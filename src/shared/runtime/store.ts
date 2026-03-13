import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  RetrievalSourceSet,
  RuntimeEventRecord,
  RuntimeGovernanceStore,
  RuntimeIntelStore,
  RuntimeMemoryStore,
  RuntimeTaskDefaults,
  RuntimeTaskStore,
  RuntimeMetadata,
} from "./contracts.js";

const RUNTIME_STORE_SEGMENTS = ["runtime", "v1"] as const;
const TASK_STORE_FILENAME = "task-store.json";
const MEMORY_STORE_FILENAME = "memory-store.json";
const INTEL_STORE_FILENAME = "intel-store.json";
const GOVERNANCE_STORE_FILENAME = "governance-store.json";
const EVENTS_FILENAME = "events.jsonl";

export type RuntimeStoreOptions = {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  now?: number;
};

export type RuntimeStoreBundle = {
  taskStore: RuntimeTaskStore;
  memoryStore: RuntimeMemoryStore;
  intelStore: RuntimeIntelStore;
  governanceStore: RuntimeGovernanceStore;
};

export type RuntimeStorePaths = {
  root: string;
  taskStorePath: string;
  memoryStorePath: string;
  intelStorePath: string;
  governanceStorePath: string;
  eventsPath: string;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildDefaultTaskDefaults(): RuntimeTaskDefaults {
  return {
    defaultBudgetMode: "balanced",
    defaultRetrievalMode: "light",
    maxInputTokensPerTurn: 6000,
    maxContextChars: 9000,
    maxRemoteCallsPerTask: 6,
  };
}

function buildDefaultTaskStore(): RuntimeTaskStore {
  return {
    version: "v1",
    defaults: buildDefaultTaskDefaults(),
    tasks: [],
    runs: [],
    steps: [],
    reviews: [],
  };
}

function buildDefaultMemoryStore(): RuntimeMemoryStore {
  return {
    version: "v1",
    memories: [],
    strategies: [],
    metaLearning: [],
    evolutionMemory: [],
  };
}

function buildDefaultIntelStore(): RuntimeIntelStore {
  return {
    version: "v1",
    enabled: true,
    digestEnabled: true,
    candidateLimitPerDomain: 20,
    digestItemLimitPerDomain: 10,
    exploitItemsPerDigest: 8,
    exploreItemsPerDigest: 2,
    candidates: [],
    digestItems: [],
    sourceProfiles: [],
    topicProfiles: [],
    usefulnessRecords: [],
    pinnedRecords: [],
    metadata: {
      refreshMinutes: 180,
      maxItemsPerSourceInDigest: 2,
      recentDigestTopicWindowDays: 5,
      githubSearchWindowDays: 7,
    },
  };
}

function buildDefaultGovernanceStore(): RuntimeGovernanceStore {
  return {
    version: "v1",
    entries: [],
    shadowEvaluations: [],
  };
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeTaskMetadata(metadata: unknown): RuntimeMetadata | undefined {
  const record = toRecord(metadata);
  if (!record) {
    return undefined;
  }
  const runtimeTask = toRecord(record.runtimeTask) ?? {};
  const taskContext = {
    ...(toRecord(record.legacyCompatibility) ?? {}),
    ...(toRecord(record.taskContext) ?? {}),
  };
  const legacyRunState = toRecord(record.legacyRunState);
  if (legacyRunState && !toRecord(runtimeTask.runState)) {
    runtimeTask.runState = legacyRunState;
  }
  delete record.legacyCompatibility;
  delete record.legacyRunState;
  if (Object.keys(runtimeTask).length > 0) {
    record.runtimeTask = runtimeTask;
  } else {
    delete record.runtimeTask;
  }
  if (Object.keys(taskContext).length > 0) {
    record.taskContext = taskContext;
  } else {
    delete record.taskContext;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function normalizeTaskStore(raw: RuntimeTaskStore | null): RuntimeTaskStore {
  const fallback = buildDefaultTaskStore();
  if (!raw) return fallback;
  return {
    version: "v1",
    defaults: {
      defaultBudgetMode:
        raw.defaults?.defaultBudgetMode === "strict" ||
        raw.defaults?.defaultBudgetMode === "deep" ||
        raw.defaults?.defaultBudgetMode === "balanced"
          ? raw.defaults.defaultBudgetMode
          : fallback.defaults.defaultBudgetMode,
      defaultRetrievalMode:
        raw.defaults?.defaultRetrievalMode === "off" ||
        raw.defaults?.defaultRetrievalMode === "deep" ||
        raw.defaults?.defaultRetrievalMode === "light"
          ? raw.defaults.defaultRetrievalMode
          : fallback.defaults.defaultRetrievalMode,
      maxInputTokensPerTurn: toNumber(
        raw.defaults?.maxInputTokensPerTurn,
        fallback.defaults.maxInputTokensPerTurn,
      ),
      maxContextChars: toNumber(raw.defaults?.maxContextChars, fallback.defaults.maxContextChars),
      maxRemoteCallsPerTask: toNumber(
        raw.defaults?.maxRemoteCallsPerTask,
        fallback.defaults.maxRemoteCallsPerTask,
      ),
    },
    tasks: toArray<RuntimeTaskStore["tasks"][number]>(raw.tasks).map((task) => ({
      ...task,
      metadata: normalizeTaskMetadata(task.metadata),
    })),
    runs: toArray(raw.runs),
    steps: toArray(raw.steps),
    reviews: toArray(raw.reviews),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeMemoryStore(raw: RuntimeMemoryStore | null): RuntimeMemoryStore {
  const fallback = buildDefaultMemoryStore();
  if (!raw) return fallback;
  return {
    version: "v1",
    memories: toArray(raw.memories),
    strategies: toArray(raw.strategies),
    metaLearning: toArray(raw.metaLearning),
    evolutionMemory: toArray(raw.evolutionMemory),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeIntelStore(raw: RuntimeIntelStore | null): RuntimeIntelStore {
  const fallback = buildDefaultIntelStore();
  if (!raw) return fallback;
  return {
    version: "v1",
    enabled: toBoolean(raw.enabled, fallback.enabled),
    digestEnabled: toBoolean(raw.digestEnabled, fallback.digestEnabled),
    candidateLimitPerDomain: toNumber(
      raw.candidateLimitPerDomain,
      fallback.candidateLimitPerDomain,
    ),
    digestItemLimitPerDomain: toNumber(
      raw.digestItemLimitPerDomain,
      fallback.digestItemLimitPerDomain,
    ),
    exploitItemsPerDigest: toNumber(
      raw.exploitItemsPerDigest,
      fallback.exploitItemsPerDigest,
    ),
    exploreItemsPerDigest: toNumber(
      raw.exploreItemsPerDigest,
      fallback.exploreItemsPerDigest,
    ),
    candidates: toArray(raw.candidates),
    digestItems: toArray(raw.digestItems),
    sourceProfiles: toArray(raw.sourceProfiles),
    topicProfiles: toArray(raw.topicProfiles),
    usefulnessRecords: toArray(raw.usefulnessRecords),
    pinnedRecords: toArray(raw.pinnedRecords),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeGovernanceStore(raw: RuntimeGovernanceStore | null): RuntimeGovernanceStore {
  const fallback = buildDefaultGovernanceStore();
  if (!raw) return fallback;
  return {
    version: "v1",
    entries: toArray(raw.entries),
    shadowEvaluations: toArray(raw.shadowEvaluations),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

export function resolveRuntimeStorePaths(opts: RuntimeStoreOptions = {}): RuntimeStorePaths {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const root = resolver.resolveDataPath(...RUNTIME_STORE_SEGMENTS);
  return {
    root,
    taskStorePath: path.join(root, TASK_STORE_FILENAME),
    memoryStorePath: path.join(root, MEMORY_STORE_FILENAME),
    intelStorePath: path.join(root, INTEL_STORE_FILENAME),
    governanceStorePath: path.join(root, GOVERNANCE_STORE_FILENAME),
    eventsPath: path.join(root, EVENTS_FILENAME),
  };
}

export function hasAuthoritativeRuntimeStore(opts: RuntimeStoreOptions = {}): boolean {
  const paths = resolveRuntimeStorePaths(opts);
  return (
    fs.existsSync(paths.taskStorePath) ||
    fs.existsSync(paths.memoryStorePath) ||
    fs.existsSync(paths.intelStorePath) ||
    fs.existsSync(paths.governanceStorePath)
  );
}

export function loadRuntimeTaskStore(opts: RuntimeStoreOptions = {}): RuntimeTaskStore {
  const { taskStorePath } = resolveRuntimeStorePaths(opts);
  return normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(taskStorePath, null));
}

export function saveRuntimeTaskStore(
  store: RuntimeTaskStore,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskStore {
  const { taskStorePath } = resolveRuntimeStorePaths(opts);
  const normalized = normalizeTaskStore(store);
  writeJsonFile(taskStorePath, normalized);
  return normalized;
}

export function loadRuntimeMemoryStore(opts: RuntimeStoreOptions = {}): RuntimeMemoryStore {
  const { memoryStorePath } = resolveRuntimeStorePaths(opts);
  return normalizeMemoryStore(readJsonFile<RuntimeMemoryStore | null>(memoryStorePath, null));
}

export function saveRuntimeMemoryStore(
  store: RuntimeMemoryStore,
  opts: RuntimeStoreOptions = {},
): RuntimeMemoryStore {
  const { memoryStorePath } = resolveRuntimeStorePaths(opts);
  const normalized = normalizeMemoryStore(store);
  writeJsonFile(memoryStorePath, normalized);
  return normalized;
}

export function loadRuntimeIntelStore(opts: RuntimeStoreOptions = {}): RuntimeIntelStore {
  const { intelStorePath } = resolveRuntimeStorePaths(opts);
  return normalizeIntelStore(readJsonFile<RuntimeIntelStore | null>(intelStorePath, null));
}

export function saveRuntimeIntelStore(
  store: RuntimeIntelStore,
  opts: RuntimeStoreOptions = {},
): RuntimeIntelStore {
  const { intelStorePath } = resolveRuntimeStorePaths(opts);
  const normalized = normalizeIntelStore(store);
  writeJsonFile(intelStorePath, normalized);
  return normalized;
}

export function loadRuntimeGovernanceStore(
  opts: RuntimeStoreOptions = {},
): RuntimeGovernanceStore {
  const { governanceStorePath } = resolveRuntimeStorePaths(opts);
  return normalizeGovernanceStore(
    readJsonFile<RuntimeGovernanceStore | null>(governanceStorePath, null),
  );
}

export function saveRuntimeGovernanceStore(
  store: RuntimeGovernanceStore,
  opts: RuntimeStoreOptions = {},
): RuntimeGovernanceStore {
  const { governanceStorePath } = resolveRuntimeStorePaths(opts);
  const normalized = normalizeGovernanceStore(store);
  writeJsonFile(governanceStorePath, normalized);
  return normalized;
}

export function loadRuntimeStoreBundle(opts: RuntimeStoreOptions = {}): RuntimeStoreBundle {
  return {
    taskStore: loadRuntimeTaskStore(opts),
    memoryStore: loadRuntimeMemoryStore(opts),
    intelStore: loadRuntimeIntelStore(opts),
    governanceStore: loadRuntimeGovernanceStore(opts),
  };
}

export function saveRuntimeStoreBundle(
  stores: RuntimeStoreBundle,
  opts: RuntimeStoreOptions = {},
): RuntimeStoreBundle {
  return {
    taskStore: saveRuntimeTaskStore(stores.taskStore, opts),
    memoryStore: saveRuntimeMemoryStore(stores.memoryStore, opts),
    intelStore: saveRuntimeIntelStore(stores.intelStore, opts),
    governanceStore: saveRuntimeGovernanceStore(stores.governanceStore, opts),
  };
}

export function appendRuntimeEvent(
  type: string,
  payload: RuntimeMetadata = {},
  opts: RuntimeStoreOptions = {},
): RuntimeEventRecord {
  const now = resolveNow(opts.now);
  const { eventsPath } = resolveRuntimeStorePaths(opts);
  const event: RuntimeEventRecord = {
    id: `runtime-event-${now}-${Math.random().toString(36).slice(2, 10)}`,
    type: toString(type, "runtime_event"),
    createdAt: now,
    payload,
  };
  ensureDir(path.dirname(eventsPath));
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function readRuntimeEvents(limit = 50, opts: RuntimeStoreOptions = {}): RuntimeEventRecord[] {
  const { eventsPath } = resolveRuntimeStorePaths(opts);
  try {
    const lines = fs
      .readFileSync(eventsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((line) => JSON.parse(line) as RuntimeEventRecord);
  } catch {
    return [];
  }
}

export function buildRuntimeRetrievalSourceSet(
  opts: RuntimeStoreOptions = {},
): RetrievalSourceSet {
  const { memoryStore, intelStore } = loadRuntimeStoreBundle(opts);
  return {
    strategies: memoryStore.strategies,
    memories: memoryStore.memories,
    intel: intelStore.candidates,
    archive: [],
  };
}
