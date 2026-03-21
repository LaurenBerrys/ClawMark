import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRuntimeFederationCoordinatorSuggestionTaskLifecycle } from "./federation-coordinator-sync.js";
import {
  loadRuntimeFederationStore,
  saveRuntimeFederationStore,
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

describe("runtime federation coordinator suggestion lifecycle sync", () => {
  it("requeues materialized coordinator suggestions when the linked local task is missing", async () => {
    await withTempRoot("openclaw-runtime-coordinator-sync-missing-", async (_root, env) => {
      const now = 1_700_400_000_000;
      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-missing",
              title: "Resume lost local follow-up",
              summary: "Requeue when the linked local task disappeared.",
              sourceRuntimeId: "brain-runtime-missing",
              sourcePackageId: "pkg-coord-missing",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              localTaskId: "task-missing",
              materializedAt: now,
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const result = syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
        env,
        now: now + 50,
      });
      const suggestion = loadRuntimeFederationStore({
        env,
        now: now + 60,
      }).coordinatorSuggestions[0];

      expect(result.changed).toBe(1);
      expect(result.suggestions[0]).toMatchObject({
        id: "coord-missing",
        localTaskId: undefined,
        localTaskStatus: "missing",
        lastMaterializedLocalTaskId: "task-missing",
        lastMaterializedAt: now,
      });
      expect(suggestion).toMatchObject({
        id: "coord-missing",
        localTaskId: undefined,
        localTaskStatus: "missing",
        lifecycleSyncedAt: now + 50,
        lastMaterializedLocalTaskId: "task-missing",
        lastMaterializedAt: now,
        rematerializeReason: "Linked local task task-missing is missing locally.",
      });
    });
  });

  it("keeps materialized coordinator suggestions linked while recording local completion", async () => {
    await withTempRoot("openclaw-runtime-coordinator-sync-completed-", async (_root, env) => {
      const now = 1_700_400_010_000;
      saveRuntimeTaskStore(
        {
          version: "v1",
          defaults: {
            defaultBudgetMode: "balanced",
            defaultRetrievalMode: "light",
            maxInputTokensPerTurn: 6_000,
            maxContextChars: 9_000,
            compactionWatermark: 4_000,
            maxRemoteCallsPerTask: 6,
            leaseDurationMs: 90_000,
            maxConcurrentRunsPerWorker: 2,
            maxConcurrentRunsPerRoute: 3,
          },
          tasks: [
            {
              id: "task-completed",
              rootTaskId: "task-completed",
              title: "Completed local follow-up",
              goal: "Keep the coordinator suggestion linked after completion.",
              route: "sales",
              status: "completed",
              priority: "normal",
              budgetMode: "balanced",
              retrievalMode: "light",
              skillIds: [],
              memoryRefs: [],
              artifactRefs: [],
              recurring: false,
              maintenance: false,
              createdAt: now,
              updatedAt: now + 20,
            },
          ],
          runs: [],
          archivedSteps: [],
          steps: [],
          reviews: [],
          reports: [],
        },
        { env, now },
      );
      saveRuntimeFederationStore(
        {
          version: "v1",
          inbox: [],
          coordinatorSuggestions: [
            {
              id: "coord-completed",
              title: "Confirm completed local follow-up",
              summary: "Keep the local link for auditing after completion.",
              sourceRuntimeId: "brain-runtime-completed",
              sourcePackageId: "pkg-coord-completed",
              createdAt: now,
              updatedAt: now,
              adoptedAt: now,
              localTaskId: "task-completed",
              materializedAt: now,
            },
          ],
          sharedStrategies: [],
          teamKnowledge: [],
        },
        { env, now },
      );

      const result = syncRuntimeFederationCoordinatorSuggestionTaskLifecycle({
        env,
        now: now + 100,
      });
      const suggestion = loadRuntimeFederationStore({
        env,
        now: now + 110,
      }).coordinatorSuggestions[0];

      expect(result.changed).toBe(1);
      expect(suggestion).toMatchObject({
        id: "coord-completed",
        localTaskId: "task-completed",
        localTaskStatus: "completed",
        lifecycleSyncedAt: now + 100,
        lastMaterializedLocalTaskId: "task-completed",
        lastMaterializedAt: now,
        rematerializeReason: undefined,
      });
    });
  });
});
