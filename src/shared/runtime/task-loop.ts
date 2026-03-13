import type { TaskPriority, TaskStatus } from "./contracts.js";
import { TASK_STATUSES } from "./contracts.js";

export type TaskQueueInput = {
  status?: TaskStatus | string | null;
  priority?: TaskPriority | string | null;
  nextRunAt?: number | null;
  updatedAt?: number | null;
  createdAt?: number | null;
};

export type TaskStatusCounts = {
  total: number;
  queued: number;
  planning: number;
  ready: number;
  running: number;
  waitingExternal: number;
  waitingUser: number;
  blocked: number;
  completed: number;
  cancelled: number;
  due: number;
};

const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);

const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  blocked: 0,
  queued: 1,
  planning: 2,
  ready: 3,
  waiting_external: 4,
  running: 5,
  waiting_user: 6,
  completed: 7,
  cancelled: 8,
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function toTimestamp(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function normalizeTaskStatus(
  value: TaskStatus | string | null | undefined,
  fallback: TaskStatus = "queued",
): TaskStatus {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "waiting_human") return "waiting_user";
  if (normalized === "done") return "completed";
  if (TASK_STATUS_SET.has(normalized)) return normalized as TaskStatus;
  return fallback;
}

export function normalizeOptionalTaskStatus(
  value: TaskStatus | string | null | undefined,
): TaskStatus | null {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === "waiting_human") return "waiting_user";
  if (normalized === "done") return "completed";
  return TASK_STATUS_SET.has(normalized) ? (normalized as TaskStatus) : null;
}

export function getTaskStatusAliases(value: TaskStatus | string | null | undefined): string[] {
  const normalized = normalizeOptionalTaskStatus(value);
  if (!normalized) return [];
  if (normalized === "waiting_user") return ["waiting_user", "waiting_human"];
  if (normalized === "completed") return ["completed", "done"];
  return [normalized];
}

export function isTerminalTaskStatus(value: TaskStatus | string | null | undefined): boolean {
  const status = normalizeOptionalTaskStatus(value);
  return status === "completed" || status === "cancelled";
}

export function isRunnableTaskStatus(value: TaskStatus | string | null | undefined): boolean {
  const status = normalizeOptionalTaskStatus(value);
  if (!status) return false;
  return status !== "waiting_user" && status !== "completed" && status !== "cancelled";
}

export function shouldTaskRun(task: TaskQueueInput | null | undefined, now = Date.now()): boolean {
  const status = normalizeTaskStatus(task?.status, "queued");
  if (!isRunnableTaskStatus(status)) return false;
  const nextRunAt = Number(task?.nextRunAt);
  if (!Number.isFinite(nextRunAt)) {
    return (
      status === "queued" || status === "planning" || status === "ready" || status === "blocked"
    );
  }
  return nextRunAt <= now;
}

export function compareTaskQueueOrder(left: TaskQueueInput, right: TaskQueueInput): number {
  const leftPriority = TASK_PRIORITY_RANK[normalizePriority(left.priority)] ?? 9;
  const rightPriority = TASK_PRIORITY_RANK[normalizePriority(right.priority)] ?? 9;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftStatus = TASK_STATUS_RANK[normalizeTaskStatus(left.status, "queued")] ?? 9;
  const rightStatus = TASK_STATUS_RANK[normalizeTaskStatus(right.status, "queued")] ?? 9;
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;

  const leftNextRunAt = toTimestamp(left.nextRunAt);
  const rightNextRunAt = toTimestamp(right.nextRunAt);
  if (leftNextRunAt !== rightNextRunAt) return leftNextRunAt - rightNextRunAt;

  return (
    toTimestamp(left.updatedAt ?? left.createdAt) - toTimestamp(right.updatedAt ?? right.createdAt)
  );
}

export function buildTaskStatusCounts(
  tasks: Array<TaskQueueInput | null | undefined>,
  now = Date.now(),
): TaskStatusCounts {
  const counts: TaskStatusCounts = {
    total: tasks.length,
    queued: 0,
    planning: 0,
    ready: 0,
    running: 0,
    waitingExternal: 0,
    waitingUser: 0,
    blocked: 0,
    completed: 0,
    cancelled: 0,
    due: 0,
  };

  for (const task of tasks) {
    const status = normalizeTaskStatus(task?.status, "queued");
    if (status === "queued") counts.queued += 1;
    else if (status === "planning") counts.planning += 1;
    else if (status === "ready") counts.ready += 1;
    else if (status === "running") counts.running += 1;
    else if (status === "waiting_external") counts.waitingExternal += 1;
    else if (status === "waiting_user") counts.waitingUser += 1;
    else if (status === "blocked") counts.blocked += 1;
    else if (status === "completed") counts.completed += 1;
    else if (status === "cancelled") counts.cancelled += 1;

    if (shouldTaskRun(task, now)) counts.due += 1;
  }

  return counts;
}
