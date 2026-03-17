import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveRuntimeCapabilityPolicy,
  syncRuntimeCapabilityRegistry,
  upsertRuntimeMcpGrant,
  upsertRuntimeCapabilityRegistryEntry,
} from "./capability-plane.js";
import { transitionRuntimeFederationPackage } from "./federation-inbox.js";
import { buildRuntimeCapabilitiesStatus } from "./runtime-dashboard.js";
import {
  loadRuntimeGovernanceStore,
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
  } as NodeJS.ProcessEnv;
  try {
    await run(root, env);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("runtime capability plane", () => {
  it("syncs agent, skill, and mcp registry entries into the authoritative store", async () => {
    await withTempRoot("openclaw-runtime-capability-", async (_root, env) => {
      const now = 1_700_340_000_000;
      const config = {
        browser: { enabled: true },
        agents: {
          defaults: {
            sandbox: { mode: "off" },
            workspace: "/tmp/runtime-workspace",
          },
          list: [{ id: "main" }, { id: "research" }],
        },
        tools: {
          skills: {
            browser: { enabled: true },
            shell: { enabled: true },
          },
        },
        mcp: {
          servers: {
            github: { enabled: true },
            memory: { enabled: true },
          },
        },
      } satisfies Record<string, unknown>;

      const result = syncRuntimeCapabilityRegistry(config, { env, now });
      const governanceStore = loadRuntimeGovernanceStore({ env, now });
      const status = buildRuntimeCapabilitiesStatus({ env, now, config: null });

      expect(result.entries).toHaveLength(6);
      expect(governanceStore.entries).toHaveLength(6);
      expect(governanceStore.mcpGrants).toHaveLength(4);
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === "main",
        )?.state,
      ).toBe("core");
      expect(
        governanceStore.mcpGrants.find(
          (grant) => grant.agentId === "main" && grant.mcpServerId === "github",
        )?.state,
      ).toBe("allowed");
      expect(
        governanceStore.mcpGrants.find(
          (grant) => grant.agentId === "research" && grant.mcpServerId === "github",
        )?.state,
      ).toBe("denied");
      expect(status.agentCount).toBe(2);
      expect(status.skillCount).toBe(2);
      expect(status.mcpCount).toBe(2);
      expect(status.mcpGrantCount).toBe(4);
      expect(status.mcpAllowedGrantCount).toBe(2);
      expect(status.mcpDeniedGrantCount).toBe(2);
      expect(status.overlayCount).toBe(0);
      expect(status.entries).toHaveLength(6);
      expect(status.mcpGrants).toHaveLength(4);
      expect(status.governanceStateCounts.core).toBe(1);
      expect(status.governanceStateCounts.shadow).toBe(5);
      expect(
        status.entries.find((entry) => entry.registryType === "agent" && entry.targetId === "main")
          ?.executionMode,
      ).toBe("live");
      expect(
        status.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === "research",
        )?.executionMode,
      ).toBe("shadow_only");
    });
  });

  it("upserts authoritative capability registry entries without duplicating targets", async () => {
    await withTempRoot("openclaw-runtime-capability-upsert-", async (_root, env) => {
      const now = 1_700_341_000_000;

      const created = upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "patch-edit",
          state: "candidate",
          summary: "Evaluate patch editing before adopting it into the main lane.",
        },
        { env, now },
      );
      const updated = upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "patch-edit",
          state: "blocked",
          reason: "Regression risk exceeded the safe threshold.",
        },
        { env, now: now + 100 },
      );

      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 100 });

      expect(created.entry.state).toBe("candidate");
      expect(updated.entry.state).toBe("blocked");
      expect(governanceStore.entries).toHaveLength(1);
      expect(governanceStore.entries[0]?.targetId).toBe("patch-edit");
      expect(governanceStore.entries[0]?.state).toBe("blocked");
      expect(updated.counts.skill).toBe(1);
    });
  });

  it("upserts host-owned mcp grants without duplicating the agent-server pair", async () => {
    await withTempRoot("openclaw-runtime-capability-mcp-grant-", async (_root, env) => {
      const now = 1_700_341_500_000;

      const created = upsertRuntimeMcpGrant(
        {
          agentId: "research",
          mcpServerId: "github",
          state: "allowed",
          summary: "Research agent may read GitHub context through the host-owned MCP bus.",
        },
        { env, now },
      );
      const updated = upsertRuntimeMcpGrant(
        {
          agentId: "research",
          mcpServerId: "github",
          state: "denied",
          reason: "GitHub access is paused until the review completes.",
        },
        { env, now: now + 100 },
      );

      const governanceStore = loadRuntimeGovernanceStore({ env, now: now + 100 });

      expect(created.grant.state).toBe("allowed");
      expect(updated.grant.state).toBe("denied");
      expect(governanceStore.mcpGrants).toHaveLength(1);
      expect(governanceStore.mcpGrants[0]?.agentId).toBe("research");
      expect(governanceStore.mcpGrants[0]?.mcpServerId).toBe("github");
      expect(governanceStore.mcpGrants[0]?.state).toBe("denied");
      expect(updated.allowedCount).toBe(0);
      expect(updated.deniedCount).toBe(1);
    });
  });

  it("treats local user-console agents as shadow-governed by default instead of falling back to implicit live execution", async () => {
    await withTempRoot("openclaw-runtime-capability-local-agent-", async (_root, env) => {
      const now = 1_700_341_800_000;
      const config = {
        agents: {
          list: [{ id: "main" }],
        },
        mcp: {
          servers: {
            github: { enabled: true },
          },
        },
      } satisfies Record<string, unknown>;

      const userConsoleStore = loadRuntimeUserConsoleStore({ env, now });
      saveRuntimeUserConsoleStore(
        {
          ...userConsoleStore,
          agents: [
            {
              id: "sales-agent",
              name: "Sales Agent",
              memoryNamespace: "agent/sales-agent",
              skillIds: ["pitch-deck"],
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        { env, now },
      );

      const policy = resolveRuntimeCapabilityPolicy(config, {
        env,
        now: now + 10,
      });
      const status = buildRuntimeCapabilitiesStatus({
        env,
        now: now + 10,
        config,
      });

      expect(policy.resolveEntry("agent", "sales-agent")?.state).toBe("shadow");
      expect(policy.resolveEntry("skill", "pitch-deck")?.state).toBe("shadow");
      expect(policy.resolveExecutionStatus("agent", "sales-agent").mode).toBe("shadow_only");
      expect(policy.resolveExecutionStatus("skill", "pitch-deck").mode).toBe("shadow_only");
      expect(policy.resolveExecutionStatus("agent", "sales-agent").liveEligible).toBe(false);
      expect(policy.resolveMcpGrant("sales-agent", "github")?.state).toBe("denied");
      expect(
        status.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === "sales-agent",
        )?.executionMode,
      ).toBe("shadow_only");
      expect(
        status.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === "sales-agent",
        )?.metadata?.source,
      ).toBe("runtime-user-console");
      expect(
        status.entries.find((entry) => entry.registryType === "skill" && entry.targetId === "pitch-deck")
          ?.metadata?.source,
      ).toBe("runtime-user-console");
    });
  });

  it("merges adopted federation overlays into the authoritative capability policy", async () => {
    await withTempRoot("openclaw-runtime-capability-overlay-", async (_root, env) => {
      const now = 1_700_342_000_000;
      const config = {
        browser: { enabled: true },
        agents: {
          defaults: {
            sandbox: { mode: "off" },
            workspace: "/tmp/runtime-workspace",
          },
          list: [{ id: "main" }, { id: "research" }],
        },
        tools: {
          skills: {
            browser: { enabled: true },
            shell: { enabled: true },
          },
        },
        mcp: {
          servers: {
            github: { enabled: true },
            memory: { enabled: true },
          },
        },
      } satisfies Record<string, unknown>;

      syncRuntimeCapabilityRegistry(config, { env, now });
      const federationStore = loadRuntimeFederationStore({ env, now });
      saveRuntimeFederationStore(
        {
          ...federationStore,
          metadata: {
            ...federationStore.metadata,
            appliedPolicyOverlays: {
              routeCoder: {
                route: "coder",
                appliedAt: now + 10,
                policy: {
                  blockedSkills: ["shell"],
                  agentStates: {
                    research: "blocked",
                  },
                  mcpGrants: [
                    {
                      agentId: "research",
                      mcpServerId: "github",
                      state: "allowed",
                    },
                  ],
                  governanceEntries: [
                    {
                      registryType: "skill",
                      targetId: "browser",
                      state: "adopted",
                    },
                  ],
                },
              },
            },
          },
        },
        { env, now: now + 10 },
      );

      const policy = resolveRuntimeCapabilityPolicy(config, {
        env,
        now: now + 20,
        route: "coder",
      });
      const status = buildRuntimeCapabilitiesStatus({
        env,
        now: now + 20,
        config,
      });

      expect(policy.overlayCount).toBe(4);
      expect(policy.resolveEntry("skill", "browser")?.state).toBe("adopted");
      expect(policy.resolveEntry("skill", "shell")?.state).toBe("blocked");
      expect(policy.resolveEntry("agent", "research")?.state).toBe("blocked");
      expect(policy.resolveMcpGrant("research", "github")?.state).toBe("allowed");
      expect(policy.isAllowed("skill", "shell")).toBe(false);
      expect(policy.isAllowed("agent", "research")).toBe(false);
      expect(policy.isMcpAllowed("research", "github")).toBe(false);
      expect(policy.isLiveEligible("skill", "browser")).toBe(true);
      expect(policy.isLiveEligible("skill", "shell")).toBe(false);
      expect(status.agentCount).toBe(2);
      expect(status.skillCount).toBe(2);
      expect(status.mcpCount).toBe(2);
      expect(status.mcpGrantCount).toBe(4);
      expect(status.mcpAllowedGrantCount).toBe(3);
      expect(status.mcpDeniedGrantCount).toBe(1);
      expect(status.overlayCount).toBe(4);
      expect(
        status.mcpGrants.find(
          (grant) => grant.agentId === "research" && grant.mcpServerId === "github",
        )?.state,
      ).toBe("allowed");
      expect(
        status.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "shell",
        )?.state,
      ).toBe("blocked");
      expect(
        status.entries.find(
          (entry) => entry.registryType === "skill" && entry.targetId === "browser",
        )?.executionMode,
      ).toBe("live");
      expect(status.governanceStateCounts.core).toBe(1);
      expect(status.governanceStateCounts.adopted).toBe(1);
      expect(status.governanceStateCounts.blocked).toBe(2);
      expect(status.governanceStateCounts.shadow).toBe(2);
    });
  });

  it("surfaces recent capability activity for local governance changes and federation overlays", async () => {
    await withTempRoot("openclaw-runtime-capability-activity-", async (_root, env) => {
      const now = 1_700_342_500_000;
      const config = {
        agents: {
          defaults: {
            sandbox: { mode: "off" },
          },
          list: [{ id: "main" }, { id: "research", name: "Research Agent" }],
        },
        tools: {
          skills: {
            browser: { enabled: true },
          },
        },
        mcp: {
          servers: {
            github: { enabled: true },
          },
        },
      } satisfies Record<string, unknown>;

      syncRuntimeCapabilityRegistry(config, { env, now });
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "browser",
          state: "adopted",
          reason: "Validated through local review.",
        },
        { env, now: now + 10 },
      );
      upsertRuntimeMcpGrant(
        {
          agentId: "research",
          mcpServerId: "github",
          state: "allowed",
          reason: "Research agent now has approved GitHub access.",
        },
        { env, now: now + 20 },
      );

      const federationStore = loadRuntimeFederationStore({ env, now: now + 30 });
      saveRuntimeFederationStore(
        {
          ...federationStore,
          inbox: [
            {
              id: "pkg-overlay-1",
              packageType: "runtime-policy-overlay-package",
              sourceRuntimeId: "brain-runtime-1",
              state: "recommended",
              summary: "Route-scoped overlay",
              validationErrors: [],
              receivedAt: now + 30,
              updatedAt: now + 30,
              payload: {
                schemaVersion: "v1",
                type: "runtime-policy-overlay-package",
                sourceRuntimeId: "brain-runtime-1",
                generatedAt: now + 30,
                payload: {
                  route: "research",
                  policy: {
                    blockedSkills: ["shell"],
                  },
                },
              },
              review: {
                riskLevel: "low",
                autoAdoptEligible: true,
                requiresReasonOnAdopt: false,
                routeScope: "route",
                summary: "Safe route-scoped overlay.",
                signals: ["Restrictive route-only overlay."],
              },
            },
          ],
        },
        { env, now: now + 30 },
      );
      transitionRuntimeFederationPackage(
        {
          id: "pkg-overlay-1",
          state: "adopted",
          reason: "Approved local route restriction.",
        },
        { env, now: now + 40 },
      );

      const status = buildRuntimeCapabilitiesStatus({
        env,
        now: now + 50,
        config,
      });

      expect(status.recentActivity.slice(0, 4).map((entry) => entry.kind)).toEqual([
        "federation_overlay",
        "mcp_grant",
        "registry_entry",
        "registry_sync",
      ]);
      expect(status.recentActivity[0]).toMatchObject({
        kind: "federation_overlay",
        state: "adopted",
        sourceRuntimeId: "brain-runtime-1",
      });
      expect(status.recentActivity[1]).toMatchObject({
        kind: "mcp_grant",
        agentId: "research",
        mcpServerId: "github",
      });
      expect(status.recentActivity[2]).toMatchObject({
        kind: "registry_entry",
        registryType: "skill",
        targetId: "browser",
        state: "adopted",
      });
    });
  });

  it("keeps shadow and candidate capabilities off the default live route while preferring adopted/core", async () => {
    await withTempRoot("openclaw-runtime-capability-live-routing-", async (_root, env) => {
      const now = 1_700_343_000_000;

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
          registryType: "agent",
          targetId: "reviewer",
          state: "adopted",
        },
        { env, now: now + 20 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "shell",
          state: "shadow",
        },
        { env, now: now + 30 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "browser",
          state: "candidate",
        },
        { env, now: now + 40 },
      );
      upsertRuntimeCapabilityRegistryEntry(
        {
          registryType: "skill",
          targetId: "patch-edit",
          state: "adopted",
        },
        { env, now: now + 50 },
      );

      const policy = resolveRuntimeCapabilityPolicy(null, {
        env,
        now: now + 60,
      });

      expect(policy.isLiveEligible("agent", "main")).toBe(true);
      expect(policy.isLiveEligible("agent", "reviewer")).toBe(true);
      expect(policy.isLiveEligible("agent", "research")).toBe(false);
      expect(policy.isLiveEligible("skill", "patch-edit")).toBe(true);
      expect(policy.isLiveEligible("skill", "browser")).toBe(false);
      expect(policy.isLiveEligible("skill", "shell")).toBe(false);
      expect(policy.sortByExecutionPreference("agent", ["research", "reviewer", "main"])).toEqual([
        "main",
        "reviewer",
        "research",
      ]);
      expect(
        policy.sortByExecutionPreference("skill", ["shell", "browser", "patch-edit"]),
      ).toEqual(["patch-edit", "browser", "shell"]);
      expect(policy.resolveExecutionStatus("skill", "shell").mode).toBe("shadow_only");
      expect(policy.resolveExecutionStatus("skill", "browser").mode).toBe("candidate_only");
      expect(policy.resolveExecutionStatus("agent", "main").preferenceLabel).toBe("core");
    });
  });
});
