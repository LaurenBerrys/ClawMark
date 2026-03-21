import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  CoordinatorSuggestionRecord,
  FederationInboundPackage,
  FederationInboxRecord,
  InvalidFederationPackageEnvelope,
  FederationPackageReview,
  FederationPackageState,
  RoleOptimizationCandidate,
  RuntimeMetadata,
  TaskRecord,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";
import {
  hasExplicitSurfaceLocalBusinessPolicy,
  normalizeSurfaceReportTarget,
  sanitizeSurfaceLocalBusinessPolicy,
} from "./surface-policy.js";
import { upsertRuntimeTask } from "./task-engine.js";
import { listRuntimeResolvedSurfaceProfiles } from "./user-console.js";

export {
  configureRuntimeFederationInboxMaintenance,
  reviewRuntimeFederationInboxMaintenance,
  type ConfigureFederationInboxMaintenanceResult,
  type FederationInboxMaintenanceResult,
} from "./federation-maintenance.js";
export {
  configureRuntimeFederationPushPolicy,
  type ConfigureFederationPushPolicyResult,
} from "./federation-policy.js";

const ALLOWED_PACKAGE_TYPES = new Set<FederationInboundPackage["type"]>([
  "coordinator-suggestion",
  "shared-strategy-package",
  "team-knowledge-package",
  "role-optimization-package",
  "runtime-policy-overlay-package",
]);

const ALLOWED_FEDERATION_POLICY_OVERLAY_FIELDS = new Set([
  "governanceEntries",
  "skillStates",
  "agentStates",
  "mcpStates",
  "blockedSkills",
  "blockedAgents",
  "blockedMcps",
  "mcpGrants",
]);

const ALLOWED_TRANSITIONS: Record<FederationPackageState, FederationPackageState[]> = {
  received: ["validated", "rejected", "expired"],
  validated: ["shadowed", "rejected", "expired"],
  shadowed: ["recommended", "rejected", "expired"],
  recommended: ["adopted", "rejected", "expired"],
  adopted: ["reverted"],
  rejected: [],
  expired: [],
  reverted: [],
};

export type FederationInboxSyncResult = {
  generatedAt: number;
  inboxRoot: string;
  processed: number;
  received: number;
  updated: number;
  invalid: number;
  syncCursorUpdated: boolean;
};

export type FederationPackageTransitionInput = {
  id: string;
  state: FederationPackageState;
  reason?: string;
};

export type CoordinatorSuggestionMaterializeResult = {
  created: boolean;
  suggestion: CoordinatorSuggestionRecord;
  task: TaskRecord;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function listJsonFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const output: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        output.push(nextPath);
      }
    }
  }
  return output.toSorted((left, right) => left.localeCompare(right));
}

function isFederationInboundPackage(value: unknown): value is FederationInboundPackage {
  return validateFederationInboundPackageShape(value).length === 0;
}

function validateFederationInboundPackageShape(value: unknown): string[] {
  const record = toRecord(value);
  if (!record) {
    return ["package must be a JSON object"];
  }
  const errors: string[] = [];
  if (record.schemaVersion !== "v1") {
    errors.push("schemaVersion must be v1");
  }
  if (typeof record.type !== "string" || record.type.trim().length === 0) {
    errors.push("type must be a non-empty string");
  } else if (!ALLOWED_PACKAGE_TYPES.has(record.type as FederationInboundPackage["type"])) {
    errors.push(`type ${record.type} is not supported`);
  }
  if (typeof record.sourceRuntimeId !== "string" || record.sourceRuntimeId.trim().length === 0) {
    errors.push("sourceRuntimeId must be a non-empty string");
  }
  if (typeof record.generatedAt !== "number" || !Number.isFinite(record.generatedAt)) {
    errors.push("generatedAt must be a number");
  }
  if (!toRecord(record.payload)) {
    errors.push("payload must be an object");
  }
  if (record.metadata != null && !toRecord(record.metadata)) {
    errors.push("metadata must be an object when present");
  }
  return errors;
}

function resolveInvalidFederationPackageId(inboxRoot: string, filePath: string): string {
  const relativePath = path.relative(inboxRoot, filePath) || path.basename(filePath);
  return sanitizeId(`invalid-package-${relativePath.replaceAll(path.sep, "-")}`);
}

function buildRawPreview(rawText: string | undefined, parsed: unknown): string | undefined {
  const sourceText =
    typeof rawText === "string" && rawText.trim().length > 0
      ? rawText
      : (() => {
          try {
            return JSON.stringify(parsed);
          } catch {
            return "";
          }
        })();
  const normalized = sourceText.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function buildInvalidFederationPackageSummary(
  declaredType: string | undefined,
  sourceRuntimeId: string,
): string {
  if (declaredType) {
    return `Invalid ${declaredType} package from ${sourceRuntimeId}`;
  }
  return `Invalid federation package from ${sourceRuntimeId}`;
}

function buildInvalidFederationPackageRecord(params: {
  inboxRoot: string;
  filePath: string;
  rawText?: string;
  parsed: unknown;
  now: number;
  sourceError?: string;
  validationErrors: string[];
  existing?: FederationInboxRecord;
}): FederationInboxRecord {
  const parsedRecord = toRecord(params.parsed);
  const declaredType =
    typeof parsedRecord?.type === "string" && parsedRecord.type.trim().length > 0
      ? parsedRecord.type.trim()
      : undefined;
  const sourceRuntimeId =
    typeof parsedRecord?.sourceRuntimeId === "string" &&
    parsedRecord.sourceRuntimeId.trim().length > 0
      ? parsedRecord.sourceRuntimeId.trim()
      : "unknown-runtime";
  const generatedAt =
    typeof parsedRecord?.generatedAt === "number" && Number.isFinite(parsedRecord.generatedAt)
      ? Number(parsedRecord.generatedAt)
      : params.now;
  const payload: InvalidFederationPackageEnvelope = {
    schemaVersion: "v1",
    type: "invalid-package",
    sourceRuntimeId,
    generatedAt,
    payload: {
      declaredType,
      sourceError: params.sourceError,
      fileName: path.basename(params.filePath),
      rawPreview: buildRawPreview(params.rawText, params.parsed),
    },
    metadata: toRecord(parsedRecord?.metadata) ?? undefined,
  };
  return params.existing
    ? {
        ...params.existing,
        packageType: "invalid-package",
        sourceRuntimeId,
        sourcePath: params.filePath,
        summary: buildInvalidFederationPackageSummary(declaredType, sourceRuntimeId),
        validationErrors: [...params.validationErrors],
        payload,
        review: undefined,
        updatedAt: params.now,
      }
    : {
        id: resolveInvalidFederationPackageId(params.inboxRoot, params.filePath),
        packageType: "invalid-package",
        sourceRuntimeId,
        state: "received",
        summary: buildInvalidFederationPackageSummary(declaredType, sourceRuntimeId),
        sourcePath: params.filePath,
        validationErrors: [...params.validationErrors],
        receivedAt: params.now,
        updatedAt: params.now,
        payload,
        review: undefined,
        metadata: undefined,
      };
}

function validateFederationPackage(pkg: FederationInboundPackage): string[] {
  switch (pkg.type) {
    case "coordinator-suggestion":
      return [
        typeof pkg.payload.id === "string" && pkg.payload.id.trim().length > 0
          ? null
          : "payload.id is required",
        typeof pkg.payload.title === "string" && pkg.payload.title.trim().length > 0
          ? null
          : "payload.title is required",
        typeof pkg.payload.summary === "string" && pkg.payload.summary.trim().length > 0
          ? null
          : "payload.summary is required",
      ].filter((value): value is string => value != null);
    case "shared-strategy-package":
      return Array.isArray(pkg.payload.strategies) ? [] : ["payload.strategies must be an array"];
    case "team-knowledge-package":
      if (!Array.isArray(pkg.payload.records)) {
        return ["payload.records must be an array"];
      }
      return pkg.payload.records.flatMap((record, index) =>
        validateTeamKnowledgeRecord(record, index),
      );
    case "role-optimization-package":
      return [
        typeof pkg.payload.summary === "string" && pkg.payload.summary.trim().length > 0
          ? null
          : "payload.summary is required",
        toRecord(pkg.payload.proposedOverlay) ? null : "payload.proposedOverlay must be an object",
      ].filter((value): value is string => value != null);
    case "runtime-policy-overlay-package":
      return [
        pkg.payload.route == null || typeof pkg.payload.route === "string"
          ? null
          : "payload.route must be a string when present",
        ...validateRuntimePolicyOverlayPolicy(pkg.payload.policy),
      ].filter((value): value is string => value != null);
  }
}

function summarizeFederationPackage(pkg: FederationInboundPackage): string {
  switch (pkg.type) {
    case "coordinator-suggestion":
      return pkg.payload.summary;
    case "shared-strategy-package":
      return `${pkg.payload.strategies.length} shared strategies`;
    case "team-knowledge-package":
      return `${pkg.payload.records.length} team knowledge records`;
    case "role-optimization-package":
      return pkg.payload.summary;
    case "runtime-policy-overlay-package":
      return `${pkg.payload.route ?? "global"} runtime policy overlay`;
  }
}

function resolveFederationPackageId(pkg: FederationInboundPackage): string {
  if (pkg.type === "coordinator-suggestion" && pkg.payload.id.trim().length > 0) {
    return sanitizeId(pkg.payload.id);
  }
  return sanitizeId(`${pkg.type}-${pkg.sourceRuntimeId}-${pkg.generatedAt}`);
}

function setStateTimestamp(
  record: FederationInboxRecord,
  state: FederationPackageState,
  now: number,
): FederationInboxRecord {
  if (state === "validated") {
    return { ...record, validatedAt: now, updatedAt: now };
  }
  if (state === "shadowed") {
    return { ...record, shadowedAt: now, updatedAt: now };
  }
  if (state === "recommended") {
    return { ...record, recommendedAt: now, updatedAt: now };
  }
  if (state === "adopted") {
    return { ...record, adoptedAt: now, updatedAt: now };
  }
  if (state === "rejected") {
    return { ...record, rejectedAt: now, updatedAt: now };
  }
  if (state === "expired") {
    return { ...record, expiredAt: now, updatedAt: now };
  }
  if (state === "reverted") {
    return { ...record, revertedAt: now, updatedAt: now };
  }
  return { ...record, updatedAt: now };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
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

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalInitiative(
  value: unknown,
): RoleOptimizationCandidate["proposedOverlay"]["initiative"] {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeTaskPriority(value: unknown): "low" | "normal" | "high" | undefined {
  return value === "low" || value === "normal" || value === "high" ? value : undefined;
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

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function validateTeamKnowledgeRecord(record: unknown, index: number): string[] {
  const entry = toRecord(record);
  if (!entry) {
    return [`payload.records[${index}] must be an object`];
  }
  const errors: string[] = [];
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    errors.push(`payload.records[${index}].id is required`);
  }
  if (entry.namespace !== "team-shareable") {
    errors.push(`payload.records[${index}].namespace must be team-shareable`);
  }
  if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
    errors.push(`payload.records[${index}].title is required`);
  }
  if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
    errors.push(`payload.records[${index}].summary is required`);
  }
  if (!Array.isArray(entry.tags)) {
    errors.push(`payload.records[${index}].tags must be an array`);
  } else if (entry.tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)) {
    errors.push(`payload.records[${index}].tags must contain only non-empty strings`);
  }
  if (typeof entry.createdAt !== "number" || !Number.isFinite(entry.createdAt)) {
    errors.push(`payload.records[${index}].createdAt must be a number`);
  }
  if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) {
    errors.push(`payload.records[${index}].updatedAt must be a number`);
  }
  if (entry.sourceRuntimeId != null && typeof entry.sourceRuntimeId !== "string") {
    errors.push(`payload.records[${index}].sourceRuntimeId must be a string when present`);
  }
  if (entry.metadata != null && !toRecord(entry.metadata)) {
    errors.push(`payload.records[${index}].metadata must be an object when present`);
  }
  return errors;
}

function normalizeGovernanceState(
  value: unknown,
): "blocked" | "shadow" | "candidate" | "adopted" | "core" | undefined {
  return value === "blocked" ||
    value === "shadow" ||
    value === "candidate" ||
    value === "adopted" ||
    value === "core"
    ? value
    : undefined;
}

function normalizeMcpGrantState(value: unknown): "allowed" | "denied" | undefined {
  return value === "allowed" || value === "denied" ? value : undefined;
}

function validateGovernanceStateMap(
  value: unknown,
  field: "skillStates" | "agentStates" | "mcpStates",
): string[] {
  if (value == null) {
    return [];
  }
  const record = toRecord(value);
  if (!record) {
    return [`payload.policy.${field} must be an object when present`];
  }
  const errors: string[] = [];
  for (const [targetId, state] of Object.entries(record)) {
    if (!normalizeText(targetId)) {
      errors.push(`payload.policy.${field} contains an empty target id`);
      continue;
    }
    if (!normalizeGovernanceState(state)) {
      errors.push(`payload.policy.${field}.${targetId} has an invalid governance state`);
    }
  }
  return errors;
}

function validateGovernanceBlockedList(
  value: unknown,
  field: "blockedSkills" | "blockedAgents" | "blockedMcps",
): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`payload.policy.${field} must be an array when present`];
  }
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push(`payload.policy.${field}[${index}] must be a non-empty string`);
    }
  }
  return errors;
}

function validateGovernanceOverlayEntries(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return ["payload.policy.governanceEntries must be an array when present"];
  }
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    const record = toRecord(entry);
    if (!record) {
      errors.push(`payload.policy.governanceEntries[${index}] must be an object`);
      continue;
    }
    const targetId = normalizeText(record.targetId ?? record.id ?? record.name);
    if (!targetId) {
      errors.push(`payload.policy.governanceEntries[${index}] must include targetId, id, or name`);
    }
    if (
      record.registryType != null &&
      record.registryType !== "skill" &&
      record.registryType !== "agent" &&
      record.registryType !== "mcp"
    ) {
      errors.push(
        `payload.policy.governanceEntries[${index}].registryType must be skill, agent, or mcp`,
      );
    }
    if (!normalizeGovernanceState(record.state)) {
      errors.push(
        `payload.policy.governanceEntries[${index}].state must be a valid governance state`,
      );
    }
    if (record.summary != null && typeof record.summary !== "string") {
      errors.push(`payload.policy.governanceEntries[${index}].summary must be a string`);
    }
    if (record.metadata != null && !toRecord(record.metadata)) {
      errors.push(`payload.policy.governanceEntries[${index}].metadata must be an object`);
    }
  }
  return errors;
}

function validateMcpGrantEntries(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return ["payload.policy.mcpGrants must be an array when present"];
  }
  const errors: string[] = [];
  for (const [index, entry] of value.entries()) {
    const record = toRecord(entry);
    if (!record) {
      errors.push(`payload.policy.mcpGrants[${index}] must be an object`);
      continue;
    }
    if (!normalizeText(record.agentId)) {
      errors.push(`payload.policy.mcpGrants[${index}].agentId is required`);
    }
    if (!normalizeText(record.mcpServerId)) {
      errors.push(`payload.policy.mcpGrants[${index}].mcpServerId is required`);
    }
    if (!normalizeMcpGrantState(record.state)) {
      errors.push(`payload.policy.mcpGrants[${index}].state must be allowed or denied`);
    }
    if (record.summary != null && typeof record.summary !== "string") {
      errors.push(`payload.policy.mcpGrants[${index}].summary must be a string`);
    }
    if (record.metadata != null && !toRecord(record.metadata)) {
      errors.push(`payload.policy.mcpGrants[${index}].metadata must be an object`);
    }
  }
  return errors;
}

function validateRuntimePolicyOverlayPolicy(value: unknown): string[] {
  const policy = toRecord(value);
  if (!policy) {
    return ["payload.policy must be an object"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(policy)) {
    if (!ALLOWED_FEDERATION_POLICY_OVERLAY_FIELDS.has(key)) {
      errors.push(`payload.policy.${key} is not allowed in federation runtime overlays`);
    }
  }
  errors.push(...validateGovernanceOverlayEntries(policy.governanceEntries));
  errors.push(...validateGovernanceStateMap(policy.skillStates, "skillStates"));
  errors.push(...validateGovernanceStateMap(policy.agentStates, "agentStates"));
  errors.push(...validateGovernanceStateMap(policy.mcpStates, "mcpStates"));
  errors.push(...validateGovernanceBlockedList(policy.blockedSkills, "blockedSkills"));
  errors.push(...validateGovernanceBlockedList(policy.blockedAgents, "blockedAgents"));
  errors.push(...validateGovernanceBlockedList(policy.blockedMcps, "blockedMcps"));
  errors.push(...validateMcpGrantEntries(policy.mcpGrants));
  return errors;
}

function sanitizeRuntimePolicyOverlayPolicy(value: unknown): Record<string, unknown> {
  const policy = toRecord(value) ?? {};
  const normalized: Record<string, unknown> = {};
  type OverlayGovernanceEntry = {
    registryType: "skill" | "agent" | "mcp";
    targetId: string;
    state: "blocked" | "shadow" | "candidate" | "adopted" | "core";
    summary: string | undefined;
    metadata: RuntimeMetadata | undefined;
  };
  type OverlayMcpGrant = {
    agentId: string;
    mcpServerId: string;
    state: "allowed" | "denied";
    summary: string | undefined;
    metadata: RuntimeMetadata | undefined;
  };

  if (Array.isArray(policy.governanceEntries)) {
    const governanceEntries = policy.governanceEntries
      .map((entry) => {
        const record = toRecord(entry);
        if (!record) {
          return null;
        }
        const targetId = normalizeText(record.targetId ?? record.id ?? record.name);
        const state = normalizeGovernanceState(record.state);
        if (!targetId || !state) {
          return null;
        }
        return {
          registryType:
            record.registryType === "agent" || record.registryType === "mcp"
              ? record.registryType
              : "skill",
          targetId,
          state,
          summary: normalizeOptionalString(record.summary),
          metadata: toRecord(record.metadata) ?? undefined,
        };
      })
      .filter((entry): entry is OverlayGovernanceEntry => entry != null);
    if (governanceEntries.length > 0) {
      normalized.governanceEntries = governanceEntries;
    }
  }

  const stateFields = ["skillStates", "agentStates", "mcpStates"] as const satisfies ReadonlyArray<
    "skillStates" | "agentStates" | "mcpStates"
  >;
  for (const field of stateFields) {
    const map = toRecord(policy[field]);
    if (!map) {
      continue;
    }
    const nextEntries = Object.fromEntries(
      Object.entries(map)
        .map(([targetId, state]) => {
          const normalizedTargetId = normalizeText(targetId);
          const normalizedState = normalizeGovernanceState(state);
          if (!normalizedTargetId || !normalizedState) {
            return null;
          }
          return [normalizedTargetId, normalizedState];
        })
        .filter((entry): entry is [string, string] => entry != null),
    );
    if (Object.keys(nextEntries).length > 0) {
      normalized[field] = nextEntries;
    }
  }

  const blockedFields = [
    "blockedSkills",
    "blockedAgents",
    "blockedMcps",
  ] as const satisfies ReadonlyArray<"blockedSkills" | "blockedAgents" | "blockedMcps">;
  for (const field of blockedFields) {
    const values = normalizeStringArray(policy[field]);
    if (values?.length) {
      normalized[field] = uniqueStrings(values);
    }
  }

  if (Array.isArray(policy.mcpGrants)) {
    const grants = policy.mcpGrants
      .map((entry) => {
        const record = toRecord(entry);
        if (!record) {
          return null;
        }
        const agentId = normalizeText(record.agentId);
        const mcpServerId = normalizeText(record.mcpServerId);
        const state = normalizeMcpGrantState(record.state);
        if (!agentId || !mcpServerId || !state) {
          return null;
        }
        return {
          agentId,
          mcpServerId,
          state,
          summary: normalizeOptionalString(record.summary),
          metadata: toRecord(record.metadata) ?? undefined,
        };
      })
      .filter((entry): entry is OverlayMcpGrant => entry != null);
    if (grants.length > 0) {
      normalized.mcpGrants = grants;
    }
  }

  return normalized;
}

function elevateRiskLevel(
  current: FederationPackageReview["riskLevel"],
  next: FederationPackageReview["riskLevel"],
): FederationPackageReview["riskLevel"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[next] > rank[current] ? next : current;
}

function buildRuntimePolicyOverlayReview(
  pkg: Extract<FederationInboundPackage, { type: "runtime-policy-overlay-package" }>,
): FederationPackageReview {
  const policy = sanitizeRuntimePolicyOverlayPolicy(pkg.payload.policy);
  const routeScope: FederationPackageReview["routeScope"] = normalizeText(pkg.payload.route)
    ? "route"
    : "global";
  const signals: string[] = [];
  let riskLevel: FederationPackageReview["riskLevel"] = "low";

  const governanceStates = new Set<string>();
  const governanceEntries = Array.isArray(policy.governanceEntries) ? policy.governanceEntries : [];
  for (const entry of governanceEntries) {
    const record = toRecord(entry);
    const state = normalizeGovernanceState(record?.state);
    if (state) {
      governanceStates.add(state);
    }
  }
  for (const field of ["skillStates", "agentStates", "mcpStates"] as const) {
    const stateMap = toRecord(policy[field]);
    if (!stateMap) {
      continue;
    }
    for (const state of Object.values(stateMap)) {
      const normalizedState = normalizeGovernanceState(state);
      if (normalizedState) {
        governanceStates.add(normalizedState);
      }
    }
  }

  const mcpGrantStates = new Set<string>();
  const mcpGrants = Array.isArray(policy.mcpGrants) ? policy.mcpGrants : [];
  for (const entry of mcpGrants) {
    const record = toRecord(entry);
    const state = normalizeMcpGrantState(record?.state);
    if (state) {
      mcpGrantStates.add(state);
    }
  }

  const changedTargetCount =
    governanceEntries.length +
    mcpGrants.length +
    (Array.isArray(policy.blockedSkills) ? policy.blockedSkills.length : 0) +
    (Array.isArray(policy.blockedAgents) ? policy.blockedAgents.length : 0) +
    (Array.isArray(policy.blockedMcps) ? policy.blockedMcps.length : 0) +
    Object.keys(toRecord(policy.skillStates) ?? {}).length +
    Object.keys(toRecord(policy.agentStates) ?? {}).length +
    Object.keys(toRecord(policy.mcpStates) ?? {}).length;

  if (routeScope === "global") {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Global overlay affects every route instead of a single runtime path.");
  } else {
    signals.push("Route-scoped overlay stays limited to a named runtime route.");
  }

  if (governanceStates.has("core")) {
    riskLevel = elevateRiskLevel(riskLevel, "high");
    signals.push("Overlay promotes governance targets to core state.");
  } else if (governanceStates.has("adopted") || governanceStates.has("candidate")) {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Overlay promotes governance targets beyond shadow/blocked states.");
  }

  if (mcpGrantStates.has("allowed")) {
    riskLevel = elevateRiskLevel(riskLevel, "high");
    signals.push("Overlay expands MCP access by granting allowed capability routes.");
  } else if (mcpGrantStates.has("denied")) {
    signals.push("Overlay only restricts MCP access with denied grants.");
  }

  if (changedTargetCount >= 6) {
    riskLevel = elevateRiskLevel(riskLevel, routeScope === "global" ? "high" : "medium");
    signals.push("Overlay changes multiple governance targets in a single package.");
  }

  if (signals.length === 0) {
    signals.push("Overlay remains within the allowed governance field subset.");
  }

  const autoAdoptEligible = riskLevel === "low";
  return {
    riskLevel,
    autoAdoptEligible,
    requiresReasonOnAdopt: !autoAdoptEligible,
    routeScope,
    summary:
      riskLevel === "low"
        ? "Low-risk restrictive overlay; eligible for future auto-adopt."
        : riskLevel === "medium"
          ? "Manual local review is recommended before adoption."
          : "Manual local approval is required before adoption.",
    signals: uniqueStrings(signals),
  };
}

function buildFederationPackageReview(
  pkg: FederationInboundPackage,
): FederationPackageReview | undefined {
  if (pkg.type === "runtime-policy-overlay-package") {
    return buildRuntimePolicyOverlayReview(pkg);
  }
  return undefined;
}

function normalizeRoleOptimizationOverlay(
  value: unknown,
  ownerKind: RoleOptimizationCandidate["ownerKind"],
): RoleOptimizationCandidate["proposedOverlay"] {
  const proposed = toRecord(value) ?? {};
  const normalized: RoleOptimizationCandidate["proposedOverlay"] = {};
  const role = normalizeOptionalString(proposed.role);
  const businessGoal = normalizeOptionalString(proposed.businessGoal);
  const tone = normalizeOptionalString(proposed.tone);
  const initiative = normalizeOptionalInitiative(proposed.initiative);
  const allowedTopics = normalizeStringArray(proposed.allowedTopics);
  const restrictedTopics = normalizeStringArray(proposed.restrictedTopics);
  const reportTarget = normalizeSurfaceReportTarget(proposed.reportTarget);

  if (role) {
    normalized.role = role;
  }
  if (businessGoal) {
    normalized.businessGoal = businessGoal;
  }
  if (tone) {
    normalized.tone = tone;
  }
  if (initiative) {
    normalized.initiative = initiative;
  }
  if (allowedTopics) {
    normalized.allowedTopics = allowedTopics;
  }
  if (restrictedTopics) {
    normalized.restrictedTopics = restrictedTopics;
  }
  if (reportTarget) {
    normalized.reportTarget = reportTarget;
  }
  if (hasExplicitSurfaceLocalBusinessPolicy(proposed.localBusinessPolicy)) {
    normalized.localBusinessPolicy = sanitizeSurfaceLocalBusinessPolicy(
      proposed.localBusinessPolicy,
      {
        ownerKind,
        role: role ?? "",
      },
    );
  }
  return normalized;
}

function buildFederationRoleOptimizationCandidateId(record: FederationInboxRecord): string {
  return `federation-role-opt-${sanitizeId(record.id)}`;
}

function buildFederationRoleOptimizationReasoning(record: FederationInboxRecord): string[] {
  const metadata = toRecord(record.payload.metadata);
  const candidateReasoning = Array.isArray(metadata?.reasoning)
    ? metadata.reasoning.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  if (candidateReasoning.length > 0) {
    return candidateReasoning;
  }
  return [`Federation recommended this surface role optimization from ${record.sourceRuntimeId}.`];
}

function resolveFederationRoleOptimizationConfidence(record: FederationInboxRecord): number {
  const metadata = toRecord(record.payload.metadata);
  const value = metadata?.confidence;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 82;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(1, value));
  }
  return Math.max(0, Math.min(100, value));
}

function applyCoordinatorSuggestionPackage(
  stores: RuntimeStoreBundle,
  record: FederationInboxRecord,
  now: number,
): FederationInboxRecord {
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  const payload =
    record.payload.type === "coordinator-suggestion" ? record.payload.payload : undefined;
  if (!payload) {
    return record;
  }
  const existingSuggestion = federationStore.coordinatorSuggestions.find(
    (entry) => entry.sourcePackageId === record.id || entry.id === payload.id,
  );
  const suggestion: CoordinatorSuggestionRecord = {
    id: payload.id,
    title: payload.title,
    summary: payload.summary,
    taskId: payload.taskId,
    localTaskId: existingSuggestion?.localTaskId,
    localTaskStatus: existingSuggestion?.localTaskStatus,
    sourceRuntimeId: record.sourceRuntimeId,
    sourcePackageId: record.id,
    createdAt: record.payload.generatedAt,
    updatedAt: now,
    adoptedAt: now,
    materializedAt: existingSuggestion?.materializedAt,
    lifecycleSyncedAt: existingSuggestion?.lifecycleSyncedAt,
    lastMaterializedLocalTaskId: existingSuggestion?.lastMaterializedLocalTaskId,
    lastMaterializedAt: existingSuggestion?.lastMaterializedAt,
    rematerializeReason: existingSuggestion?.rematerializeReason,
    metadata: {
      ...existingSuggestion?.metadata,
      ...payload.metadata,
      federationPackageId: record.id,
      federationSourceRuntimeId: record.sourceRuntimeId,
    },
  };
  federationStore.coordinatorSuggestions = upsertById(
    federationStore.coordinatorSuggestions.filter(
      (entry) => entry.sourcePackageId !== record.id && entry.id !== suggestion.id,
    ),
    suggestion,
  );
  return record;
}

export function materializeRuntimeCoordinatorSuggestionTask(
  id: string,
  opts: RuntimeStoreOptions = {},
): CoordinatorSuggestionMaterializeResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  const suggestionIndex = federationStore.coordinatorSuggestions.findIndex(
    (entry) => entry.id === id.trim(),
  );
  if (suggestionIndex < 0) {
    throw new Error(`coordinator suggestion ${id} was not found`);
  }
  const suggestion = federationStore.coordinatorSuggestions[suggestionIndex];
  const metadata = toRecord(suggestion.metadata);

  if (suggestion.localTaskId) {
    const existingTask = stores.taskStore.tasks.find(
      (entry) => entry.id === suggestion.localTaskId,
    );
    if (existingTask) {
      return {
        created: false,
        suggestion,
        task: existingTask,
      };
    }
  }

  const remoteTaskId = normalizeOptionalString(suggestion.taskId);
  const route = normalizeOptionalString(metadata?.route) ?? "federation";
  const surfaceId = normalizeOptionalString(metadata?.surfaceId);
  const surfaceProfile = surfaceId
    ? listRuntimeResolvedSurfaceProfiles({
        env: opts.env,
        homedir: opts.homedir,
        now,
      }).find((entry) => entry.surface.id === surfaceId)
    : undefined;
  if (surfaceId && !surfaceProfile) {
    throw new Error(`surface ${surfaceId} was not found`);
  }
  if (surfaceProfile?.effectiveLocalBusinessPolicy?.taskCreation === "disabled") {
    throw new Error(
      `surface ${surfaceProfile.surface.label} blocks local task creation for coordinator suggestions`,
    );
  }
  const createdTask = upsertRuntimeTask(
    {
      title: suggestion.title,
      goal: suggestion.summary,
      route,
      worker: normalizeOptionalString(metadata?.worker),
      priority: normalizeTaskPriority(metadata?.priority) ?? "normal",
      budgetMode: normalizeBudgetMode(metadata?.budgetMode),
      retrievalMode: normalizeRetrievalMode(metadata?.retrievalMode),
      reportPolicy: normalizeReportPolicy(metadata?.reportPolicy),
      skillIds: normalizeStringArray(metadata?.skillIds) ?? [],
      tags: uniqueStrings([
        "federation",
        "coordinator-suggestion",
        surfaceProfile ? "surface-bound" : undefined,
        surfaceProfile ? `surface:${surfaceProfile.surface.id}` : undefined,
        surfaceProfile?.surface.channel,
        ...(normalizeStringArray(metadata?.tags) ?? []).map((entry) => entry.trim()),
      ]),
      artifactRefs: uniqueStrings([
        `federation-package:${suggestion.sourcePackageId}`,
        `federation-coordinator-suggestion:${suggestion.id}`,
        remoteTaskId ? `federation-source-task:${remoteTaskId}` : undefined,
        surfaceProfile ? `runtime-surface:${surfaceProfile.surface.id}` : undefined,
      ]),
      metadata: {
        federation: {
          sourceRuntimeId: suggestion.sourceRuntimeId,
          sourcePackageId: suggestion.sourcePackageId,
          coordinatorSuggestionId: suggestion.id,
          sourceTaskId: remoteTaskId,
        },
        surface: surfaceProfile
          ? {
              surfaceId: surfaceProfile.surface.id,
              label: surfaceProfile.surface.label,
              channel: surfaceProfile.surface.channel,
              ownerKind: surfaceProfile.surface.ownerKind,
              ownerId: surfaceProfile.surface.ownerId,
              effectiveRole: surfaceProfile.effectiveRole,
              reportTarget: surfaceProfile.effectiveReportTarget,
              taskCreationPolicy: surfaceProfile.effectiveLocalBusinessPolicy?.taskCreation,
              escalationTarget: surfaceProfile.effectiveLocalBusinessPolicy?.escalationTarget,
              roleScope: surfaceProfile.effectiveLocalBusinessPolicy?.roleScope,
            }
          : undefined,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      ...opts,
      now,
    },
  );

  const materializedSuggestion: CoordinatorSuggestionRecord = {
    ...suggestion,
    localTaskId: createdTask.task.id,
    localTaskStatus: createdTask.task.status,
    materializedAt: now,
    updatedAt: now,
    lifecycleSyncedAt: now,
    lastMaterializedLocalTaskId: createdTask.task.id,
    lastMaterializedAt: now,
    rematerializeReason: undefined,
    metadata: {
      ...suggestion.metadata,
      localTaskId: createdTask.task.id,
      localTaskStatus: createdTask.task.status,
      materializedAt: now,
      lifecycleSyncedAt: now,
      lastMaterializedLocalTaskId: createdTask.task.id,
      lastMaterializedAt: now,
      rematerializeReason: undefined,
    },
  };
  const nextStores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  if (!nextStores.federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  nextStores.federationStore.coordinatorSuggestions = upsertById(
    nextStores.federationStore.coordinatorSuggestions,
    materializedSuggestion,
  );
  saveRuntimeStoreBundle(nextStores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_federation_coordinator_suggestion_materialized",
    {
      suggestionId: suggestion.id,
      sourcePackageId: suggestion.sourcePackageId,
      sourceRuntimeId: suggestion.sourceRuntimeId,
      localTaskId: createdTask.task.id,
      remoteTaskId,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    created: createdTask.created,
    suggestion: materializedSuggestion,
    task: createdTask.task,
  };
}

function applyRoleOptimizationPackage(
  stores: RuntimeStoreBundle,
  record: FederationInboxRecord,
  now: number,
): FederationInboxRecord {
  const userConsoleStore = stores.userConsoleStore;
  if (!userConsoleStore) {
    throw new Error("runtime user console store is unavailable");
  }
  const payload =
    record.payload.type === "role-optimization-package" ? record.payload.payload : null;
  if (!payload?.surfaceId) {
    return record;
  }
  const surface = userConsoleStore.surfaces.find((entry) => entry.id === payload.surfaceId);
  if (!surface) {
    throw new Error(`surface ${payload.surfaceId} does not exist`);
  }
  const candidateId = buildFederationRoleOptimizationCandidateId(record);
  const existingCandidate = userConsoleStore.roleOptimizationCandidates.find(
    (entry) => entry.id === candidateId,
  );
  const nextCandidate: RoleOptimizationCandidate = {
    id: candidateId,
    surfaceId: surface.id,
    agentId: payload.agentId ?? (surface.ownerKind === "agent" ? surface.ownerId : undefined),
    ownerKind: surface.ownerKind,
    summary: payload.summary,
    reasoning: buildFederationRoleOptimizationReasoning(record),
    proposedOverlay: normalizeRoleOptimizationOverlay(payload.proposedOverlay, surface.ownerKind),
    observationCount: Math.max(1, existingCandidate?.observationCount ?? 1),
    confidence: resolveFederationRoleOptimizationConfidence(record),
    state:
      existingCandidate?.state === "adopted" || existingCandidate?.state === "rejected"
        ? existingCandidate.state
        : "recommended",
    source: "federation",
    createdAt: existingCandidate?.createdAt ?? now,
    updatedAt: now,
    shadowedAt: existingCandidate?.shadowedAt ?? record.shadowedAt ?? now,
    recommendedAt:
      existingCandidate?.state === "adopted" || existingCandidate?.state === "rejected"
        ? (existingCandidate.recommendedAt ?? now)
        : now,
    adoptedAt: existingCandidate?.adoptedAt,
    rejectedAt: existingCandidate?.rejectedAt,
    expiredAt: existingCandidate?.expiredAt,
    revertedAt: existingCandidate?.revertedAt,
    metadata: {
      ...existingCandidate?.metadata,
      federationPackageId: record.id,
      federationPackageType: record.packageType,
      federationPackageState: "adopted",
      federationPackageAdoptedAt: now,
      federationSourceRuntimeId: record.sourceRuntimeId,
      importSource: "federation-package",
      reviewTarget: "user-console",
    },
  };
  stores.userConsoleStore = {
    ...userConsoleStore,
    roleOptimizationCandidates: upsertById(
      userConsoleStore.roleOptimizationCandidates,
      nextCandidate,
    ),
  };
  return record;
}

function applyAdoptedPackage(
  stores: RuntimeStoreBundle,
  record: FederationInboxRecord,
  now: number,
): FederationInboxRecord {
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  if (record.payload.type === "shared-strategy-package") {
    const sharedStrategies = record.payload.payload.strategies.map((strategy) => ({
      ...strategy,
      metadata: {
        ...strategy.metadata,
        federationPackageId: record.id,
        federationSourceRuntimeId: record.sourceRuntimeId,
        sourcePackageId: record.id,
        adoptedAt: now,
      },
    }));
    federationStore.sharedStrategies = [
      ...federationStore.sharedStrategies.filter(
        (entry) => !sharedStrategies.some((candidate) => candidate.id === entry.id),
      ),
      ...sharedStrategies,
    ];
    return record;
  }
  if (record.payload.type === "coordinator-suggestion") {
    return applyCoordinatorSuggestionPackage(stores, record, now);
  }
  if (record.payload.type === "team-knowledge-package") {
    const records = record.payload.payload.records.map((entry) => ({
      ...entry,
      namespace: "team-shareable" as const,
      sourceRuntimeId: entry.sourceRuntimeId ?? record.sourceRuntimeId,
      metadata: {
        ...entry.metadata,
        federationPackageId: record.id,
        federationSourceRuntimeId: record.sourceRuntimeId,
        sourcePackageId: record.id,
        adoptedAt: now,
      },
    }));
    federationStore.teamKnowledge = [
      ...federationStore.teamKnowledge.filter(
        (entry) => !records.some((candidate) => candidate.id === entry.id),
      ),
      ...records,
    ];
    return record;
  }
  if (record.payload.type === "role-optimization-package") {
    return applyRoleOptimizationPackage(stores, record, now);
  }
  if (record.payload.type === "runtime-policy-overlay-package") {
    const existingPolicies = toRecord(federationStore.metadata?.appliedPolicyOverlays) ?? {};
    federationStore.metadata = {
      ...federationStore.metadata,
      appliedPolicyOverlays: {
        ...existingPolicies,
        [record.id]: {
          route: record.payload.payload.route,
          policy: sanitizeRuntimePolicyOverlayPolicy(record.payload.payload.policy),
          appliedAt: now,
          review: record.review,
        },
      },
    };
    return record;
  }
  return record;
}

function revertAdoptedPackage(
  stores: RuntimeStoreBundle,
  record: FederationInboxRecord,
  now: number,
): void {
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  if (record.payload.type === "shared-strategy-package") {
    const ids = new Set(record.payload.payload.strategies.map((entry) => entry.id));
    federationStore.sharedStrategies = federationStore.sharedStrategies.filter(
      (entry) => !ids.has(entry.id),
    );
    return;
  }
  if (record.payload.type === "coordinator-suggestion") {
    const suggestionId = record.payload.payload.id;
    federationStore.coordinatorSuggestions = federationStore.coordinatorSuggestions.filter(
      (entry) => entry.sourcePackageId !== record.id && entry.id !== suggestionId,
    );
    return;
  }
  if (record.payload.type === "team-knowledge-package") {
    const ids = new Set(record.payload.payload.records.map((entry) => entry.id));
    federationStore.teamKnowledge = federationStore.teamKnowledge.filter(
      (entry) => !ids.has(entry.id),
    );
    return;
  }
  if (record.payload.type === "role-optimization-package") {
    const userConsoleStore = stores.userConsoleStore;
    const surfaceId = record.payload.payload.surfaceId;
    if (!userConsoleStore || !surfaceId) {
      return;
    }
    const candidateId = buildFederationRoleOptimizationCandidateId(record);
    const candidate = userConsoleStore.roleOptimizationCandidates.find(
      (entry) => entry.id === candidateId,
    );
    if (!candidate) {
      return;
    }
    if (candidate.state === "adopted" || candidate.state === "rejected") {
      stores.userConsoleStore = {
        ...userConsoleStore,
        roleOptimizationCandidates: upsertById(userConsoleStore.roleOptimizationCandidates, {
          ...candidate,
          updatedAt: now,
          metadata: {
            ...candidate.metadata,
            federationPackageState: "reverted",
            federationPackageRevertedAt: now,
          },
        }),
      };
      return;
    }
    stores.userConsoleStore = {
      ...userConsoleStore,
      roleOptimizationCandidates: upsertById(userConsoleStore.roleOptimizationCandidates, {
        ...candidate,
        state: "reverted",
        revertedAt: now,
        updatedAt: now,
        metadata: {
          ...candidate.metadata,
          federationPackageState: "reverted",
          federationPackageRevertedAt: now,
        },
      }),
    };
    return;
  }
  if (record.payload.type === "runtime-policy-overlay-package") {
    const existingPolicies = toRecord(federationStore.metadata?.appliedPolicyOverlays) ?? {};
    const nextPolicies = { ...existingPolicies };
    delete nextPolicies[record.id];
    federationStore.metadata = {
      ...federationStore.metadata,
      appliedPolicyOverlays: nextPolicies,
    };
  }
}

export function listRuntimeFederationInbox(
  opts: RuntimeStoreOptions = {},
): FederationInboxRecord[] {
  const stores = loadRuntimeStoreBundle(opts);
  return [...(stores.federationStore?.inbox ?? [])].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
}

export function syncRuntimeFederationInbox(
  opts: RuntimeStoreOptions = {},
): FederationInboxSyncResult {
  const now = resolveNow(opts.now);
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const inboxRoot = resolver.resolveDataPath("federation", "inbox");
  ensureDir(inboxRoot);
  const files = listJsonFilesRecursive(inboxRoot);
  const stores = loadRuntimeStoreBundle({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }

  const existingById = new Map(federationStore.inbox.map((entry) => [entry.id, entry]));
  const existingBySourcePath = new Map(
    federationStore.inbox
      .filter((entry) => typeof entry.sourcePath === "string" && entry.sourcePath.length > 0)
      .map((entry) => [entry.sourcePath!, entry]),
  );
  const nextInbox = [...federationStore.inbox];
  let received = 0;
  let updated = 0;
  let invalid = 0;
  let lastInboxEnvelopeId = federationStore.syncCursor?.lastInboxEnvelopeId;
  const newRecordIds: string[] = [];

  for (const filePath of files) {
    const existingForSourcePath = existingBySourcePath.get(filePath);
    const replaceInvalidSourcePathRecord = (nextId: string): void => {
      if (!existingForSourcePath || existingForSourcePath.id === nextId) {
        return;
      }
      if (existingForSourcePath.packageType !== "invalid-package") {
        return;
      }
      const existingIndex = nextInbox.findIndex((entry) => entry.id === existingForSourcePath.id);
      if (existingIndex >= 0) {
        nextInbox.splice(existingIndex, 1);
      }
      existingById.delete(existingForSourcePath.id);
    };
    let rawText = "";
    let parsed: unknown;
    try {
      rawText = fs.readFileSync(filePath, "utf8");
      parsed = JSON.parse(rawText);
    } catch (error) {
      invalid += 1;
      const parseError =
        error instanceof Error && error.message ? `invalid JSON: ${error.message}` : "invalid JSON";
      const invalidRecord = buildInvalidFederationPackageRecord({
        inboxRoot,
        filePath,
        rawText,
        parsed: undefined,
        now,
        sourceError: parseError,
        validationErrors: [parseError],
        existing:
          existingForSourcePath?.packageType === "invalid-package"
            ? existingForSourcePath
            : undefined,
      });
      replaceInvalidSourcePathRecord(invalidRecord.id);
      const existingIndex = nextInbox.findIndex((entry) => entry.id === invalidRecord.id);
      if (existingIndex < 0) {
        nextInbox.push(invalidRecord);
        received += 1;
        newRecordIds.push(invalidRecord.id);
      } else {
        nextInbox[existingIndex] = invalidRecord;
        updated += 1;
      }
      existingById.set(invalidRecord.id, invalidRecord);
      existingBySourcePath.set(filePath, invalidRecord);
      lastInboxEnvelopeId = invalidRecord.id;
      continue;
    }
    const shapeErrors = validateFederationInboundPackageShape(parsed);
    if (shapeErrors.length > 0 || !isFederationInboundPackage(parsed)) {
      invalid += 1;
      const invalidRecord = buildInvalidFederationPackageRecord({
        inboxRoot,
        filePath,
        rawText,
        parsed,
        now,
        sourceError: shapeErrors[0],
        validationErrors: shapeErrors,
        existing:
          existingForSourcePath?.packageType === "invalid-package"
            ? existingForSourcePath
            : undefined,
      });
      replaceInvalidSourcePathRecord(invalidRecord.id);
      const existingIndex = nextInbox.findIndex((entry) => entry.id === invalidRecord.id);
      if (existingIndex < 0) {
        nextInbox.push(invalidRecord);
        received += 1;
        newRecordIds.push(invalidRecord.id);
      } else {
        nextInbox[existingIndex] = invalidRecord;
        updated += 1;
      }
      existingById.set(invalidRecord.id, invalidRecord);
      existingBySourcePath.set(filePath, invalidRecord);
      lastInboxEnvelopeId = invalidRecord.id;
      continue;
    }
    const pkg = parsed;
    const id = resolveFederationPackageId(pkg);
    replaceInvalidSourcePathRecord(id);
    const validationErrors = validateFederationPackage(pkg);
    const review = buildFederationPackageReview(pkg);
    const existing = existingById.get(id);
    const nextRecord: FederationInboxRecord = existing
      ? {
          ...existing,
          packageType: pkg.type,
          sourceRuntimeId: pkg.sourceRuntimeId,
          sourcePath: filePath,
          summary: summarizeFederationPackage(pkg),
          validationErrors,
          payload: pkg,
          review,
          updatedAt: now,
        }
      : {
          id,
          packageType: pkg.type,
          sourceRuntimeId: pkg.sourceRuntimeId,
          state: "received",
          summary: summarizeFederationPackage(pkg),
          sourcePath: filePath,
          validationErrors,
          receivedAt: now,
          updatedAt: now,
          payload: pkg,
          review,
          metadata: undefined,
        };
    const index = nextInbox.findIndex((entry) => entry.id === id);
    if (index < 0) {
      nextInbox.push(nextRecord);
      received += 1;
      newRecordIds.push(id);
    } else {
      nextInbox[index] = nextRecord;
      updated += 1;
    }
    existingById.set(id, nextRecord);
    existingBySourcePath.set(filePath, nextRecord);
    lastInboxEnvelopeId = id;
  }

  federationStore.inbox = nextInbox;
  federationStore.syncCursor = {
    ...(federationStore.syncCursor ?? { updatedAt: now }),
    lastInboxEnvelopeId,
    lastPulledAt: now,
    updatedAt: now,
  };
  stores.federationStore = federationStore;
  saveRuntimeStoreBundle(stores, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });

  for (const recordId of newRecordIds) {
    const record = existingById.get(recordId);
    if (!record) {
      continue;
    }
    appendRuntimeEvent(
      "federation.package.received",
      {
        packageId: record.id,
        packageType: record.packageType,
        sourceRuntimeId: record.sourceRuntimeId,
      },
      {
        env: opts.env,
        homedir: opts.homedir,
        now,
      },
    );
  }

  return {
    generatedAt: now,
    inboxRoot,
    processed: files.length,
    received,
    updated,
    invalid,
    syncCursorUpdated: true,
  };
}

export function transitionRuntimeFederationPackage(
  input: FederationPackageTransitionInput,
  opts: RuntimeStoreOptions = {},
): FederationInboxRecord {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const federationStore = stores.federationStore;
  if (!federationStore) {
    throw new Error("runtime federation store is unavailable");
  }
  const index = federationStore.inbox.findIndex((entry) => entry.id === input.id);
  if (index < 0) {
    throw new Error(`federation package ${input.id} does not exist`);
  }
  const current = federationStore.inbox[index];
  if (!ALLOWED_TRANSITIONS[current.state].includes(input.state)) {
    throw new Error(`cannot transition federation package from ${current.state} to ${input.state}`);
  }
  if (input.state === "validated" && current.validationErrors.length > 0) {
    throw new Error(`federation package ${input.id} has validation errors`);
  }
  if (
    input.state === "adopted" &&
    current.packageType === "runtime-policy-overlay-package" &&
    current.review?.requiresReasonOnAdopt &&
    !normalizeText(input.reason)
  ) {
    throw new Error(
      `federation package ${input.id} requires a manual approval reason before adoption`,
    );
  }

  let next = setStateTimestamp(
    {
      ...current,
      state: input.state,
      metadata: input.reason
        ? {
            ...current.metadata,
            lastTransitionReason: input.reason,
          }
        : current.metadata,
    },
    input.state,
    now,
  );

  if (input.state === "adopted") {
    next = applyAdoptedPackage(stores, next, now);
  } else if (input.state === "reverted") {
    revertAdoptedPackage(stores, current, now);
  }

  federationStore.inbox[index] = next;
  federationStore.syncCursor = {
    ...(federationStore.syncCursor ?? { updatedAt: now }),
    lastInboxEnvelopeId: next.id,
    updatedAt: now,
  };
  stores.federationStore = federationStore;
  saveRuntimeStoreBundle(stores, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  appendRuntimeEvent(
    `federation.package.${input.state}`,
    {
      packageId: next.id,
      packageType: next.packageType,
      sourceRuntimeId: next.sourceRuntimeId,
      reason: input.reason,
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
  return next;
}
