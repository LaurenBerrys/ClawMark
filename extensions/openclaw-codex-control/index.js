const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const {
  buildManagedRuntimeEnv,
  resolveControlExtensionPaths
} = require("./lib/instance-paths.js");

const INSTANCE_PATHS = resolveControlExtensionPaths();

const PROVIDER = "openai-codex";
const CODEX_CLI_PREFIX = "codex-cli";
const DEFAULT_ROUTE_BASE = "/plugins/openclaw-codex-control";
const CONFIG_PATH = INSTANCE_PATHS.configPath;
const AUTH_STORE_PATH = path.join(INSTANCE_PATHS.agentsRoot, "main", "agent", "auth-profiles.json");
const CODEX_HOME = INSTANCE_PATHS.codexRoot;
const OPENCLAW_SKILLS_DIR = INSTANCE_PATHS.skillsRoot;
const CODEX_SKILLS_DIR = path.join(CODEX_HOME, "skills");
const CODEX_CLI_AUTH_PATH = path.join(CODEX_HOME, "auth.json");
const CODEX_CLI_CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
const CODEX_CLI_STORE_PATH = path.join(INSTANCE_PATHS.controlStateDir, "codex-cli-profiles.json");
const CONTROL_STATE_DIR = INSTANCE_PATHS.controlStateDir;
const AUTOPILOT_STORE_PATH = path.join(
  CONTROL_STATE_DIR,
  "autopilot.json"
);
const INTEL_STORE_PATH = path.join(CONTROL_STATE_DIR, "intel.json");
const MEMORY_STORE_PATH = path.join(CONTROL_STATE_DIR, "memory.json");
const EVOLUTION_STORE_PATH = path.join(CONTROL_STATE_DIR, "evolution.json");
const EVENT_LOG_PATH = path.join(CONTROL_STATE_DIR, "events.jsonl");
const SKILL_GOVERNANCE_STORE_PATH = path.join(CONTROL_STATE_DIR, "skill-governance.json");
const INJECT_JS_PATH = path.join(__dirname, "ui", "inject.js");
const OAUTH_HELPER_PATH = INSTANCE_PATHS.oauthHelperPath;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;
const AUTOPILOT_TICK_MS = 60 * 1000;
const INTEL_REFRESH_MINUTES = 180;
const INTEL_DIGEST_RETRY_BACKOFF_MS = 30 * 60 * 1000;
const EVOLUTION_REVIEW_INTERVAL_MS = 12 * 60 * 60 * 1000;
const EVOLUTION_SHADOW_MIN_OBSERVATIONS = 3;
const EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS = 4;
const EVOLUTION_ROUTE_SUCCESS_RATE_MIN = 0.65;
const EVOLUTION_ROUTE_COMPLETION_MIN = 62;
const EVOLUTION_ROUTE_SHADOW_WIN_RATE_PROMOTE = 0.55;
const EVOLUTION_ROUTE_SHADOW_WIN_RATE_ADOPT = 0.62;
const EVENT_LOG_TAIL_LIMIT = 120;
const INTEL_ITEM_RETENTION = 600;
const INTEL_DIGEST_RETENTION = 45;
const MEMORY_ENTRY_RETENTION = 800;
const STRATEGY_ENTRY_RETENTION = 240;
const AUTOPILOT_TASK_STATUSES = new Set([
  "queued",
  "planning",
  "ready",
  "running",
  "blocked",
  "waiting_external",
  "waiting_user",
  "completed",
  "cancelled"
]);
const AUTOPILOT_PRIORITIES = new Set(["low", "normal", "high"]);
const AUTOPILOT_BUDGET_MODES = new Set(["strict", "balanced", "deep"]);
const AUTOPILOT_RETRIEVAL_MODES = new Set(["off", "light", "deep"]);
const AUTOPILOT_REPORT_POLICIES = new Set(["reply_and_proactive", "reply_only", "proactive_only", "silent"]);
const SKILL_GOVERNANCE_ALLOWED_DECISION_STATES = new Set(["candidate", "adopted", "core"]);
const OPENCLAW_BIN = INSTANCE_PATHS.openclawBin;
const DEFAULT_AUTOPILOT_SESSION_PREFIX = "autopilot-task";
const AUTOPILOT_BLOCK_NOTIFY_AFTER_MS = 10 * 60 * 1000;
const AUTOPILOT_MIN_NOTIFY_GAP_MS = 10 * 60 * 1000;
const AUTOPILOT_TASK_CAPTURE_LOOKBACK = 6;
const AUTOPILOT_RETRY_BACKOFF_MINUTES = [3, 10, 30];
const AUTOPILOT_MAX_CONSECUTIVE_FAILURES = 4;
const DEFAULT_AUTOPILOT_CONFIG = Object.freeze({
  enabled: true,
  localFirst: true,
  heartbeatEnabled: true,
  defaultBudgetMode: "strict",
  defaultRetrievalMode: "light",
  maxInputTokensPerTurn: 6000,
  maxContextChars: 9000,
  maxRemoteCallsPerTask: 6,
  dailyRemoteTokenBudget: 250000
});
const DEFAULT_INTEL_CONFIG = Object.freeze({
  enabled: true,
  digestEnabled: true,
  refreshMinutes: INTEL_REFRESH_MINUTES,
  digestHourLocal: 9,
  candidateLimitPerDomain: 20,
  digestItemLimitPerDomain: 10,
  exploitItemsPerDigest: 8,
  exploreItemsPerDigest: 2,
  maxItemsPerSourceInDigest: 2,
  recentDigestTopicWindowDays: 5,
  llmJudgeEnabled: true,
  llmAgent: "research",
  deliveryMode: "preferred_recent",
  notifyOnlyHighUrgency: true
});
const DEFAULT_EVOLUTION_CONFIG = Object.freeze({
  enabled: true,
  autoApplyLowRisk: true,
  reviewIntervalHours: 12
});
const DEFAULT_INTEL_DOMAINS = Object.freeze([
  {
    id: "tech",
    label: "科技",
    keywords: ["technology", "tech", "startup", "chip", "software", "cloud", "developer"],
    sources: [
      { id: "hn-frontpage", url: "https://hnrss.org/frontpage", priority: 1.0 },
      { id: "techcrunch", url: "https://techcrunch.com/feed/", priority: 0.9 },
      { id: "theverge", url: "https://www.theverge.com/rss/index.xml", priority: 0.8 },
      { id: "arstechnica", url: "https://feeds.arstechnica.com/arstechnica/index", priority: 0.8 }
    ]
  },
  {
    id: "ai",
    label: "AI",
    keywords: ["ai", "artificial intelligence", "model", "agent", "llm", "inference", "gpu"],
    sources: [
      { id: "openai-news", url: "https://openai.com/news/rss.xml", priority: 1.0 },
      { id: "anthropic-news", url: "https://www.anthropic.com/news/rss.xml", priority: 0.95 },
      { id: "mit-ai", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", priority: 0.85 },
      { id: "google-ai", url: "https://blog.google/technology/ai/rss/", priority: 0.8 }
    ]
  },
  {
    id: "business",
    label: "商业",
    keywords: ["business", "market", "company", "funding", "finance", "policy", "economy"],
    sources: [
      { id: "reuters-business", url: "https://feeds.reuters.com/reuters/businessNews", priority: 1.0 },
      { id: "cnbc-business", url: "https://www.cnbc.com/id/10001147/device/rss/rss.html", priority: 0.9 },
      { id: "reuters-top", url: "https://feeds.reuters.com/reuters/topNews", priority: 0.75 },
      { id: "marketwatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/", priority: 0.75 }
    ]
  }
]);

let activeLogin = null;
let autopilotTicker = null;
const autopilotRuntime = {
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  lastSnapshot: null,
  activeTaskId: null,
  activeTaskStartedAt: null
};
const intelRuntime = {
  activeDomainId: null,
  activeDigestDomainId: null,
  lastTickAt: null,
  lastError: null
};
const evolutionRuntime = {
  active: false,
  lastTickAt: null,
  lastError: null,
  lastReviewAt: null
};

const skillGovernanceRuntime = {
  mtimeMs: 0,
  store: null
};
let pluginApi = null;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowTs() {
  return Date.now();
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function safeParseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function hashText(value, size = 12) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return null;
  const abs = Math.abs(ms);
  const sign = ms < 0 ? "-" : "";
  const units = [
    ["d", 24 * 60 * 60 * 1000],
    ["h", 60 * 60 * 1000],
    ["m", 60 * 1000]
  ];
  for (const [label, size] of units) {
    if (abs >= size) return `${sign}${Math.round(abs / size)}${label}`;
  }
  return `${sign}${Math.max(1, Math.round(abs / 1000))}s`;
}

function toIso(value) {
  if (!value || !Number.isFinite(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function shortId(value, size = 8) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, size);
}

function naturalProfileIdForEmail(email) {
  const normalized = String(email || "").trim();
  return `${PROVIDER}:${normalized || "default"}`;
}

function sanitizeAlias(alias) {
  const cleaned = String(alias || "")
    .trim()
    .toLowerCase()
    .replace(/^openai-codex:/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!cleaned) throw new Error("Alias is empty after sanitization.");
  return `${PROVIDER}:${cleaned}`;
}

function makeUniqueProfileId(baseId, existingProfiles) {
  let candidate = String(baseId || "").trim();
  if (!candidate) throw new Error("Profile id is empty.");
  let index = 2;
  while (existingProfiles?.[candidate]) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  return candidate;
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function readTextFile(filePath, fallback) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(tempPath, text, "utf8");
  await fsp.rename(tempPath, filePath);
}

async function writeJsonAtomicSecure(filePath, value) {
  await writeJsonAtomic(filePath, value);
  try {
    await fsp.chmod(filePath, 0o600);
  } catch {}
}

async function appendJsonLine(filePath, value) {
  const text = `${JSON.stringify(value)}\n`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, text, "utf8");
  try {
    await fsp.chmod(filePath, 0o600);
  } catch {}
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function loadConfig() {
  return readJsonFile(CONFIG_PATH, {});
}

async function loadStore() {
  return readJsonFile(AUTH_STORE_PATH, { version: 1, profiles: {} });
}

async function loadCodexCliStore() {
  return readJsonFile(CODEX_CLI_STORE_PATH, { version: 1, profiles: {} });
}

async function loadAutopilotStore() {
  return normalizeAutopilotStore(await readJsonFile(AUTOPILOT_STORE_PATH, null));
}

async function loadIntelStore() {
  const raw = await readJsonFile(INTEL_STORE_PATH, null);
  if (raw == null) {
    return saveIntelStore(normalizeIntelStore(null));
  }
  return normalizeIntelStore(raw);
}

async function loadMemoryStore() {
  const raw = await readJsonFile(MEMORY_STORE_PATH, null);
  if (raw == null) {
    return saveMemoryStore(normalizeMemoryStore(null));
  }
  return normalizeMemoryStore(raw);
}

let managedRuntimeDecisionCorePromise = null;
let managedRuntimeTaskLoopPromise = null;
let managedRuntimeTaskArtifactsPromise = null;
let managedRuntimeTaskLoopWarned = false;
let managedRuntimeTaskArtifactsWarned = false;

async function loadManagedRuntimeDecisionCore() {
  if (!managedRuntimeDecisionCorePromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "decision-core.js")
    ).href;
    managedRuntimeDecisionCorePromise = import(modulePath).catch((error) => {
      managedRuntimeDecisionCorePromise = null;
      throw error;
    });
  }
  return managedRuntimeDecisionCorePromise;
}

async function loadManagedRuntimeTaskLoopCore() {
  if (!managedRuntimeTaskLoopPromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "task-loop.js")
    ).href;
    managedRuntimeTaskLoopPromise = import(modulePath).catch((error) => {
      managedRuntimeTaskLoopPromise = null;
      throw error;
    });
  }
  return managedRuntimeTaskLoopPromise;
}

async function loadManagedRuntimeTaskArtifactsCore() {
  if (!managedRuntimeTaskArtifactsPromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "task-artifacts.js")
    ).href;
    managedRuntimeTaskArtifactsPromise = import(modulePath).catch((error) => {
      managedRuntimeTaskArtifactsPromise = null;
      throw error;
    });
  }
  return managedRuntimeTaskArtifactsPromise;
}

async function loadEvolutionStore() {
  const raw = await readJsonFile(EVOLUTION_STORE_PATH, null);
  if (raw == null) {
    return saveEvolutionStore(normalizeEvolutionStore(null));
  }
  return normalizeEvolutionStore(raw);
}

function resolveAgentSessionsStorePath(agentId = "main") {
  return path.join(
    INSTANCE_PATHS.agentsRoot,
    normalizeString(agentId, "main"),
    "sessions",
    "sessions.json"
  );
}

async function loadAgentSessionsStore(agentId = "main") {
  return readJsonFile(resolveAgentSessionsStorePath(agentId), {});
}

async function resolveSessionEntry(agentId, sessionKey) {
  if (!sessionKey) return null;
  const store = await loadAgentSessionsStore(agentId);
  return isRecord(store?.[sessionKey]) ? store[sessionKey] : null;
}

async function isHeartbeatSession(agentId, sessionKey) {
  if (!sessionKey) return false;
  if (sessionKey === "agent:main:main") return true;
  const entry = await resolveSessionEntry(agentId, sessionKey);
  const to = normalizeString(entry?.deliveryContext?.to || entry?.lastTo).toLowerCase();
  const provider = normalizeString(entry?.origin?.provider).toLowerCase();
  return to === "heartbeat" || provider === "heartbeat";
}

async function readTranscriptTail(filePath, maxChars = 200000) {
  const text = await readTextFile(filePath, "");
  if (!text) return "";
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

async function readRecentTranscriptMessages(filePath, limit = AUTOPILOT_TASK_CAPTURE_LOOKBACK) {
  const tail = await readTranscriptTail(filePath);
  if (!tail) return [];
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const result = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = safeParseJson(lines[index], null);
    if (!parsed || parsed.type !== "message") continue;
    result.push(parsed);
    if (result.length >= limit) break;
  }
  return result;
}

function extractLatestUserTranscriptMessage(entries) {
  for (const entry of entries) {
    if (entry?.message?.role === "user") return entry;
  }
  return null;
}

function buildSourceMetaFromTranscript(entry, sessionEntry, sessionKey) {
  const contentText = extractTextBlocksFromContent(entry?.message?.content);
  const conversationInfo = extractMessageInfoJson(contentText);
  const senderInfo = extractSenderInfoJson(contentText);
  const delivery = normalizeAutopilotDelivery({
    channel: sessionEntry?.deliveryContext?.channel || sessionEntry?.lastChannel,
    target: sessionEntry?.deliveryContext?.to || sessionEntry?.lastTo,
    accountId: sessionEntry?.deliveryContext?.accountId || sessionEntry?.lastAccountId,
    threadId: sessionEntry?.deliveryContext?.threadId || sessionEntry?.lastThreadId,
    replyTo: conversationInfo.message_id || null
  });
  return {
    body: extractMessageBody(contentText),
    rawText: contentText,
    info: conversationInfo,
    sender: senderInfo,
    sourceMeta: normalizeAutopilotSourceMeta({
      sessionKey,
      messageId: conversationInfo.message_id,
      senderId: conversationInfo.sender_id || senderInfo.id,
      senderLabel: senderInfo.label || senderInfo.name,
      channel: delivery.channel,
      accountId: delivery.accountId,
      target: delivery.target,
      threadId: delivery.threadId,
      originLabel: sessionEntry?.origin?.label || null,
      transcriptTimestamp: entry?.timestamp || null
    }),
    delivery
  };
}

function shouldIgnoreIncomingAutopilotMessage(messageMeta) {
  const senderId = normalizeString(messageMeta?.sourceMeta?.senderId).toLowerCase();
  const body = normalizeString(messageMeta?.body);
  if (!body) return true;
  if (senderId === "system" && !isLikelyTaskText(body)) return true;
  if (body === "HEARTBEAT_OK") return true;
  return false;
}

async function runOpenClawCli(args, options = {}) {
  const timeoutMs = clampInt(options.timeoutMs, 8 * 60 * 1000, 1000, 60 * 60 * 1000);
  const env = buildManagedRuntimeEnv(process.env, INSTANCE_PATHS);
  return await new Promise((resolve) => {
    const child = spawn(OPENCLAW_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim()
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${String(error?.message || error)}`.trim()
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr
      });
    });
  });
}

function normalizeString(value, fallback = "") {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function parseOptionalTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function clampInt(value, fallback, min, max) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return dedupe(
    value
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
  );
}

function normalizeOptionalRecord(value) {
  return isRecord(value) ? structuredClone(value) : null;
}

function normalizeAutopilotStatusValue(value, fallback = "queued") {
  const text = normalizeString(value, fallback);
  if (text === "waiting_human") return "waiting_user";
  if (text === "done") return "completed";
  return AUTOPILOT_TASK_STATUSES.has(text) ? text : fallback;
}

function normalizeOptionalAutopilotStatusValue(value) {
  const text = normalizeString(value);
  if (!text) return null;
  return normalizeAutopilotStatusValue(text, text);
}

function getAutopilotStatusAliases(status) {
  const normalized = normalizeAutopilotStatusValue(status, normalizeString(status));
  if (normalized === "waiting_user") return ["waiting_user", "waiting_human"];
  if (normalized === "completed") return ["completed", "done"];
  return normalized ? [normalized] : [];
}

function isAutopilotTerminalStatus(status) {
  return status === "completed" || status === "cancelled";
}

function shouldAutopilotTaskRun(task, ts = nowTs()) {
  if (!task || isAutopilotTerminalStatus(task.status)) return false;
  if (task.status === "waiting_user") return false;
  if (!task.nextRunAt) return task.status === "queued" || task.status === "planning" || task.status === "ready" || task.status === "blocked";
  return task.nextRunAt <= ts;
}

function compareAutopilotTasks(left, right) {
  const priorityRank = {
    high: 0,
    normal: 1,
    low: 2
  };
  const statusRank = {
    blocked: 0,
    queued: 1,
    planning: 2,
    ready: 3,
    waiting_external: 4,
    running: 5,
    waiting_user: 6,
    completed: 7,
    cancelled: 8
  };
  const leftPriority = priorityRank[left.priority] ?? 9;
  const rightPriority = priorityRank[right.priority] ?? 9;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftStatus = statusRank[left.status] ?? 9;
  const rightStatus = statusRank[right.status] ?? 9;
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;
  const leftNext = left.nextRunAt || 0;
  const rightNext = right.nextRunAt || 0;
  if (leftNext !== rightNext) return leftNext - rightNext;
  return (left.updatedAt || left.createdAt || 0) - (right.updatedAt || right.createdAt || 0);
}

function normalizeAutopilotDelivery(value) {
  const source = isRecord(value) ? value : {};
  return {
    channel: normalizeString(source.channel) || null,
    target: normalizeString(source.target || source.to) || null,
    accountId: normalizeString(source.accountId) || null,
    threadId: normalizeString(source.threadId) || null,
    replyTo: normalizeString(source.replyTo) || null
  };
}

function normalizeAutopilotSourceMeta(value) {
  const source = isRecord(value) ? value : {};
  return {
    sessionKey: normalizeString(source.sessionKey) || null,
    messageId: normalizeString(source.messageId) || null,
    senderId: normalizeString(source.senderId) || null,
    senderLabel: normalizeString(source.senderLabel) || null,
    channel: normalizeString(source.channel) || null,
    accountId: normalizeString(source.accountId) || null,
    target: normalizeString(source.target) || null,
    threadId: normalizeString(source.threadId) || null,
    originLabel: normalizeString(source.originLabel) || null,
    transcriptTimestamp: normalizeString(source.transcriptTimestamp) || null
  };
}

function normalizeAutopilotRunState(value) {
  const source = isRecord(value) ? value : {};
  return {
    lastResultStatus: normalizeOptionalAutopilotStatusValue(source.lastResultStatus),
    lastResultSummary: normalizeString(source.lastResultSummary) || null,
    lastWorkerOutput: normalizeString(source.lastWorkerOutput) || null,
    lastCliExitCode: Number.isFinite(Number(source.lastCliExitCode)) ? Number(source.lastCliExitCode) : null,
    backgroundSessionId: normalizeString(source.backgroundSessionId) || null,
    blockedAt: parseOptionalTimestamp(source.blockedAt),
    completedAt: parseOptionalTimestamp(source.completedAt),
    lastNotifyAt: parseOptionalTimestamp(source.lastNotifyAt),
    lastNotifiedStatus: normalizeOptionalAutopilotStatusValue(source.lastNotifiedStatus),
    memoryLoggedStatuses: dedupe(
      normalizeStringArray(source.memoryLoggedStatuses)
        .map((entry) => normalizeOptionalAutopilotStatusValue(entry))
        .filter(Boolean)
    ),
    consecutiveFailures: clampInt(source.consecutiveFailures, 0, 0, 1000),
    totalFailures: clampInt(source.totalFailures, 0, 0, 100000),
    replanCount: clampInt(source.replanCount, 0, 0, 100000),
    lastFailureAt: parseOptionalTimestamp(source.lastFailureAt),
    lastFailureSummary: normalizeString(source.lastFailureSummary) || null,
    triedAssignees: normalizeStringArray(source.triedAssignees),
    lastDecisionAt: parseOptionalTimestamp(source.lastDecisionAt),
    lastThinkingLane: normalizeString(source.lastThinkingLane) || null,
    lastDecisionSummary: normalizeString(source.lastDecisionSummary) || null,
    lastRecommendedWorker: normalizeString(source.lastRecommendedWorker) || null,
    lastRecommendedSkills: normalizeStringArray(source.lastRecommendedSkills),
    lastRelevantMemoryIds: normalizeStringArray(source.lastRelevantMemoryIds),
    lastRelevantIntelIds: normalizeStringArray(source.lastRelevantIntelIds),
    lastFallbackOrder: normalizeStringArray(source.lastFallbackOrder),
    remoteCallCount: clampInt(source.remoteCallCount, 0, 0, 100000)
  };
}

function normalizeAutopilotTaskHintSet(value) {
  return filterGovernedSkillHints(normalizeStringArray(value));
}

function normalizeSkillGovernanceEntry(entry) {
  const source = isRecord(entry) ? entry : {};
  return {
    id: normalizeString(source.id),
    title: normalizeString(source.title),
    origin: normalizeString(source.origin, "local"),
    path: normalizeString(source.path),
    routeAffinity: normalizeString(source.routeAffinity, "general"),
    sideEffectLevel: normalizeString(source.sideEffectLevel, "medium"),
    tokenProfile: normalizeString(source.tokenProfile, "medium"),
    trustClass: normalizeString(source.trustClass, "local"),
    adoptionState: normalizeString(source.adoptionState, "shadow"),
    notes: normalizeString(source.notes),
    findings: normalizeStringArray(source.findings).slice(0, 32),
    lastAuditedAt: parseOptionalTimestamp(source.lastAuditedAt),
    updatedAt: parseOptionalTimestamp(source.updatedAt)
  };
}

function buildDefaultSkillGovernanceStore() {
  return {
    version: 1,
    scannedAt: null,
    rules: {
      enforceDecisionFilter: false,
      allowedDecisionStates: [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES]
    },
    skills: []
  };
}

function normalizeSkillGovernanceStore(store) {
  const source = isRecord(store) ? store : {};
  const rules = isRecord(source.rules) ? source.rules : {};
  return {
    version: clampInt(source.version, 1, 1, 999),
    scannedAt: parseOptionalTimestamp(source.scannedAt),
    rules: {
      enforceDecisionFilter: rules.enforceDecisionFilter === true,
      allowedDecisionStates: normalizeStringArray(rules.allowedDecisionStates).length
        ? normalizeStringArray(rules.allowedDecisionStates)
        : [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES]
    },
    skills: (Array.isArray(source.skills) ? source.skills : [])
      .map((entry) => normalizeSkillGovernanceEntry(entry))
      .filter((entry) => entry.id)
  };
}

function loadSkillGovernanceStoreSync() {
  try {
    if (!fs.existsSync(SKILL_GOVERNANCE_STORE_PATH)) {
      return buildDefaultSkillGovernanceStore();
    }
    const stat = fs.statSync(SKILL_GOVERNANCE_STORE_PATH);
    if (
      skillGovernanceRuntime.store &&
      skillGovernanceRuntime.mtimeMs === stat.mtimeMs
    ) {
      return skillGovernanceRuntime.store;
    }
    const parsed = safeParseJson(fs.readFileSync(SKILL_GOVERNANCE_STORE_PATH, "utf8"), null);
    const normalized = normalizeSkillGovernanceStore(parsed);
    skillGovernanceRuntime.mtimeMs = stat.mtimeMs;
    skillGovernanceRuntime.store = normalized;
    return normalized;
  } catch {
    return buildDefaultSkillGovernanceStore();
  }
}

function skillLooksInstalledLocally(skillId) {
  if (!skillId) return false;
  return [
    path.join(OPENCLAW_SKILLS_DIR, skillId, "SKILL.md"),
    path.join(CODEX_SKILLS_DIR, skillId, "SKILL.md"),
    path.join(CODEX_SKILLS_DIR, ".system", skillId, "SKILL.md")
  ].some((candidate) => fs.existsSync(candidate));
}

function filterGovernedSkillHints(value) {
  const hints = normalizeStringArray(value);
  if (!hints.length) return [];
  const store = loadSkillGovernanceStoreSync();
  if (!store.rules.enforceDecisionFilter) return hints.slice(0, 16);
  const allowedStates = new Set(
    normalizeStringArray(store.rules.allowedDecisionStates).length
      ? normalizeStringArray(store.rules.allowedDecisionStates)
      : [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES]
  );
  const byId = new Map(store.skills.map((entry) => [entry.id, entry]));
  return hints
    .filter((skillId) => {
      const governed = byId.get(skillId);
      if (governed) return allowedStates.has(governed.adoptionState);
      if (skillLooksInstalledLocally(skillId)) return false;
      return true;
    })
    .slice(0, 16);
}

function normalizeKeywordTags(value) {
  return normalizeStringArray(value).slice(0, 24);
}

function extractKeywordTags(text, extra = []) {
  const source = `${normalizeString(text)} ${normalizeStringArray(extra).join(" ")}`.toLowerCase();
  if (!source) return [];
  const english = source.match(/[a-z][a-z0-9._-]{2,}/g) || [];
  const chinese = source.match(/[\u4e00-\u9fff]{2,6}/g) || [];
  const filtered = [...english, ...chinese]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2 && !/^(please|thanks|task|agent|with|from|that|this|have|will)$/.test(entry));
  return normalizeKeywordTags(filtered);
}

function normalizeTaskTitle(value, fallbackGoal) {
  const title = normalizeString(value);
  if (title) return title;
  const goal = normalizeString(fallbackGoal);
  if (!goal) return "未命名任务";
  return goal.length > 48 ? `${goal.slice(0, 48)}...` : goal;
}

function normalizeTaskGoal(value) {
  return normalizeString(value).replace(/\s+/g, " ").trim();
}

function isLikelyHumanAck(text) {
  const normalized = normalizeString(text).toLowerCase();
  return new Set([
    "你好",
    "hi",
    "hello",
    "收到",
    "好的",
    "ok",
    "okay",
    "可以",
    "嗯",
    "嗯嗯",
    "在吗",
    "在么",
    "好的呀",
    "行",
    "行的"
  ]).has(normalized);
}

function hasTaskVerb(text) {
  const normalized = normalizeString(text).toLowerCase();
  const patterns = [
    /帮我/,
    /请/,
    /麻烦/,
    /继续/,
    /整理/,
    /处理/,
    /分析/,
    /总结/,
    /对比/,
    /研究/,
    /调查/,
    /搜索/,
    /查/,
    /写/,
    /做/,
    /开发/,
    /部署/,
    /修/,
    /排查/,
    /调试/,
    /生成/,
    /发给我/,
    /发我/,
    /提醒/,
    /跟进/,
    /安排/,
    /计划/,
    /实现/,
    /能不能/,
    /可不可以/,
    /need to/,
    /please/,
    /build/,
    /implement/,
    /debug/,
    /fix/,
    /investigate/,
    /research/,
    /summari[sz]e/,
    /compare/,
    /deploy/,
    /notify/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isLikelyTaskText(text) {
  const normalized = normalizeString(text);
  if (!normalized) return false;
  if (isLikelyHumanAck(normalized)) return false;
  const inboundMediaPrefix = path.join(INSTANCE_PATHS.stateRoot, "media", "inbound").replace(/\\/g, "/");
  if (normalized.includes(inboundMediaPrefix)) return true;
  if (normalized.length >= 24) return true;
  if (/[？?]/.test(normalized) && hasTaskVerb(normalized)) return true;
  return hasTaskVerb(normalized);
}

function looksLikeContinuation(text) {
  const normalized = normalizeString(text).toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /^继续/,
    /^然后/,
    /^顺便/,
    /^另外/,
    /^对了/,
    /^还有/,
    /^更新/,
    /^进度/,
    /^完成了吗/,
    /^还在吗/,
    /^记得/,
    /^别忘/,
    /^先/,
    /^再/,
    /^补充/,
    /^补一下/,
    /^补个/,
    /^and /,
    /^also /,
    /^next /,
    /^continue /
  ];
  return normalized.length <= 120 && patterns.some((pattern) => pattern.test(normalized));
}

function classifyTaskRoute(text) {
  const normalized = normalizeString(text).toLowerCase();
  const mediaPatterns = [/ocr/, /图片/, /截图/, /长图/, /视频/, /音频/, /表格/, /文档整理/, /识别/, /提取/];
  const officePatterns = [/飞书/, /企微/, /微信/, /文档/, /多维表格/, /bitable/, /日历/, /任务/, /待办/, /提醒/, /通知/];
  const coderPatterns = [/代码/, /repo/, /git/, /commit/, /pull request/, /pr/, /接口/, /api/, /服务开发/, /编程/, /写代码/, /开发/, /实现/];
  const opsPatterns = [/日志/, /端口/, /服务/, /重启/, /部署/, /nginx/, /docker/, /cloudflared/, /故障/, /排障/, /监控/, /修复/, /运维/];
  const researchPatterns = [/调研/, /研究/, /咨询/, /对比/, /比较/, /搜索/, /搜集/, /资料/, /信息/, /知识库/, /方案/];
  if (mediaPatterns.some((pattern) => pattern.test(normalized))) return { route: "media", assignee: "media" };
  if (coderPatterns.some((pattern) => pattern.test(normalized))) return { route: "coder", assignee: "coder" };
  if (opsPatterns.some((pattern) => pattern.test(normalized))) return { route: "ops", assignee: "ops" };
  if (officePatterns.some((pattern) => pattern.test(normalized))) return { route: "office", assignee: "office" };
  if (researchPatterns.some((pattern) => pattern.test(normalized))) return { route: "research", assignee: "research" };
  return { route: "general", assignee: "main" };
}

function buildSkillHintsForTask(route, text) {
  const normalized = normalizeString(text).toLowerCase();
  const hints = ["personal-superintelligence", "personal-memory-maintainer"];
  if (route === "office") {
    hints.push("personal-office-executor", "feishu-task", "feishu-bitable", "feishu-create-doc", "feishu-update-doc", "feishu-im-read");
    if (/表格|图片|ocr|截图|多维表格/.test(normalized)) hints.push("image-to-feishu-table", "image-ocr");
  } else if (route === "media") {
    hints.push("personal-media-executor", "image-ocr", "image-to-feishu-table", "word-docx", "video-frames");
  } else if (route === "coder") {
    hints.push("personal-coder-executor", "coding-agent", "github", "tmux");
  } else if (route === "ops") {
    hints.push("personal-ops-executor", "windows-ops", "home-stack", "healthcheck", "tmux");
  } else if (route === "research") {
    hints.push("personal-research-executor", "tavily", "answeroverflow", "api-gateway");
  } else {
    hints.push("self-improvement", "windows-ops");
  }
  return normalizeAutopilotTaskHintSet(hints);
}

function buildBackgroundSessionId(task) {
  return `${DEFAULT_AUTOPILOT_SESSION_PREFIX}-${slugify(task.route || task.assignee || "main")}-${slugify(task.id) || hashText(task.id, 8)}`;
}

function bumpBudgetMode(mode) {
  if (mode === "strict") return "balanced";
  if (mode === "balanced") return "deep";
  return "deep";
}

function bumpRetrievalMode(mode) {
  if (mode === "off") return "light";
  if (mode === "light") return "deep";
  return "deep";
}

function buildTaskIdFromMessage(sessionKey, messageId, goal) {
  const seed = [sessionKey, messageId, goal].filter(Boolean).join("|") || crypto.randomUUID();
  return `task_${hashText(seed, 16)}`;
}

function extractTextBlocksFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && block.type === "text" ? String(block.text || "") : ""))
    .filter(Boolean)
    .join("\n");
}

function stripMetadataBlocks(rawText) {
  let text = String(rawText || "");
  text = text.replace(/<openviking-context>[\s\S]*?<\/openviking-context>\s*/gi, "");
  text = text.replace(/\[Queued messages while agent was busy\][\s\S]*?Queued #1\s*/gi, "");
  text = text.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  text = text.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  text = text.replace(/^System:[^\n]*\n*/gim, "");
  text = text.replace(/^To send an image back[^\n]*\n*/gim, "");
  return text.trim();
}

function extractMessageInfoJson(rawText) {
  const match = String(rawText || "").match(/Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i);
  return safeParseJson(match?.[1] || "", {});
}

function extractSenderInfoJson(rawText) {
  const match = String(rawText || "").match(/Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i);
  return safeParseJson(match?.[1] || "", {});
}

function extractMessageBody(rawText) {
  const stripped = stripMetadataBlocks(rawText);
  return stripped
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function buildTaskTitleFromText(text) {
  const normalized = normalizeTaskGoal(text);
  if (!normalized) return "未命名任务";
  const firstLine = normalized.split("\n")[0] || normalized;
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
}

function summarizeTaskGoal(text) {
  const normalized = normalizeTaskGoal(text);
  if (!normalized) return "";
  const collapsed = normalized.replace(/\n+/g, " | ");
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}...` : collapsed;
}

function resolveThinkingLevelForBudget(mode) {
  if (mode === "deep") return "medium";
  if (mode === "balanced") return "low";
  return "minimal";
}

function buildAutopilotResultEnvelope(raw) {
  const source = isRecord(raw) ? raw : {};
  const status = normalizeAutopilotStatusValue(source.status, "running");
  const nextRunMinutes = clampInt(source.nextRunInMinutes, 15, 1, 24 * 60);
  return {
    status,
    summary: normalizeString(source.summary),
    planSummary: normalizeString(source.planSummary),
    nextAction: normalizeString(source.nextAction),
    blockedReason: normalizeString(source.blockedReason),
    lastResult: normalizeString(source.lastResult),
    nextRunInMinutes: nextRunMinutes,
    needsUser: normalizeString(source.needsUser),
    shouldNotify: source.shouldNotify !== false && (status === "completed" || status === "blocked" || status === "waiting_user"),
    notes: normalizeString(source.notes)
  };
}

function extractAutopilotResultFromText(rawText) {
  const text = String(rawText || "");
  const tagMatch = text.match(/<AUTOPILOT_RESULT>\s*([\s\S]*?)\s*<\/AUTOPILOT_RESULT>/i);
  if (tagMatch) return buildAutopilotResultEnvelope(safeParseJson(tagMatch[1], null));
  const jsonMatch = text.match(/\{[\s\S]*"status"[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = safeParseJson(jsonMatch[0], null);
    if (parsed) return buildAutopilotResultEnvelope(parsed);
  }
  return buildAutopilotResultEnvelope({
    status: "running",
    summary: text.trim().slice(-1000)
  });
}

function normalizeAutopilotConfig(config) {
  const source = isRecord(config) ? config : {};
  return {
    enabled: source.enabled == null ? DEFAULT_AUTOPILOT_CONFIG.enabled : Boolean(source.enabled),
    localFirst: source.localFirst !== false,
    heartbeatEnabled: source.heartbeatEnabled == null ? DEFAULT_AUTOPILOT_CONFIG.heartbeatEnabled : Boolean(source.heartbeatEnabled),
    defaultBudgetMode: pickEnum(source.defaultBudgetMode, AUTOPILOT_BUDGET_MODES, DEFAULT_AUTOPILOT_CONFIG.defaultBudgetMode),
    defaultRetrievalMode: pickEnum(
      source.defaultRetrievalMode,
      AUTOPILOT_RETRIEVAL_MODES,
      DEFAULT_AUTOPILOT_CONFIG.defaultRetrievalMode
    ),
    maxInputTokensPerTurn: clampInt(
      source.maxInputTokensPerTurn,
      DEFAULT_AUTOPILOT_CONFIG.maxInputTokensPerTurn,
      500,
      50000
    ),
    maxContextChars: clampInt(source.maxContextChars, DEFAULT_AUTOPILOT_CONFIG.maxContextChars, 1000, 100000),
    maxRemoteCallsPerTask: clampInt(
      source.maxRemoteCallsPerTask,
      DEFAULT_AUTOPILOT_CONFIG.maxRemoteCallsPerTask,
      1,
      50
    ),
    dailyRemoteTokenBudget: clampInt(
      source.dailyRemoteTokenBudget,
      DEFAULT_AUTOPILOT_CONFIG.dailyRemoteTokenBudget,
      10000,
      10000000
    )
  };
}

function normalizeAutopilotTask(task, defaults = DEFAULT_AUTOPILOT_CONFIG) {
  const source = isRecord(task) ? task : {};
  const createdAt = parseOptionalTimestamp(source.createdAt) || nowTs();
  const updatedAt = parseOptionalTimestamp(source.updatedAt) || createdAt;
  const nextRunAt = parseOptionalTimestamp(source.nextRunAt);
  const lastRunAt = parseOptionalTimestamp(source.lastRunAt);
  const status = normalizeAutopilotStatusValue(source.status, "queued");
  const runState = normalizeAutopilotRunState(source.runState);
  const derivedTags = extractKeywordTags(
    `${normalizeString(source.title)} ${normalizeString(source.goal)} ${normalizeString(source.lastResult)} ${normalizeString(source.blockedReason)} ${normalizeString(source.lastError)}`,
    source.skillHints
  );
  if ((status === "blocked" || status === "waiting_user") && !runState.blockedAt) runState.blockedAt = updatedAt;
  if (status === "completed" && !runState.completedAt) runState.completedAt = updatedAt;
  return {
    id: normalizeString(source.id) || `task_${crypto.randomUUID()}`,
    title: normalizeTaskTitle(source.title, source.goal),
    goal: normalizeTaskGoal(source.goal),
    successCriteria: normalizeString(source.successCriteria || source.doneCriteria),
    doneCriteria: normalizeString(source.doneCriteria),
    planSummary: normalizeString(source.planSummary),
    nextAction: normalizeString(source.nextAction),
    blockedReason: normalizeString(source.blockedReason),
    lastResult: normalizeString(source.lastResult),
    notes: normalizeString(source.notes),
    source: normalizeString(source.source, "manual"),
    assignee: normalizeString(source.assignee, "main"),
    workspace: normalizeString(source.workspace, "main"),
    route: normalizeString(source.route) || "general",
    taskKind: normalizeString(source.taskKind) || "general",
    reportPolicy: pickEnum(source.reportPolicy, AUTOPILOT_REPORT_POLICIES, "reply_and_proactive"),
    skillHints: normalizeAutopilotTaskHintSet(source.skillHints),
    tags: normalizeKeywordTags(Array.isArray(source.tags) && source.tags.length ? source.tags : derivedTags),
    memoryRefs: normalizeStringArray(source.memoryRefs).slice(0, 24),
    intelRefs: normalizeStringArray(source.intelRefs).slice(0, 24),
    optimizationState: normalizeOptionalRecord(source.optimizationState),
    intakeText: normalizeString(source.intakeText),
    sourceMeta: normalizeAutopilotSourceMeta(source.sourceMeta),
    delivery: normalizeAutopilotDelivery(source.delivery),
    runState,
    status,
    priority: pickEnum(source.priority, AUTOPILOT_PRIORITIES, "normal"),
    budgetMode: pickEnum(source.budgetMode, AUTOPILOT_BUDGET_MODES, defaults.defaultBudgetMode),
    retrievalMode: pickEnum(source.retrievalMode, AUTOPILOT_RETRIEVAL_MODES, defaults.defaultRetrievalMode),
    localOnly: Boolean(source.localOnly),
    localFirst: source.localFirst !== false,
    createdAt,
    updatedAt,
    nextRunAt,
    lastRunAt,
    runCount: clampInt(source.runCount, 0, 0, 100000),
    lastError: normalizeString(source.lastError)
  };
}

function normalizeAutopilotStore(store) {
  const source = isRecord(store) ? store : {};
  const version = clampInt(source.version, 1, 1, 999);
  const configPatch = version < 2 ? { enabled: true, heartbeatEnabled: true } : null;
  const config = normalizeAutopilotConfig({ ...(isRecord(source.config) ? source.config : {}), ...(configPatch || {}) });
  const tasks = Array.isArray(source.tasks)
    ? source.tasks.map((task) => normalizeAutopilotTask(task, config)).sort(compareAutopilotTasks)
    : [];
  const scheduler = isRecord(source.scheduler) ? source.scheduler : {};
  return {
    version: 2,
    config,
    scheduler: {
      startedAt: parseOptionalTimestamp(scheduler.startedAt),
      lastPersistedAt: parseOptionalTimestamp(scheduler.lastPersistedAt)
    },
    tasks
  };
}

function hasDefinedOwn(obj, key) {
  return isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

function normalizeIntelSource(value) {
  const source = isRecord(value) ? value : {};
  return {
    id: normalizeString(source.id) || `source_${hashText(JSON.stringify(source) || crypto.randomUUID(), 12)}`,
    url: normalizeString(source.url),
    priority: Math.max(0, Math.min(3, Number(source.priority) || 0.5))
  };
}

function normalizeIntelDomain(value, fallback = null) {
  const base = isRecord(fallback) ? fallback : {};
  const source = isRecord(value) ? value : {};
  const mergedSources = Array.isArray(source.sources) ? source.sources : Array.isArray(base.sources) ? base.sources : [];
  const normalizedSources = dedupe(
    mergedSources
      .map((entry) => normalizeIntelSource(entry))
      .filter((entry) => entry.url)
      .map((entry) => entry.id)
  ).map((id) => {
    const raw = mergedSources.find((entry) => normalizeIntelSource(entry).id === id);
    return normalizeIntelSource(raw);
  });
  const rawStats = isRecord(source.sourceStats) ? source.sourceStats : isRecord(base.sourceStats) ? base.sourceStats : {};
  const sourceStats = {};
  for (const [sourceId, stats] of Object.entries(rawStats)) {
    sourceStats[sourceId] = {
      successCount: clampInt(stats?.successCount, 0, 0, 100000),
      failureCount: clampInt(stats?.failureCount, 0, 0, 100000),
      lastSeenAt: parseOptionalTimestamp(stats?.lastSeenAt),
      lastFailureAt: parseOptionalTimestamp(stats?.lastFailureAt),
      avgScore: Math.max(0, Math.min(100, Number(stats?.avgScore) || 0))
    };
  }
  return {
    id: normalizeString(source.id || base.id) || `domain_${crypto.randomUUID()}`,
    label: normalizeString(source.label || base.label) || normalizeString(source.id || base.id),
    keywords: normalizeKeywordTags(source.keywords || base.keywords),
    sources: normalizedSources,
    lastFetchedAt: parseOptionalTimestamp(source.lastFetchedAt ?? base.lastFetchedAt),
    lastDigestAt: parseOptionalTimestamp(source.lastDigestAt ?? base.lastDigestAt),
    lastDigestId: normalizeString(source.lastDigestId || base.lastDigestId) || null,
    lastDigestAttemptAt: parseOptionalTimestamp(source.lastDigestAttemptAt ?? base.lastDigestAttemptAt),
    lastDigestError: normalizeString(source.lastDigestError || base.lastDigestError),
    nextDigestDate: normalizeString(source.nextDigestDate || base.nextDigestDate) || null,
    sourceStats
  };
}

function normalizeIntelItem(value) {
  const source = isRecord(value) ? value : {};
  const title = normalizeString(source.title);
  const summary = normalizeString(source.summary);
  const url = normalizeString(source.url);
  const contentHash = normalizeString(source.contentHash) || hashText(`${title}|${url}|${summary}`, 16);
  return {
    id: normalizeString(source.id) || `intel_${contentHash}`,
    domain: normalizeString(source.domain),
    title,
    summary,
    url,
    sourceId: normalizeString(source.sourceId),
    sourceUrl: normalizeString(source.sourceUrl),
    publishedAt: parseOptionalTimestamp(source.publishedAt),
    fetchedAt: parseOptionalTimestamp(source.fetchedAt) || nowTs(),
    contentHash,
    rawText: normalizeString(source.rawText),
    tags: normalizeKeywordTags(source.tags),
    credibilityScore: clampPercent(source.credibilityScore),
    importanceScore: clampPercent(source.importanceScore),
    noveltyScore: clampPercent(source.noveltyScore),
    relevanceScore: clampPercent(source.relevanceScore),
    overallScore: clampPercent(source.overallScore),
    actionability: normalizeString(source.actionability),
    judgement: normalizeString(source.judgement),
    selectedForDigest: Boolean(source.selectedForDigest),
    explorationCandidate: Boolean(source.explorationCandidate),
    digestId: normalizeString(source.digestId) || null,
    deliveredAt: parseOptionalTimestamp(source.deliveredAt),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 24)
  };
}

function normalizeDigestItem(value) {
  const source = isRecord(value) ? value : {};
  return {
    itemId: normalizeString(source.itemId),
    rank: clampInt(source.rank, 0, 0, 1000),
    title: normalizeString(source.title),
    summary: normalizeString(source.summary),
    judgement: normalizeString(source.judgement),
    whyImportant: normalizeString(source.whyImportant || source.why),
    actionability: normalizeString(source.actionability),
    url: normalizeString(source.url),
    sourceId: normalizeString(source.sourceId),
    overallScore: clampPercent(source.overallScore),
    exploration: Boolean(source.exploration)
  };
}

function normalizeIntelDigest(value) {
  const source = isRecord(value) ? value : {};
  return {
    id: normalizeString(source.id) || `digest_${crypto.randomUUID()}`,
    domain: normalizeString(source.domain),
    digestDate: normalizeString(source.digestDate),
    createdAt: parseOptionalTimestamp(source.createdAt) || nowTs(),
    items: Array.isArray(source.items) ? source.items.map((item) => normalizeDigestItem(item)).filter((item) => item.itemId) : [],
    delivery: normalizeAutopilotDelivery(source.delivery),
    status: normalizeString(source.status, "draft"),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 24)
  };
}

function normalizeIntelConfig(value) {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled == null ? DEFAULT_INTEL_CONFIG.enabled : Boolean(source.enabled),
    digestEnabled: source.digestEnabled == null ? DEFAULT_INTEL_CONFIG.digestEnabled : Boolean(source.digestEnabled),
    refreshMinutes: clampInt(source.refreshMinutes, DEFAULT_INTEL_CONFIG.refreshMinutes, 15, 24 * 60),
    digestHourLocal: clampInt(source.digestHourLocal, DEFAULT_INTEL_CONFIG.digestHourLocal, 0, 23),
    candidateLimitPerDomain: clampInt(source.candidateLimitPerDomain, DEFAULT_INTEL_CONFIG.candidateLimitPerDomain, 5, 100),
    digestItemLimitPerDomain: clampInt(source.digestItemLimitPerDomain, DEFAULT_INTEL_CONFIG.digestItemLimitPerDomain, 3, 30),
    exploitItemsPerDigest: clampInt(source.exploitItemsPerDigest, DEFAULT_INTEL_CONFIG.exploitItemsPerDigest, 1, 20),
    exploreItemsPerDigest: clampInt(source.exploreItemsPerDigest, DEFAULT_INTEL_CONFIG.exploreItemsPerDigest, 0, 10),
    maxItemsPerSourceInDigest: clampInt(source.maxItemsPerSourceInDigest, DEFAULT_INTEL_CONFIG.maxItemsPerSourceInDigest, 1, 10),
    recentDigestTopicWindowDays: clampInt(source.recentDigestTopicWindowDays, DEFAULT_INTEL_CONFIG.recentDigestTopicWindowDays, 1, 30),
    llmJudgeEnabled: source.llmJudgeEnabled == null ? DEFAULT_INTEL_CONFIG.llmJudgeEnabled : Boolean(source.llmJudgeEnabled),
    llmAgent: normalizeString(source.llmAgent, DEFAULT_INTEL_CONFIG.llmAgent),
    deliveryMode: normalizeString(source.deliveryMode, DEFAULT_INTEL_CONFIG.deliveryMode),
    notifyOnlyHighUrgency: source.notifyOnlyHighUrgency == null ? DEFAULT_INTEL_CONFIG.notifyOnlyHighUrgency : Boolean(source.notifyOnlyHighUrgency)
  };
}

function normalizeIntelStore(store) {
  const source = isRecord(store) ? store : {};
  const config = normalizeIntelConfig(source.config);
  const baseDomains = DEFAULT_INTEL_DOMAINS.map((entry) => normalizeIntelDomain(entry));
  const storedDomains = Array.isArray(source.domains) ? source.domains.map((entry) => normalizeIntelDomain(entry)) : [];
  const domainsById = new Map(baseDomains.map((entry) => [entry.id, entry]));
  for (const stored of storedDomains) {
    domainsById.set(stored.id, normalizeIntelDomain(stored, domainsById.get(stored.id) || null));
  }
  const items = (Array.isArray(source.items) ? source.items : [])
    .map((entry) => normalizeIntelItem(entry))
    .sort((left, right) => (right.fetchedAt || 0) - (left.fetchedAt || 0))
    .slice(0, INTEL_ITEM_RETENTION);
  const digests = (Array.isArray(source.digests) ? source.digests : [])
    .map((entry) => normalizeIntelDigest(entry))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, INTEL_DIGEST_RETENTION);
  const scheduler = isRecord(source.scheduler) ? source.scheduler : {};
  return {
    version: 2,
    config,
    domains: [...domainsById.values()],
    items,
    digests,
    scheduler: {
      lastTickAt: parseOptionalTimestamp(scheduler.lastTickAt),
      lastDigestSweepAt: parseOptionalTimestamp(scheduler.lastDigestSweepAt),
      lastPersistedAt: parseOptionalTimestamp(scheduler.lastPersistedAt)
    }
  };
}

function normalizeMemoryEntry(value) {
  const source = isRecord(value) ? value : {};
  const createdAt = parseOptionalTimestamp(source.createdAt) || nowTs();
  return {
    id: normalizeString(source.id) || `mem_${crypto.randomUUID()}`,
    memoryType: normalizeString(source.memoryType || source.type, "execution"),
    scope: normalizeString(source.scope, "global"),
    route: normalizeString(source.route),
    summary: normalizeString(source.summary),
    appliesWhen: normalizeString(source.appliesWhen),
    avoidWhen: normalizeString(source.avoidWhen),
    tags: normalizeKeywordTags(source.tags),
    confidence: clampPercent(source.confidence),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 48),
    sourceTaskIds: normalizeStringArray(source.sourceTaskIds).slice(0, 24),
    sourceIntelIds: normalizeStringArray(source.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: normalizeStringArray(source.derivedFromMemoryIds).slice(0, 24),
    invalidatedBy: normalizeStringArray(source.invalidatedBy).slice(0, 24),
    lastReinforcedAt: parseOptionalTimestamp(source.lastReinforcedAt) || createdAt,
    decayScore: clampPercent(source.decayScore),
    version: clampInt(source.version, 1, 1, 999),
    createdAt,
    updatedAt: parseOptionalTimestamp(source.updatedAt) || createdAt
  };
}

function normalizeStrategyEntry(value) {
  const source = isRecord(value) ? value : {};
  const createdAt = parseOptionalTimestamp(source.createdAt) || nowTs();
  return {
    id: normalizeString(source.id) || `strategy_${crypto.randomUUID()}`,
    route: normalizeString(source.route),
    scope: normalizeString(source.scope, "global"),
    triggerConditions: normalizeString(source.triggerConditions),
    recommendedPath: normalizeString(source.recommendedPath),
    fallbackPath: normalizeString(source.fallbackPath),
    recommendedWorker: normalizeString(source.recommendedWorker),
    recommendedSkills: normalizeAutopilotTaskHintSet(source.recommendedSkills),
    thinkingLane: normalizeString(source.thinkingLane, "system1"),
    confidence: clampPercent(source.confidence),
    measuredEffect: normalizeOptionalRecord(source.measuredEffect),
    tags: normalizeKeywordTags(source.tags),
    derivedFromMemoryIds: normalizeStringArray(source.derivedFromMemoryIds).slice(0, 24),
    sourceTaskIds: normalizeStringArray(source.sourceTaskIds).slice(0, 24),
    sourceIntelIds: normalizeStringArray(source.sourceIntelIds).slice(0, 24),
    invalidatedBy: normalizeStringArray(source.invalidatedBy).slice(0, 24),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 24),
    version: clampInt(source.version, 1, 1, 999),
    createdAt,
    updatedAt: parseOptionalTimestamp(source.updatedAt) || createdAt
  };
}

function normalizeLearningEntry(value) {
  const source = isRecord(value) ? value : {};
  const createdAt = parseOptionalTimestamp(source.createdAt) || nowTs();
  return {
    id: normalizeString(source.id) || `learning_${crypto.randomUUID()}`,
    observedPattern: normalizeString(source.observedPattern),
    effectOnSuccessRate: Number.isFinite(Number(source.effectOnSuccessRate)) ? Number(source.effectOnSuccessRate) : 0,
    effectOnTokenCost: Number.isFinite(Number(source.effectOnTokenCost)) ? Number(source.effectOnTokenCost) : 0,
    effectOnCompletionQuality: Number.isFinite(Number(source.effectOnCompletionQuality)) ? Number(source.effectOnCompletionQuality) : 0,
    adoptedAs: normalizeString(source.adoptedAs),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 24),
    sourceTaskIds: normalizeStringArray(source.sourceTaskIds).slice(0, 24),
    createdAt,
    updatedAt: parseOptionalTimestamp(source.updatedAt) || createdAt
  };
}

function normalizeMemoryStore(store) {
  const source = isRecord(store) ? store : {};
  const scheduler = isRecord(source.scheduler) ? source.scheduler : {};
  return {
    version: 1,
    memories: (Array.isArray(source.memories) ? source.memories : [])
      .map((entry) => normalizeMemoryEntry(entry))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, MEMORY_ENTRY_RETENTION),
    strategies: (Array.isArray(source.strategies) ? source.strategies : [])
      .map((entry) => normalizeStrategyEntry(entry))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, STRATEGY_ENTRY_RETENTION),
    learnings: (Array.isArray(source.learnings) ? source.learnings : [])
      .map((entry) => normalizeLearningEntry(entry))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 240),
    scheduler: {
      lastDistilledAt: parseOptionalTimestamp(scheduler.lastDistilledAt),
      lastPersistedAt: parseOptionalTimestamp(scheduler.lastPersistedAt)
    }
  };
}

function normalizeEvolutionCandidate(value) {
  const source = isRecord(value) ? value : {};
  const createdAt = parseOptionalTimestamp(source.createdAt) || nowTs();
  return {
    id: normalizeString(source.id) || `evo_${crypto.randomUUID()}`,
    targetLayer: normalizeString(source.targetLayer),
    candidateType: normalizeString(source.candidateType),
    candidateRef: normalizeString(source.candidateRef),
    expectedEffect: normalizeOptionalRecord(source.expectedEffect),
    measuredEffect: normalizeOptionalRecord(source.measuredEffect),
    shadowMetrics: normalizeOptionalRecord(source.shadowMetrics),
    adoptionState: normalizeString(source.adoptionState, "shadow"),
    sourceEventIds: normalizeStringArray(source.sourceEventIds).slice(0, 24),
    sourceTaskIds: normalizeStringArray(source.sourceTaskIds).slice(0, 24),
    sourceIntelIds: normalizeStringArray(source.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: normalizeStringArray(source.derivedFromMemoryIds).slice(0, 24),
    invalidatedBy: normalizeStringArray(source.invalidatedBy).slice(0, 24),
    notes: normalizeString(source.notes),
    createdAt,
    updatedAt: parseOptionalTimestamp(source.updatedAt) || createdAt,
    lastShadowAt: parseOptionalTimestamp(source.lastShadowAt)
  };
}

function normalizeEvolutionConfig(value) {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled == null ? DEFAULT_EVOLUTION_CONFIG.enabled : Boolean(source.enabled),
    autoApplyLowRisk: source.autoApplyLowRisk == null ? DEFAULT_EVOLUTION_CONFIG.autoApplyLowRisk : Boolean(source.autoApplyLowRisk),
    reviewIntervalHours: clampInt(source.reviewIntervalHours, DEFAULT_EVOLUTION_CONFIG.reviewIntervalHours, 1, 7 * 24)
  };
}

function normalizeEvolutionStore(store) {
  const source = isRecord(store) ? store : {};
  const scheduler = isRecord(source.scheduler) ? source.scheduler : {};
  return {
    version: 1,
    config: normalizeEvolutionConfig(source.config),
    candidates: (Array.isArray(source.candidates) ? source.candidates : [])
      .map((entry) => normalizeEvolutionCandidate(entry))
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 240),
    scheduler: {
      lastReviewAt: parseOptionalTimestamp(scheduler.lastReviewAt),
      lastPersistedAt: parseOptionalTimestamp(scheduler.lastPersistedAt)
    }
  };
}

async function saveIntelStore(store) {
  const normalized = normalizeIntelStore(store);
  normalized.scheduler.lastPersistedAt = nowTs();
  await writeJsonAtomicSecure(INTEL_STORE_PATH, normalized);
  return normalized;
}

async function saveMemoryStore(store) {
  const normalized = normalizeMemoryStore(store);
  normalized.scheduler.lastPersistedAt = nowTs();
  await writeJsonAtomicSecure(MEMORY_STORE_PATH, normalized);
  return normalized;
}

async function saveEvolutionStore(store) {
  const normalized = normalizeEvolutionStore(store);
  normalized.scheduler.lastPersistedAt = nowTs();
  await writeJsonAtomicSecure(EVOLUTION_STORE_PATH, normalized);
  return normalized;
}

async function appendSystemEvent(type, payload = {}) {
  const ts = nowTs();
  const event = {
    eventId: `evt_${hashText(`${type}|${ts}|${JSON.stringify(payload)}`, 16)}`,
    type: normalizeString(type, "unknown"),
    ts,
    iso: toIso(ts),
    payload: isRecord(payload) ? payload : {}
  };
  await appendJsonLine(EVENT_LOG_PATH, event);
  return event;
}

async function readRecentSystemEvents(limit = EVENT_LOG_TAIL_LIMIT) {
  const text = await readTextFile(EVENT_LOG_PATH, "");
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = lines.slice(Math.max(0, lines.length - limit));
  return selected
    .map((line) => safeParseJson(line, null))
    .filter(Boolean);
}

function truncateText(value, limit = 160) {
  const text = normalizeString(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(16, limit - 3))}...`;
}

function mergeUniqueStrings(...lists) {
  return dedupe(
    lists.flatMap((list) => normalizeStringArray(list))
  );
}

function buildLocalDateKey(ts = nowTs()) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRelativeLocalDateKey(dayOffset, ts = nowTs()) {
  const offset = Number(dayOffset);
  const baseTs = Number.isFinite(offset) ? ts + offset * 24 * 60 * 60 * 1000 : ts;
  return buildLocalDateKey(baseTs);
}

function computeInitialDigestDateKey(digestHourLocal, ts = nowTs()) {
  const currentHour = new Date(ts).getHours();
  if (currentHour < digestHourLocal) return buildLocalDateKey(ts);
  return buildRelativeLocalDateKey(1, ts);
}

function isSameLocalDate(left, right) {
  if (!left || !right) return false;
  return buildLocalDateKey(left) === buildLocalDateKey(right);
}

function intersectionSize(left, right) {
  const leftSet = new Set(normalizeStringArray(left));
  const rightSet = new Set(normalizeStringArray(right));
  let count = 0;
  for (const entry of leftSet) {
    if (rightSet.has(entry)) count += 1;
  }
  return count;
}

function removeStringsFromSet(values, blocked) {
  const blockedSet = blocked instanceof Set ? blocked : new Set(normalizeStringArray(blocked));
  return normalizeStringArray(values).filter((value) => !blockedSet.has(value));
}

function averageNumber(values) {
  const filtered = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function scoreRecency(ts, windowHours = 72) {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ageHours = Math.max(0, (nowTs() - value) / (60 * 60 * 1000));
  if (ageHours >= windowHours) return 0;
  return Math.round((1 - ageHours / windowHours) * 100);
}

function buildIntelStatus(store) {
  const normalized = normalizeIntelStore(store);
  return {
    config: normalized.config,
    scheduler: {
      lastTickIso: toIso(intelRuntime.lastTickAt),
      lastError: intelRuntime.lastError || null,
      activeDomainId: intelRuntime.activeDomainId || null,
      activeDigestDomainId: intelRuntime.activeDigestDomainId || null,
      lastRefreshIso: toIso(normalized.scheduler.lastTickAt),
      lastDigestSweepIso: toIso(normalized.scheduler.lastDigestSweepAt)
    },
    stats: {
      itemCount: normalized.items.length,
      digestCount: normalized.digests.length,
      deliveredDigestCount: normalized.digests.filter((digest) => digest.status === "sent").length
    },
    domains: normalized.domains.map((domain) => {
      const items = normalized.items
        .filter((item) => item.domain === domain.id)
        .sort((left, right) => (right.overallScore || 0) - (left.overallScore || 0));
      const latestDigest = normalized.digests.find((digest) => digest.domain === domain.id) || null;
      return {
        id: domain.id,
        label: domain.label,
        keywords: domain.keywords,
        sourceCount: domain.sources.length,
        itemCount: items.length,
        lastFetchedIso: toIso(domain.lastFetchedAt),
        lastDigestIso: toIso(domain.lastDigestAt),
        lastDigestAttemptIso: toIso(domain.lastDigestAttemptAt),
        lastDigestError: domain.lastDigestError || null,
        nextDigestDate: domain.nextDigestDate || null,
        latestDigestId: latestDigest?.id || null,
        latestDigestDate: latestDigest?.digestDate || null,
        topItems: items.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          overallScore: item.overallScore,
          noveltyScore: item.noveltyScore,
          relevanceScore: item.relevanceScore,
          judgement: item.judgement,
          url: item.url
        })),
        sources: domain.sources.map((source) => ({
          id: source.id,
          url: source.url,
          priority: source.priority,
          stats: domain.sourceStats[source.id] || {
            successCount: 0,
            failureCount: 0,
            lastSeenAt: null,
            lastFailureAt: null,
            avgScore: 0
          }
        }))
      };
    }),
    digests: normalized.digests.slice(0, 9).map((digest) => ({
      id: digest.id,
      domain: digest.domain,
      digestDate: digest.digestDate,
      createdIso: toIso(digest.createdAt),
      status: digest.status,
      delivery: digest.delivery,
      itemCount: digest.items.length,
      topTitles: digest.items.slice(0, 3).map((item) => item.title)
    }))
  };
}

function buildMemoryStatus(store) {
  const normalized = normalizeMemoryStore(store);
  return {
    scheduler: {
      lastDistilledIso: toIso(normalized.scheduler.lastDistilledAt),
      lastPersistedIso: toIso(normalized.scheduler.lastPersistedAt)
    },
    stats: {
      memoryCount: normalized.memories.length,
      strategyCount: normalized.strategies.length,
      learningCount: normalized.learnings.length,
      highConfidenceMemories: normalized.memories.filter((entry) => entry.confidence >= 75 && entry.invalidatedBy.length === 0).length,
      invalidatedMemories: normalized.memories.filter((entry) => entry.invalidatedBy.length > 0).length
    },
    recentMemories: normalized.memories.slice(0, 12).map((entry) => ({
      id: entry.id,
      memoryType: entry.memoryType,
      route: entry.route,
      scope: entry.scope,
      summary: truncateText(entry.summary, 180),
      confidence: entry.confidence,
      tags: entry.tags,
      invalidated: entry.invalidatedBy.length > 0,
      updatedIso: toIso(entry.updatedAt)
    })),
    recentStrategies: normalized.strategies.slice(0, 10).map((entry) => ({
      id: entry.id,
      route: entry.route,
      thinkingLane: entry.thinkingLane,
      recommendedWorker: entry.recommendedWorker,
      recommendedSkills: entry.recommendedSkills,
      confidence: entry.confidence,
      invalidated: entry.invalidatedBy.length > 0,
      triggerConditions: truncateText(entry.triggerConditions, 160),
      updatedIso: toIso(entry.updatedAt)
    })),
    recentLearnings: normalized.learnings.slice(0, 10).map((entry) => ({
      id: entry.id,
      observedPattern: truncateText(entry.observedPattern, 180),
      effectOnSuccessRate: entry.effectOnSuccessRate,
      effectOnTokenCost: entry.effectOnTokenCost,
      effectOnCompletionQuality: entry.effectOnCompletionQuality,
      adoptedAs: entry.adoptedAs,
      updatedIso: toIso(entry.updatedAt)
    }))
  };
}

function buildEvolutionStatus(store) {
  const normalized = normalizeEvolutionStore(store);
  return {
    config: normalized.config,
    scheduler: {
      lastTickIso: toIso(evolutionRuntime.lastTickAt),
      lastError: evolutionRuntime.lastError || null,
      active: Boolean(evolutionRuntime.active),
      lastReviewIso: toIso(evolutionRuntime.lastReviewAt || normalized.scheduler.lastReviewAt)
    },
    stats: {
      candidateCount: normalized.candidates.length,
      shadowCount: normalized.candidates.filter((entry) => entry.adoptionState === "shadow").length,
      candidateStageCount: normalized.candidates.filter((entry) => entry.adoptionState === "candidate").length,
      adoptedCount: normalized.candidates.filter((entry) => entry.adoptionState === "adopted").length
    },
    candidates: normalized.candidates.slice(0, 20).map((entry) => ({
      id: entry.id,
      targetLayer: entry.targetLayer,
      candidateType: entry.candidateType,
      candidateRef: entry.candidateRef,
      adoptionState: entry.adoptionState,
      invalidated: entry.invalidatedBy.length > 0,
      notes: truncateText(entry.notes, 180),
      shadowMetrics: entry.shadowMetrics,
      expectedEffect: entry.expectedEffect,
      measuredEffect: entry.measuredEffect,
      updatedIso: toIso(entry.updatedAt)
    }))
  };
}

function normalizeDeliveryCandidate(value) {
  const delivery = normalizeAutopilotDelivery(value);
  if (!delivery.channel || !delivery.target) return null;
  if (delivery.target === "heartbeat") return null;
  return delivery;
}

async function resolvePreferredDigestDelivery() {
  const [autopilot, sessions] = await Promise.all([
    loadAutopilotStore(),
    loadAgentSessionsStore("main")
  ]);
  const candidates = [];
  for (const task of [...autopilot.tasks].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))) {
    const delivery = normalizeDeliveryCandidate(task.delivery);
    if (!delivery) continue;
    candidates.push({
      delivery,
      updatedAt: task.updatedAt || 0,
      direct: !String(task.delivery?.target || "").includes("group:") && !String(task.delivery?.target || "").includes("wrSH"),
      source: "autopilot-task"
    });
  }
  for (const entry of Object.values(sessions || {})) {
    const delivery = normalizeDeliveryCandidate({
      channel: entry?.deliveryContext?.channel || entry?.lastChannel,
      target: entry?.deliveryContext?.to || entry?.lastTo,
      accountId: entry?.deliveryContext?.accountId || entry?.lastAccountId,
      threadId: entry?.deliveryContext?.threadId || entry?.lastThreadId
    });
    if (!delivery) continue;
    const direct = normalizeString(entry?.origin?.chatType) === "direct" || /^user:|^wecom:/i.test(delivery.target);
    candidates.push({
      delivery,
      updatedAt: Number(entry?.updatedAt || 0),
      direct,
      source: "recent-session"
    });
  }
  candidates.sort((left, right) => {
    if (left.direct !== right.direct) return left.direct ? -1 : 1;
    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
  return candidates[0]?.delivery || null;
}

function buildRouteDomains(route) {
  if (route === "coder") return ["tech", "ai"];
  if (route === "ops") return ["tech"];
  if (route === "research") return ["ai", "business", "tech"];
  if (route === "office") return ["business"];
  if (route === "media") return ["tech"];
  return ["ai", "tech", "business"];
}

function scoreMemoryForTask(entry, task) {
  if (!entry || entry.invalidatedBy?.length) return -1000;
  const tags = normalizeKeywordTags(task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints));
  const routeDomains = buildRouteDomains(task.route);
  let score = entry.confidence - entry.decayScore * 0.6;
  if (entry.route && entry.route === task.route) score += 22;
  if (entry.memoryType === "knowledge" && routeDomains.includes(entry.scope)) score += 18;
  if (entry.memoryType === "knowledge" && task.route === "research") score += 10;
  score += intersectionSize(entry.tags, tags) * 9;
  if (entry.sourceTaskIds?.includes(task.id)) score += 30;
  score += Math.min(18, scoreRecency(entry.lastReinforcedAt, 24 * 14) * 0.18);
  if (entry.memoryType === "execution" || entry.memoryType === "efficiency") score += 8;
  return score;
}

function scoreStrategyForTask(entry, task) {
  if (!entry || entry.invalidatedBy?.length) return -1000;
  const tags = normalizeKeywordTags(task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints));
  let score = entry.confidence;
  if (entry.route && entry.route === task.route) score += 25;
  score += intersectionSize(entry.tags, tags) * 10;
  if (entry.recommendedWorker && entry.recommendedWorker === task.assignee) score += 8;
  if (entry.thinkingLane === "system1") score += 4;
  score += Math.min(12, scoreRecency(entry.updatedAt, 24 * 30) * 0.12);
  return score;
}

function scoreIntelForTask(item, task) {
  if (!item) return -1000;
  const tags = normalizeKeywordTags(task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints));
  let score = item.overallScore;
  score += intersectionSize(item.tags, tags) * 8;
  if (buildRouteDomains(task.route).includes(item.domain)) score += 12;
  if (item.selectedForDigest) score += 8;
  score += Math.min(15, scoreRecency(item.publishedAt || item.fetchedAt, 24 * 5) * 0.15);
  return score;
}

function selectRelevantMemories(task, store, limit = 5) {
  return [...store.memories]
    .map((entry) => ({ entry, score: scoreMemoryForTask(entry, task) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function selectRelevantStrategies(task, store, limit = 3) {
  return [...store.strategies]
    .map((entry) => ({ entry, score: scoreStrategyForTask(entry, task) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function selectRelevantIntel(task, store, limit = 4) {
  return [...store.items]
    .map((entry) => ({ entry, score: scoreIntelForTask(entry, task) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function buildLocalFirstPlan(task, lane) {
  const route = task.route || task.taskKind || "general";
  if (route === "coder") return "先读仓库与文件差异，尽量在本地完成修改、验证和总结。";
  if (route === "ops") return "先查日志、端口、进程和配置，本地定位后再动远程链路。";
  if (route === "office") return "先复用现有飞书/企微技能和本地结构化脚本，再决定是否重推理。";
  if (route === "research") return "先读现有知识摘要和近期情报，再补最少量外部检索。";
  if (route === "media") return "先做 OCR、抽取、分段等本地处理，再让模型做高层判断。";
  return lane === "system1"
    ? "优先走稳定规则、本地工具和已有策略，不做重规划。"
    : "先压缩上下文和已知记忆，再决定是否升级到重推理。";
}

function buildRemoteModelPlan(task, lane) {
  if (lane === "system1") return "只有本地路径和稳定 skill 不足时才升级到远程模型。";
  if (task.route === "coder" || task.route === "ops") return "允许更深推理，但先带入最少必要记忆和情报，不做长上下文裸跑。";
  return "只把最相关的记忆、情报和当前状态送入远程推理链。";
}

function buildFallbackOrder(task, worker, skills, lane) {
  const route = task.route || task.taskKind || "general";
  const base = [
    "stable-local-tools",
    skills.length ? `skill:${skills[0]}` : null,
    worker ? `worker:${worker}` : null,
    lane === "system2" ? "route-replan" : "system2-escalation",
    route !== "general" ? "worker:main" : null
  ].filter(Boolean);
  return dedupe(base);
}

function shouldUseSystem2(task, topStrategy, relevantMemories, relevantIntel) {
  const stableSkillCount = mergeUniqueStrings(task?.skillHints, topStrategy?.recommendedSkills).length;
  const highConfidenceExecutionMemories = relevantMemories.filter((entry) => (
    ["execution", "efficiency"].includes(entry.entry.memoryType) &&
    entry.entry.confidence >= 68
  )).length;
  if (topStrategy?.thinkingLane === "system2") return true;
  if (topStrategy?.thinkingLane === "system1" && topStrategy.confidence >= 68) {
    if ((task.runState?.consecutiveFailures || 0) === 0 && (task.runState?.remoteCallCount || 0) < 2) {
      return false;
    }
  }
  if (
    !topStrategy &&
    normalizeString(task.goal).length <= 180 &&
    (task.runState?.consecutiveFailures || 0) === 0 &&
    (task.runState?.remoteCallCount || 0) <= 1 &&
    stableSkillCount >= 1 &&
    highConfidenceExecutionMemories >= 1 &&
    relevantMemories.length >= 2
  ) {
    return false;
  }
  if (!topStrategy) return true;
  if ((task.runState?.consecutiveFailures || 0) > 0) return true;
  if ((task.runState?.remoteCallCount || 0) >= 2) return true;
  if (task.route === "general" && highConfidenceExecutionMemories < 2 && stableSkillCount < 2) return true;
  if (normalizeString(task.goal).length > 220) return true;
  if (task.priority === "high" && relevantMemories.length < 2) return true;
  if (relevantIntel.length >= 2 && relevantMemories.length === 0) return true;
  return topStrategy.confidence < 68;
}

function toManagedRuntimeMemoryRecord(entry) {
  const normalized = normalizeMemoryEntry(entry);
  const detailParts = [
    normalized.appliesWhen ? `applies=${normalized.appliesWhen}` : "",
    normalized.avoidWhen ? `avoid=${normalized.avoidWhen}` : ""
  ].filter(Boolean);
  const allowedTypes = new Set(["user", "knowledge", "execution", "avoidance", "efficiency", "completion", "resource", "communication"]);
  const memoryType = allowedTypes.has(normalized.memoryType) ? normalized.memoryType : "execution";
  return {
    id: normalized.id,
    layer: "memories",
    memoryType,
    route: normalized.route || undefined,
    summary: normalized.summary,
    detail: detailParts.join(" | ") || undefined,
    scope: normalized.scope || undefined,
    tags: normalizeKeywordTags(normalized.tags),
    confidence: clampPercent(normalized.confidence),
    version: clampInt(normalized.version, 1, 1, 999),
    invalidatedBy: normalizeStringArray(normalized.invalidatedBy).slice(0, 24),
    sourceEventIds: normalizeStringArray(normalized.sourceEventIds).slice(0, 48),
    sourceTaskIds: normalizeStringArray(normalized.sourceTaskIds).slice(0, 24),
    sourceIntelIds: normalizeStringArray(normalized.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: normalizeStringArray(normalized.derivedFromMemoryIds).slice(0, 24),
    createdAt: normalized.createdAt || nowTs(),
    updatedAt: normalized.updatedAt || normalized.createdAt || nowTs()
  };
}

function toManagedRuntimeStrategyRecord(entry) {
  const normalized = normalizeStrategyEntry(entry);
  return {
    id: normalized.id,
    layer: "strategies",
    route: normalized.route || "general",
    worker: normalized.recommendedWorker || "main",
    skillIds: normalizeAutopilotTaskHintSet(normalized.recommendedSkills),
    summary: normalized.recommendedPath || normalized.triggerConditions || `${normalized.route || "general"} strategy`,
    fallback: normalized.fallbackPath || undefined,
    thinkingLane: normalizeString(normalized.thinkingLane, "system1") === "system2" ? "system2" : "system1",
    confidence: clampPercent(normalized.confidence),
    version: clampInt(normalized.version, 1, 1, 999),
    invalidatedBy: normalizeStringArray(normalized.invalidatedBy).slice(0, 24),
    sourceEventIds: normalizeStringArray(normalized.sourceEventIds).slice(0, 24),
    sourceTaskIds: normalizeStringArray(normalized.sourceTaskIds).slice(0, 24),
    sourceIntelIds: normalizeStringArray(normalized.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: normalizeStringArray(normalized.derivedFromMemoryIds).slice(0, 24),
    createdAt: normalized.createdAt || nowTs(),
    updatedAt: normalized.updatedAt || normalized.createdAt || nowTs()
  };
}

function toManagedRuntimeIntelCandidate(entry) {
  const normalized = normalizeIntelItem(entry);
  const allowedDomains = new Set(["tech", "ai", "business", "github"]);
  const domain = allowedDomains.has(normalizeString(normalized.domain)) ? normalizeString(normalized.domain) : "tech";
  return {
    id: normalized.id,
    domain,
    sourceId: normalized.sourceId || `legacy:${domain}`,
    title: normalized.title || normalized.summary || normalized.id,
    url: normalized.url || undefined,
    summary: normalized.summary || normalized.judgement || "",
    score: clampPercent(normalized.overallScore),
    selected: Boolean(normalized.selectedForDigest),
    createdAt: normalized.publishedAt || normalized.fetchedAt || nowTs(),
    metadata: {
      judgement: normalized.judgement,
      actionability: normalized.actionability,
      explorationCandidate: normalized.explorationCandidate,
      digestId: normalized.digestId || null,
      sourceEventIds: normalizeStringArray(normalized.sourceEventIds).slice(0, 24)
    }
  };
}

function buildManagedRuntimeDecisionTask(task, config) {
  const route = normalizeString(task.route || task.taskKind, "general");
  const taskGoalText = `${task.title || ""} ${task.goal || ""} ${task.lastError || ""} ${task.blockedReason || ""}`;
  return {
    id: normalizeString(task.id) || `task_${crypto.randomUUID()}`,
    title: normalizeString(task.title, "未命名任务"),
    goal: normalizeString(task.goal),
    route,
    taskKind: normalizeString(task.taskKind),
    priority: normalizeString(task.priority, "normal"),
    budgetMode: normalizeString(task.budgetMode || config.defaultBudgetMode, "strict"),
    retrievalMode: normalizeString(task.retrievalMode || config.defaultRetrievalMode, "light"),
    worker: normalizeString(task.assignee || "main"),
    skillIds: mergeUniqueStrings(
      task.skillHints,
      buildSkillHintsForTask(route, taskGoalText)
    ).slice(0, 16),
    tags: normalizeKeywordTags(task.tags || extractKeywordTags(taskGoalText, task.skillHints)),
    blockedReason: normalizeString(task.blockedReason),
    lastError: normalizeString(task.lastError),
    runState: {
      consecutiveFailures: clampInt(task.runState?.consecutiveFailures, 0, 0, 1000),
      remoteCallCount: clampInt(task.runState?.remoteCallCount, 0, 0, 100000)
    }
  };
}

function buildManagedRuntimeDecisionConfig(config) {
  return {
    maxInputTokensPerTurn: clampInt(config.maxInputTokensPerTurn, DEFAULT_AUTOPILOT_CONFIG.maxInputTokensPerTurn, 512, 500000),
    maxRemoteCallsPerTask: clampInt(config.maxRemoteCallsPerTask, DEFAULT_AUTOPILOT_CONFIG.maxRemoteCallsPerTask, 1, 100000),
    maxCandidatesPerPlane: 4,
    maxContextChars: clampInt(config.maxContextChars, DEFAULT_AUTOPILOT_CONFIG.maxContextChars, 1200, 100000)
  };
}

function buildManagedRuntimeContextPackText(decision) {
  const strategyLine = decision?.contextPack?.strategyCandidates?.[0]?.title
    ? `命中策略：${truncateText(decision.contextPack.strategyCandidates[0].title, 160)}`
    : "命中策略：无高置信固定策略，本轮需要显式规划。";
  const memoryLines = (decision?.contextPack?.memoryCandidates || []).slice(0, 5).map((entry) => (
    `- [memory] ${truncateText(entry.title || entry.excerpt, 160)}`
  ));
  const intelLines = (decision?.contextPack?.intelCandidates || []).slice(0, 4).map((entry) => (
    `- [intel] ${truncateText(entry.title, 90)} | ${truncateText(entry.excerpt || "", 120)}`
  ));
  const synthesisLines = (decision?.contextPack?.synthesis || []).slice(0, 6).map((line) => `- ${line}`);
  return [
    `决策通道：${decision?.thinkingLane || "system1"}`,
    strategyLine,
    `本地优先策略：${decision?.localFirstPlan || ""}`,
    `远程推理策略：${decision?.remoteModelPlan || ""}`,
    decision?.contextPack?.summary ? `上下文摘要：${decision.contextPack.summary}` : "",
    memoryLines.length ? "相关记忆：" : "",
    ...memoryLines,
    intelLines.length ? "相关情报：" : "",
    ...intelLines,
    synthesisLines.length ? "综合上下文：" : "",
    ...synthesisLines
  ].filter(Boolean).join("\n");
}

function adaptManagedRuntimeDecision(decision) {
  const relevantMemorySummaries = (decision?.contextPack?.memoryCandidates || [])
    .map((entry) => truncateText(entry.title || entry.excerpt || "", 180))
    .filter(Boolean)
    .slice(0, 5);
  const relevantIntelSummaries = (decision?.contextPack?.intelCandidates || [])
    .map((entry) => truncateText(entry.excerpt || entry.title || "", 180))
    .filter(Boolean)
    .slice(0, 4);
  return {
    builtAt: decision.builtAt,
    thinkingLane: decision.thinkingLane,
    decisionSummary: decision.summary,
    summary: decision.summary,
    recommendedWorker: decision.recommendedWorker,
    recommendedSkills: decision.recommendedSkills,
    relevantMemoryIds: decision.relevantMemoryIds,
    relevantIntelIds: decision.relevantIntelIds,
    relevantMemorySummaries,
    relevantIntelSummaries,
    localFirstPlan: decision.localFirstPlan,
    remoteModelPlan: decision.remoteModelPlan,
    fallbackOrder: decision.fallbackOrder,
    budgetLimit: decision.budgetLimit,
    contextPack: buildManagedRuntimeContextPackText(decision),
    contextPackRecord: decision.contextPack,
    coreDecision: decision
  };
}

function normalizeManagedRuntimeThinkingLane(value) {
  return normalizeString(value).toLowerCase() === "system2" ? "system2" : "system1";
}

function buildManagedRuntimeTaskReviewSummary(task) {
  return truncateText(
    task?.lastResult
      || task?.runState?.lastResultSummary
      || task?.blockedReason
      || task?.lastError
      || task?.planSummary
      || task?.nextAction
      || task?.goal
      || task?.title,
    220
  );
}

async function buildManagedRuntimeTaskArtifacts(task, options = {}) {
  try {
    const core = await loadManagedRuntimeTaskArtifactsCore();
    const status = normalizeAutopilotStatusValue(task?.status, "queued");
    const updatedAt = parseOptionalTimestamp(task?.updatedAt) || nowTs();
    const startedAt = parseOptionalTimestamp(task?.lastRunAt) || updatedAt;
    const route = normalizeString(task?.route) || "general";
    const worker = normalizeString(task?.assignee) || "main";
    const thinkingLane = normalizeManagedRuntimeThinkingLane(task?.runState?.lastThinkingLane);
    const taskRun = core.buildTaskRunSnapshot({
      taskId: normalizeString(task?.id),
      status,
      thinkingLane,
      startedAt,
      updatedAt,
      completedAt: parseOptionalTimestamp(task?.runState?.completedAt),
      blockedAt: parseOptionalTimestamp(task?.runState?.blockedAt),
      concurrencyKey: `${route}:${worker}`,
      metadata: {
        source: "openclaw-codex-control",
        route,
        worker,
        backgroundSessionId: normalizeString(task?.runState?.backgroundSessionId) || null
      }
    });
    const taskStep = core.buildTaskTransitionStep({
      taskId: normalizeString(task?.id),
      runId: taskRun.id,
      status,
      idempotencyKey: `task_transition:${normalizeString(task?.id)}:${taskRun.id}:${status}:${updatedAt}`,
      worker,
      route,
      skillId: normalizeStringArray(task?.skillHints)[0] || null,
      occurredAt: updatedAt,
      error: normalizeString(task?.lastError || task?.blockedReason) || null,
      metadata: {
        source: "openclaw-codex-control",
        fromStatus: normalizeString(options.fromStatus) || null,
        transitionEventId: normalizeString(options.transitionEventId) || null
      }
    });
    let taskReview = null;
    let shareableReview = null;
    if (options.includeReview) {
      taskReview = core.buildTaskReviewRecord({
        taskId: normalizeString(task?.id),
        runId: taskRun.id,
        status,
        summary: buildManagedRuntimeTaskReviewSummary(task),
        extractedMemoryIds: normalizeStringArray(options.memoryIds),
        strategyCandidateIds: normalizeStringArray(options.strategyIds),
        createdAt: updatedAt,
        metadata: {
          source: "openclaw-codex-control",
          fromStatus: normalizeString(options.fromStatus) || null,
          transitionEventId: normalizeString(options.transitionEventId) || null,
          route,
          worker,
          thinkingLane
        }
      });
      shareableReview = core.buildShareableReviewEnvelope(taskReview, {
        generatedAt: parseOptionalTimestamp(options.generatedAt) || updatedAt,
        metadata: {
          source: "openclaw-codex-control",
          route,
          worker,
          thinkingLane
        }
      });
    }
    const taskRecord = core.buildTaskRecordSnapshot({
      id: normalizeString(task?.id),
      title: normalizeString(task?.title),
      route,
      status,
      priority: normalizeString(task?.priority) || "normal",
      budgetMode: normalizeString(task?.budgetMode) || DEFAULT_AUTOPILOT_CONFIG.defaultBudgetMode,
      retrievalMode: normalizeString(task?.retrievalMode) || DEFAULT_AUTOPILOT_CONFIG.defaultRetrievalMode,
      worker,
      skillIds: normalizeStringArray(task?.skillHints),
      memoryRefs: normalizeStringArray(task?.memoryRefs),
      intelRefs: normalizeStringArray(task?.intelRefs),
      recurring: task?.recurring === true,
      maintenance: task?.maintenance === true,
      activeRunId: taskRun.id,
      latestReviewId: taskReview?.id || null,
      createdAt: parseOptionalTimestamp(task?.createdAt) || updatedAt,
      updatedAt,
      metadata: {
        source: "openclaw-codex-control",
        workspace: normalizeString(task?.workspace) || null,
        taskKind: normalizeString(task?.taskKind) || null,
        reportPolicy: normalizeString(task?.reportPolicy) || null,
        sourceType: normalizeString(task?.source) || null,
        planSummary: normalizeString(task?.planSummary) || null,
        nextAction: normalizeString(task?.nextAction) || null,
        blockedReason: normalizeString(task?.blockedReason) || null,
        lastError: normalizeString(task?.lastError) || null
      }
    });
    return {
      taskRecord,
      taskRun,
      taskStep,
      taskReview,
      shareableReview
    };
  } catch (error) {
    if (!managedRuntimeTaskArtifactsWarned && pluginApi?.logger) {
      managedRuntimeTaskArtifactsWarned = true;
      pluginApi.logger.warn(`[openclaw-codex-control] managed runtime task artifacts unavailable, using legacy task events only: ${error?.message || error}`);
    }
    return null;
  }
}

async function buildTaskDecisionLegacy(task, config) {
  const [memoryStore, intelStore] = await Promise.all([
    loadMemoryStore(),
    loadIntelStore()
  ]);
  const relevantMemories = selectRelevantMemories(task, memoryStore, 5);
  const relevantStrategies = selectRelevantStrategies(task, memoryStore, 3);
  const relevantIntel = selectRelevantIntel(task, intelStore, 4);
  const topStrategy = relevantStrategies[0]?.entry || null;
  const thinkingLane = shouldUseSystem2(task, topStrategy, relevantMemories, relevantIntel) ? "system2" : "system1";
  const recommendedWorker = normalizeString(topStrategy?.recommendedWorker || task.assignee || "main");
  const recommendedSkills = mergeUniqueStrings(
    task.skillHints,
    topStrategy?.recommendedSkills,
    buildSkillHintsForTask(task.route || task.taskKind || "general", `${task.goal} ${task.lastError} ${task.blockedReason}`)
  ).slice(0, 12);
  const relevantMemoryIds = relevantMemories.map((entry) => entry.entry.id);
  const relevantIntelIds = relevantIntel.map((entry) => entry.entry.id);
  const fallbackOrder = buildFallbackOrder(task, recommendedWorker, recommendedSkills, thinkingLane);
  const memoryLines = relevantMemories.map((entry) => (
    `- [memory][${entry.entry.memoryType}] ${truncateText(entry.entry.summary, 160)}`
  ));
  const intelLines = relevantIntel.map((entry) => (
    `- [intel][${entry.entry.domain}] ${truncateText(entry.entry.title, 90)} | ${truncateText(entry.entry.judgement || entry.entry.summary, 120)}`
  ));
  const strategyLine = topStrategy
    ? `命中策略：${truncateText(topStrategy.triggerConditions, 120)} -> ${truncateText(topStrategy.recommendedPath, 120)}`
    : "命中策略：无高置信固定策略，本轮需要显式规划。";
  const decisionSummary = [
    `lane=${thinkingLane}`,
    `worker=${recommendedWorker}`,
    strategyLine,
    memoryLines.length ? `记忆命中 ${memoryLines.length} 条` : "记忆命中 0 条",
    intelLines.length ? `相关情报 ${intelLines.length} 条` : "相关情报 0 条",
    thinkingLane === "system1"
      ? "优先快通道，直接复用稳定路径。"
      : "进入慢通道，需要显式规划、裁剪上下文并准备 fallback。"
  ].join(" | ");
  const contextPack = [
    `决策通道：${thinkingLane}`,
    strategyLine,
    `本地优先策略：${buildLocalFirstPlan(task, thinkingLane)}`,
    `远程推理策略：${buildRemoteModelPlan(task, thinkingLane)}`,
    memoryLines.length ? "相关记忆：" : "",
    ...memoryLines,
    intelLines.length ? "相关情报：" : "",
    ...intelLines
  ].filter(Boolean).join("\n");
  return {
    builtAt: nowTs(),
    thinkingLane,
    decisionSummary,
    recommendedWorker,
    recommendedSkills,
    relevantMemoryIds,
    relevantIntelIds,
    relevantMemorySummaries: relevantMemories.map((entry) => truncateText(entry.entry.summary, 180)),
    relevantIntelSummaries: relevantIntel.map((entry) => truncateText(entry.entry.judgement || entry.entry.summary || entry.entry.title, 180)),
    localFirstPlan: buildLocalFirstPlan(task, thinkingLane),
    remoteModelPlan: buildRemoteModelPlan(task, thinkingLane),
    fallbackOrder,
    budgetLimit: {
      maxInputTokens: config.maxInputTokensPerTurn,
      maxRemoteCallsRemaining: Math.max(0, config.maxRemoteCallsPerTask - (task.runState?.remoteCallCount || 0))
    },
    contextPack: truncateText(contextPack, Math.max(1200, config.maxContextChars))
  };
}

async function buildTaskDecision(task, config) {
  try {
    const core = await loadManagedRuntimeDecisionCore();
    if (!core?.buildDecisionRecord) {
      return await buildTaskDecisionLegacy(task, config);
    }
    const [memoryStore, intelStore] = await Promise.all([
      loadMemoryStore(),
      loadIntelStore()
    ]);
    const coreDecision = core.buildDecisionRecord({
      task: buildManagedRuntimeDecisionTask(task, config),
      config: buildManagedRuntimeDecisionConfig(config),
      sources: {
        strategies: memoryStore.strategies.map((entry) => toManagedRuntimeStrategyRecord(entry)),
        memories: memoryStore.memories.map((entry) => toManagedRuntimeMemoryRecord(entry)),
        intel: intelStore.items.map((entry) => toManagedRuntimeIntelCandidate(entry)),
        archive: []
      },
      now: nowTs()
    });
    return adaptManagedRuntimeDecision(coreDecision);
  } catch {
    return await buildTaskDecisionLegacy(task, config);
  }
}

function buildDecisionPromptBlock(decision) {
  if (!isRecord(decision)) return "";
  const lines = [
    "决策内核输出：",
    `- 决策通道：${decision.thinkingLane || "system1"}`,
    `- 推荐执行者：${decision.recommendedWorker || "main"}`,
    decision.recommendedSkills?.length ? `- 推荐 skills：${decision.recommendedSkills.join(", ")}` : "",
    decision.fallbackOrder?.length ? `- fallback 顺序：${decision.fallbackOrder.join(" -> ")}` : "",
    decision.localFirstPlan ? `- 本地优先：${decision.localFirstPlan}` : "",
    decision.remoteModelPlan ? `- 远程推理：${decision.remoteModelPlan}` : "",
    decision.contextPack ? decision.contextPack : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function buildMemorySignature(memoryType, route, tags, summary) {
  return `mem_${hashText(`${memoryType}|${route}|${normalizeKeywordTags(tags).slice(0, 8).join("|")}|${truncateText(summary, 96)}`, 16)}`;
}

function buildStrategySignature(route, worker, skills, lane) {
  return `strategy_${hashText(`${route}|${worker}|${mergeUniqueStrings(skills).slice(0, 8).join("|")}|${lane}`, 16)}`;
}

function computeTaskCompletionScore(task) {
  const status = normalizeAutopilotStatusValue(task?.status, "queued");
  const remoteCalls = clampInt(task?.runState?.remoteCallCount, 0, 0, 100000);
  const failures = clampInt(task?.runState?.consecutiveFailures, 0, 0, 100000);
  let score = 30;
  if (status === "completed") score = 92;
  else if (status === "waiting_external") score = 60;
  else if (status === "waiting_user") score = 44;
  else if (status === "ready") score = 40;
  else if (status === "blocked") score = 18;
  score -= Math.max(0, remoteCalls - 1) * 6;
  score -= Math.max(0, failures) * 4;
  if (normalizeString(task?.lastError)) score -= 6;
  if (normalizeString(task?.blockedReason)) score -= 4;
  return Math.max(5, Math.min(100, score));
}

function extractObservedTaskSkillBundle(task) {
  return mergeUniqueStrings(
    task?.runState?.lastRecommendedSkills,
    task?.skillHints
  ).slice(0, 6);
}

function buildEvolutionCandidateSignal(candidate) {
  const type = normalizeString(candidate?.candidateType);
  if (type === "intel_source_reweight") {
    return Math.sign(Number(candidate?.measuredEffect?.priorityDelta || 0));
  }
  const shadowWinCount = Number(candidate?.shadowMetrics?.shadowWinCount || 0);
  const shadowLossCount = Number(candidate?.shadowMetrics?.shadowLossCount || 0);
  if (shadowWinCount > shadowLossCount) return 1;
  if (shadowLossCount > shadowWinCount) return -1;
  const successCount = Number(candidate?.measuredEffect?.successCount || 0);
  const blockedCount = Number(candidate?.measuredEffect?.blockedCount || 0);
  const waitingUserCount = Number(candidate?.measuredEffect?.waitingUserCount || candidate?.measuredEffect?.waitingHumanCount || 0);
  if (successCount > blockedCount + waitingUserCount) return 1;
  if (blockedCount + waitingUserCount > successCount) return -1;
  return 0;
}

function mergeCandidateMetrics(currentValue, incomingValue, key) {
  const incomingNum = Number(incomingValue);
  if (!Number.isFinite(incomingNum)) return incomingValue ?? currentValue;
  const currentNum = Number(currentValue);
  if (key === "priorityDelta") return incomingNum;
  if (/Count$|Total$/.test(key)) return (Number.isFinite(currentNum) ? currentNum : 0) + incomingNum;
  if (/^avg[A-Z]|Rate$|Score$/.test(key)) return averageNumber([currentNum, incomingNum]);
  return incomingNum;
}

function mergeEvolutionMeasuredEffect(currentEffect, incomingEffect) {
  const result = { ...(isRecord(currentEffect) ? currentEffect : {}) };
  for (const [key, value] of Object.entries(isRecord(incomingEffect) ? incomingEffect : {})) {
    result[key] = mergeCandidateMetrics(result[key], value, key);
  }
  const sampleCount = Number(result.sampleCount || 0);
  if (sampleCount > 0) {
    if (Number.isFinite(Number(result.remoteCallTotal))) {
      result.avgRemoteCalls = Number(result.remoteCallTotal) / sampleCount;
    }
    if (Number.isFinite(Number(result.completionScoreTotal))) {
      result.avgCompletionScore = Number(result.completionScoreTotal) / sampleCount;
    }
    const successCount = Number(result.successCount || 0);
    if (Number.isFinite(successCount)) {
      result.successRate = successCount / sampleCount;
    }
  }
  return result;
}

function mergeEvolutionShadowMetrics(currentMetrics, incomingMetrics) {
  const result = { ...(isRecord(currentMetrics) ? currentMetrics : {}) };
  for (const [key, value] of Object.entries(isRecord(incomingMetrics) ? incomingMetrics : {})) {
    if (Array.isArray(value) || Array.isArray(result[key])) {
      result[key] = mergeUniqueStrings(result[key], value).slice(0, 24);
      continue;
    }
    if (typeof value === "number" || typeof result[key] === "number") {
      if (key === "observationCount" || key === "consistentSignalCount" || key === "lastSignal") continue;
      result[key] = mergeCandidateMetrics(result[key], value, key);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function buildRouteStrategyFromEvolutionCandidate(candidate) {
  const shadow = isRecord(candidate?.shadowMetrics) ? candidate.shadowMetrics : {};
  const route = normalizeString(shadow.route);
  const thinkingLane = normalizeString(shadow.lane || "system1");
  const worker = normalizeString(shadow.worker || (route && route !== "general" ? route : "main"), "main");
  const skillBundle = normalizeAutopilotTaskHintSet(shadow.skillBundle || []);
  const avgCompletionScore = Number(candidate?.measuredEffect?.avgCompletionScore || 0);
  const successCount = clampInt(candidate?.measuredEffect?.successCount, 0, 0, 100000);
  const blockedCount = clampInt(candidate?.measuredEffect?.blockedCount, 0, 0, 100000);
  const waitingUserCount = clampInt(candidate?.measuredEffect?.waitingUserCount ?? candidate?.measuredEffect?.waitingHumanCount, 0, 0, 100000);
  const fallbackPath = thinkingLane === "system1"
    ? "若命中未知场景、连续失败或相关记忆不足，则升级到 system2 并回退到 worker:main。"
    : "若已有高置信策略且上下文清晰，则降级到 system1，并只带最少必要上下文。";
  return {
    id: buildStrategySignature(route || "general", worker, skillBundle, thinkingLane),
    route: route || "general",
    scope: "evolved-route-default",
    triggerConditions: `${route || "general"} 高频任务默认采用 ${thinkingLane} 决策通道。`,
    recommendedPath: `优先由 ${worker} 执行，默认通道 ${thinkingLane}；优先技能：${skillBundle.join(", ") || "route-native-skills"}。`,
    fallbackPath,
    recommendedWorker: worker,
    recommendedSkills: skillBundle,
    thinkingLane,
    confidence: clampPercent(Math.round(Math.max(68, avgCompletionScore || 0) + Math.min(12, successCount * 2) - Math.min(10, blockedCount + waitingUserCount))),
    measuredEffect: candidate?.measuredEffect,
    tags: mergeUniqueStrings([route, thinkingLane, worker], skillBundle),
    derivedFromMemoryIds: candidate?.derivedFromMemoryIds || [],
    sourceTaskIds: candidate?.sourceTaskIds || [],
    sourceIntelIds: candidate?.sourceIntelIds || [],
    invalidatedBy: candidate?.invalidatedBy || [],
    sourceEventIds: candidate?.sourceEventIds || []
  };
}

function computeTaskComplexityScore(task, decision) {
  let score = 0;
  score += Math.min(28, Math.round(normalizeString(task?.goal).length / 8));
  score += Math.min(20, clampInt(task?.runState?.consecutiveFailures, 0, 0, 1000) * 12);
  score += Math.min(18, Math.max(0, clampInt(task?.runState?.remoteCallCount, 0, 0, 1000) - 1) * 8);
  score += Math.min(12, Math.max(0, 2 - normalizeStringArray(decision?.relevantMemoryIds).length) * 6);
  score += Math.min(10, Math.max(0, normalizeStringArray(decision?.relevantIntelIds).length - 1) * 4);
  if (task?.priority === "high") score += 8;
  if (normalizeString(task?.route || task?.taskKind, "general") === "general") score += 8;
  return Math.max(0, Math.min(100, score));
}

function buildCounterfactualShadowSample(task, candidateType, route, lane, worker, skillBundle, completionScore, remoteCalls, decision) {
  const complexity = computeTaskComplexityScore(task, decision);
  const actualScore = completionScore - remoteCalls * 5 - clampInt(task?.runState?.consecutiveFailures, 0, 0, 1000) * 6;
  if (candidateType === "route_default_lane") {
    const baselineLane = lane === "system1" ? "system2" : "system1";
    let baselineScore = completionScore;
    if (baselineLane === "system2") {
      baselineScore -= 8;
      if (complexity >= 62) baselineScore += 10;
      if ((decision?.relevantIntelIds || []).length >= 2 && (decision?.relevantMemoryIds || []).length <= 1) baselineScore += 6;
    } else {
      baselineScore -= 4;
      if (complexity <= 46) baselineScore += 10;
      if (remoteCalls <= 1 && (decision?.relevantMemoryIds || []).length >= 2) baselineScore += 8;
    }
    if (task?.status === "blocked" || task?.status === "waiting_user") baselineScore += 6;
    const delta = actualScore - baselineScore;
    return {
      shadowType: "counterfactual_lane",
      baselineRef: `${route}:${baselineLane}`,
      delta,
      qualityDelta: delta,
      tokenDelta: baselineLane === "system2" ? -6 : 6,
      latencyDelta: baselineLane === "system2" ? -4 : 4,
      result: delta >= 4 ? "win" : delta <= -4 ? "loss" : "tie",
      reason: lane === "system1"
        ? `system1 实际路径对比 ${baselineLane} 基线更省 token；复杂度 ${complexity}。`
        : `system2 实际路径对比 ${baselineLane} 基线更稳；复杂度 ${complexity}。`
    };
  }
  const bundleStrength = Math.min(16, skillBundle.length * 3 + (worker && worker !== "main" ? 2 : 0));
  let baselineScore = completionScore - bundleStrength;
  if (task?.status === "completed") baselineScore -= 4;
  if (task?.status === "blocked" || task?.status === "waiting_user") baselineScore += 8;
  if (remoteCalls <= 1) baselineScore -= 5;
  if (route === "office" || route === "research" || route === "coder") baselineScore -= 4;
  const delta = actualScore - baselineScore;
  return {
    shadowType: "counterfactual_skill_bundle",
    baselineRef: `${route}:${worker || "main"}:route-native-skills`,
    delta,
    qualityDelta: delta,
    tokenDelta: Math.max(0, 8 - bundleStrength),
    latencyDelta: Math.max(0, 6 - Math.min(6, skillBundle.length)),
    result: delta >= 4 ? "win" : delta <= -4 ? "loss" : "tie",
    reason: `${route} 路由的技能组合对比 route-native 基线的对照结果：${delta >= 4 ? "更优" : delta <= -4 ? "更差" : "接近"}。`
  };
}

async function observeTaskOutcomeForEvolution(task, sourceEvent) {
  if (!task || !["completed", "blocked", "waiting_user"].includes(task.status) || !sourceEvent?.eventId) return null;
  const route = normalizeString(task.route || task.taskKind || "general", "general");
  const worker = normalizeString(task.assignee || task.runState?.lastRecommendedWorker || "main", "main");
  const lane = normalizeString(task.runState?.lastThinkingLane || task.optimizationState?.decision?.thinkingLane || "system1", "system1");
  const skillBundle = extractObservedTaskSkillBundle(task);
  const completionScore = computeTaskCompletionScore(task);
  const remoteCalls = clampInt(task.runState?.remoteCallCount, 0, 0, 100000);
  const successCount = task.status === "completed" ? 1 : 0;
  const blockedCount = task.status === "blocked" ? 1 : 0;
  const waitingUserCount = task.status === "waiting_user" ? 1 : 0;
  const decision = isRecord(task.optimizationState?.decision) ? task.optimizationState.decision : {};
  const derivedMemoryIds = mergeUniqueStrings(task.memoryRefs, decision.relevantMemoryIds).slice(0, 24);
  const sourceIntelIds = mergeUniqueStrings(task.intelRefs, decision.relevantIntelIds).slice(0, 24);
  const store = await loadEvolutionStore();
  const observedCandidateIds = [];
  const shadowComparisons = [];
  const laneShadow = buildCounterfactualShadowSample(task, "route_default_lane", route, lane, worker, skillBundle, completionScore, remoteCalls, decision);
  const routeLaneCandidate = upsertEvolutionCandidate(store, {
    id: `evo_${hashText(`route-lane|${route}|${lane}`, 16)}`,
    targetLayer: "decision",
    candidateType: "route_default_lane",
    candidateRef: `${route}:${lane}`,
    expectedEffect: {
      reduceDecisionLatency: lane === "system1",
      preserveDepth: lane === "system2"
    },
    measuredEffect: {
      sampleCount: 1,
      successCount,
      blockedCount,
      waitingUserCount,
      remoteCallTotal: remoteCalls,
      avgRemoteCalls: remoteCalls,
      completionScoreTotal: completionScore,
      avgCompletionScore: completionScore
    },
    shadowMetrics: {
      route,
      lane,
      worker,
      skillBundle,
      completionScore,
      baselineRef: laneShadow.baselineRef,
      shadowType: laneShadow.shadowType,
      shadowSampleCount: 1,
      shadowWinCount: laneShadow.result === "win" ? 1 : 0,
      shadowLossCount: laneShadow.result === "loss" ? 1 : 0,
      shadowTieCount: laneShadow.result === "tie" ? 1 : 0,
      shadowDeltaTotal: laneShadow.delta,
      avgShadowDelta: laneShadow.delta,
      lastShadowReason: laneShadow.reason
    },
    adoptionState: "shadow",
    notes: `${route} 路由在 ${lane} 通道上的真实执行观测正在累积，先保持影子模式。`,
    sourceEventIds: [sourceEvent.eventId],
    sourceTaskIds: [task.id],
    sourceIntelIds,
    derivedFromMemoryIds: derivedMemoryIds
  });
  observedCandidateIds.push(routeLaneCandidate.id);
  shadowComparisons.push({
    candidateId: routeLaneCandidate.id,
    ...laneShadow
  });
  if (skillBundle.length) {
    const skillShadow = buildCounterfactualShadowSample(task, "route_skill_bundle", route, lane, worker, skillBundle, completionScore, remoteCalls, decision);
    const routeSkillCandidate = upsertEvolutionCandidate(store, {
      id: `evo_${hashText(`route-skill|${route}|${worker}|${skillBundle.join("|")}|${lane}`, 16)}`,
      targetLayer: "skill",
      candidateType: "route_skill_bundle",
      candidateRef: `${route}:${worker}:${hashText(skillBundle.join("|"), 10)}`,
      expectedEffect: {
        reduceRemoteCalls: true,
        improveCompletion: true
      },
      measuredEffect: {
        sampleCount: 1,
        successCount,
        blockedCount,
        waitingUserCount,
        remoteCallTotal: remoteCalls,
        avgRemoteCalls: remoteCalls,
        completionScoreTotal: completionScore,
        avgCompletionScore: completionScore
      },
      shadowMetrics: {
        route,
        lane,
        worker,
        skillBundle,
        completionScore,
        baselineRef: skillShadow.baselineRef,
        shadowType: skillShadow.shadowType,
        shadowSampleCount: 1,
        shadowWinCount: skillShadow.result === "win" ? 1 : 0,
        shadowLossCount: skillShadow.result === "loss" ? 1 : 0,
        shadowTieCount: skillShadow.result === "tie" ? 1 : 0,
        shadowDeltaTotal: skillShadow.delta,
        avgShadowDelta: skillShadow.delta,
        lastShadowReason: skillShadow.reason
      },
      adoptionState: "shadow",
      notes: `${route} 路由的技能组合 ${skillBundle.join(", ")} 正在影子模式下累计真实效果。`,
      sourceEventIds: [sourceEvent.eventId],
      sourceTaskIds: [task.id],
      sourceIntelIds,
      derivedFromMemoryIds: derivedMemoryIds
    });
    observedCandidateIds.push(routeSkillCandidate.id);
    shadowComparisons.push({
      candidateId: routeSkillCandidate.id,
      ...skillShadow
    });
  }
  await saveEvolutionStore(store);
  await appendSystemEvent("task_shadow_observed", {
    taskId: task.id,
    route,
    worker,
    thinkingLane: lane,
    completionScore,
    candidateIds: observedCandidateIds
  });
  await appendSystemEvent("task_shadow_compared", {
    taskId: task.id,
    route,
    candidateIds: observedCandidateIds,
    samples: shadowComparisons
  });
  return buildEvolutionStatus(store);
}

async function materializeAdoptedEvolutionStrategies(store, memoryStore) {
  let memoryChanged = false;
  const materialized = [];
  for (const candidate of store.candidates) {
    if (candidate.adoptionState !== "adopted") continue;
    if (candidate.invalidatedBy?.length) continue;
    if (!["route_default_lane", "route_skill_bundle"].includes(candidate.candidateType)) continue;
    if (candidate.notes && candidate.notes.includes("[materialized]")) continue;
    const strategy = buildRouteStrategyFromEvolutionCandidate(candidate);
    upsertStrategyEntry(memoryStore, strategy);
    candidate.notes = truncateText(`${candidate.notes || ""} [materialized] 已物化为可被 Decision Core 直接读取的策略。`, 220);
    candidate.updatedAt = nowTs();
    materialized.push({
      candidateId: candidate.id,
      strategyId: strategy.id
    });
    memoryChanged = true;
  }
  if (materialized.length) {
    await appendSystemEvent("evolution_strategy_materialized", {
      materialized
    });
  }
  return memoryChanged;
}

function upsertMemoryEntry(store, candidate) {
  const normalized = normalizeMemoryEntry(candidate);
  const index = store.memories.findIndex((entry) => entry.id === normalized.id);
  if (index < 0) {
    store.memories.unshift(normalized);
    return normalized;
  }
  const current = store.memories[index];
  const merged = normalizeMemoryEntry({
    ...current,
    ...normalized,
    summary: normalizeString(normalized.summary || current.summary),
    tags: mergeUniqueStrings(current.tags, normalized.tags).slice(0, 24),
    confidence: Math.max(current.confidence, normalized.confidence),
    sourceEventIds: mergeUniqueStrings(current.sourceEventIds, normalized.sourceEventIds).slice(0, 48),
    sourceTaskIds: mergeUniqueStrings(current.sourceTaskIds, normalized.sourceTaskIds).slice(0, 24),
    sourceIntelIds: mergeUniqueStrings(current.sourceIntelIds, normalized.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: mergeUniqueStrings(current.derivedFromMemoryIds, normalized.derivedFromMemoryIds).slice(0, 24),
    invalidatedBy: mergeUniqueStrings(current.invalidatedBy, normalized.invalidatedBy).slice(0, 24),
    lastReinforcedAt: Math.max(current.lastReinforcedAt || 0, normalized.lastReinforcedAt || 0),
    decayScore: Math.min(current.decayScore, normalized.decayScore),
    version: Math.max(current.version, normalized.version),
    updatedAt: nowTs()
  });
  store.memories[index] = merged;
  return merged;
}

function upsertStrategyEntry(store, candidate) {
  const normalized = normalizeStrategyEntry(candidate);
  const index = store.strategies.findIndex((entry) => entry.id === normalized.id);
  if (index < 0) {
    store.strategies.unshift(normalized);
    return normalized;
  }
  const current = store.strategies[index];
  const merged = normalizeStrategyEntry({
    ...current,
    ...normalized,
    confidence: Math.max(current.confidence, normalized.confidence),
    recommendedSkills: mergeUniqueStrings(current.recommendedSkills, normalized.recommendedSkills).slice(0, 16),
    derivedFromMemoryIds: mergeUniqueStrings(current.derivedFromMemoryIds, normalized.derivedFromMemoryIds).slice(0, 24),
    sourceTaskIds: mergeUniqueStrings(current.sourceTaskIds, normalized.sourceTaskIds).slice(0, 24),
    sourceIntelIds: mergeUniqueStrings(current.sourceIntelIds, normalized.sourceIntelIds).slice(0, 24),
    invalidatedBy: mergeUniqueStrings(current.invalidatedBy, normalized.invalidatedBy).slice(0, 24),
    sourceEventIds: mergeUniqueStrings(current.sourceEventIds, normalized.sourceEventIds).slice(0, 24),
    measuredEffect: {
      successCount: clampInt((current.measuredEffect?.successCount || 0) + (normalized.measuredEffect?.successCount || 0), 0, 0, 100000),
      blockedCount: clampInt((current.measuredEffect?.blockedCount || 0) + (normalized.measuredEffect?.blockedCount || 0), 0, 0, 100000),
      avgRemoteCalls: averageNumber([current.measuredEffect?.avgRemoteCalls, normalized.measuredEffect?.avgRemoteCalls])
    },
    updatedAt: nowTs()
  });
  store.strategies[index] = merged;
  return merged;
}

function upsertLearningEntry(store, candidate) {
  const normalized = normalizeLearningEntry(candidate);
  const index = store.learnings.findIndex((entry) => entry.id === normalized.id);
  if (index < 0) {
    store.learnings.unshift(normalized);
    return normalized;
  }
  const current = store.learnings[index];
  const merged = normalizeLearningEntry({
    ...current,
    ...normalized,
    effectOnSuccessRate: Math.max(current.effectOnSuccessRate, normalized.effectOnSuccessRate),
    effectOnTokenCost: Math.min(current.effectOnTokenCost, normalized.effectOnTokenCost),
    effectOnCompletionQuality: Math.max(current.effectOnCompletionQuality, normalized.effectOnCompletionQuality),
    sourceEventIds: mergeUniqueStrings(current.sourceEventIds, normalized.sourceEventIds).slice(0, 24),
    sourceTaskIds: mergeUniqueStrings(current.sourceTaskIds, normalized.sourceTaskIds).slice(0, 24),
    updatedAt: nowTs()
  });
  store.learnings[index] = merged;
  return merged;
}

function appendMemoryInvalidationNote(existing, reasonEventId) {
  const base = normalizeString(existing);
  const suffix = `[invalidated:${reasonEventId}]`;
  if (base.includes(suffix)) return truncateText(base, 220);
  return truncateText(`${base ? `${base} ` : ""}${suffix}`, 220);
}

async function invalidateMemoryLineage(memoryIds, reasonEventId) {
  const targetIds = new Set(normalizeStringArray(memoryIds));
  if (targetIds.size === 0 || !reasonEventId) return null;
  const [memoryStore, evolutionStore, autopilotStore] = await Promise.all([
    loadMemoryStore(),
    loadEvolutionStore(),
    loadAutopilotStore()
  ]);
  let changed = false;
  let evolutionChanged = false;
  let autopilotChanged = false;
  const affectedMemoryIds = new Set(targetIds);
  const affectedStrategyIds = new Set();
  const affectedCandidateIds = new Set();
  const affectedTaskIds = new Set();
  let pending = [...targetIds];
  while (pending.length > 0) {
    const currentId = pending.pop();
    for (const entry of memoryStore.memories) {
      if (entry.id !== currentId && !entry.derivedFromMemoryIds.includes(currentId)) continue;
      if (!affectedMemoryIds.has(entry.id)) {
        affectedMemoryIds.add(entry.id);
        pending.push(entry.id);
      }
      if (!entry.invalidatedBy.includes(reasonEventId)) {
        entry.invalidatedBy = mergeUniqueStrings(entry.invalidatedBy, [reasonEventId]).slice(0, 24);
        entry.confidence = Math.max(5, Math.round(entry.confidence * 0.45));
        entry.decayScore = Math.min(100, Math.max(entry.decayScore, 65));
        entry.updatedAt = nowTs();
        changed = true;
      }
    }
  }
  for (const strategy of memoryStore.strategies) {
    if (strategy.derivedFromMemoryIds.some((id) => affectedMemoryIds.has(id))) {
      affectedStrategyIds.add(strategy.id);
      if (strategy.invalidatedBy.includes(reasonEventId)) continue;
      strategy.invalidatedBy = mergeUniqueStrings(strategy.invalidatedBy, [reasonEventId]).slice(0, 24);
      strategy.confidence = Math.max(5, Math.round(strategy.confidence * 0.5));
      strategy.updatedAt = nowTs();
      changed = true;
    }
  }
  for (const candidate of evolutionStore.candidates) {
    if (!candidate.derivedFromMemoryIds.some((id) => affectedMemoryIds.has(id))) continue;
    affectedCandidateIds.add(candidate.id);
    if (candidate.invalidatedBy.includes(reasonEventId)) continue;
    candidate.invalidatedBy = mergeUniqueStrings(candidate.invalidatedBy, [reasonEventId]).slice(0, 24);
    candidate.adoptionState = "shadow";
    candidate.notes = appendMemoryInvalidationNote(candidate.notes, reasonEventId);
    candidate.updatedAt = nowTs();
    candidate.lastShadowAt = nowTs();
    evolutionChanged = true;
  }
  const requeueStatuses = new Set(["queued", "planning", "ready", "running", "waiting_external", "blocked"]);
  for (let index = 0; index < autopilotStore.tasks.length; index += 1) {
    const task = autopilotStore.tasks[index];
    if (!task || task.status === "completed" || task.status === "cancelled") continue;
    const taskMemoryRefs = normalizeStringArray(task.memoryRefs);
    const decisionState = isRecord(task.optimizationState?.decision) ? task.optimizationState.decision : {};
    const decisionMemoryRefs = normalizeStringArray(decisionState.relevantMemoryIds);
    const runStateMemoryRefs = normalizeStringArray(task.runState?.lastRelevantMemoryIds);
    const matchedMemoryIds = mergeUniqueStrings(
      taskMemoryRefs.filter((id) => affectedMemoryIds.has(id)),
      decisionMemoryRefs.filter((id) => affectedMemoryIds.has(id)),
      runStateMemoryRefs.filter((id) => affectedMemoryIds.has(id))
    ).slice(0, 24);
    if (matchedMemoryIds.length === 0) continue;
    affectedTaskIds.add(task.id);
    const nextDecisionState = {
      ...decisionState,
      relevantMemoryIds: removeStringsFromSet(decisionMemoryRefs, affectedMemoryIds),
      memoryInvalidatedAt: nowTs(),
      memoryInvalidationReasonEventId: reasonEventId,
      invalidatedMemoryIds: mergeUniqueStrings(decisionState.invalidatedMemoryIds, matchedMemoryIds).slice(0, 24)
    };
    const nextOptimizationState = {
      ...(isRecord(task.optimizationState) ? task.optimizationState : {}),
      needsReplan: true,
      memoryInvalidatedAt: nowTs(),
      invalidatedBy: mergeUniqueStrings(task.optimizationState?.invalidatedBy, [reasonEventId]).slice(0, 24),
      invalidatedMemoryIds: mergeUniqueStrings(task.optimizationState?.invalidatedMemoryIds, matchedMemoryIds).slice(0, 24),
      decision: nextDecisionState
    };
    const nextRunState = normalizeAutopilotRunState({
      ...task.runState,
      lastRelevantMemoryIds: removeStringsFromSet(runStateMemoryRefs, affectedMemoryIds),
      lastFailureAt: nowTs(),
      lastFailureSummary: truncateText(
        `${normalizeString(task.runState?.lastFailureSummary) ? `${normalizeString(task.runState?.lastFailureSummary)} | ` : ""}相关记忆已失效，任务将重新规划。`,
        180
      ),
      replanCount: (task.runState?.replanCount || 0) + 1
    });
    const nextStatus = requeueStatuses.has(task.status) ? "queued" : task.status;
    autopilotStore.tasks[index] = normalizeAutopilotTask({
      ...task,
      status: nextStatus,
      memoryRefs: removeStringsFromSet(taskMemoryRefs, affectedMemoryIds),
      optimizationState: nextOptimizationState,
      runState: nextRunState,
      nextRunAt: nextStatus === "queued" ? nowTs() : task.nextRunAt,
      nextAction: nextStatus === "queued" ? "相关记忆已失效，重新规划任务。" : task.nextAction,
      updatedAt: nowTs()
    }, autopilotStore.config);
    autopilotChanged = true;
  }
  if (!changed && !evolutionChanged && !autopilotChanged) return buildMemoryStatus(memoryStore);
  let savedMemoryStore = memoryStore;
  const saveOperations = [];
  if (changed) {
    saveOperations.push(
      saveMemoryStore(memoryStore).then((saved) => {
        savedMemoryStore = saved;
      })
    );
  }
  if (evolutionChanged) saveOperations.push(saveEvolutionStore(evolutionStore));
  if (autopilotChanged) saveOperations.push(saveAutopilotStore(autopilotStore));
  if (saveOperations.length > 0) await Promise.all(saveOperations);
  const invalidationEvent = await appendSystemEvent("memory_invalidated", {
    reasonEventId,
    memoryIds: [...affectedMemoryIds],
    strategyIds: [...affectedStrategyIds],
    candidateIds: [...affectedCandidateIds],
    taskIds: [...affectedTaskIds]
  });
  if (affectedTaskIds.size > 0) {
    await appendSystemEvent("task_memory_refs_invalidated", {
      reasonEventId,
      invalidationEventId: invalidationEvent.eventId,
      taskIds: [...affectedTaskIds],
      memoryIds: [...affectedMemoryIds]
    });
  }
  return buildMemoryStatus(savedMemoryStore);
}

async function distillTaskOutcomeToMemory(task, sourceEvent) {
  if (!task || !["completed", "blocked", "waiting_user"].includes(task.status)) return null;
  const summary = truncateText(task.lastResult || task.runState?.lastResultSummary || task.blockedReason || task.lastError || task.goal, 220);
  if (!summary) return null;
  const decision = isRecord(task.optimizationState?.decision) ? task.optimizationState.decision : {};
  const upstreamMemoryIds = mergeUniqueStrings(task.memoryRefs, decision.relevantMemoryIds).slice(0, 24);
  const tags = extractKeywordTags(
    `${task.title} ${task.goal} ${task.lastResult} ${task.blockedReason} ${task.lastError}`,
    [...(task.tags || []), ...(task.skillHints || []), task.route, task.assignee]
  );
  const memoryStore = await loadMemoryStore();
  const success = task.status === "completed";
  const confidence = success ? 82 : task.status === "waiting_user" ? 58 : 64;
  const executionMemory = upsertMemoryEntry(memoryStore, {
    id: buildMemorySignature(success ? "execution" : "avoidance", task.route, tags, summary),
    memoryType: success ? "execution" : "avoidance",
    scope: "task-loop",
    route: task.route,
    summary: success
      ? `在 ${task.route || "general"} 场景下，已验证有效路径：${summary}`
      : `在 ${task.route || "general"} 场景下，容易阻塞/误判的模式：${summary}`,
    appliesWhen: truncateText(task.goal || task.title, 180),
    avoidWhen: success ? "" : truncateText(task.lastError || task.blockedReason || summary, 180),
    tags,
    confidence,
    sourceEventIds: [sourceEvent.eventId],
    sourceTaskIds: [task.id],
    sourceIntelIds: task.intelRefs || [],
    derivedFromMemoryIds: upstreamMemoryIds,
    lastReinforcedAt: nowTs(),
    decayScore: success ? 8 : 24
  });
  const efficiencyMemory = upsertMemoryEntry(memoryStore, {
    id: buildMemorySignature("efficiency", task.route, [...tags, task.budgetMode], `${task.assignee}|${(task.skillHints || []).join(",")}|${task.runState?.remoteCallCount || 0}`),
    memoryType: "efficiency",
    scope: "task-loop",
    route: task.route,
    summary: success
      ? `任务 ${task.title} 的更省 token 路径：优先 ${mergeUniqueStrings(task.skillHints).slice(0, 4).join(", ") || "本地工具"}，决策通道 ${decision.thinkingLane || task.runState?.lastThinkingLane || "system1"}。`
      : `任务 ${task.title} 的低效点：${truncateText(task.lastError || task.blockedReason || summary, 180)}；下次先走 fallback ${mergeUniqueStrings(decision.fallbackOrder).join(" -> ") || "worker:main"}。`,
    appliesWhen: truncateText(task.goal || task.title, 180),
    avoidWhen: success ? "" : truncateText(task.lastError || task.blockedReason || summary, 180),
    tags,
    confidence: success ? 76 : 52,
    sourceEventIds: [sourceEvent.eventId],
    sourceTaskIds: [task.id],
    sourceIntelIds: task.intelRefs || [],
    derivedFromMemoryIds: mergeUniqueStrings([executionMemory.id], upstreamMemoryIds).slice(0, 24),
    lastReinforcedAt: nowTs(),
    decayScore: success ? 12 : 28
  });
  const strategyEntry = upsertStrategyEntry(memoryStore, {
    id: buildStrategySignature(task.route, task.assignee, task.skillHints, decision.thinkingLane || task.runState?.lastThinkingLane || "system1"),
    route: task.route,
    scope: "task-loop",
    triggerConditions: truncateText(task.goal || task.title, 180),
    recommendedPath: truncateText(task.planSummary || task.nextAction || summary, 200),
    fallbackPath: truncateText(mergeUniqueStrings(decision.fallbackOrder).join(" -> ") || task.blockedReason || task.lastError || "worker:main", 200),
    recommendedWorker: task.assignee,
    recommendedSkills: task.skillHints,
    thinkingLane: decision.thinkingLane || task.runState?.lastThinkingLane || "system1",
    confidence: success ? 78 : 48,
    measuredEffect: {
      successCount: success ? 1 : 0,
      blockedCount: success ? 0 : 1,
      avgRemoteCalls: task.runState?.remoteCallCount || 0
    },
    tags,
    derivedFromMemoryIds: [executionMemory.id, efficiencyMemory.id],
    sourceTaskIds: [task.id],
    sourceIntelIds: task.intelRefs || [],
    sourceEventIds: [sourceEvent.eventId]
  });
  upsertLearningEntry(memoryStore, {
    id: `learning_${hashText(`${task.id}|${task.status}|${summary}`, 16)}`,
    observedPattern: success
      ? `成功模式：${truncateText(task.title, 80)} -> ${summary}`
      : `失败模式：${truncateText(task.title, 80)} -> ${summary}`,
    effectOnSuccessRate: success ? 1 : 0,
    effectOnTokenCost: success ? -(task.runState?.remoteCallCount || 0) : task.runState?.remoteCallCount || 0,
    effectOnCompletionQuality: success ? 1 : -1,
    adoptedAs: success ? "strategy" : "avoidance-memory",
    sourceEventIds: [sourceEvent.eventId],
    sourceTaskIds: [task.id]
  });
  memoryStore.scheduler.lastDistilledAt = nowTs();
  await saveMemoryStore(memoryStore);
  await appendSystemEvent("task_memory_distilled", {
    taskId: task.id,
    status: task.status,
    memoryIds: [executionMemory.id, efficiencyMemory.id],
    strategyIds: [strategyEntry.id],
    upstreamMemoryIds
  });
  return {
    status: buildMemoryStatus(memoryStore),
    memoryIds: [executionMemory.id, efficiencyMemory.id],
    strategyIds: [strategyEntry.id]
  };
}

function extractXmlTagValue(block, tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = String(block || "").match(pattern);
    if (match?.[1]) return stripHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  }
  return "";
}

function extractXmlLink(block) {
  const hrefMatch = String(block || "").match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();
  const tagLink = extractXmlTagValue(block, ["link", "id"]);
  return normalizeString(tagLink);
}

function parseFeedEntries(xmlText) {
  const xml = String(xmlText || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((block) => ({
    title: extractXmlTagValue(block, ["title"]),
    summary: extractXmlTagValue(block, ["description", "summary", "content:encoded", "content"]),
    url: extractXmlLink(block),
    publishedAt: parseOptionalTimestamp(extractXmlTagValue(block, ["pubDate", "published", "updated"]))
  })).filter((entry) => entry.title && entry.url);
}

async function fetchTextWithTimeout(url, timeoutMs = 20000) {
  if (typeof fetch !== "function") throw new Error("Global fetch is unavailable.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "openclaw-codex-control/1.0 (+https://chatgpt.com)"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function scoreIntelCandidate(domain, source, sourceStats, item, existingItems) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const keywordHits = domain.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
  const sameHash = existingItems.find((entry) => entry.contentHash === item.contentHash);
  const credibilityBase = Math.round((source.priority || 0.5) * 100);
  const credibilityScore = clampPercent(averageNumber([credibilityBase, sourceStats?.avgScore || 0]) || credibilityBase);
  const importanceBoost = /launch|release|funding|raising|security|policy|benchmark|earnings|acquisition|agent|model|chip|gpu|open source|deploy|pricing|attack|breach|partnership/i.test(text)
    ? 28
    : 0;
  const importanceScore = clampPercent(38 + keywordHits * 14 + importanceBoost + scoreRecency(item.publishedAt, 24 * 5) * 0.18);
  const noveltyScore = clampPercent(sameHash ? 8 : 52 + scoreRecency(item.publishedAt, 24 * 7) * 0.28 + Math.max(0, 18 - keywordHits * 2));
  const relevanceScore = clampPercent(25 + keywordHits * 18 + intersectionSize(item.tags, domain.keywords) * 10);
  const overallScore = clampPercent(
    credibilityScore * 0.24 +
    importanceScore * 0.31 +
    noveltyScore * 0.2 +
    relevanceScore * 0.25
  );
  const actionability = overallScore >= 82
    ? "建议重点关注"
    : overallScore >= 70
      ? "建议关注"
      : noveltyScore >= 82
        ? "建议观察"
        : "建议忽略";
  const judgement = `${domain.label}情报判断：${actionability}；可信度 ${credibilityScore} / 新颖度 ${noveltyScore} / 重要性 ${importanceScore}。`;
  return {
    ...item,
    credibilityScore,
    importanceScore,
    noveltyScore,
    relevanceScore,
    overallScore,
    actionability,
    judgement,
    explorationCandidate: noveltyScore >= 76
  };
}

function buildIntelTopicFingerprint(domain, item) {
  const tags = normalizeKeywordTags(
    item?.tags?.length
      ? item.tags
      : extractKeywordTags(
        `${item?.title || ""} ${item?.summary || ""} ${item?.judgement || ""}`,
        [domain.id, domain.label, ...domain.keywords]
      )
  );
  const filtered = tags
    .filter((tag) => tag && !domain.sources.some((source) => source.id === tag))
    .slice(0, 6)
    .sort();
  const fallback = slugify(`${item?.title || ""} ${item?.summary || ""}`)
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .join("|");
  return hashText(`${domain.id}|${filtered.join("|") || fallback || normalizeString(item?.sourceId)}`, 16);
}

function buildRecentDigestSignals(store, domain) {
  const sourceCounts = new Map();
  const topicCounts = new Map();
  const now = nowTs();
  const lookbackMs = store.config.recentDigestTopicWindowDays * 24 * 60 * 60 * 1000;
  const recentDigests = store.digests
    .filter((entry) => (
      entry.domain === domain.id &&
      entry.status === "sent" &&
      now - Number(entry.createdAt || 0) <= lookbackMs
    ))
    .slice(0, 12);
  for (const digest of recentDigests) {
    for (const item of digest.items || []) {
      if (item.sourceId) sourceCounts.set(item.sourceId, (sourceCounts.get(item.sourceId) || 0) + 1);
      const topicFingerprint = buildIntelTopicFingerprint(domain, item);
      topicCounts.set(topicFingerprint, (topicCounts.get(topicFingerprint) || 0) + 1);
    }
  }
  return {
    sourceCounts,
    topicCounts
  };
}

function buildDigestSourceTrustSignals(memoryStore, domain) {
  const scores = new Map();
  for (const memory of memoryStore.memories || []) {
    if (!memory || memory.invalidatedBy?.length) continue;
    if (memory.scope !== domain.id) continue;
    if (!memory.tags?.includes("source-trust")) continue;
    const sourceId = domain.sources.find((entry) => memory.tags?.includes(entry.id) || memory.summary.includes(entry.id))?.id;
    if (!sourceId) continue;
    const weightedScore = ((memory.confidence || 0) - (memory.decayScore || 0) * 0.45) / 6 - (memory.avoidWhen ? 4 : 0);
    scores.set(sourceId, (scores.get(sourceId) || 0) + weightedScore);
  }
  return scores;
}

function buildDigestIntelUsefulnessSignals(memoryStore, domainId) {
  const scores = new Map();
  for (const memory of memoryStore.memories || []) {
    if (!memory || memory.invalidatedBy?.length || !Array.isArray(memory.sourceIntelIds) || !memory.sourceIntelIds.length) continue;
    const typeWeight = memory.memoryType === "efficiency"
      ? 16
      : memory.memoryType === "execution"
        ? 14
        : memory.memoryType === "knowledge"
          ? 8
          : 6;
    const confidenceWeight = Math.max(0.15, (Number(memory.confidence || 0) - Number(memory.decayScore || 0) * 0.35) / 100);
    const scopeWeight = memory.scope === domainId ? 1.15 : 1;
    const totalWeight = typeWeight * confidenceWeight * scopeWeight;
    for (const intelId of memory.sourceIntelIds) {
      if (!intelId) continue;
      scores.set(intelId, (scores.get(intelId) || 0) + totalWeight);
    }
  }
  return scores;
}

function buildDigestRankingContext(store, domain, memoryStore) {
  const recentSignals = buildRecentDigestSignals(store, domain);
  return {
    sourceTrustScores: buildDigestSourceTrustSignals(memoryStore, domain),
    intelUsefulnessScores: buildDigestIntelUsefulnessSignals(memoryStore, domain.id),
    recentSourceCounts: recentSignals.sourceCounts,
    recentTopicCounts: recentSignals.topicCounts
  };
}

function scoreDigestCandidateForSelection(domain, item, rankingContext) {
  const topicFingerprint = buildIntelTopicFingerprint(domain, item);
  const sourceRecencyCount = rankingContext.recentSourceCounts.get(item.sourceId) || 0;
  const recentTopicCount = rankingContext.recentTopicCounts.get(topicFingerprint) || 0;
  const sourceTrustBoost = Math.max(-16, Math.min(16, Number(rankingContext.sourceTrustScores.get(item.sourceId) || 0)));
  const usefulnessBoost = Math.max(-6, Math.min(18, Number(rankingContext.intelUsefulnessScores.get(item.id) || 0)));
  const sourceDiversityBoost = Math.max(0, 9 - sourceRecencyCount * 3);
  const recentTopicPenalty = recentTopicCount * 10;
  const digestScore = (
    Number(item.overallScore || 0) +
    sourceTrustBoost +
    usefulnessBoost +
    sourceDiversityBoost -
    recentTopicPenalty
  );
  const explorationScore = (
    Number(item.noveltyScore || 0) * 0.55 +
    digestScore * 0.25 +
    sourceDiversityBoost * 1.8 -
    recentTopicCount * 4
  );
  const reasons = [
    `base:${Math.round(Number(item.overallScore || 0))}`,
    sourceTrustBoost ? `source:${sourceTrustBoost > 0 ? "+" : ""}${Math.round(sourceTrustBoost)}` : "",
    usefulnessBoost ? `memory:${usefulnessBoost > 0 ? "+" : ""}${Math.round(usefulnessBoost)}` : "",
    sourceDiversityBoost ? `diversity:+${Math.round(sourceDiversityBoost)}` : "",
    recentTopicPenalty ? `topic:-${Math.round(recentTopicPenalty)}` : ""
  ].filter(Boolean);
  return {
    topicFingerprint,
    digestScore,
    explorationScore,
    reasons
  };
}

function greedilyPickDigestEntries(entries, limit, sourceCap, alreadySelected = [], options = {}) {
  const preferFreshTopics = Boolean(options.preferFreshTopics);
  const selected = [];
  const selectedIds = new Set(alreadySelected.map((entry) => entry.id));
  const sourceCounts = new Map();
  const topicCounts = new Map();
  for (const entry of alreadySelected) {
    sourceCounts.set(entry.sourceId, (sourceCounts.get(entry.sourceId) || 0) + 1);
    if (entry.topicFingerprint) topicCounts.set(entry.topicFingerprint, (topicCounts.get(entry.topicFingerprint) || 0) + 1);
  }
  const capLevels = [sourceCap, sourceCap + 1, Number.MAX_SAFE_INTEGER];
  for (const cap of capLevels) {
    for (const entry of entries) {
      if (selected.length >= limit) break;
      if (!entry || selectedIds.has(entry.id)) continue;
      const sourceCount = sourceCounts.get(entry.sourceId) || 0;
      const topicCount = topicCounts.get(entry.topicFingerprint) || 0;
      if (sourceCount >= cap) continue;
      if (preferFreshTopics && cap === sourceCap && topicCount >= 1) continue;
      selected.push(entry);
      selectedIds.add(entry.id);
      sourceCounts.set(entry.sourceId, sourceCount + 1);
      if (entry.topicFingerprint) topicCounts.set(entry.topicFingerprint, topicCount + 1);
    }
    if (selected.length >= limit) break;
  }
  return selected.slice(0, limit);
}

async function refreshIntelDomain(domainId, options = {}) {
  const force = Boolean(options.force);
  const store = await loadIntelStore();
  if (!store.config.enabled) return buildIntelStatus(store);
  const domain = store.domains.find((entry) => entry.id === domainId);
  if (!domain) throw new Error(`Unknown intel domain: ${domainId}`);
  if (!force && domain.lastFetchedAt && nowTs() - domain.lastFetchedAt < store.config.refreshMinutes * 60 * 1000) {
    return buildIntelStatus(store);
  }
  intelRuntime.activeDomainId = domainId;
  try {
    const existingItems = store.items.filter((entry) => entry.domain === domainId);
    const collected = [];
    for (const source of domain.sources) {
      try {
        const xml = await fetchTextWithTimeout(source.url);
        const parsedItems = parseFeedEntries(xml).slice(0, store.config.candidateLimitPerDomain * 2);
        const scoredItems = parsedItems.map((entry) => {
          const rawText = `${entry.title}\n${entry.summary}`.trim();
          const contentHash = hashText(`${entry.title}|${entry.url}|${entry.summary}`, 16);
          return scoreIntelCandidate(
            domain,
            source,
            domain.sourceStats[source.id] || null,
            normalizeIntelItem({
              id: `intel_${contentHash}`,
              domain: domainId,
              title: entry.title,
              summary: truncateText(entry.summary || entry.title, 320),
              url: entry.url,
              sourceId: source.id,
              sourceUrl: source.url,
              publishedAt: entry.publishedAt,
              fetchedAt: nowTs(),
              contentHash,
              rawText,
              tags: extractKeywordTags(rawText, [...domain.keywords, domain.label])
            }),
            existingItems
          );
        });
        collected.push(...scoredItems);
        const sourceItems = scoredItems.slice(0, 20);
        const avgScore = clampPercent(averageNumber(sourceItems.map((entry) => entry.overallScore)));
        domain.sourceStats[source.id] = {
          successCount: clampInt((domain.sourceStats[source.id]?.successCount || 0) + 1, 0, 0, 100000),
          failureCount: clampInt(domain.sourceStats[source.id]?.failureCount || 0, 0, 0, 100000),
          lastSeenAt: nowTs(),
          lastFailureAt: domain.sourceStats[source.id]?.lastFailureAt || null,
          avgScore
        };
      } catch (error) {
        domain.sourceStats[source.id] = {
          successCount: clampInt(domain.sourceStats[source.id]?.successCount || 0, 0, 0, 100000),
          failureCount: clampInt((domain.sourceStats[source.id]?.failureCount || 0) + 1, 0, 0, 100000),
          lastSeenAt: domain.sourceStats[source.id]?.lastSeenAt || null,
          lastFailureAt: nowTs(),
          avgScore: clampPercent(domain.sourceStats[source.id]?.avgScore || 0)
        };
        await appendSystemEvent("intel_source_failed", {
          domainId,
          sourceId: source.id,
          error: String(error?.message || error)
        });
      }
    }
    const deduped = new Map();
    for (const item of [...collected, ...existingItems]) {
      const current = deduped.get(item.contentHash);
      if (!current || (item.overallScore || 0) > (current.overallScore || 0)) deduped.set(item.contentHash, item);
    }
    const mergedItems = [...deduped.values()]
      .sort((left, right) => (right.overallScore || 0) - (left.overallScore || 0))
      .slice(0, INTEL_ITEM_RETENTION);
    store.items = [
      ...store.items.filter((entry) => entry.domain !== domainId),
      ...mergedItems
    ].sort((left, right) => (right.fetchedAt || 0) - (left.fetchedAt || 0)).slice(0, INTEL_ITEM_RETENTION);
    domain.lastFetchedAt = nowTs();
    store.scheduler.lastTickAt = nowTs();
    await appendSystemEvent("intel_ingested", {
      domainId,
      candidateCount: mergedItems.length,
      topItemIds: mergedItems.slice(0, 5).map((entry) => entry.id)
    });
    await saveIntelStore(store);
    return buildIntelStatus(store);
  } finally {
    intelRuntime.activeDomainId = null;
    intelRuntime.lastTickAt = nowTs();
  }
}

function selectDigestItemsForDomain(store, domain, memoryStore) {
  const candidateLimit = store.config.candidateLimitPerDomain;
  const digestLimit = store.config.digestItemLimitPerDomain;
  const exploitLimit = Math.min(store.config.exploitItemsPerDigest, digestLimit);
  const exploreLimit = Math.min(store.config.exploreItemsPerDigest, Math.max(0, digestLimit - exploitLimit));
  const candidates = store.items
    .filter((entry) => entry.domain === domain.id)
    .sort((left, right) => (right.overallScore || 0) - (left.overallScore || 0))
    .slice(0, candidateLimit);
  const rankingContext = buildDigestRankingContext(store, domain, memoryStore);
  const rankedCandidates = candidates
    .map((entry) => {
      const ranking = scoreDigestCandidateForSelection(domain, entry, rankingContext);
      return {
        ...entry,
        topicFingerprint: ranking.topicFingerprint,
        digestRankScore: ranking.digestScore,
        explorationRankScore: ranking.explorationScore,
        selectionReasons: ranking.reasons
      };
    })
    .sort((left, right) => {
      if ((right.digestRankScore || 0) !== (left.digestRankScore || 0)) {
        return (right.digestRankScore || 0) - (left.digestRankScore || 0);
      }
      return (right.overallScore || 0) - (left.overallScore || 0);
    });
  const exploitItems = greedilyPickDigestEntries(
    rankedCandidates,
    exploitLimit,
    store.config.maxItemsPerSourceInDigest
  );
  const explorationPool = rankedCandidates
    .filter((entry) => !exploitItems.some((item) => item.id === entry.id))
    .sort((left, right) => {
      if ((right.explorationRankScore || 0) !== (left.explorationRankScore || 0)) {
        return (right.explorationRankScore || 0) - (left.explorationRankScore || 0);
      }
      return (right.noveltyScore || 0) - (left.noveltyScore || 0);
    });
  const exploreItems = greedilyPickDigestEntries(
    explorationPool,
    exploreLimit,
    store.config.maxItemsPerSourceInDigest,
    exploitItems,
    { preferFreshTopics: true }
  );
  const selected = [...exploitItems, ...exploreItems];
  if (selected.length < digestLimit) {
    selected.push(...greedilyPickDigestEntries(
      rankedCandidates,
      digestLimit - selected.length,
      store.config.maxItemsPerSourceInDigest,
      selected
    ));
  }
  const finalSelected = selected.slice(0, digestLimit);
  for (const entry of candidates) {
    entry.selectedForDigest = finalSelected.some((item) => item.id === entry.id);
  }
  for (const entry of finalSelected) {
    entry.explorationCandidate = exploreItems.some((item) => item.id === entry.id);
  }
  return {
    selected: finalSelected,
    rankingSummary: finalSelected.map((entry, index) => ({
      itemId: entry.id,
      rank: index + 1,
      sourceId: entry.sourceId,
      digestRankScore: Math.round(Number(entry.digestRankScore || entry.overallScore || 0)),
      exploration: Boolean(entry.explorationCandidate),
      reasons: entry.selectionReasons || []
    }))
  };
}

function buildDigestJudgement(item) {
  const whyImportant = item.importanceScore >= 80
    ? "重要性高，可能改变该领域的判断或优先级。"
    : item.noveltyScore >= 80
      ? "新颖度高，适合当作探索信号。"
      : "相关性和可信度较高，值得纳入今日认知更新。";
  return {
    title: item.title,
    summary: truncateText(item.summary || item.title, 120),
    judgement: truncateText(item.judgement || `${item.actionability || "建议关注"}。`, 120),
    whyImportant,
    actionability: normalizeString(item.actionability, "建议关注"),
    url: item.url
  };
}

function formatDigestMessage(domain, digest) {
  const header = `${domain.label} 情报日报 (${digest.digestDate})`;
  const body = digest.items.map((item) => (
    `${item.rank}. ${item.title}\n结论：${item.summary}\n判断：${item.judgement}\n原因：${item.whyImportant}${item.url ? `\n链接：${item.url}` : ""}`
  )).join("\n\n");
  return `${header}\n\n${body}`.trim();
}

function extractTaggedJson(rawText, tagName) {
  const text = String(rawText || "");
  const match = text.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i"));
  if (match?.[1]) return safeParseJson(match[1], null);
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) return safeParseJson(arrayMatch[0], null);
  return null;
}

async function maybeRefineDigestItemsWithLlm(config, domain, items) {
  if (!config.llmJudgeEnabled || !items.length) return items;
  const input = items.map((item) => ({
    itemId: item.itemId,
    title: item.title,
    summary: item.summary,
    overallScore: item.overallScore,
    exploration: item.exploration,
    url: item.url
  }));
  const prompt = [
    `你是墨水个人超级智能 AI 的 research 专工，现在要把 ${domain.label} 日报的候选条目压缩成高信息密度的中文结论。`,
    "要求：",
    "1. 保持极简，但要比原始摘要更像真正的情报判断。",
    "2. 不要胡编，不知道就保守。",
    "3. 每条只返回 itemId、summary、judgement、whyImportant、actionability。",
    "4. actionability 只能是：建议重点关注 / 建议关注 / 建议观察 / 建议忽略。",
    "5. 用 <DIGEST_REVIEW> 包住 JSON 数组。",
    "",
    JSON.stringify(input, null, 2)
  ].join("\n");
  const cliResult = await runOpenClawCli([
    "agent",
    "--agent",
    config.llmAgent || "research",
    "--session-id",
    `intel-digest-${domain.id}-${buildLocalDateKey()}`,
    "--thinking",
    "low",
    "--verbose",
    "off",
    "--message",
    prompt,
    "--json"
  ], { timeoutMs: 10 * 60 * 1000 });
  if (!cliResult.ok) return items;
  const parsed = extractTaggedJson([cliResult.stdout, cliResult.stderr].filter(Boolean).join("\n"), "DIGEST_REVIEW");
  if (!Array.isArray(parsed)) return items;
  const byId = new Map(parsed
    .filter((entry) => isRecord(entry) && normalizeString(entry.itemId))
    .map((entry) => [normalizeString(entry.itemId), entry]));
  return items.map((item) => {
    const refined = byId.get(item.itemId);
    if (!refined) return item;
    return normalizeDigestItem({
      ...item,
      summary: normalizeString(refined.summary) || item.summary,
      judgement: normalizeString(refined.judgement) || item.judgement,
      whyImportant: normalizeString(refined.whyImportant || refined.why) || item.whyImportant,
      actionability: normalizeString(refined.actionability) || item.actionability
    });
  });
}

function buildIntelDigestKnowledgeSummary(domain, enrichedItems) {
  const selected = enrichedItems.slice(0, 3);
  if (!selected.length) return `${domain.label} 暂无足够高价值情报。`;
  return selected
    .map((item) => `${item.title}：${truncateText(item.summary || item.judgement || item.title, 42)}`)
    .join("；");
}

function buildIntelSourceMemorySummary(domain, sourceId, stats, items) {
  const avgOverallScore = Math.round(averageNumber(items.map((item) => item.overallScore)));
  const explorationCount = items.filter((item) => item.exploration).length;
  const topTitles = items.slice(0, 2).map((item) => item.title).join("；");
  return `${domain.label} 来源 ${sourceId} 的近期有效性：平均信号 ${avgOverallScore}，成功 ${stats?.successCount || 0} / 失败 ${stats?.failureCount || 0}，探索信号 ${explorationCount} 条。${topTitles ? `近期代表项：${topTitles}。` : ""}`.trim();
}

async function distillIntelDigestToMemory(domain, digest, sourceEvent) {
  const [memoryStore, intelStore] = await Promise.all([
    loadMemoryStore(),
    loadIntelStore()
  ]);
  const intelById = new Map(intelStore.items.map((item) => [item.id, item]));
  const enrichedItems = digest.items
    .map((item) => {
      const full = intelById.get(item.itemId);
      return {
        ...item,
        noveltyScore: clampPercent(full?.noveltyScore),
        credibilityScore: clampPercent(full?.credibilityScore),
        importanceScore: clampPercent(full?.importanceScore),
        sourceId: normalizeString(item.sourceId || full?.sourceId),
        exploration: Boolean(item.exploration),
        tags: normalizeKeywordTags(full?.tags || extractKeywordTags(`${item.title} ${item.summary} ${item.judgement}`, [domain.id, domain.label]))
      };
    })
    .sort((left, right) => (right.overallScore || 0) - (left.overallScore || 0));
  const memoryIds = [];
  const domainDigestMemory = upsertMemoryEntry(memoryStore, {
    id: `mem_${hashText(`intel-digest-domain|${domain.id}`, 16)}`,
    memoryType: "knowledge",
    scope: domain.id,
    route: "research",
    summary: `${domain.label} 最新高价值认知摘要：${buildIntelDigestKnowledgeSummary(domain, enrichedItems)}`,
    appliesWhen: `${domain.label} 相关任务规划、研究判断、背景补充`,
    avoidWhen: "",
    tags: extractKeywordTags(buildIntelDigestKnowledgeSummary(domain, enrichedItems), [domain.id, domain.label, "intel-digest", "knowledge"]),
    confidence: clampPercent(Math.round(averageNumber(enrichedItems.slice(0, 4).map((item) => item.overallScore)))),
    sourceEventIds: [sourceEvent.eventId],
    sourceIntelIds: enrichedItems.slice(0, 6).map((item) => item.itemId),
    lastReinforcedAt: nowTs(),
    decayScore: 14
  });
  memoryIds.push(domainDigestMemory.id);
  const selected = enrichedItems
    .filter((item) => item.overallScore >= 75 || item.rank <= 3 || item.exploration)
    .slice(0, 6);
  for (const item of selected) {
    const memory = upsertMemoryEntry(memoryStore, {
      id: buildMemorySignature("knowledge", domain.id, [domain.id, domain.label], `${item.title}|${item.summary}`),
      memoryType: "knowledge",
      scope: domain.id,
      route: "research",
      summary: `${domain.label} 领域近期高价值认知：${item.title}。${item.summary}${item.judgement ? ` ${item.judgement}` : ""}`,
      appliesWhen: `${domain.label} / ${item.actionability || "建议关注"}`,
      avoidWhen: item.actionability === "建议忽略" ? "不需要主动升级成任务，除非命中既有目标。" : "",
      tags: extractKeywordTags(`${item.title} ${item.summary} ${item.judgement}`, [domain.id, domain.label, item.sourceId, item.exploration ? "explore" : "exploit"]),
      confidence: clampPercent(Math.round(averageNumber([item.overallScore, item.credibilityScore || item.overallScore]))),
      sourceEventIds: [sourceEvent.eventId],
      sourceIntelIds: [item.itemId],
      lastReinforcedAt: nowTs(),
      decayScore: item.exploration ? 22 : 16
    });
    memoryIds.push(memory.id);
  }
  const sourceGroups = new Map();
  for (const item of enrichedItems) {
    if (!item.sourceId) continue;
    if (!sourceGroups.has(item.sourceId)) sourceGroups.set(item.sourceId, []);
    sourceGroups.get(item.sourceId).push(item);
  }
  for (const [sourceId, items] of sourceGroups.entries()) {
    const stats = domain.sourceStats?.[sourceId] || {};
    const sourceMemory = upsertMemoryEntry(memoryStore, {
      id: `mem_${hashText(`intel-source|${domain.id}|${sourceId}`, 16)}`,
      memoryType: "knowledge",
      scope: domain.id,
      route: "research",
      summary: buildIntelSourceMemorySummary(domain, sourceId, stats, items),
      appliesWhen: `${domain.label} 情报筛选 / 来源调权 / 每日摘要排序`,
      avoidWhen: Number(stats.failureCount || 0) > Number(stats.successCount || 0) ? `该来源近期失败偏多，避免过度依赖。` : "",
      tags: extractKeywordTags(buildIntelSourceMemorySummary(domain, sourceId, stats, items), [domain.id, domain.label, sourceId, "source-trust"]),
      confidence: clampPercent(Math.round(averageNumber([
        Number(stats.avgScore || 0),
        averageNumber(items.map((item) => item.credibilityScore || item.overallScore))
      ]))),
      sourceEventIds: [sourceEvent.eventId],
      sourceIntelIds: items.slice(0, 8).map((item) => item.itemId),
      lastReinforcedAt: nowTs(),
      decayScore: Number(stats.failureCount || 0) > Number(stats.successCount || 0) ? 30 : 18
    });
    memoryIds.push(sourceMemory.id);
  }
  memoryStore.scheduler.lastDistilledAt = nowTs();
  await saveMemoryStore(memoryStore);
  await appendSystemEvent("intel_memory_distilled", {
    domainId: domain.id,
    digestId: digest.id,
    memoryIds
  });
  return memoryIds;
}

async function runIntelDigest(domainId, options = {}) {
  const [store, memoryStore] = await Promise.all([
    loadIntelStore(),
    loadMemoryStore()
  ]);
  if (!store.config.enabled || !store.config.digestEnabled) return buildIntelStatus(store);
  const domain = store.domains.find((entry) => entry.id === domainId);
  if (!domain) throw new Error(`Unknown intel domain: ${domainId}`);
  const force = Boolean(options.force);
  const todayKey = buildLocalDateKey();
  const latestSentDigest = store.digests.find((entry) => entry.domain === domainId && entry.status === "sent");
  if (!force && latestSentDigest?.digestDate === todayKey) return buildIntelStatus(store);
  const { selected, rankingSummary } = selectDigestItemsForDomain(store, domain, memoryStore);
  if (selected.length === 0) return buildIntelStatus(store);
  const digestId = `digest_${hashText(`${domainId}|${todayKey}|${selected.map((entry) => entry.id).join("|")}`, 16)}`;
  const buildDigestItems = () => selected.slice(0, store.config.digestItemLimitPerDomain).map((item, index) => {
    const judgement = buildDigestJudgement(item);
    return {
      itemId: item.id,
      rank: index + 1,
      title: judgement.title,
      summary: judgement.summary,
      judgement: judgement.judgement,
      whyImportant: judgement.whyImportant,
      actionability: judgement.actionability,
      url: judgement.url,
      sourceId: item.sourceId,
      overallScore: item.overallScore,
      exploration: Boolean(item.explorationCandidate)
    };
  });
  const persistDigestAttempt = async (status, eventType, reasonText, delivery) => {
    const event = await appendSystemEvent(eventType, {
      domainId,
      digestId,
      reason: normalizeString(reasonText),
      delivery,
      itemIds: selected.slice(0, store.config.digestItemLimitPerDomain).map((entry) => entry.id)
    });
    const digest = normalizeIntelDigest({
      id: digestId,
      domain: domainId,
      digestDate: todayKey,
      createdAt: nowTs(),
      delivery,
      status,
      items: buildDigestItems(),
      sourceEventIds: [event.eventId]
    });
    domain.lastDigestAttemptAt = nowTs();
    domain.lastDigestError = normalizeString(reasonText);
    domain.lastDigestId = digest.id;
    store.scheduler.lastDigestSweepAt = nowTs();
    store.digests = [digest, ...store.digests.filter((entry) => entry.id !== digest.id)]
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      .slice(0, INTEL_DIGEST_RETENTION);
    await saveIntelStore(store);
    return buildIntelStatus(store);
  };
  const delivery = normalizeDeliveryCandidate(options.delivery) || await resolvePreferredDigestDelivery();
  if (!delivery) return persistDigestAttempt("no_delivery", "digest_delivery_unavailable", "delivery_unavailable", null);
  intelRuntime.activeDigestDomainId = domainId;
  try {
    const digest = normalizeIntelDigest({
      id: digestId,
      domain: domainId,
      digestDate: todayKey,
      createdAt: nowTs(),
      delivery,
      status: "draft",
      items: buildDigestItems()
    });
    const rankingEvent = await appendSystemEvent("digest_ranked", {
      domainId,
      digestId: digest.id,
      itemIds: digest.items.map((entry) => entry.itemId),
      rankingSummary
    });
    const beforeRefineSignature = JSON.stringify(digest.items.map((item) => ({
      itemId: item.itemId,
      summary: item.summary,
      judgement: item.judgement,
      whyImportant: item.whyImportant,
      actionability: item.actionability
    })));
    digest.items = await maybeRefineDigestItemsWithLlm(store.config, domain, digest.items);
    const afterRefineSignature = JSON.stringify(digest.items.map((item) => ({
      itemId: item.itemId,
      summary: item.summary,
      judgement: item.judgement,
      whyImportant: item.whyImportant,
      actionability: item.actionability
    })));
    let refineEventId = null;
    if (beforeRefineSignature !== afterRefineSignature) {
      const refineEvent = await appendSystemEvent("digest_refined_with_llm", {
        domainId,
        digestId: digest.id,
        itemIds: digest.items.map((entry) => entry.itemId)
      });
      refineEventId = refineEvent.eventId;
    }
    const message = formatDigestMessage(domain, digest);
    const deliveryResult = await notifyTaskTarget({
      id: digest.id,
      title: `${domain.label} 情报日报`,
      delivery
    }, "proactive", message);
    if (!deliveryResult.ok) {
      return persistDigestAttempt("failed", "digest_failed", deliveryResult.error || "digest_delivery_failed", delivery);
    }
    digest.status = "sent";
    selected.forEach((item) => {
      item.deliveredAt = nowTs();
      item.selectedForDigest = true;
      item.digestId = digest.id;
    });
    domain.lastDigestAttemptAt = nowTs();
    domain.lastDigestAt = nowTs();
    domain.lastDigestId = digest.id;
    domain.lastDigestError = "";
    domain.nextDigestDate = buildRelativeLocalDateKey(1);
    store.scheduler.lastDigestSweepAt = nowTs();
    const event = await appendSystemEvent("digest_sent", {
      domainId,
      digestId: digest.id,
      delivery,
      itemIds: digest.items.map((entry) => entry.itemId),
      refineEventId,
      rankingEventId: rankingEvent.eventId
    });
    digest.sourceEventIds = mergeUniqueStrings(
      digest.sourceEventIds,
      [rankingEvent.eventId],
      refineEventId ? [refineEventId] : [],
      [event.eventId]
    ).slice(0, 24);
    store.digests = [digest, ...store.digests.filter((entry) => entry.id !== digest.id)]
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      .slice(0, INTEL_DIGEST_RETENTION);
    await saveIntelStore(store);
    await distillIntelDigestToMemory(domain, digest, event);
    return buildIntelStatus(store);
  } finally {
    intelRuntime.activeDigestDomainId = null;
    intelRuntime.lastTickAt = nowTs();
  }
}

async function runIntelMaintenance(options = {}) {
  const store = await loadIntelStore();
  if (!store.config.enabled) return buildIntelStatus(store);
  const domainIds = normalizeString(options.domainId)
    ? [normalizeString(options.domainId)]
    : store.domains.map((entry) => entry.id);
  for (const domainId of domainIds) {
    await refreshIntelDomain(domainId, { force: Boolean(options.forceRefresh) });
  }
  const refreshed = await loadIntelStore();
  if (!refreshed.config.digestEnabled) return buildIntelStatus(refreshed);
  const currentHour = new Date().getHours();
  const todayKey = buildLocalDateKey();
  let schedulerAdjusted = false;
  for (const domain of refreshed.domains) {
    if (!domain.nextDigestDate) {
      domain.nextDigestDate = computeInitialDigestDateKey(refreshed.config.digestHourLocal);
      schedulerAdjusted = true;
    }
  }
  if (schedulerAdjusted) await saveIntelStore(refreshed);
  const digestStore = schedulerAdjusted ? await loadIntelStore() : refreshed;
  for (const domain of digestStore.domains) {
    const latestSentDigest = digestStore.digests.find((entry) => entry.domain === domain.id && entry.status === "sent");
    if (!Boolean(options.forceDigest) && latestSentDigest?.digestDate === todayKey) {
      const tomorrowKey = buildRelativeLocalDateKey(1);
      if (domain.nextDigestDate !== tomorrowKey) {
        domain.nextDigestDate = tomorrowKey;
        await saveIntelStore(digestStore);
      }
      continue;
    }
    const backoffActive = Boolean(
      !options.forceDigest &&
      domain.lastDigestAttemptAt &&
      nowTs() - domain.lastDigestAttemptAt < INTEL_DIGEST_RETRY_BACKOFF_MS
    );
    const dueDigest = Boolean(options.forceDigest) || (
      currentHour >= digestStore.config.digestHourLocal &&
      (!domain.nextDigestDate || domain.nextDigestDate <= todayKey) &&
      !backoffActive
    );
    if (dueDigest) {
      await runIntelDigest(domain.id, {
        force: Boolean(options.forceDigest)
      });
    }
  }
  return buildIntelStatus(await loadIntelStore());
}

function upsertEvolutionCandidate(store, candidate) {
  const normalized = normalizeEvolutionCandidate(candidate);
  const index = store.candidates.findIndex((entry) => entry.id === normalized.id);
  if (index < 0) {
    const nextSignal = buildEvolutionCandidateSignal(normalized);
    const seeded = normalizeEvolutionCandidate({
      ...normalized,
      measuredEffect: mergeEvolutionMeasuredEffect({}, normalized.measuredEffect),
      shadowMetrics: {
        ...(normalized.shadowMetrics || {}),
        observationCount: clampInt(normalized.shadowMetrics?.observationCount, 1, 1, 100000),
        consistentSignalCount: nextSignal ? clampInt(normalized.shadowMetrics?.consistentSignalCount, 1, 1, 100000) : clampInt(normalized.shadowMetrics?.consistentSignalCount, 0, 0, 100000),
        lastSignal: nextSignal || 0
      },
      lastShadowAt: nowTs()
    });
    store.candidates.unshift(seeded);
    return seeded;
  }
  const current = store.candidates[index];
  const previousObservationCount = clampInt(current.shadowMetrics?.observationCount, 0, 0, 100000);
  const previousConsistentCount = clampInt(current.shadowMetrics?.consistentSignalCount, 0, 0, 100000);
  const previousSignal = Math.sign(Number(current.shadowMetrics?.lastSignal || buildEvolutionCandidateSignal(current)));
  const nextSignal = buildEvolutionCandidateSignal({
    ...current,
    measuredEffect: mergeEvolutionMeasuredEffect(current.measuredEffect, normalized.measuredEffect)
  });
  const consistentSignalCount = nextSignal === 0
    ? previousConsistentCount
    : previousSignal === nextSignal
      ? previousConsistentCount + 1
      : 1;
  const merged = normalizeEvolutionCandidate({
    ...current,
    ...normalized,
    shadowMetrics: {
      ...mergeEvolutionShadowMetrics(current.shadowMetrics, normalized.shadowMetrics),
      observationCount: previousObservationCount + 1,
      consistentSignalCount,
      lastSignal: nextSignal || previousSignal || 0
    },
    expectedEffect: {
      ...current.expectedEffect,
      ...normalized.expectedEffect
    },
    measuredEffect: mergeEvolutionMeasuredEffect(current.measuredEffect, normalized.measuredEffect),
    sourceEventIds: mergeUniqueStrings(current.sourceEventIds, normalized.sourceEventIds).slice(0, 24),
    sourceTaskIds: mergeUniqueStrings(current.sourceTaskIds, normalized.sourceTaskIds).slice(0, 24),
    sourceIntelIds: mergeUniqueStrings(current.sourceIntelIds, normalized.sourceIntelIds).slice(0, 24),
    derivedFromMemoryIds: mergeUniqueStrings(current.derivedFromMemoryIds, normalized.derivedFromMemoryIds).slice(0, 24),
    invalidatedBy: mergeUniqueStrings(current.invalidatedBy, normalized.invalidatedBy).slice(0, 24),
    adoptionState: current.adoptionState === "adopted"
      ? "adopted"
      : current.adoptionState === "candidate" && normalized.adoptionState === "shadow"
        ? "candidate"
        : normalized.adoptionState || current.adoptionState || "shadow",
    lastShadowAt: nowTs(),
    updatedAt: nowTs()
  });
  store.candidates[index] = merged;
  return merged;
}

async function rollbackPrematureEvolutionAdoptions(store, intelStore) {
  let evolutionChanged = false;
  let intelChanged = false;
  const reverted = [];
  for (const candidate of store.candidates) {
    if (candidate.candidateType !== "intel_source_reweight" || candidate.adoptionState !== "adopted") continue;
    const observationCount = clampInt(candidate.shadowMetrics?.observationCount, 0, 0, 100000);
    if (observationCount >= EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS) continue;
    const [domainId, sourceId] = String(candidate.candidateRef || "").split(":");
    const domain = intelStore.domains.find((entry) => entry.id === domainId);
    const source = domain?.sources.find((entry) => entry.id === sourceId);
    const delta = Number(candidate.measuredEffect?.priorityDelta);
    if (domain && source && Number.isFinite(delta) && Math.abs(delta) >= 0.01) {
      source.priority = Math.max(0.1, Math.min(3, Number(source.priority || 0.5) - delta));
      intelChanged = true;
    }
    candidate.adoptionState = "shadow";
    candidate.updatedAt = nowTs();
    candidate.notes = truncateText(`${candidate.notes || ""} 已自动回退到影子模式，等待更多真实观测后再决定是否采纳。`, 220);
    candidate.shadowMetrics = {
      ...(candidate.shadowMetrics || {}),
      observationCount: Math.max(1, observationCount),
      consistentSignalCount: Math.max(1, clampInt(candidate.shadowMetrics?.consistentSignalCount, 0, 0, 100000))
    };
    reverted.push(candidate.id);
    evolutionChanged = true;
  }
  if (intelChanged) await saveIntelStore(intelStore);
  if (evolutionChanged) {
    await saveEvolutionStore(store);
    await appendSystemEvent("evolution_candidate_reverted_to_shadow", {
      candidateIds: reverted
    });
  }
  return evolutionChanged || intelChanged;
}

async function maybeAutoApplyLowRiskEvolution(store, intelStore) {
  if (!store.config.autoApplyLowRisk) return false;
  let evolutionChanged = false;
  let intelChanged = false;
  const promoted = [];
  const adopted = [];
  for (const candidate of store.candidates) {
    if (candidate.invalidatedBy?.length) continue;
    const observationCount = clampInt(candidate.shadowMetrics?.observationCount, 0, 0, 100000);
    const consistentSignalCount = clampInt(candidate.shadowMetrics?.consistentSignalCount, 0, 0, 100000);
    if (candidate.candidateType === "intel_source_reweight") {
      const [domainId, sourceId] = String(candidate.candidateRef || "").split(":");
      const domain = intelStore.domains.find((entry) => entry.id === domainId);
      const source = domain?.sources.find((entry) => entry.id === sourceId);
      if (!domain || !source) continue;
      const delta = Number(candidate.measuredEffect?.priorityDelta);
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) continue;
      if (
        candidate.adoptionState === "shadow" &&
        observationCount >= EVOLUTION_SHADOW_MIN_OBSERVATIONS &&
        consistentSignalCount >= EVOLUTION_SHADOW_MIN_OBSERVATIONS
      ) {
        candidate.adoptionState = "candidate";
        candidate.updatedAt = nowTs();
        promoted.push(candidate.id);
        evolutionChanged = true;
        continue;
      }
      if (candidate.adoptionState !== "candidate") continue;
      if (observationCount < EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS || consistentSignalCount < EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS) continue;
      source.priority = Math.max(0.1, Math.min(3, Number(source.priority || 0.5) + delta));
      candidate.adoptionState = "adopted";
      candidate.updatedAt = nowTs();
      adopted.push(candidate.id);
      evolutionChanged = true;
      intelChanged = true;
      continue;
    }
    if (!["route_default_lane", "route_skill_bundle"].includes(candidate.candidateType)) continue;
    const sampleCount = clampInt(candidate.measuredEffect?.sampleCount, observationCount, 0, 100000);
    const successCount = clampInt(candidate.measuredEffect?.successCount, 0, 0, 100000);
    const blockedCount = clampInt(candidate.measuredEffect?.blockedCount, 0, 0, 100000);
    const waitingUserCount = clampInt(candidate.measuredEffect?.waitingUserCount ?? candidate.measuredEffect?.waitingHumanCount, 0, 0, 100000);
    const avgCompletionScore = Number(candidate.measuredEffect?.avgCompletionScore || 0);
    const successRate = sampleCount > 0 ? successCount / sampleCount : 0;
    if (
      candidate.adoptionState === "shadow" &&
      observationCount >= EVOLUTION_SHADOW_MIN_OBSERVATIONS &&
      consistentSignalCount >= EVOLUTION_SHADOW_MIN_OBSERVATIONS &&
      successRate >= 0.5
    ) {
      candidate.adoptionState = "candidate";
      candidate.updatedAt = nowTs();
      promoted.push(candidate.id);
      evolutionChanged = true;
      continue;
    }
    if (candidate.adoptionState !== "candidate") continue;
    if (observationCount < EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS || consistentSignalCount < EVOLUTION_AUTO_ADOPT_MIN_OBSERVATIONS) continue;
    if (successRate < EVOLUTION_ROUTE_SUCCESS_RATE_MIN) continue;
    if (avgCompletionScore < EVOLUTION_ROUTE_COMPLETION_MIN) continue;
    if (blockedCount + waitingUserCount >= successCount) continue;
    candidate.adoptionState = "adopted";
    candidate.updatedAt = nowTs();
    adopted.push(candidate.id);
    evolutionChanged = true;
  }
  if (intelChanged) await saveIntelStore(intelStore);
  if (evolutionChanged) await saveEvolutionStore(store);
  if (promoted.length) {
    await appendSystemEvent("evolution_candidate_promoted", {
      candidateIds: promoted
    });
  }
  if (adopted.length) {
    await appendSystemEvent("evolution_candidate_adopted", {
      candidateIds: adopted
    });
  }
  return evolutionChanged || intelChanged;
}

async function runEvolutionReview(options = {}) {
  const store = await loadEvolutionStore();
  if (!store.config.enabled) return buildEvolutionStatus(store);
  const reviewIntervalMs = store.config.reviewIntervalHours * 60 * 60 * 1000;
  if (!Boolean(options.force) && store.scheduler.lastReviewAt && nowTs() - store.scheduler.lastReviewAt < reviewIntervalMs) {
    return buildEvolutionStatus(store);
  }
  evolutionRuntime.active = true;
  try {
    const [events, memoryStore, intelStore, autopilotStore] = await Promise.all([
      readRecentSystemEvents(EVENT_LOG_TAIL_LIMIT),
      loadMemoryStore(),
      loadIntelStore(),
      loadAutopilotStore()
    ]);
    const routeCounts = new Map();
    for (const task of autopilotStore.tasks) {
      const route = normalizeString(task.route || task.taskKind || "general", "general");
      const current = routeCounts.get(route) || { success: 0, blocked: 0, remoteCalls: [] };
      if (task.status === "completed") current.success += 1;
      if (task.status === "blocked" || task.status === "waiting_user") current.blocked += 1;
      current.remoteCalls.push(task.runState?.remoteCallCount || 0);
      routeCounts.set(route, current);
    }
    for (const [route, stats] of routeCounts.entries()) {
      const routeTaskIds = autopilotStore.tasks
        .filter((task) => normalizeString(task.route || task.taskKind || "general", "general") === route)
        .slice(0, 12)
        .map((task) => task.id);
      if (stats.blocked >= 2) {
        upsertEvolutionCandidate(store, {
          id: `evo_${hashText(`route-fallback|${route}`, 16)}`,
          targetLayer: "task",
          candidateType: "retry_policy_review",
          candidateRef: route,
          expectedEffect: {
            reduceBlocked: true
          },
          measuredEffect: {
            blockedCount: stats.blocked,
            successCount: stats.success,
            avgRemoteCalls: averageNumber(stats.remoteCalls)
          },
          shadowMetrics: {
            route,
            blockedCount: stats.blocked,
            successCount: stats.success
          },
          adoptionState: "shadow",
          notes: `${route} 路由近期阻塞偏多，建议在影子模式下评估新的 fallback 顺序。`,
          sourceEventIds: events.slice(0, 6).map((entry) => entry.eventId),
          sourceTaskIds: routeTaskIds
        });
      }
    }
    for (const domain of intelStore.domains) {
      for (const source of domain.sources) {
        const stats = domain.sourceStats[source.id];
        if (!stats) continue;
        if (stats.failureCount >= 3 || stats.avgScore <= 30 || stats.avgScore >= 82) {
          const delta = stats.avgScore >= 82 ? 0.05 : -0.05;
          const sourceIntelIds = intelStore.items
            .filter((entry) => entry.domain === domain.id && entry.sourceId === source.id)
            .slice(0, 12)
            .map((entry) => entry.id);
          upsertEvolutionCandidate(store, {
            id: `evo_${hashText(`intel-source|${domain.id}|${source.id}`, 16)}`,
            targetLayer: "intel",
            candidateType: "intel_source_reweight",
            candidateRef: `${domain.id}:${source.id}`,
            expectedEffect: {
              reduceNoise: delta < 0,
              increaseSignal: delta > 0
            },
            measuredEffect: {
              avgScore: stats.avgScore,
              failureCount: stats.failureCount,
              successCount: stats.successCount,
              priorityDelta: delta
            },
            shadowMetrics: {
              avgScore: stats.avgScore,
              failureCount: stats.failureCount,
              successCount: stats.successCount
            },
            adoptionState: "shadow",
            notes: `${domain.label}/${source.id} 来源表现已偏离基线，先在影子模式下评估调权。`
            ,
            sourceIntelIds
          });
        }
      }
    }
    const lowConfidenceStrategies = memoryStore.strategies.filter((entry) => entry.confidence <= 45).slice(0, 8);
    for (const strategy of lowConfidenceStrategies) {
      upsertEvolutionCandidate(store, {
        id: `evo_${hashText(`strategy-refresh|${strategy.id}`, 16)}`,
        targetLayer: "strategy",
        candidateType: "strategy_refresh",
        candidateRef: strategy.id,
        expectedEffect: {
          improveConfidence: true
        },
        measuredEffect: {
          confidence: strategy.confidence
        },
        shadowMetrics: {
          route: strategy.route,
          thinkingLane: strategy.thinkingLane
        },
        adoptionState: "shadow",
        notes: `策略 ${strategy.id} 置信度偏低，应在影子模式下重新评估是否继续保留。`,
        sourceEventIds: strategy.sourceEventIds,
        sourceTaskIds: strategy.sourceTaskIds,
        sourceIntelIds: strategy.sourceIntelIds,
        derivedFromMemoryIds: strategy.derivedFromMemoryIds
      });
    }
    store.scheduler.lastReviewAt = nowTs();
    await rollbackPrematureEvolutionAdoptions(store, intelStore);
    await maybeAutoApplyLowRiskEvolution(store, intelStore);
    const memoryChanged = await materializeAdoptedEvolutionStrategies(store, memoryStore);
    if (memoryChanged) {
      memoryStore.scheduler.lastDistilledAt = nowTs();
      await saveMemoryStore(memoryStore);
    }
    await saveEvolutionStore(store);
    await appendSystemEvent("evolution_reviewed", {
      candidateCount: store.candidates.length,
      lastReviewAt: store.scheduler.lastReviewAt
    });
    evolutionRuntime.lastReviewAt = store.scheduler.lastReviewAt;
    return buildEvolutionStatus(store);
  } finally {
    evolutionRuntime.active = false;
    evolutionRuntime.lastTickAt = nowTs();
  }
}

async function saveAutopilotStore(store) {
  const normalized = normalizeAutopilotStore(store);
  normalized.scheduler.lastPersistedAt = nowTs();
  await writeJsonAtomicSecure(AUTOPILOT_STORE_PATH, normalized);
  return normalized;
}

function buildAutopilotTaskView(task, config) {
  const ts = nowTs();
  const nextRunAt = Number(task.nextRunAt || 0) || null;
  const lastRunAt = Number(task.lastRunAt || 0) || null;
  const isDone = task.status === "completed" || task.status === "cancelled";
  const isRunnable = !isDone && task.status !== "waiting_user";
  const isDue = Boolean(isRunnable && nextRunAt && nextRunAt <= ts);
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    successCriteria: task.successCriteria || task.doneCriteria,
    doneCriteria: task.doneCriteria,
    planSummary: task.planSummary,
    nextAction: task.nextAction,
    blockedReason: task.blockedReason,
    lastResult: task.lastResult,
    notes: task.notes,
    source: task.source,
    assignee: task.assignee,
    workspace: task.workspace,
    route: task.route,
    taskKind: task.taskKind,
    reportPolicy: task.reportPolicy,
    skillHints: task.skillHints,
    tags: task.tags,
    memoryRefs: task.memoryRefs,
    intelRefs: task.intelRefs,
    optimizationState: task.optimizationState,
    intakeText: task.intakeText,
    sourceMeta: task.sourceMeta,
    delivery: task.delivery,
    runState: task.runState,
    status: task.status,
    priority: task.priority,
    budgetMode: task.budgetMode || config.defaultBudgetMode,
    retrievalMode: task.retrievalMode || config.defaultRetrievalMode,
    localOnly: Boolean(task.localOnly),
    localFirst: task.localFirst !== false,
    createdAt: task.createdAt,
    createdIso: toIso(task.createdAt),
    updatedAt: task.updatedAt,
    updatedIso: toIso(task.updatedAt),
    nextRunAt,
    nextRunIso: toIso(nextRunAt),
    nextRunIn: nextRunAt ? formatDuration(nextRunAt - ts) : null,
    lastRunAt,
    lastRunIso: toIso(lastRunAt),
    runCount: task.runCount || 0,
    lastError: task.lastError || null,
    isDue,
    isOverdue: Boolean(isDue && nextRunAt),
    canRunNow: Boolean(config.enabled && isRunnable),
    effectiveBudgetMode: task.budgetMode || config.defaultBudgetMode,
    effectiveRetrievalMode: task.retrievalMode || config.defaultRetrievalMode
  };
}

function buildAutopilotStatus(store) {
  const normalized = normalizeAutopilotStore(store);
  const tasks = normalized.tasks.map((task) => buildAutopilotTaskView(task, normalized.config));
  const counts = {
    total: tasks.length,
    queued: 0,
    planning: 0,
    ready: 0,
    running: 0,
    blocked: 0,
    waitingExternal: 0,
    waitingUser: 0,
    completed: 0,
    cancelled: 0,
    due: 0
  };
  let nextDueTask = null;
  for (const task of tasks) {
    if (task.status === "queued") counts.queued += 1;
    else if (task.status === "planning") counts.planning += 1;
    else if (task.status === "ready") counts.ready += 1;
    else if (task.status === "running") counts.running += 1;
    else if (task.status === "blocked") counts.blocked += 1;
    else if (task.status === "waiting_external") counts.waitingExternal += 1;
    else if (task.status === "waiting_user") counts.waitingUser += 1;
    else if (task.status === "completed") counts.completed += 1;
    else if (task.status === "cancelled") counts.cancelled += 1;
    if (task.isDue) {
      counts.due += 1;
      if (!nextDueTask || (task.nextRunAt || 0) < (nextDueTask.nextRunAt || 0)) nextDueTask = task;
    }
  }
  return {
    config: normalized.config,
    scheduler: {
      startedIso: toIso(autopilotRuntime.startedAt),
      lastTickIso: toIso(autopilotRuntime.lastTickAt),
      lastError: autopilotRuntime.lastError || null,
      nextDueTaskId: nextDueTask ? nextDueTask.id : null,
      activeTaskId: autopilotRuntime.activeTaskId || null,
      activeTaskStartedIso: toIso(autopilotRuntime.activeTaskStartedAt)
    },
    stats: {
      ...counts,
      waitingHuman: counts.waitingUser,
      done: counts.completed
    },
    tasks
  };
}

function findContinuationTask(store, sessionKey) {
  const active = store.tasks
    .filter((task) => !isAutopilotTerminalStatus(task.status) && task.sourceMeta?.sessionKey === sessionKey)
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  return active[0] || null;
}

function buildCapturedTaskPayload(params) {
  const { store, sessionKey, cleanText, sourceMeta, delivery, route, assignee } = params;
  const continuation = looksLikeContinuation(cleanText) ? findContinuationTask(store, sessionKey) : null;
  const taskId = continuation?.id || buildTaskIdFromMessage(sessionKey, sourceMeta.messageId, cleanText);
  const goal = continuation?.goal
    ? `${continuation.goal}\n\n跟进补充：${cleanText}`
    : cleanText;
  return {
    ...continuation,
    id: taskId,
    title: continuation?.title || buildTaskTitleFromText(cleanText),
    goal: summarizeTaskGoal(goal),
    successCriteria: continuation?.successCriteria || "形成真实交付、明确下一动作，或在缺少关键输入时给出高信息密度阻塞说明。",
    notes: continuation?.notes
      ? `${continuation.notes}\n\n[follow-up ${new Date().toISOString()}]\n${cleanText}`
      : cleanText,
    doneCriteria: continuation?.doneCriteria || "完成真实交付，或在缺少关键决策/外部输入时给出高信息密度阻塞说明。",
    planSummary: continuation?.planSummary || "",
    nextAction: continuation?.nextAction || "",
    blockedReason: continuation?.blockedReason || "",
    lastResult: continuation?.lastResult || "",
    source: "channel_inbox",
    sourceMeta,
    delivery,
    intakeText: cleanText,
    route,
    taskKind: route,
    assignee,
    status: "queued",
    reportPolicy: "reply_and_proactive",
    skillHints: buildSkillHintsForTask(route, cleanText),
    tags: mergeUniqueStrings(continuation?.tags, extractKeywordTags(goal, [route, assignee])),
    priority: route === "ops" || route === "coder" ? "high" : "normal",
    nextRunAt: nowTs()
  };
}

async function captureAutopilotTaskFromSession(ctx) {
  if (!ctx?.sessionKey) return null;
  const store = await loadAutopilotStore();
  if (!store.config.enabled) return null;
  const agentId = normalizeString(ctx.agentId, "main");
  const sessionKey = normalizeString(ctx.sessionKey);
  const sessionEntry = await resolveSessionEntry(agentId, sessionKey);
  if (!sessionEntry?.sessionFile) return null;
  const recentEntries = await readRecentTranscriptMessages(sessionEntry.sessionFile);
  const latestUser = extractLatestUserTranscriptMessage(recentEntries);
  if (!latestUser) return null;
  const messageMeta = buildSourceMetaFromTranscript(latestUser, sessionEntry, sessionKey);
  if (shouldIgnoreIncomingAutopilotMessage(messageMeta)) return null;
  const cleanText = normalizeTaskGoal(messageMeta.body);
  if (!isLikelyTaskText(cleanText)) return null;
  if (!messageMeta.delivery.channel || !messageMeta.delivery.target) return null;
  const duplicate = store.tasks.find((task) => (
    task?.sourceMeta?.sessionKey === sessionKey &&
    task?.sourceMeta?.messageId &&
    task.sourceMeta.messageId === messageMeta.sourceMeta.messageId
  ));
  if (duplicate) return buildAutopilotTaskView(duplicate, store.config);
  const routeInfo = classifyTaskRoute(cleanText);
  const payload = buildCapturedTaskPayload({
    store,
    sessionKey,
    cleanText,
    sourceMeta: messageMeta.sourceMeta,
    delivery: messageMeta.delivery,
    route: routeInfo.route,
    assignee: routeInfo.assignee
  });
  const saved = await upsertAutopilotTask(payload);
  return saved.tasks.find((task) => task.id === payload.id) || payload;
}

function buildAutopilotPromptBlock(task, config) {
  if (!task) return "";
  const lines = [
    "<personal-superintelligence>",
    "你是墨水的个人超级智能 AI。默认目标不是聊天，而是推进任务。",
    `当前消息已被自动捕获为任务 ${task.id}。`,
    `任务目标：${task.goal || task.title}`,
    `完成标准：${task.successCriteria || task.doneCriteria || "完成真实交付或明确阻塞。"}`,
    `路由领域：${task.route || task.taskKind || "general"}；执行 agent：${task.assignee || "main"}`,
    `默认策略：skill-first=${task.skillHints?.length ? "on" : "off"}；local-first=${task.localFirst !== false ? "on" : "off"}；budget=${task.budgetMode || config.defaultBudgetMode}；retrieval=${task.retrievalMode || config.defaultRetrievalMode}`,
    "规则：",
    "- 默认沿整条链路继续做，不要把任务拆回给用户。",
    "- 先用最省 token 的路径：规则、本地工具、稳定 skills，再升级到重推理。",
    "- 回复要短，除非当前回合就能直接交付。",
    "- 只有缺少关键决策、授权、外部输入时才问，并且一次说清楚缺什么。",
    "- 如当前回合无法完全收口，也要给用户一个简短确认，并继续让后台推进。",
    task.skillHints?.length ? `优先考虑的 skills：${task.skillHints.join(", ")}` : "",
    "</personal-superintelligence>"
  ].filter(Boolean);
  return lines.join("\n");
}

function buildAutopilotWorkerPrompt(task, config) {
  const decisionBlock = buildDecisionPromptBlock(task.optimizationState?.decision);
  const lines = [
    `你是墨水的个人超级智能 AI 的后台执行器。`,
    `任务 ID: ${task.id}`,
    `任务标题: ${task.title}`,
    `任务目标: ${task.goal || task.title}`,
    task.planSummary ? `当前计划摘要: ${task.planSummary}` : "",
    task.nextAction ? `当前下一动作: ${task.nextAction}` : "",
    task.lastResult ? `上一轮结果: ${task.lastResult}` : "",
    `完成标准: ${task.doneCriteria || "完成真实交付或明确阻塞。"}`,
    `路由领域: ${task.route || task.taskKind || "general"}`,
    `建议 skills: ${(task.skillHints || []).join(", ") || "none"}`,
    `预算策略: ${task.budgetMode || config.defaultBudgetMode}`,
    `检索策略: ${task.retrievalMode || config.defaultRetrievalMode}`,
    decisionBlock || "",
    task.notes ? `补充备注:\n${task.notes}` : "",
    "执行规则：",
    "1. 默认继续推进整条链路，不要把任务退回给用户。",
    "2. 优先使用本地工具、稳定 skills、已有记忆和 workspace 文档。",
    "3. 如果任务涉及多个领域，优先自己协调；确有必要时，使用 sessions_spawn / coding-agent 等方式把工作分给专工，而不是回头问用户。",
    "4. 输出要短、结构清晰、高信息密度，不要写长篇过程描述。",
    "5. 完成时直接交付结果；阻塞时明确卡点、已尝试、还需要什么。",
    "6. 如果某条路径失败，先换工具、换 skill、换策略，再考虑转 blocked。",
    "7. 记住：默认目标是推进任务，不是陪聊。",
    "8. 只有在缺少关键决策、授权或外部信息时，才把状态设为 waiting_user 或 blocked。",
    "9. 如果需要后续继续处理但当前回合不适合立即继续，把状态设为 ready、running 或 waiting_external，并给出 nextRunInMinutes。",
    "10. 最终输出时，除了必要的简短说明，只能在最后包含一段 AUTOPILOT_RESULT JSON。",
    "输出格式：",
    "<AUTOPILOT_RESULT>",
    JSON.stringify({
      status: "running",
      summary: "一句话说明当前进展或交付结果",
      planSummary: "当前计划的简短摘要",
      nextAction: "下一步具体动作",
      blockedReason: "",
      lastResult: "本轮产出或最新结论",
      nextRunInMinutes: 15,
      needsUser: "",
      shouldNotify: false,
      notes: ""
    }, null, 2),
    "</AUTOPILOT_RESULT>"
  ].filter(Boolean);
  return lines.join("\n\n");
}

async function notifyTaskTarget(task, kind, text) {
  const delivery = normalizeAutopilotDelivery(task.delivery);
  if (!delivery.channel || !delivery.target || !normalizeString(text)) return { ok: false, skipped: true };
  const args = [
    "message",
    "send",
    "--channel",
    delivery.channel,
    "--target",
    delivery.target,
    "--message",
    text,
    "--json"
  ];
  if (delivery.accountId) args.push("--account", delivery.accountId);
  if (delivery.threadId) args.push("--thread-id", delivery.threadId);
  if (delivery.replyTo && kind !== "proactive") args.push("--reply-to", delivery.replyTo);
  const result = await runOpenClawCli(args, { timeoutMs: 60 * 1000 });
  if (!result.ok && pluginApi) {
    pluginApi.logger.warn(`[openclaw-codex-control] notify ${kind} failed for ${task.id}: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function resolveWorkspacePathForAutopilotTask(task) {
  const config = await loadConfig();
  if (task?.workspace && path.isAbsolute(task.workspace)) return task.workspace;
  const requested = normalizeString(task?.workspace || task?.assignee || "main");
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const agent = agents.find((entry) => normalizeString(entry?.id) === requested);
  if (agent?.workspace) return agent.workspace;
  return normalizeString(config?.agents?.defaults?.workspace) || null;
}

function formatMemoryTaskLine(task, status) {
  const route = normalizeString(task.route || task.taskKind || "general");
  const summary = normalizeString(task.lastResult || task.runState?.lastResultSummary || task.blockedReason || task.lastError || task.goal || task.title);
  const compactSummary = summary.replace(/\s+/g, " ").trim();
  const shownSummary = compactSummary.length > 220 ? `${compactSummary.slice(0, 220)}...` : compactSummary;
  return `- [autopilot][${status}][${task.id}] ${task.title} | route=${route} | ${shownSummary}`;
}

async function appendAutopilotMemoryLine(task, status) {
  const runState = normalizeAutopilotRunState(task.runState);
  const normalizedStatus = normalizeAutopilotStatusValue(status, status);
  if (runState.memoryLoggedStatuses.includes(normalizedStatus)) return false;
  const workspace = await resolveWorkspacePathForAutopilotTask(task);
  if (!workspace) return false;
  const dateKey = new Date().toISOString().slice(0, 10);
  const memoryDir = path.join(workspace, "memory");
  const memoryFile = path.join(memoryDir, `${dateKey}.md`);
  const existing = await readTextFile(memoryFile, "");
  const markers = getAutopilotStatusAliases(normalizedStatus).map((entry) => `[autopilot][${entry}][${task.id}]`);
  if (markers.some((marker) => existing.includes(marker))) {
    await transitionAutopilotTask(task.id, {
      runState: {
        memoryLoggedStatuses: [...runState.memoryLoggedStatuses, normalizedStatus]
      }
    });
    return false;
  }
  await fsp.mkdir(memoryDir, { recursive: true });
  const line = formatMemoryTaskLine(task, normalizedStatus);
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await fsp.appendFile(memoryFile, `${prefix}${line}\n`, "utf8");
  await transitionAutopilotTask(task.id, {
    runState: {
      memoryLoggedStatuses: [...runState.memoryLoggedStatuses, normalizedStatus]
    }
  });
  return true;
}

function buildPlanningSummary(task) {
  const skillText = Array.isArray(task.skillHints) && task.skillHints.length > 0
    ? `优先 skills: ${task.skillHints.slice(0, 5).join(", ")}`
    : "优先用现有本地工具和稳定技能";
  return `按 ${task.route || task.taskKind || "general"} 路径推进，${skillText}。`;
}

function buildNextActionSummary(task) {
  const route = task.route || task.taskKind || "general";
  if (route === "office") return "整理需求并优先落到飞书/企微文档、任务或表格。";
  if (route === "coder") return "读取代码和仓库状态，形成最小可执行修改。";
  if (route === "ops") return "读取服务、日志、端口和环境状态，再做最小修复。";
  if (route === "media") return "优先结构化提取输入素材，输出可继续执行的数据。";
  if (route === "research") return "先检索与筛选，再压缩成高信息密度结论。";
  return "先识别任务类型，再选择最省 token 的执行链路。";
}

function buildRetryStrategy(task, failureSummary, reason = "worker_failure") {
  const currentRunState = normalizeAutopilotRunState(task.runState);
  const consecutiveFailures = (currentRunState.consecutiveFailures || 0) + 1;
  const totalFailures = (currentRunState.totalFailures || 0) + 1;
  const retryIndex = Math.min(consecutiveFailures - 1, AUTOPILOT_RETRY_BACKOFF_MINUTES.length - 1);
  const nextRunAt = nowTs() + AUTOPILOT_RETRY_BACKOFF_MINUTES[retryIndex] * 60 * 1000;
  const escalatedBudget = consecutiveFailures >= 2 ? bumpBudgetMode(task.budgetMode) : task.budgetMode;
  const escalatedRetrieval = consecutiveFailures >= 2 ? bumpRetrievalMode(task.retrievalMode) : task.retrievalMode;
  const shouldEscalateToMain = consecutiveFailures >= 3 && !["main", ""].includes(task.assignee || "");
  const assignee = shouldEscalateToMain ? "main" : task.assignee;
  const status = consecutiveFailures >= AUTOPILOT_MAX_CONSECUTIVE_FAILURES ? "blocked" : "queued";
  const replanCount = currentRunState.replanCount + (consecutiveFailures >= 2 ? 1 : 0);
  const routeLabel = shouldEscalateToMain ? "，并升级到总管复判" : "";
  return {
    status,
    assignee,
    budgetMode: escalatedBudget,
    retrievalMode: escalatedRetrieval,
    nextRunAt: status === "blocked" ? nowTs() + AUTOPILOT_BLOCK_NOTIFY_AFTER_MS : nextRunAt,
    lastError: failureSummary,
    blockedReason: status === "blocked" ? failureSummary : "",
    planSummary: status === "blocked"
      ? `连续失败 ${consecutiveFailures} 次，已停止自动重试并等待外部处理。`
      : `失败后自动重规划第 ${replanCount} 次，调整预算/检索策略${routeLabel}。`,
    nextAction: status === "blocked"
      ? "等待墨水介入，或由 heartbeat/后续任务重新触发。"
      : `在 ${AUTOPILOT_RETRY_BACKOFF_MINUTES[retryIndex]} 分钟后重试，优先换技能或换路径。`,
    runState: {
      consecutiveFailures,
      totalFailures,
      replanCount,
      lastFailureAt: nowTs(),
      lastFailureSummary: failureSummary
    }
  };
}

function buildHeartbeatAutopilotContext(status) {
  const tasks = Array.isArray(status?.tasks) ? status.tasks : [];
  const interesting = tasks
    .filter((task) => task.status === "blocked" || task.status === "waiting_user" || task.status === "waiting_external" || task.status === "queued" || task.status === "ready" || task.status === "running")
    .slice(0, 8);
  if (interesting.length === 0) return "";
  const lines = [
    "<autopilot-heartbeat>",
    "这是个人超级智能 AI 当前任务快照。heartbeat 只用于补充调度和必要汇报，不要凭空恢复旧任务。",
    ...interesting.map((task, index) => {
      const detail = [
        `${index + 1}. [${task.status}] ${task.title}`,
        `route=${task.route || task.taskKind || "general"}`,
        task.nextAction ? `next=${task.nextAction}` : "",
        task.blockedReason ? `blocked=${task.blockedReason}` : "",
        task.nextRunIn ? `retry=${task.nextRunIn}` : ""
      ].filter(Boolean).join(" | ");
      return detail;
    }),
    "</autopilot-heartbeat>"
  ];
  return lines.join("\n");
}

function formatBlockedNotification(task, result) {
  const lines = [
    `${task.title || "任务"}卡住了。`,
    `卡点：${result.blockedReason || result.summary || task.blockedReason || task.lastError || "后台执行未能继续推进。"}`,
    task.lastError ? `已尝试：${task.lastError}` : "",
    result.needsUser ? `还需要你提供：${result.needsUser}` : "还需要你提供：进一步决策或外部信息。"
  ].filter(Boolean);
  return lines.join("\n");
}

function formatDoneNotification(task, result) {
  return `${task.title || "任务"} 已完成。\n${result.lastResult || result.summary || task.lastResult || task.runState?.lastResultSummary || "后台已完成交付。"}`
    .trim();
}

async function maybeNotifyForTask(task) {
  const status = task.status;
  const runState = normalizeAutopilotRunState(task.runState);
  const ts = nowTs();
  if (task.reportPolicy === "silent") return false;
  if (status === "completed") {
    await appendAutopilotMemoryLine(task, "completed");
    if (runState.lastNotifiedStatus === "completed") return false;
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      shouldNotify: true
    });
    const message = formatDoneNotification(task, result);
    const notified = await notifyTaskTarget(task, "reply", message);
    if (notified.ok) {
      await transitionAutopilotTask(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "completed"
        }
      });
      return true;
    }
    return false;
  }
  if (status === "waiting_user") {
    await appendAutopilotMemoryLine(task, "waiting_user");
    if (runState.lastNotifiedStatus === "waiting_user" && runState.lastNotifyAt && ts - runState.lastNotifyAt < AUTOPILOT_MIN_NOTIFY_GAP_MS) {
      return false;
    }
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      needsUser: task.lastError,
      shouldNotify: true
    });
    const message = formatBlockedNotification(task, result);
    const notified = await notifyTaskTarget(task, "reply", message);
    if (notified.ok) {
      await transitionAutopilotTask(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "waiting_user"
        }
      });
      return true;
    }
    return false;
  }
  if (status === "blocked") {
    await appendAutopilotMemoryLine(task, "blocked");
    const blockedAt = runState.blockedAt || task.updatedAt || ts;
    if (ts - blockedAt < AUTOPILOT_BLOCK_NOTIFY_AFTER_MS) return false;
    if (runState.lastNotifiedStatus === "blocked" && runState.lastNotifyAt && ts - runState.lastNotifyAt < AUTOPILOT_MIN_NOTIFY_GAP_MS) {
      return false;
    }
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      needsUser: task.lastError,
      shouldNotify: true
    });
    const message = formatBlockedNotification(task, result);
    const notified = await notifyTaskTarget(task, "proactive", message);
    if (notified.ok) {
      await transitionAutopilotTask(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "blocked"
        }
      });
      return true;
    }
  }
  return false;
}

async function runAutopilotTask(task, config) {
  if ((task.runState?.remoteCallCount || 0) >= config.maxRemoteCallsPerTask) {
    return await transitionAutopilotTask(task.id, {
      status: "blocked",
      lastError: "已达到单任务远程调用上限，暂停继续调用远程推理。",
      blockedReason: "已达到单任务远程调用上限，等待新策略或外部介入。",
      planSummary: "达到远程调用预算上限，停止继续消耗额度。",
      nextAction: "等待墨水介入，或由后续策略刷新后再恢复。"
    });
  }
  const decision = await buildTaskDecision(task, config);
  const backgroundSessionId = task.runState?.backgroundSessionId || buildBackgroundSessionId(task);
  const effectiveBudgetMode = decision.thinkingLane === "system2"
    ? bumpBudgetMode(task.budgetMode || config.defaultBudgetMode)
    : (task.budgetMode || config.defaultBudgetMode);
  const effectiveRetrievalMode = decision.thinkingLane === "system2"
    ? bumpRetrievalMode(task.retrievalMode || config.defaultRetrievalMode)
    : (task.retrievalMode || config.defaultRetrievalMode);
  const mergedSkills = mergeUniqueStrings(task.skillHints, decision.recommendedSkills).slice(0, 16);
  const planningTask = {
    ...task,
    assignee: decision.recommendedWorker || task.assignee,
    skillHints: mergedSkills
  };
  const replanMarker = normalizeString(task.nextAction).includes("相关记忆已失效")
    || normalizeString(task.planSummary).includes("相关记忆已失效")
    || Boolean(task.optimizationState?.needsReplan);
  await transitionAutopilotTask(task.id, {
    status: "running",
    assignee: decision.recommendedWorker || task.assignee,
    skillHints: mergedSkills,
    budgetMode: effectiveBudgetMode,
    retrievalMode: effectiveRetrievalMode,
    memoryRefs: decision.relevantMemoryIds,
    intelRefs: decision.relevantIntelIds,
    optimizationState: {
      ...(isRecord(task.optimizationState) ? task.optimizationState : {}),
      needsReplan: false,
      lastReplannedAt: nowTs(),
      decision
    },
    nextRunAt: null,
    lastError: "",
    blockedReason: "",
    planSummary: !task.planSummary || replanMarker ? buildPlanningSummary(planningTask) : task.planSummary,
    nextAction: !task.nextAction || replanMarker ? buildNextActionSummary(planningTask) : task.nextAction,
    runState: {
      backgroundSessionId,
      triedAssignees: dedupe([...(task.runState?.triedAssignees || []), decision.recommendedWorker || task.assignee || "main"]),
      lastDecisionAt: decision.builtAt,
      lastThinkingLane: decision.thinkingLane,
      lastDecisionSummary: decision.decisionSummary,
      lastRecommendedWorker: decision.recommendedWorker,
      lastRecommendedSkills: decision.recommendedSkills,
      lastRelevantMemoryIds: decision.relevantMemoryIds,
      lastRelevantIntelIds: decision.relevantIntelIds,
      lastFallbackOrder: decision.fallbackOrder,
      remoteCallCount: (task.runState?.remoteCallCount || 0) + 1
    }
  });
  await appendSystemEvent("task_decision", {
    taskId: task.id,
    route: task.route,
    thinkingLane: decision.thinkingLane,
    recommendedWorker: decision.recommendedWorker,
    recommendedSkills: decision.recommendedSkills,
    memoryRefs: decision.relevantMemoryIds,
    intelRefs: decision.relevantIntelIds,
    fallbackOrder: decision.fallbackOrder
  });
  const executionTask = normalizeAutopilotTask({
    ...task,
    assignee: decision.recommendedWorker || task.assignee,
    skillHints: mergedSkills,
    budgetMode: effectiveBudgetMode,
    retrievalMode: effectiveRetrievalMode,
    memoryRefs: decision.relevantMemoryIds,
    intelRefs: decision.relevantIntelIds,
    optimizationState: {
      ...(isRecord(task.optimizationState) ? task.optimizationState : {}),
      decision
    },
    runState: {
      ...(task.runState || {}),
      backgroundSessionId,
      lastDecisionAt: decision.builtAt,
      lastThinkingLane: decision.thinkingLane,
      lastDecisionSummary: decision.decisionSummary,
      lastRecommendedWorker: decision.recommendedWorker,
      lastRecommendedSkills: decision.recommendedSkills,
      lastRelevantMemoryIds: decision.relevantMemoryIds,
      lastRelevantIntelIds: decision.relevantIntelIds,
      lastFallbackOrder: decision.fallbackOrder,
      remoteCallCount: (task.runState?.remoteCallCount || 0) + 1
    }
  }, config);
  const prompt = buildAutopilotWorkerPrompt(executionTask, config);
  const thinking = resolveThinkingLevelForBudget(effectiveBudgetMode);
  const args = [
    "agent",
    "--agent",
    decision.recommendedWorker || task.assignee || "main",
    "--session-id",
    backgroundSessionId,
    "--thinking",
    thinking,
    "--verbose",
    "off",
    "--message",
    prompt,
    "--json"
  ];
  const cliResult = await runOpenClawCli(args, { timeoutMs: 15 * 60 * 1000 });
  const combinedOutput = [cliResult.stdout, cliResult.stderr].filter(Boolean).join("\n");
  const parsed = extractAutopilotResultFromText(combinedOutput);
  const patch = {
    lastError: "",
    nextRunAt: null,
    planSummary: parsed.planSummary || task.planSummary || "",
    nextAction: parsed.nextAction || "",
    blockedReason: parsed.blockedReason || "",
    lastResult: parsed.lastResult || parsed.summary || "",
    runState: {
      lastResultStatus: parsed.status,
      lastResultSummary: parsed.summary,
      lastWorkerOutput: combinedOutput.slice(-6000),
      lastCliExitCode: cliResult.code,
      backgroundSessionId,
      consecutiveFailures: 0
    }
  };
  if (!cliResult.ok) {
    return await transitionAutopilotTask(
      task.id,
      {
        ...patch,
        ...buildRetryStrategy(task, normalizeString(cliResult.stderr || cliResult.stdout || "Autopilot worker failed."), "cli_error")
      }
    );
  }
  if (parsed.status === "completed") {
    patch.status = "completed";
    return await transitionAutopilotTask(task.id, patch);
  }
  if (parsed.status === "waiting_user") {
    patch.status = "waiting_user";
    patch.lastError = parsed.needsUser || parsed.summary;
    patch.blockedReason = parsed.blockedReason || patch.lastError;
    return await transitionAutopilotTask(task.id, patch);
  }
  if (parsed.status === "blocked") {
    const failureText = normalizeString(parsed.blockedReason || parsed.needsUser || parsed.summary || "Autopilot worker returned blocked.");
    return await transitionAutopilotTask(task.id, {
      ...patch,
      ...buildRetryStrategy(task, failureText, "worker_blocked")
    });
  }
  if (parsed.status === "waiting_external") {
    patch.status = "waiting_external";
    patch.nextRunAt = nowTs() + parsed.nextRunInMinutes * 60 * 1000;
    return await transitionAutopilotTask(task.id, patch);
  }
  patch.status = "queued";
  patch.nextRunAt = nowTs() + parsed.nextRunInMinutes * 60 * 1000;
  return await transitionAutopilotTask(task.id, patch);
}

async function tickAutopilotExecution() {
  const store = await loadAutopilotStore();
  if (!store.config.enabled) return buildAutopilotStatus(store);
  let taskLoopCore = null;
  try {
    taskLoopCore = await loadManagedRuntimeTaskLoopCore();
  } catch (error) {
    if (!managedRuntimeTaskLoopWarned && pluginApi?.logger) {
      managedRuntimeTaskLoopWarned = true;
      pluginApi.logger.warn(`[openclaw-codex-control] managed runtime task loop unavailable, using legacy scheduler: ${error?.message || error}`);
    }
  }
  const compareTasks = taskLoopCore?.compareTaskQueueOrder || compareAutopilotTasks;
  const shouldRunTask = taskLoopCore?.shouldTaskRun || shouldAutopilotTaskRun;
  store.tasks.sort((left, right) => compareTasks(left, right));
  for (const task of store.tasks) {
    await maybeNotifyForTask(task);
  }
  if (autopilotRuntime.activeTaskId) return buildAutopilotStatus(await loadAutopilotStore());
  const dueTask = store.tasks.find((task) => shouldRunTask(task, nowTs()));
  if (!dueTask) return buildAutopilotStatus(await loadAutopilotStore());
  autopilotRuntime.activeTaskId = dueTask.id;
  autopilotRuntime.activeTaskStartedAt = nowTs();
  try {
    await transitionAutopilotTask(dueTask.id, {
      status: "planning",
      planSummary: dueTask.planSummary || buildPlanningSummary(dueTask),
      nextAction: dueTask.nextAction || buildNextActionSummary(dueTask)
    });
    const updated = await runAutopilotTask(dueTask, store.config);
    return updated;
  } finally {
    autopilotRuntime.activeTaskId = null;
    autopilotRuntime.activeTaskStartedAt = null;
  }
}

async function upsertAutopilotTask(inputTask) {
  const store = await loadAutopilotStore();
  const payload = isRecord(inputTask) ? inputTask : {};
  const taskId = normalizeString(payload.id) || `task_${crypto.randomUUID()}`;
  const index = store.tasks.findIndex((task) => task.id === taskId);
  const base = index >= 0 ? store.tasks[index] : null;
  const merged = normalizeAutopilotTask(
    {
      ...base,
      ...payload,
      id: taskId,
      createdAt: base ? base.createdAt : nowTs(),
      updatedAt: nowTs()
    },
    store.config
  );
  if (index >= 0) store.tasks[index] = merged;
  else store.tasks.push(merged);
  const saved = await saveAutopilotStore(store);
  await appendSystemEvent(index >= 0 ? "task_updated" : "task_created", {
    taskId: merged.id,
    route: merged.route,
    status: merged.status,
    assignee: merged.assignee,
    tags: merged.tags,
    delivery: merged.delivery
  });
  return buildAutopilotStatus(saved);
}

async function transitionAutopilotTask(taskId, patch) {
  const store = await loadAutopilotStore();
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error(`Unknown task: ${taskId}`);
  const current = store.tasks[index];
  const patchValue = isRecord(patch) ? patch : {};
  const nextStatus = patchValue.status ? normalizeAutopilotStatusValue(patchValue.status, current.status) : current.status;
  const runState = normalizeAutopilotRunState({
    ...current.runState,
    ...patchValue.runState
  });
  const nextTask = {
    ...current,
    updatedAt: nowTs(),
    status: nextStatus,
    runState
  };
  if (hasDefinedOwn(patchValue, "notes")) nextTask.notes = patchValue.notes;
  if (hasDefinedOwn(patchValue, "nextRunAt")) nextTask.nextRunAt = patchValue.nextRunAt;
  if (hasDefinedOwn(patchValue, "lastError")) nextTask.lastError = patchValue.lastError;
  if (hasDefinedOwn(patchValue, "planSummary")) nextTask.planSummary = patchValue.planSummary;
  if (hasDefinedOwn(patchValue, "nextAction")) nextTask.nextAction = patchValue.nextAction;
  if (hasDefinedOwn(patchValue, "blockedReason")) nextTask.blockedReason = patchValue.blockedReason;
  if (hasDefinedOwn(patchValue, "lastResult")) nextTask.lastResult = patchValue.lastResult;
  if (hasDefinedOwn(patchValue, "assignee")) nextTask.assignee = patchValue.assignee;
  if (hasDefinedOwn(patchValue, "route")) nextTask.route = patchValue.route;
  if (hasDefinedOwn(patchValue, "workspace")) nextTask.workspace = patchValue.workspace;
  if (hasDefinedOwn(patchValue, "priority")) nextTask.priority = patchValue.priority;
  if (hasDefinedOwn(patchValue, "budgetMode")) nextTask.budgetMode = patchValue.budgetMode;
  if (hasDefinedOwn(patchValue, "retrievalMode")) nextTask.retrievalMode = patchValue.retrievalMode;
  if (hasDefinedOwn(patchValue, "reportPolicy")) nextTask.reportPolicy = patchValue.reportPolicy;
  if (hasDefinedOwn(patchValue, "successCriteria")) nextTask.successCriteria = patchValue.successCriteria;
  if (hasDefinedOwn(patchValue, "doneCriteria")) nextTask.doneCriteria = patchValue.doneCriteria;
  if (hasDefinedOwn(patchValue, "skillHints")) nextTask.skillHints = patchValue.skillHints;
  if (hasDefinedOwn(patchValue, "memoryRefs")) nextTask.memoryRefs = normalizeStringArray(patchValue.memoryRefs).slice(0, 24);
  if (hasDefinedOwn(patchValue, "intelRefs")) nextTask.intelRefs = normalizeStringArray(patchValue.intelRefs).slice(0, 24);
  if (hasDefinedOwn(patchValue, "optimizationState")) nextTask.optimizationState = normalizeOptionalRecord(patchValue.optimizationState);
  if (nextStatus === "running") {
    nextTask.lastRunAt = nowTs();
    nextTask.runCount = (current.runCount || 0) + 1;
    nextTask.runState.blockedAt = null;
    nextTask.runState.triedAssignees = dedupe([...(current.runState?.triedAssignees || []), nextTask.assignee || current.assignee || "main"]);
  }
  if (nextStatus === "blocked" || nextStatus === "waiting_user") {
    nextTask.runState.blockedAt = nextTask.runState.blockedAt || nowTs();
  } else if (nextStatus !== "blocked") {
    nextTask.runState.blockedAt = null;
  }
  if (nextStatus === "completed") {
    nextTask.runState.completedAt = nowTs();
    nextTask.runState.consecutiveFailures = 0;
  }
  if (nextStatus === "queued" || nextStatus === "planning" || nextStatus === "ready" || nextStatus === "running" || nextStatus === "waiting_external") {
    if (!nextTask.lastError) nextTask.runState.lastFailureSummary = nextTask.runState.lastFailureSummary;
  }
  store.tasks[index] = normalizeAutopilotTask(
    nextTask,
    store.config
  );
  let saved = await saveAutopilotStore(store);
  let savedTask = saved.tasks.find((task) => task.id === taskId) || store.tasks[index];
  const transitionArtifacts = await buildManagedRuntimeTaskArtifacts(savedTask, {
    fromStatus: current.status
  });
  const lifecycleEvent = await appendSystemEvent("task_transition", {
    taskId,
    fromStatus: current.status,
    toStatus: savedTask.status,
    assignee: savedTask.assignee,
    route: savedTask.route,
    lastError: truncateText(savedTask.lastError, 180),
    lastResult: truncateText(savedTask.lastResult, 180),
    nextAction: truncateText(savedTask.nextAction, 180),
    memoryRefs: savedTask.memoryRefs,
    intelRefs: savedTask.intelRefs,
    thinkingLane: savedTask.runState?.lastThinkingLane || null,
    taskRecord: transitionArtifacts?.taskRecord || null,
    taskRun: transitionArtifacts?.taskRun || null,
    taskStep: transitionArtifacts?.taskStep || null
  });
  const changedOutcome = (
    current.status !== savedTask.status ||
    current.lastResult !== savedTask.lastResult ||
    current.lastError !== savedTask.lastError ||
    current.blockedReason !== savedTask.blockedReason
  );
  if (changedOutcome) {
    const distilled = await distillTaskOutcomeToMemory(savedTask, lifecycleEvent);
    if (distilled?.memoryIds?.length) {
      const refreshedStore = await loadAutopilotStore();
      const refreshedIndex = refreshedStore.tasks.findIndex((task) => task.id === taskId);
      if (refreshedIndex >= 0) {
        refreshedStore.tasks[refreshedIndex] = normalizeAutopilotTask({
          ...refreshedStore.tasks[refreshedIndex],
          memoryRefs: mergeUniqueStrings(refreshedStore.tasks[refreshedIndex].memoryRefs, distilled.memoryIds).slice(0, 24),
          updatedAt: nowTs()
        }, refreshedStore.config);
        saved = await saveAutopilotStore(refreshedStore);
        savedTask = saved.tasks.find((task) => task.id === taskId) || refreshedStore.tasks[refreshedIndex];
      }
    }
    if (["completed", "blocked", "waiting_user", "cancelled"].includes(savedTask.status)) {
      const reviewArtifacts = await buildManagedRuntimeTaskArtifacts(savedTask, {
        fromStatus: current.status,
        transitionEventId: lifecycleEvent.eventId,
        includeReview: true,
        generatedAt: lifecycleEvent.ts,
        memoryIds: distilled?.memoryIds || [],
        strategyIds: distilled?.strategyIds || []
      });
      if (reviewArtifacts?.taskReview) {
        await appendSystemEvent("task_review_built", {
          taskId: savedTask.id,
          runId: reviewArtifacts.taskRun?.id || null,
          reviewId: reviewArtifacts.taskReview.id,
          outcome: reviewArtifacts.taskReview.outcome,
          extractedMemoryIds: reviewArtifacts.taskReview.extractedMemoryIds,
          strategyCandidateIds: reviewArtifacts.taskReview.strategyCandidateIds,
          taskRecord: reviewArtifacts.taskRecord || null,
          taskRun: reviewArtifacts.taskRun || null,
          taskStep: reviewArtifacts.taskStep || null,
          taskReview: reviewArtifacts.taskReview,
          shareableReview: reviewArtifacts.shareableReview || null
        });
      }
    }
    await observeTaskOutcomeForEvolution(savedTask, lifecycleEvent);
  }
  return buildAutopilotStatus(saved);
}

async function deleteAutopilotTask(taskId) {
  const store = await loadAutopilotStore();
  store.tasks = store.tasks.filter((task) => task.id !== taskId);
  return buildAutopilotStatus(await saveAutopilotStore(store));
}

async function updateAutopilotConfig(patch) {
  const store = await loadAutopilotStore();
  store.config = normalizeAutopilotConfig({ ...store.config, ...(isRecord(patch) ? patch : {}) });
  store.tasks = store.tasks.map((task) => normalizeAutopilotTask(task, store.config));
  return buildAutopilotStatus(await saveAutopilotStore(store));
}

async function loadAutopilotStatus() {
  return buildAutopilotStatus(await loadAutopilotStore());
}

function startAutopilotTicker() {
  if (autopilotTicker) return;
  autopilotRuntime.startedAt = autopilotRuntime.startedAt || nowTs();
  const tick = async () => {
    autopilotRuntime.lastTickAt = nowTs();
    try {
      autopilotRuntime.lastSnapshot = await tickAutopilotExecution();
      autopilotRuntime.lastError = null;
    } catch (error) {
      autopilotRuntime.lastError = String(error?.message || error);
      if (pluginApi) pluginApi.logger.warn(`[openclaw-codex-control] autopilot tick failed: ${autopilotRuntime.lastError}`);
    }
    try {
      await runIntelMaintenance();
      intelRuntime.lastError = null;
    } catch (error) {
      intelRuntime.lastError = String(error?.message || error);
      if (pluginApi) pluginApi.logger.warn(`[openclaw-codex-control] intel tick failed: ${intelRuntime.lastError}`);
    }
    try {
      await runEvolutionReview();
      evolutionRuntime.lastError = null;
    } catch (error) {
      evolutionRuntime.lastError = String(error?.message || error);
      if (pluginApi) pluginApi.logger.warn(`[openclaw-codex-control] evolution tick failed: ${evolutionRuntime.lastError}`);
    }
  };
  tick();
  autopilotTicker = setInterval(tick, AUTOPILOT_TICK_MS);
  if (typeof autopilotTicker.unref === "function") autopilotTicker.unref();
}

function listProviderProfileIds(store) {
  return Object.entries(store.profiles || {})
    .filter(([, profile]) => profile && profile.provider === PROVIDER)
    .map(([profileId]) => profileId);
}

function resolveCooldownUntil(stats) {
  if (!isRecord(stats)) return null;
  const values = [stats.cooldownUntil, stats.disabledUntil]
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return Math.max(...values);
}

function isInCooldown(stats, ts = nowTs()) {
  const until = resolveCooldownUntil(stats);
  return typeof until === "number" && until > ts;
}

function computeEffectiveOrder(store, config, profileIds) {
  const ts = nowTs();
  const storeOrder = isRecord(store.order) ? store.order[PROVIDER] : null;
  const configOrder = isRecord(config.auth?.order) ? config.auth.order[PROVIDER] : null;
  const explicitOrder = Array.isArray(storeOrder) ? storeOrder : Array.isArray(configOrder) ? configOrder : null;
  const validIds = new Set(profileIds);

  if (explicitOrder) {
    const ordered = dedupe([...explicitOrder, ...profileIds]).filter((id) => validIds.has(id));
    const available = [];
    const cooling = [];
    for (const profileId of ordered) {
      const stats = store.usageStats?.[profileId];
      if (isInCooldown(stats, ts)) {
        cooling.push({
          profileId,
          cooldownUntil: resolveCooldownUntil(stats) || ts
        });
      } else {
        available.push(profileId);
      }
    }
    cooling.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    return [...available, ...cooling.map((entry) => entry.profileId)];
  }

  const typeScore = (profile) => {
    if (profile?.type === "oauth") return 0;
    if (profile?.type === "token") return 1;
    if (profile?.type === "api_key") return 2;
    return 3;
  };

  const available = [];
  const cooling = [];
  for (const profileId of profileIds) {
    const stats = store.usageStats?.[profileId];
    if (isInCooldown(stats, ts)) {
      cooling.push({
        profileId,
        cooldownUntil: resolveCooldownUntil(stats) || ts
      });
      continue;
    }
    available.push({
      profileId,
      typeScore: typeScore(store.profiles?.[profileId]),
      lastUsed: Number(store.usageStats?.[profileId]?.lastUsed || 0)
    });
  }

  available.sort((a, b) => {
    if (a.typeScore !== b.typeScore) return a.typeScore - b.typeScore;
    return a.lastUsed - b.lastUsed;
  });
  cooling.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
  return [...available.map((entry) => entry.profileId), ...cooling.map((entry) => entry.profileId)];
}

function buildSuggestedAlias(profileId, { email, accountId }) {
  const emailStem = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  const source = accountId || profileId || Date.now().toString(36);
  const hash = crypto.createHash("sha1").update(String(source)).digest("hex").slice(0, 8);
  return `${PROVIDER}:${emailStem || "workspace"}-${hash}`;
}

function buildSuggestedCliAlias({ email, accountId, workspaceId, workspaceTitle }) {
  const emailStem = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  const workspaceStem = String(workspaceTitle || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  const base = dedupe([emailStem, workspaceStem]).filter(Boolean).join("-") || "account";
  const source = workspaceId || accountId || email || Date.now().toString(36);
  const hash = crypto.createHash("sha1").update(String(source)).digest("hex").slice(0, 8);
  return `${CODEX_CLI_PREFIX}:${base}-${hash}`;
}

function parseProfileMetadata(profileId, profile) {
  const jwt = profile?.type === "oauth" ? decodeJwtPayload(profile.access) : null;
  const authMeta = isRecord(jwt?.["https://api.openai.com/auth"]) ? jwt["https://api.openai.com/auth"] : {};
  const profileMeta = isRecord(jwt?.["https://api.openai.com/profile"]) ? jwt["https://api.openai.com/profile"] : {};
  const email = String(profile?.email || profileMeta.email || "").trim() || null;
  const accountId = String(profile?.accountId || authMeta.chatgpt_account_id || "").trim() || null;
  const plan = String(authMeta.chatgpt_plan_type || "").trim() || null;
  return {
    email,
    accountId,
    plan,
    suggestedAlias: buildSuggestedAlias(profileId, { email, accountId })
  };
}

function sanitizeCliProfileId(alias) {
  const cleaned = String(alias || "")
    .trim()
    .toLowerCase()
    .replace(/^codex-cli:/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!cleaned) throw new Error("Alias is empty after sanitization.");
  return `${CODEX_CLI_PREFIX}:${cleaned}`;
}

function normalizeCodexCliStore(store) {
  return {
    ...(isRecord(store) ? store : {}),
    version: Number(store?.version || 1) || 1,
    profiles: isRecord(store?.profiles) ? { ...store.profiles } : {}
  };
}

function parseCodexCliAuthMetadata(auth) {
  const tokens = isRecord(auth?.tokens) ? auth.tokens : {};
  const idJwt = decodeJwtPayload(tokens.id_token);
  const accessJwt = decodeJwtPayload(tokens.access_token);
  const ts = nowTs();
  const idAuthMeta = isRecord(idJwt?.["https://api.openai.com/auth"]) ? idJwt["https://api.openai.com/auth"] : {};
  const accessAuthMeta = isRecord(accessJwt?.["https://api.openai.com/auth"]) ? accessJwt["https://api.openai.com/auth"] : {};
  const authMeta = Object.keys(accessAuthMeta).length ? accessAuthMeta : idAuthMeta;
  const profileMeta = isRecord(accessJwt?.["https://api.openai.com/profile"]) ? accessJwt["https://api.openai.com/profile"] : {};
  const organizations = (Array.isArray(idAuthMeta.organizations) ? idAuthMeta.organizations : [])
    .filter((value) => isRecord(value))
    .map((organization) => ({
      id: String(organization.id || "").trim() || null,
      title: String(organization.title || "").trim() || null,
      role: String(organization.role || "").trim() || null,
      isDefault: Boolean(organization.is_default)
    }));
  const defaultOrganization = organizations.find((organization) => organization.isDefault) || organizations[0] || null;
  const email = String(idJwt?.email || profileMeta.email || "").trim() || null;
  const accountId = String(tokens.account_id || authMeta.chatgpt_account_id || "").trim() || null;
  const plan = String(authMeta.chatgpt_plan_type || "").trim() || null;
  const authMode = String(auth?.auth_mode || "").trim() || null;
  const lastRefreshIso = String(auth?.last_refresh || "").trim() || null;
  const idTokenExpiresAt = Number(idJwt?.exp || 0) ? Number(idJwt.exp) * 1000 : null;
  const accessTokenExpiresAt = Number(accessJwt?.exp || 0) ? Number(accessJwt.exp) * 1000 : null;
  const workspaceId = String(defaultOrganization?.id || "").trim() || null;
  const workspaceTitle = String(defaultOrganization?.title || "").trim() || null;
  return {
    email,
    accountId,
    accountShort: shortId(accountId),
    plan,
    authMode,
    workspaceId,
    workspaceTitle,
    lastRefreshIso,
    idTokenExpiresAt,
    idTokenExpiresIso: toIso(idTokenExpiresAt),
    idTokenExpiresIn: idTokenExpiresAt ? formatDuration(idTokenExpiresAt - ts) : null,
    isIdTokenExpired: Boolean(idTokenExpiresAt && idTokenExpiresAt <= ts),
    accessTokenExpiresAt,
    accessTokenExpiresIso: toIso(accessTokenExpiresAt),
    accessTokenExpiresIn: accessTokenExpiresAt ? formatDuration(accessTokenExpiresAt - ts) : null,
    isAccessTokenExpired: Boolean(accessTokenExpiresAt && accessTokenExpiresAt <= ts),
    suggestedAlias: buildSuggestedCliAlias({
      email,
      accountId,
      workspaceId,
      workspaceTitle
    })
  };
}

function buildCodexCliIdentity(meta) {
  if (!meta) return null;
  const parts = [
    String(meta.accountId || "").trim().toLowerCase(),
    String(meta.workspaceId || "").trim().toLowerCase(),
    String(meta.email || "").trim().toLowerCase()
  ];
  if (!parts.some(Boolean)) return null;
  return parts.join("|");
}

function validateCodexCliAuth(auth) {
  const tokens = isRecord(auth?.tokens) ? auth.tokens : {};
  if (!tokens.id_token) throw new Error("Current Codex CLI auth is missing id_token. Run codex login again.");
  if (!tokens.refresh_token) throw new Error("Current Codex CLI auth is missing refresh_token. Run codex login again.");
}

async function loadCodexCliConfigSummary() {
  const text = await readTextFile(CODEX_CLI_CONFIG_PATH, null);
  if (text == null) {
    return {
      model: null,
      reasoning: null,
      serviceTier: null
    };
  }
  const extract = (key) => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`, "m"));
    return match ? match[1].trim() || null : null;
  };
  return {
    model: extract("model"),
    reasoning: extract("model_reasoning_effort"),
    serviceTier: extract("service_tier")
  };
}

function buildCodexCliProfileView(profileId, entry, currentProfileId) {
  const meta = parseCodexCliAuthMetadata(entry?.auth || null);
  const savedAt = Number(entry?.savedAt || 0) || null;
  const updatedAt = Number(entry?.updatedAt || 0) || null;
  return {
    profileId,
    ...meta,
    savedAt,
    savedIso: toIso(savedAt),
    updatedAt,
    updatedIso: toIso(updatedAt),
    isCurrent: currentProfileId === profileId
  };
}

function findCodexCliProfileIdByIdentity(store, meta) {
  const target = buildCodexCliIdentity(meta);
  if (!target) return null;
  for (const [profileId, entry] of Object.entries(store.profiles || {})) {
    const existingMeta = parseCodexCliAuthMetadata(entry?.auth || null);
    if (buildCodexCliIdentity(existingMeta) === target) return profileId;
  }
  return null;
}

async function loadCodexCliStatus() {
  const [config, rawStore, currentAuth] = await Promise.all([
    loadCodexCliConfigSummary(),
    loadCodexCliStore(),
    readJsonFile(CODEX_CLI_AUTH_PATH, null)
  ]);
  const store = normalizeCodexCliStore(rawStore);
  const currentMeta = currentAuth ? parseCodexCliAuthMetadata(currentAuth) : null;
  const currentIdentity = buildCodexCliIdentity(currentMeta);
  let currentProfileId = null;
  const profiles = await Promise.all(Object.entries(store.profiles).map(async ([profileId, entry]) => {
    const view = buildCodexCliProfileView(profileId, entry, null);
    if (!currentProfileId && currentIdentity && buildCodexCliIdentity(view) === currentIdentity) {
      currentProfileId = profileId;
    }
    return {
      ...view,
      usage: await fetchCodexUsageFromAuthJson(entry?.auth || null)
    };
  }));

  profiles.sort((left, right) => {
    if (left.profileId === currentProfileId && right.profileId !== currentProfileId) return -1;
    if (right.profileId === currentProfileId && left.profileId !== currentProfileId) return 1;
    return (right.updatedAt || right.savedAt || 0) - (left.updatedAt || left.savedAt || 0);
  });

  const matchedCurrentProfile = currentProfileId
    ? profiles.find((profile) => profile.profileId === currentProfileId) || null
    : null;
  const currentUsage = matchedCurrentProfile
    ? matchedCurrentProfile.usage
    : currentAuth
      ? await fetchCodexUsageFromAuthJson(currentAuth)
      : null;

  return {
    config,
    paths: {
      authPath: CODEX_CLI_AUTH_PATH,
      configPath: CODEX_CLI_CONFIG_PATH,
      codexRoot: CODEX_HOME
    },
    current: currentMeta
      ? {
          ...currentMeta,
          usage: currentUsage,
          matchedProfileId: currentProfileId,
          authFilePresent: true
        }
      : {
          authFilePresent: false,
          matchedProfileId: null
        },
    profileCount: profiles.length,
    profiles: profiles.map((profile) => ({
      ...profile,
      isCurrent: profile.profileId === currentProfileId
    }))
  };
}

async function saveCurrentCodexCliProfile(alias) {
  const currentAuth = await readJsonFile(CODEX_CLI_AUTH_PATH, null);
  if (!currentAuth) throw new Error("No Codex CLI auth found. Run codex login first.");
  validateCodexCliAuth(currentAuth);
  const meta = parseCodexCliAuthMetadata(currentAuth);
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  const matchedProfileId = findCodexCliProfileIdByIdentity(store, meta);
  const requestedProfileId = alias ? sanitizeCliProfileId(alias) : null;
  let profileId = requestedProfileId || matchedProfileId || makeUniqueProfileId(meta.suggestedAlias, store.profiles);

  if (requestedProfileId && store.profiles[requestedProfileId] && requestedProfileId !== matchedProfileId) {
    throw new Error(`CLI profile already exists: ${requestedProfileId}`);
  }

  const existing = store.profiles[profileId];
  store.profiles[profileId] = {
    savedAt: Number(existing?.savedAt || 0) || nowTs(),
    updatedAt: nowTs(),
    auth: currentAuth
  };

  await writeJsonAtomicSecure(CODEX_CLI_STORE_PATH, store);
  return await loadCodexCliStatus();
}

async function activateCodexCliProfile(profileId) {
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  const entry = store.profiles[profileId];
  if (!entry) throw new Error(`Unknown CLI profile: ${profileId}`);
  validateCodexCliAuth(entry.auth);
  await writeJsonAtomicSecure(CODEX_CLI_AUTH_PATH, entry.auth);
  return await loadCodexCliStatus();
}

async function renameCodexCliProfile(profileId, alias) {
  const newProfileId = sanitizeCliProfileId(alias);
  if (newProfileId === profileId) return await loadCodexCliStatus();
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  if (!store.profiles[profileId]) throw new Error(`Unknown CLI profile: ${profileId}`);
  if (store.profiles[newProfileId]) throw new Error(`CLI profile already exists: ${newProfileId}`);
  store.profiles[newProfileId] = store.profiles[profileId];
  delete store.profiles[profileId];
  store.profiles[newProfileId].updatedAt = nowTs();
  await writeJsonAtomicSecure(CODEX_CLI_STORE_PATH, store);
  return await loadCodexCliStatus();
}

async function deleteCodexCliProfile(profileId) {
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  if (!store.profiles[profileId]) throw new Error(`Unknown CLI profile: ${profileId}`);
  delete store.profiles[profileId];
  await writeJsonAtomicSecure(CODEX_CLI_STORE_PATH, store);
  return await loadCodexCliStatus();
}

async function exchangeRefreshTokenForFullCodexTokens(refreshToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: String(refreshToken || "").trim(),
        client_id: OPENAI_OAUTH_CLIENT_ID
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const errorText = json?.error_description || json?.error || text || `HTTP ${response.status}`;
      throw new Error(`OpenAI token refresh failed: ${errorText}`);
    }
    if (!json?.access_token || !json?.refresh_token || !json?.id_token || typeof json?.expires_in !== "number") {
      throw new Error("OpenAI token refresh response is missing required fields.");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      idToken: json.id_token,
      expiresAt: nowTs() + json.expires_in * 1000
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OpenAI token refresh timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCodexCliAuthJson(fullTokens) {
  const accessMeta = parseCodexCliAuthMetadata({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fullTokens.idToken,
      access_token: fullTokens.accessToken,
      refresh_token: fullTokens.refreshToken,
      account_id: ""
    },
    last_refresh: new Date().toISOString()
  });
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fullTokens.idToken,
      access_token: fullTokens.accessToken,
      refresh_token: fullTokens.refreshToken,
      account_id: accessMeta.accountId
    },
    last_refresh: new Date().toISOString()
  };
}

async function upsertCodexCliProfileFromAuth(auth, preferredAlias) {
  validateCodexCliAuth(auth);
  const meta = parseCodexCliAuthMetadata(auth);
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  const matchedProfileId = findCodexCliProfileIdByIdentity(store, meta);
  const requestedProfileId = preferredAlias ? sanitizeCliProfileId(preferredAlias) : null;
  let profileId = matchedProfileId || requestedProfileId || makeUniqueProfileId(meta.suggestedAlias, store.profiles);
  if (requestedProfileId && store.profiles[requestedProfileId] && requestedProfileId !== matchedProfileId) {
    profileId = makeUniqueProfileId(requestedProfileId, store.profiles);
  }
  const existing = store.profiles[profileId];
  store.profiles[profileId] = {
    savedAt: Number(existing?.savedAt || 0) || nowTs(),
    updatedAt: nowTs(),
    auth
  };
  await writeJsonAtomicSecure(CODEX_CLI_STORE_PATH, store);
  return profileId;
}

async function fetchCodexUsageFromAccess(accessToken, accountId) {
  if (!accessToken) return { error: "missing access token" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "OpenClawCodexControl",
      Accept: "application/json"
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const response = await fetch(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    const windows = [];
    if (isRecord(data.rate_limit?.primary_window)) {
      const entry = data.rate_limit.primary_window;
      windows.push({
        label: `${Math.round((entry.limit_window_seconds || 10800) / 3600)}h`,
        usedPercent: clampPercent(entry.used_percent || 0),
        resetAt: entry.reset_at ? entry.reset_at * 1000 : null
      });
    }
    if (isRecord(data.rate_limit?.secondary_window)) {
      const entry = data.rate_limit.secondary_window;
      const hours = Math.round((entry.limit_window_seconds || 86400) / 3600);
      windows.push({
        label: hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`,
        usedPercent: clampPercent(entry.used_percent || 0),
        resetAt: entry.reset_at ? entry.reset_at * 1000 : null
      });
    }
    return {
      plan: data.plan_type || null,
      windows
    };
  } catch (error) {
    return { error: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCodexUsageFromAuthJson(auth) {
  const tokens = isRecord(auth?.tokens) ? auth.tokens : {};
  return await fetchCodexUsageFromAccess(tokens.access_token, tokens.account_id);
}

function ensureConfigAuthProfile(config, params) {
  const normalizedProvider = String(params.provider || "").toLowerCase();
  const nextConfig = isRecord(config) ? { ...config } : {};
  const auth = isRecord(nextConfig.auth) ? { ...nextConfig.auth } : {};
  const profiles = isRecord(auth.profiles) ? { ...auth.profiles } : {};
  profiles[params.profileId] = {
    provider: params.provider,
    mode: params.mode,
    ...(params.email ? { email: params.email } : {})
  };

  const existingProviderOrder = Array.isArray(auth.order?.[params.provider]) ? auth.order[params.provider] : undefined;
  const configuredProviderProfiles = Object.entries(profiles)
    .filter(([, profile]) => String(profile?.provider || "").toLowerCase() === normalizedProvider)
    .map(([profileId, profile]) => ({ profileId, mode: profile?.mode }));
  const preferProfileFirst = params.preferProfileFirst !== false;
  const reorderedProviderOrder = existingProviderOrder && preferProfileFirst
    ? [params.profileId, ...existingProviderOrder.filter((profileId) => profileId !== params.profileId)]
    : existingProviderOrder;
  const hasMixedConfiguredModes = configuredProviderProfiles.some(({ profileId, mode }) =>
    profileId !== params.profileId && mode !== params.mode
  );
  const derivedProviderOrder = existingProviderOrder === undefined && preferProfileFirst && hasMixedConfiguredModes
    ? [params.profileId, ...configuredProviderProfiles.map(({ profileId }) => profileId).filter((profileId) => profileId !== params.profileId)]
    : undefined;
  const order = existingProviderOrder !== undefined
    ? {
        ...(isRecord(auth.order) ? auth.order : {}),
        [params.provider]: reorderedProviderOrder?.includes(params.profileId)
          ? reorderedProviderOrder
          : [...(reorderedProviderOrder || []), params.profileId]
      }
    : derivedProviderOrder
      ? {
          ...(isRecord(auth.order) ? auth.order : {}),
          [params.provider]: derivedProviderOrder
        }
      : auth.order;

  return {
    ...nextConfig,
    auth: {
      ...auth,
      profiles,
      ...(order ? { order } : {})
    }
  };
}

function summarizeLoginSession() {
  if (!activeLogin) return null;
  return {
    id: activeLogin.id,
    status: activeLogin.status,
    targetProfileId: activeLogin.targetProfileId || null,
    authUrl: activeLogin.authUrl || null,
    instructions: activeLogin.instructions || null,
    progress: activeLogin.progress || null,
    error: activeLogin.error || null,
    result: activeLogin.result || null,
    createdAt: activeLogin.createdAt,
    updatedAt: activeLogin.updatedAt
  };
}

function updateActiveLogin(patch) {
  if (!activeLogin) return;
  Object.assign(activeLogin, patch, { updatedAt: nowTs() });
}

function isTerminalLoginStatus(status) {
  return status === "completed" || status === "error" || status === "cancelled";
}

function renameProfileInState(config, store, profileId, newProfileId) {
  if (newProfileId === profileId) return;
  if (!store.profiles?.[profileId]) throw new Error(`Unknown profile: ${profileId}`);
  if (store.profiles[newProfileId]) throw new Error(`Profile already exists: ${newProfileId}`);

  const profileValue = store.profiles[profileId];
  delete store.profiles[profileId];
  store.profiles[newProfileId] = profileValue;

  if (isRecord(store.usageStats) && profileId in store.usageStats) {
    store.usageStats[newProfileId] = store.usageStats[profileId];
    delete store.usageStats[profileId];
  }
  if (isRecord(store.lastGood)) {
    for (const [provider, value] of Object.entries(store.lastGood)) {
      if (value === profileId) store.lastGood[provider] = newProfileId;
    }
  }
  if (isRecord(store.order)) {
    for (const [provider, list] of Object.entries(store.order)) {
      store.order[provider] = replaceProfileIdInArray(list, profileId, newProfileId);
    }
  }

  if (isRecord(config.auth?.profiles) && profileId in config.auth.profiles) {
    config.auth.profiles[newProfileId] = config.auth.profiles[profileId];
    delete config.auth.profiles[profileId];
  }
  if (isRecord(config.auth?.order)) {
    for (const [provider, list] of Object.entries(config.auth.order)) {
      config.auth.order[provider] = replaceProfileIdInArray(list, profileId, newProfileId);
    }
  }
}

async function persistOAuthLogin(params) {
  let [config, store] = await Promise.all([loadConfig(), loadStore()]);
  config = isRecord(config) ? config : {};
  store = isRecord(store) ? store : { version: 1, profiles: {} };
  store.profiles = isRecord(store.profiles) ? store.profiles : {};

  const email = String(parseProfileMetadata("incoming", {
    type: "oauth",
    access: params.creds.access,
    accountId: params.creds.accountId
  }).email || "").trim() || null;
  const targetProfileId = String(params.targetProfileId || "").trim() || null;
  let profileId = targetProfileId || naturalProfileIdForEmail(email);
  const existingTarget = store.profiles[profileId];

  if (existingTarget && existingTarget.provider !== PROVIDER) {
    throw new Error(`Profile ${profileId} belongs to provider ${existingTarget.provider}.`);
  }

  let preservedProfileId = null;
  if (!targetProfileId && existingTarget) {
    const existingMeta = parseProfileMetadata(profileId, existingTarget);
    const existingAccountId = existingMeta.accountId;
    if (existingAccountId && params.creds.accountId && existingAccountId !== params.creds.accountId) {
      const suggestedBase = existingMeta.suggestedAlias;
      preservedProfileId = makeUniqueProfileId(suggestedBase, store.profiles);
      renameProfileInState(config, store, profileId, preservedProfileId);
    }
  }

  store.profiles[profileId] = {
    type: "oauth",
    provider: PROVIDER,
    access: params.creds.access,
    refresh: params.creds.refresh,
    expires: params.creds.expires,
    accountId: params.creds.accountId,
    ...(email ? { email } : {})
  };

  config = ensureConfigAuthProfile(config, {
    profileId,
    provider: PROVIDER,
    mode: "oauth",
    email
  });

  await Promise.all([
    writeJsonAtomic(CONFIG_PATH, config),
    writeJsonAtomic(AUTH_STORE_PATH, store)
  ]);

  return {
    profileId,
    email,
    accountId: params.creds.accountId || null,
    preservedProfileId
  };
}

async function startLoginSession(params = {}) {
  if (activeLogin && !isTerminalLoginStatus(activeLogin.status)) {
    return summarizeLoginSession();
  }

  const login = {
    id: crypto.randomUUID(),
    createdAt: nowTs(),
    updatedAt: nowTs(),
    status: "starting",
    progress: "Starting OAuth flow…",
    error: null,
    authUrl: null,
    instructions: null,
    targetProfileId: String(params.targetProfileId || "").trim() || null,
    result: null,
    manualInput: createDeferred()
  };
  activeLogin = login;

  const authReady = createDeferred();
  void (async () => {
    try {
      const oauthModule = await import(pathToFileURL(OAUTH_HELPER_PATH).href);
      const creds = await oauthModule.loginOpenAICodex({
        originator: "openclaw-codex-control",
        onAuth({ url, instructions }) {
          updateActiveLogin({
            status: "awaiting-browser",
            authUrl: url,
            instructions: instructions || "Open the login page and complete the OAuth flow."
          });
          authReady.resolve();
        },
        onProgress(message) {
          updateActiveLogin({ progress: String(message || "") });
        },
        async onManualCodeInput() {
          updateActiveLogin({
            status: "waiting-callback",
            progress: "Waiting for browser callback or pasted redirect URL…"
          });
          return await login.manualInput.promise;
        },
        async onPrompt(prompt) {
          updateActiveLogin({
            status: "waiting-callback",
            progress: prompt?.message || "Paste the final redirect URL or authorization code."
          });
          return await login.manualInput.promise;
        }
      });

      updateActiveLogin({
        status: "saving",
        progress: "Saving OAuth credentials…"
      });
      const persisted = await persistOAuthLogin({
        creds,
        targetProfileId: login.targetProfileId
      });
      updateActiveLogin({
        status: "completed",
        progress: "OAuth login complete.",
        result: persisted
      });
      authReady.resolve();
    } catch (error) {
      updateActiveLogin({
        status: login.status === "cancelled" ? "cancelled" : "error",
        error: String(error?.message || error),
        progress: null
      });
      authReady.resolve();
    }
  })();

  await Promise.race([
    authReady.promise,
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  return summarizeLoginSession();
}

async function submitLoginInput(input) {
  if (!activeLogin || isTerminalLoginStatus(activeLogin.status)) {
    throw new Error("No active login session.");
  }
  const value = String(input || "").trim();
  if (!value) throw new Error("Redirect URL or authorization code is required.");
  updateActiveLogin({
    status: "waiting-exchange",
    progress: "Exchanging authorization code for token…"
  });
  activeLogin.manualInput.resolve(value);
  return summarizeLoginSession();
}

async function cancelLoginSession() {
  if (!activeLogin || isTerminalLoginStatus(activeLogin.status)) {
    return summarizeLoginSession();
  }
  updateActiveLogin({
    status: "cancelled",
    error: "Login cancelled.",
    progress: null
  });
  activeLogin.manualInput.reject(new Error("Login cancelled."));
  return summarizeLoginSession();
}

async function fetchCodexUsage(profile) {
  return await fetchCodexUsageFromAccess(profile?.access, profile?.accountId);
}

function buildProfileView(profileId, profile, store, config, effectiveOrder, usageById) {
  const ts = nowTs();
  const stats = store.usageStats?.[profileId] || {};
  const cooldownUntil = resolveCooldownUntil(stats);
  const meta = parseProfileMetadata(profileId, profile);
  const explicitOrder = Array.isArray(store.order?.[PROVIDER]) ? store.order[PROVIDER] : null;
  const expiresAt = Number(profile?.expires || 0) || null;
  return {
    profileId,
    email: meta.email,
    accountId: meta.accountId,
    accountShort: shortId(meta.accountId),
    plan: usageById[profileId]?.plan || meta.plan || null,
    type: profile.type,
    expiresAt,
    expiresIso: toIso(expiresAt),
    expiresIn: expiresAt ? formatDuration(expiresAt - ts) : null,
    isExpired: Boolean(expiresAt && expiresAt <= ts),
    isExpiringSoon: Boolean(expiresAt && expiresAt > ts && expiresAt - ts <= EXPIRING_SOON_MS),
    lastUsedAt: Number(stats.lastUsed || 0) || null,
    lastUsedIso: Number(stats.lastUsed || 0) ? toIso(Number(stats.lastUsed || 0)) : null,
    errorCount: Number(stats.errorCount || 0),
    cooldownUntil,
    cooldownIso: toIso(cooldownUntil),
    cooldownIn: cooldownUntil ? formatDuration(cooldownUntil - ts) : null,
    isNext: effectiveOrder[0] === profileId,
    isLastGood: store.lastGood?.[PROVIDER] === profileId,
    isPinned: explicitOrder ? explicitOrder[0] === profileId : false,
    isInCooldown: isInCooldown(stats, ts),
    suggestedAlias: meta.suggestedAlias,
    usage: usageById[profileId] || null,
    configProfile: config.auth?.profiles?.[profileId] || null
  };
}

async function loadStatus(includeUsage = true) {
  const [config, store, codexCli, autopilot, intelStore, memoryStore, evolutionStore, recentEvents] = await Promise.all([
    loadConfig(),
    loadStore(),
    loadCodexCliStatus(),
    loadAutopilotStatus(),
    loadIntelStore(),
    loadMemoryStore(),
    loadEvolutionStore(),
    readRecentSystemEvents(24)
  ]);
  const profileIds = listProviderProfileIds(store);
  const effectiveOrder = computeEffectiveOrder(store, config, profileIds);
  const usageById = {};
  if (includeUsage) {
    await Promise.all(profileIds.map(async (profileId) => {
      usageById[profileId] = await fetchCodexUsage(store.profiles[profileId]);
    }));
  }
  return {
    config: {
      defaultModel: config.agents?.defaults?.model?.primary || null,
      imageModel: config.agents?.defaults?.imageModel?.primary || null,
      thinkingDefault: config.agents?.defaults?.thinkingDefault || null,
      workspace: config.agents?.defaults?.workspace || null
    },
    auth: {
      explicitOrder: Array.isArray(store.order?.[PROVIDER]) ? store.order[PROVIDER] : null,
      configOrder: Array.isArray(config.auth?.order?.[PROVIDER]) ? config.auth.order[PROVIDER] : null,
      effectiveOrder,
      autoMode: !Array.isArray(store.order?.[PROVIDER]),
      profileCount: profileIds.length,
      lastGood: store.lastGood?.[PROVIDER] || null
    },
    codexCli,
    autopilot,
    intel: buildIntelStatus(intelStore),
    memory: buildMemoryStatus(memoryStore),
    evolution: buildEvolutionStatus(evolutionStore),
    recentEvents,
    login: summarizeLoginSession(),
    profiles: profileIds.map((profileId) =>
      buildProfileView(profileId, store.profiles[profileId], store, config, effectiveOrder, usageById)
    )
  };
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text.trim() ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(JSON.stringify(body));
}

function sendJs(res, source) {
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(source);
}

function isLoopbackAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "127.0.0.1" || text === "::1" || text === "::ffff:127.0.0.1";
}

function isTrustedPluginApiRequest(req) {
  const host = String(req.headers?.host || "").trim().toLowerCase();
  const origin = String(req.headers?.origin || "").trim();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  const site = String(req.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
  if (site === "same-origin" || site === "same-site") return true;
  return isLoopbackAddress(req.socket?.remoteAddress);
}

function enforcePluginApiAccess(req, res) {
  if (isTrustedPluginApiRequest(req)) return true;
  sendJson(res, 403, { error: "forbidden" });
  return false;
}

async function selectProfile(profileId) {
  const [config, store] = await Promise.all([loadConfig(), loadStore()]);
  const profileIds = listProviderProfileIds(store);
  if (!profileIds.includes(profileId)) throw new Error(`Unknown profile: ${profileId}`);
  const order = dedupe([profileId, ...computeEffectiveOrder(store, config, profileIds), ...profileIds]);
  store.order = isRecord(store.order) ? store.order : {};
  store.order[PROVIDER] = order;
  await writeJsonAtomic(AUTH_STORE_PATH, store);
}

async function clearProfileOrder() {
  const store = await loadStore();
  if (isRecord(store.order) && PROVIDER in store.order) {
    delete store.order[PROVIDER];
    if (Object.keys(store.order).length === 0) delete store.order;
    await writeJsonAtomic(AUTH_STORE_PATH, store);
  }
}

async function activateOpenClawProfileForCodexCli(profileId, setOpenClawCurrent = false) {
  const [config, store] = await Promise.all([loadConfig(), loadStore()]);
  const profile = store?.profiles?.[profileId];
  if (!profile || profile.provider !== PROVIDER) throw new Error(`Unknown profile: ${profileId}`);
  if (!profile.refresh) throw new Error(`Profile ${profileId} is missing refresh token.`);
  const fullTokens = await exchangeRefreshTokenForFullCodexTokens(profile.refresh);
  const cliAuth = buildCodexCliAuthJson(fullTokens);
  await writeJsonAtomicSecure(CODEX_CLI_AUTH_PATH, cliAuth);
  await upsertCodexCliProfileFromAuth(cliAuth, profileId.replace(/^openai-codex:/, ""));

  if (setOpenClawCurrent) {
    const profileIds = listProviderProfileIds(store);
    const order = dedupe([profileId, ...computeEffectiveOrder(store, config, profileIds), ...profileIds]);
    store.order = isRecord(store.order) ? store.order : {};
    store.order[PROVIDER] = order;
    await writeJsonAtomic(AUTH_STORE_PATH, store);
  }

  return await loadStatus(true);
}

function replaceProfileIdInArray(values, oldId, newId) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => (value === oldId ? newId : value));
}

async function renameProfile(profileId, alias) {
  const newProfileId = sanitizeAlias(alias);
  if (newProfileId === profileId) return;

  const [config, store] = await Promise.all([loadConfig(), loadStore()]);
  renameProfileInState(config, store, profileId, newProfileId);

  await Promise.all([
    writeJsonAtomic(CONFIG_PATH, config),
    writeJsonAtomic(AUTH_STORE_PATH, store)
  ]);
}

module.exports = {
  id: "openclaw-codex-control",
  name: "OpenClaw Codex Control",
  register(api) {
    pluginApi = api;
    const routeBase = String(api.pluginConfig?.routeBase || DEFAULT_ROUTE_BASE).trim() || DEFAULT_ROUTE_BASE;
    const injectPath = `${routeBase}/inject.js`;
    const apiBase = `${routeBase}/api`;

    api.registerHttpRoute({
      path: injectPath,
      auth: "plugin",
      match: "exact",
      handler(req, res) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { Allow: "GET, HEAD" });
          res.end("Method Not Allowed");
          return true;
        }
        const source = fs.readFileSync(INJECT_JS_PATH, "utf8");
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache"
          });
          res.end();
          return true;
        }
        sendJs(res, source.replaceAll("__ROUTE_BASE__", routeBase));
        return true;
      }
    });

    api.registerHttpRoute({
      path: apiBase,
      auth: "plugin",
      match: "prefix",
      async handler(req, res) {
        const url = new URL(req.url || "/", "http://localhost");
        const pathname = url.pathname;
        try {
          if (!enforcePluginApiAccess(req, res)) return true;

          if (pathname === `${apiBase}/status` && req.method === "GET") {
            sendJson(res, 200, await loadStatus(true));
            return true;
          }

          if (pathname === `${apiBase}/autopilot/status` && req.method === "GET") {
            sendJson(res, 200, await loadAutopilotStatus());
            return true;
          }

          if (pathname === `${apiBase}/intel/status` && req.method === "GET") {
            sendJson(res, 200, buildIntelStatus(await loadIntelStore()));
            return true;
          }

          if (pathname === `${apiBase}/intel/run` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await runIntelMaintenance({
              domainId: normalizeString(body.domainId),
              forceRefresh: Boolean(body.forceRefresh),
              forceDigest: Boolean(body.forceDigest)
            }));
            return true;
          }

          if (pathname === `${apiBase}/memory/status` && req.method === "GET") {
            sendJson(res, 200, buildMemoryStatus(await loadMemoryStore()));
            return true;
          }

          if (pathname === `${apiBase}/memory/invalidate` && req.method === "POST") {
            const body = await readJsonBody(req);
            const reasonEvent = await appendSystemEvent("memory_invalidation_requested", {
              memoryIds: normalizeStringArray(body.memoryIds || []),
              reason: normalizeString(body.reason)
            });
            sendJson(
              res,
              200,
              await invalidateMemoryLineage(normalizeStringArray(body.memoryIds || []), reasonEvent.eventId)
            );
            return true;
          }

          if (pathname === `${apiBase}/evolution/status` && req.method === "GET") {
            sendJson(res, 200, buildEvolutionStatus(await loadEvolutionStore()));
            return true;
          }

          if (pathname === `${apiBase}/evolution/run` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await runEvolutionReview({ force: Boolean(body.force) }));
            return true;
          }

          if (pathname === `${apiBase}/events/recent` && req.method === "GET") {
            const limit = clampInt(url.searchParams.get("limit"), 24, 1, 200);
            sendJson(res, 200, await readRecentSystemEvents(limit));
            return true;
          }

          if (pathname === `${apiBase}/autopilot/config` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await updateAutopilotConfig(body.config));
            return true;
          }

          if (pathname === `${apiBase}/autopilot/task/upsert` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await upsertAutopilotTask(isRecord(body.task) ? body.task : body));
            return true;
          }

          if (pathname === `${apiBase}/autopilot/task/transition` && req.method === "POST") {
            const body = await readJsonBody(req);
            const transitionPatch = {
              status: body.status,
              runState: isRecord(body.runState) ? body.runState : {
                lastResultStatus: body.status,
                lastResultSummary: body.summary,
                lastWorkerOutput: body.workerOutput
              }
            };
            const optionalKeys = [
              "notes",
              "nextRunAt",
              "lastError",
              "planSummary",
              "nextAction",
              "blockedReason",
              "assignee",
              "route",
              "workspace",
              "priority",
              "budgetMode",
              "retrievalMode",
              "reportPolicy",
              "successCriteria",
              "doneCriteria",
              "skillHints",
              "memoryRefs",
              "intelRefs",
              "optimizationState"
            ];
            for (const key of optionalKeys) {
              if (body[key] !== undefined) transitionPatch[key] = body[key];
            }
            if (body.lastResult !== undefined || body.summary !== undefined) {
              transitionPatch.lastResult = body.lastResult !== undefined ? body.lastResult : body.summary;
            }
            sendJson(
              res,
              200,
              await transitionAutopilotTask(String(body.taskId || "").trim(), transitionPatch)
            );
            return true;
          }

          if (pathname === `${apiBase}/autopilot/task/delete` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await deleteAutopilotTask(String(body.taskId || "").trim()));
            return true;
          }

          if (pathname === `${apiBase}/login/status` && req.method === "GET") {
            sendJson(res, 200, summarizeLoginSession());
            return true;
          }

          if (pathname === `${apiBase}/profile/select` && req.method === "POST") {
            const body = await readJsonBody(req);
            await selectProfile(String(body.profileId || "").trim());
            sendJson(res, 200, await loadStatus(true));
            return true;
          }

          if (pathname === `${apiBase}/profile/auto` && req.method === "POST") {
            await clearProfileOrder();
            sendJson(res, 200, await loadStatus(true));
            return true;
          }

          if (pathname === `${apiBase}/profile/rename` && req.method === "POST") {
            const body = await readJsonBody(req);
            await renameProfile(String(body.profileId || "").trim(), String(body.alias || "").trim());
            sendJson(res, 200, await loadStatus(true));
            return true;
          }

          if (pathname === `${apiBase}/login/start` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await startLoginSession({
              targetProfileId: String(body.targetProfileId || "").trim() || null
            }));
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/save-current` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await saveCurrentCodexCliProfile(String(body.alias || "").trim()));
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/activate` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await activateCodexCliProfile(String(body.profileId || "").trim()));
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/activate-from-openclaw` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(
              res,
              200,
              await activateOpenClawProfileForCodexCli(
                String(body.profileId || "").trim(),
                Boolean(body.setOpenClawCurrent)
              )
            );
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/rename` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(
              res,
              200,
              await renameCodexCliProfile(String(body.profileId || "").trim(), String(body.alias || "").trim())
            );
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/delete` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await deleteCodexCliProfile(String(body.profileId || "").trim()));
            return true;
          }

          if (pathname === `${apiBase}/login/submit` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await submitLoginInput(String(body.input || "").trim()));
            return true;
          }

          if (pathname === `${apiBase}/login/cancel` && req.method === "POST") {
            sendJson(res, 200, await cancelLoginSession());
            return true;
          }

          sendJson(res, 404, { error: "not found" });
          return true;
        } catch (error) {
          api.logger.warn(`[openclaw-codex-control] ${pathname} failed: ${String(error?.message || error)}`);
          sendJson(res, 500, { error: String(error?.message || error) });
          return true;
        }
      }
    });

    api.logger.info(`[openclaw-codex-control] injection script: ${injectPath}`);
    api.logger.info(`[openclaw-codex-control] api base: ${apiBase}`);

    api.on("before_prompt_build", async (_event, ctx) => {
      try {
        const sessionKey = normalizeString(ctx?.sessionKey);
        if (!sessionKey) return;
        const agentId = normalizeString(ctx?.agentId, "main");
        const store = await loadAutopilotStore();
        if (store.config.heartbeatEnabled && await isHeartbeatSession(agentId, sessionKey)) {
          const heartbeatBlock = buildHeartbeatAutopilotContext(buildAutopilotStatus(store));
          if (heartbeatBlock) {
            return {
              prependContext: heartbeatBlock
            };
          }
        }
        const task = await captureAutopilotTaskFromSession(ctx);
        if (!task) return;
        const block = buildAutopilotPromptBlock(task, store.config);
        if (!block) return;
        return {
          prependContext: block
        };
      } catch (error) {
        api.logger.warn(`[openclaw-codex-control] before_prompt_build capture failed: ${String(error?.message || error)}`);
        return;
      }
    }, { priority: 18 });

    startAutopilotTicker();
  }
};
