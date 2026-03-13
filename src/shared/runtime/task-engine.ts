import {
  buildDecisionRecord,
  type DecisionConfig,
  type DecisionRecord,
  type DecisionTaskInput,
} from "./decision-core.js";
import type {
  BudgetMode,
  RetrievalMode,
  RuntimeMetadata,
  RuntimeTaskStore,
  TaskRecord,
  TaskReview,
  TaskRun,
  TaskStatus,
  ThinkingLane,
} from "./contracts.js";
import {
  distillTaskOutcomeToMemory,
  materializeAdoptedEvolutionStrategies,
  maybeAutoApplyLowRiskEvolution,
  observeTaskOutcomeForEvolution,
  persistTaskLifecycleArtifacts,
} from "./mutations.js";
import {
  appendRuntimeEvent,
  buildRuntimeRetrievalSourceSet,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import { buildTaskRecordSnapshot, type TaskRecordSnapshotInput } from "./task-artifacts.js";
import {
  compareTaskQueueOrder,
  isTerminalTaskStatus,
  normalizeTaskStatus,
  shouldTaskRun,
} from "./task-loop.js";

const TASK_RETRY_BACKOFF_MINUTES = [3, 10, 30] as const;
const TASK_MAX_CONSECUTIVE_FAILURES = 4;
const TASK_BLOCK_NOTIFY_AFTER_MS = 10 * 60 * 1000;

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
  lastRelevantIntelIds?: string[];
  lastFallbackOrder?: string[];
  lastFailureAt?: number;
  lastFailureSummary?: string;
  lastResultStatus?: string;
  lastResultSummary?: string;
  lastWorkerOutput?: string;
  lastCliExitCode?: number;
  blockedAt?: number | null;
};

type RuntimeTaskOptimizationState = {
  needsReplan?: boolean;
  lastReplannedAt?: number;
  invalidatedBy?: string[];
  invalidatedMemoryIds?: string[];
  decision?: DecisionRecord;
};

export type RuntimeTaskPlanResult = {
  kind: "planned";
  task: TaskRecord;
  run: TaskRun;
  decision: DecisionRecord;
};

export type RuntimeTaskUpsertResult = {
  created: boolean;
  task: TaskRecord;
};

export type RuntimeTaskApplyResult = {
  task: TaskRecord;
  run: TaskRun;
  review?: TaskReview;
  distilledMemoryIds: string[];
  strategyIds: string[];
};

export type RuntimeTaskTickResult =
  | { kind: "idle"; dueTaskIds: string[] }
  | { kind: "busy"; activeTaskIds: string[]; dueTaskIds: string[] }
  | RuntimeTaskPlanResult;

export type RuntimeTaskResultInput = {
  taskId: string;
  status: TaskStatus | string;
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

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeMetadataRecords(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!left && !right) return undefined;
  if (!left) return right ?? undefined;
  if (!right) return left;
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = toRecord(merged[key]);
    const next = toRecord(value);
    merged[key] = current && next ? mergeMetadataRecords(current, next) : value;
  }
  return merged;
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
    lastDecisionAt: typeof runState?.lastDecisionAt === "number" ? runState.lastDecisionAt : undefined,
    lastThinkingLane: runState?.lastThinkingLane === "system2" ? "system2" : "system1",
    lastDecisionSummary: normalizeText(runState?.lastDecisionSummary) || undefined,
    lastRecommendedWorker: normalizeText(runState?.lastRecommendedWorker) || undefined,
    lastRecommendedSkills: Array.isArray(runState?.lastRecommendedSkills)
      ? uniqueStrings(runState.lastRecommendedSkills.filter((value): value is string => typeof value === "string"))
      : [],
    lastRelevantMemoryIds: Array.isArray(runState?.lastRelevantMemoryIds)
      ? uniqueStrings(runState.lastRelevantMemoryIds.filter((value): value is string => typeof value === "string"))
      : [],
    lastRelevantIntelIds: Array.isArray(runState?.lastRelevantIntelIds)
      ? uniqueStrings(runState.lastRelevantIntelIds.filter((value): value is string => typeof value === "string"))
      : [],
    lastFallbackOrder: Array.isArray(runState?.lastFallbackOrder)
      ? uniqueStrings(runState.lastFallbackOrder.filter((value): value is string => typeof value === "string"))
      : [],
    lastFailureAt: typeof runState?.lastFailureAt === "number" ? runState.lastFailureAt : undefined,
    lastFailureSummary: normalizeText(runState?.lastFailureSummary) || undefined,
    lastResultStatus: normalizeText(runState?.lastResultStatus) || undefined,
    lastResultSummary: normalizeText(runState?.lastResultSummary) || undefined,
    lastWorkerOutput: normalizeText(runState?.lastWorkerOutput) || undefined,
    lastCliExitCode: typeof runState?.lastCliExitCode === "number" ? runState.lastCliExitCode : undefined,
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
      ? uniqueStrings(optimizationState.invalidatedBy.filter((value): value is string => typeof value === "string"))
      : [],
    invalidatedMemoryIds: Array.isArray(optimizationState?.invalidatedMemoryIds)
      ? uniqueStrings(
          optimizationState.invalidatedMemoryIds.filter((value): value is string => typeof value === "string"),
        )
      : [],
    decision: toRecord(optimizationState?.decision) as DecisionRecord | undefined,
  };
}

// Keep mutable scheduler/runtime state under metadata until contracts gain dedicated fields.
function writeTaskRuntimeMetadata(
  task: TaskRecord,
  params: {
    runState?: Partial<RuntimeTaskRunState>;
    optimizationState?: Partial<RuntimeTaskOptimizationState>;
  },
): RuntimeMetadata {
  const metadata = toRecord(task.metadata) ?? {};
  const runtime = toRecord(metadata.runtimeTask) ?? {};
  const currentRunState = readTaskRunState(task);
  const currentOptimizationState = readTaskOptimizationState(task);
  return {
    ...metadata,
    runtimeTask: {
      ...runtime,
      runState: {
        ...currentRunState,
        ...(params.runState ?? {}),
      },
      optimizationState: {
        ...currentOptimizationState,
        ...(params.optimizationState ?? {}),
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

function buildDecisionTaskInput(task: TaskRecord): DecisionTaskInput {
  const runState = readTaskRunState(task);
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    route: task.route,
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

function buildPlanningSummary(task: TaskRecord): string {
  const skillText =
    task.skillIds.length > 0
      ? `prioritize skills: ${task.skillIds.slice(0, 5).join(", ")}`
      : "prioritize stable local tools and known skills";
  return `Proceed on the ${task.route || "general"} lane and ${skillText}.`;
}

function buildNextActionSummary(task: TaskRecord): string {
  if (task.route === "office") return "Organize the request and update the lowest-cost office workflow first.";
  if (task.route === "coder") return "Read the repo and current diff, then shape the smallest executable patch.";
  if (task.route === "ops") return "Read logs, ports, processes, and config before attempting a repair.";
  if (task.route === "media") return "Extract the source material into structured data before asking for higher-level judgment.";
  if (task.route === "research") return "Retrieve, rank, and compress the signal before deep synthesis.";
  return "Identify the task shape first, then choose the cheapest valid execution path.";
}

function bumpBudgetMode(mode: BudgetMode): BudgetMode {
  if (mode === "strict") return "balanced";
  if (mode === "balanced") return "deep";
  return "deep";
}

function bumpRetrievalMode(mode: RetrievalMode): RetrievalMode {
  if (mode === "off") return "light";
  if (mode === "light") return "deep";
  return "deep";
}

function buildRetryPatch(task: TaskRecord, failureSummary: string, now: number) {
  const runState = readTaskRunState(task);
  const consecutiveFailures = (runState.consecutiveFailures ?? 0) + 1;
  const totalFailures = (runState.totalFailures ?? 0) + 1;
  const retryIndex = Math.min(consecutiveFailures - 1, TASK_RETRY_BACKOFF_MINUTES.length - 1);
  const nextRunAt = now + TASK_RETRY_BACKOFF_MINUTES[retryIndex]! * 60 * 1000;
  const budgetMode = consecutiveFailures >= 2 ? bumpBudgetMode(task.budgetMode) : task.budgetMode;
  const retrievalMode =
    consecutiveFailures >= 2 ? bumpRetrievalMode(task.retrievalMode) : task.retrievalMode;
  const worker = consecutiveFailures >= 3 && task.worker && task.worker !== "main" ? "main" : task.worker;
  const status: TaskStatus =
    consecutiveFailures >= TASK_MAX_CONSECUTIVE_FAILURES ? "blocked" : "queued";
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
        ? `Repeated failure ${consecutiveFailures} times; pausing automatic retries.`
        : `Automatic replan #${replanCount} after failure; upgrade budget/retrieval before the next run.`,
    nextAction:
      status === "blocked"
        ? "Wait for external intervention or a later strategy refresh."
        : `Retry in ${TASK_RETRY_BACKOFF_MINUTES[retryIndex]} minutes and prefer a different skill bundle or path.`,
    runState: {
      consecutiveFailures,
      totalFailures,
      replanCount,
      lastFailureAt: now,
      lastFailureSummary: failureSummary,
    } satisfies Partial<RuntimeTaskRunState>,
  };
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

function mergeTaskMemoryRefs(
  taskId: string,
  memoryIds: string[],
  opts: RuntimeStoreOptions,
): TaskRecord | undefined {
  if (memoryIds.length === 0) return undefined;
  const stores = loadRuntimeStoreBundle(opts);
  const task = stores.taskStore.tasks.find((entry) => entry.id === taskId);
  if (!task) return undefined;
  task.memoryRefs = uniqueStrings([...(task.memoryRefs ?? []), ...memoryIds]);
  task.updatedAt = resolveNow(opts.now);
  const saved = saveRuntimeStoreBundle(stores, opts);
  return saved.taskStore.tasks.find((entry) => entry.id === taskId);
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
  const nextTask = buildTaskRecordSnapshot(
    {
      id: requestedId || existing?.id,
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
      intelRefs: input.intelRefs ?? existing?.intelRefs ?? [],
      recurring: input.recurring ?? existing?.recurring ?? false,
      maintenance: input.maintenance ?? existing?.maintenance ?? false,
      planSummary: input.planSummary ?? existing?.planSummary,
      nextAction: input.nextAction ?? existing?.nextAction,
      blockedReason: input.blockedReason ?? existing?.blockedReason,
      lastError: input.lastError ?? existing?.lastError,
      reportPolicy: input.reportPolicy ?? existing?.reportPolicy,
      nextRunAt:
        input.nextRunAt === null
          ? undefined
          : input.nextRunAt ?? existing?.nextRunAt,
      leaseOwner: input.leaseOwner ?? existing?.leaseOwner,
      leaseExpiresAt:
        input.leaseExpiresAt === null
          ? undefined
          : input.leaseExpiresAt ?? existing?.leaseExpiresAt,
      activeRunId:
        input.activeRunId === null
          ? undefined
          : input.activeRunId ?? existing?.activeRunId,
      latestReviewId:
        input.latestReviewId === null
          ? undefined
          : input.latestReviewId ?? existing?.latestReviewId,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
      metadata: mergeMetadataRecords(toRecord(existing?.metadata), toRecord(input.metadata)),
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

  const decision = buildDecisionRecord({
    task: buildDecisionTaskInput(task),
    config: buildDecisionConfig(stores.taskStore),
    sources: buildRuntimeRetrievalSourceSet({
      ...opts,
      now,
    }),
    now,
  });
  const optimizationState = readTaskOptimizationState(task);
  const replanMarker =
    normalizeText(task.nextAction).includes("memory invalidated") ||
    normalizeText(task.planSummary).includes("memory invalidated") ||
    normalizeText(task.nextAction).includes("记忆已失效") ||
    normalizeText(task.planSummary).includes("记忆已失效") ||
    optimizationState.needsReplan === true;
  const mergedSkills = uniqueStrings([...(task.skillIds ?? []), ...decision.recommendedSkills]).slice(
    0,
    16,
  );
  const effectiveBudgetMode =
    decision.thinkingLane === "system2" ? bumpBudgetMode(task.budgetMode) : task.budgetMode;
  const effectiveRetrievalMode =
    decision.thinkingLane === "system2"
      ? bumpRetrievalMode(task.retrievalMode)
      : task.retrievalMode;
  const runState = readTaskRunState(task);
  const nextTask: TaskRecord = {
    ...task,
    status: "running",
    worker: decision.recommendedWorker || task.worker,
    skillIds: mergedSkills,
    budgetMode: effectiveBudgetMode,
    retrievalMode: effectiveRetrievalMode,
    memoryRefs: decision.relevantMemoryIds,
    intelRefs: decision.relevantIntelIds,
    nextRunAt: undefined,
    lastError: undefined,
    blockedReason: undefined,
    planSummary: !task.planSummary || replanMarker ? buildPlanningSummary(task) : task.planSummary,
    nextAction: !task.nextAction || replanMarker ? buildNextActionSummary(task) : task.nextAction,
    updatedAt: now,
    metadata: writeTaskRuntimeMetadata(task, {
      optimizationState: {
        ...optimizationState,
        needsReplan: false,
        lastReplannedAt: now,
        decision,
      },
      runState: {
        ...runState,
        lastDecisionAt: decision.builtAt,
        lastThinkingLane: decision.thinkingLane,
        lastDecisionSummary: decision.summary,
        lastRecommendedWorker: decision.recommendedWorker,
        lastRecommendedSkills: decision.recommendedSkills,
        lastRelevantMemoryIds: decision.relevantMemoryIds,
        lastRelevantIntelIds: decision.relevantIntelIds,
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
        metadata: {
          decisionSummary: decision.summary,
          recommendedWorker: decision.recommendedWorker,
          recommendedSkills: decision.recommendedSkills,
          remoteCallCount: (runState.remoteCallCount ?? 0) + 1,
        },
      },
      step: {
        kind: "executor",
        status: "running",
        idempotencyKey: `runtime-plan:${task.id}:${now}`,
        worker: decision.recommendedWorker || task.worker,
        route: task.route,
        metadata: {
          thinkingLane: decision.thinkingLane,
          relevantMemoryIds: decision.relevantMemoryIds,
          relevantIntelIds: decision.relevantIntelIds,
        },
      },
      now,
    },
    {
      ...opts,
      now,
    },
  );

  appendRuntimeEvent(
    "runtime_task_planned",
    {
      taskId: persisted.task.id,
      runId: persisted.run.id,
      thinkingLane: decision.thinkingLane,
      recommendedWorker: decision.recommendedWorker,
      recommendedSkills: decision.recommendedSkills,
      memoryRefs: decision.relevantMemoryIds,
      intelRefs: decision.relevantIntelIds,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    kind: "planned",
    task: persisted.task,
    run: persisted.run,
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
          ...(toRecord(activeRun?.metadata) ?? {}),
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

  let distilledMemoryIds: string[] = [];
  let strategyIds: string[] = [];
  let finalTask = persisted.task;
  if (
    persisted.task.status === "completed" ||
    persisted.task.status === "blocked" ||
    persisted.task.status === "waiting_user"
  ) {
    const distilled = distillTaskOutcomeToMemory(
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
    distilledMemoryIds = distilled.memories.map((entry) => entry.id);
    strategyIds = distilled.strategies.map((entry) => entry.id);

    const mergedTask = mergeTaskMemoryRefs(persisted.task.id, distilledMemoryIds, {
      ...opts,
      now,
    });
    if (mergedTask) {
      finalTask = mergedTask;
    }

    const evolutionInputTask = mergedTask ?? persisted.task;
    observeTaskOutcomeForEvolution(
      {
        task: evolutionInputTask,
        review: persisted.review,
        thinkingLane:
          activeRun?.thinkingLane || decision?.thinkingLane || runState.lastThinkingLane || "system1",
        now,
      },
      {
        ...opts,
        now,
      },
    );
    maybeAutoApplyLowRiskEvolution({
      ...opts,
      now,
    });
    materializeAdoptedEvolutionStrategies({
      ...opts,
      now,
    });
  }

  appendRuntimeEvent(
    "runtime_task_result_applied",
    {
      taskId: persisted.task.id,
      runId: persisted.run.id,
      status: persisted.task.status,
      reviewId: persisted.review?.id,
      memoryIds: distilledMemoryIds,
      strategyIds,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    task: finalTask,
    run: persisted.run,
    review: persisted.review,
    distilledMemoryIds,
    strategyIds,
  };
}

export function tickRuntimeTaskLoop(opts: RuntimeStoreOptions = {}): RuntimeTaskTickResult {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeStoreBundle({
    ...opts,
    now,
  }).taskStore;
  const dueTasks = [...taskStore.tasks]
    .filter((task) => shouldTaskRun(task, now))
    .toSorted(compareTaskQueueOrder);
  const activeTaskIds = taskStore.tasks
    .filter((task) => task.status === "running")
    .map((task) => task.id);

  if (activeTaskIds.length > 0) {
    return {
      kind: "busy",
      activeTaskIds,
      dueTaskIds: dueTasks.map((task) => task.id),
    };
  }
  const nextTask = dueTasks[0];
  if (!nextTask) {
    return {
      kind: "idle",
      dueTaskIds: [],
    };
  }
  return planRuntimeTask(nextTask.id, {
    ...opts,
    now,
  });
}
