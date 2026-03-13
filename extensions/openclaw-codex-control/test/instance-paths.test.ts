import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildManagedRuntimeEnv,
  resolveControlExtensionPaths,
} = require("../lib/instance-paths.js") as {
  buildManagedRuntimeEnv: (baseEnv?: Record<string, string>, instancePaths?: Record<string, unknown>) => Record<string, string>;
  resolveControlExtensionPaths: (opts?: Record<string, unknown>) => Record<string, any>;
};

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

describe("resolveControlExtensionPaths", () => {
  it("derives full instance roots from an explicit instance root", () => {
    const paths = resolveControlExtensionPaths({
      env: {
        OPENCLAW_INSTANCE_ROOT: "E:/OpenClawVault/instances/main",
        OPENCLAW_CODEX_ROOT: "E:/OpenClawVault/codex",
      },
      existsSync: () => false,
      homedir: () => "C:/Users/tester",
    });

    expect(normalizeSlashes(paths.instanceRoot)).toBe("E:/OpenClawVault/instances/main");
    expect(normalizeSlashes(paths.runtimeRoot)).toBe("E:/OpenClawVault/instances/main/runtime");
    expect(normalizeSlashes(paths.dataRoot)).toBe("E:/OpenClawVault/instances/main/data");
    expect(normalizeSlashes(paths.cacheRoot)).toBe("E:/OpenClawVault/instances/main/runtime/cache");
    expect(normalizeSlashes(paths.logRoot)).toBe("E:/OpenClawVault/instances/main/runtime/logs");
    expect(normalizeSlashes(paths.workspaceRoot)).toBe("E:/OpenClawVault/instances/main/workspace");
    expect(normalizeSlashes(paths.agentsRoot)).toBe("E:/OpenClawVault/instances/main/agents");
    expect(normalizeSlashes(paths.skillsRoot)).toBe("E:/OpenClawVault/instances/main/skills");
    expect(normalizeSlashes(paths.extensionsRoot)).toBe("E:/OpenClawVault/instances/main/extensions");
    expect(normalizeSlashes(paths.codexRoot)).toBe("E:/OpenClawVault/codex");
    expect(normalizeSlashes(paths.archiveRoot)).toBe("E:/OpenClawVault/instances/main/archive");
    expect(normalizeSlashes(paths.controlStateDir)).toBe("E:/OpenClawVault/instances/main/data/extensions/openclaw-codex-control");
    expect(normalizeSlashes(paths.openclawBin)).toBe("E:/OpenClawVault/instances/main/runtime/bin/openclaw");
    expect(normalizeSlashes(paths.controlUiIndexPath)).toBe(
      "E:/OpenClawVault/instances/main/runtime/lib/node_modules/openclaw/dist/control-ui/index.html"
    );
  });

  it("falls back to legacy runtime and control state paths when only the old layout exists", () => {
    const existing = new Set([
      "/home/test/.openclaw/bin/openclaw",
      "/home/test/.openclaw/state/openclaw-codex-control",
    ]);
    const paths = resolveControlExtensionPaths({
      env: {
        HOME: "/home/test",
      },
      existsSync: (filePath: string) => existing.has(filePath),
      homedir: () => "/home/test",
    });

    expect(paths.stateRoot).toBe("/home/test/.openclaw");
    expect(paths.runtimeRoot).toBe("/home/test/.openclaw/runtime");
    expect(paths.effectiveRuntimeRoot).toBe("/home/test/.openclaw");
    expect(paths.openclawBin).toBe("/home/test/.openclaw/bin/openclaw");
    expect(paths.controlStateDir).toBe("/home/test/.openclaw/state/openclaw-codex-control");
  });
});

describe("buildManagedRuntimeEnv", () => {
  it("propagates manifest-driven roots into the child runtime env", () => {
    const instancePaths = resolveControlExtensionPaths({
      env: {
        OPENCLAW_INSTANCE_ROOT: "/srv/openclaw/main",
        OPENCLAW_PROFILE: "desktop",
      },
      existsSync: () => false,
      homedir: () => "/home/user",
    });
    const env = buildManagedRuntimeEnv(
      {
        PATH: "/usr/bin",
        OPENCLAW_PREFIX: "/legacy/prefix",
      },
      instancePaths
    );

    expect(env.OPENCLAW_INSTANCE_ROOT).toBe("/srv/openclaw/main");
    expect(env.OPENCLAW_RUNTIME_ROOT).toBe("/srv/openclaw/main/runtime");
    expect(env.OPENCLAW_DATA_ROOT).toBe("/srv/openclaw/main/data");
    expect(env.OPENCLAW_ARCHIVE_ROOT).toBe("/srv/openclaw/main/archive");
    expect(env.OPENCLAW_PROFILE).toBe("desktop");
    expect(env.PATH).toBe("/srv/openclaw/main/runtime/bin:/usr/bin");
    expect(env.OPENCLAW_PREFIX).toBeUndefined();
  });
});
