import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeRetrievalSourceSet,
  loadRuntimeTaskStore,
  loadRuntimeUserConsoleStore,
  resolveRuntimeStorePaths,
  saveRuntimeUserConsoleStore,
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

describe("runtime store metadata normalization", () => {
  it("upgrades imported legacy task metadata into canonical runtime keys on load", async () => {
    await withTempRoot("openclaw-runtime-store-", async (_root, env) => {
      const paths = resolveRuntimeStorePaths({ env, now: 1_700_000_000_000 });
      await fs.mkdir(path.dirname(paths.taskStorePath), { recursive: true });
      await fs.writeFile(
        paths.taskStorePath,
        JSON.stringify(
          {
            version: "v1",
            defaults: {
              defaultBudgetMode: "balanced",
              defaultRetrievalMode: "light",
              maxInputTokensPerTurn: 6000,
              maxContextChars: 9000,
              maxRemoteCallsPerTask: 6,
            },
            tasks: [
              {
                id: "task-1",
                title: "Imported task",
                route: "general",
                status: "queued",
                priority: "normal",
                budgetMode: "balanced",
                retrievalMode: "light",
                skillIds: [],
                memoryRefs: [],
                intelRefs: [],
                recurring: false,
                maintenance: false,
                createdAt: 1_700_000_000_000,
                updatedAt: 1_700_000_000_100,
                metadata: {
                  legacyCompatibility: {
                    workspace: "/tmp/workspace",
                    notes: "migrated context",
                  },
                  legacyRunState: {
                    lastThinkingLane: "system2",
                    remoteCallCount: 3,
                  },
                },
              },
            ],
            runs: [],
            steps: [],
            reviews: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      const store = loadRuntimeTaskStore({ env, now: 1_700_000_000_100 });
      const task = store.tasks[0];

      expect(task?.metadata?.taskContext).toEqual({
        workspace: "/tmp/workspace",
        notes: "migrated context",
      });
      expect(task?.metadata?.runtimeTask).toEqual({
        runState: {
          lastThinkingLane: "system2",
          remoteCallCount: 3,
        },
      });
      expect("legacyCompatibility" in (task?.metadata ?? {})).toBe(false);
      expect("legacyRunState" in (task?.metadata ?? {})).toBe(false);
    });
  });

  it("persists the runtime user console store in sqlite", async () => {
    await withTempRoot("openclaw-runtime-user-store-", async (_root, env) => {
      const now = 1_700_100_000_000;
      saveRuntimeUserConsoleStore(
        {
          version: "v1",
          userModel: {
            id: "runtime-user",
            displayName: "Operator",
            communicationStyle: "direct and concise",
            interruptionThreshold: "medium",
            reportVerbosity: "brief",
            confirmationBoundary: "balanced",
            reportPolicy: "reply",
            createdAt: now,
            updatedAt: now,
          },
          agents: [
            {
              id: "agent-sales",
              name: "Sales Agent",
              memoryNamespace: "agent/agent-sales",
              skillIds: ["pitch", "follow-up"],
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          agentOverlays: [
            {
              id: "agent-overlay-sales",
              agentId: "agent-sales",
              reportPolicy: "proactive",
              updatedAt: now,
            },
          ],
          surfaces: [
            {
              id: "surface-wechat-sales",
              channel: "wechat",
              accountId: "wx-sales-01",
              label: "WeChat Sales",
              ownerKind: "agent",
              ownerId: "agent-sales",
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-wechat-sales",
              surfaceId: "surface-wechat-sales",
              role: "sales",
              businessGoal: "close qualified leads",
              allowedTopics: ["pricing", "shipping"],
              restrictedTopics: ["refund policy exceptions"],
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        { env, now },
      );

      const store = loadRuntimeUserConsoleStore({ env, now });
      expect(store.userModel.displayName).toBe("Operator");
      expect(store.agents.map((agent) => agent.id)).toEqual(["agent-sales"]);
      expect(store.surfaces[0]?.ownerKind).toBe("agent");
      expect(store.surfaceRoleOverlays[0]?.role).toBe("sales");

      const retrievalSources = buildRuntimeRetrievalSourceSet({ env, now });
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain("runtime-user");
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain("agent-sales");
      expect(retrievalSources.sessions.map((entry) => entry.recordId)).toContain(
        "surface-wechat-sales",
      );
    });
  });
});
