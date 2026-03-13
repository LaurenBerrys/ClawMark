export const MEMORY_LAYERS = [
  "logs",
  "events",
  "memories",
  "strategies",
  "meta_learning",
  "evolution_memory",
] as const;

export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export const FORMAL_MEMORY_TYPES = [
  "user",
  "knowledge",
  "execution",
  "avoidance",
  "efficiency",
  "completion",
  "resource",
  "communication",
] as const;

export type FormalMemoryType = (typeof FORMAL_MEMORY_TYPES)[number];

export type TaskPriority = "low" | "normal" | "high";
export type BudgetMode = "strict" | "balanced" | "deep";
export type RetrievalMode = "off" | "light" | "deep";
export type TaskReportPolicy = "silent" | "reply" | "proactive" | "reply_and_proactive";

export const TASK_STATUSES = [
  "queued",
  "planning",
  "ready",
  "running",
  "waiting_external",
  "waiting_user",
  "blocked",
  "completed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type ThinkingLane = "system1" | "system2";
export type RetrievalPlane = "strategy" | "memory" | "intel" | "archive";
export type GovernanceState = "blocked" | "shadow" | "candidate" | "adopted" | "core";
export type GovernanceRegistryType = "skill" | "agent" | "mcp";

export type EvolutionCandidateType =
  | "route_default_lane"
  | "route_skill_bundle"
  | "retry_policy_review"
  | "intel_source_reweight"
  | "model_route"
  | "skill_bundle"
  | "retry_policy"
  | "intel_source"
  | "strategy_refresh"
  | "prompt_context_policy"
  | "worker_routing";

export type RuntimeMetadata = Record<string, unknown>;

export type SourceLineage = {
  sourceEventIds: string[];
  sourceTaskIds: string[];
  sourceIntelIds: string[];
  derivedFromMemoryIds: string[];
};

export type VersionedConfidence = {
  confidence: number;
  version: number;
  invalidatedBy: string[];
};

export type MemoryRecord = SourceLineage &
  VersionedConfidence & {
    id: string;
    layer: "memories";
    memoryType: FormalMemoryType;
    route?: string;
    summary: string;
    detail?: string;
    scope?: string;
    appliesWhen?: string;
    avoidWhen?: string;
    tags: string[];
    lastReinforcedAt?: number;
    decayScore?: number;
    createdAt: number;
    updatedAt: number;
    metadata?: RuntimeMetadata;
  };

export type StrategyRecord = SourceLineage &
  VersionedConfidence & {
    id: string;
    layer: "strategies";
    route: string;
    worker: string;
    skillIds: string[];
    summary: string;
    fallback?: string;
    triggerConditions?: string;
    recommendedPath?: string;
    fallbackPath?: string;
    thinkingLane: ThinkingLane;
    measuredEffect?: RuntimeMetadata;
    createdAt: number;
    updatedAt: number;
    metadata?: RuntimeMetadata;
  };

export type MetaLearningRecord = {
  id: string;
  layer: "meta_learning";
  summary: string;
  hypothesis?: string;
  adoptedAs?: "strategy" | "memory" | "policy" | "shadow";
  sourceTaskIds: string[];
  sourceReviewIds: string[];
  sourceMemoryIds: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type EvolutionMemoryRecord = {
  id: string;
  layer: "evolution_memory";
  candidateType: EvolutionCandidateType;
  targetLayer: "decision" | "task_loop" | "intel" | "retrieval" | "governance";
  summary: string;
  adoptionState: Exclude<GovernanceState, "blocked" | "core">;
  baselineRef?: string;
  candidateRef?: string;
  sourceTaskIds: string[];
  sourceReviewIds: string[];
  sourceShadowTelemetryIds: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type TaskRecord = {
  id: string;
  title: string;
  route: string;
  status: TaskStatus;
  priority: TaskPriority;
  budgetMode: BudgetMode;
  retrievalMode: RetrievalMode;
  goal?: string;
  successCriteria?: string;
  tags?: string[];
  worker?: string;
  skillIds: string[];
  memoryRefs: string[];
  intelRefs: string[];
  recurring: boolean;
  maintenance: boolean;
  planSummary?: string;
  nextAction?: string;
  blockedReason?: string;
  lastError?: string;
  reportPolicy?: TaskReportPolicy;
  nextRunAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  activeRunId?: string;
  latestReviewId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type TaskRun = {
  id: string;
  taskId: string;
  status: TaskStatus;
  thinkingLane: ThinkingLane;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  blockedAt?: number;
  concurrencyKey?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  metadata?: RuntimeMetadata;
};

export type TaskStep = {
  id: string;
  taskId: string;
  runId: string;
  kind: "intake" | "planner" | "executor" | "recovery" | "review" | "notify";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  idempotencyKey: string;
  worker?: string;
  route?: string;
  skillId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata?: RuntimeMetadata;
};

export type TaskReview = {
  id: string;
  taskId: string;
  runId: string;
  summary: string;
  outcome: "success" | "partial" | "blocked" | "cancelled" | "failed";
  extractedMemoryIds: string[];
  strategyCandidateIds: string[];
  createdAt: number;
  metadata?: RuntimeMetadata;
};

export type RetrievalQuery = {
  id: string;
  taskId?: string;
  prompt: string;
  thinkingLane: ThinkingLane;
  planes: RetrievalPlane[];
  route?: string;
  worker?: string;
  topicHints: string[];
  maxCandidatesPerPlane: number;
  metadata?: RuntimeMetadata;
};

export type RetrievalCandidate = {
  id: string;
  plane: RetrievalPlane;
  recordId?: string;
  title: string;
  excerpt?: string;
  score: number;
  confidence?: number;
  sourceRef?: string;
  metadata?: RuntimeMetadata;
};

export type ContextPack = {
  id: string;
  queryId: string;
  thinkingLane: ThinkingLane;
  summary: string;
  strategyCandidates: RetrievalCandidate[];
  memoryCandidates: RetrievalCandidate[];
  intelCandidates: RetrievalCandidate[];
  archiveCandidates: RetrievalCandidate[];
  synthesis: string[];
  metadata?: RuntimeMetadata;
};

export type RetrievalSourceSet = {
  strategies: StrategyRecord[];
  memories: MemoryRecord[];
  intel: IntelCandidate[];
  archive?: RetrievalCandidate[];
};

export type DecisionTaskInput = {
  id: string;
  title: string;
  goal?: string;
  route: string;
  taskKind?: string;
  priority: TaskPriority;
  budgetMode: BudgetMode;
  retrievalMode: RetrievalMode;
  worker?: string;
  skillIds: string[];
  tags: string[];
  blockedReason?: string;
  lastError?: string;
  runState?: {
    consecutiveFailures?: number;
    remoteCallCount?: number;
  };
  metadata?: RuntimeMetadata;
};

export type DecisionConfig = {
  maxInputTokensPerTurn: number;
  maxRemoteCallsPerTask: number;
  maxCandidatesPerPlane?: number;
  maxContextChars?: number;
};

export type DecisionBudget = {
  maxInputTokens: number;
  maxRemoteCallsRemaining: number;
};

export type DecisionRecord = {
  builtAt: number;
  thinkingLane: ThinkingLane;
  summary: string;
  recommendedWorker: string;
  recommendedSkills: string[];
  relevantMemoryIds: string[];
  relevantIntelIds: string[];
  fallbackOrder: string[];
  localFirstPlan: string;
  remoteModelPlan: string;
  budgetLimit: DecisionBudget;
  contextPack: ContextPack;
  metadata?: RuntimeMetadata;
};

export type IntelCandidate = {
  id: string;
  domain: "tech" | "ai" | "business" | "github";
  sourceId: string;
  title: string;
  url?: string;
  summary?: string;
  score?: number;
  selected: boolean;
  createdAt: number;
  metadata?: RuntimeMetadata;
};

export type IntelDigestItem = {
  id: string;
  domain: IntelCandidate["domain"];
  title: string;
  conclusion: string;
  whyItMatters: string;
  recommendedAttention: string;
  recommendedAction: string;
  recommendedIgnoreReason?: string;
  sourceIds: string[];
  exploit: boolean;
  createdAt: number;
  metadata?: RuntimeMetadata;
};

export type IntelSourceProfile = {
  id: string;
  domain: IntelCandidate["domain"];
  label: string;
  priority: number;
  trustScore?: number;
  metadata?: RuntimeMetadata;
};

export type IntelTopicProfile = {
  id: string;
  domain: IntelCandidate["domain"];
  topic: string;
  weight: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type IntelUsefulnessRecord = {
  id: string;
  intelId: string;
  sourceId: string;
  domain: IntelCandidate["domain"];
  usefulnessScore: number;
  reason?: string;
  createdAt: number;
  metadata?: RuntimeMetadata;
};

export type ManualPinnedIntelRecord = {
  id: string;
  intelId: string;
  promotedToMemoryId?: string;
  promotedBy: string;
  createdAt: number;
  metadata?: RuntimeMetadata;
};

export type GovernanceRegistryEntry = {
  id: string;
  registryType: GovernanceRegistryType;
  targetId: string;
  state: GovernanceState;
  summary: string;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type ShadowEvaluationRecord = {
  id: string;
  candidateType: EvolutionCandidateType;
  targetLayer: EvolutionMemoryRecord["targetLayer"];
  state: "observed" | "shadow" | "promoted" | "adopted" | "reverted";
  baselineRef?: string;
  candidateRef?: string;
  expectedEffect?: string;
  measuredEffect?: string;
  observationCount: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type InstanceManifest = {
  version: "v1";
  platform: NodeJS.Platform;
  profile?: string;
  instanceRoot: string;
  runtimeRoot: string;
  configRoot: string;
  stateRoot: string;
  dataRoot: string;
  cacheRoot: string;
  logRoot: string;
  workspaceRoot: string;
  agentsRoot: string;
  skillsRoot: string;
  extensionsRoot: string;
  codexRoot: string;
  archiveRoot: string;
  configPath: string;
  oauthDir: string;
  oauthPath: string;
};

export type InstancePathKey =
  | "instanceRoot"
  | "runtimeRoot"
  | "configRoot"
  | "stateRoot"
  | "dataRoot"
  | "cacheRoot"
  | "logRoot"
  | "workspaceRoot"
  | "agentsRoot"
  | "skillsRoot"
  | "extensionsRoot"
  | "codexRoot"
  | "archiveRoot";

export type PathResolver = {
  manifest: InstanceManifest;
  root: (key: InstancePathKey) => string;
  join: (key: InstancePathKey, ...segments: string[]) => string;
};

export type RuntimeManifest = {
  instanceId: string;
  runtimeVersion: string;
  manifestVersion: "v1";
  instanceManifest: InstanceManifest;
  capabilities: string[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type ShareableReviewRecord = {
  id: string;
  taskReview: TaskReview;
  shareScope: "shareable_derived";
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type ShareableMemoryEnvelope = {
  id: string;
  memory: MemoryRecord;
  shareScope: "shareable_derived";
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type IntelDigestEnvelope = {
  id: string;
  digestItems: IntelDigestItem[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type StrategyDigestEnvelope = {
  id: string;
  strategies: StrategyRecord[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type ShadowTelemetryEnvelope = {
  id: string;
  evaluations: ShadowEvaluationRecord[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type CapabilityGovernanceSnapshot = {
  id: string;
  entries: GovernanceRegistryEntry[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeTaskDefaults = {
  defaultBudgetMode: BudgetMode;
  defaultRetrievalMode: RetrievalMode;
  maxInputTokensPerTurn: number;
  maxContextChars: number;
  maxRemoteCallsPerTask: number;
};

export type RuntimeTaskStore = {
  version: "v1";
  defaults: RuntimeTaskDefaults;
  tasks: TaskRecord[];
  runs: TaskRun[];
  steps: TaskStep[];
  reviews: TaskReview[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeMemoryStore = {
  version: "v1";
  memories: MemoryRecord[];
  strategies: StrategyRecord[];
  metaLearning: MetaLearningRecord[];
  evolutionMemory: EvolutionMemoryRecord[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeIntelStore = {
  version: "v1";
  enabled: boolean;
  digestEnabled: boolean;
  candidateLimitPerDomain: number;
  digestItemLimitPerDomain: number;
  exploitItemsPerDigest: number;
  exploreItemsPerDigest: number;
  candidates: IntelCandidate[];
  digestItems: IntelDigestItem[];
  sourceProfiles: IntelSourceProfile[];
  topicProfiles: IntelTopicProfile[];
  usefulnessRecords: IntelUsefulnessRecord[];
  pinnedRecords: ManualPinnedIntelRecord[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeGovernanceStore = {
  version: "v1";
  entries: GovernanceRegistryEntry[];
  shadowEvaluations: ShadowEvaluationRecord[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeEventRecord = {
  id: string;
  type: string;
  createdAt: number;
  payload?: RuntimeMetadata;
};
