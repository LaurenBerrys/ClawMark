import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeIntelStore, TaskRecord, TaskReview, TaskRun } from "./contracts.js";
import {
  acknowledgeRuntimeEvolutionVerification,
  configureRuntimeEvolution,
  configureRuntimeMemoryLifecycle,
  distillTaskOutcomeToMemory,
  invalidateMemoryLineage,
  maybeAutoApplyLowRiskEvolution,
  observeTaskOutcomeForEvolution,
  promotePinnedIntelToKnowledgeMemory,
  reinforceMemoryLineage,
  reviewRuntimeMemoryLifecycle,
  rollbackMemoryInvalidation,
  setRuntimeEvolutionCandidateState,
} from "./mutations.js";
import {
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  saveRuntimeGovernanceStore,
  saveRuntimeIntelStore,
  saveRuntimeMemoryStore,
  saveRuntimeTaskStore,
} from "./store.js";

function materializedStrategyIdFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  const value = (metadata as { materializedStrategyId?: unknown }).materializedStrategyId;
  return typeof value === "string" ? value : "";
}

async function withTempRoot(
  prefix: string,
  run: (root: string, env: NodeJS.ProcessEnv) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const env = {
    OPENCLAW_INSTANCE_ROOT: path.join(root, "instance"),
    OPENCLAW_DATA_ROOT: path.join(root, "instance", "data"),
    OPENCLAW_RUNTIME_ROOT: path.join(root, "instance", "runtime"),
    OPENCLAW_STATE_ROOT: path.join(root, "instance", "state"),
    OPENCLAW_CONFIG_ROOT: path.join(root, "instance", "config"),
    OPENCLAW_EXTENSIONS_ROOT: path.join(root, "instance", "extensions"),
    OPENCLAW_ARCHIVE_ROOT: path.join(root, "instance", "archive"),
    OPENCLAW_WORKSPACE_ROOT: path.join(root, "instance", "workspace"),
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function buildTask(now: number, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Repair runtime memory path",
    route: "coder",
    status: "completed",
    priority: "high",
    budgetMode: "balanced",
    retrievalMode: "light",
    goal: "Move runtime memory ownership into the new store",
    successCriteria: "Dashboard reads only from the new store",
    tags: ["runtime", "memory"],
    worker: "main",
    skillIds: ["patch-edit", "test-verify"],
    memoryRefs: [],
    artifactRefs: ["artifact-1"],
    recurring: false,
    maintenance: false,
    planSummary: "Persist runtime artifacts into the authoritative store.",
    nextAction: "Write the canonical runtime store.",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildReview(now: number, overrides: Partial<TaskReview> = {}): TaskReview {
  return {
    id: "review-1",
    taskId: "task-1",
    runId: "run-1",
    summary: "The runtime store now owns the imported task and memory state.",
    outcome: "success",
    extractedMemoryIds: [],
    strategyCandidateIds: [],
    createdAt: now,
    ...overrides,
  };
}

function buildRun(now: number, overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    taskId: "task-1",
    status: "completed",
    thinkingLane: "system1",
    startedAt: now - 5 * 60 * 1000,
    updatedAt: now,
    completedAt: now,
    metadata: {
      remoteCallCount: 1,
    },
    ...overrides,
  };
}

describe("runtime mutations", () => {
  it("persists auto-canary evolution controls in governance metadata", async () => {
    await withTempRoot("openclaw-runtime-evolution-config-", async (_root, env) => {
      const now = 1_700_099_000_000;
      const configured = configureRuntimeEvolution(
        {
          enabled: true,
          autoApplyLowRisk: true,
          autoCanaryEvolution: true,
          reviewIntervalHours: 24,
        },
        { env, now },
      );
      const governanceStore = loadRuntimeGovernanceStore({ env, now });

      expect(configured).toMatchObject({
        enabled: true,
        autoApplyLowRisk: true,
        autoCanaryEvolution: true,
        reviewIntervalHours: 24,
      });
      expect(governanceStore.metadata).toMatchObject({
        enabled: true,
        autoApplyLowRisk: true,
        autoCanaryEvolution: true,
        reviewIntervalHours: 24,
      });
    });
  });

  it("distills a terminal task outcome into formal memory and strategy records", async () => {
    await withTempRoot("openclaw-runtime-mutations-", async (_root, env) => {
      const now = 1_700_100_000_000;
      const result = distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });

      expect(result.memories).toHaveLength(4);
      expect(result.strategies).toHaveLength(1);
      expect(result.metaLearning).toHaveLength(1);
      expect(memoryStore.memories.map((entry) => entry.memoryType).toSorted()).toEqual([
        "completion",
        "efficiency",
        "execution",
        "resource",
      ]);
      expect(memoryStore.strategies[0]?.route).toBe("coder");
      expect(memoryStore.strategies[0]?.sourceReviewIds).toEqual(["review-1"]);
      expect(memoryStore.strategies[0]?.derivedFromMemoryIds.length).toBeGreaterThanOrEqual(2);
      expect(memoryStore.metaLearning[0]?.adoptedAs).toBe("strategy");
    });
  });

  it("invalidates downstream memory and requeues active tasks that reference it", async () => {
    await withTempRoot("openclaw-runtime-invalidation-", async (_root, env) => {
      const now = 1_700_200_000_000;
      const distilled = distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const taskStore = loadRuntimeTaskStore({ env, now });
      taskStore.tasks = [
        buildTask(now + 100, {
          id: "task-replan",
          status: "running",
          memoryRefs: [distilled.memories[0].id],
          updatedAt: now + 100,
        }),
      ];
      saveRuntimeTaskStore(taskStore, { env, now: now + 100 });

      const result = invalidateMemoryLineage(
        {
          memoryIds: [distilled.memories[0].id],
          reasonEventId: "event-memory-invalid",
          now: now + 200,
        },
        { env, now: now + 200 },
      );

      const nextTaskStore = loadRuntimeTaskStore({ env, now: now + 200 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 200 });

      expect(result.invalidatedMemoryIds).toContain(distilled.memories[0].id);
      expect(result.invalidationEventId).toContain("runtime-event-");
      expect(result.invalidatedStrategyIds.length).toBeGreaterThan(0);
      expect(result.invalidatedMetaLearningIds).toEqual([distilled.metaLearning[0].id]);
      expect(result.requeuedTaskIds).toEqual(["task-replan"]);
      expect(nextTaskStore.tasks[0]?.status).toBe("queued");
      expect(nextTaskStore.tasks[0]?.memoryRefs).toEqual([]);
      expect(nextTaskStore.tasks[0]?.activeRunId).toBeUndefined();
      expect(nextTaskStore.tasks[0]?.leaseOwner).toBeUndefined();
      expect(nextTaskStore.tasks[0]?.leaseExpiresAt).toBeUndefined();
      expect(nextTaskStore.tasks[0]?.planSummary).toContain("重建执行计划");
      expect(nextTaskStore.tasks[0]?.nextAction).toContain("重新规划");
      expect(
        (
          nextTaskStore.tasks[0]?.metadata as {
            runtimeTask?: {
              optimizationState?: {
                needsReplan?: boolean;
                invalidatedBy?: string[];
                invalidatedMemoryIds?: string[];
              };
            };
          }
        )?.runtimeTask?.optimizationState?.needsReplan,
      ).toBe(true);
      expect(
        (
          nextTaskStore.tasks[0]?.metadata as {
            runtimeTask?: {
              optimizationState?: {
                invalidatedBy?: string[];
                invalidatedMemoryIds?: string[];
              };
            };
          }
        )?.runtimeTask?.optimizationState?.invalidatedBy ?? [],
      ).toContain("event-memory-invalid");
      expect(
        (
          nextTaskStore.tasks[0]?.metadata as {
            runtimeTask?: {
              optimizationState?: {
                invalidatedBy?: string[];
                invalidatedMemoryIds?: string[];
              };
            };
          }
        )?.runtimeTask?.optimizationState?.invalidatedMemoryIds ?? [],
      ).toContain(distilled.memories[0].id);
      expect(nextMemoryStore.memories[0]?.invalidatedBy).toContain("event-memory-invalid");
      expect(nextMemoryStore.metaLearning[0]?.adoptedAs).toBe("shadow");
    });
  });

  it("rolls back an invalidation event and restores the prior lineage state", async () => {
    await withTempRoot("openclaw-runtime-rollback-", async (_root, env) => {
      const now = 1_700_205_000_000;
      const distilled = distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const taskStore = loadRuntimeTaskStore({ env, now });
      taskStore.tasks = [
        buildTask(now + 100, {
          id: "task-rollback",
          status: "running",
          memoryRefs: [distilled.memories[0].id],
          updatedAt: now + 100,
        }),
      ];
      saveRuntimeTaskStore(taskStore, { env, now: now + 100 });

      const invalidated = invalidateMemoryLineage(
        {
          memoryIds: [distilled.memories[0].id],
          reasonEventId: "event-memory-invalid",
          now: now + 200,
        },
        { env, now: now + 200 },
      );
      const rolledBack = rollbackMemoryInvalidation(
        {
          invalidationEventId: invalidated.invalidationEventId,
          now: now + 300,
        },
        { env, now: now + 300 },
      );

      const nextTaskStore = loadRuntimeTaskStore({ env, now: now + 300 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 300 });

      expect(rolledBack.restoredMemoryIds).toContain(distilled.memories[0].id);
      expect(rolledBack.restoredMetaLearningIds).toContain(distilled.metaLearning[0].id);
      expect(rolledBack.restoredTaskIds).toEqual(["task-rollback"]);
      expect(nextTaskStore.tasks[0]?.status).toBe("running");
      expect(nextTaskStore.tasks[0]?.memoryRefs).toEqual([distilled.memories[0].id]);
      expect(nextTaskStore.tasks[0]?.activeRunId).toBeUndefined();
      expect(
        (
          nextTaskStore.tasks[0]?.metadata as {
            runtimeTask?: {
              optimizationState?: {
                needsReplan?: boolean;
                invalidatedBy?: string[];
                invalidatedMemoryIds?: string[];
              };
            };
          }
        )?.runtimeTask?.optimizationState?.needsReplan ?? false,
      ).toBe(false);
      expect(
        (
          nextTaskStore.tasks[0]?.metadata as {
            runtimeTask?: {
              optimizationState?: {
                invalidatedBy?: string[];
                invalidatedMemoryIds?: string[];
              };
            };
          }
        )?.runtimeTask?.optimizationState?.invalidatedBy ?? [],
      ).toEqual([]);
      expect(
        nextMemoryStore.memories.find((entry) => entry.id === distilled.memories[0].id)
          ?.invalidatedBy,
      ).toEqual([]);
      expect(
        nextMemoryStore.metaLearning.find((entry) => entry.id === distilled.metaLearning[0].id)
          ?.adoptedAs,
      ).toBe("strategy");
    });
  });

  it("promotes a manually pinned intel item into knowledge memory", async () => {
    await withTempRoot("openclaw-runtime-intel-pin-", async (_root, env) => {
      const now = 1_700_210_000_000;
      const intelStore: RuntimeIntelStore = {
        version: "v1",
        enabled: true,
        digestEnabled: true,
        candidateLimitPerDomain: 20,
        digestItemLimitPerDomain: 10,
        exploitItemsPerDigest: 8,
        exploreItemsPerDigest: 2,
        candidates: [
          {
            id: "intel-1",
            domain: "ai",
            sourceId: "openai-news",
            title: "Runtime memory safety update",
            url: "https://example.test/runtime-memory",
            summary: "Memory invalidation now emits rollback-ready events.",
            score: 91,
            selected: true,
            createdAt: now,
            metadata: {
              tags: ["runtime", "memory"],
            },
          },
        ],
        digestItems: [],
        sourceProfiles: [],
        topicProfiles: [],
        usefulnessRecords: [],
        rankRecords: [],
        pinnedRecords: [],
      };
      saveRuntimeIntelStore(intelStore, { env, now });

      const result = promotePinnedIntelToKnowledgeMemory(
        {
          intelId: "intel-1",
          promotedBy: "runtime-user",
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const nextIntelStore = loadRuntimeIntelStore({ env, now: now + 10 });

      expect(result.memory.memoryType).toBe("knowledge");
      expect(result.memory.sourceIntelIds).toEqual(["intel-1"]);
      expect(nextIntelStore.pinnedRecords[0]?.promotedToMemoryId).toBe(result.memory.id);
      expect(nextIntelStore.usefulnessRecords[0]).toMatchObject({
        intelId: "intel-1",
        sourceId: "openai-news",
        domain: "ai",
        usefulnessScore: 95,
        reason: "manual_pin_to_knowledge",
      });
      expect(nextMemoryStore.memories.some((entry) => entry.id === result.memory.id)).toBe(true);
    });
  });

  it("promotes, adopts, and reverts evolution candidates with strategy materialization", async () => {
    await withTempRoot("openclaw-runtime-evolution-transition-", async (_root, env) => {
      const now = 1_700_215_000_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now),
          review: buildReview(now),
          thinkingLane: "system1",
          now,
        },
        { env, now },
      );

      const candidate =
        observed.evolutionRecords.find((entry) => entry.candidateType === "route_skill_bundle") ??
        observed.evolutionRecords[0];
      if (!candidate) {
        throw new Error("expected evolution candidate");
      }
      expect(
        (candidate.metadata as { riskReview?: { riskLevel?: string; autoApplyEligible?: boolean } })
          ?.riskReview,
      ).toMatchObject({
        riskLevel: "low",
        autoApplyEligible: true,
      });

      const promoted = setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "candidate",
          reason: "manual-promote",
          now: now + 10,
        },
        { env, now: now + 10 },
      );
      expect(promoted.candidate.adoptionState).toBe("candidate");

      const adopted = setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "adopted",
          reason: "manual-adopt",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      let memoryStore = loadRuntimeMemoryStore({ env, now: now + 20 });
      let governanceStore = loadRuntimeGovernanceStore({ env, now: now + 20 });
      const adoptedCandidate = memoryStore.evolutionMemory.find(
        (entry) => entry.id === candidate.id,
      );
      const materializedStrategyId = materializedStrategyIdFromMetadata(adoptedCandidate?.metadata);

      expect(adopted.state).toBe("adopted");
      expect(materializedStrategyId).toBeTruthy();
      expect(
        memoryStore.strategies.find((entry) => entry.id === materializedStrategyId)?.invalidatedBy,
      ).toEqual([]);
      expect(
        governanceStore.shadowEvaluations.find(
          (entry) =>
            entry.candidateRef === candidate.id || entry.candidateRef === candidate.candidateRef,
        )?.state,
      ).toBe("adopted");

      const reverted = setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "reverted",
          reason: "manual-revert",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      memoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      governanceStore = loadRuntimeGovernanceStore({ env, now: now + 30 });
      expect(reverted.state).toBe("reverted");
      expect(
        memoryStore.evolutionMemory.find((entry) => entry.id === candidate.id)?.adoptionState,
      ).toBe("shadow");
      expect(
        memoryStore.strategies.find((entry) => entry.id === materializedStrategyId)?.invalidatedBy
          .length,
      ).toBeGreaterThan(0);
      expect(
        governanceStore.shadowEvaluations.find(
          (entry) =>
            entry.candidateRef === candidate.id || entry.candidateRef === candidate.candidateRef,
        )?.state,
      ).toBe("reverted");

      setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "adopted",
          reason: "manual-readopt",
          now: now + 40,
        },
        { env, now: now + 40 },
      );

      memoryStore = loadRuntimeMemoryStore({ env, now: now + 40 });
      expect(
        memoryStore.strategies.find((entry) => entry.id === materializedStrategyId)?.invalidatedBy,
      ).toEqual([]);
      expect(
        memoryStore.strategies.find((entry) => entry.id === materializedStrategyId)?.metadata
          ?.reactivatedFromEvolutionId,
      ).toBe(candidate.id);
    });
  });

  it("keeps medium-risk evolution candidates out of auto-apply even after repeated observations", async () => {
    await withTempRoot("openclaw-runtime-evolution-medium-risk-", async (_root, env) => {
      const now = 1_700_216_000_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now, {
            route: "ops",
            worker: "reviewer",
            skillIds: ["browser", "patch-edit"],
          }),
          review: buildReview(now, {
            id: "review-medium-risk",
            taskId: "task-1",
            runId: "run-medium-risk",
          }),
          thinkingLane: "system2",
          now,
        },
        { env, now },
      );

      const candidate =
        observed.evolutionRecords.find((entry) => entry.candidateType === "route_skill_bundle") ??
        observed.evolutionRecords[0];
      if (!candidate) {
        throw new Error("expected evolution candidate");
      }
      expect(() =>
        setRuntimeEvolutionCandidateState(
          {
            id: candidate.id,
            state: "adopted",
            now: now + 5,
          },
          { env, now: now + 5 },
        ),
      ).toThrow(/manual approval reason/i);

      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 1 });
      for (const evaluation of governanceStore.shadowEvaluations) {
        if (
          evaluation.candidateRef === candidate.id ||
          evaluation.candidateRef === candidate.candidateRef
        ) {
          evaluation.observationCount = 6;
          evaluation.updatedAt = now + 1;
        }
      }
      governanceStore.metadata = {
        ...governanceStore.metadata,
        enabled: true,
        autoApplyLowRisk: true,
        autoCanaryEvolution: true,
        reviewIntervalHours: 1,
      };
      saveRuntimeGovernanceStore(governanceStore, { env, now: now + 1 });

      const result = maybeAutoApplyLowRiskEvolution({ env, now: now + 10 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const nextCandidate = nextMemoryStore.evolutionMemory.find(
        (entry) => entry.id === candidate.id,
      );

      expect(result.promotedIds).toEqual([]);
      expect(result.adoptedIds).toEqual([]);
      expect(nextCandidate?.adoptionState).toBe("shadow");
      expect(
        (
          nextCandidate?.metadata as {
            riskReview?: {
              riskLevel?: string;
              autoApplyEligible?: boolean;
              requiresReasonOnAdopt?: boolean;
            };
          }
        )?.riskReview,
      ).toMatchObject({
        riskLevel: "medium",
        autoApplyEligible: false,
        requiresReasonOnAdopt: true,
      });
    });
  });

  it("requires healthy structured telemetry before auto-applying low-risk evolution candidates", async () => {
    await withTempRoot("openclaw-runtime-evolution-metrics-gate-", async (_root, env) => {
      const now = 1_700_217_000_000;
      const governanceStore = loadRuntimeGovernanceStore({ env, now });
      governanceStore.metadata = {
        ...governanceStore.metadata,
        enabled: true,
        autoApplyLowRisk: true,
        reviewIntervalHours: 1,
      };
      saveRuntimeGovernanceStore(governanceStore, { env, now });

      for (let index = 0; index < 5; index += 1) {
        const observedAt = now + index * 1000;
        observeTaskOutcomeForEvolution(
          {
            task: buildTask(observedAt, {
              status: "waiting_user",
              skillIds: ["patch-edit"],
              updatedAt: observedAt,
            }),
            review: buildReview(observedAt, {
              id: `review-metrics-${index}`,
              runId: `run-metrics-${index}`,
              outcome: "partial",
              summary: "Still waiting on the user.",
            }),
            run: buildRun(observedAt, {
              id: `run-metrics-${index}`,
              status: "waiting_user",
              completedAt: undefined,
              updatedAt: observedAt,
              metadata: {
                remoteCallCount: 4,
              },
            }),
            thinkingLane: "system1",
            completionScore: 45,
            now: observedAt,
          },
          { env, now: observedAt },
        );
      }

      const result = maybeAutoApplyLowRiskEvolution({ env, now: now + 10_000 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 10_000 });
      const candidate = memoryStore.evolutionMemory.find(
        (entry) => entry.candidateType === "route_skill_bundle",
      );
      const metrics = (candidate?.metadata as { observationMetrics?: Record<string, number> })
        ?.observationMetrics;
      const autoApplyStatus = (
        candidate?.metadata as {
          autoApplyStatus?: { promoteReady?: boolean; adoptReady?: boolean; blockers?: string[] };
        }
      )?.autoApplyStatus;

      expect(result.promotedIds).toEqual([]);
      expect(result.adoptedIds).toEqual([]);
      expect(candidate?.adoptionState).toBe("shadow");
      expect(metrics).toMatchObject({
        observationCount: 5,
        waitingUserCount: 5,
      });
      expect(Number(metrics?.successRate ?? 1)).toBeLessThan(0.6);
      expect(Number(metrics?.averageInterruptionCount ?? 0)).toBeGreaterThanOrEqual(1);
      expect(Number(metrics?.regressionRiskScore ?? 0)).toBeGreaterThan(0.34);
      expect(autoApplyStatus).toMatchObject({
        promoteReady: false,
        adoptReady: false,
      });
      expect(autoApplyStatus?.blockers?.join(" ")).toMatch(
        /success rate|regression risk|interruptions/i,
      );
      expect(
        (
          candidate?.metadata as {
            riskReview?: { riskLevel?: string; autoApplyEligible?: boolean };
          }
        )?.riskReview,
      ).toMatchObject({
        riskLevel: "low",
        autoApplyEligible: true,
      });
    });
  });

  it("caps low-risk evolution auto-apply at candidate when auto-canary evolution is disabled", async () => {
    await withTempRoot("openclaw-runtime-evolution-manual-adopt-", async (_root, env) => {
      const now = 1_700_219_000_000;
      const governanceStore = loadRuntimeGovernanceStore({ env, now });
      governanceStore.metadata = {
        ...governanceStore.metadata,
        enabled: true,
        autoApplyLowRisk: true,
        autoCanaryEvolution: false,
        reviewIntervalHours: 1,
      };
      saveRuntimeGovernanceStore(governanceStore, { env, now });

      for (let index = 0; index < 5; index += 1) {
        const observedAt = now + index * 1000;
        observeTaskOutcomeForEvolution(
          {
            task: buildTask(observedAt, {
              id: `task-auto-canary-${index}`,
              status: "completed",
              route: "coder",
              worker: "main",
              skillIds: [],
              updatedAt: observedAt,
            }),
            review: buildReview(observedAt, {
              id: `review-auto-canary-${index}`,
              taskId: `task-auto-canary-${index}`,
              runId: `run-auto-canary-${index}`,
              summary: "Stable route execution observed.",
            }),
            run: buildRun(observedAt, {
              id: `run-auto-canary-${index}`,
            }),
            thinkingLane: "system1",
            completionScore: 95,
            now: observedAt,
          },
          { env, now: observedAt },
        );
      }

      const promoted = maybeAutoApplyLowRiskEvolution({ env, now: now + 10_000 });
      const capped = maybeAutoApplyLowRiskEvolution({ env, now: now + 11_000 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 11_000 });
      const candidate = memoryStore.evolutionMemory.find(
        (entry) => entry.candidateType === "route_default_lane",
      );
      const autoApplyStatus = (
        candidate?.metadata as {
          autoApplyStatus?: { promoteReady?: boolean; adoptReady?: boolean };
        }
      )?.autoApplyStatus;

      expect(candidate?.id).toBeTruthy();
      expect(promoted.promotedIds).toContain(candidate?.id);
      expect(capped.adoptedIds).toEqual([]);
      expect(candidate?.adoptionState).toBe("candidate");
      expect(autoApplyStatus).toMatchObject({
        promoteReady: true,
        adoptReady: true,
      });
    });
  });

  it("preserves adopted evolution state and materialized strategy when later observations arrive", async () => {
    await withTempRoot("openclaw-runtime-evolution-preserve-state-", async (_root, env) => {
      const now = 1_700_217_500_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now, {
            skillIds: ["patch-edit"],
          }),
          review: buildReview(now),
          run: buildRun(now),
          thinkingLane: "system1",
          completionScore: 88,
          now,
        },
        { env, now },
      );
      const candidate =
        observed.evolutionRecords.find((entry) => entry.candidateType === "route_skill_bundle") ??
        observed.evolutionRecords[0];
      if (!candidate) {
        throw new Error("expected evolution candidate");
      }

      setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "adopted",
          reason: "manual-adopt",
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      const adoptedMemoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const adoptedCandidate = adoptedMemoryStore.evolutionMemory.find(
        (entry) => entry.id === candidate.id,
      );
      const materializedStrategyId = materializedStrategyIdFromMetadata(adoptedCandidate?.metadata);
      expect(materializedStrategyId).toBeTruthy();

      observeTaskOutcomeForEvolution(
        {
          task: buildTask(now + 20, {
            skillIds: ["patch-edit"],
            updatedAt: now + 20,
          }),
          review: buildReview(now + 20, {
            id: "review-follow-up",
            runId: "run-follow-up",
          }),
          run: buildRun(now + 20, {
            id: "run-follow-up",
          }),
          thinkingLane: "system1",
          completionScore: 90,
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 30 });
      const nextCandidate = memoryStore.evolutionMemory.find((entry) => entry.id === candidate.id);
      const evaluation = governanceStore.shadowEvaluations.find(
        (entry) =>
          entry.candidateRef === candidate.id || entry.candidateRef === candidate.candidateRef,
      );

      expect(nextCandidate?.adoptionState).toBe("adopted");
      expect(materializedStrategyIdFromMetadata(nextCandidate?.metadata)).toBe(
        materializedStrategyId,
      );
      expect(evaluation?.state).toBe("adopted");
    });
  });

  it("tracks post-adoption verification telemetry separately and can recommend revert", async () => {
    await withTempRoot("openclaw-runtime-evolution-verification-", async (_root, env) => {
      const now = 1_700_217_700_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now, {
            skillIds: ["patch-edit"],
          }),
          review: buildReview(now),
          run: buildRun(now),
          thinkingLane: "system1",
          completionScore: 92,
          now,
        },
        { env, now },
      );
      const candidate =
        observed.evolutionRecords.find((entry) => entry.candidateType === "route_skill_bundle") ??
        observed.evolutionRecords[0];
      if (!candidate) {
        throw new Error("expected evolution candidate");
      }

      setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "adopted",
          reason: "manual-adopt",
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      let memoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      let adoptedCandidate = memoryStore.evolutionMemory.find((entry) => entry.id === candidate.id);
      expect(
        (adoptedCandidate?.metadata as { verificationStatus?: string })?.verificationStatus,
      ).toBe("pending");

      observeTaskOutcomeForEvolution(
        {
          task: buildTask(now + 20, {
            skillIds: ["patch-edit"],
            status: "blocked",
            blockedReason: "Live route regressed after adoption.",
            lastError: "Live route regressed after adoption.",
            updatedAt: now + 20,
          }),
          review: buildReview(now + 20, {
            id: "review-verification-follow-up",
            runId: "run-verification-follow-up",
            outcome: "failed",
            summary: "Live route regressed after adoption.",
          }),
          run: buildRun(now + 20, {
            id: "run-verification-follow-up",
            status: "blocked",
            completedAt: undefined,
            updatedAt: now + 20,
            metadata: {
              remoteCallCount: 3,
            },
          }),
          thinkingLane: "system1",
          completionScore: 28,
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      memoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 30 });
      adoptedCandidate = memoryStore.evolutionMemory.find((entry) => entry.id === candidate.id);
      const evaluation = governanceStore.shadowEvaluations.find(
        (entry) =>
          entry.candidateRef === candidate.id || entry.candidateRef === candidate.candidateRef,
      );
      const verificationMetrics = (
        adoptedCandidate?.metadata as {
          verificationMetrics?: {
            observationCount?: number;
            blockedCount?: number;
            failedCount?: number;
            successCount?: number;
          };
        }
      )?.verificationMetrics;

      expect(adoptedCandidate?.adoptionState).toBe("adopted");
      expect(verificationMetrics).toMatchObject({
        observationCount: 1,
        blockedCount: 1,
        failedCount: 1,
        successCount: 0,
      });
      expect(
        (adoptedCandidate?.metadata as { verificationStatus?: string })?.verificationStatus,
      ).toBe("revert_recommended");
      expect(
        String(
          (
            adoptedCandidate?.metadata as {
              revertRecommendedReason?: string;
            }
          )?.revertRecommendedReason ?? "",
        ),
      ).toMatch(/failed live runs|blocked live runs|success rate/i);
      expect(
        (
          evaluation?.metadata as {
            verificationReview?: { state?: string; revertRecommended?: boolean };
          }
        )?.verificationReview,
      ).toMatchObject({
        state: "revert_recommended",
        revertRecommended: true,
      });
    });
  });

  it("acknowledges post-adoption verification review without clearing the live candidate", async () => {
    await withTempRoot("openclaw-runtime-evolution-verification-ack-", async (_root, env) => {
      const now = 1_700_217_710_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now, {
            skillIds: ["patch-edit"],
          }),
          review: buildReview(now),
          run: buildRun(now),
          thinkingLane: "system1",
          completionScore: 92,
          now,
        },
        { env, now },
      );
      const candidate =
        observed.evolutionRecords.find((entry) => entry.candidateType === "route_skill_bundle") ??
        observed.evolutionRecords[0];
      if (!candidate) {
        throw new Error("expected evolution candidate");
      }

      setRuntimeEvolutionCandidateState(
        {
          id: candidate.id,
          state: "adopted",
          reason: "manual-adopt",
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      observeTaskOutcomeForEvolution(
        {
          task: buildTask(now + 20, {
            skillIds: ["patch-edit"],
            status: "blocked",
            blockedReason: "Live route regressed after adoption.",
            lastError: "Live route regressed after adoption.",
            updatedAt: now + 20,
          }),
          review: buildReview(now + 20, {
            id: "review-verification-ack-follow-up",
            runId: "run-verification-ack-follow-up",
            outcome: "failed",
            summary: "Live route regressed after adoption.",
          }),
          run: buildRun(now + 20, {
            id: "run-verification-ack-follow-up",
            status: "blocked",
            completedAt: undefined,
            updatedAt: now + 20,
            metadata: {
              remoteCallCount: 3,
            },
          }),
          thinkingLane: "system1",
          completionScore: 28,
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const acknowledgement = acknowledgeRuntimeEvolutionVerification(
        {
          id: candidate.id,
          note: "Keep live while gathering more post-adoption evidence.",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 40 });
      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 40 });
      const adoptedCandidate = memoryStore.evolutionMemory.find(
        (entry) => entry.id === candidate.id,
      );
      const evaluation = governanceStore.shadowEvaluations.find(
        (entry) =>
          entry.candidateRef === candidate.id || entry.candidateRef === candidate.candidateRef,
      );

      expect(acknowledgement).toMatchObject({
        verificationState: "revert_recommended",
        verificationObservationCount: 1,
      });
      expect(adoptedCandidate?.adoptionState).toBe("adopted");
      expect(
        adoptedCandidate?.metadata as {
          verificationAcknowledgedAt?: number;
          verificationAcknowledgedState?: string;
          verificationAcknowledgedObservationCount?: number;
          verificationAcknowledgedNote?: string;
        },
      ).toMatchObject({
        verificationAcknowledgedAt: now + 30,
        verificationAcknowledgedState: "revert_recommended",
        verificationAcknowledgedObservationCount: 1,
        verificationAcknowledgedNote: "Keep live while gathering more post-adoption evidence.",
      });
      expect(
        evaluation?.metadata as {
          verificationAcknowledgedAt?: number;
          verificationAcknowledgedState?: string;
          verificationAcknowledgedObservationCount?: number;
          verificationAcknowledgedNote?: string;
        },
      ).toMatchObject({
        verificationAcknowledgedAt: now + 30,
        verificationAcknowledgedState: "revert_recommended",
        verificationAcknowledgedObservationCount: 1,
        verificationAcknowledgedNote: "Keep live while gathering more post-adoption evidence.",
      });
    });
  });

  it("observes worker-routing and retry-policy candidates and materializes them on adoption", async () => {
    await withTempRoot("openclaw-runtime-evolution-worker-retry-", async (_root, env) => {
      const now = 1_700_218_000_000;
      const observed = observeTaskOutcomeForEvolution(
        {
          task: buildTask(now, {
            route: "ops",
            worker: "reviewer",
            status: "blocked",
            budgetMode: "deep",
            retrievalMode: "deep",
            skillIds: ["browser"],
            blockedReason: "Repeated failures exhausted the route.",
            lastError: "Repeated failures exhausted the route.",
            nextRunAt: now + 10 * 60 * 1000,
            metadata: {
              runtimeTask: {
                runState: {
                  totalFailures: 4,
                  consecutiveFailures: 4,
                },
              },
            },
          }),
          review: buildReview(now, {
            id: "review-worker-retry",
            runId: "run-worker-retry",
            outcome: "blocked",
            summary: "Repeated failures exhausted the route.",
          }),
          run: buildRun(now, {
            id: "run-worker-retry",
            status: "blocked",
            completedAt: undefined,
            updatedAt: now,
            metadata: {
              remoteCallCount: 3,
            },
          }),
          thinkingLane: "system2",
          completionScore: 32,
          now,
        },
        { env, now },
      );

      const workerCandidate = observed.evolutionRecords.find(
        (entry) => entry.candidateType === "worker_routing",
      );
      const retryCandidate = observed.evolutionRecords.find(
        (entry) => entry.candidateType === "retry_policy_review",
      );

      expect(workerCandidate).toBeTruthy();
      expect(retryCandidate).toBeTruthy();
      expect(workerCandidate?.summary).toContain("reviewer worker");
      expect(retryCandidate?.summary).toContain("暂停自动重试");
      expect(
        (retryCandidate?.metadata as {
          totalFailures?: number;
          consecutiveFailures?: number;
          budgetMode?: string;
          retrievalMode?: string;
          retryDelayMinutes?: number;
          blockedThreshold?: number;
        }) ?? {},
      ).toMatchObject({
        totalFailures: 4,
        consecutiveFailures: 4,
        budgetMode: "deep",
        retrievalMode: "deep",
        retryDelayMinutes: 10,
        blockedThreshold: 4,
      });

      setRuntimeEvolutionCandidateState(
        {
          id: workerCandidate?.id ?? "",
          state: "adopted",
          reason: "manual-worker-adopt",
          now: now + 10,
        },
        { env, now: now + 10 },
      );
      setRuntimeEvolutionCandidateState(
        {
          id: retryCandidate?.id ?? "",
          state: "adopted",
          reason: "manual-retry-adopt",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 20 });
      const adoptedWorkerCandidate = memoryStore.evolutionMemory.find(
        (entry) => entry.id === workerCandidate?.id,
      );
      const adoptedRetryCandidate = memoryStore.evolutionMemory.find(
        (entry) => entry.id === retryCandidate?.id,
      );
      const workerStrategyId = materializedStrategyIdFromMetadata(adoptedWorkerCandidate?.metadata);
      const retryStrategyId = materializedStrategyIdFromMetadata(adoptedRetryCandidate?.metadata);
      const workerStrategy = memoryStore.strategies.find((entry) => entry.id === workerStrategyId);
      const retryStrategy = memoryStore.strategies.find((entry) => entry.id === retryStrategyId);

      expect(workerStrategyId).toBeTruthy();
      expect(retryStrategyId).toBeTruthy();
      expect(workerStrategy?.metadata?.evolutionCandidateType).toBe("worker_routing");
      expect(retryStrategy?.metadata?.evolutionCandidateType).toBe("retry_policy_review");
      expect(workerStrategy?.recommendedPath).toContain("reviewer worker");
      expect(retryStrategy?.recommendedPath).toContain("预算提升到 deep");
      expect(retryStrategy?.recommendedPath).toContain("检索提升到 deep");
      expect(retryStrategy?.recommendedPath).toContain("4 次失败后暂停自动重试");
    });
  });

  it("reviews runtime memory health and decays stale memories with linked strategy downweighting", async () => {
    await withTempRoot("openclaw-runtime-memory-review-", async (_root, env) => {
      const now = 1_700_220_000_000;
      const distilled = distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const targetMemory = memoryStore.memories.find((entry) => entry.memoryType === "execution");
      const targetStrategy = memoryStore.strategies[0];
      const targetLearning = memoryStore.metaLearning[0];
      if (!targetMemory || !targetStrategy || !targetLearning) {
        throw new Error("expected memory, strategy, and learning");
      }
      targetMemory.lastReinforcedAt = now - 40 * 24 * 60 * 60 * 1000;
      targetMemory.updatedAt = targetMemory.lastReinforcedAt;
      targetMemory.decayScore = 4;
      targetStrategy.derivedFromMemoryIds = [targetMemory.id];
      memoryStore.evolutionMemory = [
        {
          id: "evolution-memory-review",
          layer: "evolution_memory",
          candidateType: "route_skill_bundle",
          targetLayer: "task_loop",
          summary: "Prefer the stable route skill bundle while the supporting memory holds.",
          adoptionState: "shadow",
          baselineRef: "coder:route-native",
          candidateRef: "coder:main:patch-edit",
          confidence: 70,
          version: 1,
          invalidatedBy: [],
          sourceTaskIds: [distilled.memories[0]?.sourceTaskIds[0] ?? "task-1"],
          sourceReviewIds: ["review-1"],
          sourceSessionIds: [],
          sourceEventIds: [],
          sourceIntelIds: [],
          derivedFromMemoryIds: [],
          sourceShadowTelemetryIds: ["shadow-memory-review"],
          createdAt: now,
          updatedAt: now,
          metadata: {
            derivedFromMemoryIds: [targetMemory.id],
            materializedStrategyId: targetStrategy.id,
          },
        },
      ];
      saveRuntimeMemoryStore(memoryStore, { env, now });

      const initialMemoryVersion = targetMemory.version;
      const initialStrategyVersion = targetStrategy.version;
      const result = reviewRuntimeMemoryLifecycle({ env, now: now + 1000 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 1000 });
      const reviewedMemory = nextMemoryStore.memories.find((entry) => entry.id === targetMemory.id);
      const reviewedStrategy = nextMemoryStore.strategies.find(
        (entry) => entry.id === targetStrategy.id,
      );
      const reviewedLearning = nextMemoryStore.metaLearning.find(
        (entry) => entry.id === targetLearning.id,
      );
      const reviewedEvolution = nextMemoryStore.evolutionMemory.find(
        (entry) => entry.id === "evolution-memory-review",
      );

      expect(result.agedMemoryIds).toContain(targetMemory.id);
      expect(result.weakenedStrategyIds).toContain(targetStrategy.id);
      expect(result.staleMetaLearningIds).toContain(targetLearning.id);
      expect(result.staleEvolutionIds).toContain("evolution-memory-review");
      expect(reviewedMemory?.decayScore ?? 0).toBeGreaterThanOrEqual(80);
      expect(reviewedStrategy?.confidence ?? 100).toBeLessThan(targetStrategy.confidence);
      expect(reviewedMemory?.version).toBeGreaterThan(initialMemoryVersion);
      expect(reviewedStrategy?.version).toBeGreaterThan(initialStrategyVersion);
      expect(
        (
          reviewedLearning?.metadata as {
            lifecycle?: { stale?: boolean; agedMemoryIds?: string[] };
          }
        )?.lifecycle,
      ).toMatchObject({
        stale: true,
        agedMemoryIds: [targetMemory.id],
      });
      expect(
        (
          reviewedEvolution?.metadata as {
            lifecycle?: {
              stale?: boolean;
              agedMemoryIds?: string[];
              weakenedStrategyIds?: string[];
            };
          }
        )?.lifecycle,
      ).toMatchObject({
        stale: true,
        agedMemoryIds: [targetMemory.id],
        weakenedStrategyIds: [targetStrategy.id],
      });

      const reinforced = reinforceMemoryLineage(
        {
          memoryIds: [targetMemory.id],
          reason: "fresh-success",
          now: now + 2000,
        },
        { env, now: now + 2000 },
      );
      const reinforcedStore = loadRuntimeMemoryStore({ env, now: now + 2000 });
      const reinforcedLearning = reinforcedStore.metaLearning.find(
        (entry) => entry.id === targetLearning.id,
      );
      const reinforcedEvolution = reinforcedStore.evolutionMemory.find(
        (entry) => entry.id === "evolution-memory-review",
      );
      expect(reinforced.refreshedMetaLearningIds).toContain(targetLearning.id);
      expect(reinforced.refreshedEvolutionIds).toContain("evolution-memory-review");
      expect(
        (reinforcedLearning?.metadata as { lifecycle?: { stale?: boolean; clearedBy?: string } })
          ?.lifecycle,
      ).toMatchObject({
        stale: false,
        clearedBy: "memory_lineage_reinforced",
      });
      expect(
        (reinforcedEvolution?.metadata as { lifecycle?: { stale?: boolean; clearedBy?: string } })
          ?.lifecycle,
      ).toMatchObject({
        stale: false,
        clearedBy: "memory_lineage_reinforced",
      });
    });
  });

  it("blocks low-risk evolution auto-apply while lifecycle marks supporting evidence stale and reopens after reinforcement", async () => {
    await withTempRoot("openclaw-runtime-evolution-lifecycle-gate-", async (_root, env) => {
      const now = 1_700_220_500_000;
      const governanceStore = loadRuntimeGovernanceStore({ env, now });
      governanceStore.metadata = {
        ...governanceStore.metadata,
        enabled: true,
        autoApplyLowRisk: true,
        reviewIntervalHours: 1,
      };
      saveRuntimeGovernanceStore(governanceStore, { env, now });

      const distilled = distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );
      const supportMemoryId = distilled.memories.find(
        (entry) => entry.memoryType === "execution",
      )?.id;
      if (!supportMemoryId) {
        throw new Error("expected execution memory");
      }

      for (let index = 0; index < 5; index += 1) {
        const observedAt = now + 1_000 + index * 1_000;
        observeTaskOutcomeForEvolution(
          {
            task: buildTask(observedAt, {
              id: `task-evolution-lifecycle-${index}`,
              updatedAt: observedAt,
              memoryRefs: [supportMemoryId],
              skillIds: ["patch-edit"],
            }),
            review: buildReview(observedAt, {
              id: `review-evolution-lifecycle-${index}`,
              taskId: `task-evolution-lifecycle-${index}`,
              runId: `run-evolution-lifecycle-${index}`,
            }),
            run: buildRun(observedAt, {
              id: `run-evolution-lifecycle-${index}`,
            }),
            thinkingLane: "system1",
            completionScore: 92,
            now: observedAt,
          },
          { env, now: observedAt },
        );
      }

      const agedStore = loadRuntimeMemoryStore({ env, now: now + 7_000 });
      agedStore.memories = agedStore.memories.map((entry) =>
        entry.id === supportMemoryId
          ? {
              ...entry,
              lastReinforcedAt: now - 45 * 24 * 60 * 60 * 1000,
              updatedAt: now - 45 * 24 * 60 * 60 * 1000,
              decayScore: 18,
            }
          : entry,
      );
      saveRuntimeMemoryStore(agedStore, { env, now: now + 7_000 });

      const lifecycleReview = reviewRuntimeMemoryLifecycle({ env, now: now + 8_000 });
      const blocked = maybeAutoApplyLowRiskEvolution({ env, now: now + 9_000 });
      const blockedStore = loadRuntimeMemoryStore({ env, now: now + 9_000 });
      const blockedCandidate = blockedStore.evolutionMemory.find(
        (entry) => entry.candidateType === "route_skill_bundle",
      );
      if (!blockedCandidate) {
        throw new Error("expected route skill bundle candidate");
      }

      expect(lifecycleReview.staleEvolutionIds).toContain(blockedCandidate.id);
      expect(blocked.promotedIds).not.toContain(blockedCandidate.id);
      expect(blocked.adoptedIds).not.toContain(blockedCandidate.id);
      expect(blockedCandidate.adoptionState).toBe("shadow");
      expect(
        (
          blockedCandidate.metadata as {
            autoApplyStatus?: { blockers?: string[] };
          }
        )?.autoApplyStatus?.blockers?.join(" "),
      ).toMatch(/lifecycle review marked this candidate stale/i);

      reinforceMemoryLineage(
        {
          memoryIds: [supportMemoryId],
          reason: "fresh-success",
          now: now + 10_000,
        },
        { env, now: now + 10_000 },
      );

      const reopened = maybeAutoApplyLowRiskEvolution({ env, now: now + 11_000 });
      const adopted = maybeAutoApplyLowRiskEvolution({ env, now: now + 12_000 });
      const reopenedStore = loadRuntimeMemoryStore({ env, now: now + 12_000 });
      const reopenedCandidate = reopenedStore.evolutionMemory.find(
        (entry) => entry.id === blockedCandidate.id,
      );

      expect(reopened.promotedIds).toContain(blockedCandidate.id);
      expect(adopted.adoptedIds).not.toContain(blockedCandidate.id);
      expect(reopenedCandidate?.adoptionState).toBe("candidate");
      expect(
        (reopenedCandidate?.metadata as { lifecycle?: { stale?: boolean } })?.lifecycle?.stale,
      ).toBe(false);
    });
  });

  it("applies configured runtime memory lifecycle policy instead of hardcoded decay values", async () => {
    await withTempRoot("openclaw-runtime-memory-policy-", async (_root, env) => {
      const now = 1_700_230_000_000;
      distillTaskOutcomeToMemory(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const targetMemory = memoryStore.memories.find((entry) => entry.memoryType === "execution");
      const targetStrategy = memoryStore.strategies[0];
      if (!targetMemory || !targetStrategy) {
        throw new Error("expected memory and strategy");
      }
      targetMemory.lastReinforcedAt = now - 5 * 24 * 60 * 60 * 1000;
      targetMemory.updatedAt = targetMemory.lastReinforcedAt;
      targetMemory.decayScore = 10;
      targetStrategy.derivedFromMemoryIds = [targetMemory.id];
      saveRuntimeMemoryStore(memoryStore, { env, now });

      const configured = configureRuntimeMemoryLifecycle(
        {
          reviewIntervalHours: 6,
          decayGraceDays: 4,
          minDecayIncreasePerReview: 3,
          agePressurePerDay: 5,
          confidencePenaltyDivisor: 2,
          linkedStrategyConfidencePenalty: 7,
          highDecayThreshold: 40,
        },
        { env, now: now + 50 },
      );
      const reviewResult = reviewRuntimeMemoryLifecycle({ env, now: now + 1000 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 1000 });
      const reviewedMemory = nextMemoryStore.memories.find((entry) => entry.id === targetMemory.id);
      const reviewedStrategy = nextMemoryStore.strategies.find(
        (entry) => entry.id === targetStrategy.id,
      );

      expect(configured).toMatchObject({
        reviewIntervalHours: 6,
        decayGraceDays: 4,
        minDecayIncreasePerReview: 3,
        agePressurePerDay: 5,
        confidencePenaltyDivisor: 2,
        linkedStrategyConfidencePenalty: 7,
        highDecayThreshold: 40,
      });
      expect(reviewResult.agedMemoryIds).toContain(targetMemory.id);
      expect(reviewResult.weakenedStrategyIds).toContain(targetStrategy.id);
      expect(reviewedMemory?.decayScore).toBe(25);
      expect(reviewedMemory?.confidence).toBe(targetMemory.confidence - 7);
      expect(reviewedStrategy?.confidence).toBe(targetStrategy.confidence - 7);
      expect(nextMemoryStore.metadata).toMatchObject({
        reviewIntervalHours: 6,
        decayGraceDays: 4,
        minDecayIncreasePerReview: 3,
        agePressurePerDay: 5,
        confidencePenaltyDivisor: 2,
        linkedStrategyConfidencePenalty: 7,
        highDecayThreshold: 40,
        lastReviewAt: now + 1000,
      });
    });
  });
});
