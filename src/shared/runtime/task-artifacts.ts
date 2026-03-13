import type {
  BudgetMode,
  RetrievalMode,
  RuntimeMetadata,
  ShareableReviewRecord,
  TaskPriority,
  TaskRecord,
  TaskReview,
  TaskRun,
  TaskStatus,
  TaskStep,
  ThinkingLane,
} from "./contracts.js";
import { normalizeTaskStatus } from "./task-loop.js";

export type TaskRecordSnapshotInput = {
  id?: string | null;
  title?: string | null;
  route?: string | null;
  status?: TaskStatus | string | null;
  priority?: TaskPriority | string | null;
  budgetMode?: BudgetMode | string | null;
  retrievalMode?: RetrievalMode | string | null;
  worker?: string | null;
  skillIds?: Array<string | null | undefined> | null;
  memoryRefs?: Array<string | null | undefined> | null;
  intelRefs?: Array<string | null | undefined> | null;
  recurring?: boolean | null;
  maintenance?: boolean | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  activeRunId?: string | null;
  latestReviewId?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  metadata?: RuntimeMetadata;
};

export type TaskRunSnapshotInput = {
  id?: string | null;
  taskId: string;
  status?: TaskStatus | string | null;
  thinkingLane?: ThinkingLane | string | null;
  startedAt?: number | null;
  updatedAt?: number | null;
  completedAt?: number | null;
  blockedAt?: number | null;
  concurrencyKey?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  metadata?: RuntimeMetadata;
};

export type TaskStepKind = TaskStep["kind"];
export type TaskStepStatus = TaskStep["status"];

export type TaskStepSnapshotInput = {
  id?: string | null;
  taskId: string;
  runId: string;
  kind?: TaskStepKind | string | null;
  status?: TaskStepStatus | string | null;
  idempotencyKey: string;
  worker?: string | null;
  route?: string | null;
  skillId?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  error?: string | null;
  metadata?: RuntimeMetadata;
};

export type TaskTransitionStepInput = {
  taskId: string;
  runId: string;
  status?: TaskStatus | string | null;
  idempotencyKey: string;
  worker?: string | null;
  route?: string | null;
  skillId?: string | null;
  occurredAt?: number | null;
  error?: string | null;
  metadata?: RuntimeMetadata;
};

export type TaskReviewInput = {
  id?: string | null;
  taskId: string;
  runId: string;
  status?: TaskStatus | string | null;
  summary?: string | null;
  outcome?: TaskReview["outcome"] | string | null;
  extractedMemoryIds?: Array<string | null | undefined> | null;
  strategyCandidateIds?: Array<string | null | undefined> | null;
  createdAt?: number | null;
  metadata?: RuntimeMetadata;
};

export type ShareableReviewEnvelopeInput = {
  id?: string | null;
  generatedAt?: number | null;
  metadata?: RuntimeMetadata;
};

export type TaskLifecycleArtifactsInput = {
  task: TaskRecordSnapshotInput;
  run?: Omit<TaskRunSnapshotInput, "taskId"> | null;
  step?: Omit<TaskStepSnapshotInput, "taskId" | "runId"> | null;
  review?: Omit<TaskReviewInput, "taskId" | "runId"> | null;
  shareableReview?: ShareableReviewEnvelopeInput | null;
  now?: number;
};

export type TaskLifecycleArtifacts = {
  taskRecord: TaskRecord;
  taskRun: TaskRun;
  taskStep?: TaskStep;
  taskReview?: TaskReview;
  shareableReview?: ShareableReviewRecord;
};

const TASK_STEP_KINDS = ["intake", "planner", "executor", "recovery", "review", "notify"] as const;

const TASK_STEP_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;

const TASK_STEP_KIND_SET = new Set<string>(TASK_STEP_KINDS);
const TASK_STEP_STATUS_SET = new Set<string>(TASK_STEP_STATUSES);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function toTimestamp(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
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

function normalizePriority(
  value: TaskPriority | string | null | undefined,
  fallback: TaskPriority = "normal",
): TaskPriority {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "high" || normalized === "normal" || normalized === "low") {
    return normalized;
  }
  return fallback;
}

function normalizeBudgetMode(
  value: BudgetMode | string | null | undefined,
  fallback: BudgetMode = "balanced",
): BudgetMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "strict" || normalized === "balanced" || normalized === "deep") {
    return normalized;
  }
  return fallback;
}

function normalizeRetrievalMode(
  value: RetrievalMode | string | null | undefined,
  fallback: RetrievalMode = "light",
): RetrievalMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "off" || normalized === "light" || normalized === "deep") {
    return normalized;
  }
  return fallback;
}

function normalizeThinkingLane(
  value: ThinkingLane | string | null | undefined,
  fallback: ThinkingLane = "system1",
): ThinkingLane {
  return normalizeText(value).toLowerCase() === "system2" ? "system2" : fallback;
}

function normalizeTaskStepKind(
  value: TaskStepKind | string | null | undefined,
  fallback: TaskStepKind = "intake",
): TaskStepKind {
  const normalized = normalizeText(value).toLowerCase();
  return TASK_STEP_KIND_SET.has(normalized) ? (normalized as TaskStepKind) : fallback;
}

function normalizeTaskStepStatus(
  value: TaskStepStatus | string | null | undefined,
  fallback: TaskStepStatus = "queued",
): TaskStepStatus {
  const normalized = normalizeText(value).toLowerCase();
  return TASK_STEP_STATUS_SET.has(normalized) ? (normalized as TaskStepStatus) : fallback;
}

function normalizeReviewOutcome(
  value: TaskReview["outcome"] | string | null | undefined,
  fallback: TaskReview["outcome"],
): TaskReview["outcome"] {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "success" ||
    normalized === "partial" ||
    normalized === "blocked" ||
    normalized === "cancelled" ||
    normalized === "failed"
  ) {
    return normalized;
  }
  return fallback;
}

export function buildTaskReviewOutcome(
  value: TaskStatus | string | null | undefined,
): TaskReview["outcome"] {
  const status = normalizeTaskStatus(value, "queued");
  if (status === "completed") return "success";
  if (status === "cancelled") return "cancelled";
  if (status === "blocked" || status === "waiting_user") return "blocked";
  return "partial";
}

export function buildTaskRecordSnapshot(
  input: TaskRecordSnapshotInput,
  now = Date.now(),
): TaskRecord {
  const createdAt = toTimestamp(input.createdAt, now);
  const updatedAt = toTimestamp(input.updatedAt, createdAt);
  const route = normalizeText(input.route) || "general";
  const title = normalizeText(input.title) || "Untitled task";

  return {
    id: normalizeText(input.id) || buildStableId("task", [route, title, createdAt]),
    title,
    route,
    status: normalizeTaskStatus(input.status, "queued"),
    priority: normalizePriority(input.priority),
    budgetMode: normalizeBudgetMode(input.budgetMode),
    retrievalMode: normalizeRetrievalMode(input.retrievalMode),
    worker: normalizeText(input.worker) || undefined,
    skillIds: uniqueStrings(input.skillIds),
    memoryRefs: uniqueStrings(input.memoryRefs),
    intelRefs: uniqueStrings(input.intelRefs),
    recurring: input.recurring === true,
    maintenance: input.maintenance === true,
    leaseOwner: normalizeText(input.leaseOwner) || undefined,
    leaseExpiresAt: Number.isFinite(input.leaseExpiresAt)
      ? Number(input.leaseExpiresAt)
      : undefined,
    activeRunId: normalizeText(input.activeRunId) || undefined,
    latestReviewId: normalizeText(input.latestReviewId) || undefined,
    createdAt,
    updatedAt,
    metadata: input.metadata,
  };
}

export function buildTaskRunSnapshot(input: TaskRunSnapshotInput, now = Date.now()): TaskRun {
  const startedAt = toTimestamp(input.startedAt, now);
  const updatedAt = toTimestamp(input.updatedAt, startedAt);
  const status = normalizeTaskStatus(input.status, "queued");
  const completedAt = Number.isFinite(input.completedAt)
    ? Number(input.completedAt)
    : status === "completed" || status === "cancelled"
      ? updatedAt
      : undefined;
  const blockedAt = Number.isFinite(input.blockedAt)
    ? Number(input.blockedAt)
    : status === "blocked" || status === "waiting_user"
      ? updatedAt
      : undefined;

  return {
    id:
      normalizeText(input.id) ||
      buildStableId("run", [
        input.taskId,
        startedAt,
        status,
        normalizeThinkingLane(input.thinkingLane),
        normalizeText(input.concurrencyKey),
      ]),
    taskId: normalizeText(input.taskId) || "task_unknown",
    status,
    thinkingLane: normalizeThinkingLane(input.thinkingLane),
    startedAt,
    updatedAt,
    completedAt,
    blockedAt,
    concurrencyKey: normalizeText(input.concurrencyKey) || undefined,
    leaseOwner: normalizeText(input.leaseOwner) || undefined,
    leaseExpiresAt: Number.isFinite(input.leaseExpiresAt)
      ? Number(input.leaseExpiresAt)
      : undefined,
    metadata: input.metadata,
  };
}

export function buildTaskStepSnapshot(input: TaskStepSnapshotInput): TaskStep {
  return {
    id:
      normalizeText(input.id) ||
      buildStableId("step", [
        input.taskId,
        input.runId,
        input.idempotencyKey,
        input.kind,
        input.status,
      ]),
    taskId: normalizeText(input.taskId) || "task_unknown",
    runId: normalizeText(input.runId) || "run_unknown",
    kind: normalizeTaskStepKind(input.kind),
    status: normalizeTaskStepStatus(input.status),
    idempotencyKey: normalizeText(input.idempotencyKey) || "step_idempotency_unknown",
    worker: normalizeText(input.worker) || undefined,
    route: normalizeText(input.route) || undefined,
    skillId: normalizeText(input.skillId) || undefined,
    startedAt: Number.isFinite(input.startedAt) ? Number(input.startedAt) : undefined,
    completedAt: Number.isFinite(input.completedAt) ? Number(input.completedAt) : undefined,
    error: normalizeText(input.error) || undefined,
    metadata: input.metadata,
  };
}

export function buildTaskTransitionStep(input: TaskTransitionStepInput): TaskStep {
  const status = normalizeTaskStatus(input.status, "queued");
  const occurredAt = Number.isFinite(input.occurredAt) ? Number(input.occurredAt) : Date.now();

  let kind: TaskStepKind = "intake";
  let stepStatus: TaskStepStatus = "queued";

  if (status === "planning") {
    kind = "planner";
    stepStatus = "running";
  } else if (status === "ready") {
    kind = "planner";
    stepStatus = "completed";
  } else if (status === "running") {
    kind = "executor";
    stepStatus = "running";
  } else if (status === "waiting_external") {
    kind = "recovery";
    stepStatus = "running";
  } else if (status === "waiting_user") {
    kind = "notify";
    stepStatus = "queued";
  } else if (status === "blocked") {
    kind = "recovery";
    stepStatus = "failed";
  } else if (status === "completed") {
    kind = "review";
    stepStatus = "completed";
  } else if (status === "cancelled") {
    kind = "notify";
    stepStatus = "cancelled";
  }

  return buildTaskStepSnapshot({
    taskId: input.taskId,
    runId: input.runId,
    kind,
    status: stepStatus,
    idempotencyKey: input.idempotencyKey,
    worker: input.worker,
    route: input.route,
    skillId: input.skillId,
    startedAt: stepStatus === "queued" ? undefined : occurredAt,
    completedAt:
      stepStatus === "completed" || stepStatus === "failed" || stepStatus === "cancelled"
        ? occurredAt
        : undefined,
    error: input.error,
    metadata: input.metadata,
  });
}

export function buildTaskReviewRecord(input: TaskReviewInput, now = Date.now()): TaskReview {
  const status = normalizeTaskStatus(input.status, "queued");
  const createdAt = toTimestamp(input.createdAt, now);
  const summary =
    normalizeText(input.summary) || `Task ${normalizeText(input.taskId) || "unknown"} -> ${status}`;
  const outcome = normalizeReviewOutcome(input.outcome, buildTaskReviewOutcome(status));

  return {
    id:
      normalizeText(input.id) ||
      buildStableId("review", [input.taskId, input.runId, outcome, summary, createdAt]),
    taskId: normalizeText(input.taskId) || "task_unknown",
    runId: normalizeText(input.runId) || "run_unknown",
    summary,
    outcome,
    extractedMemoryIds: uniqueStrings(input.extractedMemoryIds),
    strategyCandidateIds: uniqueStrings(input.strategyCandidateIds),
    createdAt,
    metadata: input.metadata,
  };
}

export function buildShareableReviewEnvelope(
  taskReview: TaskReview,
  input: ShareableReviewEnvelopeInput = {},
): ShareableReviewRecord {
  const generatedAt = toTimestamp(input.generatedAt, taskReview.createdAt);
  return {
    id: normalizeText(input.id) || buildStableId("shareable_review", [taskReview.id, generatedAt]),
    taskReview,
    shareScope: "shareable_derived",
    generatedAt,
    metadata: input.metadata,
  };
}

export function buildTaskLifecycleArtifacts(
  input: TaskLifecycleArtifactsInput,
): TaskLifecycleArtifacts {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const taskRecord = buildTaskRecordSnapshot(input.task, now);
  const taskRun = buildTaskRunSnapshot(
    {
      taskId: taskRecord.id,
      status: taskRecord.status,
      startedAt: taskRecord.updatedAt,
      updatedAt: taskRecord.updatedAt,
      ...input.run,
    },
    now,
  );
  const taskStep = input.step
    ? buildTaskStepSnapshot({
        taskId: taskRecord.id,
        runId: taskRun.id,
        ...input.step,
      })
    : undefined;
  const taskReview = input.review
    ? buildTaskReviewRecord(
        {
          taskId: taskRecord.id,
          runId: taskRun.id,
          status: taskRecord.status,
          createdAt: taskRecord.updatedAt,
          ...input.review,
        },
        now,
      )
    : undefined;
  const shareableReview = taskReview
    ? buildShareableReviewEnvelope(taskReview, input.shareableReview || undefined)
    : undefined;

  return {
    taskRecord: {
      ...taskRecord,
      activeRunId: taskRun.id,
      latestReviewId: taskReview?.id || taskRecord.latestReviewId,
    },
    taskRun,
    taskStep,
    taskReview,
    shareableReview,
  };
}
