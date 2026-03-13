import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshRuntimeIntelPipeline } from "./intel-refresh.js";
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
  it("fetches RSS and GitHub sources into the authoritative intel pipeline", async () => {
    await withTempRoot("openclaw-runtime-intel-refresh-", async (_root, env) => {
      const now = 1_700_350_000_000;
      const requestLog: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        requestLog.push(url);
        if (url.includes("api.github.com/search/repositories")) {
          return buildMockResponse(buildGitHubPayload(12, now));
        }
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
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await refreshRuntimeIntelPipeline({
        env,
        now,
        force: true,
        domains: ["ai", "github"],
        fetchImpl,
      });

      const intelStore = loadRuntimeIntelStore({ env, now });
      const memoryStore = loadRuntimeMemoryStore({ env, now });

      expect(result.domains).toHaveLength(2);
      expect(result.domains.every((entry) => entry.skipped === false)).toBe(true);
      expect(result.domains.find((entry) => entry.domain === "ai")?.fetchedCount).toBeGreaterThan(20);
      expect(result.domains.find((entry) => entry.domain === "ai")?.digestCount).toBe(10);
      expect(result.domains.find((entry) => entry.domain === "github")?.digestCount).toBe(10);
      expect(intelStore.candidates.filter((entry) => entry.domain === "ai")).toHaveLength(20);
      expect(intelStore.candidates.filter((entry) => entry.domain === "github")).toHaveLength(12);
      expect(
        (intelStore.metadata?.domains as Record<string, { lastFetchedAt?: number }> | undefined)?.ai
          ?.lastFetchedAt,
      ).toBe(now);
      expect(memoryStore.memories.some((entry) => entry.tags.includes("source-trust"))).toBe(true);
      expect(requestLog.some((url) => url.includes("api.github.com/search/repositories"))).toBe(true);
    });
  });

  it("skips refresh inside the configured refresh window unless forced", async () => {
    await withTempRoot("openclaw-runtime-intel-refresh-skip-", async (_root, env) => {
      const now = 1_700_360_000_000;
      let requestCount = 0;
      const fetchImpl: typeof fetch = async (input) => {
        requestCount += 1;
        const url = String(input);
        if (url.includes("api.github.com/search/repositories")) {
          return buildMockResponse(buildGitHubPayload(12, now));
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      await refreshRuntimeIntelPipeline({
        env,
        now,
        force: true,
        domains: ["github"],
        fetchImpl,
      });
      const firstRequestCount = requestCount;

      const result = await refreshRuntimeIntelPipeline({
        env,
        now: now + 60_000,
        domains: ["github"],
        fetchImpl,
      });

      expect(requestCount).toBe(firstRequestCount);
      expect(result.domains).toEqual([
        {
          domain: "github",
          fetchedCount: 0,
          digestCount: 10,
          skipped: true,
          errors: [],
        },
      ]);
    });
  });
});
