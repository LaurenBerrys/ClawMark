import { resolveRuntimeCapabilityPolicy } from "./capability-plane.js";
import type {
  ArchivedTaskStep,
  BudgetMode,
  DecisionConfig,
  DecisionRecord,
  DecisionTaskInput,
  RetrievalMode,
  RuntimeMetadata,
  StrategyRecord,
  TaskReportPolicy,
  TaskReportRecord,
  RuntimeTaskStore,
  TaskRecord,
  TaskReview,
  TaskRun,
  TaskStep,
  TaskStatus,
  ThinkingLane,
  GoalStateCheckpoint,
} from "./contracts.js";
import { buildDecisionRecord } from "./decision-core.js";
import { syncRuntimeFederationAssignmentTaskLifecycle } from "./federation-assignment-sync.js";
import { syncRuntimeFederationCoordinatorSuggestionTaskLifecycle } from "./federation-coordinator-sync.js";
import {
  readFederationInboxMaintenanceControls,
  reviewRuntimeFederationInboxMaintenance,
  summarizeFederationInboxMaintenance,
} from "./federation-maintenance.js";
import {
  readFederationRemoteSyncMaintenanceControls,
  summarizeFederationRemoteSyncMaintenance,
} from "./federation-remote-maintenance.js";
import { syncRuntimeFederationRemote } from "./federation-sync.js";
import { dispatchRuntimeIntelDeliveries, previewRuntimeIntelDeliveries } from "./intel-delivery.js";
import { maybeRunScheduledIntelRefresh } from "./intel-refresh.js";
import { resolveRuntimeMemoryLifecycleControls } from "./memory-lifecycle.js";
import {
  applyRuntimeMemoryLifecycleReview,
  applyRuntimeMemoryLineageReinforcement,
  applyRuntimeTaskOutcomeMemoryUpdate,
  applyRuntimeUserControlMemoryUpdate,
} from "./memory-update-engine.js";
import {
  materializeAdoptedEvolutionStrategies,
  maybeAutoApplyLowRiskEvolution,
  observeTaskOutcomeForEvolution,
  persistTaskLifecycleArtifacts,
  reviewRuntimeEvolution,
} from "./mutations.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import {
  appendRuntimeEvent,
  buildRuntimeRetrievalSourceSet,
  loadRuntimeTaskStore,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  saveRuntimeTaskStore,
  type RuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import {
  buildTaskRecordSnapshot,
  buildTaskStepSnapshot,
  type TaskRecordSnapshotInput,
} from "./task-artifacts.js";
import {
  buildActiveTaskConcurrencySnapshot,
  compareTaskQueueOrder,
  hasActiveTaskLease,
  isTerminalTaskStatus,
  normalizeTaskStatus,
  resolveTaskSchedulerPolicy,
  shouldTaskRun,
} from "./task-loop.js";
import {
  resolveRuntimeUserPreferenceView,
  reviewRuntimeUserConsoleMaintenance,
  listRuntimeResolvedSurfaceProfiles,
} from "./user-console.js";

const TASK_RETRY_BACKOFF_MINUTES = [3, 10, 30] as const;
const TASK_MAX_CONSECUTIVE_FAILURES = 4;
const TASK_BLOCK_NOTIFY_AFTER_MS = 10 * 60 * 1000;
const TASK_SCHEDULER_LEASE_OWNER = "runtime-task-loop";
const TASK_SCHEDULER_DEFER_MS = 30 * 1000;

type RuntimeTaskRunState = {
  consecutiveFailures?: number;
  totalFailures?: number;
  replanCount?: number;
  remoteCallCount?: number;
  lastDecisionAt?: number;
  lastThinkingLane?: ThinkingLane;
  lastDecisionSummary?: string;
  lastRecommendedWorker?: string;
  lastRecommendedSkills?: string[];
  lastRelevantMemoryIds?: string[];
  lastRelevantSessionIds?: string[];
  lastReportPolicy?: TaskReportPolicy;
  lastReportVerbosity?: NonNullable<TaskReportRecord["reportVerbosity"]>;
  lastInterruptionThreshold?: NonNullable<TaskReportRecord["interruptionThreshold"]>;
  lastConfirmationBoundary?: NonNullable<TaskReportRecord["confirmationBoundary"]>;
  lastRetrievalQueryId?: string;
  lastContextSummary?: string;
  lastContextSynthesis?: string[];
  lastStrategyCandidateIds?: string[];
  lastArchiveCandidateIds?: string[];
  lastFallbackOrder?: string[];
  lastFailureAt?: number;
  lastFailureSummary?: string;
  lastResultStatus?: string;
  lastResultSummary?: string;
  lastWorkerOutput?: string;
  lastCliExitCode?: number;
  lastUserResponseAt?: number;
  lastUserResponseSummary?: string;
  lastUserResponseBy?: string;
  lastUserResponseMemoryIds?: string[];
  userResponseCount?: number;
  blockedAt?: number | null;
  lastRetryStrategyId?: string;
  lastRetryDelayMinutes?: number;
  lastRetryBlockedThreshold?: number;
};

type RuntimeTaskOptimizationState = {
  needsReplan?: boolean;
  lastReplannedAt?: number;
  invalidatedBy?: string[];
  invalidatedMemoryIds?: string[];
  decision?: DecisionRecord;
};

type RuntimeTaskScheduleState = {
  lastCompletedAt?: number;
  lastScheduledAt?: number;
  lastScheduleIntervalMinutes?: number;
  rescheduleCount?: number;
};

type ResolvedTaskReportPreferences = {
  reportPolicy: TaskReportPolicy;
  reportVerbosity: NonNullable<TaskReportRecord["reportVerbosity"]>;
  interruptionThreshold: NonNullable<TaskReportRecord["interruptionThreshold"]>;
  confirmationBoundary: NonNullable<TaskReportRecord["confirmationBoundary"]>;
};

export type RuntimeTaskPlannedResult = {
  kind: "planned";
  task: TaskRecord;
  run: TaskRun;
  decision: DecisionRecord;
};

export type RuntimeTaskDeferredReason =
  | "lease_active"
  | "worker_concurrency"
  | "route_concurrency"
  | "capability_governance";

export type RuntimeTaskDeferredResult = {
  kind: "deferred";
  task: TaskRecord;
  decision: DecisionRecord | null;
  reason: RuntimeTaskDeferredReason;
  activeTaskIds: string[];
  constrainedWorker?: string;
  constrainedRoute?: string;
};

export type RuntimeTaskPlanResult = RuntimeTaskPlannedResult | RuntimeTaskDeferredResult;

export type RuntimeTaskUpsertResult = {
  created: boolean;
  task: TaskRecord;
};

export type RuntimeTaskApplyResult = {
  task: TaskRecord;
  run: TaskRun;
  review?: TaskReview;
  report?: TaskReportRecord;
  distilledMemoryIds: string[];
  strategyIds: string[];
  metaLearningIds: string[];
};

export type RuntimeTaskLoopConfigureInput = {
  defaultBudgetMode?: BudgetMode;
  defaultRetrievalMode?: RetrievalMode;
  maxInputTokensPerTurn?: number;
  maxContextChars?: number;
  compactionWatermark?: number;
  maxRemoteCallsPerTask?: number;
  leaseDurationMs?: number;
  maxConcurrentRunsPerWorker?: number;
  maxConcurrentRunsPerRoute?: number;
};

export type RuntimeTaskLoopOptions = RuntimeStoreOptions & {
  config?: Record<string, unknown> | null;
};

export type RuntimeTaskTickResult =
  | { kind: "idle"; dueTaskIds: string[] }
  | { kind: "busy"; activeTaskIds: string[]; dueTaskIds: string[]; deferredTaskIds: string[] }
  | RuntimeTaskPlanResult;

export type RuntimeTaskResultInput = {
  taskId: string;
  status: string;
  summary?: string;
  lastResult?: string;
  lastError?: string;
  blockedReason?: string;
  needsUser?: string;
  nextRunInMinutes?: number;
  planSummary?: string;
  nextAction?: string;
  workerOutput?: string;
  cliExitCode?: number;
  now?: number;
};

export type RuntimeTaskWaitingUserResponseInput = {
  taskId: string;
  response: string;
  respondedBy?: string;
  nextAction?: string;
  now?: number;
};

export type RuntimeTaskWaitingUserResponseResult = {
  task: TaskRecord;
  run: TaskRun;
  responseMemoryIds: string[];
  resolvedReportIds: string[];
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function readTaskCompactionWatermark(taskStore: RuntimeTaskStore): number {
  return typeof taskStore.defaults.compactionWatermark === "number" &&
    Number.isFinite(taskStore.defaults.compactionWatermark) &&
    taskStore.defaults.compactionWatermark > 0
    ? Math.round(taskStore.defaults.compactionWatermark)
    : 4000;
}

function readTaskStepOutput(step: { metadata?: RuntimeMetadata }): string {
  const metadata = toRecord(step.metadata);
  return normalizeText(metadata?.workerOutput);
}

function buildArchivedTaskStep(step: TaskStep, now: number): ArchivedTaskStep {
  return {
    ...step,
    archivedAt: now,
    archiveReason: "goal_state_compaction",
    updatedAt: now,
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values?.length) {
    return [];
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
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

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildStableId(prefix: string, parts: Array<string | number | null | undefined>): string {
  const seed = parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join("|");
  return `${prefix}_${hashText(seed || prefix)}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    items.unshift(item);
    return;
  }
  items[index] = item;
}

function mergeMetadataRecords(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!left && !right) {
    return undefined;
  }
  if (!left) {
    return right ?? undefined;
  }
  if (!right) {
    return left;
  }
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = toRecord(merged[key]);
    const next = toRecord(value);
    merged[key] = current && next ? mergeMetadataRecords(current, next) : value;
  }
  return merged;
}

function collectContextCandidateIds(
  candidates: DecisionRecord["contextPack"]["strategyCandidates"],
): string[] {
  return uniqueStrings(
    candidates.map((candidate) => normalizeText(candidate.recordId) || normalizeText(candidate.id)),
  );
}

function normalizeReportPolicy(value: unknown): TaskReportPolicy | undefined {
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function readTaskContext(task: TaskRecord): { agentId?: string; sessionId?: string } {
  const metadata = toRecord(task.metadata);
  const taskContext = toRecord(metadata?.taskContext);
  const agentId = normalizeText(taskContext?.agentId);
  const sessionId = normalizeText(taskContext?.sessionId);
  return {
    agentId: agentId || undefined,
    sessionId: sessionId || undefined,
  };
}

function readTaskSurfaceBinding(task: TaskRecord): {
  surfaceId?: string;
  ownerKind?: "user" | "agent";
  ownerId?: string;
} {
  const metadata = toRecord(task.metadata);
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

function resolveTaskReportRouting(
  task: TaskRecord,
  opts: RuntimeStoreOptions = {},
): {
  reportTarget: string;
  surfaceId?: string;
  surfaceLabel?: string;
  agentId?: string;
  sessionId?: string;
  escalationTarget?: TaskReportRecord["escalationTarget"];
} {
  const { agentId, sessionId } = readTaskContext(task);
  const surfaceBinding = readTaskSurfaceBinding(task);
  const routing = {
    reportTarget: "runtime-user",
    surfaceId: surfaceBinding.surfaceId,
    surfaceLabel: undefined as string | undefined,
    agentId,
    sessionId,
    escalationTarget: undefined as TaskReportRecord["escalationTarget"],
  };
  if (!surfaceBinding.surfaceId) {
    return routing;
  }
  const profile = listRuntimeResolvedSurfaceProfiles(opts).find(
    (entry) => entry.surface.id === surfaceBinding.surfaceId,
  );
  if (!profile) {
    return routing;
  }
  return {
    ...routing,
    reportTarget: profile.effectiveReportTarget || "runtime-user",
    surfaceLabel: profile.surface.label,
    agentId: profile.agent?.id ?? routing.agentId,
    escalationTarget: profile.effectiveLocalBusinessPolicy?.escalationTarget,
  };
}

function resolveTaskEcologyBinding(
  input: TaskRecordSnapshotInput,
  existing: TaskRecord | undefined,
  stores: RuntimeStoreBundle,
): {
  agentId?: string;
  sessionId?: string;
  surfaceId?: string;
  surfaceOwnerKind?: "user" | "agent";
  surfaceOwnerId?: string;
} {
  const existingTaskContext = existing ? readTaskContext(existing) : {};
  const existingSurface = existing ? readTaskSurfaceBinding(existing) : {};
  const inputMetadata = toRecord(input.metadata);
  const inputTaskContext = toRecord(inputMetadata?.taskContext);
  const inputSurface = toRecord(inputMetadata?.surface);
  const hasAgentId = Object.prototype.hasOwnProperty.call(input, "agentId");
  const hasSessionId = Object.prototype.hasOwnProperty.call(input, "sessionId");
  const hasSurfaceId = Object.prototype.hasOwnProperty.call(input, "surfaceId");
  let agentId = hasAgentId
    ? input.agentId === null
      ? undefined
      : normalizeText(input.agentId) || undefined
    : normalizeText(inputTaskContext?.agentId) || existingTaskContext.agentId;
  const sessionId = hasSessionId
    ? input.sessionId === null
      ? undefined
      : normalizeText(input.sessionId) || undefined
    : normalizeText(inputTaskContext?.sessionId) || existingTaskContext.sessionId;
  const surfaceId = hasSurfaceId
    ? input.surfaceId === null
      ? undefined
      : normalizeText(input.surfaceId) || undefined
    : normalizeText(inputSurface?.surfaceId) || existingSurface.surfaceId;
  if (agentId && !stores.userConsoleStore?.agents.some((entry) => entry.id === agentId)) {
    throw new Error(`Task agent ${agentId} was not found.`);
  }
  if (!surfaceId) {
    return {
      agentId,
      sessionId,
    };
  }
  const surface = stores.userConsoleStore?.surfaces.find((entry) => entry.id === surfaceId);
  if (!surface) {
    throw new Error(`Task surface ${surfaceId} was not found.`);
  }
  if (surface.ownerKind === "agent") {
    const ownerId = normalizeText(surface.ownerId);
    if (!ownerId) {
      throw new Error(`Agent-owned surface ${surfaceId} is missing ownerId.`);
    }
    if (hasAgentId && agentId && agentId !== ownerId) {
      throw new Error(
        `Task surface ${surfaceId} belongs to agent ${ownerId} and cannot be rebound to agent ${agentId}.`,
      );
    }
    agentId = ownerId;
  } else {
    if (hasAgentId && agentId) {
      throw new Error(`User-owned surface ${surfaceId} cannot be bound to agent ${agentId}.`);
    }
    agentId = undefined;
  }
  return {
    agentId,
    sessionId,
    surfaceId,
    surfaceOwnerKind: surface.ownerKind,
    surfaceOwnerId: surface.ownerId,
  };
}

function buildTaskEcologyMetadata(
  existingMetadata: RuntimeMetadata | undefined,
  inputMetadata: RuntimeMetadata | undefined,
  binding: ReturnType<typeof resolveTaskEcologyBinding>,
): RuntimeMetadata | undefined {
  const merged = mergeMetadataRecords(toRecord(existingMetadata), toRecord(inputMetadata));
  const nextMetadata = merged ? { ...merged } : {};
  const nextTaskContext = {
    ...toRecord(nextMetadata.taskContext),
  };
  if (binding.agentId) {
    nextTaskContext.agentId = binding.agentId;
  } else {
    delete nextTaskContext.agentId;
  }
  if (binding.sessionId) {
    nextTaskContext.sessionId = binding.sessionId;
  } else {
    delete nextTaskContext.sessionId;
  }
  if (Object.keys(nextTaskContext).length > 0) {
    nextMetadata.taskContext = nextTaskContext;
  } else {
    delete nextMetadata.taskContext;
  }
  if (binding.surfaceId) {
    const nextSurface = {
      ...toRecord(nextMetadata.surface),
      surfaceId: binding.surfaceId,
      ownerKind: binding.surfaceOwnerKind,
      ownerId: binding.surfaceOwnerId,
    };
    if (!nextSurface.ownerId) {
      delete nextSurface.ownerId;
    }
    nextMetadata.surface = nextSurface;
  } else {
    delete nextMetadata.surface;
  }
  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function resolveEffectiveTaskReportPreferences(
  task: TaskRecord,
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
): ResolvedTaskReportPreferences {
  const direct = normalizeReportPolicy(task.reportPolicy);
  const taskContext = readTaskContext(task);
  const preferenceView = resolveRuntimeUserPreferenceView(
    {
      agentId: taskContext.agentId,
      sessionId: taskContext.sessionId,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    reportPolicy: direct ?? preferenceView.effective.reportPolicy ?? "reply",
    reportVerbosity: preferenceView.effective.reportVerbosity ?? "balanced",
    interruptionThreshold: preferenceView.effective.interruptionThreshold ?? "medium",
    confirmationBoundary: preferenceView.effective.confirmationBoundary ?? "balanced",
  };
}

function resolveTaskReportKind(status: TaskStatus): TaskReportRecord["kind"] | undefined {
  if (status === "waiting_user") {
    return "waiting_user";
  }
  if (status === "completed") {
    return "completion";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "waiting_external") {
    return "waiting_external";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return undefined;
}

function shouldPersistTaskReport(
  task: TaskRecord,
  status: TaskStatus,
  preferences: ResolvedTaskReportPreferences,
): boolean {
  if (status === "waiting_user") {
    return true;
  }
  if (
    preferences.reportPolicy !== "proactive" &&
    preferences.reportPolicy !== "reply_and_proactive"
  ) {
    return false;
  }
  if (status === "completed" || status === "cancelled") {
    return true;
  }
  if (status === "blocked") {
    if (preferences.interruptionThreshold === "low" && task.priority !== "high") {
      return preferences.confirmationBoundary === "strict";
    }
    return true;
  }
  if (status === "waiting_external") {
    if (task.priority === "high") {
      return true;
    }
    if (preferences.interruptionThreshold === "high") {
      return true;
    }
    return preferences.confirmationBoundary === "strict";
  }
  return false;
}

function buildTaskReportTitle(task: TaskRecord, kind: TaskReportRecord["kind"]): string {
  if (kind === "waiting_user") {
    return `Task waiting for user input: ${task.title}`;
  }
  if (kind === "completion") {
    return `Task completed: ${task.title}`;
  }
  if (kind === "blocked") {
    return `Task blocked: ${task.title}`;
  }
  if (kind === "waiting_external") {
    return `Task waiting on external dependency: ${task.title}`;
  }
  return `Task cancelled: ${task.title}`;
}

function buildTaskReportSummary(
  task: TaskRecord,
  params: {
    kind: TaskReportRecord["kind"];
    baseSummary?: string;
    nextAction?: string;
    review?: TaskReview;
  },
): string {
  const summary =
    normalizeText(params.baseSummary) ||
    normalizeText(params.review?.summary) ||
    normalizeText(task.nextAction) ||
    normalizeText(task.planSummary) ||
    normalizeText(task.goal) ||
    normalizeText(task.blockedReason) ||
    normalizeText(task.lastError);
  if (summary) {
    return summary;
  }
  if (params.kind === "waiting_user") {
    return "Task is paused until the runtime user answers the pending question.";
  }
  if (params.kind === "completion") {
    return "Task completed successfully and the runtime recorded review artifacts.";
  }
  if (params.kind === "blocked") {
    return "Task is blocked and requires a new plan or manual intervention.";
  }
  if (params.kind === "waiting_external") {
    return "Task is waiting for an external dependency before it can resume.";
  }
  return "Task was cancelled before completion.";
}

function finalizeTaskReportSummary(
  summary: string,
  task: TaskRecord,
  params: {
    kind: TaskReportRecord["kind"];
    nextAction?: string;
    review?: TaskReview;
    preferences: ResolvedTaskReportPreferences;
  },
): string {
  const normalizedSummary = normalizeText(summary);
  const nextAction = normalizeText(params.nextAction || task.nextAction);
  const reviewSummary = normalizeText(params.review?.summary);
  const confirmationHint =
    params.preferences.confirmationBoundary === "strict"
      ? params.kind === "waiting_user"
        ? "Operator confirmation is required before the runtime continues."
        : params.kind === "blocked" || params.kind === "waiting_external"
          ? "Operator confirmation remains enabled before execution resumes."
          : undefined
      : undefined;
  if (params.preferences.reportVerbosity === "detailed") {
    return [
      normalizedSummary,
      nextAction && !normalizedSummary.includes(nextAction)
        ? `Next action: ${nextAction}`
        : undefined,
      reviewSummary && reviewSummary !== normalizedSummary ? `Review: ${reviewSummary}` : undefined,
      confirmationHint,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (params.preferences.reportVerbosity === "brief") {
    const brief = confirmationHint
      ? `${confirmationHint} ${normalizedSummary}`.trim()
      : normalizedSummary;
    return truncateText(brief, 120);
  }
  if (!confirmationHint) {
    return normalizedSummary;
  }
  return `${normalizedSummary} ${confirmationHint}`.trim();
}

function resolveTaskReportsForTask(
  taskStore: RuntimeTaskStore,
  params: {
    taskId: string;
    now: number;
    reason: string;
    kind?: TaskReportRecord["kind"];
    requireUserAction?: boolean;
    keepId?: string;
  },
): string[] {
  const resolvedIds: string[] = [];
  taskStore.reports = taskStore.reports.map((report) => {
    if (
      report.taskId !== params.taskId ||
      report.state === "resolved" ||
      report.id === params.keepId
    ) {
      return report;
    }
    if (params.kind && report.kind !== params.kind) {
      return report;
    }
    if (params.requireUserAction === true && !report.requiresUserAction) {
      return report;
    }
    resolvedIds.push(report.id);
    return {
      ...report,
      state: "resolved",
      updatedAt: params.now,
      resolvedAt: params.now,
      metadata: {
        ...toRecord(report.metadata),
        resolutionReason: params.reason,
      },
    };
  });
  return resolvedIds;
}

function persistRuntimeTaskReport(
  params: {
    task: TaskRecord;
    reportedStatus: TaskStatus;
    run: TaskRun;
    review?: TaskReview;
    baseSummary?: string;
    preferences: ResolvedTaskReportPreferences;
    existingNotifyStep?: { id?: string } | null;
    now: number;
  },
  opts: RuntimeStoreOptions = {},
): TaskReportRecord | undefined {
  const kind = resolveTaskReportKind(params.reportedStatus);
  if (!kind || !shouldPersistTaskReport(params.task, params.reportedStatus, params.preferences)) {
    return undefined;
  }

  const stores = loadRuntimeStoreBundle({
    ...opts,
    now: params.now,
  });
  const resolvedIds = resolveTaskReportsForTask(stores.taskStore, {
    taskId: params.task.id,
    now: params.now,
    kind: kind === "waiting_user" ? "waiting_user" : undefined,
    requireUserAction: kind === "waiting_user",
    reason:
      kind === "waiting_user"
        ? "superseded-by-new-waiting-user-report"
        : "superseded-by-new-task-report",
  });
  const requiresUserAction = kind === "waiting_user";
  const reportRouting = resolveTaskReportRouting(params.task, {
    ...opts,
    now: params.now,
  });
  const report: TaskReportRecord = {
    id: buildStableId("task_report", [params.task.id, params.run.id, kind, params.now]),
    taskId: params.task.id,
    runId: params.run.id,
    reviewId: params.review?.id,
    taskStatus: params.reportedStatus,
    kind,
    state: requiresUserAction ? "pending" : "delivered",
    reportPolicy: params.preferences.reportPolicy,
    reportVerbosity: params.preferences.reportVerbosity,
    interruptionThreshold: params.preferences.interruptionThreshold,
    confirmationBoundary: params.preferences.confirmationBoundary,
    title: buildTaskReportTitle(params.task, kind),
    summary: finalizeTaskReportSummary(
      buildTaskReportSummary(params.task, {
        kind,
        baseSummary: params.baseSummary,
        nextAction: params.task.nextAction,
        review: params.review,
      }),
      params.task,
      {
        kind,
        nextAction: params.task.nextAction,
        review: params.review,
        preferences: params.preferences,
      },
    ),
    nextAction: normalizeText(params.task.nextAction) || undefined,
    requiresUserAction,
    reportTarget: reportRouting.reportTarget,
    surfaceId: reportRouting.surfaceId,
    surfaceLabel: reportRouting.surfaceLabel,
    agentId: reportRouting.agentId,
    sessionId: reportRouting.sessionId,
    escalationTarget: reportRouting.escalationTarget,
    createdAt: params.now,
    updatedAt: params.now,
    deliveredAt: requiresUserAction ? undefined : params.now,
    metadata: {
      route: params.task.route,
      worker: params.task.worker,
      resolvedSupersededReportIds: resolvedIds,
      reportTarget: reportRouting.reportTarget,
      surfaceId: reportRouting.surfaceId,
      surfaceLabel: reportRouting.surfaceLabel,
      agentId: reportRouting.agentId,
      sessionId: reportRouting.sessionId,
      escalationTarget: reportRouting.escalationTarget,
    },
  };
  upsertById(stores.taskStore.reports, report);

  const notifyStep =
    params.existingNotifyStep?.id && kind === "waiting_user"
      ? stores.taskStore.steps.find((entry) => entry.id === params.existingNotifyStep?.id)
      : undefined;
  if (notifyStep) {
    notifyStep.metadata = mergeMetadataRecords(toRecord(notifyStep.metadata), {
      reportId: report.id,
      reportPolicy: params.preferences.reportPolicy,
      reportVerbosity: params.preferences.reportVerbosity,
      interruptionThreshold: params.preferences.interruptionThreshold,
      confirmationBoundary: params.preferences.confirmationBoundary,
      reportState: report.state,
      reportTarget: report.reportTarget,
      surfaceId: report.surfaceId,
      surfaceLabel: report.surfaceLabel,
      agentId: report.agentId,
      sessionId: report.sessionId,
      escalationTarget: report.escalationTarget,
    });
  } else {
    const taskStep = buildTaskStepSnapshot({
      taskId: params.task.id,
      runId: params.run.id,
      kind: "notify",
      status: requiresUserAction ? "queued" : "completed",
      idempotencyKey: `runtime-report:${params.task.id}:${report.id}`,
      worker: params.task.worker,
      route: params.task.route,
      startedAt: params.now,
      completedAt: requiresUserAction ? undefined : params.now,
      metadata: {
        reportId: report.id,
        reportPolicy: params.preferences.reportPolicy,
        reportVerbosity: params.preferences.reportVerbosity,
        interruptionThreshold: params.preferences.interruptionThreshold,
        confirmationBoundary: params.preferences.confirmationBoundary,
        reportState: report.state,
        reportedStatus: params.reportedStatus,
        reportTarget: report.reportTarget,
        surfaceId: report.surfaceId,
        surfaceLabel: report.surfaceLabel,
        agentId: report.agentId,
        sessionId: report.sessionId,
        escalationTarget: report.escalationTarget,
      },
    });
    upsertById(stores.taskStore.steps, taskStep);
  }

  saveRuntimeStoreBundle(stores, {
    ...opts,
    now: params.now,
  });
  appendRuntimeEvent(
    "runtime_task_report_persisted",
    {
      taskId: params.task.id,
      runId: params.run.id,
      reviewId: params.review?.id,
      reportId: report.id,
      reportKind: report.kind,
      reportState: report.state,
      reportPolicy: report.reportPolicy,
      reportVerbosity: report.reportVerbosity,
      interruptionThreshold: report.interruptionThreshold,
      confirmationBoundary: report.confirmationBoundary,
      resolvedSupersededReportIds: resolvedIds,
      reportTarget: report.reportTarget,
      surfaceId: report.surfaceId,
      surfaceLabel: report.surfaceLabel,
      agentId: report.agentId,
      sessionId: report.sessionId,
      escalationTarget: report.escalationTarget,
    },
    {
      ...opts,
      now: params.now,
    },
  );
  return report;
}

function readTaskRunState(task: TaskRecord): RuntimeTaskRunState {
  const metadata = toRecord(task.metadata);
  const runtime = toRecord(metadata?.runtimeTask);
  const runState = toRecord(runtime?.runState);
  return {
    consecutiveFailures:
      typeof runState?.consecutiveFailures === "number" ? runState.consecutiveFailures : 0,
    totalFailures: typeof runState?.totalFailures === "number" ? runState.totalFailures : 0,
    replanCount: typeof runState?.replanCount === "number" ? runState.replanCount : 0,
    remoteCallCount: typeof runState?.remoteCallCount === "number" ? runState.remoteCallCount : 0,
    lastDecisionAt:
      typeof runState?.lastDecisionAt === "number" ? runState.lastDecisionAt : undefined,
    lastThinkingLane: runState?.lastThinkingLane === "system2" ? "system2" : "system1",
    lastDecisionSummary: normalizeText(runState?.lastDecisionSummary) || undefined,
    lastRecommendedWorker: normalizeText(runState?.lastRecommendedWorker) || undefined,
    lastRecommendedSkills: Array.isArray(runState?.lastRecommendedSkills)
      ? uniqueStrings(
          runState.lastRecommendedSkills.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    lastRetrievalQueryId: normalizeText(runState?.lastRetrievalQueryId) || undefined,
    lastContextSummary: normalizeText(runState?.lastContextSummary) || undefined,
    lastContextSynthesis: Array.isArray(runState?.lastContextSynthesis)
      ? uniqueStrings(
          runState.lastContextSynthesis.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    lastStrategyCandidateIds: Array.isArray(runState?.lastStrategyCandidateIds)
      ? uniqueStrings(
          runState.lastStrategyCandidateIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    lastArchiveCandidateIds: Array.isArray(runState?.lastArchiveCandidateIds)
      ? uniqueStrings(
          runState.lastArchiveCandidateIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    lastRelevantMemoryIds: Array.isArray(runState?.lastRelevantMemoryIds)
      ? uniqueStrings(
          runState.lastRelevantMemoryIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    lastRelevantSessionIds: Array.isArray(runState?.lastRelevantSessionIds)
      ? uniqueStrings(
          runState.lastRelevantSessionIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : Array.isArray(runState?.lastRelevantIntelIds)
        ? uniqueStrings(
            runState.lastRelevantIntelIds.filter(
              (value): value is string => typeof value === "string",
            ),
          )
        : [],
    lastFallbackOrder: Array.isArray(runState?.lastFallbackOrder)
      ? uniqueStrings(
          runState.lastFallbackOrder.filter((value): value is string => typeof value === "string"),
        )
      : [],
    lastFailureAt: typeof runState?.lastFailureAt === "number" ? runState.lastFailureAt : undefined,
    lastFailureSummary: normalizeText(runState?.lastFailureSummary) || undefined,
    lastResultStatus: normalizeText(runState?.lastResultStatus) || undefined,
    lastResultSummary: normalizeText(runState?.lastResultSummary) || undefined,
    lastWorkerOutput: normalizeText(runState?.lastWorkerOutput) || undefined,
    lastCliExitCode:
      typeof runState?.lastCliExitCode === "number" ? runState.lastCliExitCode : undefined,
    lastUserResponseAt:
      typeof runState?.lastUserResponseAt === "number" ? runState.lastUserResponseAt : undefined,
    lastUserResponseSummary: normalizeText(runState?.lastUserResponseSummary) || undefined,
    lastUserResponseBy: normalizeText(runState?.lastUserResponseBy) || undefined,
    lastUserResponseMemoryIds: Array.isArray(runState?.lastUserResponseMemoryIds)
      ? uniqueStrings(
          runState.lastUserResponseMemoryIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    userResponseCount:
      typeof runState?.userResponseCount === "number" ? runState.userResponseCount : 0,
    blockedAt:
      runState?.blockedAt == null
        ? undefined
        : typeof runState.blockedAt === "number"
          ? runState.blockedAt
          : null,
  };
}

function readTaskOptimizationState(task: TaskRecord): RuntimeTaskOptimizationState {
  const metadata = toRecord(task.metadata);
  const runtime = toRecord(metadata?.runtimeTask);
  const optimizationState = toRecord(runtime?.optimizationState);
  return {
    needsReplan: optimizationState?.needsReplan === true,
    lastReplannedAt:
      typeof optimizationState?.lastReplannedAt === "number"
        ? optimizationState.lastReplannedAt
        : undefined,
    invalidatedBy: Array.isArray(optimizationState?.invalidatedBy)
      ? uniqueStrings(
          optimizationState.invalidatedBy.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    invalidatedMemoryIds: Array.isArray(optimizationState?.invalidatedMemoryIds)
      ? uniqueStrings(
          optimizationState.invalidatedMemoryIds.filter(
            (value): value is string => typeof value === "string",
          ),
        )
      : [],
    decision: toRecord(optimizationState?.decision) as DecisionRecord | undefined,
  };
}

function readTaskScheduleState(task: TaskRecord): RuntimeTaskScheduleState {
  const metadata = toRecord(task.metadata);
  const runtime = toRecord(metadata?.runtimeTask);
  const scheduleState = toRecord(runtime?.scheduleState);
  return {
    lastCompletedAt:
      typeof scheduleState?.lastCompletedAt === "number"
        ? scheduleState.lastCompletedAt
        : undefined,
    lastScheduledAt:
      typeof scheduleState?.lastScheduledAt === "number"
        ? scheduleState.lastScheduledAt
        : undefined,
    lastScheduleIntervalMinutes:
      typeof scheduleState?.lastScheduleIntervalMinutes === "number" &&
      scheduleState.lastScheduleIntervalMinutes > 0
        ? Math.round(scheduleState.lastScheduleIntervalMinutes)
        : undefined,
    rescheduleCount:
      typeof scheduleState?.rescheduleCount === "number" ? scheduleState.rescheduleCount : 0,
  };
}

// Keep mutable scheduler/runtime state under metadata until contracts gain dedicated fields.
function writeTaskRuntimeMetadata(
  task: TaskRecord,
  params: {
    runState?: Partial<RuntimeTaskRunState>;
    optimizationState?: Partial<RuntimeTaskOptimizationState>;
    scheduleState?: Partial<RuntimeTaskScheduleState>;
  },
): RuntimeMetadata {
  const metadata = toRecord(task.metadata) ?? {};
  const runtime = toRecord(metadata.runtimeTask) ?? {};
  const currentRunState = readTaskRunState(task);
  const currentOptimizationState = readTaskOptimizationState(task);
  const currentScheduleState = readTaskScheduleState(task);
  return {
    ...metadata,
    runtimeTask: {
      ...runtime,
      runState: {
        ...currentRunState,
        ...params.runState,
      },
      optimizationState: {
        ...currentOptimizationState,
        ...params.optimizationState,
      },
      scheduleState: {
        ...currentScheduleState,
        ...params.scheduleState,
      },
    },
  };
}

function buildDecisionConfig(taskStore: RuntimeTaskStore): DecisionConfig {
  return {
    maxInputTokensPerTurn: taskStore.defaults.maxInputTokensPerTurn,
    maxRemoteCallsPerTask: taskStore.defaults.maxRemoteCallsPerTask,
    maxContextChars: taskStore.defaults.maxContextChars,
  };
}

function writeTaskRecord(
  stores: RuntimeStoreBundle,
  task: TaskRecord,
  opts: RuntimeStoreOptions,
): TaskRecord {
  const index = stores.taskStore.tasks.findIndex((entry) => entry.id === task.id);
  if (index < 0) {
    stores.taskStore.tasks.unshift(task);
  } else {
    stores.taskStore.tasks[index] = task;
  }
  const saved = saveRuntimeStoreBundle(stores, opts);
  return saved.taskStore.tasks.find((entry) => entry.id === task.id) ?? task;
}

function readEvolutionControls(metadata: RuntimeMetadata | undefined): {
  enabled: boolean;
  autoApplyLowRisk: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
} {
  const record = toRecord(metadata);
  const reviewIntervalHours = Number(record?.reviewIntervalHours);
  const lastReviewAt = Number(record?.lastReviewAt);
  return {
    enabled: record?.enabled !== false,
    autoApplyLowRisk: record?.autoApplyLowRisk === true,
    reviewIntervalHours:
      Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
        ? Math.trunc(reviewIntervalHours)
        : 12,
    lastReviewAt:
      Number.isFinite(lastReviewAt) && lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
  };
}

function maybeRunScheduledEvolutionReview(
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
) {
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const controls = readEvolutionControls(stores.governanceStore.metadata);
  if (!controls.enabled) {
    return false;
  }
  if (
    stores.memoryStore.evolutionMemory.length === 0 &&
    stores.governanceStore.shadowEvaluations.length === 0
  ) {
    return false;
  }
  const reviewIntervalMs = controls.reviewIntervalHours * 60 * 60 * 1000;
  if (controls.lastReviewAt && now - controls.lastReviewAt < reviewIntervalMs) {
    return false;
  }
  reviewRuntimeEvolution({
    ...opts,
    now,
  });
  return true;
}

function readMemoryLifecycleControls(metadata: RuntimeMetadata | undefined): {
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
} {
  return resolveRuntimeMemoryLifecycleControls(metadata);
}

function maybeRunScheduledMemoryLifecycleReview(
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
) {
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const controls = readMemoryLifecycleControls(stores.memoryStore.metadata);
  if (!controls.enabled) {
    return false;
  }
  if (stores.memoryStore.memories.length === 0 && stores.memoryStore.strategies.length === 0) {
    return false;
  }
  const reviewIntervalMs = controls.reviewIntervalHours * 60 * 60 * 1000;
  if (controls.lastReviewAt && now - controls.lastReviewAt < reviewIntervalMs) {
    return false;
  }
  applyRuntimeMemoryLifecycleReview({
    ...opts,
    now,
  });
  return true;
}

function readUserConsoleMaintenanceControls(metadata: RuntimeMetadata | undefined): {
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lastSessionCleanupAt?: number;
} {
  const record = toRecord(metadata);
  const reviewIntervalHours = Number(record?.reviewIntervalHours);
  const lastReviewAt = Number(record?.lastReviewAt);
  const lastSessionCleanupAt = Number(record?.lastSessionCleanupAt);
  return {
    enabled: record?.enabled !== false,
    reviewIntervalHours:
      Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
        ? Math.trunc(reviewIntervalHours)
        : 12,
    lastReviewAt:
      Number.isFinite(lastReviewAt) && lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
    lastSessionCleanupAt:
      Number.isFinite(lastSessionCleanupAt) && lastSessionCleanupAt > 0
        ? Math.trunc(lastSessionCleanupAt)
        : undefined,
  };
}

function maybeRunScheduledUserConsoleMaintenance(
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
) {
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const userConsoleStore = stores.userConsoleStore;
  if (!userConsoleStore) {
    return false;
  }
  const controls = readUserConsoleMaintenanceControls(userConsoleStore.metadata);
  if (!controls.enabled) {
    return false;
  }
  const hasExpiredSessionPreferences = userConsoleStore.sessionWorkingPreferences.some(
    (entry) => !!entry.expiresAt && entry.expiresAt <= now,
  );
  const hasReviewableSignals =
    userConsoleStore.sessionWorkingPreferences.length > 0 ||
    userConsoleStore.surfaces.length > 0 ||
    userConsoleStore.roleOptimizationCandidates.length > 0 ||
    userConsoleStore.userModelOptimizationCandidates.length > 0;
  if (!hasExpiredSessionPreferences && !hasReviewableSignals) {
    return false;
  }
  const reviewIntervalMs = controls.reviewIntervalHours * 60 * 60 * 1000;
  if (
    !hasExpiredSessionPreferences &&
    controls.lastReviewAt &&
    now - controls.lastReviewAt < reviewIntervalMs
  ) {
    return false;
  }
  reviewRuntimeUserConsoleMaintenance({
    ...opts,
    now,
  });
  return true;
}

function maybeRunScheduledFederationInboxMaintenance(
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
) {
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const federationStore = stores.federationStore;
  if (!federationStore) {
    return false;
  }
  const controls = readFederationInboxMaintenanceControls(federationStore.metadata);
  if (!controls.enabled) {
    return false;
  }
  const summary = summarizeFederationInboxMaintenance(federationStore.inbox, controls, now);
  if (summary.pendingReviewCount === 0) {
    return false;
  }
  const reviewIntervalMs = controls.reviewIntervalHours * 60 * 60 * 1000;
  if (
    summary.stalePackageCount === 0 &&
    controls.lastReviewAt &&
    now - controls.lastReviewAt < reviewIntervalMs
  ) {
    return false;
  }
  reviewRuntimeFederationInboxMaintenance({
    ...opts,
    now,
  });
  return true;
}

async function maybeRunScheduledFederationRemoteSync(
  opts: RuntimeTaskLoopOptions = {},
  now = resolveNow(opts.now),
) {
  if (!opts.config) {
    return false;
  }
  const stores = loadRuntimeStoreBundle({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationStore = stores.federationStore;
  if (!federationStore) {
    return false;
  }
  const controls = readFederationRemoteSyncMaintenanceControls(federationStore.metadata);
  const snapshot = buildFederationRuntimeSnapshot({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config: opts.config,
  });
  const summary = summarizeFederationRemoteSyncMaintenance({
    controls,
    remoteEnabled: snapshot.enabled,
    remoteConfigured: snapshot.remoteConfigured,
    syncCursor: federationStore.syncCursor,
    latestAttempt: snapshot.latestSyncAttempts[0] ?? null,
    now,
  });
  if (!summary.due) {
    return false;
  }
  try {
    await syncRuntimeFederationRemote({
      env: opts.env,
      homedir: opts.homedir,
      now,
      config: opts.config,
      trigger: "scheduled",
    });
    return true;
  } catch {
    return false;
  }
}

function maybeRefreshIntel(opts: RuntimeStoreOptions = {}, now = resolveNow(opts.now)) {
  void maybeRefreshIntelInternal({
    ...opts,
    now,
  });
  return true;
}

async function maybeRefreshIntelInternal(opts: RuntimeStoreOptions = {}) {
  try {
    await maybeRunScheduledIntelRefresh(opts);
  } catch {
    // Background task fails silently
  }
}

function maybeRunScheduledIntelDeliveries(
  opts: RuntimeStoreOptions = {},
  now = resolveNow(opts.now),
) {
  const pending = previewRuntimeIntelDeliveries({
    ...opts,
    now,
  });
  if (pending.items.length === 0) {
    return false;
  }
  dispatchRuntimeIntelDeliveries({
    ...opts,
    now,
  });
  return true;
}

function buildDecisionTaskInput(task: TaskRecord): DecisionTaskInput {
  const runState = readTaskRunState(task);
  const taskContext = readTaskContext(task);
  const taskSurface = readTaskSurfaceBinding(task);
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    route: task.route,
    agentId: taskContext.agentId,
    sessionId: taskContext.sessionId,
    surfaceId: taskSurface.surfaceId,
    priority: task.priority,
    budgetMode: task.budgetMode,
    retrievalMode: task.retrievalMode,
    worker: task.worker,
    skillIds: task.skillIds,
    tags: task.tags ?? [],
    blockedReason: task.blockedReason,
    lastError: task.lastError,
    runState: {
      consecutiveFailures: runState.consecutiveFailures,
      remoteCallCount: runState.remoteCallCount,
    },
    metadata: task.metadata,
  };
}

function buildPlanningSummary(
  task: TaskRecord,
  optimizationState?: RuntimeTaskOptimizationState,
): string {
  const invalidatedMemoryIds = uniqueStrings(optimizationState?.invalidatedMemoryIds ?? []);
  const replanPrefix =
    optimizationState?.needsReplan || invalidatedMemoryIds.length > 0
      ? `Rebuild the plan after invalidated memory lineage removed ${
          invalidatedMemoryIds.length || "relevant"
        } runtime context references. `
      : "";
  const skillText =
    task.skillIds.length > 0
      ? `prioritize skills: ${task.skillIds.slice(0, 5).join(", ")}`
      : "prioritize stable local tools and known skills";
  return `${replanPrefix}Proceed on the ${task.route || "general"} lane and ${skillText}.`;
}

function buildNextActionSummary(
  task: TaskRecord,
  optimizationState?: RuntimeTaskOptimizationState,
): string {
  const invalidatedMemoryIds = uniqueStrings(optimizationState?.invalidatedMemoryIds ?? []);
  if (optimizationState?.needsReplan || invalidatedMemoryIds.length > 0) {
    const scopeText =
      invalidatedMemoryIds.length > 0
        ? ` ${invalidatedMemoryIds.length} invalidated memory reference(s)`
        : " invalidated runtime memory lineage";
    return `Refresh the task context after removing${scopeText}, then choose the cheapest safe execution path.`;
  }
  if (task.route === "office") {
    return "Organize the request and update the lowest-cost office workflow first.";
  }
  if (task.route === "coder") {
    return "Read the repo and current diff, then shape the smallest executable patch.";
  }
  if (task.route === "ops") {
    return "Read logs, ports, processes, and config before attempting a repair.";
  }
  if (task.route === "media") {
    return "Extract the source material into structured data before asking for higher-level judgment.";
  }
  if (task.route === "research") {
    return "Retrieve, rank, and compress the signal before deep synthesis.";
  }
  return "Identify the task shape first, then choose the cheapest valid execution path.";
}

function buildDeferredConcurrencyText(
  reason: RuntimeTaskDeferredReason,
  task: TaskRecord,
  params: {
    constrainedWorker?: string;
    constrainedRoute?: string;
    used: number;
    limit: number;
  },
): { planSummary: string; nextAction: string } {
  if (reason === "lease_active") {
    return {
      planSummary: "Task lease is still active; wait before scheduling another run.",
      nextAction: "Wait for the current lease to expire or for the active run to report back.",
    };
  }
  if (reason === "worker_concurrency") {
    return {
      planSummary: `Worker ${params.constrainedWorker ?? task.worker ?? "main"} is at concurrency capacity (${params.used}/${params.limit}).`,
      nextAction: "Keep the task ready and retry planning after another worker slot is released.",
    };
  }
  if (reason === "capability_governance") {
    return {
      planSummary: `Capability governance does not currently expose a live-adopted worker for ${
        params.constrainedWorker ?? task.worker ?? "this task"
      }.`,
      nextAction:
        "Promote or adopt a governed worker for the live route, or update the task routing policy before retrying.",
    };
  }
  return {
    planSummary: `Route ${params.constrainedRoute ?? task.route} is at concurrency capacity (${params.used}/${params.limit}).`,
    nextAction: "Keep the task ready and retry planning after another route slot is released.",
  };
}

function buildDeferredPlanResult(
  params: {
    stores: RuntimeStoreBundle;
    task: TaskRecord;
    decision: DecisionRecord | null;
    runState: RuntimeTaskRunState;
    optimizationState: RuntimeTaskOptimizationState;
    reason: RuntimeTaskDeferredReason;
    constrainedWorker?: string;
    constrainedRoute?: string;
    used: number;
    limit: number;
    now: number;
  },
  opts: RuntimeStoreOptions,
): RuntimeTaskDeferredResult {
  const { planSummary, nextAction } = buildDeferredConcurrencyText(params.reason, params.task, {
    constrainedWorker: params.constrainedWorker,
    constrainedRoute: params.constrainedRoute,
    used: params.used,
    limit: params.limit,
  });
  const nextTask: TaskRecord = {
    ...params.task,
    status: "ready",
    nextRunAt: params.now + TASK_SCHEDULER_DEFER_MS,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    planSummary,
    nextAction,
    updatedAt: params.now,
    metadata: writeTaskRuntimeMetadata(params.task, {
      optimizationState: {
        ...params.optimizationState,
        decision: params.decision ?? params.optimizationState.decision,
      },
      runState: {
        ...params.runState,
        lastDecisionAt: params.decision?.builtAt ?? params.runState.lastDecisionAt,
        lastThinkingLane: params.decision?.thinkingLane ?? params.runState.lastThinkingLane,
        lastDecisionSummary: params.decision?.summary ?? params.runState.lastDecisionSummary,
        lastRecommendedWorker:
          params.constrainedWorker ?? params.decision?.recommendedWorker ?? params.task.worker,
        lastRecommendedSkills:
          params.decision?.recommendedSkills ?? params.runState.lastRecommendedSkills,
        lastRelevantMemoryIds:
          params.decision?.relevantMemoryIds ?? params.runState.lastRelevantMemoryIds,
        lastRelevantSessionIds:
          params.decision?.relevantSessionIds ?? params.runState.lastRelevantSessionIds,
        lastFallbackOrder: params.decision?.fallbackOrder ?? params.runState.lastFallbackOrder,
      },
    }),
  };
  const savedTask = writeTaskRecord(params.stores, nextTask, {
    ...opts,
    now: params.now,
  });
  appendRuntimeEvent(
    "runtime_task_deferred",
    {
      taskId: savedTask.id,
      reason: params.reason,
      constrainedWorker: params.constrainedWorker,
      constrainedRoute: params.constrainedRoute,
      used: params.used,
      limit: params.limit,
    },
    {
      ...opts,
      now: params.now,
    },
  );
  return {
    kind: "deferred",
    task: savedTask,
    decision: params.decision,
    reason: params.reason,
    activeTaskIds: buildActiveTaskConcurrencySnapshot(params.stores.taskStore.tasks, params.now)
      .activeTaskIds,
    constrainedWorker: params.constrainedWorker,
    constrainedRoute: params.constrainedRoute,
  };
}

function bumpBudgetMode(mode: BudgetMode): BudgetMode {
  if (mode === "strict") {
    return "balanced";
  }
  if (mode === "balanced") {
    return "deep";
  }
  return "deep";
}

function bumpRetrievalMode(mode: RetrievalMode): RetrievalMode {
  if (mode === "off") {
    return "light";
  }
  if (mode === "light") {
    return "deep";
  }
  return "deep";
}

function normalizeBudgetMode(value: unknown): BudgetMode | undefined {
  return value === "strict" || value === "balanced" || value === "deep" ? value : undefined;
}

function normalizeRetrievalMode(value: unknown): RetrievalMode | undefined {
  return value === "off" || value === "light" || value === "deep" ? value : undefined;
}

type RuntimeRetryStrategyHint = {
  strategyId: string;
  budgetMode?: BudgetMode;
  retrievalMode?: RetrievalMode;
  retryDelayMinutes?: number;
  blockedThreshold?: number;
};

function resolveRuntimeRetryStrategyHint(
  task: TaskRecord,
  strategies: StrategyRecord[],
): RuntimeRetryStrategyHint | null {
  const route = normalizeText(task.route).toLowerCase();
  if (!route) {
    return null;
  }

  const candidates = strategies
    .filter((strategy) => {
      if (strategy.invalidatedBy.length) {
        return false;
      }
      if (normalizeText(strategy.route).toLowerCase() !== route) {
        return false;
      }
      const metadata = toRecord(strategy.metadata);
      return normalizeText(metadata?.evolutionCandidateType) === "retry_policy_review";
    })
    .toSorted((left, right) => {
      const leftWorkerExact =
        normalizeText(left.worker).toLowerCase() === normalizeText(task.worker).toLowerCase()
          ? 1
          : 0;
      const rightWorkerExact =
        normalizeText(right.worker).toLowerCase() === normalizeText(task.worker).toLowerCase()
          ? 1
          : 0;
      if (leftWorkerExact !== rightWorkerExact) {
        return rightWorkerExact - leftWorkerExact;
      }
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }
      return right.updatedAt - left.updatedAt;
    });
  const strategy = candidates[0];
  if (!strategy) {
    return null;
  }

  const metadata = toRecord(strategy.metadata);
  const retryDelayMinutes =
    typeof metadata?.retryDelayMinutes === "number" && Number.isFinite(metadata.retryDelayMinutes)
      ? Math.max(1, Math.round(metadata.retryDelayMinutes))
      : undefined;
  const blockedThreshold =
    typeof metadata?.blockedThreshold === "number" && Number.isFinite(metadata.blockedThreshold)
      ? Math.max(1, Math.round(metadata.blockedThreshold))
      : undefined;

  return {
    strategyId: strategy.id,
    budgetMode: normalizeBudgetMode(metadata?.budgetMode),
    retrievalMode: normalizeRetrievalMode(metadata?.retrievalMode),
    retryDelayMinutes,
    blockedThreshold,
  };
}

function buildRetryPatch(
  task: TaskRecord,
  strategies: StrategyRecord[],
  failureSummary: string,
  now: number,
) {
  const runState = readTaskRunState(task);
  const consecutiveFailures = (runState.consecutiveFailures ?? 0) + 1;
  const totalFailures = (runState.totalFailures ?? 0) + 1;
  const strategyHint = resolveRuntimeRetryStrategyHint(task, strategies);
  const retryIndex = Math.min(consecutiveFailures - 1, TASK_RETRY_BACKOFF_MINUTES.length - 1);
  const retryDelayMinutes =
    strategyHint?.retryDelayMinutes ?? TASK_RETRY_BACKOFF_MINUTES[retryIndex];
  const nextRunAt = now + retryDelayMinutes * 60 * 1000;
  const budgetMode =
    consecutiveFailures >= 2
      ? (strategyHint?.budgetMode ?? bumpBudgetMode(task.budgetMode))
      : task.budgetMode;
  const retrievalMode =
    consecutiveFailures >= 2
      ? (strategyHint?.retrievalMode ?? bumpRetrievalMode(task.retrievalMode))
      : task.retrievalMode;
  const worker =
    consecutiveFailures >= 3 && task.worker && task.worker !== "main" ? "main" : task.worker;
  const blockedThreshold = strategyHint?.blockedThreshold ?? TASK_MAX_CONSECUTIVE_FAILURES;
  const status: TaskStatus = consecutiveFailures >= blockedThreshold ? "blocked" : "queued";
  const replanCount = (runState.replanCount ?? 0) + (consecutiveFailures >= 2 ? 1 : 0);
  return {
    status,
    worker,
    budgetMode,
    retrievalMode,
    nextRunAt: status === "blocked" ? now + TASK_BLOCK_NOTIFY_AFTER_MS : nextRunAt,
    lastError: failureSummary,
    blockedReason: status === "blocked" ? failureSummary : "",
    planSummary:
      status === "blocked"
        ? `Repeated failure ${consecutiveFailures} times; pausing automatic retries${strategyHint ? ` under strategy ${strategyHint.strategyId}` : ""}.`
        : `Automatic replan #${replanCount} after failure; upgrade budget/retrieval before the next run${strategyHint ? ` via ${strategyHint.strategyId}` : ""}.`,
    nextAction:
      status === "blocked"
        ? "Wait for external intervention or a later strategy refresh."
        : `Retry in ${retryDelayMinutes} minutes and prefer a different skill bundle or path.`,
    runState: {
      consecutiveFailures,
      totalFailures,
      replanCount,
      lastFailureAt: now,
      lastFailureSummary: failureSummary,
      lastRetryStrategyId: strategyHint?.strategyId,
      lastRetryDelayMinutes: retryDelayMinutes,
      lastRetryBlockedThreshold: blockedThreshold,
    } satisfies Partial<RuntimeTaskRunState>,
  };
}

function resolveTaskScheduleIntervalMinutes(task: TaskRecord): number | undefined {
  return typeof task.scheduleIntervalMinutes === "number" && task.scheduleIntervalMinutes > 0
    ? Math.round(task.scheduleIntervalMinutes)
    : undefined;
}

function buildRecurringTaskNextAction(task: TaskRecord, intervalMinutes: number): string {
  const cadence =
    intervalMinutes >= 60 && intervalMinutes % 60 === 0
      ? `${Math.round(intervalMinutes / 60)} hour`
      : `${intervalMinutes} minute`;
  const suffix =
    intervalMinutes >= 60 && intervalMinutes % 60 === 0 && intervalMinutes / 60 !== 1 ? "s" : "";
  const scheduleLabel = `${cadence}${suffix}`;
  if (task.maintenance) {
    return `Maintenance task completed; wait for the next ${scheduleLabel} service window.`;
  }
  return `Recurring task completed; wait for the next ${scheduleLabel} run window.`;
}

function rescheduleRecurringTask(
  task: TaskRecord,
  reviewId: string | undefined,
  opts: RuntimeStoreOptions = {},
): TaskRecord {
  const now = resolveNow(opts.now);
  const intervalMinutes = resolveTaskScheduleIntervalMinutes(task);
  if ((!task.recurring && !task.maintenance) || !intervalMinutes) {
    return task;
  }
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const currentTask = findTask(stores.taskStore, task.id);
  const scheduleState = readTaskScheduleState(currentTask);
  const nextTask: TaskRecord = {
    ...currentTask,
    status: "queued",
    nextRunAt: now + intervalMinutes * 60 * 1000,
    blockedReason: undefined,
    lastError: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    activeRunId: undefined,
    updatedAt: now,
    nextAction: buildRecurringTaskNextAction(currentTask, intervalMinutes),
    metadata: writeTaskRuntimeMetadata(currentTask, {
      runState: {
        blockedAt: null,
      },
      scheduleState: {
        lastCompletedAt: now,
        lastScheduledAt: now,
        lastScheduleIntervalMinutes: intervalMinutes,
        rescheduleCount: (scheduleState.rescheduleCount ?? 0) + 1,
      },
    }),
  };
  const savedTask = writeTaskRecord(stores, nextTask, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_task_rescheduled",
    {
      taskId: savedTask.id,
      reviewId,
      recurring: savedTask.recurring,
      maintenance: savedTask.maintenance,
      scheduleIntervalMinutes: intervalMinutes,
      nextRunAt: savedTask.nextRunAt,
    },
    {
      ...opts,
      now,
    },
  );
  return savedTask;
}

function findTask(taskStore: RuntimeTaskStore, taskId: string): TaskRecord {
  const task = taskStore.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Unknown runtime task: ${taskId}`);
  }
  return task;
}

function findActiveRun(taskStore: RuntimeTaskStore, task: TaskRecord): TaskRun | undefined {
  if (task.activeRunId) {
    return taskStore.runs.find((entry) => entry.id === task.activeRunId);
  }
  return [...taskStore.runs]
    .filter((entry) => entry.taskId === task.id)
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
}

function finalizeTerminalTaskArtifacts(
  params: {
    taskId: string;
    reviewId?: string;
    memoryIds: string[];
    strategyIds: string[];
    metaLearningIds: string[];
  },
  opts: RuntimeStoreOptions,
): { task?: TaskRecord; review?: TaskReview } {
  if (
    params.memoryIds.length === 0 &&
    params.strategyIds.length === 0 &&
    params.metaLearningIds.length === 0
  ) {
    return {};
  }
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const task = stores.taskStore.tasks.find((entry) => entry.id === params.taskId);
  if (task) {
    task.memoryRefs = uniqueStrings([...(task.memoryRefs ?? []), ...params.memoryIds]);
    task.updatedAt = now;
    task.metadata = mergeMetadataRecords(toRecord(task.metadata), {
      runtimeTask: {
        distillState: {
          lastDistilledAt: now,
          memoryIds: params.memoryIds,
          strategyIds: params.strategyIds,
          metaLearningIds: params.metaLearningIds,
        },
      },
    });
  }
  const review = params.reviewId
    ? stores.taskStore.reviews.find((entry) => entry.id === params.reviewId)
    : undefined;
  if (review) {
    review.extractedMemoryIds = uniqueStrings([
      ...(review.extractedMemoryIds ?? []),
      ...params.memoryIds,
    ]);
    review.strategyCandidateIds = uniqueStrings([
      ...(review.strategyCandidateIds ?? []),
      ...params.strategyIds,
    ]);
    review.metadata = mergeMetadataRecords(toRecord(review.metadata), {
      distill: {
        finalizedAt: now,
        extractedMemoryIds: params.memoryIds,
        strategyCandidateIds: params.strategyIds,
        metaLearningIds: params.metaLearningIds,
      },
    });
  }
  const saved = saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  return {
    task: saved.taskStore.tasks.find((entry) => entry.id === params.taskId),
    review: params.reviewId
      ? saved.taskStore.reviews.find((entry) => entry.id === params.reviewId)
      : undefined,
  };
}

function buildTerminalReviewSummary(input: RuntimeTaskResultInput, task: TaskRecord): string {
  return (
    normalizeText(input.summary) ||
    normalizeText(input.lastResult) ||
    normalizeText(input.blockedReason) ||
    normalizeText(input.needsUser) ||
    normalizeText(task.lastError) ||
    `${task.title} -> ${normalizeTaskStatus(input.status, task.status)}`
  );
}

export function upsertRuntimeTask(
  input: TaskRecordSnapshotInput,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskUpsertResult {
  const now = resolveNow(input.updatedAt ?? input.createdAt ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const requestedId = normalizeText(input.id);
  const existing = requestedId
    ? stores.taskStore.tasks.find((entry) => entry.id === requestedId)
    : undefined;
  const requestedParentTaskId =
    input.parentTaskId === null ? undefined : normalizeText(input.parentTaskId);
  const parentTaskId =
    requestedParentTaskId || (input.parentTaskId === null ? undefined : existing?.parentTaskId);
  const parentTask = parentTaskId
    ? stores.taskStore.tasks.find((entry) => entry.id === parentTaskId)
    : undefined;
  if (parentTaskId && !parentTask) {
    throw new Error(`Parent task ${parentTaskId} was not found.`);
  }
  const requestedRootTaskId =
    input.rootTaskId === null ? undefined : normalizeText(input.rootTaskId);
  const currentTaskId = requestedId || existing?.id;
  if (parentTask) {
    const parentRootTaskId = parentTask.rootTaskId || parentTask.id;
    if (requestedRootTaskId && requestedRootTaskId !== parentRootTaskId) {
      throw new Error(
        `Derived task ${currentTaskId || "[new task]"} must inherit root task ${parentRootTaskId} from parent ${parentTask.id}.`,
      );
    }
  }
  if (!parentTask && requestedRootTaskId && requestedRootTaskId !== currentTaskId) {
    throw new Error(
      `Derived task lineage requires parentTaskId. Task ${currentTaskId || "[new task]"} cannot point at foreign root ${requestedRootTaskId} without a parent.`,
    );
  }
  const ecologyBinding = resolveTaskEcologyBinding(input, existing, stores);
  const rootTaskId =
    requestedRootTaskId ||
    (parentTask
      ? parentTask.rootTaskId || parentTask.id
      : input.parentTaskId === null
        ? currentTaskId
        : existing?.rootTaskId);
  const nextTask = buildTaskRecordSnapshot(
    {
      id: requestedId || existing?.id,
      rootTaskId,
      parentTaskId,
      title: input.title ?? existing?.title ?? "Untitled task",
      route: input.route ?? existing?.route ?? "general",
      status: input.status ?? existing?.status ?? "queued",
      priority: input.priority ?? existing?.priority ?? "normal",
      budgetMode:
        input.budgetMode ?? existing?.budgetMode ?? stores.taskStore.defaults.defaultBudgetMode,
      retrievalMode:
        input.retrievalMode ??
        existing?.retrievalMode ??
        stores.taskStore.defaults.defaultRetrievalMode,
      goal: input.goal ?? existing?.goal,
      successCriteria: input.successCriteria ?? existing?.successCriteria,
      tags: input.tags ?? existing?.tags ?? [],
      worker: input.worker ?? existing?.worker,
      skillIds: input.skillIds ?? existing?.skillIds ?? [],
      memoryRefs: input.memoryRefs ?? existing?.memoryRefs ?? [],
      artifactRefs: input.artifactRefs ?? input.intelRefs ?? existing?.artifactRefs ?? [],
      recurring: input.recurring ?? existing?.recurring ?? false,
      maintenance: input.maintenance ?? existing?.maintenance ?? false,
      scheduleIntervalMinutes:
        input.scheduleIntervalMinutes === null
          ? undefined
          : (input.scheduleIntervalMinutes ?? existing?.scheduleIntervalMinutes),
      planSummary: input.planSummary ?? existing?.planSummary,
      nextAction: input.nextAction ?? existing?.nextAction,
      blockedReason: input.blockedReason ?? existing?.blockedReason,
      lastError: input.lastError ?? existing?.lastError,
      reportPolicy: input.reportPolicy ?? existing?.reportPolicy,
      nextRunAt: input.nextRunAt === null ? undefined : (input.nextRunAt ?? existing?.nextRunAt),
      leaseOwner: input.leaseOwner ?? existing?.leaseOwner,
      leaseExpiresAt:
        input.leaseExpiresAt === null
          ? undefined
          : (input.leaseExpiresAt ?? existing?.leaseExpiresAt),
      activeRunId:
        input.activeRunId === null ? undefined : (input.activeRunId ?? existing?.activeRunId),
      latestReviewId:
        input.latestReviewId === null
          ? undefined
          : (input.latestReviewId ?? existing?.latestReviewId),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
      metadata: buildTaskEcologyMetadata(existing?.metadata, input.metadata, ecologyBinding),
    },
    now,
  );
  const index = stores.taskStore.tasks.findIndex((entry) => entry.id === nextTask.id);
  const created = index === -1;
  if (created) {
    stores.taskStore.tasks.unshift(nextTask);
  } else {
    stores.taskStore.tasks[index] = nextTask;
  }
  const saved = saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  syncRuntimeFederationAssignmentTaskLifecycle({
    ...opts,
    now,
  });
  syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_task_upserted",
    {
      taskId: nextTask.id,
      created,
      status: nextTask.status,
      route: nextTask.route,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    created,
    task: saved.taskStore.tasks.find((entry) => entry.id === nextTask.id) ?? nextTask,
  };
}

export function configureRuntimeTaskLoop(
  input: RuntimeTaskLoopConfigureInput,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskStore["defaults"] {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const currentDefaults = stores.taskStore.defaults;
  const nextDefaults: RuntimeTaskStore["defaults"] = {
    defaultBudgetMode:
      input.defaultBudgetMode === "strict" ||
      input.defaultBudgetMode === "balanced" ||
      input.defaultBudgetMode === "deep"
        ? input.defaultBudgetMode
        : currentDefaults.defaultBudgetMode,
    defaultRetrievalMode:
      input.defaultRetrievalMode === "off" ||
      input.defaultRetrievalMode === "light" ||
      input.defaultRetrievalMode === "deep"
        ? input.defaultRetrievalMode
        : currentDefaults.defaultRetrievalMode,
    maxInputTokensPerTurn: normalizePositiveInteger(
      input.maxInputTokensPerTurn,
      currentDefaults.maxInputTokensPerTurn,
    ),
    maxContextChars: normalizePositiveInteger(
      input.maxContextChars,
      currentDefaults.maxContextChars,
    ),
    compactionWatermark: normalizePositiveInteger(
      input.compactionWatermark,
      currentDefaults.compactionWatermark,
    ),
    maxRemoteCallsPerTask: normalizePositiveInteger(
      input.maxRemoteCallsPerTask,
      currentDefaults.maxRemoteCallsPerTask,
    ),
    leaseDurationMs: normalizePositiveInteger(
      input.leaseDurationMs,
      currentDefaults.leaseDurationMs,
    ),
    maxConcurrentRunsPerWorker: normalizePositiveInteger(
      input.maxConcurrentRunsPerWorker,
      currentDefaults.maxConcurrentRunsPerWorker,
    ),
    maxConcurrentRunsPerRoute: normalizePositiveInteger(
      input.maxConcurrentRunsPerRoute,
      currentDefaults.maxConcurrentRunsPerRoute,
    ),
  };
  stores.taskStore.defaults = nextDefaults;
  const saved = saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_task_loop_configured",
    {
      defaults: nextDefaults,
    },
    {
      ...opts,
      now,
    },
  );
  return saved.taskStore.defaults;
}

function maybeCompactTaskRun(
  params: {
    task: TaskRecord;
    run: TaskRun;
    now: number;
  },
  opts: RuntimeStoreOptions = {},
): TaskRun | null {
  const { task, run, now } = params;
  if (!run || !run.id) {
    return null;
  }

  const taskStore = loadRuntimeTaskStore({
    ...opts,
    now,
  });
  const persistedRun = taskStore.runs.find((entry) => entry.id === run.id);
  if (!persistedRun) {
    return null;
  }

  const steps = taskStore.steps.filter((step) => step.runId === run.id);
  let totalLength = 0;
  for (const step of steps) {
    totalLength += readTaskStepOutput(step).length;
  }

  const watermark = readTaskCompactionWatermark(taskStore);
  if (totalLength <= watermark) {
    return null;
  }

  const eliminatedPaths = steps
    .filter(
      (step) => step.status === "failed" || step.status === "cancelled" || Boolean(step.error),
    )
    .map((step) =>
      truncateText(
        uniqueStrings([
          `failed approach: ${step.kind}`,
          step.worker ? `worker ${step.worker}` : undefined,
          step.error,
          readTaskStepOutput(step),
        ]).join(" · "),
        180,
      ),
    );
  const previousCheckpoint = persistedRun.checkpoint;

  const checkpoint: GoalStateCheckpoint = {
    currentGoal:
      normalizeText(previousCheckpoint?.currentGoal) || normalizeText(task.goal) || task.title,
    eliminatedPaths: uniqueStrings([
      ...(previousCheckpoint?.eliminatedPaths ?? []),
      ...eliminatedPaths,
    ]).slice(0, 10),
    nextPlan: task.nextAction || task.planSummary || previousCheckpoint?.nextPlan || "continue",
    compactedAt: now,
    archivedStepIds: uniqueStrings([
      ...(previousCheckpoint?.archivedStepIds ?? []),
      ...steps.map((step) => step.id),
    ]),
  };

  const nextRun: TaskRun = {
    ...persistedRun,
    checkpoint,
    updatedAt: now,
  };
  taskStore.runs = taskStore.runs.map((entry) => (entry.id === run.id ? nextRun : entry));
  taskStore.steps = taskStore.steps.filter((step) => step.runId !== run.id);
  taskStore.archivedSteps = [
    ...steps.map((step) => buildArchivedTaskStep(step, now)),
    ...taskStore.archivedSteps,
  ];

  saveRuntimeTaskStore(taskStore, {
    ...opts,
    now,
  });

  appendRuntimeEvent(
    "runtime_task_history_compacted",
    {
      taskId: task.id,
      runId: run.id,
      compactedLength: totalLength,
      watermark,
      archivedStepCount: steps.length,
    },
    {
      ...opts,
      now,
    },
  );
  return nextRun;
}
export function planRuntimeTask(
  taskId: string,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskPlanResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const task = findTask(stores.taskStore, taskId);
  if (isTerminalTaskStatus(task.status)) {
    throw new Error(`Task ${taskId} is terminal and cannot be planned again.`);
  }
  const runState = readTaskRunState(task);
  const optimizationState = readTaskOptimizationState(task);
  if (hasActiveTaskLease(task, now)) {
    return buildDeferredPlanResult(
      {
        stores,
        task,
        decision: optimizationState.decision ?? null,
        runState,
        optimizationState,
        reason: "lease_active",
        used: 1,
        limit: 1,
        now,
      },
      opts,
    );
  }

  const decision = buildDecisionRecord({
    task: buildDecisionTaskInput(task),
    config: buildDecisionConfig(stores.taskStore),
    sources: buildRuntimeRetrievalSourceSet({
      ...opts,
      now,
    }),
    now,
  });
  const replanMarker =
    normalizeText(task.nextAction).includes("memory invalidated") ||
    normalizeText(task.planSummary).includes("memory invalidated") ||
    normalizeText(task.nextAction).includes("记忆已失效") ||
    normalizeText(task.planSummary).includes("记忆已失效") ||
    optimizationState.needsReplan === true;
  const mergedSkills = uniqueStrings([
    ...(task.skillIds ?? []),
    ...decision.recommendedSkills,
  ]).slice(0, 16);
  const capabilityPolicy = resolveRuntimeCapabilityPolicy(null, {
    ...opts,
    now,
    route: task.route,
  });
  const sortedSkills = capabilityPolicy.sortByExecutionPreference("skill", mergedSkills);
  const governedSkills = sortedSkills.filter((skillId) =>
    capabilityPolicy.isLiveEligible("skill", skillId),
  );
  const blockedSkills = mergedSkills.filter(
    (skillId) => capabilityPolicy.resolveExecutionStatus("skill", skillId).mode === "blocked",
  );
  const stagedSkills = mergedSkills.filter((skillId) => {
    const mode = capabilityPolicy.resolveExecutionStatus("skill", skillId).mode;
    return mode === "shadow_only" || mode === "candidate_only";
  });
  const workerFallbacks = capabilityPolicy.sortByExecutionPreference("agent", [
    decision.recommendedWorker,
    task.worker,
    ...decision.fallbackOrder
      .filter((entry) => entry.startsWith("worker:"))
      .map((entry) => entry.slice("worker:".length)),
    "main",
  ]);
  const governedWorker = workerFallbacks.find((workerId) =>
    capabilityPolicy.isLiveEligible("agent", workerId),
  );
  if (!governedWorker) {
    return buildDeferredPlanResult(
      {
        stores,
        task,
        decision,
        runState,
        optimizationState,
        reason: "capability_governance",
        constrainedWorker:
          workerFallbacks[0] ?? decision.recommendedWorker ?? task.worker ?? "main",
        used: 0,
        limit: 0,
        now,
      },
      opts,
    );
  }
  const effectiveBudgetMode =
    decision.thinkingLane === "system2" ? bumpBudgetMode(task.budgetMode) : task.budgetMode;
  const effectiveRetrievalMode =
    decision.thinkingLane === "system2"
      ? bumpRetrievalMode(task.retrievalMode)
      : task.retrievalMode;
  const schedulerPolicy = resolveTaskSchedulerPolicy(stores.taskStore.defaults);
  const activeConcurrency = buildActiveTaskConcurrencySnapshot(
    stores.taskStore.tasks.filter((entry) => entry.id !== task.id),
    now,
  );
  const workerUsage = activeConcurrency.workerCounts[governedWorker] ?? 0;
  if (workerUsage >= schedulerPolicy.maxConcurrentRunsPerWorker) {
    return buildDeferredPlanResult(
      {
        stores,
        task,
        decision,
        runState,
        optimizationState,
        reason: "worker_concurrency",
        constrainedWorker: governedWorker,
        used: workerUsage,
        limit: schedulerPolicy.maxConcurrentRunsPerWorker,
        now,
      },
      opts,
    );
  }
  const routeUsage = activeConcurrency.routeCounts[task.route] ?? 0;
  if (routeUsage >= schedulerPolicy.maxConcurrentRunsPerRoute) {
    return buildDeferredPlanResult(
      {
        stores,
        task,
        decision,
        runState,
        optimizationState,
        reason: "route_concurrency",
        constrainedWorker: governedWorker,
        constrainedRoute: task.route,
        used: routeUsage,
        limit: schedulerPolicy.maxConcurrentRunsPerRoute,
        now,
      },
      opts,
    );
  }
  const nextOptimizationState: RuntimeTaskOptimizationState = {
    ...optimizationState,
    needsReplan: false,
    lastReplannedAt: replanMarker ? now : optimizationState.lastReplannedAt,
    decision,
  };
  const decisionUserPreferenceView = toRecord(decision.metadata?.userPreferenceView);
  const nextTask: TaskRecord = {
    ...task,
    status: "running",
    worker: governedWorker,
    skillIds: governedSkills,
    budgetMode: effectiveBudgetMode,
    retrievalMode: effectiveRetrievalMode,
    memoryRefs: decision.relevantMemoryIds,
    artifactRefs: task.artifactRefs,
    nextRunAt: undefined,
    leaseOwner: TASK_SCHEDULER_LEASE_OWNER,
    leaseExpiresAt: now + schedulerPolicy.leaseDurationMs,
    lastError: undefined,
    blockedReason: undefined,
    planSummary:
      !task.planSummary || replanMarker
        ? buildPlanningSummary(task, optimizationState)
        : task.planSummary,
    nextAction:
      !task.nextAction || replanMarker
        ? buildNextActionSummary(task, optimizationState)
        : task.nextAction,
    updatedAt: now,
    metadata: writeTaskRuntimeMetadata(task, {
      optimizationState: nextOptimizationState,
      runState: {
        ...runState,
        lastReportPolicy:
          normalizeReportPolicy(decisionUserPreferenceView?.reportPolicy ?? undefined) ??
          runState.lastReportPolicy,
        lastReportVerbosity:
          decisionUserPreferenceView?.reportVerbosity === "brief" ||
          decisionUserPreferenceView?.reportVerbosity === "balanced" ||
          decisionUserPreferenceView?.reportVerbosity === "detailed"
            ? (decisionUserPreferenceView?.reportVerbosity as RuntimeTaskRunState["lastReportVerbosity"])
            : runState.lastReportVerbosity,
        lastInterruptionThreshold:
          decisionUserPreferenceView?.interruptionThreshold === "low" ||
          decisionUserPreferenceView?.interruptionThreshold === "medium" ||
          decisionUserPreferenceView?.interruptionThreshold === "high"
            ? (decisionUserPreferenceView?.interruptionThreshold as RuntimeTaskRunState["lastInterruptionThreshold"])
            : runState.lastInterruptionThreshold,
        lastConfirmationBoundary:
          decisionUserPreferenceView?.confirmationBoundary === "strict" ||
          decisionUserPreferenceView?.confirmationBoundary === "balanced" ||
          decisionUserPreferenceView?.confirmationBoundary === "light"
            ? (decisionUserPreferenceView?.confirmationBoundary as RuntimeTaskRunState["lastConfirmationBoundary"])
            : runState.lastConfirmationBoundary,
        replanCount: (runState.replanCount ?? 0) + (replanMarker ? 1 : 0),
        lastDecisionAt: decision.builtAt,
        lastThinkingLane: decision.thinkingLane,
        lastDecisionSummary: decision.summary,
        lastRecommendedWorker: governedWorker,
        lastRecommendedSkills: governedSkills,
        lastRelevantMemoryIds: decision.relevantMemoryIds,
        lastRelevantSessionIds: decision.relevantSessionIds,
        lastRetrievalQueryId:
          normalizeText(decision.metadata?.retrievalQueryId) || decision.contextPack.queryId,
        lastContextSummary: normalizeText(decision.contextPack.summary) || undefined,
        lastContextSynthesis: uniqueStrings(decision.contextPack.synthesis),
        lastStrategyCandidateIds: collectContextCandidateIds(
          decision.contextPack.strategyCandidates,
        ),
        lastArchiveCandidateIds: collectContextCandidateIds(decision.contextPack.archiveCandidates),
        lastFallbackOrder: decision.fallbackOrder,
        remoteCallCount: (runState.remoteCallCount ?? 0) + 1,
      },
    }),
  };

  const persisted = persistTaskLifecycleArtifacts(
    {
      task: nextTask,
      run: {
        id: findActiveRun(stores.taskStore, task)?.id,
        status: "running",
        thinkingLane: decision.thinkingLane,
        startedAt: now,
        updatedAt: now,
        concurrencyKey: `${task.route}:${governedWorker}`,
        leaseOwner: TASK_SCHEDULER_LEASE_OWNER,
        leaseExpiresAt: now + schedulerPolicy.leaseDurationMs,
        metadata: {
          decisionSummary: decision.summary,
          recommendedWorker: governedWorker,
          recommendedSkills: governedSkills,
          blockedSkills,
          governanceHeldBackSkills: stagedSkills,
          remoteCallCount: (runState.remoteCallCount ?? 0) + 1,
        },
      },
      step: {
        kind: "executor",
        status: "running",
        idempotencyKey: `runtime-plan:${task.id}:${now}`,
        worker: governedWorker,
        route: task.route,
        metadata: {
          thinkingLane: decision.thinkingLane,
          relevantMemoryIds: decision.relevantMemoryIds,
          blockedSkills,
          governanceHeldBackSkills: stagedSkills,
        },
      },
      now,
    },
    {
      ...opts,
      now,
    },
  );

  const finalRun =
    maybeCompactTaskRun(
      {
        task: persisted.task,
        run: persisted.run,
        now,
      },
      opts,
    ) ?? persisted.run;

  appendRuntimeEvent(
    "runtime_task_planned",
    {
      taskId: persisted.task.id,
      runId: persisted.run.id,
      thinkingLane: decision.thinkingLane,
      recommendedWorker: governedWorker,
      recommendedSkills: governedSkills,
      blockedSkills,
      governanceHeldBackSkills: stagedSkills,
      memoryRefs: decision.relevantMemoryIds,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    kind: "planned",
    task: persisted.task,
    run: finalRun,
    decision,
  };
}

export function applyRuntimeTaskResult(
  input: RuntimeTaskResultInput,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskApplyResult {
  const now = resolveNow(input.now ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const task = findTask(stores.taskStore, input.taskId);
  const activeRun = findActiveRun(stores.taskStore, task);
  const runState = readTaskRunState(task);
  const optimizationState = readTaskOptimizationState(task);
  const decision = optimizationState.decision;
  const requestedStatus = normalizeTaskStatus(input.status, task.status);
  const baseSummary =
    normalizeText(input.summary) ||
    normalizeText(input.lastResult) ||
    normalizeText(input.blockedReason) ||
    normalizeText(input.needsUser) ||
    normalizeText(input.lastError);

  let nextTask: TaskRecord = {
    ...task,
    status: requestedStatus,
    updatedAt: now,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };

  const nextRunState: Partial<RuntimeTaskRunState> = {
    lastResultStatus: requestedStatus,
    lastResultSummary: baseSummary || undefined,
    lastWorkerOutput: normalizeText(input.workerOutput) || undefined,
    lastCliExitCode: typeof input.cliExitCode === "number" ? input.cliExitCode : undefined,
  };

  if (requestedStatus === "completed") {
    nextTask = {
      ...nextTask,
      status: "completed",
      lastError: undefined,
      blockedReason: undefined,
      nextRunAt: undefined,
      planSummary: normalizeText(input.planSummary) || task.planSummary,
      nextAction: normalizeText(input.nextAction) || undefined,
      metadata: writeTaskRuntimeMetadata(task, {
        runState: {
          ...nextRunState,
          consecutiveFailures: 0,
          blockedAt: null,
        },
      }),
    };
  } else if (requestedStatus === "waiting_user") {
    const waitingReason = normalizeText(input.needsUser || input.blockedReason || input.summary);
    nextTask = {
      ...nextTask,
      status: "waiting_user",
      lastError: waitingReason || task.lastError,
      blockedReason: waitingReason || task.blockedReason,
      nextRunAt: undefined,
      nextAction: normalizeText(input.nextAction) || task.nextAction,
      metadata: writeTaskRuntimeMetadata(task, {
        runState: {
          ...nextRunState,
          blockedAt: now,
        },
      }),
    };
  } else if (requestedStatus === "blocked") {
    const retryPatch = buildRetryPatch(
      task,
      stores.memoryStore.strategies,
      normalizeText(input.blockedReason || input.needsUser || input.summary || input.lastError) ||
        "Runtime worker returned blocked.",
      now,
    );
    nextTask = {
      ...nextTask,
      ...retryPatch,
      metadata: writeTaskRuntimeMetadata(task, {
        runState: {
          ...nextRunState,
          ...retryPatch.runState,
          blockedAt: retryPatch.status === "blocked" ? now : null,
        },
      }),
    };
  } else if (requestedStatus === "waiting_external") {
    nextTask = {
      ...nextTask,
      status: "waiting_external",
      nextRunAt: now + Math.max(1, input.nextRunInMinutes ?? 10) * 60 * 1000,
      lastError: normalizeText(input.lastError) || undefined,
      blockedReason: normalizeText(input.blockedReason) || undefined,
      planSummary: normalizeText(input.planSummary) || task.planSummary,
      nextAction: normalizeText(input.nextAction) || task.nextAction,
      metadata: writeTaskRuntimeMetadata(task, {
        runState: {
          ...nextRunState,
          blockedAt: null,
        },
      }),
    };
  } else {
    nextTask = {
      ...nextTask,
      status: requestedStatus,
      nextRunAt: now + Math.max(1, input.nextRunInMinutes ?? 5) * 60 * 1000,
      lastError: normalizeText(input.lastError) || undefined,
      blockedReason: normalizeText(input.blockedReason) || undefined,
      planSummary: normalizeText(input.planSummary) || task.planSummary,
      nextAction: normalizeText(input.nextAction) || task.nextAction,
      metadata: writeTaskRuntimeMetadata(task, {
        runState: {
          ...nextRunState,
          blockedAt: null,
        },
      }),
    };
  }

  const terminalForReview =
    nextTask.status === "completed" ||
    nextTask.status === "waiting_user" ||
    nextTask.status === "blocked" ||
    nextTask.status === "cancelled";

  const persisted = persistTaskLifecycleArtifacts(
    {
      task: nextTask,
      run: {
        id: activeRun?.id,
        status: nextTask.status,
        thinkingLane: activeRun?.thinkingLane || runState.lastThinkingLane || "system1",
        startedAt: activeRun?.startedAt || task.updatedAt,
        updatedAt: now,
        metadata: {
          ...toRecord(activeRun?.metadata),
          ...(nextRunState as RuntimeMetadata),
        },
      },
      step: {
        kind:
          nextTask.status === "completed"
            ? "review"
            : nextTask.status === "waiting_external" || nextTask.status === "queued"
              ? "recovery"
              : nextTask.status === "waiting_user"
                ? "notify"
                : "executor",
        status:
          nextTask.status === "completed"
            ? "completed"
            : nextTask.status === "blocked"
              ? "failed"
              : nextTask.status === "cancelled"
                ? "cancelled"
                : nextTask.status === "waiting_user"
                  ? "queued"
                  : "running",
        idempotencyKey: `runtime-result:${task.id}:${now}`,
        worker: nextTask.worker,
        route: nextTask.route,
        error: nextTask.lastError,
        metadata: {
          requestedStatus,
          workerOutput: normalizeText(input.workerOutput) || undefined,
        },
      },
      review: terminalForReview
        ? {
            summary: buildTerminalReviewSummary(input, nextTask),
            outcome: undefined,
            extractedMemoryIds: [],
            strategyCandidateIds: [],
          }
        : undefined,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const finalRun =
    maybeCompactTaskRun(
      {
        task: persisted.task,
        run: persisted.run,
        now,
      },
      opts,
    ) ?? persisted.run;

  let distilledMemoryIds: string[] = [];
  let strategyIds: string[] = [];
  let metaLearningIds: string[] = [];
  let finalTask = persisted.task;
  let finalReview = persisted.review;
  let finalReport: TaskReportRecord | undefined;
  if (
    persisted.task.status === "completed" ||
    persisted.task.status === "blocked" ||
    persisted.task.status === "waiting_user"
  ) {
    const distilled = applyRuntimeTaskOutcomeMemoryUpdate(
      {
        task: persisted.task,
        review: persisted.review,
        decision,
        now,
      },
      {
        ...opts,
        now,
      },
    );
    distilledMemoryIds = distilled.memoryIds;
    strategyIds = distilled.strategyIds;
    metaLearningIds = distilled.metaLearningIds;

    const finalized = finalizeTerminalTaskArtifacts(
      {
        taskId: persisted.task.id,
        reviewId: persisted.review?.id,
        memoryIds: distilledMemoryIds,
        strategyIds,
        metaLearningIds,
      },
      {
        ...opts,
        now,
      },
    );
    if (finalized.task) {
      finalTask = finalized.task;
    }
    if (finalized.review) {
      finalReview = finalized.review;
    }

    const evolutionInputTask = finalized.task ?? persisted.task;
    if (persisted.task.status === "completed" && (decision?.relevantMemoryIds?.length ?? 0) > 0) {
      applyRuntimeMemoryLineageReinforcement(
        {
          memoryIds: decision?.relevantMemoryIds ?? [],
          sourceTaskId: persisted.task.id,
          reason: "task completed with referenced runtime memories",
          now,
        },
        {
          ...opts,
          now,
        },
      );
    }
    const evolutionControls = readEvolutionControls(stores.governanceStore.metadata);
    if (evolutionControls.enabled) {
      observeTaskOutcomeForEvolution(
        {
          task: evolutionInputTask,
          review: persisted.review,
          run: finalRun,
          thinkingLane:
            activeRun?.thinkingLane ||
            decision?.thinkingLane ||
            runState.lastThinkingLane ||
            "system1",
          now,
        },
        {
          ...opts,
          now,
        },
      );
      if (evolutionControls.autoApplyLowRisk) {
        maybeAutoApplyLowRiskEvolution({
          ...opts,
          now,
        });
        materializeAdoptedEvolutionStrategies({
          ...opts,
          now,
        });
      }
    }
  }

  finalReport = persistRuntimeTaskReport(
    {
      task: finalTask,
      reportedStatus: persisted.task.status,
      run: finalRun,
      review: finalReview,
      baseSummary,
      preferences: resolveEffectiveTaskReportPreferences(finalTask, opts, now),
      existingNotifyStep: persisted.step,
      now,
    },
    {
      ...opts,
      now,
    },
  );

  if (finalTask.status === "completed" && (finalTask.recurring || finalTask.maintenance)) {
    finalTask = rescheduleRecurringTask(finalTask, finalReview?.id, {
      ...opts,
      now,
    });
  }

  syncRuntimeFederationAssignmentTaskLifecycle({
    ...opts,
    now,
  });
  syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
    ...opts,
    now,
  });

  appendRuntimeEvent(
    "runtime_task_result_applied",
    {
      taskId: persisted.task.id,
      runId: persisted.run.id,
      status: persisted.task.status,
      reviewId: finalReview?.id,
      reportId: finalReport?.id,
      memoryIds: distilledMemoryIds,
      strategyIds,
      metaLearningIds,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    task: finalTask,
    run: finalRun,
    review: finalReview,
    report: finalReport,
    distilledMemoryIds,
    strategyIds,
    metaLearningIds,
  };
}

export function respondRuntimeWaitingUserTask(
  input: RuntimeTaskWaitingUserResponseInput,
  opts: RuntimeStoreOptions = {},
): RuntimeTaskWaitingUserResponseResult {
  const now = resolveNow(input.now ?? opts.now);
  const response = normalizeText(input.response);
  if (!response) {
    throw new Error("response is required");
  }
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const task = findTask(stores.taskStore, input.taskId);
  if (normalizeTaskStatus(task.status) !== "waiting_user") {
    throw new Error(`Task ${task.id} is not waiting for user input.`);
  }
  const activeRun = findActiveRun(stores.taskStore, task);
  const runState = readTaskRunState(task);
  const optimizationState = readTaskOptimizationState(task);
  const respondedBy = normalizeText(input.respondedBy) || "runtime-user";
  const responseUpdate = applyRuntimeUserControlMemoryUpdate(
    {
      kind: "task_waiting_user_response",
      task,
      response,
      respondedBy,
      now,
    },
    {
      ...opts,
      now,
    },
  );

  const nextTask: TaskRecord = {
    ...task,
    status: "queued",
    memoryRefs: uniqueStrings([...(task.memoryRefs ?? []), ...responseUpdate.memoryIds]),
    blockedReason: undefined,
    lastError: undefined,
    nextRunAt: now,
    nextAction:
      normalizeText(input.nextAction) || "User answered the pending question; replan the task.",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now,
    metadata: writeTaskRuntimeMetadata(task, {
      runState: {
        ...runState,
        lastResultStatus: "queued",
        lastResultSummary: response,
        lastUserResponseAt: now,
        lastUserResponseSummary: response,
        lastUserResponseBy: respondedBy,
        lastUserResponseMemoryIds: responseUpdate.memoryIds,
        userResponseCount: (runState.userResponseCount ?? 0) + 1,
        blockedAt: null,
      },
      optimizationState: {
        ...optimizationState,
        needsReplan: true,
      },
    }),
  };

  const persisted = persistTaskLifecycleArtifacts(
    {
      task: nextTask,
      run: {
        id: activeRun?.id,
        status: "queued",
        thinkingLane: activeRun?.thinkingLane || runState.lastThinkingLane || "system1",
        startedAt: activeRun?.startedAt || task.updatedAt,
        updatedAt: now,
        metadata: {
          ...toRecord(activeRun?.metadata),
          userResponse: response,
          userResponseMemoryIds: responseUpdate.memoryIds,
        },
      },
      step: {
        kind: "notify",
        status: "completed",
        idempotencyKey: `runtime-waiting-user-response:${task.id}:${now}`,
        worker: task.worker,
        route: task.route,
        metadata: {
          response,
          respondedBy,
          responseMemoryIds: responseUpdate.memoryIds,
        },
      },
      now,
    },
    {
      ...opts,
      now,
    },
  );

  const refreshedStores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const resolvedReportIds = resolveTaskReportsForTask(refreshedStores.taskStore, {
    taskId: persisted.task.id,
    now,
    kind: "waiting_user",
    requireUserAction: true,
    reason: "resolved-by-user-response",
  });
  if (resolvedReportIds.length > 0) {
    saveRuntimeStoreBundle(refreshedStores, {
      ...opts,
      now,
    });
    appendRuntimeEvent(
      "runtime_task_reports_resolved",
      {
        taskId: persisted.task.id,
        runId: persisted.run.id,
        resolvedReportIds,
        reason: "resolved-by-user-response",
      },
      {
        ...opts,
        now,
      },
    );
  }

  appendRuntimeEvent(
    "runtime_task_waiting_user_resumed",
    {
      taskId: persisted.task.id,
      runId: persisted.run.id,
      respondedBy,
      responseMemoryIds: responseUpdate.memoryIds,
    },
    {
      ...opts,
      now,
    },
  );

  syncRuntimeFederationAssignmentTaskLifecycle({
    ...opts,
    now,
  });
  syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
    ...opts,
    now,
  });

  return {
    task: persisted.task,
    run: persisted.run,
    responseMemoryIds: responseUpdate.memoryIds,
    resolvedReportIds,
  };
}

export async function tickRuntimeTaskLoop(
  opts: RuntimeTaskLoopOptions = {},
): Promise<RuntimeTaskTickResult> {
  const now = resolveNow(opts.now);
  maybeRunScheduledUserConsoleMaintenance(opts, now);
  await maybeRunScheduledFederationRemoteSync(opts, now);
  maybeRunScheduledFederationInboxMaintenance(opts, now);
  maybeRunScheduledMemoryLifecycleReview(opts, now);
  maybeRefreshIntel(opts, now);
  maybeRunScheduledIntelDeliveries(opts, now);
  maybeRunScheduledEvolutionReview(opts, now);
  syncRuntimeFederationAssignmentTaskLifecycle({
    ...opts,
    now,
  });
  syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
    ...opts,
    now,
  });
  const taskStore = loadRuntimeStoreBundle({
    ...opts,
    now,
  }).taskStore;
  const dueTasks = [...taskStore.tasks]
    .filter((task) => shouldTaskRun(task, now))
    .toSorted(compareTaskQueueOrder);
  const activeTaskIds = buildActiveTaskConcurrencySnapshot(taskStore.tasks, now).activeTaskIds;
  if (!dueTasks.length) {
    return {
      kind: "idle",
      dueTaskIds: [],
    };
  }
  const deferredTaskIds: string[] = [];
  let deferredResult: RuntimeTaskDeferredResult | null = null;
  for (const nextTask of dueTasks) {
    const result = planRuntimeTask(nextTask.id, {
      ...opts,
      now,
    });
    if (result.kind === "planned") {
      return result;
    }
    deferredTaskIds.push(result.task.id);
    if (!deferredResult) {
      deferredResult = result;
    }
  }
  if (activeTaskIds.length > 0) {
    return {
      kind: "busy",
      activeTaskIds,
      dueTaskIds: dueTasks.map((task) => task.id),
      deferredTaskIds,
    };
  }
  if (deferredResult) {
    return deferredResult;
  }
  return {
    kind: "idle",
    dueTaskIds: [],
  };
}
