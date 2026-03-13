const fs = require("fs");
const os = require("os");
const path = require("path");

const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moltbot", ".moldbot"];
const DEFAULT_STATE_DIRNAME = ".openclaw";
const DEFAULT_CONFIG_FILENAME = "openclaw.json";
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

function resolveProfileSuffix(profile) {
  const trimmed = String(profile || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "default") return "";
  return `-${trimmed}`;
}

function pickFirstDefined(values) {
  for (const value of values) {
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function pathExists(filePath, existsSync) {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveHomeDirFromEnv(env = process.env, homedir = os.homedir) {
  const envHome = env.HOME && env.HOME.trim();
  if (envHome) return envHome;
  const envProfile = env.USERPROFILE && env.USERPROFILE.trim();
  if (envProfile) return envProfile;
  try {
    const home = homedir();
    if (home && home.trim()) return home;
  } catch {
    // ignore
  }
  return undefined;
}

function resolvePathWithHome(input, opts = {}) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const homeDir = String(opts.homeDir || "").trim();
    if (!homeDir) throw new Error("Missing HOME");
    return path.resolve(trimmed.replace(/^~(?=$|[\\/])/, homeDir));
  }
  if (WINDOWS_ABSOLUTE_PATH.test(trimmed) || WINDOWS_UNC_PATH.test(trimmed)) {
    return trimmed;
  }
  return path.resolve(trimmed);
}

function joinResolvedPath(base, ...segments) {
  if (WINDOWS_ABSOLUTE_PATH.test(base) || WINDOWS_UNC_PATH.test(base)) {
    return path.win32.join(base, ...segments);
  }
  return path.join(base, ...segments);
}

function resolveLegacyStateDirs(homeDir) {
  return LEGACY_STATE_DIRNAMES.map((dir) => joinResolvedPath(homeDir, dir));
}

function resolveOverridePath(value, fallback, homeDir) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return fallback;
  return resolvePathWithHome(trimmed, { homeDir });
}

function resolveInstanceManifest(opts = {}) {
  const env = opts.env || process.env;
  const existsSync = opts.existsSync || fs.existsSync;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir || os.homedir);
  const profile =
    env.OPENCLAW_PROFILE && env.OPENCLAW_PROFILE.trim() ? env.OPENCLAW_PROFILE.trim() : undefined;
  const explicitInstanceRoot = pickFirstDefined([env.OPENCLAW_INSTANCE_ROOT, env.OPENCLAW_HOME]);
  const stateOverride = pickFirstDefined([
    env.OPENCLAW_STATE_ROOT,
    env.OPENCLAW_STATE_DIR,
    env.CLAWDBOT_STATE_DIR,
    env.OPENCLAW_HOME,
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
      stateRoot = legacyStateRoot || defaultStateRoot;
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
    joinResolvedPath(homeDir || instanceRoot, ".codex"),
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
    pickFirstDefined([env.OPENCLAW_CONFIG_PATH, env.CLAWDBOT_CONFIG_PATH]),
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

function resolvePathResolver(opts = {}) {
  const env = opts.env || process.env;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir || os.homedir);
  const manifest = resolveInstanceManifest(opts);
  return {
    manifest,
    root(key) {
      return manifest[key];
    },
    join(key, ...segments) {
      return joinResolvedPath(manifest[key], ...segments);
    },
    resolvePath(input) {
      return resolvePathWithHome(input, { homeDir });
    },
    resolveStatePath(...segments) {
      return joinResolvedPath(manifest.stateRoot, ...segments);
    },
    resolveRuntimePath(...segments) {
      return joinResolvedPath(manifest.runtimeRoot, ...segments);
    },
    resolveConfigPath(...segments) {
      return joinResolvedPath(manifest.configRoot, ...segments);
    },
    resolveDataPath(...segments) {
      return joinResolvedPath(manifest.dataRoot, ...segments);
    },
  };
}

function resolveControlExtensionPaths(opts = {}) {
  const env = opts.env || process.env;
  const existsSync = opts.existsSync || fs.existsSync;
  const homeDir = resolveHomeDirFromEnv(env, opts.homedir || os.homedir);
  const pluginId =
    String(opts.pluginId || "openclaw-codex-control").trim() || "openclaw-codex-control";
  const resolver = resolvePathResolver({
    ...opts,
    env,
    existsSync,
    homedir: opts.homedir || os.homedir,
  });
  const manifest = resolver.manifest;
  const legacyRuntimeRoot = manifest.stateRoot;
  const effectiveRuntimeRoot = manifest.runtimeRoot;
  const legacyControlStateDir = joinResolvedPath(manifest.stateRoot, "state", pluginId);
  const defaultControlStateDir = joinResolvedPath(manifest.dataRoot, "extensions", pluginId);
  const controlStateDir = resolveOverridePath(
    pickFirstDefined([env.OPENCLAW_CODEX_CONTROL_STATE_ROOT, env.OPENCLAW_EXTENSION_STATE_ROOT]),
    defaultControlStateDir,
    homeDir,
  );

  return {
    ...manifest,
    manifest,
    pluginId,
    legacyRuntimeRoot,
    effectiveRuntimeRoot,
    controlStateDir,
    legacyControlStateDir,
    configPath: manifest.configPath,
    openclawBin: joinResolvedPath(effectiveRuntimeRoot, "bin", "openclaw"),
    oauthHelperPath: joinResolvedPath(
      effectiveRuntimeRoot,
      "lib",
      "node_modules",
      "@mariozechner",
      "pi-ai",
      "dist",
      "utils",
      "oauth",
      "openai-codex.js",
    ),
    controlUiIndexPath: joinResolvedPath(
      effectiveRuntimeRoot,
      "lib",
      "node_modules",
      "openclaw",
      "dist",
      "control-ui",
      "index.html",
    ),
    root: resolver.root,
    join: resolver.join,
    resolvePath: resolver.resolvePath,
    resolveStatePath: resolver.resolveStatePath,
    resolveRuntimePath(...segments) {
      return joinResolvedPath(effectiveRuntimeRoot, ...segments);
    },
    resolveConfigPath: resolver.resolveConfigPath,
    resolveDataPath: resolver.resolveDataPath,
  };
}

function buildManagedRuntimeEnv(
  baseEnv = process.env,
  instancePaths = resolveControlExtensionPaths({ env: baseEnv }),
) {
  const env = {
    ...baseEnv,
    OPENCLAW_INSTANCE_ROOT: instancePaths.manifest.instanceRoot,
    OPENCLAW_HOME: instancePaths.manifest.instanceRoot,
    OPENCLAW_STATE_ROOT: instancePaths.manifest.stateRoot,
    OPENCLAW_STATE_DIR: instancePaths.manifest.stateRoot,
    CLAWDBOT_STATE_DIR: instancePaths.manifest.stateRoot,
    OPENCLAW_CONFIG_ROOT: instancePaths.manifest.configRoot,
    OPENCLAW_RUNTIME_ROOT: instancePaths.effectiveRuntimeRoot,
    OPENCLAW_DATA_ROOT: instancePaths.manifest.dataRoot,
    OPENCLAW_CACHE_ROOT: instancePaths.manifest.cacheRoot,
    OPENCLAW_LOG_ROOT: instancePaths.manifest.logRoot,
    OPENCLAW_WORKSPACE_ROOT: instancePaths.manifest.workspaceRoot,
    OPENCLAW_AGENTS_ROOT: instancePaths.manifest.agentsRoot,
    OPENCLAW_SKILLS_ROOT: instancePaths.manifest.skillsRoot,
    OPENCLAW_EXTENSIONS_ROOT: instancePaths.manifest.extensionsRoot,
    OPENCLAW_CODEX_ROOT: instancePaths.manifest.codexRoot,
    OPENCLAW_ARCHIVE_ROOT: instancePaths.manifest.archiveRoot,
    OPENCLAW_OAUTH_DIR: instancePaths.manifest.oauthDir,
    OPENCLAW_CONFIG_PATH: instancePaths.manifest.configPath,
    PATH: `${path.dirname(instancePaths.openclawBin)}:${baseEnv.PATH || ""}`,
  };
  if (instancePaths.manifest.profile) {
    env.OPENCLAW_PROFILE = instancePaths.manifest.profile;
  } else {
    delete env.OPENCLAW_PROFILE;
  }
  delete env.OPENCLAW_PREFIX;
  return env;
}

module.exports = {
  buildManagedRuntimeEnv,
  joinResolvedPath,
  resolveControlExtensionPaths,
  resolveHomeDirFromEnv,
  resolveInstanceManifest,
  resolvePathResolver,
  resolvePathWithHome,
};
