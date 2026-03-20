import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/config.js";
import { buildGatewayConnectionDetails } from "../src/gateway/call.js";
import { resolveGatewayConnectionAuth } from "../src/gateway/connection-auth.js";

type DesktopConsoleCommand = "pub-get" | "analyze" | "run" | "build" | "stage";
type DesktopTarget = "macos" | "windows";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const flutterProjectRoot = path.join(repoRoot, "apps", "desktop_console");
const localFlutterBin = "/Users/niechengyong/ProjectCode/Flutter/flutter/bin/flutter";
const runtimePayloadRootName = "DesktopRuntime";
const pnpmLockfileName = "pnpm-lock.yaml";

function resolveBuildOutputRoot(target: DesktopTarget, outputRootOverride?: string): string {
  const override = outputRootOverride?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (target === "macos") {
    return path.join(
      flutterProjectRoot,
      "build",
      "macos",
      "Build",
      "Products",
      "Release",
      "desktop_console.app",
      "Contents",
      "Resources",
      runtimePayloadRootName,
    );
  }
  return path.join(
    flutterProjectRoot,
    "build",
    "windows",
    "x64",
    "runner",
    "Release",
    "data",
    runtimePayloadRootName,
  );
}

function resolveBundledNodeBinary(target: DesktopTarget): { source: string; outputName: string } {
  const override = process.env.BUNDLED_NODE_BINARY?.trim();
  const source = override && override.length > 0 ? override : process.execPath;
  if (!fs.existsSync(source)) {
    throw new Error(`Bundled node binary not found: ${source}`);
  }
  const version = spawnSync(source, ["--version"], { encoding: "utf8" });
  const rawVersion = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  const majorToken = rawVersion.replace(/^v/i, "").split(".")[0] ?? "";
  const major = Number.parseInt(majorToken, 10);
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(
      `Bundled node binary must be Node 22+, received ${rawVersion || "unknown"} from ${source}`,
    );
  }
  const outputName = target === "windows" ? "node.exe" : "node";
  return { source, outputName };
}

function copyDirectoryFiltered(
  source: string,
  destination: string,
  excludeNames: Set<string> = new Set(),
  options: { dereference?: boolean } = {},
): void {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: options.dereference ?? false,
    filter: (entry) => {
      const basename = path.basename(entry);
      if (excludeNames.has(basename)) {
        return false;
      }
      if (
        basename.endsWith(".app") ||
        basename.endsWith(".dmg") ||
        basename.endsWith(".zip") ||
        basename.endsWith(".tar.gz") ||
        basename.startsWith("clawmark-core-")
      ) {
        return false;
      }
      return true;
    },
  });
}

function copyFileRequired(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required file: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function installBundledRuntimeDependencies(appRoot: string): void {
  const installAttempts: Array<{ args: string[]; description: string }> = [
    {
      args: ["install", "--ignore-workspace", "--prod", "--offline", "--frozen-lockfile"],
      description: "offline",
    },
    {
      args: ["install", "--ignore-workspace", "--prod", "--frozen-lockfile"],
      description: "network fallback",
    },
  ];

  let lastFailure: Error | undefined;
  for (const attempt of installAttempts) {
    const result = spawnSync("pnpm", attempt.args, {
      cwd: appRoot,
      env: {
        ...process.env,
        CI: process.env.CI || "true",
      },
      stdio: "inherit",
    });
    if (result.status === 0) {
      return;
    }
    lastFailure = new Error(
      `pnpm ${attempt.args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }

  throw lastFailure ?? new Error("Failed to install bundled runtime dependencies.");
}

function createStandaloneRuntimeAppRoot(
  target: DesktopTarget,
  stagingRoot: string,
): { appRoot: string; stagingRoot: string } {
  const appRoot = path.join(stagingRoot, "app");
  const packageJsonSource = path.join(repoRoot, "package.json");
  const lockfileSource = path.join(repoRoot, pnpmLockfileName);
  const entrypointSource = path.join(repoRoot, "openclaw.mjs");
  const distSource = path.join(repoRoot, "dist");

  fs.mkdirSync(appRoot, { recursive: true });
  copyFileRequired(packageJsonSource, path.join(appRoot, "package.json"));
  copyFileRequired(lockfileSource, path.join(appRoot, pnpmLockfileName));
  copyFileRequired(entrypointSource, path.join(appRoot, "openclaw.mjs"));
  copyDirectoryFiltered(
    distSource,
    path.join(appRoot, "dist"),
    new Set(target === "macos" ? ["OpenClaw.app"] : []),
  );
  installBundledRuntimeDependencies(appRoot);
  return { appRoot, stagingRoot };
}

function stageBundledRuntimePayload(target: DesktopTarget, outputRootOverride?: string): void {
  const destinationRoot = resolveBuildOutputRoot(target, outputRootOverride);
  const destinationParent = path.dirname(destinationRoot);
  const stagingRoot = fs.mkdtempSync(
    path.join(destinationParent, `${runtimePayloadRootName}-staging-`),
  );
  const binRoot = path.join(stagingRoot, "bin");
  createStandaloneRuntimeAppRoot(target, stagingRoot);
  try {
    fs.mkdirSync(binRoot, { recursive: true });
    const bundledNode = resolveBundledNodeBinary(target);
    const bundledNodeDestination = path.join(binRoot, bundledNode.outputName);
    fs.copyFileSync(bundledNode.source, bundledNodeDestination);
    fs.chmodSync(bundledNodeDestination, 0o755);
    fs.rmSync(destinationRoot, { recursive: true, force: true });
    fs.renameSync(stagingRoot, destinationRoot);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function removeBundledRuntimePayload(target: DesktopTarget, outputRootOverride?: string): void {
  fs.rmSync(resolveBuildOutputRoot(target, outputRootOverride), {
    recursive: true,
    force: true,
  });
}

function resolveFlutterBin(): string {
  const candidates = [
    process.env.FLUTTER_BIN?.trim(),
    process.env.FLUTTER_ROOT?.trim()
      ? path.join(process.env.FLUTTER_ROOT.trim(), "bin", "flutter")
      : undefined,
    localFlutterBin,
    "flutter",
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  for (const candidate of candidates) {
    if (candidate === "flutter") {
      return candidate;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning fallbacks.
    }
  }
  return "flutter";
}

function shouldEmbedGatewayConnection(command: DesktopConsoleCommand): boolean {
  if (command === "run") {
    return true;
  }
  return process.env.CLAWMARK_DESKTOP_EMBED_GATEWAY_CONNECTION === "1";
}

function shouldBundleCorePayload(): boolean {
  const override = process.env.CLAWMARK_DESKTOP_BUNDLE_CORE?.trim();
  if (override === "1") {
    return true;
  }
  if (override === "0") {
    return false;
  }
  return false;
}

function parseArgs(): {
  command: DesktopConsoleCommand;
  target?: DesktopTarget;
  outputRootOverride?: string;
} {
  const [rawCommand = "run", rawTarget = "macos", rawOutputRoot] = process.argv.slice(2);
  if (
    rawCommand !== "pub-get" &&
    rawCommand !== "analyze" &&
    rawCommand !== "run" &&
    rawCommand !== "build" &&
    rawCommand !== "stage"
  ) {
    throw new Error(`Unsupported desktop console command: ${rawCommand}`);
  }
  if (
    (rawCommand === "run" || rawCommand === "build" || rawCommand === "stage") &&
    rawTarget !== "macos" &&
    rawTarget !== "windows"
  ) {
    throw new Error(`Desktop target must be macos or windows, received: ${rawTarget}`);
  }
  return {
    command: rawCommand,
    target:
      rawCommand === "run" || rawCommand === "build" || rawCommand === "stage"
        ? rawTarget
        : undefined,
    outputRootOverride: rawCommand === "stage" ? rawOutputRoot : undefined,
  };
}

function spawnFlutter(flutterBin: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(flutterBin, args, {
      cwd: flutterProjectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const { command, target, outputRootOverride } = parseArgs();
const flutterBin = resolveFlutterBin();

if (command === "stage") {
  stageBundledRuntimePayload(target!, outputRootOverride);
  process.exit(0);
}

const embedGatewayConnection = shouldEmbedGatewayConnection(command);
const dartDefines = embedGatewayConnection
  ? await (async () => {
      const config = loadConfig();
      const gateway = buildGatewayConnectionDetails({ config });
      const auth = await resolveGatewayConnectionAuth({
        config,
        env: process.env,
      });
      return [
        `--dart-define=CLAWMARK_DESKTOP_WS_URL=${gateway.url}`,
        ...(auth.token ? [`--dart-define=CLAWMARK_DESKTOP_AUTH_TOKEN=${auth.token}`] : []),
        ...(auth.password ? [`--dart-define=CLAWMARK_DESKTOP_AUTH_PASSWORD=${auth.password}`] : []),
      ];
    })()
  : [];

const args =
  command === "pub-get"
    ? ["--no-version-check", "pub", "get"]
    : command === "analyze"
      ? ["--no-version-check", "analyze"]
      : command === "build"
        ? ["--no-version-check", "build", target!, ...dartDefines]
        : ["--no-version-check", "run", "-d", target!, ...dartDefines];

const exitCode = await spawnFlutter(flutterBin, args);
if (exitCode === 0 && command === "build" && target) {
  if (shouldBundleCorePayload()) {
    stageBundledRuntimePayload(target);
  } else {
    removeBundledRuntimePayload(target);
  }
}
process.exit(exitCode);
