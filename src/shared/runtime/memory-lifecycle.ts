import type { RuntimeMetadata } from "./contracts.js";

export type RuntimeMemoryLifecycleControls = {
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  decayGraceDays: number;
  minDecayIncreasePerReview: number;
  agePressurePerDay: number;
  confidencePenaltyDivisor: number;
  linkedStrategyConfidencePenalty: number;
  highDecayThreshold: number;
};

export const DEFAULT_RUNTIME_MEMORY_LIFECYCLE_CONTROLS: RuntimeMemoryLifecycleControls = {
  enabled: true,
  reviewIntervalHours: 24,
  decayGraceDays: 2,
  minDecayIncreasePerReview: 1,
  agePressurePerDay: 2,
  confidencePenaltyDivisor: 3,
  linkedStrategyConfidencePenalty: 4,
  highDecayThreshold: 50,
};

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function resolveRuntimeMemoryLifecycleControls(
  metadata: RuntimeMetadata | undefined,
): RuntimeMemoryLifecycleControls {
  const record = toRecord(metadata);
  const fallback = DEFAULT_RUNTIME_MEMORY_LIFECYCLE_CONTROLS;
  const lastReviewAtRaw = Number(record?.lastReviewAt);
  return {
    enabled: record?.enabled !== false,
    reviewIntervalHours: normalizeInteger(
      record?.reviewIntervalHours,
      fallback.reviewIntervalHours,
      1,
      168,
    ),
    lastReviewAt:
      Number.isFinite(lastReviewAtRaw) && lastReviewAtRaw > 0
        ? Math.trunc(lastReviewAtRaw)
        : undefined,
    decayGraceDays: normalizeInteger(record?.decayGraceDays, fallback.decayGraceDays, 1, 90),
    minDecayIncreasePerReview: normalizeInteger(
      record?.minDecayIncreasePerReview,
      fallback.minDecayIncreasePerReview,
      1,
      25,
    ),
    agePressurePerDay: normalizeInteger(
      record?.agePressurePerDay,
      fallback.agePressurePerDay,
      1,
      25,
    ),
    confidencePenaltyDivisor: normalizeInteger(
      record?.confidencePenaltyDivisor,
      fallback.confidencePenaltyDivisor,
      1,
      20,
    ),
    linkedStrategyConfidencePenalty: normalizeInteger(
      record?.linkedStrategyConfidencePenalty,
      fallback.linkedStrategyConfidencePenalty,
      1,
      25,
    ),
    highDecayThreshold: normalizeInteger(
      record?.highDecayThreshold,
      fallback.highDecayThreshold,
      1,
      100,
    ),
  };
}
