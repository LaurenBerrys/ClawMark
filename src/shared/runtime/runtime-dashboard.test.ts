import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildLegacyRuntimeImportPreview,
  buildRuntimeDashboardSnapshot,
} from "./runtime-dashboard.js";
import {
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeTaskStore,
  resolveRuntimeStorePaths,
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

async function seedLegacyRuntime(root: string) {
  const legacyRoot = path.join(root, "legacy");
  const managedStateRoot = path.join(legacyRoot, "state", "openclaw-codex-control");
  await fs.mkdir(managedStateRoot, { recursive: true });
  await fs.mkdir(path.join(legacyRoot, "extensions", "memory-lancedb-pro"), { recursive: true });
  await fs.mkdir(path.join(legacyRoot, "extensions", "openviking-context-bridge"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(legacyRoot, "openclaw.json"),
    JSON.stringify(
      {
        browser: { enabled: true },
        agents: {
          defaults: {
            sandbox: { mode: "off" },
            workspace: "E:/OpenClaw/workspace",
          },
          list: [{ id: "main" }, { id: "reviewer" }],
        },
        tools: {
          fs: { workspaceOnly: false },
          skills: {
            shell: { enabled: true },
            browser: { enabled: true },
          },
        },
        mcp: {
          servers: {
            memory: { enabled: true },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "autopilot.json"),
    JSON.stringify(
      {
        version: 1,
        config: {
          localFirst: false,
          heartbeatEnabled: true,
          defaultBudgetMode: "balanced",
          defaultRetrievalMode: "light",
          maxInputTokensPerTurn: 7000,
          maxContextChars: 12000,
          maxRemoteCallsPerTask: 9,
        },
        tasks: [
          {
            id: "task-a",
            title: "Legacy human wait task",
            route: "runtime",
            status: "waiting_human",
            priority: "high",
            budgetMode: "balanced",
            retrievalMode: "light",
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
            runState: { lastThinkingLane: "system2", remoteCallCount: 3 },
          },
          {
            id: "task-b",
            title: "Completed task",
            route: "intel",
            status: "done",
            createdAt: 1_700_000_001_000,
            updatedAt: 1_700_000_001_100,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "memory.json"),
    JSON.stringify(
      {
        version: 1,
        memories: [
          {
            id: "memory-a",
            memoryType: "knowledge",
            summary: "Pinned runtime knowledge",
            confidence: 0.91,
            updatedAt: 1_700_000_002_000,
          },
        ],
        strategies: [
          {
            id: "strategy-a",
            route: "runtime",
            worker: "main",
            summary: "Prefer system1 for repeated tasks",
            confidence: 0.88,
            updatedAt: 1_700_000_003_000,
          },
        ],
        learnings: [{ id: "learning-a" }],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "intel.json"),
    JSON.stringify(
      {
        version: 1,
        config: {
          enabled: true,
          digestEnabled: true,
          candidateLimitPerDomain: 20,
          digestItemLimitPerDomain: 10,
          exploitItemsPerDigest: 8,
          exploreItemsPerDigest: 2,
        },
        domains: [
          { id: "ai", label: "AI", lastFetchedAt: 1_700_000_004_000 },
          { id: "github", label: "GitHub", lastFetchedAt: 1_700_000_005_000 },
        ],
        items: [
          { id: "intel-a", domain: "ai", selectedForDigest: true },
          { id: "intel-b", domain: "github", selectedForDigest: false },
        ],
        digests: [
          {
            id: "digest-a",
            domain: "ai",
            createdAt: 1_700_000_006_000,
            items: [
              {
                id: "digest-item-a",
                title: "AI digest",
                judgement: "Reference only",
                importanceScore: 9,
                sourceId: "source-a",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "evolution.json"),
    JSON.stringify(
      {
        version: 1,
        config: {
          enabled: true,
          autoApplyLowRisk: false,
          autoCanaryEvolution: true,
          reviewIntervalHours: 12,
        },
        candidates: [
          { id: "candidate-a", adoptionState: "shadow" },
          { id: "candidate-b", adoptionState: "candidate" },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "skill-governance.json"),
    JSON.stringify(
      {
        version: 1,
        scannedAt: 1_700_000_006_500,
        skills: [
          {
            id: "patch-edit",
            title: "Patch Edit",
            adoptionState: "shadow",
            notes: "Imported legacy governed skill.",
            updatedAt: 1_700_000_006_600,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(managedStateRoot, "events.jsonl"),
    '{"type":"task_transition","taskId":"task-a"}\n',
    "utf8",
  );
}

describe("runtime dashboard legacy import", () => {
  it("builds a read-only import preview and copies into the new instance root only", async () => {
    await withTempRoot("openclaw-runtime-dashboard-", async (root, env) => {
      await seedLegacyRuntime(root);

      const preview = buildLegacyRuntimeImportPreview({
        env,
        now: 1_700_000_100_000,
      });

      expect(preview.detected).toBe(true);
      expect(preview.counts).toEqual({
        tasks: 2,
        memories: 1,
        strategies: 1,
        intelItems: 2,
        intelDigests: 1,
        evolutionCandidates: 2,
      });
      expect(preview.availableStateFiles).toContain("events.jsonl");
      expect(preview.legacyExtensions).toEqual(["memory-lancedb-pro", "openviking-context-bridge"]);
      expect(preview.plan.mappings.map((entry) => entry.kind)).toEqual([
        "config",
        "state",
        "state",
        "state",
        "state",
        "state",
        "events",
        "extensions_manifest",
      ]);

      const sourceConfigPath = path.join(root, "legacy", "openclaw.json");
      const sourceConfig = await fs.readFile(sourceConfigPath, "utf8");

      const applied = applyLegacyRuntimeImport({
        env,
        now: 1_700_000_100_000,
      });
      const storePaths = resolveRuntimeStorePaths({
        env,
        now: 1_700_000_100_000,
      });

      expect(applied.targetRoot).toContain(
        path.join("instance", "data", "imports", "legacy-runtime"),
      );
      expect(applied.extensionsManifestPath).toContain("extensions-manifest.json");
      const importedTaskStore = loadRuntimeTaskStore({ env, now: 1_700_000_100_000 });
      const importedMemoryStore = loadRuntimeMemoryStore({ env, now: 1_700_000_100_000 });
      const importedIntelStore = loadRuntimeIntelStore({ env, now: 1_700_000_100_000 });
      const importedGovernanceStore = loadRuntimeGovernanceStore({
        env,
        now: 1_700_000_100_000,
      });
      expect(storePaths.dbPath).toContain(path.join("instance", "data", "runtime", "v2"));
      expect(importedTaskStore.tasks.some((task) => task.id === "task-a")).toBe(true);
      expect(importedTaskStore.defaults.compactionWatermark).toBe(4000);
      expect(importedTaskStore.archivedSteps).toEqual([]);
      expect(importedMemoryStore.memories.some((memory) => memory.id === "memory-a")).toBe(true);
      expect(importedIntelStore.digestItems.some((item) => item.id === "digest-item-a")).toBe(true);
      expect(importedGovernanceStore.entries.some((entry) => entry.targetId === "patch-edit")).toBe(
        true,
      );
      expect(
        (
          importedTaskStore.metadata as
            | {
                autopilot?: {
                  localFirst?: boolean;
                  heartbeatEnabled?: boolean;
                };
              }
            | undefined
        )?.autopilot?.localFirst,
      ).toBe(false);
      expect(
        (
          importedTaskStore.metadata as
            | {
                autopilot?: {
                  localFirst?: boolean;
                  heartbeatEnabled?: boolean;
                };
              }
            | undefined
        )?.autopilot?.heartbeatEnabled,
      ).toBe(true);

      const importedConfig = await fs.readFile(
        path.join(applied.targetRoot, "config", "openclaw.json"),
        "utf8",
      );
      expect(importedConfig).toBe(sourceConfig);
      expect(await fs.readFile(sourceConfigPath, "utf8")).toBe(sourceConfig);

      const manifest = JSON.parse(
        await fs.readFile(applied.extensionsManifestPath ?? "", "utf8"),
      ) as { extensions: Array<{ name: string; sourcePath: string }> };
      expect(manifest.extensions.map((entry) => entry.name)).toEqual([
        "memory-lancedb-pro",
        "openviking-context-bridge",
      ]);
      expect(manifest.extensions[0]?.sourcePath).toContain(path.join("legacy", "extensions"));

      await fs.writeFile(
        path.join(root, "legacy", "state", "openclaw-codex-control", "autopilot.json"),
        JSON.stringify({ version: 1, tasks: [] }, null, 2),
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "legacy", "state", "openclaw-codex-control", "memory.json"),
        JSON.stringify({ version: 1, memories: [], strategies: [], learnings: [] }, null, 2),
        "utf8",
      );

      const dashboard = buildRuntimeDashboardSnapshot({
        env,
        now: 1_700_000_100_100,
      });

      expect(dashboard.tasks.total).toBe(2);
      expect(dashboard.memory.total).toBe(1);
      expect(dashboard.memory.strategyCount).toBe(1);
      expect(dashboard.intel.digestCount).toBe(1);
      expect(dashboard.capabilities.skillCount).toBe(1);
      expect(dashboard.capabilities.governanceStateCounts.shadow).toBe(1);
      expect(dashboard.evolution.autoCanaryEvolution).toBe(true);
      expect(dashboard.userConsole.model.id).toBe("runtime-user");
      expect(dashboard.agents).toEqual([]);
      expect(dashboard.surfaces).toEqual([]);
    });
  });

  it("keeps runtime snapshots empty until legacy data is explicitly imported", async () => {
    await withTempRoot("openclaw-runtime-snapshot-", async (root, env) => {
      await seedLegacyRuntime(root);

      await fs.mkdir(path.join(root, "instance", "data", "federation", "assignments"), {
        recursive: true,
      });
      await fs.mkdir(
        path.join(root, "instance", "data", "federation", "outbox", "strategy-digest"),
        {
          recursive: true,
        },
      );
      await fs.mkdir(path.join(root, "instance", "data", "federation", "outbox", "news-digest"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(root, "instance", "data", "federation", "assignments", "task-1.json"),
        "{}",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "instance", "data", "federation", "outbox", "strategy-digest", "a.json"),
        "{}",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "instance", "data", "federation", "outbox", "news-digest", "b.json"),
        "{}",
        "utf8",
      );

      const dashboard = buildRuntimeDashboardSnapshot({
        env,
        now: 1_700_000_200_000,
        config: {
          browser: { enabled: true },
          agents: {
            defaults: {
              sandbox: { mode: "off" },
              workspace: "E:/OpenClaw/workspace",
            },
            list: [{ id: "main" }, { id: "reviewer" }],
          },
          tools: {
            fs: { workspaceOnly: false },
            skills: {
              shell: { enabled: true },
              browser: { enabled: true },
            },
          },
          mcp: {
            servers: {
              memory: { enabled: true },
            },
          },
          federation: {
            remote: {
              enabled: true,
              url: "https://brain.example.test/runtime",
            },
            allowedPushScopes: ["shareable_derived", "news_digest", "team_shareable_knowledge"],
            blockedPushScopes: ["raw_chat", "secrets", "durable_private_memory_dump"],
          },
        },
      });

      expect(dashboard.preset).toBe("managed_high");
      expect(dashboard.tasks.total).toBe(0);
      expect(dashboard.memory.total).toBe(0);
      expect(dashboard.memory.strategyCount).toBe(0);
      expect(dashboard.intel.itemCount).toBe(0);
      expect(dashboard.intel.domains.map((domain) => domain.id)).toEqual([
        "military",
        "tech",
        "ai",
        "business",
      ]);
      expect(dashboard.userConsole.model.id).toBe("runtime-user");
      expect(dashboard.agents).toEqual([]);
      expect(dashboard.surfaces).toEqual([]);
      expect(dashboard.capabilities.agentCount).toBe(2);
      expect(dashboard.capabilities.skillCount).toBe(2);
      expect(dashboard.capabilities.legacyExtensions).toEqual([]);
      expect(dashboard.importPreview.counts.tasks).toBe(2);
      expect(dashboard.importPreview.counts.memories).toBe(1);
      expect(dashboard.federation.pendingAssignments).toBe(1);
      expect(dashboard.federation.inbox.total).toBe(0);
      expect(dashboard.federation.outboxEnvelopeCounts.strategyDigest).toBe(1);
      expect(dashboard.federation.outboxEnvelopeCounts.newsDigest).toBe(1);
      expect(dashboard.federation.allowedPushScopes).toEqual([
        "shareable_derived",
        "news_digest",
        "team_shareable_knowledge",
      ]);
      expect(dashboard.federation.blockedPushScopes).toContain("raw_chat");
      expect(dashboard.federation.remoteConfigured).toBe(true);

      const federation = buildFederationRuntimeSnapshot({
        env,
        now: 1_700_000_200_000,
        config: {
          federation: {
            remote: {
              enabled: true,
              endpoint: "https://brain.example.test/runtime",
            },
            push: {
              allowedScopes: ["shareable_derived", "strategy_digest"],
              blockedScopes: ["raw_chat", "secrets"],
            },
          },
        },
        runtimeManifest: dashboard.runtimeManifest,
      });

      expect(federation.manifest.instanceId).toBe(dashboard.runtimeManifest.instanceId);
      expect(federation.allowedPushScopes).toEqual(["shareable_derived", "strategy_digest"]);
      expect(federation.blockedPushScopes).toEqual([
        "raw_chat",
        "secrets",
        "durable_private_memory_dump",
      ]);
      expect(federation.remoteConfigured).toBe(true);
      expect(federation.inbox.stateCounts.received).toBe(0);
    });
  });
});
