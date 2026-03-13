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
import {
  FORMAL_MEMORY_TYPES,
  MEMORY_LAYERS,
  type FormalMemoryType,
  type GovernanceState,
  type InstanceManifest,
  type IntelCandidate,
  type IntelDigestEnvelope,
  type RuntimeManifest,
  type RuntimeMetadata,
  type StrategyDigestEnvelope,
  type StrategyRecord,
  type TaskRecord,
  type TaskStatus,
} from "./contracts.js";
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

type RuntimeStateOptions = {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  now?: number;
  config?: Record<string, unknown> | null;
};

type LegacyAutopilotTask = Record<string, unknown> & {
  id?: string;
  title?: string;
  route?: string;
  status?: string;
  priority?: string;
  budgetMode?: string;
  retrievalMode?: string;
  skillHints?: string[];
  memoryRefs?: string[];
  intelRefs?: string[];
  recurring?: boolean;
  maintenance?: boolean;
  blockedReason?: string;
  nextAction?: string;
  tags?: string[];
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
  confidence?: number;
  invalidatedBy?: string[];
  updatedAt?: number;
  createdAt?: number;
};

type LegacyStrategyEntry = {
  id?: string;
  route?: string;
  worker?: string;
  summary?: string;
  confidence?: number;
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
  adoptionState?: string;
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
  enabled: true;
  remoteConfigured: false;
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

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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
  const location = resolveLegacyRuntimeLocation(opts);
  const autopilot = loadLegacyAutopilotState(location);
  const tasks = toArray<LegacyAutopilotTask>(autopilot?.tasks).map((task) => {
    const runState = toRecord(task.runState);
    const status = normalizeTaskStatus(task.status);
    return {
      id: toStringValue(task.id, "task-unknown"),
      title: toStringValue(task.title, "Untitled task"),
      route: toStringValue(task.route, "general"),
      status,
      priority:
        task.priority === "high" || task.priority === "low" || task.priority === "normal"
          ? task.priority
          : "normal",
      budgetMode:
        task.budgetMode === "deep" || task.budgetMode === "balanced" || task.budgetMode === "strict"
          ? task.budgetMode
          : "strict",
      retrievalMode:
        task.retrievalMode === "deep" ||
        task.retrievalMode === "light" ||
        task.retrievalMode === "off"
          ? task.retrievalMode
          : "light",
      recurring: task.recurring === true,
      maintenance: task.maintenance === true,
      tags: toArray<string>(task.tags).filter((value) => typeof value === "string"),
      nextAction: toStringValue(task.nextAction) || undefined,
      blockedReason: toStringValue(task.blockedReason) || undefined,
      lastError: toStringValue(task.lastError) || undefined,
      thinkingLane: toStringValue(runState?.lastThinkingLane) || undefined,
      remoteCallCount: toNumber(runState?.remoteCallCount, 0) || undefined,
      createdAt: toNumber(task.createdAt, now),
      updatedAt: toNumber(task.updatedAt, toNumber(task.createdAt, now)),
      nextRunAt:
        typeof task.nextRunAt === "number" && Number.isFinite(task.nextRunAt)
          ? task.nextRunAt
          : undefined,
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
  const location = resolveLegacyRuntimeLocation(opts);
  const memoryState = loadLegacyMemoryState(location);
  const memoryTypeCounts = emptyMemoryTypeCounts();
  const memories = toArray<LegacyMemoryEntry>(memoryState?.memories)
    .map((entry) => {
      const memoryType = normalizeMemoryType(entry.memoryType);
      memoryTypeCounts[memoryType] += 1;
      return {
        id: toStringValue(entry.id, "memory-unknown"),
        memoryType,
        route: toStringValue(entry.route) || undefined,
        scope: toStringValue(entry.scope) || undefined,
        summary: toStringValue(entry.summary, "No summary"),
        confidence: toNumber(entry.confidence, 0),
        invalidated: toArray<string>(entry.invalidatedBy).length > 0,
        updatedAt: toNumber(entry.updatedAt, toNumber(entry.createdAt, now)),
      } satisfies RuntimeMemorySummary;
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  const strategies = toArray<LegacyStrategyEntry>(memoryState?.strategies)
    .map(
      (entry) =>
        ({
          id: toStringValue(entry.id, "strategy-unknown"),
          layer: "strategies",
          route: toStringValue(entry.route, "general"),
          worker: toStringValue(entry.worker, "main"),
          skillIds: [],
          summary: toStringValue(entry.summary, "No strategy summary"),
          thinkingLane: "system1",
          createdAt: toNumber(entry.createdAt, now),
          updatedAt: toNumber(entry.updatedAt, toNumber(entry.createdAt, now)),
          sourceEventIds: [],
          sourceTaskIds: [],
          sourceIntelIds: [],
          derivedFromMemoryIds: [],
          confidence: toNumber(entry.confidence, 0),
          version: 1,
          invalidatedBy: [],
        }) satisfies StrategyRecord,
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  return {
    generatedAt: now,
    total: memories.length,
    strategyCount: strategies.length,
    learningCount: toArray(memoryState?.learnings).length,
    memoryTypeCounts,
    memories,
    strategies,
  };
}

export function buildRuntimeRetrievalStatus(
  opts: RuntimeStateOptions = {},
): RuntimeRetrievalStatus {
  const now = resolveNow(opts.now);
  const location = resolveLegacyRuntimeLocation(opts);
  const autopilot = loadLegacyAutopilotState(location);
  return {
    generatedAt: now,
    planes: ["strategy", "memory", "intel", "archive"],
    layers: MEMORY_LAYERS,
    system1DefaultPlanes: ["strategy", "memory"],
    system2DefaultPlanes: ["strategy", "memory", "intel", "archive"],
    defaultBudgetMode: toStringValue(autopilot?.config?.defaultBudgetMode, "strict"),
    defaultRetrievalMode: toStringValue(autopilot?.config?.defaultRetrievalMode, "light"),
    maxInputTokensPerTurn: toNumber(autopilot?.config?.maxInputTokensPerTurn, 6000),
    maxContextChars: toNumber(autopilot?.config?.maxContextChars, 9000),
    maxRemoteCallsPerTask: toNumber(autopilot?.config?.maxRemoteCallsPerTask, 6),
  };
}

export function buildRuntimeIntelStatus(opts: RuntimeStateOptions = {}): RuntimeIntelStatus {
  const now = resolveNow(opts.now);
  const location = resolveLegacyRuntimeLocation(opts);
  const intel = loadLegacyIntelState(location);
  const items = toArray<LegacyIntelItem>(intel?.items);
  const digests = toArray<LegacyIntelDigest>(intel?.digests);
  const domains = toArray<LegacyIntelDomain>(intel?.domains).map((domain) => {
    const id = toStringValue(domain.id, "unknown") || "unknown";
    const domainItems = items.filter((item) => item.domain === id);
    const domainDigests = digests.filter((digest) => digest.domain === id);
    return {
      id,
      label: toStringValue(domain.label, id),
      candidateCount: domainItems.length,
      selectedCount: domainItems.filter((item) => item.selectedForDigest === true).length,
      digestCount: domainDigests.length,
      latestDigestAt:
        domainDigests.reduce(
          (latest, digest) => Math.max(latest, toNumber(digest.createdAt, 0)),
          0,
        ) || null,
      latestFetchAt: toNumber(domain.lastFetchedAt, 0) || null,
    } satisfies RuntimeIntelDomainStatus;
  });
  return {
    generatedAt: now,
    enabled: intel?.config?.enabled !== false,
    digestEnabled: intel?.config?.digestEnabled !== false,
    candidateLimitPerDomain: toNumber(intel?.config?.candidateLimitPerDomain, 20),
    digestItemLimitPerDomain: toNumber(intel?.config?.digestItemLimitPerDomain, 10),
    exploitItemsPerDigest: toNumber(intel?.config?.exploitItemsPerDigest, 8),
    exploreItemsPerDigest: toNumber(intel?.config?.exploreItemsPerDigest, 2),
    itemCount: items.length,
    digestCount: digests.length,
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
  const location = resolveLegacyRuntimeLocation(opts);
  const evolution = loadLegacyEvolutionState(location);
  const stateCounts = emptyGovernanceStateCounts();
  for (const candidate of toArray<LegacyEvolutionCandidate>(evolution?.candidates)) {
    const state = toStringValue(candidate.adoptionState) as GovernanceState;
    if (state in stateCounts) {
      stateCounts[state] += 1;
    }
  }

  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  const sandbox = toRecord(defaults?.sandbox);
  const tools = toRecord(config?.tools);
  const mcp = toRecord(config?.mcp);

  return {
    generatedAt: now,
    preset: detectCapabilityPolicyPreset(config),
    browserEnabled: toRecord(config?.browser)?.enabled === true,
    sandboxMode: toStringValue(sandbox?.mode, "unknown"),
    workspaceRoot: toStringValue(defaults?.workspace) || manifest.workspaceRoot || null,
    extensions: listDirectoryNames(manifest.extensionsRoot),
    legacyExtensions: listDirectoryNames(location.extensionsRoot),
    agentCount: toArray(toRecord(agents)?.list).length,
    skillCount: countObjectEntries(toRecord(tools)?.skills ?? toRecord(config?.skills)),
    mcpCount: countObjectEntries(mcp?.servers ?? mcp?.entries ?? mcp?.list),
    governanceStateCounts: stateCounts,
  };
}

export function buildRuntimeEvolutionStatus(
  opts: RuntimeStateOptions = {},
): RuntimeEvolutionStatus {
  const now = resolveNow(opts.now);
  const location = resolveLegacyRuntimeLocation(opts);
  const evolution = loadLegacyEvolutionState(location);
  return {
    generatedAt: now,
    enabled: evolution?.config?.enabled !== false,
    autoApplyLowRisk: evolution?.config?.autoApplyLowRisk === true,
    reviewIntervalHours: toNumber(evolution?.config?.reviewIntervalHours, 12),
    candidateCount: toArray(evolution?.candidates).length,
    stateCounts: countBy(
      toArray<LegacyEvolutionCandidate>(evolution?.candidates).map(
        (candidate) => toStringValue(candidate.adoptionState, "shadow") || "shadow",
      ),
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
    warnings.push("No legacy runtime files were detected under the default ~/.openclaw root.");
  }
  if (manifest.instanceRoot === location.legacyRoot) {
    warnings.push("Current instance root matches the legacy runtime root; import stays read-only.");
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
  return {
    generatedAt: now,
    enabled: true,
    remoteConfigured: false,
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
    allowedPushScopes: [
      "shareable_derived",
      "review_summary",
      "metrics",
      "shadow_telemetry",
      "strategy_digest",
      "intel_digest",
    ],
    blockedPushScopes: ["raw_chat", "secrets", "durable_private_memory_dump"],
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
  const location = resolveLegacyRuntimeLocation(opts);
  const intel = loadLegacyIntelState(location);
  const digests = toArray<LegacyIntelDigest>(intel?.digests)
    .toSorted((left, right) => toNumber(right.createdAt, 0) - toNumber(left.createdAt, 0))
    .slice(0, 4);
  return {
    id: `intel-digest-${now}`,
    digestItems: digests.flatMap((digest) =>
      toArray<LegacyIntelDigestItem>(digest.items).map((item, index) => ({
        id: toStringValue(item.id, `${toStringValue(digest.id, "digest")}-${index}`),
        domain: digest.domain ?? "tech",
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
