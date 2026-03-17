import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRuntimeCapabilityRegistry } from "./capability-plane.js";
import { syncRuntimeFederationOutbox } from "./federation-outbox.js";
import { runRuntimeIntelPipeline } from "./intel-pipeline.js";
import { distillTaskOutcomeToMemory, observeTaskOutcomeForEvolution } from "./mutations.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import { loadRuntimeFederationStore, loadRuntimeTaskStore, saveRuntimeTaskStore } from "./store.js";

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

describe("runtime federation outbox", () => {
  it("writes runtime manifest, digests, and governance envelopes into the local outbox", async () => {
    await withTempRoot("openclaw-runtime-federation-", async (_root, env) => {
      const now = 1_700_370_000_000;
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
        federation: {
          remote: {
            enabled: true,
            url: "https://brain.example.test/runtime",
          },
          push: {
            allowedScopes: [
              "shareable_derived",
              "strategy_digest",
              "news_digest",
              "team_shareable_knowledge",
            ],
            blockedScopes: ["raw_chat", "secrets"],
          },
        },
      } satisfies Record<string, unknown>;

      syncRuntimeCapabilityRegistry(config, { env, now });
      runRuntimeIntelPipeline(
        Array.from({ length: 10 }, (_value, index) => ({
          id: `intel-ai-${index}`,
          domain: "ai" as const,
          sourceId: "openai-news",
          title: `AI runtime signal ${index}`,
          url: `https://example.com/ai/${index}`,
          summary: `Signal ${index} for federation digest materialization`,
          score: 100 - index,
          createdAt: now + index,
          metadata: {
            noveltyScore: 50 + index,
          },
        })),
        { env, now },
      );
      const task = {
        id: "task-federation",
        title: "Materialize federation outbox",
        route: "coder",
        status: "completed" as const,
        priority: "high" as const,
        budgetMode: "balanced" as const,
        retrievalMode: "light" as const,
        goal: "Write outbox envelopes from the authoritative runtime store",
        successCriteria: "All local envelopes are persisted under federation/outbox",
        tags: ["runtime", "federation"],
        worker: "main",
        skillIds: ["patch-edit"],
        memoryRefs: [],
        artifactRefs: ["news-ai-0"],
        recurring: false,
        maintenance: true,
        createdAt: now,
        updatedAt: now,
      };
      const review = {
        id: "review-federation",
        taskId: task.id,
        runId: "run-federation",
        summary: "Federation outbox is persisted from the authoritative runtime state.",
        outcome: "success" as const,
        extractedMemoryIds: [],
        strategyCandidateIds: [],
        createdAt: now,
      };
      distillTaskOutcomeToMemory(
        {
          task,
          review,
          now,
        },
        { env, now },
      );
      const taskStore = loadRuntimeTaskStore({ env, now });
      taskStore.tasks = [task];
      taskStore.reviews = [review];
      saveRuntimeTaskStore(taskStore, { env, now });
      observeTaskOutcomeForEvolution(
        {
          task,
          review,
          thinkingLane: "system1",
          completionScore: 88,
          now,
        },
        { env, now },
      );

      const result = syncRuntimeFederationOutbox({
        env,
        now,
        config,
      });
      const snapshot = buildFederationRuntimeSnapshot({
        env,
        now,
      });

      await expect(fs.readFile(result.runtimeManifestPath, "utf8")).resolves.toContain(
        '"manifestVersion": "v1"',
      );
      await expect(fs.readFile(result.shareableReviewPaths[0], "utf8")).resolves.toContain(
        '"shareScope": "shareable_derived"',
      );
      await expect(fs.readFile(result.shareableMemoryPaths[0], "utf8")).resolves.toContain(
        '"shareScope": "shareable_derived"',
      );
      await expect(fs.readFile(result.strategyDigestPath, "utf8")).resolves.toContain(
        '"strategies"',
      );
      await expect(fs.readFile(result.newsDigestPath, "utf8")).resolves.toContain('"news-digest"');
      await expect(fs.readFile(result.newsDigestPath, "utf8")).resolves.toContain('"digestItems"');
      await expect(fs.readFile(result.shadowTelemetryPath, "utf8")).resolves.toContain(
        '"evaluations"',
      );
      await expect(fs.readFile(result.capabilityGovernancePath, "utf8")).resolves.toContain(
        '"entries"',
      );
      await expect(fs.readFile(result.capabilityGovernancePath, "utf8")).resolves.toContain(
        '"mcpGrants"',
      );
      await expect(fs.readFile(result.teamKnowledgePath!, "utf8")).resolves.toContain(
        '"type": "team-knowledge"',
      );
      await expect(fs.readFile(result.teamKnowledgePath!, "utf8")).resolves.toContain(
        '"sourceKind": "meta_learning"',
      );
      expect(snapshot.outboxEnvelopeCounts.runtimeManifest).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.shareableReview).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.shareableMemory).toBeGreaterThan(0);
      expect(snapshot.outboxEnvelopeCounts.strategyDigest).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.newsDigest).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.shadowTelemetry).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.capabilityGovernance).toBe(1);
      expect(snapshot.outboxEnvelopeCounts.teamKnowledge).toBe(1);
      expect(snapshot.outboxPreview.latestShareableReviews).toHaveLength(1);
      expect(snapshot.outboxPreview.latestShareableMemories.length).toBeGreaterThan(0);
      expect(snapshot.outboxPreview.latestTeamKnowledge.length).toBeGreaterThan(0);
      expect(snapshot.remoteConfigured).toBe(false);
      expect(result.journalRoot).toContain("outbox-journal");
      expect(result.latestOutboxEventId).toBeTruthy();
      expect(result.pendingOutboxEventCount).toBeGreaterThan(0);
      expect(result.pendingEvents.length).toBe(result.pendingOutboxEventCount);
      const federationStore = loadRuntimeFederationStore({
        env,
        now,
      });
      expect(federationStore.syncCursor?.lastPushedAt).toBeUndefined();
      expect(federationStore.syncCursor?.lastOutboxEventId).toBeUndefined();
      expect(federationStore.syncCursor?.metadata?.localOutboxHeadEventId).toBe(
        result.latestOutboxEventId,
      );

      const secondResult = syncRuntimeFederationOutbox({
        env,
        now: now + 1_000,
        config,
      });
      expect(secondResult.latestOutboxEventId).toBe(result.latestOutboxEventId);
      expect(secondResult.pendingOutboxEventCount).toBe(result.pendingOutboxEventCount);
      expect(secondResult.pendingEvents).toHaveLength(result.pendingEvents.length);

      const configuredSnapshot = buildFederationRuntimeSnapshot({
        env,
        now,
        config,
      });
      expect(configuredSnapshot.remoteConfigured).toBe(true);
      expect(configuredSnapshot.allowedPushScopes).toEqual([
        "shareable_derived",
        "strategy_digest",
        "news_digest",
        "team_shareable_knowledge",
      ]);
      expect(configuredSnapshot.blockedPushScopes).toEqual([
        "raw_chat",
        "secrets",
        "durable_private_memory_dump",
      ]);
    });
  });
});
