import type { CoordinatorSuggestionRecord, TaskRecord, TaskStatus } from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeFederationStore,
  loadRuntimeTaskStore,
  saveRuntimeFederationStore,
  type RuntimeStoreOptions,
} from "./store.js";

export type FederationCoordinatorSuggestionTaskLifecycleSyncResult = {
  changed: number;
  suggestions: CoordinatorSuggestionRecord[];
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildMissingTaskReason(taskId: string): string {
  return `Linked local task ${taskId} is missing locally.`;
}

function buildCancelledTaskReason(taskId: string): string {
  return `Linked local task ${taskId} was cancelled locally.`;
}

function buildLifecycleMetadata(
  suggestion: CoordinatorSuggestionRecord,
  nextLocalTaskStatus: TaskStatus | "missing",
  now: number,
  nextRematerializeReason?: string,
): CoordinatorSuggestionRecord["metadata"] {
  return {
    ...suggestion.metadata,
    localTaskStatus: nextLocalTaskStatus,
    lifecycleSyncedAt: now,
    lastMaterializedLocalTaskId:
      suggestion.localTaskId ?? suggestion.lastMaterializedLocalTaskId ?? undefined,
    lastMaterializedAt: suggestion.materializedAt ?? suggestion.lastMaterializedAt ?? undefined,
    rematerializeReason: nextRematerializeReason,
  };
}

function buildCoordinatorSuggestionLifecycleUpdate(
  suggestion: CoordinatorSuggestionRecord,
  task: TaskRecord | undefined,
  now: number,
): CoordinatorSuggestionRecord | null {
  if (!suggestion.localTaskId) {
    return null;
  }

  const currentStatus = task?.status ?? "missing";
  const nextLocalTaskStatus: TaskStatus | "missing" = currentStatus;

  if (!task) {
    const reason = buildMissingTaskReason(suggestion.localTaskId);
    const next: CoordinatorSuggestionRecord = {
      ...suggestion,
      localTaskId: undefined,
      localTaskStatus: nextLocalTaskStatus,
      updatedAt: now,
      materializedAt: undefined,
      lifecycleSyncedAt: now,
      lastMaterializedLocalTaskId:
        suggestion.localTaskId ?? suggestion.lastMaterializedLocalTaskId ?? undefined,
      lastMaterializedAt: suggestion.materializedAt ?? suggestion.lastMaterializedAt ?? undefined,
      rematerializeReason: reason,
      metadata: buildLifecycleMetadata(suggestion, nextLocalTaskStatus, now, reason),
    };
    return next;
  }

  if (task.status === "cancelled") {
    const reason = buildCancelledTaskReason(task.id);
    const next: CoordinatorSuggestionRecord = {
      ...suggestion,
      localTaskId: undefined,
      localTaskStatus: "cancelled",
      updatedAt: now,
      materializedAt: undefined,
      lifecycleSyncedAt: now,
      lastMaterializedLocalTaskId: task.id,
      lastMaterializedAt: suggestion.materializedAt ?? suggestion.lastMaterializedAt ?? undefined,
      rematerializeReason: reason,
      metadata: buildLifecycleMetadata(suggestion, "cancelled", now, reason),
    };
    return next;
  }

  const next: CoordinatorSuggestionRecord = {
    ...suggestion,
    localTaskStatus: nextLocalTaskStatus,
    updatedAt: now,
    lifecycleSyncedAt: now,
    lastMaterializedLocalTaskId: suggestion.localTaskId,
    lastMaterializedAt: suggestion.materializedAt ?? suggestion.lastMaterializedAt ?? undefined,
    rematerializeReason: undefined,
    metadata: buildLifecycleMetadata(suggestion, nextLocalTaskStatus, now),
  };

  const unchanged =
    next.localTaskStatus === suggestion.localTaskStatus &&
    next.lastMaterializedLocalTaskId === suggestion.lastMaterializedLocalTaskId &&
    (next.lastMaterializedAt ?? undefined) === (suggestion.lastMaterializedAt ?? undefined) &&
    normalizeText(next.rematerializeReason) === normalizeText(suggestion.rematerializeReason);
  if (unchanged) {
    return null;
  }
  return next;
}

function buildLifecycleEventSummary(
  previous: CoordinatorSuggestionRecord,
  next: CoordinatorSuggestionRecord,
): {
  previousState: string;
  nextState: string;
  localTaskStatus: TaskStatus | "missing" | undefined;
  rematerializeReason?: string;
} {
  const previousState = previous.localTaskId ? "materialized" : "queued";
  const nextState = next.localTaskId
    ? next.localTaskStatus === "completed" || next.localTaskStatus === "cancelled"
      ? "materialized_terminal"
      : "materialized"
    : next.rematerializeReason
      ? "requeued"
      : "queued";
  return {
    previousState,
    nextState,
    localTaskStatus: next.localTaskStatus,
    rematerializeReason: next.rematerializeReason,
  };
}

export function syncRuntimeFederationCoordinatorSuggestionTaskLifecycle(
  opts: RuntimeStoreOptions = {},
): FederationCoordinatorSuggestionTaskLifecycleSyncResult {
  const now = resolveNow(opts.now);
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
  const tasksById = new Map(taskStore.tasks.map((task) => [task.id, task] as const));

  const changedSuggestions: CoordinatorSuggestionRecord[] = [];
  const nextCoordinatorSuggestions = federationStore.coordinatorSuggestions.map((suggestion) => {
    const next = buildCoordinatorSuggestionLifecycleUpdate(
      suggestion,
      suggestion.localTaskId ? tasksById.get(suggestion.localTaskId) : undefined,
      now,
    );
    if (!next) {
      return suggestion;
    }
    const summary = buildLifecycleEventSummary(suggestion, next);
    appendRuntimeEvent(
      "runtime_federation_coordinator_suggestion_task_synced",
      {
        suggestionId: next.id,
        previousState: summary.previousState,
        nextState: summary.nextState,
        localTaskId: next.localTaskId ?? suggestion.localTaskId,
        localTaskStatus: summary.localTaskStatus,
        rematerializeReason: summary.rematerializeReason,
      },
      {
        env: opts.env,
        homedir: opts.homedir,
        now,
      },
    );
    changedSuggestions.push(next);
    return next;
  });

  if (changedSuggestions.length > 0) {
    saveRuntimeFederationStore(
      {
        ...federationStore,
        coordinatorSuggestions: nextCoordinatorSuggestions,
      },
      {
        env: opts.env,
        homedir: opts.homedir,
        now,
      },
    );
  }

  return {
    changed: changedSuggestions.length,
    suggestions: changedSuggestions,
  };
}
