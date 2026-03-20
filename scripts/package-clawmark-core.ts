import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type DesktopTarget = "macos" | "windows";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distSource = path.join(repoRoot, "dist");
const packageJsonSource = path.join(repoRoot, "package.json");
const lockfileSource = path.join(repoRoot, "pnpm-lock.yaml");
const entrypointSource = path.join(repoRoot, "openclaw.mjs");
const runtimeRootName = "ClawMarkCore";

type PackagedAssetManifest = {
  version: string;
  generatedAt: string;
  assets: Array<{
    version: string;
    platform: DesktopTarget;
    arch: string;
    assetName: string;
    archiveFormat: "tar.gz" | "zip";
    sha256: string;
    sizeBytes: number;
    localPath: string;
  }>;
};

function parseArgs(): { target: DesktopTarget; outputDir: string } {
  const args = process.argv.slice(2);
  const [rawTarget] = args;
  if (rawTarget !== "macos" && rawTarget !== "windows") {
    throw new Error(
      "Usage: node --import tsx scripts/package-clawmark-core.ts <macos|windows> [--output-dir <dir>]",
    );
  }
  let outputDir = path.join(repoRoot, "dist");
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--output-dir") {
      const candidate = args[index + 1]?.trim();
      if (!candidate) {
        throw new Error("--output-dir requires a value");
      }
      outputDir = path.resolve(candidate);
      index += 1;
    }
  }
  return { target: rawTarget, outputDir };
}

function normalizeArch(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "x86_64" || normalized === "amd64") {
    return "x64";
  }
  return normalized;
}

function resolveHostArch(): string {
  return normalizeArch(process.env.CLAWMARK_CORE_ARCH?.trim() || process.arch);
}

function resolvePnpmBin(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      CI: process.env.CI || "true",
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
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
  return { source, outputName: target === "windows" ? "node.exe" : "node" };
}

function copyFileRequired(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required file: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyDirectoryFiltered(
  source: string,
  destination: string,
  excludeNames: Set<string> = new Set(),
): void {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
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

function installBundledRuntimeDependencies(appRoot: string): void {
  const pnpm = resolvePnpmBin();
  const attempts: string[][] = [
    ["install", "--ignore-workspace", "--prod", "--offline", "--frozen-lockfile"],
    ["install", "--ignore-workspace", "--prod", "--frozen-lockfile"],
  ];
  let lastError: Error | undefined;
  for (const args of attempts) {
    const result = spawnSync(pnpm, args, {
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
    lastError = new Error(
      `pnpm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
  throw lastError ?? new Error("Failed to install production runtime dependencies.");
}

function runtimeVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonSource, "utf8")) as {
    version?: string;
  };
  const version = packageJson.version?.trim();
  if (!version) {
    throw new Error("Root package.json is missing a version field");
  }
  return version;
}

function archiveAsset(
  target: DesktopTarget,
  parentDir: string,
  rootName: string,
  outputPath: string,
): void {
  if (target === "windows") {
    const powershellArgs = [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${path.join(parentDir, rootName)}' -DestinationPath '${outputPath}' -Force`,
    ];
    runCommand("powershell", powershellArgs, repoRoot);
    return;
  }
  runCommand("tar", ["-czf", outputPath, "-C", parentDir, rootName], repoRoot);
}

function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const { target, outputDir } = parseArgs();
const version = runtimeVersion();
const arch = resolveHostArch();
const archiveFormat = target === "windows" ? "zip" : "tar.gz";
const assetName =
  target === "windows"
    ? `${runtimeRootName}-windows-${arch}-${version}.zip`
    : `${runtimeRootName}-macos-${arch}-${version}.tar.gz`;
const stageRootName =
  target === "windows"
    ? `${runtimeRootName}-windows-${arch}-${version}`
    : `${runtimeRootName}-macos-${arch}-${version}`;
const stageParent = fs.mkdtempSync(path.join(os.tmpdir(), "clawmark-core-staging-"));
const stageRoot = path.join(stageParent, stageRootName);
const appRoot = path.join(stageRoot, "app");
const binRoot = path.join(stageRoot, "bin");

fs.mkdirSync(outputDir, { recursive: true });
if (process.env.SKIP_JS_BUILD !== "1") {
  runCommand(resolvePnpmBin(), ["build"], repoRoot);
}

try {
  fs.mkdirSync(appRoot, { recursive: true });
  copyFileRequired(packageJsonSource, path.join(appRoot, "package.json"));
  copyFileRequired(lockfileSource, path.join(appRoot, "pnpm-lock.yaml"));
  copyFileRequired(entrypointSource, path.join(appRoot, "openclaw.mjs"));
  copyDirectoryFiltered(distSource, path.join(appRoot, "dist"));
  installBundledRuntimeDependencies(appRoot);

  fs.mkdirSync(binRoot, { recursive: true });
  const nodeBinary = resolveBundledNodeBinary(target);
  const bundledNodeDestination = path.join(binRoot, nodeBinary.outputName);
  fs.copyFileSync(nodeBinary.source, bundledNodeDestination);
  fs.chmodSync(bundledNodeDestination, 0o755);

  const manifestPath = path.join(stageRoot, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version,
        platform: target,
        arch,
        assetName,
        archiveFormat,
        generatedAt: Date.now(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const archivePath = path.join(outputDir, assetName);
  fs.rmSync(archivePath, { force: true });
  archiveAsset(target, stageParent, stageRootName, archivePath);

  const assetManifest: PackagedAssetManifest = {
    version,
    generatedAt: new Date().toISOString(),
    assets: [
      {
        version,
        platform: target,
        arch,
        assetName,
        archiveFormat,
        sha256: sha256OfFile(archivePath),
        sizeBytes: fs.statSync(archivePath).size,
        localPath: archivePath,
      },
    ],
  };
  const assetManifestPath = path.join(
    outputDir,
    `clawmark-core-asset-manifest-${target}-${arch}.json`,
  );
  fs.writeFileSync(assetManifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`, "utf8");

  process.stdout.write(`Packaged ${assetName}\n`);
  process.stdout.write(`Asset manifest: ${assetManifestPath}\n`);
} finally {
  fs.rmSync(stageParent, { recursive: true, force: true });
}
