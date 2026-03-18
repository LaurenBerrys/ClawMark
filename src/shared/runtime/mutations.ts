import type {
  DecisionRecord,
  EvolutionCandidateType,
  EvolutionMemoryRecord,
  IntelCandidate,
  IntelDigestItem,
  IntelUsefulnessRecord,
  ManualPinnedIntelRecord,
  MemoryRecord,
  MetaLearningRecord,
  RuntimeGovernanceStore,
  RuntimeIntelStore,
  RuntimeEvolutionObservationMetrics,
  RuntimeMemoryStore,
  RuntimeTaskStore,
  RuntimeUserModel,
  ShadowEvaluationRecord,
  SurfaceRecord,
  SurfaceRoleOverlay,
  StrategyRecord,
  TaskRecord,
  TaskReview,
  TaskRun,
  TaskStep,
  EvolutionOptimizationMetric,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  readRuntimeEventById,
  saveRuntimeStoreBundle,
  type RuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import { buildTaskLifecycleArtifacts, type TaskLifecycleArtifactsInput } from "./task-artifacts.js";
import { isTerminalTaskStatus } from "./task-loop.js";
import {
  buildRuntimeEvolutionAutoApplyStatus,
  buildRuntimeEvolutionRiskReview,
  buildRuntimeEvolutionVerificationReview,
  readRuntimeEvolutionObservationMetrics,
  readRuntimeEvolutionVerificationMetrics,
} from "./evolution-risk.js";
import { resolveRuntimeMemoryLifecycleControls } from "./memory-lifecycle.js";

const INTEL_USEFULNESS_RETENTION_DAYS = 90;
const INTEL_USEFULNESS_RETENTION_ITEMS = 800;

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
}

function truncateText(value: string, maxLength: number): string {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function clampPercent(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function writeLifecycleMetadata(
  metadata: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...metadata,
    lifecycle: {
      ...toRecord(metadata?.lifecycle),
      ...patch,
    },
  };
}

function readEvolutionLinkedMemoryIds(entry: EvolutionMemoryRecord): string[] {
  const metadata = toRecord(entry.metadata);
  return uniqueStrings([
    ...readStringArray(metadata?.derivedFromMemoryIds),
  ]);
}

function readEvolutionLinkedStrategyIds(entry: EvolutionMemoryRecord): string[] {
  const metadata = toRecord(entry.metadata);
  return uniqueStrings([
    normalizeText(entry.candidateRef),
    normalizeText(metadata?.materializedStrategyId),
    ...readStringArray(metadata?.sourceStrategyIds),
  ]);
}

type RuntimeTaskOptimizationState = {
  needsReplan?: boolean;
  lastReplannedAt?: number;
  invalidatedBy?: string[];
  invalidatedMemoryIds?: string[];
};

function nextVersion(existing?: { version: number } | null): number {
  return Math.max(1, Number(existing?.version ?? 0) + 1);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number, digits = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type RuntimeEvolutionObservationSample = {
  observedAt: number;
  success: boolean;
  completed: boolean;
  waitingUser: boolean;
  blocked: boolean;
  failed: boolean;
  completionScore: number;
  latencyMs: number;
  tokenEstimate: number;
  interruptionCount: number;
  remoteCallCount: number;
  regressionRiskScore: number;
};

type RuntimeEvolutionAdoptionState = EvolutionMemoryRecord["adoptionState"];
type RuntimeShadowEvaluationState = ShadowEvaluationRecord["state"];

function readTaskRuntimeRecord(task: TaskRecord): Record<string, unknown> {
  return toRecord(toRecord(task.metadata)?.runtimeTask) ?? {};
}

function readTaskRuntimeRunState(task: TaskRecord): Record<string, unknown> {
  return toRecord(readTaskRuntimeRecord(task).runState) ?? {};
}

function mergeEvolutionAdoptionState(
  existing: RuntimeEvolutionAdoptionState,
  incoming: RuntimeEvolutionAdoptionState,
): RuntimeEvolutionAdoptionState {
  const rank = {
    shadow: 0,
    candidate: 1,
    adopted: 2,
  } satisfies Record<RuntimeEvolutionAdoptionState, number>;
  return rank[existing] >= rank[incoming] ? existing : incoming;
}

function mergeShadowEvaluationState(
  existing: RuntimeShadowEvaluationState,
  incoming: RuntimeShadowEvaluationState,
): RuntimeShadowEvaluationState {
  const rank = {
    observed: 0,
    shadow: 1,
    promoted: 2,
    adopted: 3,
    reverted: 4,
  } satisfies Record<RuntimeShadowEvaluationState, number>;
  return rank[existing] >= rank[incoming] ? existing : incoming;
}

function buildEvolutionObservationTokenEstimate(params: {
  lane: "system1" | "system2";
  remoteCallCount: number;
  skillCount: number;
  completionScore: number;
}): number {
  const remoteBase = params.lane === "system2" ? 2200 : 1200;
  return Math.max(
    300,
    Math.round(
      Math.max(1, params.remoteCallCount) * remoteBase +
        Math.max(0, params.skillCount) * 140 +
        Math.max(0, Math.round(params.completionScore * 8)),
    ),
  );
}

function buildEvolutionObservationSample(input: {
  task: TaskRecord;
  review?: TaskReview | null;
  run?: TaskRun | null;
  lane: "system1" | "system2";
  completionScore: number;
  now: number;
}): RuntimeEvolutionObservationSample {
  const runtimeRunState = readTaskRuntimeRunState(input.task);
  const taskStatus = input.task.status;
  const reviewOutcome = normalizeText(input.review?.outcome);
  const run = input.run ?? null;
  const runRemoteCallCount = toRecord(run?.metadata)?.remoteCallCount;
  const remoteCallCount = Math.max(
    0,
    Math.round(
      typeof runRemoteCallCount === "number" && Number.isFinite(runRemoteCallCount)
        ? runRemoteCallCount
        : toNumber(runtimeRunState.remoteCallCount, 0),
    ),
  );
  const latencyMs = Math.max(
    0,
    Math.round(
      run?.startedAt
        ? Math.max(
            0,
            (run?.completedAt ?? run?.updatedAt ?? input.now) - Math.max(0, run.startedAt),
          )
        : Math.max(0, (input.task.updatedAt ?? input.now) - (input.task.createdAt ?? input.now)),
    ),
  );
  const interruptionCount = Math.max(
    taskStatus === "waiting_user" ? 1 : 0,
    Math.round(toNumber(runtimeRunState.userResponseCount, 0)),
  );
  const success =
    reviewOutcome === "success" ||
    (taskStatus === "completed" && reviewOutcome !== "failed" && reviewOutcome !== "cancelled");
  const completed = taskStatus === "completed";
  const waitingUser = taskStatus === "waiting_user";
  const blocked = taskStatus === "blocked" || reviewOutcome === "blocked";
  const failed = reviewOutcome === "failed" || taskStatus === "cancelled";
  let regressionRiskScore = 0.08;
  if (input.lane === "system2") {
    regressionRiskScore += 0.08;
  }
  if (!success) {
    regressionRiskScore += 0.18;
  }
  if (waitingUser) {
    regressionRiskScore += 0.16;
  }
  if (blocked) {
    regressionRiskScore += 0.22;
  }
  if (failed) {
    regressionRiskScore += 0.32;
  }
  if (input.completionScore < 80) {
    regressionRiskScore += Math.min(0.18, (80 - input.completionScore) / 160);
  }
  if (remoteCallCount > 2) {
    regressionRiskScore += Math.min(0.12, (remoteCallCount - 2) * 0.04);
  }
  if (interruptionCount > 0) {
    regressionRiskScore += Math.min(0.18, interruptionCount * 0.08);
  }
  return {
    observedAt: input.now,
    success,
    completed,
    waitingUser,
    blocked,
    failed,
    completionScore: roundMetric(input.completionScore),
    latencyMs,
    tokenEstimate: buildEvolutionObservationTokenEstimate({
      lane: input.lane,
      remoteCallCount,
      skillCount: input.task.skillIds.length,
      completionScore: input.completionScore,
    }),
    interruptionCount,
    remoteCallCount,
    regressionRiskScore: roundMetric(Math.max(0, Math.min(1, regressionRiskScore))),
  };
}

function mergeEvolutionObservationMetrics(
  previous: RuntimeEvolutionObservationMetrics | undefined,
  sample: RuntimeEvolutionObservationSample,
): RuntimeEvolutionObservationMetrics {
  const observationCount = (previous?.observationCount ?? 0) + 1;
  const sum = (average: number | undefined, count: number, next: number) =>
    (average ?? 0) * count + next;
  const previousCount = previous?.observationCount ?? 0;
  const successCount = (previous?.successCount ?? 0) + (sample.success ? 1 : 0);
  const completionCount = (previous?.completionCount ?? 0) + (sample.completed ? 1 : 0);
  const waitingUserCount = (previous?.waitingUserCount ?? 0) + (sample.waitingUser ? 1 : 0);
  const blockedCount = (previous?.blockedCount ?? 0) + (sample.blocked ? 1 : 0);
  const failedCount = (previous?.failedCount ?? 0) + (sample.failed ? 1 : 0);
  return {
    observationCount,
    successCount,
    completionCount,
    waitingUserCount,
    blockedCount,
    failedCount,
    averageCompletionScore: roundMetric(
      sum(previous?.averageCompletionScore, previousCount, sample.completionScore) / observationCount,
    ),
    averageLatencyMs: roundMetric(
      sum(previous?.averageLatencyMs, previousCount, sample.latencyMs) / observationCount,
      0,
    ),
    averageTokenEstimate: roundMetric(
      sum(previous?.averageTokenEstimate, previousCount, sample.tokenEstimate) / observationCount,
      0,
    ),
    averageInterruptionCount: roundMetric(
      sum(previous?.averageInterruptionCount, previousCount, sample.interruptionCount) /
        observationCount,
    ),
    averageRemoteCallCount: roundMetric(
      sum(previous?.averageRemoteCallCount, previousCount, sample.remoteCallCount) / observationCount,
    ),
    successRate: roundMetric(successCount / observationCount),
    regressionRiskScore: roundMetric(
      sum(previous?.regressionRiskScore, previousCount, sample.regressionRiskScore) /
        observationCount,
    ),
    lastObservedAt: sample.observedAt,
  };
}

function formatEvolutionObservationMeasuredEffect(
  metrics: RuntimeEvolutionObservationMetrics,
): string {
  return [
    `success=${Math.round(metrics.successRate * 100)}%`,
    `completion=${Math.round(metrics.averageCompletionScore)}`,
    `latency=${Math.round(metrics.averageLatencyMs / 1000)}s`,
    `tokens≈${Math.round(metrics.averageTokenEstimate)}`,
    `interruptions=${roundMetric(metrics.averageInterruptionCount)}`,
    `risk=${Math.round(metrics.regressionRiskScore * 100)}%`,
  ].join(" · ");
}

function readTaskOptimizationState(task: TaskRecord): RuntimeTaskOptimizationState {
  const metadata = toRecord(task.metadata);
  const runtimeTask = toRecord(metadata?.runtimeTask);
  const optimizationState = toRecord(runtimeTask?.optimizationState);
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
  };
}

function writeTaskOptimizationState(
  task: TaskRecord,
  patch: Partial<RuntimeTaskOptimizationState>,
): Record<string, unknown> {
  const metadata = toRecord(task.metadata) ?? {};
  const runtimeTask = toRecord(metadata.runtimeTask) ?? {};
  const optimizationState = readTaskOptimizationState(task);
  return {
    ...metadata,
    runtimeTask: {
      ...runtimeTask,
      optimizationState: {
        ...optimizationState,
        ...patch,
      },
    },
  };
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

type RuntimeObservedEvolutionCandidateSpec = {
  candidateId: string;
  evaluationId: string;
  candidateType: EvolutionCandidateType;
  targetLayer: EvolutionMemoryRecord["targetLayer"];
  summary: string;
  baselineRef: string;
  candidateRef: string;
  expectedEffect: string;
  optimizedMetrics?: EvolutionOptimizationMetric[];
  metadata?: Record<string, unknown>;
};

function observeRuntimeEvolutionCandidate(params: {
  stores: RuntimeStoreBundle;
  task: TaskRecord;
  review?: TaskReview | null;
  spec: RuntimeObservedEvolutionCandidateSpec;
  completionScore: number;
  observationSample: RuntimeEvolutionObservationSample;
  now: number;
}): {
  evolutionRecord: EvolutionMemoryRecord;
  shadowEvaluation: ShadowEvaluationRecord;
  metrics: RuntimeEvolutionObservationMetrics;
} {
  const previousEvaluation = params.stores.governanceStore.shadowEvaluations.find(
    (entry) => entry.id === params.spec.evaluationId,
  );
  const observationMetrics = mergeEvolutionObservationMetrics(
    readRuntimeEvolutionObservationMetrics(previousEvaluation?.metadata),
    params.observationSample,
  );
  const shadowEvaluation = upsertShadowEvaluation(params.stores.governanceStore, {
    id: params.spec.evaluationId,
    candidateType: params.spec.candidateType,
    targetLayer: params.spec.targetLayer,
    state: "shadow",
    baselineRef: params.spec.baselineRef,
    candidateRef: params.spec.candidateId,
    expectedEffect: params.spec.expectedEffect,
    measuredEffect: formatEvolutionObservationMeasuredEffect(observationMetrics),
    observationCount: observationMetrics.observationCount,
    confidence: 60,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [],
    sourceTaskIds: [params.task.id],
    sourceReviewIds: params.review?.id ? [params.review.id] : [],
    sourceSessionIds: params.task.sessionId ? [params.task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    targetMetrics: params.spec.optimizedMetrics,
    updatedAt: params.now,
    metadata: {
      ...toRecord(previousEvaluation?.metadata),
      ...toRecord(params.spec.metadata),
      taskId: params.task.id,
      status: params.task.status,
      observationMetrics,
    },
  });
  const previousEvolution = params.stores.memoryStore.evolutionMemory.find(
    (entry) => entry.id === params.spec.candidateId,
  );
  const previousEvolutionMetadata = toRecord(previousEvolution?.metadata);
  const specMetadata = toRecord(params.spec.metadata);
  const evolutionRecord = upsertEvolutionMemory(
    params.stores.memoryStore,
    attachEvolutionRiskReview({
      id: params.spec.candidateId,
      layer: "evolution_memory",
      candidateType: params.spec.candidateType,
      targetLayer: params.spec.targetLayer,
      summary: params.spec.summary,
      adoptionState: "shadow",
      baselineRef: params.spec.baselineRef,
      candidateRef: params.spec.candidateRef,
      confidence: 50,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: [params.task.id],
      sourceReviewIds: params.review?.id ? [params.review.id] : [],
      sourceSessionIds: params.task.sessionId ? [params.task.sessionId] : [],
      sourceIntelIds: [],
      derivedFromMemoryIds: params.task.memoryRefs ?? [],
      sourceShadowTelemetryIds: [shadowEvaluation.id],
      createdAt: params.now,
      updatedAt: params.now,
      optimizedMetrics: params.spec.optimizedMetrics,
      metadata: {
        ...previousEvolutionMetadata,
        ...specMetadata,
        completionScore: params.completionScore,
        observationMetrics,
      },
    }),
  );
  if (evolutionRecord.adoptionState === "adopted") {
    attachEvolutionVerificationReview({
      entry: evolutionRecord,
      now: params.now,
      sample: params.observationSample,
    });
  }
  shadowEvaluation.metadata = {
    ...toRecord(shadowEvaluation.metadata),
    verificationMetrics:
      evolutionRecord.adoptionState === "adopted"
        ? readRuntimeEvolutionVerificationMetrics(evolutionRecord.metadata)
        : undefined,
    verificationReview:
      evolutionRecord.adoptionState === "adopted"
        ? buildRuntimeEvolutionVerificationReview({
            candidate: evolutionRecord,
            metrics: readRuntimeEvolutionVerificationMetrics(evolutionRecord.metadata),
          })
        : undefined,
  };
  return {
    evolutionRecord,
    shadowEvaluation,
    metrics: observationMetrics,
  };
}

function upsertById<T extends { id: string }>(entries: T[], next: T): T {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    entries.unshift(next);
    return next;
  }
  entries[index] = next;
  return next;
}

function resolveRuntimeEvolutionControls(
  governanceStore: RuntimeGovernanceStore,
): {
  enabled: boolean;
  autoApplyLowRisk: boolean;
  autoCanaryEvolution: boolean;
  reviewIntervalHours: number;
} {
  const metadata = toRecord(governanceStore.metadata);
  const reviewIntervalHoursRaw = Number(metadata?.reviewIntervalHours);
  return {
    enabled: metadata?.enabled !== false,
    autoApplyLowRisk: metadata?.autoApplyLowRisk === true,
    autoCanaryEvolution: metadata?.autoCanaryEvolution === true,
    reviewIntervalHours:
      Number.isFinite(reviewIntervalHoursRaw) && reviewIntervalHoursRaw > 0
        ? Math.trunc(reviewIntervalHoursRaw)
        : 12,
  };
}

function persistStores(
  stores: RuntimeStoreBundle,
  opts: RuntimeStoreOptions = {},
): RuntimeStoreBundle {
  return saveRuntimeStoreBundle(stores, opts);
}

function buildTaskSummary(task: TaskRecord, review?: TaskReview | null): string {
  return truncateText(
    review?.summary ||
      task.lastError ||
      task.blockedReason ||
      task.nextAction ||
      task.planSummary ||
      task.goal ||
      task.title,
    220,
  );
}

function buildTaskTags(task: TaskRecord): string[] {
  return uniqueStrings([...(task.tags ?? []), ...task.skillIds, task.route, task.worker]);
}

function upsertMemory(store: RuntimeMemoryStore, entry: MemoryRecord): MemoryRecord {
  const existing = store.memories.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.memories.unshift(entry);
    return entry;
  }
  const merged: MemoryRecord = {
    ...existing,
    ...entry,
    tags: uniqueStrings([...(existing.tags ?? []), ...(entry.tags ?? [])]),
    confidence: Math.max(existing.confidence, entry.confidence),
    version: Math.max(existing.version, entry.version),
    invalidatedBy: uniqueStrings([
      ...(existing.invalidatedBy ?? []),
      ...(entry.invalidatedBy ?? []),
    ]),
    sourceEventIds: uniqueStrings([
      ...(existing.sourceEventIds ?? []),
      ...(entry.sourceEventIds ?? []),
    ]),
    sourceTaskIds: uniqueStrings([
      ...(existing.sourceTaskIds ?? []),
      ...(entry.sourceTaskIds ?? []),
    ]),
    sourceIntelIds: uniqueStrings([
      ...(existing.sourceIntelIds ?? []),
      ...(entry.sourceIntelIds ?? []),
    ]),
    sourceReviewIds: uniqueStrings([
      ...(existing.sourceReviewIds ?? []),
      ...(entry.sourceReviewIds ?? []),
    ]),
    sourceSessionIds: uniqueStrings([
      ...(existing.sourceSessionIds ?? []),
      ...(entry.sourceSessionIds ?? []),
    ]),
    derivedFromMemoryIds: uniqueStrings([
      ...(existing.derivedFromMemoryIds ?? []),
      ...(entry.derivedFromMemoryIds ?? []),
    ]),
    lastReinforcedAt:
      Math.max(existing.lastReinforcedAt ?? 0, entry.lastReinforcedAt ?? 0) || undefined,
    decayScore:
      existing.decayScore == null
        ? entry.decayScore
        : entry.decayScore == null
          ? existing.decayScore
          : Math.min(existing.decayScore, entry.decayScore),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
  };
  return upsertById(store.memories, merged);
}

function upsertStrategy(store: RuntimeMemoryStore, entry: StrategyRecord): StrategyRecord {
  const existing = store.strategies.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.strategies.unshift(entry);
    return entry;
  }
  const merged: StrategyRecord = {
    ...existing,
    ...entry,
    skillIds: uniqueStrings([...(existing.skillIds ?? []), ...(entry.skillIds ?? [])]),
    confidence: Math.max(existing.confidence, entry.confidence),
    version: Math.max(existing.version, entry.version),
    invalidatedBy: uniqueStrings([
      ...(existing.invalidatedBy ?? []),
      ...(entry.invalidatedBy ?? []),
    ]),
    sourceEventIds: uniqueStrings([
      ...(existing.sourceEventIds ?? []),
      ...(entry.sourceEventIds ?? []),
    ]),
    sourceTaskIds: uniqueStrings([
      ...(existing.sourceTaskIds ?? []),
      ...(entry.sourceTaskIds ?? []),
    ]),
    sourceReviewIds: uniqueStrings([
      ...(existing.sourceReviewIds ?? []),
      ...(entry.sourceReviewIds ?? []),
    ]),
    sourceSessionIds: uniqueStrings([
      ...(existing.sourceSessionIds ?? []),
      ...(entry.sourceSessionIds ?? []),
    ]),
    sourceIntelIds: uniqueStrings([
      ...(existing.sourceIntelIds ?? []),
      ...(entry.sourceIntelIds ?? []),
    ]),
    derivedFromMemoryIds: uniqueStrings([
      ...(existing.derivedFromMemoryIds ?? []),
      ...(entry.derivedFromMemoryIds ?? []),
    ]),
    measuredEffect: {
      ...existing.measuredEffect,
      ...entry.measuredEffect,
    },
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
  };
  return upsertById(store.strategies, merged);
}

function upsertMetaLearning(
  store: RuntimeMemoryStore,
  entry: MetaLearningRecord,
): MetaLearningRecord {
  const existing = store.metaLearning.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.metaLearning.unshift(entry);
    return entry;
  }
  const merged: MetaLearningRecord = {
    ...existing,
    ...entry,
    sourceTaskIds: uniqueStrings([
      ...(existing.sourceTaskIds ?? []),
      ...(entry.sourceTaskIds ?? []),
    ]),
    sourceReviewIds: uniqueStrings([
      ...(existing.sourceReviewIds ?? []),
      ...(entry.sourceReviewIds ?? []),
    ]),
    sourceSessionIds: uniqueStrings([
      ...(existing.sourceSessionIds ?? []),
      ...(entry.sourceSessionIds ?? []),
    ]),
    sourceIntelIds: uniqueStrings([
      ...(existing.sourceIntelIds ?? []),
      ...(entry.sourceIntelIds ?? []),
    ]),
    derivedFromMemoryIds: uniqueStrings([
      ...(existing.derivedFromMemoryIds ?? []),
      ...(entry.derivedFromMemoryIds ?? []),
    ]),
    confidence: Math.max(existing.confidence ?? 0, entry.confidence ?? 0),
    version: Math.max(existing.version ?? 0, entry.version ?? 0),
    invalidatedBy: uniqueStrings([
      ...(existing.invalidatedBy ?? []),
      ...(entry.invalidatedBy ?? []),
    ]),
    sourceEventIds: uniqueStrings([
      ...(existing.sourceEventIds ?? []),
      ...(entry.sourceEventIds ?? []),
    ]),
    lastReinforcedAt:
      Math.max(existing.lastReinforcedAt ?? 0, entry.lastReinforcedAt ?? 0) || undefined,
    decayScore:
      existing.decayScore == null
        ? entry.decayScore
        : entry.decayScore == null
          ? existing.decayScore
          : Math.min(existing.decayScore, entry.decayScore),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    metadata: {
      ...toRecord(existing.metadata),
      ...toRecord(entry.metadata),
    },
  };
  return upsertById(store.metaLearning, merged);
}

function upsertEvolutionMemory(
  store: RuntimeMemoryStore,
  entry: EvolutionMemoryRecord,
): EvolutionMemoryRecord {
  const existing = store.evolutionMemory.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.evolutionMemory.unshift(entry);
    return entry;
  }
  const merged: EvolutionMemoryRecord = {
    ...existing,
    ...entry,
    sourceTaskIds: uniqueStrings([
      ...(existing.sourceTaskIds ?? []),
      ...(entry.sourceTaskIds ?? []),
    ]),
    sourceReviewIds: uniqueStrings([
      ...(existing.sourceReviewIds ?? []),
      ...(entry.sourceReviewIds ?? []),
    ]),
    sourceSessionIds: uniqueStrings([
      ...(existing.sourceSessionIds ?? []),
      ...(entry.sourceSessionIds ?? []),
    ]),
    sourceIntelIds: uniqueStrings([
      ...(existing.sourceIntelIds ?? []),
      ...(entry.sourceIntelIds ?? []),
    ]),
    derivedFromMemoryIds: uniqueStrings([
      ...(existing.derivedFromMemoryIds ?? []),
      ...(entry.derivedFromMemoryIds ?? []),
    ]),
    sourceShadowTelemetryIds: uniqueStrings([
      ...(existing.sourceShadowTelemetryIds ?? []),
      ...(entry.sourceShadowTelemetryIds ?? []),
    ]),
    confidence: Math.max(existing.confidence ?? 0, entry.confidence ?? 0),
    version: Math.max(existing.version ?? 0, entry.version ?? 0),
    invalidatedBy: uniqueStrings([
      ...(existing.invalidatedBy ?? []),
      ...(entry.invalidatedBy ?? []),
    ]),
    sourceEventIds: uniqueStrings([
      ...(existing.sourceEventIds ?? []),
      ...(entry.sourceEventIds ?? []),
    ]),
    lastReinforcedAt:
      Math.max(existing.lastReinforcedAt ?? 0, entry.lastReinforcedAt ?? 0) || undefined,
    decayScore:
      existing.decayScore == null
        ? entry.decayScore
        : entry.decayScore == null
          ? existing.decayScore
          : Math.min(existing.decayScore, entry.decayScore),
    adoptionState: mergeEvolutionAdoptionState(existing.adoptionState, entry.adoptionState),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    metadata: {
      ...toRecord(existing.metadata),
      ...toRecord(entry.metadata),
    },
  };
  return upsertById(store.evolutionMemory, merged);
}

function attachEvolutionRiskReview(entry: EvolutionMemoryRecord): EvolutionMemoryRecord {
  const riskReview = buildRuntimeEvolutionRiskReview(entry);
  entry.metadata = {
    ...toRecord(entry.metadata),
    riskReview,
  };
  return entry;
}

function attachEvolutionVerificationReview(params: {
  entry: EvolutionMemoryRecord;
  now: number;
  sample?: RuntimeEvolutionObservationSample;
  reset?: boolean;
  clear?: boolean;
}): EvolutionMemoryRecord {
  const metadata = toRecord(params.entry.metadata);
  let verificationMetrics = params.reset
    ? undefined
    : readRuntimeEvolutionVerificationMetrics(metadata);
  if (params.sample) {
    verificationMetrics = mergeEvolutionObservationMetrics(verificationMetrics, params.sample);
  }
  const verificationReview = params.clear
    ? undefined
    : buildRuntimeEvolutionVerificationReview({
        candidate: params.entry,
        metrics: verificationMetrics,
      });
  params.entry.metadata = {
    ...metadata,
    verificationMetrics: params.clear ? undefined : verificationMetrics,
    verificationStatus: verificationReview?.state,
    verificationSummary: verificationReview?.summary,
    verificationSignals: verificationReview ? [...verificationReview.signals] : undefined,
    lastVerifiedAt:
      verificationReview && verificationReview.state !== "pending" ? params.now : undefined,
    revertRecommendedAt:
      verificationReview?.revertRecommended === true ? params.now : undefined,
    revertRecommendedReason:
      verificationReview?.revertRecommended === true
        ? verificationReview.signals[0] || verificationReview.summary
        : undefined,
  };
  return params.entry;
}

function upsertShadowEvaluation(
  store: RuntimeGovernanceStore,
  entry: ShadowEvaluationRecord,
): ShadowEvaluationRecord {
  const existing = store.shadowEvaluations.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.shadowEvaluations.unshift(entry);
    return entry;
  }
  const merged: ShadowEvaluationRecord = {
    ...existing,
    ...entry,
    state: mergeShadowEvaluationState(existing.state, entry.state),
    observationCount: Math.max(existing.observationCount, entry.observationCount),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    metadata: {
      ...(existing.metadata as Record<string, unknown>),
      ...(entry.metadata as Record<string, unknown>),
    },
  };
  return upsertById(store.shadowEvaluations, merged);
}

function findMemory(
  store: RuntimeMemoryStore,
  memoryId: string,
): MemoryRecord | undefined {
  return store.memories.find((entry) => entry.id === memoryId);
}

function findStrategy(
  store: RuntimeMemoryStore,
  strategyId: string,
): StrategyRecord | undefined {
  return store.strategies.find((entry) => entry.id === strategyId);
}

function findMetaLearning(
  store: RuntimeMemoryStore,
  learningId: string,
): MetaLearningRecord | undefined {
  return store.metaLearning.find((entry) => entry.id === learningId);
}


function restoreMemorySnapshot(
  store: RuntimeMemoryStore,
  snapshot: MemoryRecord,
  now: number,
  reason: string,
): MemoryRecord {
  const current = findMemory(store, snapshot.id);
  return upsertById(store.memories, {
    ...cloneValue(snapshot),
    version: Math.max(current?.version ?? snapshot.version, snapshot.version) + 1,
    updatedAt: now,
    metadata: {
      ...toRecord(snapshot.metadata),
      rollback: {
        reason,
        restoredAt: now,
      },
    },
  });
}

function restoreStrategySnapshot(
  store: RuntimeMemoryStore,
  snapshot: StrategyRecord,
  now: number,
  reason: string,
): StrategyRecord {
  const current = findStrategy(store, snapshot.id);
  return upsertById(store.strategies, {
    ...cloneValue(snapshot),
    version: Math.max(current?.version ?? snapshot.version, snapshot.version) + 1,
    updatedAt: now,
    metadata: {
      ...toRecord(snapshot.metadata),
      rollback: {
        reason,
        restoredAt: now,
      },
    },
  });
}

function restoreMetaLearningSnapshot(
  store: RuntimeMemoryStore,
  snapshot: MetaLearningRecord,
  now: number,
  reason: string,
): MetaLearningRecord {
  const current = findMetaLearning(store, snapshot.id);
  return upsertMetaLearning(store, {
    ...cloneValue(snapshot),
    updatedAt: now,
    metadata: {
      ...toRecord(current?.metadata),
      ...toRecord(snapshot.metadata),
      rollback: {
        reason,
        restoredAt: now,
      },
    },
  });
}

function upsertPinnedIntelRecord(
  store: RuntimeIntelStore,
  record: ManualPinnedIntelRecord,
): ManualPinnedIntelRecord {
  const existing = store.pinnedRecords.find((entry) => entry.id === record.id);
  if (!existing) {
    store.pinnedRecords.unshift(record);
    return record;
  }
  const merged: ManualPinnedIntelRecord = {
    ...existing,
    ...record,
    createdAt: Math.max(existing.createdAt, record.createdAt),
    metadata: {
      ...toRecord(existing.metadata),
      ...toRecord(record.metadata),
    },
  };
  return upsertById(store.pinnedRecords, merged);
}

function pruneIntelUsefulnessRecords(
  records: IntelUsefulnessRecord[],
  now: number,
): IntelUsefulnessRecord[] {
  const retentionMs = INTEL_USEFULNESS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return records
    .filter((entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt <= retentionMs)
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, INTEL_USEFULNESS_RETENTION_ITEMS);
}

function appendIntelUsefulnessRecords(
  store: RuntimeIntelStore,
  input: {
    intelId: string;
    sourceIds: string[];
    domain: RuntimeIntelStore["candidates"][number]["domain"];
    usefulnessScore: number;
    reason: string;
    now: number;
    metadata?: Record<string, unknown>;
  },
): IntelUsefulnessRecord[] {
  const sourceIds = uniqueStrings(input.sourceIds);
  const created: IntelUsefulnessRecord[] = [];
  for (const sourceId of sourceIds) {
    const record: IntelUsefulnessRecord = {
      id: buildStableId("intel_usefulness", [
        input.intelId,
        sourceId,
        input.reason,
        input.now,
      ]),
      intelId: input.intelId,
      sourceId,
      domain: input.domain,
      usefulnessScore: clampPercent(input.usefulnessScore, 0),
      reason: input.reason,
      createdAt: input.now,
      metadata: input.metadata,
    };
    store.usefulnessRecords.unshift(record);
    created.push(record);
  }
  store.usefulnessRecords = pruneIntelUsefulnessRecords(store.usefulnessRecords, input.now);
  return created;
}

function readIntelSnapshot(
  store: RuntimeIntelStore,
  intelId: string,
):
  | {
      kind: "candidate";
      candidate: IntelCandidate;
    }
  | {
      kind: "digest";
      digest: IntelDigestItem;
    }
  | undefined {
  const candidate = store.candidates.find((entry) => entry.id === intelId);
  if (candidate) {
    return {
      kind: "candidate",
      candidate,
    };
  }
  const digest = store.digestItems.find((entry) => entry.id === intelId);
  if (digest) {
    return {
      kind: "digest",
      digest,
    };
  }
  return undefined;
}

export type PersistedTaskLifecycleResult = {
  taskStore: RuntimeTaskStore;
  task: TaskRecord;
  run: TaskRun;
  step?: TaskStep;
  review?: TaskReview;
};

export function persistTaskLifecycleArtifacts(
  input: TaskLifecycleArtifactsInput,
  opts: RuntimeStoreOptions = {},
): PersistedTaskLifecycleResult {
  const now = resolveNow(input.now ?? opts.now);
  const artifacts = buildTaskLifecycleArtifacts({
    ...input,
    now,
  });
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  upsertById(stores.taskStore.tasks, artifacts.taskRecord);
  upsertById(stores.taskStore.runs, artifacts.taskRun);
  if (artifacts.taskStep) {
    upsertById(stores.taskStore.steps, artifacts.taskStep);
  }
  if (artifacts.taskReview) {
    upsertById(stores.taskStore.reviews, artifacts.taskReview);
  }
  const saved = persistStores(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "task_lifecycle_persisted",
    {
      taskId: artifacts.taskRecord.id,
      runId: artifacts.taskRun.id,
      reviewId: artifacts.taskReview?.id,
      status: artifacts.taskRecord.status,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    taskStore: saved.taskStore,
    task: artifacts.taskRecord,
    run: artifacts.taskRun,
    step: artifacts.taskStep,
    review: artifacts.taskReview,
  };
}

export type DistillTaskOutcomeInput = {
  task: TaskRecord;
  review?: TaskReview | null;
  decision?: DecisionRecord | null;
  now?: number;
};

export type DistillTaskOutcomeResult = {
  memories: MemoryRecord[];
  strategies: StrategyRecord[];
  metaLearning: MetaLearningRecord[];
};

export function distillTaskOutcomeToMemory(
  input: DistillTaskOutcomeInput,
  opts: RuntimeStoreOptions = {},
): DistillTaskOutcomeResult {
  const now = resolveNow(input.now ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const task = input.task;
  const review = input.review ?? null;
  const summary = buildTaskSummary(task, review);
  if (
    !summary ||
    (task.status !== "completed" && task.status !== "blocked" && task.status !== "waiting_user")
  ) {
    return { memories: [], strategies: [], metaLearning: [] };
  }

  const tags = buildTaskTags(task);
  const success = task.status === "completed";
  const decisionMemoryIds = input.decision?.relevantMemoryIds ?? [];
  const upstreamMemoryIds = uniqueStrings([...(task.memoryRefs ?? []), ...decisionMemoryIds]);
  const distillEvent = appendRuntimeEvent(
    "task_outcome_distilling",
    {
      taskId: task.id,
      reviewId: review?.id,
      status: task.status,
      upstreamMemoryIds,
    },
    {
      ...opts,
      now,
    },
  );
  const baseMemoryId = buildStableId(success ? "execution_memory" : "avoidance_memory", [
    task.route,
    summary,
  ]);
  const efficiencyMemoryId = buildStableId("efficiency_memory", [
    task.route,
    task.worker,
    task.skillIds.join("|"),
    task.status,
  ]);
  const completionMemoryId = buildStableId("completion_memory", [task.route, task.title, summary]);
  const resourceMemoryId = buildStableId("resource_memory", [
    task.route,
    task.worker,
    task.skillIds.join("|"),
    (task.artifactRefs ?? []).join("|"),
  ]);

  const reinforcedMemoryIds: string[] = [];
  for (const memoryId of upstreamMemoryIds) {
    const memory = findMemory(stores.memoryStore, memoryId);
    if (!memory || memory.invalidatedBy.length > 0) {
      continue;
    }
    const reinforcement = toRecord(toRecord(memory.metadata)?.reinforcement);
    memory.version = nextVersion(memory);
    memory.lastReinforcedAt = now;
    memory.decayScore = Math.max(0, (memory.decayScore ?? 18) - 18);
    memory.confidence = clampPercent(Math.max(memory.confidence, 40) + 4, memory.confidence);
    memory.updatedAt = now;
    memory.metadata = {
      ...toRecord(memory.metadata),
      reinforcement: {
        lastTaskId: task.id,
        lastReviewId: review?.id,
        count: Number(reinforcement?.count ?? 0) + 1,
      },
    };
    reinforcedMemoryIds.push(memory.id);
  }

  const executionMemory = upsertMemory(stores.memoryStore, {
    id: baseMemoryId,
    layer: "memories",
    memoryType: success ? "execution" : "avoidance",
    route: task.route,
    scope: "task-loop",
    summary: success
      ? `在 ${task.route} 路径下已验证有效做法：${summary}`
      : `在 ${task.route} 路径下需要规避的阻塞模式：${summary}`,
    appliesWhen: truncateText(task.goal || task.title, 180) || undefined,
    avoidWhen: success
      ? undefined
      : truncateText(task.lastError || task.blockedReason || summary, 180) || undefined,
    tags,
    confidence: success ? 82 : task.status === "waiting_user" ? 58 : 64,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [distillEvent.id],
    sourceTaskIds: [task.id],
    sourceReviewIds: review?.id ? [review.id] : [],
    sourceSessionIds: task.sessionId ? [task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: uniqueStrings([...(task.memoryRefs ?? []), ...decisionMemoryIds]),
    lastReinforcedAt: now,
    decayScore: success ? 8 : 24,
    createdAt: now,
    updatedAt: now,
  });

  const efficiencyMemory = upsertMemory(stores.memoryStore, {
    id: efficiencyMemoryId,
    layer: "memories",
    memoryType: "efficiency",
    route: task.route,
    scope: "task-loop",
    summary: success
      ? `任务 ${task.title} 的低开销路径：优先 ${task.skillIds.join(", ") || "本地工具"}。`
      : `任务 ${task.title} 的低效点：${truncateText(task.lastError || task.blockedReason || summary, 180)}。`,
    appliesWhen: truncateText(task.goal || task.title, 180) || undefined,
    avoidWhen: success
      ? undefined
      : truncateText(task.lastError || task.blockedReason || summary, 180) || undefined,
    tags,
    confidence: success ? 76 : 52,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [distillEvent.id],
    sourceTaskIds: [task.id],
    sourceReviewIds: review?.id ? [review.id] : [],
    sourceSessionIds: task.sessionId ? [task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: uniqueStrings([
      executionMemory.id,
      ...(task.memoryRefs ?? []),
      ...decisionMemoryIds,
    ]),
    lastReinforcedAt: now,
    decayScore: success ? 12 : 28,
    createdAt: now,
    updatedAt: now,
  });

  const completionMemory = success
    ? upsertMemory(stores.memoryStore, {
        id: completionMemoryId,
        layer: "memories",
        memoryType: "completion",
        route: task.route,
        scope: "task-review",
        summary: `任务 ${task.title} 已完成，验收摘要：${summary}`,
        detail: truncateText(
          [
            task.successCriteria,
            task.planSummary,
            task.nextAction,
            review?.summary,
          ]
            .filter(Boolean)
            .join(" | "),
          400,
        ) || undefined,
        appliesWhen: truncateText(task.goal || task.title, 180) || undefined,
        tags,
        confidence: 88,
        version: 1,
        invalidatedBy: [],
        sourceEventIds: [distillEvent.id],
        sourceTaskIds: [task.id],
        sourceReviewIds: review?.id ? [review.id] : [],
        sourceSessionIds: task.sessionId ? [task.sessionId] : [],
        sourceIntelIds: [],
        derivedFromMemoryIds: uniqueStrings([executionMemory.id, efficiencyMemory.id]),
        lastReinforcedAt: now,
        decayScore: 10,
        createdAt: now,
        updatedAt: now,
      })
    : null;

  const resourceRefs = uniqueStrings([
    task.worker,
    ...task.skillIds,
    ...(task.artifactRefs ?? []),
  ]);
  const resourceMemory =
    resourceRefs.length > 0
      ? upsertMemory(stores.memoryStore, {
          id: resourceMemoryId,
          layer: "memories",
          memoryType: "resource",
          route: task.route,
          scope: "task-resources",
          summary:
            truncateText(
              `任务 ${task.title} 的可复用资源：${resourceRefs.slice(0, 5).join(" / ")}`,
              220,
            ) || `任务 ${task.title} 的可复用资源`,
          detail:
            truncateText(
              [
                task.worker ? `worker=${task.worker}` : undefined,
                task.skillIds.length > 0 ? `skills=${task.skillIds.join(", ")}` : undefined,
                task.artifactRefs.length > 0 ? `artifacts=${task.artifactRefs.join(", ")}` : undefined,
              ]
                .filter(Boolean)
                .join(" · "),
              420,
            ) || undefined,
          appliesWhen: truncateText(task.goal || task.title, 180) || undefined,
          tags: uniqueStrings(["resource", ...tags, task.worker, ...task.skillIds]),
          confidence: success ? 74 : task.status === "waiting_user" ? 56 : 60,
          version: 1,
          invalidatedBy: [],
          sourceEventIds: [distillEvent.id],
          sourceTaskIds: [task.id],
          sourceReviewIds: review?.id ? [review.id] : [],
          sourceSessionIds: task.sessionId ? [task.sessionId] : [],
          sourceIntelIds: [],
          derivedFromMemoryIds: uniqueStrings([
            executionMemory.id,
            efficiencyMemory.id,
            completionMemory?.id,
            ...upstreamMemoryIds,
          ]),
          lastReinforcedAt: now,
          decayScore: success ? 14 : 26,
          createdAt: now,
          updatedAt: now,
          metadata: {
            worker: task.worker,
            skillIds: uniqueStrings(task.skillIds),
            artifactRefs: uniqueStrings(task.artifactRefs ?? []),
          },
        })
      : null;

  const strategy = upsertStrategy(stores.memoryStore, {
    id: buildStableId("strategy", [
      task.route,
      task.worker,
      task.skillIds.join("|"),
      input.decision?.thinkingLane || "system1",
    ]),
    layer: "strategies",
    route: task.route,
    worker: task.worker || "main",
    skillIds: uniqueStrings(task.skillIds),
    summary: truncateText(task.planSummary || task.nextAction || summary, 200) || task.title,
    fallback: truncateText(task.blockedReason || task.lastError || "worker:main", 180) || undefined,
    triggerConditions: truncateText(task.goal || task.title, 180) || undefined,
    recommendedPath: truncateText(task.planSummary || task.nextAction || summary, 200) || undefined,
    fallbackPath:
      truncateText(task.blockedReason || task.lastError || "worker:main", 200) || undefined,
    thinkingLane: input.decision?.thinkingLane || "system1",
    confidence: success ? 78 : 48,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [distillEvent.id],
    sourceTaskIds: [task.id],
    sourceReviewIds: review?.id ? [review.id] : [],
    sourceSessionIds: task.sessionId ? [task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: uniqueStrings([
      executionMemory.id,
      efficiencyMemory.id,
      completionMemory?.id,
      resourceMemory?.id,
      ...upstreamMemoryIds,
    ]),
    measuredEffect: {
      successCount: success ? 1 : 0,
      blockedCount: success ? 0 : 1,
      waitingUserCount: task.status === "waiting_user" ? 1 : 0,
    },
    createdAt: now,
    updatedAt: now,
  });

  const metaLearning = upsertMetaLearning(stores.memoryStore, {
    id: buildStableId("meta_learning", [task.id, task.status, summary]),
    layer: "meta_learning",
    summary: success
      ? `成功模式：${truncateText(task.title, 80)} -> ${summary}`
      : `失败模式：${truncateText(task.title, 80)} -> ${summary}`,
    hypothesis: success ? "优先沿已验证策略执行。" : "需要在相同触发条件下重新规划 fallback。",
    adoptedAs: success ? "strategy" : "memory",
    confidence: success ? 80 : 50,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [distillEvent.id],
    sourceTaskIds: [task.id],
    sourceReviewIds: review?.id ? [review.id] : [],
    sourceSessionIds: task.sessionId ? [task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: uniqueStrings([
      executionMemory.id,
      efficiencyMemory.id,
      completionMemory?.id,
      resourceMemory?.id,
    ]),
    createdAt: now,
    updatedAt: now,
    metadata: {
      reinforcedMemoryIds,
    },
  });

  persistStores(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "task_outcome_distilled",
    {
      taskId: task.id,
      status: task.status,
      memoryIds: uniqueStrings([
        executionMemory.id,
        efficiencyMemory.id,
        completionMemory?.id,
        resourceMemory?.id,
      ]),
      strategyIds: [strategy.id],
      reviewId: review?.id,
      reinforcedMemoryIds,
      sourceEventId: distillEvent.id,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    memories: [executionMemory, efficiencyMemory, completionMemory, resourceMemory].filter(
      (entry): entry is MemoryRecord => entry != null,
    ),
    strategies: [strategy],
    metaLearning: [metaLearning],
  };
}

export type InvalidateMemoryLineageInput = {
  memoryIds: string[];
  reasonEventId: string;
  now?: number;
};

export type InvalidateMemoryLineageResult = {
  invalidationEventId: string;
  invalidatedMemoryIds: string[];
  invalidatedStrategyIds: string[];
  invalidatedMetaLearningIds: string[];
  requeuedTaskIds: string[];
};

export function invalidateMemoryLineage(
  input: InvalidateMemoryLineageInput,
  opts: RuntimeStoreOptions = {},
): InvalidateMemoryLineageResult {
  const now = resolveNow(input.now ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const targetIds = new Set(uniqueStrings(input.memoryIds));
  const invalidatedMemoryIds = new Set<string>();
  const invalidatedStrategyIds = new Set<string>();
  const invalidatedMetaLearningIds = new Set<string>();
  const requeuedTaskIds = new Set<string>();
  const memorySnapshots = new Map<string, MemoryRecord>();
  const strategySnapshots = new Map<string, StrategyRecord>();
  const metaLearningSnapshots = new Map<string, MetaLearningRecord>();
  const evolutionSnapshots = new Map<string, EvolutionMemoryRecord>();
  const shadowSnapshots = new Map<string, ShadowEvaluationRecord>();
  const taskSnapshots = new Map<string, TaskRecord>();

  let pending = [...targetIds];
  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId) {
      continue;
    }
    for (const memory of stores.memoryStore.memories) {
      if (memory.id !== currentId && !memory.derivedFromMemoryIds.includes(currentId)) {
        continue;
      }
      if (!memorySnapshots.has(memory.id)) {
        memorySnapshots.set(memory.id, cloneValue(memory));
      }
      invalidatedMemoryIds.add(memory.id);
      const invalidatedBy = uniqueStrings([...(memory.invalidatedBy ?? []), input.reasonEventId]);
      if (invalidatedBy.length !== memory.invalidatedBy.length) {
        memory.invalidatedBy = invalidatedBy;
        memory.version = nextVersion(memory);
        memory.confidence = Math.max(5, Math.round(memory.confidence * 0.45));
        memory.decayScore = Math.max(memory.decayScore ?? 0, 65);
        memory.updatedAt = now;
        memory.metadata = {
          ...toRecord(memory.metadata),
          invalidation: {
            reasonEventId: input.reasonEventId,
            invalidatedAt: now,
          },
        };
      }
      if (memory.id !== currentId && !targetIds.has(memory.id)) {
        targetIds.add(memory.id);
        pending.push(memory.id);
      }
    }
  }

  for (const strategy of stores.memoryStore.strategies) {
    const linkedMemoryIds = uniqueStrings([
      ...(strategy.derivedFromMemoryIds ?? []),
    ]);
    if (!linkedMemoryIds.some((memoryId) => invalidatedMemoryIds.has(memoryId))) {
      continue;
    }
    if (!strategySnapshots.has(strategy.id)) {
      strategySnapshots.set(strategy.id, cloneValue(strategy));
    }
    invalidatedStrategyIds.add(strategy.id);
    strategy.invalidatedBy = uniqueStrings([
      ...(strategy.invalidatedBy ?? []),
      input.reasonEventId,
    ]);
    strategy.version = nextVersion(strategy);
    strategy.confidence = Math.max(5, Math.round(strategy.confidence * 0.5));
    strategy.updatedAt = now;
    strategy.metadata = {
      ...toRecord(strategy.metadata),
      invalidation: {
        reasonEventId: input.reasonEventId,
        invalidatedAt: now,
        linkedMemoryIds: linkedMemoryIds.filter((memoryId) => invalidatedMemoryIds.has(memoryId)),
      },
    };
  }

  for (const learning of stores.memoryStore.metaLearning) {
    const linkedMemoryIds = uniqueStrings(learning.derivedFromMemoryIds ?? []);
    if (!linkedMemoryIds.some((memoryId) => invalidatedMemoryIds.has(memoryId))) {
      continue;
    }
    if (!metaLearningSnapshots.has(learning.id)) {
      metaLearningSnapshots.set(learning.id, cloneValue(learning));
    }
    invalidatedMetaLearningIds.add(learning.id);
    learning.adoptedAs = "shadow";
    learning.updatedAt = now;
    learning.metadata = {
      ...toRecord(learning.metadata),
      invalidation: {
        reasonEventId: input.reasonEventId,
        invalidatedAt: now,
        linkedMemoryIds: linkedMemoryIds.filter((memoryId) => invalidatedMemoryIds.has(memoryId)),
      },
    };
  }

  for (const evolution of stores.memoryStore.evolutionMemory) {
    if (!evolution.sourceTaskIds.some(Boolean) && !evolution.sourceReviewIds.some(Boolean)) {
      continue;
    }
    if (!stores.memoryStore.strategies.some((strategy) => strategy.id === evolution.candidateRef)) {
      continue;
    }
    if (invalidatedStrategyIds.has(evolution.candidateRef || "")) {
      if (!evolutionSnapshots.has(evolution.id)) {
        evolutionSnapshots.set(evolution.id, cloneValue(evolution));
      }
      evolution.adoptionState = "shadow";
      evolution.updatedAt = now;
    }
  }

  for (const shadow of stores.governanceStore.shadowEvaluations) {
    if (!invalidatedStrategyIds.has(shadow.candidateRef || "")) {
      continue;
    }
    if (!shadowSnapshots.has(shadow.id)) {
      shadowSnapshots.set(shadow.id, cloneValue(shadow));
    }
    shadow.state = "reverted";
    shadow.updatedAt = now;
  }

  for (const task of stores.taskStore.tasks) {
    if (isTerminalTaskStatus(task.status)) {
      continue;
    }
    const matchedMemoryIds = uniqueStrings(
      (task.memoryRefs ?? []).filter((memoryId) => invalidatedMemoryIds.has(memoryId)),
    );
    if (matchedMemoryIds.length === 0) {
      continue;
    }
    if (!taskSnapshots.has(task.id)) {
      taskSnapshots.set(task.id, cloneValue(task));
    }
    const optimizationState = readTaskOptimizationState(task);
    task.memoryRefs = (task.memoryRefs ?? []).filter(
      (memoryId) => !invalidatedMemoryIds.has(memoryId),
    );
    task.status = "queued";
    task.nextRunAt = now;
    task.activeRunId = undefined;
    task.leaseOwner = undefined;
    task.leaseExpiresAt = undefined;
    task.blockedReason = "相关记忆已失效，任务将重新规划。";
    task.planSummary = "相关记忆已失效，任务正在重建执行计划。";
    task.nextAction = "相关记忆已失效，重新规划任务。";
    task.updatedAt = now;
    task.metadata = writeTaskOptimizationState(task, {
      needsReplan: true,
      invalidatedBy: uniqueStrings([...(optimizationState.invalidatedBy ?? []), input.reasonEventId]),
      invalidatedMemoryIds: uniqueStrings([
        ...(optimizationState.invalidatedMemoryIds ?? []),
        ...matchedMemoryIds,
      ]),
    });
    requeuedTaskIds.add(task.id);
  }

  persistStores(stores, {
    ...opts,
    now,
  });
  const invalidationEvent = appendRuntimeEvent(
    "memory_lineage_invalidated",
    {
      reasonEventId: input.reasonEventId,
      invalidatedMemoryIds: [...invalidatedMemoryIds],
      invalidatedStrategyIds: [...invalidatedStrategyIds],
      invalidatedMetaLearningIds: [...invalidatedMetaLearningIds],
      requeuedTaskIds: [...requeuedTaskIds],
      rollback: {
        memories: [...memorySnapshots.values()],
        strategies: [...strategySnapshots.values()],
        metaLearning: [...metaLearningSnapshots.values()],
        evolutionMemory: [...evolutionSnapshots.values()],
        shadowEvaluations: [...shadowSnapshots.values()],
        tasks: [...taskSnapshots.values()],
      },
    },
    {
      ...opts,
      now,
    },
  );

  return {
    invalidationEventId: invalidationEvent.id,
    invalidatedMemoryIds: [...invalidatedMemoryIds],
    invalidatedStrategyIds: [...invalidatedStrategyIds],
    invalidatedMetaLearningIds: [...invalidatedMetaLearningIds],
    requeuedTaskIds: [...requeuedTaskIds],
  };
}

export type RollbackMemoryLineageInput = {
  invalidationEventId: string;
  now?: number;
};

export type RollbackMemoryLineageResult = {
  restoredMemoryIds: string[];
  restoredStrategyIds: string[];
  restoredMetaLearningIds: string[];
  restoredTaskIds: string[];
  rollbackEventId: string;
};

export function rollbackMemoryLineageInvalidation(
  input: RollbackMemoryLineageInput,
  opts: RuntimeStoreOptions = {},
): RollbackMemoryLineageResult {
  const result = rollbackMemoryInvalidation(
    {
      invalidationEventId: input.invalidationEventId,
      reason: `rollback:${input.invalidationEventId}`,
      now: input.now,
    },
    opts,
  );
  return {
    restoredMemoryIds: result.restoredMemoryIds,
    restoredStrategyIds: result.restoredStrategyIds,
    restoredMetaLearningIds: result.restoredMetaLearningIds,
    restoredTaskIds: result.restoredTaskIds,
    rollbackEventId: result.rollbackEventId || "",
  };
}

export type ReviewRuntimeMemoryHealthResult = {
  reviewedAt: number;
  decayedMemoryIds: string[];
  downweightedStrategyIds: string[];
};

export function reviewRuntimeMemoryHealth(
  opts: RuntimeStoreOptions = {},
): ReviewRuntimeMemoryHealthResult {
  const result = reviewRuntimeMemoryLifecycle(opts);
  return {
    reviewedAt: result.reviewedAt,
    decayedMemoryIds: result.agedMemoryIds,
    downweightedStrategyIds: result.weakenedStrategyIds,
  };
}

export type PromotePinnedIntelToKnowledgeMemoryInput = {
  intelId: string;
  promotedBy: string;
  summary?: string;
  detail?: string;
  tags?: string[];
  now?: number;
};

export type PromotePinnedIntelToKnowledgeMemoryResult = {
  pinnedRecord: ManualPinnedIntelRecord;
  memory: MemoryRecord;
};

export function promotePinnedIntelToKnowledgeMemory(
  input: PromotePinnedIntelToKnowledgeMemoryInput,
  opts: RuntimeStoreOptions = {},
): PromotePinnedIntelToKnowledgeMemoryResult {
  const now = resolveNow(input.now ?? opts.now);
  const intelId = normalizeText(input.intelId);
  const promotedBy = normalizeText(input.promotedBy) || "runtime-user";
  if (!intelId) {
    throw new Error("intelId is required");
  }
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const intel = readIntelSnapshot(stores.intelStore, intelId);
  if (!intel) {
    throw new Error(`Unknown intel item: ${intelId}`);
  }
  const label =
    intel.kind === "candidate" ? intel.candidate.title : intel.digest.title;
  const sourceIds =
    intel.kind === "candidate" ? [intel.candidate.sourceId] : uniqueStrings(intel.digest.sourceIds);
  const domain = intel.kind === "candidate" ? intel.candidate.domain : intel.digest.domain;
  const sourceUrl =
    intel.kind === "candidate"
      ? intel.candidate.url
      : normalizeText(intel.digest.metadata?.sourceUrl) || undefined;
  const promotionEvent = appendRuntimeEvent(
    "runtime_intel_knowledge_promoting",
    {
      intelId,
      promotedBy,
      kind: intel.kind,
      domain,
    },
    {
      ...opts,
      now,
    },
  );
  const existing = stores.memoryStore.memories.find(
    (entry) =>
      entry.memoryType === "knowledge" &&
      entry.sourceIntelIds.includes(intelId) &&
      entry.scope === "manual-pinned-intel",
  );
  const memory = upsertMemory(stores.memoryStore, {
    id: existing?.id ?? buildStableId("knowledge_memory", [intelId, label]),
    layer: "memories",
    memoryType: "knowledge",
    route: domain,
    scope: "manual-pinned-intel",
    summary:
      normalizeText(input.summary) ||
      truncateText(`人工升格资讯为正式知识：${label}`, 220) ||
      label,
    detail:
      normalizeText(input.detail) ||
      truncateText(
        [
          intel.kind === "candidate" ? intel.candidate.summary : intel.digest.conclusion,
          sourceUrl,
          intel.kind === "digest" ? intel.digest.whyItMatters : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
        500,
      ) ||
      undefined,
    appliesWhen: intel.kind === "digest" ? intel.digest.recommendedAction : undefined,
    avoidWhen:
      intel.kind === "digest" ? normalizeText(intel.digest.recommendedIgnoreReason) || undefined : undefined,
    tags: uniqueStrings([
      domain,
      "knowledge",
      "manual-pin",
      ...sourceIds,
      ...(input.tags ?? []),
      ...(Array.isArray(
        intel.kind === "candidate" ? intel.candidate.metadata?.tags : intel.digest.metadata?.tags,
      )
        ? (
            ((intel.kind === "candidate" ? intel.candidate.metadata?.tags : intel.digest.metadata?.tags) ?? []) as unknown[]
          ).filter((value): value is string => typeof value === "string")
        : []),
    ]),
    confidence: 92,
    version: (existing?.version ?? 0) + 1,
    invalidatedBy: [],
    sourceEventIds: [promotionEvent.id],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [intelId],
    derivedFromMemoryIds: [],
    lastReinforcedAt: now,
    decayScore: 8,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      promotedBy,
      sourceDomain: domain,
      sourceIds,
      sourceUrl,
      promotedFromKind: intel.kind,
    },
  });
  const pinnedRecord = upsertPinnedIntelRecord(stores.intelStore, {
    id: buildStableId("intel_pin", [intelId, promotedBy]),
    intelId,
    promotedToMemoryId: memory.id,
    promotedBy,
    createdAt: now,
    metadata: {
      sourceDomain: domain,
      sourceIds,
      promotionEventId: promotionEvent.id,
    },
  });
  appendIntelUsefulnessRecords(stores.intelStore, {
    intelId,
    sourceIds,
    domain,
    usefulnessScore: 95,
    reason: "manual_pin_to_knowledge",
    now,
    metadata: {
      title: label,
      promotedBy,
      pinnedRecordId: pinnedRecord.id,
      memoryId: memory.id,
      promotedFromKind: intel.kind,
    },
  });

  persistStores(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_intel_promoted_to_knowledge",
    {
      intelId,
      pinnedRecordId: pinnedRecord.id,
      memoryId: memory.id,
      promotedBy,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    pinnedRecord,
    memory,
  };
}

export type RecordRuntimeUserPreferenceMemoriesInput = {
  previous: RuntimeUserModel;
  next: RuntimeUserModel;
  now?: number;
};

export type RecordRuntimeUserPreferenceMemoriesResult = {
  memories: MemoryRecord[];
};

export function recordRuntimeUserPreferenceMemories(
  input: RecordRuntimeUserPreferenceMemoriesInput,
  opts: RuntimeStoreOptions = {},
): RecordRuntimeUserPreferenceMemoriesResult {
  const now = resolveNow(input.now ?? opts.now);
  const changedFields = uniqueStrings([
    input.previous.displayName !== input.next.displayName ? "display_name" : undefined,
    input.previous.communicationStyle !== input.next.communicationStyle
      ? "communication_style"
      : undefined,
    input.previous.interruptionThreshold !== input.next.interruptionThreshold
      ? "interruption_threshold"
      : undefined,
    input.previous.reportVerbosity !== input.next.reportVerbosity ? "report_verbosity" : undefined,
    input.previous.confirmationBoundary !== input.next.confirmationBoundary
      ? "confirmation_boundary"
      : undefined,
    input.previous.reportPolicy !== input.next.reportPolicy ? "report_policy" : undefined,
  ]);
  if (changedFields.length === 0) {
    return { memories: [] };
  }

  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const event = appendRuntimeEvent(
    "runtime_user_model_updated",
    {
      userModelId: input.next.id,
      changedFields,
    },
    {
      ...opts,
      now,
    },
  );

  const userMemoryId = buildStableId("runtime_user_memory", [input.next.id, "core"]);
  const communicationMemoryId = buildStableId("runtime_user_memory", [input.next.id, "communication"]);
  const userExisting = findMemory(stores.memoryStore, userMemoryId);
  const communicationExisting = findMemory(stores.memoryStore, communicationMemoryId);

  const userSummary =
    truncateText(
      [
        input.next.displayName ? `称呼=${input.next.displayName}` : undefined,
        input.next.interruptionThreshold ? `打扰阈值=${input.next.interruptionThreshold}` : undefined,
        input.next.confirmationBoundary ? `确认边界=${input.next.confirmationBoundary}` : undefined,
        input.next.reportVerbosity ? `汇报粒度=${input.next.reportVerbosity}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      220,
    ) || "用户核心偏好已更新";
  const communicationSummary =
    truncateText(
      [
        input.next.communicationStyle ? `沟通风格=${input.next.communicationStyle}` : undefined,
        input.next.reportPolicy ? `汇报策略=${input.next.reportPolicy}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      220,
    ) || "用户沟通偏好已更新";

  const userMemory = upsertMemory(stores.memoryStore, {
    id: userMemoryId,
    layer: "memories",
    memoryType: "user",
    route: "user-console",
    scope: "runtime-user-model",
    summary: userSummary,
    detail: truncateText(`changed=${changedFields.join(", ")}`, 180) || undefined,
    tags: uniqueStrings(["user-model", "preference", ...changedFields]),
    confidence: 96,
    version: (userExisting?.version ?? 0) + 1,
    invalidatedBy: [],
    sourceEventIds: [event.id],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    lastReinforcedAt: now,
    decayScore: 6,
    createdAt: userExisting?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      changedFields,
      displayName: input.next.displayName,
      interruptionThreshold: input.next.interruptionThreshold,
      confirmationBoundary: input.next.confirmationBoundary,
      reportVerbosity: input.next.reportVerbosity,
    },
  });
  const communicationMemory = upsertMemory(stores.memoryStore, {
    id: communicationMemoryId,
    layer: "memories",
    memoryType: "communication",
    route: "user-console",
    scope: "runtime-user-model",
    summary: communicationSummary,
    detail: truncateText(`changed=${changedFields.join(", ")}`, 180) || undefined,
    tags: uniqueStrings(["user-model", "communication", ...changedFields]),
    confidence: 94,
    version: (communicationExisting?.version ?? 0) + 1,
    invalidatedBy: [],
    sourceEventIds: [event.id],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [userMemory.id],
    lastReinforcedAt: now,
    decayScore: 8,
    createdAt: communicationExisting?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      changedFields,
      communicationStyle: input.next.communicationStyle,
      reportPolicy: input.next.reportPolicy,
    },
  });

  persistStores(stores, {
    ...opts,
    now,
  });
  return {
    memories: [userMemory, communicationMemory],
  };
}

export type RecordRuntimeSurfaceRoleMemoryInput = {
  surface: SurfaceRecord;
  overlay: SurfaceRoleOverlay;
  now?: number;
};

export type RecordRuntimeSurfaceRoleMemoryResult = {
  memory: MemoryRecord;
};

export function recordRuntimeSurfaceRoleMemory(
  input: RecordRuntimeSurfaceRoleMemoryInput,
  opts: RuntimeStoreOptions = {},
): RecordRuntimeSurfaceRoleMemoryResult {
  const now = resolveNow(input.now ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const event = appendRuntimeEvent(
    "runtime_surface_role_overlay_updated",
    {
      surfaceId: input.surface.id,
      overlayId: input.overlay.id,
      channel: input.surface.channel,
      role: input.overlay.role,
    },
    {
      ...opts,
      now,
    },
  );
  const memoryId = buildStableId("runtime_surface_role_memory", [input.surface.id]);
  const existing = findMemory(stores.memoryStore, memoryId);
  const memory = upsertMemory(stores.memoryStore, {
    id: memoryId,
    layer: "memories",
    memoryType: "communication",
    route: input.surface.channel,
    scope: `surface:${input.surface.id}`,
    summary:
      truncateText(
        `${input.surface.label} 角色=${input.overlay.role}${input.overlay.businessGoal ? ` · 目标=${input.overlay.businessGoal}` : ""}`,
        220,
      ) || `${input.surface.label} 角色策略`,
    detail:
      truncateText(
        [
          input.overlay.tone ? `tone=${input.overlay.tone}` : undefined,
          input.overlay.reportTarget ? `report=${input.overlay.reportTarget}` : undefined,
          input.overlay.allowedTopics.length > 0
            ? `allow=${input.overlay.allowedTopics.join("/")}`
            : undefined,
          input.overlay.restrictedTopics.length > 0
            ? `restrict=${input.overlay.restrictedTopics.join("/")}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        360,
      ) || undefined,
    tags: uniqueStrings([
      "surface-role",
      input.surface.channel,
      input.overlay.role,
      ...(input.overlay.allowedTopics ?? []),
    ]),
    confidence: 92,
    version: (existing?.version ?? 0) + 1,
    invalidatedBy: [],
    sourceEventIds: [event.id],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    lastReinforcedAt: now,
    decayScore: 10,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      surfaceId: input.surface.id,
      overlayId: input.overlay.id,
      ownerKind: input.surface.ownerKind,
      ownerId: input.surface.ownerId,
      initiative: input.overlay.initiative,
      reportTarget: input.overlay.reportTarget,
      localBusinessPolicy: input.overlay.localBusinessPolicy,
    },
  });

  persistStores(stores, {
    ...opts,
    now,
  });
  return { memory };
}

export type RecordRuntimeTaskUserResponseMemoryInput = {
  task: TaskRecord;
  response: string;
  respondedBy?: string;
  now?: number;
};

export type RecordRuntimeTaskUserResponseMemoryResult = {
  memory: MemoryRecord;
};

export function recordRuntimeTaskUserResponseMemory(
  input: RecordRuntimeTaskUserResponseMemoryInput,
  opts: RuntimeStoreOptions = {},
): RecordRuntimeTaskUserResponseMemoryResult {
  const now = resolveNow(input.now ?? opts.now);
  const response = truncateText(normalizeText(input.response), 320);
  if (!response) {
    throw new Error("response is required");
  }
  const respondedBy = normalizeText(input.respondedBy) || "runtime-user";
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const event = appendRuntimeEvent(
    "runtime_task_waiting_user_response_recorded",
    {
      taskId: input.task.id,
      route: input.task.route,
      respondedBy,
      status: input.task.status,
    },
    {
      ...opts,
      now,
    },
  );
  const memoryId = buildStableId("runtime_task_user_response_memory", [input.task.id]);
  const existing = findMemory(stores.memoryStore, memoryId);
  const memory = upsertMemory(stores.memoryStore, {
    id: memoryId,
    layer: "memories",
    memoryType: "communication",
    route: input.task.route,
    scope: `task:${input.task.id}:waiting-user`,
    summary:
      truncateText(`任务 ${input.task.title} 收到用户答复：${response}`, 220) ||
      `任务 ${input.task.title} 收到用户答复`,
    detail:
      truncateText(
        [
          `response=${response}`,
          input.task.nextAction ? `next=${input.task.nextAction}` : undefined,
          input.task.blockedReason ? `waiting=${input.task.blockedReason}` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        420,
      ) || undefined,
    tags: uniqueStrings([
      "task-user-response",
      "communication",
      input.task.route,
      ...(input.task.tags ?? []),
    ]),
    confidence: 95,
    version: (existing?.version ?? 0) + 1,
    invalidatedBy: [],
    sourceEventIds: [event.id],
    sourceTaskIds: [input.task.id],
    sourceReviewIds: input.task.latestReviewId ? [input.task.latestReviewId] : [],
    sourceSessionIds: input.task.sessionId ? [input.task.sessionId] : [],
    sourceIntelIds: [],
    derivedFromMemoryIds: uniqueStrings(input.task.memoryRefs ?? []),
    lastReinforcedAt: now,
    decayScore: 9,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      respondedBy,
      response,
      taskStatus: input.task.status,
      reportPolicy: input.task.reportPolicy,
      rootTaskId: input.task.rootTaskId,
      parentTaskId: input.task.parentTaskId,
    },
  });

  persistStores(stores, {
    ...opts,
    now,
  });
  return { memory };
}

export type ObserveTaskOutcomeForEvolutionInput = {
  task: TaskRecord;
  review?: TaskReview | null;
  run?: TaskRun | null;
  thinkingLane?: "system1" | "system2";
  completionScore?: number;
  now?: number;
};

export type ObserveTaskOutcomeForEvolutionResult = {
  evolutionRecords: EvolutionMemoryRecord[];
  shadowEvaluations: ShadowEvaluationRecord[];
};

export function observeTaskOutcomeForEvolution(
  input: ObserveTaskOutcomeForEvolutionInput,
  opts: RuntimeStoreOptions = {},
): ObserveTaskOutcomeForEvolutionResult {
  const now = resolveNow(input.now ?? opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const lane = input.thinkingLane || "system1";
  const completionScore = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(input.completionScore)
        ? Number(input.completionScore)
        : input.task.status === "completed"
          ? 82
          : input.task.status === "waiting_user"
            ? 42
            : 35,
    ),
  );
  const observationSample = buildEvolutionObservationSample({
    task: input.task,
    review: input.review,
    run: input.run,
    lane,
    completionScore,
    now,
  });
  const runtimeRunState = readTaskRuntimeRunState(input.task);
  const evolutionRecords: EvolutionMemoryRecord[] = [];
  const shadowEvaluations: ShadowEvaluationRecord[] = [];

  const laneCandidateId = buildStableId("evolution_lane", [input.task.route, lane]);
  const laneEvaluationId = buildStableId("shadow_lane", [input.task.route, lane]);
  const laneObserved = observeRuntimeEvolutionCandidate({
    stores,
    task: input.task,
    review: input.review,
    completionScore,
    observationSample,
    now,
    spec: {
      candidateId: laneCandidateId,
      evaluationId: laneEvaluationId,
      candidateType: "route_default_lane",
      targetLayer: "decision",
      summary: `${input.task.route} 高频任务默认采用 ${lane} 决策通道。`,
      baselineRef: `${input.task.route}:baseline`,
      candidateRef: `${input.task.route}:${lane}`,
      expectedEffect: "Prefer the default lane with lower latency and stable completion.",
      optimizedMetrics: ["latency", "completion", "success"],
      metadata: {
        route: input.task.route,
        lane,
        worker: input.task.worker || "main",
        skillIds: input.task.skillIds,
      },
    },
  });
  shadowEvaluations.push(laneObserved.shadowEvaluation);
  evolutionRecords.push(laneObserved.evolutionRecord);

  if (input.task.skillIds.length > 0) {
    const skillCandidateId = buildStableId("evolution_skill_bundle", [
      input.task.route,
      input.task.worker,
      input.task.skillIds.join("|"),
      lane,
    ]);
    const skillEvaluationId = buildStableId("shadow_skill_bundle", [
      input.task.route,
      input.task.skillIds.join("|"),
      lane,
    ]);
    const skillObserved = observeRuntimeEvolutionCandidate({
      stores,
      task: input.task,
      review: input.review,
      completionScore,
      observationSample,
      now,
      spec: {
        candidateId: skillCandidateId,
        evaluationId: skillEvaluationId,
        candidateType: "route_skill_bundle",
        targetLayer: "task_loop",
        summary: `${input.task.route} 路由优先技能组合：${input.task.skillIds.join(", ")}。`,
        baselineRef: `${input.task.route}:route-native`,
        candidateRef: `${input.task.route}:${input.task.worker || "main"}:${hashText(input.task.skillIds.join("|"))}`,
        expectedEffect: "Prefer the observed stable skill bundle before escalating.",
        optimizedMetrics: ["success", "completion"],
        metadata: {
          route: input.task.route,
          lane,
          worker: input.task.worker || "main",
          skillIds: input.task.skillIds,
        },
      },
    });
    shadowEvaluations.push(skillObserved.shadowEvaluation);
    evolutionRecords.push(skillObserved.evolutionRecord);
  }

  const worker = normalizeText(input.task.worker);
  if (worker && worker !== "main") {
    const workerCandidateId = buildStableId("evolution_worker_routing", [
      input.task.route,
      worker,
      lane,
    ]);
    const workerEvaluationId = buildStableId("shadow_worker_routing", [
      input.task.route,
      worker,
      lane,
    ]);
    const workerObserved = observeRuntimeEvolutionCandidate({
      stores,
      task: input.task,
      review: input.review,
      completionScore,
      observationSample,
      now,
      spec: {
        candidateId: workerCandidateId,
        evaluationId: workerEvaluationId,
        candidateType: "worker_routing",
        targetLayer: "task_loop",
        summary: `${input.task.route} 路由可优先交给 ${worker} worker 执行，再按 ${lane} 通道完成收敛。`,
        baselineRef: `${input.task.route}:worker-main`,
        candidateRef: `${input.task.route}:${worker}:${lane}`,
        expectedEffect: "Prefer a stable specialized worker when it repeatedly finishes the route cleanly.",
        optimizedMetrics: ["success", "completion", "latency"],
        metadata: {
          route: input.task.route,
          lane,
          worker,
          skillIds: input.task.skillIds,
        },
      },
    });
    shadowEvaluations.push(workerObserved.shadowEvaluation);
    evolutionRecords.push(workerObserved.evolutionRecord);
  }

  const totalFailures = Math.max(0, Math.round(toNumber(runtimeRunState.totalFailures, 0)));
  const consecutiveFailures = Math.max(
    0,
    Math.round(toNumber(runtimeRunState.consecutiveFailures, 0)),
  );
  if (
    totalFailures > 0 ||
    consecutiveFailures > 0 ||
    input.task.status === "blocked" ||
    input.task.status === "cancelled"
  ) {
    const retryCandidateId = buildStableId("evolution_retry_policy", [
      input.task.route,
      input.task.worker || "main",
      lane,
    ]);
    const retryEvaluationId = buildStableId("shadow_retry_policy", [
      input.task.route,
      input.task.worker || "main",
      lane,
    ]);
    const retryDelayMinutes =
      typeof input.task.nextRunAt === "number" && Number.isFinite(input.task.nextRunAt)
        ? Math.max(0, Math.round((input.task.nextRunAt - now) / 60000))
        : undefined;
    const retrySummary =
      input.task.status === "blocked"
        ? `${input.task.route} 路由在连续失败后应暂停自动重试，并保留 ${input.task.budgetMode}/${input.task.retrievalMode} 恢复策略。`
        : `${input.task.route} 路由在累计失败后仍恢复成功，应保留 ${input.task.budgetMode}/${input.task.retrievalMode} 重试路径。`;
    const retryObserved = observeRuntimeEvolutionCandidate({
      stores,
      task: input.task,
      review: input.review,
      completionScore,
      observationSample,
      now,
      spec: {
        candidateId: retryCandidateId,
        evaluationId: retryEvaluationId,
        candidateType: "retry_policy_review",
        targetLayer: "task_loop",
        summary: retrySummary,
        baselineRef: `${input.task.route}:retry-default`,
        candidateRef: `${input.task.route}:${input.task.worker || "main"}:retry`,
        expectedEffect:
          "Keep retry and recovery policy explicit: deepen budget/retrieval after repeated failures and stop automatic retries once the route becomes unsafe.",
        optimizedMetrics: ["regression_risk", "success", "completion"],
        metadata: {
          route: input.task.route,
          lane,
          worker: input.task.worker || "main",
          skillIds: input.task.skillIds,
          budgetMode: input.task.budgetMode,
          retrievalMode: input.task.retrievalMode,
          totalFailures,
          consecutiveFailures,
          retryDelayMinutes,
          blockedThreshold: Math.max(4, consecutiveFailures || totalFailures || 0),
          failureSummary: normalizeText(
            input.task.lastError || input.task.blockedReason || input.review?.summary,
          ),
        },
      },
    });
    shadowEvaluations.push(retryObserved.shadowEvaluation);
    evolutionRecords.push(retryObserved.evolutionRecord);
  }

  if (input.task.retrievalMode && input.task.retrievalMode !== "light") {
    const retrievalCandidateId = buildStableId("evolution_retrieval_policy", [
      input.task.route,
      input.task.retrievalMode,
      lane,
    ]);
    const retrievalEvaluationId = buildStableId("shadow_retrieval_policy", [
      input.task.route,
      input.task.retrievalMode,
      lane,
    ]);
    const retrievalObserved = observeRuntimeEvolutionCandidate({
      stores,
      task: input.task,
      review: input.review,
      completionScore,
      observationSample,
      now,
      spec: {
        candidateId: retrievalCandidateId,
        evaluationId: retrievalEvaluationId,
        candidateType: "retrieval_policy",
        targetLayer: "retrieval",
        summary: `${input.task.route} 路由可优先在大模型下使用 ${input.task.retrievalMode} 检索策略。`,
        baselineRef: `${input.task.route}:light`,
        candidateRef: `${input.task.route}:${input.task.retrievalMode}`,
        expectedEffect: "Optimize retrieval depth based on successful historical outcomes.",
        optimizedMetrics: ["success", "completion"],
        metadata: {
          route: input.task.route,
          retrievalMode: input.task.retrievalMode,
          lane,
        },
      },
    });
    shadowEvaluations.push(retrievalObserved.shadowEvaluation);
    evolutionRecords.push(retrievalObserved.evolutionRecord);
  }

  const strategyIds = (input.task.memoryRefs ?? []).filter((id) => id.startsWith("strategy:"));
  for (const strategyId of strategyIds) {
    const cleanId = strategyId.replace(/^strategy:/, "");
    const refreshCandidateId = buildStableId("evolution_strategy_refresh", [cleanId]);
    const refreshEvaluationId = buildStableId("shadow_strategy_refresh", [cleanId]);
    const refreshObserved = observeRuntimeEvolutionCandidate({
      stores,
      task: input.task,
      review: input.review,
      completionScore,
      observationSample,
      now,
      spec: {
        candidateId: refreshCandidateId,
        evaluationId: refreshEvaluationId,
        candidateType: "strategy_refresh",
        targetLayer: "decision",
        summary: `策略 ${cleanId} 已完成验证，可刷新其置信度并延长其生命周期。`,
        baselineRef: "strategy:baseline",
        candidateRef: strategyId,
        expectedEffect: "Reinforce successful strategies through structured shadow evaluation.",
        optimizedMetrics: ["success", "completion"],
        metadata: {
          strategyId: cleanId,
        },
      },
    });
    shadowEvaluations.push(refreshObserved.shadowEvaluation);
    evolutionRecords.push(refreshObserved.evolutionRecord);
  }

  persistStores(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "task_outcome_observed_for_evolution",
    {
      taskId: input.task.id,
      reviewId: input.review?.id,
      evolutionRecordIds: evolutionRecords.map((entry) => entry.id),
      shadowEvaluationIds: shadowEvaluations.map((entry) => entry.id),
    },
    {
      ...opts,
      now,
    },
  );

  return { evolutionRecords, shadowEvaluations };
}

export type AutoApplyLowRiskEvolutionResult = {
  promotedIds: string[];
  adoptedIds: string[];
};

export function maybeAutoApplyLowRiskEvolution(
  opts: RuntimeStoreOptions = {},
): AutoApplyLowRiskEvolutionResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const controls = resolveRuntimeEvolutionControls(stores.governanceStore);
  const promotedIds: string[] = [];
  const adoptedIds: string[] = [];
  let updated = false;

  if (!controls.enabled || !controls.autoApplyLowRisk) {
    return {
      promotedIds,
      adoptedIds,
    };
  }

  for (const evolution of stores.memoryStore.evolutionMemory) {
    attachEvolutionRiskReview(evolution);
    const riskReview = buildRuntimeEvolutionRiskReview(evolution);
    const evaluations = stores.governanceStore.shadowEvaluations.filter(
      (entry) =>
        entry.candidateRef === evolution.id || entry.candidateRef === evolution.candidateRef,
    );
    const observationMetrics =
      readRuntimeEvolutionObservationMetrics(evolution.metadata) ??
      evaluations
        .map((entry) => readRuntimeEvolutionObservationMetrics(entry.metadata))
        .filter((entry): entry is RuntimeEvolutionObservationMetrics => entry != null)
        .toSorted((left, right) => right.observationCount - left.observationCount)[0];
    const autoApplyStatus = buildRuntimeEvolutionAutoApplyStatus({
      candidate: evolution,
      metrics: observationMetrics,
    });
    for (const evaluation of evaluations) {
      evaluation.metadata = {
        ...toRecord(evaluation.metadata),
        riskReview,
        observationMetrics,
        autoApplyStatus,
      };
      updated = true;
    }
    evolution.metadata = {
      ...toRecord(evolution.metadata),
      riskReview,
      observationMetrics,
      autoApplyStatus,
    };
    updated = true;
    if (!riskReview.autoApplyEligible) {
      continue;
    }
    if (evolution.adoptionState === "shadow" && autoApplyStatus.promoteReady) {
      evolution.adoptionState = "candidate";
      evolution.updatedAt = now;
      promotedIds.push(evolution.id);
      updated = true;
      continue;
    }
    // Promotion from Candidate to Adopted requires explicit autoCanaryEvolution flag.
    // In sovereign deployments (default), this requires manual operator adoption.
    if (
      evolution.adoptionState === "candidate" &&
      autoApplyStatus.adoptReady &&
      controls.autoCanaryEvolution
    ) {
      evolution.adoptionState = "adopted";
      evolution.updatedAt = now;
      adoptedIds.push(evolution.id);
      updated = true;
    }
  }

  for (const evaluation of stores.governanceStore.shadowEvaluations) {
    if (adoptedIds.includes(evaluation.candidateRef || "")) {
      evaluation.state = "adopted";
      evaluation.updatedAt = now;
      updated = true;
    } else if (promotedIds.includes(evaluation.candidateRef || "")) {
      evaluation.state = "promoted";
      evaluation.updatedAt = now;
      updated = true;
    }
  }

  if (updated) {
    persistStores(stores, {
      ...opts,
      now,
    });
  }
  if (promotedIds.length > 0 || adoptedIds.length > 0) {
    appendRuntimeEvent(
      "low_risk_evolution_auto_applied",
      {
        promotedIds,
        adoptedIds,
      },
      {
        ...opts,
        now,
      },
    );
  }

  return {
    promotedIds,
    adoptedIds,
  };
}

export type MaterializeAdoptedEvolutionStrategiesResult = {
  strategyIds: string[];
};

export function materializeAdoptedEvolutionStrategies(
  opts: RuntimeStoreOptions = {},
): MaterializeAdoptedEvolutionStrategiesResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const strategyIds: string[] = [];

  for (const evolution of stores.memoryStore.evolutionMemory) {
    if (evolution.adoptionState !== "adopted" && evolution.adoptionState !== "candidate") {
      continue;
    }
    const isCanary = evolution.adoptionState === "candidate";
    if (
      evolution.candidateType !== "route_default_lane" &&
      evolution.candidateType !== "route_skill_bundle" &&
      evolution.candidateType !== "worker_routing" &&
      evolution.candidateType !== "retry_policy_review"
    ) {
      continue;
    }
    const metadata = evolution.metadata ?? {};
    const route = normalizeText(metadata.route) || "general";
    const worker = normalizeText(metadata.worker) || "main";
    const lane = normalizeText(metadata.lane) === "system2" ? "system2" : "system1";
    const budgetMode = normalizeText(metadata.budgetMode) || undefined;
    const retrievalMode = normalizeText(metadata.retrievalMode) || undefined;
    const retryDelayMinutes =
      typeof metadata.retryDelayMinutes === "number" && Number.isFinite(metadata.retryDelayMinutes)
        ? Math.max(0, Math.round(metadata.retryDelayMinutes))
        : undefined;
    const blockedThreshold =
      typeof metadata.blockedThreshold === "number" && Number.isFinite(metadata.blockedThreshold)
        ? Math.max(1, Math.round(metadata.blockedThreshold))
        : undefined;
    const totalFailures =
      typeof metadata.totalFailures === "number" && Number.isFinite(metadata.totalFailures)
        ? Math.max(0, Math.round(metadata.totalFailures))
        : 0;
    const consecutiveFailures =
      typeof metadata.consecutiveFailures === "number" && Number.isFinite(metadata.consecutiveFailures)
        ? Math.max(0, Math.round(metadata.consecutiveFailures))
        : 0;
    const skillIds = Array.isArray(metadata.skillIds)
      ? uniqueStrings(
          metadata.skillIds.filter((value): value is string => typeof value === "string"),
        )
      : [];
    const strategyId =
      evolution.candidateType === "route_default_lane" ||
      evolution.candidateType === "route_skill_bundle"
        ? buildStableId("adopted_evolution_strategy", [route, worker, lane, skillIds.join("|")])
        : evolution.candidateType === "worker_routing"
          ? buildStableId("adopted_evolution_strategy", [
              evolution.candidateType,
              route,
              worker,
              lane,
              skillIds.join("|"),
            ])
          : buildStableId("adopted_evolution_strategy", [
              evolution.candidateType,
              route,
              worker,
              lane,
              budgetMode,
              retrievalMode,
            ]);
    const existingStrategy = stores.memoryStore.strategies.find((entry) => entry.id === strategyId);
    const strategy = upsertStrategy(stores.memoryStore, {
      id: strategyId,
      layer: "strategies",
      route,
      worker,
      skillIds,
      summary: evolution.summary,
      triggerConditions: evolution.summary,
      recommendedPath:
        evolution.candidateType === "route_default_lane"
          ? `优先按 ${lane} 通道决策，再交给 ${worker} 执行。`
          : evolution.candidateType === "route_skill_bundle"
            ? `优先使用技能组合：${skillIds.join(", ") || "route-native-skills"}。`
            : evolution.candidateType === "worker_routing"
              ? `优先将 ${route} 工作交给 ${worker} worker，再按 ${lane} 通道完成；worker 不可用时回退到 route-native worker。`
              : `连续失败时将预算提升到 ${budgetMode || "balanced"}、检索提升到 ${retrievalMode || "deep"}${
                  typeof retryDelayMinutes === "number" && retryDelayMinutes > 0
                    ? `，约 ${retryDelayMinutes} 分钟后重试`
                    : ""
                }${
                  typeof blockedThreshold === "number"
                    ? `，并在 ${blockedThreshold} 次失败后暂停自动重试`
                    : ""
                }。`,
      fallbackPath:
        evolution.candidateType === "retry_policy_review"
          ? "若恢复策略仍然失败，则回退到 route-native baseline 并等待人工复核。"
          : "当新策略失效时回退到 route-native baseline。",
      thinkingLane: lane,
      confidence: 84,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: evolution.sourceTaskIds,
      sourceReviewIds: evolution.sourceReviewIds,
      sourceSessionIds: evolution.sourceSessionIds,
      sourceIntelIds: [],
      derivedFromMemoryIds: evolution.derivedFromMemoryIds,
      canary: isCanary,
      measuredEffect: {
        materializedFrom: evolution.id,
        candidateType: evolution.candidateType,
        budgetMode,
        retrievalMode,
        retryDelayMinutes,
        blockedThreshold,
        totalFailures,
        consecutiveFailures,
        observationMetrics: readRuntimeEvolutionObservationMetrics(
          metadata as Record<string, unknown>,
        ),
      },
      createdAt: now,
      updatedAt: now,
      metadata: {
        materializedFromEvolutionId: evolution.id,
        evolutionCandidateType: evolution.candidateType,
        budgetMode,
        retrievalMode,
        retryDelayMinutes,
        blockedThreshold,
      },
    });
    if (
      existingStrategy?.invalidatedBy.length &&
      normalizeText(toRecord(existingStrategy.metadata)?.materializedFromEvolutionId) === evolution.id
    ) {
      strategy.invalidatedBy = [];
      strategy.version = nextVersion(strategy);
      strategy.updatedAt = now;
      strategy.metadata = {
        ...toRecord(strategy.metadata),
        reactivatedAt: now,
        reactivatedFromEvolutionId: evolution.id,
      };
    }
    evolution.metadata = {
      ...evolution.metadata,
      materializedStrategyId: strategy.id,
      materializedAt: now,
    };
    evolution.updatedAt = now;
    strategyIds.push(strategy.id);
  }

  if (strategyIds.length > 0) {
    persistStores(stores, {
      ...opts,
      now,
    });
    appendRuntimeEvent(
      "adopted_evolution_materialized",
      {
        strategyIds,
      },
      {
        ...opts,
        now,
      },
    );
  }

  return { strategyIds };
}

export type SetRuntimeEvolutionCandidateStateInput = {
  id: string;
  state: "candidate" | "adopted" | "reverted";
  reason?: string;
  now?: number;
};

export type SetRuntimeEvolutionCandidateStateResult = {
  candidate: EvolutionMemoryRecord;
  shadowEvaluationIds: string[];
  state: "shadow" | "candidate" | "adopted" | "reverted";
  strategyIds: string[];
  invalidatedStrategyIds: string[];
  updatedAt: number;
};

export type AcknowledgeRuntimeEvolutionVerificationInput = {
  id: string;
  note?: string;
  now?: number;
};

export type AcknowledgeRuntimeEvolutionVerificationResult = {
  candidate: EvolutionMemoryRecord;
  shadowEvaluationIds: string[];
  acknowledgedAt: number;
  verificationState: "pending" | "healthy" | "watch" | "revert_recommended";
  verificationObservationCount: number;
  updatedAt: number;
};

export function setRuntimeEvolutionCandidateState(
  input: SetRuntimeEvolutionCandidateStateInput,
  opts: RuntimeStoreOptions = {},
): SetRuntimeEvolutionCandidateStateResult {
  const now = resolveNow(input.now ?? opts.now);
  const id = normalizeText(input.id);
  if (!id) {
    throw new Error("Evolution candidate id is required");
  }
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const evolution = stores.memoryStore.evolutionMemory.find((entry) => entry.id === id);
  if (!evolution) {
    throw new Error(`Unknown evolution candidate: ${id}`);
  }
  const targetState = input.state;
  const reason = normalizeText(input.reason) || undefined;
  const revertReasonId = buildStableId("runtime_evolution_reverted", [evolution.id, now]);
  const relatedEvaluations = stores.governanceStore.shadowEvaluations.filter(
    (entry) => entry.candidateRef === evolution.id || entry.candidateRef === evolution.candidateRef,
  );

  evolution.updatedAt = now;
  evolution.metadata = {
    ...toRecord(evolution.metadata),
    lastTransitionAt: now,
    lastTransitionTo: targetState,
    lastTransitionReason: reason,
  };

  if (targetState === "candidate") {
    evolution.adoptionState = "candidate";
    evolution.metadata = {
      ...toRecord(evolution.metadata),
      promotedAt: now,
      revertedAt: undefined,
      revertedReason: undefined,
    };
    attachEvolutionVerificationReview({
      entry: evolution,
      now,
      clear: true,
    });
  } else if (targetState === "adopted") {
    const riskReview = buildRuntimeEvolutionRiskReview(evolution);
    if (riskReview.requiresReasonOnAdopt && !reason) {
      throw new Error("Evolution candidate requires a manual approval reason before adoption");
    }
    evolution.adoptionState = "adopted";
    evolution.metadata = {
      ...toRecord(evolution.metadata),
      adoptedAt: now,
      revertedAt: undefined,
      revertedReason: undefined,
    };
    attachEvolutionVerificationReview({
      entry: evolution,
      now,
      reset: true,
    });
  } else {
    evolution.adoptionState = "shadow";
    evolution.metadata = {
      ...toRecord(evolution.metadata),
      revertedAt: now,
      revertedReason: reason,
    };
  }
  attachEvolutionRiskReview(evolution);

  for (const evaluation of relatedEvaluations) {
    const riskReview = buildRuntimeEvolutionRiskReview(evolution);
    const verificationMetrics =
      targetState === "candidate"
        ? undefined
        : readRuntimeEvolutionVerificationMetrics(evolution.metadata);
    const verificationReview =
      targetState === "candidate"
        ? undefined
        : buildRuntimeEvolutionVerificationReview({
            candidate: evolution,
            metrics: verificationMetrics,
          });
    evaluation.state =
      targetState === "candidate"
        ? "promoted"
        : targetState === "adopted"
          ? "adopted"
          : "reverted";
    evaluation.updatedAt = now;
    evaluation.metadata = {
      ...toRecord(evaluation.metadata),
      lastTransitionAt: now,
      lastTransitionTo: targetState,
      lastTransitionReason: reason,
      riskReview,
      verificationMetrics,
      verificationReview,
    };
  }

  const invalidatedStrategyIds: string[] = [];
  if (targetState === "reverted") {
    const materializedStrategyId = normalizeText(toRecord(evolution.metadata)?.materializedStrategyId);
    if (materializedStrategyId) {
      const strategy = stores.memoryStore.strategies.find((entry) => entry.id === materializedStrategyId);
      if (strategy && !strategy.invalidatedBy.includes(revertReasonId)) {
        strategy.invalidatedBy = uniqueStrings([...(strategy.invalidatedBy ?? []), revertReasonId]);
        strategy.updatedAt = now;
        strategy.version = nextVersion(strategy);
        strategy.metadata = {
          ...toRecord(strategy.metadata),
          revertedAt: now,
          revertedFromEvolutionId: evolution.id,
          revertedReason: reason,
        };
        invalidatedStrategyIds.push(strategy.id);
      }
    }
  }

  persistStores(stores, {
    ...opts,
    now,
  });

  const materialized =
    targetState === "adopted"
      ? materializeAdoptedEvolutionStrategies({
          ...opts,
          now,
        })
      : { strategyIds: [] };

  appendRuntimeEvent(
    "runtime_evolution_candidate_transitioned",
    {
      candidateId: evolution.id,
      candidateType: evolution.candidateType,
      targetLayer: evolution.targetLayer,
      state: targetState === "reverted" ? "reverted" : evolution.adoptionState,
      reason,
      shadowEvaluationIds: relatedEvaluations.map((entry) => entry.id),
      strategyIds: materialized.strategyIds,
      invalidatedStrategyIds,
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
  const refreshedCandidate =
    refreshedStores.memoryStore.evolutionMemory.find((entry) => entry.id === evolution.id) ?? evolution;

  return {
    candidate: refreshedCandidate,
    shadowEvaluationIds: relatedEvaluations.map((entry) => entry.id),
    state:
      targetState === "reverted"
        ? "reverted"
        : refreshedCandidate.adoptionState,
    strategyIds: materialized.strategyIds,
    invalidatedStrategyIds,
    updatedAt: now,
  };
}

export function acknowledgeRuntimeEvolutionVerification(
  input: AcknowledgeRuntimeEvolutionVerificationInput,
  opts: RuntimeStoreOptions = {},
): AcknowledgeRuntimeEvolutionVerificationResult {
  const now = resolveNow(input.now ?? opts.now);
  const id = normalizeText(input.id);
  if (!id) {
    throw new Error("Evolution candidate id is required");
  }
  const note = normalizeText(input.note) || undefined;
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const evolution = stores.memoryStore.evolutionMemory.find((entry) => entry.id === id);
  if (!evolution) {
    throw new Error(`Unknown evolution candidate: ${id}`);
  }
  if (evolution.adoptionState !== "adopted") {
    throw new Error("Only adopted evolution candidates can acknowledge verification");
  }
  const verificationMetrics = readRuntimeEvolutionVerificationMetrics(evolution.metadata);
  if (!verificationMetrics || verificationMetrics.observationCount < 1) {
    throw new Error("Evolution candidate has no post-adoption verification telemetry");
  }
  const verificationReview = buildRuntimeEvolutionVerificationReview({
    candidate: evolution,
    metrics: verificationMetrics,
  });
  if (verificationReview.state === "pending") {
    throw new Error("Evolution candidate verification is still pending");
  }
  const relatedEvaluations = stores.governanceStore.shadowEvaluations.filter(
    (entry) => entry.candidateRef === evolution.id || entry.candidateRef === evolution.candidateRef,
  );

  evolution.updatedAt = now;
  evolution.metadata = {
    ...toRecord(evolution.metadata),
    verificationAcknowledgedAt: now,
    verificationAcknowledgedNote: note,
    verificationAcknowledgedState: verificationReview.state,
    verificationAcknowledgedObservationCount: verificationMetrics.observationCount,
  };

  for (const evaluation of relatedEvaluations) {
    evaluation.updatedAt = now;
    evaluation.metadata = {
      ...toRecord(evaluation.metadata),
      verificationAcknowledgedAt: now,
      verificationAcknowledgedNote: note,
      verificationAcknowledgedState: verificationReview.state,
      verificationAcknowledgedObservationCount: verificationMetrics.observationCount,
      verificationMetrics,
      verificationReview,
    };
  }

  persistStores(stores, {
    ...opts,
    now,
  });

  appendRuntimeEvent(
    "runtime_evolution_verification_acknowledged",
    {
      candidateId: evolution.id,
      verificationState: verificationReview.state,
      verificationObservationCount: verificationMetrics.observationCount,
      note,
      shadowEvaluationIds: relatedEvaluations.map((entry) => entry.id),
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
  const refreshedCandidate =
    refreshedStores.memoryStore.evolutionMemory.find((entry) => entry.id === evolution.id) ?? evolution;

  return {
    candidate: refreshedCandidate,
    shadowEvaluationIds: relatedEvaluations.map((entry) => entry.id),
    acknowledgedAt: now,
    verificationState: verificationReview.state,
    verificationObservationCount: verificationMetrics.observationCount,
    updatedAt: now,
  };
}

export type RuntimeEvolutionReviewResult = {
  promotedIds: string[];
  adoptedIds: string[];
  strategyIds: string[];
  lastReviewAt: number;
};

export type ConfigureRuntimeEvolutionInput = {
  enabled?: boolean;
  autoApplyLowRisk?: boolean;
  reviewIntervalHours?: number;
};

export type ConfigureRuntimeEvolutionResult = {
  configuredAt: number;
  enabled: boolean;
  autoApplyLowRisk: boolean;
  reviewIntervalHours: number;
};

export function configureRuntimeEvolution(
  input: ConfigureRuntimeEvolutionInput,
  opts: RuntimeStoreOptions = {},
): ConfigureRuntimeEvolutionResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const current = resolveRuntimeEvolutionControls(stores.governanceStore);
  const nextReviewIntervalHours =
    typeof input.reviewIntervalHours === "number" && Number.isFinite(input.reviewIntervalHours)
      ? Math.max(1, Math.min(168, Math.trunc(input.reviewIntervalHours)))
      : current.reviewIntervalHours;
  stores.governanceStore.metadata = {
    ...stores.governanceStore.metadata,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    autoApplyLowRisk:
      typeof input.autoApplyLowRisk === "boolean"
        ? input.autoApplyLowRisk
        : current.autoApplyLowRisk,
    reviewIntervalHours: nextReviewIntervalHours,
    updatedAt: now,
  };
  saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_evolution_configured",
    {
      enabled: stores.governanceStore.metadata?.enabled,
      autoApplyLowRisk: stores.governanceStore.metadata?.autoApplyLowRisk,
      reviewIntervalHours: nextReviewIntervalHours,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    enabled: stores.governanceStore.metadata?.enabled !== false,
    autoApplyLowRisk: stores.governanceStore.metadata?.autoApplyLowRisk === true,
    reviewIntervalHours: nextReviewIntervalHours,
  };
}

export function reviewRuntimeEvolution(
  opts: RuntimeStoreOptions = {},
): RuntimeEvolutionReviewResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const controls = resolveRuntimeEvolutionControls(stores.governanceStore);
  const autoApplied =
    controls.enabled && controls.autoApplyLowRisk
      ? maybeAutoApplyLowRiskEvolution({
          ...opts,
          now,
        })
      : { promotedIds: [], adoptedIds: [] };
  const materialized =
    controls.enabled && controls.autoApplyLowRisk
      ? materializeAdoptedEvolutionStrategies({
          ...opts,
          now,
        })
      : { strategyIds: [] };
  const refreshedStores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  refreshedStores.governanceStore.metadata = {
    ...refreshedStores.governanceStore.metadata,
    enabled: controls.enabled,
    autoApplyLowRisk: controls.autoApplyLowRisk,
    reviewIntervalHours: controls.reviewIntervalHours,
    lastReviewAt: now,
  };
  persistStores(refreshedStores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_evolution_reviewed",
    {
      promotedIds: autoApplied.promotedIds,
      adoptedIds: autoApplied.adoptedIds,
      strategyIds: materialized.strategyIds,
      lastReviewAt: now,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    promotedIds: autoApplied.promotedIds,
    adoptedIds: autoApplied.adoptedIds,
    strategyIds: materialized.strategyIds,
    lastReviewAt: now,
  };
}

export type ReinforceMemoryLineageInput = {
  memoryIds: string[];
  reason?: string;
  sourceTaskId?: string;
  sourceEventId?: string;
  confidenceBoost?: number;
  now?: number;
};

export type ReinforceMemoryLineageResult = {
  reinforcedMemoryIds: string[];
  strengthenedStrategyIds: string[];
  refreshedMetaLearningIds: string[];
  refreshedEvolutionIds: string[];
  eventId?: string;
};

export function reinforceMemoryLineage(
  input: ReinforceMemoryLineageInput,
  opts: RuntimeStoreOptions = {},
): ReinforceMemoryLineageResult {
  const now = resolveNow(input.now ?? opts.now);
  const targetIds = new Set(uniqueStrings(input.memoryIds));
  if (targetIds.size === 0) {
    return {
      reinforcedMemoryIds: [],
      strengthenedStrategyIds: [],
      refreshedMetaLearningIds: [],
      refreshedEvolutionIds: [],
    };
  }
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const confidenceBoost = Math.max(1, Math.min(12, Math.trunc(input.confidenceBoost ?? 6)));
  const reinforcedMemoryIds: string[] = [];
  const strengthenedStrategyIds: string[] = [];
  const refreshedMetaLearningIds: string[] = [];
  const refreshedEvolutionIds: string[] = [];

  for (const memory of stores.memoryStore.memories) {
    if (!targetIds.has(memory.id) || memory.invalidatedBy.length > 0) {
      continue;
    }
    const existingReinforcement = toRecord(toRecord(memory.metadata)?.reinforcement);
    const reinforcementCount =
      typeof existingReinforcement?.count === "number" ? existingReinforcement.count : 0;
    memory.confidence = Math.min(99, memory.confidence + confidenceBoost);
    memory.version = nextVersion(memory);
    memory.lastReinforcedAt = now;
    memory.decayScore = Math.max(0, (memory.decayScore ?? 12) - confidenceBoost);
    memory.updatedAt = now;
    memory.sourceTaskIds = uniqueStrings([...(memory.sourceTaskIds ?? []), input.sourceTaskId]);
    memory.sourceEventIds = uniqueStrings([...(memory.sourceEventIds ?? []), input.sourceEventId]);
    memory.metadata = {
      ...toRecord(memory.metadata),
      reinforcement: {
        reason: normalizeText(input.reason) || "runtime-success",
        count: reinforcementCount + 1,
        lastReinforcedAt: now,
      },
    };
    reinforcedMemoryIds.push(memory.id);
  }

  for (const strategy of stores.memoryStore.strategies) {
    const linkedMemoryIds = uniqueStrings([
      ...(strategy.derivedFromMemoryIds ?? []),
    ]);
    if (
      strategy.invalidatedBy.length > 0 ||
      !linkedMemoryIds.some((memoryId) => targetIds.has(memoryId))
    ) {
      continue;
    }
    strategy.confidence = Math.min(
      96,
      strategy.confidence + Math.max(2, Math.floor(confidenceBoost / 2)),
    );
    strategy.version = nextVersion(strategy);
    strategy.updatedAt = now;
    strategy.metadata = {
      ...toRecord(strategy.metadata),
      reinforcement: {
        reason: normalizeText(input.reason) || "runtime-success",
        lastReinforcedAt: now,
      },
    };
    strengthenedStrategyIds.push(strategy.id);
  }

  const reinforcedMemorySet = new Set(reinforcedMemoryIds);
  const strengthenedStrategySet = new Set(strengthenedStrategyIds);

  for (const learning of stores.memoryStore.metaLearning) {
    const linkedMemoryIds = uniqueStrings(learning.derivedFromMemoryIds ?? []);
    if (
      !linkedMemoryIds.some((memoryId) => reinforcedMemorySet.has(memoryId)) ||
      toRecord(learning.metadata?.lifecycle)?.stale !== true
    ) {
      continue;
    }
    learning.updatedAt = now;
    learning.metadata = writeLifecycleMetadata(toRecord(learning.metadata), {
      stale: false,
      staleReason: undefined,
      agedMemoryIds: [],
      staleAt: undefined,
      clearedAt: now,
      clearedBy: "memory_lineage_reinforced",
      reinforcedMemoryIds: linkedMemoryIds.filter((memoryId) => reinforcedMemorySet.has(memoryId)),
      lastReinforcementAt: now,
    });
    refreshedMetaLearningIds.push(learning.id);
  }

  for (const evolution of stores.memoryStore.evolutionMemory) {
    const linkedMemoryIds = readEvolutionLinkedMemoryIds(evolution);
    const linkedStrategyIds = readEvolutionLinkedStrategyIds(evolution);
    const reinforcedLinks = linkedMemoryIds.filter((memoryId) => reinforcedMemorySet.has(memoryId));
    const strengthenedLinks = linkedStrategyIds.filter((strategyId) =>
      strengthenedStrategySet.has(strategyId),
    );
    if (
      (reinforcedLinks.length === 0 && strengthenedLinks.length === 0) ||
      toRecord(evolution.metadata?.lifecycle)?.stale !== true
    ) {
      continue;
    }
    evolution.updatedAt = now;
    evolution.metadata = writeLifecycleMetadata(toRecord(evolution.metadata), {
      stale: false,
      staleReason: undefined,
      agedMemoryIds: [],
      weakenedStrategyIds: [],
      staleAt: undefined,
      clearedAt: now,
      clearedBy: "memory_lineage_reinforced",
      reinforcedMemoryIds: reinforcedLinks,
      strengthenedStrategyIds: strengthenedLinks,
      lastReinforcementAt: now,
    });
    refreshedEvolutionIds.push(evolution.id);
  }

  if (
    reinforcedMemoryIds.length === 0 &&
    strengthenedStrategyIds.length === 0 &&
    refreshedMetaLearningIds.length === 0 &&
    refreshedEvolutionIds.length === 0
  ) {
    return {
      reinforcedMemoryIds,
      strengthenedStrategyIds,
      refreshedMetaLearningIds,
      refreshedEvolutionIds,
    };
  }

  persistStores(stores, {
    ...opts,
    now,
  });
  const event = appendRuntimeEvent(
    "memory_lineage_reinforced",
    {
      reinforcedMemoryIds,
      strengthenedStrategyIds,
      refreshedMetaLearningIds,
      refreshedEvolutionIds,
      sourceTaskId: input.sourceTaskId,
      sourceEventId: input.sourceEventId,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    reinforcedMemoryIds,
    strengthenedStrategyIds,
    refreshedMetaLearningIds,
    refreshedEvolutionIds,
    eventId: event.id,
  };
}

export type ReviewRuntimeMemoryLifecycleResult = {
  agedMemoryIds: string[];
  weakenedStrategyIds: string[];
  staleMetaLearningIds: string[];
  staleEvolutionIds: string[];
  reviewedAt: number;
  eventId?: string;
};

export type ConfigureRuntimeMemoryLifecycleInput = {
  enabled?: boolean;
  reviewIntervalHours?: number;
  decayGraceDays?: number;
  minDecayIncreasePerReview?: number;
  agePressurePerDay?: number;
  confidencePenaltyDivisor?: number;
  linkedStrategyConfidencePenalty?: number;
  highDecayThreshold?: number;
};

export type ConfigureRuntimeMemoryLifecycleResult = {
  configuredAt: number;
  enabled: boolean;
  reviewIntervalHours: number;
  decayGraceDays: number;
  minDecayIncreasePerReview: number;
  agePressurePerDay: number;
  confidencePenaltyDivisor: number;
  linkedStrategyConfidencePenalty: number;
  highDecayThreshold: number;
};

export function configureRuntimeMemoryLifecycle(
  input: ConfigureRuntimeMemoryLifecycleInput,
  opts: RuntimeStoreOptions = {},
): ConfigureRuntimeMemoryLifecycleResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const current = resolveRuntimeMemoryLifecycleControls(stores.memoryStore.metadata);
  stores.memoryStore.metadata = {
    ...toRecord(stores.memoryStore.metadata),
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    reviewIntervalHours:
      typeof input.reviewIntervalHours === "number" && Number.isFinite(input.reviewIntervalHours)
        ? Math.max(1, Math.min(168, Math.trunc(input.reviewIntervalHours)))
        : current.reviewIntervalHours,
    decayGraceDays:
      typeof input.decayGraceDays === "number" && Number.isFinite(input.decayGraceDays)
        ? Math.max(1, Math.min(90, Math.trunc(input.decayGraceDays)))
        : current.decayGraceDays,
    minDecayIncreasePerReview:
      typeof input.minDecayIncreasePerReview === "number" &&
      Number.isFinite(input.minDecayIncreasePerReview)
        ? Math.max(1, Math.min(25, Math.trunc(input.minDecayIncreasePerReview)))
        : current.minDecayIncreasePerReview,
    agePressurePerDay:
      typeof input.agePressurePerDay === "number" && Number.isFinite(input.agePressurePerDay)
        ? Math.max(1, Math.min(25, Math.trunc(input.agePressurePerDay)))
        : current.agePressurePerDay,
    confidencePenaltyDivisor:
      typeof input.confidencePenaltyDivisor === "number" &&
      Number.isFinite(input.confidencePenaltyDivisor)
        ? Math.max(1, Math.min(20, Math.trunc(input.confidencePenaltyDivisor)))
        : current.confidencePenaltyDivisor,
    linkedStrategyConfidencePenalty:
      typeof input.linkedStrategyConfidencePenalty === "number" &&
      Number.isFinite(input.linkedStrategyConfidencePenalty)
        ? Math.max(1, Math.min(25, Math.trunc(input.linkedStrategyConfidencePenalty)))
        : current.linkedStrategyConfidencePenalty,
    highDecayThreshold:
      typeof input.highDecayThreshold === "number" && Number.isFinite(input.highDecayThreshold)
        ? Math.max(1, Math.min(100, Math.trunc(input.highDecayThreshold)))
        : current.highDecayThreshold,
    updatedAt: now,
  };
  persistStores(stores, {
    ...opts,
    now,
  });
  const controls = resolveRuntimeMemoryLifecycleControls(stores.memoryStore.metadata);
  appendRuntimeEvent(
    "runtime_memory_lifecycle_configured",
    {
      enabled: controls.enabled,
      reviewIntervalHours: controls.reviewIntervalHours,
      decayGraceDays: controls.decayGraceDays,
      minDecayIncreasePerReview: controls.minDecayIncreasePerReview,
      agePressurePerDay: controls.agePressurePerDay,
      confidencePenaltyDivisor: controls.confidencePenaltyDivisor,
      linkedStrategyConfidencePenalty: controls.linkedStrategyConfidencePenalty,
      highDecayThreshold: controls.highDecayThreshold,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    enabled: controls.enabled,
    reviewIntervalHours: controls.reviewIntervalHours,
    decayGraceDays: controls.decayGraceDays,
    minDecayIncreasePerReview: controls.minDecayIncreasePerReview,
    agePressurePerDay: controls.agePressurePerDay,
    confidencePenaltyDivisor: controls.confidencePenaltyDivisor,
    linkedStrategyConfidencePenalty: controls.linkedStrategyConfidencePenalty,
    highDecayThreshold: controls.highDecayThreshold,
  };
}

export function reviewRuntimeMemoryLifecycle(
  opts: RuntimeStoreOptions = {},
): ReviewRuntimeMemoryLifecycleResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const agedMemoryIds: string[] = [];
  const weakenedStrategyIds: string[] = [];
  const staleMetaLearningIds: string[] = [];
  const staleEvolutionIds: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const metadata = toRecord(stores.memoryStore.metadata);
  const controls = resolveRuntimeMemoryLifecycleControls(stores.memoryStore.metadata);

  for (const memory of stores.memoryStore.memories) {
    if (memory.invalidatedBy.length > 0) {
      continue;
    }
    const lastTouch =
      Math.max(memory.lastReinforcedAt ?? 0, memory.updatedAt ?? 0) || memory.createdAt;
    const ageDays = Math.max(0, (now - lastTouch) / dayMs);
    if (ageDays < controls.decayGraceDays) {
      continue;
    }
    const currentDecay = memory.decayScore ?? 0;
    const agePressure = Math.max(
      controls.minDecayIncreasePerReview,
      Math.floor(ageDays * controls.agePressurePerDay),
    );
    const nextDecay = Math.min(
      100,
      Math.max(currentDecay + controls.minDecayIncreasePerReview, agePressure),
    );
    if (nextDecay <= currentDecay) {
      continue;
    }
    const confidencePenalty = Math.max(
      1,
      Math.floor((nextDecay - currentDecay) / controls.confidencePenaltyDivisor),
    );
    memory.decayScore = nextDecay;
    memory.confidence = Math.max(12, memory.confidence - confidencePenalty);
    memory.version = nextVersion(memory);
    memory.updatedAt = now;
    memory.metadata = {
      ...toRecord(memory.metadata),
      lifecycle: {
        lastDecayReviewAt: now,
        ageDays: Math.round(ageDays * 10) / 10,
      },
    };
    agedMemoryIds.push(memory.id);
  }

  const agedSet = new Set(agedMemoryIds);
  for (const strategy of stores.memoryStore.strategies) {
    const linkedMemoryIds = uniqueStrings([
      ...(strategy.derivedFromMemoryIds ?? []),
    ]);
    if (
      strategy.invalidatedBy.length > 0 ||
      !linkedMemoryIds.some((memoryId) => agedSet.has(memoryId))
    ) {
      continue;
    }
    strategy.confidence = Math.max(18, strategy.confidence - controls.linkedStrategyConfidencePenalty);
    strategy.version = nextVersion(strategy);
    strategy.updatedAt = now;
    strategy.metadata = {
      ...(strategy.metadata as Record<string, unknown>),
      lifecycle: {
        lastDecayReviewAt: now,
      },
    };
    weakenedStrategyIds.push(strategy.id);
  }

  const weakenedSet = new Set(weakenedStrategyIds);

  for (const learning of stores.memoryStore.metaLearning) {
    const linkedMemoryIds = uniqueStrings(learning.derivedFromMemoryIds ?? []);
    const staleLinkedMemoryIds = linkedMemoryIds.filter((memoryId) => agedSet.has(memoryId));
    if (staleLinkedMemoryIds.length === 0) {
      continue;
    }
    learning.updatedAt = now;
    learning.metadata = writeLifecycleMetadata(toRecord(learning.metadata), {
      stale: true,
      staleReason: "linked_memory_decay",
      agedMemoryIds: staleLinkedMemoryIds,
      staleAt: now,
      lastDecayReviewAt: now,
    });
    staleMetaLearningIds.push(learning.id);
  }

  for (const evolution of stores.memoryStore.evolutionMemory) {
    const linkedMemoryIds = readEvolutionLinkedMemoryIds(evolution);
    const linkedStrategyIds = readEvolutionLinkedStrategyIds(evolution);
    const staleLinkedMemoryIds = linkedMemoryIds.filter((memoryId) => agedSet.has(memoryId));
    const staleLinkedStrategyIds = linkedStrategyIds.filter((strategyId) => weakenedSet.has(strategyId));
    if (staleLinkedMemoryIds.length === 0 && staleLinkedStrategyIds.length === 0) {
      continue;
    }
    evolution.updatedAt = now;
    evolution.metadata = writeLifecycleMetadata(toRecord(evolution.metadata), {
      stale: true,
      staleReason:
        staleLinkedStrategyIds.length > 0 ? "linked_strategy_decay" : "linked_memory_decay",
      agedMemoryIds: staleLinkedMemoryIds,
      weakenedStrategyIds: staleLinkedStrategyIds,
      staleAt: now,
      lastDecayReviewAt: now,
    });
    staleEvolutionIds.push(evolution.id);
  }

  stores.memoryStore.metadata = {
    ...metadata,
    ...controls,
    lastReviewAt: now,
  };
  persistStores(stores, {
    ...opts,
    now,
  });
  const event = appendRuntimeEvent(
    "runtime_memory_lifecycle_reviewed",
    {
      agedMemoryIds,
      weakenedStrategyIds,
      staleMetaLearningIds,
      staleEvolutionIds,
      reviewedAt: now,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    agedMemoryIds,
    weakenedStrategyIds,
    staleMetaLearningIds,
    staleEvolutionIds,
    reviewedAt: now,
    eventId: event?.id,
  };
}

export type RollbackMemoryInvalidationResult = {
  restoredMemoryIds: string[];
  restoredStrategyIds: string[];
  restoredMetaLearningIds: string[];
  restoredTaskIds: string[];
  restoredEvolutionIds: string[];
  restoredShadowIds: string[];
  rollbackEventId?: string;
};

export function rollbackMemoryInvalidation(
  input: {
    invalidationEventId: string;
    reason?: string;
    now?: number;
  },
  opts: RuntimeStoreOptions = {},
): RollbackMemoryInvalidationResult {
  const now = resolveNow(input.now ?? opts.now);
  const event = readRuntimeEventById(input.invalidationEventId, {
    ...opts,
    now,
  });
  if (!event || event.type !== "memory_lineage_invalidated") {
    throw new Error(`Unknown memory invalidation event: ${input.invalidationEventId}`);
  }
  const rollback = toRecord(event.payload?.rollback);
  const memorySnapshots = Array.isArray(rollback?.memories)
    ? (rollback?.memories as MemoryRecord[])
    : [];
  const strategySnapshots = Array.isArray(rollback?.strategies)
    ? (rollback?.strategies as StrategyRecord[])
    : [];
  const metaLearningSnapshots = Array.isArray(rollback?.metaLearning)
    ? (rollback?.metaLearning as MetaLearningRecord[])
    : [];
  const evolutionSnapshots = Array.isArray(rollback?.evolutionMemory)
    ? (rollback?.evolutionMemory as EvolutionMemoryRecord[])
    : [];
  const shadowSnapshots = Array.isArray(rollback?.shadowEvaluations)
    ? (rollback?.shadowEvaluations as ShadowEvaluationRecord[])
    : [];
  const taskSnapshots = Array.isArray(rollback?.tasks) ? (rollback?.tasks as TaskRecord[]) : [];

  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const reason = normalizeText(input.reason) || "memory invalidation rollback";

  const restoredMemoryIds = memorySnapshots.map((snapshot) =>
    restoreMemorySnapshot(stores.memoryStore, snapshot, now, reason).id,
  );
  const restoredStrategyIds = strategySnapshots.map((snapshot) =>
    restoreStrategySnapshot(stores.memoryStore, snapshot, now, reason).id,
  );
  const restoredMetaLearningIds = metaLearningSnapshots.map((snapshot) =>
    restoreMetaLearningSnapshot(stores.memoryStore, snapshot, now, reason).id,
  );
  const restoredEvolutionIds = evolutionSnapshots.map((snapshot) =>
    upsertEvolutionMemory(stores.memoryStore, {
      ...cloneValue(snapshot),
      updatedAt: now,
      metadata: {
        ...toRecord(snapshot.metadata),
        rollback: {
          reason,
          restoredAt: now,
        },
      },
    }).id,
  );
  const restoredShadowIds = shadowSnapshots.map((snapshot) =>
    upsertShadowEvaluation(stores.governanceStore, {
      ...cloneValue(snapshot),
      updatedAt: now,
      metadata: {
        ...toRecord(snapshot.metadata),
        rollback: {
          reason,
          restoredAt: now,
        },
      },
    }).id,
  );
  const restoredTaskIds = taskSnapshots.map((snapshot) =>
    upsertById(stores.taskStore.tasks, {
      ...cloneValue(snapshot),
      status: snapshot.status,
      nextRunAt: snapshot.nextRunAt,
      blockedReason: snapshot.blockedReason,
      nextAction: snapshot.nextAction,
      updatedAt: now,
      metadata: {
        ...toRecord(snapshot.metadata),
        rollback: {
          reason,
          restoredAt: now,
        },
      },
    }).id,
  );

  persistStores(stores, {
    ...opts,
    now,
  });
  const rollbackEvent = appendRuntimeEvent(
    "memory_invalidation_rolled_back",
    {
      invalidationEventId: input.invalidationEventId,
      restoredMemoryIds,
      restoredStrategyIds,
      restoredMetaLearningIds,
      restoredTaskIds,
      restoredEvolutionIds,
      restoredShadowIds,
      reason,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    restoredMemoryIds,
    restoredStrategyIds,
    restoredMetaLearningIds,
    restoredTaskIds,
    restoredEvolutionIds,
    restoredShadowIds,
    rollbackEventId: rollbackEvent.id,
  };
}
