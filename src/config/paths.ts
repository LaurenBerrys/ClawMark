import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  joinResolvedPath,
  resolveHomeDirFromEnv,
  resolveInstanceManifest,
  resolvePathWithHome,
  type InstanceManifest,
  type PathResolver,
} from "../instance/paths.js";
import type { OpenClawConfig } from "./types.js";

/**
 * Nix mode detection: When OPENCLAW_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moldbot", ".moltbot"] as const;
const NEW_STATE_DIRNAME = ".openclaw";
const CONFIG_FILENAME = "openclaw.json";
const LEGACY_CONFIG_FILENAMES = ["clawdbot.json", "moldbot.json", "moltbot.json"] as const;

function legacyStateDirs(homedir: () => string = os.homedir): string[] {
  return LEGACY_STATE_DIRNAMES.map((dir) => joinResolvedPath(homedir(), dir));
}

function newStateDir(homedir: () => string = os.homedir): string {
  return joinResolvedPath(homedir(), NEW_STATE_DIRNAME);
}

export function resolveLegacyStateDir(homedir: () => string = os.homedir): string {
  return legacyStateDirs(homedir)[0] ?? newStateDir(homedir);
}

export function resolveLegacyStateDirs(homedir: () => string = os.homedir): string[] {
  return legacyStateDirs(homedir);
}

export function resolveNewStateDir(homedir: () => string = os.homedir): string {
  return newStateDir(homedir);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via OPENCLAW_STATE_DIR.
 * Default: ~/.openclaw
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return resolveInstanceManifest({ env, homedir }).stateRoot;
}

export const STATE_DIR = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via OPENCLAW_CONFIG_PATH.
 * Default: ~/.openclaw/openclaw.json (or $OPENCLAW_STATE_DIR/openclaw.json)
 */
export function resolveCanonicalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override = env.OPENCLAW_CONFIG_PATH?.trim() || env.CLAWDBOT_CONFIG_PATH?.trim();
  const homeDir = resolveHomeDirFromEnv(env, homedir);
  if (override) return resolvePathWithHome(override, { homeDir });
  const manifest = resolveInstanceManifest({ env, homedir });
  if (path.resolve(stateDir) !== path.resolve(manifest.stateRoot)) {
    return joinResolvedPath(stateDir, CONFIG_FILENAME);
  }
  return manifest.configPath;
}

/**
 * Resolve the active config path by preferring existing config candidates
 * before falling back to the canonical path.
 */
export function resolveConfigPathCandidate(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir), homedir);
}

/**
 * Active config path (prefers existing config files).
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override = env.OPENCLAW_CONFIG_PATH?.trim();
  const homeDir = resolveHomeDirFromEnv(env, homedir);
  if (override) return resolvePathWithHome(override, { homeDir });
  const manifest = resolveInstanceManifest({ env, homedir });
  const configRoot =
    path.resolve(stateDir) === path.resolve(manifest.stateRoot) ? manifest.configRoot : stateDir;
  const stateOverride = env.OPENCLAW_STATE_ROOT?.trim() || env.OPENCLAW_STATE_DIR?.trim();
  const candidates = [
    joinResolvedPath(configRoot, CONFIG_FILENAME),
    ...LEGACY_CONFIG_FILENAMES.map((name) => joinResolvedPath(configRoot, name)),
  ];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  if (stateOverride) return joinResolvedPath(configRoot, CONFIG_FILENAME);
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return joinResolvedPath(configRoot, CONFIG_FILENAME);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across default locations.
 * Order: explicit config path → state-dir-derived paths → new default.
 */
export function resolveDefaultConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string[] {
  const explicit = env.OPENCLAW_CONFIG_PATH?.trim() || env.CLAWDBOT_CONFIG_PATH?.trim();
  const homeDir = resolveHomeDirFromEnv(env, homedir);
  if (explicit) return [resolvePathWithHome(explicit, { homeDir })];

  const candidates: string[] = [];
  const manifest = resolveInstanceManifest({ env, homedir });
  const configuredConfigRoot =
    env.OPENCLAW_CONFIG_ROOT?.trim() ||
    env.OPENCLAW_INSTANCE_ROOT?.trim() ||
    env.OPENCLAW_STATE_ROOT?.trim() ||
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (configuredConfigRoot) {
    const resolved = resolvePathWithHome(configuredConfigRoot, { homeDir });
    candidates.push(joinResolvedPath(resolved, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => joinResolvedPath(resolved, name)));
    return candidates;
  }

  const defaultDirs = [newStateDir(homedir), ...legacyStateDirs(homedir)];
  for (const dir of defaultDirs) {
    candidates.push(joinResolvedPath(dir, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => joinResolvedPath(dir, name)));
  }
  if (!candidates.includes(manifest.configPath)) {
    candidates.unshift(manifest.configPath);
  }
  return candidates;
}

export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Gateway lock directory (ephemeral).
 * Default: os.tmpdir()/openclaw-<uid> (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `openclaw-${uid}` : "openclaw";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `OPENCLAW_OAUTH_DIR` (explicit override)
 * - `$*_STATE_DIR/credentials` (canonical server/default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override = env.OPENCLAW_OAUTH_DIR?.trim();
  if (override) {
    return resolvePathWithHome(override, { homeDir: resolveHomeDirFromEnv(env, homedir) });
  }
  const manifest = resolveInstanceManifest({ env, homedir });
  if (path.resolve(stateDir) !== path.resolve(manifest.stateRoot)) {
    return joinResolvedPath(stateDir, "credentials");
  }
  return manifest.oauthDir;
}

export function resolvePathManifest(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): InstanceManifest {
  return resolveInstanceManifest({ env, homedir });
}

export type { InstanceManifest, PathResolver };

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  return joinResolvedPath(resolveOAuthDir(env, stateDir, homedir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.OPENCLAW_GATEWAY_PORT?.trim() || env.CLAWDBOT_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}
