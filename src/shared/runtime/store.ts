import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolvePathResolver } from "../../instance/paths.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import type {
  AgentLocalOverlay,
  AgentRecord,
  CoordinatorSuggestionRecord,
  FederationInboxRecord,
  FederationSyncCursor,
  RoleOptimizationCandidate,
  RetrievalCandidate,
  RetrievalSourceSet,
  ArchivedTaskStep,
  RuntimeEventRecord,
  RuntimeFederationStore,
  RuntimeGovernanceStore,
  RuntimeIntelStore,
  RuntimeMcpGrantRecord,
  RuntimeMemoryStore,
  RuntimeMetadata,
  RuntimeTaskDefaults,
  RuntimeTaskStore,
  RuntimeUserConsoleStore,
  RuntimeUserModel,
  RuntimeSessionWorkingPreference,
  SurfaceRecord,
  SurfaceRoleOverlay,
  TeamKnowledgeRecord,
  UserModelOptimizationCandidate,
} from "./contracts.js";
import { normalizeRuntimeInfoDomain, normalizeRuntimeInfoDomainList } from "./intel-domains.js";
import {
  DEFAULT_RUNTIME_MEMORY_LIFECYCLE_CONTROLS,
  resolveRuntimeMemoryLifecycleControls,
} from "./memory-lifecycle.js";
import {
  hasExplicitSurfaceLocalBusinessPolicy,
  normalizeSurfaceReportTarget,
  sanitizeSurfaceLocalBusinessPolicy,
} from "./surface-policy.js";

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
  archivedSteps: "runtime_task_archived_steps",
  reviews: "runtime_task_reviews",
  reports: "runtime_task_reports",
  memories: "runtime_memories",
  strategies: "runtime_strategies",
  metaLearning: "runtime_meta_learning",
  evolutionMemory: "runtime_evolution_memory",
  userModel: "runtime_user_model",
  sessionWorkingPreferences: "runtime_session_working_preferences",
  agents: "runtime_agents",
  agentOverlays: "runtime_agent_overlays",
  surfaces: "runtime_surfaces",
  surfaceRoleOverlays: "runtime_surface_role_overlays",
  roleOptimizationCandidates: "runtime_role_optimization_candidates",
  userModelOptimizationCandidates: "runtime_user_model_optimization_candidates",
  intelCandidates: "runtime_news_candidates",
  intelDigestItems: "runtime_news_digest_items",
  intelSourceProfiles: "runtime_news_source_profiles",
  intelTopicProfiles: "runtime_news_topic_profiles",
  intelUsefulnessRecords: "runtime_news_usefulness_records",
  intelRankRecords: "runtime_news_rank_records",
  intelPinnedRecords: "runtime_news_pinned_records",
  governanceEntries: "runtime_governance_entries",
  governanceMcpGrants: "runtime_governance_mcp_grants",
  shadowEvaluations: "runtime_shadow_evaluations",
  federationInbox: "runtime_federation_inbox",
  federationCoordinatorSuggestions: "runtime_federation_coordinator_suggestions",
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function buildExcerpt(parts: Array<string | undefined | null>): string | undefined {
  const excerpt = uniqueStrings(parts).join(" · ");
  return excerpt || undefined;
}

function readUserModelMirrorMetadata(metadata: RuntimeMetadata | undefined): {
  lastSyncedAt?: number;
  lastSyncedMtimeMs?: number;
  lastImportedAt?: number;
  lastImportedMtimeMs?: number;
} {
  const record = metadata?.userModelMirror;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }
  const lastSyncedAt = Number((record as Record<string, unknown>).lastSyncedAt);
  const lastSyncedMtimeMs = Number((record as Record<string, unknown>).lastSyncedMtimeMs);
  const lastImportedAt = Number((record as Record<string, unknown>).lastImportedAt);
  const lastImportedMtimeMs = Number((record as Record<string, unknown>).lastImportedMtimeMs);
  return {
    lastSyncedAt:
      Number.isFinite(lastSyncedAt) && lastSyncedAt > 0 ? Math.trunc(lastSyncedAt) : undefined,
    lastSyncedMtimeMs:
      Number.isFinite(lastSyncedMtimeMs) && lastSyncedMtimeMs > 0
        ? Math.trunc(lastSyncedMtimeMs)
        : undefined,
    lastImportedAt:
      Number.isFinite(lastImportedAt) && lastImportedAt > 0
        ? Math.trunc(lastImportedAt)
        : undefined,
    lastImportedMtimeMs:
      Number.isFinite(lastImportedMtimeMs) && lastImportedMtimeMs > 0
        ? Math.trunc(lastImportedMtimeMs)
        : undefined,
  };
}

function resolveUserModelMirrorSignal(
  userConsoleStore: RuntimeUserConsoleStore | undefined,
  opts: RuntimeStoreOptions,
): {
  path: string;
  exists: boolean;
  lastModifiedAt?: number;
  pendingImport: boolean;
} {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const mirrorPath = resolver.resolveConfigPath("USER.md");
  let lastModifiedAt: number | undefined;
  try {
    const stat = fs.statSync(mirrorPath);
    lastModifiedAt = Number.isFinite(stat.mtimeMs) ? Math.trunc(stat.mtimeMs) : undefined;
  } catch {
    lastModifiedAt = undefined;
  }
  const exists = typeof lastModifiedAt === "number";
  const metadata = readUserModelMirrorMetadata(userConsoleStore?.metadata);
  const baselineMtime = Math.max(
    metadata.lastSyncedMtimeMs ?? 0,
    metadata.lastImportedMtimeMs ?? 0,
  );
  return {
    path: mirrorPath,
    exists,
    lastModifiedAt,
    pendingImport: exists && (lastModifiedAt ?? 0) > baselineMtime,
  };
}

function toSessionSignalScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.max(0, value);
  }
  return Math.max(0, Math.min(1, value / 100));
}

function toSessionSignalConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.max(0, value);
  }
  return Math.max(0, Math.min(100, value));
}

function readTaskContextSignalMetadata(task?: RuntimeTaskStore["tasks"][number]): {
  agentId?: string;
  sessionId?: string;
} {
  const metadata = toRecord(task?.metadata);
  const taskContext = toRecord(metadata?.taskContext);
  const agentId = normalizeText(taskContext?.agentId);
  const sessionId = normalizeText(taskContext?.sessionId);
  return {
    agentId: agentId || undefined,
    sessionId: sessionId || undefined,
  };
}

function readTaskSurfaceSignalMetadata(task?: RuntimeTaskStore["tasks"][number]): {
  surfaceId?: string;
  ownerKind?: "user" | "agent";
  ownerId?: string;
} {
  const metadata = toRecord(task?.metadata);
  const surface = toRecord(metadata?.surface);
  const surfaceId = normalizeText(surface?.surfaceId);
  const ownerKind = normalizeText(surface?.ownerKind);
  const ownerId = normalizeText(surface?.ownerId);
  return {
    surfaceId: surfaceId || undefined,
    ownerKind: ownerKind === "user" || ownerKind === "agent" ? ownerKind : undefined,
    ownerId: ownerId || undefined,
  };
}

function buildTaskReportSessionCandidate(params: {
  report: RuntimeTaskStore["reports"][number];
  task?: RuntimeTaskStore["tasks"][number];
}): RetrievalCandidate {
  const { report, task } = params;
  const route = normalizeText(task?.route);
  const taskContext = readTaskContextSignalMetadata(task);
  const taskSurface = readTaskSurfaceSignalMetadata(task);
  const score =
    report.state === "pending"
      ? report.kind === "waiting_user"
        ? 0.99
        : report.kind === "blocked"
          ? 0.94
          : report.kind === "waiting_external"
            ? 0.88
            : report.kind === "completion"
              ? 0.74
              : 0.68
      : report.kind === "waiting_user"
        ? 0.9
        : report.kind === "blocked"
          ? 0.84
          : report.kind === "waiting_external"
            ? 0.8
            : report.kind === "completion"
              ? 0.64
              : 0.58;

  return {
    id: `session-task-report-${report.id}`,
    plane: "session",
    recordId: report.id,
    title: report.title,
    excerpt: buildExcerpt([
      task?.title,
      route ? `route:${route}` : undefined,
      report.summary,
      report.nextAction ? `next:${report.nextAction}` : undefined,
      report.requiresUserAction ? "requires-user-action" : undefined,
      report.state,
    ]),
    score,
    confidence: report.requiresUserAction ? 96 : 82,
    sourceRef: "runtime-task-report",
    metadata: {
      sessionSignalKind: "task-report",
      taskId: report.taskId,
      runId: report.runId,
      route,
      agentId: taskContext.agentId,
      sessionId: taskContext.sessionId,
      surfaceId: taskSurface.surfaceId,
      taskStatus: report.taskStatus,
      reportKind: report.kind,
      reportState: report.state,
      reportPolicy: report.reportPolicy,
      reportVerbosity: report.reportVerbosity,
      interruptionThreshold: report.interruptionThreshold,
      confirmationBoundary: report.confirmationBoundary,
      requiresUserAction: report.requiresUserAction,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    },
  };
}

function buildCoordinatorSuggestionSessionCandidate(params: {
  suggestion: CoordinatorSuggestionRecord;
  task?: RuntimeTaskStore["tasks"][number];
  surface?: SurfaceRecord;
  overlay?: SurfaceRoleOverlay;
}): RetrievalCandidate {
  const { suggestion, task, surface, overlay } = params;
  const localTaskId = normalizeText(suggestion.localTaskId) || normalizeText(task?.id);
  const sourceTaskId = normalizeText(suggestion.taskId);
  const surfaceId =
    normalizeText(
      typeof suggestion.metadata?.surfaceId === "string" ? suggestion.metadata.surfaceId : "",
    ) || normalizeText(surface?.id);
  const taskContext = readTaskContextSignalMetadata(task);
  const route =
    normalizeText(
      typeof suggestion.metadata?.route === "string" ? suggestion.metadata.route : undefined,
    ) || normalizeText(task?.route);
  const localBusinessPolicy = surface
    ? sanitizeSurfaceLocalBusinessPolicy(overlay?.localBusinessPolicy, {
        ownerKind: surface.ownerKind,
        role: normalizeText(overlay?.role),
      })
    : undefined;
  const taskCreationPolicy = localBusinessPolicy?.taskCreation;
  const escalationTarget = localBusinessPolicy?.escalationTarget;
  const materializationBlocked = taskCreationPolicy === "disabled" && !localTaskId;
  const localTaskStatus = normalizeText(suggestion.localTaskStatus);
  const rematerializeReason = normalizeText(suggestion.rematerializeReason);
  const lastMaterializedLocalTaskId = normalizeText(suggestion.lastMaterializedLocalTaskId);
  return {
    id: `session-coordinator-suggestion-${suggestion.id}`,
    plane: "session",
    recordId: suggestion.id,
    title: `Coordinator suggestion: ${suggestion.title}`,
    excerpt: buildExcerpt([
      suggestion.summary,
      task?.title ? `task:${task.title}` : undefined,
      route ? `route:${route}` : undefined,
      surface?.label ? `surface:${surface.label}` : undefined,
      taskCreationPolicy ? `taskCreation:${taskCreationPolicy}` : undefined,
      escalationTarget ? `escalate:${escalationTarget}` : undefined,
      localTaskStatus ? `localTaskStatus:${localTaskStatus}` : undefined,
      lastMaterializedLocalTaskId ? `lastLocalTask:${lastMaterializedLocalTaskId}` : undefined,
      rematerializeReason ? `requeue:${rematerializeReason}` : undefined,
      suggestion.sourceRuntimeId ? `from:${suggestion.sourceRuntimeId}` : undefined,
    ]),
    score: localTaskId
      ? 0.94
      : rematerializeReason
        ? 0.9
        : materializationBlocked
          ? 0.52
          : sourceTaskId
            ? 0.88
            : 0.82,
    confidence: 84,
    sourceRef: "runtime-coordinator-suggestion",
    metadata: {
      sessionSignalKind: "coordinator-suggestion",
      taskId: localTaskId || undefined,
      localTaskId: localTaskId || undefined,
      localTaskStatus: localTaskStatus || undefined,
      sourceTaskId: sourceTaskId || undefined,
      route,
      agentId: taskContext.agentId,
      sessionId: taskContext.sessionId,
      surfaceId: surfaceId || undefined,
      taskCreationPolicy,
      escalationTarget,
      materializationBlocked,
      sourceRuntimeId: suggestion.sourceRuntimeId,
      sourcePackageId: suggestion.sourcePackageId,
      adoptedAt: suggestion.adoptedAt,
      materializedAt: suggestion.materializedAt,
      lifecycleSyncedAt: suggestion.lifecycleSyncedAt,
      lastMaterializedLocalTaskId: lastMaterializedLocalTaskId || undefined,
      lastMaterializedAt: suggestion.lastMaterializedAt,
      rematerializeReason: rematerializeReason || undefined,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
    },
  };
}

function buildUserModelOptimizationSessionCandidate(
  candidate: UserModelOptimizationCandidate,
): RetrievalCandidate {
  return {
    id: `session-user-model-optimization-${candidate.id}`,
    plane: "session",
    recordId: candidate.id,
    title: `User model ${candidate.state}: ${candidate.field}`,
    excerpt: buildExcerpt([
      candidate.summary,
      candidate.reasoning[0],
      `${candidate.observationCount} observations`,
      candidate.observedSessionIds.length > 0
        ? `sessions:${candidate.observedSessionIds.slice(0, 3).join(",")}`
        : undefined,
    ]),
    score: candidate.state === "recommended" ? 0.84 : 0.7,
    confidence: toSessionSignalConfidence(candidate.confidence),
    sourceRef: "runtime-user-model-optimization",
    metadata: {
      sessionSignalKind: "user-model-optimization",
      candidateState: candidate.state,
      field: candidate.field,
      observationCount: candidate.observationCount,
      observedSessionIds: candidate.observedSessionIds,
      reportPolicy: candidate.proposedUserModel.reportPolicy,
      reportVerbosity: candidate.proposedUserModel.reportVerbosity,
      interruptionThreshold: candidate.proposedUserModel.interruptionThreshold,
      confirmationBoundary: candidate.proposedUserModel.confirmationBoundary,
      source: candidate.source,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    },
  };
}

function buildRoleOptimizationSessionCandidate(params: {
  candidate: RoleOptimizationCandidate;
  surface?: SurfaceRecord;
  agent?: AgentRecord;
}): RetrievalCandidate {
  const { candidate, surface, agent } = params;
  const proposedOverlay = candidate.proposedOverlay ?? {};
  const role = normalizeText(proposedOverlay.role);
  return {
    id: `session-role-optimization-${candidate.id}`,
    plane: "session",
    recordId: candidate.id,
    title: `Role ${candidate.state}: ${surface?.label || candidate.surfaceId}`,
    excerpt: buildExcerpt([
      candidate.summary,
      surface?.channel ? `channel:${surface.channel}` : undefined,
      role ? `role:${role}` : undefined,
      normalizeText(proposedOverlay.businessGoal),
      agent?.name ? `agent:${agent.name}` : undefined,
      `${candidate.observationCount} observations`,
    ]),
    score: candidate.state === "recommended" ? 0.84 : 0.7,
    confidence: toSessionSignalConfidence(candidate.confidence),
    sourceRef: "runtime-role-optimization",
    metadata: {
      sessionSignalKind: "role-optimization",
      candidateState: candidate.state,
      surfaceId: candidate.surfaceId,
      agentId: candidate.agentId,
      ownerKind: candidate.ownerKind,
      roleScope: proposedOverlay.localBusinessPolicy?.roleScope,
      source: candidate.source,
      observationCount: candidate.observationCount,
      proposedRole: role,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    },
  };
}

function buildUserModelMirrorSessionCandidate(params: {
  path: string;
  lastModifiedAt?: number;
}): RetrievalCandidate {
  return {
    id: "session-user-model-mirror-pending-import",
    plane: "session",
    recordId: "runtime-user-model-mirror",
    title: "Pending USER.md import",
    excerpt: buildExcerpt([
      "Manual USER.md edits are waiting to be imported into the authoritative Runtime user model.",
      params.path,
      params.lastModifiedAt ? `modified:${params.lastModifiedAt}` : undefined,
    ]),
    score: toSessionSignalScore(0.93),
    confidence: 92,
    sourceRef: "runtime-user-model-mirror",
    metadata: {
      sessionSignalKind: "user-model-mirror",
      requiresUserAction: true,
      mirrorPath: params.path,
      updatedAt: params.lastModifiedAt,
    },
  };
}

function buildDefaultTaskDefaults(): RuntimeTaskDefaults {
  return {
    defaultBudgetMode: "balanced",
    defaultRetrievalMode: "light",
    maxInputTokensPerTurn: 6000,
    maxContextChars: 9000,
    compactionWatermark: 4000,
    maxRemoteCallsPerTask: 6,
    leaseDurationMs: 10 * 60 * 1000,
    maxConcurrentRunsPerWorker: 2,
    maxConcurrentRunsPerRoute: 3,
  };
}

function buildDefaultTaskStore(): RuntimeTaskStore {
  return {
    version: "v1",
    defaults: buildDefaultTaskDefaults(),
    tasks: [],
    runs: [],
    steps: [],
    archivedSteps: [],
    reviews: [],
    reports: [],
  };
}

function buildDefaultMemoryStore(): RuntimeMemoryStore {
  return {
    version: "v1",
    memories: [],
    strategies: [],
    metaLearning: [],
    evolutionMemory: [],
    metadata: {
      ...DEFAULT_RUNTIME_MEMORY_LIFECYCLE_CONTROLS,
    },
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
    rankRecords: [],
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
    mcpGrants: [],
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
    sessionWorkingPreferences: [],
    agents: [],
    agentOverlays: [],
    surfaces: [],
    surfaceRoleOverlays: [],
    roleOptimizationCandidates: [],
    userModelOptimizationCandidates: [],
    metadata: {
      enabled: true,
      reviewIntervalHours: 12,
    },
  };
}

function buildDefaultFederationStore(): RuntimeFederationStore {
  return {
    version: "v1",
    inbox: [],
    coordinatorSuggestions: [],
    sharedStrategies: [],
    teamKnowledge: [],
    metadata: {
      enabled: true,
      reviewIntervalHours: 12,
      expireReceivedAfterHours: 72,
      expireValidatedAfterHours: 96,
      expireShadowedAfterHours: 120,
      expireRecommendedAfterHours: 168,
    },
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
      compactionWatermark:
        toNumber(raw.defaults?.compactionWatermark, fallback.defaults.compactionWatermark) > 0
          ? toNumber(raw.defaults?.compactionWatermark, fallback.defaults.compactionWatermark)
          : fallback.defaults.compactionWatermark,
      maxRemoteCallsPerTask: toNumber(
        raw.defaults?.maxRemoteCallsPerTask,
        fallback.defaults.maxRemoteCallsPerTask,
      ),
      leaseDurationMs: toNumber(raw.defaults?.leaseDurationMs, fallback.defaults.leaseDurationMs),
      maxConcurrentRunsPerWorker: toNumber(
        raw.defaults?.maxConcurrentRunsPerWorker,
        fallback.defaults.maxConcurrentRunsPerWorker,
      ),
      maxConcurrentRunsPerRoute: toNumber(
        raw.defaults?.maxConcurrentRunsPerRoute,
        fallback.defaults.maxConcurrentRunsPerRoute,
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
    archivedSteps: toArray<ArchivedTaskStep>(raw.archivedSteps),
    reviews: toArray(raw.reviews),
    reports: toArray<RuntimeTaskStore["reports"][number]>(raw.reports).map((report) => ({
      ...report,
      taskStatus:
        report.taskStatus === "queued" ||
        report.taskStatus === "planning" ||
        report.taskStatus === "ready" ||
        report.taskStatus === "running" ||
        report.taskStatus === "waiting_external" ||
        report.taskStatus === "waiting_user" ||
        report.taskStatus === "blocked" ||
        report.taskStatus === "completed" ||
        report.taskStatus === "cancelled"
          ? report.taskStatus
          : "completed",
      kind:
        report.kind === "waiting_user" ||
        report.kind === "completion" ||
        report.kind === "blocked" ||
        report.kind === "waiting_external" ||
        report.kind === "cancelled"
          ? report.kind
          : report.requiresUserAction
            ? "waiting_user"
            : "completion",
      state:
        report.state === "pending" || report.state === "delivered" || report.state === "resolved"
          ? report.state
          : report.requiresUserAction
            ? "pending"
            : "delivered",
      reportPolicy:
        report.reportPolicy === "silent" ||
        report.reportPolicy === "reply" ||
        report.reportPolicy === "proactive" ||
        report.reportPolicy === "reply_and_proactive"
          ? report.reportPolicy
          : "reply",
      title: typeof report.title === "string" ? report.title : "",
      summary: typeof report.summary === "string" ? report.summary : "",
      nextAction: typeof report.nextAction === "string" ? report.nextAction : undefined,
      requiresUserAction: report.requiresUserAction,
      reportTarget: normalizeSurfaceReportTarget(report.reportTarget) ?? undefined,
      surfaceId: typeof report.surfaceId === "string" ? report.surfaceId : undefined,
      surfaceLabel: typeof report.surfaceLabel === "string" ? report.surfaceLabel : undefined,
      agentId: typeof report.agentId === "string" ? report.agentId : undefined,
      sessionId: typeof report.sessionId === "string" ? report.sessionId : undefined,
      escalationTarget:
        report.escalationTarget === "runtime-user" || report.escalationTarget === "surface-owner"
          ? report.escalationTarget
          : undefined,
      createdAt: toNumber(report.createdAt, Date.now()),
      updatedAt: toNumber(report.updatedAt, toNumber(report.createdAt, Date.now())),
      deliveredAt: Number.isFinite(report.deliveredAt) ? Number(report.deliveredAt) : undefined,
      resolvedAt: Number.isFinite(report.resolvedAt) ? Number(report.resolvedAt) : undefined,
    })),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeMemoryStore(raw: RuntimeMemoryStore | null): RuntimeMemoryStore {
  const fallback = buildDefaultMemoryStore();
  if (!raw) {
    return fallback;
  }
  const metadata = toRecord(raw.metadata);
  const lifecycleControls = resolveRuntimeMemoryLifecycleControls(raw.metadata);
  return {
    version: "v1",
    memories: toArray(raw.memories),
    strategies: toArray(raw.strategies),
    metaLearning: toArray(raw.metaLearning),
    evolutionMemory: toArray(raw.evolutionMemory),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: {
      ...fallback.metadata,
      ...metadata,
      ...lifecycleControls,
    },
  };
}

function normalizeIntelStore(raw: RuntimeIntelStore | null): RuntimeIntelStore {
  const fallback = buildDefaultIntelStore();
  if (!raw) {
    return fallback;
  }
  const metadata = toRecord(raw.metadata);
  const normalizedMetadata: RuntimeMetadata | undefined = metadata
    ? {
        ...metadata,
        enabledDomainIds: normalizeRuntimeInfoDomainList(metadata.enabledDomainIds),
        domains:
          metadata.domains &&
          typeof metadata.domains === "object" &&
          !Array.isArray(metadata.domains)
            ? Object.fromEntries(
                Object.entries(metadata.domains as Record<string, unknown>).map(([key, value]) => [
                  normalizeRuntimeInfoDomain(key),
                  value,
                ]),
              )
            : metadata.domains,
      }
    : undefined;
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
    candidates: toArray<RuntimeIntelStore["candidates"][number]>(raw.candidates).map(
      (candidate) => ({
        ...candidate,
        domain: normalizeRuntimeInfoDomain(candidate.domain),
      }),
    ),
    digestItems: toArray<RuntimeIntelStore["digestItems"][number]>(raw.digestItems).map((item) => ({
      ...item,
      domain: normalizeRuntimeInfoDomain(item.domain),
    })),
    sourceProfiles: toArray<RuntimeIntelStore["sourceProfiles"][number]>(raw.sourceProfiles).map(
      (profile) => ({
        ...profile,
        domain: normalizeRuntimeInfoDomain(profile.domain),
      }),
    ),
    topicProfiles: toArray<RuntimeIntelStore["topicProfiles"][number]>(raw.topicProfiles).map(
      (profile) => ({
        ...profile,
        domain: normalizeRuntimeInfoDomain(profile.domain),
      }),
    ),
    usefulnessRecords: toArray<RuntimeIntelStore["usefulnessRecords"][number]>(
      raw.usefulnessRecords,
    ).map((record) => ({
      ...record,
      domain: normalizeRuntimeInfoDomain(record.domain),
    })),
    rankRecords: toArray<RuntimeIntelStore["rankRecords"][number]>(raw.rankRecords).map(
      (record) => ({
        ...record,
        domain: normalizeRuntimeInfoDomain(record.domain),
        selectionRank: Number.isFinite(record.selectionRank)
          ? Number(record.selectionRank)
          : undefined,
        explorationRank: Number.isFinite(record.explorationRank)
          ? Number(record.explorationRank)
          : undefined,
        selectionScore: toNumber(record.selectionScore, 0),
        explorationScore: toNumber(record.explorationScore, 0),
        selected: record.selected,
        selectedMode:
          record.selectedMode === "exploit" ||
          record.selectedMode === "explore" ||
          record.selectedMode === "none"
            ? record.selectedMode
            : record.selected
              ? "exploit"
              : "none",
        createdAt: toNumber(record.createdAt, Date.now()),
      }),
    ),
    pinnedRecords: toArray(raw.pinnedRecords),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: normalizedMetadata,
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
    mcpGrants: toArray<RuntimeMcpGrantRecord>(raw.mcpGrants).map((grant) => ({
      ...grant,
      agentId: typeof grant.agentId === "string" ? grant.agentId : "",
      mcpServerId: typeof grant.mcpServerId === "string" ? grant.mcpServerId : "",
      state: grant.state === "allowed" ? "allowed" : "denied",
      summary: typeof grant.summary === "string" ? grant.summary : "",
      updatedAt: toNumber(grant.updatedAt, Date.now()),
    })),
    shadowEvaluations: toArray(raw.shadowEvaluations),
    lastImportedAt: Number.isFinite(raw.lastImportedAt) ? Number(raw.lastImportedAt) : undefined,
    metadata: raw.metadata,
  };
}

function normalizeUserConsoleStore(raw: RuntimeUserConsoleStore | null): RuntimeUserConsoleStore {
  const fallback = buildDefaultUserConsoleStore();
  const metadata = toRecord(raw?.metadata);
  const reviewIntervalHours = Number(metadata?.reviewIntervalHours);
  const lastReviewAt = Number(metadata?.lastReviewAt);
  const lastSessionCleanupAt = Number(metadata?.lastSessionCleanupAt);
  const surfaces: SurfaceRecord[] = toArray<SurfaceRecord>(raw?.surfaces).map((surface) => ({
    ...surface,
    ownerKind: surface.ownerKind === "agent" ? "agent" : "user",
    active: toBoolean(surface.active, true),
    createdAt: toNumber(surface.createdAt, fallback.userModel.createdAt),
    updatedAt: toNumber(surface.updatedAt, fallback.userModel.updatedAt),
  }));
  const surfaceOwnerKindById = new Map(
    surfaces.map((surface) => [surface.id, surface.ownerKind] as const),
  );
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
    sessionWorkingPreferences: toArray<RuntimeSessionWorkingPreference>(
      raw?.sessionWorkingPreferences,
    ).map((preference) => ({
      ...preference,
      sessionId: typeof preference.sessionId === "string" ? preference.sessionId : "",
      label: typeof preference.label === "string" ? preference.label : undefined,
      communicationStyle:
        typeof preference.communicationStyle === "string"
          ? preference.communicationStyle
          : undefined,
      interruptionThreshold:
        preference.interruptionThreshold === "low" ||
        preference.interruptionThreshold === "medium" ||
        preference.interruptionThreshold === "high"
          ? preference.interruptionThreshold
          : undefined,
      reportVerbosity:
        preference.reportVerbosity === "brief" ||
        preference.reportVerbosity === "balanced" ||
        preference.reportVerbosity === "detailed"
          ? preference.reportVerbosity
          : undefined,
      confirmationBoundary:
        preference.confirmationBoundary === "strict" ||
        preference.confirmationBoundary === "balanced" ||
        preference.confirmationBoundary === "light"
          ? preference.confirmationBoundary
          : undefined,
      reportPolicy:
        preference.reportPolicy === "silent" ||
        preference.reportPolicy === "reply" ||
        preference.reportPolicy === "proactive" ||
        preference.reportPolicy === "reply_and_proactive"
          ? preference.reportPolicy
          : undefined,
      notes: typeof preference.notes === "string" ? preference.notes : undefined,
      expiresAt: Number.isFinite(preference.expiresAt) ? Number(preference.expiresAt) : undefined,
      createdAt: toNumber(preference.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(preference.updatedAt, fallback.userModel.updatedAt),
    })),
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
    surfaces,
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
      reportTarget: normalizeSurfaceReportTarget(overlay.reportTarget) ?? undefined,
      localBusinessPolicy: hasExplicitSurfaceLocalBusinessPolicy(overlay.localBusinessPolicy)
        ? sanitizeSurfaceLocalBusinessPolicy(overlay.localBusinessPolicy, {
            ownerKind: surfaceOwnerKindById.get(overlay.surfaceId) === "agent" ? "agent" : "user",
            role: typeof overlay.role === "string" ? overlay.role : "",
          })
        : undefined,
      createdAt: toNumber(overlay.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(overlay.updatedAt, fallback.userModel.updatedAt),
    })),
    roleOptimizationCandidates: toArray<RoleOptimizationCandidate>(
      raw?.roleOptimizationCandidates,
    ).map((candidate) => ({
      ...candidate,
      ownerKind: candidate.ownerKind === "agent" ? "agent" : "user",
      reasoning: toArray<string>(candidate.reasoning).filter((value) => typeof value === "string"),
      proposedOverlay:
        candidate.proposedOverlay &&
        typeof candidate.proposedOverlay === "object" &&
        !Array.isArray(candidate.proposedOverlay)
          ? {
              ...candidate.proposedOverlay,
              allowedTopics: toArray<string>(candidate.proposedOverlay.allowedTopics).filter(
                (value) => typeof value === "string",
              ),
              restrictedTopics: toArray<string>(candidate.proposedOverlay.restrictedTopics).filter(
                (value) => typeof value === "string",
              ),
              initiative:
                candidate.proposedOverlay.initiative === "low" ||
                candidate.proposedOverlay.initiative === "medium" ||
                candidate.proposedOverlay.initiative === "high"
                  ? candidate.proposedOverlay.initiative
                  : undefined,
              reportTarget:
                normalizeSurfaceReportTarget(candidate.proposedOverlay.reportTarget) ?? undefined,
              localBusinessPolicy: hasExplicitSurfaceLocalBusinessPolicy(
                candidate.proposedOverlay.localBusinessPolicy,
              )
                ? sanitizeSurfaceLocalBusinessPolicy(
                    candidate.proposedOverlay.localBusinessPolicy,
                    {
                      ownerKind: candidate.ownerKind === "agent" ? "agent" : "user",
                      role:
                        typeof candidate.proposedOverlay.role === "string"
                          ? candidate.proposedOverlay.role
                          : "",
                    },
                  )
                : undefined,
            }
          : {},
      observationCount: toNumber(candidate.observationCount, 1),
      confidence: toNumber(candidate.confidence, 0),
      state:
        candidate.state === "recommended" ||
        candidate.state === "adopted" ||
        candidate.state === "rejected" ||
        candidate.state === "expired" ||
        candidate.state === "reverted"
          ? candidate.state
          : "shadow",
      source: candidate.source === "federation" ? "federation" : "local-review",
      createdAt: toNumber(candidate.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(candidate.updatedAt, fallback.userModel.updatedAt),
      shadowedAt: Number.isFinite(candidate.shadowedAt) ? Number(candidate.shadowedAt) : undefined,
      recommendedAt: Number.isFinite(candidate.recommendedAt)
        ? Number(candidate.recommendedAt)
        : undefined,
      adoptedAt: Number.isFinite(candidate.adoptedAt) ? Number(candidate.adoptedAt) : undefined,
      rejectedAt: Number.isFinite(candidate.rejectedAt) ? Number(candidate.rejectedAt) : undefined,
      expiredAt: Number.isFinite(candidate.expiredAt) ? Number(candidate.expiredAt) : undefined,
      revertedAt: Number.isFinite(candidate.revertedAt) ? Number(candidate.revertedAt) : undefined,
    })),
    userModelOptimizationCandidates: toArray<UserModelOptimizationCandidate>(
      raw?.userModelOptimizationCandidates,
    ).map((candidate) => ({
      ...candidate,
      field:
        candidate.field === "interruptionThreshold" ||
        candidate.field === "reportVerbosity" ||
        candidate.field === "confirmationBoundary" ||
        candidate.field === "reportPolicy"
          ? candidate.field
          : "communicationStyle",
      reasoning: toArray<string>(candidate.reasoning).filter((value) => typeof value === "string"),
      proposedUserModel:
        candidate.proposedUserModel &&
        typeof candidate.proposedUserModel === "object" &&
        !Array.isArray(candidate.proposedUserModel)
          ? {
              communicationStyle:
                typeof candidate.proposedUserModel.communicationStyle === "string"
                  ? candidate.proposedUserModel.communicationStyle
                  : undefined,
              interruptionThreshold:
                candidate.proposedUserModel.interruptionThreshold === "low" ||
                candidate.proposedUserModel.interruptionThreshold === "medium" ||
                candidate.proposedUserModel.interruptionThreshold === "high"
                  ? candidate.proposedUserModel.interruptionThreshold
                  : undefined,
              reportVerbosity:
                candidate.proposedUserModel.reportVerbosity === "brief" ||
                candidate.proposedUserModel.reportVerbosity === "balanced" ||
                candidate.proposedUserModel.reportVerbosity === "detailed"
                  ? candidate.proposedUserModel.reportVerbosity
                  : undefined,
              confirmationBoundary:
                candidate.proposedUserModel.confirmationBoundary === "strict" ||
                candidate.proposedUserModel.confirmationBoundary === "balanced" ||
                candidate.proposedUserModel.confirmationBoundary === "light"
                  ? candidate.proposedUserModel.confirmationBoundary
                  : undefined,
              reportPolicy:
                candidate.proposedUserModel.reportPolicy === "silent" ||
                candidate.proposedUserModel.reportPolicy === "reply" ||
                candidate.proposedUserModel.reportPolicy === "proactive" ||
                candidate.proposedUserModel.reportPolicy === "reply_and_proactive"
                  ? candidate.proposedUserModel.reportPolicy
                  : undefined,
            }
          : {},
      observedSessionIds: toArray<string>(candidate.observedSessionIds).filter(
        (value) => typeof value === "string",
      ),
      observationCount: toNumber(candidate.observationCount, 1),
      confidence: toNumber(candidate.confidence, 0),
      state:
        candidate.state === "recommended" ||
        candidate.state === "adopted" ||
        candidate.state === "rejected" ||
        candidate.state === "expired" ||
        candidate.state === "reverted"
          ? candidate.state
          : "shadow",
      source: candidate.source === "federation" ? "federation" : "local-review",
      createdAt: toNumber(candidate.createdAt, fallback.userModel.createdAt),
      updatedAt: toNumber(candidate.updatedAt, fallback.userModel.updatedAt),
      shadowedAt: Number.isFinite(candidate.shadowedAt) ? Number(candidate.shadowedAt) : undefined,
      recommendedAt: Number.isFinite(candidate.recommendedAt)
        ? Number(candidate.recommendedAt)
        : undefined,
      adoptedAt: Number.isFinite(candidate.adoptedAt) ? Number(candidate.adoptedAt) : undefined,
      rejectedAt: Number.isFinite(candidate.rejectedAt) ? Number(candidate.rejectedAt) : undefined,
      expiredAt: Number.isFinite(candidate.expiredAt) ? Number(candidate.expiredAt) : undefined,
      revertedAt: Number.isFinite(candidate.revertedAt) ? Number(candidate.revertedAt) : undefined,
    })),
    lastImportedAt: Number.isFinite(raw?.lastImportedAt) ? Number(raw?.lastImportedAt) : undefined,
    metadata: {
      ...fallback.metadata,
      ...metadata,
      enabled: metadata?.enabled !== false,
      reviewIntervalHours:
        Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
          ? Math.max(1, Math.min(168, Math.trunc(reviewIntervalHours)))
          : Number(fallback.metadata?.reviewIntervalHours ?? 12),
      lastReviewAt:
        Number.isFinite(lastReviewAt) && lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
      lastSessionCleanupAt:
        Number.isFinite(lastSessionCleanupAt) && lastSessionCleanupAt > 0
          ? Math.trunc(lastSessionCleanupAt)
          : undefined,
    },
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
  const fallback = buildDefaultFederationStore();
  const metadata = toRecord(raw?.metadata);
  const reviewIntervalHours = Number(metadata?.reviewIntervalHours);
  const expireReceivedAfterHours = Number(metadata?.expireReceivedAfterHours);
  const expireValidatedAfterHours = Number(metadata?.expireValidatedAfterHours);
  const expireShadowedAfterHours = Number(metadata?.expireShadowedAfterHours);
  const expireRecommendedAfterHours = Number(metadata?.expireRecommendedAfterHours);
  const lastReviewAt = Number(metadata?.lastReviewAt);
  const lastExpiredAt = Number(metadata?.lastExpiredAt);
  const lastExpiredCount = Number(metadata?.lastExpiredCount);
  return {
    version: "v1",
    inbox: toArray<FederationInboxRecord>(raw?.inbox).map((record) => ({
      ...record,
      packageType:
        record.packageType === "coordinator-suggestion" ||
        record.packageType === "shared-strategy-package" ||
        record.packageType === "team-knowledge-package" ||
        record.packageType === "role-optimization-package" ||
        record.packageType === "runtime-policy-overlay-package" ||
        record.packageType === "invalid-package"
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
      review:
        record.review &&
        (record.review.riskLevel === "low" ||
          record.review.riskLevel === "medium" ||
          record.review.riskLevel === "high")
          ? {
              riskLevel: record.review.riskLevel,
              autoAdoptEligible: record.review.autoAdoptEligible,
              requiresReasonOnAdopt: record.review.requiresReasonOnAdopt,
              routeScope: record.review.routeScope === "route" ? "route" : "global",
              summary: typeof record.review.summary === "string" ? record.review.summary : "",
              signals: toArray<string>(record.review.signals).filter(
                (value) => typeof value === "string" && value.trim().length > 0,
              ),
            }
          : undefined,
      metadata: record.metadata,
    })),
    coordinatorSuggestions: toArray<CoordinatorSuggestionRecord>(raw?.coordinatorSuggestions).map(
      (record) => ({
        id: typeof record.id === "string" ? record.id : `coordinator-suggestion-${Date.now()}`,
        title: typeof record.title === "string" ? record.title : "Untitled suggestion",
        summary: typeof record.summary === "string" ? record.summary : "",
        taskId: typeof record.taskId === "string" ? record.taskId : undefined,
        localTaskId: typeof record.localTaskId === "string" ? record.localTaskId : undefined,
        localTaskStatus:
          record.localTaskStatus === "queued" ||
          record.localTaskStatus === "planning" ||
          record.localTaskStatus === "ready" ||
          record.localTaskStatus === "running" ||
          record.localTaskStatus === "waiting_external" ||
          record.localTaskStatus === "waiting_user" ||
          record.localTaskStatus === "blocked" ||
          record.localTaskStatus === "completed" ||
          record.localTaskStatus === "cancelled" ||
          record.localTaskStatus === "missing"
            ? record.localTaskStatus
            : undefined,
        sourceRuntimeId:
          typeof record.sourceRuntimeId === "string" ? record.sourceRuntimeId : "unknown-runtime",
        sourcePackageId:
          typeof record.sourcePackageId === "string" ? record.sourcePackageId : "unknown-package",
        createdAt: toNumber(record.createdAt, Date.now()),
        updatedAt: toNumber(record.updatedAt, Date.now()),
        adoptedAt: Number.isFinite(record.adoptedAt) ? Number(record.adoptedAt) : undefined,
        materializedAt: Number.isFinite(record.materializedAt)
          ? Number(record.materializedAt)
          : undefined,
        lifecycleSyncedAt: Number.isFinite(record.lifecycleSyncedAt)
          ? Number(record.lifecycleSyncedAt)
          : undefined,
        lastMaterializedLocalTaskId:
          typeof record.lastMaterializedLocalTaskId === "string"
            ? record.lastMaterializedLocalTaskId
            : undefined,
        lastMaterializedAt: Number.isFinite(record.lastMaterializedAt)
          ? Number(record.lastMaterializedAt)
          : undefined,
        rematerializeReason:
          typeof record.rematerializeReason === "string" ? record.rematerializeReason : undefined,
        metadata: record.metadata,
      }),
    ),
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
    metadata: {
      ...fallback.metadata,
      ...metadata,
      enabled: metadata?.enabled !== false,
      reviewIntervalHours:
        Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
          ? Math.max(1, Math.min(168, Math.trunc(reviewIntervalHours)))
          : Number(fallback.metadata?.reviewIntervalHours ?? 12),
      expireReceivedAfterHours:
        Number.isFinite(expireReceivedAfterHours) && expireReceivedAfterHours > 0
          ? Math.max(1, Math.min(24 * 365, Math.trunc(expireReceivedAfterHours)))
          : Number(fallback.metadata?.expireReceivedAfterHours ?? 72),
      expireValidatedAfterHours:
        Number.isFinite(expireValidatedAfterHours) && expireValidatedAfterHours > 0
          ? Math.max(1, Math.min(24 * 365, Math.trunc(expireValidatedAfterHours)))
          : Number(fallback.metadata?.expireValidatedAfterHours ?? 96),
      expireShadowedAfterHours:
        Number.isFinite(expireShadowedAfterHours) && expireShadowedAfterHours > 0
          ? Math.max(1, Math.min(24 * 365, Math.trunc(expireShadowedAfterHours)))
          : Number(fallback.metadata?.expireShadowedAfterHours ?? 120),
      expireRecommendedAfterHours:
        Number.isFinite(expireRecommendedAfterHours) && expireRecommendedAfterHours > 0
          ? Math.max(1, Math.min(24 * 365, Math.trunc(expireRecommendedAfterHours)))
          : Number(fallback.metadata?.expireRecommendedAfterHours ?? 168),
      lastReviewAt:
        Number.isFinite(lastReviewAt) && lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
      lastExpiredAt:
        Number.isFinite(lastExpiredAt) && lastExpiredAt > 0 ? Math.trunc(lastExpiredAt) : undefined,
      lastExpiredCount:
        Number.isFinite(lastExpiredCount) && lastExpiredCount >= 0
          ? Math.trunc(lastExpiredCount)
          : undefined,
    },
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
      TABLES.archivedSteps,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null))
        .archivedSteps,
    );
    replaceTableRows(
      db,
      TABLES.reviews,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).reviews,
    );
    replaceTableRows(
      db,
      TABLES.reports,
      normalizeTaskStore(readJsonFile<RuntimeTaskStore | null>(paths.taskStorePath, null)).reports,
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
    replaceTableRows(db, TABLES.intelRankRecords, intelStore.rankRecords);
    replaceTableRows(db, TABLES.intelPinnedRecords, intelStore.pinnedRecords);

    const governanceStore = normalizeGovernanceStore(
      readJsonFile<RuntimeGovernanceStore | null>(paths.governanceStorePath, null),
    );
    replaceTableRows(db, TABLES.governanceEntries, governanceStore.entries);
    replaceTableRows(db, TABLES.governanceMcpGrants, governanceStore.mcpGrants);
    replaceTableRows(db, TABLES.shadowEvaluations, governanceStore.shadowEvaluations);
    const userConsoleStore = buildDefaultUserConsoleStore();
    replaceTableRows(db, TABLES.userModel, [userConsoleStore.userModel]);
    replaceTableRows(
      db,
      TABLES.sessionWorkingPreferences,
      userConsoleStore.sessionWorkingPreferences,
    );
    replaceTableRows(db, TABLES.agents, userConsoleStore.agents);
    replaceTableRows(db, TABLES.agentOverlays, userConsoleStore.agentOverlays);
    replaceTableRows(db, TABLES.surfaces, userConsoleStore.surfaces);
    replaceTableRows(db, TABLES.surfaceRoleOverlays, userConsoleStore.surfaceRoleOverlays);
    replaceTableRows(
      db,
      TABLES.roleOptimizationCandidates,
      userConsoleStore.roleOptimizationCandidates,
    );
    replaceTableRows(
      db,
      TABLES.userModelOptimizationCandidates,
      userConsoleStore.userModelOptimizationCandidates,
    );
    const federationStore = buildDefaultFederationStore();
    replaceTableRows(db, TABLES.federationInbox, federationStore.inbox);
    replaceTableRows(
      db,
      TABLES.federationCoordinatorSuggestions,
      federationStore.coordinatorSuggestions,
    );
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
    archivedSteps: readTableRows(db, TABLES.archivedSteps),
    reviews: readTableRows(db, TABLES.reviews),
    reports: readTableRows(db, TABLES.reports),
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
  replaceTableRows(db, TABLES.archivedSteps, normalized.archivedSteps);
  replaceTableRows(db, TABLES.reviews, normalized.reviews);
  replaceTableRows(db, TABLES.reports, normalized.reports);
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
    rankRecords: readTableRows(db, TABLES.intelRankRecords),
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
  replaceTableRows(db, TABLES.intelRankRecords, normalized.rankRecords);
  replaceTableRows(db, TABLES.intelPinnedRecords, normalized.pinnedRecords);
  return normalized;
}

function readGovernanceStoreFromDb(db: DatabaseSync): RuntimeGovernanceStore {
  return normalizeGovernanceStore({
    version: "v1",
    entries: readTableRows(db, TABLES.governanceEntries),
    mcpGrants: readTableRows(db, TABLES.governanceMcpGrants),
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
  replaceTableRows(db, TABLES.governanceMcpGrants, normalized.mcpGrants);
  replaceTableRows(db, TABLES.shadowEvaluations, normalized.shadowEvaluations);
  return normalized;
}

function readUserConsoleStoreFromDb(db: DatabaseSync): RuntimeUserConsoleStore {
  return normalizeUserConsoleStore({
    version: "v1",
    userModel: readTableRows<RuntimeUserModel>(db, TABLES.userModel)[0],
    sessionWorkingPreferences: readTableRows(db, TABLES.sessionWorkingPreferences),
    agents: readTableRows(db, TABLES.agents),
    agentOverlays: readTableRows(db, TABLES.agentOverlays),
    surfaces: readTableRows(db, TABLES.surfaces),
    surfaceRoleOverlays: readTableRows(db, TABLES.surfaceRoleOverlays),
    roleOptimizationCandidates: readTableRows(db, TABLES.roleOptimizationCandidates),
    userModelOptimizationCandidates: readTableRows(db, TABLES.userModelOptimizationCandidates),
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
  replaceTableRows(db, TABLES.sessionWorkingPreferences, normalized.sessionWorkingPreferences);
  replaceTableRows(db, TABLES.agents, normalized.agents);
  replaceTableRows(db, TABLES.agentOverlays, normalized.agentOverlays);
  replaceTableRows(db, TABLES.surfaces, normalized.surfaces);
  replaceTableRows(db, TABLES.surfaceRoleOverlays, normalized.surfaceRoleOverlays);
  replaceTableRows(db, TABLES.roleOptimizationCandidates, normalized.roleOptimizationCandidates);
  replaceTableRows(
    db,
    TABLES.userModelOptimizationCandidates,
    normalized.userModelOptimizationCandidates,
  );
  return normalized;
}

function readFederationStoreFromDb(db: DatabaseSync): RuntimeFederationStore {
  return normalizeFederationStore({
    version: "v1",
    inbox: readTableRows(db, TABLES.federationInbox),
    coordinatorSuggestions: readTableRows(db, TABLES.federationCoordinatorSuggestions),
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
  replaceTableRows(db, TABLES.federationCoordinatorSuggestions, normalized.coordinatorSuggestions);
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

export function readRuntimeEventById(
  id: string,
  opts: RuntimeStoreOptions = {},
): RuntimeEventRecord | undefined {
  if (typeof id !== "string" || id.trim().length === 0) {
    return undefined;
  }
  const paths = ensureRuntimeStoreAvailable(opts);
  const db = openRuntimeDatabase(paths);
  try {
    const row = db
      .prepare(`
        SELECT id, type, created_at, payload_json
        FROM ${TABLES.events}
        WHERE id = ?
        LIMIT 1
      `)
      .get(id.trim()) as
      | {
          id: string;
          type: string;
          created_at: number;
          payload_json: string | null;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      type: row.type,
      createdAt: row.created_at,
      payload: row.payload_json ? (JSON.parse(row.payload_json) as RuntimeMetadata) : {},
    };
  } finally {
    db.close();
  }
}

export function buildRuntimeRetrievalSourceSet(opts: RuntimeStoreOptions = {}): RetrievalSourceSet {
  const now = resolveNow(opts.now);
  const { taskStore, memoryStore, userConsoleStore, federationStore } =
    loadRuntimeStoreBundle(opts);
  const mirrorSignal = resolveUserModelMirrorSignal(userConsoleStore, opts);
  const tasksById = new Map(taskStore.tasks.map((task) => [task.id, task]));
  const agentById = new Map(userConsoleStore?.agents.map((agent) => [agent.id, agent]) ?? []);
  const surfaceById = new Map(
    userConsoleStore?.surfaces.map((surface) => [surface.id, surface]) ?? [],
  );
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
      score: toSessionSignalScore(1),
      confidence: 92,
      sourceRef: "runtime-user-model",
      metadata: {
        sessionSignalKind: "user-model",
        communicationStyle: userConsoleStore?.userModel.communicationStyle,
        reportPolicy: userConsoleStore?.userModel.reportPolicy,
        reportVerbosity: userConsoleStore?.userModel.reportVerbosity,
        interruptionThreshold: userConsoleStore?.userModel.interruptionThreshold,
        confirmationBoundary: userConsoleStore?.userModel.confirmationBoundary,
      },
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
      score: toSessionSignalScore(agent.active ? 0.85 : 0.45),
      confidence: agent.active ? 90 : 50,
      sourceRef: "runtime-agent",
      metadata: {
        sessionSignalKind: "agent",
        agentId: agent.id,
        active: agent.active,
        roleBase: agent.roleBase,
        skillIds: agent.skillIds,
      },
    })),
    ...(userConsoleStore?.sessionWorkingPreferences ?? []).map((preference) => ({
      id: `session-working-preference-${preference.id}`,
      plane: "session" as const,
      recordId: preference.sessionId,
      title: preference.label || `Session ${preference.sessionId}`,
      excerpt: [
        preference.sessionId,
        preference.communicationStyle,
        preference.reportPolicy,
        preference.confirmationBoundary,
      ]
        .filter(Boolean)
        .join(" · "),
      score: toSessionSignalScore(
        !preference.expiresAt || preference.expiresAt > now ? 0.92 : 0.25,
      ),
      confidence: !preference.expiresAt || preference.expiresAt > now ? 95 : 30,
      sourceRef: "runtime-session-working-preference",
      metadata: {
        sessionSignalKind: "session-working-preference",
        preferenceId: preference.id,
        sessionId: preference.sessionId,
        expiresAt: preference.expiresAt,
        communicationStyle: preference.communicationStyle,
        reportPolicy: preference.reportPolicy,
        reportVerbosity: preference.reportVerbosity,
        interruptionThreshold: preference.interruptionThreshold,
        confirmationBoundary: preference.confirmationBoundary,
      },
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
        score: toSessionSignalScore(surface.active ? 0.8 : 0.35),
        confidence: surface.active ? 85 : 45,
        sourceRef: "runtime-surface",
        metadata: {
          sessionSignalKind: "surface",
          surfaceId: surface.id,
          channel: surface.channel,
          ownerKind: surface.ownerKind,
          ownerId: surface.ownerId,
          active: surface.active,
          role: overlay?.role,
          businessGoal: overlay?.businessGoal,
        },
      };
    }),
    ...taskStore.reports
      .filter((report) => report.state !== "resolved")
      .map((report) =>
        buildTaskReportSessionCandidate({
          report,
          task: tasksById.get(report.taskId),
        }),
      ),
    ...(federationStore?.coordinatorSuggestions ?? []).map((suggestion) =>
      buildCoordinatorSuggestionSessionCandidate({
        suggestion,
        task:
          (suggestion.localTaskId ? tasksById.get(suggestion.localTaskId) : undefined) ??
          (suggestion.lastMaterializedLocalTaskId
            ? tasksById.get(suggestion.lastMaterializedLocalTaskId)
            : undefined) ??
          (suggestion.taskId ? tasksById.get(suggestion.taskId) : undefined),
        surface: normalizeText(
          typeof suggestion.metadata?.surfaceId === "string" ? suggestion.metadata.surfaceId : "",
        )
          ? surfaceById.get(
              normalizeText(
                typeof suggestion.metadata?.surfaceId === "string"
                  ? suggestion.metadata.surfaceId
                  : "",
              ),
            )
          : undefined,
        overlay: normalizeText(
          typeof suggestion.metadata?.surfaceId === "string" ? suggestion.metadata.surfaceId : "",
        )
          ? surfaceOverlayById.get(
              normalizeText(
                typeof suggestion.metadata?.surfaceId === "string"
                  ? suggestion.metadata.surfaceId
                  : "",
              ),
            )
          : undefined,
      }),
    ),
    ...(userConsoleStore?.userModelOptimizationCandidates ?? [])
      .filter((candidate) => candidate.state === "recommended" || candidate.state === "shadow")
      .map((candidate) => buildUserModelOptimizationSessionCandidate(candidate)),
    ...(userConsoleStore?.roleOptimizationCandidates ?? [])
      .filter((candidate) => candidate.state === "recommended" || candidate.state === "shadow")
      .map((candidate) =>
        buildRoleOptimizationSessionCandidate({
          candidate,
          surface: surfaceById.get(candidate.surfaceId),
          agent: candidate.agentId ? agentById.get(candidate.agentId) : undefined,
        }),
      ),
    ...(mirrorSignal.pendingImport
      ? [
          buildUserModelMirrorSessionCandidate({
            path: mirrorSignal.path,
            lastModifiedAt: mirrorSignal.lastModifiedAt,
          }),
        ]
      : []),
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
