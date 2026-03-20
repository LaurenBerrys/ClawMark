import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type AssetEntry = {
  version: string;
  platform: string;
  arch: string;
  assetName: string;
  archiveFormat: string;
  sha256: string;
  sizeBytes: number;
  localPath?: string;
  downloadUrl?: string;
  publishedAt?: string;
};

function usage(): never {
  throw new Error(
    "Usage: node --import tsx scripts/merge-clawmark-core-manifest.ts <output-path> <asset-manifest...>",
  );
}

const [outputPath, ...inputPaths] = process.argv.slice(2);
if (!outputPath || inputPaths.length === 0) {
  usage();
}

const releaseTag = process.env.CLAWMARK_CORE_RELEASE_TAG?.trim() || "";
const repository = process.env.CLAWMARK_CORE_REPOSITORY?.trim() || "LaurenBerrys/ClawMark";
const publishedAt = process.env.CLAWMARK_CORE_PUBLISHED_AT?.trim() || new Date().toISOString();
const releaseBaseUrl =
  releaseTag.length > 0 ? `https://github.com/${repository}/releases/download/${releaseTag}` : "";

const assets: AssetEntry[] = [];
let version = "";

for (const inputPath of inputPaths) {
  const resolved = path.resolve(inputPath);
  const decoded = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
    version?: string;
    assets?: AssetEntry[];
  };
  if (decoded.version && !version) {
    version = decoded.version;
  }
  for (const asset of decoded.assets ?? []) {
    assets.push({
      ...asset,
      downloadUrl:
        asset.downloadUrl || (releaseBaseUrl ? `${releaseBaseUrl}/${asset.assetName}` : ""),
      publishedAt: asset.publishedAt || publishedAt,
    });
  }
}

if (!version || assets.length === 0) {
  throw new Error("No ClawMarkCore assets were provided for manifest generation.");
}

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  assets,
};

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${outputPath}\n`);
