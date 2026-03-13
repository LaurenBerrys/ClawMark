import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRuntimeIntelPipeline } from "./intel-pipeline.js";
import { loadRuntimeIntelStore, loadRuntimeMemoryStore } from "./store.js";

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

describe("runtime intel pipeline", () => {
  it("dedupes candidates, enforces 20 -> 10, and writes knowledge/source-trust memories", async () => {
    await withTempRoot("openclaw-runtime-intel-", async (_root, env) => {
      const now = 1_700_330_000_000;
      const inputs = Array.from({ length: 22 }, (_value, index) => ({
        id: `intel-ai-${index}`,
        domain: "ai" as const,
        sourceId: index < 14 ? "source-core" : "source-explore",
        title: `AI signal ${index}`,
        url: `https://example.com/ai/${index}`,
        summary: `Signal ${index} for the AI runtime digest`,
        score: 100 - index,
        createdAt: now + index,
        metadata: {
          noveltyScore: index >= 18 ? 98 - index : 12 + index,
        },
      }));

      inputs.push({
        id: "intel-ai-duplicate",
        domain: "ai",
        sourceId: "source-core",
        title: "AI signal 2",
        url: "https://example.com/ai/2",
        summary: "Lower-score duplicate that should be removed during dedupe",
        score: 5,
        createdAt: now + 100,
        metadata: {
          noveltyScore: 1,
        },
      });

      const result = runRuntimeIntelPipeline(inputs, { env, now });
      const intelStore = loadRuntimeIntelStore({ env, now });
      const memoryStore = loadRuntimeMemoryStore({ env, now });

      const aiCandidates = intelStore.candidates.filter((entry) => entry.domain === "ai");
      const selectedCandidates = aiCandidates.filter((entry) => entry.selected);
      const aiDigestItems = intelStore.digestItems.filter((entry) => entry.domain === "ai");

      expect(result.candidates).toHaveLength(20);
      expect(aiCandidates).toHaveLength(20);
      expect(selectedCandidates).toHaveLength(10);
      expect(aiDigestItems).toHaveLength(10);
      expect(aiDigestItems.filter((entry) => entry.exploit)).toHaveLength(8);
      expect(aiDigestItems.filter((entry) => !entry.exploit)).toHaveLength(2);
      expect(result.knowledgeMemoryIds).toHaveLength(10);
      expect(result.sourceTrustMemoryIds.length).toBeGreaterThan(0);
      expect(intelStore.sourceProfiles.map((entry) => entry.label)).toEqual([
        "source-explore",
        "source-core",
      ]);
      expect(memoryStore.memories.some((entry) => entry.tags.includes("source-trust"))).toBe(true);
      expect(
        aiCandidates.filter(
          (entry) =>
            entry.title === "AI signal 2" && entry.url === "https://example.com/ai/2",
        ),
      ).toHaveLength(1);
      expect(
        aiCandidates.find(
          (entry) =>
            entry.title === "AI signal 2" && entry.url === "https://example.com/ai/2",
        )?.score,
      ).toBeGreaterThan(5);
    });
  });
});
