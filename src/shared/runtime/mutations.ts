import type {
  DecisionRecord,
  EvolutionMemoryRecord,
  MemoryRecord,
  MetaLearningRecord,
  RuntimeGovernanceStore,
  RuntimeMemoryStore,
  RuntimeTaskStore,
  ShadowEvaluationRecord,
  StrategyRecord,
  TaskRecord,
  TaskReview,
  TaskRun,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import { buildTaskLifecycleArtifacts, type TaskLifecycleArtifactsInput } from "./task-artifacts.js";
import { isTerminalTaskStatus } from "./task-loop.js";

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

function truncateText(value: string, maxLength: number): string {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
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

function upsertById<T extends { id: string }>(entries: T[], next: T): T {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    entries.unshift(next);
    return next;
  }
  entries[index] = next;
  return next;
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
  return upsertById(store.metaLearning, entry);
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
    sourceShadowTelemetryIds: uniqueStrings([
      ...(existing.sourceShadowTelemetryIds ?? []),
      ...(entry.sourceShadowTelemetryIds ?? []),
    ]),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
  };
  return upsertById(store.evolutionMemory, merged);
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
    observationCount: Math.max(existing.observationCount, entry.observationCount),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    metadata: {
      ...existing.metadata,
      ...entry.metadata,
    },
  };
  return upsertById(store.shadowEvaluations, merged);
}

export type PersistedTaskLifecycleResult = {
  taskStore: RuntimeTaskStore;
  task: TaskRecord;
  run: TaskRun;
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
    sourceEventIds: [],
    sourceTaskIds: [task.id],
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
    sourceEventIds: [],
    sourceTaskIds: [task.id],
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
    sourceEventIds: [],
    sourceTaskIds: [task.id],
    sourceIntelIds: [],
    derivedFromMemoryIds: [executionMemory.id, efficiencyMemory.id],
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
    sourceTaskIds: [task.id],
    sourceReviewIds: review?.id ? [review.id] : [],
    sourceMemoryIds: [executionMemory.id, efficiencyMemory.id],
    createdAt: now,
    updatedAt: now,
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
      memoryIds: [executionMemory.id, efficiencyMemory.id],
      strategyIds: [strategy.id],
      reviewId: review?.id,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    memories: [executionMemory, efficiencyMemory],
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
  invalidatedMemoryIds: string[];
  invalidatedStrategyIds: string[];
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
  const requeuedTaskIds = new Set<string>();

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
      invalidatedMemoryIds.add(memory.id);
      const invalidatedBy = uniqueStrings([...(memory.invalidatedBy ?? []), input.reasonEventId]);
      if (invalidatedBy.length !== memory.invalidatedBy.length) {
        memory.invalidatedBy = invalidatedBy;
        memory.confidence = Math.max(5, Math.round(memory.confidence * 0.45));
        memory.decayScore = Math.max(memory.decayScore ?? 0, 65);
        memory.updatedAt = now;
      }
      if (memory.id !== currentId && !targetIds.has(memory.id)) {
        targetIds.add(memory.id);
        pending.push(memory.id);
      }
    }
  }

  for (const strategy of stores.memoryStore.strategies) {
    if (!strategy.derivedFromMemoryIds.some((memoryId) => invalidatedMemoryIds.has(memoryId))) {
      continue;
    }
    invalidatedStrategyIds.add(strategy.id);
    strategy.invalidatedBy = uniqueStrings([
      ...(strategy.invalidatedBy ?? []),
      input.reasonEventId,
    ]);
    strategy.confidence = Math.max(5, Math.round(strategy.confidence * 0.5));
    strategy.updatedAt = now;
  }

  for (const evolution of stores.memoryStore.evolutionMemory) {
    if (!evolution.sourceTaskIds.some(Boolean) && !evolution.sourceReviewIds.some(Boolean)) {
      continue;
    }
    if (!stores.memoryStore.strategies.some((strategy) => strategy.id === evolution.candidateRef)) {
      continue;
    }
    if (invalidatedStrategyIds.has(evolution.candidateRef || "")) {
      evolution.adoptionState = "shadow";
      evolution.updatedAt = now;
    }
  }

  for (const shadow of stores.governanceStore.shadowEvaluations) {
    if (!invalidatedStrategyIds.has(shadow.candidateRef || "")) {
      continue;
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
    task.memoryRefs = (task.memoryRefs ?? []).filter(
      (memoryId) => !invalidatedMemoryIds.has(memoryId),
    );
    task.status = "queued";
    task.nextRunAt = now;
    task.blockedReason = "相关记忆已失效，任务将重新规划。";
    task.nextAction = "相关记忆已失效，重新规划任务。";
    task.updatedAt = now;
    requeuedTaskIds.add(task.id);
  }

  persistStores(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "memory_lineage_invalidated",
    {
      reasonEventId: input.reasonEventId,
      invalidatedMemoryIds: [...invalidatedMemoryIds],
      invalidatedStrategyIds: [...invalidatedStrategyIds],
      requeuedTaskIds: [...requeuedTaskIds],
    },
    {
      ...opts,
      now,
    },
  );

  return {
    invalidatedMemoryIds: [...invalidatedMemoryIds],
    invalidatedStrategyIds: [...invalidatedStrategyIds],
    requeuedTaskIds: [...requeuedTaskIds],
  };
}

export type ObserveTaskOutcomeForEvolutionInput = {
  task: TaskRecord;
  review?: TaskReview | null;
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
  const sourceReviewIds = input.review?.id ? [input.review.id] : [];
  const evolutionRecords: EvolutionMemoryRecord[] = [];
  const shadowEvaluations: ShadowEvaluationRecord[] = [];

  const laneCandidateId = buildStableId("evolution_lane", [input.task.route, lane]);
  const laneEvaluationId = buildStableId("shadow_lane", [input.task.route, lane]);
  const laneEvaluation = upsertShadowEvaluation(stores.governanceStore, {
    id: laneEvaluationId,
    candidateType: "route_default_lane",
    targetLayer: "decision",
    state: "shadow",
    baselineRef: `${input.task.route}:baseline`,
    candidateRef: laneCandidateId,
    expectedEffect: "Prefer the default lane with lower latency and stable completion.",
    measuredEffect: `completion=${completionScore}`,
    observationCount:
      (stores.governanceStore.shadowEvaluations.find((entry) => entry.id === laneEvaluationId)
        ?.observationCount ?? 0) + 1,
    updatedAt: now,
    metadata: {
      route: input.task.route,
      lane,
      taskId: input.task.id,
      status: input.task.status,
    },
  });
  shadowEvaluations.push(laneEvaluation);
  evolutionRecords.push(
    upsertEvolutionMemory(stores.memoryStore, {
      id: laneCandidateId,
      layer: "evolution_memory",
      candidateType: "route_default_lane",
      targetLayer: "decision",
      summary: `${input.task.route} 高频任务默认采用 ${lane} 决策通道。`,
      adoptionState: "shadow",
      baselineRef: `${input.task.route}:baseline`,
      candidateRef: `${input.task.route}:${lane}`,
      sourceTaskIds: [input.task.id],
      sourceReviewIds,
      sourceShadowTelemetryIds: [laneEvaluation.id],
      createdAt: now,
      updatedAt: now,
      metadata: {
        route: input.task.route,
        lane,
        worker: input.task.worker || "main",
        skillIds: input.task.skillIds,
        completionScore,
      },
    }),
  );

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
    const skillEvaluation = upsertShadowEvaluation(stores.governanceStore, {
      id: skillEvaluationId,
      candidateType: "route_skill_bundle",
      targetLayer: "task_loop",
      state: "shadow",
      baselineRef: `${input.task.route}:route-native`,
      candidateRef: skillCandidateId,
      expectedEffect: "Prefer the observed stable skill bundle before escalating.",
      measuredEffect: `completion=${completionScore}`,
      observationCount:
        (stores.governanceStore.shadowEvaluations.find((entry) => entry.id === skillEvaluationId)
          ?.observationCount ?? 0) + 1,
      updatedAt: now,
      metadata: {
        route: input.task.route,
        lane,
        taskId: input.task.id,
        skillIds: input.task.skillIds,
        status: input.task.status,
      },
    });
    shadowEvaluations.push(skillEvaluation);
    evolutionRecords.push(
      upsertEvolutionMemory(stores.memoryStore, {
        id: skillCandidateId,
        layer: "evolution_memory",
        candidateType: "route_skill_bundle",
        targetLayer: "task_loop",
        summary: `${input.task.route} 路由优先技能组合：${input.task.skillIds.join(", ")}。`,
        adoptionState: "shadow",
        baselineRef: `${input.task.route}:route-native`,
        candidateRef: `${input.task.route}:${input.task.worker || "main"}:${hashText(input.task.skillIds.join("|"))}`,
        sourceTaskIds: [input.task.id],
        sourceReviewIds,
        sourceShadowTelemetryIds: [skillEvaluation.id],
        createdAt: now,
        updatedAt: now,
        metadata: {
          route: input.task.route,
          lane,
          worker: input.task.worker || "main",
          skillIds: input.task.skillIds,
          completionScore,
        },
      }),
    );
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
  const promotedIds: string[] = [];
  const adoptedIds: string[] = [];

  for (const evolution of stores.memoryStore.evolutionMemory) {
    const evaluations = stores.governanceStore.shadowEvaluations.filter(
      (entry) =>
        entry.candidateRef === evolution.id || entry.candidateRef === evolution.candidateRef,
    );
    const observationCount = evaluations.reduce(
      (count, entry) => Math.max(count, entry.observationCount),
      0,
    );
    if (evolution.adoptionState === "shadow" && observationCount >= 3) {
      evolution.adoptionState = "candidate";
      evolution.updatedAt = now;
      promotedIds.push(evolution.id);
      continue;
    }
    if (evolution.adoptionState === "candidate" && observationCount >= 5) {
      evolution.adoptionState = "adopted";
      evolution.updatedAt = now;
      adoptedIds.push(evolution.id);
    }
  }

  for (const evaluation of stores.governanceStore.shadowEvaluations) {
    if (adoptedIds.includes(evaluation.candidateRef || "")) {
      evaluation.state = "adopted";
      evaluation.updatedAt = now;
    } else if (promotedIds.includes(evaluation.candidateRef || "")) {
      evaluation.state = "promoted";
      evaluation.updatedAt = now;
    }
  }

  if (promotedIds.length > 0 || adoptedIds.length > 0) {
    persistStores(stores, {
      ...opts,
      now,
    });
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
    if (evolution.adoptionState !== "adopted") {
      continue;
    }
    if (
      evolution.candidateType !== "route_default_lane" &&
      evolution.candidateType !== "route_skill_bundle"
    ) {
      continue;
    }
    const metadata = evolution.metadata ?? {};
    const route = normalizeText(metadata.route) || "general";
    const worker = normalizeText(metadata.worker) || "main";
    const lane = normalizeText(metadata.lane) === "system2" ? "system2" : "system1";
    const skillIds = Array.isArray(metadata.skillIds)
      ? uniqueStrings(
          metadata.skillIds.filter((value): value is string => typeof value === "string"),
        )
      : [];
    const strategy = upsertStrategy(stores.memoryStore, {
      id: buildStableId("adopted_evolution_strategy", [route, worker, lane, skillIds.join("|")]),
      layer: "strategies",
      route,
      worker,
      skillIds,
      summary: evolution.summary,
      triggerConditions: evolution.summary,
      recommendedPath:
        evolution.candidateType === "route_default_lane"
          ? `优先按 ${lane} 通道决策，再交给 ${worker} 执行。`
          : `优先使用技能组合：${skillIds.join(", ") || "route-native-skills"}。`,
      fallbackPath: "当新策略失效时回退到 route-native baseline。",
      thinkingLane: lane,
      confidence: 84,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: evolution.sourceTaskIds,
      sourceIntelIds: [],
      derivedFromMemoryIds: [],
      measuredEffect: {
        materializedFrom: evolution.id,
        candidateType: evolution.candidateType,
      },
      createdAt: now,
      updatedAt: now,
      metadata: {
        materializedFromEvolutionId: evolution.id,
      },
    });
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

export type RuntimeEvolutionReviewResult = {
  promotedIds: string[];
  adoptedIds: string[];
  strategyIds: string[];
  lastReviewAt: number;
};

export function reviewRuntimeEvolution(
  opts: RuntimeStoreOptions = {},
): RuntimeEvolutionReviewResult {
  const now = resolveNow(opts.now);
  const autoApplied = maybeAutoApplyLowRiskEvolution({
    ...opts,
    now,
  });
  const materialized = materializeAdoptedEvolutionStrategies({
    ...opts,
    now,
  });
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  stores.governanceStore.metadata = {
    ...stores.governanceStore.metadata,
    enabled: stores.governanceStore.metadata?.enabled !== false,
    autoApplyLowRisk: stores.governanceStore.metadata?.autoApplyLowRisk !== false,
    reviewIntervalHours: Number(stores.governanceStore.metadata?.reviewIntervalHours) || 12,
    lastReviewAt: now,
  };
  persistStores(stores, {
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
