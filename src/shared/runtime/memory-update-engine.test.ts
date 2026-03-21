import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  RuntimeIntelStore,
  RuntimeUserModel,
  SurfaceRecord,
  SurfaceRoleOverlay,
  TaskRecord,
  TaskReview,
} from "./contracts.js";
import {
  applyRuntimeMemoryInvalidationRollback,
  applyRuntimeMemoryLifecycleReview,
  applyRuntimeMemoryLineageInvalidation,
  applyRuntimeMemoryLineageReinforcement,
  applyRuntimePinnedIntelKnowledgePromotion,
  applyRuntimeTaskOutcomeMemoryUpdate,
  applyRuntimeUserControlMemoryUpdate,
} from "./memory-update-engine.js";
import {
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  readRuntimeEvents,
  saveRuntimeMemoryStore,
  saveRuntimeIntelStore,
} from "./store.js";

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

describe("runtime memory update engine", () => {
  it("routes task outcome writes through a unified engine event and writes resource memory", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-task-", async (_root, env) => {
      const now = 1_700_500_000_000;
      const result = applyRuntimeTaskOutcomeMemoryUpdate(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const events = readRuntimeEvents(20, { env, now });
      const engineEvent = events.find((entry) => entry.id === result.eventId);

      expect(result.memoryIds.length).toBe(4);
      expect(result.memories.some((entry) => entry.memoryType === "resource")).toBe(true);
      expect(memoryStore.memories.some((entry) => entry.memoryType === "resource")).toBe(true);
      expect(engineEvent?.type).toBe("runtime_memory_update_engine_applied");
      expect(engineEvent?.payload?.kind).toBe("task_outcome_review");
    });
  });

  it("routes user-model updates through the unified engine path", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-user-", async (_root, env) => {
      const now = 1_700_500_100_000;
      const previous: RuntimeUserModel = {
        id: "runtime-user",
        reportPolicy: "reply",
        createdAt: now,
        updatedAt: now,
      };
      const next: RuntimeUserModel = {
        ...previous,
        communicationStyle: "direct",
        interruptionThreshold: "low",
        reportVerbosity: "detailed",
        confirmationBoundary: "strict",
        reportPolicy: "reply_and_proactive",
        updatedAt: now + 10,
      };

      const result = applyRuntimeUserControlMemoryUpdate(
        {
          kind: "user_model_update",
          previous,
          next,
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const events = readRuntimeEvents(20, { env, now: now + 10 });
      const engineEvent = events.find((entry) => entry.id === result.eventId);

      expect(result.memoryIds).toHaveLength(2);
      expect(memoryStore.memories.some((entry) => entry.memoryType === "user")).toBe(true);
      expect(memoryStore.memories.some((entry) => entry.memoryType === "communication")).toBe(true);
      expect(engineEvent?.payload?.kind).toBe("user_model_update");
    });
  });

  it("routes surface-role updates through the unified engine path", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-surface-", async (_root, env) => {
      const now = 1_700_500_200_000;
      const surface: SurfaceRecord = {
        id: "surface-1",
        channel: "wecom",
        accountId: "sales-1",
        label: "WeCom Sales",
        ownerKind: "user",
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      const overlay: SurfaceRoleOverlay = {
        id: "overlay-1",
        surfaceId: surface.id,
        role: "sales",
        businessGoal: "Convert qualified leads",
        tone: "direct",
        initiative: "high",
        allowedTopics: ["pricing", "demo"],
        restrictedTopics: ["legal"],
        reportTarget: "runtime-user",
        createdAt: now,
        updatedAt: now,
      };

      const result = applyRuntimeUserControlMemoryUpdate(
        {
          kind: "surface_role_overlay_update",
          surface,
          overlay,
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const events = readRuntimeEvents(20, { env, now });
      const engineEvent = events.find((entry) => entry.id === result.eventId);
      if (result.kind !== "surface_role_overlay_update") {
        throw new Error(`expected surface role overlay update, received ${result.kind}`);
      }

      expect(result.memoryIds).toEqual([result.memory.id]);
      expect(
        memoryStore.memories.find((entry) => entry.scope === `surface:${surface.id}`)?.memoryType,
      ).toBe("communication");
      expect(engineEvent?.payload?.kind).toBe("surface_role_overlay_update");
    });
  });

  it("routes waiting-user task responses through the unified engine path", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-task-response-", async (_root, env) => {
      const now = 1_700_500_250_000;
      const task = buildTask(now, {
        id: "task-waiting-user",
        status: "waiting_user",
        route: "support",
        title: "Clarify the preferred handoff path",
        blockedReason: "Need the operator to confirm the follow-up path.",
      });

      const result = applyRuntimeUserControlMemoryUpdate(
        {
          kind: "task_waiting_user_response",
          task,
          response: "Use the customer-success handoff and keep the summary brief.",
          respondedBy: "runtime-user",
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const events = readRuntimeEvents(20, { env, now });
      const engineEvent = events.find((entry) => entry.id === result.eventId);
      if (result.kind !== "task_waiting_user_response") {
        throw new Error(`expected waiting-user response, received ${result.kind}`);
      }

      expect(result.memoryIds).toEqual([result.memory.id]);
      expect(result.memory.memoryType).toBe("communication");
      expect(result.memory.scope).toBe(`task:${task.id}:waiting-user`);
      expect(result.memory.sourceTaskIds).toContain(task.id);
      expect(
        memoryStore.memories.find((entry) => entry.id === result.memory.id)?.summary,
      ).toContain("收到用户答复");
      expect(engineEvent?.payload?.kind).toBe("task_waiting_user_response");
    });
  });

  it("routes pinned intel promotion through the unified engine path", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-intel-", async (_root, env) => {
      const now = 1_700_500_300_000;
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

      const result = applyRuntimePinnedIntelKnowledgePromotion(
        {
          intelId: "intel-1",
          promotedBy: "runtime-user",
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      const nextIntelStore = loadRuntimeIntelStore({ env, now: now + 10 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const events = readRuntimeEvents(20, { env, now: now + 10 });
      const engineEvent = events.find((entry) => entry.id === result.eventId);

      expect(result.memory.memoryType).toBe("knowledge");
      expect(nextIntelStore.pinnedRecords[0]?.promotedToMemoryId).toBe(result.memory.id);
      expect(nextIntelStore.usefulnessRecords[0]).toMatchObject({
        intelId: "intel-1",
        sourceId: "openai-news",
        reason: "manual_pin_to_knowledge",
      });
      expect(memoryStore.memories.some((entry) => entry.id === result.memory.id)).toBe(true);
      expect(engineEvent?.payload?.kind).toBe("manual_pinned_intel");
    });
  });

  it("routes reinforcement, lifecycle review, invalidation, and rollback through the unified engine path", async () => {
    await withTempRoot("openclaw-runtime-memory-engine-lifecycle-", async (_root, env) => {
      const now = 1_700_500_400_000;
      const distilled = applyRuntimeTaskOutcomeMemoryUpdate(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const reinforced = applyRuntimeMemoryLineageReinforcement(
        {
          memoryIds: [distilled.memories[0].id],
          reason: "repeat-success",
          sourceTaskId: "task-1",
          sourceEventId: "runtime-success-1",
          confidenceBoost: 9,
          now: now + 10,
        },
        { env, now: now + 10 },
      );

      const beforeReview = loadRuntimeMemoryStore({ env, now: now + 11 });
      const targetLearning = beforeReview.metaLearning[0];
      const targetStrategyId = distilled.strategies[0]?.id;
      if (!targetLearning || !targetStrategyId) {
        throw new Error("expected learning and strategy");
      }
      beforeReview.memories = beforeReview.memories.map((memory) =>
        memory.id === distilled.memories[1].id
          ? {
              ...memory,
              lastReinforcedAt: now - 5 * 24 * 60 * 60 * 1000,
              updatedAt: now - 5 * 24 * 60 * 60 * 1000,
              decayScore: 18,
            }
          : memory,
      );
      beforeReview.evolutionMemory = [
        {
          id: "engine-evolution-lifecycle",
          layer: "evolution_memory",
          candidateType: "route_skill_bundle",
          targetLayer: "task_loop",
          summary: "Keep the stable route bundle while the linked memory stays fresh.",
          adoptionState: "shadow",
          baselineRef: "coder:route-native",
          candidateRef: "coder:main:patch-edit",
          confidence: 70,
          version: 1,
          invalidatedBy: [],
          sourceTaskIds: [],
          sourceReviewIds: ["review-1"],
          sourceSessionIds: [],
          sourceEventIds: [],
          sourceIntelIds: [],
          derivedFromMemoryIds: [],
          sourceShadowTelemetryIds: ["shadow-engine-lifecycle"],
          createdAt: now,
          updatedAt: now,
          metadata: {
            derivedFromMemoryIds: [distilled.memories[1].id],
            materializedStrategyId: targetStrategyId,
          },
        },
      ];
      saveRuntimeMemoryStore(beforeReview, { env, now: now + 11 });

      const reviewed = applyRuntimeMemoryLifecycleReview({ env, now: now + 12 });
      const invalidated = applyRuntimeMemoryLineageInvalidation(
        {
          memoryIds: [distilled.memories[0].id],
          reasonEventId: "runtime-memory-invalidated",
          now: now + 20,
        },
        { env, now: now + 20 },
      );
      const rolledBack = applyRuntimeMemoryInvalidationRollback(
        {
          invalidationEventId: invalidated.invalidationEventId,
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      const events = readRuntimeEvents(20, { env, now: now + 30 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });

      expect(reinforced.memoryIds).toContain(distilled.memories[0].id);
      expect(reinforced.strategyIds.length).toBeGreaterThan(0);
      expect(reviewed.memoryIds).toContain(distilled.memories[1].id);
      expect(reviewed.metaLearningIds).toContain(targetLearning.id);
      expect(reviewed.evolutionIds).toContain("engine-evolution-lifecycle");
      expect(memoryStore.metadata?.lastReviewAt).toBe(now + 12);
      expect(invalidated.memoryIds).toContain(distilled.memories[0].id);
      expect(rolledBack.memoryIds).toContain(distilled.memories[0].id);
      expect(events.find((entry) => entry.id === reinforced.eventId)?.payload?.kind).toBe(
        "memory_lineage_reinforcement",
      );
      expect(events.find((entry) => entry.id === reviewed.eventId)?.payload?.kind).toBe(
        "memory_lifecycle_review",
      );
      expect(events.find((entry) => entry.id === invalidated.eventId)?.payload?.kind).toBe(
        "memory_lineage_invalidation",
      );
      expect(events.find((entry) => entry.id === rolledBack.eventId)?.payload?.kind).toBe(
        "memory_invalidation_rollback",
      );
    });
  });
});
