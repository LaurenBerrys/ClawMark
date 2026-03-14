import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listRuntimeFederationInbox,
  syncRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
} from "./federation-inbox.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import {
  buildRuntimeRetrievalSourceSet,
  loadRuntimeFederationStore,
  loadRuntimeUserConsoleStore,
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
    OPENCLAW_LEGACY_RUNTIME_ROOT: path.join(root, "legacy"),
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("runtime federation inbox", () => {
  it("syncs inbound packages into the authoritative federation inbox", async () => {
    await withTempRoot("openclaw-runtime-federation-inbox-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "team-knowledge"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "team-knowledge", "knowledge.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "team-knowledge-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_500_000,
            payload: {
              records: [
                {
                  id: "team-knowledge-1",
                  namespace: "team-shareable",
                  title: "Escalation policy",
                  summary: "Escalate payment disputes before issuing refunds.",
                  tags: ["support", "payments"],
                  createdAt: 1_700_000_400_000,
                  updatedAt: 1_700_000_400_100,
                },
              ],
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const result = syncRuntimeFederationInbox({
        env,
        now: 1_700_000_500_100,
      });
      const records = listRuntimeFederationInbox({
        env,
        now: 1_700_000_500_100,
      });
      const snapshot = buildFederationRuntimeSnapshot({
        env,
        now: 1_700_000_500_100,
      });

      expect(result.processed).toBe(1);
      expect(result.received).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0]?.state).toBe("received");
      expect(records[0]?.validationErrors).toEqual([]);
      expect(snapshot.inbox.total).toBe(1);
      expect(snapshot.inbox.stateCounts.received).toBe(1);
      expect(snapshot.inbox.latestPackages[0]?.packageType).toBe("team-knowledge-package");
    });
  });

  it("adopts shared strategies into retrieval and reverts role overlays cleanly", async () => {
    await withTempRoot("openclaw-runtime-federation-adopt-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });

      const sharedStrategyPackage = {
        schemaVersion: "v1" as const,
        type: "shared-strategy-package" as const,
        sourceRuntimeId: "brain-os-runtime",
        generatedAt: 1_700_000_600_000,
        payload: {
          strategies: [
            {
              id: "shared-strategy-1",
              layer: "strategies" as const,
              route: "sales",
              worker: "seller",
              skillIds: ["crm"],
              summary: "Lead with the accepted financing plan.",
              triggerConditions: "Customer asks about payment terms",
              recommendedPath: "Mention financing options before discounting.",
              fallbackPath: "Escalate to human closer after two objections.",
              thinkingLane: "system1" as const,
              confidence: 0.92,
              version: 1,
              invalidatedBy: [],
              sourceEventIds: [],
              sourceTaskIds: [],
              sourceIntelIds: [],
              derivedFromMemoryIds: [],
              createdAt: 1_700_000_590_000,
              updatedAt: 1_700_000_590_100,
            },
          ],
        },
      };

      const roleOptimizationPackage = {
        schemaVersion: "v1" as const,
        type: "role-optimization-package" as const,
        sourceRuntimeId: "brain-os-runtime",
        generatedAt: 1_700_000_600_050,
        payload: {
          surfaceId: "surface-sales",
          summary: "Raise initiative for the sales surface.",
          proposedOverlay: {
            role: "sales_closer",
            initiative: "high",
            tone: "confident",
          },
        },
      };

      await fs.writeFile(
        path.join(inboxRoot, "packages", "shared-strategy.json"),
        JSON.stringify(sharedStrategyPackage, null, 2),
        "utf8",
      );
      await fs.writeFile(
        path.join(inboxRoot, "packages", "role-optimization.json"),
        JSON.stringify(roleOptimizationPackage, null, 2),
        "utf8",
      );

      const userConsoleStore = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_600_090,
      });
      saveRuntimeUserConsoleStore(
        {
          ...userConsoleStore,
          surfaces: [
            {
              id: "surface-sales",
              channel: "wechat",
              accountId: "wechat-sales-001",
              label: "WeChat Sales",
              ownerKind: "user",
              active: true,
              createdAt: 1_700_000_590_000,
              updatedAt: 1_700_000_590_000,
            },
          ],
        },
        {
          env,
          now: 1_700_000_600_090,
        },
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_600_100,
      });
      const records = listRuntimeFederationInbox({
        env,
        now: 1_700_000_600_100,
      });

      const sharedRecord = records.find((entry) => entry.packageType === "shared-strategy-package");
      const roleRecord = records.find((entry) => entry.packageType === "role-optimization-package");
      expect(sharedRecord).toBeDefined();
      expect(roleRecord).toBeDefined();

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: sharedRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_600_200 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: roleRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_600_300 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      const federationStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_600_400,
      });
      const retrieval = buildRuntimeRetrievalSourceSet({
        env,
        now: 1_700_000_600_400,
      });
      const adoptedUserConsole = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_600_400,
      });

      expect(federationStore.sharedStrategies.map((entry) => entry.id)).toContain(
        "shared-strategy-1",
      );
      expect(retrieval.strategies.map((entry) => entry.id)).toContain("shared-strategy-1");
      expect(
        adoptedUserConsole.surfaceRoleOverlays.find((entry) => entry.surfaceId === "surface-sales")
          ?.role,
      ).toBe("sales_closer");

      transitionRuntimeFederationPackage(
        {
          id: roleRecord!.id,
          state: "reverted",
        },
        {
          env,
          now: 1_700_000_600_500,
        },
      );

      const revertedUserConsole = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_600_500,
      });
      expect(
        revertedUserConsole.surfaceRoleOverlays.find(
          (entry) => entry.surfaceId === "surface-sales",
        ),
      ).toBeUndefined();
    });
  });
});
