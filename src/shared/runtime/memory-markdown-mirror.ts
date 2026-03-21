import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  EvolutionMemoryRecord,
  MemoryRecord,
  MetaLearningRecord,
  RuntimeMetadata,
  RuntimeMemoryStore,
  StrategyRecord,
} from "./contracts.js";
import {
  loadRuntimeMemoryStore,
  saveRuntimeMemoryStore,
  type RuntimeStoreOptions,
} from "./store.js";

type RuntimeMemoryMarkdownMirrorMetadata = {
  lastSyncedAt?: number;
  fileCount?: number;
};

export type RuntimeMemoryMarkdownMirrorStatus = {
  rootPath: string;
  exists: boolean;
  fileCount: number;
  lastSyncedAt?: number;
  memoryCount: number;
  strategyCount: number;
  learningCount: number;
  evolutionCount: number;
};

export type RuntimeMemoryMarkdownMirrorSyncResult = RuntimeMemoryMarkdownMirrorStatus & {
  syncedAt: number;
  files: string[];
};

const MIRROR_FILES = [
  "README.md",
  "memories.md",
  "strategies.md",
  "meta-learning.md",
  "evolution-memory.md",
] as const;

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function readMarkdownMirrorMetadata(
  metadata: RuntimeMetadata | undefined,
): RuntimeMemoryMarkdownMirrorMetadata {
  const record = metadata?.markdownMirror;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }
  const lastSyncedAt = Number((record as Record<string, unknown>).lastSyncedAt);
  const fileCount = Number((record as Record<string, unknown>).fileCount);
  return {
    lastSyncedAt:
      Number.isFinite(lastSyncedAt) && lastSyncedAt > 0 ? Math.trunc(lastSyncedAt) : undefined,
    fileCount: Number.isFinite(fileCount) && fileCount >= 0 ? Math.trunc(fileCount) : undefined,
  };
}

function mergeMarkdownMirrorMetadata(
  metadata: RuntimeMetadata | undefined,
  patch: Partial<RuntimeMemoryMarkdownMirrorMetadata>,
): RuntimeMetadata {
  const current = readMarkdownMirrorMetadata(metadata);
  return {
    ...metadata,
    markdownMirror: {
      ...current,
      ...patch,
    },
  };
}

function getMirrorRootPath(opts: RuntimeStoreOptions = {}): string {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  return resolver.resolveDataPath("mirrors", "memory-markdown");
}

function listExistingMirrorFiles(rootPath: string): string[] {
  return MIRROR_FILES.filter((fileName) => fs.existsSync(path.join(rootPath, fileName)));
}

function formatTimestamp(value?: number): string {
  return Number.isFinite(value) ? new Date(Number(value)).toISOString() : "(unset)";
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "(none)";
  }
  return values.map((value) => `\`${value}\``).join(", ");
}

function sortByUpdatedAt<T extends { id: string; updatedAt: number; createdAt?: number }>(
  records: T[],
): T[] {
  return [...records].toSorted((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    if (Number(right.createdAt ?? 0) !== Number(left.createdAt ?? 0)) {
      return Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0);
    }
    return left.id.localeCompare(right.id);
  });
}

function stringifyMetadata(metadata: RuntimeMetadata | undefined): string | undefined {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }
  return JSON.stringify(metadata, null, 2);
}

function renderMetadataBlock(metadata: RuntimeMetadata | undefined): string[] {
  const json = stringifyMetadata(metadata);
  if (!json) {
    return [];
  }
  return ["### Metadata", "", "```json", json, "```", ""];
}

function renderMemoryRecord(record: MemoryRecord): string {
  const lines = [
    `## ${record.summary}`,
    "",
    `- ID: \`${record.id}\``,
    `- Type: \`${record.memoryType}\``,
    `- Route: ${record.route ? `\`${record.route}\`` : "(unset)"}`,
    `- Scope: ${record.scope ? `\`${record.scope}\`` : "(unset)"}`,
    `- Confidence: ${record.confidence}%`,
    `- Version: ${record.version}`,
    `- Tags: ${formatList(record.tags)}`,
    `- Applies when: ${record.appliesWhen ?? "(unset)"}`,
    `- Avoid when: ${record.avoidWhen ?? "(unset)"}`,
    `- Source events: ${formatList(record.sourceEventIds)}`,
    `- Source tasks: ${formatList(record.sourceTaskIds)}`,
    `- Source intel: ${formatList(record.sourceIntelIds)}`,
    `- Derived from: ${formatList(record.derivedFromMemoryIds)}`,
    `- Invalidated by: ${formatList(record.invalidatedBy)}`,
    `- Last reinforced: ${formatTimestamp(record.lastReinforcedAt)}`,
    `- Decay score: ${record.decayScore ?? 0}`,
    `- Created: ${formatTimestamp(record.createdAt)}`,
    `- Updated: ${formatTimestamp(record.updatedAt)}`,
    "",
  ];
  if (record.detail?.trim()) {
    lines.push("### Detail", "", record.detail.trim(), "");
  }
  lines.push(...renderMetadataBlock(record.metadata));
  return lines.join("\n");
}

function renderStrategyRecord(record: StrategyRecord): string {
  const lines = [
    `## ${record.summary}`,
    "",
    `- ID: \`${record.id}\``,
    `- Route: \`${record.route}\``,
    `- Worker: \`${record.worker}\``,
    `- Skills: ${formatList(record.skillIds)}`,
    `- Thinking lane: \`${record.thinkingLane}\``,
    `- Confidence: ${record.confidence}%`,
    `- Version: ${record.version}`,
    `- Trigger conditions: ${record.triggerConditions ?? "(unset)"}`,
    `- Recommended path: ${record.recommendedPath ?? "(unset)"}`,
    `- Fallback path: ${record.fallbackPath ?? record.fallback ?? "(unset)"}`,
    `- Source tasks: ${formatList(record.sourceTaskIds)}`,
    `- Source reviews: ${formatList(record.sourceReviewIds)}`,
    `- Source intel: ${formatList(record.sourceIntelIds)}`,
    `- Derived from: ${formatList(record.derivedFromMemoryIds)}`,
    `- Invalidated by: ${formatList(record.invalidatedBy)}`,
    `- Created: ${formatTimestamp(record.createdAt)}`,
    `- Updated: ${formatTimestamp(record.updatedAt)}`,
    "",
  ];
  if (record.measuredEffect && Object.keys(record.measuredEffect).length > 0) {
    lines.push(
      "### Measured Effect",
      "",
      "```json",
      JSON.stringify(record.measuredEffect, null, 2),
      "```",
      "",
    );
  }
  lines.push(...renderMetadataBlock(record.metadata));
  return lines.join("\n");
}

function renderMetaLearningRecord(record: MetaLearningRecord): string {
  const lines = [
    `## ${record.summary}`,
    "",
    `- ID: \`${record.id}\``,
    `- Adopted as: ${record.adoptedAs ? `\`${record.adoptedAs}\`` : "(unset)"}`,
    `- Hypothesis: ${record.hypothesis ?? "(unset)"}`,
    `- Source tasks: ${formatList(record.sourceTaskIds)}`,
    `- Source reviews: ${formatList(record.sourceReviewIds)}`,
    `- Derived from: ${formatList(record.derivedFromMemoryIds)}`,
    `- Created: ${formatTimestamp(record.createdAt)}`,
    `- Updated: ${formatTimestamp(record.updatedAt)}`,
    "",
  ];
  lines.push(...renderMetadataBlock(record.metadata));
  return lines.join("\n");
}

function renderEvolutionMemoryRecord(record: EvolutionMemoryRecord): string {
  const lines = [
    `## ${record.summary}`,
    "",
    `- ID: \`${record.id}\``,
    `- Candidate type: \`${record.candidateType}\``,
    `- Target layer: \`${record.targetLayer}\``,
    `- Adoption state: \`${record.adoptionState}\``,
    `- Baseline ref: ${record.baselineRef ? `\`${record.baselineRef}\`` : "(unset)"}`,
    `- Candidate ref: ${record.candidateRef ? `\`${record.candidateRef}\`` : "(unset)"}`,
    `- Source tasks: ${formatList(record.sourceTaskIds)}`,
    `- Source reviews: ${formatList(record.sourceReviewIds)}`,
    `- Shadow telemetry: ${formatList(record.sourceShadowTelemetryIds)}`,
    `- Created: ${formatTimestamp(record.createdAt)}`,
    `- Updated: ${formatTimestamp(record.updatedAt)}`,
    "",
  ];
  lines.push(...renderMetadataBlock(record.metadata));
  return lines.join("\n");
}

function renderCollectionFile<T>(
  title: string,
  description: string,
  records: T[],
  renderRecord: (record: T) => string,
): string {
  const lines = [`# ${title}`, "", description, "", `Count: ${records.length}`, ""];
  if (records.length === 0) {
    lines.push("No records available.", "");
    return lines.join("\n");
  }
  for (const record of records) {
    lines.push(renderRecord(record), "---", "");
  }
  return lines.join("\n");
}

function buildReadme(store: RuntimeMemoryStore, rootPath: string, syncedAt: number): string {
  return [
    "# Runtime Memory Markdown Mirror",
    "",
    "Derived Markdown mirror of the authoritative Runtime formal-memory store.",
    "",
    `- Root path: \`${rootPath}\``,
    `- Last synced: ${formatTimestamp(syncedAt)}`,
    `- Formal memories: ${store.memories.length}`,
    `- Strategies: ${store.strategies.length}`,
    `- Meta-learning records: ${store.metaLearning.length}`,
    `- Evolution memory records: ${store.evolutionMemory.length}`,
    "",
    "Files:",
    "- `memories.md`: formal memory truth mirror",
    "- `strategies.md`: adopted strategy mirror",
    "- `meta-learning.md`: distilled learning mirror",
    "- `evolution-memory.md`: evolution candidate memory mirror",
    "",
  ].join("\n");
}

function buildMirrorFiles(
  store: RuntimeMemoryStore,
  rootPath: string,
  syncedAt: number,
): Array<{ name: (typeof MIRROR_FILES)[number]; content: string }> {
  return [
    {
      name: "README.md",
      content: buildReadme(store, rootPath, syncedAt),
    },
    {
      name: "memories.md",
      content: renderCollectionFile(
        "Formal Memories",
        "Authoritative formal memories mirrored from the Runtime Core truth store.",
        sortByUpdatedAt(store.memories),
        renderMemoryRecord,
      ),
    },
    {
      name: "strategies.md",
      content: renderCollectionFile(
        "Strategies",
        "Adopted strategy records mirrored from the Runtime Core truth store.",
        sortByUpdatedAt(store.strategies),
        renderStrategyRecord,
      ),
    },
    {
      name: "meta-learning.md",
      content: renderCollectionFile(
        "Meta Learning",
        "Runtime review/distill outputs mirrored from the authoritative store.",
        sortByUpdatedAt(store.metaLearning),
        renderMetaLearningRecord,
      ),
    },
    {
      name: "evolution-memory.md",
      content: renderCollectionFile(
        "Evolution Memory",
        "System-level evolution memory mirrored from the authoritative store.",
        sortByUpdatedAt(store.evolutionMemory),
        renderEvolutionMemoryRecord,
      ),
    },
  ];
}

export function buildRuntimeMemoryMarkdownMirrorStatus(
  opts: RuntimeStoreOptions = {},
): RuntimeMemoryMarkdownMirrorStatus {
  const store = loadRuntimeMemoryStore(opts);
  const rootPath = getMirrorRootPath(opts);
  const files = listExistingMirrorFiles(rootPath);
  const metadata = readMarkdownMirrorMetadata(store.metadata);
  return {
    rootPath,
    exists: files.length > 0,
    fileCount: files.length,
    lastSyncedAt: metadata.lastSyncedAt,
    memoryCount: store.memories.length,
    strategyCount: store.strategies.length,
    learningCount: store.metaLearning.length,
    evolutionCount: store.evolutionMemory.length,
  };
}

export function syncRuntimeMemoryMarkdownMirror(
  opts: RuntimeStoreOptions = {},
): RuntimeMemoryMarkdownMirrorSyncResult {
  const now = resolveNow(opts.now);
  const store = loadRuntimeMemoryStore({
    ...opts,
    now,
  });
  const rootPath = getMirrorRootPath(opts);
  fs.mkdirSync(rootPath, { recursive: true });
  const files = buildMirrorFiles(store, rootPath, now);
  for (const file of files) {
    fs.writeFileSync(path.join(rootPath, file.name), file.content, "utf8");
  }
  saveRuntimeMemoryStore(
    {
      ...store,
      metadata: mergeMarkdownMirrorMetadata(store.metadata, {
        lastSyncedAt: now,
        fileCount: files.length,
      }),
    },
    {
      ...opts,
      now,
    },
  );
  return {
    ...buildRuntimeMemoryMarkdownMirrorStatus({
      ...opts,
      now,
    }),
    syncedAt: now,
    files: files.map((file) => path.join(rootPath, file.name)),
  };
}
