import type {
  FederationTaskAssignment,
  FederationTaskAssignmentState,
  TaskRecord,
} from "./contracts.js";
import {
  listRuntimeFederationAssignments,
  persistRuntimeFederationAssignments,
} from "./federation-assignments.js";
import { appendRuntimeEvent, loadRuntimeTaskStore, type RuntimeStoreOptions } from "./store.js";

export type FederationAssignmentTaskLifecycleSyncResult = {
  changed: number;
  assignments: FederationTaskAssignment[];
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCancelledReason(taskId: string): string {
  return `Linked local task ${taskId} was cancelled locally.`;
}

function buildMissingTaskReason(taskId: string): string {
  return `Linked local task ${taskId} is missing locally.`;
}

function buildAssignmentLifecycleState(
  assignment: FederationTaskAssignment,
  task: TaskRecord | undefined,
  now: number,
): FederationTaskAssignment | null {
  if (!assignment.localTaskId) {
    return null;
  }
  if (assignment.state !== "materialized" && assignment.state !== "applied") {
    return null;
  }

  let nextState: FederationTaskAssignmentState = assignment.state;
  let nextAppliedAt = assignment.appliedAt;
  let nextBlockedReason = assignment.blockedReason;

  if (!task) {
    nextState = "blocked";
    nextAppliedAt = undefined;
    nextBlockedReason = buildMissingTaskReason(assignment.localTaskId);
  } else if (task.status === "completed") {
    nextState = "applied";
    nextAppliedAt = assignment.appliedAt ?? now;
    nextBlockedReason = undefined;
  } else if (task.status === "cancelled") {
    nextState = "blocked";
    nextAppliedAt = undefined;
    nextBlockedReason = buildCancelledReason(task.id);
  } else {
    nextState = "materialized";
    nextAppliedAt = undefined;
    nextBlockedReason = undefined;
  }

  if (
    nextState === assignment.state &&
    (nextAppliedAt ?? undefined) === (assignment.appliedAt ?? undefined) &&
    normalizeText(nextBlockedReason) === normalizeText(assignment.blockedReason)
  ) {
    return null;
  }

  const metadata = {
    ...assignment.metadata,
    localTaskStatus: task?.status ?? "missing",
    localTaskUpdatedAt: task?.updatedAt,
    lifecycleSyncedAt: now,
  };

  return {
    ...assignment,
    state: nextState,
    appliedAt: nextAppliedAt,
    blockedReason: nextBlockedReason,
    updatedAt: now,
    metadata,
  };
}

export function syncRuntimeFederationAssignmentTaskLifecycle(
  opts: RuntimeStoreOptions = {},
): FederationAssignmentTaskLifecycleSyncResult {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const tasksById = new Map(taskStore.tasks.map((task) => [task.id, task] as const));
  const assignments = listRuntimeFederationAssignments({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });

  const changedAssignments: FederationTaskAssignment[] = [];
  for (const assignment of assignments) {
    if (assignment.invalid || !assignment.localTaskId) {
      continue;
    }
    const next = buildAssignmentLifecycleState(
      assignment,
      tasksById.get(assignment.localTaskId),
      now,
    );
    if (!next) {
      continue;
    }
    persistRuntimeFederationAssignments([next], {
      env: opts.env,
      homedir: opts.homedir,
      now,
    });
    appendRuntimeEvent(
      "runtime_federation_assignment_task_synced",
      {
        assignmentId: next.id,
        previousState: assignment.state,
        nextState: next.state,
        localTaskId: next.localTaskId,
        localTaskStatus:
          taskStore.tasks.find((task) => task.id === next.localTaskId)?.status ?? "missing",
        blockedReason: next.blockedReason,
      },
      {
        env: opts.env,
        homedir: opts.homedir,
        now,
      },
    );
    changedAssignments.push(next);
  }

  return {
    changed: changedAssignments.length,
    assignments: changedAssignments,
  };
}
