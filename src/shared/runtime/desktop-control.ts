import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  resolveConfigPath,
  resolveGatewayPort,
  type OpenClawConfig,
} from "../../config/config.js";
import { DEFAULT_GATEWAY_PORT } from "../../config/paths.js";
import { buildGatewayConnectionDetails } from "../../gateway/call.js";
import { isLoopbackHost } from "../../gateway/net.js";
import { resolveInstanceManifest, type InstanceManifest } from "../../instance/paths.js";
import { resolveRuntimeServiceVersion } from "../../version.js";
import type {
  ArchivedTaskStep,
  TaskRecord,
  TaskReportRecord,
  TaskReview,
  TaskRun,
  TaskStep,
  RuntimeTaskDefaults,
} from "./contracts.js";
import {
  buildFederationRuntimeSnapshot,
  buildRuntimeCapabilitiesStatus,
  buildRuntimeDashboardSnapshot,
  buildRuntimeEvolutionStatus,
  buildRuntimeIntelStatus,
  buildRuntimeMemoryList,
  buildRuntimeTasksList,
  type FederationRuntimeSnapshot,
  type RuntimeCapabilitiesStatus,
  type RuntimeDashboardSnapshot,
  type RuntimeEvolutionStatus,
  type RuntimeIntelStatus,
  type RuntimeMemoryListResult,
  type RuntimeTasksListResult,
} from "./runtime-dashboard.js";
import { loadRuntimeTaskStore, type RuntimeStoreOptions } from "./store.js";

export type DesktopBootstrapState = {
  generatedAt: number;
  product: {
    name: "ClawMark";
    operatorSurface: "desktop_console";
    supportedPlatforms: ["macOS", "Windows"];
    webProductSurfaceEnabled: false;
    layout: "left_navigation_center_interaction_right_workboard";
  };
  instanceManifest: InstanceManifest;
  gateway: DesktopGatewayDescriptor;
  runtime: DesktopRuntimeProcessState;
  warnings: string[];
};

export type ClawMarkCoreReleaseAssetManifest = {
  platform: "macos" | "windows";
  arch: string;
  version: string;
  assetName: string;
  archiveFormat: "tar.gz" | "zip";
  sha256: string;
  sizeBytes: number;
  downloadUrl?: string;
  publishedAt?: string;
};

export type ClawMarkCoreReleaseManifest = {
  generatedAt: number;
  version: string;
  assets: ClawMarkCoreReleaseAssetManifest[];
};

export type DesktopConnectionDescriptor = {
  version: string;
  coreVersion: string;
  transport: "websocket-rpc";
  wsUrl: string;
  authToken: string;
  issuedAt: number;
  expiresAt: number;
  hostPid: number;
  runtimePid: number;
  instanceRoot: string;
  logRoot: string;
};

export type DesktopBootstrapStateKind =
  | "core_missing"
  | "download_available"
  | "downloading"
  | "verifying"
  | "installing"
  | "starting_runtime"
  | "ready"
  | "failed";

export type DesktopCoreInstallState = {
  state: DesktopBootstrapStateKind;
  source: "installed" | "bundled" | "missing";
  installed: boolean;
  bundledAvailable: boolean;
  currentRoot: string;
  stagedRoot: string;
  downloadsRoot: string;
  version?: string;
  lastCheckedAt?: number;
  latestVersion?: string;
  updateAvailable?: boolean;
  lastError?: string;
};

export type DesktopBootstrapStatus = {
  generatedAt: number;
  state: DesktopBootstrapStateKind;
  platform: string;
  arch: string;
  core: DesktopCoreInstallState;
  connection: DesktopConnectionDescriptor | null;
  directories: {
    appSupportRoot: string;
    descriptorPath: string;
    instanceRoot: string;
    logRoot: string;
  };
  warnings: string[];
};

export type DesktopGatewayDescriptor = {
  url: string;
  urlSource: string;
  port: number;
  authMode: string;
  requiresAuth: boolean;
  localOnly: boolean;
  transport: "websocket-rpc";
};

export type DesktopRuntimeProcessState = {
  pid: number;
  startedAt: number;
  uptimeMs: number;
  platform: NodeJS.Platform;
  runtimeVersion: string;
  nodeVersion: string;
  wsUrl: string;
  configPath: string;
  runtimeRoot: string;
  logRoot: string;
  workspaceRoot: string;
  bundledHostReady: boolean;
};

export type DesktopInitializeInstanceResult = {
  generatedAt: number;
  createdPaths: string[];
  createdConfig: boolean;
  instanceManifest: InstanceManifest;
};

export type DesktopOpenLogsResult = {
  generatedAt: number;
  logRoot: string;
  opened: boolean;
};

export type DesktopSettingsSnapshot = {
  generatedAt: number;
  instanceManifest: InstanceManifest;
  gateway: DesktopGatewayDescriptor;
  taskDefaults: RuntimeTaskDefaults;
  evolution: Pick<
    RuntimeEvolutionStatus,
    "enabled" | "autoApplyLowRisk" | "autoCanaryEvolution" | "reviewIntervalHours"
  >;
  intel: Pick<
    RuntimeIntelStatus,
    | "enabled"
    | "digestEnabled"
    | "refreshMinutes"
    | "dailyPushEnabled"
    | "instantPushEnabled"
    | "dailyPushHourLocal"
    | "dailyPushMinuteLocal"
  >;
  capabilities: Pick<
    RuntimeCapabilitiesStatus,
    "preset" | "browserEnabled" | "sandboxMode" | "workspaceRoot"
  >;
};

export type RuntimeHealthSnapshot = {
  generatedAt: number;
  process: {
    pid: number;
    uptimeMs: number;
    rssBytes: number;
    heapUsedBytes: number;
  };
  runtimeVersion: string;
  tasks: {
    total: number;
    runnable: number;
    active: number;
    waitingUser: number;
  };
  memory: {
    total: number;
    strategies: number;
    invalidated: number;
  };
  federation: {
    enabled: boolean;
    remoteConfigured: boolean;
    pendingOutboxEventCount: number;
    pendingAssignments: number;
  };
  warnings: string[];
};

export type RuntimeTaskDetailSnapshot = {
  generatedAt: number;
  task: TaskRecord;
  runs: TaskRun[];
  reviews: TaskReview[];
  reports: TaskReportRecord[];
  activeSteps: TaskStep[];
  archivedSteps: ArchivedTaskStep[];
};

type DesktopControlOptions = RuntimeStoreOptions & {
  config?: OpenClawConfig;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function resolveDesktopConnectionDescriptor(
  env: NodeJS.ProcessEnv = process.env,
): DesktopConnectionDescriptor | undefined {
  const descriptorPath = env.CLAWMARK_DESKTOP_RUNTIME_DESCRIPTOR_PATH?.trim();
  if (descriptorPath) {
    try {
      const decoded = JSON.parse(
        fs.readFileSync(descriptorPath, "utf8"),
      ) as Partial<DesktopConnectionDescriptor>;
      if (
        typeof decoded.wsUrl === "string" &&
        decoded.wsUrl.trim().length > 0 &&
        typeof decoded.authToken === "string" &&
        decoded.authToken.trim().length > 0
      ) {
        return {
          version: typeof decoded.version === "string" ? decoded.version : "v1",
          coreVersion: typeof decoded.coreVersion === "string" ? decoded.coreVersion : "unknown",
          transport: "websocket-rpc",
          wsUrl: decoded.wsUrl,
          authToken: decoded.authToken,
          issuedAt: typeof decoded.issuedAt === "number" ? decoded.issuedAt : Date.now(),
          expiresAt:
            typeof decoded.expiresAt === "number" ? decoded.expiresAt : Date.now() + 86_400_000,
          hostPid: typeof decoded.hostPid === "number" ? decoded.hostPid : process.ppid,
          runtimePid: typeof decoded.runtimePid === "number" ? decoded.runtimePid : process.pid,
          instanceRoot:
            typeof decoded.instanceRoot === "string"
              ? decoded.instanceRoot
              : resolveInstanceManifest({ env }).instanceRoot,
          logRoot:
            typeof decoded.logRoot === "string"
              ? decoded.logRoot
              : resolveInstanceManifest({ env }).logRoot,
        };
      }
    } catch {
      // Ignore malformed desktop descriptors and fall back to the current process env.
    }
  }

  const wsUrl = env.CLAWMARK_DESKTOP_WS_URL?.trim();
  const authToken = env.CLAWMARK_DESKTOP_AUTH_TOKEN?.trim();
  if (!wsUrl || !authToken) {
    return undefined;
  }
  const manifest = resolveInstanceManifest({ env });
  return {
    version: "v1",
    coreVersion: env.CLAWMARK_DESKTOP_CORE_VERSION?.trim() || resolveRuntimeServiceVersion(env),
    transport: "websocket-rpc",
    wsUrl,
    authToken,
    issuedAt: resolveNow(),
    expiresAt: resolveNow() + 86_400_000,
    hostPid: Number.parseInt(env.CLAWMARK_DESKTOP_HOST_PID?.trim() || "", 10) || process.ppid,
    runtimePid: process.pid,
    instanceRoot: manifest.instanceRoot,
    logRoot: manifest.logRoot,
  };
}

export function loadDesktopConfigSafe(): OpenClawConfig | undefined {
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

function resolveGatewayDescriptor(
  config: OpenClawConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { descriptor: DesktopGatewayDescriptor; warnings: string[] } {
  const warnings: string[] = [];
  const desktopDescriptor = resolveDesktopConnectionDescriptor(env);
  if (desktopDescriptor) {
    try {
      const parsed = new URL(desktopDescriptor.wsUrl);
      return {
        descriptor: {
          url: desktopDescriptor.wsUrl,
          urlSource: "desktop runtime descriptor",
          port: parsed.port ? Number.parseInt(parsed.port, 10) : resolveGatewayPort(config, env),
          authMode: desktopDescriptor.authToken.trim().length > 0 ? "token" : "none",
          requiresAuth: desktopDescriptor.authToken.trim().length > 0,
          localOnly: isLoopbackHost(parsed.hostname),
          transport: "websocket-rpc",
        },
        warnings,
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const details = buildGatewayConnectionDetails({ config });
    const parsed = new URL(details.url);
    const authMode = config?.gateway?.auth?.mode ?? "token";
    return {
      descriptor: {
        url: details.url,
        urlSource: details.urlSource,
        port: parsed.port ? Number.parseInt(parsed.port, 10) : resolveGatewayPort(config, env),
        authMode,
        requiresAuth: authMode !== "none",
        localOnly: isLoopbackHost(parsed.hostname),
        transport: "websocket-rpc",
      },
      warnings,
    };
  } catch (error) {
    const port = resolveGatewayPort(config, env) || DEFAULT_GATEWAY_PORT;
    const url = `ws://127.0.0.1:${port}`;
    warnings.push(error instanceof Error ? error.message : String(error));
    return {
      descriptor: {
        url,
        urlSource: "local loopback fallback",
        port,
        authMode: config?.gateway?.auth?.mode ?? "token",
        requiresAuth: (config?.gateway?.auth?.mode ?? "token") !== "none",
        localOnly: true,
        transport: "websocket-rpc",
      },
      warnings,
    };
  }
}

export function buildDesktopRuntimeProcessState(
  opts: DesktopControlOptions = {},
): DesktopRuntimeProcessState {
  const now = resolveNow(opts.now);
  const config = opts.config ?? loadDesktopConfigSafe();
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const { descriptor } = resolveGatewayDescriptor(config, opts.env ?? process.env);
  return {
    pid: process.pid,
    startedAt: now - Math.round(process.uptime() * 1000),
    uptimeMs: Math.round(process.uptime() * 1000),
    platform: process.platform,
    runtimeVersion: resolveRuntimeServiceVersion(opts.env ?? process.env),
    nodeVersion: process.version,
    wsUrl: descriptor.url,
    configPath: resolveConfigPath(opts.env ?? process.env, undefined, opts.homedir),
    runtimeRoot: instanceManifest.runtimeRoot,
    logRoot: instanceManifest.logRoot,
    workspaceRoot: instanceManifest.workspaceRoot,
    bundledHostReady: true,
  };
}

export function buildDesktopBootstrapState(
  opts: DesktopControlOptions = {},
): DesktopBootstrapState {
  const now = resolveNow(opts.now);
  const config = opts.config ?? loadDesktopConfigSafe();
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const { descriptor, warnings } = resolveGatewayDescriptor(config, opts.env ?? process.env);
  return {
    generatedAt: now,
    product: {
      name: "ClawMark",
      operatorSurface: "desktop_console",
      supportedPlatforms: ["macOS", "Windows"],
      webProductSurfaceEnabled: false,
      layout: "left_navigation_center_interaction_right_workboard",
    },
    instanceManifest,
    gateway: descriptor,
    runtime: buildDesktopRuntimeProcessState({
      ...opts,
      now,
      config,
    }),
    warnings,
  };
}

export function initializeDesktopInstance(
  opts: DesktopControlOptions = {},
): DesktopInitializeInstanceResult {
  const now = resolveNow(opts.now);
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const roots = [
    instanceManifest.instanceRoot,
    instanceManifest.configRoot,
    instanceManifest.stateRoot,
    instanceManifest.runtimeRoot,
    instanceManifest.dataRoot,
    instanceManifest.cacheRoot,
    instanceManifest.logRoot,
    instanceManifest.workspaceRoot,
    instanceManifest.agentsRoot,
    instanceManifest.skillsRoot,
    instanceManifest.extensionsRoot,
    instanceManifest.archiveRoot,
    instanceManifest.oauthDir,
  ];
  const createdPaths: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      createdPaths.push(root);
    }
  }
  const configPath = instanceManifest.configPath;
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  let createdConfig = false;
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      '{\n  "runtime": {\n    "surface": "desktop_console"\n  }\n}\n',
      "utf8",
    );
    createdConfig = true;
  }
  return {
    generatedAt: now,
    createdPaths,
    createdConfig,
    instanceManifest,
  };
}

export function buildDesktopSettingsSnapshot(
  opts: DesktopControlOptions = {},
): DesktopSettingsSnapshot {
  const now = resolveNow(opts.now);
  const config = opts.config ?? loadDesktopConfigSafe();
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const evolution = buildRuntimeEvolutionStatus({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const intel = buildRuntimeIntelStatus({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const capabilities = buildRuntimeCapabilitiesStatus({
    env: opts.env,
    homedir: opts.homedir,
    now,
    config,
  });
  return {
    generatedAt: now,
    instanceManifest,
    gateway: resolveGatewayDescriptor(config, opts.env ?? process.env).descriptor,
    taskDefaults: taskStore.defaults,
    evolution: {
      enabled: evolution.enabled,
      autoApplyLowRisk: evolution.autoApplyLowRisk,
      autoCanaryEvolution: evolution.autoCanaryEvolution,
      reviewIntervalHours: evolution.reviewIntervalHours,
    },
    intel: {
      enabled: intel.enabled,
      digestEnabled: intel.digestEnabled,
      refreshMinutes: intel.refreshMinutes,
      dailyPushEnabled: intel.dailyPushEnabled,
      instantPushEnabled: intel.instantPushEnabled,
      dailyPushHourLocal: intel.dailyPushHourLocal,
      dailyPushMinuteLocal: intel.dailyPushMinuteLocal,
    },
    capabilities: {
      preset: capabilities.preset,
      browserEnabled: capabilities.browserEnabled,
      sandboxMode: capabilities.sandboxMode,
      workspaceRoot: capabilities.workspaceRoot,
    },
  };
}

export function buildRuntimeHealthSnapshot(
  opts: DesktopControlOptions = {},
): RuntimeHealthSnapshot {
  const now = resolveNow(opts.now);
  const tasks = buildRuntimeTasksList({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const memory = buildRuntimeMemoryList({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federation = buildFederationRuntimeSnapshot({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const warnings: string[] = [];
  if (tasks.replanPendingCount > 0) {
    warnings.push(`${tasks.replanPendingCount} tasks are waiting for replanning.`);
  }
  if (memory.highDecayCount > 0) {
    warnings.push(`${memory.highDecayCount} memories crossed the high-decay threshold.`);
  }
  if (federation.enabled && !federation.remoteConfigured) {
    warnings.push("Federation is enabled locally but the remote endpoint is not configured.");
  }
  return {
    generatedAt: now,
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
    runtimeVersion: resolveRuntimeServiceVersion(opts.env ?? process.env),
    tasks: {
      total: tasks.total,
      runnable: tasks.runnableCount,
      active: tasks.activeTaskCount,
      waitingUser: tasks.statusCounts.waitingUser ?? 0,
    },
    memory: {
      total: memory.total,
      strategies: memory.strategyCount,
      invalidated: memory.invalidatedCount,
    },
    federation: {
      enabled: federation.enabled,
      remoteConfigured: federation.remoteConfigured,
      pendingOutboxEventCount: federation.pendingOutboxEventCount,
      pendingAssignments: federation.pendingAssignments,
    },
    warnings,
  };
}

export function buildRuntimeTaskDetailSnapshot(
  taskId: string,
  opts: DesktopControlOptions = {},
): RuntimeTaskDetailSnapshot {
  const now = resolveNow(opts.now);
  const taskStore = loadRuntimeTaskStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const task = taskStore.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Unknown task ${taskId}`);
  }
  return {
    generatedAt: now,
    task,
    runs: taskStore.runs.filter((entry) => entry.taskId === taskId),
    reviews: taskStore.reviews.filter((entry) => entry.taskId === taskId),
    reports: taskStore.reports.filter((entry) => entry.taskId === taskId),
    activeSteps: taskStore.steps.filter((entry) => entry.taskId === taskId),
    archivedSteps: taskStore.archivedSteps.filter((entry) => entry.taskId === taskId),
  };
}

export type DesktopRuntimeShellSnapshot = {
  generatedAt: number;
  bootstrap: DesktopBootstrapState;
  dashboard: RuntimeDashboardSnapshot;
  tasks: RuntimeTasksListResult;
  memory: RuntimeMemoryListResult;
  evolution: RuntimeEvolutionStatus;
  capabilities: RuntimeCapabilitiesStatus;
  federation: FederationRuntimeSnapshot;
  settings: DesktopSettingsSnapshot;
};

export function buildDesktopRuntimeShellSnapshot(
  opts: DesktopControlOptions = {},
): DesktopRuntimeShellSnapshot {
  const now = resolveNow(opts.now);
  const config = opts.config ?? loadDesktopConfigSafe();
  return {
    generatedAt: now,
    bootstrap: buildDesktopBootstrapState({
      ...opts,
      now,
      config,
    }),
    dashboard: buildRuntimeDashboardSnapshot({
      env: opts.env,
      homedir: opts.homedir,
      now,
      config,
    }),
    tasks: buildRuntimeTasksList({
      env: opts.env,
      homedir: opts.homedir,
      now,
    }),
    memory: buildRuntimeMemoryList({
      env: opts.env,
      homedir: opts.homedir,
      now,
    }),
    evolution: buildRuntimeEvolutionStatus({
      env: opts.env,
      homedir: opts.homedir,
      now,
    }),
    capabilities: buildRuntimeCapabilitiesStatus({
      env: opts.env,
      homedir: opts.homedir,
      now,
      config,
    }),
    federation: buildFederationRuntimeSnapshot({
      env: opts.env,
      homedir: opts.homedir,
      now,
    }),
    settings: buildDesktopSettingsSnapshot({
      ...opts,
      now,
      config,
    }),
  };
}

export function buildDesktopOpenLogsResult(
  opts: DesktopControlOptions = {},
): DesktopOpenLogsResult {
  const now = resolveNow(opts.now);
  const instanceManifest = resolveInstanceManifest({
    env: opts.env,
    homedir: opts.homedir,
  });
  fs.mkdirSync(instanceManifest.logRoot, { recursive: true });
  const opened = (() => {
    const platform = process.platform;
    const logRoot = instanceManifest.logRoot;
    const spawnOptions = {
      detached: true,
      stdio: "ignore" as const,
    };
    try {
      if (platform === "darwin") {
        const child = spawn("open", [logRoot], spawnOptions);
        child.unref();
        return true;
      }
      if (platform === "win32") {
        const child = spawn("explorer.exe", [logRoot], spawnOptions);
        child.unref();
        return true;
      }
      if (platform === "linux") {
        const child = spawn("xdg-open", [logRoot], spawnOptions);
        child.unref();
        return true;
      }
    } catch {
      return false;
    }
    return false;
  })();
  return {
    generatedAt: now,
    logRoot: instanceManifest.logRoot,
    opened,
  };
}
