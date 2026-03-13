import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  joinResolvedPath,
  resolveHomeDirFromEnv,
  resolveInstanceManifest,
  resolvePathResolver,
  resolvePathWithHome,
} from "../../instance/paths.js";
import { resolveRuntimeServiceVersion } from "../../version.js";
import { syncRuntimeCapabilityRegistry } from "./capability-plane.js";
import {
  FORMAL_MEMORY_TYPES,
  MEMORY_LAYERS,
  type FormalMemoryType,
  type GovernanceState,
  type InstanceManifest,
  type IntelCandidate,
  type IntelDigestEnvelope,
  type RuntimeGovernanceStore,
  type RuntimeIntelStore,
  type RuntimeMemoryStore,
  type RuntimeManifest,
  type RuntimeMetadata,
  type RuntimeTaskStore,
  type StrategyDigestEnvelope,
  type StrategyRecord,
  type TaskRecord,
  type TaskStatus,
} from "./contracts.js";
import {
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  saveRuntimeStoreBundle,
} from "./store.js";
import { buildTaskRecordSnapshot } from "./task-artifacts.js";
import {
  buildTaskStatusCounts,
  compareTaskQueueOrder,
  isRunnableTaskStatus,
  normalizeTaskStatus,
  type TaskQueueInput,
  type TaskStatusCounts,
} from "./task-loop.js";

const LEGACY_RUNTIME_DIRNAME = ".openclaw";
const LEGACY_MANAGED_STATE_DIRNAME = "openclaw-codex-control";
const IMPORTS_ROOT_SEGMENTS = ["imports", "legacy-runtime"] as const;
const FEDERATION_ROOT_SEGMENTS = ["federation"] as const;
const DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES = [
  "shareable_derived",
  "review_summary",
  "metrics",
  "shadow_telemetry",
  "strategy_digest",
  "intel_digest",
] as const;
const DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES = [
  "raw_chat",
  "secrets",
  "durable_private_memory_dump",
] as const;
const KNOWN_FEDERATION_PUSH_SCOPES = [
  ...DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES,
  ...DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES,
] as const;

type RuntimeStateOptions = {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  now?: number;
  config?: Record<string, unknown> | null;
};

type LegacyAutopilotTask = Record<string, unknown> & {
  id?: string;
  title?: string;
  goal?: string;
  successCriteria?: string;
  route?: string;
  taskKind?: string;
  status?: string;
  priority?: string;
  budgetMode?: string;
  retrievalMode?: string;
  assignee?: string;
  skillHints?: string[];
  memoryRefs?: string[];
  intelRefs?: string[];
  recurring?: boolean;
  maintenance?: boolean;
  planSummary?: string;
  blockedReason?: string;
  nextAction?: string;
  lastError?: string;
  reportPolicy?: string;
  tags?: string[];
  notes?: string;
  source?: string;
  workspace?: string;
  delivery?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  intakeText?: string;
  createdAt?: number;
  updatedAt?: number;
  nextRunAt?: number;
  runState?: {
    lastThinkingLane?: string;
    remoteCallCount?: number;
  };
};

type LegacyAutopilotState = {
  version?: number;
  config?: {
    enabled?: boolean;
    localFirst?: boolean;
    heartbeatEnabled?: boolean;
    defaultBudgetMode?: string;
    defaultRetrievalMode?: string;
    maxInputTokensPerTurn?: number;
    maxContextChars?: number;
    maxRemoteCallsPerTask?: number;
    dailyRemoteTokenBudget?: number;
  };
  tasks?: LegacyAutopilotTask[];
};

type LegacyMemoryEntry = {
  id?: string;
  memoryType?: string;
  scope?: string;
  route?: string;
  summary?: string;
  detail?: string;
  appliesWhen?: string;
  avoidWhen?: string;
  tags?: string[];
  confidence?: number;
  version?: number;
  invalidatedBy?: string[];
  sourceEventIds?: string[];
  sourceTaskIds?: string[];
  sourceIntelIds?: string[];
  derivedFromMemoryIds?: string[];
  lastReinforcedAt?: number;
  decayScore?: number;
  updatedAt?: number;
  createdAt?: number;
};

type LegacyStrategyEntry = {
  id?: string;
  route?: string;
  worker?: string;
  summary?: string;
  fallback?: string;
  triggerConditions?: string;
  recommendedPath?: string;
  fallbackPath?: string;
  thinkingLane?: string;
  skillIds?: string[];
  confidence?: number;
  version?: number;
  invalidatedBy?: string[];
  sourceEventIds?: string[];
  sourceTaskIds?: string[];
  sourceIntelIds?: string[];
  derivedFromMemoryIds?: string[];
  measuredEffect?: Record<string, unknown>;
  updatedAt?: number;
  createdAt?: number;
};

type LegacyMemoryState = {
  version?: number;
  memories?: LegacyMemoryEntry[];
  strategies?: LegacyStrategyEntry[];
  learnings?: Array<Record<string, unknown>>;
};

type LegacyIntelDomain = {
  id?: string;
  label?: string;
  lastFetchedAt?: number;
  lastDigestAt?: number;
};

type LegacyIntelItem = {
  id?: string;
  domain?: IntelCandidate["domain"];
  sourceId?: string;
  title?: string;
  summary?: string;
  url?: string;
  overallScore?: number;
  selectedForDigest?: boolean;
  explorationCandidate?: boolean;
  deliveredAt?: number;
  fetchedAt?: number;
};

type LegacyIntelDigestItem = {
  id?: string;
  title?: string;
  judgement?: string;
  importanceScore?: number;
  sourceId?: string;
};

type LegacyIntelDigest = {
  id?: string;
  domain?: IntelCandidate["domain"];
  digestDate?: string;
  createdAt?: number;
  items?: LegacyIntelDigestItem[];
  status?: string;
};

type LegacyIntelState = {
  version?: number;
  config?: {
    enabled?: boolean;
    digestEnabled?: boolean;
    refreshMinutes?: number;
    candidateLimitPerDomain?: number;
    digestItemLimitPerDomain?: number;
    exploitItemsPerDigest?: number;
    exploreItemsPerDigest?: number;
  };
  domains?: LegacyIntelDomain[];
  items?: LegacyIntelItem[];
  digests?: LegacyIntelDigest[];
};

type LegacyEvolutionCandidate = {
  id?: string;
  targetLayer?: string;
  candidateType?: string;
  candidateRef?: string;
  expectedEffect?: Record<string, unknown>;
  measuredEffect?: Record<string, unknown>;
  shadowMetrics?: Record<string, unknown>;
  adoptionState?: string;
  notes?: string;
  sourceTaskIds?: string[];
  sourceEventIds?: string[];
  sourceIntelIds?: string[];
  derivedFromMemoryIds?: string[];
  invalidatedBy?: string[];
  lastShadowAt?: number;
  updatedAt?: number;
  createdAt?: number;
};

type LegacyEvolutionState = {
  version?: number;
  config?: {
    enabled?: boolean;
    autoApplyLowRisk?: boolean;
    reviewIntervalHours?: number;
  };
  candidates?: LegacyEvolutionCandidate[];
};

type LegacySkillGovernanceEntry = {
  id?: string;
  title?: string;
  origin?: string;
  path?: string;
  routeAffinity?: string;
  sideEffectLevel?: string;
  tokenProfile?: string;
  trustClass?: string;
  adoptionState?: string;
  notes?: string;
  findings?: string[];
  lastAuditedAt?: number;
  updatedAt?: number;
};

type LegacySkillGovernanceState = {
  version?: number;
  scannedAt?: number;
  rules?: {
    enforceDecisionFilter?: boolean;
    allowedDecisionStates?: string[];
  };
  skills?: LegacySkillGovernanceEntry[];
};

export type CapabilityPolicyPreset = "managed_high" | "balanced" | "custom";

export type RuntimeTaskSummary = {
  id: string;
  title: string;
  route: string;
  status: TaskStatus;
  priority: TaskRecord["priority"];
  budgetMode: TaskRecord["budgetMode"];
  retrievalMode: TaskRecord["retrievalMode"];
  recurring: boolean;
  maintenance: boolean;
  tags: string[];
  nextAction?: string;
  blockedReason?: string;
  lastError?: string;
  thinkingLane?: string;
  remoteCallCount?: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
};

export type RuntimeTasksListResult = {
  generatedAt: number;
  total: number;
  statusCounts: TaskStatusCounts;
  runnableCount: number;
  tasks: RuntimeTaskSummary[];
};

export type RuntimeMemorySummary = {
  id: string;
  memoryType: FormalMemoryType;
  route?: string;
  scope?: string;
  summary: string;
  confidence: number;
  invalidated: boolean;
  updatedAt: number;
};

export type RuntimeMemoryListResult = {
  generatedAt: number;
  total: number;
  strategyCount: number;
  learningCount: number;
  memoryTypeCounts: Record<FormalMemoryType, number>;
  memories: RuntimeMemorySummary[];
  strategies: StrategyRecord[];
};

export type RuntimeRetrievalStatus = {
  generatedAt: number;
  planes: Array<"strategy" | "memory" | "intel" | "archive">;
  layers: typeof MEMORY_LAYERS;
  system1DefaultPlanes: Array<"strategy" | "memory">;
  system2DefaultPlanes: Array<"strategy" | "memory" | "intel" | "archive">;
  defaultBudgetMode: string;
  defaultRetrievalMode: string;
  maxInputTokensPerTurn: number;
  maxContextChars: number;
  maxRemoteCallsPerTask: number;
};

export type RuntimeIntelDomainStatus = {
  id: string;
  label: string;
  candidateCount: number;
  selectedCount: number;
  digestCount: number;
  latestDigestAt: number | null;
  latestFetchAt: number | null;
};

export type RuntimeIntelStatus = {
  generatedAt: number;
  enabled: boolean;
  digestEnabled: boolean;
  candidateLimitPerDomain: number;
  digestItemLimitPerDomain: number;
  exploitItemsPerDigest: number;
  exploreItemsPerDigest: number;
  itemCount: number;
  digestCount: number;
  domains: RuntimeIntelDomainStatus[];
};

export type RuntimeCapabilitiesStatus = {
  generatedAt: number;
  preset: CapabilityPolicyPreset;
  browserEnabled: boolean;
  sandboxMode: string;
  workspaceRoot: string | null;
  extensions: string[];
  legacyExtensions: string[];
  agentCount: number;
  skillCount: number;
  mcpCount: number;
  governanceStateCounts: Record<GovernanceState, number>;
};

export type RuntimeEvolutionStatus = {
  generatedAt: number;
  enabled: boolean;
  autoApplyLowRisk: boolean;
  reviewIntervalHours: number;
  candidateCount: number;
  stateCounts: Record<string, number>;
};

export type RuntimeImportMapping = {
  kind: "config" | "state" | "events" | "extensions_manifest";
  source: string;
  targetRelativePath: string;
  optional: boolean;
};

export type RuntimeImportPlan = {
  id: string;
  generatedAt: number;
  legacyRoot: string;
  targetBaseRoot: string;
  targetInstanceRoot: string;
  mappings: RuntimeImportMapping[];
  warnings: string[];
};

export type LegacyRuntimeImportReport = {
  detected: boolean;
  generatedAt: number;
  legacyRoot: string;
  configPath: string | null;
  stateRoot: string | null;
  managedStateRoot: string | null;
  extensionsRoot: string | null;
  availableStateFiles: string[];
  legacyExtensions: string[];
  counts: {
    tasks: number;
    memories: number;
    strategies: number;
    intelItems: number;
    intelDigests: number;
    evolutionCandidates: number;
  };
  warnings: string[];
  plan: RuntimeImportPlan;
};

export type LegacyRuntimeImportApplyResult = {
  importId: string;
  appliedAt: number;
  targetRoot: string;
  copiedFiles: Array<{
    kind: RuntimeImportMapping["kind"];
    target: string;
  }>;
  planPath: string;
  reportPath: string;
  extensionsManifestPath: string | null;
};

export type FederationRuntimeSnapshot = {
  generatedAt: number;
  enabled: boolean;
  remoteConfigured: boolean;
  manifest: RuntimeManifest;
  outboxRoot: string;
  assignmentsRoot: string;
  syncCursorPath: string;
  pendingAssignments: number;
  outboxEnvelopeCounts: {
    runtimeManifest: number;
    strategyDigest: number;
    intelDigest: number;
    shadowTelemetry: number;
    capabilityGovernance: number;
  };
  allowedPushScopes: string[];
  blockedPushScopes: string[];
};

export type RuntimeDashboardSnapshot = {
  generatedAt: number;
  runtimeVersion: string;
  preset: CapabilityPolicyPreset;
  instanceManifest: InstanceManifest;
  runtimeManifest: RuntimeManifest;
  tasks: RuntimeTasksListResult;
  memory: RuntimeMemoryListResult;
  retrieval: RuntimeRetrievalStatus;
  intel: RuntimeIntelStatus;
  capabilities: RuntimeCapabilitiesStatus;
  evolution: RuntimeEvolutionStatus;
  importPreview: LegacyRuntimeImportReport;
  federation: FederationRuntimeSnapshot;
};

type LegacyRuntimeLocation = {
  legacyRoot: string;
  configPath: string;
  stateRoot: string;
  managedStateRoot: string;
  extensionsRoot: string;
};

const RUNTIME_INTEL_DOMAIN_ORDER = ["tech", "ai", "business", "github"] as const;

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = toStringValue(value).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeConfidencePercent(value: unknown, fallback = 0): number {
  const numeric = toNumber(value, fallback);
  if (numeric <= 1) {
    return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeLegacyBudgetMode(value: unknown): TaskRecord["budgetMode"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "strict" || normalized === "balanced" || normalized === "deep") {
    return normalized;
  }
  return "balanced";
}

function normalizeLegacyRetrievalMode(value: unknown): TaskRecord["retrievalMode"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "off" || normalized === "light" || normalized === "deep") {
    return normalized;
  }
  return "light";
}

function normalizeLegacyPriority(value: unknown): TaskRecord["priority"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "high" || normalized === "low" || normalized === "normal") {
    return normalized;
  }
  return "normal";
}

function normalizeLegacyThinkingLane(value: unknown): StrategyRecord["thinkingLane"] {
  return toStringValue(value).trim().toLowerCase() === "system2" ? "system2" : "system1";
}

function normalizeEvolutionCandidateType(
  value: unknown,
): RuntimeMemoryStore["evolutionMemory"][number]["candidateType"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "route_default_lane" ||
    normalized === "route_skill_bundle" ||
    normalized === "retry_policy_review" ||
    normalized === "intel_source_reweight" ||
    normalized === "model_route" ||
    normalized === "skill_bundle" ||
    normalized === "retry_policy" ||
    normalized === "intel_source" ||
    normalized === "strategy_refresh" ||
    normalized === "prompt_context_policy" ||
    normalized === "worker_routing"
  ) {
    return normalized;
  }
  return "strategy_refresh";
}

function normalizeEvolutionTargetLayer(
  value: unknown,
): RuntimeMemoryStore["evolutionMemory"][number]["targetLayer"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "decision" ||
    normalized === "task_loop" ||
    normalized === "intel" ||
    normalized === "retrieval" ||
    normalized === "governance"
  ) {
    return normalized;
  }
  return "decision";
}

function normalizeEvolutionAdoptionState(
  value: unknown,
): RuntimeMemoryStore["evolutionMemory"][number]["adoptionState"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "shadow" || normalized === "candidate" || normalized === "adopted") {
    return normalized;
  }
  return "shadow";
}

function normalizeLegacyGovernanceState(value: unknown): GovernanceState {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "blocked" ||
    normalized === "shadow" ||
    normalized === "candidate" ||
    normalized === "adopted" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return "shadow";
}

function mapShadowEvaluationStateToGovernanceState(value: unknown): GovernanceState | null {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "shadow" || normalized === "observed") return "shadow";
  if (normalized === "promoted") return "candidate";
  if (normalized === "adopted") return "adopted";
  if (normalized === "reverted") return "blocked";
  return null;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function listDirectoryNames(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function countBy<T extends string>(values: Iterable<T>): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function normalizeMemoryType(value: unknown): FormalMemoryType {
  const normalized = toStringValue(value).trim().toLowerCase();
  if ((FORMAL_MEMORY_TYPES as readonly string[]).includes(normalized)) {
    return normalized as FormalMemoryType;
  }
  return "knowledge";
}

function emptyMemoryTypeCounts(): Record<FormalMemoryType, number> {
  return FORMAL_MEMORY_TYPES.reduce(
    (counts, memoryType) => {
      counts[memoryType] = 0;
      return counts;
    },
    {} as Record<FormalMemoryType, number>,
  );
}

function emptyGovernanceStateCounts(): Record<GovernanceState, number> {
  return {
    blocked: 0,
    shadow: 0,
    candidate: 0,
    adopted: 0,
    core: 0,
  };
}

function resolveLegacyRuntimeLocation(opts: RuntimeStateOptions = {}): LegacyRuntimeLocation {
  const env = opts.env ?? process.env;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir ?? os.homedir);
  const legacyRoot = env.OPENCLAW_LEGACY_RUNTIME_ROOT?.trim()
    ? resolvePathWithHome(env.OPENCLAW_LEGACY_RUNTIME_ROOT, { homeDir })
    : joinResolvedPath(homeDir ?? process.cwd(), LEGACY_RUNTIME_DIRNAME);
  return {
    legacyRoot,
    configPath: joinResolvedPath(legacyRoot, "openclaw.json"),
    stateRoot: joinResolvedPath(legacyRoot, "state"),
    managedStateRoot: joinResolvedPath(legacyRoot, "state", LEGACY_MANAGED_STATE_DIRNAME),
    extensionsRoot: joinResolvedPath(legacyRoot, "extensions"),
  };
}

function loadLegacyAutopilotState(location: LegacyRuntimeLocation): LegacyAutopilotState | null {
  return readJsonFile<LegacyAutopilotState>(
    joinResolvedPath(location.managedStateRoot, "autopilot.json"),
  );
}

function loadLegacyMemoryState(location: LegacyRuntimeLocation): LegacyMemoryState | null {
  return readJsonFile<LegacyMemoryState>(
    joinResolvedPath(location.managedStateRoot, "memory.json"),
  );
}

function loadLegacyIntelState(location: LegacyRuntimeLocation): LegacyIntelState | null {
  return readJsonFile<LegacyIntelState>(joinResolvedPath(location.managedStateRoot, "intel.json"));
}

function loadLegacyEvolutionState(location: LegacyRuntimeLocation): LegacyEvolutionState | null {
  return readJsonFile<LegacyEvolutionState>(
    joinResolvedPath(location.managedStateRoot, "evolution.json"),
  );
}

function loadLegacySkillGovernanceState(
  location: LegacyRuntimeLocation,
): LegacySkillGovernanceState | null {
  return readJsonFile<LegacySkillGovernanceState>(
    joinResolvedPath(location.managedStateRoot, "skill-governance.json"),
  );
}

function buildImportedTaskStore(location: LegacyRuntimeLocation, now: number): RuntimeTaskStore {
  const autopilot = loadLegacyAutopilotState(location);
  const tasks = toArray<LegacyAutopilotTask>(autopilot?.tasks).map((task) =>
    buildTaskRecordSnapshot(
      {
        id: toStringValue(task.id) || undefined,
        title: toStringValue(task.title || task.goal, "Untitled task"),
        goal: toStringValue(task.goal) || undefined,
        successCriteria: toStringValue(task.successCriteria) || undefined,
        route: toStringValue(task.route || task.taskKind, "general"),
        status: toStringValue(task.status, "queued"),
        priority: normalizeLegacyPriority(task.priority),
        budgetMode: normalizeLegacyBudgetMode(task.budgetMode),
        retrievalMode: normalizeLegacyRetrievalMode(task.retrievalMode),
        tags: toArray<string>(task.tags).filter((value) => typeof value === "string"),
        worker: toStringValue(task.assignee) || undefined,
        skillIds: toArray<string>(task.skillHints).filter((value) => typeof value === "string"),
        memoryRefs: toArray<string>(task.memoryRefs).filter((value) => typeof value === "string"),
        intelRefs: toArray<string>(task.intelRefs).filter((value) => typeof value === "string"),
        recurring: task.recurring === true,
        maintenance: task.maintenance === true,
        planSummary: toStringValue(task.planSummary) || undefined,
        nextAction: toStringValue(task.nextAction) || undefined,
        blockedReason: toStringValue(task.blockedReason) || undefined,
        lastError: toStringValue(task.lastError) || undefined,
        reportPolicy: toStringValue(task.reportPolicy) || undefined,
        nextRunAt:
          typeof task.nextRunAt === "number" && Number.isFinite(task.nextRunAt)
            ? task.nextRunAt
            : undefined,
        createdAt: toNumber(task.createdAt, now),
        updatedAt: toNumber(task.updatedAt, toNumber(task.createdAt, now)),
        metadata: {
          ...(toRecord(task.runState) == null
            ? {}
            : {
                runtimeTask: {
                  runState: toRecord(task.runState),
                },
                lastThinkingLane:
                  toStringValue(toRecord(task.runState)?.lastThinkingLane) || undefined,
                remoteCallCount: toNumber(toRecord(task.runState)?.remoteCallCount, 0) || undefined,
              }),
          taskContext: {
            notes: toStringValue(task.notes) || undefined,
            source: toStringValue(task.source) || undefined,
            workspace: toStringValue(task.workspace) || undefined,
            delivery: toRecord(task.delivery) ?? undefined,
            sourceMeta: toRecord(task.sourceMeta) ?? undefined,
            intakeText: toStringValue(task.intakeText) || undefined,
          },
        },
      },
      now,
    ),
  );

  return {
    version: "v1",
    defaults: {
      defaultBudgetMode: normalizeLegacyBudgetMode(autopilot?.config?.defaultBudgetMode),
      defaultRetrievalMode: normalizeLegacyRetrievalMode(autopilot?.config?.defaultRetrievalMode),
      maxInputTokensPerTurn: toNumber(autopilot?.config?.maxInputTokensPerTurn, 6000),
      maxContextChars: toNumber(autopilot?.config?.maxContextChars, 9000),
      maxRemoteCallsPerTask: toNumber(autopilot?.config?.maxRemoteCallsPerTask, 6),
    },
    tasks,
    runs: [],
    steps: [],
    reviews: [],
    lastImportedAt: now,
    metadata: {
      autopilot: {
        enabled: autopilot?.config?.enabled !== false,
        localFirst: autopilot?.config?.localFirst !== false,
        heartbeatEnabled: autopilot?.config?.heartbeatEnabled !== false,
        dailyRemoteTokenBudget: toNumber(autopilot?.config?.dailyRemoteTokenBudget, 250000),
      },
    },
  };
}

function buildImportedMemoryStore(
  location: LegacyRuntimeLocation,
  now: number,
): RuntimeMemoryStore {
  const memoryState = loadLegacyMemoryState(location);
  const evolutionState = loadLegacyEvolutionState(location);
  return {
    version: "v1",
    memories: toArray<LegacyMemoryEntry>(memoryState?.memories).map((entry) => ({
      id: toStringValue(entry.id, "memory-unknown"),
      layer: "memories",
      memoryType: normalizeMemoryType(entry.memoryType),
      route: toStringValue(entry.route) || undefined,
      scope: toStringValue(entry.scope) || undefined,
      summary: toStringValue(entry.summary, "No summary"),
      detail: toStringValue(entry.detail) || undefined,
      appliesWhen: toStringValue(entry.appliesWhen) || undefined,
      avoidWhen: toStringValue(entry.avoidWhen) || undefined,
      tags: toArray<string>(entry.tags).filter((value) => typeof value === "string"),
      confidence: normalizeConfidencePercent(entry.confidence, 0),
      version: toNumber(entry.version, 1),
      invalidatedBy: toArray<string>(entry.invalidatedBy).filter(
        (value) => typeof value === "string",
      ),
      sourceEventIds: toArray<string>(entry.sourceEventIds).filter(
        (value) => typeof value === "string",
      ),
      sourceTaskIds: toArray<string>(entry.sourceTaskIds).filter(
        (value) => typeof value === "string",
      ),
      sourceIntelIds: toArray<string>(entry.sourceIntelIds).filter(
        (value) => typeof value === "string",
      ),
      derivedFromMemoryIds: toArray<string>(entry.derivedFromMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      lastReinforcedAt:
        toNumber(entry.lastReinforcedAt, toNumber(entry.updatedAt, now)) || undefined,
      decayScore: toNumber(entry.decayScore, 0),
      createdAt: toNumber(entry.createdAt, now),
      updatedAt: toNumber(entry.updatedAt, toNumber(entry.createdAt, now)),
    })),
    strategies: toArray<LegacyStrategyEntry>(memoryState?.strategies).map((entry) => ({
      id: toStringValue(entry.id, "strategy-unknown"),
      layer: "strategies",
      route: toStringValue(entry.route, "general"),
      worker: toStringValue(entry.worker, "main"),
      skillIds: toArray<string>(entry.skillIds).filter((value) => typeof value === "string"),
      summary: toStringValue(entry.summary, "No strategy summary"),
      fallback: toStringValue(entry.fallback) || undefined,
      triggerConditions: toStringValue(entry.triggerConditions) || undefined,
      recommendedPath: toStringValue(entry.recommendedPath) || undefined,
      fallbackPath: toStringValue(entry.fallbackPath) || undefined,
      thinkingLane: normalizeLegacyThinkingLane(entry.thinkingLane),
      confidence: normalizeConfidencePercent(entry.confidence, 0),
      version: toNumber(entry.version, 1),
      invalidatedBy: toArray<string>(entry.invalidatedBy).filter(
        (value) => typeof value === "string",
      ),
      sourceEventIds: toArray<string>(entry.sourceEventIds).filter(
        (value) => typeof value === "string",
      ),
      sourceTaskIds: toArray<string>(entry.sourceTaskIds).filter(
        (value) => typeof value === "string",
      ),
      sourceIntelIds: toArray<string>(entry.sourceIntelIds).filter(
        (value) => typeof value === "string",
      ),
      derivedFromMemoryIds: toArray<string>(entry.derivedFromMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      measuredEffect: toRecord(entry.measuredEffect) ?? undefined,
      createdAt: toNumber(entry.createdAt, now),
      updatedAt: toNumber(entry.updatedAt, toNumber(entry.createdAt, now)),
    })),
    metaLearning: toArray<Record<string, unknown>>(memoryState?.learnings).map((entry, index) => ({
      id: toStringValue(entry.id, `meta-learning-${index}`),
      layer: "meta_learning",
      summary: toStringValue(entry.summary || entry.observedPattern, "Imported legacy learning"),
      hypothesis: toStringValue(entry.hypothesis) || undefined,
      adoptedAs:
        toStringValue(entry.adoptedAs) === "strategy" ||
        toStringValue(entry.adoptedAs) === "memory" ||
        toStringValue(entry.adoptedAs) === "policy" ||
        toStringValue(entry.adoptedAs) === "shadow"
          ? (toStringValue(entry.adoptedAs) as "strategy" | "memory" | "policy" | "shadow")
          : undefined,
      sourceTaskIds: toArray<string>(entry.sourceTaskIds).filter(
        (value) => typeof value === "string",
      ),
      sourceReviewIds: toArray<string>(entry.sourceReviewIds).filter(
        (value) => typeof value === "string",
      ),
      sourceMemoryIds: toArray<string>(entry.sourceMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      createdAt: toNumber(entry.createdAt, now),
      updatedAt: toNumber(entry.updatedAt, toNumber(entry.createdAt, now)),
      metadata: toRecord(entry) ?? undefined,
    })),
    evolutionMemory: toArray<LegacyEvolutionCandidate>(evolutionState?.candidates).map(
      (candidate, index) => ({
        id: toStringValue(candidate.id, `evolution-${index}`),
        layer: "evolution_memory",
        candidateType: normalizeEvolutionCandidateType(candidate.candidateType),
        targetLayer: normalizeEvolutionTargetLayer(candidate.targetLayer),
        summary: toStringValue(candidate.notes, "Imported legacy evolution candidate"),
        adoptionState: normalizeEvolutionAdoptionState(candidate.adoptionState),
        baselineRef: undefined,
        candidateRef: toStringValue(candidate.candidateRef) || undefined,
        sourceTaskIds: toArray<string>(candidate.sourceTaskIds).filter(
          (value) => typeof value === "string",
        ),
        sourceReviewIds: [],
        sourceShadowTelemetryIds: [],
        createdAt: toNumber(candidate.createdAt, now),
        updatedAt: toNumber(candidate.updatedAt, toNumber(candidate.createdAt, now)),
        metadata: {
          expectedEffect: toRecord(candidate.expectedEffect) ?? undefined,
          measuredEffect: toRecord(candidate.measuredEffect) ?? undefined,
          shadowMetrics: toRecord(candidate.shadowMetrics) ?? undefined,
          sourceEventIds: toArray<string>(candidate.sourceEventIds).filter(
            (value) => typeof value === "string",
          ),
          sourceIntelIds: toArray<string>(candidate.sourceIntelIds).filter(
            (value) => typeof value === "string",
          ),
          derivedFromMemoryIds: toArray<string>(candidate.derivedFromMemoryIds).filter(
            (value) => typeof value === "string",
          ),
          invalidatedBy: toArray<string>(candidate.invalidatedBy).filter(
            (value) => typeof value === "string",
          ),
          lastShadowAt: toNumber(candidate.lastShadowAt, 0) || undefined,
        },
      }),
    ),
    lastImportedAt: now,
  };
}

function buildImportedIntelStore(location: LegacyRuntimeLocation, now: number): RuntimeIntelStore {
  const intel = loadLegacyIntelState(location);
  const domains = toArray<LegacyIntelDomain>(intel?.domains);
  const candidates = toArray<LegacyIntelItem>(intel?.items).map((item) => ({
    id: toStringValue(item.id, "intel-unknown"),
    domain:
      item.domain === "tech" ||
      item.domain === "ai" ||
      item.domain === "business" ||
      item.domain === "github"
        ? item.domain
        : "tech",
    sourceId: toStringValue(item.sourceId, "legacy-source"),
    title: toStringValue(item.title, "Untitled intel"),
    url: toStringValue(item.url) || undefined,
    summary: toStringValue(item.summary) || undefined,
    score: toNumber(item.overallScore, 0),
    selected: item.selectedForDigest === true,
    createdAt: toNumber(item.deliveredAt, toNumber(item.fetchedAt, now)),
  }));

  return {
    version: "v1",
    enabled: intel?.config?.enabled !== false,
    digestEnabled: intel?.config?.digestEnabled !== false,
    candidateLimitPerDomain: toNumber(intel?.config?.candidateLimitPerDomain, 20),
    digestItemLimitPerDomain: toNumber(intel?.config?.digestItemLimitPerDomain, 10),
    exploitItemsPerDigest: toNumber(intel?.config?.exploitItemsPerDigest, 8),
    exploreItemsPerDigest: toNumber(intel?.config?.exploreItemsPerDigest, 2),
    candidates,
    digestItems: toArray<LegacyIntelDigest>(intel?.digests).flatMap((digest) =>
      toArray<LegacyIntelDigestItem>(digest.items).map((item, index) => ({
        id: toStringValue(item.id, `${toStringValue(digest.id, "digest")}-${index}`),
        domain:
          digest.domain === "tech" ||
          digest.domain === "ai" ||
          digest.domain === "business" ||
          digest.domain === "github"
            ? digest.domain
            : "tech",
        title: toStringValue(item.title, "Untitled intel"),
        conclusion: toStringValue(item.judgement, "Reference only."),
        whyItMatters: `importance=${toNumber(item.importanceScore, 0)}`,
        recommendedAttention: "review",
        recommendedAction: "reference",
        sourceIds: toStringValue(item.sourceId) ? [toStringValue(item.sourceId)] : [],
        exploit: true,
        createdAt: toNumber(digest.createdAt, now),
      })),
    ),
    sourceProfiles: domains.map((domain, index) => ({
      id: toStringValue(domain.id, `domain-${index}`),
      domain:
        domain.id === "tech" ||
        domain.id === "ai" ||
        domain.id === "business" ||
        domain.id === "github"
          ? domain.id
          : "tech",
      label: toStringValue(domain.label, domain.id),
      priority: 1,
      metadata: {
        latestFetchAt: toNumber(domain.lastFetchedAt, 0) || undefined,
      },
    })),
    topicProfiles: [],
    usefulnessRecords: [],
    pinnedRecords: [],
    lastImportedAt: now,
    metadata: {
      refreshMinutes: toNumber(intel?.config?.refreshMinutes, 180),
      maxItemsPerSourceInDigest: 2,
      recentDigestTopicWindowDays: 5,
      githubSearchWindowDays: 7,
    },
  };
}

function buildImportedGovernanceStore(
  location: LegacyRuntimeLocation,
  now: number,
): RuntimeGovernanceStore {
  const evolution = loadLegacyEvolutionState(location);
  const skillGovernance = loadLegacySkillGovernanceState(location);
  const entries = toArray<LegacySkillGovernanceEntry>(skillGovernance?.skills)
    .map((entry) => {
      const targetId = toStringValue(entry.id);
      return {
        id: `governance_skill_${hashText(targetId)}`,
        registryType: "skill" as const,
        targetId,
        state: normalizeLegacyGovernanceState(entry.adoptionState),
        summary:
          toStringValue(entry.notes) ||
          toStringValue(entry.title) ||
          `Imported legacy skill governance state for ${targetId}.`,
        updatedAt: toNumber(entry.updatedAt, now),
        metadata: {
          origin: toStringValue(entry.origin) || undefined,
          path: toStringValue(entry.path) || undefined,
          routeAffinity: toStringValue(entry.routeAffinity) || undefined,
          sideEffectLevel: toStringValue(entry.sideEffectLevel) || undefined,
          tokenProfile: toStringValue(entry.tokenProfile) || undefined,
          trustClass: toStringValue(entry.trustClass) || undefined,
          findings: toArray<string>(entry.findings).filter((value) => typeof value === "string"),
          lastAuditedAt: toNumber(entry.lastAuditedAt, 0) || undefined,
          importedFrom: "legacy-skill-governance",
        },
      };
    })
    .filter((entry) => entry.targetId);
  const shadowEvaluations = toArray<LegacyEvolutionCandidate>(evolution?.candidates).map(
    (candidate, index) => {
      const evolutionId = toStringValue(candidate.id, `evolution-${index}`);
      const shadowMetrics = toRecord(candidate.shadowMetrics);
      const shadowType = toStringValue(shadowMetrics?.shadowType);
      const route = toStringValue(shadowMetrics?.route);
      const lane = toStringValue(shadowMetrics?.lane);
      const worker = toStringValue(shadowMetrics?.worker);
      const skillBundle = toArray<string>(shadowMetrics?.skillBundle).filter(
        (value) => typeof value === "string",
      );
      return {
        id: `shadow_eval_${hashText(evolutionId)}`,
        candidateType: normalizeEvolutionCandidateType(candidate.candidateType),
        targetLayer: normalizeEvolutionTargetLayer(candidate.targetLayer),
        state:
          normalizeEvolutionAdoptionState(candidate.adoptionState) === "adopted"
            ? "adopted"
            : normalizeEvolutionAdoptionState(candidate.adoptionState) === "candidate"
              ? "promoted"
              : toArray<string>(candidate.invalidatedBy).length > 0
                ? "reverted"
                : "shadow",
        baselineRef: toStringValue(candidate.candidateRef) || undefined,
        candidateRef: evolutionId,
        expectedEffect: toStringValue(toRecord(candidate.expectedEffect)?.summary) || undefined,
        measuredEffect: toStringValue(toRecord(candidate.measuredEffect)?.summary) || undefined,
        observationCount: Math.max(
          1,
          toNumber(shadowMetrics?.observationCount, toNumber(shadowMetrics?.shadowSampleCount, 1)),
        ),
        updatedAt: toNumber(
          candidate.updatedAt,
          toNumber(candidate.lastShadowAt, toNumber(candidate.createdAt, now)),
        ),
        metadata: {
          route: route || undefined,
          lane: lane || undefined,
          worker: worker || undefined,
          skillBundle,
          shadowType: shadowType || undefined,
          shadowMetrics: shadowMetrics ?? undefined,
          expectedEffect: toRecord(candidate.expectedEffect) ?? undefined,
          measuredEffect: toRecord(candidate.measuredEffect) ?? undefined,
          originalCandidateRef: toStringValue(candidate.candidateRef) || undefined,
          invalidatedBy: toArray<string>(candidate.invalidatedBy).filter(
            (value) => typeof value === "string",
          ),
        },
      };
    },
  );
  return {
    version: "v1",
    entries,
    shadowEvaluations,
    lastImportedAt: now,
    metadata: {
      enabled: evolution?.config?.enabled !== false,
      autoApplyLowRisk: evolution?.config?.autoApplyLowRisk === true,
      reviewIntervalHours: toNumber(evolution?.config?.reviewIntervalHours, 12),
      skillGovernance: {
        scannedAt: toNumber(skillGovernance?.scannedAt, 0) || undefined,
        enforceDecisionFilter: toRecord(skillGovernance?.rules)?.enforceDecisionFilter === true,
        allowedDecisionStates: toArray<string>(
          toRecord(skillGovernance?.rules)?.allowedDecisionStates,
        ).filter((value) => typeof value === "string"),
      },
    },
  };
}

function syncLegacyRuntimeIntoAuthoritativeStore(
  location: LegacyRuntimeLocation,
  opts: RuntimeStateOptions = {},
): void {
  const now = resolveNow(opts.now);
  saveRuntimeStoreBundle(
    {
      taskStore: buildImportedTaskStore(location, now),
      memoryStore: buildImportedMemoryStore(location, now),
      intelStore: buildImportedIntelStore(location, now),
      governanceStore: buildImportedGovernanceStore(location, now),
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
}

function buildRuntimeManifest(params: {
  instanceManifest: InstanceManifest;
  runtimeVersion: string;
  generatedAt: number;
}): RuntimeManifest {
  return {
    instanceId: [
      params.instanceManifest.platform,
      params.instanceManifest.profile ?? "default",
      path.basename(params.instanceManifest.instanceRoot),
    ].join(":"),
    runtimeVersion: params.runtimeVersion,
    manifestVersion: "v1",
    instanceManifest: params.instanceManifest,
    capabilities: [
      "local-memory-kernel",
      "local-retrieval-orchestrator",
      "local-decision-core",
      "local-task-loop",
      "local-intel-pipeline",
      "open-capability-plane",
      "instance-root",
      "brain-federation-hooks",
    ],
    generatedAt: params.generatedAt,
  };
}

function detectCapabilityPolicyPreset(
  config: Record<string, unknown> | null,
): CapabilityPolicyPreset {
  const browserEnabled = toRecord(config?.browser)?.enabled === true;
  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  const sandbox = toRecord(defaults?.sandbox);
  const sandboxMode = toStringValue(sandbox?.mode);
  const workspaceOnly = toRecord(config?.tools)?.fs
    ? toRecord(toRecord(config?.tools)?.fs)?.workspaceOnly === true
    : false;

  if (browserEnabled && sandboxMode === "off" && !workspaceOnly) {
    return "managed_high";
  }
  if (sandboxMode === "non-main" || workspaceOnly) {
    return "balanced";
  }
  return "custom";
}

function sortTasks(tasks: RuntimeTaskSummary[]): RuntimeTaskSummary[] {
  return [...tasks].toSorted((left, right) =>
    compareTaskQueueOrder(left as TaskQueueInput, right as TaskQueueInput),
  );
}

export function buildRuntimeTasksList(opts: RuntimeStateOptions = {}): RuntimeTasksListResult {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const latestRuns = new Map<string, RuntimeTaskStore["runs"][number]>();
  for (const run of [...taskStore.runs].toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  )) {
    if (!latestRuns.has(run.taskId)) {
      latestRuns.set(run.taskId, run);
    }
  }
  const tasks = taskStore.tasks.map((task) => {
    const taskMetadata = toRecord(task.metadata);
    const runtimeTaskMetadata = toRecord(taskMetadata?.runtimeTask);
    const runtimeTaskRunState = toRecord(runtimeTaskMetadata?.runState);
    const latestRun = latestRuns.get(task.id);
    return {
      id: task.id,
      title: task.title,
      route: task.route,
      status: normalizeTaskStatus(task.status),
      priority: task.priority,
      budgetMode: task.budgetMode,
      retrievalMode: task.retrievalMode,
      recurring: task.recurring,
      maintenance: task.maintenance,
      tags: toArray<string>(task.tags).filter((value) => typeof value === "string"),
      nextAction: task.nextAction,
      blockedReason: task.blockedReason,
      lastError: task.lastError,
      thinkingLane:
        latestRun?.thinkingLane ||
        toStringValue(
          taskMetadata?.lastThinkingLane ||
            runtimeTaskMetadata?.lastThinkingLane ||
            runtimeTaskRunState?.lastThinkingLane,
        ) ||
        undefined,
      remoteCallCount:
        toNumber(
          toRecord(latestRun?.metadata)?.remoteCallCount ??
            taskMetadata?.remoteCallCount ??
            runtimeTaskMetadata?.remoteCallCount ??
            runtimeTaskRunState?.remoteCallCount,
          0,
        ) || undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      nextRunAt: task.nextRunAt,
    } satisfies RuntimeTaskSummary;
  });
  const sorted = sortTasks(tasks);
  return {
    generatedAt: now,
    total: sorted.length,
    statusCounts: buildTaskStatusCounts(sorted, now),
    runnableCount: sorted.filter((task) => isRunnableTaskStatus(task.status)).length,
    tasks: sorted,
  };
}

export function buildRuntimeMemoryList(opts: RuntimeStateOptions = {}): RuntimeMemoryListResult {
  const now = resolveNow(opts.now);
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const memoryTypeCounts = emptyMemoryTypeCounts();
  const memories = [...memoryStore.memories]
    .map((entry) => {
      memoryTypeCounts[entry.memoryType] += 1;
      return {
        id: entry.id,
        memoryType: entry.memoryType,
        route: entry.route,
        scope: entry.scope,
        summary: entry.summary,
        confidence: normalizeConfidencePercent(entry.confidence, 0),
        invalidated: entry.invalidatedBy.length > 0,
        updatedAt: entry.updatedAt,
      } satisfies RuntimeMemorySummary;
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  const strategies = [...memoryStore.strategies].toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  );

  return {
    generatedAt: now,
    total: memories.length,
    strategyCount: strategies.length,
    learningCount: memoryStore.metaLearning.length,
    memoryTypeCounts,
    memories,
    strategies,
  };
}

export function buildRuntimeRetrievalStatus(
  opts: RuntimeStateOptions = {},
): RuntimeRetrievalStatus {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return {
    generatedAt: now,
    planes: ["strategy", "memory", "intel", "archive"],
    layers: MEMORY_LAYERS,
    system1DefaultPlanes: ["strategy", "memory"],
    system2DefaultPlanes: ["strategy", "memory", "intel", "archive"],
    defaultBudgetMode: taskStore.defaults.defaultBudgetMode,
    defaultRetrievalMode: taskStore.defaults.defaultRetrievalMode,
    maxInputTokensPerTurn: taskStore.defaults.maxInputTokensPerTurn,
    maxContextChars: taskStore.defaults.maxContextChars,
    maxRemoteCallsPerTask: taskStore.defaults.maxRemoteCallsPerTask,
  };
}

export function buildRuntimeIntelStatus(opts: RuntimeStateOptions = {}): RuntimeIntelStatus {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const detectedDomainIds = new Set<IntelCandidate["domain"]>();
  for (const candidate of intelStore.candidates) detectedDomainIds.add(candidate.domain);
  for (const digestItem of intelStore.digestItems) detectedDomainIds.add(digestItem.domain);
  for (const sourceProfile of intelStore.sourceProfiles)
    detectedDomainIds.add(sourceProfile.domain);
  const domainIds = (
    detectedDomainIds.size > 0 ? [...detectedDomainIds] : [...RUNTIME_INTEL_DOMAIN_ORDER]
  ).toSorted(
    (left, right) =>
      RUNTIME_INTEL_DOMAIN_ORDER.indexOf(left) - RUNTIME_INTEL_DOMAIN_ORDER.indexOf(right),
  );
  const domains = domainIds.map((domainId) => {
    const profile = intelStore.sourceProfiles.find((entry) => entry.domain === domainId);
    const metadata = toRecord(profile?.metadata);
    return {
      id: domainId,
      label:
        profile?.label ||
        (domainId === "ai"
          ? "AI"
          : domainId === "github"
            ? "GitHub"
            : domainId === "tech"
              ? "Tech"
              : "Business"),
      candidateCount: intelStore.candidates.filter((entry) => entry.domain === domainId).length,
      selectedCount: intelStore.candidates.filter(
        (entry) => entry.domain === domainId && entry.selected,
      ).length,
      digestCount: intelStore.digestItems.filter((entry) => entry.domain === domainId).length,
      latestDigestAt:
        intelStore.digestItems
          .filter((entry) => entry.domain === domainId)
          .reduce((latest, entry) => Math.max(latest, entry.createdAt), 0) || null,
      latestFetchAt: toNumber(metadata?.latestFetchAt ?? metadata?.lastFetchedAt, 0) || null,
    } satisfies RuntimeIntelDomainStatus;
  });
  return {
    generatedAt: now,
    enabled: intelStore.enabled,
    digestEnabled: intelStore.digestEnabled,
    candidateLimitPerDomain: intelStore.candidateLimitPerDomain,
    digestItemLimitPerDomain: intelStore.digestItemLimitPerDomain,
    exploitItemsPerDigest: intelStore.exploitItemsPerDigest,
    exploreItemsPerDigest: intelStore.exploreItemsPerDigest,
    itemCount: intelStore.candidates.length,
    digestCount: intelStore.digestItems.length,
    domains,
  };
}

function countObjectEntries(value: unknown): number {
  const record = toRecord(value);
  return record ? Object.keys(record).length : 0;
}

export function buildRuntimeCapabilitiesStatus(
  opts: RuntimeStateOptions = {},
): RuntimeCapabilitiesStatus {
  const now = resolveNow(opts.now);
  const manifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const config = opts.config ?? null;
  const stateCounts = emptyGovernanceStateCounts();
  const governanceStore = loadRuntimeGovernanceStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const authoritativeEntries = governanceStore.entries;
  if (governanceStore.entries.length > 0) {
    for (const entry of governanceStore.entries) {
      stateCounts[entry.state] += 1;
    }
  } else {
    for (const entry of memoryStore.evolutionMemory) {
      stateCounts[entry.adoptionState] += 1;
    }
    for (const entry of governanceStore.shadowEvaluations) {
      const state = mapShadowEvaluationStateToGovernanceState(entry.state);
      if (state) stateCounts[state] += 1;
    }
  }

  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  const sandbox = toRecord(defaults?.sandbox);
  const tools = toRecord(config?.tools);
  const mcp = toRecord(config?.mcp);
  const agentCount =
    authoritativeEntries.filter((entry) => entry.registryType === "agent").length ||
    toArray(toRecord(agents)?.list).length;
  const skillCount =
    authoritativeEntries.filter((entry) => entry.registryType === "skill").length ||
    countObjectEntries(toRecord(tools)?.skills ?? toRecord(config?.skills));
  const mcpCount =
    authoritativeEntries.filter((entry) => entry.registryType === "mcp").length ||
    countObjectEntries(mcp?.servers ?? mcp?.entries ?? mcp?.list);

  return {
    generatedAt: now,
    preset: detectCapabilityPolicyPreset(config),
    browserEnabled: toRecord(config?.browser)?.enabled === true,
    sandboxMode: toStringValue(sandbox?.mode, "unknown"),
    workspaceRoot: toStringValue(defaults?.workspace) || manifest.workspaceRoot || null,
    extensions: listDirectoryNames(manifest.extensionsRoot),
    legacyExtensions: [],
    agentCount,
    skillCount,
    mcpCount,
    governanceStateCounts: stateCounts,
  };
}

export function buildRuntimeEvolutionStatus(
  opts: RuntimeStateOptions = {},
): RuntimeEvolutionStatus {
  const now = resolveNow(opts.now);
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const governanceStore = loadRuntimeGovernanceStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const metadata = toRecord(governanceStore.metadata);
  return {
    generatedAt: now,
    enabled: metadata?.enabled !== false,
    autoApplyLowRisk: metadata?.autoApplyLowRisk === true,
    reviewIntervalHours: toNumber(metadata?.reviewIntervalHours, 12),
    candidateCount: memoryStore.evolutionMemory.length,
    stateCounts:
      memoryStore.evolutionMemory.length > 0
        ? countBy(memoryStore.evolutionMemory.map((entry) => entry.adoptionState))
        : countBy(
            governanceStore.shadowEvaluations
              .map((entry) => mapShadowEvaluationStateToGovernanceState(entry.state))
              .filter((value): value is GovernanceState => value != null),
          ),
  };
}

export function buildLegacyRuntimeImportPreview(
  opts: RuntimeStateOptions = {},
): LegacyRuntimeImportReport {
  const now = resolveNow(opts.now);
  const manifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const location = resolveLegacyRuntimeLocation(opts);
  const stateFiles = [
    "autopilot.json",
    "intel.json",
    "memory.json",
    "evolution.json",
    "skill-governance.json",
    "events.jsonl",
  ].filter((fileName) => fs.existsSync(joinResolvedPath(location.managedStateRoot, fileName)));
  const autopilot = loadLegacyAutopilotState(location);
  const memory = loadLegacyMemoryState(location);
  const intel = loadLegacyIntelState(location);
  const evolution = loadLegacyEvolutionState(location);
  const warnings: string[] = [];
  const detected =
    fs.existsSync(location.configPath) ||
    stateFiles.length > 0 ||
    listDirectoryNames(location.extensionsRoot).length > 0;

  if (!detected) {
    warnings.push(`No migration source files were detected under ${location.legacyRoot}.`);
  }
  if (manifest.instanceRoot === location.legacyRoot) {
    warnings.push(
      "Current instance root matches the migration source root; import stays read-only.",
    );
  }

  const mappings: RuntimeImportMapping[] = [];
  if (fs.existsSync(location.configPath)) {
    mappings.push({
      kind: "config",
      source: location.configPath,
      targetRelativePath: path.join("config", "openclaw.json"),
      optional: false,
    });
  }
  for (const fileName of stateFiles) {
    mappings.push({
      kind: fileName.endsWith(".jsonl") ? "events" : "state",
      source: joinResolvedPath(location.managedStateRoot, fileName),
      targetRelativePath: path.join("state", LEGACY_MANAGED_STATE_DIRNAME, fileName),
      optional: false,
    });
  }
  const legacyExtensions = listDirectoryNames(location.extensionsRoot);
  if (legacyExtensions.length > 0) {
    mappings.push({
      kind: "extensions_manifest",
      source: location.extensionsRoot,
      targetRelativePath: "extensions-manifest.json",
      optional: false,
    });
  }

  return {
    detected,
    generatedAt: now,
    legacyRoot: location.legacyRoot,
    configPath: fs.existsSync(location.configPath) ? location.configPath : null,
    stateRoot: fs.existsSync(location.stateRoot) ? location.stateRoot : null,
    managedStateRoot: fs.existsSync(location.managedStateRoot) ? location.managedStateRoot : null,
    extensionsRoot: fs.existsSync(location.extensionsRoot) ? location.extensionsRoot : null,
    availableStateFiles: stateFiles,
    legacyExtensions,
    counts: {
      tasks: toArray(autopilot?.tasks).length,
      memories: toArray(memory?.memories).length,
      strategies: toArray(memory?.strategies).length,
      intelItems: toArray(intel?.items).length,
      intelDigests: toArray(intel?.digests).length,
      evolutionCandidates: toArray(evolution?.candidates).length,
    },
    warnings,
    plan: {
      id: `preview-${now}`,
      generatedAt: now,
      legacyRoot: location.legacyRoot,
      targetBaseRoot: resolver.resolveDataPath(...IMPORTS_ROOT_SEGMENTS),
      targetInstanceRoot: manifest.instanceRoot,
      mappings,
      warnings: [...warnings],
    },
  };
}

export function applyLegacyRuntimeImport(
  opts: RuntimeStateOptions = {},
): LegacyRuntimeImportApplyResult {
  const now = resolveNow(opts.now);
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const preview = buildLegacyRuntimeImportPreview(opts);
  const importId = `legacy-runtime-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
  const targetRoot = resolver.resolveDataPath(...IMPORTS_ROOT_SEGMENTS, importId);
  fs.mkdirSync(targetRoot, { recursive: true });

  const copiedFiles: LegacyRuntimeImportApplyResult["copiedFiles"] = [];
  for (const mapping of preview.plan.mappings) {
    const targetPath = path.join(targetRoot, mapping.targetRelativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (mapping.kind === "extensions_manifest") {
      fs.writeFileSync(
        targetPath,
        JSON.stringify(
          {
            generatedAt: now,
            extensions: preview.legacyExtensions.map((name) => ({
              name,
              sourcePath: joinResolvedPath(preview.extensionsRoot ?? "", name),
            })),
          },
          null,
          2,
        ),
        "utf8",
      );
    } else {
      fs.copyFileSync(mapping.source, targetPath);
    }
    copiedFiles.push({ kind: mapping.kind, target: targetPath });
  }

  const planPath = path.join(targetRoot, "plan.json");
  const reportPath = path.join(targetRoot, "report.json");
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        ...preview.plan,
        id: importId,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(reportPath, JSON.stringify(preview, null, 2), "utf8");
  syncLegacyRuntimeIntoAuthoritativeStore(resolveLegacyRuntimeLocation(opts), opts);
  syncRuntimeCapabilityRegistry(opts.config ?? null, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });

  return {
    importId,
    appliedAt: now,
    targetRoot,
    copiedFiles,
    planPath,
    reportPath,
    extensionsManifestPath:
      copiedFiles.find((entry) => entry.kind === "extensions_manifest")?.target ?? null,
  };
}

function countJsonFiles(root: string): number {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function readFederationConfigRecord(
  config: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const direct = toRecord(config?.federation);
  if (direct) return direct;
  const runtime = toRecord(config?.runtime);
  const runtimeFederation = toRecord(runtime?.federation);
  if (runtimeFederation) return runtimeFederation;
  const brain = toRecord(config?.brain);
  return toRecord(brain?.federation);
}

function parseScopeList(value: unknown): string[] {
  if (typeof value === "string") {
    return uniqueStrings(
      value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  }
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
  );
}

function resolveFederationPushPolicy(config: Record<string, unknown> | null): {
  enabled: boolean;
  remoteConfigured: boolean;
  allowedPushScopes: string[];
  blockedPushScopes: string[];
} {
  const federation = readFederationConfigRecord(config);
  const remote = toRecord(federation?.remote);
  const push = toRecord(federation?.push);
  const explicitAllowed = parseScopeList(
    push?.allowedScopes ?? push?.scopes ?? federation?.allowedPushScopes,
  );
  const explicitBlocked = parseScopeList(
    push?.blockedScopes ?? push?.deny ?? federation?.blockedPushScopes,
  );
  const blockedPushScopes = uniqueStrings([
    ...DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES,
    ...explicitBlocked,
  ]);
  const allowedSeed =
    explicitAllowed.length > 0
      ? explicitAllowed.filter((scope) =>
          (KNOWN_FEDERATION_PUSH_SCOPES as readonly string[]).includes(scope),
        )
      : [...DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES];
  const allowedPushScopes = uniqueStrings(
    allowedSeed.filter((scope) => !blockedPushScopes.includes(scope)),
  );
  const remoteConfigured =
    typeof remote?.enabled === "boolean"
      ? remote.enabled === true &&
        uniqueStrings([
          toStringValue(remote.url),
          toStringValue(remote.endpoint),
          toStringValue(remote.baseUrl),
          toStringValue(remote.origin),
          toStringValue(remote.assignmentInbox),
        ]).length > 0
      : uniqueStrings([
          toStringValue(remote?.url),
          toStringValue(remote?.endpoint),
          toStringValue(remote?.baseUrl),
          toStringValue(remote?.origin),
          toStringValue(remote?.assignmentInbox),
        ]).length > 0;
  return {
    enabled: federation?.enabled !== false,
    remoteConfigured,
    allowedPushScopes,
    blockedPushScopes,
  };
}

export function buildFederationRuntimeSnapshot(
  opts: RuntimeStateOptions & {
    runtimeManifest?: RuntimeManifest;
  } = {},
): FederationRuntimeSnapshot {
  const now = resolveNow(opts.now);
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const runtimeManifest =
    opts.runtimeManifest ??
    buildRuntimeManifest({
      instanceManifest: resolveInstanceManifest({
        env: opts.env,
        homedir: opts.homedir,
      }),
      runtimeVersion: resolveRuntimeServiceVersion(opts.env ?? process.env),
      generatedAt: now,
    });
  const federationRoot = resolver.resolveDataPath(...FEDERATION_ROOT_SEGMENTS);
  const outboxRoot = path.join(federationRoot, "outbox");
  const assignmentsRoot = path.join(federationRoot, "assignments");
  const federationPolicy = resolveFederationPushPolicy(opts.config ?? null);
  return {
    generatedAt: now,
    enabled: federationPolicy.enabled,
    remoteConfigured: federationPolicy.remoteConfigured,
    manifest: runtimeManifest,
    outboxRoot,
    assignmentsRoot,
    syncCursorPath: path.join(federationRoot, "sync-cursor.json"),
    pendingAssignments: countJsonFiles(assignmentsRoot),
    outboxEnvelopeCounts: {
      runtimeManifest: countJsonFiles(path.join(outboxRoot, "runtime-manifest")),
      strategyDigest: countJsonFiles(path.join(outboxRoot, "strategy-digest")),
      intelDigest: countJsonFiles(path.join(outboxRoot, "intel-digest")),
      shadowTelemetry: countJsonFiles(path.join(outboxRoot, "shadow-telemetry")),
      capabilityGovernance: countJsonFiles(path.join(outboxRoot, "capability-governance")),
    },
    allowedPushScopes: federationPolicy.allowedPushScopes,
    blockedPushScopes: federationPolicy.blockedPushScopes,
  };
}

export function buildRuntimeDashboardSnapshot(
  opts: RuntimeStateOptions = {},
): RuntimeDashboardSnapshot {
  const now = resolveNow(opts.now);
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const runtimeVersion = resolveRuntimeServiceVersion(opts.env ?? process.env);
  const runtimeManifest = buildRuntimeManifest({
    instanceManifest,
    runtimeVersion,
    generatedAt: now,
  });
  return {
    generatedAt: now,
    runtimeVersion,
    preset: detectCapabilityPolicyPreset(opts.config ?? null),
    instanceManifest,
    runtimeManifest,
    tasks: buildRuntimeTasksList(opts),
    memory: buildRuntimeMemoryList(opts),
    retrieval: buildRuntimeRetrievalStatus(opts),
    intel: buildRuntimeIntelStatus(opts),
    capabilities: buildRuntimeCapabilitiesStatus(opts),
    evolution: buildRuntimeEvolutionStatus(opts),
    importPreview: buildLegacyRuntimeImportPreview(opts),
    federation: buildFederationRuntimeSnapshot({
      ...opts,
      runtimeManifest,
    }),
  };
}

export function buildLatestStrategyDigestEnvelope(
  opts: RuntimeStateOptions = {},
): StrategyDigestEnvelope {
  const now = resolveNow(opts.now);
  const memory = buildRuntimeMemoryList(opts);
  return {
    id: `strategy-digest-${now}`,
    strategies: memory.strategies.slice(0, 20),
    generatedAt: now,
  };
}

export function buildLatestIntelDigestEnvelope(
  opts: RuntimeStateOptions = {},
): IntelDigestEnvelope {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return {
    id: `intel-digest-${now}`,
    digestItems: [...intelStore.digestItems]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .slice(0, 40),
    generatedAt: now,
  };
}

export function buildGovernanceSnapshotMetadata(opts: RuntimeStateOptions = {}): RuntimeMetadata {
  const capabilities = buildRuntimeCapabilitiesStatus(opts);
  return {
    preset: capabilities.preset,
    sandboxMode: capabilities.sandboxMode,
    agentCount: capabilities.agentCount,
    extensionCount: capabilities.extensions.length,
  };
}
