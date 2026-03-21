import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchRuntimeIntelDeliveries, previewRuntimeIntelDeliveries } from "./intel-delivery.js";
import {
  configureRuntimeIntelPanel,
  deleteRuntimeIntelSource,
  refreshRuntimeIntelPipeline,
  upsertRuntimeIntelSource,
} from "./intel-refresh.js";
import { loadRuntimeIntelStore, loadRuntimeMemoryStore, saveRuntimeIntelStore } from "./store.js";
import { upsertRuntimeAgent, upsertRuntimeSurface } from "./user-console.js";

function requestUrlToString(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

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

function buildFeedXml(prefix: string, count: number, baseUrl: string, now: number): string {
  const items = Array.from({ length: count }, (_value, index) => {
    const publishedAt = new Date(now - index * 60 * 60 * 1000).toUTCString();
    return `
      <item>
        <title>${prefix} signal ${index}</title>
        <description>${prefix} update ${index} about model launches, agents, and deployment.</description>
        <link>${baseUrl}${index}</link>
        <pubDate>${publishedAt}</pubDate>
      </item>
    `.trim();
  }).join("\n");
  return `<rss><channel>${items}</channel></rss>`;
}

function buildGitHubPayload(count: number, now: number): string {
  return JSON.stringify({
    items: Array.from({ length: count }, (_value, index) => ({
      full_name: `owner/repo-${index}`,
      description: `Repository ${index} for agents and runtime tooling`,
      html_url: `https://github.com/owner/repo-${index}`,
      language: index % 2 === 0 ? "TypeScript" : "Rust",
      stargazers_count: 500 - index * 7,
      created_at: new Date(now - (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
      pushed_at: new Date(now - index * 60 * 60 * 1000).toISOString(),
      owner: { login: "owner" },
    })),
  });
}

function buildMockResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as Response;
}

describe("runtime intel refresh", () => {
  it("fetches default news domains into the authoritative intel pipeline", async () => {
    await withTempRoot("openclaw-runtime-intel-refresh-", async (_root, env) => {
      const now = 1_700_350_000_000;
      const requestLog: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = requestUrlToString(input);
        requestLog.push(url);
        if (url.includes("openai.com/news")) {
          return buildMockResponse(buildFeedXml("OpenAI", 6, "https://openai.com/news/", now));
        }
        if (url.includes("anthropic.com/news")) {
          return buildMockResponse(
            buildFeedXml("Anthropic", 6, "https://www.anthropic.com/news/", now - 1_000),
          );
        }
        if (url.includes("technologyreview.com")) {
          return buildMockResponse(
            buildFeedXml("MIT AI", 6, "https://www.technologyreview.com/ai/", now - 2_000),
          );
        }
        if (url.includes("blog.google/technology/ai")) {
          return buildMockResponse(
            buildFeedXml("Google AI", 6, "https://blog.google/technology/ai/", now - 3_000),
          );
        }
        if (url.includes("defenseone.com")) {
          return buildMockResponse(
            buildFeedXml("Defense One", 6, "https://www.defenseone.com/story-", now - 4_000),
          );
        }
        if (url.includes("breakingdefense.com")) {
          return buildMockResponse(
            buildFeedXml("Breaking Defense", 6, "https://breakingdefense.com/story-", now - 5_000),
          );
        }
        if (url.includes("reuters.com/reuters/worldNews")) {
          return buildMockResponse(
            buildFeedXml("Reuters World", 6, "https://www.reuters.com/world/", now - 6_000),
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await refreshRuntimeIntelPipeline({
        env,
        now,
        force: true,
        domains: ["ai", "military"],
        fetchImpl,
      });

      const intelStore = loadRuntimeIntelStore({ env, now });
      const memoryStore = loadRuntimeMemoryStore({ env, now });

      expect(result.domains).toHaveLength(2);
      expect(result.domains.every((entry) => !entry.skipped)).toBe(true);
      expect(result.domains.find((entry) => entry.domain === "ai")?.fetchedCount).toBeGreaterThan(
        20,
      );
      expect(result.domains.find((entry) => entry.domain === "ai")?.digestCount).toBe(10);
      expect(result.domains.find((entry) => entry.domain === "military")?.digestCount).toBe(10);
      expect(intelStore.candidates.filter((entry) => entry.domain === "ai")).toHaveLength(20);
      expect(intelStore.candidates.filter((entry) => entry.domain === "military")).toHaveLength(18);
      expect(
        (intelStore.metadata?.domains as Record<string, { lastFetchedAt?: number }> | undefined)?.ai
          ?.lastFetchedAt,
      ).toBe(now);
      expect(intelStore.metadata?.lastRefreshAt).toBe(now);
      expect(intelStore.metadata?.lastSuccessfulRefreshAt).toBe(now);
      expect(intelStore.metadata?.lastRefreshOutcome).toBe("success");
      expect(
        (
          intelStore.metadata?.sources as
            | Record<string, { lastSuccessfulRefreshAt?: number }>
            | undefined
        )?.["openai-news"]?.lastSuccessfulRefreshAt,
      ).toBe(now);
      expect(memoryStore.memories).toHaveLength(0);
      expect(requestLog.some((url) => url.includes("defenseone.com"))).toBe(true);
    });
  });

  it("skips refresh inside the configured refresh window unless forced", async () => {
    await withTempRoot("openclaw-runtime-intel-refresh-skip-", async (_root, env) => {
      const now = 1_700_360_000_000;
      let requestCount = 0;
      const fetchImpl: typeof fetch = async (input) => {
        requestCount += 1;
        const url = requestUrlToString(input);
        if (url.includes("defenseone.com")) {
          return buildMockResponse(
            buildFeedXml("Defense One", 6, "https://www.defenseone.com/story-", now),
          );
        }
        if (url.includes("breakingdefense.com")) {
          return buildMockResponse(
            buildFeedXml("Breaking Defense", 6, "https://breakingdefense.com/story-", now - 1_000),
          );
        }
        if (url.includes("reuters.com/reuters/worldNews")) {
          return buildMockResponse(
            buildFeedXml("Reuters World", 6, "https://www.reuters.com/world/", now - 2_000),
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      await refreshRuntimeIntelPipeline({
        env,
        now,
        force: true,
        domains: ["military"],
        fetchImpl,
      });
      const firstRequestCount = requestCount;

      const result = await refreshRuntimeIntelPipeline({
        env,
        now: now + 60_000,
        domains: ["military"],
        fetchImpl,
      });

      expect(requestCount).toBe(firstRequestCount);
      expect(result.domains).toEqual([
        {
          domain: "military",
          fetchedCount: 0,
          digestCount: 10,
          skipped: true,
          errors: [],
        },
      ]);
    });
  });

  it("supports github_search as a custom source kind inside the new news domains", async () => {
    await withTempRoot("openclaw-runtime-intel-github-source-", async (_root, env) => {
      const now = 1_700_360_500_000;
      upsertRuntimeIntelSource(
        {
          domain: "tech",
          kind: "github_search",
          label: "GitHub Radar",
          priority: 1.6,
          enabled: true,
        },
        { env, now },
      );
      configureRuntimeIntelPanel(
        {
          enabledDomainIds: ["tech"],
          selectedSourceIds: ["github-radar"],
        },
        { env, now: now + 1 },
      );

      const requestLog: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = requestUrlToString(input);
        requestLog.push(url);
        if (url.includes("api.github.com/search/repositories")) {
          return buildMockResponse(buildGitHubPayload(12, now));
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await refreshRuntimeIntelPipeline({
        env,
        now: now + 2,
        force: true,
        domains: ["tech"],
        fetchImpl,
      });

      const intelStore = loadRuntimeIntelStore({ env, now: now + 2 });
      expect(result.domains).toEqual([
        {
          domain: "tech",
          fetchedCount: 12,
          digestCount: 10,
          skipped: false,
          errors: [],
        },
      ]);
      expect(intelStore.candidates.filter((entry) => entry.domain === "tech")).toHaveLength(12);
      expect(requestLog.some((url) => url.includes("api.github.com/search/repositories"))).toBe(
        true,
      );
    });
  });

  it("does not fetch any sources when intel is disabled", async () => {
    await withTempRoot("openclaw-runtime-intel-refresh-disabled-", async (_root, env) => {
      const now = 1_700_365_000_000;
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.enabled = false;
      intelStore.digestItems = [
        {
          id: "digest-ai-1",
          domain: "ai",
          title: "Existing digest",
          conclusion: "Reference only",
          whyItMatters: "kept for dashboard continuity",
          recommendedAttention: "review",
          recommendedAction: "reference",
          sourceIds: ["openai-news"],
          exploit: true,
          createdAt: now - 1000,
        },
      ];
      saveRuntimeIntelStore(intelStore, { env, now });

      let requestCount = 0;
      const fetchImpl: typeof fetch = async () => {
        requestCount += 1;
        throw new Error("fetch should not run while intel is disabled");
      };

      const result = await refreshRuntimeIntelPipeline({
        env,
        now: now + 1000,
        domains: ["ai"],
        fetchImpl,
      });
      const reloaded = loadRuntimeIntelStore({ env, now: now + 1000 });

      expect(requestCount).toBe(0);
      expect(result.pipeline.digestItems).toHaveLength(1);
      expect(result.domains).toEqual([
        {
          domain: "ai",
          fetchedCount: 0,
          digestCount: 1,
          skipped: true,
          errors: ["runtime intel disabled"],
        },
      ]);
      expect(reloaded.metadata?.lastRefreshAt).toBe(now + 1000);
      expect(reloaded.metadata?.lastRefreshOutcome).toBe("disabled");
    });
  });

  it("supports custom sources and skips disabled domains during refresh", async () => {
    await withTempRoot("openclaw-runtime-intel-custom-source-", async (_root, env) => {
      const now = 1_700_366_000_000;
      upsertRuntimeIntelSource(
        {
          domain: "tech",
          kind: "rss",
          label: "Custom Radar",
          url: "https://custom.example/rss.xml",
          priority: 1.4,
          enabled: true,
        },
        { env, now },
      );
      configureRuntimeIntelPanel(
        {
          enabledDomainIds: ["tech"],
          selectedSourceIds: ["custom-radar"],
          instantPushEnabled: true,
          instantPushMinScore: 91,
        },
        { env, now: now + 1 },
      );

      const requestLog: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = requestUrlToString(input);
        requestLog.push(url);
        if (url === "https://custom.example/rss.xml") {
          return buildMockResponse(
            buildFeedXml("Custom Radar", 5, "https://custom.example/story-", now + 2_000),
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await refreshRuntimeIntelPipeline({
        env,
        now: now + 2_000,
        force: true,
        domains: ["tech", "ai"],
        fetchImpl,
      });

      const intelStore = loadRuntimeIntelStore({ env, now: now + 2_000 });

      expect(requestLog).toEqual(["https://custom.example/rss.xml"]);
      expect(result.domains).toContainEqual({
        domain: "ai",
        fetchedCount: 0,
        digestCount: 0,
        skipped: true,
        errors: ["domain disabled"],
      });
      expect(result.domains.find((entry) => entry.domain === "tech")?.fetchedCount).toBeGreaterThan(
        0,
      );
      expect(intelStore.candidates.some((entry) => entry.sourceId === "custom-radar")).toBe(true);
      expect(intelStore.metadata?.instantPushEnabled).toBe(true);
      expect(intelStore.metadata?.instantPushMinScore).toBe(91);
    });
  });

  it("removes deleted custom sources from the selected source policy", async () => {
    await withTempRoot("openclaw-runtime-intel-delete-source-", async (_root, env) => {
      const now = 1_700_367_000_000;
      upsertRuntimeIntelSource(
        {
          domain: "business",
          kind: "rss",
          label: "Deal Wire",
          url: "https://deal.example/feed.xml",
          enabled: true,
        },
        { env, now },
      );

      const deleted = deleteRuntimeIntelSource("deal-wire", { env, now: now + 1 });
      const intelStore = loadRuntimeIntelStore({ env, now: now + 1 });

      expect(deleted.deleted).toBe(true);
      expect(deleted.sources.some((entry) => entry.id === "deal-wire")).toBe(false);
      expect(Array.isArray(intelStore.metadata?.customSources)).toBe(true);
      expect(
        ((intelStore.metadata?.customSources ?? []) as Array<{ id: string }>).some(
          (entry) => entry.id === "deal-wire",
        ),
      ).toBe(false);
      expect(
        Array.isArray(intelStore.metadata?.selectedSourceIds) &&
          ((intelStore.metadata?.selectedSourceIds ?? []) as string[]).includes("deal-wire"),
      ).toBe(false);
    });
  });

  it("materializes pending daily digests and instant alerts, then clears them after dispatch", async () => {
    await withTempRoot("openclaw-runtime-intel-delivery-", async (_root, env) => {
      const now = new Date("2026-03-14T11:05:00+08:00").getTime();
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.digestItems = [
        {
          id: "digest-tech-1",
          domain: "tech",
          title: "Chip launch",
          conclusion: "High-signal launch update",
          whyItMatters: "score=96",
          recommendedAttention: "review",
          recommendedAction: "reference",
          sourceIds: ["hn-frontpage"],
          exploit: true,
          createdAt: now - 30 * 60 * 1000,
          metadata: {
            candidateScore: 96,
            sourceUrl: "https://example.com/chip-launch",
          },
        },
        {
          id: "digest-ai-1",
          domain: "ai",
          title: "Model notes",
          conclusion: "Useful but not urgent",
          whyItMatters: "score=76",
          recommendedAttention: "scan",
          recommendedAction: "observe",
          sourceIds: ["openai-news"],
          exploit: false,
          createdAt: now - 90 * 60 * 1000,
          metadata: {
            candidateScore: 76,
            sourceUrl: "https://example.com/model-notes",
          },
        },
      ];
      saveRuntimeIntelStore(intelStore, { env, now });

      configureRuntimeIntelPanel(
        {
          dailyPushEnabled: true,
          dailyPushHourLocal: 9,
          dailyPushMinuteLocal: 0,
          dailyPushItemCount: 10,
          instantPushEnabled: true,
          instantPushMinScore: 90,
        },
        { env, now: now + 1 },
      );

      const pending = previewRuntimeIntelDeliveries({ env, now: now + 2 });
      expect(pending.dailyDigestDue).toBe(true);
      expect(pending.dailyDigestCount).toBe(2);
      expect(pending.instantAlertCount).toBe(1);
      expect(pending.items).toHaveLength(3);

      const dispatched = dispatchRuntimeIntelDeliveries({ env, now: now + 3 });
      expect(dispatched.deliveredCount).toBe(3);
      expect(dispatched.dailyDigestCount).toBe(2);
      expect(dispatched.instantAlertCount).toBe(1);
      expect(dispatched.preview.items).toEqual([]);
      expect(dispatched.lastDailyPushAt).toBe(now + 3);
      expect(dispatched.lastInstantPushAt).toBe(now + 3);

      const reloaded = previewRuntimeIntelDeliveries({ env, now: now + 4 });
      expect(reloaded.items).toEqual([]);
      expect(reloaded.lastDailyPushAt).toBe(now + 3);
      expect(reloaded.lastInstantPushAt).toBe(now + 3);
    });
  });

  it("routes daily digests and instant alerts through explicit local delivery targets", async () => {
    await withTempRoot("openclaw-runtime-intel-targets-", async (_root, env) => {
      const now = new Date("2026-03-14T11:05:00+08:00").getTime();
      const agent = upsertRuntimeAgent(
        {
          name: "Research Agent",
          memoryNamespace: "agent.research",
          active: true,
        },
        { env, now },
      );
      const surface = upsertRuntimeSurface(
        {
          channel: "discord",
          accountId: "ops-room",
          label: "Ops Discord",
          ownerKind: "user",
          active: true,
        },
        { env, now: now + 1 },
      );
      const intelStore = loadRuntimeIntelStore({ env, now });
      intelStore.digestItems = [
        {
          id: "digest-tech-2",
          domain: "tech",
          title: "Infra update",
          conclusion: "High-signal runtime change",
          whyItMatters: "score=94",
          recommendedAttention: "review",
          recommendedAction: "share",
          sourceIds: ["hn-frontpage"],
          exploit: true,
          createdAt: now - 10 * 60 * 1000,
          metadata: {
            candidateScore: 94,
            sourceUrl: "https://example.com/infra-update",
          },
        },
        {
          id: "digest-ai-2",
          domain: "ai",
          title: "Model note",
          conclusion: "Useful reference",
          whyItMatters: "score=72",
          recommendedAttention: "scan",
          recommendedAction: "reference",
          sourceIds: ["openai-news"],
          exploit: false,
          createdAt: now - 70 * 60 * 1000,
          metadata: {
            candidateScore: 72,
            sourceUrl: "https://example.com/model-note",
          },
        },
      ];
      saveRuntimeIntelStore(intelStore, { env, now });

      configureRuntimeIntelPanel(
        {
          dailyPushEnabled: true,
          dailyPushHourLocal: 9,
          dailyPushMinuteLocal: 0,
          dailyPushItemCount: 10,
          instantPushEnabled: true,
          instantPushMinScore: 90,
          dailyPushTargetIds: ["runtime-user", `surface:${surface.id}`],
          instantPushTargetIds: [`agent:${agent.id}`],
        },
        { env, now: now + 2 },
      );

      const pending = previewRuntimeIntelDeliveries({ env, now: now + 3 });
      expect(pending.dailyDigestCount).toBe(2);
      expect(pending.instantAlertCount).toBe(1);
      expect(
        pending.items
          .find((item) => item.kind === "daily_digest")
          ?.targets.map((target) => target.id),
      ).toEqual(["runtime-user", `surface:${surface.id}`]);
      expect(
        pending.items
          .find((item) => item.kind === "instant_alert")
          ?.targets.map((target) => target.id),
      ).toEqual([`agent:${agent.id}`]);

      const dispatched = dispatchRuntimeIntelDeliveries({ env, now: now + 4 });
      expect(dispatched.deliveredCount).toBe(5);
      expect(dispatched.deliveryRecords).toHaveLength(5);
      expect(
        dispatched.deliveryRecords
          .filter((entry) => entry.kind === "daily_digest")
          .map((entry) => entry.targetId),
      ).toEqual(["runtime-user", `surface:${surface.id}`, "runtime-user", `surface:${surface.id}`]);
      expect(
        dispatched.deliveryRecords.find((entry) => entry.kind === "instant_alert")?.targetId,
      ).toBe(`agent:${agent.id}`);

      const reloaded = previewRuntimeIntelDeliveries({ env, now: now + 5 });
      expect(reloaded.items).toEqual([]);
    });
  });
});
