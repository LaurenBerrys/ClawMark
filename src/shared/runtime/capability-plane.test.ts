import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncRuntimeCapabilityRegistry } from "./capability-plane.js";
import { buildRuntimeCapabilitiesStatus } from "./runtime-dashboard.js";
import { loadRuntimeGovernanceStore } from "./store.js";

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
      expect(
        governanceStore.entries.find(
          (entry) => entry.registryType === "agent" && entry.targetId === "main",
        )?.state,
      ).toBe("core");
      expect(status.agentCount).toBe(2);
      expect(status.skillCount).toBe(2);
      expect(status.mcpCount).toBe(2);
      expect(status.governanceStateCounts.core).toBe(1);
      expect(status.governanceStateCounts.shadow).toBe(5);
    });
  });
});
