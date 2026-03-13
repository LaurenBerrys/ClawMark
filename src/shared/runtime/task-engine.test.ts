import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTaskRecordSnapshot } from "./task-artifacts.js";
import {
  applyRuntimeTaskResult,
  planRuntimeTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "./task-engine.js";
import {
  loadRuntimeGovernanceStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  saveRuntimeTaskStore,
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

function seedTaskStore(env: NodeJS.ProcessEnv, now: number, overrides: Record<string, unknown> = {}) {
  const task = buildTaskRecordSnapshot(
    {
      id: "task-runtime",
      title: "Move runtime ownership into the canonical store",
      goal: "Plan and execute on the authoritative runtime path",
      successCriteria: "Task loop reads and writes the new store",
      route: "coder",
      status: "queued",
      priority: "high",
      budgetMode: "strict",
      retrievalMode: "light",
      worker: "reviewer",
      skillIds: ["patch-edit"],
      tags: ["runtime", "memory"],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    now,
  );
  saveRuntimeTaskStore(
    {
      version: "v1",
      defaults: {
        defaultBudgetMode: "strict",
        defaultRetrievalMode: "light",
        maxInputTokensPerTurn: 6000,
        maxContextChars: 9000,
        maxRemoteCallsPerTask: 6,
      },
      tasks: [task],
      runs: [],
      steps: [],
      reviews: [],
    },
    { env, now },
  );
}

describe("runtime task engine", () => {
  it("upserts canonical tasks directly into the authoritative runtime store", async () => {
    await withTempRoot("openclaw-runtime-engine-upsert-", async (_root, env) => {
      const now = 1_700_295_000_000;

      const created = upsertRuntimeTask(
        {
          title: "Create authoritative runtime task",
          goal: "Add a new canonical task without touching legacy state",
          successCriteria: "Task exists in the authoritative store",
          route: "ops",
          priority: "high",
          budgetMode: "balanced",
          retrievalMode: "light",
          skillIds: ["patch-edit"],
          tags: ["runtime", "authoritative"],
        },
        { env, now },
      );

      const updated = upsertRuntimeTask(
        {
          id: created.task.id,
          status: "waiting_external",
          nextAction: "Wait for the next instance-root migration step.",
          nextRunAt: now + 15 * 60 * 1000,
        },
        { env, now: now + 100 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 100 });

      expect(created.created).toBe(true);
      expect(updated.created).toBe(false);
      expect(taskStore.tasks).toHaveLength(1);
      expect(taskStore.tasks[0]?.route).toBe("ops");
      expect(taskStore.tasks[0]?.status).toBe("waiting_external");
      expect(taskStore.tasks[0]?.nextAction).toContain("instance-root");
    });
  });

  it("deep merges runtime metadata instead of overwriting sibling runtime state", async () => {
    await withTempRoot("openclaw-runtime-engine-metadata-", async (_root, env) => {
      const now = 1_700_299_000_000;

      const created = upsertRuntimeTask(
        {
          title: "Preserve runtime metadata",
          route: "ops",
          metadata: {
            runtimeTask: {
              optimizationState: {
                needsReplan: true,
              },
            },
          },
        },
        { env, now },
      );

      upsertRuntimeTask(
        {
          id: created.task.id,
          metadata: {
            runtimeTask: {
              runState: {
                backgroundSessionId: "autopilot-task-ops-preserve-runtime-metadata",
              },
            },
          },
        },
        { env, now: now + 10 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 10 });
      const runtimeMetadata = (taskStore.tasks[0]?.metadata as {
        runtimeTask?: {
          optimizationState?: { needsReplan?: boolean };
          runState?: { backgroundSessionId?: string };
        };
      })?.runtimeTask;

      expect(runtimeMetadata?.optimizationState?.needsReplan).toBe(true);
      expect(runtimeMetadata?.runState?.backgroundSessionId).toContain("autopilot-task");
    });
  });

  it("plans the next due task from the authoritative runtime store", async () => {
    await withTempRoot("openclaw-runtime-engine-plan-", async (_root, env) => {
      const now = 1_700_300_000_000;
      seedTaskStore(env, now);

      const result = tickRuntimeTaskLoop({ env, now: now + 100 });

      expect(result.kind).toBe("planned");
      if (result.kind !== "planned") {
        throw new Error("expected planned runtime task");
      }

      const taskStore = loadRuntimeTaskStore({ env, now: now + 100 });
      const plannedTask = taskStore.tasks[0];

      expect(plannedTask?.status).toBe("running");
      expect(plannedTask?.worker).toBeTruthy();
      expect(plannedTask?.activeRunId).toBeTruthy();
      expect(taskStore.runs).toHaveLength(1);
      expect(taskStore.steps).toHaveLength(1);
      expect(
        (
          ((plannedTask?.metadata as { runtimeTask?: { runState?: { lastThinkingLane?: string } } })
            ?.runtimeTask?.runState?.lastThinkingLane) ??
          null
        ),
      ).toMatch(/system[12]/);
      expect(result.decision.recommendedWorker).toBe(plannedTask?.worker);
    });
  });

  it("applies a completed result and writes review, memory, and evolution records", async () => {
    await withTempRoot("openclaw-runtime-engine-complete-", async (_root, env) => {
      const now = 1_700_310_000_000;
      seedTaskStore(env, now);
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Runtime task completed and canonical store is now authoritative.",
          nextAction: "Idle until the next scheduled task.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 20 });
      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 20 });

      expect(result.task.status).toBe("completed");
      expect(result.review?.taskId).toBe("task-runtime");
      expect(taskStore.reviews).toHaveLength(1);
      expect(taskStore.tasks[0]?.memoryRefs.length).toBeGreaterThan(0);
      expect(memoryStore.memories.length).toBeGreaterThan(0);
      expect(memoryStore.strategies.length).toBeGreaterThan(0);
      expect(memoryStore.evolutionMemory.length).toBeGreaterThan(0);
      expect(governanceStore.shadowEvaluations.length).toBeGreaterThan(0);
    });
  });

  it("escalates retry policy and eventually blocks after repeated failures", async () => {
    await withTempRoot("openclaw-runtime-engine-retry-", async (_root, env) => {
      const now = 1_700_320_000_000;
      seedTaskStore(env, now);
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "First failure",
          now: now + 20,
        },
        { env, now: now + 20 },
      );
      let taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      expect(taskStore.tasks[0]?.status).toBe("queued");
      expect(taskStore.tasks[0]?.nextRunAt).toBeGreaterThan(now + 20);

      applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "Second failure",
          now: now + 30,
        },
        { env, now: now + 30 },
      );
      taskStore = loadRuntimeTaskStore({ env, now: now + 30 });
      expect(["balanced", "deep"]).toContain(taskStore.tasks[0]?.budgetMode);
      expect(taskStore.tasks[0]?.retrievalMode).toBe("deep");

      applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "Third failure",
          now: now + 40,
        },
        { env, now: now + 40 },
      );
      taskStore = loadRuntimeTaskStore({ env, now: now + 40 });
      expect(taskStore.tasks[0]?.worker).toBe("main");

      const finalResult = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "Fourth failure",
          now: now + 50,
        },
        { env, now: now + 50 },
      );
      taskStore = loadRuntimeTaskStore({ env, now: now + 50 });

      expect(finalResult.task.status).toBe("blocked");
      expect(taskStore.tasks[0]?.status).toBe("blocked");
      expect(taskStore.reviews.length).toBeGreaterThan(0);
      expect(taskStore.tasks[0]?.blockedReason).toContain("Fourth failure");
    });
  });
});
