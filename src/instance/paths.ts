import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  InstanceManifest as RuntimeInstanceManifest,
  InstancePathKey,
  PathResolver as RuntimePathResolver,
} from "../shared/runtime/contracts.js";

const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moldbot", ".moltbot"] as const;
const DEFAULT_STATE_DIRNAME = ".openclaw";
const DEFAULT_CONFIG_FILENAME = "openclaw.json";
const windowsAbsolutePath = /^[a-zA-Z]:[\\/]/;
const windowsUncPath = /^\\\\/;

export type InstanceManifest = RuntimeInstanceManifest;

export type PathResolver = RuntimePathResolver & {
  resolvePath: (input: string) => string;
  resolveStatePath: (...segments: string[]) => string;
  resolveRuntimePath: (...segments: string[]) => string;
  resolveConfigPath: (...segments: string[]) => string;
  resolveDataPath: (...segments: string[]) => string;
};

export type ResolveInstancePathsOptions = {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  existsSync?: (filePath: string) => boolean;
  profileAwareStateDir?: boolean;
};

function resolveProfileSuffix(profile?: string): string {
  const trimmed = profile?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") return "";
  return `-${trimmed}`;
}

function resolveLegacyStateDirs(homeDir: string): string[] {
  return LEGACY_STATE_DIRNAMES.map((dir) => joinResolvedPath(homeDir, dir));
}

function pathExists(filePath: string, existsSync: (filePath: string) => boolean): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveOverridePath(
  value: string | undefined,
  fallback: string,
  homeDir?: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return resolvePathWithHome(trimmed, { homeDir });
}

function pickFirstDefined(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return undefined;
}

export function resolveHomeDirFromEnv(
  env: Record<string, string | undefined> = process.env,
  homedir: () => string = os.homedir,
): string | undefined {
  const envHome = env.OPENCLAW_HOME?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim();
  if (envHome) return envHome;
  try {
    const fallback = homedir();
    return fallback?.trim() ? fallback : undefined;
  } catch {
    return undefined;
  }
}

export function resolvePathWithHome(
  input: string,
  opts?: {
    homeDir?: string;
  },
): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const homeDir = opts?.homeDir?.trim();
    if (!homeDir) throw new Error("Missing HOME");
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, homeDir);
    return path.resolve(expanded);
  }
  if (windowsAbsolutePath.test(trimmed) || windowsUncPath.test(trimmed)) {
    return trimmed;
  }
  return path.resolve(trimmed);
}

export function joinResolvedPath(base: string, ...segments: string[]): string {
  if (windowsAbsolutePath.test(base) || windowsUncPath.test(base)) {
    return path.win32.join(base, ...segments);
  }
  return path.join(base, ...segments);
}

export function resolveInstanceManifest(opts: ResolveInstancePathsOptions = {}): InstanceManifest {
  const env = opts.env ?? process.env;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir ?? os.homedir);
  const profile = env.OPENCLAW_PROFILE?.trim() || undefined;
  const explicitInstanceRoot = pickFirstDefined([env.OPENCLAW_INSTANCE_ROOT]);
  const stateOverride = pickFirstDefined([
    env.OPENCLAW_STATE_ROOT,
    env.OPENCLAW_STATE_DIR,
    env.CLAWDBOT_STATE_DIR,
  ]);

  let stateRoot = "";
  if (stateOverride) {
    stateRoot = resolvePathWithHome(stateOverride, { homeDir });
  } else {
    if (!homeDir) throw new Error("Missing HOME");
    const suffix = opts.profileAwareStateDir ? resolveProfileSuffix(profile) : "";
    const defaultStateRoot = joinResolvedPath(homeDir, `${DEFAULT_STATE_DIRNAME}${suffix}`);
    if (suffix) {
      stateRoot = defaultStateRoot;
    } else if (pathExists(defaultStateRoot, existsSync)) {
      stateRoot = defaultStateRoot;
    } else {
      const legacyStateRoot = resolveLegacyStateDirs(homeDir).find((candidate) =>
        pathExists(candidate, existsSync),
      );
      stateRoot = legacyStateRoot ?? defaultStateRoot;
    }
  }

  const instanceRoot = resolveOverridePath(explicitInstanceRoot, stateRoot, homeDir);
  if (!stateOverride && explicitInstanceRoot) {
    stateRoot = instanceRoot;
  }
  const configRoot = resolveOverridePath(env.OPENCLAW_CONFIG_ROOT, instanceRoot, homeDir);
  const runtimeRoot = resolveOverridePath(
    env.OPENCLAW_RUNTIME_ROOT,
    joinResolvedPath(instanceRoot, "runtime"),
    homeDir,
  );
  const dataRoot = resolveOverridePath(
    env.OPENCLAW_DATA_ROOT,
    joinResolvedPath(instanceRoot, "data"),
    homeDir,
  );
  const cacheRoot = resolveOverridePath(
    env.OPENCLAW_CACHE_ROOT,
    joinResolvedPath(runtimeRoot, "cache"),
    homeDir,
  );
  const logRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_LOG_ROOT, env.OPENCLAW_LOG_DIR]),
    joinResolvedPath(runtimeRoot, "logs"),
    homeDir,
  );
  const workspaceRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_WORKSPACE_ROOT, env.OPENCLAW_WORKSPACE_DIR]),
    joinResolvedPath(stateRoot, "workspace"),
    homeDir,
  );
  const agentsRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_AGENTS_ROOT, env.OPENCLAW_AGENTS_DIR]),
    joinResolvedPath(stateRoot, "agents"),
    homeDir,
  );
  const skillsRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_SKILLS_ROOT, env.OPENCLAW_SKILLS_DIR]),
    joinResolvedPath(stateRoot, "skills"),
    homeDir,
  );
  const extensionsRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_EXTENSIONS_ROOT, env.OPENCLAW_EXTENSIONS_DIR]),
    joinResolvedPath(configRoot, "extensions"),
    homeDir,
  );
  const codexRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_CODEX_ROOT, env.OPENCLAW_CODEX_DIR]),
    joinResolvedPath(homeDir ?? instanceRoot, ".codex"),
    homeDir,
  );
  const archiveRoot = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_ARCHIVE_ROOT, env.OPENCLAW_ARCHIVE_DIR]),
    joinResolvedPath(stateRoot, "archive"),
    homeDir,
  );
  const oauthDir = resolveOverridePath(
    env.OPENCLAW_OAUTH_DIR,
    joinResolvedPath(stateRoot, "credentials"),
    homeDir,
  );
  const configPath = resolveOverridePath(
    env.OPENCLAW_CONFIG_PATH?.trim() || env.CLAWDBOT_CONFIG_PATH?.trim(),
    joinResolvedPath(configRoot, DEFAULT_CONFIG_FILENAME),
    homeDir,
  );

  return {
    version: "v1",
    platform: process.platform,
    profile,
    instanceRoot,
    runtimeRoot,
    configRoot,
    stateRoot,
    dataRoot,
    cacheRoot,
    logRoot,
    workspaceRoot,
    agentsRoot,
    skillsRoot,
    extensionsRoot,
    codexRoot,
    archiveRoot,
    oauthDir,
    oauthPath: joinResolvedPath(oauthDir, "oauth.json"),
    configPath,
  };
}

export function resolvePathResolver(opts: ResolveInstancePathsOptions = {}): PathResolver {
  const env = opts.env ?? process.env;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir ?? os.homedir);
  const manifest = resolveInstanceManifest(opts);
  return {
    manifest,
    root: (key: InstancePathKey) => manifest[key],
    join: (key: InstancePathKey, ...segments: string[]) =>
      joinResolvedPath(manifest[key], ...segments),
    resolvePath: (input: string) => resolvePathWithHome(input, { homeDir }),
    resolveStatePath: (...segments: string[]) => joinResolvedPath(manifest.stateRoot, ...segments),
    resolveRuntimePath: (...segments: string[]) =>
      joinResolvedPath(manifest.runtimeRoot, ...segments),
    resolveConfigPath: (...segments: string[]) =>
      joinResolvedPath(manifest.configRoot, ...segments),
    resolveDataPath: (...segments: string[]) => joinResolvedPath(manifest.dataRoot, ...segments),
  };
}
