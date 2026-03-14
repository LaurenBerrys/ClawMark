const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { buildManagedRuntimeEnv, resolveControlExtensionPaths } = require("./lib/instance-paths.js");

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
const SKILL_GOVERNANCE_STORE_PATH = path.join(CONTROL_STATE_DIR, "skill-governance.json");
const INJECT_JS_PATH = path.join(__dirname, "ui", "inject.js");
const OAUTH_HELPER_PATH = INSTANCE_PATHS.oauthHelperPath;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;
const AUTOPILOT_TICK_MS = 60 * 1000;
const INTEL_DIGEST_RETRY_BACKOFF_MS = 30 * 60 * 1000;
const EVENT_LOG_TAIL_LIMIT = 120;
const AUTOPILOT_TASK_STATUSES = new Set([
  "queued",
  "planning",
  "ready",
  "running",
  "blocked",
  "waiting_external",
  "waiting_user",
  "completed",
  "cancelled",
]);
const AUTOPILOT_PRIORITIES = new Set(["low", "normal", "high"]);
const AUTOPILOT_BUDGET_MODES = new Set(["strict", "balanced", "deep"]);
const AUTOPILOT_RETRIEVAL_MODES = new Set(["off", "light", "deep"]);
const AUTOPILOT_REPORT_POLICIES = new Set([
  "reply_and_proactive",
  "reply_only",
  "proactive_only",
  "silent",
]);
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
  dailyRemoteTokenBudget: 250000,
});

let activeLogin = null;
let autopilotTicker = null;
const autopilotRuntime = {
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  lastSnapshot: null,
  activeTaskId: null,
  activeTaskStartedAt: null,
};
const intelRuntime = {
  activeDomainId: null,
  activeDigestDomainId: null,
  lastTickAt: null,
  lastError: null,
};
const evolutionRuntime = {
  active: false,
  lastTickAt: null,
  lastError: null,
  lastReviewAt: null,
};

const skillGovernanceRuntime = {
  mtimeMs: 0,
  store: null,
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
  return crypto
    .createHash("sha1")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, size);
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
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
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
    ["m", 60 * 1000],
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
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

let managedRuntimeDecisionCorePromise = null;
let managedRuntimeTaskArtifactsPromise = null;
let managedRuntimeStorePromise = null;
let managedRuntimeTaskEnginePromise = null;
let managedRuntimeIntelRefreshPromise = null;
let managedRuntimeMutationsPromise = null;
let managedRuntimeTaskArtifactsWarned = false;

async function loadManagedRuntimeDecisionCore() {
  if (!managedRuntimeDecisionCorePromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "decision-core.js"),
    ).href;
    managedRuntimeDecisionCorePromise = import(modulePath).catch((error) => {
      managedRuntimeDecisionCorePromise = null;
      throw error;
    });
  }
  return managedRuntimeDecisionCorePromise;
}

async function loadManagedRuntimeTaskArtifactsCore() {
  if (!managedRuntimeTaskArtifactsPromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "task-artifacts.js"),
    ).href;
    managedRuntimeTaskArtifactsPromise = import(modulePath).catch((error) => {
      managedRuntimeTaskArtifactsPromise = null;
      throw error;
    });
  }
  return managedRuntimeTaskArtifactsPromise;
}

async function loadManagedRuntimeStoreCore() {
  if (!managedRuntimeStorePromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "store.js"),
    ).href;
    managedRuntimeStorePromise = import(modulePath).catch((error) => {
      managedRuntimeStorePromise = null;
      throw error;
    });
  }
  return managedRuntimeStorePromise;
}

async function loadManagedRuntimeTaskEngineCore() {
  if (!managedRuntimeTaskEnginePromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "task-engine.js"),
    ).href;
    managedRuntimeTaskEnginePromise = import(modulePath).catch((error) => {
      managedRuntimeTaskEnginePromise = null;
      throw error;
    });
  }
  return managedRuntimeTaskEnginePromise;
}

async function loadManagedRuntimeIntelRefreshCore() {
  if (!managedRuntimeIntelRefreshPromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "intel-refresh.js"),
    ).href;
    managedRuntimeIntelRefreshPromise = import(modulePath).catch((error) => {
      managedRuntimeIntelRefreshPromise = null;
      throw error;
    });
  }
  return managedRuntimeIntelRefreshPromise;
}

async function loadManagedRuntimeMutationsCore() {
  if (!managedRuntimeMutationsPromise) {
    const modulePath = pathToFileURL(
      path.join(__dirname, "..", "..", "dist", "shared", "runtime", "mutations.js"),
    ).href;
    managedRuntimeMutationsPromise = import(modulePath).catch((error) => {
      managedRuntimeMutationsPromise = null;
      throw error;
    });
  }
  return managedRuntimeMutationsPromise;
}

function managedRuntimeStoreOptions(nowValue = nowTs()) {
  return {
    env: buildManagedRuntimeEnv(process.env, INSTANCE_PATHS),
    now: nowValue,
  };
}

function resolveAgentSessionsStorePath(agentId = "main") {
  return path.join(
    INSTANCE_PATHS.agentsRoot,
    normalizeString(agentId, "main"),
    "sessions",
    "sessions.json",
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
    replyTo: conversationInfo.message_id || null,
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
      transcriptTimestamp: entry?.timestamp || null,
    }),
    delivery,
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
      env,
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
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(),
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
        stderr: `${stderr}\n${String(error?.message || error)}`.trim(),
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
        stderr,
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
  return dedupe(value.map((entry) => normalizeString(entry)).filter(Boolean));
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
  if (!task.nextRunAt)
    return (
      task.status === "queued" ||
      task.status === "planning" ||
      task.status === "ready" ||
      task.status === "blocked"
    );
  return task.nextRunAt <= ts;
}

function compareAutopilotTasks(left, right) {
  const priorityRank = {
    high: 0,
    normal: 1,
    low: 2,
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
    cancelled: 8,
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
    replyTo: normalizeString(source.replyTo) || null,
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
    transcriptTimestamp: normalizeString(source.transcriptTimestamp) || null,
  };
}

function normalizeAutopilotRunState(value) {
  const source = isRecord(value) ? value : {};
  return {
    lastResultStatus: normalizeOptionalAutopilotStatusValue(source.lastResultStatus),
    lastResultSummary: normalizeString(source.lastResultSummary) || null,
    lastWorkerOutput: normalizeString(source.lastWorkerOutput) || null,
    lastCliExitCode: Number.isFinite(Number(source.lastCliExitCode))
      ? Number(source.lastCliExitCode)
      : null,
    backgroundSessionId: normalizeString(source.backgroundSessionId) || null,
    blockedAt: parseOptionalTimestamp(source.blockedAt),
    completedAt: parseOptionalTimestamp(source.completedAt),
    lastNotifyAt: parseOptionalTimestamp(source.lastNotifyAt),
    lastNotifiedStatus: normalizeOptionalAutopilotStatusValue(source.lastNotifiedStatus),
    memoryLoggedStatuses: dedupe(
      normalizeStringArray(source.memoryLoggedStatuses)
        .map((entry) => normalizeOptionalAutopilotStatusValue(entry))
        .filter(Boolean),
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
    remoteCallCount: clampInt(source.remoteCallCount, 0, 0, 100000),
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
    updatedAt: parseOptionalTimestamp(source.updatedAt),
  };
}

function buildDefaultSkillGovernanceStore() {
  return {
    version: 1,
    scannedAt: null,
    rules: {
      enforceDecisionFilter: false,
      allowedDecisionStates: [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES],
    },
    skills: [],
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
        : [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES],
    },
    skills: (Array.isArray(source.skills) ? source.skills : [])
      .map((entry) => normalizeSkillGovernanceEntry(entry))
      .filter((entry) => entry.id),
  };
}

function loadSkillGovernanceStoreSync() {
  try {
    if (!fs.existsSync(SKILL_GOVERNANCE_STORE_PATH)) {
      return buildDefaultSkillGovernanceStore();
    }
    const stat = fs.statSync(SKILL_GOVERNANCE_STORE_PATH);
    if (skillGovernanceRuntime.store && skillGovernanceRuntime.mtimeMs === stat.mtimeMs) {
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
    path.join(CODEX_SKILLS_DIR, ".system", skillId, "SKILL.md"),
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
      : [...SKILL_GOVERNANCE_ALLOWED_DECISION_STATES],
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
    .filter(
      (entry) =>
        entry.length >= 2 &&
        !/^(please|thanks|task|agent|with|from|that|this|have|will)$/.test(entry),
    );
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
    "行的",
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
    /notify/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isLikelyTaskText(text) {
  const normalized = normalizeString(text);
  if (!normalized) return false;
  if (isLikelyHumanAck(normalized)) return false;
  const inboundMediaPrefix = path
    .join(INSTANCE_PATHS.stateRoot, "media", "inbound")
    .replace(/\\/g, "/");
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
    /^continue /,
  ];
  return normalized.length <= 120 && patterns.some((pattern) => pattern.test(normalized));
}

function classifyTaskRoute(text) {
  const normalized = normalizeString(text).toLowerCase();
  const mediaPatterns = [
    /ocr/,
    /图片/,
    /截图/,
    /长图/,
    /视频/,
    /音频/,
    /表格/,
    /文档整理/,
    /识别/,
    /提取/,
  ];
  const officePatterns = [
    /飞书/,
    /企微/,
    /微信/,
    /文档/,
    /多维表格/,
    /bitable/,
    /日历/,
    /任务/,
    /待办/,
    /提醒/,
    /通知/,
  ];
  const coderPatterns = [
    /代码/,
    /repo/,
    /git/,
    /commit/,
    /pull request/,
    /pr/,
    /接口/,
    /api/,
    /服务开发/,
    /编程/,
    /写代码/,
    /开发/,
    /实现/,
  ];
  const opsPatterns = [
    /日志/,
    /端口/,
    /服务/,
    /重启/,
    /部署/,
    /nginx/,
    /docker/,
    /cloudflared/,
    /故障/,
    /排障/,
    /监控/,
    /修复/,
    /运维/,
  ];
  const researchPatterns = [
    /调研/,
    /研究/,
    /咨询/,
    /对比/,
    /比较/,
    /搜索/,
    /搜集/,
    /资料/,
    /信息/,
    /知识库/,
    /方案/,
  ];
  if (mediaPatterns.some((pattern) => pattern.test(normalized)))
    return { route: "media", assignee: "media" };
  if (coderPatterns.some((pattern) => pattern.test(normalized)))
    return { route: "coder", assignee: "coder" };
  if (opsPatterns.some((pattern) => pattern.test(normalized)))
    return { route: "ops", assignee: "ops" };
  if (officePatterns.some((pattern) => pattern.test(normalized)))
    return { route: "office", assignee: "office" };
  if (researchPatterns.some((pattern) => pattern.test(normalized)))
    return { route: "research", assignee: "research" };
  return { route: "general", assignee: "main" };
}

function buildSkillHintsForTask(route, text) {
  const normalized = normalizeString(text).toLowerCase();
  const hints = ["personal-superintelligence", "personal-memory-maintainer"];
  if (route === "office") {
    hints.push(
      "personal-office-executor",
      "feishu-task",
      "feishu-bitable",
      "feishu-create-doc",
      "feishu-update-doc",
      "feishu-im-read",
    );
    if (/表格|图片|ocr|截图|多维表格/.test(normalized))
      hints.push("image-to-feishu-table", "image-ocr");
  } else if (route === "media") {
    hints.push(
      "personal-media-executor",
      "image-ocr",
      "image-to-feishu-table",
      "word-docx",
      "video-frames",
    );
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
  const match = String(rawText || "").match(
    /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i,
  );
  return safeParseJson(match?.[1] || "", {});
}

function extractSenderInfoJson(rawText) {
  const match = String(rawText || "").match(
    /Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i,
  );
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
    shouldNotify:
      source.shouldNotify !== false &&
      (status === "completed" || status === "blocked" || status === "waiting_user"),
    notes: normalizeString(source.notes),
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
    summary: text.trim().slice(-1000),
  });
}

function normalizeAutopilotConfig(config) {
  const source = isRecord(config) ? config : {};
  return {
    enabled: source.enabled == null ? DEFAULT_AUTOPILOT_CONFIG.enabled : Boolean(source.enabled),
    localFirst: source.localFirst !== false,
    heartbeatEnabled:
      source.heartbeatEnabled == null
        ? DEFAULT_AUTOPILOT_CONFIG.heartbeatEnabled
        : Boolean(source.heartbeatEnabled),
    defaultBudgetMode: pickEnum(
      source.defaultBudgetMode,
      AUTOPILOT_BUDGET_MODES,
      DEFAULT_AUTOPILOT_CONFIG.defaultBudgetMode,
    ),
    defaultRetrievalMode: pickEnum(
      source.defaultRetrievalMode,
      AUTOPILOT_RETRIEVAL_MODES,
      DEFAULT_AUTOPILOT_CONFIG.defaultRetrievalMode,
    ),
    maxInputTokensPerTurn: clampInt(
      source.maxInputTokensPerTurn,
      DEFAULT_AUTOPILOT_CONFIG.maxInputTokensPerTurn,
      500,
      50000,
    ),
    maxContextChars: clampInt(
      source.maxContextChars,
      DEFAULT_AUTOPILOT_CONFIG.maxContextChars,
      1000,
      100000,
    ),
    maxRemoteCallsPerTask: clampInt(
      source.maxRemoteCallsPerTask,
      DEFAULT_AUTOPILOT_CONFIG.maxRemoteCallsPerTask,
      1,
      50,
    ),
    dailyRemoteTokenBudget: clampInt(
      source.dailyRemoteTokenBudget,
      DEFAULT_AUTOPILOT_CONFIG.dailyRemoteTokenBudget,
      10000,
      10000000,
    ),
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
    source.skillHints,
  );
  if ((status === "blocked" || status === "waiting_user") && !runState.blockedAt)
    runState.blockedAt = updatedAt;
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
    tags: normalizeKeywordTags(
      Array.isArray(source.tags) && source.tags.length ? source.tags : derivedTags,
    ),
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
    retrievalMode: pickEnum(
      source.retrievalMode,
      AUTOPILOT_RETRIEVAL_MODES,
      defaults.defaultRetrievalMode,
    ),
    localOnly: Boolean(source.localOnly),
    localFirst: source.localFirst !== false,
    createdAt,
    updatedAt,
    nextRunAt,
    lastRunAt,
    runCount: clampInt(source.runCount, 0, 0, 100000),
    lastError: normalizeString(source.lastError),
  };
}

function hasDefinedOwn(obj, key) {
  return isRecord(obj) && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

async function appendSystemEvent(type, payload = {}) {
  const opts = managedRuntimeStoreOptions();
  const storeCore = await loadManagedRuntimeStoreCore();
  const runtimeEvent = storeCore.appendRuntimeEvent(
    normalizeString(type, "unknown"),
    isRecord(payload) ? payload : {},
    opts,
  );
  const ts = Number(runtimeEvent?.createdAt || opts.now || nowTs()) || nowTs();
  return {
    eventId: normalizeString(runtimeEvent?.id) || `runtime-event-${ts}`,
    type: normalizeString(runtimeEvent?.type, normalizeString(type, "unknown")),
    ts,
    iso: toIso(ts),
    payload: isRecord(runtimeEvent?.payload) ? runtimeEvent.payload : {},
  };
}

async function readRecentSystemEvents(limit = EVENT_LOG_TAIL_LIMIT) {
  const storeCore = await loadManagedRuntimeStoreCore();
  return storeCore.readRuntimeEvents(limit, managedRuntimeStoreOptions()).map((event) => {
    const ts = Number(event?.createdAt || 0) || 0;
    return {
      eventId: normalizeString(event?.id),
      type: normalizeString(event?.type),
      ts,
      iso: toIso(ts),
      payload: isRecord(event?.payload) ? event.payload : {},
    };
  });
}

function truncateText(value, limit = 160) {
  const text = normalizeString(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(16, limit - 3))}...`;
}

function mergeUniqueStrings(...lists) {
  return dedupe(lists.flatMap((list) => normalizeStringArray(list)));
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
  const filtered = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
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
      lastDigestSweepIso: toIso(normalized.scheduler.lastDigestSweepAt),
    },
    stats: {
      itemCount: normalized.items.length,
      digestCount: normalized.digests.length,
      deliveredDigestCount: normalized.digests.filter((digest) => digest.status === "sent").length,
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
          url: item.url,
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
            avgScore: 0,
          },
        })),
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
      topTitles: digest.items.slice(0, 3).map((item) => item.title),
    })),
  };
}

function buildMemoryStatus(store) {
  const normalized = normalizeMemoryStore(store);
  return {
    scheduler: {
      lastDistilledIso: toIso(normalized.scheduler.lastDistilledAt),
      lastPersistedIso: toIso(normalized.scheduler.lastPersistedAt),
    },
    stats: {
      memoryCount: normalized.memories.length,
      strategyCount: normalized.strategies.length,
      learningCount: normalized.learnings.length,
      highConfidenceMemories: normalized.memories.filter(
        (entry) => entry.confidence >= 75 && entry.invalidatedBy.length === 0,
      ).length,
      invalidatedMemories: normalized.memories.filter((entry) => entry.invalidatedBy.length > 0)
        .length,
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
      updatedIso: toIso(entry.updatedAt),
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
      updatedIso: toIso(entry.updatedAt),
    })),
    recentLearnings: normalized.learnings.slice(0, 10).map((entry) => ({
      id: entry.id,
      observedPattern: truncateText(entry.observedPattern, 180),
      effectOnSuccessRate: entry.effectOnSuccessRate,
      effectOnTokenCost: entry.effectOnTokenCost,
      effectOnCompletionQuality: entry.effectOnCompletionQuality,
      adoptedAs: entry.adoptedAs,
      updatedIso: toIso(entry.updatedAt),
    })),
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
      lastReviewIso: toIso(evolutionRuntime.lastReviewAt || normalized.scheduler.lastReviewAt),
    },
    stats: {
      candidateCount: normalized.candidates.length,
      shadowCount: normalized.candidates.filter((entry) => entry.adoptionState === "shadow").length,
      candidateStageCount: normalized.candidates.filter(
        (entry) => entry.adoptionState === "candidate",
      ).length,
      adoptedCount: normalized.candidates.filter((entry) => entry.adoptionState === "adopted")
        .length,
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
      updatedIso: toIso(entry.updatedAt),
    })),
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
    loadAutopilotStatus(),
    loadAgentSessionsStore("main"),
  ]);
  const candidates = [];
  for (const task of [...(autopilot?.tasks || [])].sort(
    (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0),
  )) {
    const delivery = normalizeDeliveryCandidate(task.delivery);
    if (!delivery) continue;
    candidates.push({
      delivery,
      updatedAt: task.updatedAt || 0,
      direct:
        !String(task.delivery?.target || "").includes("group:") &&
        !String(task.delivery?.target || "").includes("wrSH"),
      source: "autopilot-task",
    });
  }
  for (const entry of Object.values(sessions || {})) {
    const delivery = normalizeDeliveryCandidate({
      channel: entry?.deliveryContext?.channel || entry?.lastChannel,
      target: entry?.deliveryContext?.to || entry?.lastTo,
      accountId: entry?.deliveryContext?.accountId || entry?.lastAccountId,
      threadId: entry?.deliveryContext?.threadId || entry?.lastThreadId,
    });
    if (!delivery) continue;
    const direct =
      normalizeString(entry?.origin?.chatType) === "direct" ||
      /^user:|^wecom:/i.test(delivery.target);
    candidates.push({
      delivery,
      updatedAt: Number(entry?.updatedAt || 0),
      direct,
      source: "recent-session",
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
  const tags = normalizeKeywordTags(
    task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints),
  );
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
  const tags = normalizeKeywordTags(
    task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints),
  );
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
  const tags = normalizeKeywordTags(
    task.tags || extractKeywordTags(`${task.title} ${task.goal}`, task.skillHints),
  );
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
  if (task.route === "coder" || task.route === "ops")
    return "允许更深推理，但先带入最少必要记忆和情报，不做长上下文裸跑。";
  return "只把最相关的记忆、情报和当前状态送入远程推理链。";
}

function buildFallbackOrder(task, worker, skills, lane) {
  const route = task.route || task.taskKind || "general";
  const base = [
    "stable-local-tools",
    skills.length ? `skill:${skills[0]}` : null,
    worker ? `worker:${worker}` : null,
    lane === "system2" ? "route-replan" : "system2-escalation",
    route !== "general" ? "worker:main" : null,
  ].filter(Boolean);
  return dedupe(base);
}

function shouldUseSystem2(task, topStrategy, relevantMemories, relevantIntel) {
  const stableSkillCount = mergeUniqueStrings(
    task?.skillHints,
    topStrategy?.recommendedSkills,
  ).length;
  const highConfidenceExecutionMemories = relevantMemories.filter(
    (entry) =>
      ["execution", "efficiency"].includes(entry.entry.memoryType) && entry.entry.confidence >= 68,
  ).length;
  if (topStrategy?.thinkingLane === "system2") return true;
  if (topStrategy?.thinkingLane === "system1" && topStrategy.confidence >= 68) {
    if (
      (task.runState?.consecutiveFailures || 0) === 0 &&
      (task.runState?.remoteCallCount || 0) < 2
    ) {
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
  if (task.route === "general" && highConfidenceExecutionMemories < 2 && stableSkillCount < 2)
    return true;
  if (normalizeString(task.goal).length > 220) return true;
  if (task.priority === "high" && relevantMemories.length < 2) return true;
  if (relevantIntel.length >= 2 && relevantMemories.length === 0) return true;
  return topStrategy.confidence < 68;
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
      buildSkillHintsForTask(route, taskGoalText),
    ).slice(0, 16),
    tags: normalizeKeywordTags(task.tags || extractKeywordTags(taskGoalText, task.skillHints)),
    blockedReason: normalizeString(task.blockedReason),
    lastError: normalizeString(task.lastError),
    runState: {
      consecutiveFailures: clampInt(task.runState?.consecutiveFailures, 0, 0, 1000),
      remoteCallCount: clampInt(task.runState?.remoteCallCount, 0, 0, 100000),
    },
  };
}

function buildManagedRuntimeDecisionConfig(config) {
  return {
    maxInputTokensPerTurn: clampInt(
      config.maxInputTokensPerTurn,
      DEFAULT_AUTOPILOT_CONFIG.maxInputTokensPerTurn,
      512,
      500000,
    ),
    maxRemoteCallsPerTask: clampInt(
      config.maxRemoteCallsPerTask,
      DEFAULT_AUTOPILOT_CONFIG.maxRemoteCallsPerTask,
      1,
      100000,
    ),
    maxCandidatesPerPlane: 4,
    maxContextChars: clampInt(
      config.maxContextChars,
      DEFAULT_AUTOPILOT_CONFIG.maxContextChars,
      1200,
      100000,
    ),
  };
}

function buildManagedRuntimeContextPackText(decision) {
  const strategyLine = decision?.contextPack?.strategyCandidates?.[0]?.title
    ? `命中策略：${truncateText(decision.contextPack.strategyCandidates[0].title, 160)}`
    : "命中策略：无高置信固定策略，本轮需要显式规划。";
  const memoryLines = (decision?.contextPack?.memoryCandidates || [])
    .slice(0, 5)
    .map((entry) => `- [memory] ${truncateText(entry.title || entry.excerpt, 160)}`);
  const intelLines = (decision?.contextPack?.intelCandidates || [])
    .slice(0, 4)
    .map(
      (entry) =>
        `- [intel] ${truncateText(entry.title, 90)} | ${truncateText(entry.excerpt || "", 120)}`,
    );
  const synthesisLines = (decision?.contextPack?.synthesis || [])
    .slice(0, 6)
    .map((line) => `- ${line}`);
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
    ...synthesisLines,
  ]
    .filter(Boolean)
    .join("\n");
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
    coreDecision: decision,
  };
}

function normalizeManagedRuntimeThinkingLane(value) {
  return normalizeString(value).toLowerCase() === "system2" ? "system2" : "system1";
}

function buildManagedRuntimeTaskReviewSummary(task) {
  return truncateText(
    task?.lastResult ||
      task?.runState?.lastResultSummary ||
      task?.blockedReason ||
      task?.lastError ||
      task?.planSummary ||
      task?.nextAction ||
      task?.goal ||
      task?.title,
    220,
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
        backgroundSessionId: normalizeString(task?.runState?.backgroundSessionId) || null,
      },
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
        transitionEventId: normalizeString(options.transitionEventId) || null,
      },
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
          thinkingLane,
        },
      });
      shareableReview = core.buildShareableReviewEnvelope(taskReview, {
        generatedAt: parseOptionalTimestamp(options.generatedAt) || updatedAt,
        metadata: {
          source: "openclaw-codex-control",
          route,
          worker,
          thinkingLane,
        },
      });
    }
    const taskRecord = core.buildTaskRecordSnapshot({
      id: normalizeString(task?.id),
      title: normalizeString(task?.title),
      route,
      status,
      priority: normalizeString(task?.priority) || "normal",
      budgetMode: normalizeString(task?.budgetMode) || DEFAULT_AUTOPILOT_CONFIG.defaultBudgetMode,
      retrievalMode:
        normalizeString(task?.retrievalMode) || DEFAULT_AUTOPILOT_CONFIG.defaultRetrievalMode,
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
        lastError: normalizeString(task?.lastError) || null,
      },
    });
    return {
      taskRecord,
      taskRun,
      taskStep,
      taskReview,
      shareableReview,
    };
  } catch (error) {
    if (!managedRuntimeTaskArtifactsWarned && pluginApi?.logger) {
      managedRuntimeTaskArtifactsWarned = true;
      pluginApi.logger.warn(
        `[openclaw-codex-control] managed runtime task artifacts unavailable, runtime event snapshots will be partial: ${error?.message || error}`,
      );
    }
    return null;
  }
}

async function buildTaskDecision(task, config) {
  const [core, storeCore] = await Promise.all([
    loadManagedRuntimeDecisionCore(),
    loadManagedRuntimeStoreCore(),
  ]);
  if (!core?.buildDecisionRecord) {
    throw new Error("Managed runtime decision core is unavailable.");
  }
  const opts = managedRuntimeStoreOptions();
  const memoryStore = storeCore.loadRuntimeMemoryStore(opts);
  const intelStore = storeCore.loadRuntimeIntelStore(opts);
  const coreDecision = core.buildDecisionRecord({
    task: buildManagedRuntimeDecisionTask(task, config),
    config: buildManagedRuntimeDecisionConfig(config),
    sources: {
      strategies: memoryStore.strategies,
      memories: memoryStore.memories,
      intel: intelStore.candidates,
      archive: [],
    },
    now: nowTs(),
  });
  return adaptManagedRuntimeDecision(coreDecision);
}

function buildDecisionPromptBlock(decision) {
  if (!isRecord(decision)) return "";
  const lines = [
    "决策内核输出：",
    `- 决策通道：${decision.thinkingLane || "system1"}`,
    `- 推荐执行者：${decision.recommendedWorker || "main"}`,
    decision.recommendedSkills?.length
      ? `- 推荐 skills：${decision.recommendedSkills.join(", ")}`
      : "",
    decision.fallbackOrder?.length ? `- fallback 顺序：${decision.fallbackOrder.join(" -> ")}` : "",
    decision.localFirstPlan ? `- 本地优先：${decision.localFirstPlan}` : "",
    decision.remoteModelPlan ? `- 远程推理：${decision.remoteModelPlan}` : "",
    decision.contextPack ? decision.contextPack : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function buildManagedIntelDigest(intelStore, digestDate) {
  const items = intelStore.digestItems
    .filter((entry) => normalizeString(entry.metadata?.digestDate) === digestDate)
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  return {
    id: `runtime-digest-${digestDate}`,
    digestDate,
    createdAt: items.reduce((latest, entry) => Math.max(latest, entry.createdAt || 0), 0),
    items,
  };
}

function formatManagedIntelDigestMessage(digest) {
  const header = `情报面板日报 (${digest.digestDate})`;
  const body = digest.items
    .map((item, index) => {
      const domain = normalizeString(item.domain).toUpperCase() || "INFO";
      return `${index + 1}. [${domain}] ${item.title}\n结论：${item.conclusion}\n判断：${item.whyItMatters}\n行动：${item.recommendedAction}`;
    })
    .join("\n\n");
  return `${header}\n\n${body}`.trim();
}

async function runIntelMaintenance(options = {}) {
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const [storeCore, intelRefresh] = await Promise.all([
    loadManagedRuntimeStoreCore(),
    loadManagedRuntimeIntelRefreshCore(),
  ]);
  const initialIntelStore = storeCore.loadRuntimeIntelStore(opts);
  if (!initialIntelStore.enabled) return await buildManagedIntelStatus();
  const domainIds = normalizeString(options.domainId)
    ? [normalizeString(options.domainId)]
    : [
        ...new Set([
          ...initialIntelStore.candidates.map((entry) => entry.domain),
          ...initialIntelStore.digestItems.map((entry) => entry.domain),
          ...initialIntelStore.sourceProfiles.map((entry) => entry.domain),
          "tech",
          "ai",
          "business",
          "github",
        ]),
      ];
  await intelRefresh.refreshRuntimeIntelPipeline({
    ...opts,
    domains: domainIds,
    force: Boolean(options.forceRefresh),
    githubToken: normalizeString(options.githubToken) || undefined,
  });
  const refreshedIntelStore = storeCore.loadRuntimeIntelStore(opts);
  const metadata = isRecord(refreshedIntelStore.metadata) ? refreshedIntelStore.metadata : {};
  if (metadata.dailyPushEnabled === false) return await buildManagedIntelStatus();
  const nowDate = new Date();
  const currentHour = nowDate.getHours();
  const currentMinute = nowDate.getMinutes();
  const todayKey = buildLocalDateKey();
  const delivery =
    normalizeDeliveryCandidate(options.delivery) || (await resolvePreferredDigestDelivery());
  const nextIntelStore = storeCore.loadRuntimeIntelStore(opts);
  let changed = false;
  let nextMetadata = isRecord(nextIntelStore.metadata) ? nextIntelStore.metadata : {};
  const lastDeliveredDigestDate = normalizeString(nextMetadata.lastDeliveredDigestDate);
  const backoffActive = Boolean(
    !options.forceDigest &&
    Number(nextMetadata.lastDigestAttemptAt || 0) &&
    nowValue - Number(nextMetadata.lastDigestAttemptAt || 0) < INTEL_DIGEST_RETRY_BACKOFF_MS,
  );
  const pushHour = clampInt(nextMetadata.dailyPushHourLocal, 9, 0, 23);
  const pushMinute = clampInt(nextMetadata.dailyPushMinuteLocal, 0, 0, 59);
  const dueDigest =
    Boolean(options.forceDigest) ||
    (!backoffActive &&
      lastDeliveredDigestDate !== todayKey &&
      (currentHour > pushHour || (currentHour === pushHour && currentMinute >= pushMinute)));
  if (dueDigest) {
    const digest = buildManagedIntelDigest(nextIntelStore, todayKey);
    if (!digest.items.length) {
      nextMetadata = {
        ...nextMetadata,
        lastDigestAttemptAt: nowValue,
        lastDigestError: "no_digest_items",
      };
      changed = true;
    } else if (!delivery) {
      nextMetadata = {
        ...nextMetadata,
        lastDigestAttemptAt: nowValue,
        lastDigestError: "delivery_unavailable",
      };
      changed = true;
    } else {
      const message = formatManagedIntelDigestMessage(digest);
      const deliveryResult = await notifyTaskTarget(
        {
          id: digest.id,
          title: "情报面板日报",
          delivery,
        },
        "proactive",
        message,
      );
      nextMetadata = {
        ...nextMetadata,
        lastDigestAttemptAt: nowValue,
        lastDigestDate: todayKey,
        lastDigestError: deliveryResult.ok
          ? ""
          : String(deliveryResult.error || "digest_delivery_failed"),
        lastDeliveredDigestDate: deliveryResult.ok
          ? todayKey
          : lastDeliveredDigestDate || undefined,
      };
      changed = true;
      if (deliveryResult.ok && typeof storeCore.appendRuntimeEvent === "function") {
        storeCore.appendRuntimeEvent(
          "runtime_intel_digest_sent",
          {
            digestId: digest.id,
            digestDate: todayKey,
            itemCount: digest.items.length,
            delivery,
          },
          opts,
        );
      }
    }
  }
  if (changed) {
    nextIntelStore.metadata = nextMetadata;
    storeCore.saveRuntimeIntelStore(nextIntelStore, opts);
  }
  return await buildManagedIntelStatus();
}

async function runEvolutionReview(options = {}) {
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const [storeCore, mutations] = await Promise.all([
    loadManagedRuntimeStoreCore(),
    loadManagedRuntimeMutationsCore(),
  ]);
  const governanceStore = storeCore.loadRuntimeGovernanceStore(opts);
  const metadata = isRecord(governanceStore.metadata) ? governanceStore.metadata : {};
  const enabled = metadata.enabled !== false;
  const reviewIntervalHours = clampInt(metadata.reviewIntervalHours, 12, 1, 168);
  const lastReviewAt = Number(metadata.lastReviewAt || 0) || 0;
  if (!enabled) {
    return await buildManagedEvolutionStatus();
  }
  if (
    !Boolean(options.force) &&
    lastReviewAt &&
    nowValue - lastReviewAt < reviewIntervalHours * 60 * 60 * 1000
  ) {
    return await buildManagedEvolutionStatus();
  }
  evolutionRuntime.active = true;
  try {
    if (typeof mutations.reviewRuntimeEvolution !== "function") {
      throw new Error("Managed runtime evolution review is unavailable.");
    }
    mutations.reviewRuntimeEvolution(opts);
    evolutionRuntime.lastReviewAt = nowValue;
    return await buildManagedEvolutionStatus();
  } finally {
    evolutionRuntime.active = false;
    evolutionRuntime.lastTickAt = nowTs();
  }
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
    effectiveRetrievalMode: task.retrievalMode || config.defaultRetrievalMode,
  };
}

function findContinuationTask(store, sessionKey) {
  const active = store.tasks
    .filter(
      (task) =>
        !isAutopilotTerminalStatus(task.status) && task.sourceMeta?.sessionKey === sessionKey,
    )
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  return active[0] || null;
}

function buildCapturedTaskPayload(params) {
  const { store, sessionKey, cleanText, sourceMeta, delivery, route, assignee } = params;
  const continuation = looksLikeContinuation(cleanText)
    ? findContinuationTask(store, sessionKey)
    : null;
  const taskId =
    continuation?.id || buildTaskIdFromMessage(sessionKey, sourceMeta.messageId, cleanText);
  const goal = continuation?.goal ? `${continuation.goal}\n\n跟进补充：${cleanText}` : cleanText;
  return {
    ...continuation,
    id: taskId,
    title: continuation?.title || buildTaskTitleFromText(cleanText),
    goal: summarizeTaskGoal(goal),
    successCriteria:
      continuation?.successCriteria ||
      "形成真实交付、明确下一动作，或在缺少关键输入时给出高信息密度阻塞说明。",
    notes: continuation?.notes
      ? `${continuation.notes}\n\n[follow-up ${new Date().toISOString()}]\n${cleanText}`
      : cleanText,
    doneCriteria:
      continuation?.doneCriteria ||
      "完成真实交付，或在缺少关键决策/外部输入时给出高信息密度阻塞说明。",
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
    nextRunAt: nowTs(),
  };
}

async function captureAutopilotTaskFromSession(ctx) {
  if (!ctx?.sessionKey) return null;
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
  const status = await buildManagedAutopilotStatus();
  if (!status.config.enabled) return null;
  const duplicate = status.tasks.find(
    (task) =>
      task?.sourceMeta?.sessionKey === sessionKey &&
      task?.sourceMeta?.messageId &&
      task.sourceMeta.messageId === messageMeta.sourceMeta.messageId,
  );
  if (duplicate) return duplicate;
  const routeInfo = classifyTaskRoute(cleanText);
  const payload = buildCapturedTaskPayload({
    store: status,
    sessionKey,
    cleanText,
    sourceMeta: messageMeta.sourceMeta,
    delivery: messageMeta.delivery,
    route: routeInfo.route,
    assignee: routeInfo.assignee,
  });
  const saved = await upsertManagedAutopilotTask(payload);
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
    "</personal-superintelligence>",
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
    JSON.stringify(
      {
        status: "running",
        summary: "一句话说明当前进展或交付结果",
        planSummary: "当前计划的简短摘要",
        nextAction: "下一步具体动作",
        blockedReason: "",
        lastResult: "本轮产出或最新结论",
        nextRunInMinutes: 15,
        needsUser: "",
        shouldNotify: false,
        notes: "",
      },
      null,
      2,
    ),
    "</AUTOPILOT_RESULT>",
  ].filter(Boolean);
  return lines.join("\n\n");
}

async function notifyTaskTarget(task, kind, text) {
  const delivery = normalizeAutopilotDelivery(task.delivery);
  if (!delivery.channel || !delivery.target || !normalizeString(text))
    return { ok: false, skipped: true };
  const args = [
    "message",
    "send",
    "--channel",
    delivery.channel,
    "--target",
    delivery.target,
    "--message",
    text,
    "--json",
  ];
  if (delivery.accountId) args.push("--account", delivery.accountId);
  if (delivery.threadId) args.push("--thread-id", delivery.threadId);
  if (delivery.replyTo && kind !== "proactive") args.push("--reply-to", delivery.replyTo);
  const result = await runOpenClawCli(args, { timeoutMs: 60 * 1000 });
  if (!result.ok && pluginApi) {
    pluginApi.logger.warn(
      `[openclaw-codex-control] notify ${kind} failed for ${task.id}: ${result.stderr || result.stdout}`,
    );
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
  const summary = normalizeString(
    task.lastResult ||
      task.runState?.lastResultSummary ||
      task.blockedReason ||
      task.lastError ||
      task.goal ||
      task.title,
  );
  const compactSummary = summary.replace(/\s+/g, " ").trim();
  const shownSummary =
    compactSummary.length > 220 ? `${compactSummary.slice(0, 220)}...` : compactSummary;
  return `- [autopilot][${status}][${task.id}] ${task.title} | route=${route} | ${shownSummary}`;
}

async function appendAutopilotMemoryLineWithTransition(task, status, transitionFn) {
  const runState = normalizeAutopilotRunState(task.runState);
  const normalizedStatus = normalizeAutopilotStatusValue(status, status);
  if (runState.memoryLoggedStatuses.includes(normalizedStatus)) return false;
  const workspace = await resolveWorkspacePathForAutopilotTask(task);
  if (!workspace) return false;
  const dateKey = new Date().toISOString().slice(0, 10);
  const memoryDir = path.join(workspace, "memory");
  const memoryFile = path.join(memoryDir, `${dateKey}.md`);
  const existing = await readTextFile(memoryFile, "");
  const markers = getAutopilotStatusAliases(normalizedStatus).map(
    (entry) => `[autopilot][${entry}][${task.id}]`,
  );
  if (markers.some((marker) => existing.includes(marker))) {
    await transitionFn(task.id, {
      runState: {
        memoryLoggedStatuses: [...runState.memoryLoggedStatuses, normalizedStatus],
      },
    });
    return false;
  }
  await fsp.mkdir(memoryDir, { recursive: true });
  const line = formatMemoryTaskLine(task, normalizedStatus);
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await fsp.appendFile(memoryFile, `${prefix}${line}\n`, "utf8");
  await transitionFn(task.id, {
    runState: {
      memoryLoggedStatuses: [...runState.memoryLoggedStatuses, normalizedStatus],
    },
  });
  return true;
}

async function appendManagedAutopilotMemoryLine(task, status) {
  return await appendAutopilotMemoryLineWithTransition(
    task,
    status,
    transitionManagedAutopilotTask,
  );
}

function buildPlanningSummary(task) {
  const skillText =
    Array.isArray(task.skillHints) && task.skillHints.length > 0
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
  const escalatedBudget =
    consecutiveFailures >= 2 ? bumpBudgetMode(task.budgetMode) : task.budgetMode;
  const escalatedRetrieval =
    consecutiveFailures >= 2 ? bumpRetrievalMode(task.retrievalMode) : task.retrievalMode;
  const shouldEscalateToMain =
    consecutiveFailures >= 3 && !["main", ""].includes(task.assignee || "");
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
    planSummary:
      status === "blocked"
        ? `连续失败 ${consecutiveFailures} 次，已停止自动重试并等待外部处理。`
        : `失败后自动重规划第 ${replanCount} 次，调整预算/检索策略${routeLabel}。`,
    nextAction:
      status === "blocked"
        ? "等待墨水介入，或由 heartbeat/后续任务重新触发。"
        : `在 ${AUTOPILOT_RETRY_BACKOFF_MINUTES[retryIndex]} 分钟后重试，优先换技能或换路径。`,
    runState: {
      consecutiveFailures,
      totalFailures,
      replanCount,
      lastFailureAt: nowTs(),
      lastFailureSummary: failureSummary,
    },
  };
}

function buildHeartbeatAutopilotContext(status) {
  const tasks = Array.isArray(status?.tasks) ? status.tasks : [];
  const interesting = tasks
    .filter(
      (task) =>
        task.status === "blocked" ||
        task.status === "waiting_user" ||
        task.status === "waiting_external" ||
        task.status === "queued" ||
        task.status === "ready" ||
        task.status === "running",
    )
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
        task.nextRunIn ? `retry=${task.nextRunIn}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      return detail;
    }),
    "</autopilot-heartbeat>",
  ];
  return lines.join("\n");
}

function formatBlockedNotification(task, result) {
  const lines = [
    `${task.title || "任务"}卡住了。`,
    `卡点：${result.blockedReason || result.summary || task.blockedReason || task.lastError || "后台执行未能继续推进。"}`,
    task.lastError ? `已尝试：${task.lastError}` : "",
    result.needsUser ? `还需要你提供：${result.needsUser}` : "还需要你提供：进一步决策或外部信息。",
  ].filter(Boolean);
  return lines.join("\n");
}

function formatDoneNotification(task, result) {
  return `${task.title || "任务"} 已完成。\n${result.lastResult || result.summary || task.lastResult || task.runState?.lastResultSummary || "后台已完成交付。"}`.trim();
}

async function maybeNotifyForTaskWithTransition(task, handlers) {
  const transition = handlers.transition;
  const appendMemoryLine = handlers.appendMemoryLine;
  const status = task.status;
  const runState = normalizeAutopilotRunState(task.runState);
  const ts = nowTs();
  if (task.reportPolicy === "silent") return false;
  if (status === "completed") {
    await appendMemoryLine(task, "completed");
    if (runState.lastNotifiedStatus === "completed") return false;
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      shouldNotify: true,
    });
    const message = formatDoneNotification(task, result);
    const notified = await notifyTaskTarget(task, "reply", message);
    if (notified.ok) {
      await transition(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "completed",
        },
      });
      return true;
    }
    return false;
  }
  if (status === "waiting_user") {
    await appendMemoryLine(task, "waiting_user");
    if (
      runState.lastNotifiedStatus === "waiting_user" &&
      runState.lastNotifyAt &&
      ts - runState.lastNotifyAt < AUTOPILOT_MIN_NOTIFY_GAP_MS
    ) {
      return false;
    }
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      needsUser: task.lastError,
      shouldNotify: true,
    });
    const message = formatBlockedNotification(task, result);
    const notified = await notifyTaskTarget(task, "reply", message);
    if (notified.ok) {
      await transition(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "waiting_user",
        },
      });
      return true;
    }
    return false;
  }
  if (status === "blocked") {
    await appendMemoryLine(task, "blocked");
    const blockedAt = runState.blockedAt || task.updatedAt || ts;
    if (ts - blockedAt < AUTOPILOT_BLOCK_NOTIFY_AFTER_MS) return false;
    if (
      runState.lastNotifiedStatus === "blocked" &&
      runState.lastNotifyAt &&
      ts - runState.lastNotifyAt < AUTOPILOT_MIN_NOTIFY_GAP_MS
    ) {
      return false;
    }
    const result = buildAutopilotResultEnvelope({
      status,
      summary: runState.lastResultSummary,
      needsUser: task.lastError,
      shouldNotify: true,
    });
    const message = formatBlockedNotification(task, result);
    const notified = await notifyTaskTarget(task, "proactive", message);
    if (notified.ok) {
      await transition(task.id, {
        runState: {
          lastNotifyAt: ts,
          lastNotifiedStatus: "blocked",
        },
      });
      return true;
    }
  }
  return false;
}

async function maybeNotifyForManagedTask(task) {
  return await maybeNotifyForTaskWithTransition(task, {
    transition: transitionManagedAutopilotTask,
    appendMemoryLine: appendManagedAutopilotMemoryLine,
  });
}

function buildManagedAutopilotRunMaps(taskStore) {
  const latestRunByTaskId = new Map();
  const runCountByTaskId = new Map();
  for (const run of [...(taskStore?.runs || [])].sort(
    (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0),
  )) {
    if (!latestRunByTaskId.has(run.taskId)) latestRunByTaskId.set(run.taskId, run);
    runCountByTaskId.set(run.taskId, Number(runCountByTaskId.get(run.taskId) || 0) + 1);
  }
  return { latestRunByTaskId, runCountByTaskId };
}

async function runManagedPlannedAutopilotTask(plan, config) {
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const storeCore = await loadManagedRuntimeStoreCore();
  const taskStore = storeCore.loadRuntimeTaskStore(opts);
  const { latestRunByTaskId, runCountByTaskId } = buildManagedAutopilotRunMaps(taskStore);
  const currentTask = taskStore.tasks.find((entry) => entry.id === plan.task.id) || plan.task;
  const currentRun = latestRunByTaskId.get(plan.task.id) || plan.run || null;
  const taskView = buildManagedAutopilotTaskView(
    currentTask,
    currentRun,
    Number(runCountByTaskId.get(plan.task.id) || 0),
    config,
    nowValue,
  );
  const backgroundSessionId =
    taskView.runState?.backgroundSessionId || buildBackgroundSessionId(taskView);
  await transitionManagedAutopilotTask(taskView.id, {
    runState: {
      backgroundSessionId,
    },
  });
  const executionTask = normalizeAutopilotTask(
    {
      ...taskView,
      runState: {
        ...(isRecord(taskView.runState) ? taskView.runState : {}),
        backgroundSessionId,
      },
    },
    config,
  );
  const prompt = buildAutopilotWorkerPrompt(executionTask, config);
  const thinking = resolveThinkingLevelForBudget(
    executionTask.effectiveBudgetMode || executionTask.budgetMode || config.defaultBudgetMode,
  );
  const args = [
    "agent",
    "--agent",
    plan.decision?.recommendedWorker || executionTask.assignee || "main",
    "--session-id",
    backgroundSessionId,
    "--thinking",
    thinking,
    "--verbose",
    "off",
    "--message",
    prompt,
    "--json",
  ];
  const cliResult = await runOpenClawCli(args, { timeoutMs: 15 * 60 * 1000 });
  const combinedOutput = [cliResult.stdout, cliResult.stderr].filter(Boolean).join("\n");
  const parsed = extractAutopilotResultFromText(combinedOutput);
  const patch = {
    lastError: "",
    nextRunAt: null,
    planSummary: parsed.planSummary || executionTask.planSummary || "",
    nextAction: parsed.nextAction || "",
    blockedReason: parsed.blockedReason || "",
    lastResult: parsed.lastResult || parsed.summary || "",
    workerOutput: combinedOutput.slice(-6000),
    cliExitCode: cliResult.code,
    runState: {
      lastResultStatus: parsed.status,
      lastResultSummary: parsed.summary,
      lastWorkerOutput: combinedOutput.slice(-6000),
      lastCliExitCode: cliResult.code,
      backgroundSessionId,
      consecutiveFailures: 0,
    },
  };
  if (!cliResult.ok) {
    return await transitionManagedAutopilotTask(taskView.id, {
      ...patch,
      ...buildRetryStrategy(
        executionTask,
        normalizeString(cliResult.stderr || cliResult.stdout || "Autopilot worker failed."),
        "cli_error",
      ),
    });
  }
  if (parsed.status === "completed") {
    return await transitionManagedAutopilotTask(taskView.id, {
      ...patch,
      status: "completed",
    });
  }
  if (parsed.status === "waiting_user") {
    return await transitionManagedAutopilotTask(taskView.id, {
      ...patch,
      status: "waiting_user",
      lastError: parsed.needsUser || parsed.summary,
      blockedReason: parsed.blockedReason || parsed.needsUser || parsed.summary,
    });
  }
  if (parsed.status === "blocked") {
    const failureText = normalizeString(
      parsed.blockedReason ||
        parsed.needsUser ||
        parsed.summary ||
        "Autopilot worker returned blocked.",
    );
    return await transitionManagedAutopilotTask(taskView.id, {
      ...patch,
      ...buildRetryStrategy(executionTask, failureText, "worker_blocked"),
    });
  }
  if (parsed.status === "waiting_external") {
    return await transitionManagedAutopilotTask(taskView.id, {
      ...patch,
      status: "waiting_external",
      nextRunAt: nowTs() + parsed.nextRunInMinutes * 60 * 1000,
    });
  }
  return await transitionManagedAutopilotTask(taskView.id, {
    ...patch,
    status: "queued",
    nextRunAt: nowTs() + parsed.nextRunInMinutes * 60 * 1000,
  });
}

async function tickAutopilotExecution() {
  const opts = managedRuntimeStoreOptions();
  const [taskEngine, status] = await Promise.all([
    loadManagedRuntimeTaskEngineCore(),
    buildManagedAutopilotStatus(),
  ]);
  if (!status.config.enabled) return status;
  for (const task of status.tasks) {
    await maybeNotifyForManagedTask(task);
  }
  if (autopilotRuntime.activeTaskId) return await buildManagedAutopilotStatus();
  const tickResult = taskEngine.tickRuntimeTaskLoop(opts);
  if (tickResult.kind !== "planned") {
    return await buildManagedAutopilotStatus();
  }
  const dueTask = tickResult.task;
  autopilotRuntime.activeTaskId = dueTask.id;
  autopilotRuntime.activeTaskStartedAt = nowTs();
  try {
    return await runManagedPlannedAutopilotTask(tickResult, status.config);
  } finally {
    autopilotRuntime.activeTaskId = null;
    autopilotRuntime.activeTaskStartedAt = null;
  }
}

async function updateAutopilotConfig(patch) {
  const patchValue = isRecord(patch) ? patch : {};
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const storeCore = await loadManagedRuntimeStoreCore();
  const taskStore = storeCore.loadRuntimeTaskStore(opts);
  const currentConfig = readManagedAutopilotCompatibilityConfig(taskStore);
  const nextConfig = normalizeAutopilotConfig({
    ...currentConfig,
    ...patchValue,
  });
  taskStore.defaults = {
    ...taskStore.defaults,
    defaultBudgetMode: nextConfig.defaultBudgetMode,
    defaultRetrievalMode: nextConfig.defaultRetrievalMode,
    maxInputTokensPerTurn: nextConfig.maxInputTokensPerTurn,
    maxContextChars: nextConfig.maxContextChars,
    maxRemoteCallsPerTask: nextConfig.maxRemoteCallsPerTask,
  };
  taskStore.metadata = {
    ...(isRecord(taskStore.metadata) ? taskStore.metadata : {}),
    autopilot: {
      enabled: nextConfig.enabled,
      localFirst: nextConfig.localFirst,
      heartbeatEnabled: nextConfig.heartbeatEnabled,
      dailyRemoteTokenBudget: nextConfig.dailyRemoteTokenBudget,
    },
    updatedAt: nowValue,
  };
  storeCore.saveRuntimeTaskStore(taskStore, opts);
  if (typeof storeCore.appendRuntimeEvent === "function") {
    storeCore.appendRuntimeEvent(
      "runtime_autopilot_config_updated",
      {
        enabled: nextConfig.enabled,
        localFirst: nextConfig.localFirst,
        heartbeatEnabled: nextConfig.heartbeatEnabled,
        defaultBudgetMode: nextConfig.defaultBudgetMode,
        defaultRetrievalMode: nextConfig.defaultRetrievalMode,
      },
      opts,
    );
  }
  return await buildManagedAutopilotStatus();
}

function mapLegacyReportPolicyToManaged(value) {
  const normalized = normalizeString(value);
  if (normalized === "reply_only") return "reply";
  if (normalized === "proactive_only") return "proactive";
  if (
    normalized === "reply_and_proactive" ||
    normalized === "reply" ||
    normalized === "proactive" ||
    normalized === "silent"
  ) {
    return normalized;
  }
  return undefined;
}

function readManagedAutopilotCompatibilityConfig(taskStore, fallback = DEFAULT_AUTOPILOT_CONFIG) {
  const metadata = isRecord(taskStore?.metadata) ? taskStore.metadata : {};
  const autopilot = isRecord(metadata.autopilot) ? metadata.autopilot : {};
  return normalizeAutopilotConfig({
    enabled: autopilot.enabled,
    localFirst: autopilot.localFirst,
    heartbeatEnabled: autopilot.heartbeatEnabled,
    defaultBudgetMode: taskStore?.defaults?.defaultBudgetMode || fallback.defaultBudgetMode,
    defaultRetrievalMode:
      taskStore?.defaults?.defaultRetrievalMode || fallback.defaultRetrievalMode,
    maxInputTokensPerTurn:
      taskStore?.defaults?.maxInputTokensPerTurn || fallback.maxInputTokensPerTurn,
    maxContextChars: taskStore?.defaults?.maxContextChars || fallback.maxContextChars,
    maxRemoteCallsPerTask:
      taskStore?.defaults?.maxRemoteCallsPerTask || fallback.maxRemoteCallsPerTask,
    dailyRemoteTokenBudget: autopilot.dailyRemoteTokenBudget,
  });
}

function readManagedAutopilotTaskContext(task) {
  return isRecord(task?.metadata?.taskContext) ? task.metadata.taskContext : {};
}

function buildManagedAutopilotMetadataPatch(patchValue) {
  const runtimeTask = {};
  if (hasDefinedOwn(patchValue, "runState")) {
    runtimeTask.runState = normalizeOptionalRecord(patchValue.runState) || {};
  }
  if (hasDefinedOwn(patchValue, "optimizationState")) {
    runtimeTask.optimizationState = normalizeOptionalRecord(patchValue.optimizationState) || {};
  }
  const taskContext = {};
  if (hasDefinedOwn(patchValue, "notes"))
    taskContext.notes = normalizeString(patchValue.notes) || undefined;
  if (hasDefinedOwn(patchValue, "workspace"))
    taskContext.workspace = normalizeString(patchValue.workspace) || undefined;
  if (hasDefinedOwn(patchValue, "source"))
    taskContext.source = normalizeString(patchValue.source) || undefined;
  if (hasDefinedOwn(patchValue, "delivery"))
    taskContext.delivery = normalizeOptionalRecord(patchValue.delivery) || undefined;
  if (hasDefinedOwn(patchValue, "sourceMeta"))
    taskContext.sourceMeta = normalizeOptionalRecord(patchValue.sourceMeta) || undefined;
  if (hasDefinedOwn(patchValue, "intakeText"))
    taskContext.intakeText = normalizeString(patchValue.intakeText) || undefined;
  const metadata = {};
  if (Object.keys(runtimeTask).length > 0) metadata.runtimeTask = runtimeTask;
  if (Object.keys(taskContext).length > 0) metadata.taskContext = taskContext;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildManagedAutopilotTaskView(task, latestRun, runCount, config, nowValue) {
  const taskContext = readManagedAutopilotTaskContext(task);
  const runState = isRecord(task.metadata?.runtimeTask?.runState)
    ? task.metadata.runtimeTask.runState
    : {};
  const optimizationState = isRecord(task.metadata?.runtimeTask?.optimizationState)
    ? task.metadata.runtimeTask.optimizationState
    : {};
  const nextRunAt = Number(task.nextRunAt || 0) || null;
  const lastRunAt =
    Number(
      latestRun?.completedAt ||
        latestRun?.blockedAt ||
        latestRun?.updatedAt ||
        latestRun?.startedAt ||
        0,
    ) || null;
  const isDone = task.status === "completed" || task.status === "cancelled";
  const isRunnable = !isDone && task.status !== "waiting_user";
  const isDue = Boolean(
    isRunnable &&
    ((nextRunAt && nextRunAt <= nowValue) ||
      (!nextRunAt && ["queued", "planning", "ready"].includes(task.status))),
  );
  return buildAutopilotTaskView(
    {
      id: task.id,
      title: task.title,
      goal: task.goal,
      successCriteria: task.successCriteria,
      doneCriteria: task.successCriteria,
      planSummary: task.planSummary,
      nextAction: task.nextAction,
      blockedReason: task.blockedReason,
      lastResult: normalizeString(runState.lastResultSummary),
      notes: normalizeString(taskContext.notes) || null,
      source: normalizeString(taskContext.source, "runtime-store"),
      assignee: task.worker || "main",
      workspace: normalizeString(taskContext.workspace) || INSTANCE_PATHS.workspaceRoot,
      route: task.route,
      taskKind: task.route,
      reportPolicy: task.reportPolicy,
      skillHints: Array.isArray(task.skillIds) ? task.skillIds : [],
      tags: Array.isArray(task.tags) ? task.tags : [],
      memoryRefs: Array.isArray(task.memoryRefs) ? task.memoryRefs : [],
      intelRefs: Array.isArray(task.intelRefs) ? task.intelRefs : [],
      optimizationState,
      intakeText: normalizeString(taskContext.intakeText) || null,
      sourceMeta: normalizeOptionalRecord(taskContext.sourceMeta),
      delivery: normalizeOptionalRecord(taskContext.delivery),
      runState,
      status: task.status,
      priority: task.priority,
      budgetMode: task.budgetMode || config.defaultBudgetMode,
      retrievalMode: task.retrievalMode || config.defaultRetrievalMode,
      localOnly: false,
      localFirst: config.localFirst !== false,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      nextRunAt,
      lastRunAt,
      runCount,
      lastError: task.lastError || null,
      isDue,
    },
    config,
  );
}

async function buildManagedAutopilotStatus() {
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const storeCore = await loadManagedRuntimeStoreCore();
  const taskStore = storeCore.loadRuntimeTaskStore(opts);
  const config = readManagedAutopilotCompatibilityConfig(taskStore);
  const latestRunByTaskId = new Map();
  const runCountByTaskId = new Map();
  for (const run of [...taskStore.runs].sort(
    (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0),
  )) {
    if (!latestRunByTaskId.has(run.taskId)) latestRunByTaskId.set(run.taskId, run);
    runCountByTaskId.set(run.taskId, Number(runCountByTaskId.get(run.taskId) || 0) + 1);
  }
  const tasks = taskStore.tasks
    .map((task) =>
      buildManagedAutopilotTaskView(
        task,
        latestRunByTaskId.get(task.id) || null,
        Number(runCountByTaskId.get(task.id) || 0),
        config,
        nowValue,
      ),
    )
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
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
    due: 0,
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
    config,
    scheduler: {
      startedIso: toIso(autopilotRuntime.startedAt),
      lastTickIso: toIso(autopilotRuntime.lastTickAt),
      lastError: autopilotRuntime.lastError || null,
      nextDueTaskId: nextDueTask ? nextDueTask.id : null,
      activeTaskId: autopilotRuntime.activeTaskId || null,
      activeTaskStartedIso: toIso(autopilotRuntime.activeTaskStartedAt),
    },
    stats: {
      ...counts,
      waitingHuman: counts.waitingUser,
      done: counts.completed,
    },
    tasks,
  };
}

async function buildManagedIntelStatus() {
  const opts = managedRuntimeStoreOptions();
  const storeCore = await loadManagedRuntimeStoreCore();
  const intelStore = storeCore.loadRuntimeIntelStore(opts);
  const sourceProfiles = Array.isArray(intelStore.sourceProfiles) ? intelStore.sourceProfiles : [];
  const groupedDigests = new Map();
  for (const digestItem of intelStore.digestItems) {
    const digestDate =
      normalizeString(digestItem.metadata?.digestDate) ||
      new Date(digestItem.createdAt || nowTs()).toISOString().slice(0, 10);
    const key = `${digestItem.domain}|${digestDate}`;
    const current = groupedDigests.get(key) || {
      id: `digest_${hashText(key, 16)}`,
      domain: digestItem.domain,
      digestDate,
      createdAt: digestItem.createdAt || nowTs(),
      status: "sent",
      delivery: null,
      items: [],
    };
    current.createdAt = Math.max(current.createdAt, digestItem.createdAt || 0);
    current.items.push({
      title: digestItem.title,
      itemId: digestItem.id,
      rank: current.items.length + 1,
    });
    groupedDigests.set(key, current);
  }
  const digests = [...groupedDigests.values()]
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, 9);
  const domainsById = new Map();
  for (const candidate of intelStore.candidates) domainsById.set(candidate.domain, true);
  for (const digest of intelStore.digestItems) domainsById.set(digest.domain, true);
  for (const sourceProfile of sourceProfiles) domainsById.set(sourceProfile.domain, true);
  const domainIds = [...domainsById.keys()].length
    ? [...domainsById.keys()]
    : ["tech", "ai", "business", "github"];
  const metadata = isRecord(intelStore.metadata) ? intelStore.metadata : {};
  const latestFetchAt = sourceProfiles.reduce((latest, profile) => {
    const profileMeta = isRecord(profile?.metadata) ? profile.metadata : {};
    return Math.max(
      latest,
      Number(profileMeta.latestFetchAt || profileMeta.lastFetchedAt || 0) || 0,
    );
  }, 0);
  return {
    config: {
      enabled: intelStore.enabled,
      dailyPushEnabled: metadata.dailyPushEnabled !== false,
      refreshMinutes: clampInt(metadata.refreshMinutes, 180, 1, 10080),
      dailyPushItemCount: clampInt(metadata.dailyPushItemCount, 10, 1, 50),
      dailyPushHourLocal: clampInt(metadata.dailyPushHourLocal, 9, 0, 23),
      dailyPushMinuteLocal: clampInt(metadata.dailyPushMinuteLocal, 0, 0, 59),
      selectedSourceIds: Array.isArray(metadata.selectedSourceIds)
        ? metadata.selectedSourceIds.filter((entry) => typeof entry === "string" && entry.trim())
        : [],
    },
    scheduler: {
      lastTickIso: toIso(intelRuntime.lastTickAt),
      lastError: intelRuntime.lastError || null,
      activeDomainId: intelRuntime.activeDomainId || null,
      activeDigestDomainId: intelRuntime.activeDigestDomainId || null,
      lastRefreshIso: toIso(latestFetchAt),
      lastDigestSweepIso: toIso(Number(metadata.lastDigestSweepAt || 0) || 0),
    },
    stats: {
      itemCount: intelStore.candidates.length,
      digestCount: digests.length,
      deliveredDigestCount: digests.filter((digest) => digest.status === "sent").length,
    },
    domains: domainIds.map((domainId) => {
      const candidates = intelStore.candidates
        .filter((entry) => entry.domain === domainId)
        .sort((left, right) => (right.score || 0) - (left.score || 0));
      const latestDigest = digests.find((entry) => entry.domain === domainId) || null;
      const domainSources = sourceProfiles.filter((entry) => entry.domain === domainId);
      const domainMeta = readManagedIntelDomainMetadata(metadata, domainId);
      return {
        id: domainId,
        label:
          domainSources[0]?.label ||
          (domainId === "ai"
            ? "AI"
            : domainId === "github"
              ? "GitHub"
              : domainId === "business"
                ? "Business"
                : "Tech"),
        keywords: [],
        sourceCount: domainSources.length,
        enabledSourceCount: domainSources.filter((entry) => {
          const selected = Array.isArray(metadata.selectedSourceIds)
            ? metadata.selectedSourceIds.filter((value) => typeof value === "string")
            : [];
          return selected.length === 0 || selected.includes(entry.label);
        }).length,
        itemCount: candidates.length,
        lastFetchedIso: toIso(
          domainSources.reduce((latest, entry) => {
            const profileMeta = isRecord(entry?.metadata) ? entry.metadata : {};
            return Math.max(
              latest,
              Number(profileMeta.latestFetchAt || profileMeta.lastFetchedAt || 0) || 0,
            );
          }, 0),
        ),
        lastDigestIso: toIso(latestDigest?.createdAt || 0),
        lastDigestAttemptIso: toIso(
          Number(domainMeta.lastDigestAttemptAt || latestDigest?.createdAt || 0) || 0,
        ),
        lastDigestError: normalizeString(domainMeta.lastDigestError) || null,
        nextDigestDate: normalizeString(domainMeta.nextDigestDate) || null,
        latestDigestId: latestDigest?.id || null,
        latestDigestDate: latestDigest?.digestDate || null,
        topItems: candidates.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          overallScore: clampPercent(item.score || 0),
          noveltyScore: clampPercent(item.metadata?.noveltyScore || 0),
          relevanceScore: clampPercent(item.metadata?.relevanceScore || item.score || 0),
          judgement: normalizeString(item.summary),
          url: item.url,
        })),
        sources: domainSources.map((source) => {
          const profileMeta = isRecord(source?.metadata) ? source.metadata : {};
          return {
            id: source.id,
            url: normalizeString(profileMeta.url) || normalizeString(profileMeta.sourceUrl) || null,
            priority: source.priority,
            stats: {
              successCount: clampInt(profileMeta.successCount, 0, 0, 100000),
              failureCount: clampInt(profileMeta.failureCount, 0, 0, 100000),
              lastSeenAt:
                Number(
                  profileMeta.lastSeenAt ||
                    profileMeta.latestFetchAt ||
                    profileMeta.lastFetchedAt ||
                    0,
                ) || null,
              lastFailureAt: Number(profileMeta.lastFailureAt || 0) || null,
              avgScore: clampPercent(profileMeta.avgScore || source.trustScore || 0),
            },
          };
        }),
      };
    }),
    digests: digests.map((digest) => ({
      id: digest.id,
      domain: digest.domain,
      digestDate: digest.digestDate,
      createdIso: toIso(digest.createdAt),
      status: digest.status,
      delivery: digest.delivery,
      itemCount: digest.items.length,
      topTitles: digest.items.slice(0, 3).map((item) => item.title),
    })),
  };
}

async function buildManagedMemoryStatus() {
  const opts = managedRuntimeStoreOptions();
  const storeCore = await loadManagedRuntimeStoreCore();
  const memoryStore = storeCore.loadRuntimeMemoryStore(opts);
  return {
    scheduler: {
      lastDistilledIso: toIso(
        memoryStore.memories.reduce((latest, entry) => Math.max(latest, entry.updatedAt || 0), 0),
      ),
      lastPersistedIso: toIso(
        Math.max(
          memoryStore.memories.reduce((latest, entry) => Math.max(latest, entry.updatedAt || 0), 0),
          memoryStore.strategies.reduce(
            (latest, entry) => Math.max(latest, entry.updatedAt || 0),
            0,
          ),
          memoryStore.metaLearning.reduce(
            (latest, entry) => Math.max(latest, entry.updatedAt || 0),
            0,
          ),
        ),
      ),
    },
    stats: {
      memoryCount: memoryStore.memories.length,
      strategyCount: memoryStore.strategies.length,
      learningCount: memoryStore.metaLearning.length,
      highConfidenceMemories: memoryStore.memories.filter(
        (entry) =>
          entry.confidence >= 75 && (!entry.invalidatedBy || entry.invalidatedBy.length === 0),
      ).length,
      invalidatedMemories: memoryStore.memories.filter(
        (entry) => Array.isArray(entry.invalidatedBy) && entry.invalidatedBy.length > 0,
      ).length,
    },
    recentMemories: [...memoryStore.memories]
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 12)
      .map((entry) => ({
        id: entry.id,
        memoryType: entry.memoryType,
        route: entry.route,
        scope: entry.scope,
        summary: truncateText(entry.summary, 180),
        confidence: entry.confidence,
        tags: entry.tags,
        invalidated: Array.isArray(entry.invalidatedBy) && entry.invalidatedBy.length > 0,
        updatedIso: toIso(entry.updatedAt),
      })),
    recentStrategies: [...memoryStore.strategies]
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 10)
      .map((entry) => ({
        id: entry.id,
        route: entry.route,
        thinkingLane: entry.thinkingLane,
        recommendedWorker: entry.worker,
        recommendedSkills: entry.skillIds,
        confidence: entry.confidence,
        invalidated: Array.isArray(entry.invalidatedBy) && entry.invalidatedBy.length > 0,
        triggerConditions: truncateText(entry.triggerConditions, 160),
        updatedIso: toIso(entry.updatedAt),
      })),
    recentLearnings: [...memoryStore.metaLearning]
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 10)
      .map((entry) => {
        const meta = isRecord(entry.metadata) ? entry.metadata : {};
        return {
          id: entry.id,
          observedPattern: truncateText(entry.summary || entry.hypothesis || "", 180),
          effectOnSuccessRate: Number(meta.effectOnSuccessRate || meta.successDelta || 0) || 0,
          effectOnTokenCost: Number(meta.effectOnTokenCost || meta.tokenDelta || 0) || 0,
          effectOnCompletionQuality:
            Number(meta.effectOnCompletionQuality || meta.qualityDelta || 0) || 0,
          adoptedAs: entry.adoptedAs,
          updatedIso: toIso(entry.updatedAt),
        };
      }),
  };
}

async function buildManagedEvolutionStatus() {
  const opts = managedRuntimeStoreOptions();
  const storeCore = await loadManagedRuntimeStoreCore();
  const memoryStore = storeCore.loadRuntimeMemoryStore(opts);
  const governanceStore = storeCore.loadRuntimeGovernanceStore(opts);
  const metadata = isRecord(governanceStore.metadata) ? governanceStore.metadata : {};
  return {
    config: {
      enabled: metadata.enabled !== false,
      autoApplyLowRisk: metadata.autoApplyLowRisk !== false,
      reviewIntervalHours: clampInt(metadata.reviewIntervalHours, 12, 1, 168),
    },
    scheduler: {
      lastTickIso: toIso(evolutionRuntime.lastTickAt),
      lastError: evolutionRuntime.lastError || null,
      active: Boolean(evolutionRuntime.active),
      lastReviewIso: toIso(
        Number(metadata.lastReviewAt || evolutionRuntime.lastReviewAt || 0) || 0,
      ),
    },
    stats: {
      candidateCount: memoryStore.evolutionMemory.length,
      shadowCount: memoryStore.evolutionMemory.filter((entry) => entry.adoptionState === "shadow")
        .length,
      candidateStageCount: memoryStore.evolutionMemory.filter(
        (entry) => entry.adoptionState === "candidate",
      ).length,
      adoptedCount: memoryStore.evolutionMemory.filter((entry) => entry.adoptionState === "adopted")
        .length,
    },
    candidates: [...memoryStore.evolutionMemory]
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 20)
      .map((entry) => {
        const linkedShadow = governanceStore.shadowEvaluations.find(
          (shadow) =>
            shadow.candidateRef === entry.id || shadow.candidateRef === entry.candidateRef,
        );
        return {
          id: entry.id,
          targetLayer: entry.targetLayer,
          candidateType: entry.candidateType,
          candidateRef: entry.candidateRef,
          adoptionState: entry.adoptionState,
          invalidated: false,
          notes: truncateText(entry.summary, 180),
          shadowMetrics: isRecord(linkedShadow?.metadata) ? linkedShadow.metadata : null,
          expectedEffect: linkedShadow?.expectedEffect || null,
          measuredEffect: linkedShadow?.measuredEffect || null,
          updatedIso: toIso(entry.updatedAt),
        };
      }),
  };
}

async function upsertManagedAutopilotTask(inputTask) {
  const payload = isRecord(inputTask) ? inputTask : {};
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const taskEngine = await loadManagedRuntimeTaskEngineCore();
  taskEngine.upsertRuntimeTask(
    {
      id: normalizeString(payload.id) || undefined,
      title: normalizeString(payload.title) || normalizeString(payload.goal) || "Untitled task",
      route: normalizeString(payload.route || payload.taskKind, "general"),
      status: normalizeString(payload.status) || "queued",
      priority: normalizeString(payload.priority) || undefined,
      budgetMode: normalizeString(payload.budgetMode) || undefined,
      retrievalMode: normalizeString(payload.retrievalMode) || undefined,
      goal: normalizeString(payload.goal) || undefined,
      successCriteria:
        normalizeString(payload.successCriteria || payload.doneCriteria) || undefined,
      tags: normalizeStringArray(payload.tags),
      worker: normalizeString(payload.assignee) || undefined,
      skillIds: normalizeStringArray(payload.skillHints),
      memoryRefs: normalizeStringArray(payload.memoryRefs),
      intelRefs: normalizeStringArray(payload.intelRefs),
      recurring: payload.recurring === true,
      maintenance: payload.maintenance === true,
      planSummary: normalizeString(payload.planSummary) || undefined,
      nextAction: normalizeString(payload.nextAction) || undefined,
      blockedReason: normalizeString(payload.blockedReason) || undefined,
      lastError: normalizeString(payload.lastError) || undefined,
      reportPolicy: mapLegacyReportPolicyToManaged(payload.reportPolicy),
      nextRunAt: parseOptionalTimestamp(payload.nextRunAt) || undefined,
      metadata: buildManagedAutopilotMetadataPatch(payload),
    },
    opts,
  );
  return await buildManagedAutopilotStatus();
}

async function transitionManagedAutopilotTask(taskId, patch) {
  const patchValue = isRecord(patch) ? patch : {};
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const [taskEngine, storeCore] = await Promise.all([
    loadManagedRuntimeTaskEngineCore(),
    loadManagedRuntimeStoreCore(),
  ]);
  const currentTask =
    storeCore.loadRuntimeTaskStore(opts).tasks.find((task) => task.id === taskId) || null;
  const metadataPatch = buildManagedAutopilotMetadataPatch(patchValue);
  const nextStatus = normalizeAutopilotStatusValue(
    patchValue.status,
    currentTask?.status || "queued",
  );
  if (
    ["completed", "blocked", "waiting_user", "waiting_external", "cancelled"].includes(nextStatus)
  ) {
    const nextRunAt = parseOptionalTimestamp(patchValue.nextRunAt);
    taskEngine.applyRuntimeTaskResult(
      {
        taskId,
        status: nextStatus,
        summary:
          normalizeString(patchValue.summary || patchValue.lastResult || patchValue.notes) ||
          undefined,
        lastResult: normalizeString(patchValue.lastResult || patchValue.summary) || undefined,
        lastError: normalizeString(patchValue.lastError) || undefined,
        blockedReason: normalizeString(patchValue.blockedReason) || undefined,
        needsUser:
          nextStatus === "waiting_user"
            ? normalizeString(patchValue.summary || patchValue.blockedReason) || undefined
            : undefined,
        nextRunInMinutes: nextRunAt
          ? Math.max(1, Math.round((nextRunAt - nowValue) / 60000))
          : undefined,
        planSummary: normalizeString(patchValue.planSummary) || undefined,
        nextAction: normalizeString(patchValue.nextAction) || undefined,
        workerOutput: normalizeString(patchValue.workerOutput) || undefined,
        cliExitCode: Number.isFinite(Number(patchValue.cliExitCode))
          ? Number(patchValue.cliExitCode)
          : undefined,
        now: nowValue,
      },
      opts,
    );
    taskEngine.upsertRuntimeTask(
      {
        id: taskId,
        route: normalizeString(patchValue.route) || undefined,
        worker: normalizeString(patchValue.assignee) || undefined,
        priority: normalizeString(patchValue.priority) || undefined,
        budgetMode: normalizeString(patchValue.budgetMode) || undefined,
        retrievalMode: normalizeString(patchValue.retrievalMode) || undefined,
        successCriteria:
          normalizeString(patchValue.successCriteria || patchValue.doneCriteria) || undefined,
        skillIds: hasDefinedOwn(patchValue, "skillHints")
          ? normalizeStringArray(patchValue.skillHints)
          : undefined,
        memoryRefs: hasDefinedOwn(patchValue, "memoryRefs")
          ? normalizeStringArray(patchValue.memoryRefs)
          : undefined,
        intelRefs: hasDefinedOwn(patchValue, "intelRefs")
          ? normalizeStringArray(patchValue.intelRefs)
          : undefined,
        reportPolicy: mapLegacyReportPolicyToManaged(patchValue.reportPolicy),
        metadata: metadataPatch,
      },
      opts,
    );
  } else {
    taskEngine.upsertRuntimeTask(
      {
        id: taskId,
        status: nextStatus,
        route: normalizeString(patchValue.route) || undefined,
        worker: normalizeString(patchValue.assignee) || undefined,
        priority: normalizeString(patchValue.priority) || undefined,
        budgetMode: normalizeString(patchValue.budgetMode) || undefined,
        retrievalMode: normalizeString(patchValue.retrievalMode) || undefined,
        successCriteria:
          normalizeString(patchValue.successCriteria || patchValue.doneCriteria) || undefined,
        skillIds: hasDefinedOwn(patchValue, "skillHints")
          ? normalizeStringArray(patchValue.skillHints)
          : undefined,
        memoryRefs: hasDefinedOwn(patchValue, "memoryRefs")
          ? normalizeStringArray(patchValue.memoryRefs)
          : undefined,
        intelRefs: hasDefinedOwn(patchValue, "intelRefs")
          ? normalizeStringArray(patchValue.intelRefs)
          : undefined,
        planSummary: normalizeString(patchValue.planSummary) || undefined,
        nextAction: normalizeString(patchValue.nextAction) || undefined,
        blockedReason: normalizeString(patchValue.blockedReason) || undefined,
        lastError: normalizeString(patchValue.lastError) || undefined,
        reportPolicy: mapLegacyReportPolicyToManaged(patchValue.reportPolicy),
        nextRunAt: parseOptionalTimestamp(patchValue.nextRunAt) || undefined,
        metadata: metadataPatch,
      },
      opts,
    );
  }
  return await buildManagedAutopilotStatus();
}

async function deleteManagedAutopilotTask(taskId) {
  const nowValue = nowTs();
  const opts = managedRuntimeStoreOptions(nowValue);
  const storeCore = await loadManagedRuntimeStoreCore();
  const taskStore = storeCore.loadRuntimeTaskStore(opts);
  taskStore.tasks = taskStore.tasks.filter((task) => task.id !== taskId);
  taskStore.runs = taskStore.runs.filter((run) => run.taskId !== taskId);
  taskStore.steps = taskStore.steps.filter((step) => step.taskId !== taskId);
  taskStore.reviews = taskStore.reviews.filter((review) => review.taskId !== taskId);
  storeCore.saveRuntimeTaskStore(taskStore, opts);
  if (typeof storeCore.appendRuntimeEvent === "function") {
    storeCore.appendRuntimeEvent("runtime_task_deleted", { taskId }, opts);
  }
  return await buildManagedAutopilotStatus();
}

async function loadAutopilotStatus() {
  return await buildManagedAutopilotStatus();
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
      if (pluginApi)
        pluginApi.logger.warn(
          `[openclaw-codex-control] autopilot tick failed: ${autopilotRuntime.lastError}`,
        );
    }
    try {
      await runIntelMaintenance();
      intelRuntime.lastError = null;
    } catch (error) {
      intelRuntime.lastError = String(error?.message || error);
      if (pluginApi)
        pluginApi.logger.warn(
          `[openclaw-codex-control] intel tick failed: ${intelRuntime.lastError}`,
        );
    }
    try {
      await runEvolutionReview();
      evolutionRuntime.lastError = null;
    } catch (error) {
      evolutionRuntime.lastError = String(error?.message || error);
      if (pluginApi)
        pluginApi.logger.warn(
          `[openclaw-codex-control] evolution tick failed: ${evolutionRuntime.lastError}`,
        );
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
  const values = [stats.cooldownUntil, stats.disabledUntil].filter(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
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
  const explicitOrder = Array.isArray(storeOrder)
    ? storeOrder
    : Array.isArray(configOrder)
      ? configOrder
      : null;
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
          cooldownUntil: resolveCooldownUntil(stats) || ts,
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
        cooldownUntil: resolveCooldownUntil(stats) || ts,
      });
      continue;
    }
    available.push({
      profileId,
      typeScore: typeScore(store.profiles?.[profileId]),
      lastUsed: Number(store.usageStats?.[profileId]?.lastUsed || 0),
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
  const authMeta = isRecord(jwt?.["https://api.openai.com/auth"])
    ? jwt["https://api.openai.com/auth"]
    : {};
  const profileMeta = isRecord(jwt?.["https://api.openai.com/profile"])
    ? jwt["https://api.openai.com/profile"]
    : {};
  const email = String(profile?.email || profileMeta.email || "").trim() || null;
  const accountId = String(profile?.accountId || authMeta.chatgpt_account_id || "").trim() || null;
  const plan = String(authMeta.chatgpt_plan_type || "").trim() || null;
  return {
    email,
    accountId,
    plan,
    suggestedAlias: buildSuggestedAlias(profileId, { email, accountId }),
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
    profiles: isRecord(store?.profiles) ? { ...store.profiles } : {},
  };
}

function parseCodexCliAuthMetadata(auth) {
  const tokens = isRecord(auth?.tokens) ? auth.tokens : {};
  const idJwt = decodeJwtPayload(tokens.id_token);
  const accessJwt = decodeJwtPayload(tokens.access_token);
  const ts = nowTs();
  const idAuthMeta = isRecord(idJwt?.["https://api.openai.com/auth"])
    ? idJwt["https://api.openai.com/auth"]
    : {};
  const accessAuthMeta = isRecord(accessJwt?.["https://api.openai.com/auth"])
    ? accessJwt["https://api.openai.com/auth"]
    : {};
  const authMeta = Object.keys(accessAuthMeta).length ? accessAuthMeta : idAuthMeta;
  const profileMeta = isRecord(accessJwt?.["https://api.openai.com/profile"])
    ? accessJwt["https://api.openai.com/profile"]
    : {};
  const organizations = (Array.isArray(idAuthMeta.organizations) ? idAuthMeta.organizations : [])
    .filter((value) => isRecord(value))
    .map((organization) => ({
      id: String(organization.id || "").trim() || null,
      title: String(organization.title || "").trim() || null,
      role: String(organization.role || "").trim() || null,
      isDefault: Boolean(organization.is_default),
    }));
  const defaultOrganization =
    organizations.find((organization) => organization.isDefault) || organizations[0] || null;
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
      workspaceTitle,
    }),
  };
}

function buildCodexCliIdentity(meta) {
  if (!meta) return null;
  const parts = [
    String(meta.accountId || "")
      .trim()
      .toLowerCase(),
    String(meta.workspaceId || "")
      .trim()
      .toLowerCase(),
    String(meta.email || "")
      .trim()
      .toLowerCase(),
  ];
  if (!parts.some(Boolean)) return null;
  return parts.join("|");
}

function validateCodexCliAuth(auth) {
  const tokens = isRecord(auth?.tokens) ? auth.tokens : {};
  if (!tokens.id_token)
    throw new Error("Current Codex CLI auth is missing id_token. Run codex login again.");
  if (!tokens.refresh_token)
    throw new Error("Current Codex CLI auth is missing refresh_token. Run codex login again.");
}

async function loadCodexCliConfigSummary() {
  const text = await readTextFile(CODEX_CLI_CONFIG_PATH, null);
  if (text == null) {
    return {
      model: null,
      reasoning: null,
      serviceTier: null,
    };
  }
  const extract = (key) => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`, "m"));
    return match ? match[1].trim() || null : null;
  };
  return {
    model: extract("model"),
    reasoning: extract("model_reasoning_effort"),
    serviceTier: extract("service_tier"),
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
    isCurrent: currentProfileId === profileId,
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
    readJsonFile(CODEX_CLI_AUTH_PATH, null),
  ]);
  const store = normalizeCodexCliStore(rawStore);
  const currentMeta = currentAuth ? parseCodexCliAuthMetadata(currentAuth) : null;
  const currentIdentity = buildCodexCliIdentity(currentMeta);
  let currentProfileId = null;
  const profiles = await Promise.all(
    Object.entries(store.profiles).map(async ([profileId, entry]) => {
      const view = buildCodexCliProfileView(profileId, entry, null);
      if (!currentProfileId && currentIdentity && buildCodexCliIdentity(view) === currentIdentity) {
        currentProfileId = profileId;
      }
      return {
        ...view,
        usage: await fetchCodexUsageFromAuthJson(entry?.auth || null),
      };
    }),
  );

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
      codexRoot: CODEX_HOME,
    },
    current: currentMeta
      ? {
          ...currentMeta,
          usage: currentUsage,
          matchedProfileId: currentProfileId,
          authFilePresent: true,
        }
      : {
          authFilePresent: false,
          matchedProfileId: null,
        },
    profileCount: profiles.length,
    profiles: profiles.map((profile) => ({
      ...profile,
      isCurrent: profile.profileId === currentProfileId,
    })),
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
  let profileId =
    requestedProfileId ||
    matchedProfileId ||
    makeUniqueProfileId(meta.suggestedAlias, store.profiles);

  if (
    requestedProfileId &&
    store.profiles[requestedProfileId] &&
    requestedProfileId !== matchedProfileId
  ) {
    throw new Error(`CLI profile already exists: ${requestedProfileId}`);
  }

  const existing = store.profiles[profileId];
  store.profiles[profileId] = {
    savedAt: Number(existing?.savedAt || 0) || nowTs(),
    updatedAt: nowTs(),
    auth: currentAuth,
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
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: String(refreshToken || "").trim(),
        client_id: OPENAI_OAUTH_CLIENT_ID,
      }),
      signal: controller.signal,
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
    if (
      !json?.access_token ||
      !json?.refresh_token ||
      !json?.id_token ||
      typeof json?.expires_in !== "number"
    ) {
      throw new Error("OpenAI token refresh response is missing required fields.");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      idToken: json.id_token,
      expiresAt: nowTs() + json.expires_in * 1000,
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
      account_id: "",
    },
    last_refresh: new Date().toISOString(),
  });
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fullTokens.idToken,
      access_token: fullTokens.accessToken,
      refresh_token: fullTokens.refreshToken,
      account_id: accessMeta.accountId,
    },
    last_refresh: new Date().toISOString(),
  };
}

async function upsertCodexCliProfileFromAuth(auth, preferredAlias) {
  validateCodexCliAuth(auth);
  const meta = parseCodexCliAuthMetadata(auth);
  const store = normalizeCodexCliStore(await loadCodexCliStore());
  const matchedProfileId = findCodexCliProfileIdByIdentity(store, meta);
  const requestedProfileId = preferredAlias ? sanitizeCliProfileId(preferredAlias) : null;
  let profileId =
    matchedProfileId ||
    requestedProfileId ||
    makeUniqueProfileId(meta.suggestedAlias, store.profiles);
  if (
    requestedProfileId &&
    store.profiles[requestedProfileId] &&
    requestedProfileId !== matchedProfileId
  ) {
    profileId = makeUniqueProfileId(requestedProfileId, store.profiles);
  }
  const existing = store.profiles[profileId];
  store.profiles[profileId] = {
    savedAt: Number(existing?.savedAt || 0) || nowTs(),
    updatedAt: nowTs(),
    auth,
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
      Accept: "application/json",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const response = await fetch(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    const windows = [];
    if (isRecord(data.rate_limit?.primary_window)) {
      const entry = data.rate_limit.primary_window;
      windows.push({
        label: `${Math.round((entry.limit_window_seconds || 10800) / 3600)}h`,
        usedPercent: clampPercent(entry.used_percent || 0),
        resetAt: entry.reset_at ? entry.reset_at * 1000 : null,
      });
    }
    if (isRecord(data.rate_limit?.secondary_window)) {
      const entry = data.rate_limit.secondary_window;
      const hours = Math.round((entry.limit_window_seconds || 86400) / 3600);
      windows.push({
        label: hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`,
        usedPercent: clampPercent(entry.used_percent || 0),
        resetAt: entry.reset_at ? entry.reset_at * 1000 : null,
      });
    }
    return {
      plan: data.plan_type || null,
      windows,
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
    ...(params.email ? { email: params.email } : {}),
  };

  const existingProviderOrder = Array.isArray(auth.order?.[params.provider])
    ? auth.order[params.provider]
    : undefined;
  const configuredProviderProfiles = Object.entries(profiles)
    .filter(([, profile]) => String(profile?.provider || "").toLowerCase() === normalizedProvider)
    .map(([profileId, profile]) => ({ profileId, mode: profile?.mode }));
  const preferProfileFirst = params.preferProfileFirst !== false;
  const reorderedProviderOrder =
    existingProviderOrder && preferProfileFirst
      ? [
          params.profileId,
          ...existingProviderOrder.filter((profileId) => profileId !== params.profileId),
        ]
      : existingProviderOrder;
  const hasMixedConfiguredModes = configuredProviderProfiles.some(
    ({ profileId, mode }) => profileId !== params.profileId && mode !== params.mode,
  );
  const derivedProviderOrder =
    existingProviderOrder === undefined && preferProfileFirst && hasMixedConfiguredModes
      ? [
          params.profileId,
          ...configuredProviderProfiles
            .map(({ profileId }) => profileId)
            .filter((profileId) => profileId !== params.profileId),
        ]
      : undefined;
  const order =
    existingProviderOrder !== undefined
      ? {
          ...(isRecord(auth.order) ? auth.order : {}),
          [params.provider]: reorderedProviderOrder?.includes(params.profileId)
            ? reorderedProviderOrder
            : [...(reorderedProviderOrder || []), params.profileId],
        }
      : derivedProviderOrder
        ? {
            ...(isRecord(auth.order) ? auth.order : {}),
            [params.provider]: derivedProviderOrder,
          }
        : auth.order;

  return {
    ...nextConfig,
    auth: {
      ...auth,
      profiles,
      ...(order ? { order } : {}),
    },
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
    updatedAt: activeLogin.updatedAt,
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

  const email =
    String(
      parseProfileMetadata("incoming", {
        type: "oauth",
        access: params.creds.access,
        accountId: params.creds.accountId,
      }).email || "",
    ).trim() || null;
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
    if (
      existingAccountId &&
      params.creds.accountId &&
      existingAccountId !== params.creds.accountId
    ) {
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
    ...(email ? { email } : {}),
  };

  config = ensureConfigAuthProfile(config, {
    profileId,
    provider: PROVIDER,
    mode: "oauth",
    email,
  });

  await Promise.all([
    writeJsonAtomic(CONFIG_PATH, config),
    writeJsonAtomic(AUTH_STORE_PATH, store),
  ]);

  return {
    profileId,
    email,
    accountId: params.creds.accountId || null,
    preservedProfileId,
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
    manualInput: createDeferred(),
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
            instructions: instructions || "Open the login page and complete the OAuth flow.",
          });
          authReady.resolve();
        },
        onProgress(message) {
          updateActiveLogin({ progress: String(message || "") });
        },
        async onManualCodeInput() {
          updateActiveLogin({
            status: "waiting-callback",
            progress: "Waiting for browser callback or pasted redirect URL…",
          });
          return await login.manualInput.promise;
        },
        async onPrompt(prompt) {
          updateActiveLogin({
            status: "waiting-callback",
            progress: prompt?.message || "Paste the final redirect URL or authorization code.",
          });
          return await login.manualInput.promise;
        },
      });

      updateActiveLogin({
        status: "saving",
        progress: "Saving OAuth credentials…",
      });
      const persisted = await persistOAuthLogin({
        creds,
        targetProfileId: login.targetProfileId,
      });
      updateActiveLogin({
        status: "completed",
        progress: "OAuth login complete.",
        result: persisted,
      });
      authReady.resolve();
    } catch (error) {
      updateActiveLogin({
        status: login.status === "cancelled" ? "cancelled" : "error",
        error: String(error?.message || error),
        progress: null,
      });
      authReady.resolve();
    }
  })();

  await Promise.race([authReady.promise, new Promise((resolve) => setTimeout(resolve, 5000))]);
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
    progress: "Exchanging authorization code for token…",
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
    progress: null,
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
    configProfile: config.auth?.profiles?.[profileId] || null,
  };
}

async function loadStatus(includeUsage = true) {
  const [config, store, codexCli, autopilot, intel, memory, evolution, recentEvents] =
    await Promise.all([
      loadConfig(),
      loadStore(),
      loadCodexCliStatus(),
      loadAutopilotStatus(),
      buildManagedIntelStatus(),
      buildManagedMemoryStatus(),
      buildManagedEvolutionStatus(),
      readRecentSystemEvents(24),
    ]);
  const profileIds = listProviderProfileIds(store);
  const effectiveOrder = computeEffectiveOrder(store, config, profileIds);
  const usageById = {};
  if (includeUsage) {
    await Promise.all(
      profileIds.map(async (profileId) => {
        usageById[profileId] = await fetchCodexUsage(store.profiles[profileId]);
      }),
    );
  }
  return {
    config: {
      defaultModel: config.agents?.defaults?.model?.primary || null,
      imageModel: config.agents?.defaults?.imageModel?.primary || null,
      thinkingDefault: config.agents?.defaults?.thinkingDefault || null,
      workspace: config.agents?.defaults?.workspace || null,
    },
    auth: {
      explicitOrder: Array.isArray(store.order?.[PROVIDER]) ? store.order[PROVIDER] : null,
      configOrder: Array.isArray(config.auth?.order?.[PROVIDER])
        ? config.auth.order[PROVIDER]
        : null,
      effectiveOrder,
      autoMode: !Array.isArray(store.order?.[PROVIDER]),
      profileCount: profileIds.length,
      lastGood: store.lastGood?.[PROVIDER] || null,
    },
    codexCli,
    autopilot,
    intel,
    memory,
    evolution,
    recentEvents,
    login: summarizeLoginSession(),
    profiles: profileIds.map((profileId) =>
      buildProfileView(
        profileId,
        store.profiles[profileId],
        store,
        config,
        effectiveOrder,
        usageById,
      ),
    ),
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
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(body));
}

function sendJs(res, source) {
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(source);
}

function isLoopbackAddress(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return text === "127.0.0.1" || text === "::1" || text === "::ffff:127.0.0.1";
}

function isTrustedPluginApiRequest(req) {
  const host = String(req.headers?.host || "")
    .trim()
    .toLowerCase();
  const origin = String(req.headers?.origin || "").trim();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  const site = String(req.headers?.["sec-fetch-site"] || "")
    .trim()
    .toLowerCase();
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
  const order = dedupe([
    profileId,
    ...computeEffectiveOrder(store, config, profileIds),
    ...profileIds,
  ]);
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
    const order = dedupe([
      profileId,
      ...computeEffectiveOrder(store, config, profileIds),
      ...profileIds,
    ]);
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
    writeJsonAtomic(AUTH_STORE_PATH, store),
  ]);
}

module.exports = {
  id: "openclaw-codex-control",
  name: "OpenClaw Codex Control",
  register(api) {
    pluginApi = api;
    const routeBase =
      String(api.pluginConfig?.routeBase || DEFAULT_ROUTE_BASE).trim() || DEFAULT_ROUTE_BASE;
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
            "Cache-Control": "no-cache",
          });
          res.end();
          return true;
        }
        sendJs(res, source.replaceAll("__ROUTE_BASE__", routeBase));
        return true;
      },
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
            sendJson(res, 200, await buildManagedIntelStatus());
            return true;
          }

          if (pathname === `${apiBase}/intel/run` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(
              res,
              200,
              await runIntelMaintenance({
                domainId: normalizeString(body.domainId),
                forceRefresh: Boolean(body.forceRefresh),
                forceDigest: Boolean(body.forceDigest),
              }),
            );
            return true;
          }

          if (pathname === `${apiBase}/memory/status` && req.method === "GET") {
            sendJson(res, 200, await buildManagedMemoryStatus());
            return true;
          }

          if (pathname === `${apiBase}/memory/invalidate` && req.method === "POST") {
            const body = await readJsonBody(req);
            const reasonEvent = await appendSystemEvent("memory_invalidation_requested", {
              memoryIds: normalizeStringArray(body.memoryIds || []),
              reason: normalizeString(body.reason),
            });
            const mutations = await loadManagedRuntimeMutationsCore();
            const opts = managedRuntimeStoreOptions(nowTs());
            sendJson(
              res,
              200,
              mutations.invalidateMemoryLineage(
                {
                  memoryIds: normalizeStringArray(body.memoryIds || []),
                  reasonEventId: reasonEvent.eventId,
                  now: opts.now,
                },
                opts,
              ),
            );
            return true;
          }

          if (pathname === `${apiBase}/evolution/status` && req.method === "GET") {
            sendJson(res, 200, await buildManagedEvolutionStatus());
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
            sendJson(
              res,
              200,
              await upsertManagedAutopilotTask(isRecord(body.task) ? body.task : body),
            );
            return true;
          }

          if (pathname === `${apiBase}/autopilot/task/transition` && req.method === "POST") {
            const body = await readJsonBody(req);
            const transitionPatch = {
              status: body.status,
              runState: isRecord(body.runState)
                ? body.runState
                : {
                    lastResultStatus: body.status,
                    lastResultSummary: body.summary,
                    lastWorkerOutput: body.workerOutput,
                  },
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
              "optimizationState",
            ];
            for (const key of optionalKeys) {
              if (body[key] !== undefined) transitionPatch[key] = body[key];
            }
            if (body.lastResult !== undefined || body.summary !== undefined) {
              transitionPatch.lastResult =
                body.lastResult !== undefined ? body.lastResult : body.summary;
            }
            sendJson(
              res,
              200,
              await transitionManagedAutopilotTask(
                String(body.taskId || "").trim(),
                transitionPatch,
              ),
            );
            return true;
          }

          if (pathname === `${apiBase}/autopilot/task/delete` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(res, 200, await deleteManagedAutopilotTask(String(body.taskId || "").trim()));
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
            await renameProfile(
              String(body.profileId || "").trim(),
              String(body.alias || "").trim(),
            );
            sendJson(res, 200, await loadStatus(true));
            return true;
          }

          if (pathname === `${apiBase}/login/start` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(
              res,
              200,
              await startLoginSession({
                targetProfileId: String(body.targetProfileId || "").trim() || null,
              }),
            );
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
                Boolean(body.setOpenClawCurrent),
              ),
            );
            return true;
          }

          if (pathname === `${apiBase}/codex-cli/rename` && req.method === "POST") {
            const body = await readJsonBody(req);
            sendJson(
              res,
              200,
              await renameCodexCliProfile(
                String(body.profileId || "").trim(),
                String(body.alias || "").trim(),
              ),
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
          api.logger.warn(
            `[openclaw-codex-control] ${pathname} failed: ${String(error?.message || error)}`,
          );
          sendJson(res, 500, { error: String(error?.message || error) });
          return true;
        }
      },
    });

    api.logger.info(`[openclaw-codex-control] injection script: ${injectPath}`);
    api.logger.info(`[openclaw-codex-control] api base: ${apiBase}`);

    api.on(
      "before_prompt_build",
      async (_event, ctx) => {
        try {
          const sessionKey = normalizeString(ctx?.sessionKey);
          if (!sessionKey) return;
          const agentId = normalizeString(ctx?.agentId, "main");
          const autopilotStatus = await loadAutopilotStatus();
          if (
            autopilotStatus?.config?.heartbeatEnabled &&
            (await isHeartbeatSession(agentId, sessionKey))
          ) {
            const heartbeatBlock = buildHeartbeatAutopilotContext(autopilotStatus);
            if (heartbeatBlock) {
              return {
                prependContext: heartbeatBlock,
              };
            }
          }
          const task = await captureAutopilotTaskFromSession(ctx);
          if (!task) return;
          const block = buildAutopilotPromptBlock(
            task,
            autopilotStatus?.config || DEFAULT_AUTOPILOT_CONFIG,
          );
          if (!block) return;
          return {
            prependContext: block,
          };
        } catch (error) {
          api.logger.warn(
            `[openclaw-codex-control] before_prompt_build capture failed: ${String(error?.message || error)}`,
          );
          return;
        }
      },
      { priority: 18 },
    );

    startAutopilotTicker();
  },
};
