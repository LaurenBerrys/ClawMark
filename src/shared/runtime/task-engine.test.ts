import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertRuntimeCapabilityRegistryEntry } from "./capability-plane.js";
import {
  configureRuntimeFederationInboxMaintenance,
  materializeRuntimeCoordinatorSuggestionTask,
} from "./federation-inbox.js";
import { configureRuntimeFederationRemoteSyncMaintenance } from "./federation-remote-maintenance.js";
import {
  listRuntimeFederationAssignments,
  materializeRuntimeFederationAssignmentTask,
  persistRuntimeFederationAssignments,
} from "./federation-assignments.js";
import { previewRuntimeIntelDeliveries } from "./intel-delivery.js";
import { configureRuntimeIntelPanel } from "./intel-refresh.js";
import { applyRuntimeTaskOutcomeMemoryUpdate } from "./memory-update-engine.js";
import {
  configureRuntimeEvolution,
  invalidateMemoryLineage,
  observeTaskOutcomeForEvolution,
} from "./mutations.js";
import { buildTaskRecordSnapshot } from "./task-artifacts.js";
import {
  configureRuntimeUserConsoleMaintenance,
  upsertRuntimeAgent,
  upsertRuntimeSessionWorkingPreference,
  upsertRuntimeSurface,
  upsertRuntimeSurfaceRoleOverlay,
} from "./user-console.js";
import {
  applyRuntimeTaskResult,
  configureRuntimeTaskLoop,
  planRuntimeTask,
  respondRuntimeWaitingUserTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "./task-engine.js";
import {
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  loadRuntimeUserConsoleStore,
  saveRuntimeFederationStore,
  saveRuntimeGovernanceStore,
  saveRuntimeIntelStore,
  saveRuntimeMemoryStore,
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

async function readRequestBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
        leaseDurationMs: 10 * 60 * 1000,
        maxConcurrentRunsPerWorker: 2,
        maxConcurrentRunsPerRoute: 3,
      },
      tasks: [task],
      runs: [],
      steps: [],
      reviews: [],
      reports: [],
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

  it("anchors derived tasks under their root task lineage", async () => {
    await withTempRoot("openclaw-runtime-engine-lineage-", async (_root, env) => {
      const now = 1_700_298_000_000;

      const rootTask = upsertRuntimeTask(
        {
          id: "task-root",
          title: "Root task",
          route: "ops",
        },
        { env, now },
      );
      const childTask = upsertRuntimeTask(
        {
          id: "task-child",
          parentTaskId: rootTask.task.id,
          title: "Child task",
          route: "ops",
        },
        { env, now: now + 10 },
      );
      const grandchildTask = upsertRuntimeTask(
        {
          id: "task-grandchild",
          parentTaskId: childTask.task.id,
          title: "Grandchild task",
          route: "ops",
        },
        { env, now: now + 20 },
      );

      expect(rootTask.task.rootTaskId).toBe("task-root");
      expect(rootTask.task.parentTaskId).toBeUndefined();
      expect(childTask.task.parentTaskId).toBe("task-root");
      expect(childTask.task.rootTaskId).toBe("task-root");
      expect(grandchildTask.task.parentTaskId).toBe("task-child");
      expect(grandchildTask.task.rootTaskId).toBe("task-root");
    });
  });

  it("rejects derived tasks that try to override their parent root lineage", async () => {
    await withTempRoot("openclaw-runtime-engine-lineage-guard-", async (_root, env) => {
      const now = 1_700_298_500_000;

      upsertRuntimeTask(
        {
          id: "task-root",
          title: "Root task",
          route: "ops",
        },
        { env, now },
      );

      expect(() =>
        upsertRuntimeTask(
          {
            id: "task-child",
            parentTaskId: "task-root",
            rootTaskId: "foreign-root",
            title: "Invalid child task",
            route: "ops",
          },
          { env, now: now + 10 },
        ),
      ).toThrow(/must inherit root task task-root/i);
    });
  });

  it("rejects foreign root lineage when no parent task is provided", async () => {
    await withTempRoot("openclaw-runtime-engine-root-guard-", async (_root, env) => {
      const now = 1_700_298_700_000;

      expect(() =>
        upsertRuntimeTask(
          {
            id: "task-detached",
            rootTaskId: "task-root",
            title: "Detached derived task",
            route: "ops",
          },
          { env, now },
        ),
      ).toThrow(/requires parentTaskId/i);
    });
  });

  it("normalizes agent-owned surface bindings into canonical task metadata", async () => {
    await withTempRoot("openclaw-runtime-engine-ecology-binding-", async (_root, env) => {
      const now = 1_700_298_900_000;
      const agent = upsertRuntimeAgent(
        {
          id: "agent-sales",
          name: "Sales Agent",
          roleBase: "sales_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          id: "surface-sales",
          channel: "wechat",
          accountId: "wx-sales-1",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 10 },
      );

      const created = upsertRuntimeTask(
        {
          id: "task-sales",
          title: "Follow up with lead",
          route: "sales",
          agentId: agent.id,
          surfaceId: surface.id,
          sessionId: "sales-session",
        },
        { env, now: now + 20 },
      );

      const metadata = (created.task.metadata ?? {}) as Record<string, unknown>;
      const taskContext = (metadata.taskContext ?? {}) as Record<string, unknown>;
      const taskSurface = (metadata.surface ?? {}) as Record<string, unknown>;

      expect(taskContext.agentId).toBe(agent.id);
      expect(taskContext.sessionId).toBe("sales-session");
      expect(taskSurface.surfaceId).toBe(surface.id);
      expect(taskSurface.ownerKind).toBe("agent");
      expect(taskSurface.ownerId).toBe(agent.id);
    });
  });

  it("feeds canonical ecology bindings into decision planning and persists effective user preferences", async () => {
    await withTempRoot("openclaw-runtime-engine-decision-preferences-", async (_root, env) => {
      const now = 1_700_298_925_000;
      const agent = upsertRuntimeAgent(
        {
          id: "agent-sales",
          name: "Sales Agent",
          roleBase: "sales_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          id: "surface-sales",
          channel: "wechat",
          accountId: "wx-sales-1",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 10 },
      );
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "sales-session",
          label: "Sales Session",
          reportPolicy: "reply_and_proactive",
          reportVerbosity: "detailed",
          interruptionThreshold: "low",
          confirmationBoundary: "strict",
        },
        { env, now: now + 20 },
      );

      const task = upsertRuntimeTask(
        {
          id: "task-sales-plan",
          title: "Plan sales follow-up under the bound surface",
          route: "sales",
          priority: "normal",
          budgetMode: "balanced",
          retrievalMode: "light",
          skillIds: [],
          agentId: agent.id,
          surfaceId: surface.id,
          sessionId: "sales-session",
        },
        { env, now: now + 30 },
      ).task;

      const result = planRuntimeTask(task.id, { env, now: now + 40 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 50 });
      const plannedTask = taskStore.tasks.find((entry) => entry.id === task.id);
      const runtimeTask = ((plannedTask?.metadata ?? {}) as { runtimeTask?: { runState?: Record<string, unknown> } })
        .runtimeTask;
      const runState = runtimeTask?.runState ?? {};

      expect(result.kind).toBe("planned");
      if (result.kind !== "planned") {
        throw new Error("expected ecology-bound task to plan successfully");
      }
      expect(result.decision.metadata).toMatchObject({
        ecologyBinding: {
          agentId: "agent-sales",
          sessionId: "sales-session",
          surfaceId: "surface-sales",
        },
        userPreferenceView: {
          reportPolicy: "reply_and_proactive",
          reportVerbosity: "detailed",
          interruptionThreshold: "low",
          confirmationBoundary: "strict",
        },
      });
      expect(result.decision.relevantSessionIds).toContain("sales-session");
      expect(runState.lastReportPolicy).toBe("reply_and_proactive");
      expect(runState.lastReportVerbosity).toBe("detailed");
      expect(runState.lastInterruptionThreshold).toBe("low");
      expect(runState.lastConfirmationBoundary).toBe("strict");
    });
  });

  it("rejects surface bindings that violate agent ownership", async () => {
    await withTempRoot("openclaw-runtime-engine-ecology-guard-", async (_root, env) => {
      const now = 1_700_298_950_000;
      const agentA = upsertRuntimeAgent(
        {
          id: "agent-a",
          name: "Agent A",
        },
        { env, now },
      );
      const agentB = upsertRuntimeAgent(
        {
          id: "agent-b",
          name: "Agent B",
        },
        { env, now: now + 10 },
      );
      const agentSurface = upsertRuntimeSurface(
        {
          id: "surface-agent",
          channel: "wechat",
          accountId: "wx-agent",
          label: "Agent Surface",
          ownerKind: "agent",
          ownerId: agentA.id,
        },
        { env, now: now + 20 },
      );
      const userSurface = upsertRuntimeSurface(
        {
          id: "surface-user",
          channel: "feishu",
          accountId: "fs-user",
          label: "User Control Surface",
          ownerKind: "user",
        },
        { env, now: now + 30 },
      );

      expect(() =>
        upsertRuntimeTask(
          {
            title: "Invalid agent surface binding",
            route: "sales",
            agentId: agentB.id,
            surfaceId: agentSurface.id,
          },
          { env, now: now + 40 },
        ),
      ).toThrow(/belongs to agent agent-a/i);

      expect(() =>
        upsertRuntimeTask(
          {
            title: "Invalid user surface binding",
            route: "ops",
            agentId: agentB.id,
            surfaceId: userSurface.id,
          },
          { env, now: now + 50 },
        ),
      ).toThrow(/user-owned surface surface-user cannot be bound to agent agent-b/i);
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

      const result = await tickRuntimeTaskLoop({ env, now: now + 100 });

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
      const runState = ((plannedTask?.metadata as {
        runtimeTask?: {
          runState?: {
            lastThinkingLane?: string;
            lastRetrievalQueryId?: string;
            lastContextSummary?: string;
            lastContextSynthesis?: string[];
            lastStrategyCandidateIds?: string[];
            lastArchiveCandidateIds?: string[];
          };
        };
      })?.runtimeTask?.runState ??
        null) as
        | {
            lastThinkingLane?: string;
            lastRetrievalQueryId?: string;
            lastContextSummary?: string;
            lastContextSynthesis?: string[];
            lastStrategyCandidateIds?: string[];
            lastArchiveCandidateIds?: string[];
          }
        | null;

      expect(runState?.lastThinkingLane ?? null).toMatch(/system[12]/);
      expect(runState?.lastRetrievalQueryId).toMatch(/^decision:/);
      expect(runState?.lastContextSummary).toContain("strategy=");
      expect(Array.isArray(runState?.lastContextSynthesis)).toBe(true);
      expect(Array.isArray(runState?.lastStrategyCandidateIds)).toBe(true);
      expect(Array.isArray(runState?.lastArchiveCandidateIds)).toBe(true);
      expect(result.decision.recommendedWorker).toBe(plannedTask?.worker);
    });
  });

  it("prefers live adopted/core capabilities and keeps staged capabilities off the live plan", async () => {
    await withTempRoot("openclaw-runtime-engine-governed-plan-", async (_root, env) => {
      const now = 1_700_300_200_000;
      seedTaskStore(env, now, {
        worker: "research",
        skillIds: ["shell", "patch-edit"],
      });

      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: "main",
          state: "core",
        },
        { env, now },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: "research",
          state: "candidate",
        },
        { env, now: now + 10 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "shell",
          state: "shadow",
        },
        { env, now: now + 20 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "patch-edit",
          state: "adopted",
        },
        { env, now: now + 30 },
      );

      const result = planRuntimeTask("task-runtime", { env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const plannedTask = taskStore.tasks.find((entry) => entry.id === "task-runtime");
      const activeRun = taskStore.runs.find((entry) => entry.id === plannedTask?.activeRunId);

      expect(result.kind).toBe("planned");
      if (result.kind !== "planned") {
        throw new Error("expected governed task to plan successfully");
      }
      expect(result.task.worker).toBe("main");
      expect(plannedTask?.worker).toBe("main");
      expect(plannedTask?.skillIds).toContain("patch-edit");
      expect(plannedTask?.skillIds).not.toContain("shell");
      expect(
        (activeRun?.metadata as { governanceHeldBackSkills?: string[] } | undefined)
          ?.governanceHeldBackSkills,
      ).toContain("shell");
    });
  });

  it("defers planning when governance does not expose a live worker", async () => {
    await withTempRoot("openclaw-runtime-engine-governance-defer-", async (_root, env) => {
      const now = 1_700_300_300_000;
      seedTaskStore(env, now, {
        worker: "research",
      });

      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: "research",
          state: "candidate",
        },
        { env, now },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: "main",
          state: "blocked",
        },
        { env, now: now + 10 },
      );

      const result = planRuntimeTask("task-runtime", { env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const deferredTask = taskStore.tasks.find((entry) => entry.id === "task-runtime");

      expect(result.kind).toBe("deferred");
      if (result.kind !== "deferred") {
        throw new Error("expected governed task to defer without a live worker");
      }
      expect(result.reason).toBe("capability_governance");
      expect(result.constrainedWorker).toBe("research");
      expect(deferredTask?.status).toBe("ready");
      expect(deferredTask?.planSummary).toContain("Capability governance");
      expect(deferredTask?.nextAction).toContain("Promote or adopt");
    });
  });

  it("continues planning when another active task uses a different worker and route slot", async () => {
    await withTempRoot("openclaw-runtime-engine-concurrency-plan-", async (_root, env) => {
      const now = 1_700_300_500_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "strict",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 60_000,
            maxConcurrentRunsPerWorker: 1,
            maxConcurrentRunsPerRoute: 1,
          },
          tasks: [
            buildTaskRecordSnapshot(
              {
                id: "task-running",
                title: "Existing active task",
                route: "coder",
                status: "running",
                priority: "high",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "reviewer",
                leaseOwner: "runtime-task-loop",
                leaseExpiresAt: now + 30_000,
                activeRunId: "run-active",
                createdAt: now - 2_000,
                updatedAt: now - 1_000,
              },
              now,
            ),
            buildTaskRecordSnapshot(
              {
                id: "task-queued",
                title: "Queue another task on a different slot",
                route: "ops",
                status: "queued",
                priority: "normal",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                createdAt: now - 500,
                updatedAt: now - 500,
              },
              now,
            ),
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );

      const result = await tickRuntimeTaskLoop({ env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const plannedTask = taskStore.tasks.find((entry) => entry.id === "task-queued");

      expect(result.kind).toBe("planned");
      if (result.kind !== "planned") {
        throw new Error("expected a queued task to be planned while another slot remains free");
      }
      expect(result.task.id).toBe("task-queued");
      expect(plannedTask?.status).toBe("running");
      expect(plannedTask?.worker).toBe("main");
      expect(plannedTask?.leaseOwner).toBe("runtime-task-loop");
      expect(plannedTask?.leaseExpiresAt).toBe(now + 61_000);
    });
  });

  it("defers planning when a task lease is still active", async () => {
    await withTempRoot("openclaw-runtime-engine-lease-defer-", async (_root, env) => {
      const now = 1_700_301_000_000;
      seedTaskStore(env, now, {
        status: "ready",
        leaseOwner: "runtime-task-loop",
        leaseExpiresAt: now + 60_000,
      });

      const result = planRuntimeTask("task-runtime", { env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const deferredTask = taskStore.tasks[0];

      expect(result.kind).toBe("deferred");
      if (result.kind !== "deferred") {
        throw new Error("expected task lease to defer planning");
      }
      expect(result.reason).toBe("lease_active");
      expect(deferredTask?.status).toBe("ready");
      expect(deferredTask?.nextRunAt).toBe(now + 31_000);
      expect(deferredTask?.leaseOwner).toBeUndefined();
      expect(deferredTask?.leaseExpiresAt).toBeUndefined();
    });
  });

  it("defers planning when the selected worker is already at concurrency capacity", async () => {
    await withTempRoot("openclaw-runtime-engine-worker-concurrency-", async (_root, env) => {
      const now = 1_700_301_500_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "strict",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 60_000,
            maxConcurrentRunsPerWorker: 1,
            maxConcurrentRunsPerRoute: 2,
          },
          tasks: [
            buildTaskRecordSnapshot(
              {
                id: "task-running",
                title: "Worker slot already occupied",
                route: "coder",
                status: "running",
                priority: "high",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                leaseOwner: "runtime-task-loop",
                leaseExpiresAt: now + 30_000,
                activeRunId: "run-active",
                createdAt: now - 2_000,
                updatedAt: now - 1_000,
              },
              now,
            ),
            buildTaskRecordSnapshot(
              {
                id: "task-queued",
                title: "Wait for worker slot",
                route: "ops",
                status: "queued",
                priority: "normal",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                createdAt: now - 500,
                updatedAt: now - 500,
              },
              now,
            ),
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );

      const result = planRuntimeTask("task-queued", { env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const deferredTask = taskStore.tasks.find((entry) => entry.id === "task-queued");

      expect(result.kind).toBe("deferred");
      if (result.kind !== "deferred") {
        throw new Error("expected worker concurrency to defer planning");
      }
      expect(result.reason).toBe("worker_concurrency");
      expect(result.constrainedWorker).toBe("main");
      expect(result.activeTaskIds).toContain("task-running");
      expect(deferredTask?.status).toBe("ready");
      expect(deferredTask?.planSummary).toContain("Worker main is at concurrency capacity");
      expect(deferredTask?.nextAction).toContain("worker slot");
    });
  });

  it("defers planning when the selected route is already at concurrency capacity", async () => {
    await withTempRoot("openclaw-runtime-engine-route-concurrency-", async (_root, env) => {
      const now = 1_700_302_000_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "strict",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 60_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 1,
          },
          tasks: [
            buildTaskRecordSnapshot(
              {
                id: "task-running",
                title: "Route slot already occupied",
                route: "coder",
                status: "running",
                priority: "high",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "reviewer",
                leaseOwner: "runtime-task-loop",
                leaseExpiresAt: now + 30_000,
                activeRunId: "run-active",
                createdAt: now - 2_000,
                updatedAt: now - 1_000,
              },
              now,
            ),
            buildTaskRecordSnapshot(
              {
                id: "task-queued",
                title: "Wait for route slot",
                route: "coder",
                status: "queued",
                priority: "normal",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                createdAt: now - 500,
                updatedAt: now - 500,
              },
              now,
            ),
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );

      const result = planRuntimeTask("task-queued", { env, now: now + 1_000 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 1_000 });
      const deferredTask = taskStore.tasks.find((entry) => entry.id === "task-queued");

      expect(result.kind).toBe("deferred");
      if (result.kind !== "deferred") {
        throw new Error("expected route concurrency to defer planning");
      }
      expect(result.reason).toBe("route_concurrency");
      expect(result.constrainedRoute).toBe("coder");
      expect(result.activeTaskIds).toContain("task-running");
      expect(deferredTask?.status).toBe("ready");
      expect(deferredTask?.planSummary).toContain("Route coder is at concurrency capacity");
      expect(deferredTask?.nextAction).toContain("route slot");
    });
  });

  it("returns busy with deferred task ids when due tasks are blocked by active concurrency", async () => {
    await withTempRoot("openclaw-runtime-engine-busy-concurrency-", async (_root, env) => {
      const now = 1_700_302_500_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "strict",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6000,
            maxContextChars: 9000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 60_000,
            maxConcurrentRunsPerWorker: 1,
            maxConcurrentRunsPerRoute: 2,
          },
          tasks: [
            buildTaskRecordSnapshot(
              {
                id: "task-running",
                title: "Running task",
                route: "research",
                status: "running",
                priority: "high",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                leaseOwner: "runtime-task-loop",
                leaseExpiresAt: now + 30_000,
                activeRunId: "run-active",
                createdAt: now - 2_000,
                updatedAt: now - 1_000,
              },
              now,
            ),
            buildTaskRecordSnapshot(
              {
                id: "task-queued",
                title: "Blocked by worker slot",
                route: "ops",
                status: "queued",
                priority: "normal",
                budgetMode: "strict",
                retrievalMode: "light",
                worker: "main",
                createdAt: now - 500,
                updatedAt: now - 500,
              },
              now,
            ),
          ],
          runs: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );

      const result = await tickRuntimeTaskLoop({ env, now: now + 1_000 });

      expect(result.kind).toBe("busy");
      if (result.kind !== "busy") {
        throw new Error("expected active concurrency to return busy");
      }
      expect(result.activeTaskIds).toEqual(["task-running"]);
      expect(result.dueTaskIds).toContain("task-queued");
      expect(result.deferredTaskIds).toContain("task-queued");
    });
  });

  it("filters blocked skills and falls back to an allowed worker during planning", async () => {
    await withTempRoot("openclaw-runtime-engine-governance-", async (_root, env) => {
      const now = 1_700_305_000_000;
      seedTaskStore(env, now, {
        worker: "reviewer",
        skillIds: ["patch-edit", "browser"],
      });

      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "patch-edit",
          state: "blocked",
        },
        { env, now: now + 1 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "agent",
          targetId: "reviewer",
          state: "blocked",
        },
        { env, now: now + 2 },
      );

      const result = planRuntimeTask("task-runtime", { env, now: now + 10 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 10 });
      const plannedTask = taskStore.tasks[0];
      const plannedRun = taskStore.runs[0];
      const plannedStep = taskStore.steps[0];

      expect(result.task.worker).toBe("main");
      expect(plannedTask?.worker).toBe("main");
      expect(plannedTask?.skillIds).toContain("browser");
      expect(plannedTask?.skillIds).not.toContain("patch-edit");
      expect(
        ((plannedRun?.metadata as { blockedSkills?: string[] } | undefined)?.blockedSkills ??
          []),
      ).toContain("patch-edit");
      expect(
        ((plannedStep?.metadata as { blockedSkills?: string[] } | undefined)?.blockedSkills ??
          []),
      ).toContain("patch-edit");
    });
  });

  it("persists task loop defaults and uses the configured lease duration for new runs", async () => {
    await withTempRoot("openclaw-runtime-engine-configure-loop-", async (_root, env) => {
      const now = 1_700_306_000_000;
      seedTaskStore(env, now);

      const defaults = configureRuntimeTaskLoop(
        {
          defaultBudgetMode: "balanced",
          defaultRetrievalMode: "deep",
          maxInputTokensPerTurn: 8000,
          maxContextChars: 12000,
          maxRemoteCallsPerTask: 9,
          leaseDurationMs: 120_000,
          maxConcurrentRunsPerWorker: 4,
          maxConcurrentRunsPerRoute: 5,
        },
        { env, now: now + 10 },
      );
      const planned = planRuntimeTask("task-runtime", { env, now: now + 20 });
      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const task = taskStore.tasks[0];

      expect(defaults.defaultBudgetMode).toBe("balanced");
      expect(defaults.defaultRetrievalMode).toBe("deep");
      expect(defaults.maxInputTokensPerTurn).toBe(8000);
      expect(defaults.maxContextChars).toBe(12000);
      expect(defaults.maxRemoteCallsPerTask).toBe(9);
      expect(defaults.leaseDurationMs).toBe(120_000);
      expect(defaults.maxConcurrentRunsPerWorker).toBe(4);
      expect(defaults.maxConcurrentRunsPerRoute).toBe(5);
      expect(taskStore.defaults).toMatchObject(defaults);
      expect(planned.kind).toBe("planned");
      expect(task?.leaseExpiresAt).toBe(now + 120_020);
    });
  });

  it("replans queued tasks from structured memory invalidation state instead of stale text markers", async () => {
    await withTempRoot("openclaw-runtime-engine-memory-replan-", async (_root, env) => {
      const now = 1_700_307_000_000;
      seedTaskStore(env, now);
      planRuntimeTask("task-runtime", { env, now: now + 10 });
      const completed = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Capture a formal memory lineage for downstream replanning.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const memoryId = completed.distilledMemoryIds[0];
      expect(memoryId).toBeTruthy();

      upsertRuntimeTask(
        {
          id: "task-replan-after-memory-invalidation",
          title: "Replan after memory invalidation",
          goal: "Queue a task that depends on formal memory lineage",
          successCriteria: "Task should rebuild its plan after invalidation",
          route: "coder",
          status: "running",
          priority: "high",
          budgetMode: "strict",
          retrievalMode: "light",
          worker: "reviewer",
          skillIds: ["patch-edit"],
          memoryRefs: [memoryId],
          activeRunId: "run-stale",
          metadata: {
            runtimeTask: {
              runState: {
                replanCount: 2,
              },
            },
          },
        },
        { env, now: now + 21 },
      );

      invalidateMemoryLineage(
        {
          memoryIds: [memoryId],
          reasonEventId: "event-memory-invalidated",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      const result = planRuntimeTask("task-replan-after-memory-invalidation", {
        env,
        now: now + 40,
      });

      const taskStore = loadRuntimeTaskStore({ env, now: now + 40 });
      const replannedTask = taskStore.tasks.find(
        (entry) => entry.id === "task-replan-after-memory-invalidation",
      );
      const optimizationState = (
        replannedTask?.metadata as {
          runtimeTask?: {
            optimizationState?: {
              needsReplan?: boolean;
              lastReplannedAt?: number;
              invalidatedBy?: string[];
              invalidatedMemoryIds?: string[];
            };
            runState?: {
              replanCount?: number;
            };
          };
        }
      )?.runtimeTask;

      expect(result.task.id).toBe("task-replan-after-memory-invalidation");
      expect(replannedTask?.status).toBe("running");
      expect(replannedTask?.activeRunId).toBeTruthy();
      expect(replannedTask?.activeRunId).not.toBe("run-stale");
      expect(replannedTask?.planSummary).toContain("invalidated memory lineage");
      expect(replannedTask?.nextAction).toContain("invalidated memory reference");
      expect(optimizationState?.optimizationState?.needsReplan).toBe(false);
      expect(optimizationState?.optimizationState?.lastReplannedAt).toBe(now + 40);
      expect(optimizationState?.optimizationState?.invalidatedBy).toContain(
        "event-memory-invalidated",
      );
      expect(optimizationState?.optimizationState?.invalidatedMemoryIds).toContain(memoryId);
      expect(optimizationState?.runState?.replanCount).toBe(3);
    });
  });

  it("applies a completed result and writes review, memory, and evolution records", async () => {
    await withTempRoot("openclaw-runtime-engine-complete-", async (_root, env) => {
      const now = 1_700_310_000_000;
      seedTaskStore(env, now, {
        reportPolicy: "reply",
      });
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
      expect(result.review?.extractedMemoryIds.length).toBeGreaterThan(0);
      expect(result.review?.strategyCandidateIds.length).toBeGreaterThan(0);
      expect(result.metaLearningIds.length).toBeGreaterThan(0);
      expect(result.report).toBeUndefined();
      expect(taskStore.reviews).toHaveLength(1);
      expect(taskStore.reports).toHaveLength(0);
      expect(taskStore.reviews[0]?.extractedMemoryIds.length).toBeGreaterThan(0);
      expect(taskStore.reviews[0]?.strategyCandidateIds.length).toBeGreaterThan(0);
      expect(taskStore.tasks[0]?.memoryRefs.length).toBeGreaterThan(0);
      expect(taskStore.tasks[0]?.leaseOwner).toBeUndefined();
      expect(taskStore.tasks[0]?.leaseExpiresAt).toBeUndefined();
      expect(taskStore.tasks[0]?.activeRunId).toBeUndefined();
      expect(memoryStore.memories.length).toBeGreaterThan(0);
      expect(memoryStore.strategies.length).toBeGreaterThan(0);
      expect(memoryStore.evolutionMemory.length).toBeGreaterThan(0);
      expect(governanceStore.shadowEvaluations.length).toBeGreaterThan(0);
    });
  });

  it("auto-applies materialized federation assignments when the local task completes", async () => {
    await withTempRoot("openclaw-runtime-engine-federation-assignment-auto-apply-", async (_root, env) => {
      const now = 1_700_306_400_000;

      persistRuntimeFederationAssignments(
        [
          {
            id: "assignment-auto-apply",
            title: "Complete the local follow-up",
            summary: "The assignment should be applied once the local task completes.",
            sourceRuntimeId: "brain-runtime-auto-apply",
            route: "ops",
            worker: "main",
          },
        ],
        { env, now },
      );

      const materialized = materializeRuntimeFederationAssignmentTask("assignment-auto-apply", {
        env,
        now: now + 20,
      });

      const completed = applyRuntimeTaskResult(
        {
          taskId: materialized.task.id,
          status: "completed",
          summary: "Local follow-up finished cleanly.",
        },
        {
          env,
          now: now + 60,
        },
      );
      const assignment = listRuntimeFederationAssignments({
        env,
        now: now + 80,
      }).find((entry) => entry.id === "assignment-auto-apply");

      expect(completed.task.status).toBe("completed");
      expect(assignment).toMatchObject({
        id: "assignment-auto-apply",
        state: "applied",
        localTaskId: materialized.task.id,
        appliedAt: now + 60,
        metadata: expect.objectContaining({
          localTaskStatus: "completed",
          lifecycleSyncedAt: now + 60,
        }),
      });
    });
  });

  it("requeues materialized coordinator suggestions when the linked local task is cancelled", async () => {
    await withTempRoot("openclaw-runtime-engine-coordinator-requeue-", async (_root, env) => {
      const now = 1_700_306_405_000;

      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-cancel-requeue",
              title: "Retry cancelled customer follow-up",
              summary: "If the local task is cancelled, the suggestion should return to the user queue.",
              taskId: "remote-task-requeue",
              sourceRuntimeId: "brain-runtime-requeue",
              sourcePackageId: "pkg-coord-requeue",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              metadata: {
                route: "sales",
                worker: "closer",
              },
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const materialized = materializeRuntimeCoordinatorSuggestionTask("coord-cancel-requeue", {
        env,
        now: now + 10,
      });

      const result = applyRuntimeTaskResult(
        {
          taskId: materialized.task.id,
          status: "cancelled",
          summary: "Local operator cancelled this follow-up.",
        },
        {
          env,
          now: now + 50,
        },
      );
      const suggestion = loadRuntimeFederationStore({
        env,
        now: now + 60,
      }).coordinatorSuggestions.find((entry) => entry.id === "coord-cancel-requeue");

      expect(result.task.status).toBe("cancelled");
      expect(suggestion).toMatchObject({
        id: "coord-cancel-requeue",
        localTaskId: undefined,
        localTaskStatus: "cancelled",
        lastMaterializedLocalTaskId: materialized.task.id,
        rematerializeReason: `Linked local task ${materialized.task.id} was cancelled locally.`,
      });
      expect(suggestion?.materializedAt).toBeUndefined();
    });
  });

  it("persists proactive completion reports in the durable notify ledger", async () => {
    await withTempRoot("openclaw-runtime-engine-proactive-report-", async (_root, env) => {
      const now = 1_700_310_250_000;
      seedTaskStore(env, now, {
        reportPolicy: "reply_and_proactive",
      });
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Push a proactive completion update into the local report ledger.",
          nextAction: "Wait for the next runtime task.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const report = taskStore.reports[0];
      const notifyStep = taskStore.steps.find(
        (entry) =>
          entry.kind === "notify" &&
          (entry.metadata as { reportId?: string } | undefined)?.reportId === report?.id,
      );

      expect(result.report).toMatchObject({
        kind: "completion",
        state: "delivered",
        reportPolicy: "reply_and_proactive",
        taskStatus: "completed",
      });
      expect(report).toMatchObject({
        kind: "completion",
        state: "delivered",
        reportPolicy: "reply_and_proactive",
        taskId: "task-runtime",
      });
      expect(taskStore.reports).toHaveLength(1);
      expect(notifyStep?.status).toBe("completed");
    });
  });

  it("does not persist passive completion reports when the task report policy is silent", async () => {
    await withTempRoot("openclaw-runtime-engine-silent-report-", async (_root, env) => {
      const now = 1_700_310_350_000;
      seedTaskStore(env, now, {
        reportPolicy: "silent",
      });
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Complete quietly without emitting a proactive local report.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });

      expect(result.task.status).toBe("completed");
      expect(result.report).toBeUndefined();
      expect(taskStore.reports).toHaveLength(0);
      expect(taskStore.steps.filter((entry) => entry.kind === "notify")).toHaveLength(0);
    });
  });

  it("suppresses low-priority waiting-external proactive reports when the interruption threshold is low", async () => {
    await withTempRoot("openclaw-runtime-engine-low-interrupt-report-", async (_root, env) => {
      const now = 1_700_310_425_000;
      seedTaskStore(env, now, {
        priority: "low",
        metadata: {
          taskContext: {
            sessionId: "session-low-interrupt",
          },
        },
      });
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-low-interrupt",
          label: "Low interruption session",
          interruptionThreshold: "low",
          confirmationBoundary: "balanced",
          reportVerbosity: "brief",
          reportPolicy: "reply_and_proactive",
        },
        { env, now },
      );
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "waiting_external",
          summary: "Waiting for the vendor delivery window before continuing.",
          nextAction: "Retry once the vendor confirms the delivery window.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });

      expect(result.task.status).toBe("waiting_external");
      expect(result.report).toBeUndefined();
      expect(taskStore.reports).toHaveLength(0);
      expect(taskStore.steps.filter((entry) => entry.kind === "notify")).toHaveLength(0);
    });
  });

  it("persists effective report preferences and detailed strict-confirmation summaries in task reports", async () => {
    await withTempRoot("openclaw-runtime-engine-detailed-report-", async (_root, env) => {
      const now = 1_700_310_450_000;
      seedTaskStore(env, now, {
        metadata: {
          taskContext: {
            sessionId: "session-detailed-report",
          },
        },
      });
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-detailed-report",
          label: "Detailed review session",
          interruptionThreshold: "high",
          confirmationBoundary: "strict",
          reportVerbosity: "detailed",
          reportPolicy: "reply_and_proactive",
        },
        { env, now },
      );
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "waiting_user",
          summary: "Need approval before shipping the runtime patch.",
          needsUser: "Approve whether the runtime patch should ship now.",
          nextAction: "Confirm whether the runtime patch should ship now.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const report = taskStore.reports[0];

      expect(result.report).toMatchObject({
        kind: "waiting_user",
        state: "pending",
        reportPolicy: "reply_and_proactive",
        reportVerbosity: "detailed",
        interruptionThreshold: "high",
        confirmationBoundary: "strict",
      });
      expect(result.report?.summary).toContain(
        "Next action: Confirm whether the runtime patch should ship now.",
      );
      expect(result.report?.summary).toContain(
        "Operator confirmation is required before the runtime continues.",
      );
      expect(report).toMatchObject({
        reportVerbosity: "detailed",
        interruptionThreshold: "high",
        confirmationBoundary: "strict",
      });
    });
  });

  it("persists effective surface notify routing in the durable task report ledger", async () => {
    await withTempRoot("openclaw-runtime-engine-surface-report-routing-", async (_root, env) => {
      const now = 1_700_310_470_000;
      const agent = upsertRuntimeAgent(
        {
          id: "agent-sales",
          name: "Sales Agent",
          roleBase: "sales_operator",
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          id: "surface-sales",
          channel: "wechat",
          accountId: "wx-sales-1",
          label: "WeChat Sales",
          ownerKind: "agent",
          ownerId: agent.id,
        },
        { env, now: now + 5 },
      );
      upsertRuntimeSurfaceRoleOverlay(
        {
          surfaceId: surface.id,
          role: "lead_closer",
          reportTarget: "surface-owner",
          localBusinessPolicy: {
            taskCreation: "recommend_only",
            escalationTarget: "surface-owner",
            roleScope: "sales-pipeline",
          },
        },
        { env, now: now + 10 },
      );
      seedTaskStore(env, now + 15, {
        route: "sales",
        worker: "sales-worker",
        metadata: {
          taskContext: {
            agentId: agent.id,
            sessionId: "session-sales-notify",
          },
          surface: {
            surfaceId: surface.id,
            ownerKind: "agent",
            ownerId: agent.id,
          },
        },
      });
      planRuntimeTask("task-runtime", { env, now: now + 20 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "waiting_user",
          summary: "Need approval before sending the final pricing reply.",
          needsUser: "Approve whether the final pricing reply should be sent from the bound surface.",
          nextAction: "Approve or revise the final pricing reply.",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 30 });
      const report = taskStore.reports[0];
      const notifyStep = taskStore.steps.find(
        (entry) =>
          entry.kind === "notify" &&
          (entry.metadata as { reportId?: string } | undefined)?.reportId === report?.id,
      );
      const notifyMetadata = (notifyStep?.metadata ?? {}) as Record<string, unknown>;

      expect(result.report).toMatchObject({
        reportTarget: "surface-owner",
        surfaceId: "surface-sales",
        surfaceLabel: "WeChat Sales",
        agentId: "agent-sales",
        sessionId: "session-sales-notify",
        escalationTarget: "surface-owner",
      });
      expect(report).toMatchObject({
        reportTarget: "surface-owner",
        surfaceId: "surface-sales",
        surfaceLabel: "WeChat Sales",
        agentId: "agent-sales",
        sessionId: "session-sales-notify",
        escalationTarget: "surface-owner",
      });
      expect(notifyMetadata).toMatchObject({
        reportTarget: "surface-owner",
        surfaceId: "surface-sales",
        surfaceLabel: "WeChat Sales",
        agentId: "agent-sales",
        sessionId: "session-sales-notify",
        escalationTarget: "surface-owner",
      });
    });
  });

  it("requeues waiting-user tasks after a local user response and records communication memory", async () => {
    await withTempRoot("openclaw-runtime-engine-user-response-", async (_root, env) => {
      const now = 1_700_310_500_000;
      seedTaskStore(env, now, {
        reportPolicy: "reply",
      });
      planRuntimeTask("task-runtime", { env, now: now + 10 });
      const waitingResult = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "waiting_user",
          summary: "Need the operator to confirm the rollout sequence.",
          needsUser: "Confirm whether to continue with the staged rollout.",
          nextAction: "Wait for the operator decision before replanning.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );
      const waitingTaskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const pendingReport = waitingTaskStore.reports[0];

      const responded = respondRuntimeWaitingUserTask(
        {
          taskId: "task-runtime",
          response: "Continue with the staged rollout and report only blockers.",
          respondedBy: "runtime-user",
          nextAction: "Replan the rollout using the operator decision.",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 30 });
      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      const task = taskStore.tasks.find((entry) => entry.id === "task-runtime");
      const notifyStep = taskStore.steps.find(
        (entry) =>
          entry.taskId === "task-runtime" &&
          entry.kind === "notify" &&
          typeof (entry.metadata as { respondedBy?: string } | undefined)?.respondedBy === "string",
      );
      const resolvedReport = taskStore.reports.find((entry) => entry.id === pendingReport?.id);
      const runtimeTask = (task?.metadata as {
        runtimeTask?: {
          runState?: {
            lastUserResponseAt?: number;
            lastUserResponseSummary?: string;
            lastUserResponseBy?: string;
            lastUserResponseMemoryIds?: string[];
            userResponseCount?: number;
          };
          optimizationState?: {
            needsReplan?: boolean;
          };
        };
      })?.runtimeTask;

      expect(responded.task.status).toBe("queued");
      expect(waitingResult.report).toMatchObject({
        kind: "waiting_user",
        state: "pending",
        reportPolicy: "reply",
      });
      expect(pendingReport).toMatchObject({
        kind: "waiting_user",
        state: "pending",
        taskId: "task-runtime",
      });
      expect(task?.status).toBe("queued");
      expect(task?.nextRunAt).toBe(now + 30);
      expect(task?.blockedReason).toBeUndefined();
      expect(task?.lastError).toBeUndefined();
      expect(task?.memoryRefs).toEqual(expect.arrayContaining(responded.responseMemoryIds));
      expect(runtimeTask?.runState?.lastUserResponseAt).toBe(now + 30);
      expect(runtimeTask?.runState?.lastUserResponseSummary).toContain("staged rollout");
      expect(runtimeTask?.runState?.lastUserResponseBy).toBe("runtime-user");
      expect(runtimeTask?.runState?.lastUserResponseMemoryIds).toEqual(responded.responseMemoryIds);
      expect(runtimeTask?.runState?.userResponseCount).toBe(1);
      expect(runtimeTask?.optimizationState?.needsReplan).toBe(true);
      expect(responded.resolvedReportIds).toEqual([pendingReport?.id]);
      expect(resolvedReport?.state).toBe("resolved");
      expect(resolvedReport?.resolvedAt).toBe(now + 30);
      expect(notifyStep?.kind).toBe("notify");
      expect(notifyStep?.status).toBe("completed");
      expect(notifyStep?.metadata).toMatchObject({
        respondedBy: "runtime-user",
      });
      expect(
        memoryStore.memories.some(
          (entry) =>
            entry.id === responded.responseMemoryIds[0] &&
            entry.memoryType === "communication" &&
            entry.scope === "task:task-runtime:waiting-user",
        ),
      ).toBe(true);
    });
  });

  it("reschedules recurring tasks after completion while still writing review artifacts", async () => {
    await withTempRoot("openclaw-runtime-engine-recurring-", async (_root, env) => {
      const now = 1_700_311_000_000;
      seedTaskStore(env, now, {
        recurring: true,
        scheduleIntervalMinutes: 120,
        nextRunAt: now + 5_000,
      });
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Recurring maintenance cycle completed cleanly.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      const task = taskStore.tasks[0];
      const scheduleState = (
        task?.metadata as {
          runtimeTask?: {
            scheduleState?: {
              lastCompletedAt?: number;
              lastScheduledAt?: number;
              lastScheduleIntervalMinutes?: number;
              rescheduleCount?: number;
            };
          };
        }
      )?.runtimeTask?.scheduleState;

      expect(result.task.status).toBe("queued");
      expect(result.task.nextRunAt).toBe(now + 20 + 120 * 60 * 1000);
      expect(result.review?.taskId).toBe("task-runtime");
      expect(taskStore.reviews).toHaveLength(1);
      expect(task?.status).toBe("queued");
      expect(task?.nextRunAt).toBe(now + 20 + 120 * 60 * 1000);
      expect(task?.activeRunId).toBeUndefined();
      expect(task?.leaseOwner).toBeUndefined();
      expect(scheduleState?.lastCompletedAt).toBe(now + 20);
      expect(scheduleState?.lastScheduledAt).toBe(now + 20);
      expect(scheduleState?.lastScheduleIntervalMinutes).toBe(120);
      expect(scheduleState?.rescheduleCount).toBe(1);
    });
  });

  it("skips evolution observation and auto-apply when runtime evolution is disabled", async () => {
    await withTempRoot("openclaw-runtime-engine-evolution-off-", async (_root, env) => {
      const now = 1_700_315_000_000;
      seedTaskStore(env, now);
      configureRuntimeEvolution(
        {
          enabled: false,
          autoApplyLowRisk: true,
          reviewIntervalHours: 6,
        },
        { env, now: now + 5 },
      );
      planRuntimeTask("task-runtime", { env, now: now + 10 });

      const result = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "completed",
          summary: "Completed without running the evolution loop.",
          nextAction: "Wait for the next scheduled task.",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 20 });
      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 20 });

      expect(result.task.status).toBe("completed");
      expect(result.review?.taskId).toBe("task-runtime");
      expect(memoryStore.memories.length).toBeGreaterThan(0);
      expect(memoryStore.strategies.length).toBeGreaterThan(0);
      expect(memoryStore.evolutionMemory).toHaveLength(0);
      expect(governanceStore.shadowEvaluations).toHaveLength(0);
      expect(governanceStore.metadata?.enabled).toBe(false);
      expect(governanceStore.metadata?.autoApplyLowRisk).toBe(true);
    });
  });

  it("runs scheduled evolution review on idle ticks when the review interval elapses", async () => {
    await withTempRoot("openclaw-runtime-engine-evolution-review-", async (_root, env) => {
      const now = 1_700_316_000_000;
      configureRuntimeEvolution(
        {
          enabled: true,
          autoApplyLowRisk: true,
          reviewIntervalHours: 1,
        },
        { env, now },
      );

      for (let index = 0; index < 3; index += 1) {
        observeTaskOutcomeForEvolution(
          {
            task: buildTaskRecordSnapshot(
              {
                id: `task-evolution-${index}`,
                title: "Observe a stable route",
                route: "coder",
                status: "completed",
                priority: "normal",
                budgetMode: "balanced",
                retrievalMode: "light",
                worker: "reviewer",
                skillIds: ["patch-edit"],
                createdAt: now + index,
                updatedAt: now + index,
              },
              now + index,
            ),
            review: {
              id: `review-evolution-${index}`,
              taskId: `task-evolution-${index}`,
              runId: `run-evolution-${index}`,
              summary: "Stable route execution observed.",
              outcome: "success",
              extractedMemoryIds: [],
              strategyCandidateIds: [],
              createdAt: now + index,
            },
            thinkingLane: "system1",
            now: now + 10 + index,
          },
          { env, now: now + 10 + index },
        );
      }

      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 20 });
      saveRuntimeGovernanceStore(
        {
          ...governanceStore,
          metadata: {
            ...governanceStore.metadata,
            lastReviewAt: now - 3 * 60 * 60 * 1000,
          },
        },
        { env, now: now + 20 },
      );

      const tick = await tickRuntimeTaskLoop({ env, now: now + 30 });
      const nextGovernanceStore = loadRuntimeGovernanceStore({ env, now: now + 30 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      const laneCandidate = nextMemoryStore.evolutionMemory.find(
        (entry) => entry.candidateType === "route_default_lane",
      );
      const skillCandidate = nextMemoryStore.evolutionMemory.find(
        (entry) => entry.candidateType === "route_skill_bundle",
      );

      expect(tick.kind).toBe("idle");
      expect(nextGovernanceStore.metadata?.lastReviewAt).toBe(now + 30);
      expect(laneCandidate?.adoptionState).toBe("candidate");
      expect(
        (laneCandidate?.metadata as {
          riskReview?: { riskLevel?: string; autoApplyEligible?: boolean };
        })?.riskReview,
      ).toMatchObject({
        riskLevel: "low",
        autoApplyEligible: true,
      });
      expect(skillCandidate?.adoptionState).toBe("shadow");
      expect(
        (skillCandidate?.metadata as {
          riskReview?: { riskLevel?: string; autoApplyEligible?: boolean };
        })?.riskReview,
      ).toMatchObject({
        riskLevel: "medium",
        autoApplyEligible: false,
      });
    });
  });

  it("runs scheduled memory lifecycle review on idle ticks and records the review time", async () => {
    await withTempRoot("openclaw-runtime-engine-memory-review-", async (_root, env) => {
      const now = 1_700_318_000_000;
      const outcome = applyRuntimeTaskOutcomeMemoryUpdate(
        {
          task: {
            id: "task-memory-review",
            title: "Keep local runtime memory healthy",
            route: "runtime",
            status: "completed",
            priority: "normal",
            budgetMode: "balanced",
            retrievalMode: "light",
            worker: "reviewer",
            skillIds: ["patch-edit"],
            memoryRefs: [],
            artifactRefs: [],
            recurring: false,
            maintenance: true,
            createdAt: now,
            updatedAt: now,
          },
          review: {
            id: "review-memory-review",
            taskId: "task-memory-review",
            runId: "run-memory-review",
            summary: "Memory lifecycle stays under authoritative runtime maintenance.",
            outcome: "success",
            extractedMemoryIds: [],
            strategyCandidateIds: [],
            createdAt: now,
          },
          now,
        },
        { env, now },
      );

      const memoryStore = loadRuntimeMemoryStore({ env, now: now + 10 });
      const targetMemory = memoryStore.memories.find((entry) => entry.id === outcome.memories[0]?.id);
      saveRuntimeMemoryStore(
        {
          ...memoryStore,
          metadata: {
            ...memoryStore.metadata,
            lastReviewAt: now - 3 * 24 * 60 * 60 * 1000,
          },
        },
        { env, now: now + 10 },
      );

      const tick = await tickRuntimeTaskLoop({ env, now: now + 30 });
      const nextMemoryStore = loadRuntimeMemoryStore({ env, now: now + 30 });
      const nextTargetMemory = nextMemoryStore.memories.find(
        (entry) => entry.id === outcome.memories[0]?.id,
      );

      expect(tick.kind).toBe("idle");
      expect(nextMemoryStore.metadata?.lastReviewAt).toBe(now + 30);
      expect(nextTargetMemory?.decayScore).toBe(targetMemory?.decayScore);
    });
  });

  it("runs scheduled user console maintenance on idle ticks and removes expired session overlays", async () => {
    await withTempRoot("openclaw-runtime-engine-user-console-review-", async (_root, env) => {
      const now = 1_700_318_500_000;
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-expired",
          communicationStyle: "temporary",
          expiresAt: now - 60_000,
        },
        { env, now },
      );

      const tick = await tickRuntimeTaskLoop({ env, now: now + 30 });
      const consoleStore = loadRuntimeUserConsoleStore({ env, now: now + 30 });

      expect(tick.kind).toBe("idle");
      expect(consoleStore.metadata?.lastReviewAt).toBe(now + 30);
      expect(consoleStore.metadata?.lastSessionCleanupAt).toBe(now + 30);
      expect(consoleStore.sessionWorkingPreferences).toHaveLength(0);
    });
  });

  it("respects configured user-console maintenance cadence on idle ticks", async () => {
    await withTempRoot("openclaw-runtime-engine-user-console-cadence-", async (_root, env) => {
      const now = 1_700_318_600_000;
      upsertRuntimeSessionWorkingPreference(
        {
          sessionId: "session-active",
          communicationStyle: "still under review",
          expiresAt: now + 3 * 24 * 60 * 60 * 1000,
        },
        { env, now },
      );
      configureRuntimeUserConsoleMaintenance(
        {
          enabled: true,
          reviewIntervalHours: 24,
        },
        { env, now: now + 5 },
      );

      const firstTick = await tickRuntimeTaskLoop({ env, now: now + 10 });
      const afterFirstTick = loadRuntimeUserConsoleStore({ env, now: now + 10 });
      const secondTick = await tickRuntimeTaskLoop({ env, now: now + 60 * 60 * 1000 });
      const afterSecondTick = loadRuntimeUserConsoleStore({ env, now: now + 60 * 60 * 1000 });
      const thirdTick = await tickRuntimeTaskLoop({ env, now: now + 25 * 60 * 60 * 1000 });
      const afterThirdTick = loadRuntimeUserConsoleStore({ env, now: now + 25 * 60 * 60 * 1000 });

      expect(firstTick.kind).toBe("idle");
      expect(afterFirstTick.metadata?.lastReviewAt).toBe(now + 10);
      expect(secondTick.kind).toBe("idle");
      expect(afterSecondTick.metadata?.lastReviewAt).toBe(now + 10);
      expect(thirdTick.kind).toBe("idle");
      expect(afterThirdTick.metadata?.lastReviewAt).toBe(now + 25 * 60 * 60 * 1000);
    });
  });

  it("runs scheduled federation inbox maintenance on idle ticks and expires stale actionable packages", async () => {
    await withTempRoot("openclaw-runtime-engine-federation-review-", async (_root, env) => {
      const now = 1_700_318_700_000;
      const federationStore = loadRuntimeFederationStore({ env, now });
      saveRuntimeFederationStore(
        {
          ...federationStore,
          inbox: [
            {
              id: "pkg-stale",
              packageType: "team-knowledge-package",
              sourceRuntimeId: "brain-os-runtime",
              state: "received",
              summary: "Stale package waiting in the inbox",
              validationErrors: [],
              receivedAt: now - 80 * 60 * 60 * 1000,
              updatedAt: now - 80 * 60 * 60 * 1000,
              payload: {
                schemaVersion: "v1",
                type: "team-knowledge-package",
                sourceRuntimeId: "brain-os-runtime",
                generatedAt: now - 80 * 60 * 60 * 1000,
                payload: {
                  records: [],
                },
              },
            },
          ],
        },
        { env, now },
      );

      const tick = await tickRuntimeTaskLoop({ env, now: now + 30 });
      const nextFederationStore = loadRuntimeFederationStore({ env, now: now + 30 });

      expect(tick.kind).toBe("idle");
      expect(nextFederationStore.inbox[0]?.state).toBe("expired");
      expect(nextFederationStore.metadata).toMatchObject({
        lastReviewAt: now + 30,
        lastExpiredAt: now + 30,
        lastExpiredCount: 1,
      });
    });
  });

  it("respects configured federation inbox maintenance cadence on idle ticks", async () => {
    await withTempRoot("openclaw-runtime-engine-federation-cadence-", async (_root, env) => {
      const now = 1_700_318_710_000;
      const federationStore = loadRuntimeFederationStore({ env, now });
      saveRuntimeFederationStore(
        {
          ...federationStore,
          inbox: [
            {
              id: "pkg-reviewable",
              packageType: "team-knowledge-package",
              sourceRuntimeId: "brain-os-runtime",
              state: "validated",
              summary: "Needs shadow review",
              validationErrors: [],
              receivedAt: now - 2 * 60 * 60 * 1000,
              validatedAt: now - 90 * 60 * 1000,
              updatedAt: now - 90 * 60 * 1000,
              payload: {
                schemaVersion: "v1",
                type: "team-knowledge-package",
                sourceRuntimeId: "brain-os-runtime",
                generatedAt: now - 2 * 60 * 60 * 1000,
                payload: {
                  records: [],
                },
              },
            },
          ],
        },
        { env, now },
      );
      configureRuntimeFederationInboxMaintenance(
        {
          enabled: true,
          reviewIntervalHours: 24,
        },
        { env, now: now + 5 },
      );

      const firstTick = await tickRuntimeTaskLoop({ env, now: now + 10 });
      const afterFirstTick = loadRuntimeFederationStore({ env, now: now + 10 });
      const secondTick = await tickRuntimeTaskLoop({ env, now: now + 60 * 60 * 1000 });
      const afterSecondTick = loadRuntimeFederationStore({ env, now: now + 60 * 60 * 1000 });
      const thirdTick = await tickRuntimeTaskLoop({ env, now: now + 25 * 60 * 60 * 1000 });
      const afterThirdTick = loadRuntimeFederationStore({ env, now: now + 25 * 60 * 60 * 1000 });

      expect(firstTick.kind).toBe("idle");
      expect(afterFirstTick.metadata?.lastReviewAt).toBe(now + 10);
      expect(secondTick.kind).toBe("idle");
      expect(afterSecondTick.metadata?.lastReviewAt).toBe(now + 10);
      expect(thirdTick.kind).toBe("idle");
      expect(afterThirdTick.metadata?.lastReviewAt).toBe(now + 25 * 60 * 60 * 1000);
    });
  });

  it("runs scheduled remote federation sync on idle ticks when due", async () => {
    await withTempRoot("openclaw-runtime-engine-federation-remote-maintenance-", async (_root, env) => {
      const now = 1_700_318_720_000;
      const requests = {
        outbox: 0,
        inbox: 0,
      };
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/runtime/outbox") {
          requests.outbox += 1;
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/runtime/inbox") {
          requests.inbox += 1;
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ schemaVersion: "v1", packages: [], assignments: [] }));
          return;
        }
        res.writeHead(404).end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;

      try {
        configureRuntimeFederationRemoteSyncMaintenance(
          {
            enabled: true,
            syncIntervalMinutes: 90,
            retryAfterFailureMinutes: 20,
          },
          { env, now: now + 1 },
        );

        const tick = await tickRuntimeTaskLoop({
          env,
          now: now + 10,
          config: {
            federation: {
              remote: {
                enabled: true,
                url: baseUrl,
                token: "brain-token",
                allowPrivateNetwork: true,
              },
            },
          },
        });
        const federationStore = loadRuntimeFederationStore({ env, now: now + 10 });

        expect(tick.kind).toBe("idle");
        expect(requests).toEqual({ outbox: 1, inbox: 1 });
        expect(federationStore.metadata?.remoteSyncMaintenance).toMatchObject({
          enabled: true,
          syncIntervalMinutes: 90,
          retryAfterFailureMinutes: 20,
          lastAutoSyncAttemptAt: now + 10,
          lastAutoSyncStatus: "success",
          lastAutoSyncSucceededAt: now + 10,
        });
        expect(federationStore.syncCursor).toMatchObject({
          lastPushedAt: now + 10,
          lastPulledAt: now + 10,
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("respects configured remote federation sync cadence on idle ticks", async () => {
    await withTempRoot("openclaw-runtime-engine-federation-remote-cadence-", async (_root, env) => {
      const now = 1_700_318_721_000;
      let outboxCalls = 0;
      let inboxCalls = 0;
      const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        if (req.url === "/runtime/outbox") {
          outboxCalls += 1;
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/runtime/inbox") {
          inboxCalls += 1;
          await readRequestBody(req);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ schemaVersion: "v1", packages: [], assignments: [] }));
          return;
        }
        res.writeHead(404).end();
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve test server address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/runtime`;
      const config = {
        federation: {
          remote: {
            enabled: true,
            url: baseUrl,
            token: "brain-token",
            allowPrivateNetwork: true,
          },
        },
      };

      try {
        configureRuntimeFederationRemoteSyncMaintenance(
          {
            enabled: true,
            syncIntervalMinutes: 60,
            retryAfterFailureMinutes: 15,
          },
          { env, now: now + 1 },
        );

        const firstTick = await tickRuntimeTaskLoop({ env, now: now + 10, config });
        const secondTick = await tickRuntimeTaskLoop({ env, now: now + 30 * 60 * 1000, config });
        const thirdTick = await tickRuntimeTaskLoop({ env, now: now + 61 * 60 * 1000, config });
        const federationStore = loadRuntimeFederationStore({ env, now: now + 61 * 60 * 1000 });

        expect(firstTick.kind).toBe("idle");
        expect(secondTick.kind).toBe("idle");
        expect(thirdTick.kind).toBe("idle");
        expect(outboxCalls).toBe(2);
        expect(inboxCalls).toBe(2);
        expect(federationStore.metadata?.remoteSyncMaintenance).toMatchObject({
          lastAutoSyncAttemptAt: now + 61 * 60 * 1000,
          lastAutoSyncSucceededAt: now + 61 * 60 * 1000,
          lastAutoSyncStatus: "success",
        });
      } finally {
        server.close();
        await once(server, "close");
      }
    });
  });

  it("dispatches scheduled intel deliveries on idle ticks without creating tasks", async () => {
    await withTempRoot("openclaw-runtime-engine-intel-delivery-", async (_root, env) => {
      const now = new Date("2026-03-15T11:05:00+08:00").getTime();
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.digestItems = [
        {
          id: "digest-tech-runtime",
          domain: "tech",
          title: "Runtime release note",
          conclusion: "Ship the local digest",
          whyItMatters: "score=96",
          recommendedAttention: "review",
          recommendedAction: "share",
          sourceIds: ["hn-frontpage"],
          exploit: true,
          createdAt: now - 30 * 60 * 1000,
          metadata: {
            candidateScore: 96,
            sourceUrl: "https://example.com/runtime-release",
          },
        },
      ];
      saveRuntimeIntelStore(intelStore, { env, now });

      configureRuntimeIntelPanel(
        {
          dailyPushEnabled: true,
          dailyPushHourLocal: 9,
          dailyPushMinuteLocal: 0,
          dailyPushItemCount: 10,
          instantPushEnabled: true,
          instantPushMinScore: 90,
        },
        { env, now: now + 1 },
      );

      const pendingBefore = previewRuntimeIntelDeliveries({ env, now: now + 2 });
      expect(pendingBefore.items).toHaveLength(2);

      const tick = await tickRuntimeTaskLoop({ env, now: now + 3 });
      const pendingAfter = previewRuntimeIntelDeliveries({ env, now: now + 4 });
      const nextIntelStore = loadRuntimeIntelStore({ env, now: now + 4 });

      expect(tick.kind).toBe("idle");
      expect(pendingAfter.items).toEqual([]);
      expect(nextIntelStore.metadata?.lastDailyPushAt).toBe(now + 3);
      expect(nextIntelStore.metadata?.lastInstantPushAt).toBe(now + 3);
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

  it("applies adopted retry-policy strategies to recovery timing and pause thresholds", async () => {
    await withTempRoot("openclaw-runtime-engine-retry-strategy-", async (_root, env) => {
      const now = 1_700_320_500_000;
      seedTaskStore(env, now, {
        route: "coder",
        worker: "reviewer",
        budgetMode: "strict",
        retrievalMode: "light",
      });

      const memoryStore = loadRuntimeMemoryStore({ env, now });
      memoryStore.strategies = [
        {
          id: "strategy-retry-coder-reviewer",
          layer: "strategies",
          route: "coder",
          worker: "reviewer",
          skillIds: ["patch-edit"],
          summary: "Escalate coder recovery with a deeper retry profile.",
          triggerConditions: "Repeated runtime coder failures",
          recommendedPath: "Retry after 45 minutes with deep retrieval and budget.",
          fallbackPath: "Pause and wait for operator intervention once the threshold is reached.",
          thinkingLane: "system2",
          confidence: 92,
          version: 1,
          invalidatedBy: [],
          sourceEventIds: [],
          sourceTaskIds: ["task-runtime"],
          sourceReviewIds: [],
          sourceSessionIds: [],
          sourceIntelIds: [],
          derivedFromMemoryIds: [],
          createdAt: now,
          updatedAt: now,
          metadata: {
            evolutionCandidateType: "retry_policy_review",
            budgetMode: "deep",
            retrievalMode: "deep",
            retryDelayMinutes: 45,
            blockedThreshold: 2,
          },
        },
      ];
      saveRuntimeMemoryStore(memoryStore, { env, now });

      planRuntimeTask("task-runtime", { env, now: now + 10 });

      applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "First guided failure",
          now: now + 20,
        },
        { env, now: now + 20 },
      );

      let taskStore = loadRuntimeTaskStore({ env, now: now + 20 });
      let runtimeTaskMetadata = (taskStore.tasks[0]?.metadata as {
        runtimeTask?: {
          runState?: {
            lastRetryStrategyId?: string;
            lastRetryDelayMinutes?: number;
            lastRetryBlockedThreshold?: number;
          };
        };
      })?.runtimeTask;

      expect(taskStore.tasks[0]?.status).toBe("queued");
      expect(taskStore.tasks[0]?.nextRunAt).toBe(now + 20 + 45 * 60 * 1000);
      expect(runtimeTaskMetadata?.runState).toMatchObject({
        lastRetryStrategyId: "strategy-retry-coder-reviewer",
        lastRetryDelayMinutes: 45,
        lastRetryBlockedThreshold: 2,
      });

      const second = applyRuntimeTaskResult(
        {
          taskId: "task-runtime",
          status: "blocked",
          summary: "Second guided failure",
          now: now + 30,
        },
        { env, now: now + 30 },
      );

      taskStore = loadRuntimeTaskStore({ env, now: now + 30 });
      runtimeTaskMetadata = (taskStore.tasks[0]?.metadata as {
        runtimeTask?: {
          runState?: {
            lastRetryStrategyId?: string;
            lastRetryDelayMinutes?: number;
            lastRetryBlockedThreshold?: number;
          };
        };
      })?.runtimeTask;

      expect(second.task.status).toBe("blocked");
      expect(taskStore.tasks[0]).toMatchObject({
        status: "blocked",
        budgetMode: "deep",
        retrievalMode: "deep",
      });
      expect(runtimeTaskMetadata?.runState).toMatchObject({
        lastRetryStrategyId: "strategy-retry-coder-reviewer",
        lastRetryDelayMinutes: 45,
        lastRetryBlockedThreshold: 2,
      });
    });
  });
});
