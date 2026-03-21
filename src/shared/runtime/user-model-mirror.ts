import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  RuntimeMetadata,
  RuntimeUserModel,
  RuntimeUserModelPreferencePatch,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeUserConsoleStore,
  saveRuntimeUserConsoleStore,
  type RuntimeStoreOptions,
} from "./store.js";

const USER_MODEL_SUMMARY_START = "<!-- OPENCLAW_RUNTIME_USER_MODEL_SUMMARY_START -->";
const USER_MODEL_SUMMARY_END = "<!-- OPENCLAW_RUNTIME_USER_MODEL_SUMMARY_END -->";
const USER_MODEL_JSON_START = "<!-- OPENCLAW_RUNTIME_USER_MODEL_JSON_START -->";
const USER_MODEL_JSON_END = "<!-- OPENCLAW_RUNTIME_USER_MODEL_JSON_END -->";

type UserModelMirrorMetadata = {
  lastSyncedAt?: number;
  lastSyncedMtimeMs?: number;
  lastImportedAt?: number;
  lastImportedMtimeMs?: number;
};

export type RuntimeUserModelMirrorStatus = {
  path: string;
  exists: boolean;
  pendingImport: boolean;
  syncNeeded: boolean;
  lastModifiedAt?: number;
  lastSyncedAt?: number;
  lastImportedAt?: number;
};

export type RuntimeUserModelMirrorSyncResult = {
  path: string;
  syncedAt: number;
  lastModifiedAt?: number;
  skipped: boolean;
  reason?: "pending_external_edits";
  pendingImport: boolean;
};

export type RuntimeUserModelMirrorImportResult = {
  path: string;
  patch: RuntimeUserModelPreferencePatch & { displayName?: string };
  lastModifiedAt?: number;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readMirrorMetadata(metadata: RuntimeMetadata | undefined): UserModelMirrorMetadata {
  const record = metadata?.userModelMirror;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }
  const lastSyncedAt = Number((record as Record<string, unknown>).lastSyncedAt);
  const lastSyncedMtimeMs = Number((record as Record<string, unknown>).lastSyncedMtimeMs);
  const lastImportedAt = Number((record as Record<string, unknown>).lastImportedAt);
  const lastImportedMtimeMs = Number((record as Record<string, unknown>).lastImportedMtimeMs);
  return {
    lastSyncedAt:
      Number.isFinite(lastSyncedAt) && lastSyncedAt > 0 ? Math.trunc(lastSyncedAt) : undefined,
    lastSyncedMtimeMs:
      Number.isFinite(lastSyncedMtimeMs) && lastSyncedMtimeMs > 0
        ? Math.trunc(lastSyncedMtimeMs)
        : undefined,
    lastImportedAt:
      Number.isFinite(lastImportedAt) && lastImportedAt > 0
        ? Math.trunc(lastImportedAt)
        : undefined,
    lastImportedMtimeMs:
      Number.isFinite(lastImportedMtimeMs) && lastImportedMtimeMs > 0
        ? Math.trunc(lastImportedMtimeMs)
        : undefined,
  };
}

function mergeMirrorMetadata(
  metadata: RuntimeMetadata | undefined,
  patch: Partial<UserModelMirrorMetadata>,
): RuntimeMetadata {
  const current = readMirrorMetadata(metadata);
  return {
    ...metadata,
    userModelMirror: {
      ...current,
      ...patch,
    },
  };
}

function getMirrorFilePath(opts: RuntimeStoreOptions = {}): string {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  return resolver.resolveConfigPath("USER.md");
}

function readFileMtime(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    return Number.isFinite(stat.mtimeMs) ? Math.trunc(stat.mtimeMs) : undefined;
  } catch {
    return undefined;
  }
}

function buildEditableUserModelPayload(userModel: RuntimeUserModel) {
  return {
    displayName: userModel.displayName ?? undefined,
    communicationStyle: userModel.communicationStyle ?? undefined,
    interruptionThreshold: userModel.interruptionThreshold ?? undefined,
    reportVerbosity: userModel.reportVerbosity ?? undefined,
    confirmationBoundary: userModel.confirmationBoundary ?? undefined,
    reportPolicy: userModel.reportPolicy ?? undefined,
  };
}

function buildUserModelSummary(userModel: RuntimeUserModel): string {
  const lines = [
    "## Runtime User Model Summary",
    "",
    `- Display name: ${userModel.displayName ?? "(unset)"}`,
    `- Communication style: ${userModel.communicationStyle ?? "(unset)"}`,
    `- Interruption threshold: ${userModel.interruptionThreshold ?? "(unset)"}`,
    `- Report verbosity: ${userModel.reportVerbosity ?? "(unset)"}`,
    `- Confirmation boundary: ${userModel.confirmationBoundary ?? "(unset)"}`,
    `- Report policy: ${userModel.reportPolicy ?? "(unset)"}`,
  ];
  return lines.join("\n");
}

function buildUserModelJsonBlock(userModel: RuntimeUserModel): string {
  return [
    "## Editable Runtime User Model",
    "",
    "Edit only the JSON block below. Then import it from the Runtime UI to update the authoritative user model.",
    "",
    "```json",
    JSON.stringify(buildEditableUserModelPayload(userModel), null, 2),
    "```",
  ].join("\n");
}

function replaceManagedSection(
  content: string,
  startMarker: string,
  endMarker: string,
  sectionBody: string,
): string {
  const block = `${startMarker}\n${sectionBody}\n${endMarker}`;
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${content.slice(0, startIndex)}${block}${content.slice(endIndex + endMarker.length)}`;
  }
  const separator = content.trim().length > 0 ? "\n\n" : "";
  return `${content.trimEnd()}${separator}${block}\n`;
}

function buildInitialMirrorContent(userModel: RuntimeUserModel): string {
  return [
    "# USER.md",
    "",
    "This file is the human-editable mirror of the authoritative Runtime user model.",
    "Edit the managed JSON block and import it from the Runtime UI. Free-form notes outside the managed blocks are preserved locally but are not imported.",
    "",
    USER_MODEL_SUMMARY_START,
    buildUserModelSummary(userModel),
    USER_MODEL_SUMMARY_END,
    "",
    USER_MODEL_JSON_START,
    buildUserModelJsonBlock(userModel),
    USER_MODEL_JSON_END,
    "",
    "## Notes",
    "",
    "- Add human notes here if you want, but only the managed JSON block is imported into Runtime Core.",
    "",
  ].join("\n");
}

function renderMirrorContent(userModel: RuntimeUserModel, existingContent?: string): string {
  const base =
    existingContent && existingContent.trim().length > 0
      ? existingContent
      : buildInitialMirrorContent(userModel);
  const withSummary = replaceManagedSection(
    base,
    USER_MODEL_SUMMARY_START,
    USER_MODEL_SUMMARY_END,
    buildUserModelSummary(userModel),
  );
  return replaceManagedSection(
    withSummary,
    USER_MODEL_JSON_START,
    USER_MODEL_JSON_END,
    buildUserModelJsonBlock(userModel),
  );
}

function extractManagedJson(content: string): string {
  const startIndex = content.indexOf(USER_MODEL_JSON_START);
  const endIndex = content.indexOf(USER_MODEL_JSON_END);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error("USER.md does not contain a managed Runtime user model block");
  }
  const block = content.slice(startIndex + USER_MODEL_JSON_START.length, endIndex);
  const fenced = block.match(/```json\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    throw new Error("USER.md managed Runtime user model block is missing a JSON code fence");
  }
  return fenced[1].trim();
}

function parseImportedPatch(
  jsonText: string,
): RuntimeUserModelPreferencePatch & { displayName?: string } {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return {
    displayName: normalizeText(parsed.displayName) || undefined,
    communicationStyle: normalizeText(parsed.communicationStyle) || undefined,
    interruptionThreshold:
      parsed.interruptionThreshold === "low" ||
      parsed.interruptionThreshold === "medium" ||
      parsed.interruptionThreshold === "high"
        ? parsed.interruptionThreshold
        : undefined,
    reportVerbosity:
      parsed.reportVerbosity === "brief" ||
      parsed.reportVerbosity === "balanced" ||
      parsed.reportVerbosity === "detailed"
        ? parsed.reportVerbosity
        : undefined,
    confirmationBoundary:
      parsed.confirmationBoundary === "strict" ||
      parsed.confirmationBoundary === "balanced" ||
      parsed.confirmationBoundary === "light"
        ? parsed.confirmationBoundary
        : undefined,
    reportPolicy:
      parsed.reportPolicy === "silent" ||
      parsed.reportPolicy === "reply" ||
      parsed.reportPolicy === "proactive" ||
      parsed.reportPolicy === "reply_and_proactive"
        ? parsed.reportPolicy
        : undefined,
  };
}

export function buildRuntimeUserModelMirrorStatus(
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelMirrorStatus {
  const store = loadRuntimeUserConsoleStore(opts);
  const filePath = getMirrorFilePath(opts);
  const lastModifiedAt = readFileMtime(filePath);
  const exists = typeof lastModifiedAt === "number";
  const metadata = readMirrorMetadata(store.metadata);
  const baselineMtime = Math.max(
    metadata.lastSyncedMtimeMs ?? 0,
    metadata.lastImportedMtimeMs ?? 0,
  );
  const pendingImport = exists && (lastModifiedAt ?? 0) > baselineMtime;
  return {
    path: filePath,
    exists,
    pendingImport,
    syncNeeded: !exists || !metadata.lastSyncedAt || pendingImport,
    lastModifiedAt,
    lastSyncedAt: metadata.lastSyncedAt,
    lastImportedAt: metadata.lastImportedAt,
  };
}

export function syncRuntimeUserModelMirror(
  input: { force?: boolean } = {},
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelMirrorSyncResult {
  const now = resolveNow(opts.now);
  const store = loadRuntimeUserConsoleStore({
    ...opts,
    now,
  });
  const status = buildRuntimeUserModelMirrorStatus({
    ...opts,
    now,
  });
  if (status.pendingImport && input.force !== true) {
    return {
      path: status.path,
      syncedAt: now,
      lastModifiedAt: status.lastModifiedAt,
      skipped: true,
      reason: "pending_external_edits",
      pendingImport: true,
    };
  }
  const existingContent = fs.existsSync(status.path)
    ? fs.readFileSync(status.path, "utf8")
    : undefined;
  fs.mkdirSync(path.dirname(status.path), { recursive: true });
  fs.writeFileSync(status.path, renderMirrorContent(store.userModel, existingContent), "utf8");
  const mtimeMs = readFileMtime(status.path);
  saveRuntimeUserConsoleStore(
    {
      ...store,
      metadata: mergeMirrorMetadata(store.metadata, {
        lastSyncedAt: now,
        lastSyncedMtimeMs: mtimeMs,
      }),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_user_model_mirror_synced",
    {
      path: status.path,
      forced: input.force === true,
      skipped: false,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    path: status.path,
    syncedAt: now,
    lastModifiedAt: mtimeMs,
    skipped: false,
    pendingImport: false,
  };
}

export function readRuntimeUserModelMirrorImport(
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelMirrorImportResult {
  const filePath = getMirrorFilePath(opts);
  if (!fs.existsSync(filePath)) {
    throw new Error("USER.md mirror file does not exist");
  }
  const content = fs.readFileSync(filePath, "utf8");
  return {
    path: filePath,
    patch: parseImportedPatch(extractManagedJson(content)),
    lastModifiedAt: readFileMtime(filePath),
  };
}

export function markRuntimeUserModelMirrorImported(
  input: {
    lastModifiedAt?: number;
  },
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelMirrorStatus {
  const now = resolveNow(opts.now);
  const store = loadRuntimeUserConsoleStore({
    ...opts,
    now,
  });
  saveRuntimeUserConsoleStore(
    {
      ...store,
      metadata: mergeMirrorMetadata(store.metadata, {
        lastImportedAt: now,
        lastImportedMtimeMs: input.lastModifiedAt,
      }),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_user_model_mirror_imported",
    {
      path: getMirrorFilePath(opts),
      lastModifiedAt: input.lastModifiedAt,
    },
    {
      ...opts,
      now,
    },
  );
  return buildRuntimeUserModelMirrorStatus({
    ...opts,
    now,
  });
}
