const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:1933",
  targetUri: "viking://resources/main/runtime",
  semanticTopK: 4,
  keywordTopK: 4,
  detailTopK: 3,
  syncIntervalMs: 2 * 60 * 1000,
  requestTimeoutMs: 6000,
  maxBlockChars: 2200,
  excerptChars: 220,
};

const RG_CANDIDATES = [
  process.env.RG_BIN,
  "/usr/bin/rg",
  "/bin/rg",
  "/usr/local/bin/rg",
  "/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/path/rg",
  "rg",
].filter(Boolean);

function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw || {}) };
  cfg.semanticTopK = clampInt(cfg.semanticTopK, DEFAULTS.semanticTopK, 1, 8);
  cfg.keywordTopK = clampInt(cfg.keywordTopK, DEFAULTS.keywordTopK, 1, 8);
  cfg.detailTopK = clampInt(cfg.detailTopK, DEFAULTS.detailTopK, 1, 4);
  cfg.syncIntervalMs = clampInt(cfg.syncIntervalMs, DEFAULTS.syncIntervalMs, 1000, 60 * 60 * 1000);
  cfg.requestTimeoutMs = clampInt(cfg.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 500, 30 * 1000);
  cfg.maxBlockChars = clampInt(cfg.maxBlockChars, DEFAULTS.maxBlockChars, 512, 12000);
  cfg.excerptChars = clampInt(cfg.excerptChars, DEFAULTS.excerptChars, 64, 1200);
  return cfg;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeText(value, maxChars = 280) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizePromptForRetrieval(prompt) {
  let text = String(prompt || "").replace(/^\[[^\]]+\]\s*/, "");

  // Strip common OpenClaw session metadata wrappers from direct-channel turns.
  text = text
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```/g, "")
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```/g, "")
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/^\s*[\{\}"].*$/gm, "")
    .replace(/^\s*(message_id|sender_id|sender|timestamp|label|id)\s*[:：].*$/gim, "")
    .replace(/^\s*Conversation info.*$/gim, "")
    .replace(/^\s*Sender .*$/gim, "")
    .replace(/^\s*\[.*GMT\+8\]\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "```" && line !== "json");

  const candidates = lines.filter((line) => {
    if (/^(Conversation info|Sender)\b/i.test(line)) return false;
    if (/^[\[\]{}":,]+$/.test(line)) return false;
    return true;
  });

  if (candidates.length > 0) {
    return candidates[candidates.length - 1];
  }

  return text;
}

function normalizeSegment(value) {
  return (
    String(value || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "item"
  );
}

function isFileUri(uri) {
  return /\.(md|txt|json|ya?ml|ini|cfg)$/i.test(uri);
}

function shouldSkipPrompt(prompt) {
  const text = normalizePromptForRetrieval(prompt);
  if (!text) return true;
  if (text.length < 4) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes("read heartbeat.md") ||
    lower.includes("heartbeat_ok") ||
    lower.includes("heartbeat poll") ||
    lower.includes("heartbeat wake")
  );
}

function extractKeywordTerms(prompt) {
  const raw = normalizePromptForRetrieval(prompt);
  if (!raw) return [];
  const terms = [];
  const seen = new Set();
  const add = (term) => {
    const normalized = String(term || "").trim();
    if (!normalized) return;
    if (normalized.length < 2) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    terms.push(normalized);
  };

  add(raw);
  const tokenMatches =
    raw.match(/\d+[A-Za-z\u4e00-\u9fff]{1,6}|[A-Za-z0-9._/-]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  for (const token of tokenMatches) add(token);

  const cjkRuns = raw.match(/[\u4e00-\u9fff]{4,}/g) || [];
  for (const run of cjkRuns) {
    for (let start = 0; start < run.length && terms.length < 12; start += 2) {
      const shortSlice = run.slice(start, start + 2);
      const mediumSlice = run.slice(start, start + 4);
      const longSlice = run.slice(start, start + 6);
      add(shortSlice);
      add(mediumSlice);
      add(longSlice);
    }
  }

  return terms.slice(0, 8);
}

function buildSemanticQueries(prompt) {
  const full = normalizePromptForRetrieval(prompt);
  const terms = extractKeywordTerms(full);
  const queries = [];
  const seen = new Set();
  const add = (value) => {
    const query = String(value || "").trim();
    if (!query) return;
    if (seen.has(query)) return;
    seen.add(query);
    queries.push(query);
  };

  add(full);

  const meaningful = terms
    .filter((term) => term !== full)
    .filter((term) => (/[\u4e00-\u9fff]/.test(term) ? term.length >= 2 : term.length >= 3))
    .slice(0, 5);

  for (const term of meaningful) add(term);

  for (let i = 0; i < meaningful.length && queries.length < 8; i++) {
    for (let j = i + 1; j < meaningful.length && queries.length < 8; j++) {
      add(`${meaningful[i]} ${meaningful[j]}`);
    }
  }

  return queries.slice(0, 8);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadPersistentState(stateFile) {
  try {
    const raw = await fsp.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.syncedFiles) ? parsed.syncedFiles : [];
    return new Map(entries.filter((row) => Array.isArray(row) && row.length === 2));
  } catch {
    return new Map();
  }
}

async function savePersistentState(stateFile, syncedFiles) {
  const dir = path.dirname(stateFile);
  await fsp.mkdir(dir, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    syncedFiles: [...syncedFiles.entries()],
  };
  await fsp.writeFile(stateFile, JSON.stringify(payload, null, 2), "utf8");
}

async function listTopLevelMarkdown(dirPath) {
  if (!(await pathExists(dirPath))) return [];
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

async function collectWatchedFiles(workspaceDir) {
  const fixed = ["HEARTBEAT.md", "IDENTITY.md", "MEMORY.md", "OPENCLAW_RUNBOOK.md", "TOOLS.md"].map(
    (name) => path.join(workspaceDir, name),
  );

  const candidates = [];
  for (const filePath of fixed) {
    if (await pathExists(filePath)) candidates.push(filePath);
  }

  candidates.push(...(await listTopLevelMarkdown(path.join(workspaceDir, "memory"))));
  candidates.push(...(await listTopLevelMarkdown(path.join(workspaceDir, "openviking"))));

  return [...new Set(candidates)];
}

function buildTargetUri(workspaceDir, filePath) {
  const rel = path.relative(workspaceDir, filePath).replace(/\\/g, "/");
  const segments = rel.split("/").filter(Boolean);
  const top = segments[0] || "";
  let pathParts;

  if (top === "memory") {
    pathParts = ["memory"];
  } else if (top === "openviking") {
    pathParts = ["openviking"];
  } else if (segments.length <= 1) {
    pathParts = ["core"];
  } else {
    pathParts = ["misc", ...segments.slice(0, -1).map(normalizeSegment).filter(Boolean)];
  }

  return `viking://resources/main/runtime/${pathParts.join("/")}`;
}

async function fetchJson(config, route, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(`${config.serverUrl}${route}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = data?.error?.message || data?.detail || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function maybeSyncRuntimeResources(api, config, state, workspaceDir) {
  if (!state.loadedFromDisk) {
    state.stateFile = path.join(workspaceDir, ".openviking-context-bridge-state.json");
    state.syncedFiles = await loadPersistentState(state.stateFile);
    state.loadedFromDisk = true;
  }

  const now = Date.now();
  if (now - state.lastSyncAt < config.syncIntervalMs) return;
  state.lastSyncAt = now;

  const watched = await collectWatchedFiles(workspaceDir);
  state.watchedFiles = watched;

  for (const filePath of watched) {
    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch {
      continue;
    }
    const previousMtime = state.syncedFiles.get(filePath);
    if (previousMtime && previousMtime === stats.mtimeMs) continue;

    const target = buildTargetUri(workspaceDir, filePath);
    try {
      await fetchJson(config, "/api/v1/resources", {
        method: "POST",
        body: JSON.stringify({
          path: filePath,
          target,
          wait: true,
          timeout: 30,
          strict: true,
        }),
      });
      state.syncedFiles.set(filePath, stats.mtimeMs);
    } catch (err) {
      api.logger.warn(`openviking-context-bridge: sync failed for ${filePath}: ${String(err)}`);
    }
  }

  if (state.stateFile) {
    try {
      await savePersistentState(state.stateFile, state.syncedFiles);
    } catch (err) {
      api.logger.warn(`openviking-context-bridge: failed to persist sync state: ${String(err)}`);
    }
  }
}

async function runSemanticSearch(api, config, prompt) {
  try {
    const data = await fetchJson(config, "/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify({
        query: prompt,
        target_uri: config.targetUri,
        limit: config.semanticTopK,
      }),
    });
    const resources = Array.isArray(data?.result?.resources) ? data.result.resources : [];
    return resources
      .map((item) => ({
        uri: String(item.uri || ""),
        level: Number.isFinite(item.level) ? item.level : null,
        abstract: sanitizeText(item.abstract || "", config.excerptChars),
        overview: sanitizeText(item.overview || "", config.excerptChars),
      }))
      .filter((item) => item.uri);
  } catch (err) {
    api.logger.warn(`openviking-context-bridge: semantic search failed: ${String(err)}`);
    return [];
  }
}

async function runSemanticSearchVariants(api, config, prompt) {
  const queries = buildSemanticQueries(prompt);
  const deduped = [];
  const seen = new Set();

  for (const query of queries) {
    const rows = await runSemanticSearch(api, config, query);
    for (const row of rows) {
      if (seen.has(row.uri)) continue;
      seen.add(row.uri);
      deduped.push({ ...row, query });
      if (deduped.length >= config.semanticTopK) {
        return { results: deduped, queries };
      }
    }
  }

  return { results: deduped, queries };
}

async function resolveReadableUri(config, uri) {
  if (!uri) return null;
  if (isFileUri(uri)) return uri;

  try {
    const route = `/api/v1/fs/ls?${new URLSearchParams({
      uri,
      output: "agent",
      recursive: "true",
      node_limit: "8",
      abs_limit: "128",
    }).toString()}`;
    const data = await fetchJson(config, route, { method: "GET", headers: {} });
    const results = Array.isArray(data?.result) ? data.result : [];
    const firstFile = results.find(
      (entry) => entry && !entry.isDir && typeof entry.uri === "string",
    );
    return firstFile?.uri || null;
  } catch {
    return null;
  }
}

async function readUriSnippet(api, config, uri, maxChars) {
  const readableUri = await resolveReadableUri(config, uri);
  if (!readableUri) return { uri, text: "" };

  try {
    const route = `/api/v1/content/read?${new URLSearchParams({
      uri: readableUri,
      offset: "0",
      limit: "40",
    }).toString()}`;
    const data = await fetchJson(config, route, { method: "GET", headers: {} });
    return {
      uri: readableUri,
      text: sanitizeText(data?.result || "", maxChars),
    };
  } catch (err) {
    api.logger.warn(`openviking-context-bridge: read failed for ${readableUri}: ${String(err)}`);
    return { uri: readableUri, text: "" };
  }
}

async function runKeywordSearch(api, prompt, files, limit) {
  const terms = extractKeywordTerms(prompt);
  const hits = [];
  const seen = new Set();
  const existingFiles = files.filter((filePath) => fs.existsSync(filePath));
  if (existingFiles.length === 0) return hits;

  const filePriority = (filePath) => {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    if (/\/memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(normalized)) {
      const name = normalized.split("/").pop() || "";
      if (name === "2026-03-12.md") return 0;
      if (name === "2026-03-11.md") return 1;
      return 2;
    }
    if (/\/openviking\/.*\.md$/i.test(normalized)) return 3;
    if (/\/MEMORY\.md$/i.test(normalized)) return 4;
    if (/\/TOOLS\.md$/i.test(normalized)) return 5;
    if (/\/IDENTITY\.md$/i.test(normalized)) return 6;
    if (/\/HEARTBEAT\.md$/i.test(normalized)) return 7;
    return 9;
  };

  const rgBinary = RG_CANDIDATES.find(
    (candidate) => candidate === "rg" || fs.existsSync(candidate),
  );
  if (!rgBinary) {
    api.logger.warn("openviking-context-bridge: no rg binary found; keyword fallback disabled");
    return hits;
  }

  for (const term of terms) {
    if (hits.length >= limit) break;
    try {
      const { stdout } = await execFileAsync(
        rgBinary,
        ["--json", "-n", "-F", "--max-count", "2", term, ...existingFiles],
        {
          maxBuffer: 1024 * 1024,
        },
      );

      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type !== "match") continue;
        const filePath = parsed.data?.path?.text;
        const lineNumber = parsed.data?.line_number;
        const text = parsed.data?.lines?.text;
        if (!filePath || !lineNumber || !text) continue;
        const key = `${filePath}:${lineNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          filePath,
          lineNumber,
          text: sanitizeText(text, 220),
          term,
        });
        if (hits.length >= limit) break;
      }
    } catch (err) {
      if (err && typeof err.code === "number" && err.code === 1) {
        continue;
      }
      if (String(err).includes("code 1")) continue;
      api.logger.warn(
        `openviking-context-bridge: keyword search failed for "${term}": ${String(err)}`,
      );
    }
  }

  hits.sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.filePath || "").localeCompare(b.filePath || "") ||
      a.lineNumber - b.lineNumber,
  );
  return hits.slice(0, limit);
}

async function readFileSnippet(filePath, maxChars) {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    return sanitizeText(text, maxChars);
  } catch {
    return "";
  }
}

function trimToBudget(text, maxChars) {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

async function buildContextBlock(api, config, prompt, workspaceDir, state) {
  const retrievalPrompt = normalizePromptForRetrieval(prompt);
  await maybeSyncRuntimeResources(api, config, state, workspaceDir);

  const semanticProbe = await runSemanticSearchVariants(api, config, retrievalPrompt);
  const semanticHits = semanticProbe.results;
  const keywordTerms = extractKeywordTerms(retrievalPrompt);
  const keywordHits = await runKeywordSearch(
    api,
    retrievalPrompt,
    state.watchedFiles || [],
    config.keywordTopK,
  );
  state.lastSemanticCount = semanticHits.length;
  state.lastKeywordCount = keywordHits.length;
  state.lastSemanticQueries = semanticProbe.queries;
  state.lastKeywordTerms = keywordTerms;

  if (semanticHits.length === 0 && keywordHits.length === 0) return null;

  const lines = [
    "<openviking-context>",
    "Use this retrieved context only when it is relevant. It may be incomplete or stale.",
  ];

  if (keywordHits.length > 0) {
    lines.push("", "## Keyword Fallback");
    for (const [index, hit] of keywordHits.slice(0, config.keywordTopK).entries()) {
      const rel = path.relative(workspaceDir, hit.filePath).replace(/\\/g, "/");
      lines.push(`${index + 1}. [keyword] ${rel}:${hit.lineNumber} :: ${hit.text}`);
    }
  }

  if (semanticHits.length > 0) {
    lines.push("", "## Semantic Index (L0/L1)");
    for (const [index, hit] of semanticHits.slice(0, config.semanticTopK).entries()) {
      const summary = hit.abstract || hit.overview || "(no summary)";
      lines.push(`${index + 1}. [semantic] ${hit.uri} :: ${summary}`);
    }
  }

  const detailedSections = [];
  const usedDetailKeys = new Set();

  for (const hit of keywordHits) {
    if (detailedSections.length >= config.detailTopK) break;
    const rel = path.relative(workspaceDir, hit.filePath).replace(/\\/g, "/");
    if (usedDetailKeys.has(rel)) continue;
    const text = await readFileSnippet(hit.filePath, 520);
    if (!text) continue;
    usedDetailKeys.add(rel);
    detailedSections.push(`### ${rel}\n${text}`);
  }

  for (const hit of semanticHits.slice(0, config.detailTopK)) {
    if (detailedSections.length >= config.detailTopK) break;
    const detail = await readUriSnippet(api, config, hit.uri, 520);
    if (!detail.text) continue;
    if (usedDetailKeys.has(detail.uri)) continue;
    usedDetailKeys.add(detail.uri);
    detailedSections.push(`### ${detail.uri}\n${detail.text}`);
  }

  state.lastDetailSources = detailedSections.map((section) =>
    section.split("\n", 1)[0].replace(/^###\s+/, ""),
  );

  if (detailedSections.length > 0) {
    lines.push("", "## On-Demand Detail (L2)", ...detailedSections);
  }

  lines.push("</openviking-context>");
  const joined = lines.join("\n");
  state.lastTrimmed = joined.length > config.maxBlockChars;
  return trimToBudget(joined, config.maxBlockChars);
}

module.exports = {
  id: "openviking-context-bridge",
  name: "OpenViking Context Bridge",

  register(api) {
    const config = normalizeConfig(api.pluginConfig);
    const state = {
      lastSyncAt: 0,
      syncedFiles: new Map(),
      watchedFiles: [],
      lastError: null,
      lastContextPreview: null,
      lastBuiltAt: null,
      lastSemanticCount: 0,
      lastKeywordCount: 0,
      lastSemanticQueries: [],
      lastKeywordTerms: [],
      lastDetailSources: [],
      lastTrimmed: false,
      loadedFromDisk: false,
      stateFile: null,
    };

    api.registerHttpRoute({
      path: "/plugins/openviking-context-bridge/status",
      auth: "plugin",
      match: "exact",
      handler(_req, res) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            config,
            watchedFiles: state.watchedFiles,
            syncedFileCount: state.syncedFiles.size,
            stateFile: state.stateFile,
            lastBuiltAt: state.lastBuiltAt,
            lastSemanticCount: state.lastSemanticCount,
            lastKeywordCount: state.lastKeywordCount,
            lastSemanticQueries: state.lastSemanticQueries,
            lastKeywordTerms: state.lastKeywordTerms || [],
            lastDetailSources: state.lastDetailSources || [],
            lastTrimmed: state.lastTrimmed || false,
            lastError: state.lastError,
            lastContextPreview: state.lastContextPreview,
          }),
        );
        return true;
      },
    });

    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const prompt = String(event?.prompt || "");
        if (shouldSkipPrompt(prompt)) return;

        const workspaceDir =
          typeof ctx?.workspaceDir === "string" && ctx.workspaceDir
            ? ctx.workspaceDir
            : api.resolvePath(".");

        try {
          const block = await buildContextBlock(api, config, prompt, workspaceDir, state);
          if (!block) return;
          state.lastBuiltAt = new Date().toISOString();
          state.lastContextPreview = block.slice(0, 600);
          state.lastError = null;
          return { prependContext: block };
        } catch (err) {
          state.lastError = String(err);
          api.logger.warn(`openviking-context-bridge: prompt injection failed: ${String(err)}`);
          return;
        }
      },
      { priority: 20 },
    );

    api.logger.info(
      `openviking-context-bridge: registered (server=${config.serverUrl}, target=${config.targetUri})`,
    );
  },
};
