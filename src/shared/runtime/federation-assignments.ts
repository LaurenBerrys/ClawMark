import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  FederationTaskAssignment,
  FederationTaskAssignmentState,
  RuntimeMetadata,
  TaskRecord,
} from "./contracts.js";
import { appendRuntimeEvent, loadRuntimeTaskStore } from "./store.js";
import type { RuntimeStoreOptions } from "./store.js";
import { upsertRuntimeTask } from "./task-engine.js";
import { listRuntimeResolvedSurfaceProfiles } from "./user-console.js";

export type FederationAssignmentAction = "materialize" | "block" | "reset" | "mark_applied";

export type ListedFederationAssignment = FederationTaskAssignment & {
  fileName: string;
  filePath: string;
  rawState?: string;
  invalid: boolean;
};

export type FederationAssignmentTransitionInput = {
  id: string;
  state: "pending" | "blocked" | "applied";
  reason?: string;
};

export type FederationAssignmentTransitionResult = {
  assignment: FederationTaskAssignment;
  changed: boolean;
};

export type FederationAssignmentMaterializeResult = {
  created: boolean;
  assignment: FederationTaskAssignment;
  task: TaskRecord;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function resolveTimestamp(values: unknown[], fallback?: number): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }
  }
  return fallback;
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveAssignmentsRoot(opts: RuntimeStoreOptions): string {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  return resolver.resolveDataPath("federation", "assignments");
}

function listAssignmentJsonFiles(assignmentsRoot: string): string[] {
  try {
    return fs
      .readdirSync(assignmentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(assignmentsRoot, entry.name))
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function readFileTimestamp(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return Number.isFinite(stat.mtimeMs) ? Math.trunc(stat.mtimeMs) : Date.now();
  } catch {
    return Date.now();
  }
}

function normalizeAssignmentState(value: unknown): FederationTaskAssignmentState | undefined {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "materialized" ||
    normalized === "blocked" ||
    normalized === "applied"
  ) {
    return normalized;
  }
  if (
    normalized === "received" ||
    normalized === "queued" ||
    normalized === "new" ||
    normalized === "recommended"
  ) {
    return "pending";
  }
  if (
    normalized === "rejected" ||
    normalized === "reverted" ||
    normalized === "denied" ||
    normalized === "cancelled" ||
    normalized === "expired"
  ) {
    return "blocked";
  }
  if (normalized === "done" || normalized === "completed" || normalized === "accepted") {
    return "applied";
  }
  return undefined;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeMetadata(parts: Array<Record<string, unknown> | null>): RuntimeMetadata | undefined {
  const merged: RuntimeMetadata = {};
  for (const part of parts) {
    if (!part) {
      continue;
    }
    for (const [key, value] of Object.entries(part)) {
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function normalizeRuntimeFederationAssignment(
  raw: unknown,
  params: { filePath?: string; now?: number } = {},
): ListedFederationAssignment {
  const fileName = params.filePath ? path.basename(params.filePath) : "assignment.json";
  const fileTimestamp = params.filePath ? readFileTimestamp(params.filePath) : resolveNow(params.now);
  const record = toRecord(raw);
  const payload = toRecord(record?.payload);
  const metadata = normalizeMetadata([
    toRecord(payload?.metadata),
    toRecord(record?.metadata),
  ]);
  const id =
    normalizeOptionalText(record?.id) ??
    normalizeOptionalText(payload?.id) ??
    fileName.replace(/\.json$/i, "");
  const sourceRuntimeId =
    normalizeOptionalText(record?.sourceRuntimeId) ??
    normalizeOptionalText(payload?.sourceRuntimeId) ??
    normalizeOptionalText(metadata?.sourceRuntimeId) ??
    "unknown-runtime";
  const sourcePackageId =
    normalizeOptionalText(record?.sourcePackageId) ??
    normalizeOptionalText(payload?.sourcePackageId) ??
    normalizeOptionalText(metadata?.sourcePackageId);
  const sourceTaskId =
    normalizeOptionalText(record?.sourceTaskId) ??
    normalizeOptionalText(record?.taskId) ??
    normalizeOptionalText(payload?.sourceTaskId) ??
    normalizeOptionalText(payload?.taskId) ??
    normalizeOptionalText(metadata?.sourceTaskId);
  const route =
    normalizeOptionalText(record?.route) ??
    normalizeOptionalText(payload?.route) ??
    normalizeOptionalText(metadata?.route);
  const worker =
    normalizeOptionalText(record?.worker) ??
    normalizeOptionalText(payload?.worker) ??
    normalizeOptionalText(metadata?.worker);
  const surfaceId =
    normalizeOptionalText(record?.surfaceId) ??
    normalizeOptionalText(payload?.surfaceId) ??
    normalizeOptionalText(metadata?.surfaceId);
  const agentId =
    normalizeOptionalText(record?.agentId) ??
    normalizeOptionalText(payload?.agentId) ??
    normalizeOptionalText(metadata?.agentId);
  const localTaskId =
    normalizeOptionalText(record?.localTaskId) ??
    normalizeOptionalText(payload?.localTaskId) ??
    normalizeOptionalText(metadata?.localTaskId);
  const blockedReason =
    normalizeOptionalText(record?.blockedReason) ??
    normalizeOptionalText(payload?.blockedReason) ??
    normalizeOptionalText(metadata?.blockedReason);
  const materializedAt = resolveTimestamp(
    [record?.materializedAt, payload?.materializedAt, metadata?.materializedAt],
    undefined,
  );
  const appliedAt = resolveTimestamp(
    [record?.appliedAt, payload?.appliedAt, metadata?.appliedAt],
    undefined,
  );
  const rawState =
    normalizeOptionalText(record?.state) ??
    normalizeOptionalText(record?.status) ??
    normalizeOptionalText(payload?.state) ??
    normalizeOptionalText(payload?.status) ??
    normalizeOptionalText(metadata?.state) ??
    normalizeOptionalText(metadata?.status);
  let state =
    normalizeAssignmentState(rawState) ??
    (localTaskId || materializedAt != null
      ? "materialized"
      : blockedReason || normalizeBoolean(record?.materializationBlocked)
        ? "blocked"
        : appliedAt != null
          ? "applied"
          : "pending");
  if (appliedAt != null) {
    state = "applied";
  }
  const generatedAt = resolveTimestamp(
    [record?.generatedAt, payload?.generatedAt, record?.receivedAt, payload?.receivedAt],
    fileTimestamp,
  )!;
  const receivedAt = resolveTimestamp(
    [record?.receivedAt, payload?.receivedAt, generatedAt],
    fileTimestamp,
  );
  const updatedAt = resolveTimestamp(
    [record?.updatedAt, payload?.updatedAt, appliedAt, materializedAt, receivedAt],
    fileTimestamp,
  )!;
  const title =
    normalizeOptionalText(record?.title) ??
    normalizeOptionalText(payload?.title) ??
    `Assignment ${id}`;
  const summary =
    normalizeOptionalText(record?.summary) ??
    normalizeOptionalText(payload?.summary) ??
    normalizeOptionalText(record?.description) ??
    normalizeOptionalText(payload?.description) ??
    (blockedReason ? `Blocked: ${blockedReason}` : "Pending federation assignment");
  return {
    schemaVersion: "v1",
    type: "federation-task-assignment",
    id,
    title,
    summary,
    sourceRuntimeId,
    generatedAt,
    sourcePackageId,
    sourceTaskId,
    route,
    worker,
    surfaceId,
    agentId,
    state,
    localTaskId,
    blockedReason,
    receivedAt,
    updatedAt,
    materializedAt,
    appliedAt,
    metadata,
    fileName,
    filePath: params.filePath ?? path.join(".", `${sanitizeFileStem(id)}.json`),
    rawState,
    invalid: false,
  };
}

function serializeAssignment(record: FederationTaskAssignment): string {
  return JSON.stringify(record, null, 2);
}

function resolveAssignmentFilePath(
  id: string,
  assignmentsRoot: string,
  existingPath?: string,
): string {
  if (existingPath) {
    return existingPath;
  }
  return path.join(assignmentsRoot, `${sanitizeFileStem(id)}.json`);
}

export function listRuntimeFederationAssignments(
  opts: RuntimeStoreOptions = {},
): ListedFederationAssignment[] {
  const assignmentsRoot = resolveAssignmentsRoot(opts);
  return listAssignmentJsonFiles(assignmentsRoot)
    .map((filePath) => {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return normalizeRuntimeFederationAssignment(raw, { filePath, now: opts.now });
      } catch (error) {
        const fileTimestamp = readFileTimestamp(filePath);
        return {
          schemaVersion: "v1",
          type: "federation-task-assignment",
          id: path.basename(filePath).replace(/\.json$/i, ""),
          title: `Unreadable assignment ${path.basename(filePath)}`,
          summary: error instanceof Error ? error.message : "Failed to parse assignment file",
          sourceRuntimeId: "unknown-runtime",
          generatedAt: fileTimestamp,
          state: "blocked",
          receivedAt: fileTimestamp,
          updatedAt: fileTimestamp,
          metadata: undefined,
          fileName: path.basename(filePath),
          filePath,
          rawState: "invalid",
          invalid: true,
        } satisfies ListedFederationAssignment;
      }
    })
    .toSorted(
      (left, right) =>
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.id.localeCompare(right.id),
    );
}

export function findRuntimeFederationAssignment(
  id: string,
  opts: RuntimeStoreOptions = {},
): ListedFederationAssignment | null {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return null;
  }
  return (
    listRuntimeFederationAssignments(opts).find((entry) => entry.id === normalizedId) ?? null
  );
}

export function persistRuntimeFederationAssignments(
  assignments: unknown[],
  opts: RuntimeStoreOptions = {},
): Array<{ id: string; filePath: string }> {
  const assignmentsRoot = resolveAssignmentsRoot(opts);
  ensureDir(assignmentsRoot);
  return assignments.map((entry) => {
    const normalized = normalizeRuntimeFederationAssignment(entry, { now: opts.now });
    const existing = findRuntimeFederationAssignment(normalized.id, opts);
    const filePath = resolveAssignmentFilePath(normalized.id, assignmentsRoot, existing?.filePath);
    const merged: FederationTaskAssignment = {
      ...normalized,
      receivedAt: normalized.receivedAt ?? resolveNow(opts.now),
      updatedAt: resolveNow(opts.now),
      state: normalized.state ?? existing?.state ?? "pending",
    };
    fs.writeFileSync(filePath, serializeAssignment(merged), "utf8");
    return {
      id: merged.id,
      filePath,
    };
  });
}

function readOptionalMetadataArray(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(value.map((entry) => (typeof entry === "string" ? entry : undefined)))
    : [];
}

function normalizePriority(value: unknown): "low" | "normal" | "high" {
  return value === "low" || value === "high" ? value : "normal";
}

function normalizeBudgetMode(value: unknown): "strict" | "balanced" | "deep" | undefined {
  return value === "strict" || value === "balanced" || value === "deep" ? value : undefined;
}

function normalizeRetrievalMode(value: unknown): "off" | "light" | "deep" | undefined {
  return value === "off" || value === "light" || value === "deep" ? value : undefined;
}

function normalizeReportPolicy(
  value: unknown,
): "silent" | "reply" | "proactive" | "reply_and_proactive" | undefined {
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function writeAssignmentRecord(
  record: FederationTaskAssignment,
  opts: RuntimeStoreOptions,
  existingPath?: string,
): FederationTaskAssignment {
  const assignmentsRoot = resolveAssignmentsRoot(opts);
  ensureDir(assignmentsRoot);
  const filePath = resolveAssignmentFilePath(record.id, assignmentsRoot, existingPath);
  fs.writeFileSync(filePath, serializeAssignment(record), "utf8");
  return record;
}

export function transitionRuntimeFederationAssignment(
  input: FederationAssignmentTransitionInput,
  opts: RuntimeStoreOptions = {},
): FederationAssignmentTransitionResult {
  const now = resolveNow(opts.now);
  const assignment = findRuntimeFederationAssignment(input.id, opts);
  if (!assignment || assignment.invalid) {
    throw new Error(`federation assignment ${input.id} was not found`);
  }
  if (input.state === "pending" && assignment.localTaskId) {
    throw new Error(`federation assignment ${assignment.id} is already materialized locally`);
  }
  const next: FederationTaskAssignment = {
    ...assignment,
    state: input.state,
    blockedReason:
      input.state === "blocked"
        ? normalizeOptionalText(input.reason) ?? assignment.blockedReason ?? "Blocked locally"
        : undefined,
    appliedAt: input.state === "applied" ? now : undefined,
    updatedAt: now,
  };
  if (input.state === "pending") {
    delete next.appliedAt;
    delete next.blockedReason;
  }
  writeAssignmentRecord(next, opts, assignment.filePath);
  appendRuntimeEvent(
    "runtime_federation_assignment_transitioned",
    {
      assignmentId: next.id,
      state: next.state,
      reason: normalizeOptionalText(input.reason),
      localTaskId: next.localTaskId,
      sourceRuntimeId: next.sourceRuntimeId,
      sourcePackageId: next.sourcePackageId,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    assignment: next,
    changed: next.state !== assignment.state || next.blockedReason !== assignment.blockedReason,
  };
}

export function materializeRuntimeFederationAssignmentTask(
  id: string,
  opts: RuntimeStoreOptions = {},
): FederationAssignmentMaterializeResult {
  const now = resolveNow(opts.now);
  const assignment = findRuntimeFederationAssignment(id, {
    ...opts,
    now,
  });
  if (!assignment || assignment.invalid) {
    throw new Error(`federation assignment ${id} was not found`);
  }
  if (assignment.localTaskId) {
    const taskStore = loadRuntimeTaskStore({
      env: opts.env,
      homedir: opts.homedir,
      now,
    });
    const existingTask = taskStore.tasks.find((entry) => entry.id === assignment.localTaskId);
    if (!existingTask) {
      throw new Error(
        `federation assignment ${assignment.id} references missing local task ${assignment.localTaskId}`,
      );
    }
    return {
      created: false,
      assignment,
      task: existingTask,
    };
  }
  const surfaceProfile = assignment.surfaceId
    ? listRuntimeResolvedSurfaceProfiles({
        env: opts.env,
        homedir: opts.homedir,
        now,
      }).find((entry) => entry.surface.id === assignment.surfaceId)
    : undefined;
  if (assignment.surfaceId && !surfaceProfile) {
    throw new Error(`surface ${assignment.surfaceId} was not found`);
  }
  if (surfaceProfile?.effectiveLocalBusinessPolicy?.taskCreation === "disabled") {
    throw new Error(
      `surface ${surfaceProfile.surface.label} blocks local task creation for federation assignments`,
    );
  }
  const metadata = toRecord(assignment.metadata);
  const createdTask = upsertRuntimeTask(
    {
      title: assignment.title,
      goal: assignment.summary,
      route: assignment.route ?? "federation",
      worker: assignment.worker,
      agentId: assignment.agentId,
      surfaceId: assignment.surfaceId,
      priority: normalizePriority(metadata?.priority),
      budgetMode: normalizeBudgetMode(metadata?.budgetMode),
      retrievalMode: normalizeRetrievalMode(metadata?.retrievalMode),
      reportPolicy: normalizeReportPolicy(metadata?.reportPolicy),
      skillIds: readOptionalMetadataArray(metadata?.skillIds),
      tags: uniqueStrings([
        "federation",
        "assignment",
        assignment.route ? `route:${assignment.route}` : undefined,
        assignment.surfaceId ? `surface:${assignment.surfaceId}` : undefined,
        assignment.agentId ? `agent:${assignment.agentId}` : undefined,
        ...readOptionalMetadataArray(metadata?.tags),
      ]),
      artifactRefs: uniqueStrings([
        assignment.sourcePackageId ? `federation-package:${assignment.sourcePackageId}` : undefined,
        `federation-assignment:${assignment.id}`,
        assignment.sourceTaskId ? `federation-source-task:${assignment.sourceTaskId}` : undefined,
      ]),
      metadata: {
        federation: {
          sourceRuntimeId: assignment.sourceRuntimeId,
          sourcePackageId: assignment.sourcePackageId,
          assignmentId: assignment.id,
          sourceTaskId: assignment.sourceTaskId,
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      ...opts,
      now,
    },
  );
  const next: FederationTaskAssignment = {
    ...assignment,
    localTaskId: createdTask.task.id,
    materializedAt: now,
    updatedAt: now,
    state: "materialized",
    blockedReason: undefined,
    metadata: {
      ...assignment.metadata,
      localTaskId: createdTask.task.id,
      materializedAt: now,
    },
  };
  writeAssignmentRecord(next, opts, assignment.filePath);
  appendRuntimeEvent(
    "runtime_federation_assignment_materialized",
    {
      assignmentId: next.id,
      sourceRuntimeId: next.sourceRuntimeId,
      sourcePackageId: next.sourcePackageId,
      sourceTaskId: next.sourceTaskId,
      localTaskId: createdTask.task.id,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    created: createdTask.created,
    assignment: next,
    task: createdTask.task,
  };
}
