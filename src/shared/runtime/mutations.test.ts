import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskRecord, TaskReview } from "./contracts.js";
import { distillTaskOutcomeToMemory, invalidateMemoryLineage } from "./mutations.js";
import { loadRuntimeMemoryStore, loadRuntimeTaskStore, saveRuntimeTaskStore } from "./store.js";

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
    intelRefs: ["intel-1"],
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

describe("runtime mutations", () => {
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

      expect(result.memories).toHaveLength(2);
      expect(result.strategies).toHaveLength(1);
      expect(result.metaLearning).toHaveLength(1);
      expect(memoryStore.memories.map((entry) => entry.memoryType).toSorted()).toEqual([
        "efficiency",
        "execution",
      ]);
      expect(memoryStore.strategies[0]?.route).toBe("coder");
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
          memoryRefs: [distilled.memories[0]!.id],
          updatedAt: now + 100,
        }),
      ];
      saveRuntimeTaskStore(taskStore, { env, now: now + 100 });

      const result = invalidateMemoryLineage(
        {
          memoryIds: [distilled.memories[0]!.id],
          reasonEventId: "event-memory-invalid",
          now: now + 200,
        },
        { env, now: now + 200 },
      );

      const nextTaskStore = loadRuntimeTaskStore({ env, now: now + 200 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 200 });

      expect(result.invalidatedMemoryIds).toContain(distilled.memories[0]!.id);
      expect(result.invalidatedStrategyIds.length).toBeGreaterThan(0);
      expect(result.requeuedTaskIds).toEqual(["task-replan"]);
      expect(nextTaskStore.tasks[0]?.status).toBe("queued");
      expect(nextTaskStore.tasks[0]?.memoryRefs).toEqual([]);
      expect(nextTaskStore.tasks[0]?.nextAction).toContain("重新规划");
      expect(nextMemoryStore.memories[0]?.invalidatedBy).toContain("event-memory-invalid");
    });
  });
});
