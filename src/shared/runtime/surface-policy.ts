import type {
  SurfaceLocalBusinessPolicy,
  SurfaceLocalBusinessPolicyEscalationTarget,
  SurfaceLocalBusinessPolicyTaskCreation,
  SurfaceOwnerKind,
  SurfaceReportTarget,
} from "./contracts.js";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeRoleScope(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 120) : undefined;
}

function normalizeTaskCreation(value: unknown): SurfaceLocalBusinessPolicyTaskCreation | undefined {
  return value === "disabled" || value === "recommend_only" ? value : undefined;
}

function normalizeEscalationTarget(
  value: unknown,
): SurfaceLocalBusinessPolicyEscalationTarget | undefined {
  return value === "runtime-user" || value === "surface-owner" ? value : undefined;
}

export function normalizeSurfaceReportTarget(value: unknown): SurfaceReportTarget | undefined {
  return value === "runtime-user" || value === "surface-owner" ? value : undefined;
}

export function buildDefaultSurfaceLocalBusinessPolicy(
  ownerKind: SurfaceOwnerKind,
  role: string,
): SurfaceLocalBusinessPolicy {
  return {
    runtimeCoreBinding: "forbidden",
    formalMemoryWrite: false,
    userModelWrite: false,
    surfaceRoleWrite: false,
    taskCreation: "recommend_only",
    escalationTarget: "runtime-user",
    privacyBoundary: ownerKind === "agent" ? "agent-local" : "user-local",
    roleScope: normalizeRoleScope(role) ?? "general",
  };
}

export function hasExplicitSurfaceLocalBusinessPolicy(value: unknown): boolean {
  const record = toRecord(value);
  return !!record && Object.keys(record).length > 0;
}

export function sanitizeSurfaceLocalBusinessPolicy(
  value: unknown,
  opts: {
    ownerKind: SurfaceOwnerKind;
    role: string;
  },
): SurfaceLocalBusinessPolicy {
  const defaults = buildDefaultSurfaceLocalBusinessPolicy(opts.ownerKind, opts.role);
  const record = toRecord(value);
  return {
    runtimeCoreBinding: "forbidden",
    formalMemoryWrite: false,
    userModelWrite: false,
    surfaceRoleWrite: false,
    taskCreation: normalizeTaskCreation(record?.taskCreation) ?? defaults.taskCreation,
    escalationTarget:
      normalizeEscalationTarget(record?.escalationTarget) ?? defaults.escalationTarget,
    privacyBoundary: defaults.privacyBoundary,
    roleScope: normalizeRoleScope(record?.roleScope) ?? defaults.roleScope,
  };
}
