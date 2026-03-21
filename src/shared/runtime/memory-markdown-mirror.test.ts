import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeMemoryStore, TaskRecord, TaskReview } from "./contracts.js";
import {
  buildRuntimeMemoryMarkdownMirrorStatus,
  syncRuntimeMemoryMarkdownMirror,
} from "./memory-markdown-mirror.js";
import { applyRuntimeTaskOutcomeMemoryUpdate } from "./memory-update-engine.js";
import { buildRuntimeDashboardSnapshot } from "./runtime-dashboard.js";
import { loadRuntimeMemoryStore, saveRuntimeMemoryStore } from "./store.js";

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

function buildTask(now: number, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-markdown-mirror",
    title: "Land the markdown mirror layer",
    route: "runtime",
    status: "completed",
    priority: "high",
    budgetMode: "balanced",
    retrievalMode: "light",
    goal: "Keep a readable markdown mirror of formal memory truth",
    successCriteria: "Mirror files are synced from the authoritative store",
    skillIds: ["patch-edit", "test-verify"],
    memoryRefs: [],
    artifactRefs: [],
    recurring: false,
    maintenance: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildReview(now: number, overrides: Partial<TaskReview> = {}): TaskReview {
  return {
    id: "review-markdown-mirror",
    taskId: "task-markdown-mirror",
    runId: "run-markdown-mirror",
    summary: "The markdown mirror now reflects the authoritative memory store.",
    outcome: "success",
    extractedMemoryIds: [],
    strategyCandidateIds: [],
    createdAt: now,
    ...overrides,
  };
}

describe("runtime memory markdown mirror", () => {
  it("writes readable markdown mirror files from the authoritative store", async () => {
    await withTempRoot("openclaw-runtime-memory-markdown-", async (_root, env) => {
      const now = 1_700_700_000_000;
      const store: RuntimeMemoryStore = {
        version: "v1",
        memories: [
          {
            id: "memory-1",
            layer: "memories",
            memoryType: "execution",
            summary: "Prefer authoritative runtime stores over extension-local state",
            detail: "The runtime dashboard should read only from the SQLite-backed store.",
            scope: "runtime",
            route: "runtime",
            appliesWhen: "Refreshing the main control surface",
            avoidWhen: "A legacy extension wants to own persistence",
            tags: ["runtime", "memory"],
            confidence: 88,
            version: 2,
            invalidatedBy: [],
            sourceTaskIds: [],
            sourceReviewIds: [],
            sourceSessionIds: [],
            sourceEventIds: ["event-1"],
            sourceIntelIds: [],
            derivedFromMemoryIds: [],
            lastReinforcedAt: now - 1_000,
            decayScore: 5,
            createdAt: now - 5_000,
            updatedAt: now - 1_000,
            metadata: {
              lane: "system1",
            },
          },
        ],
        strategies: [
          {
            id: "strategy-1",
            layer: "strategies",
            route: "runtime",
            worker: "main",
            skillIds: ["runtime-dashboard"],
            summary: "Summarize runtime memory state before planning task work",
            triggerConditions: "When the operator opens the Runtime page",
            recommendedPath: "Load dashboard snapshot first",
            fallbackPath: "Read the sqlite store directly",
            thinkingLane: "system1",
            confidence: 91,
            version: 3,
            invalidatedBy: [],
            sourceTaskIds: [],
            sourceReviewIds: ["review-1"],
            sourceSessionIds: [],
            sourceEventIds: [],
            sourceIntelIds: [],
            derivedFromMemoryIds: ["memory-1"],
            measuredEffect: {
              latencyMs: 210,
            },
            createdAt: now - 5_000,
            updatedAt: now - 500,
          },
        ],
        metaLearning: [
          {
            id: "learning-1",
            layer: "meta_learning",
            summary: "Dashboard-first review reduces runtime drift",
            hypothesis: "Show authoritative state earlier in the workflow",
            adoptedAs: "strategy",
            confidence: 90,
            version: 1,
            invalidatedBy: [],
            sourceTaskIds: [],
            sourceReviewIds: ["review-1"],
            sourceSessionIds: [],
            sourceEventIds: [],
            sourceIntelIds: [],
            derivedFromMemoryIds: ["memory-1"],
            createdAt: now - 4_000,
            updatedAt: now - 400,
          },
        ],
        evolutionMemory: [
          {
            id: "evolution-1",
            layer: "evolution_memory",
            candidateType: "strategy_refresh",
            targetLayer: "retrieval",
            summary: "Refresh runtime retrieval policy after mirror syncs",
            adoptionState: "shadow",
            confidence: 85,
            version: 1,
            invalidatedBy: [],
            sourceTaskIds: [],
            sourceReviewIds: ["review-1"],
            sourceSessionIds: [],
            sourceEventIds: [],
            sourceIntelIds: [],
            derivedFromMemoryIds: [],
            sourceShadowTelemetryIds: ["shadow-1"],
            createdAt: now - 3_000,
            updatedAt: now - 300,
          },
        ],
      };
      saveRuntimeMemoryStore(store, { env, now });

      const result = syncRuntimeMemoryMarkdownMirror({ env, now: now + 10 });
      const readme = await fs.readFile(path.join(result.rootPath, "README.md"), "utf8");
      const memoriesFile = await fs.readFile(path.join(result.rootPath, "memories.md"), "utf8");
      const strategiesFile = await fs.readFile(path.join(result.rootPath, "strategies.md"), "utf8");
      const evolutionFile = await fs.readFile(
        path.join(result.rootPath, "evolution-memory.md"),
        "utf8",
      );

      expect(result.fileCount).toBe(5);
      expect(result.exists).toBe(true);
      expect(result.memoryCount).toBe(1);
      expect(readme).toContain("# Runtime Memory Markdown Mirror");
      expect(readme).toContain("Formal memories: 1");
      expect(memoriesFile).toContain(
        "Prefer authoritative runtime stores over extension-local state",
      );
      expect(strategiesFile).toContain("Summarize runtime memory state before planning task work");
      expect(evolutionFile).toContain("Refresh runtime retrieval policy after mirror syncs");
    });
  });

  it("auto-syncs the markdown mirror after authoritative memory writes", async () => {
    await withTempRoot("openclaw-runtime-memory-markdown-auto-", async (_root, env) => {
      const now = 1_700_700_100_000;
      applyRuntimeTaskOutcomeMemoryUpdate(
        {
          task: buildTask(now),
          review: buildReview(now),
          now,
        },
        { env, now },
      );

      const status = buildRuntimeMemoryMarkdownMirrorStatus({ env, now });
      const dashboard = buildRuntimeDashboardSnapshot({ env, now });
      const memoryStore = loadRuntimeMemoryStore({ env, now });
      const memoriesFile = await fs.readFile(path.join(status.rootPath, "memories.md"), "utf8");

      expect(status.exists).toBe(true);
      expect(status.fileCount).toBe(5);
      expect(status.lastSyncedAt).toBe(now);
      expect(memoryStore.metadata?.markdownMirror).toMatchObject({
        lastSyncedAt: now,
        fileCount: 5,
      });
      expect(dashboard.memory.markdownMirror).toMatchObject({
        rootPath: status.rootPath,
        fileCount: 5,
        lastSyncedAt: now,
      });
      expect(memoriesFile).toContain("Land the markdown mirror layer");
    });
  });
});
