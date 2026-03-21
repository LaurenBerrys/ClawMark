import {
  removeRuntimeCapabilityRegistryTargets,
  upsertRuntimeCapabilityRegistryEntry,
} from "./capability-plane.js";
import type {
  AgentLocalOverlay,
  AgentRecord,
  RoleOptimizationCandidate,
  RoleOptimizationCandidateState,
  RuntimeMetadata,
  RuntimeUserModelPreferencePatch,
  RuntimeSessionWorkingPreference,
  RuntimeUserConsoleStore,
  RuntimeUserModel,
  SurfaceLocalBusinessPolicy,
  SurfaceRecord,
  SurfaceRoleOverlay,
  TaskRecord,
  TaskReportPolicy,
  TaskReportRecord,
  UserModelOptimizationCandidate,
  UserModelOptimizationCandidateState,
  UserModelOptimizationField,
} from "./contracts.js";
import { applyRuntimeUserControlMemoryUpdate } from "./memory-update-engine.js";
import {
  appendRuntimeEvent,
  loadRuntimeGovernanceStore,
  loadRuntimeStoreBundle,
  loadRuntimeUserConsoleStore,
  saveRuntimeUserConsoleStore,
  type RuntimeStoreOptions,
} from "./store.js";
import {
  buildDefaultSurfaceLocalBusinessPolicy,
  hasExplicitSurfaceLocalBusinessPolicy,
  normalizeSurfaceReportTarget,
  sanitizeSurfaceLocalBusinessPolicy,
} from "./surface-policy.js";

type UserModelUpdateInput = Partial<
  RuntimeUserModelPreferencePatch & {
    displayName?: RuntimeUserModel["displayName"];
    metadata?: RuntimeUserModel["metadata"];
  }
>;

type AgentUpsertInput = {
  id?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  roleBase?: string;
  memoryNamespace?: string;
  skillIds?: string[];
  active?: boolean;
  overlay?: Partial<Pick<AgentLocalOverlay, "communicationStyle" | "reportPolicy" | "notes">>;
  metadata?: Record<string, unknown>;
};

type SurfaceUpsertInput = {
  id?: string;
  channel: string;
  accountId: string;
  label: string;
  ownerKind: SurfaceRecord["ownerKind"];
  ownerId?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
};

type SurfaceRoleOverlayUpsertInput = {
  id?: string;
  surfaceId: string;
  role: string;
  businessGoal?: string;
  tone?: string;
  initiative?: SurfaceRoleOverlay["initiative"];
  allowedTopics?: string[];
  restrictedTopics?: string[];
  reportTarget?: string;
  localBusinessPolicy?: Partial<SurfaceLocalBusinessPolicy> | Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type SessionWorkingPreferenceUpsertInput = {
  id?: string;
  sessionId: string;
  label?: string;
  communicationStyle?: string;
  interruptionThreshold?: RuntimeSessionWorkingPreference["interruptionThreshold"];
  reportVerbosity?: RuntimeSessionWorkingPreference["reportVerbosity"];
  confirmationBoundary?: RuntimeSessionWorkingPreference["confirmationBoundary"];
  reportPolicy?: TaskReportPolicy;
  notes?: string;
  expiresAt?: number | null;
  metadata?: Record<string, unknown>;
};

export type RuntimeResolvedUserPreferenceView = {
  userModel: RuntimeUserModel;
  agentOverlay?: AgentLocalOverlay;
  sessionWorkingPreference?: RuntimeSessionWorkingPreference;
  effective: RuntimeUserModel;
  sources: Partial<
    Record<
      | "communicationStyle"
      | "interruptionThreshold"
      | "reportVerbosity"
      | "confirmationBoundary"
      | "reportPolicy",
      "user" | "agent" | "session"
    >
  >;
};

export type RuntimeResolvedSurfaceProfile = {
  surface: SurfaceRecord;
  agent?: AgentRecord;
  overlay?: SurfaceRoleOverlay;
  ownerLabel: string;
  effectiveRole: string;
  effectiveBusinessGoal: string;
  effectiveTone: string;
  effectiveInitiative: NonNullable<SurfaceRoleOverlay["initiative"]>;
  effectiveReportTarget: string;
  effectiveAllowedTopics: string[];
  effectiveRestrictedTopics: string[];
  effectiveLocalBusinessPolicy?: SurfaceLocalBusinessPolicy;
  overlayPresent: boolean;
  sources: {
    role: "overlay" | "agent" | "channel" | "default";
    businessGoal: "overlay" | "derived";
    tone: "overlay" | "agent" | "user" | "derived";
    initiative: "overlay" | "derived";
    reportTarget: "overlay" | "default";
    allowedTopics: "overlay" | "default";
    restrictedTopics: "overlay" | "default";
    localBusinessPolicy: "overlay" | "derived";
  };
  updatedAt: number;
};

export type RuntimeRoleOptimizationReviewResult = {
  generatedAt: number;
  created: number;
  updated: number;
  recommended: number;
  shadowed: number;
  expired: number;
  candidates: RoleOptimizationCandidate[];
};

export type RuntimeRoleOptimizationAdoptResult = {
  candidate: RoleOptimizationCandidate;
  overlay: SurfaceRoleOverlay;
};

export type RuntimeRoleOptimizationRejectResult = {
  candidate: RoleOptimizationCandidate;
};

export type RuntimeUserModelOptimizationReviewResult = {
  generatedAt: number;
  created: number;
  updated: number;
  recommended: number;
  shadowed: number;
  expired: number;
  candidates: UserModelOptimizationCandidate[];
};

export type RuntimeUserModelOptimizationAdoptResult = {
  candidate: UserModelOptimizationCandidate;
  userModel: RuntimeUserModel;
};

export type RuntimeUserModelOptimizationRejectResult = {
  candidate: UserModelOptimizationCandidate;
};

export type RuntimeUserConsoleMaintenanceResult = {
  reviewedAt: number;
  expiredSessionPreferenceCount: number;
  removedSessionPreferenceIds: string[];
  userModelReview: RuntimeUserModelOptimizationReviewResult;
  roleReview: RuntimeRoleOptimizationReviewResult;
  reviewIntervalHours: number;
  lastReviewAt: number;
  lastSessionCleanupAt?: number;
};

export type ConfigureRuntimeUserConsoleMaintenanceInput = {
  enabled?: boolean;
  autoApplyLowRisk?: boolean;
  reviewIntervalHours?: number;
};

export type ConfigureRuntimeUserConsoleMaintenanceResult = {
  configuredAt: number;
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lastSessionCleanupAt?: number;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
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

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((entry) => entry.id !== id);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isAutoManagedLocalSkillGovernanceEntry(
  entry:
    | {
        state: string;
        metadata?: RuntimeMetadata;
      }
    | null
    | undefined,
): boolean {
  if (!entry) {
    return false;
  }
  return (
    entry.state === "shadow" &&
    entry.metadata?.localSkill === true &&
    entry.metadata?.configured !== true
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeReportPolicy(value: unknown): TaskReportPolicy | undefined {
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTaskSessionIdFromMetadata(metadata: RuntimeMetadata | undefined): string | undefined {
  const taskContext = toRecord(toRecord(metadata)?.taskContext);
  const sessionId = normalizeText(taskContext?.sessionId);
  return sessionId || undefined;
}

function readTaskSurfaceIdFromMetadata(metadata: RuntimeMetadata | undefined): string | undefined {
  const surface = toRecord(toRecord(metadata)?.surface);
  const surfaceId = normalizeText(surface?.surfaceId);
  return surfaceId || undefined;
}

const USER_MODEL_REVIEW_FIELDS: UserModelOptimizationField[] = [
  "communicationStyle",
  "interruptionThreshold",
  "reportVerbosity",
  "confirmationBoundary",
  "reportPolicy",
];
const ROLE_OPTIMIZATION_OBSERVATION_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function buildUserModelOptimizationCandidateId(field: UserModelOptimizationField): string {
  return `user-model-opt-${field}`;
}

function sortUserModelOptimizationCandidates(
  candidates: UserModelOptimizationCandidate[],
): UserModelOptimizationCandidate[] {
  const stateOrder: Record<UserModelOptimizationCandidateState, number> = {
    recommended: 0,
    shadow: 1,
    adopted: 2,
    rejected: 3,
    expired: 4,
    reverted: 5,
  };
  return [...candidates].toSorted(
    (left, right) =>
      (stateOrder[left.state] ?? 99) - (stateOrder[right.state] ?? 99) ||
      right.updatedAt - left.updatedAt ||
      left.field.localeCompare(right.field),
  );
}

function getUserModelOptimizationFieldLabel(field: UserModelOptimizationField): string {
  switch (field) {
    case "communicationStyle":
      return "communication style";
    case "interruptionThreshold":
      return "interruption threshold";
    case "reportVerbosity":
      return "report verbosity";
    case "confirmationBoundary":
      return "confirmation boundary";
    case "reportPolicy":
      return "report policy";
  }
}

function normalizeUserModelOptimizationValue(
  field: UserModelOptimizationField,
  value: unknown,
): string | undefined {
  switch (field) {
    case "communicationStyle": {
      const normalized = normalizeText(value).replace(/\s+/g, " ");
      return normalized || undefined;
    }
    case "interruptionThreshold":
      return value === "low" || value === "medium" || value === "high" ? value : undefined;
    case "reportVerbosity":
      return value === "brief" || value === "balanced" || value === "detailed" ? value : undefined;
    case "confirmationBoundary":
      return value === "strict" || value === "balanced" || value === "light" ? value : undefined;
    case "reportPolicy":
      return normalizeReportPolicy(value);
  }
}

function readSessionPreferenceOptimizationValue(
  preference: RuntimeSessionWorkingPreference,
  field: UserModelOptimizationField,
): string | undefined {
  switch (field) {
    case "communicationStyle":
      return normalizeUserModelOptimizationValue(field, preference.communicationStyle);
    case "interruptionThreshold":
      return normalizeUserModelOptimizationValue(field, preference.interruptionThreshold);
    case "reportVerbosity":
      return normalizeUserModelOptimizationValue(field, preference.reportVerbosity);
    case "confirmationBoundary":
      return normalizeUserModelOptimizationValue(field, preference.confirmationBoundary);
    case "reportPolicy":
      return normalizeUserModelOptimizationValue(field, preference.reportPolicy);
  }
}

function readUserModelOptimizationValue(
  userModel: RuntimeUserModel,
  field: UserModelOptimizationField,
): string | undefined {
  switch (field) {
    case "communicationStyle":
      return normalizeUserModelOptimizationValue(field, userModel.communicationStyle);
    case "interruptionThreshold":
      return normalizeUserModelOptimizationValue(field, userModel.interruptionThreshold);
    case "reportVerbosity":
      return normalizeUserModelOptimizationValue(field, userModel.reportVerbosity);
    case "confirmationBoundary":
      return normalizeUserModelOptimizationValue(field, userModel.confirmationBoundary);
    case "reportPolicy":
      return normalizeUserModelOptimizationValue(field, userModel.reportPolicy);
  }
}

function buildUserModelOptimizationPatch(
  field: UserModelOptimizationField,
  value: string,
): RuntimeUserModelPreferencePatch {
  switch (field) {
    case "communicationStyle":
      return { communicationStyle: value };
    case "interruptionThreshold":
      return { interruptionThreshold: value as RuntimeUserModel["interruptionThreshold"] };
    case "reportVerbosity":
      return { reportVerbosity: value as RuntimeUserModel["reportVerbosity"] };
    case "confirmationBoundary":
      return { confirmationBoundary: value as RuntimeUserModel["confirmationBoundary"] };
    case "reportPolicy":
      return { reportPolicy: value as RuntimeUserModel["reportPolicy"] };
  }
}

function describeUserModelOptimizationValue(
  field: UserModelOptimizationField,
  value: string,
): string {
  return `${getUserModelOptimizationFieldLabel(field)} = ${value}`;
}

function buildUserModelOptimizationSummary(
  field: UserModelOptimizationField,
  value: string,
  observationCount: number,
): string {
  return `Recommend setting user ${describeUserModelOptimizationValue(field, value)} from ${observationCount} stable session observations.`;
}

function expireUserModelOptimizationCandidate(
  candidate: UserModelOptimizationCandidate,
  now: number,
  reason: string,
): UserModelOptimizationCandidate {
  return {
    ...candidate,
    state: "expired",
    expiredAt: now,
    updatedAt: now,
    metadata: {
      ...candidate.metadata,
      expiredReason: reason,
    },
  };
}

function reconcileSatisfiedUserModelOptimizationCandidates(
  candidates: UserModelOptimizationCandidate[],
  userModel: RuntimeUserModel,
  now: number,
): { candidates: UserModelOptimizationCandidate[]; expiredIds: string[] } {
  const expiredIds: string[] = [];
  const nextCandidates = candidates.map((candidate) => {
    if (candidate.state !== "recommended" && candidate.state !== "shadow") {
      return candidate;
    }
    const proposedValue = readUserModelOptimizationValue(
      {
        ...userModel,
        ...candidate.proposedUserModel,
      },
      candidate.field,
    );
    const currentValue = readUserModelOptimizationValue(userModel, candidate.field);
    if (!proposedValue || currentValue !== proposedValue) {
      return candidate;
    }
    expiredIds.push(candidate.id);
    return expireUserModelOptimizationCandidate(candidate, now, "user-model-already-satisfied");
  });
  return {
    candidates: sortUserModelOptimizationCandidates(nextCandidates),
    expiredIds,
  };
}

function buildRoleOptimizationCandidateId(surfaceId: string): string {
  return `role-opt-${surfaceId}`;
}

function sortRoleOptimizationCandidates(
  candidates: RoleOptimizationCandidate[],
): RoleOptimizationCandidate[] {
  const stateOrder: Record<RoleOptimizationCandidateState, number> = {
    recommended: 0,
    shadow: 1,
    adopted: 2,
    rejected: 3,
    expired: 4,
    reverted: 5,
  };
  return [...candidates].toSorted(
    (left, right) =>
      (stateOrder[left.state] ?? 99) - (stateOrder[right.state] ?? 99) ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id),
  );
}

function uniqueTopicList(values: string[] | undefined): string[] {
  return uniqueStrings(values ?? []);
}

function isMetadataRecord(value: unknown): value is RuntimeMetadata {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readUserConsoleMaintenanceMetadata(metadata: RuntimeMetadata | undefined): {
  enabled: boolean;
  reviewIntervalHours: number;
  lastReviewAt?: number;
  lastSessionCleanupAt?: number;
  autoApplyLowRisk: boolean;
} {
  const record = isMetadataRecord(metadata) ? metadata : undefined;
  const reviewIntervalHours = Number(record?.reviewIntervalHours);
  const lastReviewAt = Number(record?.lastReviewAt);
  const lastSessionCleanupAt = Number(record?.lastSessionCleanupAt);
  return {
    enabled: record?.enabled !== false,
    autoApplyLowRisk: record?.autoApplyLowRisk === true,
    reviewIntervalHours:
      Number.isFinite(reviewIntervalHours) && reviewIntervalHours > 0
        ? Math.max(1, Math.min(168, Math.trunc(reviewIntervalHours)))
        : 12,
    lastReviewAt:
      Number.isFinite(lastReviewAt) && lastReviewAt > 0 ? Math.trunc(lastReviewAt) : undefined,
    lastSessionCleanupAt:
      Number.isFinite(lastSessionCleanupAt) && lastSessionCleanupAt > 0
        ? Math.trunc(lastSessionCleanupAt)
        : undefined,
  };
}

function mergeUserConsoleMaintenanceMetadata(
  metadata: RuntimeMetadata | undefined,
  patch: Partial<{
    enabled: boolean;
    autoApplyLowRisk: boolean;
    reviewIntervalHours: number;
    lastReviewAt: number | undefined;
    lastSessionCleanupAt: number | undefined;
  }>,
): RuntimeMetadata {
  const current = isMetadataRecord(metadata) ? metadata : {};
  const existing = readUserConsoleMaintenanceMetadata(current);
  const next: RuntimeMetadata = {
    ...current,
    enabled: patch.enabled ?? existing.enabled,
    autoApplyLowRisk: patch.autoApplyLowRisk ?? existing.autoApplyLowRisk,
    reviewIntervalHours:
      typeof patch.reviewIntervalHours === "number" && Number.isFinite(patch.reviewIntervalHours)
        ? Math.max(1, Math.min(168, Math.trunc(patch.reviewIntervalHours)))
        : existing.reviewIntervalHours,
  };
  const lastReviewAt = patch.lastReviewAt ?? existing.lastReviewAt;
  if (lastReviewAt) {
    next.lastReviewAt = lastReviewAt;
  } else {
    delete next.lastReviewAt;
  }
  const lastSessionCleanupAt = patch.lastSessionCleanupAt ?? existing.lastSessionCleanupAt;
  if (lastSessionCleanupAt) {
    next.lastSessionCleanupAt = lastSessionCleanupAt;
  } else {
    delete next.lastSessionCleanupAt;
  }
  return next;
}

function normalizeRoleOverlayPatch(
  patch: Partial<SurfaceRoleOverlay>,
): Partial<SurfaceRoleOverlay> {
  const normalized: Partial<SurfaceRoleOverlay> = {};
  if (typeof patch.role === "string" && patch.role.trim()) {
    normalized.role = patch.role.trim();
  }
  if (typeof patch.businessGoal === "string" && patch.businessGoal.trim()) {
    normalized.businessGoal = patch.businessGoal.trim();
  }
  if (typeof patch.tone === "string" && patch.tone.trim()) {
    normalized.tone = patch.tone.trim();
  }
  if (patch.initiative === "low" || patch.initiative === "medium" || patch.initiative === "high") {
    normalized.initiative = patch.initiative;
  }
  if (Array.isArray(patch.allowedTopics)) {
    normalized.allowedTopics = uniqueTopicList(patch.allowedTopics);
  }
  if (Array.isArray(patch.restrictedTopics)) {
    normalized.restrictedTopics = uniqueTopicList(patch.restrictedTopics);
  }
  const normalizedReportTarget = normalizeSurfaceReportTarget(patch.reportTarget);
  if (normalizedReportTarget) {
    normalized.reportTarget = normalizedReportTarget;
  }
  if (
    patch.localBusinessPolicy &&
    typeof patch.localBusinessPolicy === "object" &&
    !Array.isArray(patch.localBusinessPolicy)
  ) {
    normalized.localBusinessPolicy = patch.localBusinessPolicy;
  }
  return normalized;
}

function hasRoleOverlayPatch(patch: Partial<SurfaceRoleOverlay>): boolean {
  return Object.keys(normalizeRoleOverlayPatch(patch)).length > 0;
}

function roleLooksLike(role: string | undefined, hints: string[]): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

function deriveSurfaceRole(
  surface: SurfaceRecord,
  agent: AgentRecord | undefined,
): { role: string; confidence: number; source: "agent" | "channel" | "default" } {
  const label = `${surface.label} ${surface.channel} ${surface.accountId}`.toLowerCase();
  if (agent?.roleBase?.trim()) {
    return { role: agent.roleBase.trim(), confidence: 92, source: "agent" };
  }
  if (
    label.includes("sales") ||
    label.includes("lead") ||
    label.includes("shop") ||
    label.includes("store")
  ) {
    return { role: "sales_operator", confidence: 82, source: "channel" };
  }
  if (
    label.includes("support") ||
    label.includes("service") ||
    label.includes("after-sale") ||
    label.includes("after sales")
  ) {
    return { role: "support_operator", confidence: 82, source: "channel" };
  }
  if (
    surface.channel === "feishu" ||
    surface.channel === "discord" ||
    surface.channel === "telegram"
  ) {
    return { role: "control_surface", confidence: 88, source: "channel" };
  }
  return { role: "channel_operator", confidence: 72, source: "default" };
}

function deriveSurfaceBusinessGoal(surface: SurfaceRecord, role: string): string {
  if (roleLooksLike(role, ["sales", "lead", "closer"])) {
    return `Convert qualified ${surface.channel} leads without policy drift.`;
  }
  if (roleLooksLike(role, ["support", "service", "care"])) {
    return `Resolve ${surface.channel} requests and escalate restricted topics quickly.`;
  }
  if (roleLooksLike(role, ["control", "ops", "operator"])) {
    return `Keep the operator informed and route high-signal ${surface.channel} messages.`;
  }
  return `Handle ${surface.channel} conversations within the local business policy.`;
}

function deriveSurfaceTone(
  userModel: RuntimeUserModel,
  agentOverlay: AgentLocalOverlay | undefined,
  role: string,
): string {
  const inherited =
    agentOverlay?.communicationStyle?.trim() || userModel.communicationStyle?.trim();
  if (inherited) {
    return inherited;
  }
  if (roleLooksLike(role, ["sales", "lead", "closer"])) {
    return "clear, persuasive, and respectful";
  }
  if (roleLooksLike(role, ["support", "service", "care"])) {
    return "calm, precise, and helpful";
  }
  return "direct and concise";
}

function deriveSurfaceInitiative(
  surface: SurfaceRecord,
  role: string,
): SurfaceRoleOverlay["initiative"] {
  if (roleLooksLike(role, ["sales", "lead", "closer"])) {
    return "high";
  }
  if (surface.ownerKind === "agent") {
    return "medium";
  }
  if (roleLooksLike(role, ["control", "ops"])) {
    return "low";
  }
  return "medium";
}

type RuntimeSurfaceOperationalSignals = {
  recentTaskCount: number;
  waitingUserTaskCount: number;
  blockedTaskCount: number;
  waitingExternalTaskCount: number;
  completedTaskCount: number;
  recentReportCount: number;
  waitingUserReportCount: number;
  blockedReportCount: number;
  waitingExternalReportCount: number;
  completionReportCount: number;
};

function createRuntimeSurfaceOperationalSignals(): RuntimeSurfaceOperationalSignals {
  return {
    recentTaskCount: 0,
    waitingUserTaskCount: 0,
    blockedTaskCount: 0,
    waitingExternalTaskCount: 0,
    completedTaskCount: 0,
    recentReportCount: 0,
    waitingUserReportCount: 0,
    blockedReportCount: 0,
    waitingExternalReportCount: 0,
    completionReportCount: 0,
  };
}

function collectRuntimeSurfaceOperationalSignals(
  tasks: TaskRecord[],
  reports: TaskReportRecord[],
  now: number,
): Map<string, RuntimeSurfaceOperationalSignals> {
  const signalsBySurfaceId = new Map<string, RuntimeSurfaceOperationalSignals>();
  const ensureSignals = (surfaceId: string) => {
    const existing = signalsBySurfaceId.get(surfaceId);
    if (existing) {
      return existing;
    }
    const created = createRuntimeSurfaceOperationalSignals();
    signalsBySurfaceId.set(surfaceId, created);
    return created;
  };
  for (const task of tasks) {
    if (
      !Number.isFinite(task.updatedAt) ||
      now - task.updatedAt > ROLE_OPTIMIZATION_OBSERVATION_LOOKBACK_MS
    ) {
      continue;
    }
    const surfaceId = readTaskSurfaceIdFromMetadata(task.metadata);
    if (!surfaceId) {
      continue;
    }
    const signals = ensureSignals(surfaceId);
    signals.recentTaskCount += 1;
    if (task.status === "waiting_user") {
      signals.waitingUserTaskCount += 1;
    } else if (task.status === "blocked") {
      signals.blockedTaskCount += 1;
    } else if (task.status === "waiting_external") {
      signals.waitingExternalTaskCount += 1;
    } else if (task.status === "completed") {
      signals.completedTaskCount += 1;
    }
  }
  for (const report of reports) {
    if (
      !report.surfaceId ||
      !Number.isFinite(report.createdAt) ||
      now - report.createdAt > ROLE_OPTIMIZATION_OBSERVATION_LOOKBACK_MS
    ) {
      continue;
    }
    const signals = ensureSignals(report.surfaceId);
    signals.recentReportCount += 1;
    if (report.kind === "waiting_user") {
      signals.waitingUserReportCount += 1;
    } else if (report.kind === "blocked") {
      signals.blockedReportCount += 1;
    } else if (report.kind === "waiting_external") {
      signals.waitingExternalReportCount += 1;
    } else if (report.kind === "completion") {
      signals.completionReportCount += 1;
    }
  }
  return signalsBySurfaceId;
}

function buildRoleOptimizationSuggestion(
  surface: SurfaceRecord,
  overlay: SurfaceRoleOverlay | undefined,
  userModel: RuntimeUserModel,
  agent: AgentRecord | undefined,
  agentOverlay: AgentLocalOverlay | undefined,
  operationalSignals: RuntimeSurfaceOperationalSignals,
): {
  summary: string;
  reasoning: string[];
  proposedOverlay: Partial<SurfaceRoleOverlay>;
  confidence: number;
  autoRecommend: boolean;
  riskLevel: "low" | "medium";
  metadata?: RuntimeMetadata;
} | null {
  const proposed: Partial<SurfaceRoleOverlay> = {};
  const reasoning: string[] = [];
  const derivedRole = deriveSurfaceRole(surface, agent);
  const targetRole = overlay?.role || derivedRole.role;

  if (!overlay?.role) {
    proposed.role = derivedRole.role;
    reasoning.push(
      derivedRole.source === "agent"
        ? "The surface is owned by an agent with a defined role base, so the local role overlay should inherit it."
        : "The surface does not have a local role overlay yet, so the runtime inferred a safe starter role from the channel context.",
    );
  }
  if (!overlay?.businessGoal) {
    proposed.businessGoal = deriveSurfaceBusinessGoal(surface, targetRole);
    reasoning.push("A missing business goal makes surface behavior drift across channels.");
  }
  if (!overlay?.tone) {
    proposed.tone = deriveSurfaceTone(userModel, agentOverlay, targetRole);
    reasoning.push(
      "The surface should inherit a stable communication tone instead of improvising per session.",
    );
  }
  if (!overlay?.initiative) {
    proposed.initiative = deriveSurfaceInitiative(surface, targetRole);
    reasoning.push("A missing initiative level leaves outbound behavior undefined.");
  }
  if (!overlay?.reportTarget) {
    proposed.reportTarget = "runtime-user";
    reasoning.push(
      "Role overlays should report back to the user console unless an explicit local target is set.",
    );
  }
  if (!hasExplicitSurfaceLocalBusinessPolicy(overlay?.localBusinessPolicy)) {
    proposed.localBusinessPolicy = buildDefaultSurfaceLocalBusinessPolicy(
      surface.ownerKind,
      targetRole,
    );
    reasoning.push(
      "Each surface should carry an explicit local business policy so service channels stay scoped and cannot rewrite the runtime core.",
    );
  }

  const waitingUserCount = Math.max(
    operationalSignals.waitingUserTaskCount,
    operationalSignals.waitingUserReportCount,
  );
  const blockedCount = Math.max(
    operationalSignals.blockedTaskCount,
    operationalSignals.blockedReportCount,
  );
  const waitingExternalCount = Math.max(
    operationalSignals.waitingExternalTaskCount,
    operationalSignals.waitingExternalReportCount,
  );
  const completionCount = Math.max(
    operationalSignals.completedTaskCount,
    operationalSignals.completionReportCount,
  );
  const followUpPressure = waitingUserCount + blockedCount;
  const frictionCount = followUpPressure + waitingExternalCount;
  const effectiveInitiative = overlay?.initiative ?? deriveSurfaceInitiative(surface, targetRole);
  let behaviorDriven = false;
  let behaviorAutoRecommend = false;
  let riskLevel: "low" | "medium" = derivedRole.source !== "default" ? "low" : "medium";

  if (surface.ownerKind === "agent" && followUpPressure >= 2) {
    if (normalizeSurfaceReportTarget(overlay?.reportTarget) !== "surface-owner") {
      proposed.reportTarget = "surface-owner";
      behaviorDriven = true;
      behaviorAutoRecommend = followUpPressure >= 3;
      reasoning.push(
        `Recent ${surface.label} activity asked for local follow-up ${followUpPressure} times (${waitingUserCount} waiting-user, ${blockedCount} blocked), so first-pass reports should route to the owning agent before escalating to the runtime user.`,
      );
    }
    const currentLocalBusinessPolicy = sanitizeSurfaceLocalBusinessPolicy(
      proposed.localBusinessPolicy ?? overlay?.localBusinessPolicy,
      {
        ownerKind: surface.ownerKind,
        role: targetRole,
      },
    );
    if (currentLocalBusinessPolicy.escalationTarget !== "surface-owner") {
      proposed.localBusinessPolicy = {
        ...currentLocalBusinessPolicy,
        escalationTarget: "surface-owner",
      };
      behaviorDriven = true;
      behaviorAutoRecommend = followUpPressure >= 3;
      reasoning.push(
        "The owning agent should receive the first escalation for this surface while the runtime keeps final operator control local.",
      );
    }
  }

  if (effectiveInitiative === "high" && frictionCount >= 3 && frictionCount > completionCount + 1) {
    proposed.initiative = "medium";
    behaviorDriven = true;
    riskLevel = "medium";
    reasoning.push(
      `Recent surface outcomes skewed toward friction (${waitingUserCount} waiting-user, ${blockedCount} blocked, ${waitingExternalCount} waiting-external) over completions (${completionCount}), so a medium initiative posture is safer than staying fully aggressive.`,
    );
  }

  const allowedTopics = uniqueTopicList(overlay?.allowedTopics);
  const restrictedTopics = uniqueTopicList(overlay?.restrictedTopics);
  if (allowedTopics.length > 0 && restrictedTopics.length > 0) {
    const restrictedSet = new Set(restrictedTopics.map((entry) => entry.toLowerCase()));
    const cleanedAllowed = allowedTopics.filter((entry) => !restrictedSet.has(entry.toLowerCase()));
    if (cleanedAllowed.length !== allowedTopics.length) {
      proposed.allowedTopics = cleanedAllowed;
      proposed.restrictedTopics = restrictedTopics;
      reasoning.push(
        "Allowed topics overlapped with restricted topics and were normalized to avoid mixed instructions.",
      );
    }
  }

  const normalized = normalizeRoleOverlayPatch(proposed);
  if (!hasRoleOverlayPatch(normalized)) {
    return null;
  }

  const proposedFields = Object.keys(normalized).length;
  const operationalConfidenceBonus = behaviorDriven
    ? Math.min(
        12,
        followUpPressure * 2 +
          Math.min(4, waitingExternalCount) +
          Math.min(4, operationalSignals.recentTaskCount),
      )
    : 0;
  const confidence = Math.min(
    94,
    Math.max(
      68,
      derivedRole.confidence + proposedFields * 2 + (overlay ? 2 : 4) + operationalConfidenceBonus,
    ),
  );
  const autoRecommend = derivedRole.source !== "default" || behaviorAutoRecommend;
  const summary = behaviorDriven
    ? `${surface.label}: tune local surface routing from recent runtime outcomes.`
    : typeof normalized.role === "string"
      ? `${surface.label}: recommend role "${normalized.role}" and tighten the local surface policy.`
      : `${surface.label}: fill missing local role controls.`;
  return {
    summary,
    reasoning,
    proposedOverlay: normalized,
    confidence,
    autoRecommend,
    riskLevel,
    metadata: behaviorDriven
      ? {
          signalSource: "surface-operations",
          recentTaskCount: operationalSignals.recentTaskCount,
          recentReportCount: operationalSignals.recentReportCount,
          waitingUserCount,
          blockedCount,
          waitingExternalCount,
          completionCount,
          followUpPressure,
        }
      : undefined,
  };
}

function requireStore(opts: RuntimeStoreOptions = {}): RuntimeUserConsoleStore {
  return loadRuntimeUserConsoleStore(opts);
}

export function getRuntimeUserConsoleStore(
  opts: RuntimeStoreOptions = {},
): RuntimeUserConsoleStore {
  return requireStore(opts);
}

export function getRuntimeUserModel(opts: RuntimeStoreOptions = {}): RuntimeUserModel {
  return requireStore(opts).userModel;
}

export function listRuntimeSessionWorkingPreferences(
  opts: RuntimeStoreOptions = {},
): RuntimeSessionWorkingPreference[] {
  const now = resolveNow(opts.now);
  return [...requireStore(opts).sessionWorkingPreferences]
    .filter((entry) => !entry.expiresAt || entry.expiresAt > now)
    .toSorted(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId),
    );
}

export function reviewRuntimeUserConsoleMaintenance(
  opts: RuntimeStoreOptions = {},
): RuntimeUserConsoleMaintenanceResult {
  const now = resolveNow(opts.now);
  const store = requireStore({
    ...opts,
    now,
  });
  const removedSessionPreferenceIds = store.sessionWorkingPreferences
    .filter((entry) => !!entry.expiresAt && entry.expiresAt <= now)
    .map((entry) => entry.id);
  const nextSessionWorkingPreferences =
    removedSessionPreferenceIds.length > 0
      ? store.sessionWorkingPreferences.filter(
          (entry) => !removedSessionPreferenceIds.includes(entry.id),
        )
      : store.sessionWorkingPreferences;

  saveRuntimeUserConsoleStore(
    {
      ...store,
      sessionWorkingPreferences: nextSessionWorkingPreferences,
      metadata: mergeUserConsoleMaintenanceMetadata(store.metadata, {
        lastReviewAt: now,
        lastSessionCleanupAt: removedSessionPreferenceIds.length > 0 ? now : undefined,
      }),
    },
    {
      ...opts,
      now,
    },
  );

  if (removedSessionPreferenceIds.length > 0) {
    appendRuntimeEvent(
      "runtime_session_working_preferences_cleaned",
      {
        removedSessionPreferenceIds,
        removedCount: removedSessionPreferenceIds.length,
      },
      {
        ...opts,
        now,
      },
    );
  }

  const userModelReview = reviewRuntimeUserModelOptimizations({
    ...opts,
    now,
  });
  const roleReview = reviewRuntimeRoleOptimizations({
    ...opts,
    now,
  });
  const refreshedStore = requireStore({
    ...opts,
    now,
  });
  const nextMetadata = mergeUserConsoleMaintenanceMetadata(refreshedStore.metadata, {
    lastReviewAt: now,
    lastSessionCleanupAt:
      removedSessionPreferenceIds.length > 0
        ? now
        : readUserConsoleMaintenanceMetadata(refreshedStore.metadata).lastSessionCleanupAt,
  });
  saveRuntimeUserConsoleStore(
    {
      ...refreshedStore,
      metadata: nextMetadata,
    },
    {
      ...opts,
      now,
    },
  );

  const _autoApply =
    nextMetadata.enabled && nextMetadata.autoApplyLowRisk
      ? maybeAutoApplyLowRiskUserOptimizations({
          ...opts,
          now,
        })
      : { userModelAdoptedIds: [], roleAdoptedIds: [] };

  appendRuntimeEvent(
    "runtime_user_console_maintenance_reviewed",
    {
      expiredSessionPreferenceCount: removedSessionPreferenceIds.length,
      removedSessionPreferenceIds,
      userModel: {
        created: userModelReview.created,
        updated: userModelReview.updated,
        recommended: userModelReview.recommended,
        shadowed: userModelReview.shadowed,
        expired: userModelReview.expired,
      },
      role: {
        created: roleReview.created,
        updated: roleReview.updated,
        recommended: roleReview.recommended,
        shadowed: roleReview.shadowed,
        expired: roleReview.expired,
      },
    },
    {
      ...opts,
      now,
    },
  );
  const maintenance = readUserConsoleMaintenanceMetadata(nextMetadata);
  return {
    reviewedAt: now,
    expiredSessionPreferenceCount: removedSessionPreferenceIds.length,
    removedSessionPreferenceIds,
    userModelReview,
    roleReview,
    reviewIntervalHours: maintenance.reviewIntervalHours,
    lastReviewAt: now,
    lastSessionCleanupAt: maintenance.lastSessionCleanupAt,
  };
}

export function configureRuntimeUserConsoleMaintenance(
  input: ConfigureRuntimeUserConsoleMaintenanceInput,
  opts: RuntimeStoreOptions = {},
): ConfigureRuntimeUserConsoleMaintenanceResult {
  const now = resolveNow(opts.now);
  const store = requireStore({
    ...opts,
    now,
  });
  const nextMetadata = mergeUserConsoleMaintenanceMetadata(store.metadata, {
    enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    reviewIntervalHours:
      typeof input.reviewIntervalHours === "number" ? input.reviewIntervalHours : undefined,
  });

  saveRuntimeUserConsoleStore(
    {
      ...store,
      metadata: nextMetadata,
    },
    {
      ...opts,
      now,
    },
  );

  const maintenance = readUserConsoleMaintenanceMetadata(nextMetadata);
  appendRuntimeEvent(
    "runtime_user_console_maintenance_configured",
    {
      enabled: maintenance.enabled,
      reviewIntervalHours: maintenance.reviewIntervalHours,
      lastReviewAt: maintenance.lastReviewAt,
      lastSessionCleanupAt: maintenance.lastSessionCleanupAt,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    configuredAt: now,
    enabled: maintenance.enabled,
    reviewIntervalHours: maintenance.reviewIntervalHours,
    lastReviewAt: maintenance.lastReviewAt,
    lastSessionCleanupAt: maintenance.lastSessionCleanupAt,
  };
}

export function updateRuntimeUserModel(
  input: UserModelUpdateInput,
  opts: RuntimeStoreOptions = {},
): RuntimeUserModel {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const next: RuntimeUserModel = {
    ...store.userModel,
    displayName:
      typeof input.displayName === "string"
        ? input.displayName.trim() || undefined
        : store.userModel.displayName,
    communicationStyle:
      typeof input.communicationStyle === "string"
        ? input.communicationStyle.trim() || undefined
        : store.userModel.communicationStyle,
    interruptionThreshold:
      input.interruptionThreshold === "low" ||
      input.interruptionThreshold === "medium" ||
      input.interruptionThreshold === "high"
        ? input.interruptionThreshold
        : store.userModel.interruptionThreshold,
    reportVerbosity:
      input.reportVerbosity === "brief" ||
      input.reportVerbosity === "balanced" ||
      input.reportVerbosity === "detailed"
        ? input.reportVerbosity
        : store.userModel.reportVerbosity,
    confirmationBoundary:
      input.confirmationBoundary === "strict" ||
      input.confirmationBoundary === "balanced" ||
      input.confirmationBoundary === "light"
        ? input.confirmationBoundary
        : store.userModel.confirmationBoundary,
    reportPolicy: normalizeReportPolicy(input.reportPolicy) ?? store.userModel.reportPolicy,
    updatedAt: now,
    metadata: input.metadata ?? store.userModel.metadata,
  };
  const reconciledUserModelOptimizations = reconcileSatisfiedUserModelOptimizationCandidates(
    store.userModelOptimizationCandidates,
    next,
    now,
  );
  saveRuntimeUserConsoleStore(
    {
      ...store,
      userModel: next,
      userModelOptimizationCandidates: reconciledUserModelOptimizations.candidates,
    },
    opts,
  );
  applyRuntimeUserControlMemoryUpdate(
    {
      kind: "user_model_update",
      previous: store.userModel,
      next,
      now,
    },
    opts,
  );
  if (reconciledUserModelOptimizations.expiredIds.length > 0) {
    appendRuntimeEvent(
      "runtime_user_model_optimization_expired",
      {
        candidateIds: reconciledUserModelOptimizations.expiredIds,
        reason: "user-model-already-satisfied",
      },
      {
        ...opts,
        now,
      },
    );
  }
  return next;
}

export function upsertRuntimeSessionWorkingPreference(
  input: SessionWorkingPreferenceUpsertInput,
  opts: RuntimeStoreOptions = {},
): RuntimeSessionWorkingPreference {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) {
    throw new Error("sessionId is required");
  }
  const existing = store.sessionWorkingPreferences.find(
    (entry) => entry.id === input.id || entry.sessionId === sessionId,
  );
  const next: RuntimeSessionWorkingPreference = {
    id:
      typeof input.id === "string" && input.id.trim().length > 0
        ? input.id.trim()
        : (existing?.id ?? `session-pref-${sessionId}`),
    sessionId,
    label: typeof input.label === "string" ? input.label.trim() || undefined : existing?.label,
    communicationStyle:
      typeof input.communicationStyle === "string"
        ? input.communicationStyle.trim() || undefined
        : existing?.communicationStyle,
    interruptionThreshold:
      input.interruptionThreshold === "low" ||
      input.interruptionThreshold === "medium" ||
      input.interruptionThreshold === "high"
        ? input.interruptionThreshold
        : existing?.interruptionThreshold,
    reportVerbosity:
      input.reportVerbosity === "brief" ||
      input.reportVerbosity === "balanced" ||
      input.reportVerbosity === "detailed"
        ? input.reportVerbosity
        : existing?.reportVerbosity,
    confirmationBoundary:
      input.confirmationBoundary === "strict" ||
      input.confirmationBoundary === "balanced" ||
      input.confirmationBoundary === "light"
        ? input.confirmationBoundary
        : existing?.confirmationBoundary,
    reportPolicy: normalizeReportPolicy(input.reportPolicy) ?? existing?.reportPolicy,
    notes: typeof input.notes === "string" ? input.notes.trim() || undefined : existing?.notes,
    expiresAt:
      input.expiresAt === null
        ? undefined
        : (normalizeOptionalNumber(input.expiresAt) ?? existing?.expiresAt),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };

  saveRuntimeUserConsoleStore(
    {
      ...store,
      sessionWorkingPreferences: upsertById(store.sessionWorkingPreferences, next),
    },
    opts,
  );
  return next;
}

export function deleteRuntimeSessionWorkingPreference(
  id: string,
  opts: RuntimeStoreOptions = {},
): { removed: boolean; id: string } {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return { removed: false, id };
  }
  const store = requireStore(opts);
  const existing = store.sessionWorkingPreferences.find((entry) => entry.id === normalizedId);
  if (!existing) {
    return { removed: false, id: normalizedId };
  }
  saveRuntimeUserConsoleStore(
    {
      ...store,
      sessionWorkingPreferences: store.sessionWorkingPreferences.filter(
        (entry) => entry.id !== normalizedId,
      ),
    },
    opts,
  );
  return { removed: true, id: normalizedId };
}

export function resolveRuntimeUserPreferenceView(
  input: {
    agentId?: string;
    sessionId?: string;
  },
  opts: RuntimeStoreOptions = {},
): RuntimeResolvedUserPreferenceView {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const agentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const agentOverlay = agentId
    ? store.agentOverlays.find((entry) => entry.agentId === agentId)
    : undefined;
  const sessionWorkingPreference = sessionId
    ? store.sessionWorkingPreferences.find(
        (entry) => entry.sessionId === sessionId && (!entry.expiresAt || entry.expiresAt > now),
      )
    : undefined;

  const effective: RuntimeUserModel = {
    ...store.userModel,
    communicationStyle:
      sessionWorkingPreference?.communicationStyle ??
      agentOverlay?.communicationStyle ??
      store.userModel.communicationStyle,
    interruptionThreshold:
      sessionWorkingPreference?.interruptionThreshold ?? store.userModel.interruptionThreshold,
    reportVerbosity: sessionWorkingPreference?.reportVerbosity ?? store.userModel.reportVerbosity,
    confirmationBoundary:
      sessionWorkingPreference?.confirmationBoundary ?? store.userModel.confirmationBoundary,
    reportPolicy:
      sessionWorkingPreference?.reportPolicy ??
      agentOverlay?.reportPolicy ??
      store.userModel.reportPolicy,
  };

  const sources: RuntimeResolvedUserPreferenceView["sources"] = {};
  if (effective.communicationStyle) {
    sources.communicationStyle = sessionWorkingPreference?.communicationStyle
      ? "session"
      : agentOverlay?.communicationStyle
        ? "agent"
        : "user";
  }
  if (effective.interruptionThreshold) {
    sources.interruptionThreshold = sessionWorkingPreference?.interruptionThreshold
      ? "session"
      : "user";
  }
  if (effective.reportVerbosity) {
    sources.reportVerbosity = sessionWorkingPreference?.reportVerbosity ? "session" : "user";
  }
  if (effective.confirmationBoundary) {
    sources.confirmationBoundary = sessionWorkingPreference?.confirmationBoundary
      ? "session"
      : "user";
  }
  if (effective.reportPolicy) {
    sources.reportPolicy = sessionWorkingPreference?.reportPolicy
      ? "session"
      : agentOverlay?.reportPolicy
        ? "agent"
        : "user";
  }

  return {
    userModel: store.userModel,
    agentOverlay,
    sessionWorkingPreference,
    effective,
    sources,
  };
}

export function listRuntimeUserModelOptimizationCandidates(
  opts: RuntimeStoreOptions = {},
): UserModelOptimizationCandidate[] {
  return sortUserModelOptimizationCandidates(requireStore(opts).userModelOptimizationCandidates);
}

export function reviewRuntimeUserModelOptimizations(
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelOptimizationReviewResult {
  const now = resolveNow(opts.now);
  const store = requireStore({
    ...opts,
    now,
  });
  const runtimeStores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const activePreferences = store.sessionWorkingPreferences.filter(
    (entry) => !entry.expiresAt || entry.expiresAt > now,
  );
  let created = 0;
  let updated = 0;
  let recommended = 0;
  let shadowed = 0;
  let expired = 0;
  let nextCandidates = [...store.userModelOptimizationCandidates];
  const touchedCandidateIds: string[] = [];

  for (const field of USER_MODEL_REVIEW_FIELDS) {
    const observationGroups = new Map<
      string,
      { value: string; sessionIds: string[]; count: number }
    >();
    let totalObservedSessions = 0;
    for (const preference of activePreferences) {
      const value = readSessionPreferenceOptimizationValue(preference, field);
      if (!value) {
        continue;
      }
      totalObservedSessions += 1;
      const key = field === "communicationStyle" ? value.toLowerCase() : value;
      const current = observationGroups.get(key);
      if (current) {
        current.count += 1;
        current.sessionIds = uniqueStrings([...current.sessionIds, preference.sessionId]).toSorted(
          (left, right) => left.localeCompare(right),
        );
      } else {
        observationGroups.set(key, {
          value,
          sessionIds: [preference.sessionId],
          count: 1,
        });
      }
    }

    let taskReportObservationCount = 0;
    if (field === "reportPolicy") {
      const taskById = new Map(runtimeStores.taskStore.tasks.map((task) => [task.id, task]));
      const seenReportSessionKeys = new Set<string>();
      const reportLookbackMs = 14 * 24 * 60 * 60 * 1000;
      for (const report of runtimeStores.taskStore.reports) {
        if (!report.reportPolicy || !Number.isFinite(report.createdAt)) {
          continue;
        }
        if (now - report.createdAt > reportLookbackMs) {
          continue;
        }
        const task = taskById.get(report.taskId);
        const sessionId = readTaskSessionIdFromMetadata(task?.metadata);
        if (!sessionId) {
          continue;
        }
        const observationKey = `${sessionId}:${report.reportPolicy}`;
        if (seenReportSessionKeys.has(observationKey)) {
          continue;
        }
        seenReportSessionKeys.add(observationKey);
        taskReportObservationCount += 1;
        totalObservedSessions += 1;
        const current = observationGroups.get(report.reportPolicy);
        if (current) {
          current.sessionIds = uniqueStrings([...current.sessionIds, sessionId]).toSorted(
            (left, right) => left.localeCompare(right),
          );
          current.count = current.sessionIds.length;
        } else {
          observationGroups.set(report.reportPolicy, {
            value: report.reportPolicy,
            sessionIds: [sessionId],
            count: 1,
          });
        }
      }
    }

    const candidateId = buildUserModelOptimizationCandidateId(field);
    const existing = nextCandidates.find((entry) => entry.id === candidateId);
    const groups = [...observationGroups.values()].toSorted(
      (left, right) => right.count - left.count || left.value.localeCompare(right.value),
    );
    const dominant = groups[0];
    const currentUserValue = readUserModelOptimizationValue(store.userModel, field);
    const hasStableSignal =
      !!dominant &&
      dominant.count >= 2 &&
      (groups.length === 1 || dominant.count > (groups[1]?.count ?? 0));

    if (!hasStableSignal || !dominant) {
      if (existing && (existing.state === "shadow" || existing.state === "recommended")) {
        const expiredCandidate = expireUserModelOptimizationCandidate(
          existing,
          now,
          totalObservedSessions === 0
            ? "no-active-session-observations"
            : "no-stable-session-consensus",
        );
        nextCandidates = upsertById(nextCandidates, expiredCandidate);
        expired += 1;
        touchedCandidateIds.push(expiredCandidate.id);
      }
      continue;
    }

    if (currentUserValue === dominant.value) {
      if (existing && (existing.state === "shadow" || existing.state === "recommended")) {
        const expiredCandidate = expireUserModelOptimizationCandidate(
          existing,
          now,
          "user-model-already-satisfied",
        );
        nextCandidates = upsertById(nextCandidates, expiredCandidate);
        expired += 1;
        touchedCandidateIds.push(expiredCandidate.id);
      }
      continue;
    }

    const stabilityRatio = dominant.count / Math.max(totalObservedSessions, 1);
    const nextState: UserModelOptimizationCandidateState =
      dominant.count >= 3 || stabilityRatio >= 0.75 ? "recommended" : "shadow";
    const competingValues = groups.slice(1).map((entry) => entry.value);
    const summary = buildUserModelOptimizationSummary(field, dominant.value, dominant.count);
    const reasoning = [
      `${dominant.count} active sessions converged on ${describeUserModelOptimizationValue(field, dominant.value)}.`,
      `The current local user model still resolves ${getUserModelOptimizationFieldLabel(field)} as ${currentUserValue ?? "unset"}.`,
      "The Runtime keeps session preferences temporary until the user explicitly adopts the long-term change.",
      ...(taskReportObservationCount > 0
        ? [
            `${taskReportObservationCount} recent task-report sessions reinforced the same report policy signal.`,
          ]
        : []),
      ...(competingValues.length > 0
        ? [`Competing session values are still present: ${competingValues.slice(0, 3).join(", ")}.`]
        : []),
    ];
    const nextCandidate: UserModelOptimizationCandidate = {
      id: candidateId,
      field,
      summary,
      reasoning,
      proposedUserModel: buildUserModelOptimizationPatch(field, dominant.value),
      observedSessionIds: [...dominant.sessionIds].toSorted((left, right) =>
        left.localeCompare(right),
      ),
      observationCount: dominant.count,
      confidence: Math.min(
        96,
        Math.max(
          68,
          Math.round(
            70 + stabilityRatio * 18 + Math.min(8, dominant.count * 2) - competingValues.length * 3,
          ),
        ),
      ),
      state: nextState,
      source: "local-review",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      shadowedAt: existing?.shadowedAt ?? now,
      recommendedAt: nextState === "recommended" ? now : existing?.recommendedAt,
      metadata: {
        ...existing?.metadata,
        dominantValue: dominant.value,
        totalObservedSessions,
        taskReportObservationCount,
        stabilityRatio,
        competingValues,
        riskLevel:
          field === "communicationStyle"
            ? stabilityRatio >= 0.8 && dominant.count >= 3
              ? "low"
              : "medium"
            : "low",
      },
    };
    nextCandidates = upsertById(nextCandidates, nextCandidate);
    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
    if (nextState === "recommended") {
      recommended += 1;
    } else {
      shadowed += 1;
    }
    touchedCandidateIds.push(nextCandidate.id);
  }

  nextCandidates = sortUserModelOptimizationCandidates(nextCandidates);
  saveRuntimeUserConsoleStore(
    {
      ...store,
      userModelOptimizationCandidates: nextCandidates,
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_user_model_optimization_reviewed",
    {
      candidateIds: touchedCandidateIds,
      created,
      updated,
      recommended,
      shadowed,
      expired,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    generatedAt: now,
    created,
    updated,
    recommended,
    shadowed,
    expired,
    candidates: nextCandidates,
  };
}

export function adoptRuntimeUserModelOptimizationCandidate(
  id: string,
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelOptimizationAdoptResult {
  const now = resolveNow(opts.now);
  const normalizedId = id.trim();
  const store = requireStore({
    ...opts,
    now,
  });
  const candidate = store.userModelOptimizationCandidates.find(
    (entry) => entry.id === normalizedId,
  );
  if (!candidate) {
    throw new Error(`Unknown user model optimization candidate: ${id}`);
  }
  if (candidate.state === "expired" || candidate.state === "rejected") {
    throw new Error(`User model optimization candidate ${id} is not adoptable`);
  }
  const userModel = updateRuntimeUserModel(candidate.proposedUserModel, {
    ...opts,
    now,
  });
  const refreshedStore = requireStore({
    ...opts,
    now,
  });
  const adoptedCandidate: UserModelOptimizationCandidate = {
    ...(refreshedStore.userModelOptimizationCandidates.find((entry) => entry.id === normalizedId) ??
      candidate),
    state: "adopted",
    adoptedAt: now,
    updatedAt: now,
    metadata: {
      ...(refreshedStore.userModelOptimizationCandidates.find((entry) => entry.id === normalizedId)
        ?.metadata ?? candidate.metadata),
      adoptedUserModelAt: now,
    },
  };
  saveRuntimeUserConsoleStore(
    {
      ...refreshedStore,
      userModelOptimizationCandidates: sortUserModelOptimizationCandidates(
        upsertById(refreshedStore.userModelOptimizationCandidates, adoptedCandidate),
      ),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_user_model_optimization_adopted",
    {
      candidateId: adoptedCandidate.id,
      field: adoptedCandidate.field,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    candidate: adoptedCandidate,
    userModel,
  };
}

export function rejectRuntimeUserModelOptimizationCandidate(
  input: {
    id: string;
    reason?: string;
  },
  opts: RuntimeStoreOptions = {},
): RuntimeUserModelOptimizationRejectResult {
  const now = resolveNow(opts.now);
  const normalizedId = input.id.trim();
  const store = requireStore({
    ...opts,
    now,
  });
  const candidate = store.userModelOptimizationCandidates.find(
    (entry) => entry.id === normalizedId,
  );
  if (!candidate) {
    throw new Error(`Unknown user model optimization candidate: ${input.id}`);
  }
  const rejectedCandidate: UserModelOptimizationCandidate = {
    ...candidate,
    state: "rejected",
    rejectedAt: now,
    updatedAt: now,
    metadata: {
      ...candidate.metadata,
      rejectionReason: normalizeText(input.reason) || undefined,
    },
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      userModelOptimizationCandidates: sortUserModelOptimizationCandidates(
        upsertById(
          removeById(store.userModelOptimizationCandidates, normalizedId),
          rejectedCandidate,
        ),
      ),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_user_model_optimization_rejected",
    {
      candidateId: rejectedCandidate.id,
      field: rejectedCandidate.field,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    candidate: rejectedCandidate,
  };
}

export function listRuntimeAgents(opts: RuntimeStoreOptions = {}): AgentRecord[] {
  return [...requireStore(opts).agents].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
  );
}

export function upsertRuntimeAgent(
  input: AgentUpsertInput,
  opts: RuntimeStoreOptions = {},
): AgentRecord {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  const id =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : `agent-${now.toString(36)}`;
  const existing = store.agents.find((entry) => entry.id === id);
  const nextAgent: AgentRecord = {
    id,
    name: input.name.trim(),
    description:
      typeof input.description === "string"
        ? input.description.trim() || undefined
        : existing?.description,
    avatarUrl:
      typeof input.avatarUrl === "string"
        ? input.avatarUrl.trim() || undefined
        : existing?.avatarUrl,
    roleBase:
      typeof input.roleBase === "string" ? input.roleBase.trim() || undefined : existing?.roleBase,
    memoryNamespace:
      typeof input.memoryNamespace === "string" && input.memoryNamespace.trim().length > 0
        ? input.memoryNamespace.trim()
        : (existing?.memoryNamespace ?? `agent/${id}`),
    skillIds: Array.isArray(input.skillIds)
      ? input.skillIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.skillIds ?? []),
    active: typeof input.active === "boolean" ? input.active : (existing?.active ?? true),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  const nextOverlay =
    input.overlay == null
      ? store.agentOverlays.find((entry) => entry.agentId === id)
      : {
          id:
            store.agentOverlays.find((entry) => entry.agentId === id)?.id ?? `agent-overlay-${id}`,
          agentId: id,
          communicationStyle:
            typeof input.overlay.communicationStyle === "string"
              ? input.overlay.communicationStyle.trim() || undefined
              : store.agentOverlays.find((entry) => entry.agentId === id)?.communicationStyle,
          reportPolicy:
            normalizeReportPolicy(input.overlay.reportPolicy) ??
            store.agentOverlays.find((entry) => entry.agentId === id)?.reportPolicy,
          notes:
            typeof input.overlay.notes === "string"
              ? input.overlay.notes.trim() || undefined
              : store.agentOverlays.find((entry) => entry.agentId === id)?.notes,
          updatedAt: now,
          metadata: input.metadata,
        };

  saveRuntimeUserConsoleStore(
    {
      ...store,
      agents: upsertById(store.agents, nextAgent),
      agentOverlays:
        nextOverlay == null ? store.agentOverlays : upsertById(store.agentOverlays, nextOverlay),
    },
    opts,
  );
  const governanceStore = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const existingGovernanceEntry = governanceStore.entries.find(
    (entry) =>
      entry.registryType === "agent" && entry.targetId.toLowerCase() === nextAgent.id.toLowerCase(),
  );
  const remainingLocalSkillIds = new Set(
    uniqueStrings([
      ...store.agents
        .filter((agent) => agent.id !== nextAgent.id)
        .flatMap((agent) => agent.skillIds ?? []),
      ...nextAgent.skillIds,
    ]).map((skillId) => skillId.toLowerCase()),
  );
  upsertRuntimeCapabilityRegistryEntry(
    {
      registryType: "agent",
      targetId: nextAgent.id,
      state: existingGovernanceEntry?.state ?? "shadow",
      summary:
        existingGovernanceEntry?.summary ||
        (existing?.id === nextAgent.id
          ? `Local agent ${nextAgent.name} remains governed by the authoritative runtime registry.`
          : `Local agent ${nextAgent.name} is staged in shadow until the runtime explicitly adopts it into the live route.`),
      metadata: {
        ...existingGovernanceEntry?.metadata,
        source: "runtime-user-console",
        configured: false,
        localAgent: true,
        accessMode: "shadow_execution",
        agentName: nextAgent.name,
      },
      reason:
        existing?.id === nextAgent.id
          ? "local agent updated through the user console"
          : "local agent created through the user console",
    },
    {
      ...opts,
      now,
    },
  );
  const governanceEntryBySkillId = new Map(
    governanceStore.entries
      .filter((entry) => entry.registryType === "skill")
      .map((entry) => [entry.targetId.toLowerCase(), entry] as const),
  );
  for (const skillId of nextAgent.skillIds) {
    const existingSkillEntry = governanceEntryBySkillId.get(skillId.toLowerCase());
    upsertRuntimeCapabilityRegistryEntry(
      {
        registryType: "skill",
        targetId: skillId,
        state: existingSkillEntry?.state ?? "shadow",
        summary:
          existingSkillEntry?.summary ||
          `Local agent skill ${skillId} is staged in shadow until the runtime explicitly adopts it into the live route.`,
        metadata: {
          ...existingSkillEntry?.metadata,
          source: "runtime-user-console",
          configured: false,
          localSkill: true,
          providedByAgentId: nextAgent.id,
          accessMode: "shadow_skill",
        },
        reason:
          existingSkillEntry == null
            ? "local agent skill materialized through the user console"
            : "local agent skill refreshed through the user console",
      },
      {
        ...opts,
        now,
      },
    );
  }
  const removedAutoManagedSkillIds = uniqueStrings(existing?.skillIds ?? []).filter(
    (skillId) =>
      !remainingLocalSkillIds.has(skillId.toLowerCase()) &&
      isAutoManagedLocalSkillGovernanceEntry(governanceEntryBySkillId.get(skillId.toLowerCase())),
  );
  for (const skillId of removedAutoManagedSkillIds) {
    removeRuntimeCapabilityRegistryTargets(
      {
        registryType: "skill",
        targetId: skillId,
        reason: "local agent skill was removed from the user-console skill pack",
      },
      {
        ...opts,
        now,
      },
    );
  }
  return nextAgent;
}

export function deleteRuntimeAgent(
  id: string,
  opts: RuntimeStoreOptions = {},
): {
  removed: boolean;
  id: string;
} {
  const store = requireStore(opts);
  const existing = store.agents.find((entry) => entry.id === id);
  if (!existing) {
    return { removed: false, id };
  }
  const now = resolveNow(opts.now);
  const governanceStore = loadRuntimeGovernanceStore({
    ...opts,
    now,
  });
  const remainingLocalSkillIds = new Set(
    uniqueStrings(
      store.agents.filter((agent) => agent.id !== id).flatMap((agent) => agent.skillIds ?? []),
    ).map((skillId) => skillId.toLowerCase()),
  );
  saveRuntimeUserConsoleStore(
    {
      ...store,
      agents: store.agents.filter((entry) => entry.id !== id),
      agentOverlays: store.agentOverlays.filter((entry) => entry.agentId !== id),
      surfaces: store.surfaces.map((surface) =>
        surface.ownerKind === "agent" && surface.ownerId === id
          ? { ...surface, ownerKind: "user", ownerId: undefined, updatedAt: now }
          : surface,
      ),
    },
    opts,
  );
  removeRuntimeCapabilityRegistryTargets(
    {
      registryType: "agent",
      targetId: id,
      removeMcpGrantsForAgentId: id,
      reason: "local agent removed through the user console",
    },
    {
      ...opts,
      now,
    },
  );
  const governanceEntryBySkillId = new Map(
    governanceStore.entries
      .filter((entry) => entry.registryType === "skill")
      .map((entry) => [entry.targetId.toLowerCase(), entry] as const),
  );
  for (const skillId of uniqueStrings(existing.skillIds ?? [])) {
    if (remainingLocalSkillIds.has(skillId.toLowerCase())) {
      continue;
    }
    if (
      !isAutoManagedLocalSkillGovernanceEntry(governanceEntryBySkillId.get(skillId.toLowerCase()))
    ) {
      continue;
    }
    removeRuntimeCapabilityRegistryTargets(
      {
        registryType: "skill",
        targetId: skillId,
        reason: "local agent removal pruned the final shadow-only skill reference",
      },
      {
        ...opts,
        now,
      },
    );
  }
  return { removed: true, id };
}

export function listRuntimeSurfaces(opts: RuntimeStoreOptions = {}): SurfaceRecord[] {
  return [...requireStore(opts).surfaces].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label),
  );
}

export function listRuntimeResolvedSurfaceProfiles(
  opts: RuntimeStoreOptions = {},
): RuntimeResolvedSurfaceProfile[] {
  const now = resolveNow(opts.now);
  const store = requireStore({
    ...opts,
    now,
  });
  const agentById = new Map(store.agents.map((agent) => [agent.id, agent]));
  const agentOverlayById = new Map(
    store.agentOverlays.map((overlay) => [overlay.agentId, overlay]),
  );
  const overlayBySurfaceId = new Map(
    store.surfaceRoleOverlays.map((overlay) => [overlay.surfaceId, overlay]),
  );

  return [...store.surfaces]
    .map((surface) => {
      const agent =
        surface.ownerKind === "agent" && surface.ownerId
          ? agentById.get(surface.ownerId)
          : undefined;
      const agentOverlay = agent ? agentOverlayById.get(agent.id) : undefined;
      const overlay = overlayBySurfaceId.get(surface.id);
      const derivedRole = deriveSurfaceRole(surface, agent);
      const effectiveRole = overlay?.role || derivedRole.role;
      const effectiveBusinessGoal =
        overlay?.businessGoal || deriveSurfaceBusinessGoal(surface, effectiveRole);
      const effectiveTone =
        overlay?.tone || deriveSurfaceTone(store.userModel, agentOverlay, effectiveRole);
      const effectiveInitiative =
        overlay?.initiative ?? deriveSurfaceInitiative(surface, effectiveRole) ?? "medium";
      const effectiveReportTarget = overlay?.reportTarget || "runtime-user";
      const effectiveAllowedTopics = uniqueTopicList(overlay?.allowedTopics);
      const effectiveRestrictedTopics = uniqueTopicList(overlay?.restrictedTopics);
      const effectiveLocalBusinessPolicy = sanitizeSurfaceLocalBusinessPolicy(
        overlay?.localBusinessPolicy,
        {
          ownerKind: surface.ownerKind,
          role: effectiveRole,
        },
      );

      return {
        surface,
        agent,
        overlay,
        ownerLabel:
          surface.ownerKind === "agent"
            ? agent?.name || surface.ownerId || "Unknown agent"
            : "User console",
        effectiveRole,
        effectiveBusinessGoal,
        effectiveTone,
        effectiveInitiative,
        effectiveReportTarget,
        effectiveAllowedTopics,
        effectiveRestrictedTopics,
        effectiveLocalBusinessPolicy,
        overlayPresent: !!overlay,
        sources: {
          role: overlay?.role ? "overlay" : derivedRole.source,
          businessGoal: overlay?.businessGoal ? "overlay" : "derived",
          tone: overlay?.tone
            ? "overlay"
            : agentOverlay?.communicationStyle
              ? "agent"
              : store.userModel.communicationStyle
                ? "user"
                : "derived",
          initiative: overlay?.initiative ? "overlay" : "derived",
          reportTarget: overlay?.reportTarget ? "overlay" : "default",
          allowedTopics: overlay?.allowedTopics?.length ? "overlay" : "default",
          restrictedTopics: overlay?.restrictedTopics?.length ? "overlay" : "default",
          localBusinessPolicy: hasExplicitSurfaceLocalBusinessPolicy(overlay?.localBusinessPolicy)
            ? "overlay"
            : "derived",
        },
        updatedAt: Math.max(
          surface.updatedAt,
          overlay?.updatedAt ?? surface.updatedAt,
          agent?.updatedAt ?? surface.updatedAt,
          agentOverlay?.updatedAt ?? surface.updatedAt,
        ),
      } satisfies RuntimeResolvedSurfaceProfile;
    })
    .toSorted(
      (left, right) =>
        Number(right.surface.active) - Number(left.surface.active) ||
        right.updatedAt - left.updatedAt ||
        left.surface.label.localeCompare(right.surface.label),
    );
}

export function listRuntimeRoleOptimizationCandidates(
  opts: RuntimeStoreOptions = {},
): RoleOptimizationCandidate[] {
  return sortRoleOptimizationCandidates(requireStore(opts).roleOptimizationCandidates);
}

export function upsertRuntimeSurface(
  input: SurfaceUpsertInput,
  opts: RuntimeStoreOptions = {},
): SurfaceRecord {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  if (input.ownerKind === "agent") {
    const agentId = typeof input.ownerId === "string" ? input.ownerId.trim() : "";
    if (!agentId || !store.agents.some((entry) => entry.id === agentId)) {
      throw new Error("surface ownerId must reference an existing agent");
    }
  }
  const id =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : `surface-${now.toString(36)}`;
  const existing = store.surfaces.find((entry) => entry.id === id);
  const next: SurfaceRecord = {
    id,
    channel: input.channel.trim(),
    accountId: input.accountId.trim(),
    label: input.label.trim(),
    ownerKind: input.ownerKind,
    ownerId: input.ownerKind === "agent" ? input.ownerId?.trim() : undefined,
    active: typeof input.active === "boolean" ? input.active : (existing?.active ?? true),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      surfaces: upsertById(store.surfaces, next),
    },
    opts,
  );
  return next;
}

export function upsertRuntimeSurfaceRoleOverlay(
  input: SurfaceRoleOverlayUpsertInput,
  opts: RuntimeStoreOptions = {},
): SurfaceRoleOverlay {
  const now = resolveNow(opts.now);
  const store = requireStore(opts);
  if (!store.surfaces.some((entry) => entry.id === input.surfaceId)) {
    throw new Error("surfaceId must reference an existing surface");
  }
  const existing = store.surfaceRoleOverlays.find(
    (entry) => entry.id === input.id || entry.surfaceId === input.surfaceId,
  );
  const surface = store.surfaces.find((entry) => entry.id === input.surfaceId);
  if (!surface) {
    throw new Error("surfaceId must reference an existing surface");
  }
  const next: SurfaceRoleOverlay = {
    id:
      typeof input.id === "string" && input.id.trim().length > 0
        ? input.id.trim()
        : (existing?.id ?? `surface-role-${input.surfaceId}`),
    surfaceId: input.surfaceId,
    role: input.role.trim(),
    businessGoal:
      typeof input.businessGoal === "string"
        ? input.businessGoal.trim() || undefined
        : existing?.businessGoal,
    tone: typeof input.tone === "string" ? input.tone.trim() || undefined : existing?.tone,
    initiative:
      input.initiative === "low" || input.initiative === "medium" || input.initiative === "high"
        ? input.initiative
        : existing?.initiative,
    allowedTopics: Array.isArray(input.allowedTopics)
      ? input.allowedTopics.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.allowedTopics ?? []),
    restrictedTopics: Array.isArray(input.restrictedTopics)
      ? input.restrictedTopics.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : (existing?.restrictedTopics ?? []),
    reportTarget: normalizeSurfaceReportTarget(input.reportTarget) ?? existing?.reportTarget,
    localBusinessPolicy: sanitizeSurfaceLocalBusinessPolicy(
      input.localBusinessPolicy ?? existing?.localBusinessPolicy,
      {
        ownerKind: surface.ownerKind,
        role: input.role.trim(),
      },
    ),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: input.metadata ?? existing?.metadata,
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      surfaceRoleOverlays: upsertById(store.surfaceRoleOverlays, next),
    },
    opts,
  );
  applyRuntimeUserControlMemoryUpdate(
    {
      kind: "surface_role_overlay_update",
      surface,
      overlay: next,
      now,
    },
    opts,
  );
  return next;
}

export function reviewRuntimeRoleOptimizations(
  opts: RuntimeStoreOptions = {},
): RuntimeRoleOptimizationReviewResult {
  const now = resolveNow(opts.now);
  const store = requireStore({
    ...opts,
    now,
  });
  const runtimeStores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const agentById = new Map(store.agents.map((entry) => [entry.id, entry]));
  const agentOverlayById = new Map(store.agentOverlays.map((entry) => [entry.agentId, entry]));
  const overlayBySurfaceId = new Map(
    store.surfaceRoleOverlays.map((entry) => [entry.surfaceId, entry]),
  );
  const operationalSignalsBySurfaceId = collectRuntimeSurfaceOperationalSignals(
    runtimeStores.taskStore.tasks,
    runtimeStores.taskStore.reports,
    now,
  );
  let created = 0;
  let updated = 0;
  let recommended = 0;
  let shadowed = 0;
  let expired = 0;
  let nextCandidates = [...store.roleOptimizationCandidates];
  const touchedCandidateIds: string[] = [];

  for (const surface of store.surfaces) {
    const overlay = overlayBySurfaceId.get(surface.id);
    const agent =
      surface.ownerKind === "agent" && surface.ownerId ? agentById.get(surface.ownerId) : undefined;
    const suggestion = buildRoleOptimizationSuggestion(
      surface,
      overlay,
      store.userModel,
      agent,
      agent ? agentOverlayById.get(agent.id) : undefined,
      operationalSignalsBySurfaceId.get(surface.id) ?? createRuntimeSurfaceOperationalSignals(),
    );
    const candidateId = buildRoleOptimizationCandidateId(surface.id);
    const existing = nextCandidates.find((entry) => entry.id === candidateId);
    if (!suggestion) {
      if (existing && (existing.state === "shadow" || existing.state === "recommended")) {
        const expiredCandidate: RoleOptimizationCandidate = {
          ...existing,
          state: "expired",
          expiredAt: now,
          updatedAt: now,
          metadata: {
            ...existing.metadata,
            expiredReason: "surface-role-overlay-already-satisfied",
          },
        };
        nextCandidates = upsertById(nextCandidates, expiredCandidate);
        expired += 1;
        touchedCandidateIds.push(expiredCandidate.id);
      }
      continue;
    }

    const nextState: RoleOptimizationCandidateState = suggestion.autoRecommend
      ? "recommended"
      : "shadow";
    const nextCandidate: RoleOptimizationCandidate = {
      id: candidateId,
      surfaceId: surface.id,
      agentId: agent?.id,
      ownerKind: surface.ownerKind,
      summary: suggestion.summary,
      reasoning: suggestion.reasoning,
      proposedOverlay: suggestion.proposedOverlay,
      observationCount: (existing?.observationCount ?? 0) + 1,
      confidence: suggestion.confidence,
      state: nextState,
      source: "local-review",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      shadowedAt: existing?.shadowedAt ?? now,
      recommendedAt: nextState === "recommended" ? now : existing?.recommendedAt,
      metadata: {
        ...existing?.metadata,
        proposedFields: Object.keys(suggestion.proposedOverlay),
        riskLevel: suggestion.riskLevel,
        ...toRecord(suggestion.metadata),
      },
    };
    nextCandidates = upsertById(nextCandidates, nextCandidate);
    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
    if (nextState === "recommended") {
      recommended += 1;
    } else {
      shadowed += 1;
    }
    touchedCandidateIds.push(nextCandidate.id);
  }

  nextCandidates = sortRoleOptimizationCandidates(nextCandidates);
  saveRuntimeUserConsoleStore(
    {
      ...store,
      roleOptimizationCandidates: nextCandidates,
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_role_optimization_reviewed",
    {
      candidateIds: touchedCandidateIds,
      created,
      updated,
      recommended,
      shadowed,
      expired,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    generatedAt: now,
    created,
    updated,
    recommended,
    shadowed,
    expired,
    candidates: nextCandidates,
  };
}

export function adoptRuntimeRoleOptimizationCandidate(
  id: string,
  opts: RuntimeStoreOptions = {},
): RuntimeRoleOptimizationAdoptResult {
  const now = resolveNow(opts.now);
  const normalizedId = id.trim();
  const store = requireStore({
    ...opts,
    now,
  });
  const candidate = store.roleOptimizationCandidates.find((entry) => entry.id === normalizedId);
  if (!candidate) {
    throw new Error(`Unknown role optimization candidate: ${id}`);
  }
  if (candidate.state !== "recommended" && candidate.state !== "shadow") {
    throw new Error(`Role optimization candidate ${id} is not adoptable`);
  }
  const surface = store.surfaces.find((entry) => entry.id === candidate.surfaceId);
  if (!surface) {
    throw new Error(`Surface ${candidate.surfaceId} no longer exists`);
  }
  const existingOverlay = store.surfaceRoleOverlays.find(
    (entry) => entry.surfaceId === candidate.surfaceId,
  );
  const patch = normalizeRoleOverlayPatch(candidate.proposedOverlay);
  const role = (typeof patch.role === "string" && patch.role.trim()) || existingOverlay?.role;
  if (!role) {
    throw new Error(`Role optimization candidate ${id} does not resolve a role`);
  }

  const overlay = upsertRuntimeSurfaceRoleOverlay(
    {
      id: existingOverlay?.id,
      surfaceId: candidate.surfaceId,
      role,
      businessGoal:
        typeof patch.businessGoal === "string" ? patch.businessGoal : existingOverlay?.businessGoal,
      tone: typeof patch.tone === "string" ? patch.tone : existingOverlay?.tone,
      initiative:
        patch.initiative === "low" || patch.initiative === "medium" || patch.initiative === "high"
          ? patch.initiative
          : existingOverlay?.initiative,
      allowedTopics: Array.isArray(patch.allowedTopics)
        ? patch.allowedTopics
        : existingOverlay?.allowedTopics,
      restrictedTopics: Array.isArray(patch.restrictedTopics)
        ? patch.restrictedTopics
        : existingOverlay?.restrictedTopics,
      reportTarget:
        normalizeSurfaceReportTarget(patch.reportTarget) ?? existingOverlay?.reportTarget,
      localBusinessPolicy: patch.localBusinessPolicy ?? existingOverlay?.localBusinessPolicy,
      metadata: {
        ...existingOverlay?.metadata,
        adoptedFromRoleOptimizationCandidateId: candidate.id,
      },
    },
    {
      ...opts,
      now,
    },
  );

  const refreshedStore = requireStore({
    ...opts,
    now,
  });
  const adoptedCandidate: RoleOptimizationCandidate = {
    ...(refreshedStore.roleOptimizationCandidates.find((entry) => entry.id === normalizedId) ??
      candidate),
    state: "adopted",
    adoptedAt: now,
    updatedAt: now,
    metadata: {
      ...(refreshedStore.roleOptimizationCandidates.find((entry) => entry.id === normalizedId)
        ?.metadata ?? candidate.metadata),
      adoptedOverlayId: overlay.id,
    },
  };
  saveRuntimeUserConsoleStore(
    {
      ...refreshedStore,
      roleOptimizationCandidates: sortRoleOptimizationCandidates(
        upsertById(refreshedStore.roleOptimizationCandidates, adoptedCandidate),
      ),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_role_optimization_adopted",
    {
      candidateId: adoptedCandidate.id,
      surfaceId: adoptedCandidate.surfaceId,
      overlayId: overlay.id,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    candidate: adoptedCandidate,
    overlay,
  };
}

export function rejectRuntimeRoleOptimizationCandidate(
  input: {
    id: string;
    reason?: string;
  },
  opts: RuntimeStoreOptions = {},
): RuntimeRoleOptimizationRejectResult {
  const now = resolveNow(opts.now);
  const normalizedId = input.id.trim();
  const store = requireStore({
    ...opts,
    now,
  });
  const candidate = store.roleOptimizationCandidates.find((entry) => entry.id === normalizedId);
  if (!candidate) {
    throw new Error(`Unknown role optimization candidate: ${input.id}`);
  }
  const rejectedCandidate: RoleOptimizationCandidate = {
    ...candidate,
    state: "rejected",
    rejectedAt: now,
    updatedAt: now,
    metadata: {
      ...candidate.metadata,
      rejectionReason: normalizeText(input.reason) || undefined,
    },
  };
  saveRuntimeUserConsoleStore(
    {
      ...store,
      roleOptimizationCandidates: sortRoleOptimizationCandidates(
        upsertById(removeById(store.roleOptimizationCandidates, normalizedId), rejectedCandidate),
      ),
    },
    {
      ...opts,
      now,
    },
  );
  appendRuntimeEvent(
    "runtime_role_optimization_rejected",
    {
      candidateId: rejectedCandidate.id,
      surfaceId: rejectedCandidate.surfaceId,
      reason: normalizeText(input.reason) || undefined,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    candidate: rejectedCandidate,
  };
}

/**
 * Automatically adopts low-risk user model and role optimizations when enabled.
 * Aligns with v6 self-evolution principles.
 */
export function maybeAutoApplyLowRiskUserOptimizations(opts: RuntimeStoreOptions = {}): {
  userModelAdoptedIds: string[];
  roleAdoptedIds: string[];
} {
  const now = resolveNow(opts.now);
  const store = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const metadata = readUserConsoleMaintenanceMetadata(store.userConsoleStore?.metadata);
  if (!metadata.enabled || !metadata.autoApplyLowRisk) {
    return { userModelAdoptedIds: [], roleAdoptedIds: [] };
  }

  const userModelAdoptedIds: string[] = [];
  const roleAdoptedIds: string[] = [];

  // 1. User Model Optimizations (communicationStyle, reportPolicy etc are low risk)
  if (store.userConsoleStore) {
    for (const candidate of store.userConsoleStore.userModelOptimizationCandidates) {
      if (candidate.state === "recommended") {
        try {
          adoptRuntimeUserModelOptimizationCandidate(candidate.id, { ...opts, now });
          userModelAdoptedIds.push(candidate.id);
        } catch {
          // Continue
        }
      }
    }
  }

  // 2. Role Optimizations
  const refreshedStore = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  if (refreshedStore.userConsoleStore) {
    for (const candidate of refreshedStore.userConsoleStore.roleOptimizationCandidates) {
      if (
        candidate.state === "recommended" &&
        (candidate.metadata as Record<string, unknown>)?.riskLevel === "low"
      ) {
        try {
          adoptRuntimeRoleOptimizationCandidate(candidate.id, { ...opts, now });
          roleAdoptedIds.push(candidate.id);
        } catch {
          // Continue
        }
      }
    }
  }

  return { userModelAdoptedIds, roleAdoptedIds };
}
