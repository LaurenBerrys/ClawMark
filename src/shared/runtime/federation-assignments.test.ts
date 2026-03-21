import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRuntimeFederationAssignmentTaskLifecycle } from "./federation-assignment-sync.js";
import {
  listRuntimeFederationAssignments,
  materializeRuntimeFederationAssignmentTask,
  persistRuntimeFederationAssignments,
  transitionRuntimeFederationAssignment,
} from "./federation-assignments.js";
import {
  loadRuntimeTaskStore,
  loadRuntimeUserConsoleStore,
  saveRuntimeUserConsoleStore,
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
    OPENCLAW_LEGACY_RUNTIME_ROOT: path.join(root, "legacy"),
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("runtime federation assignments", () => {
  it("materializes a pending assignment into an authoritative local task", async () => {
    await withTempRoot(
      "openclaw-runtime-federation-assignments-materialize-",
      async (_root, env) => {
        const now = 1_700_000_900_100;
        persistRuntimeFederationAssignments(
          [
            {
              id: "assignment-sales-followup",
              title: "Follow up the qualified lead",
              summary: "Create the local sales follow-up task.",
              sourceRuntimeId: "brain-runtime-1",
              sourcePackageId: "pkg-assignment-sales",
              sourceTaskId: "remote-task-sales",
              route: "sales",
              worker: "closer",
              metadata: {
                priority: "high",
                budgetMode: "balanced",
                retrievalMode: "light",
                reportPolicy: "reply",
                skillIds: ["crm", "quote-builder"],
                tags: ["lead"],
              },
            },
          ],
          { env, now },
        );

        const result = materializeRuntimeFederationAssignmentTask("assignment-sales-followup", {
          env,
          now: now + 100,
        });
        const listed = listRuntimeFederationAssignments({
          env,
          now: now + 200,
        }).find((entry) => entry.id === "assignment-sales-followup");
        const taskStore = loadRuntimeTaskStore({
          env,
          now: now + 200,
        });

        expect(result.created).toBe(true);
        expect(result.assignment).toMatchObject({
          id: "assignment-sales-followup",
          state: "materialized",
          localTaskId: result.task.id,
          sourceRuntimeId: "brain-runtime-1",
          sourcePackageId: "pkg-assignment-sales",
          sourceTaskId: "remote-task-sales",
        });
        expect(result.task).toMatchObject({
          title: "Follow up the qualified lead",
          route: "sales",
          worker: "closer",
          priority: "high",
          budgetMode: "balanced",
          retrievalMode: "light",
          reportPolicy: "reply",
        });
        expect(result.task.skillIds).toEqual(["crm", "quote-builder"]);
        expect(result.task.tags).toEqual(
          expect.arrayContaining(["federation", "assignment", "route:sales", "lead"]),
        );
        expect(result.task.artifactRefs).toEqual(
          expect.arrayContaining([
            "federation-package:pkg-assignment-sales",
            "federation-assignment:assignment-sales-followup",
            "federation-source-task:remote-task-sales",
          ]),
        );
        expect(taskStore.tasks.find((entry) => entry.id === result.task.id)).toMatchObject({
          id: result.task.id,
          title: "Follow up the qualified lead",
        });
        expect(listed).toMatchObject({
          id: "assignment-sales-followup",
          state: "materialized",
          localTaskId: result.task.id,
          materializedAt: now + 100,
        });
      },
    );
  });

  it("supports authoritative block, reset, and applied transitions", async () => {
    await withTempRoot(
      "openclaw-runtime-federation-assignments-transitions-",
      async (_root, env) => {
        const now = 1_700_000_901_000;
        persistRuntimeFederationAssignments(
          [
            {
              id: "assignment-review-pricing",
              title: "Review pricing exception",
              summary: "Decide whether to turn this into a local task.",
              sourceRuntimeId: "brain-runtime-2",
              route: "sales",
              worker: "reviewer",
            },
          ],
          { env, now },
        );

        const blocked = transitionRuntimeFederationAssignment(
          {
            id: "assignment-review-pricing",
            state: "blocked",
            reason: "Blocked during local operator review.",
          },
          {
            env,
            now: now + 50,
          },
        );
        expect(blocked.changed).toBe(true);
        expect(blocked.assignment).toMatchObject({
          id: "assignment-review-pricing",
          state: "blocked",
          blockedReason: "Blocked during local operator review.",
        });

        const reset = transitionRuntimeFederationAssignment(
          {
            id: "assignment-review-pricing",
            state: "pending",
          },
          {
            env,
            now: now + 100,
          },
        );
        expect(reset.assignment).toMatchObject({
          id: "assignment-review-pricing",
          state: "pending",
        });
        expect(reset.assignment.blockedReason).toBeUndefined();

        const materialized = materializeRuntimeFederationAssignmentTask(
          "assignment-review-pricing",
          {
            env,
            now: now + 150,
          },
        );
        const applied = transitionRuntimeFederationAssignment(
          {
            id: "assignment-review-pricing",
            state: "applied",
            reason: "Handled by the local runtime task.",
          },
          {
            env,
            now: now + 200,
          },
        );
        const listed = listRuntimeFederationAssignments({
          env,
          now: now + 250,
        }).find((entry) => entry.id === "assignment-review-pricing");

        expect(materialized.assignment.localTaskId).toBe(materialized.task.id);
        expect(applied.assignment).toMatchObject({
          id: "assignment-review-pricing",
          state: "applied",
          localTaskId: materialized.task.id,
          appliedAt: now + 200,
        });
        expect(listed).toMatchObject({
          id: "assignment-review-pricing",
          state: "applied",
          localTaskId: materialized.task.id,
          appliedAt: now + 200,
        });
      },
    );
  });

  it("refuses to materialize assignments when the bound surface disables local task creation", async () => {
    await withTempRoot(
      "openclaw-runtime-federation-assignments-surface-block-",
      async (_root, env) => {
        const now = 1_700_000_902_000;
        const userConsoleStore = loadRuntimeUserConsoleStore({ env, now });
        saveRuntimeUserConsoleStore(
          {
            ...userConsoleStore,
            surfaces: [
              {
                id: "surface-service",
                channel: "wechat",
                accountId: "wechat-service-001",
                label: "WeChat Service",
                ownerKind: "user",
                active: true,
                createdAt: now,
                updatedAt: now,
              },
            ],
            surfaceRoleOverlays: [
              {
                id: "surface-role-service",
                surfaceId: "surface-service",
                role: "support_triage",
                reportTarget: "runtime-user",
                allowedTopics: [],
                restrictedTopics: [],
                localBusinessPolicy: {
                  runtimeCoreBinding: "forbidden",
                  formalMemoryWrite: false,
                  userModelWrite: false,
                  surfaceRoleWrite: false,
                  taskCreation: "disabled",
                  escalationTarget: "surface-owner",
                  privacyBoundary: "user-local",
                  roleScope: "service-queue",
                },
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          { env, now },
        );

        persistRuntimeFederationAssignments(
          [
            {
              id: "assignment-service-blocked",
              title: "Escalate support case",
              summary: "This assignment should respect the local surface policy.",
              sourceRuntimeId: "brain-runtime-3",
              surfaceId: "surface-service",
              route: "support",
              worker: "triage",
            },
          ],
          { env, now: now + 10 },
        );

        expect(() =>
          materializeRuntimeFederationAssignmentTask("assignment-service-blocked", {
            env,
            now: now + 20,
          }),
        ).toThrowError(
          "surface WeChat Service blocks local task creation for federation assignments",
        );

        expect(
          listRuntimeFederationAssignments({
            env,
            now: now + 30,
          }).find((entry) => entry.id === "assignment-service-blocked"),
        ).toMatchObject({
          id: "assignment-service-blocked",
          state: "pending",
          surfaceId: "surface-service",
        });
        expect(loadRuntimeTaskStore({ env, now: now + 30 }).tasks).toEqual([]);
      },
    );
  });

  it("reconciles materialized assignments against the authoritative local task lifecycle", async () => {
    await withTempRoot("openclaw-runtime-federation-assignments-sync-", async (_root, env) => {
      const now = 1_700_000_903_000;
      persistRuntimeFederationAssignments(
        [
          {
            id: "assignment-runtime-sync",
            title: "Sync lifecycle",
            summary: "Auto-apply once the local task finishes.",
            sourceRuntimeId: "brain-runtime-4",
            localTaskId: "task-runtime-sync",
            state: "materialized",
            materializedAt: now,
          },
          {
            id: "assignment-operator-blocked",
            title: "Respect manual block",
            summary: "Manual local review should win.",
            sourceRuntimeId: "brain-runtime-4",
            localTaskId: "task-runtime-sync",
            state: "blocked",
            blockedReason: "Operator blocked this assignment locally.",
            materializedAt: now,
          },
        ],
        { env, now },
      );
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "strict",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6_000,
            maxContextChars: 9_000,
            compactionWatermark: 4_000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 60_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-runtime-sync",
              rootTaskId: "task-runtime-sync",
              title: "Local task finished",
              route: "ops",
              status: "completed",
              priority: "normal",
              budgetMode: "strict",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now + 50,
              metadata: {},
            },
          ],
          runs: [],
          archivedSteps: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now: now + 50 },
      );

      const sync = syncRuntimeFederationAssignmentTaskLifecycle({
        env,
        now: now + 100,
      });
      const assignments = listRuntimeFederationAssignments({
        env,
        now: now + 120,
      });

      expect(sync.changed).toBe(1);
      expect(sync.assignments[0]).toMatchObject({
        id: "assignment-runtime-sync",
        state: "applied",
        localTaskId: "task-runtime-sync",
        appliedAt: now + 100,
      });
      expect(assignments.find((entry) => entry.id === "assignment-runtime-sync")).toMatchObject({
        state: "applied",
        metadata: expect.objectContaining({
          localTaskStatus: "completed",
          lifecycleSyncedAt: now + 100,
        }),
      });
      expect(assignments.find((entry) => entry.id === "assignment-operator-blocked")).toMatchObject(
        {
          state: "blocked",
          blockedReason: "Operator blocked this assignment locally.",
        },
      );
    });
  });
});
