import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeCapabilityPolicy } from "./capability-plane.js";
import {
  configureRuntimeFederationInboxMaintenance,
  listRuntimeFederationInbox,
  materializeRuntimeCoordinatorSuggestionTask,
  reviewRuntimeFederationInboxMaintenance,
  syncRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
} from "./federation-inbox.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import { adoptRuntimeRoleOptimizationCandidate } from "./user-console.js";
import {
  buildRuntimeRetrievalSourceSet,
  loadRuntimeTaskStore,
  loadRuntimeFederationStore,
  loadRuntimeUserConsoleStore,
  saveRuntimeFederationStore,
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

  it("materializes malformed local inbox files as authoritative invalid-package records", async () => {
    await withTempRoot("openclaw-runtime-federation-inbox-invalid-json-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "broken.json"),
        '{"schemaVersion":"v1","type":"team-knowledge-package",',
        "utf8",
      );

      const result = syncRuntimeFederationInbox({
        env,
        now: 1_700_000_505_000,
      });
      const records = listRuntimeFederationInbox({
        env,
        now: 1_700_000_505_000,
      });
      const snapshot = buildFederationRuntimeSnapshot({
        env,
        now: 1_700_000_505_000,
      });

      expect(result.processed).toBe(1);
      expect(result.invalid).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        packageType: "invalid-package",
        state: "received",
        sourceRuntimeId: "unknown-runtime",
      });
      expect(records[0]?.validationErrors[0]).toContain("invalid JSON");
      expect(records[0]?.payload).toMatchObject({
        type: "invalid-package",
        payload: {
          fileName: "broken.json",
        },
      });
      expect(snapshot.inbox.latestPackages[0]).toMatchObject({
        packageType: "invalid-package",
        validationErrorCount: 1,
        localLandingLabel: "invalid-package",
      });
      expect(snapshot.inbox.latestPackages[0]?.payloadPreview).toEqual(
        expect.arrayContaining([
          "file broken.json",
        ]),
      );
      expect(snapshot.inbox.latestPackages[0]?.reviewSignals).toEqual([]);
    });
  });

  it("rejects team knowledge packages that try to import private namespace records", async () => {
    await withTempRoot("openclaw-runtime-federation-team-knowledge-invalid-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "team-knowledge-invalid.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "team-knowledge-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_550_000,
            payload: {
              records: [
                {
                  id: "team-knowledge-private",
                  namespace: "private",
                  title: "Private escalation notes",
                  summary: "Do not export this private note.",
                  tags: ["private"],
                  createdAt: 1_700_000_540_000,
                  updatedAt: 1_700_000_540_100,
                },
              ],
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_550_100,
      });
      const record = listRuntimeFederationInbox({
        env,
        now: 1_700_000_550_100,
      }).find((entry) => entry.packageType === "team-knowledge-package");
      const federationStoreBefore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_550_100,
      });

      expect(record).toBeDefined();
      expect(record?.state).toBe("received");
      expect(record?.validationErrors).toContain(
        "payload.records[0].namespace must be team-shareable",
      );
      expect(federationStoreBefore.teamKnowledge).toEqual([]);

      expect(() =>
        transitionRuntimeFederationPackage(
          {
            id: record!.id,
            state: "validated",
          },
          {
            env,
            now: 1_700_000_550_200,
          },
        ),
      ).toThrowError(`federation package ${record!.id} has validation errors`);

      const federationStoreAfter = loadRuntimeFederationStore({
        env,
        now: 1_700_000_550_300,
      });
      expect(federationStoreAfter.teamKnowledge).toEqual([]);
    });
  });

  it("adopts and reverts only team-shareable knowledge records", async () => {
    await withTempRoot("openclaw-runtime-federation-team-knowledge-adopt-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "team-knowledge-valid.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "team-knowledge-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_560_000,
            payload: {
              records: [
                {
                  id: "team-knowledge-shared-1",
                  namespace: "team-shareable",
                  title: "Shared escalation policy",
                  summary: "Escalate payment disputes before issuing refunds.",
                  tags: ["support", "payments"],
                  createdAt: 1_700_000_559_000,
                  updatedAt: 1_700_000_559_100,
                },
              ],
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_560_050,
      });
      const record = listRuntimeFederationInbox({
        env,
        now: 1_700_000_560_050,
      }).find((entry) => entry.packageType === "team-knowledge-package");

      expect(record).toBeDefined();
      expect(record?.validationErrors).toEqual([]);

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: record!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_560_100 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      const adoptedStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_560_200,
      });
      expect(adoptedStore.teamKnowledge).toHaveLength(1);
      expect(adoptedStore.teamKnowledge[0]).toMatchObject({
        id: "team-knowledge-shared-1",
        namespace: "team-shareable",
        title: "Shared escalation policy",
        sourceRuntimeId: "brain-os-runtime",
      });
      expect(adoptedStore.teamKnowledge[0]?.metadata).toMatchObject({
        federationPackageId: record!.id,
        federationSourceRuntimeId: "brain-os-runtime",
        sourcePackageId: record!.id,
        adoptedAt: 1_700_000_560_103,
      });

      transitionRuntimeFederationPackage(
        {
          id: record!.id,
          state: "reverted",
        },
        {
          env,
          now: 1_700_000_560_250,
        },
      );

      const revertedStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_560_300,
      });
      expect(revertedStore.teamKnowledge).toEqual([]);
    });
  });

  it("rejects runtime policy overlays that try to write unsupported governance fields", async () => {
    await withTempRoot("openclaw-runtime-federation-policy-invalid-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "runtime-policy-invalid.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "runtime-policy-overlay-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_565_000,
            payload: {
              route: "coder",
              policy: {
                blockedSkills: ["shell"],
                privateMemoryWrite: true,
                mcpGrants: [
                  {
                    agentId: "research",
                    mcpServerId: "github",
                    state: "elevated",
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_565_050,
      });
      const record = listRuntimeFederationInbox({
        env,
        now: 1_700_000_565_050,
      }).find((entry) => entry.packageType === "runtime-policy-overlay-package");

      expect(record).toBeDefined();
      expect(record?.validationErrors).toContain(
        "payload.policy.privateMemoryWrite is not allowed in federation runtime overlays",
      );
      expect(record?.validationErrors).toContain(
        "payload.policy.mcpGrants[0].state must be allowed or denied",
      );

      expect(() =>
        transitionRuntimeFederationPackage(
          {
            id: record!.id,
            state: "validated",
          },
          {
            env,
            now: 1_700_000_565_100,
          },
        ),
      ).toThrowError(`federation package ${record!.id} has validation errors`);
    });
  });

  it("adopts sanitized runtime policy overlays into the local capability plane", async () => {
    await withTempRoot("openclaw-runtime-federation-policy-adopt-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "runtime-policy-valid.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "runtime-policy-overlay-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_566_000,
            payload: {
              route: "coder",
              policy: {
                blockedSkills: ["shell"],
                governanceEntries: [
                  {
                    registryType: "agent",
                    targetId: "research",
                    state: "blocked",
                    summary: "Keep the research agent out of the primary coder route.",
                  },
                ],
                mcpGrants: [
                  {
                    agentId: "main",
                    mcpServerId: "memory",
                    state: "allowed",
                    summary: "Allow the main agent to access MCP memory tools.",
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_566_050,
      });
      const record = listRuntimeFederationInbox({
        env,
        now: 1_700_000_566_050,
      }).find((entry) => entry.packageType === "runtime-policy-overlay-package");

      expect(record).toBeDefined();
      expect(record?.validationErrors).toEqual([]);
      expect(record?.review).toMatchObject({
        riskLevel: "high",
        autoAdoptEligible: false,
        requiresReasonOnAdopt: true,
        routeScope: "route",
      });

      for (const targetState of ["validated", "shadowed", "recommended"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: record!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_566_100 +
              ["validated", "shadowed", "recommended"].indexOf(targetState),
          },
        );
      }

      expect(() =>
        transitionRuntimeFederationPackage(
          {
            id: record!.id,
            state: "adopted",
          },
          {
            env,
            now: 1_700_000_566_199,
          },
        ),
      ).toThrowError(
        `federation package ${record!.id} requires a manual approval reason before adoption`,
      );

      transitionRuntimeFederationPackage(
        {
          id: record!.id,
          state: "adopted",
          reason: "Manual local approval after reviewing high-risk MCP grant expansion.",
        },
        {
          env,
          now: 1_700_000_566_200,
        },
      );

      const federationStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_566_210,
      });
      const appliedOverlay = (
        federationStore.metadata?.appliedPolicyOverlays as Record<string, unknown> | undefined
      )?.[record!.id] as {
        route?: string;
        policy?: Record<string, unknown>;
        review?: { riskLevel?: string; autoAdoptEligible?: boolean };
      } | undefined;
      const capabilityPolicy = resolveRuntimeCapabilityPolicy(null, {
        env,
        now: 1_700_000_566_210,
        route: "coder",
      });

      expect(appliedOverlay?.route).toBe("coder");
      expect(appliedOverlay?.policy).toMatchObject({
        blockedSkills: ["shell"],
      });
      expect(appliedOverlay?.review).toMatchObject({
        riskLevel: "high",
        autoAdoptEligible: false,
      });
      expect(appliedOverlay?.policy?.privateMemoryWrite).toBeUndefined();
      expect(capabilityPolicy.resolveEntry("agent", "research")?.state).toBe("blocked");
      expect(capabilityPolicy.resolveEntry("skill", "shell")?.state).toBe("blocked");
      expect(capabilityPolicy.resolveMcpGrant("main", "memory")?.state).toBe("allowed");
    });
  });

  it("marks route-scoped restrictive runtime policy overlays as low-risk auto-adopt candidates", async () => {
    await withTempRoot("openclaw-runtime-federation-policy-low-risk-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });
      await fs.writeFile(
        path.join(inboxRoot, "packages", "runtime-policy-low-risk.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "runtime-policy-overlay-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_567_000,
            payload: {
              route: "seller",
              policy: {
                blockedSkills: ["browser"],
                skillStates: {
                  crm: "shadow",
                },
                mcpGrants: [
                  {
                    agentId: "main",
                    mcpServerId: "search",
                    state: "denied",
                  },
                ],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_567_050,
      });
      const record = listRuntimeFederationInbox({
        env,
        now: 1_700_000_567_050,
      }).find((entry) => entry.packageType === "runtime-policy-overlay-package");

      expect(record).toBeDefined();
      expect(record?.review).toMatchObject({
        riskLevel: "low",
        autoAdoptEligible: true,
        requiresReasonOnAdopt: false,
        routeScope: "route",
      });
      expect(record?.review?.signals).toContain(
        "Route-scoped overlay stays limited to a named runtime route.",
      );
      expect(record?.review?.signals).toContain(
        "Overlay only restricts MCP access with denied grants.",
      );
    });
  });

  it("adopts shared strategies and routes federation role optimization into the user console queue", async () => {
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
              sourceReviewIds: [],
              sourceMemoryIds: [],
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
      const adoptedCandidate = adoptedUserConsole.roleOptimizationCandidates.find(
        (entry) => entry.source === "federation" && entry.surfaceId === "surface-sales",
      );
      expect(adoptedCandidate).toMatchObject({
        state: "recommended",
        source: "federation",
        summary: "Raise initiative for the sales surface.",
      });
      expect(adoptedCandidate?.proposedOverlay).toMatchObject({
        role: "sales_closer",
        initiative: "high",
        tone: "confident",
      });
      expect(
        adoptedUserConsole.surfaceRoleOverlays.find((entry) => entry.surfaceId === "surface-sales"),
      ).toBeUndefined();

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
      const revertedCandidate = revertedUserConsole.roleOptimizationCandidates.find(
        (entry) => entry.source === "federation" && entry.surfaceId === "surface-sales",
      );
      expect(revertedCandidate?.state).toBe("reverted");
      expect(
        revertedUserConsole.surfaceRoleOverlays.find((entry) => entry.surfaceId === "surface-sales"),
      ).toBeUndefined();
    });
  });

  it("adopts coordinator suggestions into a local queue without creating active tasks", async () => {
    await withTempRoot("openclaw-runtime-federation-coordinator-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });

      await fs.writeFile(
        path.join(inboxRoot, "packages", "coordinator-suggestion.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "coordinator-suggestion",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_700_000,
            payload: {
              id: "coord-suggest-1",
              title: "Coordinate partner follow-up",
              summary: "Recommend a follow-up task for the partner escalation queue.",
              taskId: "follow-up-root-task",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_700_050,
      });
      const suggestionRecord = listRuntimeFederationInbox({
        env,
        now: 1_700_000_700_050,
      }).find((entry) => entry.packageType === "coordinator-suggestion");

      expect(suggestionRecord).toBeDefined();

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: suggestionRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_700_100 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      const federationStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_700_200,
      });
      const snapshot = buildFederationRuntimeSnapshot({
        env,
        now: 1_700_000_700_200,
      });
      const taskStore = loadRuntimeTaskStore({
        env,
        now: 1_700_000_700_200,
      });

      expect(federationStore.coordinatorSuggestions).toHaveLength(1);
      expect(federationStore.coordinatorSuggestions[0]).toMatchObject({
        id: "coord-suggest-1",
        title: "Coordinate partner follow-up",
        taskId: "follow-up-root-task",
        sourceRuntimeId: "brain-os-runtime",
      });
      expect(snapshot.inbox.coordinatorSuggestionCount).toBe(1);
      expect(snapshot.inbox.latestCoordinatorSuggestions[0]?.id).toBe("coord-suggest-1");
      expect(taskStore.tasks).toHaveLength(0);

      transitionRuntimeFederationPackage(
        {
          id: suggestionRecord!.id,
          state: "reverted",
        },
        {
          env,
          now: 1_700_000_700_250,
        },
      );

      const revertedStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_700_260,
      });
      expect(revertedStore.coordinatorSuggestions).toHaveLength(0);
    });
  });

  it("materializes adopted coordinator suggestions into local queued tasks without foreign lineage", async () => {
    await withTempRoot("openclaw-runtime-federation-coordinator-materialize-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });

      await fs.writeFile(
        path.join(inboxRoot, "packages", "coordinator-suggestion.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "coordinator-suggestion",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_710_000,
            payload: {
              id: "coord-suggest-materialize",
              title: "Coordinate partner follow-up",
              summary: "Queue a local follow-up without inheriting the remote root task id.",
              taskId: "remote-root-task",
              metadata: {
                route: "sales",
                surfaceId: "surface-sales",
                worker: "reviewer",
                skillIds: ["crm"],
                tags: ["partner", "follow-up"],
                priority: "high",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const userConsoleStore = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_710_020,
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
              ownerKind: "agent",
              ownerId: "agent-sales",
              active: true,
              createdAt: 1_700_000_709_000,
              updatedAt: 1_700_000_709_000,
            },
          ],
          agents: [
            {
              id: "agent-sales",
              name: "Sales Agent",
              roleBase: "lead-closer",
              memoryNamespace: "agent-sales",
              skillIds: ["crm"],
              active: true,
              createdAt: 1_700_000_709_000,
              updatedAt: 1_700_000_709_000,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-sales",
              surfaceId: "surface-sales",
              role: "sales_closer",
              reportTarget: "runtime-user",
              allowedTopics: [],
              restrictedTopics: [],
              localBusinessPolicy: {
                runtimeCoreBinding: "forbidden",
                formalMemoryWrite: false,
                userModelWrite: false,
                surfaceRoleWrite: false,
                taskCreation: "recommend_only",
                escalationTarget: "surface-owner",
                privacyBoundary: "agent-local",
                roleScope: "sales-queue",
              },
              createdAt: 1_700_000_709_000,
              updatedAt: 1_700_000_709_000,
            },
          ],
        },
        {
          env,
          now: 1_700_000_710_020,
        },
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_710_050,
      });
      const suggestionRecord = listRuntimeFederationInbox({
        env,
        now: 1_700_000_710_050,
      }).find((entry) => entry.packageType === "coordinator-suggestion");

      expect(suggestionRecord).toBeDefined();

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: suggestionRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_710_100 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      const first = materializeRuntimeCoordinatorSuggestionTask("coord-suggest-materialize", {
        env,
        now: 1_700_000_710_200,
      });
      const second = materializeRuntimeCoordinatorSuggestionTask("coord-suggest-materialize", {
        env,
        now: 1_700_000_710_300,
      });
      const taskStore = loadRuntimeTaskStore({
        env,
        now: 1_700_000_710_300,
      });
      const federationStore = loadRuntimeFederationStore({
        env,
        now: 1_700_000_710_300,
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.task.id).toBe(first.task.id);
      expect(taskStore.tasks).toHaveLength(1);
      expect(taskStore.tasks[0]).toMatchObject({
        id: first.task.id,
        title: "Coordinate partner follow-up",
        goal: "Queue a local follow-up without inheriting the remote root task id.",
        route: "sales",
        worker: "reviewer",
        priority: "high",
        rootTaskId: first.task.id,
      });
      expect(taskStore.tasks[0]?.parentTaskId).toBeUndefined();
      expect(taskStore.tasks[0]?.artifactRefs).toEqual(
        expect.arrayContaining([
          `federation-package:${suggestionRecord!.id}`,
          "federation-coordinator-suggestion:coord-suggest-materialize",
          "federation-source-task:remote-root-task",
        ]),
      );
      expect(taskStore.tasks[0]?.metadata).toMatchObject({
        federation: {
          sourceRuntimeId: "brain-os-runtime",
          coordinatorSuggestionId: "coord-suggest-materialize",
          sourceTaskId: "remote-root-task",
        },
        surface: {
          surfaceId: "surface-sales",
          label: "WeChat Sales",
          channel: "wechat",
          ownerKind: "agent",
          ownerId: "agent-sales",
          effectiveRole: "sales_closer",
          reportTarget: "runtime-user",
          taskCreationPolicy: "recommend_only",
          escalationTarget: "surface-owner",
          roleScope: "sales-queue",
        },
      });
      expect(federationStore.coordinatorSuggestions[0]).toMatchObject({
        id: "coord-suggest-materialize",
        localTaskId: first.task.id,
        localTaskStatus: "queued",
        materializedAt: 1_700_000_710_200,
        lifecycleSyncedAt: 1_700_000_710_200,
        lastMaterializedLocalTaskId: first.task.id,
        lastMaterializedAt: 1_700_000_710_200,
      });
    });
  });

  it("blocks coordinator suggestion materialization when the bound surface disables local task creation", async () => {
    await withTempRoot("openclaw-runtime-federation-coordinator-blocked-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });

      await fs.writeFile(
        path.join(inboxRoot, "packages", "coordinator-suggestion-blocked.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "coordinator-suggestion",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_720_000,
            payload: {
              id: "coord-suggest-blocked",
              title: "Queue a surface-owned sales follow-up",
              summary: "This should stay in review because the sales surface blocks local task creation.",
              taskId: "remote-root-task",
              metadata: {
                route: "sales",
                surfaceId: "surface-sales",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const userConsoleStore = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_720_010,
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
              createdAt: 1_700_000_719_000,
              updatedAt: 1_700_000_719_000,
            },
          ],
          surfaceRoleOverlays: [
            {
              id: "surface-role-sales",
              surfaceId: "surface-sales",
              role: "sales_closer",
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
                roleScope: "sales-queue",
              },
              createdAt: 1_700_000_719_000,
              updatedAt: 1_700_000_719_000,
            },
          ],
        },
        {
          env,
          now: 1_700_000_720_010,
        },
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_720_050,
      });
      const suggestionRecord = listRuntimeFederationInbox({
        env,
        now: 1_700_000_720_050,
      }).find((entry) => entry.packageType === "coordinator-suggestion");

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: suggestionRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_720_100 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      expect(() =>
        materializeRuntimeCoordinatorSuggestionTask("coord-suggest-blocked", {
          env,
          now: 1_700_000_720_200,
        })
      ).toThrow(/blocks local task creation/i);
      expect(loadRuntimeTaskStore({ env, now: 1_700_000_720_200 }).tasks).toHaveLength(0);
    });
  });

  it("does not roll back locally adopted surface truth when a federation role package is reverted", async () => {
    await withTempRoot("openclaw-runtime-federation-role-sovereignty-", async (root, env) => {
      const inboxRoot = path.join(root, "instance", "data", "federation", "inbox");
      await fs.mkdir(path.join(inboxRoot, "packages"), { recursive: true });

      await fs.writeFile(
        path.join(inboxRoot, "packages", "role-optimization.json"),
        JSON.stringify(
          {
            schemaVersion: "v1",
            type: "role-optimization-package",
            sourceRuntimeId: "brain-os-runtime",
            generatedAt: 1_700_000_800_000,
            payload: {
              surfaceId: "surface-sales",
              summary: "Raise initiative for the sales surface.",
              proposedOverlay: {
                role: "sales_closer",
                initiative: "high",
                tone: "confident",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const userConsoleStore = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_800_010,
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
              createdAt: 1_700_000_799_000,
              updatedAt: 1_700_000_799_000,
            },
          ],
        },
        {
          env,
          now: 1_700_000_800_010,
        },
      );

      syncRuntimeFederationInbox({
        env,
        now: 1_700_000_800_020,
      });
      const roleRecord = listRuntimeFederationInbox({
        env,
        now: 1_700_000_800_020,
      }).find((entry) => entry.packageType === "role-optimization-package");

      expect(roleRecord).toBeDefined();

      for (const targetState of ["validated", "shadowed", "recommended", "adopted"] as const) {
        transitionRuntimeFederationPackage(
          {
            id: roleRecord!.id,
            state: targetState,
          },
          {
            env,
            now:
              1_700_000_800_100 +
              ["validated", "shadowed", "recommended", "adopted"].indexOf(targetState),
          },
        );
      }

      const candidate = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_800_120,
      }).roleOptimizationCandidates.find(
        (entry) => entry.source === "federation" && entry.surfaceId === "surface-sales",
      );
      expect(candidate?.state).toBe("recommended");

      adoptRuntimeRoleOptimizationCandidate(candidate!.id, {
        env,
        now: 1_700_000_800_130,
      });

      transitionRuntimeFederationPackage(
        {
          id: roleRecord!.id,
          state: "reverted",
        },
        {
          env,
          now: 1_700_000_800_140,
        },
      );

      const finalUserConsole = loadRuntimeUserConsoleStore({
        env,
        now: 1_700_000_800_150,
      });
      const finalCandidate = finalUserConsole.roleOptimizationCandidates.find(
        (entry) => entry.id === candidate!.id,
      );
      expect(finalCandidate?.state).toBe("adopted");
      expect(finalCandidate?.metadata?.federationPackageState).toBe("reverted");
      expect(
        finalUserConsole.surfaceRoleOverlays.find((entry) => entry.surfaceId === "surface-sales")
          ?.role,
      ).toBe("sales_closer");
    });
  });

  it("expires stale actionable packages during federation inbox maintenance without touching protected states", async () => {
    await withTempRoot("openclaw-runtime-federation-maintenance-", async (_root, env) => {
      const now = 1_700_000_900_000;
      const federationStore = loadRuntimeFederationStore({ env, now });
      saveRuntimeFederationStore(
        {
          ...federationStore,
          inbox: [
            {
              id: "pkg-stale-received",
              packageType: "team-knowledge-package",
              sourceRuntimeId: "brain-os-runtime",
              state: "received",
              summary: "Stale inbox package",
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
            {
              id: "pkg-fresh-recommended",
              packageType: "shared-strategy-package",
              sourceRuntimeId: "brain-os-runtime",
              state: "recommended",
              summary: "Fresh recommended package",
              validationErrors: [],
              receivedAt: now - 2 * 60 * 60 * 1000,
              validatedAt: now - 90 * 60 * 1000,
              shadowedAt: now - 60 * 60 * 1000,
              recommendedAt: now - 30 * 60 * 1000,
              updatedAt: now - 30 * 60 * 1000,
              payload: {
                schemaVersion: "v1",
                type: "shared-strategy-package",
                sourceRuntimeId: "brain-os-runtime",
                generatedAt: now - 2 * 60 * 60 * 1000,
                payload: {
                  strategies: [],
                },
              },
            },
            {
              id: "pkg-adopted",
              packageType: "runtime-policy-overlay-package",
              sourceRuntimeId: "brain-os-runtime",
              state: "adopted",
              summary: "Already adopted package",
              validationErrors: [],
              receivedAt: now - 30 * 24 * 60 * 60 * 1000,
              adoptedAt: now - 29 * 24 * 60 * 60 * 1000,
              updatedAt: now - 29 * 24 * 60 * 60 * 1000,
              payload: {
                schemaVersion: "v1",
                type: "runtime-policy-overlay-package",
                sourceRuntimeId: "brain-os-runtime",
                generatedAt: now - 30 * 24 * 60 * 60 * 1000,
                payload: {
                  route: "global",
                  policy: {
                    blockedSkills: ["destructive-tool"],
                  },
                },
              },
            },
          ],
        },
        {
          env,
          now,
        },
      );

      const result = reviewRuntimeFederationInboxMaintenance({
        env,
        now: now + 1_000,
      });
      const nextStore = loadRuntimeFederationStore({
        env,
        now: now + 2_000,
      });

      expect(result.expiredCount).toBe(1);
      expect(result.expiredPackageIds).toEqual(["pkg-stale-received"]);
      expect(result.pendingReviewCount).toBe(1);
      expect(result.stalePackageCount).toBe(0);
      expect(nextStore.inbox.find((entry) => entry.id === "pkg-stale-received")?.state).toBe(
        "expired",
      );
      expect(
        nextStore.inbox.find((entry) => entry.id === "pkg-stale-received")?.metadata,
      ).toMatchObject({
        expiredFromState: "received",
        expiredBy: "runtime-federation-inbox-maintenance",
      });
      expect(nextStore.inbox.find((entry) => entry.id === "pkg-fresh-recommended")?.state).toBe(
        "recommended",
      );
      expect(nextStore.inbox.find((entry) => entry.id === "pkg-adopted")?.state).toBe("adopted");
      expect(nextStore.metadata).toMatchObject({
        lastReviewAt: now + 1_000,
        lastExpiredAt: now + 1_000,
        lastExpiredCount: 1,
      });
    });
  });

  it("configures authoritative federation inbox maintenance controls with bounded expiry windows", async () => {
    await withTempRoot("openclaw-runtime-federation-maintenance-config-", async (_root, env) => {
      const now = 1_700_000_901_000;
      const configured = configureRuntimeFederationInboxMaintenance(
        {
          enabled: false,
          reviewIntervalHours: 24,
          expireReceivedAfterHours: 0,
          expireValidatedAfterHours: 240,
          expireShadowedAfterHours: 360,
          expireRecommendedAfterHours: 480,
        },
        { env, now },
      );
      const store = loadRuntimeFederationStore({ env, now: now + 5 });

      expect(configured.enabled).toBe(false);
      expect(configured.reviewIntervalHours).toBe(24);
      expect(configured.expireReceivedAfterHours).toBe(72);
      expect(configured.expireValidatedAfterHours).toBe(240);
      expect(configured.expireShadowedAfterHours).toBe(360);
      expect(configured.expireRecommendedAfterHours).toBe(480);
      expect(store.metadata).toMatchObject({
        enabled: false,
        reviewIntervalHours: 24,
        expireReceivedAfterHours: 72,
        expireValidatedAfterHours: 240,
        expireShadowedAfterHours: 360,
        expireRecommendedAfterHours: 480,
      });
    });
  });
});
