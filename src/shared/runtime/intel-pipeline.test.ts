import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRuntimeIntelPipeline } from "./intel-pipeline.js";
import { loadRuntimeIntelStore, loadRuntimeMemoryStore, saveRuntimeIntelStore } from "./store.js";

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
  it("dedupes candidates and selects an 8 exploit + 2 explore digest mix without writing memory", async () => {
    await withTempRoot("openclaw-runtime-intel-", async (_root, env) => {
      const now = 1_700_330_000_000;
      const inputs = Array.from({ length: 22 }, (_value, index) => ({
        id: `intel-ai-${index}`,
        domain: "ai" as const,
        sourceId: `source-${Math.floor(index / 2)}`,
        title: `AI signal ${index}`,
        url: `https://example.com/ai/${index}`,
        summary: `Signal ${index} for the AI runtime digest`,
        score: 100 - index,
        createdAt: now + index,
        metadata: {
          noveltyScore: index >= 18 ? 110 - index : 10 + index,
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
      const exploitItems = aiDigestItems.filter((entry) => entry.exploit);
      const exploreItems = aiDigestItems.filter((entry) => !entry.exploit);

      expect(result.candidates).toHaveLength(20);
      expect(aiCandidates).toHaveLength(20);
      expect(selectedCandidates).toHaveLength(10);
      expect(aiDigestItems).toHaveLength(10);
      expect(exploitItems).toHaveLength(8);
      expect(exploreItems).toHaveLength(2);
      expect(intelStore.sourceProfiles).toHaveLength(10);
      expect(intelStore.rankRecords).toHaveLength(20);
      expect(
        intelStore.rankRecords.filter((entry) => entry.selectedMode === "exploit"),
      ).toHaveLength(8);
      expect(
        intelStore.rankRecords.filter((entry) => entry.selectedMode === "explore"),
      ).toHaveLength(2);
      expect(memoryStore.memories).toHaveLength(0);
      expect(
        aiCandidates.filter(
          (entry) => entry.title === "AI signal 2" && entry.url === "https://example.com/ai/2",
        ),
      ).toHaveLength(1);
      expect(
        aiCandidates.find(
          (entry) => entry.title === "AI signal 2" && entry.url === "https://example.com/ai/2",
        )?.score,
      ).toBeGreaterThan(5);
    });
  });

  it("keeps candidates but emits no digest items when digest generation is disabled", async () => {
    await withTempRoot("openclaw-runtime-intel-digest-disabled-", async (_root, env) => {
      const now = 1_700_331_000_000;
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.digestEnabled = false;
      saveRuntimeIntelStore(intelStore, { env, now });

      const inputs = Array.from({ length: 12 }, (_value, index) => ({
        id: `intel-tech-${index}`,
        domain: "tech" as const,
        sourceId: `source-tech-${index}`,
        title: `Tech signal ${index}`,
        url: `https://example.com/tech/${index}`,
        summary: `Signal ${index} for digest gating`,
        score: 80 - index,
        createdAt: now + index,
      }));

      const result = runRuntimeIntelPipeline(inputs, { env, now: now + 100 });
      const nextIntelStore = loadRuntimeIntelStore({ env, now: now + 100 });

      expect(result.candidates).toHaveLength(12);
      expect(result.digestItems).toHaveLength(0);
      expect(nextIntelStore.candidates).toHaveLength(12);
      expect(nextIntelStore.candidates.every((entry) => !entry.selected)).toBe(true);
      expect(nextIntelStore.digestItems).toHaveLength(0);
      expect(nextIntelStore.rankRecords).toHaveLength(12);
      expect(nextIntelStore.rankRecords.every((entry) => entry.selectedMode === "none")).toBe(true);
    });
  });

  it("uses stored topic weights as live ranking signals instead of dashboard-only metadata", async () => {
    await withTempRoot("openclaw-runtime-intel-topic-weights-", async (_root, env) => {
      const now = 1_700_332_000_000;
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.digestItemLimitPerDomain = 1;
      intelStore.exploitItemsPerDigest = 1;
      intelStore.exploreItemsPerDigest = 0;
      intelStore.topicProfiles = [
        {
          id: "topic-runtime",
          domain: "ai",
          topic: "runtime",
          weight: 96,
          updatedAt: now - 60_000,
          metadata: {
            sourceId: "ops-source",
          },
        },
      ];
      saveRuntimeIntelStore(intelStore, { env, now });

      runRuntimeIntelPipeline(
        [
          {
            id: "intel-runtime",
            domain: "ai",
            sourceId: "ops-source",
            title: "Runtime operations update",
            summary: "Runtime controls are being hardened for long-running workflows.",
            score: 66,
            createdAt: now + 1,
          },
          {
            id: "intel-generic",
            domain: "ai",
            sourceId: "generic-source",
            title: "Consumer chatbot release",
            summary: "A consumer AI release with a slightly higher base score.",
            score: 72,
            createdAt: now + 2,
          },
        ],
        { env, now: now + 5_000 },
      );

      const nextIntelStore = loadRuntimeIntelStore({ env, now: now + 5_000 });
      const runtimeCandidate = nextIntelStore.candidates.find(
        (entry) => entry.id === "intel-runtime",
      );
      const genericCandidate = nextIntelStore.candidates.find(
        (entry) => entry.id === "intel-generic",
      );
      const runtimeRankRecord = nextIntelStore.rankRecords.find(
        (entry) => entry.intelId === "intel-runtime",
      );

      expect(runtimeCandidate?.selected).toBe(true);
      expect(genericCandidate?.selected).toBe(false);
      expect(Number(runtimeCandidate?.metadata?.topicWeightBoost)).toBeGreaterThan(0);
      expect(Number(runtimeCandidate?.metadata?.selectionScore)).toBeGreaterThan(
        Number(genericCandidate?.metadata?.selectionScore),
      );
      expect(runtimeRankRecord?.metadata).toMatchObject({
        topicWeightBoost: expect.any(Number),
        matchedTopics: expect.arrayContaining(["runtime"]),
      });
    });
  });
});
