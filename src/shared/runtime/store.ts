import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolvePathResolver } from "../../instance/paths.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import type {
  AgentLocalOverlay,
  AgentRecord,
  FederationInboxRecord,
  FederationSyncCursor,
  RetrievalSourceSet,
  RuntimeEventRecord,
  RuntimeFederationStore,
  RuntimeGovernanceStore,
  RuntimeIntelStore,
  RuntimeMemoryStore,
  RuntimeMetadata,
  RuntimeTaskDefaults,
  RuntimeTaskStore,
  RuntimeUserConsoleStore,
  RuntimeUserModel,
  SurfaceRecord,
  SurfaceRoleOverlay,
  TeamKnowledgeRecord,
} from "./contracts.js";

const RUNTIME_STORE_SEGMENTS = ["runtime", "v2"] as const;
const LEGACY_RUNTIME_STORE_SEGMENTS = ["runtime", "v1"] as const;
const RUNTIME_DB_FILENAME = "runtime.sqlite";
const TASK_STORE_FILENAME = "task-store.json";
const MEMORY_STORE_FILENAME = "memory-store.json";
const INTEL_STORE_FILENAME = "intel-store.json";
const GOVERNANCE_STORE_FILENAME = "governance-store.json";
const EVENTS_FILENAME = "events.jsonl";

const TABLES = {
  tasks: "runtime_tasks",
  runs: "runtime_task_runs",
  steps: "runtime_task_steps",
  reviews: "runtime_task_reviews",
  memories: "runtime_memories",
  strategies: "runtime_strategies",
  metaLearning: "runtime_meta_learning",
  evolutionMemory: "runtime_evolution_memory",
  userModel: "runtime_user_model",
  agents: "runtime_agents",
  agentOverlays: "runtime_agent_overlays",
  surfaces: "runtime_surfaces",
  surfaceRoleOverlays: "runtime_surface_role_overlays",
  intelCandidates: "runtime_news_candidates",
  intelDigestItems: "runtime_news_digest_items",
  intelSourceProfiles: "runtime_news_source_profiles",
  intelTopicProfiles: "runtime_news_topic_profiles",
  intelUsefulnessRecords: "runtime_news_usefulness_records",
  intelPinnedRecords: "runtime_news_pinned_records",
  governanceEntries: "runtime_governance_entries",
  shadowEvaluations: "runtime_shadow_evaluations",
  federationInbox: "runtime_federation_inbox",
  federationSharedStrategies: "runtime_federation_shared_strategies",
  federationTeamKnowledge: "runtime_federation_team_knowledge",
  events: "runtime_events",
} as const;

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
  userConsoleStore?: RuntimeUserConsoleStore;
  federationStore?: RuntimeFederationStore;
};

export type RuntimeStorePaths = {
  root: string;
  dbPath: string;
  legacyRoot: string;
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
      dailyPushEnabled: true,
      dailyPushItemCount: 10,
      dailyPushHourLocal: 9,
      dailyPushMinuteLocal: 0,
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

function buildDefaultUserModel(now = Date.now()): RuntimeUserModel {
  return {
    id: "runtime-user",
    confirmationBoundary: "balanced",
    interruptionThreshold: "medium",
    reportPolicy: "reply",
    reportVerbosity: "balanced",
    createdAt: now,
    updatedAt: now,
  };
}

function buildDefaultUserConsoleStore(now = Date.now()): RuntimeUserConsoleStore {
  return {
    version: "v1",
    userModel: buildDefaultUserModel(now),
    agents: [],
    agentOverlays: [],
    surfaces: [],
    surfaceRoleOverlays: [],
  };
}

function buildDefaultFederationStore(): RuntimeFederationStore {
  return {
    version: "v1",
    inbox: [],
    sharedStrategies: [],
    teamKnowledge: [],
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
    ...toRecord(record.legacyCompatibility),
    ...toRecord(record.taskContext),
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
  if (!raw) {
    return fallback;
  }
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
      artifactRefs: toArray<string>(
        (task as { artifactRefs?: string[]; intelRefs?: string[] }).artifactRefs ??
          (task as { intelRefs?: string[] }).intelRefs,
      ),
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
  if (!raw) {
    return fallback;
  }
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
  if (!raw) {
    return fallback;
  }
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
    exploitItemsPerDigest: toNumber(raw.exploitItemsPerDigest, fallback.exploitItemsPerDigest),
    exploreItemsPerDigest: toNumber(raw.exploreItemsPerDigest, fallback.exploreItemsPerDigest),
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
  if (!raw) {
    return fallback;
  }
  return {
    version: "v1",
    entries: toArray(raw.entries),
    shadowEvaluations: toArray(raw.shadowEvaluations),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeUserConsoleStore(raw: RuntimeUserConsoleStore | null): RuntimeUserConsoleStore {
  const fallback = buildDefaultUserConsoleStore();
  return {
    version: "v1",
    userModel:
      raw?.userModel && typeof raw.userModel.id === "string" && raw.userModel.id.trim().length > 0
        ? {
            ...raw.userModel,
            id: raw.userModel.id,
            createdAt: toNumber(raw.userModel.createdAt, fallback.userModel.createdAt),
            updatedAt: toNumber(raw.userModel.updatedAt, fallback.userModel.updatedAt),
          }
        : fallback.userModel,
    agents: toArray<AgentRecord>(raw?.agents).map((agent) => ({
      ...agent,
      skillIds: toArray<string>(agent.skillIds).filter((value) => typeof value === "string"),
      active: toBoolean(agent.active, true),
      createdAt: toNumber(agent.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(agent.updatedAt, fallback.userModel.updatedAt),
    })),
    agentOverlays: toArray<AgentLocalOverlay>(raw?.agentOverlays).map((overlay) => ({
      ...overlay,
      updatedAt: toNumber(overlay.updatedAt, fallback.userModel.updatedAt),
    })),
    surfaces: toArray<SurfaceRecord>(raw?.surfaces).map((surface) => ({
      ...surface,
      ownerKind: surface.ownerKind === "agent" ? "agent" : "user",
      active: toBoolean(surface.active, true),
      createdAt: toNumber(surface.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(surface.updatedAt, fallback.userModel.updatedAt),
    })),
    surfaceRoleOverlays: toArray<SurfaceRoleOverlay>(raw?.surfaceRoleOverlays).map((overlay) => ({
      ...overlay,
      allowedTopics: toArray<string>(overlay.allowedTopics).filter(
        (value) => typeof value === "string",
      ),
      restrictedTopics: toArray<string>(overlay.restrictedTopics).filter(
        (value) => typeof value === "string",
      ),
      initiative:
        overlay.initiative === "low" ||
        overlay.initiative === "medium" ||
        overlay.initiative === "high"
          ? overlay.initiative
          : undefined,
      createdAt: toNumber(overlay.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(overlay.updatedAt, fallback.userModel.updatedAt),
    })),
    lastImportedAt: Number.isFinite(raw?.lastImportedAt) ? Number(raw?.lastImportedAt) : undefined,
    metadata: raw?.metadata,
  };
}

function normalizeFederationSyncCursor(
  value: FederationSyncCursor | null | undefined,
): FederationSyncCursor | undefined {
  if (!value) {
    return undefined;
  }
  return {
    lastPushedAt: Number.isFinite(value.lastPushedAt) ? Number(value.lastPushedAt) : undefined,
    lastPulledAt: Number.isFinite(value.lastPulledAt) ? Number(value.lastPulledAt) : undefined,
    lastOutboxEventId:
      typeof value.lastOutboxEventId === "string" ? value.lastOutboxEventId : undefined,
    lastInboxEnvelopeId:
      typeof value.lastInboxEnvelopeId === "string" ? value.lastInboxEnvelopeId : undefined,
    updatedAt: toNumber(value.updatedAt, Date.now()),
    metadata: value.metadata,
  };
}

function normalizeFederationStore(raw: RuntimeFederationStore | null): RuntimeFederationStore {
  return {
    version: "v1",
    inbox: toArray<FederationInboxRecord>(raw?.inbox).map((record) => ({
      ...record,
      packageType:
        record.packageType === "coordinator-suggestion" ||
        record.packageType === "shared-strategy-package" ||
        record.packageType === "team-knowledge-package" ||
        record.packageType === "role-optimization-package" ||
        record.packageType === "runtime-policy-overlay-package"
          ? record.packageType
          : "coordinator-suggestion",
      state:
        record.state === "received" ||
        record.state === "validated" ||
        record.state === "shadowed" ||
        record.state === "recommended" ||
        record.state === "adopted" ||
        record.state === "rejected" ||
        record.state === "expired" ||
        record.state === "reverted"
          ? record.state
          : "received",
      summary: typeof record.summary === "string" ? record.summary : "",
      sourceRuntimeId:
        typeof record.sourceRuntimeId === "string" ? record.sourceRuntimeId : "unknown-runtime",
      sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : undefined,
      validationErrors: toArray<string>(record.validationErrors).filter(
        (value) => typeof value === "string",
      ),
      receivedAt: toNumber(record.receivedAt, Date.now()),
      validatedAt: Number.isFinite(record.validatedAt) ? Number(record.validatedAt) : undefined,
      shadowedAt: Number.isFinite(record.shadowedAt) ? Number(record.shadowedAt) : undefined,
      recommendedAt: Number.isFinite(record.recommendedAt)
        ? Number(record.recommendedAt)
        : undefined,
      adoptedAt: Number.isFinite(record.adoptedAt) ? Number(record.adoptedAt) : undefined,
      rejectedAt: Number.isFinite(record.rejectedAt) ? Number(record.rejectedAt) : undefined,
      expiredAt: Number.isFinite(record.expiredAt) ? Number(record.expiredAt) : undefined,
      revertedAt: Number.isFinite(record.revertedAt) ? Number(record.revertedAt) : undefined,
      updatedAt: toNumber(record.updatedAt, Date.now()),
      metadata: record.metadata,
    })),
    sharedStrategies: toArray(raw?.sharedStrategies),
    teamKnowledge: toArray<TeamKnowledgeRecord>(raw?.teamKnowledge).map((record) => ({
      ...record,
      namespace: record.namespace === "private" ? "private" : "team-shareable",
      tags: toArray<string>(record.tags).filter((value) => typeof value === "string"),
      createdAt: toNumber(record.createdAt, Date.now()),
      updatedAt: toNumber(record.updatedAt, Date.now()),
    })),
    syncCursor: normalizeFederationSyncCursor(raw?.syncCursor),
    lastImportedAt: Number.isFinite(raw?.lastImportedAt) ? Number(raw?.lastImportedAt) : undefined,
    metadata: raw?.metadata,
  };
}

function openRuntimeDatabase(paths: RuntimeStorePaths): DatabaseSync {
  ensureDir(paths.root);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(paths.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  ensureRuntimeSchema(db);
  return db;
}

function ensureRuntimeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO runtime_meta(key, value)
    VALUES ('store_version', 'v2')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `);

  for (const table of Object.values(TABLES)) {
    if (table === TABLES.events) {
      continue;
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_updated_at ON ${table}(updated_at DESC);`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLES.events} (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_${TABLES.events}_created_at ON ${TABLES.events}(created_at DESC);`,
  );
}

function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readTableRows<T>(db: DatabaseSync, table: string): T[] {
  const rows = db
    .prepare(`SELECT json FROM ${table} ORDER BY updated_at DESC, id DESC`)
    .all() as Array<{ json: string }>;
  return rows.map((row) => JSON.parse(row.json) as T);
}

function replaceTableRows<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  db: DatabaseSync,
  table: string,
  rows: T[],
): void {
  const deleteStatement = db.prepare(`DELETE FROM ${table}`);
  const insertStatement = db.prepare(`
    INSERT INTO ${table}(id, json, updated_at)
    VALUES (?, ?, ?)
  `);
  withTransaction(db, () => {
    deleteStatement.run();
    for (const row of rows) {
      const updatedAt =
        typeof row.updatedAt === "number"
          ? row.updatedAt
          : typeof row.createdAt === "number"
            ? row.createdAt
            : Date.now();
      insertStatement.run(row.id, JSON.stringify(row), updatedAt);
    }
  });
}

function replaceEventRows(db: DatabaseSync, rows: RuntimeEventRecord[]): void {
  const deleteStatement = db.prepare(`DELETE FROM ${TABLES.events}`);
  const insertStatement = db.prepare(`
    INSERT INTO ${TABLES.events}(id, type, created_at, payload_json)
    VALUES (?, ?, ?, ?)
  `);
  withTransaction(db, () => {
    deleteStatement.run();
    for (const row of rows) {
      insertStatement.run(row.id, row.type, row.createdAt, JSON.stringify(row.payload ?? {}));
    }
  });
}

function readLegacyEvents(filePath: string): RuntimeEventRecord[] {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeEventRecord);
  } catch {
    return [];
  }
}

function hasLegacyRuntimeStore(paths: RuntimeStorePaths): boolean {
  return (
    fs.existsSync(paths.taskStorePath) ||
    fs.existsSync(paths.memoryStorePath) ||
    fs.existsSync(paths.intelStorePath) ||
    fs.existsSync(paths.governanceStorePath) ||
    fs.existsSync(paths.eventsPath)
  );
}

function importLegacyRuntimeStore(paths: RuntimeStorePaths): void {
  const db = openRuntimeDatabase(paths);
  try {
    replaceTableRows(
      db,
      TABLES.tasks,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).tasks,
    );
    replaceTableRows(
      db,
      TABLES.runs,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).runs,
    );
    replaceTableRows(
      db,
      TABLES.steps,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).steps,
    );
    replaceTableRows(
      db,
      TABLES.reviews,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).reviews,
    );

    const memoryStore = normalizeMemoryStore(
      readJsonFile<RuntimeMemoryStore | null>(paths.memoryStorePath, null),
    );
    replaceTableRows(db, TABLES.memories, memoryStore.memories);
    replaceTableRows(db, TABLES.strategies, memoryStore.strategies);
    replaceTableRows(db, TABLES.metaLearning, memoryStore.metaLearning);
    replaceTableRows(db, TABLES.evolutionMemory, memoryStore.evolutionMemory);

    const intelStore = normalizeIntelStore(
      readJsonFile<RuntimeIntelStore | null>(paths.intelStorePath, null),
    );
    replaceTableRows(db, TABLES.intelCandidates, intelStore.candidates);
    replaceTableRows(db, TABLES.intelDigestItems, intelStore.digestItems);
    replaceTableRows(db, TABLES.intelSourceProfiles, intelStore.sourceProfiles);
    replaceTableRows(db, TABLES.intelTopicProfiles, intelStore.topicProfiles);
    replaceTableRows(db, TABLES.intelUsefulnessRecords, intelStore.usefulnessRecords);
    replaceTableRows(db, TABLES.intelPinnedRecords, intelStore.pinnedRecords);

    const governanceStore = normalizeGovernanceStore(
      readJsonFile<RuntimeGovernanceStore | null>(paths.governanceStorePath, null),
    );
    replaceTableRows(db, TABLES.governanceEntries, governanceStore.entries);
    replaceTableRows(db, TABLES.shadowEvaluations, governanceStore.shadowEvaluations);
    const userConsoleStore = buildDefaultUserConsoleStore();
    replaceTableRows(db, TABLES.userModel, [userConsoleStore.userModel]);
    replaceTableRows(db, TABLES.agents, userConsoleStore.agents);
    replaceTableRows(db, TABLES.agentOverlays, userConsoleStore.agentOverlays);
    replaceTableRows(db, TABLES.surfaces, userConsoleStore.surfaces);
    replaceTableRows(db, TABLES.surfaceRoleOverlays, userConsoleStore.surfaceRoleOverlays);
    const federationStore = buildDefaultFederationStore();
    replaceTableRows(db, TABLES.federationInbox, federationStore.inbox);
    replaceTableRows(db, TABLES.federationSharedStrategies, federationStore.sharedStrategies);
    replaceTableRows(db, TABLES.federationTeamKnowledge, federationStore.teamKnowledge);
    replaceEventRows(db, readLegacyEvents(paths.eventsPath));
  } finally {
    db.close();
  }
}

function ensureRuntimeStoreAvailable(opts: RuntimeStoreOptions = {}): RuntimeStorePaths {
  const paths = resolveRuntimeStorePaths(opts);
  if (!fs.existsSync(paths.dbPath) && hasLegacyRuntimeStore(paths)) {
    importLegacyRuntimeStore(paths);
  }
  return paths;
}

function loadTaskDefaultsFromMeta(db: DatabaseSync): RuntimeTaskDefaults | null {
  const row = db.prepare(`SELECT value FROM runtime_meta WHERE key = ?`).get("task_defaults") as
    | { value?: string }
    | undefined;
  if (!row?.value) {
    return null;
  }
  try {
    return JSON.parse(row.value) as RuntimeTaskDefaults;
  } catch {
    return null;
  }
}

function saveTaskDefaultsToMeta(db: DatabaseSync, defaults: RuntimeTaskDefaults): void {
  db.prepare(`
    INSERT INTO runtime_meta(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run("task_defaults", JSON.stringify(defaults));
}

function readJsonMeta<T>(db: DatabaseSync, key: string): T | undefined {
  const row = db.prepare(`SELECT value FROM runtime_meta WHERE key = ?`).get(key) as
    | { value?: string }
    | undefined;
  if (!row?.value) {
    return undefined;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

function writeJsonMeta(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO runtime_meta(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

function readTaskStoreFromDb(db: DatabaseSync): RuntimeTaskStore {
  const fallback = buildDefaultTaskStore();
  return normalizeTaskStore({
    version: "v1",
    defaults: loadTaskDefaultsFromMeta(db) ?? fallback.defaults,
    tasks: readTableRows(db, TABLES.tasks),
    runs: readTableRows(db, TABLES.runs),
    steps: readTableRows(db, TABLES.steps),
    reviews: readTableRows(db, TABLES.reviews),
    metadata: readJsonMeta(db, "task_store_metadata"),
  });
}

function writeTaskStoreToDb(db: DatabaseSync, store: RuntimeTaskStore): RuntimeTaskStore {
  const normalized = normalizeTaskStore(store);
  saveTaskDefaultsToMeta(db, normalized.defaults);
  writeJsonMeta(db, "task_store_metadata", normalized.metadata ?? {});
  replaceTableRows(db, TABLES.tasks, normalized.tasks);
  replaceTableRows(db, TABLES.runs, normalized.runs);
  replaceTableRows(db, TABLES.steps, normalized.steps);
  replaceTableRows(db, TABLES.reviews, normalized.reviews);
  return normalized;
}

function readMemoryStoreFromDb(db: DatabaseSync): RuntimeMemoryStore {
  return normalizeMemoryStore({
    version: "v1",
    memories: readTableRows(db, TABLES.memories),
    strategies: readTableRows(db, TABLES.strategies),
    metaLearning: readTableRows(db, TABLES.metaLearning),
    evolutionMemory: readTableRows(db, TABLES.evolutionMemory),
    metadata: readJsonMeta(db, "memory_store_metadata"),
  });
}

function writeMemoryStoreToDb(db: DatabaseSync, store: RuntimeMemoryStore): RuntimeMemoryStore {
  const normalized = normalizeMemoryStore(store);
  writeJsonMeta(db, "memory_store_metadata", normalized.metadata ?? {});
  replaceTableRows(db, TABLES.memories, normalized.memories);
  replaceTableRows(db, TABLES.strategies, normalized.strategies);
  replaceTableRows(db, TABLES.metaLearning, normalized.metaLearning);
  replaceTableRows(db, TABLES.evolutionMemory, normalized.evolutionMemory);
  return normalized;
}

function readIntelStoreFromDb(db: DatabaseSync): RuntimeIntelStore {
  const meta = db
    .prepare(`SELECT value FROM runtime_meta WHERE key = ?`)
    .get("news_store_settings") as { value?: string } | undefined;
  const defaults = buildDefaultIntelStore();
  const stored = meta?.value ? (JSON.parse(meta.value) as Partial<RuntimeIntelStore>) : {};
  return normalizeIntelStore({
    version: "v1",
    enabled: stored.enabled ?? defaults.enabled,
    digestEnabled: stored.digestEnabled ?? defaults.digestEnabled,
    candidateLimitPerDomain: stored.candidateLimitPerDomain ?? defaults.candidateLimitPerDomain,
    digestItemLimitPerDomain: stored.digestItemLimitPerDomain ?? defaults.digestItemLimitPerDomain,
    exploitItemsPerDigest: stored.exploitItemsPerDigest ?? defaults.exploitItemsPerDigest,
    exploreItemsPerDigest: stored.exploreItemsPerDigest ?? defaults.exploreItemsPerDigest,
    candidates: readTableRows(db, TABLES.intelCandidates),
    digestItems: readTableRows(db, TABLES.intelDigestItems),
    sourceProfiles: readTableRows(db, TABLES.intelSourceProfiles),
    topicProfiles: readTableRows(db, TABLES.intelTopicProfiles),
    usefulnessRecords: readTableRows(db, TABLES.intelUsefulnessRecords),
    pinnedRecords: readTableRows(db, TABLES.intelPinnedRecords),
    metadata: stored.metadata ?? defaults.metadata,
  });
}

function writeIntelStoreToDb(db: DatabaseSync, store: RuntimeIntelStore): RuntimeIntelStore {
  const normalized = normalizeIntelStore(store);
  db.prepare(`
    INSERT INTO runtime_meta(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(
    "news_store_settings",
    JSON.stringify({
      enabled: normalized.enabled,
      digestEnabled: normalized.digestEnabled,
      candidateLimitPerDomain: normalized.candidateLimitPerDomain,
      digestItemLimitPerDomain: normalized.digestItemLimitPerDomain,
      exploitItemsPerDigest: normalized.exploitItemsPerDigest,
      exploreItemsPerDigest: normalized.exploreItemsPerDigest,
      metadata: normalized.metadata,
    }),
  );
  replaceTableRows(db, TABLES.intelCandidates, normalized.candidates);
  replaceTableRows(db, TABLES.intelDigestItems, normalized.digestItems);
  replaceTableRows(db, TABLES.intelSourceProfiles, normalized.sourceProfiles);
  replaceTableRows(db, TABLES.intelTopicProfiles, normalized.topicProfiles);
  replaceTableRows(db, TABLES.intelUsefulnessRecords, normalized.usefulnessRecords);
  replaceTableRows(db, TABLES.intelPinnedRecords, normalized.pinnedRecords);
  return normalized;
}

function readGovernanceStoreFromDb(db: DatabaseSync): RuntimeGovernanceStore {
  return normalizeGovernanceStore({
    version: "v1",
    entries: readTableRows(db, TABLES.governanceEntries),
    shadowEvaluations: readTableRows(db, TABLES.shadowEvaluations),
    metadata: readJsonMeta(db, "governance_store_metadata"),
  });
}

function writeGovernanceStoreToDb(
  db: DatabaseSync,
  store: RuntimeGovernanceStore,
): RuntimeGovernanceStore {
  const normalized = normalizeGovernanceStore(store);
  writeJsonMeta(db, "governance_store_metadata", normalized.metadata ?? {});
  replaceTableRows(db, TABLES.governanceEntries, normalized.entries);
  replaceTableRows(db, TABLES.shadowEvaluations, normalized.shadowEvaluations);
  return normalized;
}

function readUserConsoleStoreFromDb(db: DatabaseSync): RuntimeUserConsoleStore {
  return normalizeUserConsoleStore({
    version: "v1",
    userModel: readTableRows<RuntimeUserModel>(db, TABLES.userModel)[0],
    agents: readTableRows(db, TABLES.agents),
    agentOverlays: readTableRows(db, TABLES.agentOverlays),
    surfaces: readTableRows(db, TABLES.surfaces),
    surfaceRoleOverlays: readTableRows(db, TABLES.surfaceRoleOverlays),
    metadata: readJsonMeta(db, "user_console_store_metadata"),
  });
}

function writeUserConsoleStoreToDb(
  db: DatabaseSync,
  store: RuntimeUserConsoleStore,
): RuntimeUserConsoleStore {
  const normalized = normalizeUserConsoleStore(store);
  writeJsonMeta(db, "user_console_store_metadata", normalized.metadata ?? {});
  replaceTableRows(db, TABLES.userModel, [normalized.userModel]);
  replaceTableRows(db, TABLES.agents, normalized.agents);
  replaceTableRows(db, TABLES.agentOverlays, normalized.agentOverlays);
  replaceTableRows(db, TABLES.surfaces, normalized.surfaces);
  replaceTableRows(db, TABLES.surfaceRoleOverlays, normalized.surfaceRoleOverlays);
  return normalized;
}

function readFederationStoreFromDb(db: DatabaseSync): RuntimeFederationStore {
  return normalizeFederationStore({
    version: "v1",
    inbox: readTableRows(db, TABLES.federationInbox),
    sharedStrategies: readTableRows(db, TABLES.federationSharedStrategies),
    teamKnowledge: readTableRows(db, TABLES.federationTeamKnowledge),
    syncCursor: readJsonMeta(db, "federation_sync_cursor"),
    metadata: readJsonMeta(db, "federation_store_metadata"),
  });
}

function writeFederationStoreToDb(
  db: DatabaseSync,
  store: RuntimeFederationStore,
): RuntimeFederationStore {
  const normalized = normalizeFederationStore(store);
  writeJsonMeta(db, "federation_store_metadata", normalized.metadata ?? {});
  writeJsonMeta(db, "federation_sync_cursor", normalized.syncCursor ?? null);
  replaceTableRows(db, TABLES.federationInbox, normalized.inbox);
  replaceTableRows(db, TABLES.federationSharedStrategies, normalized.sharedStrategies);
  replaceTableRows(db, TABLES.federationTeamKnowledge, normalized.teamKnowledge);
  return normalized;
}

export function resolveRuntimeStorePaths(opts: RuntimeStoreOptions = {}): RuntimeStorePaths {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const root = resolver.resolveDataPath(...RUNTIME_STORE_SEGMENTS);
  const legacyRoot = resolver.resolveDataPath(...LEGACY_RUNTIME_STORE_SEGMENTS);
  return {
    root,
    dbPath: path.join(root, RUNTIME_DB_FILENAME),
    legacyRoot,
    taskStorePath: path.join(legacyRoot, TASK_STORE_FILENAME),
    memoryStorePath: path.join(legacyRoot, MEMORY_STORE_FILENAME),
    intelStorePath: path.join(legacyRoot, INTEL_STORE_FILENAME),
    governanceStorePath: path.join(legacyRoot, GOVERNANCE_STORE_FILENAME),
    eventsPath: path.join(legacyRoot, EVENTS_FILENAME),
  };
}

export function hasAuthoritativeRuntimeStore(opts: RuntimeStoreOptions = {}): boolean {
  const paths = resolveRuntimeStorePaths(opts);
  return fs.existsSync(paths.dbPath) || hasLegacyRuntimeStore(paths);
}

export function loadRuntimeTaskStore(opts: RuntimeStoreOptions = {}): RuntimeTaskStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readTaskStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeTaskStore(
  store: RuntimeTaskStore,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeTaskStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function loadRuntimeMemoryStore(opts: RuntimeStoreOptions = {}): RuntimeMemoryStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readMemoryStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeMemoryStore(
  store: RuntimeMemoryStore,
  opts: RuntimeStoreOptions = {},
): RuntimeMemoryStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeMemoryStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function loadRuntimeIntelStore(opts: RuntimeStoreOptions = {}): RuntimeIntelStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readIntelStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeIntelStore(
  store: RuntimeIntelStore,
  opts: RuntimeStoreOptions = {},
): RuntimeIntelStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeIntelStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function loadRuntimeGovernanceStore(opts: RuntimeStoreOptions = {}): RuntimeGovernanceStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readGovernanceStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeGovernanceStore(
  store: RuntimeGovernanceStore,
  opts: RuntimeStoreOptions = {},
): RuntimeGovernanceStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeGovernanceStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function loadRuntimeStoreBundle(opts: RuntimeStoreOptions = {}): RuntimeStoreBundle {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return {
      taskStore: readTaskStoreFromDb(db),
      memoryStore: readMemoryStoreFromDb(db),
      intelStore: readIntelStoreFromDb(db),
      governanceStore: readGovernanceStoreFromDb(db),
      userConsoleStore: readUserConsoleStoreFromDb(db),
      federationStore: readFederationStoreFromDb(db),
    };
  } finally {
    db.close();
  }
}

export function saveRuntimeStoreBundle(
  stores: RuntimeStoreBundle,
  opts: RuntimeStoreOptions = {},
): RuntimeStoreBundle {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return {
      taskStore: writeTaskStoreToDb(db, stores.taskStore),
      memoryStore: writeMemoryStoreToDb(db, stores.memoryStore),
      intelStore: writeIntelStoreToDb(db, stores.intelStore),
      governanceStore: writeGovernanceStoreToDb(db, stores.governanceStore),
      userConsoleStore: writeUserConsoleStoreToDb(
        db,
        stores.userConsoleStore ?? buildDefaultUserConsoleStore(),
      ),
      federationStore: writeFederationStoreToDb(
        db,
        stores.federationStore ?? buildDefaultFederationStore(),
      ),
    };
  } finally {
    db.close();
  }
}

export function loadRuntimeUserConsoleStore(
  opts: RuntimeStoreOptions = {},
): RuntimeUserConsoleStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readUserConsoleStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeUserConsoleStore(
  store: RuntimeUserConsoleStore,
  opts: RuntimeStoreOptions = {},
): RuntimeUserConsoleStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeUserConsoleStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function loadRuntimeFederationStore(opts: RuntimeStoreOptions = {}): RuntimeFederationStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return readFederationStoreFromDb(db);
  } finally {
    db.close();
  }
}

export function saveRuntimeFederationStore(
  store: RuntimeFederationStore,
  opts: RuntimeStoreOptions = {},
): RuntimeFederationStore {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    return writeFederationStoreToDb(db, store);
  } finally {
    db.close();
  }
}

export function appendRuntimeEvent(
  type: string,
  payload: RuntimeMetadata = {},
  opts: RuntimeStoreOptions = {},
): RuntimeEventRecord {
  const now = resolveNow(opts.now);
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  const event: RuntimeEventRecord = {
    id: `runtime-event-${now}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    createdAt: now,
    payload,
  };
  try {
    db.prepare(`
      INSERT INTO ${TABLES.events}(id, type, created_at, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(event.id, event.type, event.createdAt, JSON.stringify(event.payload ?? {}));
    return event;
  } finally {
    db.close();
  }
}

export function readRuntimeEvents(
  limit = 50,
  opts: RuntimeStoreOptions = {},
): RuntimeEventRecord[] {
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    const rows = db
      .prepare(`
        SELECT id, type, created_at, payload_json
        FROM ${TABLES.events}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(Math.max(1, Math.trunc(limit))) as Array<{
      id: string;
      type: string;
      created_at: number;
      payload_json: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.created_at,
      payload: row.payload_json ? (JSON.parse(row.payload_json) as RuntimeMetadata) : {},
    }));
  } finally {
    db.close();
  }
}

export function buildRuntimeRetrievalSourceSet(opts: RuntimeStoreOptions = {}): RetrievalSourceSet {
  const { memoryStore, userConsoleStore, federationStore } = loadRuntimeStoreBundle(opts);
  const surfaceOverlayById = new Map(
    userConsoleStore?.surfaceRoleOverlays.map((overlay) => [overlay.surfaceId, overlay]) ?? [],
  );
  const sessionCandidates = [
    {
      id: `session-user-${userConsoleStore?.userModel.id ?? "runtime-user"}`,
      plane: "session" as const,
      recordId: userConsoleStore?.userModel.id ?? "runtime-user",
      title: "User control context",
      excerpt: [
        userConsoleStore?.userModel.displayName,
        userConsoleStore?.userModel.communicationStyle,
        userConsoleStore?.userModel.reportPolicy,
      ]
        .filter(Boolean)
        .join(" · "),
      score: 1,
      confidence: 1,
      sourceRef: "runtime-user-model",
    },
    ...(userConsoleStore?.agents ?? []).map((agent) => ({
      id: `session-agent-${agent.id}`,
      plane: "session" as const,
      recordId: agent.id,
      title: `Agent ${agent.name}`,
      excerpt: [
        agent.roleBase,
        `${agent.skillIds.length} skills`,
        agent.active ? "active" : "paused",
      ]
        .filter(Boolean)
        .join(" · "),
      score: agent.active ? 0.85 : 0.45,
      confidence: agent.active ? 0.9 : 0.5,
      sourceRef: "runtime-agent",
    })),
    ...(userConsoleStore?.surfaces ?? []).map((surface) => {
      const overlay = surfaceOverlayById.get(surface.id);
      return {
        id: `session-surface-${surface.id}`,
        plane: "session" as const,
        recordId: surface.id,
        title: surface.label,
        excerpt: [surface.channel, surface.ownerKind, overlay?.role, overlay?.businessGoal]
          .filter(Boolean)
          .join(" · "),
        score: surface.active ? 0.8 : 0.35,
        confidence: surface.active ? 0.85 : 0.45,
        sourceRef: "runtime-surface",
      };
    }),
  ];
  return {
    strategies: [...memoryStore.strategies, ...(federationStore?.sharedStrategies ?? [])],
    memories: memoryStore.memories,
    sessions: sessionCandidates,
    archive: (federationStore?.teamKnowledge ?? []).map((record) => ({
      id: `team-knowledge-${record.id}`,
      plane: "archive" as const,
      recordId: record.id,
      title: record.title,
      excerpt: record.summary,
      score: 0.7,
      confidence: 0.8,
      sourceRef: "team-knowledge",
      metadata: {
        namespace: record.namespace,
        sourceRuntimeId: record.sourceRuntimeId,
        tags: record.tags,
      },
    })),
  };
}
