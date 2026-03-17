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
export type SurfaceOwnerKind = "user" | "agent";
export type SurfaceReportTarget = "runtime-user" | "surface-owner";
export type SurfaceLocalBusinessPolicyTaskCreation = "disabled" | "recommend_only";
export type SurfaceLocalBusinessPolicyEscalationTarget = "runtime-user" | "surface-owner";
export type SurfaceLocalBusinessPolicyPrivacyBoundary = "user-local" | "agent-local";

export type SurfaceLocalBusinessPolicy = {
  runtimeCoreBinding: "forbidden";
  formalMemoryWrite: false;
  userModelWrite: false;
  surfaceRoleWrite: false;
  taskCreation: SurfaceLocalBusinessPolicyTaskCreation;
  escalationTarget: SurfaceLocalBusinessPolicyEscalationTarget;
  privacyBoundary: SurfaceLocalBusinessPolicyPrivacyBoundary;
  roleScope: string;
};

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
export type RetrievalPlane = "strategy" | "memory" | "session" | "archive";
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
  | "worker_routing"
  | "retrieval_policy";

export const EVOLUTION_OPTIMIZATION_METRICS = [
  "success",
  "completion",
  "token",
  "latency",
  "interruption",
  "regression_risk",
] as const;

export type EvolutionOptimizationMetric = (typeof EVOLUTION_OPTIMIZATION_METRICS)[number];

export type RuntimeMetadata = Record<string, unknown>;

export type SourceLineage = {
  sourceEventIds: string[];
  sourceTaskIds: string[];
  sourceReviewIds: string[];
  sourceSessionIds: string[];
  sourceIntelIds: string[];
  derivedFromMemoryIds: string[];
};

export type VersionedConfidence = {
  confidence: number;
  version: number;
  invalidatedBy: string[];
};

export type LifecycleMetrics = {
  lastReinforcedAt?: number;
  decayScore?: number;
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
  VersionedConfidence &
  LifecycleMetrics & {
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

export type MetaLearningRecord = SourceLineage &
  VersionedConfidence &
  LifecycleMetrics & {
    id: string;
    layer: "meta_learning";
    summary: string;
    hypothesis?: string;
    adoptedAs?: "strategy" | "memory" | "policy" | "shadow";
    createdAt: number;
    updatedAt: number;
    metadata?: RuntimeMetadata;
  };

export type EvolutionMemoryRecord = SourceLineage &
  VersionedConfidence &
  LifecycleMetrics & {
    id: string;
    layer: "evolution_memory";
    candidateType: EvolutionCandidateType;
    targetLayer: "decision" | "task_loop" | "intel" | "retrieval" | "governance";
    summary: string;
    adoptionState: Exclude<GovernanceState, "blocked" | "core">;
    baselineRef?: string;
    candidateRef?: string;
    sourceShadowTelemetryIds: string[];
    createdAt: number;
    updatedAt: number;
    optimizedMetrics?: EvolutionOptimizationMetric[];
    metadata?: RuntimeMetadata;
  };

export type RuntimeEvolutionObservationMetrics = {
  observationCount: number;
  successCount: number;
  completionCount: number;
  waitingUserCount: number;
  blockedCount: number;
  failedCount: number;
  averageCompletionScore: number;
  averageLatencyMs: number;
  averageTokenEstimate: number;
  averageInterruptionCount: number;
  averageRemoteCallCount: number;
  successRate: number;
  regressionRiskScore: number;
  lastObservedAt: number;
};

export type TaskRecord = {
  id: string;
  rootTaskId?: string;
  parentTaskId?: string;
  agentId?: string;
  surfaceId?: string;
  sessionId?: string;
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
  artifactRefs: string[];
  recurring: boolean;
  maintenance: boolean;
  scheduleIntervalMinutes?: number;
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
  agentId?: string;
  surfaceId?: string;
  sessionId?: string;
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
  agentId?: string;
  surfaceId?: string;
  sessionId?: string;
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

export type TaskReportKind =
  | "waiting_user"
  | "completion"
  | "blocked"
  | "waiting_external"
  | "cancelled";

export type TaskReportState = "pending" | "delivered" | "resolved";

export type TaskReportRecord = {
  id: string;
  taskId: string;
  runId: string;
  reviewId?: string;
  taskStatus: TaskStatus;
  kind: TaskReportKind;
  state: TaskReportState;
  reportPolicy: TaskReportPolicy;
  reportVerbosity?: RuntimeUserModel["reportVerbosity"];
  interruptionThreshold?: RuntimeUserModel["interruptionThreshold"];
  confirmationBoundary?: RuntimeUserModel["confirmationBoundary"];
  title: string;
  summary: string;
  nextAction?: string;
  requiresUserAction: boolean;
  reportTarget?: string;
  surfaceId?: string;
  surfaceLabel?: string;
  agentId?: string;
  sessionId?: string;
  escalationTarget?: SurfaceLocalBusinessPolicy["escalationTarget"];
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
  resolvedAt?: number;
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
  sessionCandidates: RetrievalCandidate[];
  archiveCandidates: RetrievalCandidate[];
  synthesis: string[];
  metadata?: RuntimeMetadata;
};

export type RetrievalSourceSet = {
  strategies: StrategyRecord[];
  memories: MemoryRecord[];
  sessions: RetrievalCandidate[];
  archive?: RetrievalCandidate[];
};

export type DecisionTaskInput = {
  id: string;
  title: string;
  goal?: string;
  route: string;
  agentId?: string;
  sessionId?: string;
  surfaceId?: string;
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
  relevantSessionIds: string[];
  fallbackOrder: string[];
  localFirstPlan: string;
  remoteModelPlan: string;
  budgetLimit: DecisionBudget;
  contextPack: ContextPack;
  metadata?: RuntimeMetadata;
};

export type RuntimeUserModel = {
  id: string;
  displayName?: string;
  communicationStyle?: string;
  interruptionThreshold?: "low" | "medium" | "high";
  reportVerbosity?: "brief" | "balanced" | "detailed";
  confirmationBoundary?: "strict" | "balanced" | "light";
  reportPolicy?: TaskReportPolicy;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeUserModelPreferencePatch = Partial<
  Pick<
    RuntimeUserModel,
    | "communicationStyle"
    | "interruptionThreshold"
    | "reportVerbosity"
    | "confirmationBoundary"
    | "reportPolicy"
  >
>;

export type RuntimeSessionWorkingPreference = {
  id: string;
  sessionId: string;
  label?: string;
  communicationStyle?: string;
  interruptionThreshold?: "low" | "medium" | "high";
  reportVerbosity?: "brief" | "balanced" | "detailed";
  confirmationBoundary?: "strict" | "balanced" | "light";
  reportPolicy?: TaskReportPolicy;
  notes?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type AgentRecord = {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  roleBase?: string;
  memoryNamespace: string;
  skillIds: string[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type AgentLocalOverlay = {
  id: string;
  agentId: string;
  communicationStyle?: string;
  reportPolicy?: TaskReportPolicy;
  notes?: string;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type SurfaceRecord = {
  id: string;
  channel: string;
  accountId: string;
  label: string;
  ownerKind: SurfaceOwnerKind;
  ownerId?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type SurfaceRoleOverlay = {
  id: string;
  surfaceId: string;
  role: string;
  businessGoal?: string;
  tone?: string;
  initiative?: "low" | "medium" | "high";
  allowedTopics: string[];
  restrictedTopics: string[];
  reportTarget?: SurfaceReportTarget;
  localBusinessPolicy?: SurfaceLocalBusinessPolicy;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type RoleOptimizationCandidateState =
  | "shadow"
  | "recommended"
  | "adopted"
  | "rejected"
  | "expired"
  | "reverted";

export type RoleOptimizationCandidate = {
  id: string;
  surfaceId: string;
  agentId?: string;
  ownerKind: SurfaceOwnerKind;
  summary: string;
  reasoning: string[];
  proposedOverlay: Partial<SurfaceRoleOverlay>;
  observationCount: number;
  confidence: number;
  state: RoleOptimizationCandidateState;
  source: "local-review" | "federation";
  createdAt: number;
  updatedAt: number;
  shadowedAt?: number;
  recommendedAt?: number;
  adoptedAt?: number;
  rejectedAt?: number;
  expiredAt?: number;
  revertedAt?: number;
  metadata?: RuntimeMetadata;
};

export const USER_MODEL_OPTIMIZATION_FIELDS = [
  "communicationStyle",
  "interruptionThreshold",
  "reportVerbosity",
  "confirmationBoundary",
  "reportPolicy",
] as const;

export type UserModelOptimizationField = (typeof USER_MODEL_OPTIMIZATION_FIELDS)[number];
export type UserModelOptimizationCandidateState = RoleOptimizationCandidateState;

export type UserModelOptimizationCandidate = {
  id: string;
  field: UserModelOptimizationField;
  summary: string;
  reasoning: string[];
  proposedUserModel: RuntimeUserModelPreferencePatch;
  observedSessionIds: string[];
  observationCount: number;
  confidence: number;
  state: UserModelOptimizationCandidateState;
  source: "local-review" | "federation";
  createdAt: number;
  updatedAt: number;
  shadowedAt?: number;
  recommendedAt?: number;
  adoptedAt?: number;
  rejectedAt?: number;
  expiredAt?: number;
  revertedAt?: number;
  metadata?: RuntimeMetadata;
};

export type IntelCandidate = {
  id: string;
  domain: "military" | "tech" | "ai" | "business";
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

export type IntelItemRankRecord = {
  id: string;
  intelId: string;
  sourceId: string;
  domain: IntelCandidate["domain"];
  selectionRank?: number;
  explorationRank?: number;
  selectionScore: number;
  explorationScore: number;
  selected: boolean;
  selectedMode: "exploit" | "explore" | "none";
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

export type IntelDeliveryKind = "daily_digest" | "instant_alert";
export type IntelDeliveryTargetKind = "runtime_user" | "agent" | "surface";

export type IntelDeliveryTarget = {
  id: string;
  kind: IntelDeliveryTargetKind;
  label: string;
  active: boolean;
  channel?: string;
  ownerLabel?: string;
  metadata?: RuntimeMetadata;
};

export type IntelDeliveryRecord = {
  id: string;
  kind: IntelDeliveryKind;
  digestItemId: string;
  targetId: string;
  targetKind: IntelDeliveryTargetKind;
  targetLabel: string;
  domain: IntelCandidate["domain"];
  title: string;
  deliveredAt: number;
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

export type RuntimeMcpGrantState = "allowed" | "denied";

export type RuntimeMcpGrantRecord = {
  id: string;
  agentId: string;
  mcpServerId: string;
  state: RuntimeMcpGrantState;
  summary: string;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type ShadowEvaluationRecord = SourceLineage &
  VersionedConfidence &
  LifecycleMetrics & {
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
    targetMetrics?: EvolutionOptimizationMetric[];
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
  mcpGrants: RuntimeMcpGrantRecord[];
  generatedAt: number;
  metadata?: RuntimeMetadata;
};

export type TeamKnowledgeRecord = {
  id: string;
  namespace: "private" | "team-shareable";
  title: string;
  summary: string;
  tags: string[];
  sourceRuntimeId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeManifestEnvelope = {
  schemaVersion: "v1";
  type: "runtime-manifest";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: RuntimeManifest;
  metadata?: RuntimeMetadata;
};

export type NewsDigestEnvelope = {
  schemaVersion: "v1";
  type: "news-digest";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    digestItems: IntelDigestItem[];
  };
  metadata?: RuntimeMetadata;
};

export type TeamKnowledgeEnvelope = {
  schemaVersion: "v1";
  type: "team-knowledge";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    records: TeamKnowledgeRecord[];
  };
  metadata?: RuntimeMetadata;
};

export type FederationTaskAssignmentState =
  | "pending"
  | "materialized"
  | "blocked"
  | "applied";

export type FederationTaskAssignment = {
  schemaVersion: "v1";
  type: "federation-task-assignment";
  id: string;
  title: string;
  summary: string;
  sourceRuntimeId: string;
  generatedAt: number;
  sourcePackageId?: string;
  sourceTaskId?: string;
  route?: string;
  worker?: string;
  surfaceId?: string;
  agentId?: string;
  state?: FederationTaskAssignmentState;
  localTaskId?: string;
  blockedReason?: string;
  receivedAt?: number;
  updatedAt?: number;
  materializedAt?: number;
  appliedAt?: number;
  metadata?: RuntimeMetadata;
};

export type CoordinatorSuggestionEnvelope = {
  schemaVersion: "v1";
  type: "coordinator-suggestion";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    id: string;
    title: string;
    summary: string;
    taskId?: string;
    metadata?: RuntimeMetadata;
  };
  metadata?: RuntimeMetadata;
};

export type CoordinatorSuggestionRecord = {
  id: string;
  title: string;
  summary: string;
  taskId?: string;
  localTaskId?: string;
  localTaskStatus?: TaskStatus | "missing";
  sourceRuntimeId: string;
  sourcePackageId: string;
  createdAt: number;
  updatedAt: number;
  adoptedAt?: number;
  materializedAt?: number;
  lifecycleSyncedAt?: number;
  lastMaterializedLocalTaskId?: string;
  lastMaterializedAt?: number;
  rematerializeReason?: string;
  metadata?: RuntimeMetadata;
};

export type SharedStrategyPackage = {
  schemaVersion: "v1";
  type: "shared-strategy-package";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    strategies: StrategyRecord[];
  };
  metadata?: RuntimeMetadata;
};

export type TeamKnowledgePackage = {
  schemaVersion: "v1";
  type: "team-knowledge-package";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    records: TeamKnowledgeRecord[];
  };
  metadata?: RuntimeMetadata;
};

export type RoleOptimizationPackage = {
  schemaVersion: "v1";
  type: "role-optimization-package";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    surfaceId?: string;
    agentId?: string;
    summary: string;
    proposedOverlay: Partial<SurfaceRoleOverlay>;
  };
  metadata?: RuntimeMetadata;
};

export type RuntimePolicyOverlayPackage = {
  schemaVersion: "v1";
  type: "runtime-policy-overlay-package";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    route?: string;
    policy: RuntimeMetadata;
  };
  metadata?: RuntimeMetadata;
};

export type FederationPackageState =
  | "received"
  | "validated"
  | "shadowed"
  | "recommended"
  | "adopted"
  | "rejected"
  | "expired"
  | "reverted";

export type FederationInboundPackage =
  | CoordinatorSuggestionEnvelope
  | SharedStrategyPackage
  | TeamKnowledgePackage
  | RoleOptimizationPackage
  | RuntimePolicyOverlayPackage;

export type InvalidFederationPackageEnvelope = {
  schemaVersion: "v1";
  type: "invalid-package";
  sourceRuntimeId: string;
  generatedAt: number;
  payload: {
    declaredType?: string;
    sourceError?: string;
    fileName?: string;
    rawPreview?: string;
  };
  metadata?: RuntimeMetadata;
};

export type FederationInboxPackage =
  | FederationInboundPackage
  | InvalidFederationPackageEnvelope;

export type FederationPackageRiskLevel = "low" | "medium" | "high";

export type FederationPackageReview = {
  riskLevel: FederationPackageRiskLevel;
  autoAdoptEligible: boolean;
  requiresReasonOnAdopt: boolean;
  routeScope: "global" | "route";
  summary: string;
  signals: string[];
};

export type FederationInboxRecord = {
  id: string;
  packageType: FederationInboxPackage["type"];
  sourceRuntimeId: string;
  state: FederationPackageState;
  summary: string;
  sourcePath?: string;
  validationErrors: string[];
  receivedAt: number;
  validatedAt?: number;
  shadowedAt?: number;
  recommendedAt?: number;
  adoptedAt?: number;
  rejectedAt?: number;
  expiredAt?: number;
  revertedAt?: number;
  updatedAt: number;
  payload: FederationInboxPackage;
  review?: FederationPackageReview;
  metadata?: RuntimeMetadata;
};

export type FederationSyncCursor = {
  lastPushedAt?: number;
  lastPulledAt?: number;
  lastOutboxEventId?: string;
  lastInboxEnvelopeId?: string;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type FederationSyncAttemptStage =
  | "prepare"
  | "push"
  | "pull"
  | "persist_inbox"
  | "sync_inbox";

export type FederationSyncAttemptRecord = {
  id: string;
  status: "success" | "failed";
  stage: FederationSyncAttemptStage;
  startedAt: number;
  completedAt: number;
  pushUrl?: string;
  pullUrl?: string;
  pushedEnvelopeKeys: string[];
  pulledPackageCount: number;
  inboxProcessedCount: number;
  retryable: boolean;
  error?: string;
  metadata?: RuntimeMetadata;
};

export type RuntimeFederationStore = {
  version: "v1";
  inbox: FederationInboxRecord[];
  coordinatorSuggestions: CoordinatorSuggestionRecord[];
  sharedStrategies: StrategyRecord[];
  teamKnowledge: TeamKnowledgeRecord[];
  syncCursor?: FederationSyncCursor;
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeTaskDefaults = {
  defaultBudgetMode: BudgetMode;
  defaultRetrievalMode: RetrievalMode;
  maxInputTokensPerTurn: number;
  maxContextChars: number;
  maxRemoteCallsPerTask: number;
  leaseDurationMs: number;
  maxConcurrentRunsPerWorker: number;
  maxConcurrentRunsPerRoute: number;
};

export type RuntimeTaskStore = {
  version: "v1";
  defaults: RuntimeTaskDefaults;
  tasks: TaskRecord[];
  runs: TaskRun[];
  steps: TaskStep[];
  reviews: TaskReview[];
  reports: TaskReportRecord[];
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
  rankRecords: IntelItemRankRecord[];
  pinnedRecords: ManualPinnedIntelRecord[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeGovernanceStore = {
  version: "v1";
  entries: GovernanceRegistryEntry[];
  mcpGrants: RuntimeMcpGrantRecord[];
  shadowEvaluations: ShadowEvaluationRecord[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeUserConsoleStore = {
  version: "v1";
  userModel: RuntimeUserModel;
  sessionWorkingPreferences: RuntimeSessionWorkingPreference[];
  agents: AgentRecord[];
  agentOverlays: AgentLocalOverlay[];
  surfaces: SurfaceRecord[];
  surfaceRoleOverlays: SurfaceRoleOverlay[];
  roleOptimizationCandidates: RoleOptimizationCandidate[];
  userModelOptimizationCandidates: UserModelOptimizationCandidate[];
  lastImportedAt?: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeEventRecord = {
  id: string;
  type: string;
  createdAt: number;
  payload?: RuntimeMetadata;
};
