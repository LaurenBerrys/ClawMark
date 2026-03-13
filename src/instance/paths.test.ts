import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveInstanceManifest, resolvePathResolver } from "./paths.js";

describe("instance paths", () => {
  it("derives managed roots from OPENCLAW_INSTANCE_ROOT", () => {
    const manifest = resolveInstanceManifest({
      env: {
        OPENCLAW_INSTANCE_ROOT: "/mnt/e/OpenClawVault/instances/main",
      },
      homedir: () => "/home/test",
    });

    expect(manifest.instanceRoot).toBe("/mnt/e/OpenClawVault/instances/main");
    expect(manifest.configRoot).toBe("/mnt/e/OpenClawVault/instances/main");
    expect(manifest.stateRoot).toBe("/mnt/e/OpenClawVault/instances/main");
    expect(manifest.runtimeRoot).toBe("/mnt/e/OpenClawVault/instances/main/runtime");
    expect(manifest.dataRoot).toBe("/mnt/e/OpenClawVault/instances/main/data");
    expect(manifest.extensionsRoot).toBe("/mnt/e/OpenClawVault/instances/main/extensions");
  });

  it("supports explicit root overrides per area", () => {
    const manifest = resolveInstanceManifest({
      env: {
        OPENCLAW_INSTANCE_ROOT: "/mnt/e/OpenClawVault/instances/main",
        OPENCLAW_CONFIG_ROOT: "/mnt/e/OpenClawVault/config/main",
        OPENCLAW_STATE_ROOT: "/mnt/e/OpenClawVault/state/main",
        OPENCLAW_CODEX_ROOT: "/mnt/e/OpenClawVault/codex/main",
        OPENCLAW_WORKSPACE_ROOT: "/mnt/e/OpenClawVault/workspaces/main-runtime",
      },
      homedir: () => "/home/test",
    });

    expect(manifest.configRoot).toBe("/mnt/e/OpenClawVault/config/main");
    expect(manifest.stateRoot).toBe("/mnt/e/OpenClawVault/state/main");
    expect(manifest.codexRoot).toBe("/mnt/e/OpenClawVault/codex/main");
    expect(manifest.workspaceRoot).toBe("/mnt/e/OpenClawVault/workspaces/main-runtime");
    expect(manifest.configPath).toBe("/mnt/e/OpenClawVault/config/main/openclaw.json");
  });

  it("keeps profile-aware state roots for daemon use", () => {
    const manifest = resolveInstanceManifest({
      env: {
        HOME: "/home/test",
        OPENCLAW_PROFILE: "rescue",
      },
      homedir: () => "/home/test",
      profileAwareStateDir: true,
    });
    expect(manifest.stateRoot).toBe(path.join("/home/test", ".openclaw-rescue"));
  });

  it("builds a generic path resolver", () => {
    const resolver = resolvePathResolver({
      env: {
        OPENCLAW_INSTANCE_ROOT: "/srv/openclaw",
      },
      homedir: () => "/home/test",
    });

    expect(resolver.root("archiveRoot")).toBe("/srv/openclaw/archive");
    expect(resolver.join("agentsRoot", "main", "sessions")).toBe(
      "/srv/openclaw/agents/main/sessions",
    );
  });

  it("defaults codex root to ~/.codex for compatibility", () => {
    const manifest = resolveInstanceManifest({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => "/home/test",
    });
    expect(manifest.codexRoot).toBe(path.join("/home/test", ".codex"));
  });

  it("expands home-relative instance overrides", () => {
    const manifest = resolveInstanceManifest({
      env: {
        HOME: "/home/test",
        OPENCLAW_INSTANCE_ROOT: "~/instances/openclaw-main",
      },
      homedir: () => os.homedir(),
    });
    expect(manifest.instanceRoot).toBe("/home/test/instances/openclaw-main");
  });
});
