import type {
  ManualPinnedIntelRecord,
  MemoryRecord,
  MetaLearningRecord,
  RuntimeUserModel,
  StrategyRecord,
} from "./contracts.js";
import {
  distillTaskOutcomeToMemory,
  invalidateMemoryLineage,
  promotePinnedIntelToKnowledgeMemory,
  recordRuntimeSurfaceRoleMemory,
  recordRuntimeTaskUserResponseMemory,
  recordRuntimeUserPreferenceMemories,
  reinforceMemoryLineage,
  reviewRuntimeMemoryLifecycle,
  rollbackMemoryInvalidation,
  type DistillTaskOutcomeInput,
  type DistillTaskOutcomeResult,
  type InvalidateMemoryLineageInput,
  type InvalidateMemoryLineageResult,
  type PromotePinnedIntelToKnowledgeMemoryInput,
  type PromotePinnedIntelToKnowledgeMemoryResult,
  type RecordRuntimeSurfaceRoleMemoryInput,
  type RecordRuntimeSurfaceRoleMemoryResult,
  type RecordRuntimeTaskUserResponseMemoryInput,
  type RecordRuntimeTaskUserResponseMemoryResult,
  type RecordRuntimeUserPreferenceMemoriesInput,
  type RecordRuntimeUserPreferenceMemoriesResult,
  type ReinforceMemoryLineageInput,
  type ReinforceMemoryLineageResult,
  type ReviewRuntimeMemoryLifecycleResult,
  type RollbackMemoryInvalidationResult,
} from "./mutations.js";
import { syncRuntimeMemoryMarkdownMirror } from "./memory-markdown-mirror.js";
import { appendRuntimeEvent, type RuntimeStoreOptions } from "./store.js";

export type RuntimeMemoryUpdateKind =
  | "task_outcome_review"
  | "user_model_update"
  | "surface_role_overlay_update"
  | "task_waiting_user_response"
  | "manual_pinned_intel"
  | "memory_lineage_reinforcement"
  | "memory_lifecycle_review"
  | "memory_lineage_invalidation"
  | "memory_invalidation_rollback";

export type RuntimeMemoryUpdateSummary = {
  kind: RuntimeMemoryUpdateKind;
  appliedAt: number;
  eventId?: string;
  memoryIds: string[];
  strategyIds: string[];
  metaLearningIds: string[];
  evolutionIds: string[];
};

export type ApplyRuntimeTaskOutcomeMemoryUpdateInput = DistillTaskOutcomeInput;

export type ApplyRuntimeTaskOutcomeMemoryUpdateResult = DistillTaskOutcomeResult &
  RuntimeMemoryUpdateSummary;

export type ApplyRuntimeUserControlMemoryUpdateInput =
  | ({
      kind: "user_model_update";
    } & RecordRuntimeUserPreferenceMemoriesInput)
  | ({
      kind: "surface_role_overlay_update";
    } & RecordRuntimeSurfaceRoleMemoryInput)
  | ({
      kind: "task_waiting_user_response";
    } & RecordRuntimeTaskUserResponseMemoryInput);

export type ApplyRuntimeUserControlMemoryUpdateResult =
  | (RecordRuntimeUserPreferenceMemoriesResult &
      RuntimeMemoryUpdateSummary & {
        kind: "user_model_update";
      })
  | (RecordRuntimeSurfaceRoleMemoryResult &
      RuntimeMemoryUpdateSummary & {
        kind: "surface_role_overlay_update";
        memories: MemoryRecord[];
      })
  | (RecordRuntimeTaskUserResponseMemoryResult &
      RuntimeMemoryUpdateSummary & {
        kind: "task_waiting_user_response";
        memories: MemoryRecord[];
      });

export type ApplyRuntimePinnedIntelKnowledgePromotionInput =
  PromotePinnedIntelToKnowledgeMemoryInput;

export type ApplyRuntimePinnedIntelKnowledgePromotionResult =
  PromotePinnedIntelToKnowledgeMemoryResult &
    RuntimeMemoryUpdateSummary & {
      pinnedRecord: ManualPinnedIntelRecord;
      memories: MemoryRecord[];
    };

export type ApplyRuntimeMemoryLineageReinforcementInput = ReinforceMemoryLineageInput;

export type ApplyRuntimeMemoryLineageReinforcementResult = ReinforceMemoryLineageResult &
  RuntimeMemoryUpdateSummary & {
    kind: "memory_lineage_reinforcement";
  };

export type ApplyRuntimeMemoryLifecycleReviewResult = ReviewRuntimeMemoryLifecycleResult &
  RuntimeMemoryUpdateSummary & {
    kind: "memory_lifecycle_review";
  };

export type ApplyRuntimeMemoryLineageInvalidationInput = InvalidateMemoryLineageInput;

export type ApplyRuntimeMemoryLineageInvalidationResult = InvalidateMemoryLineageResult &
  RuntimeMemoryUpdateSummary & {
    kind: "memory_lineage_invalidation";
  };

export type ApplyRuntimeMemoryInvalidationRollbackInput = {
  invalidationEventId: string;
  reason?: string;
  now?: number;
};

export type ApplyRuntimeMemoryInvalidationRollbackResult = RollbackMemoryInvalidationResult &
  RuntimeMemoryUpdateSummary & {
    kind: "memory_invalidation_rollback";
  };

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function collectMemoryIds(memories: MemoryRecord[]): string[] {
  return uniqueStrings(memories.map((entry) => entry.id));
}

function appendMemoryUpdateEvent(
  kind: RuntimeMemoryUpdateKind,
  payload: Record<string, unknown>,
  opts: RuntimeStoreOptions,
  now: number,
): string | undefined {
  const shouldWrite = ["memoryIds", "strategyIds", "metaLearningIds", "evolutionIds"].some(
    (field) => {
    const value = payload[field];
    return Array.isArray(value) && value.length > 0;
    },
  );
  if (!shouldWrite) {
    return undefined;
  }
  return appendRuntimeEvent(
    "runtime_memory_update_engine_applied",
    {
      kind,
      ...payload,
    },
    {
      ...opts,
      now,
    },
  ).id;
}

export function applyRuntimeTaskOutcomeMemoryUpdate(
  input: ApplyRuntimeTaskOutcomeMemoryUpdateInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeTaskOutcomeMemoryUpdateResult {
  const now = resolveNow(input.now ?? opts.now);
  const result = distillTaskOutcomeToMemory(
    {
      ...input,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const memoryIds = collectMemoryIds(result.memories);
  const strategyIds = uniqueStrings(result.strategies.map((entry) => entry.id));
  const metaLearningIds = uniqueStrings(result.metaLearning.map((entry) => entry.id));
  const eventId =
    memoryIds.length > 0 || strategyIds.length > 0 || metaLearningIds.length > 0
      ? appendMemoryUpdateEvent(
          "task_outcome_review",
          {
            taskId: input.task.id,
            reviewId: input.review?.id,
            memoryIds,
            strategyIds,
            metaLearningIds,
            evolutionIds: [],
          },
          opts,
          now,
        )
      : undefined;
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "task_outcome_review",
    appliedAt: now,
    eventId,
    memoryIds,
    strategyIds,
    metaLearningIds,
    evolutionIds: [],
  };
}

function summarizeUserModelChanges(previous: RuntimeUserModel, next: RuntimeUserModel): string[] {
  return uniqueStrings([
    previous.displayName !== next.displayName ? "display_name" : undefined,
    previous.communicationStyle !== next.communicationStyle ? "communication_style" : undefined,
    previous.interruptionThreshold !== next.interruptionThreshold
      ? "interruption_threshold"
      : undefined,
    previous.reportVerbosity !== next.reportVerbosity ? "report_verbosity" : undefined,
    previous.confirmationBoundary !== next.confirmationBoundary ? "confirmation_boundary" : undefined,
    previous.reportPolicy !== next.reportPolicy ? "report_policy" : undefined,
  ]);
}

export function applyRuntimeUserControlMemoryUpdate(
  input: ApplyRuntimeUserControlMemoryUpdateInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeUserControlMemoryUpdateResult {
  const now = resolveNow(input.now ?? opts.now);
  if (input.kind === "user_model_update") {
    const result = recordRuntimeUserPreferenceMemories(
      {
        previous: input.previous,
        next: input.next,
        now,
      },
      {
        ...opts,
        now,
      },
    );
    const memoryIds = collectMemoryIds(result.memories);
    const eventId =
      memoryIds.length > 0
        ? appendMemoryUpdateEvent(
            "user_model_update",
            {
              userModelId: input.next.id,
              changedFields: summarizeUserModelChanges(input.previous, input.next),
              memoryIds,
              strategyIds: [],
              metaLearningIds: [],
              evolutionIds: [],
            },
            opts,
            now,
          )
        : undefined;
    syncRuntimeMemoryMarkdownMirror({
      ...opts,
      now,
    });
    return {
      ...result,
      kind: "user_model_update",
      appliedAt: now,
      eventId,
      memoryIds,
      strategyIds: [],
      metaLearningIds: [],
      evolutionIds: [],
    };
  }

  if (input.kind === "task_waiting_user_response") {
    const result = recordRuntimeTaskUserResponseMemory(
      {
        task: input.task,
        response: input.response,
        respondedBy: input.respondedBy,
        now,
      },
      {
        ...opts,
        now,
      },
    );
    const memoryIds = [result.memory.id];
    const eventId = appendMemoryUpdateEvent(
      "task_waiting_user_response",
      {
        taskId: input.task.id,
        respondedBy: normalizeText(input.respondedBy) || "runtime-user",
        memoryIds,
        strategyIds: [],
        metaLearningIds: [],
        evolutionIds: [],
      },
      opts,
      now,
    );
    syncRuntimeMemoryMarkdownMirror({
      ...opts,
      now,
    });
    return {
      ...result,
      kind: "task_waiting_user_response",
      memories: [result.memory],
      appliedAt: now,
      eventId,
      memoryIds,
      strategyIds: [],
      metaLearningIds: [],
      evolutionIds: [],
    };
  }

  const result = recordRuntimeSurfaceRoleMemory(
    {
      surface: input.surface,
      overlay: input.overlay,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const memoryIds = [result.memory.id];
  const eventId = appendMemoryUpdateEvent(
    "surface_role_overlay_update",
    {
      surfaceId: input.surface.id,
      overlayId: input.overlay.id,
      ownerKind: input.surface.ownerKind,
      ownerId: input.surface.ownerId,
      memoryIds,
      strategyIds: [],
      metaLearningIds: [],
      evolutionIds: [],
    },
    opts,
    now,
  );
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "surface_role_overlay_update",
    memories: [result.memory],
    appliedAt: now,
    eventId,
    memoryIds,
    strategyIds: [],
    metaLearningIds: [],
    evolutionIds: [],
  };
}

export function applyRuntimePinnedIntelKnowledgePromotion(
  input: ApplyRuntimePinnedIntelKnowledgePromotionInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimePinnedIntelKnowledgePromotionResult {
  const now = resolveNow(input.now ?? opts.now);
  const result = promotePinnedIntelToKnowledgeMemory(
    {
      ...input,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const memoryIds = [result.memory.id];
  const eventId = appendMemoryUpdateEvent(
    "manual_pinned_intel",
    {
      intelId: input.intelId,
      promotedBy: input.promotedBy,
      pinnedRecordId: result.pinnedRecord.id,
      memoryIds,
      strategyIds: [],
      metaLearningIds: [],
      evolutionIds: [],
    },
    opts,
    now,
  );
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    memories: [result.memory],
    kind: "manual_pinned_intel",
    appliedAt: now,
    eventId,
    memoryIds,
    strategyIds: [],
    metaLearningIds: [],
    evolutionIds: [],
  };
}

export function applyRuntimeMemoryLineageReinforcement(
  input: ApplyRuntimeMemoryLineageReinforcementInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeMemoryLineageReinforcementResult {
  const now = resolveNow(input.now ?? opts.now);
  const result = reinforceMemoryLineage(
    {
      ...input,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const eventId =
    result.reinforcedMemoryIds.length > 0 ||
    result.strengthenedStrategyIds.length > 0 ||
    result.refreshedMetaLearningIds.length > 0 ||
    result.refreshedEvolutionIds.length > 0
      ? appendMemoryUpdateEvent(
          "memory_lineage_reinforcement",
          {
            reason: normalizeText(input.reason) || undefined,
            sourceTaskId: normalizeText(input.sourceTaskId) || undefined,
            sourceEventId: normalizeText(input.sourceEventId) || undefined,
            memoryIds: result.reinforcedMemoryIds,
            strategyIds: result.strengthenedStrategyIds,
            metaLearningIds: result.refreshedMetaLearningIds,
            evolutionIds: result.refreshedEvolutionIds,
          },
          opts,
          now,
        )
      : undefined;
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "memory_lineage_reinforcement",
    appliedAt: now,
    eventId,
    memoryIds: result.reinforcedMemoryIds,
    strategyIds: result.strengthenedStrategyIds,
    metaLearningIds: result.refreshedMetaLearningIds,
    evolutionIds: result.refreshedEvolutionIds,
  };
}

export function applyRuntimeMemoryLifecycleReview(
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeMemoryLifecycleReviewResult {
  const now = resolveNow(opts.now);
  const result = reviewRuntimeMemoryLifecycle({
    ...opts,
    now,
  });
  const eventId = appendMemoryUpdateEvent(
    "memory_lifecycle_review",
    {
      reviewedAt: result.reviewedAt,
      memoryIds: result.agedMemoryIds,
      strategyIds: result.weakenedStrategyIds,
      metaLearningIds: result.staleMetaLearningIds,
      evolutionIds: result.staleEvolutionIds,
    },
    opts,
    now,
  );
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "memory_lifecycle_review",
    appliedAt: now,
    eventId,
    memoryIds: result.agedMemoryIds,
    strategyIds: result.weakenedStrategyIds,
    metaLearningIds: result.staleMetaLearningIds,
    evolutionIds: result.staleEvolutionIds,
  };
}

export function applyRuntimeMemoryLineageInvalidation(
  input: ApplyRuntimeMemoryLineageInvalidationInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeMemoryLineageInvalidationResult {
  const now = resolveNow(input.now ?? opts.now);
  const result = invalidateMemoryLineage(
    {
      ...input,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const eventId = appendMemoryUpdateEvent(
    "memory_lineage_invalidation",
    {
      invalidationEventId: result.invalidationEventId,
      reasonEventId: normalizeText(input.reasonEventId) || undefined,
      requeuedTaskIds: result.requeuedTaskIds,
      memoryIds: result.invalidatedMemoryIds,
      strategyIds: result.invalidatedStrategyIds,
      metaLearningIds: result.invalidatedMetaLearningIds,
      evolutionIds: [],
    },
    opts,
    now,
  );
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "memory_lineage_invalidation",
    appliedAt: now,
    eventId,
    memoryIds: result.invalidatedMemoryIds,
    strategyIds: result.invalidatedStrategyIds,
    metaLearningIds: result.invalidatedMetaLearningIds,
    evolutionIds: [],
  };
}

export function applyRuntimeMemoryInvalidationRollback(
  input: ApplyRuntimeMemoryInvalidationRollbackInput,
  opts: RuntimeStoreOptions = {},
): ApplyRuntimeMemoryInvalidationRollbackResult {
  const now = resolveNow(input.now ?? opts.now);
  const result = rollbackMemoryInvalidation(
    {
      ...input,
      now,
    },
    {
      ...opts,
      now,
    },
  );
  const eventId = appendMemoryUpdateEvent(
    "memory_invalidation_rollback",
    {
      invalidationEventId: normalizeText(input.invalidationEventId),
      rollbackEventId: result.rollbackEventId,
      restoredTaskIds: result.restoredTaskIds,
      restoredEvolutionIds: result.restoredEvolutionIds,
      restoredShadowIds: result.restoredShadowIds,
      memoryIds: result.restoredMemoryIds,
      strategyIds: result.restoredStrategyIds,
      metaLearningIds: result.restoredMetaLearningIds,
      evolutionIds: result.restoredEvolutionIds,
    },
    opts,
    now,
  );
  syncRuntimeMemoryMarkdownMirror({
    ...opts,
    now,
  });
  return {
    ...result,
    kind: "memory_invalidation_rollback",
    appliedAt: now,
    eventId,
    memoryIds: result.restoredMemoryIds,
    strategyIds: result.restoredStrategyIds,
    metaLearningIds: result.restoredMetaLearningIds,
    evolutionIds: result.restoredEvolutionIds,
  };
}

export type RuntimeFormalMemoryWriteSet = {
  memories: MemoryRecord[];
  strategies: StrategyRecord[];
  metaLearning: MetaLearningRecord[];
};
