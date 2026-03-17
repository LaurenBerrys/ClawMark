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
  resolveRuntimeCapabilityPolicy,
  syncRuntimeCapabilityRegistry,
  type RuntimeCapabilityExecutionMode,
} from "./capability-plane.js";
import {
  type IntelDeliveryRecord,
  type IntelDeliveryTarget,
  type FederationInboxRecord,
  type FederationPackageRiskLevel,
  type FederationPackageState,
  type FederationSyncAttemptRecord,
  type FederationSyncCursor,
  FORMAL_MEMORY_TYPES,
  MEMORY_LAYERS,
  type CapabilityGovernanceSnapshot,
  type RuntimeUserModel,
  type RuntimeUserConsoleStore,
  type FormalMemoryType,
  type GovernanceRegistryType,
  type GovernanceState,
  type GovernanceRegistryEntry,
  type InstanceManifest,
  type IntelCandidate,
  type NewsDigestEnvelope,
  type RuntimeMcpGrantState,
  type RuntimeGovernanceStore,
  type RuntimeIntelStore,
  type RuntimeMemoryStore,
  type RuntimeManifest,
  type RuntimeMetadata,
  type RuntimeEvolutionObservationMetrics,
  type ShareableMemoryEnvelope,
  type ShareableReviewRecord,
  type ShadowEvaluationRecord,
  type ShadowTelemetryEnvelope,
  type SurfaceLocalBusinessPolicy,
  type SurfaceRecord,
  type TeamKnowledgeEnvelope,
  type TeamKnowledgeRecord,
  type RuntimeTaskStore,
  type StrategyDigestEnvelope,
  type StrategyRecord,
  type TaskRecord,
  type TaskReportRecord,
  type TaskStatus,
  type EvolutionOptimizationMetric,
} from "./contracts.js";
import {
  buildRuntimeEvolutionAutoApplyStatus,
  buildRuntimeEvolutionRiskReview,
  readRuntimeEvolutionObservationMetrics,
  readRuntimeEvolutionVerificationMetrics,
  buildRuntimeEvolutionVerificationReview,
} from "./evolution-risk.js";
import {
  readFederationInboxMaintenanceControls,
  resolveFederationPackageMaintenanceStatus,
  summarizeFederationInboxMaintenance,
} from "./federation-maintenance.js";
import {
  readFederationRemoteSyncMaintenanceControls,
  summarizeFederationRemoteSyncMaintenance,
} from "./federation-remote-maintenance.js";
import {
  listRuntimeFederationAssignments,
  type FederationAssignmentAction,
} from "./federation-assignments.js";
import {
  buildFederationPushScopeSuppressions,
  resolveFederationPushPolicy,
  type FederationPushScopeSuppression,
} from "./federation-policy.js";
import {
  listRuntimeIntelDeliveryHistory,
  previewRuntimeIntelDeliveries,
  resolveRuntimeIntelDeliveryTargets,
  type RuntimeIntelDeliveryItem,
} from "./intel-delivery.js";
import {
  DEFAULT_RUNTIME_INFO_DOMAINS,
  labelRuntimeInfoDomain,
  normalizeRuntimeInfoDomain,
} from "./intel-domains.js";
import { resolveRuntimeMemoryLifecycleControls } from "./memory-lifecycle.js";
import {
  buildRuntimeIntelRefreshAudit,
  listRuntimeIntelDomainDefinitions,
  listRuntimeIntelPanelSources,
  resolveRuntimeIntelPanelConfig,
  type RuntimeIntelRefreshOutcome,
} from "./intel-refresh.js";
import { buildRuntimeMemoryMarkdownMirrorStatus } from "./memory-markdown-mirror.js";
import {
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  loadRuntimeUserConsoleStore,
  readRuntimeEvents,
  saveRuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import { buildShareableReviewEnvelope, buildTaskRecordSnapshot } from "./task-artifacts.js";
import {
  buildActiveTaskConcurrencySnapshot,
  buildTaskStatusCounts,
  compareTaskQueueOrder,
  isRunnableTaskStatus,
  normalizeTaskStatus,
  resolveTaskSchedulerPolicy,
  type TaskQueueInput,
  type TaskStatusCounts,
} from "./task-loop.js";
import { listRuntimeResolvedSurfaceProfiles } from "./user-console.js";
import { buildRuntimeUserModelMirrorStatus } from "./user-model-mirror.js";

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
  artifactRefs?: string[];
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
  sourceReviewIds?: string[];
  sourceMemoryIds?: string[];
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
  rootTaskId: string;
  parentTaskId?: string;
  title: string;
  route: string;
  agentId?: string;
  agentLabel?: string;
  surfaceId?: string;
  surfaceLabel?: string;
  sessionId?: string;
  sessionLabel?: string;
  status: TaskStatus;
  priority: TaskRecord["priority"];
  budgetMode: TaskRecord["budgetMode"];
  retrievalMode: TaskRecord["retrievalMode"];
  recurring: boolean;
  maintenance: boolean;
  scheduleIntervalMinutes?: number;
  tags: string[];
  nextAction?: string;
  blockedReason?: string;
  lastError?: string;
  thinkingLane?: string;
  lastDecisionAt?: number;
  recommendedWorker?: string;
  recommendedSkills: string[];
  lastRetryStrategyId?: string;
  lastRetryDelayMinutes?: number;
  lastRetryBlockedThreshold?: number;
  reportPolicy?: string;
  reportVerbosity?: string;
  interruptionThreshold?: string;
  confirmationBoundary?: string;
  retrievalQueryId?: string;
  contextSummary?: string;
  contextSynthesis: string[];
  strategyCandidateIds: string[];
  archiveCandidateIds: string[];
  relevantMemoryIds: string[];
  relevantSessionIds: string[];
  fallbackOrder: string[];
  remoteCallCount?: number;
  userResponseCount?: number;
  lastUserResponseAt?: number;
  lastUserResponseSummary?: string;
  needsReplan?: boolean;
  replanCount?: number;
  lastReplannedAt?: number;
  invalidatedBy: string[];
  invalidatedMemoryIds: string[];
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
};

export type RuntimeTaskReviewSummary = {
  id: string;
  taskId: string;
  runId: string;
  taskTitle: string;
  outcome: RuntimeTaskStore["reviews"][number]["outcome"];
  summary: string;
  extractedMemoryIds: string[];
  strategyCandidateIds: string[];
  metaLearningIds: string[];
  shareable: boolean;
  createdAt: number;
};

export type RuntimeTasksListResult = {
  generatedAt: number;
  total: number;
  reviewCount: number;
  statusCounts: TaskStatusCounts;
  runnableCount: number;
  activeTaskCount: number;
  replanPendingCount: number;
  leaseDurationMs: number;
  maxConcurrentRunsPerWorker: number;
  maxConcurrentRunsPerRoute: number;
  activeWorkerSlots: Record<string, number>;
  activeRouteSlots: Record<string, number>;
  tasks: RuntimeTaskSummary[];
  recentReviews: RuntimeTaskReviewSummary[];
};

export type RuntimeMemorySummary = {
  id: string;
  memoryType: FormalMemoryType;
  route?: string;
  scope?: string;
  summary: string;
  tags: string[];
  confidence: number;
  invalidated: boolean;
  invalidatedBy: string[];
  sourceEventIds: string[];
  sourceTaskIds: string[];
  sourceIntelIds: string[];
  derivedFromMemoryIds: string[];
  downstreamMemoryIds: string[];
  linkedStrategyIds: string[];
  shareable: boolean;
  teamShareable: boolean;
  activeInvalidationEventId?: string;
  lastReinforcedAt?: number;
  decayScore?: number;
  updatedAt: number;
};

export type RuntimeMemoryLifecycleEventStatus = {
  id: string;
  type: "reviewed" | "reinforced" | "invalidated" | "rolled_back";
  createdAt: number;
  memoryIds: string[];
  strategyIds: string[];
  metaLearningIds: string[];
  evolutionIds: string[];
  label: string;
  reason?: string;
  invalidationEventId?: string;
  rollbackAvailable: boolean;
};

export type RuntimeMemoryListResult = {
  generatedAt: number;
  total: number;
  strategyCount: number;
  learningCount: number;
  staleLearningCount: number;
  evolutionCount: number;
  staleEvolutionCount: number;
  invalidatedCount: number;
  highDecayCount: number;
  reinforcedRecentlyCount: number;
  lifecycleReviewEnabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lifecyclePolicy: {
    decayGraceDays: number;
    minDecayIncreasePerReview: number;
    agePressurePerDay: number;
    confidencePenaltyDivisor: number;
    linkedStrategyConfidencePenalty: number;
    highDecayThreshold: number;
  };
  markdownMirror: {
    rootPath: string;
    exists: boolean;
    fileCount: number;
    lastSyncedAt?: number;
    memoryCount: number;
    strategyCount: number;
    learningCount: number;
    evolutionCount: number;
  };
  memoryTypeCounts: Record<FormalMemoryType, number>;
  memories: RuntimeMemorySummary[];
  strategies: StrategyRecord[];
  recentLifecycleEvents: RuntimeMemoryLifecycleEventStatus[];
};

export type RuntimeRetrievalStatus = {
  generatedAt: number;
  planes: Array<"strategy" | "memory" | "session" | "archive">;
  layers: typeof MEMORY_LAYERS;
  system1DefaultPlanes: Array<"strategy" | "memory" | "session">;
  system2DefaultPlanes: Array<"strategy" | "memory" | "session" | "archive">;
  defaultBudgetMode: string;
  defaultRetrievalMode: string;
  maxInputTokensPerTurn: number;
  maxContextChars: number;
  maxRemoteCallsPerTask: number;
  leaseDurationMs: number;
  maxConcurrentRunsPerWorker: number;
  maxConcurrentRunsPerRoute: number;
};

export type RuntimeUserConsoleStatus = {
  generatedAt: number;
  model: RuntimeUserModel;
  mirror: {
    path: string;
    exists: boolean;
    pendingImport: boolean;
    syncNeeded: boolean;
    lastModifiedAt?: number;
    lastSyncedAt?: number;
    lastImportedAt?: number;
  };
  maintenanceEnabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lastSessionCleanupAt?: number;
  workingSessionCount: number;
  expiredSessionCount: number;
  expiringSessionCount: number;
  activeAgentCount: number;
  activeSurfaceCount: number;
  userOwnedSurfaceCount: number;
  recommendedUserModelOptimizationCount: number;
  shadowUserModelOptimizationCount: number;
  recommendedRoleOptimizationCount: number;
  shadowRoleOptimizationCount: number;
  waitingUserTaskCount: number;
  recommendedFederationPackageCount: number;
  adoptedCoordinatorSuggestionCount: number;
  pendingActionCount: number;
  actionQueue: RuntimeUserConsoleActionItem[];
};

export type RuntimeNotifyReportSummary = {
  id: string;
  taskId: string;
  runId: string;
  reviewId?: string;
  taskStatus: TaskReportRecord["taskStatus"];
  kind: TaskReportRecord["kind"];
  state: TaskReportRecord["state"];
  reportPolicy: TaskReportRecord["reportPolicy"];
  reportVerbosity?: TaskReportRecord["reportVerbosity"];
  interruptionThreshold?: TaskReportRecord["interruptionThreshold"];
  confirmationBoundary?: TaskReportRecord["confirmationBoundary"];
  title: string;
  summary: string;
  nextAction?: string;
  requiresUserAction: boolean;
  reportTarget?: TaskReportRecord["reportTarget"];
  surfaceId?: TaskReportRecord["surfaceId"];
  surfaceLabel?: TaskReportRecord["surfaceLabel"];
  agentId?: TaskReportRecord["agentId"];
  sessionId?: TaskReportRecord["sessionId"];
  escalationTarget?: TaskReportRecord["escalationTarget"];
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
  resolvedAt?: number;
};

export type RuntimeNotifyStatus = {
  generatedAt: number;
  total: number;
  pendingCount: number;
  deliveredCount: number;
  resolvedCount: number;
  waitingUserPendingCount: number;
  proactiveReportCount: number;
  recentReports: RuntimeNotifyReportSummary[];
};

export type RuntimeUserConsoleActionItem = {
  id: string;
  kind:
    | "waiting_user_task"
    | "evolution_revert_recommendation"
    | "user_model_mirror_import"
    | "user_model_optimization"
    | "role_optimization"
    | "federation_package"
    | "coordinator_suggestion";
  priority: "high" | "medium" | "low";
  title: string;
  summary: string;
  updatedAt: number;
  taskId?: string;
  localTaskId?: string;
  localTaskStatus?: TaskStatus | "missing";
  lastLocalTaskId?: string;
  rematerializeReason?: string;
  sourceTaskId?: string;
  candidateId?: string;
  coordinatorSuggestionId?: string;
  packageId?: string;
  packageType?: FederationInboxRecord["packageType"];
  packageState?: FederationPackageState;
  surfaceId?: string;
  surfaceLabel?: string;
  reportTarget?: string;
  taskCreationPolicy?: SurfaceLocalBusinessPolicy["taskCreation"];
  escalationTarget?: SurfaceLocalBusinessPolicy["escalationTarget"];
  actionBlockedReason?: string;
  mirrorPath?: string;
  verificationStatus?: RuntimeEvolutionCandidateStatus["verificationStatus"];
  verificationObservationCount?: number;
  lastVerifiedAt?: number;
};

export type RuntimeAgentStatus = {
  id: string;
  name: string;
  roleBase?: string;
  active: boolean;
  skillCount: number;
  surfaceCount: number;
  openTaskCount: number;
  waitingUserTaskCount: number;
  recentReportCount: number;
  recentCompletionReportCount: number;
  followUpPressureCount: number;
  blockedReportCount: number;
  waitingExternalReportCount: number;
  recentIntelDeliveryCount: number;
  pendingRoleOptimizationCount: number;
  pendingCoordinatorSuggestionCount: number;
  materializedCoordinatorSuggestionCount: number;
  reportPolicy?: string;
  latestActivityAt?: number;
  recentActivity: RuntimeEcologyActivityStatus[];
  updatedAt: number;
};

export type RuntimeSurfaceStatus = {
  id: string;
  label: string;
  channel: string;
  accountId: string;
  ownerKind: SurfaceRecord["ownerKind"];
  ownerId?: string;
  ownerLabel: string;
  active: boolean;
  role?: string;
  businessGoal?: string;
  tone?: string;
  initiative?: string;
  reportTarget?: string;
  allowedTopics: string[];
  restrictedTopics: string[];
  localBusinessPolicy?: SurfaceLocalBusinessPolicy;
  localBusinessPolicySource: "overlay" | "derived";
  overlayPresent: boolean;
  roleSource: "overlay" | "agent" | "channel" | "default";
  toneSource: "overlay" | "agent" | "user" | "derived";
  openTaskCount: number;
  waitingUserTaskCount: number;
  recentReportCount: number;
  recentCompletionReportCount: number;
  followUpPressureCount: number;
  blockedReportCount: number;
  waitingExternalReportCount: number;
  recentIntelDeliveryCount: number;
  pendingRoleOptimizationCount: number;
  pendingCoordinatorSuggestionCount: number;
  materializedCoordinatorSuggestionCount: number;
  latestActivityAt?: number;
  recentActivity: RuntimeEcologyActivityStatus[];
  updatedAt: number;
};

export type RuntimeEcologyActivityStatus = {
  id: string;
  kind:
    | "task"
    | "task_report"
    | "intel_delivery"
    | "role_optimization"
    | "coordinator_suggestion"
    | "surface_policy";
  title: string;
  summary: string;
  updatedAt: number;
  status?: string;
  taskId?: string;
  route?: string;
  worker?: string;
  domain?: IntelCandidate["domain"];
  sourceRuntimeId?: string;
};

export type RuntimeIntelDomainStatus = {
  id: string;
  label: string;
  enabled: boolean;
  refreshStatus: "healthy" | "stale" | "error" | "paused";
  sourceCount: number;
  enabledSourceCount: number;
  candidateCount: number;
  selectedCount: number;
  digestCount: number;
  latestDeliveryAt: number | null;
  latestFetchAt: number | null;
  lastRefreshAt: number | null;
  lastSuccessfulRefreshAt: number | null;
  nextRefreshAt: number | null;
  stale: boolean;
  lastError?: string;
};

export type RuntimeIntelSourceStatus = {
  id: string;
  domain: string;
  kind: string;
  label: string;
  priority: number;
  enabled: boolean;
  refreshStatus: "healthy" | "stale" | "error" | "paused";
  custom: boolean;
  url?: string;
  lastRefreshAt: number | null;
  lastSuccessfulRefreshAt: number | null;
  latestFetchAt: number | null;
  nextRefreshAt: number | null;
  stale: boolean;
  lastError?: string;
};

export type RuntimeIntelSourceProfileStatus = {
  id: string;
  domain: IntelCandidate["domain"];
  label: string;
  priority: number;
  trustScore: number;
  usefulnessScore: number | null;
  usefulnessCount: number;
  recentDigestAppearances: number;
  latestFetchAt: number | null;
  sourceType?: string;
};

export type RuntimeIntelTopicProfileStatus = {
  id: string;
  domain: IntelCandidate["domain"];
  topic: string;
  weight: number;
  updatedAt: number;
  recentDigestMentions: number;
  sourceId?: string;
};

export type RuntimeIntelUsefulnessStatus = {
  id: string;
  intelId: string;
  sourceId: string;
  domain: IntelCandidate["domain"];
  usefulnessScore: number;
  reason?: string;
  createdAt: number;
  title?: string;
  promotedToMemoryId?: string;
};

export type RuntimeIntelDigestHistoryStatus = {
  id: string;
  domain: IntelCandidate["domain"];
  title: string;
  exploit: boolean;
  createdAt: number;
  sourceIds: string[];
  whyItMatters: string;
  recommendedAttention: string;
  recommendedAction: string;
  url?: string;
  candidateId?: string;
};

export type RuntimeIntelRankHistoryStatus = {
  id: string;
  intelId: string;
  sourceId: string;
  domain: IntelCandidate["domain"];
  title: string;
  selectionRank?: number;
  explorationRank?: number;
  selectionScore: number;
  explorationScore: number;
  selected: boolean;
  selectedMode: "exploit" | "explore" | "none";
  createdAt: number;
  topicFingerprint?: string;
};

export type RuntimeIntelRecentItemStatus = {
  id: string;
  kind: "candidate" | "digest";
  domain: IntelCandidate["domain"];
  title: string;
  summary: string;
  score: number;
  exploit: boolean;
  createdAt: number;
  sourceLabel: string;
  selected: boolean;
  pinned: boolean;
  url?: string;
};

export type RuntimeIntelPendingDeliveryStatus = {
  id: string;
  kind: RuntimeIntelDeliveryItem["kind"];
  digestItemId: string;
  domain: RuntimeIntelDeliveryItem["domain"];
  title: string;
  summary: string;
  score: number;
  exploit: boolean;
  createdAt: number;
  targetCount: number;
  targetLabels: string[];
  url?: string;
};

export type RuntimeIntelDeliveryTargetStatus = {
  id: IntelDeliveryTarget["id"];
  kind: IntelDeliveryTarget["kind"];
  label: string;
  active: boolean;
  channel?: string;
  ownerLabel?: string;
};

export type RuntimeIntelRecentDeliveryStatus = {
  id: IntelDeliveryRecord["id"];
  kind: IntelDeliveryRecord["kind"];
  digestItemId: string;
  targetId: string;
  targetKind: IntelDeliveryRecord["targetKind"];
  targetLabel: string;
  domain: IntelDeliveryRecord["domain"];
  title: string;
  deliveredAt: number;
  channel?: string;
};

export type RuntimeIntelStatus = {
  generatedAt: number;
  enabled: boolean;
  digestEnabled: boolean;
  refreshMinutes: number;
  lastRefreshAt: number | null;
  lastSuccessfulRefreshAt: number | null;
  lastRefreshOutcome: RuntimeIntelRefreshOutcome;
  nextRefreshAt: number | null;
  staleDomainCount: number;
  errorDomainCount: number;
  modulePausedReason?: string;
  enabledDomainIds: IntelCandidate["domain"][];
  dailyPushEnabled: boolean;
  dailyPushItemCount: number;
  dailyPushHourLocal: number;
  dailyPushMinuteLocal: number;
  instantPushEnabled: boolean;
  instantPushMinScore: number;
  dailyPushTargets: RuntimeIntelDeliveryTargetStatus[];
  instantPushTargets: RuntimeIntelDeliveryTargetStatus[];
  availableTargets: RuntimeIntelDeliveryTargetStatus[];
  staleDailyTargetIds: string[];
  staleInstantTargetIds: string[];
  nextDailyPushAt: number | null;
  lastDailyPushAt: number | null;
  lastInstantPushAt: number | null;
  pendingDailyDigestCount: number;
  pendingInstantAlertCount: number;
  candidateLimitPerDomain: number;
  digestItemLimitPerDomain: number;
  exploitItemsPerDigest: number;
  exploreItemsPerDigest: number;
  itemCount: number;
  digestCount: number;
  customSourceCount: number;
  domains: RuntimeIntelDomainStatus[];
  sources: RuntimeIntelSourceStatus[];
  sourceProfiles: RuntimeIntelSourceProfileStatus[];
  topicProfiles: RuntimeIntelTopicProfileStatus[];
  usefulnessHistory: RuntimeIntelUsefulnessStatus[];
  digestHistory: RuntimeIntelDigestHistoryStatus[];
  rankHistory: RuntimeIntelRankHistoryStatus[];
  recentItems: RuntimeIntelRecentItemStatus[];
  pendingDeliveries: RuntimeIntelPendingDeliveryStatus[];
  recentDeliveries: RuntimeIntelRecentDeliveryStatus[];
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
  mcpGrantCount: number;
  mcpAllowedGrantCount: number;
  mcpDeniedGrantCount: number;
  overlayCount: number;
  governanceStateCounts: Record<GovernanceState, number>;
  entries: RuntimeCapabilityEntryStatus[];
  mcpGrants: RuntimeMcpGrantStatus[];
  recentActivity: RuntimeCapabilityActivityStatus[];
};

export type RuntimeCapabilityEntryStatus = GovernanceRegistryEntry & {
  executionMode: RuntimeCapabilityExecutionMode;
  liveEligible: boolean;
  executionPreferenceRank: number;
  executionPreferenceLabel: string;
  executionSummary: string;
};

export type RuntimeMcpGrantStatus = {
  id: string;
  agentId: string;
  agentLabel: string;
  mcpServerId: string;
  state: "allowed" | "denied";
  summary: string;
  updatedAt: number;
  metadata?: RuntimeMetadata;
};

export type RuntimeCapabilityActivityStatus = {
  id: string;
  kind: "registry_entry" | "mcp_grant" | "registry_sync" | "federation_overlay";
  title: string;
  summary: string;
  updatedAt: number;
  state?: string;
  registryType?: GovernanceRegistryType;
  targetId?: string;
  agentId?: string;
  mcpServerId?: string;
  sourceRuntimeId?: string;
};

export type RuntimeEvolutionStatus = {
  generatedAt: number;
  enabled: boolean;
  autoApplyLowRisk: boolean;
  reviewIntervalHours: number;
  candidateCount: number;
  stateCounts: Record<string, number>;
  lastReviewAt?: number;
  candidates: RuntimeEvolutionCandidateStatus[];
};

export type RuntimeEvolutionCandidateStatus = {
  id: string;
  candidateType: RuntimeMemoryStore["evolutionMemory"][number]["candidateType"];
  targetLayer: RuntimeMemoryStore["evolutionMemory"][number]["targetLayer"];
  state: "shadow" | "candidate" | "adopted" | "reverted";
  riskLevel: "low" | "medium" | "high";
  autoApplyEligible: boolean;
  requiresReasonOnAdopt: boolean;
  riskSummary: string;
  riskSignals: string[];
  summary: string;
  route?: string;
  worker?: string;
  lane?: "system1" | "system2";
  skillIds: string[];
  policyHints: string[];
  baselineRef?: string;
  candidateRef?: string;
  observationCount: number;
  successRate: number;
  averageCompletionScore: number;
  averageLatencyMs: number;
  averageTokenEstimate: number;
  averageInterruptionCount: number;
  averageRemoteCallCount: number;
  regressionRiskScore: number;
  autoPromoteReady: boolean;
  autoAdoptReady: boolean;
  autoApplyBlockers: string[];
  autoApplySummary: string;
  verificationStatus?: "pending" | "healthy" | "watch" | "revert_recommended";
  verificationSummary?: string;
  verificationSignals: string[];
  verificationObservationCount: number;
  lastVerifiedAt?: number;
  materializedStrategyId?: string;
  strategyInvalidated: boolean;
  updatedAt: number;
  optimizedMetrics?: EvolutionOptimizationMetric[];
  targetMetrics?: EvolutionOptimizationMetric[];
  sourceTaskIds: string[];
  metadata?: RuntimeMetadata;
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
  remoteMaintenance: {
    enabled: boolean;
    syncIntervalMinutes: number;
    retryAfterFailureMinutes: number;
    configuredAt?: number;
    due: boolean;
    nextSyncAt?: number;
    lastSuccessfulSyncAt?: number;
    lastFailedSyncAt?: number;
    lastAttemptAt?: number;
    lastAttemptStatus?: "success" | "failed";
    blockedReason?: string;
    lastError?: string;
  };
  manifest: RuntimeManifest;
  outboxRoot: string;
  journalRoot: string;
  inboxRoot: string;
  assignmentsRoot: string;
  syncCursorPath: string;
  syncCursor: FederationSyncCursor | null;
  localOutboxHeadEventId: string | null;
  acknowledgedOutboxEventId: string | null;
  pendingOutboxEventCount: number;
  outboxJournalEventCount: number;
  latestSyncAttempts: FederationSyncAttemptRecord[];
  pendingAssignments: number;
  assignmentInbox: FederationAssignmentInboxStatus;
  outboxEnvelopeCounts: {
    runtimeManifest: number;
    shareableReview: number;
    shareableMemory: number;
    strategyDigest: number;
    newsDigest: number;
    shadowTelemetry: number;
    capabilityGovernance: number;
    teamKnowledge: number;
  };
  outboxPreview: {
    runtimeManifest: {
      instanceId: string;
      runtimeVersion: string;
      generatedAt: number;
      capabilityCount: number;
      workspaceRoot: string;
    };
    latestStrategyDigest: {
      id: string;
      generatedAt: number;
      strategyCount: number;
      routeCount: number;
      strategies: Array<{
        id: string;
        route: string;
        worker: string;
        summary: string;
        updatedAt: number;
      }>;
    };
    latestNewsDigest: {
      sourceRuntimeId: string;
      generatedAt: number;
      itemCount: number;
      domains: string[];
      items: Array<{
        id: string;
        domain: string;
        title: string;
        exploit: boolean;
        createdAt: number;
      }>;
    };
    latestShareableReviews: Array<{
      id: string;
      taskId: string;
      summary: string;
      outcome: string;
      generatedAt: number;
    }>;
    latestShareableMemories: Array<{
      id: string;
      memoryType: FormalMemoryType;
      summary: string;
      route?: string;
      generatedAt: number;
    }>;
    latestTeamKnowledge: Array<{
      id: string;
      title: string;
      summary: string;
      tags: string[];
      updatedAt: number;
    }>;
    latestShadowTelemetry: {
      id: string;
      generatedAt: number;
      evaluationCount: number;
      stateCounts: Record<ShadowEvaluationRecord["state"], number>;
      candidateTypeCounts: Array<{
        candidateType: string;
        count: number;
      }>;
      evaluations: Array<{
        id: string;
        candidateType: string;
        state: ShadowEvaluationRecord["state"];
        targetLayer: ShadowEvaluationRecord["targetLayer"];
        observationCount: number;
        updatedAt: number;
      }>;
    } | null;
    latestCapabilityGovernance: {
      id: string;
      generatedAt: number;
      entryCount: number;
      mcpGrantCount: number;
      preset?: string;
      sandboxMode?: string;
      agentCount?: number;
      extensionCount?: number;
      entryPreview: Array<{
        id: string;
        registryType: GovernanceRegistryType;
        targetId: string;
        state: GovernanceState;
        updatedAt: number;
      }>;
      mcpGrantPreview: Array<{
        id: string;
        agentId: string;
        mcpServerId: string;
        state: RuntimeMcpGrantState;
        updatedAt: number;
      }>;
    } | null;
    latestJournalEvents: Array<{
      id: string;
      envelopeType: string;
      operation: "upsert" | "delete";
      envelopeId?: string;
      sourceRuntimeId?: string;
      generatedAt: number;
      deliveryState: "pending" | "acknowledged";
      summary: string;
    }>;
  };
  inbox: FederationInboxStatus;
  shareablePushScopeCatalog: string[];
  requiredBlockedPushScopes: string[];
  allowedPushScopes: string[];
  blockedPushScopes: string[];
  suppressedPushScopes: FederationPushScopeSuppression[];
  pushPolicyConfiguredAt?: number;
};

export type FederationAssignmentPreviewState =
  | "pending"
  | "materialized"
  | "blocked"
  | "applied"
  | "invalid";

export type FederationAssignmentInboxStatus = {
  total: number;
  stateCounts: Record<FederationAssignmentPreviewState, number>;
  latestAssignments: Array<{
    id: string;
    title: string;
    summary: string;
    sourceRuntimeId: string;
    sourcePackageId?: string;
    sourceTaskId?: string;
    localTaskId?: string;
    route?: string;
    worker?: string;
    surfaceId?: string;
    agentId?: string;
    fileName: string;
    state: FederationAssignmentPreviewState;
    rawState?: string;
    blockedReason?: string;
    receivedAt?: number;
    updatedAt: number;
    materializedAt?: number;
    availableActions: FederationAssignmentAction[];
  }>;
};

export type FederationInboxStatus = {
  total: number;
  stateCounts: Record<FederationPackageState, number>;
  packageTypeCounts: Record<string, number>;
  maintenance: {
    enabled: boolean;
    reviewIntervalHours: number;
    lastReviewAt?: number;
    lastExpiredAt?: number;
    lastExpiredCount?: number;
    pendingReviewCount: number;
    stalePackageCount: number;
    nextExpiryAt?: number;
    expireAfterHours: {
      received: number;
      validated: number;
      shadowed: number;
      recommended: number;
    };
  };
  coordinatorSuggestionCount: number;
  sharedStrategyCount: number;
  teamKnowledgeCount: number;
  latestCoordinatorSuggestions: Array<{
    id: string;
    title: string;
    summary: string;
    taskId?: string;
    localTaskId?: string;
    localTaskStatus?: TaskStatus | "missing";
    sourceRuntimeId: string;
    updatedAt: number;
    materializedAt?: number;
    lifecycleSyncedAt?: number;
    lastMaterializedLocalTaskId?: string;
    lastMaterializedAt?: number;
    rematerializeReason?: string;
  }>;
  latestSharedStrategies: Array<{
    id: string;
    summary: string;
    route: string;
    worker: string;
    thinkingLane: StrategyRecord["thinkingLane"];
    skillIds: string[];
    confidence: number;
    sourceRuntimeId: string;
    sourcePackageId?: string;
    updatedAt: number;
    adoptedAt?: number;
    invalidated: boolean;
  }>;
  latestTeamKnowledge: Array<{
    id: string;
    namespace: TeamKnowledgeRecord["namespace"];
    title: string;
    summary: string;
    tags: string[];
    sourceKind?: string;
    sourceRuntimeId: string;
    sourcePackageId?: string;
    updatedAt: number;
    adoptedAt?: number;
  }>;
  latestPackages: Array<{
    id: string;
    packageType: FederationInboxRecord["packageType"];
    state: FederationPackageState;
    summary: string;
    sourceRuntimeId: string;
    updatedAt: number;
    actionable: boolean;
    stale: boolean;
    expiresAt?: number;
    validationErrorCount: number;
    validationErrors: string[];
    riskLevel?: FederationPackageRiskLevel;
    autoAdoptEligible?: boolean;
    requiresReasonOnAdopt?: boolean;
    reviewSummary?: string;
    reviewSignals: string[];
    payloadPreview: string[];
    localLandingLabel?: string;
    localLandingSummary?: string;
  }>;
};

export type RuntimeDashboardSnapshot = {
  generatedAt: number;
  runtimeVersion: string;
  preset: CapabilityPolicyPreset;
  instanceManifest: InstanceManifest;
  runtimeManifest: RuntimeManifest;
  tasks: RuntimeTasksListResult;
  notify: RuntimeNotifyStatus;
  memory: RuntimeMemoryListResult;
  retrieval: RuntimeRetrievalStatus;
  userConsole: RuntimeUserConsoleStatus;
  agents: RuntimeAgentStatus[];
  surfaces: RuntimeSurfaceStatus[];
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

const RUNTIME_INTEL_DOMAIN_ORDER = DEFAULT_RUNTIME_INFO_DOMAINS;
const USER_CONSOLE_ACTION_QUEUE_LIMIT = 12;
const SHAREABLE_MEMORY_TYPES = new Set<FormalMemoryType>([
  "knowledge",
  "execution",
  "avoidance",
  "efficiency",
  "completion",
  "resource",
]);
const TEAM_KNOWLEDGE_MEMORY_TYPES = new Set<FormalMemoryType>([
  "knowledge",
  "avoidance",
  "efficiency",
  "completion",
  "resource",
]);

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
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
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

function compareUserConsoleActionPriority(
  left: RuntimeUserConsoleActionItem["priority"],
  right: RuntimeUserConsoleActionItem["priority"],
): number {
  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2,
  } satisfies Record<RuntimeUserConsoleActionItem["priority"], number>;
  return priorityRank[left] - priorityRank[right];
}

function compareUserConsoleActions(
  left: RuntimeUserConsoleActionItem,
  right: RuntimeUserConsoleActionItem,
): number {
  const priorityCompare = compareUserConsoleActionPriority(left.priority, right.priority);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }
  if (left.kind === "waiting_user_task" && right.kind !== "waiting_user_task") {
    return -1;
  }
  if (right.kind === "waiting_user_task" && left.kind !== "waiting_user_task") {
    return 1;
  }
  return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title);
}

function hasFreshEvolutionVerificationAcknowledgement(
  candidate: RuntimeEvolutionCandidateStatus,
): boolean {
  const metadata = toRecord(candidate.metadata);
  const acknowledgedAt = toNumber(metadata?.verificationAcknowledgedAt, 0);
  const acknowledgedState = toStringValue(metadata?.verificationAcknowledgedState);
  const acknowledgedObservationCount = toNumber(
    metadata?.verificationAcknowledgedObservationCount,
    0,
  );
  if (acknowledgedAt <= 0) {
    return false;
  }
  if ((candidate.lastVerifiedAt ?? 0) > 0 && acknowledgedAt < (candidate.lastVerifiedAt ?? 0)) {
    return false;
  }
  if (
    candidate.verificationStatus &&
    acknowledgedState &&
    acknowledgedState !== candidate.verificationStatus
  ) {
    return false;
  }
  if (
    candidate.verificationObservationCount > 0 &&
    acknowledgedObservationCount < candidate.verificationObservationCount
  ) {
    return false;
  }
  return true;
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
    normalized === "worker_routing" ||
    normalized === "retrieval_policy"
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
  if (normalized === "shadow" || normalized === "observed") {
    return "shadow";
  }
  if (normalized === "promoted") {
    return "candidate";
  }
  if (normalized === "adopted") {
    return "adopted";
  }
  if (normalized === "reverted") {
    return "blocked";
  }
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

function emptyFederationStateCounts(): Record<FederationPackageState, number> {
  return {
    received: 0,
    validated: 0,
    shadowed: 0,
    recommended: 0,
    adopted: 0,
    rejected: 0,
    expired: 0,
    reverted: 0,
  };
}

function readFederationSyncAttempts(
  metadata: RuntimeMetadata | undefined,
): FederationSyncAttemptRecord[] {
  const raw = Array.isArray(toRecord(metadata)?.syncAttempts)
    ? (toRecord(metadata)?.syncAttempts as unknown[])
    : [];
  return raw
    .map((entry) => {
      const record = toRecord(entry);
      if (!record || typeof record.id !== "string") {
        return null;
      }
      const stage = record.stage;
      const attempt: FederationSyncAttemptRecord = {
        id: record.id,
        status: record.status === "failed" ? "failed" : "success",
        stage:
          stage === "prepare" ||
          stage === "push" ||
          stage === "pull" ||
          stage === "persist_inbox" ||
          stage === "sync_inbox"
            ? stage
            : "prepare",
        startedAt:
          typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
            ? Number(record.startedAt)
            : 0,
        completedAt:
          typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
            ? Number(record.completedAt)
            : 0,
        pushUrl: toStringValue(record.pushUrl) || undefined,
        pullUrl: toStringValue(record.pullUrl) || undefined,
        pushedEnvelopeKeys: Array.isArray(record.pushedEnvelopeKeys)
          ? record.pushedEnvelopeKeys.filter((value): value is string => typeof value === "string")
          : [],
        pulledPackageCount:
          typeof record.pulledPackageCount === "number" &&
          Number.isFinite(record.pulledPackageCount)
            ? Number(record.pulledPackageCount)
            : 0,
        inboxProcessedCount:
          typeof record.inboxProcessedCount === "number" &&
          Number.isFinite(record.inboxProcessedCount)
            ? Number(record.inboxProcessedCount)
            : 0,
        retryable: record.retryable !== false,
        error: toStringValue(record.error) || undefined,
        metadata: toRecord(record.metadata) ?? undefined,
      };
      return attempt;
    })
    .filter((entry): entry is FederationSyncAttemptRecord => entry != null)
    .toSorted(
      (left, right) => right.completedAt - left.completedAt || left.id.localeCompare(right.id),
    )
    .slice(0, 8);
}

function readFederationSharedStrategyAdoptedAt(strategy: StrategyRecord): number | undefined {
  const metadata = toRecord(strategy.metadata);
  return Number.isFinite(metadata?.adoptedAt) ? Number(metadata?.adoptedAt) : undefined;
}

function readFederationSharedStrategySourceRuntimeId(strategy: StrategyRecord): string {
  const metadata = toRecord(strategy.metadata);
  return (
    toStringValue(metadata?.federationSourceRuntimeId) ||
    toStringValue(metadata?.sourceRuntimeId) ||
    "unknown-runtime"
  );
}

function readFederationSharedStrategySourcePackageId(strategy: StrategyRecord): string | undefined {
  const metadata = toRecord(strategy.metadata);
  return (
    toStringValue(metadata?.federationPackageId) ||
    toStringValue(metadata?.sourcePackageId) ||
    undefined
  );
}

function readFederationTeamKnowledgeAdoptedAt(record: TeamKnowledgeRecord): number | undefined {
  const metadata = toRecord(record.metadata);
  return Number.isFinite(metadata?.adoptedAt) ? Number(metadata?.adoptedAt) : undefined;
}

function readFederationTeamKnowledgeSourcePackageId(
  record: TeamKnowledgeRecord,
): string | undefined {
  const metadata = toRecord(record.metadata);
  return (
    toStringValue(metadata?.federationPackageId) ||
    toStringValue(metadata?.sourcePackageId) ||
    undefined
  );
}

function readFederationTeamKnowledgeSourceKind(record: TeamKnowledgeRecord): string | undefined {
  const metadata = toRecord(record.metadata);
  return toStringValue(metadata?.sourceKind) || undefined;
}

function readFederationRoleOptimizationSourcePackageId(
  candidate: RuntimeUserConsoleStore["roleOptimizationCandidates"][number],
): string | undefined {
  const metadata = toRecord(candidate.metadata);
  return (
    toStringValue(metadata?.federationPackageId) ||
    toStringValue(metadata?.sourcePackageId) ||
    undefined
  );
}

function readFederationRoleOptimizationSourceRuntimeId(
  candidate: RuntimeUserConsoleStore["roleOptimizationCandidates"][number],
): string | undefined {
  const metadata = toRecord(candidate.metadata);
  return (
    toStringValue(metadata?.federationSourceRuntimeId) ||
    toStringValue(metadata?.sourceRuntimeId) ||
    undefined
  );
}

function resolveFederationSurfaceLabel(
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
  surfaceId: string | undefined,
): string | undefined {
  if (!surfaceId) {
    return undefined;
  }
  return surfaceProfilesById.get(surfaceId)?.surface.label || surfaceId;
}

function buildFederationPolicyOverlayPreview(policy: Record<string, unknown>): string[] {
  const preview: string[] = [];
  const governanceEntries = toArray<Record<string, unknown>>(policy.governanceEntries);
  if (governanceEntries.length > 0) {
    preview.push(`${governanceEntries.length} governance entr${governanceEntries.length === 1 ? "y" : "ies"}`);
  }
  const blockedCounts = [
    ["blocked skills", toArray<string>(policy.blockedSkills).length],
    ["blocked agents", toArray<string>(policy.blockedAgents).length],
    ["blocked MCPs", toArray<string>(policy.blockedMcps).length],
  ] as const;
  for (const [label, count] of blockedCounts) {
    if (count > 0) {
      preview.push(`${count} ${label}`);
    }
  }
  const stateMapCounts = [
    ["skill states", Object.keys(toRecord(policy.skillStates) ?? {}).length],
    ["agent states", Object.keys(toRecord(policy.agentStates) ?? {}).length],
    ["MCP states", Object.keys(toRecord(policy.mcpStates) ?? {}).length],
  ] as const;
  for (const [label, count] of stateMapCounts) {
    if (count > 0) {
      preview.push(`${count} ${label}`);
    }
  }
  const mcpGrantCount = toArray<Record<string, unknown>>(policy.mcpGrants).length;
  if (mcpGrantCount > 0) {
    preview.push(`${mcpGrantCount} MCP grant${mcpGrantCount === 1 ? "" : "s"}`);
  }
  return preview.slice(0, 4);
}

function buildFederationPackagePayloadPreview(
  entry: FederationInboxRecord,
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
): string[] {
  switch (entry.payload.type) {
    case "invalid-package": {
      const payload = entry.payload.payload;
      const rawPreview = toStringValue(payload.rawPreview).trim();
      return uniqueStrings([
        toStringValue(payload.declaredType).trim()
          ? `declared ${toStringValue(payload.declaredType).trim()}`
          : undefined,
        toStringValue(payload.fileName).trim()
          ? `file ${toStringValue(payload.fileName).trim()}`
          : undefined,
        toStringValue(payload.sourceError).trim() || undefined,
        rawPreview
          ? `raw ${rawPreview.slice(0, 72)}${rawPreview.length > 72 ? "..." : ""}`
          : undefined,
      ]).slice(0, 4);
    }
    case "coordinator-suggestion": {
      const metadata = toRecord(entry.payload.payload.metadata);
      return uniqueStrings([
        toStringValue(metadata?.route).trim()
          ? `route ${toStringValue(metadata?.route).trim()}`
          : undefined,
        toStringValue(metadata?.worker).trim()
          ? `worker ${toStringValue(metadata?.worker).trim()}`
          : undefined,
        resolveFederationSurfaceLabel(
          surfaceProfilesById,
          toStringValue(metadata?.surfaceId).trim() || undefined,
        )
          ? `surface ${resolveFederationSurfaceLabel(
              surfaceProfilesById,
              toStringValue(metadata?.surfaceId).trim() || undefined,
            )}`
          : undefined,
        toStringValue(entry.payload.payload.taskId).trim()
          ? `source task ${toStringValue(entry.payload.payload.taskId).trim()}`
          : undefined,
      ]).slice(0, 4);
    }
    case "shared-strategy-package": {
      const strategies = entry.payload.payload.strategies;
      return uniqueStrings([
        `${strategies.length} strateg${strategies.length === 1 ? "y" : "ies"}`,
        strategies.length > 0
          ? `routes ${uniqueStrings(strategies.map((strategy) => strategy.route)).slice(0, 3).join(", ")}`
          : undefined,
        strategies.length > 0
          ? `workers ${uniqueStrings(strategies.map((strategy) => strategy.worker)).slice(0, 3).join(", ")}`
          : undefined,
        strategies.length > 0
          ? `skills ${uniqueStrings(strategies.flatMap((strategy) => strategy.skillIds)).slice(0, 4).join(", ")}`
          : undefined,
      ]).slice(0, 4);
    }
    case "team-knowledge-package": {
      const records = entry.payload.payload.records;
      return uniqueStrings([
        `${records.length} record${records.length === 1 ? "" : "s"}`,
        records.length > 0 ? `titles ${records.slice(0, 2).map((record) => record.title).join(" / ")}` : undefined,
        records.length > 0
          ? `tags ${uniqueStrings(records.flatMap((record) => record.tags)).slice(0, 4).join(", ")}`
          : undefined,
      ]).slice(0, 4);
    }
    case "role-optimization-package": {
      const payload = entry.payload.payload;
      const overlay = payload.proposedOverlay;
      return uniqueStrings([
        resolveFederationSurfaceLabel(surfaceProfilesById, payload.surfaceId)
          ? `surface ${resolveFederationSurfaceLabel(surfaceProfilesById, payload.surfaceId)}`
          : undefined,
        payload.agentId ? `agent ${payload.agentId}` : undefined,
        typeof overlay.role === "string" && overlay.role.trim().length > 0
          ? `role ${overlay.role.trim()}`
          : undefined,
        typeof overlay.initiative === "string" ? `initiative ${overlay.initiative}` : undefined,
        typeof overlay.tone === "string" && overlay.tone.trim().length > 0
          ? `tone ${overlay.tone.trim()}`
          : undefined,
      ]).slice(0, 4);
    }
    case "runtime-policy-overlay-package": {
      const route = toStringValue(entry.payload.payload.route).trim();
      return uniqueStrings([
        route ? `route ${route}` : "global scope",
        ...buildFederationPolicyOverlayPreview(toRecord(entry.payload.payload.policy) ?? {}),
      ]).slice(0, 4);
    }
  }
}

function buildFederationPackageLocalLanding(
  entry: FederationInboxRecord,
  federationStore: ReturnType<typeof loadRuntimeFederationStore>,
  userConsoleStore: ReturnType<typeof loadRuntimeUserConsoleStore>,
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
): { localLandingLabel?: string; localLandingSummary?: string } {
  switch (entry.payload.type) {
    case "invalid-package":
      return {
        localLandingLabel: "invalid-package",
        localLandingSummary:
          entry.validationErrors[0] ??
          "Held in the local federation inbox until the source package is corrected.",
      };
    case "coordinator-suggestion": {
      const payloadId = entry.payload.payload.id;
      const suggestion = federationStore.coordinatorSuggestions.find(
        (candidate) => candidate.sourcePackageId === entry.id || candidate.id === payloadId,
      );
      if (!suggestion) {
        return {};
      }
      if (suggestion.localTaskId) {
        return {
          localLandingLabel: "queued-task",
          localLandingSummary:
            suggestion.localTaskStatus === "completed"
              ? `Materialized as local task ${suggestion.localTaskId} and completed locally.`
              : `Materialized as local task ${suggestion.localTaskId}.`,
        };
      }
      if (normalizeText(suggestion.rematerializeReason)) {
        return {
          localLandingLabel: "suggestion-queue",
          localLandingSummary: suggestion.rematerializeReason,
        };
      }
      return {
        localLandingLabel: "suggestion-queue",
        localLandingSummary: "Held in the local coordinator suggestion queue.",
      };
    }
    case "shared-strategy-package": {
      const landed = federationStore.sharedStrategies.filter(
        (strategy) => readFederationSharedStrategySourcePackageId(strategy) === entry.id,
      );
      if (landed.length === 0) {
        return {};
      }
      const routes = uniqueStrings(landed.map((strategy) => strategy.route)).slice(0, 3);
      return {
        localLandingLabel: landed.some((strategy) => (strategy.invalidatedBy ?? []).length > 0)
          ? "strategy-plane"
          : "strategy-plane",
        localLandingSummary: `${landed.length} shared strateg${
          landed.length === 1 ? "y" : "ies"
        } landed locally${routes.length > 0 ? ` across ${routes.join(", ")}` : ""}.`,
      };
    }
    case "team-knowledge-package": {
      const landed = federationStore.teamKnowledge.filter(
        (record) => readFederationTeamKnowledgeSourcePackageId(record) === entry.id,
      );
      if (landed.length === 0) {
        return {};
      }
      return {
        localLandingLabel: "archive-plane",
        localLandingSummary: `${landed.length} team knowledge record${
          landed.length === 1 ? "" : "s"
        } landed in the local archive plane.`,
      };
    }
    case "role-optimization-package": {
      const candidate = userConsoleStore.roleOptimizationCandidates.find(
        (item) =>
          readFederationRoleOptimizationSourcePackageId(item) === entry.id &&
          readFederationRoleOptimizationSourceRuntimeId(item) === entry.sourceRuntimeId,
      );
      if (!candidate) {
        return {};
      }
      const surfaceLabel = resolveFederationSurfaceLabel(surfaceProfilesById, candidate.surfaceId);
      return {
        localLandingLabel: candidate.state,
        localLandingSummary: `User Console holds this federation role optimization for ${
          surfaceLabel ?? candidate.surfaceId
        } in ${candidate.state} state.`,
      };
    }
    case "runtime-policy-overlay-package": {
      const appliedOverlays = toRecord(federationStore.metadata?.appliedPolicyOverlays);
      const overlay = toRecord(appliedOverlays?.[entry.id]);
      if (!overlay) {
        return {};
      }
      const route = toStringValue(overlay.route).trim() || toStringValue(entry.payload.payload.route).trim();
      const policyPreview = buildFederationPolicyOverlayPreview(toRecord(overlay.policy) ?? {});
      return {
        localLandingLabel: route ? "route-overlay" : "global-overlay",
        localLandingSummary: `Applied ${route ? `${route} route` : "global"} policy overlay${
          policyPreview.length > 0 ? ` · ${policyPreview.join(" · ")}` : ""
        }.`,
      };
    }
  }
}

function emptyFederationAssignmentStateCounts(): Record<FederationAssignmentPreviewState, number> {
  return {
    pending: 0,
    materialized: 0,
    blocked: 0,
    applied: 0,
    invalid: 0,
  };
}

function resolveFederationAssignmentActions(
  state: FederationAssignmentPreviewState,
  params: {
    invalid: boolean;
    localTaskId?: string;
  },
): FederationAssignmentAction[] {
  if (params.invalid) {
    return [];
  }
  if (state === "pending") {
    return ["materialize", "block"];
  }
  if (state === "blocked") {
    return ["reset"];
  }
  if (state === "materialized") {
    return ["mark_applied"];
  }
  if (state === "applied" && !params.localTaskId) {
    return ["reset"];
  }
  return [];
}

function readFederationAssignmentInbox(
  assignmentsRoot: string,
  opts: RuntimeStoreOptions,
): FederationAssignmentInboxStatus {
  const entries = listRuntimeFederationAssignments(opts)
    .filter((entry) => entry.filePath.startsWith(assignmentsRoot))
    .map((entry) => {
      const state: FederationAssignmentPreviewState = entry.invalid
        ? "invalid"
        : entry.state === "pending" ||
            entry.state === "materialized" ||
            entry.state === "blocked" ||
            entry.state === "applied"
          ? entry.state
          : "pending";
      return {
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        sourceRuntimeId: entry.sourceRuntimeId,
        sourcePackageId: entry.sourcePackageId,
        sourceTaskId: entry.sourceTaskId,
        localTaskId: entry.localTaskId,
        route: entry.route,
        worker: entry.worker,
        surfaceId: entry.surfaceId,
        agentId: entry.agentId,
        fileName: entry.fileName,
        state,
        rawState: entry.rawState,
        blockedReason: entry.blockedReason,
        receivedAt: entry.receivedAt,
        updatedAt: entry.updatedAt ?? entry.receivedAt ?? 0,
        materializedAt: entry.materializedAt,
        availableActions: resolveFederationAssignmentActions(state, {
          invalid: entry.invalid,
          localTaskId: entry.localTaskId,
        }),
      };
    });
  const stateCounts = emptyFederationAssignmentStateCounts();
  for (const entry of entries) {
    stateCounts[entry.state] += 1;
  }
  return {
    total: entries.length,
    stateCounts,
    latestAssignments: entries.slice(0, 6),
  };
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

function appendUniqueMappedValue(target: Map<string, string[]>, key: string, value: string): void {
  const normalizedKey = toStringValue(key);
  const normalizedValue = toStringValue(value);
  if (!normalizedKey || !normalizedValue) {
    return;
  }
  const next = uniqueStrings([...(target.get(normalizedKey) ?? []), normalizedValue]);
  target.set(normalizedKey, next);
}

function extractLifecycleRecordIds(payload: Record<string, unknown>): {
  memoryIds: string[];
  strategyIds: string[];
  metaLearningIds: string[];
  evolutionIds: string[];
} {
  return {
    memoryIds: uniqueStrings(
      toArray<string>(
        payload.memoryIds ??
          payload.invalidatedMemoryIds ??
          payload.reinforcedMemoryIds ??
          payload.restoredMemoryIds ??
          payload.agedMemoryIds,
      ).filter((value) => typeof value === "string"),
    ),
    strategyIds: uniqueStrings(
      toArray<string>(
        payload.strategyIds ??
          payload.invalidatedStrategyIds ??
          payload.strengthenedStrategyIds ??
          payload.restoredStrategyIds ??
          payload.weakenedStrategyIds,
      ).filter((value) => typeof value === "string"),
    ),
    metaLearningIds: uniqueStrings(
      toArray<string>(
        payload.metaLearningIds ??
          payload.invalidatedMetaLearningIds ??
          payload.restoredMetaLearningIds ??
          payload.refreshedMetaLearningIds ??
          payload.staleMetaLearningIds,
      ).filter((value) => typeof value === "string"),
    ),
    evolutionIds: uniqueStrings(
      toArray<string>(
        payload.evolutionIds ??
          payload.restoredEvolutionIds ??
          payload.refreshedEvolutionIds ??
          payload.staleEvolutionIds,
      ).filter((value) => typeof value === "string"),
    ),
  };
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
        artifactRefs: toArray<string>(
          (
            task as TaskRecord & {
              intelRefs?: string[];
            }
          ).artifactRefs ??
            (
              task as TaskRecord & {
                intelRefs?: string[];
              }
            ).intelRefs,
        ).filter((value) => typeof value === "string"),
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
      leaseDurationMs: 10 * 60 * 1000,
      maxConcurrentRunsPerWorker: 2,
      maxConcurrentRunsPerRoute: 3,
    },
    tasks,
    runs: [],
    steps: [],
    reviews: [],
    reports: [],
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
      sourceReviewIds: [],
      sourceSessionIds: [],
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
      sourceReviewIds: toArray<string>(entry.sourceReviewIds).filter(
        (value) => typeof value === "string",
      ),
      sourceMemoryIds: toArray<string>(entry.sourceMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      sourceSessionIds: [],
      sourceIntelIds: toArray<string>(entry.sourceIntelIds).filter(
        (value) => typeof value === "string",
      ),
      derivedFromMemoryIds: uniqueStrings([
        ...toArray<string>(entry.sourceMemoryIds).filter((value) => typeof value === "string"),
        ...toArray<string>(entry.derivedFromMemoryIds).filter((value) => typeof value === "string"),
      ]),
      lastReinforcedAt: undefined,
      decayScore: 0,
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
      confidence: toNumber(entry.confidence, 0),
      version: toNumber(entry.version, 1),
      invalidatedBy: toArray<string>(entry.invalidatedBy).filter(
        (value) => typeof value === "string",
      ),
      sourceEventIds: [],
      sourceTaskIds: [],
      sourceReviewIds: [],
      sourceSessionIds: [],
      sourceIntelIds: [],
      derivedFromMemoryIds: toArray<string>(entry.sourceMemoryIds || entry.derivedFromMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      lastReinforcedAt: undefined,
      decayScore: 0,
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
        confidence: 0,
        version: 1,
        invalidatedBy: toArray<string>(candidate.invalidatedBy).filter(
          (value) => typeof value === "string",
        ),
        sourceEventIds: [],
        sourceTaskIds: toArray<string>(candidate.sourceTaskIds).filter(
          (value) => typeof value === "string",
        ),
        sourceReviewIds: [],
        sourceSessionIds: [],
        sourceShadowTelemetryIds: [],
        sourceIntelIds: toArray<string>(candidate.sourceIntelIds).filter(
          (value) => typeof value === "string",
        ),
        derivedFromMemoryIds: toArray<string>(candidate.derivedFromMemoryIds).filter(
          (value) => typeof value === "string",
        ),
        lastReinforcedAt: toNumber(candidate.lastShadowAt, 0) || undefined,
        decayScore: 0,
        createdAt: toNumber(candidate.createdAt, now),
        updatedAt: toNumber(candidate.updatedAt, toNumber(candidate.createdAt, now)),
        metadata: {
          expectedEffect: toRecord(candidate.expectedEffect) ?? undefined,
          measuredEffect: toRecord(candidate.measuredEffect) ?? undefined,
          shadowMetrics: toRecord(candidate.shadowMetrics) ?? undefined,
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
    domain: normalizeRuntimeInfoDomain(item.domain),
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
        domain: normalizeRuntimeInfoDomain(digest.domain),
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
      domain: normalizeRuntimeInfoDomain(domain.id),
      label: toStringValue(domain.label, domain.id),
      priority: 1,
      metadata: {
        latestFetchAt: toNumber(domain.lastFetchedAt, 0) || undefined,
      },
    })),
    topicProfiles: [],
    usefulnessRecords: [],
    rankRecords: [],
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
      const shadowState: ShadowEvaluationRecord["state"] =
        normalizeEvolutionAdoptionState(candidate.adoptionState) === "adopted"
          ? "adopted"
          : normalizeEvolutionAdoptionState(candidate.adoptionState) === "candidate"
            ? "promoted"
            : toArray<string>(candidate.invalidatedBy).length > 0
              ? "reverted"
              : "shadow";
      return {
        id: `shadow_eval_${hashText(evolutionId)}`,
        candidateType: normalizeEvolutionCandidateType(candidate.candidateType),
        targetLayer: normalizeEvolutionTargetLayer(candidate.targetLayer),
        state: shadowState,
        confidence: 0,
        version: 1,
        invalidatedBy: toArray<string>(candidate.invalidatedBy).filter(
          (value) => typeof value === "string",
        ),
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
        sourceEventIds: [],
        sourceTaskIds: [],
        sourceReviewIds: [],
        sourceSessionIds: [],
        sourceIntelIds: [],
        derivedFromMemoryIds: [],
        lastReinforcedAt: undefined,
        decayScore: 0,
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
    mcpGrants: [],
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
  const userConsoleStore = loadRuntimeUserConsoleStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfiles = listRuntimeResolvedSurfaceProfiles({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfileById = new Map(surfaceProfiles.map((entry) => [entry.surface.id, entry]));
  const agentNameById = new Map(userConsoleStore.agents.map((entry) => [entry.id, entry.name || entry.id]));
  const sessionLabelById = new Map(
    userConsoleStore.sessionWorkingPreferences.map((entry) => [entry.sessionId, entry.label || entry.sessionId]),
  );
  const schedulerPolicy = resolveTaskSchedulerPolicy(taskStore.defaults);
  const activeConcurrency = buildActiveTaskConcurrencySnapshot(taskStore.tasks, now);
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
    const taskContext = toRecord(taskMetadata?.taskContext);
    const taskSurface = toRecord(taskMetadata?.surface);
    const runtimeTaskMetadata = toRecord(taskMetadata?.runtimeTask);
    const runtimeTaskRunState = toRecord(runtimeTaskMetadata?.runState);
    const runtimeTaskOptimizationState = toRecord(runtimeTaskMetadata?.optimizationState);
    const latestRun = latestRuns.get(task.id);
    const surfaceId = resolveTaskSurfaceId(task);
    const surfaceProfile = surfaceId ? surfaceProfileById.get(surfaceId) : undefined;
    const agentId =
      toStringValue(taskContext?.agentId).trim() ||
      (toStringValue(taskSurface?.ownerKind).trim() === "agent"
        ? toStringValue(taskSurface?.ownerId).trim()
        : "") ||
      (surfaceProfile?.surface.ownerKind === "agent" ? surfaceProfile.surface.ownerId ?? "" : "") ||
      undefined;
    const sessionId = toStringValue(taskContext?.sessionId).trim() || undefined;
    return {
      id: task.id,
      rootTaskId: task.rootTaskId || task.id,
      parentTaskId: task.parentTaskId || undefined,
      title: task.title,
      route: task.route,
      agentId,
      agentLabel: agentId ? agentNameById.get(agentId) ?? agentId : undefined,
      surfaceId,
      surfaceLabel: surfaceId ? surfaceProfile?.surface.label ?? surfaceId : undefined,
      sessionId,
      sessionLabel: sessionId ? sessionLabelById.get(sessionId) ?? sessionId : undefined,
      status: normalizeTaskStatus(task.status),
      priority: task.priority,
      budgetMode: task.budgetMode,
      retrievalMode: task.retrievalMode,
      recurring: task.recurring,
      maintenance: task.maintenance,
      scheduleIntervalMinutes:
        typeof task.scheduleIntervalMinutes === "number" && task.scheduleIntervalMinutes > 0
          ? task.scheduleIntervalMinutes
          : undefined,
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
      lastDecisionAt:
        typeof runtimeTaskRunState?.lastDecisionAt === "number"
          ? runtimeTaskRunState.lastDecisionAt
          : undefined,
      recommendedWorker:
        toStringValue(runtimeTaskRunState?.lastRecommendedWorker || task.worker) || undefined,
      recommendedSkills: toArray<string>(runtimeTaskRunState?.lastRecommendedSkills).filter(
        (value) => typeof value === "string",
      ),
      lastRetryStrategyId: toStringValue(runtimeTaskRunState?.lastRetryStrategyId) || undefined,
      lastRetryDelayMinutes:
        typeof runtimeTaskRunState?.lastRetryDelayMinutes === "number"
          ? Math.max(1, Math.round(runtimeTaskRunState.lastRetryDelayMinutes))
          : undefined,
      lastRetryBlockedThreshold:
        typeof runtimeTaskRunState?.lastRetryBlockedThreshold === "number"
          ? Math.max(1, Math.round(runtimeTaskRunState.lastRetryBlockedThreshold))
          : undefined,
      reportPolicy: toStringValue(runtimeTaskRunState?.lastReportPolicy) || undefined,
      reportVerbosity: toStringValue(runtimeTaskRunState?.lastReportVerbosity) || undefined,
      interruptionThreshold:
        toStringValue(runtimeTaskRunState?.lastInterruptionThreshold) || undefined,
      confirmationBoundary:
        toStringValue(runtimeTaskRunState?.lastConfirmationBoundary) || undefined,
      retrievalQueryId: toStringValue(runtimeTaskRunState?.lastRetrievalQueryId) || undefined,
      contextSummary: toStringValue(runtimeTaskRunState?.lastContextSummary) || undefined,
      contextSynthesis: toArray<string>(runtimeTaskRunState?.lastContextSynthesis).filter(
        (value) => typeof value === "string",
      ),
      strategyCandidateIds: toArray<string>(runtimeTaskRunState?.lastStrategyCandidateIds).filter(
        (value) => typeof value === "string",
      ),
      archiveCandidateIds: toArray<string>(runtimeTaskRunState?.lastArchiveCandidateIds).filter(
        (value) => typeof value === "string",
      ),
      relevantMemoryIds: toArray<string>(runtimeTaskRunState?.lastRelevantMemoryIds).filter(
        (value) => typeof value === "string",
      ),
      relevantSessionIds: toArray<string>(runtimeTaskRunState?.lastRelevantSessionIds).filter(
        (value) => typeof value === "string",
      ),
      fallbackOrder: toArray<string>(runtimeTaskRunState?.lastFallbackOrder).filter(
        (value) => typeof value === "string",
      ),
      remoteCallCount:
        toNumber(
          toRecord(latestRun?.metadata)?.remoteCallCount ??
            taskMetadata?.remoteCallCount ??
            runtimeTaskMetadata?.remoteCallCount ??
            runtimeTaskRunState?.remoteCallCount,
          0,
        ) || undefined,
      userResponseCount: toNumber(runtimeTaskRunState?.userResponseCount, 0) || undefined,
      lastUserResponseAt:
        typeof runtimeTaskRunState?.lastUserResponseAt === "number"
          ? runtimeTaskRunState.lastUserResponseAt
          : undefined,
      lastUserResponseSummary:
        toStringValue(runtimeTaskRunState?.lastUserResponseSummary) || undefined,
      needsReplan: runtimeTaskOptimizationState?.needsReplan === true,
      replanCount: toNumber(runtimeTaskRunState?.replanCount, 0) || undefined,
      lastReplannedAt:
        typeof runtimeTaskOptimizationState?.lastReplannedAt === "number"
          ? runtimeTaskOptimizationState.lastReplannedAt
          : undefined,
      invalidatedBy: toArray<string>(runtimeTaskOptimizationState?.invalidatedBy).filter(
        (value) => typeof value === "string",
      ),
      invalidatedMemoryIds: toArray<string>(
        runtimeTaskOptimizationState?.invalidatedMemoryIds,
      ).filter((value) => typeof value === "string"),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      nextRunAt: task.nextRunAt,
    } satisfies RuntimeTaskSummary;
  });
  const sorted = sortTasks(tasks);
  const taskTitlesById = new Map(taskStore.tasks.map((task) => [task.id, task.title]));
  const recentReviews = [...taskStore.reviews]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .map((review) => {
      const distill = toRecord(toRecord(review.metadata)?.distill);
      return {
        id: review.id,
        taskId: review.taskId,
        runId: review.runId,
        taskTitle: taskTitlesById.get(review.taskId) ?? review.taskId,
        outcome: review.outcome,
        summary: review.summary,
        extractedMemoryIds: uniqueStrings(review.extractedMemoryIds ?? []),
        strategyCandidateIds: uniqueStrings(review.strategyCandidateIds ?? []),
        metaLearningIds: uniqueStrings(
          toArray<string>(distill?.metaLearningIds).filter((value) => typeof value === "string"),
        ),
        shareable: toRecord(review.metadata)?.localOnly !== true,
        createdAt: review.createdAt,
      } satisfies RuntimeTaskReviewSummary;
    })
    .slice(0, 8);
  return {
    generatedAt: now,
    total: sorted.length,
    reviewCount: taskStore.reviews.length,
    statusCounts: buildTaskStatusCounts(sorted, now),
    runnableCount: sorted.filter((task) => isRunnableTaskStatus(task.status)).length,
    activeTaskCount: activeConcurrency.activeCount,
    replanPendingCount: sorted.filter((task) => task.needsReplan).length,
    leaseDurationMs: schedulerPolicy.leaseDurationMs,
    maxConcurrentRunsPerWorker: schedulerPolicy.maxConcurrentRunsPerWorker,
    maxConcurrentRunsPerRoute: schedulerPolicy.maxConcurrentRunsPerRoute,
    activeWorkerSlots: activeConcurrency.workerCounts,
    activeRouteSlots: activeConcurrency.routeCounts,
    tasks: sorted,
    recentReviews,
  };
}

export function buildRuntimeMemoryList(opts: RuntimeStateOptions = {}): RuntimeMemoryListResult {
  const now = resolveNow(opts.now);
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const markdownMirror = buildRuntimeMemoryMarkdownMirrorStatus({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const _metadata = toRecord(memoryStore.metadata);
  const lifecycleControls = resolveRuntimeMemoryLifecycleControls(memoryStore.metadata);
  const memoryTypeCounts = emptyMemoryTypeCounts();
  const downstreamMemoryIdsByMemoryId = new Map<string, string[]>();
  const linkedStrategyIdsByMemoryId = new Map<string, string[]>();
  for (const memory of memoryStore.memories) {
    for (const parentId of uniqueStrings(memory.derivedFromMemoryIds ?? [])) {
      appendUniqueMappedValue(downstreamMemoryIdsByMemoryId, parentId, memory.id);
    }
  }
  for (const strategy of memoryStore.strategies) {
    for (const sourceMemoryId of uniqueStrings(strategy.derivedFromMemoryIds ?? [])) {
      appendUniqueMappedValue(linkedStrategyIdsByMemoryId, sourceMemoryId, strategy.id);
    }
  }
  const recentThreshold = now - 7 * 24 * 60 * 60 * 1000;
  let invalidatedCount = 0;
  let highDecayCount = 0;
  let reinforcedRecentlyCount = 0;
  let staleLearningCount = 0;
  let staleEvolutionCount = 0;
  const recentEvents = readRuntimeEvents(80, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const rolledBackInvalidationIds = new Set(
    recentEvents
      .filter((event) => event.type === "memory_invalidation_rolled_back")
      .map((event) => toStringValue(event.payload?.invalidationEventId))
      .filter((value) => value.length > 0),
  );
  const activeInvalidationEventIdsByMemoryId = new Map<
    string,
    {
      invalidationEventId: string;
      createdAt: number;
    }
  >();
  for (const event of recentEvents
    .filter((entry) => entry.type === "memory_lineage_invalidated")
    .toSorted((left, right) => right.createdAt - left.createdAt)) {
    if (rolledBackInvalidationIds.has(event.id)) {
      continue;
    }
    const payload = toRecord(event.payload) ?? {};
    const { memoryIds } = extractLifecycleRecordIds(payload);
    for (const memoryId of memoryIds) {
      if (activeInvalidationEventIdsByMemoryId.has(memoryId)) {
        continue;
      }
      activeInvalidationEventIdsByMemoryId.set(memoryId, {
        invalidationEventId: event.id,
        createdAt: event.createdAt,
      });
    }
  }
  const memories = [...memoryStore.memories]
    .map((entry) => {
      memoryTypeCounts[entry.memoryType] += 1;
      if (entry.invalidatedBy.length > 0) {
        invalidatedCount += 1;
      }
      if ((entry.decayScore ?? 0) >= lifecycleControls.highDecayThreshold) {
        highDecayCount += 1;
      }
      if ((entry.lastReinforcedAt ?? 0) >= recentThreshold) {
        reinforcedRecentlyCount += 1;
      }
      return {
        id: entry.id,
        memoryType: entry.memoryType,
        route: entry.route,
        scope: entry.scope,
        summary: entry.summary,
        tags: uniqueStrings(entry.tags ?? []),
        confidence: normalizeConfidencePercent(entry.confidence, 0),
        invalidated: entry.invalidatedBy.length > 0,
        invalidatedBy: uniqueStrings(entry.invalidatedBy ?? []),
        sourceEventIds: uniqueStrings(entry.sourceEventIds ?? []),
        sourceTaskIds: uniqueStrings(entry.sourceTaskIds ?? []),
        sourceIntelIds: uniqueStrings(entry.sourceIntelIds ?? []),
        derivedFromMemoryIds: uniqueStrings(entry.derivedFromMemoryIds ?? []),
        downstreamMemoryIds: uniqueStrings(downstreamMemoryIdsByMemoryId.get(entry.id) ?? []),
        linkedStrategyIds: uniqueStrings(linkedStrategyIdsByMemoryId.get(entry.id) ?? []),
        shareable: isShareableMemoryRecord(entry),
        teamShareable:
          isShareableMemoryRecord(entry) && TEAM_KNOWLEDGE_MEMORY_TYPES.has(entry.memoryType),
        activeInvalidationEventId: activeInvalidationEventIdsByMemoryId.get(entry.id)
          ?.invalidationEventId,
        lastReinforcedAt:
          toNumber(entry.lastReinforcedAt, toNumber(entry.updatedAt, now)) || undefined,
        decayScore: toNumber(entry.decayScore, 0),
        updatedAt: entry.updatedAt,
      } satisfies RuntimeMemorySummary;
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  const strategies = [...memoryStore.strategies].toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  for (const learning of memoryStore.metaLearning) {
    if (toRecord(learning.metadata?.lifecycle)?.stale === true) {
      staleLearningCount += 1;
    }
  }
  for (const evolution of memoryStore.evolutionMemory) {
    if (toRecord(evolution.metadata?.lifecycle)?.stale === true) {
      staleEvolutionCount += 1;
    }
  }
  const recentLifecycleEvents = recentEvents
    .filter(
      (event) =>
        event.type === "memory_lineage_invalidated" ||
        event.type === "memory_lineage_reinforced" ||
        event.type === "runtime_memory_lifecycle_reviewed" ||
        event.type === "memory_invalidation_rolled_back",
    )
    .map((event) => {
      const payload = toRecord(event.payload) ?? {};
      const { memoryIds, strategyIds, metaLearningIds, evolutionIds } =
        extractLifecycleRecordIds(payload);
      if (event.type === "memory_lineage_invalidated") {
        return {
          id: event.id,
          type: "invalidated",
          createdAt: event.createdAt,
          memoryIds,
          strategyIds,
          metaLearningIds,
          evolutionIds,
          label: `Invalidated ${memoryIds.length} memory records and ${strategyIds.length} linked strategies.`,
          reason: toStringValue(payload.reasonEventId) || undefined,
          invalidationEventId: event.id,
          rollbackAvailable: !rolledBackInvalidationIds.has(event.id),
        } satisfies RuntimeMemoryLifecycleEventStatus;
      }
      if (event.type === "memory_lineage_reinforced") {
        return {
          id: event.id,
          type: "reinforced",
          createdAt: event.createdAt,
          memoryIds,
          strategyIds,
          metaLearningIds,
          evolutionIds,
          label: `Reinforced ${memoryIds.length} memories, ${strategyIds.length} strategies, ${metaLearningIds.length} learnings, and ${evolutionIds.length} evolution candidates.`,
          reason: toStringValue(payload.reason) || undefined,
          rollbackAvailable: false,
        } satisfies RuntimeMemoryLifecycleEventStatus;
      }
      if (event.type === "memory_invalidation_rolled_back") {
        return {
          id: event.id,
          type: "rolled_back",
          createdAt: event.createdAt,
          memoryIds,
          strategyIds,
          metaLearningIds,
          evolutionIds,
          label: `Rolled back memory invalidation and restored ${memoryIds.length} memories.`,
          reason: toStringValue(payload.reason) || undefined,
          invalidationEventId: toStringValue(payload.invalidationEventId) || undefined,
          rollbackAvailable: false,
        } satisfies RuntimeMemoryLifecycleEventStatus;
      }
      return {
        id: event.id,
        type: "reviewed",
        createdAt: event.createdAt,
        memoryIds,
        strategyIds,
        metaLearningIds,
        evolutionIds,
        label: `Lifecycle review aged ${memoryIds.length} memories, weakened ${strategyIds.length} strategies, marked ${metaLearningIds.length} learnings stale, and marked ${evolutionIds.length} evolution candidates stale.`,
        rollbackAvailable: false,
      } satisfies RuntimeMemoryLifecycleEventStatus;
    })
    .slice(0, 8);

  return {
    generatedAt: now,
    total: memories.length,
    strategyCount: strategies.length,
    learningCount: memoryStore.metaLearning.length,
    staleLearningCount,
    evolutionCount: memoryStore.evolutionMemory.length,
    staleEvolutionCount,
    invalidatedCount,
    highDecayCount,
    reinforcedRecentlyCount,
    lifecycleReviewEnabled: lifecycleControls.enabled,
    reviewIntervalHours: lifecycleControls.reviewIntervalHours,
    lastReviewAt: lifecycleControls.lastReviewAt,
    lifecyclePolicy: {
      decayGraceDays: lifecycleControls.decayGraceDays,
      minDecayIncreasePerReview: lifecycleControls.minDecayIncreasePerReview,
      agePressurePerDay: lifecycleControls.agePressurePerDay,
      confidencePenaltyDivisor: lifecycleControls.confidencePenaltyDivisor,
      linkedStrategyConfidencePenalty: lifecycleControls.linkedStrategyConfidencePenalty,
      highDecayThreshold: lifecycleControls.highDecayThreshold,
    },
    markdownMirror,
    memoryTypeCounts,
    memories,
    strategies,
    recentLifecycleEvents,
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
    planes: ["strategy", "memory", "session", "archive"],
    layers: MEMORY_LAYERS,
    system1DefaultPlanes: ["strategy", "memory", "session"],
    system2DefaultPlanes: ["strategy", "memory", "session", "archive"],
    defaultBudgetMode: taskStore.defaults.defaultBudgetMode,
    defaultRetrievalMode: taskStore.defaults.defaultRetrievalMode,
    maxInputTokensPerTurn: taskStore.defaults.maxInputTokensPerTurn,
    maxContextChars: taskStore.defaults.maxContextChars,
    maxRemoteCallsPerTask: taskStore.defaults.maxRemoteCallsPerTask,
    leaseDurationMs: taskStore.defaults.leaseDurationMs,
    maxConcurrentRunsPerWorker: taskStore.defaults.maxConcurrentRunsPerWorker,
    maxConcurrentRunsPerRoute: taskStore.defaults.maxConcurrentRunsPerRoute,
  };
}

function buildUserConsoleActionQueue(params: {
  now: number;
  taskStore: RuntimeTaskStore;
  federationStore: ReturnType<typeof loadRuntimeFederationStore>;
  userConsoleStore: ReturnType<typeof loadRuntimeUserConsoleStore>;
  mirrorStatus: ReturnType<typeof buildRuntimeUserModelMirrorStatus>;
  surfaceProfiles: ReturnType<typeof listRuntimeResolvedSurfaceProfiles>;
  evolutionCandidates: RuntimeEvolutionCandidateStatus[];
}): {
  waitingUserTaskCount: number;
  recommendedFederationPackageCount: number;
  adoptedCoordinatorSuggestionCount: number;
  pendingActionCount: number;
  actionQueue: RuntimeUserConsoleActionItem[];
} {
  const surfaceProfileById = new Map(
    params.surfaceProfiles.map((profile) => [profile.surface.id, profile] as const),
  );
  const waitingUserReports = [...params.taskStore.reports]
    .filter((report) => report.state === "pending" && report.kind === "waiting_user")
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
    );
  const waitingUserReportTaskIds = new Set(waitingUserReports.map((report) => report.taskId));
  const waitingUserTasks = params.taskStore.tasks.filter(
    (task) => task.status === "waiting_user" && !waitingUserReportTaskIds.has(task.id),
  );
  const recommendedUserModelCandidates =
    params.userConsoleStore.userModelOptimizationCandidates.filter(
      (candidate) => candidate.state === "recommended",
    );
  const recommendedRoleCandidates = params.userConsoleStore.roleOptimizationCandidates.filter(
    (candidate) => candidate.state === "recommended",
  );
  const recommendedPackages = params.federationStore.inbox.filter(
    (entry) => entry.state === "recommended",
  );
  const actionableEvolutionCandidates = params.evolutionCandidates.filter(
    (candidate) =>
      candidate.state === "adopted" &&
      candidate.verificationStatus === "revert_recommended" &&
      !hasFreshEvolutionVerificationAcknowledgement(candidate),
  );
  const adoptedCoordinatorSuggestions = [...params.federationStore.coordinatorSuggestions].filter(
    (entry) => Number.isFinite(entry.adoptedAt ?? entry.updatedAt),
  );
  const actionableCoordinatorSuggestions = adoptedCoordinatorSuggestions.filter(
    (entry) => !entry.localTaskId,
  );
  const mirrorPendingImport = params.mirrorStatus.pendingImport;
  const mirrorUpdatedAt =
    params.mirrorStatus.lastModifiedAt ??
    params.mirrorStatus.lastImportedAt ??
    params.mirrorStatus.lastSyncedAt ??
    params.now;

  const actionQueue = [
    ...waitingUserReports.map(
      (report): RuntimeUserConsoleActionItem => {
        const surfaceProfile = report.surfaceId ? surfaceProfileById.get(report.surfaceId) : undefined;
        return {
          id: `waiting-user-report:${report.id}`,
          kind: "waiting_user_task",
          priority: "high",
          title: report.title,
          summary: report.summary,
          updatedAt: report.updatedAt,
          taskId: report.taskId,
          surfaceId: report.surfaceId,
          surfaceLabel: report.surfaceLabel ?? surfaceProfile?.surface.label,
          reportTarget: report.reportTarget,
          taskCreationPolicy: surfaceProfile?.effectiveLocalBusinessPolicy?.taskCreation,
          escalationTarget:
            report.escalationTarget ?? surfaceProfile?.effectiveLocalBusinessPolicy?.escalationTarget,
        };
      },
    ),
    ...waitingUserTasks.map(
      (task): RuntimeUserConsoleActionItem => {
        const surfaceId = resolveTaskSurfaceId(task);
        const surfaceProfile = surfaceId ? surfaceProfileById.get(surfaceId) : undefined;
        return {
          id: `waiting-user:${task.id}`,
          kind: "waiting_user_task",
          priority: "high",
          title: task.title,
          summary:
            toStringValue(task.nextAction).trim() ||
            toStringValue(task.planSummary).trim() ||
            toStringValue(task.goal).trim() ||
            "Task is paused for explicit user input.",
          updatedAt: task.updatedAt,
          taskId: task.id,
          surfaceId,
          surfaceLabel: surfaceProfile?.surface.label,
          reportTarget: surfaceProfile?.effectiveReportTarget,
          taskCreationPolicy: surfaceProfile?.effectiveLocalBusinessPolicy?.taskCreation,
          escalationTarget: surfaceProfile?.effectiveLocalBusinessPolicy?.escalationTarget,
        };
      },
    ),
    ...actionableEvolutionCandidates.map(
      (candidate): RuntimeUserConsoleActionItem => ({
        id: `evolution-verification:${candidate.id}`,
        kind: "evolution_revert_recommendation",
        priority: "high",
        title: `Review live optimization: ${candidate.summary}`,
        summary: [
          candidate.verificationSummary ||
            "Post-adoption verification recommends reverting or explicitly keeping this optimization live.",
          candidate.route ? `route=${candidate.route}` : undefined,
          candidate.worker ? `worker=${candidate.worker}` : undefined,
          candidate.verificationObservationCount > 0
            ? `observations=${candidate.verificationObservationCount}`
            : undefined,
          candidate.materializedStrategyId ? `strategy=${candidate.materializedStrategyId}` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        updatedAt: candidate.lastVerifiedAt ?? candidate.updatedAt,
        candidateId: candidate.id,
        verificationStatus: candidate.verificationStatus,
        verificationObservationCount: candidate.verificationObservationCount,
        lastVerifiedAt: candidate.lastVerifiedAt,
      }),
    ),
    ...recommendedUserModelCandidates.map(
      (candidate): RuntimeUserConsoleActionItem => ({
        id: `user-model:${candidate.id}`,
        kind: "user_model_optimization",
        priority: candidate.confidence >= 85 ? "high" : "medium",
        title: candidate.summary,
        summary: candidate.reasoning[0] || "Review the proposed long-term preference update.",
        updatedAt: candidate.updatedAt,
        candidateId: candidate.id,
      }),
    ),
    ...recommendedRoleCandidates.map(
      (candidate): RuntimeUserConsoleActionItem => ({
        id: `role-optimization:${candidate.id}`,
        kind: "role_optimization",
        priority: candidate.confidence >= 85 ? "high" : "medium",
        title: candidate.summary,
        summary: candidate.reasoning[0] || "Review the proposed surface role optimization.",
        updatedAt: candidate.updatedAt,
        candidateId: candidate.id,
        surfaceId: candidate.surfaceId,
      }),
    ),
    ...recommendedPackages.map(
      (entry): RuntimeUserConsoleActionItem => ({
        id: `federation-package:${entry.id}`,
        kind: "federation_package",
        priority: entry.packageType === "coordinator-suggestion" ? "high" : "medium",
        title: entry.summary,
        summary: `${entry.packageType} from ${entry.sourceRuntimeId} is ready for local review.`,
        updatedAt: entry.recommendedAt ?? entry.shadowedAt ?? entry.validatedAt ?? entry.receivedAt,
        packageId: entry.id,
        packageType: entry.packageType,
        packageState: entry.state,
      }),
    ),
    ...actionableCoordinatorSuggestions.map((entry): RuntimeUserConsoleActionItem => {
      const metadata = toRecord(entry.metadata);
      const surfaceId = toStringValue(metadata?.surfaceId).trim() || undefined;
      const surfaceProfile = surfaceId ? surfaceProfileById.get(surfaceId) : undefined;
      const localPolicy = surfaceProfile?.effectiveLocalBusinessPolicy;
      const taskCreationPolicy = localPolicy?.taskCreation;
      const escalationTarget = localPolicy?.escalationTarget;
      const actionBlockedReason =
        taskCreationPolicy === "disabled"
          ? `Surface ${surfaceProfile?.surface.label || surfaceId || "unknown"} blocks local task creation. Keep the coordinator suggestion in review mode until the policy changes.`
          : undefined;
      const summary = [
        entry.summary,
        surfaceProfile?.surface.label ? `surface=${surfaceProfile.surface.label}` : undefined,
        taskCreationPolicy ? `taskCreation=${taskCreationPolicy}` : undefined,
        escalationTarget ? `escalate=${escalationTarget}` : undefined,
        entry.lastMaterializedLocalTaskId ? `lastLocalTask=${entry.lastMaterializedLocalTaskId}` : undefined,
        entry.localTaskStatus ? `lastLocalStatus=${entry.localTaskStatus}` : undefined,
        entry.rematerializeReason ? `requeue=${entry.rematerializeReason}` : undefined,
        actionBlockedReason ? `blocked=${actionBlockedReason}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: `coordinator-suggestion:${entry.id}`,
        kind: "coordinator_suggestion",
        priority: actionBlockedReason
          ? "medium"
          : entry.rematerializeReason
            ? "high"
            : "low",
        title: entry.title,
        summary,
        updatedAt: entry.updatedAt,
        localTaskStatus: entry.localTaskStatus,
        lastLocalTaskId: entry.lastMaterializedLocalTaskId,
        rematerializeReason: entry.rematerializeReason,
        sourceTaskId: entry.taskId,
        coordinatorSuggestionId: entry.id,
        surfaceId,
        surfaceLabel: surfaceProfile?.surface.label,
        taskCreationPolicy,
        escalationTarget,
        actionBlockedReason,
      };
    }),
    ...(mirrorPendingImport
      ? [
          {
            id: "user-model-mirror:pending-import",
            kind: "user_model_mirror_import",
            priority: "medium",
            title: "Import pending USER.md user-model edits",
            summary:
              "Manual USER.md edits are newer than the authoritative Runtime user model. Review and import them, or force-sync to discard the mirror edits.",
            updatedAt: mirrorUpdatedAt,
            mirrorPath: params.mirrorStatus.path,
          } satisfies RuntimeUserConsoleActionItem,
        ]
      : []),
  ]
    .toSorted(compareUserConsoleActions)
    .slice(0, USER_CONSOLE_ACTION_QUEUE_LIMIT);

  return {
    waitingUserTaskCount: waitingUserReports.length + waitingUserTasks.length,
    recommendedFederationPackageCount: recommendedPackages.length,
    adoptedCoordinatorSuggestionCount: adoptedCoordinatorSuggestions.length,
    pendingActionCount:
      waitingUserReports.length +
      waitingUserTasks.length +
      actionableEvolutionCandidates.length +
      recommendedUserModelCandidates.length +
      recommendedRoleCandidates.length +
      recommendedPackages.length +
      actionableCoordinatorSuggestions.length +
      (mirrorPendingImport ? 1 : 0),
    actionQueue,
  };
}

export function buildRuntimeNotifyStatus(opts: RuntimeStateOptions = {}): RuntimeNotifyStatus {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const reports = [...taskStore.reports].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
  );
  return {
    generatedAt: now,
    total: reports.length,
    pendingCount: reports.filter((report) => report.state === "pending").length,
    deliveredCount: reports.filter((report) => report.state === "delivered").length,
    resolvedCount: reports.filter((report) => report.state === "resolved").length,
    waitingUserPendingCount: reports.filter(
      (report) => report.state === "pending" && report.kind === "waiting_user",
    ).length,
    proactiveReportCount: reports.filter(
      (report) => report.state === "delivered" && ! report.requiresUserAction,
    ).length,
    recentReports: reports.slice(0, 12).map((report) => ({
      id: report.id,
      taskId: report.taskId,
      runId: report.runId,
      reviewId: report.reviewId,
      taskStatus: report.taskStatus,
      kind: report.kind,
      state: report.state,
      reportPolicy: report.reportPolicy,
      reportVerbosity: report.reportVerbosity,
      interruptionThreshold: report.interruptionThreshold,
      confirmationBoundary: report.confirmationBoundary,
      title: report.title,
      summary: report.summary,
      nextAction: report.nextAction,
      requiresUserAction: report.requiresUserAction,
      reportTarget: report.reportTarget,
      surfaceId: report.surfaceId,
      surfaceLabel: report.surfaceLabel,
      agentId: report.agentId,
      sessionId: report.sessionId,
      escalationTarget: report.escalationTarget,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      deliveredAt: report.deliveredAt,
      resolvedAt: report.resolvedAt,
    })),
  };
}

function readRuntimeUserConsoleMaintenanceStatus(metadata: unknown): {
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lastSessionCleanupAt?: number;
} {
  const record = toRecord(metadata);
  const reviewIntervalHours = toNumber(record?.reviewIntervalHours, 12);
  const lastReviewAt = toNumber(record?.lastReviewAt, 0);
  const lastSessionCleanupAt = toNumber(record?.lastSessionCleanupAt, 0);
  return {
    enabled: record?.enabled !== false,
    reviewIntervalHours:
      Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
        ? Math.max(1, Math.min(168, Math.trunc(reviewIntervalHours)))
        : 12,
    lastReviewAt: lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
    lastSessionCleanupAt: lastSessionCleanupAt > 0 ? Math.trunc(lastSessionCleanupAt) : undefined,
  };
}

export function buildRuntimeUserConsoleStatus(
  opts: RuntimeStateOptions = {},
): RuntimeUserConsoleStatus {
  const now = resolveNow(opts.now);
  const store = loadRuntimeUserConsoleStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
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
  const mirror = buildRuntimeUserModelMirrorStatus({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfiles = listRuntimeResolvedSurfaceProfiles({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const actionQueue = buildUserConsoleActionQueue({
    now,
    taskStore,
    federationStore,
    userConsoleStore: store,
    mirrorStatus: mirror,
    surfaceProfiles,
    evolutionCandidates: buildRuntimeEvolutionCandidateStatuses(memoryStore, governanceStore),
  });
  const maintenance = readRuntimeUserConsoleMaintenanceStatus(store.metadata);
  return {
    generatedAt: now,
    model: store.userModel,
    mirror,
    maintenanceEnabled: maintenance.enabled,
    reviewIntervalHours: maintenance.reviewIntervalHours,
    lastReviewAt: maintenance.lastReviewAt,
    lastSessionCleanupAt: maintenance.lastSessionCleanupAt,
    workingSessionCount: store.sessionWorkingPreferences.filter(
      (entry) => !entry.expiresAt || entry.expiresAt > now,
    ).length,
    expiredSessionCount: store.sessionWorkingPreferences.filter(
      (entry) => !!entry.expiresAt && entry.expiresAt <= now,
    ).length,
    expiringSessionCount: store.sessionWorkingPreferences.filter(
      (entry) =>
        !!entry.expiresAt && entry.expiresAt > now && entry.expiresAt - now <= 24 * 60 * 60 * 1000,
    ).length,
    activeAgentCount: store.agents.filter((agent) => agent.active).length,
    activeSurfaceCount: store.surfaces.filter((surface) => surface.active).length,
    userOwnedSurfaceCount: store.surfaces.filter((surface) => surface.ownerKind === "user").length,
    recommendedUserModelOptimizationCount: store.userModelOptimizationCandidates.filter(
      (candidate) => candidate.state === "recommended",
    ).length,
    shadowUserModelOptimizationCount: store.userModelOptimizationCandidates.filter(
      (candidate) => candidate.state === "shadow",
    ).length,
    recommendedRoleOptimizationCount: store.roleOptimizationCandidates.filter(
      (candidate) => candidate.state === "recommended",
    ).length,
    shadowRoleOptimizationCount: store.roleOptimizationCandidates.filter(
      (candidate) => candidate.state === "shadow",
    ).length,
    waitingUserTaskCount: actionQueue.waitingUserTaskCount,
    recommendedFederationPackageCount: actionQueue.recommendedFederationPackageCount,
    adoptedCoordinatorSuggestionCount: actionQueue.adoptedCoordinatorSuggestionCount,
    pendingActionCount: actionQueue.pendingActionCount,
    actionQueue: actionQueue.actionQueue,
  };
}

type RuntimeEcologyAggregate = {
  openTaskCount: number;
  waitingUserTaskCount: number;
  recentReportCount: number;
  recentCompletionReportCount: number;
  followUpPressureCount: number;
  blockedReportCount: number;
  waitingExternalReportCount: number;
  recentIntelDeliveryCount: number;
  pendingRoleOptimizationCount: number;
  pendingCoordinatorSuggestionCount: number;
  materializedCoordinatorSuggestionCount: number;
  latestActivityAt?: number;
  recentActivity: RuntimeEcologyActivityStatus[];
};

type RuntimeEcologyStatusBundle = {
  agents: RuntimeAgentStatus[];
  surfaces: RuntimeSurfaceStatus[];
};

function createRuntimeEcologyAggregate(): RuntimeEcologyAggregate {
  return {
    openTaskCount: 0,
    waitingUserTaskCount: 0,
    recentReportCount: 0,
    recentCompletionReportCount: 0,
    followUpPressureCount: 0,
    blockedReportCount: 0,
    waitingExternalReportCount: 0,
    recentIntelDeliveryCount: 0,
    pendingRoleOptimizationCount: 0,
    pendingCoordinatorSuggestionCount: 0,
    materializedCoordinatorSuggestionCount: 0,
    latestActivityAt: undefined,
    recentActivity: [],
  };
}

const RUNTIME_ECOLOGY_REPORT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function compareRuntimeEcologyActivity(
  left: RuntimeEcologyActivityStatus,
  right: RuntimeEcologyActivityStatus,
): number {
  return (
    right.updatedAt - left.updatedAt ||
    left.kind.localeCompare(right.kind) ||
    left.title.localeCompare(right.title)
  );
}

function pushRuntimeEcologyActivity(
  aggregate: RuntimeEcologyAggregate | undefined,
  activity: RuntimeEcologyActivityStatus,
) {
  if (!aggregate) {
    return;
  }
  aggregate.recentActivity.push(activity);
  if (!aggregate.latestActivityAt || activity.updatedAt > aggregate.latestActivityAt) {
    aggregate.latestActivityAt = activity.updatedAt;
  }
}

function resolveTaskSurfaceId(task: TaskRecord): string | undefined {
  const metadata = toRecord(task.metadata);
  const surface = toRecord(metadata?.surface);
  const directSurfaceId = toStringValue(surface?.surfaceId).trim();
  if (directSurfaceId) {
    return directSurfaceId;
  }
  const taggedSurface = (task.tags ?? []).find(
    (entry) => typeof entry === "string" && entry.startsWith("surface:"),
  );
  return taggedSurface ? taggedSurface.slice("surface:".length).trim() || undefined : undefined;
}

function resolveTaskAgentIds(
  task: TaskRecord,
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
): string[] {
  const metadata = toRecord(task.metadata);
  const taskContext = toRecord(metadata?.taskContext);
  const surface = toRecord(metadata?.surface);
  const surfaceId = resolveTaskSurfaceId(task);
  return uniqueStrings([
    toStringValue(taskContext?.agentId).trim() || undefined,
    toStringValue(surface?.ownerKind) === "agent" ? toStringValue(surface?.ownerId).trim() : undefined,
    surfaceId && surfaceProfilesById.get(surfaceId)?.surface.ownerKind === "agent"
      ? surfaceProfilesById.get(surfaceId)?.surface.ownerId
      : undefined,
  ]);
}

function buildTaskEcologyActivity(task: TaskRecord): RuntimeEcologyActivityStatus {
  const summaryParts = [
    `status=${task.status}`,
    task.route ? `route=${task.route}` : undefined,
    task.worker ? `worker=${task.worker}` : undefined,
    task.nextAction ? `next=${task.nextAction}` : undefined,
  ];
  return {
    id: `task:${task.id}`,
    kind: "task",
    title: task.title,
    summary: summaryParts.filter(Boolean).join(" · "),
    updatedAt: task.updatedAt,
    status: task.status,
    taskId: task.id,
    route: task.route,
    worker: task.worker,
  };
}

function resolveTaskReportEcologyTimestamp(report: TaskReportRecord): number {
  return Math.max(
    report.resolvedAt ?? 0,
    report.deliveredAt ?? 0,
    report.updatedAt ?? 0,
    report.createdAt ?? 0,
  );
}

function resolveTaskReportAgentIds(
  report: TaskReportRecord,
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
): string[] {
  const ownerAgentId =
    report.surfaceId && surfaceProfilesById.get(report.surfaceId)?.surface.ownerKind === "agent"
      ? surfaceProfilesById.get(report.surfaceId)?.surface.ownerId
      : undefined;
  return uniqueStrings([report.agentId, ownerAgentId]);
}

function buildTaskReportEcologyActivity(report: TaskReportRecord): RuntimeEcologyActivityStatus {
  return {
    id: `task-report:${report.id}`,
    kind: "task_report",
    title: report.title,
    summary: uniqueStrings([
      `kind=${report.kind}`,
      `state=${report.state}`,
      report.reportTarget ? `target=${report.reportTarget}` : undefined,
      report.escalationTarget ? `escalate=${report.escalationTarget}` : undefined,
      report.nextAction ? `next=${report.nextAction}` : undefined,
    ]).join(" · "),
    updatedAt: resolveTaskReportEcologyTimestamp(report),
    status: report.state,
    taskId: report.taskId,
  };
}

function resolveSuggestionSurfaceId(suggestion: { metadata?: RuntimeMetadata }): string | undefined {
  const metadata = toRecord(suggestion.metadata);
  const surfaceId = toStringValue(metadata?.surfaceId).trim();
  return surfaceId || undefined;
}

function resolveSuggestionAgentIds(
  suggestion: {
    metadata?: RuntimeMetadata;
  },
  surfaceProfilesById: Map<
    string,
    ReturnType<typeof listRuntimeResolvedSurfaceProfiles>[number]
  >,
): string[] {
  const metadata = toRecord(suggestion.metadata);
  const surfaceId = resolveSuggestionSurfaceId(suggestion);
  return uniqueStrings([
    toStringValue(metadata?.agentId).trim() || undefined,
    surfaceId && surfaceProfilesById.get(surfaceId)?.surface.ownerKind === "agent"
      ? surfaceProfilesById.get(surfaceId)?.surface.ownerId
      : undefined,
  ]);
}

function resolveCoordinatorSuggestionLifecycleState(params: {
  localTaskId?: string;
  localTaskStatus?: TaskStatus | "missing";
  rematerializeReason?: string;
}): "queued" | "requeued" | "materialized" | "completed" {
  if (params.localTaskId) {
    return params.localTaskStatus === "completed" ? "completed" : "materialized";
  }
  return normalizeText(params.rematerializeReason) ? "requeued" : "queued";
}

function buildCoordinatorSuggestionEcologyActivity(
  suggestion: {
    id: string;
    title: string;
    summary: string;
    sourceRuntimeId: string;
    updatedAt: number;
    localTaskId?: string;
    localTaskStatus?: TaskStatus | "missing";
    lastMaterializedLocalTaskId?: string;
    rematerializeReason?: string;
    materializedAt?: number;
    metadata?: RuntimeMetadata;
  },
): RuntimeEcologyActivityStatus {
  const metadata = toRecord(suggestion.metadata);
  const state = resolveCoordinatorSuggestionLifecycleState(suggestion);
  return {
    id: `coordinator:${suggestion.id}`,
    kind: "coordinator_suggestion",
    title: suggestion.title,
    summary: [
      `state=${state}`,
      toStringValue(metadata?.route).trim() ? `route=${toStringValue(metadata?.route).trim()}` : undefined,
      toStringValue(metadata?.worker).trim()
        ? `worker=${toStringValue(metadata?.worker).trim()}`
        : undefined,
      suggestion.localTaskId ? `localTask=${suggestion.localTaskId}` : undefined,
      suggestion.localTaskStatus ? `localTaskStatus=${suggestion.localTaskStatus}` : undefined,
      suggestion.lastMaterializedLocalTaskId && !suggestion.localTaskId
        ? `lastLocalTask=${suggestion.lastMaterializedLocalTaskId}`
        : undefined,
      suggestion.rematerializeReason ? `requeue=${suggestion.rematerializeReason}` : undefined,
      suggestion.summary,
    ]
      .filter(Boolean)
      .join(" · "),
    updatedAt: suggestion.updatedAt,
    status: state,
    taskId: suggestion.localTaskId,
    route: toStringValue(metadata?.route).trim() || undefined,
    worker: toStringValue(metadata?.worker).trim() || undefined,
    sourceRuntimeId: suggestion.sourceRuntimeId,
  };
}

function buildRoleOptimizationEcologyActivity(
  candidate: RuntimeUserConsoleStore["roleOptimizationCandidates"][number],
): RuntimeEcologyActivityStatus {
  return {
    id: `role-optimization:${candidate.id}`,
    kind: "role_optimization",
    title: candidate.summary,
    summary: [
      `state=${candidate.state}`,
      `source=${candidate.source}`,
      `confidence=${normalizeConfidencePercent(candidate.confidence)}%`,
    ].join(" · "),
    updatedAt: candidate.updatedAt,
    status: candidate.state,
  };
}

function buildSurfacePolicyEcologyActivity(
  event: ReturnType<typeof readRuntimeEvents>[number],
): RuntimeEcologyActivityStatus | undefined {
  const payload = toRecord(event.payload);
  const surfaceId = toStringValue(payload?.surfaceId).trim();
  if (!surfaceId) {
    return undefined;
  }
  if (event.type === "runtime_surface_role_overlay_updated") {
    return {
      id: `surface-policy:${event.id}`,
      kind: "surface_policy",
      title: "Surface role overlay updated",
      summary: [
        toStringValue(payload?.channel).trim() ? `channel=${toStringValue(payload?.channel).trim()}` : undefined,
        toStringValue(payload?.role).trim() ? `role=${toStringValue(payload?.role).trim()}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      updatedAt: event.createdAt,
      status: "updated",
    };
  }
  if (event.type === "runtime_role_optimization_adopted") {
    return {
      id: `surface-policy:${event.id}`,
      kind: "surface_policy",
      title: "Role optimization adopted",
      summary: toStringValue(payload?.candidateId).trim()
        ? `candidate=${toStringValue(payload?.candidateId).trim()}`
        : "Local role suggestion adopted.",
      updatedAt: event.createdAt,
      status: "adopted",
    };
  }
  if (event.type === "runtime_role_optimization_rejected") {
    return {
      id: `surface-policy:${event.id}`,
      kind: "surface_policy",
      title: "Role optimization rejected",
      summary:
        toStringValue(payload?.reason).trim() ||
        (toStringValue(payload?.candidateId).trim()
          ? `candidate=${toStringValue(payload?.candidateId).trim()}`
          : "Local role suggestion rejected."),
      updatedAt: event.createdAt,
      status: "rejected",
    };
  }
  return undefined;
}

function buildRuntimeEcologyStatusBundle(
  opts: RuntimeStateOptions = {},
): RuntimeEcologyStatusBundle {
  const now = resolveNow(opts.now);
  const store = loadRuntimeUserConsoleStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfiles = listRuntimeResolvedSurfaceProfiles({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfilesById = new Map(surfaceProfiles.map((profile) => [profile.surface.id, profile] as const));
  const overlaysByAgentId = new Map(
    store.agentOverlays.map((overlay) => [overlay.agentId, overlay]),
  );
  const surfaceCounts = countBy(
    store.surfaces
      .filter((surface) => surface.ownerKind === "agent" && surface.ownerId)
      .map((surface) => surface.ownerId as string),
  );
  const agentAggregates = new Map(
    store.agents.map((agent) => [agent.id, createRuntimeEcologyAggregate()] as const),
  );
  const surfaceAggregates = new Map(
    store.surfaces.map((surface) => [surface.id, createRuntimeEcologyAggregate()] as const),
  );

  for (const task of taskStore.tasks) {
    const surfaceId = resolveTaskSurfaceId(task);
    const agentIds = resolveTaskAgentIds(task, surfaceProfilesById);
    const openTask = task.status !== "completed" && task.status !== "cancelled";
    const taskActivity = buildTaskEcologyActivity(task);
    if (surfaceId) {
      const surfaceAggregate = surfaceAggregates.get(surfaceId);
      if (surfaceAggregate) {
        if (openTask) {
          surfaceAggregate.openTaskCount += 1;
        }
        if (task.status === "waiting_user") {
          surfaceAggregate.waitingUserTaskCount += 1;
        }
        pushRuntimeEcologyActivity(surfaceAggregate, taskActivity);
      }
    }
    for (const agentId of agentIds) {
      const agentAggregate = agentAggregates.get(agentId);
      if (!agentAggregate) {
        continue;
      }
      if (openTask) {
        agentAggregate.openTaskCount += 1;
      }
      if (task.status === "waiting_user") {
        agentAggregate.waitingUserTaskCount += 1;
      }
      pushRuntimeEcologyActivity(agentAggregate, taskActivity);
    }
  }

  for (const report of taskStore.reports) {
    const reportTimestamp = resolveTaskReportEcologyTimestamp(report);
    if (now - reportTimestamp > RUNTIME_ECOLOGY_REPORT_LOOKBACK_MS) {
      continue;
    }
    const taskReportActivity = buildTaskReportEcologyActivity(report);
    const followUpPressure = report.kind === "waiting_user" || report.kind === "blocked";
    if (report.surfaceId) {
      const surfaceAggregate = surfaceAggregates.get(report.surfaceId);
      if (surfaceAggregate) {
        surfaceAggregate.recentReportCount += 1;
        if (report.kind === "completion") {
          surfaceAggregate.recentCompletionReportCount += 1;
        }
        if (followUpPressure) {
          surfaceAggregate.followUpPressureCount += 1;
        }
        if (report.kind === "blocked") {
          surfaceAggregate.blockedReportCount += 1;
        }
        if (report.kind === "waiting_external") {
          surfaceAggregate.waitingExternalReportCount += 1;
        }
        pushRuntimeEcologyActivity(surfaceAggregate, taskReportActivity);
      }
    }
    for (const agentId of resolveTaskReportAgentIds(report, surfaceProfilesById)) {
      const agentAggregate = agentAggregates.get(agentId);
      if (!agentAggregate) {
        continue;
      }
      agentAggregate.recentReportCount += 1;
      if (report.kind === "completion") {
        agentAggregate.recentCompletionReportCount += 1;
      }
      if (followUpPressure) {
        agentAggregate.followUpPressureCount += 1;
      }
      if (report.kind === "blocked") {
        agentAggregate.blockedReportCount += 1;
      }
      if (report.kind === "waiting_external") {
        agentAggregate.waitingExternalReportCount += 1;
      }
      pushRuntimeEcologyActivity(agentAggregate, taskReportActivity);
    }
  }

  for (const delivery of listRuntimeIntelDeliveryHistory(
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
    80,
  )) {
    const activity: RuntimeEcologyActivityStatus = {
      id: `intel:${delivery.id}`,
      kind: "intel_delivery",
      title: delivery.title,
      summary: [
        `kind=${delivery.kind}`,
        `domain=${delivery.domain}`,
        delivery.targetLabel ? `target=${delivery.targetLabel}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      updatedAt: delivery.deliveredAt,
      status: delivery.kind,
      domain: delivery.domain,
    };
    if (delivery.targetKind === "agent") {
      const agentId = delivery.targetId.startsWith("agent:")
        ? delivery.targetId.slice("agent:".length)
        : delivery.targetId;
      const aggregate = agentAggregates.get(agentId);
      if (aggregate) {
        aggregate.recentIntelDeliveryCount += 1;
        pushRuntimeEcologyActivity(aggregate, activity);
      }
    }
    if (delivery.targetKind === "surface") {
      const surfaceId = delivery.targetId.startsWith("surface:")
        ? delivery.targetId.slice("surface:".length)
        : delivery.targetId;
      const surfaceAggregate = surfaceAggregates.get(surfaceId);
      if (surfaceAggregate) {
        surfaceAggregate.recentIntelDeliveryCount += 1;
        pushRuntimeEcologyActivity(surfaceAggregate, activity);
      }
      const ownerAgentId =
        surfaceId && surfaceProfilesById.get(surfaceId)?.surface.ownerKind === "agent"
          ? surfaceProfilesById.get(surfaceId)?.surface.ownerId
          : undefined;
      if (ownerAgentId) {
        const agentAggregate = agentAggregates.get(ownerAgentId);
        if (agentAggregate) {
          agentAggregate.recentIntelDeliveryCount += 1;
          pushRuntimeEcologyActivity(agentAggregate, activity);
        }
      }
    }
  }

  for (const candidate of store.roleOptimizationCandidates) {
    const pending = candidate.state === "shadow" || candidate.state === "recommended";
    const activity = buildRoleOptimizationEcologyActivity(candidate);
    const surfaceAggregate = surfaceAggregates.get(candidate.surfaceId);
    if (surfaceAggregate) {
      if (pending) {
        surfaceAggregate.pendingRoleOptimizationCount += 1;
      }
      pushRuntimeEcologyActivity(surfaceAggregate, activity);
    }
    for (const agentId of uniqueStrings([
      candidate.agentId,
      candidate.surfaceId && surfaceProfilesById.get(candidate.surfaceId)?.surface.ownerKind === "agent"
        ? surfaceProfilesById.get(candidate.surfaceId)?.surface.ownerId
        : undefined,
    ])) {
      const agentAggregate = agentAggregates.get(agentId);
      if (!agentAggregate) {
        continue;
      }
      if (pending) {
        agentAggregate.pendingRoleOptimizationCount += 1;
      }
      pushRuntimeEcologyActivity(agentAggregate, activity);
    }
  }

  for (const suggestion of federationStore.coordinatorSuggestions) {
    const activity = buildCoordinatorSuggestionEcologyActivity(suggestion);
    const surfaceId = resolveSuggestionSurfaceId(suggestion);
    const materialized = !!suggestion.localTaskId || !!suggestion.materializedAt;
    if (surfaceId) {
      const surfaceAggregate = surfaceAggregates.get(surfaceId);
      if (surfaceAggregate) {
        if (materialized) {
          surfaceAggregate.materializedCoordinatorSuggestionCount += 1;
        } else {
          surfaceAggregate.pendingCoordinatorSuggestionCount += 1;
        }
        pushRuntimeEcologyActivity(surfaceAggregate, activity);
      }
    }
    for (const agentId of resolveSuggestionAgentIds(suggestion, surfaceProfilesById)) {
      const agentAggregate = agentAggregates.get(agentId);
      if (!agentAggregate) {
        continue;
      }
      if (materialized) {
        agentAggregate.materializedCoordinatorSuggestionCount += 1;
      } else {
        agentAggregate.pendingCoordinatorSuggestionCount += 1;
      }
      pushRuntimeEcologyActivity(agentAggregate, activity);
    }
  }

  for (const event of readRuntimeEvents(120, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  })) {
    const activity = buildSurfacePolicyEcologyActivity(event);
    const payload = toRecord(event.payload);
    const surfaceId = toStringValue(payload?.surfaceId).trim();
    if (!activity || !surfaceId) {
      continue;
    }
    pushRuntimeEcologyActivity(surfaceAggregates.get(surfaceId), activity);
    const ownerAgentId =
      surfaceProfilesById.get(surfaceId)?.surface.ownerKind === "agent"
        ? surfaceProfilesById.get(surfaceId)?.surface.ownerId
        : undefined;
    if (ownerAgentId) {
      pushRuntimeEcologyActivity(agentAggregates.get(ownerAgentId), activity);
    }
  }

  const agents = [...store.agents]
    .map((agent) => {
      const aggregate = agentAggregates.get(agent.id) ?? createRuntimeEcologyAggregate();
      return {
        id: agent.id,
        name: agent.name,
        roleBase: agent.roleBase,
        active: agent.active,
        skillCount: agent.skillIds.length,
        surfaceCount: surfaceCounts[agent.id] ?? 0,
        openTaskCount: aggregate.openTaskCount,
        waitingUserTaskCount: aggregate.waitingUserTaskCount,
        recentReportCount: aggregate.recentReportCount,
        recentCompletionReportCount: aggregate.recentCompletionReportCount,
        followUpPressureCount: aggregate.followUpPressureCount,
        blockedReportCount: aggregate.blockedReportCount,
        waitingExternalReportCount: aggregate.waitingExternalReportCount,
        recentIntelDeliveryCount: aggregate.recentIntelDeliveryCount,
        pendingRoleOptimizationCount: aggregate.pendingRoleOptimizationCount,
        pendingCoordinatorSuggestionCount: aggregate.pendingCoordinatorSuggestionCount,
        materializedCoordinatorSuggestionCount: aggregate.materializedCoordinatorSuggestionCount,
        reportPolicy: overlaysByAgentId.get(agent.id)?.reportPolicy,
        latestActivityAt: aggregate.latestActivityAt,
        recentActivity: [...aggregate.recentActivity]
          .toSorted(compareRuntimeEcologyActivity)
          .slice(0, 5),
        updatedAt: agent.updatedAt,
      } satisfies RuntimeAgentStatus;
    })
    .toSorted(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (right.latestActivityAt ?? right.updatedAt) - (left.latestActivityAt ?? left.updatedAt) ||
        left.name.localeCompare(right.name),
    );

  const surfaces = surfaceProfiles
    .map((profile) => {
      const surface = profile.surface;
      const aggregate = surfaceAggregates.get(surface.id) ?? createRuntimeEcologyAggregate();
      return {
        id: surface.id,
        label: surface.label,
        channel: surface.channel,
        accountId: surface.accountId,
        ownerKind: surface.ownerKind,
        ownerId: surface.ownerId,
        ownerLabel: profile.ownerLabel,
        active: surface.active,
        role: profile.effectiveRole,
        businessGoal: profile.effectiveBusinessGoal,
        tone: profile.effectiveTone,
        initiative: profile.effectiveInitiative,
        reportTarget: profile.effectiveReportTarget,
        allowedTopics: profile.effectiveAllowedTopics,
        restrictedTopics: profile.effectiveRestrictedTopics,
        localBusinessPolicy: profile.effectiveLocalBusinessPolicy,
        localBusinessPolicySource: profile.sources.localBusinessPolicy,
        overlayPresent: profile.overlayPresent,
        roleSource: profile.sources.role,
        toneSource: profile.sources.tone,
        openTaskCount: aggregate.openTaskCount,
        waitingUserTaskCount: aggregate.waitingUserTaskCount,
        recentReportCount: aggregate.recentReportCount,
        recentCompletionReportCount: aggregate.recentCompletionReportCount,
        followUpPressureCount: aggregate.followUpPressureCount,
        blockedReportCount: aggregate.blockedReportCount,
        waitingExternalReportCount: aggregate.waitingExternalReportCount,
        recentIntelDeliveryCount: aggregate.recentIntelDeliveryCount,
        pendingRoleOptimizationCount: aggregate.pendingRoleOptimizationCount,
        pendingCoordinatorSuggestionCount: aggregate.pendingCoordinatorSuggestionCount,
        materializedCoordinatorSuggestionCount: aggregate.materializedCoordinatorSuggestionCount,
        latestActivityAt: aggregate.latestActivityAt,
        recentActivity: [...aggregate.recentActivity]
          .toSorted(compareRuntimeEcologyActivity)
          .slice(0, 5),
        updatedAt: profile.updatedAt,
      } satisfies RuntimeSurfaceStatus;
    })
    .toSorted(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (right.latestActivityAt ?? right.updatedAt) - (left.latestActivityAt ?? left.updatedAt) ||
        left.label.localeCompare(right.label),
    );

  return {
    agents,
    surfaces,
  };
}

export function buildRuntimeAgentStatuses(opts: RuntimeStateOptions = {}): RuntimeAgentStatus[] {
  return buildRuntimeEcologyStatusBundle(opts).agents;
}

export function buildRuntimeSurfaceStatuses(
  opts: RuntimeStateOptions = {},
): RuntimeSurfaceStatus[] {
  return buildRuntimeEcologyStatusBundle(opts).surfaces;
}

export function buildRuntimeIntelStatus(opts: RuntimeStateOptions = {}): RuntimeIntelStatus {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const panelConfig = resolveRuntimeIntelPanelConfig(intelStore);
  const refreshAudit = buildRuntimeIntelRefreshAudit(intelStore, now);
  const deliveryPreview = previewRuntimeIntelDeliveries({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const panelSources = listRuntimeIntelPanelSources(intelStore);
  const domainDefinitions = listRuntimeIntelDomainDefinitions(intelStore);
  const detectedDomainIds = new Set<IntelCandidate["domain"]>(
    domainDefinitions.map((entry) => entry.id),
  );
  for (const candidate of intelStore.candidates) {
    detectedDomainIds.add(candidate.domain);
  }
  for (const digestItem of intelStore.digestItems) {
    detectedDomainIds.add(digestItem.domain);
  }
  for (const sourceProfile of intelStore.sourceProfiles) {
    detectedDomainIds.add(sourceProfile.domain);
  }
  const domainIds = [...detectedDomainIds].toSorted(
    (left, right) =>
      RUNTIME_INTEL_DOMAIN_ORDER.indexOf(left) - RUNTIME_INTEL_DOMAIN_ORDER.indexOf(right),
  );
  const sourceAuditRoot = toRecord(intelStore.metadata?.sources);
  const sources = panelSources.map((source) => {
    const profile = intelStore.sourceProfiles.find(
      (entry) =>
        entry.domain === source.domain &&
        (entry.label === source.id || entry.id === source.id || entry.label === source.label),
    );
    const sourceAudit = toRecord(sourceAuditRoot?.[source.id]);
    const metadata = toRecord(profile?.metadata);
    const sourceLastRefreshAt = toNumber(sourceAudit?.lastRefreshAt, 0) || null;
    const sourceLastSuccessfulRefreshAt =
      toNumber(sourceAudit?.lastSuccessfulRefreshAt, 0) || null;
    const latestFetchAt =
      toNumber(metadata?.latestFetchAt ?? metadata?.lastFetchedAt, 0) ||
      toNumber(sourceAudit?.lastFetchedAt, 0) ||
      null;
    const refreshMinutes = toNumber(sourceAudit?.refreshMinutes, panelConfig.refreshMinutes);
    const nextRefreshAt =
      source.enabled && panelConfig.enabled
        ? latestFetchAt
          ? latestFetchAt + refreshMinutes * 60 * 1000
          : now
        : null;
    const lastError = toStringValue(sourceAudit?.lastError) || undefined;
    const stale =
      source.enabled && panelConfig.enabled ? nextRefreshAt == null || now >= nextRefreshAt : false;
    return {
      id: source.id,
      domain: source.domain,
      kind: source.kind,
      label: source.label,
      priority: source.priority,
      enabled: source.enabled,
      refreshStatus: !panelConfig.enabled || !source.enabled
        ? "paused"
        : lastError
          ? "error"
          : stale
            ? "stale"
            : "healthy",
      custom: source.custom,
      url: source.url,
      lastRefreshAt: sourceLastRefreshAt,
      lastSuccessfulRefreshAt: sourceLastSuccessfulRefreshAt,
      latestFetchAt,
      nextRefreshAt,
      stale,
      lastError,
    } satisfies RuntimeIntelSourceStatus;
  });
  const domains = domainIds.map((domainId) => {
    const domainDefinition = domainDefinitions.find((entry) => entry.id === domainId);
    const domainSources = sources.filter((entry) => entry.domain === domainId);
    const audit = refreshAudit.domains.find((entry) => entry.domain === domainId);
    return {
      id: domainId,
      label: domainDefinition?.label || labelRuntimeInfoDomain(domainId),
      enabled: panelConfig.enabledDomainIds.includes(domainId),
      refreshStatus: audit?.status ?? "paused",
      sourceCount: domainSources.length,
      enabledSourceCount: domainSources.filter((entry) => entry.enabled).length,
      candidateCount: intelStore.candidates.filter((entry) => entry.domain === domainId).length,
      selectedCount: intelStore.candidates.filter(
        (entry) => entry.domain === domainId && entry.selected,
      ).length,
      digestCount: intelStore.digestItems.filter((entry) => entry.domain === domainId).length,
      latestDeliveryAt:
        intelStore.digestItems
          .filter((entry) => entry.domain === domainId)
          .reduce((latest, entry) => Math.max(latest, entry.createdAt), 0) || null,
      latestFetchAt:
        domainSources.reduce((latest, entry) => Math.max(latest, entry.latestFetchAt || 0), 0) ||
        audit?.lastFetchedAt ||
        null,
      lastRefreshAt: audit?.lastRefreshAt ?? null,
      lastSuccessfulRefreshAt: audit?.lastSuccessfulRefreshAt ?? null,
      nextRefreshAt: audit?.nextRefreshAt ?? null,
      stale: audit?.stale ?? false,
      lastError: audit?.lastError,
    } satisfies RuntimeIntelDomainStatus;
  });
  const sourceStatusById = new Map<string, RuntimeIntelSourceStatus>();
  for (const source of sources) {
    sourceStatusById.set(source.id, source);
    sourceStatusById.set(source.label, source);
  }
  const recentDigestWindowMs = 7 * 24 * 60 * 60 * 1000;
  const recentDigestCountsBySource = new Map<string, number>();
  for (const digestItem of intelStore.digestItems) {
    if (!Number.isFinite(digestItem.createdAt) || now - digestItem.createdAt > recentDigestWindowMs) {
      continue;
    }
    for (const sourceId of digestItem.sourceIds) {
      const normalizedSourceId = toStringValue(sourceId);
      if (!normalizedSourceId) {
        continue;
      }
      recentDigestCountsBySource.set(
        normalizedSourceId,
        (recentDigestCountsBySource.get(normalizedSourceId) ?? 0) + 1,
      );
    }
  }
  const usefulnessBySource = new Map<
    string,
    {
      total: number;
      count: number;
    }
  >();
  for (const record of intelStore.usefulnessRecords) {
    const sourceId = toStringValue(record.sourceId);
    if (!sourceId) {
      continue;
    }
    const aggregate = usefulnessBySource.get(sourceId) ?? {
      total: 0,
      count: 0,
    };
    aggregate.total += normalizeConfidencePercent(record.usefulnessScore, 0);
    aggregate.count += 1;
    usefulnessBySource.set(sourceId, aggregate);
  }
  const sourceProfiles = [...intelStore.sourceProfiles]
    .map((profile) => {
      const aggregate = usefulnessBySource.get(profile.label);
      const metadata = toRecord(profile.metadata);
      const sourceStatus = sourceStatusById.get(profile.label) ?? sourceStatusById.get(profile.id);
      return {
        id: profile.id,
        domain: profile.domain,
        label: profile.label,
        priority: profile.priority,
        trustScore: normalizeConfidencePercent(profile.trustScore, 0),
        usefulnessScore:
          aggregate && aggregate.count > 0
            ? normalizeConfidencePercent(aggregate.total / aggregate.count, 0)
            : null,
        usefulnessCount: aggregate?.count ?? 0,
        recentDigestAppearances: recentDigestCountsBySource.get(profile.label) ?? 0,
        latestFetchAt:
          toNumber(metadata?.latestFetchAt ?? metadata?.lastFetchedAt, 0) ||
          sourceStatus?.latestFetchAt ||
          null,
        sourceType: toStringValue(metadata?.sourceType) || undefined,
      } satisfies RuntimeIntelSourceProfileStatus;
    })
    .toSorted(
      (left, right) =>
        right.trustScore - left.trustScore ||
        (right.usefulnessScore ?? -1) - (left.usefulnessScore ?? -1) ||
        right.recentDigestAppearances - left.recentDigestAppearances ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 12);
  const topicProfiles = [...intelStore.topicProfiles]
    .map((profile) => {
      const topicLower = profile.topic.toLowerCase();
      const recentDigestMentions = intelStore.digestItems.filter((entry) => {
        if (entry.domain !== profile.domain) {
          return false;
        }
        if (!Number.isFinite(entry.createdAt) || now - entry.createdAt > recentDigestWindowMs) {
          return false;
        }
        const haystack = `${entry.title} ${entry.conclusion} ${entry.whyItMatters}`.toLowerCase();
        return haystack.includes(topicLower);
      }).length;
      return {
        id: profile.id,
        domain: profile.domain,
        topic: profile.topic,
        weight: normalizeConfidencePercent(profile.weight, 0),
        updatedAt: profile.updatedAt,
        recentDigestMentions,
        sourceId: toStringValue(toRecord(profile.metadata)?.sourceId) || undefined,
      } satisfies RuntimeIntelTopicProfileStatus;
    })
    .toSorted(
      (left, right) =>
        right.weight - left.weight ||
        right.recentDigestMentions - left.recentDigestMentions ||
        right.updatedAt - left.updatedAt ||
        left.topic.localeCompare(right.topic),
    )
    .slice(0, 12);
  const pinnedIntelIds = new Set(intelStore.pinnedRecords.map((entry) => entry.intelId));
  const pinnedRecordsByIntelId = new Map(
    intelStore.pinnedRecords.map((entry) => [entry.intelId, entry] as const),
  );
  const intelTitleById = new Map<string, string>();
  for (const digestItem of intelStore.digestItems) {
    intelTitleById.set(digestItem.id, digestItem.title);
    const candidateId = toStringValue(toRecord(digestItem.metadata)?.candidateId);
    if (candidateId && !intelTitleById.has(candidateId)) {
      intelTitleById.set(candidateId, digestItem.title);
    }
  }
  for (const candidate of intelStore.candidates) {
    intelTitleById.set(candidate.id, candidate.title);
  }
  const usefulnessHistory = [...intelStore.usefulnessRecords]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, 12)
    .map((record) => ({
      id: record.id,
      intelId: record.intelId,
      sourceId: record.sourceId,
      domain: record.domain,
      usefulnessScore: normalizeConfidencePercent(record.usefulnessScore, 0),
      reason: toStringValue(record.reason) || undefined,
      createdAt: record.createdAt,
      title:
        toStringValue(toRecord(record.metadata)?.title) ||
        intelTitleById.get(record.intelId) ||
        undefined,
      promotedToMemoryId: pinnedRecordsByIntelId.get(record.intelId)?.promotedToMemoryId,
    } satisfies RuntimeIntelUsefulnessStatus));
  const digestHistory = [...intelStore.digestItems]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, 12)
    .map((entry) => ({
      id: entry.id,
      domain: entry.domain,
      title: entry.title,
      exploit: entry.exploit,
      createdAt: entry.createdAt,
      sourceIds: [...entry.sourceIds],
      whyItMatters: entry.whyItMatters,
      recommendedAttention: entry.recommendedAttention,
      recommendedAction: entry.recommendedAction,
      url: toStringValue(toRecord(entry.metadata)?.sourceUrl) || undefined,
      candidateId: toStringValue(toRecord(entry.metadata)?.candidateId) || undefined,
    } satisfies RuntimeIntelDigestHistoryStatus));
  const rankHistory = [...intelStore.rankRecords]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, 16)
    .map((entry) => ({
      id: entry.id,
      intelId: entry.intelId,
      sourceId: entry.sourceId,
      domain: entry.domain,
      title:
        toStringValue(toRecord(entry.metadata)?.title) ||
        intelTitleById.get(entry.intelId) ||
        "Untitled intel",
      selectionRank:
        typeof entry.selectionRank === "number" && Number.isFinite(entry.selectionRank)
          ? Math.max(1, Math.trunc(entry.selectionRank))
          : undefined,
      explorationRank:
        typeof entry.explorationRank === "number" && Number.isFinite(entry.explorationRank)
          ? Math.max(1, Math.trunc(entry.explorationRank))
          : undefined,
      selectionScore: normalizeConfidencePercent(entry.selectionScore, 0),
      explorationScore: normalizeConfidencePercent(entry.explorationScore, 0),
      selected:  entry.selected,
      selectedMode:
        entry.selectedMode === "exploit" ||
        entry.selectedMode === "explore" ||
        entry.selectedMode === "none"
          ? entry.selectedMode
          : entry.selected
            ? "exploit"
            : "none",
      createdAt: entry.createdAt,
      topicFingerprint: toStringValue(toRecord(entry.metadata)?.topicFingerprint) || undefined,
    } satisfies RuntimeIntelRankHistoryStatus));
  const recentItems = [
    ...intelStore.digestItems.map((entry) => ({
      id: entry.id,
      kind: "digest" as const,
      domain: entry.domain,
      title: entry.title,
      summary: entry.conclusion,
      score: entry.exploit ? 92 : 80,
      exploit: entry.exploit,
      createdAt: entry.createdAt,
      sourceLabel: entry.sourceIds.join(", "),
      selected: true,
      pinned: pinnedIntelIds.has(entry.id),
      url: toStringValue(toRecord(entry.metadata)?.sourceUrl) || undefined,
    })),
    ...intelStore.candidates.map((entry) => ({
      id: entry.id,
      kind: "candidate" as const,
      domain: entry.domain,
      title: entry.title,
      summary: toStringValue(entry.summary),
      score: normalizeConfidencePercent(entry.score, 0),
      exploit: false,
      createdAt: entry.createdAt,
      sourceLabel: entry.sourceId,
      selected: entry.selected,
      pinned: pinnedIntelIds.has(entry.id),
      url: entry.url,
    })),
  ]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, 10);
  const deliveryTargets = resolveRuntimeIntelDeliveryTargets(intelStore, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const mapDeliveryTarget = (target: IntelDeliveryTarget): RuntimeIntelDeliveryTargetStatus => ({
    id: target.id,
    kind: target.kind,
    label: target.label,
    active: target.active,
    channel: target.channel,
    ownerLabel:
      typeof target.ownerLabel === "string" && target.ownerLabel.trim().length > 0
        ? target.ownerLabel
        : undefined,
  });
  const pendingDeliveries = deliveryPreview.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    digestItemId: item.digestItemId,
    domain: item.domain,
    title: item.title,
    summary: item.summary,
    score: item.score,
    exploit: item.exploit,
    createdAt: item.createdAt,
    targetCount: item.targets.length,
    targetLabels: item.targets.map((target) => target.label),
    url: item.url,
  }));
  const recentDeliveries = listRuntimeIntelDeliveryHistory(
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
    12,
  ).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    digestItemId: entry.digestItemId,
    targetId: entry.targetId,
    targetKind: entry.targetKind,
    targetLabel: entry.targetLabel,
    domain: entry.domain,
    title: entry.title,
    deliveredAt: entry.deliveredAt,
    channel:
      typeof toRecord(entry.metadata)?.channel === "string"
        ? (toRecord(entry.metadata)?.channel as string)
        : undefined,
  }));
  return {
    generatedAt: now,
    enabled: panelConfig.enabled,
    digestEnabled: panelConfig.digestEnabled,
    refreshMinutes: panelConfig.refreshMinutes,
    lastRefreshAt: refreshAudit.lastRefreshAt,
    lastSuccessfulRefreshAt: refreshAudit.lastSuccessfulRefreshAt,
    lastRefreshOutcome: refreshAudit.lastRefreshOutcome,
    nextRefreshAt: refreshAudit.nextRefreshAt,
    staleDomainCount: refreshAudit.staleDomainCount,
    errorDomainCount: refreshAudit.errorDomainCount,
    modulePausedReason: refreshAudit.modulePausedReason,
    enabledDomainIds: panelConfig.enabledDomainIds,
    dailyPushEnabled: panelConfig.dailyPushEnabled,
    dailyPushItemCount: panelConfig.dailyPushItemCount,
    dailyPushHourLocal: panelConfig.dailyPushHourLocal,
    dailyPushMinuteLocal: panelConfig.dailyPushMinuteLocal,
    instantPushEnabled: panelConfig.instantPushEnabled,
    instantPushMinScore: panelConfig.instantPushMinScore,
    dailyPushTargets: deliveryTargets.dailyTargets.map(mapDeliveryTarget),
    instantPushTargets: deliveryTargets.instantTargets.map(mapDeliveryTarget),
    availableTargets: deliveryTargets.availableTargets.map(mapDeliveryTarget),
    staleDailyTargetIds: deliveryTargets.staleDailyTargetIds,
    staleInstantTargetIds: deliveryTargets.staleInstantTargetIds,
    nextDailyPushAt: deliveryPreview.nextDailyPushAt,
    lastDailyPushAt: deliveryPreview.lastDailyPushAt,
    lastInstantPushAt: deliveryPreview.lastInstantPushAt,
    pendingDailyDigestCount: deliveryPreview.dailyDigestCount,
    pendingInstantAlertCount: deliveryPreview.instantAlertCount,
    candidateLimitPerDomain: panelConfig.candidateLimitPerDomain,
    digestItemLimitPerDomain: panelConfig.digestItemLimitPerDomain,
    exploitItemsPerDigest: panelConfig.exploitItemsPerDigest,
    exploreItemsPerDigest: panelConfig.exploreItemsPerDigest,
    itemCount: intelStore.candidates.length,
    digestCount: intelStore.digestItems.length,
    customSourceCount: sources.filter((entry) => entry.custom).length,
    domains,
    sources,
    sourceProfiles,
    topicProfiles,
    usefulnessHistory,
    digestHistory,
    rankHistory,
    recentItems,
    pendingDeliveries,
    recentDeliveries,
  };
}

function countObjectEntries(value: unknown): number {
  const record = toRecord(value);
  return record ? Object.keys(record).length : 0;
}

function buildRuntimeCapabilityActivityStatus(
  event: ReturnType<typeof readRuntimeEvents>[number],
  agentLabels: Map<string, string>,
): RuntimeCapabilityActivityStatus | undefined {
  const payload = toRecord(event.payload);
  if (event.type === "runtime_capability_registry_entry_upserted") {
    const registryType = toStringValue(payload?.registryType).trim();
    const targetId = toStringValue(payload?.targetId).trim();
    const state = toStringValue(payload?.state).trim();
    if (!registryType || !targetId) {
      return undefined;
    }
    return {
      id: event.id,
      kind: "registry_entry",
      title: `${registryType} ${targetId}`,
      summary: uniqueStrings([
        state ? `state=${state}` : undefined,
        toStringValue(payload?.reason).trim() || undefined,
      ]).join(" · "),
      updatedAt: event.createdAt,
      state: state || undefined,
      registryType:
        registryType === "agent" || registryType === "mcp" || registryType === "skill"
          ? registryType
          : undefined,
      targetId,
    };
  }
  if (event.type === "runtime_capability_mcp_grant_upserted") {
    const agentId = toStringValue(payload?.agentId).trim();
    const mcpServerId = toStringValue(payload?.mcpServerId).trim();
    const state = toStringValue(payload?.state).trim();
    if (!agentId || !mcpServerId) {
      return undefined;
    }
    return {
      id: event.id,
      kind: "mcp_grant",
      title: `${agentLabels.get(agentId) ?? agentId} -> ${mcpServerId}`,
      summary: uniqueStrings([
        state ? `state=${state}` : undefined,
        toStringValue(payload?.reason).trim() || undefined,
      ]).join(" · "),
      updatedAt: event.createdAt,
      state: state || undefined,
      agentId,
      mcpServerId,
    };
  }
  if (event.type === "runtime_capability_registry_synced") {
    const counts = toRecord(payload?.counts) ?? {};
    const entryCount = toNumber(payload?.entryCount);
    return {
      id: event.id,
      kind: "registry_sync",
      title: "Capability registry synced",
      summary: uniqueStrings([
        entryCount > 0 ? `${entryCount} entries` : undefined,
        toNumber(counts.agent) > 0 ? `${toNumber(counts.agent)} agents` : undefined,
        toNumber(counts.skill) > 0 ? `${toNumber(counts.skill)} skills` : undefined,
        toNumber(counts.mcp) > 0 ? `${toNumber(counts.mcp)} MCP` : undefined,
      ]).join(" · "),
      updatedAt: event.createdAt,
    };
  }
  if (
    (event.type === "federation.package.adopted" || event.type === "federation.package.reverted") &&
    toStringValue(payload?.packageType).trim() === "runtime-policy-overlay-package"
  ) {
    const state = event.type === "federation.package.adopted" ? "adopted" : "reverted";
    return {
      id: event.id,
      kind: "federation_overlay",
      title: `Federation policy overlay ${state}`,
      summary: uniqueStrings([
        toStringValue(payload?.sourceRuntimeId).trim()
          ? `source=${toStringValue(payload?.sourceRuntimeId).trim()}`
          : undefined,
        toStringValue(payload?.packageId).trim()
          ? `package=${toStringValue(payload?.packageId).trim()}`
          : undefined,
        toStringValue(payload?.reason).trim() || undefined,
      ]).join(" · "),
      updatedAt: event.createdAt,
      state,
      sourceRuntimeId: toStringValue(payload?.sourceRuntimeId).trim() || undefined,
    };
  }
  return undefined;
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
  const userConsoleStore = loadRuntimeUserConsoleStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const stateCounts = emptyGovernanceStateCounts();
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const capabilityPolicy = resolveRuntimeCapabilityPolicy(config, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const governanceStore = loadRuntimeGovernanceStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const authoritativeEntries = capabilityPolicy.entries;
  const entryStatuses = authoritativeEntries.map((entry) => {
    const executionStatus = capabilityPolicy.resolveExecutionStatus(
      entry.registryType,
      entry.targetId,
    );
    return {
      ...entry,
      executionMode: executionStatus.mode,
      liveEligible: executionStatus.liveEligible,
      executionPreferenceRank: executionStatus.preferenceRank,
      executionPreferenceLabel: executionStatus.preferenceLabel,
      executionSummary: executionStatus.summary,
    };
  });
  if (authoritativeEntries.length > 0) {
    for (const entry of authoritativeEntries) {
      stateCounts[entry.state] += 1;
    }
  } else {
    for (const entry of memoryStore.evolutionMemory) {
      stateCounts[entry.adoptionState] += 1;
    }
    for (const entry of governanceStore.shadowEvaluations) {
      const state = mapShadowEvaluationStateToGovernanceState(entry.state);
      if (state) {
        stateCounts[state] += 1;
      }
    }
  }

  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  const sandbox = toRecord(defaults?.sandbox);
  const tools = toRecord(config?.tools);
  const mcp = toRecord(config?.mcp);
  const configuredAgentLabels = new Map<string, string>();
  const configuredAgents = toArray(agents?.list);
  for (const configuredAgent of configuredAgents) {
    if (typeof configuredAgent === "string") {
      configuredAgentLabels.set(configuredAgent, configuredAgent);
      continue;
    }
    const record = toRecord(configuredAgent);
    const agentId = toStringValue(record?.id ?? record?.agentId ?? record?.name);
    if (!agentId) {
      continue;
    }
    configuredAgentLabels.set(
      agentId,
      toStringValue(record?.label ?? record?.title ?? record?.name, agentId),
    );
  }
  for (const agent of userConsoleStore.agents) {
    configuredAgentLabels.set(agent.id, agent.name || agent.id);
  }
  const agentCount =
    authoritativeEntries.filter((entry) => entry.registryType === "agent").length ||
    userConsoleStore.agents.length ||
    toArray(toRecord(agents)?.list).length;
  const skillCount =
    authoritativeEntries.filter((entry) => entry.registryType === "skill").length ||
    countObjectEntries(toRecord(tools)?.skills ?? toRecord(config?.skills));
  const mcpCount =
    authoritativeEntries.filter((entry) => entry.registryType === "mcp").length ||
    countObjectEntries(mcp?.servers ?? mcp?.entries ?? mcp?.list);
  const mcpGrants = capabilityPolicy.mcpGrants.map((grant) => ({
    id: grant.id,
    agentId: grant.agentId,
    agentLabel: configuredAgentLabels.get(grant.agentId) ?? grant.agentId,
    mcpServerId: grant.mcpServerId,
    state: grant.state,
    summary: grant.summary,
    updatedAt: grant.updatedAt,
    metadata: grant.metadata,
  }));
  const recentActivity = readRuntimeEvents(120, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  })
    .map((event) => buildRuntimeCapabilityActivityStatus(event, configuredAgentLabels))
    .filter((entry): entry is RuntimeCapabilityActivityStatus => entry != null)
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, 10);

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
    mcpGrantCount: capabilityPolicy.mcpGrantCount,
    mcpAllowedGrantCount: capabilityPolicy.allowedMcpGrantCount,
    mcpDeniedGrantCount: capabilityPolicy.deniedMcpGrantCount,
    overlayCount: capabilityPolicy.overlayCount,
    governanceStateCounts: stateCounts,
    entries: entryStatuses,
    mcpGrants,
    recentActivity,
  };
}

function buildRuntimeEvolutionCandidateStatuses(
  memoryStore: RuntimeMemoryStore,
  governanceStore: RuntimeGovernanceStore,
): RuntimeEvolutionCandidateStatus[] {
  return [...memoryStore.evolutionMemory]
    .map((entry) => {
      const metadata = toRecord(entry.metadata);
      const riskReview = buildRuntimeEvolutionRiskReview(entry);
      const materializedStrategyId = toStringValue(metadata?.materializedStrategyId) || undefined;
      const materializedStrategy = materializedStrategyId
        ? memoryStore.strategies.find((strategy) => strategy.id === materializedStrategyId)
        : undefined;
      const relatedEvaluations = governanceStore.shadowEvaluations.filter(
        (evaluation) =>
          evaluation.candidateRef === entry.id || evaluation.candidateRef === entry.candidateRef,
      );
      const observationMetrics =
        readRuntimeEvolutionObservationMetrics(entry.metadata) ??
        relatedEvaluations
          .map((evaluation) => readRuntimeEvolutionObservationMetrics(evaluation.metadata))
          .filter((metrics): metrics is RuntimeEvolutionObservationMetrics => metrics != null)
          .toSorted((left, right) => right.observationCount - left.observationCount)[0];
      const autoApplyStatus = buildRuntimeEvolutionAutoApplyStatus({
        candidate: entry,
        metrics: observationMetrics,
      });
      const verificationMetrics = readRuntimeEvolutionVerificationMetrics(entry.metadata);
      const verificationReview =
        normalizeEvolutionAdoptionState(entry.adoptionState) === "adopted" ||
        (toNumber(metadata?.revertedAt, 0) > 0 &&
          toNumber(metadata?.revertedAt, 0) >= toNumber(metadata?.adoptedAt, 0)) ||
        verificationMetrics
          ? buildRuntimeEvolutionVerificationReview({
              candidate: entry,
              metrics: verificationMetrics,
            })
          : undefined;
      const policyHints = uniqueStrings([
        entry.candidateType === "worker_routing" && toStringValue(metadata?.worker)
          ? `prefer worker ${toStringValue(metadata?.worker)}`
          : undefined,
        entry.candidateType === "retry_policy_review" && toStringValue(metadata?.budgetMode)
          ? `budget ${toStringValue(metadata?.budgetMode)}`
          : undefined,
        entry.candidateType === "retry_policy_review" && toStringValue(metadata?.retrievalMode)
          ? `retrieval ${toStringValue(metadata?.retrievalMode)}`
          : undefined,
        entry.candidateType === "retry_policy_review" && toNumber(metadata?.retryDelayMinutes, 0) > 0
          ? `retry ${Math.round(toNumber(metadata?.retryDelayMinutes, 0))}m`
          : undefined,
        entry.candidateType === "retry_policy_review" && toNumber(metadata?.blockedThreshold, 0) > 0
          ? `pause after ${Math.round(toNumber(metadata?.blockedThreshold, 0))} failures`
          : undefined,
        entry.candidateType === "retry_policy_review" && toNumber(metadata?.totalFailures, 0) > 0
          ? `observed failures ${Math.round(toNumber(metadata?.totalFailures, 0))}`
          : undefined,
      ]);
      const evaluationState =
        relatedEvaluations.find((evaluation) => evaluation.state === "reverted")?.state ||
        relatedEvaluations.find((evaluation) => evaluation.state === "adopted")?.state ||
        relatedEvaluations.find((evaluation) => evaluation.state === "promoted")?.state ||
        relatedEvaluations.find((evaluation) => evaluation.state === "shadow")?.state ||
        relatedEvaluations.find((evaluation) => evaluation.state === "observed")?.state;
      const state: RuntimeEvolutionCandidateStatus["state"] =
        evaluationState === "reverted" ||
        (toNumber(metadata?.revertedAt, 0) > 0 &&
          toNumber(metadata?.revertedAt, 0) >= toNumber(metadata?.adoptedAt, 0))
          ? "reverted"
          : entry.adoptionState;
      return {
        id: entry.id,
        candidateType: entry.candidateType,
        targetLayer: entry.targetLayer,
        state,
        riskLevel: riskReview.riskLevel,
        autoApplyEligible: riskReview.autoApplyEligible,
        requiresReasonOnAdopt: riskReview.requiresReasonOnAdopt,
        riskSummary: riskReview.summary,
        riskSignals: [...riskReview.signals],
        summary: entry.summary,
        route: toStringValue(metadata?.route) || undefined,
        worker: toStringValue(metadata?.worker) || undefined,
        lane:
          toStringValue(metadata?.lane) === "system2"
            ? "system2"
            : toStringValue(metadata?.lane) === "system1"
              ? "system1"
              : undefined,
        skillIds: toArray<string>(metadata?.skillIds).filter(
          (value): value is string => typeof value === "string",
        ),
        optimizedMetrics: entry.optimizedMetrics,
        targetMetrics: relatedEvaluations.find((ev) => ev.targetMetrics?.length)?.targetMetrics,
        policyHints,
        baselineRef: entry.baselineRef,
        candidateRef: entry.candidateRef,
        observationCount: Math.max(
          observationMetrics?.observationCount ?? 0,
          relatedEvaluations.reduce(
            (count, evaluation) => Math.max(count, evaluation.observationCount),
            0,
          ),
        ),
        successRate: observationMetrics?.successRate ?? 0,
        averageCompletionScore: observationMetrics?.averageCompletionScore ?? 0,
        averageLatencyMs: observationMetrics?.averageLatencyMs ?? 0,
        averageTokenEstimate: observationMetrics?.averageTokenEstimate ?? 0,
        averageInterruptionCount: observationMetrics?.averageInterruptionCount ?? 0,
        averageRemoteCallCount: observationMetrics?.averageRemoteCallCount ?? 0,
        regressionRiskScore: observationMetrics?.regressionRiskScore ?? 0,
        autoPromoteReady: autoApplyStatus.promoteReady,
        autoAdoptReady: autoApplyStatus.adoptReady,
        autoApplyBlockers: [...autoApplyStatus.blockers],
        autoApplySummary: autoApplyStatus.summary,
        verificationStatus: verificationReview?.state,
        verificationSummary: verificationReview?.summary,
        verificationSignals: verificationReview ? [...verificationReview.signals] : [],
        verificationObservationCount: verificationMetrics?.observationCount ?? 0,
        lastVerifiedAt:
          toNumber(metadata?.lastVerifiedAt, 0) ||
          verificationMetrics?.lastObservedAt ||
          undefined,
        materializedStrategyId,
        strategyInvalidated: Boolean(materializedStrategy?.invalidatedBy.length),
        updatedAt: Math.max(
          entry.updatedAt,
          ...relatedEvaluations.map((evaluation) => evaluation.updatedAt),
        ),
        sourceTaskIds: [...entry.sourceTaskIds],
        metadata: entry.metadata,
      } satisfies RuntimeEvolutionCandidateStatus;
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
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
  const candidates = buildRuntimeEvolutionCandidateStatuses(memoryStore, governanceStore);
  return {
    generatedAt: now,
    enabled: metadata?.enabled !== false,
    autoApplyLowRisk: metadata?.autoApplyLowRisk === true,
    reviewIntervalHours: toNumber(metadata?.reviewIntervalHours, 12),
    candidateCount: memoryStore.evolutionMemory.length,
    stateCounts:
      candidates.length > 0
        ? countBy(candidates.map((entry) => entry.state))
        : countBy(
            governanceStore.shadowEvaluations
              .map((entry) => mapShadowEvaluationStateToGovernanceState(entry.state))
              .filter((value): value is GovernanceState => value != null),
          ),
    lastReviewAt: toNumber(metadata?.lastReviewAt, 0) || undefined,
    candidates,
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonPayloads<T>(root: string): Array<{
  filename: string;
  payload: T;
}> {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .toSorted((left, right) => right.name.localeCompare(left.name))
      .flatMap((entry) => {
        try {
          return [
            {
              filename: entry.name,
              payload: JSON.parse(fs.readFileSync(path.join(root, entry.name), "utf8")) as T,
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function readLatestCapabilityGovernancePreview(
  root: string,
): FederationRuntimeSnapshot["outboxPreview"]["latestCapabilityGovernance"] {
  const payload = readJsonPayloads<CapabilityGovernanceSnapshot>(root)[0]?.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const metadata = toRecord(payload.metadata);
  return {
    id: normalizeText(payload.id) || "capability-governance",
    generatedAt:
      typeof payload.generatedAt === "number" && Number.isFinite(payload.generatedAt)
        ? Math.trunc(payload.generatedAt)
        : 0,
    entryCount: Array.isArray(payload.entries) ? payload.entries.length : 0,
    mcpGrantCount: Array.isArray(payload.mcpGrants) ? payload.mcpGrants.length : 0,
    preset: normalizeText(metadata?.preset) || undefined,
    sandboxMode: normalizeText(metadata?.sandboxMode) || undefined,
    agentCount:
      typeof metadata?.agentCount === "number" && Number.isFinite(metadata.agentCount)
        ? Math.trunc(metadata.agentCount)
        : undefined,
    extensionCount:
      typeof metadata?.extensionCount === "number" && Number.isFinite(metadata.extensionCount)
        ? Math.trunc(metadata.extensionCount)
        : undefined,
    entryPreview: Array.isArray(payload.entries)
      ? payload.entries.slice(0, 6).map((entry) => ({
          id: entry.id,
          registryType: entry.registryType,
          targetId: entry.targetId,
          state: entry.state,
          updatedAt: entry.updatedAt,
        }))
      : [],
    mcpGrantPreview: Array.isArray(payload.mcpGrants)
      ? payload.mcpGrants.slice(0, 6).map((entry) => ({
          id: entry.id,
          agentId: entry.agentId,
          mcpServerId: entry.mcpServerId,
          state: entry.state,
          updatedAt: entry.updatedAt,
        }))
      : [],
  };
}

function readLatestShadowTelemetryPreview(
  root: string,
): FederationRuntimeSnapshot["outboxPreview"]["latestShadowTelemetry"] {
  const payload = readJsonPayloads<ShadowTelemetryEnvelope>(root)[0]?.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const evaluations = Array.isArray(payload.evaluations) ? payload.evaluations : [];
  const stateCounts: Record<ShadowEvaluationRecord["state"], number> = {
    observed: 0,
    shadow: 0,
    promoted: 0,
    adopted: 0,
    reverted: 0,
  };
  const candidateTypeCounts = new Map<string, number>();
  for (const evaluation of evaluations) {
    stateCounts[evaluation.state] = (stateCounts[evaluation.state] ?? 0) + 1;
    const candidateType = normalizeText(evaluation.candidateType) || "unknown";
    candidateTypeCounts.set(candidateType, (candidateTypeCounts.get(candidateType) ?? 0) + 1);
  }
  return {
    id: normalizeText(payload.id) || "shadow-telemetry",
    generatedAt:
      typeof payload.generatedAt === "number" && Number.isFinite(payload.generatedAt)
        ? Math.trunc(payload.generatedAt)
        : 0,
    evaluationCount: evaluations.length,
    stateCounts,
    candidateTypeCounts: [...candidateTypeCounts.entries()]
      .map(([candidateType, count]) => ({
        candidateType,
        count,
      }))
      .toSorted((left, right) => {
        return right.count - left.count || left.candidateType.localeCompare(right.candidateType);
      })
      .slice(0, 6),
    evaluations: evaluations.slice(0, 6).map((evaluation) => ({
      id: evaluation.id,
      candidateType: normalizeText(evaluation.candidateType) || "unknown",
      state: evaluation.state,
      targetLayer: evaluation.targetLayer,
      observationCount: Math.max(0, Math.trunc(evaluation.observationCount ?? 0)),
      updatedAt: Math.max(0, Math.trunc(evaluation.updatedAt ?? 0)),
    })),
  };
}

function buildFederationOutboxJournalSummary(
  record: Record<string, unknown>,
  envelopeType: string,
  operation: "upsert" | "delete",
): string {
  if (operation === "delete") {
    return `Delete ${envelopeType} export`;
  }
  const payload = toRecord(record.payload);
  switch (envelopeType) {
    case "runtime-manifest": {
      const manifest = toRecord(payload?.payload);
      const instanceId = normalizeText(record.sourceRuntimeId ?? manifest?.instanceId);
      return instanceId ? `Publish runtime manifest for ${instanceId}` : "Publish runtime manifest";
    }
    case "shareable-review": {
      const review = toRecord(payload?.taskReview);
      const summary = normalizeText(review?.summary);
      return summary ? `Shareable review: ${summary}` : "Publish shareable review";
    }
    case "shareable-memory": {
      const memory = toRecord(payload?.memory);
      const memoryType = normalizeText(memory?.memoryType);
      const summary = normalizeText(memory?.summary);
      if (summary) {
        return `Shareable ${memoryType || "memory"}: ${summary}`;
      }
      return memoryType ? `Publish shareable ${memoryType}` : "Publish shareable memory";
    }
    case "strategy-digest": {
      const strategies = Array.isArray(payload?.strategies) ? payload.strategies.length : 0;
      return strategies > 0 ? `Strategy digest (${strategies} strategies)` : "Publish strategy digest";
    }
    case "news-digest": {
      const digestPayload = toRecord(payload?.payload);
      const items = Array.isArray(digestPayload?.digestItems) ? digestPayload.digestItems.length : 0;
      return items > 0 ? `News digest (${items} items)` : "Publish news digest";
    }
    case "shadow-telemetry": {
      const evaluations = Array.isArray(payload?.evaluations) ? payload.evaluations.length : 0;
      return evaluations > 0
        ? `Shadow telemetry (${evaluations} evaluations)`
        : "Publish shadow telemetry";
    }
    case "capability-governance": {
      const entries = Array.isArray(payload?.entries) ? payload.entries.length : 0;
      const grants = Array.isArray(payload?.mcpGrants) ? payload.mcpGrants.length : 0;
      return `Capability governance (${entries} entries · ${grants} grants)`;
    }
    case "team-knowledge": {
      const knowledgePayload = toRecord(payload?.payload);
      const records = Array.isArray(knowledgePayload?.records) ? knowledgePayload.records.length : 0;
      return records > 0 ? `Team knowledge (${records} records)` : "Publish team knowledge";
    }
    default:
      return `Publish ${envelopeType}`;
  }
}

function readLatestFederationOutboxJournalEvents(
  journalRoot: string,
  acknowledgedOutboxEventId: string | null,
): FederationRuntimeSnapshot["outboxPreview"]["latestJournalEvents"] {
  return readJsonPayloads<Record<string, unknown>>(journalRoot)
    .map(({ payload }) => {
      const eventId = normalizeText(payload.id);
      const envelopeType = normalizeText(payload.envelopeType);
      const operation: "upsert" | "delete" | null =
        payload.operation === "delete"
          ? "delete"
          : payload.operation === "upsert"
            ? "upsert"
            : null;
      if (!eventId || !envelopeType || !operation) {
        return null;
      }
      return {
        id: eventId,
        envelopeType,
        operation,
        envelopeId: normalizeText(payload.envelopeId) || undefined,
        sourceRuntimeId: normalizeText(payload.sourceRuntimeId) || undefined,
        generatedAt:
          typeof payload.generatedAt === "number" && Number.isFinite(payload.generatedAt)
            ? Math.trunc(payload.generatedAt)
            : 0,
        deliveryState:
          acknowledgedOutboxEventId && eventId.localeCompare(acknowledgedOutboxEventId) <= 0
            ? ("acknowledged" as const)
            : ("pending" as const),
        summary: buildFederationOutboxJournalSummary(payload, envelopeType, operation),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 8);
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
  const journalRoot = path.join(federationRoot, "outbox-journal");
  const inboxRoot = path.join(federationRoot, "inbox");
  const assignmentsRoot = path.join(federationRoot, "assignments");
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationPolicy = resolveFederationPushPolicy(opts.config ?? null, federationStore.metadata);
  const latestSyncAttempts = readFederationSyncAttempts(federationStore.metadata);
  const remoteMaintenanceControls = readFederationRemoteSyncMaintenanceControls(
    federationStore.metadata,
  );
  const remoteMaintenanceSummary = summarizeFederationRemoteSyncMaintenance({
    controls: remoteMaintenanceControls,
    remoteEnabled: federationPolicy.enabled,
    remoteConfigured: federationPolicy.remoteConfigured,
    syncCursor: federationStore.syncCursor,
    latestAttempt: latestSyncAttempts[0] ?? null,
    now,
  });
  const userConsoleStore = loadRuntimeUserConsoleStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfiles = listRuntimeResolvedSurfaceProfiles({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const surfaceProfilesById = new Map(
    surfaceProfiles.map((profile) => [profile.surface.id, profile] as const),
  );
  const assignmentInbox = readFederationAssignmentInbox(assignmentsRoot, opts);
  const shareableReviews = buildLatestShareableReviewEnvelopes({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config ?? null,
  });
  const strategyDigest = buildLatestStrategyDigestEnvelope({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config ?? null,
  });
  const newsDigest = buildLatestNewsDigestEnvelope({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config ?? null,
  });
  const shareableMemories = buildLatestShareableMemoryEnvelopes({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config ?? null,
  });
  const teamKnowledge = buildLatestTeamKnowledgeEnvelope({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config ?? null,
  });
  const maintenanceControls = readFederationInboxMaintenanceControls(federationStore.metadata);
  const maintenanceSummary = summarizeFederationInboxMaintenance(
    federationStore.inbox,
    maintenanceControls,
    now,
  );
  const outboxEnvelopeCounts = {
    runtimeManifest: countJsonFiles(path.join(outboxRoot, "runtime-manifest")),
    shareableReview: countJsonFiles(path.join(outboxRoot, "shareable-review")),
    shareableMemory: countJsonFiles(path.join(outboxRoot, "shareable-memory")),
    strategyDigest: countJsonFiles(path.join(outboxRoot, "strategy-digest")),
    newsDigest: countJsonFiles(path.join(outboxRoot, "news-digest")),
    shadowTelemetry: countJsonFiles(path.join(outboxRoot, "shadow-telemetry")),
    capabilityGovernance: countJsonFiles(path.join(outboxRoot, "capability-governance")),
    teamKnowledge: countJsonFiles(path.join(outboxRoot, "team-knowledge")),
  } as const;
  const inboxStateCounts = emptyFederationStateCounts();
  for (const entry of federationStore.inbox) {
    inboxStateCounts[entry.state] += 1;
  }
  return {
    generatedAt: now,
    enabled: federationPolicy.enabled,
    remoteConfigured: federationPolicy.remoteConfigured,
    remoteMaintenance: {
      enabled: remoteMaintenanceControls.enabled,
      syncIntervalMinutes: remoteMaintenanceControls.syncIntervalMinutes,
      retryAfterFailureMinutes: remoteMaintenanceControls.retryAfterFailureMinutes,
      configuredAt: remoteMaintenanceControls.configuredAt,
      due: remoteMaintenanceSummary.due,
      nextSyncAt: remoteMaintenanceSummary.nextSyncAt,
      lastSuccessfulSyncAt: remoteMaintenanceSummary.lastSuccessfulSyncAt,
      lastFailedSyncAt: remoteMaintenanceSummary.lastFailedSyncAt,
      lastAttemptAt: remoteMaintenanceSummary.lastAttemptAt,
      lastAttemptStatus: remoteMaintenanceSummary.lastAttemptStatus,
      blockedReason: remoteMaintenanceSummary.blockedReason,
      lastError: remoteMaintenanceControls.lastAutoSyncError,
    },
    manifest: runtimeManifest,
    outboxRoot,
    journalRoot,
    inboxRoot,
    assignmentsRoot,
    syncCursorPath: path.join(federationRoot, "sync-cursor.json"),
    syncCursor: federationStore.syncCursor ?? null,
    localOutboxHeadEventId:
      typeof federationStore.syncCursor?.metadata?.localOutboxHeadEventId === "string"
        ? federationStore.syncCursor.metadata.localOutboxHeadEventId
        : null,
    acknowledgedOutboxEventId: federationStore.syncCursor?.lastOutboxEventId ?? null,
    pendingOutboxEventCount:
      typeof federationStore.syncCursor?.metadata?.pendingOutboxEventCount === "number" &&
      Number.isFinite(federationStore.syncCursor.metadata.pendingOutboxEventCount)
        ? Math.max(0, Math.trunc(federationStore.syncCursor.metadata.pendingOutboxEventCount))
        : 0,
    outboxJournalEventCount: countJsonFiles(journalRoot),
    latestSyncAttempts,
    pendingAssignments: assignmentInbox.total,
    assignmentInbox,
    outboxEnvelopeCounts,
    outboxPreview: {
      runtimeManifest: {
        instanceId: runtimeManifest.instanceId,
        runtimeVersion: runtimeManifest.runtimeVersion,
        generatedAt: runtimeManifest.generatedAt,
        capabilityCount: runtimeManifest.capabilities.length,
        workspaceRoot: runtimeManifest.instanceManifest.workspaceRoot,
      },
      latestStrategyDigest: {
        id: strategyDigest.id,
        generatedAt: strategyDigest.generatedAt,
        strategyCount: strategyDigest.strategies.length,
        routeCount: new Set(strategyDigest.strategies.map((entry) => entry.route)).size,
        strategies: strategyDigest.strategies.slice(0, 6).map((entry) => ({
          id: entry.id,
          route: entry.route,
          worker: entry.worker,
          summary: entry.summary,
          updatedAt: entry.updatedAt,
        })),
      },
      latestNewsDigest: {
        sourceRuntimeId: newsDigest.sourceRuntimeId,
        generatedAt: newsDigest.generatedAt,
        itemCount: newsDigest.payload.digestItems.length,
        domains: uniqueStrings(newsDigest.payload.digestItems.map((entry) => entry.domain)),
        items: newsDigest.payload.digestItems.slice(0, 6).map((entry) => ({
          id: entry.id,
          domain: entry.domain,
          title: entry.title,
          exploit: entry.exploit,
          createdAt: entry.createdAt,
        })),
      },
      latestShareableReviews: shareableReviews.slice(0, 6).map((entry) => ({
        id: entry.id,
        taskId: entry.taskReview.taskId,
        summary: entry.taskReview.summary,
        outcome: entry.taskReview.outcome,
        generatedAt: entry.generatedAt,
      })),
      latestShareableMemories: shareableMemories.slice(0, 6).map((entry) => ({
        id: entry.id,
        memoryType: entry.memory.memoryType,
        summary: entry.memory.summary,
        route: entry.memory.route,
        generatedAt: entry.generatedAt,
      })),
      latestTeamKnowledge: teamKnowledge.payload.records.slice(0, 6).map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        tags: entry.tags,
        updatedAt: entry.updatedAt,
      })),
      latestShadowTelemetry: readLatestShadowTelemetryPreview(
        path.join(outboxRoot, "shadow-telemetry"),
      ),
      latestCapabilityGovernance: readLatestCapabilityGovernancePreview(
        path.join(outboxRoot, "capability-governance"),
      ),
      latestJournalEvents: readLatestFederationOutboxJournalEvents(
        journalRoot,
        federationStore.syncCursor?.lastOutboxEventId ?? null,
      ),
    },
    inbox: {
      total: federationStore.inbox.length,
      stateCounts: inboxStateCounts,
      packageTypeCounts: countBy(federationStore.inbox.map((entry) => entry.packageType)),
      maintenance: {
        enabled: maintenanceControls.enabled,
        reviewIntervalHours: maintenanceControls.reviewIntervalHours,
        lastReviewAt: maintenanceControls.lastReviewAt,
        lastExpiredAt: maintenanceControls.lastExpiredAt,
        lastExpiredCount: maintenanceControls.lastExpiredCount,
        pendingReviewCount: maintenanceSummary.pendingReviewCount,
        stalePackageCount: maintenanceSummary.stalePackageCount,
        nextExpiryAt: maintenanceSummary.nextExpiryAt,
        expireAfterHours: {
          received: maintenanceControls.expireReceivedAfterHours,
          validated: maintenanceControls.expireValidatedAfterHours,
          shadowed: maintenanceControls.expireShadowedAfterHours,
          recommended: maintenanceControls.expireRecommendedAfterHours,
        },
      },
      coordinatorSuggestionCount: federationStore.coordinatorSuggestions.length,
      sharedStrategyCount: federationStore.sharedStrategies.length,
      teamKnowledgeCount: federationStore.teamKnowledge.length,
      latestCoordinatorSuggestions: [...federationStore.coordinatorSuggestions]
        .toSorted(
          (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        )
        .slice(0, 6)
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          taskId: entry.taskId,
          localTaskId: entry.localTaskId,
          localTaskStatus: entry.localTaskStatus,
          sourceRuntimeId: entry.sourceRuntimeId,
          updatedAt: entry.updatedAt,
          materializedAt: entry.materializedAt,
          lifecycleSyncedAt: entry.lifecycleSyncedAt,
          lastMaterializedLocalTaskId: entry.lastMaterializedLocalTaskId,
          lastMaterializedAt: entry.lastMaterializedAt,
          rematerializeReason: entry.rematerializeReason,
        })),
      latestSharedStrategies: [...federationStore.sharedStrategies]
        .toSorted((left, right) => {
          const leftAdoptedAt = readFederationSharedStrategyAdoptedAt(left) ?? left.updatedAt;
          const rightAdoptedAt = readFederationSharedStrategyAdoptedAt(right) ?? right.updatedAt;
          return rightAdoptedAt - leftAdoptedAt || left.id.localeCompare(right.id);
        })
        .slice(0, 6)
        .map((entry) => ({
          id: entry.id,
          summary: entry.summary,
          route: entry.route,
          worker: entry.worker,
          thinkingLane: entry.thinkingLane,
          skillIds: [...entry.skillIds],
          confidence: entry.confidence,
          sourceRuntimeId: readFederationSharedStrategySourceRuntimeId(entry),
          sourcePackageId: readFederationSharedStrategySourcePackageId(entry),
          updatedAt: entry.updatedAt,
          adoptedAt: readFederationSharedStrategyAdoptedAt(entry),
          invalidated: (entry.invalidatedBy ?? []).length > 0,
        })),
      latestTeamKnowledge: [...federationStore.teamKnowledge]
        .toSorted((left, right) => {
          const leftAdoptedAt = readFederationTeamKnowledgeAdoptedAt(left) ?? left.updatedAt;
          const rightAdoptedAt = readFederationTeamKnowledgeAdoptedAt(right) ?? right.updatedAt;
          return rightAdoptedAt - leftAdoptedAt || left.id.localeCompare(right.id);
        })
        .slice(0, 6)
        .map((entry) => ({
          id: entry.id,
          namespace: entry.namespace,
          title: entry.title,
          summary: entry.summary,
          tags: [...entry.tags],
          sourceKind: readFederationTeamKnowledgeSourceKind(entry),
          sourceRuntimeId: entry.sourceRuntimeId ?? "unknown-runtime",
          sourcePackageId: readFederationTeamKnowledgeSourcePackageId(entry),
          updatedAt: entry.updatedAt,
          adoptedAt: readFederationTeamKnowledgeAdoptedAt(entry),
        })),
      latestPackages: [...federationStore.inbox]
        .toSorted(
          (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        )
        .slice(0, 6)
        .map((entry) => {
          const maintenance = resolveFederationPackageMaintenanceStatus(
            entry,
            maintenanceControls,
            now,
          );
          const localLanding = buildFederationPackageLocalLanding(
            entry,
            federationStore,
            userConsoleStore,
            surfaceProfilesById,
          );
          return {
            id: entry.id,
            packageType: entry.packageType,
            state: entry.state,
            summary: entry.summary,
            sourceRuntimeId: entry.sourceRuntimeId,
            updatedAt: entry.updatedAt,
            actionable: maintenance.actionable,
            stale: maintenance.stale,
            expiresAt: maintenance.expiresAt,
            validationErrorCount: entry.validationErrors.length,
            validationErrors: [...entry.validationErrors].slice(0, 3),
            riskLevel: entry.review?.riskLevel,
            autoAdoptEligible: entry.review?.autoAdoptEligible,
            requiresReasonOnAdopt: entry.review?.requiresReasonOnAdopt,
            reviewSummary: entry.review?.summary,
            reviewSignals: [...(entry.review?.signals ?? [])].slice(0, 3),
            payloadPreview: buildFederationPackagePayloadPreview(entry, surfaceProfilesById),
            localLandingLabel: localLanding.localLandingLabel,
            localLandingSummary: localLanding.localLandingSummary,
          };
        }),
    },
    shareablePushScopeCatalog: federationPolicy.shareablePushScopeCatalog,
    requiredBlockedPushScopes: federationPolicy.requiredBlockedPushScopes,
    allowedPushScopes: federationPolicy.allowedPushScopes,
    blockedPushScopes: federationPolicy.blockedPushScopes,
    suppressedPushScopes: buildFederationPushScopeSuppressions({
      allowedPushScopes: federationPolicy.allowedPushScopes,
      counts: outboxEnvelopeCounts,
    }),
    pushPolicyConfiguredAt: federationPolicy.configuredAt,
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
  const ecology = buildRuntimeEcologyStatusBundle({
    ...opts,
    now,
  });
  return {
    generatedAt: now,
    runtimeVersion,
    preset: detectCapabilityPolicyPreset(opts.config ?? null),
    instanceManifest,
    runtimeManifest,
    tasks: buildRuntimeTasksList(opts),
    notify: buildRuntimeNotifyStatus(opts),
    memory: buildRuntimeMemoryList(opts),
    retrieval: buildRuntimeRetrievalStatus(opts),
    userConsole: buildRuntimeUserConsoleStatus(opts),
    agents: ecology.agents,
    surfaces: ecology.surfaces,
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

function isShareableMemoryRecord(memory: RuntimeMemoryStore["memories"][number]): boolean {
  if (!SHAREABLE_MEMORY_TYPES.has(memory.memoryType)) {
    return false;
  }
  if ((memory.invalidatedBy ?? []).length > 0) {
    return false;
  }
  if ((memory.confidence ?? 0) < 0.5) {
    return false;
  }
  if (memory.scope?.includes("waiting-user")) {
    return false;
  }
  const metadata = toRecord(memory.metadata);
  return metadata?.localOnly !== true && metadata?.shareScope !== "blocked";
}

function isShareableMetaLearningRecord(
  record: RuntimeMemoryStore["metaLearning"][number],
): boolean {
  const metadata = toRecord(record.metadata);
  return metadata?.localOnly !== true && metadata?.shareScope !== "blocked";
}

function buildShareableMemoryEnvelope(
  memory: RuntimeMemoryStore["memories"][number],
  generatedAt: number,
): ShareableMemoryEnvelope {
  return {
    id: `shareable-memory-${memory.id}-${generatedAt}`,
    memory,
    shareScope: "shareable_derived",
    generatedAt,
    metadata: {
      sourceKind: "formal-memory",
      memoryType: memory.memoryType,
      route: memory.route,
    },
  };
}

function summarizeTeamKnowledgeTitle(prefix: string, text: string, fallback: string): string {
  const normalized = toStringValue(text).replace(/\s+/g, " ").trim();
  const base = normalized || fallback;
  const title = base.length > 88 ? `${base.slice(0, 85).trimEnd()}...` : base;
  return `${prefix}: ${title}`;
}

function buildLocalTeamKnowledgeRecords(
  opts: RuntimeStateOptions,
  runtimeManifest: RuntimeManifest,
  now: number,
): TeamKnowledgeRecord[] {
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });

  const memoryRecords = memoryStore.memories
    .filter(
      (memory) =>
        isShareableMemoryRecord(memory) && TEAM_KNOWLEDGE_MEMORY_TYPES.has(memory.memoryType),
    )
    .map((memory) => ({
      id: `team-knowledge-memory-${memory.id}`,
      namespace: "team-shareable" as const,
      title: summarizeTeamKnowledgeTitle("Memory", memory.summary, memory.id),
      summary: memory.detail?.trim() || memory.summary,
      tags: uniqueStrings([memory.memoryType, memory.route, ...(memory.tags ?? [])]).slice(0, 12),
      sourceRuntimeId: runtimeManifest.instanceId,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      metadata: {
        sourceKind: "memory",
        sourceId: memory.id,
        confidence: memory.confidence,
      },
    }));

  const strategyRecords = memoryStore.strategies
    .filter(
      (strategy) =>
        (strategy.invalidatedBy ?? []).length === 0 && (strategy.confidence ?? 0) >= 0.6,
    )
    .map((strategy) => ({
      id: `team-knowledge-strategy-${strategy.id}`,
      namespace: "team-shareable" as const,
      title: summarizeTeamKnowledgeTitle("Strategy", strategy.summary, strategy.id),
      summary: [
        strategy.summary,
        strategy.recommendedPath,
        strategy.fallbackPath,
        strategy.triggerConditions,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" "),
      tags: uniqueStrings([
        "strategy",
        strategy.route,
        strategy.worker,
        strategy.thinkingLane,
        ...strategy.skillIds,
      ]).slice(0, 12),
      sourceRuntimeId: runtimeManifest.instanceId,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
      metadata: {
        sourceKind: "strategy",
        sourceId: strategy.id,
        confidence: strategy.confidence,
      },
    }));

  const metaLearningRecords = memoryStore.metaLearning
    .filter((record) => isShareableMetaLearningRecord(record))
    .map((record) => ({
      id: `team-knowledge-learning-${record.id}`,
      namespace: "team-shareable" as const,
      title: summarizeTeamKnowledgeTitle("Learning", record.summary, record.id),
      summary: [record.summary, record.hypothesis]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" "),
      tags: uniqueStrings([
        "meta-learning",
        record.adoptedAs,
        ...record.sourceTaskIds,
        ...record.sourceReviewIds,
      ]).slice(0, 12),
      sourceRuntimeId: runtimeManifest.instanceId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      metadata: {
        sourceKind: "meta_learning",
        sourceId: record.id,
        adoptedAs: record.adoptedAs,
      },
    }));

  return [...memoryRecords, ...strategyRecords, ...metaLearningRecords]
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, 40);
}

export function buildLatestShareableReviewEnvelopes(
  opts: RuntimeStateOptions = {},
): ShareableReviewRecord[] {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return [...taskStore.reviews]
    .toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .filter((review) => toRecord(review.metadata)?.localOnly !== true)
    .slice(0, 40)
    .map((review) =>
      buildShareableReviewEnvelope(review, {
        generatedAt: now,
        metadata: {
          sourceKind: "task-review",
          outcome: review.outcome,
        },
      }),
    );
}

export function buildLatestShareableMemoryEnvelopes(
  opts: RuntimeStateOptions = {},
): ShareableMemoryEnvelope[] {
  const now = resolveNow(opts.now);
  const memoryStore = loadRuntimeMemoryStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return [...memoryStore.memories]
    .filter((memory) => isShareableMemoryRecord(memory))
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, 40)
    .map((memory) => buildShareableMemoryEnvelope(memory, now));
}

export function buildLatestTeamKnowledgeEnvelope(
  opts: RuntimeStateOptions = {},
): TeamKnowledgeEnvelope {
  const now = resolveNow(opts.now);
  const runtimeManifest = buildRuntimeManifest({
    instanceManifest: resolveInstanceManifest({
      env: opts.env,
      homedir: opts.homedir,
    }),
    runtimeVersion: resolveRuntimeServiceVersion(opts.env ?? process.env),
    generatedAt: now,
  });
  return {
    schemaVersion: "v1",
    type: "team-knowledge",
    sourceRuntimeId: runtimeManifest.instanceId,
    generatedAt: now,
    payload: {
      records: buildLocalTeamKnowledgeRecords(opts, runtimeManifest, now),
    },
  };
}

export function buildLatestNewsDigestEnvelope(opts: RuntimeStateOptions = {}): NewsDigestEnvelope {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return {
    schemaVersion: "v1",
    type: "news-digest",
    sourceRuntimeId: buildRuntimeManifest({
      instanceManifest: resolveInstanceManifest({
        env: opts.env,
        homedir: opts.homedir,
      }),
      runtimeVersion: resolveRuntimeServiceVersion(opts.env ?? process.env),
      generatedAt: now,
    }).instanceId,
    generatedAt: now,
    payload: {
      digestItems: [...intelStore.digestItems]
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .slice(0, 40),
    },
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
