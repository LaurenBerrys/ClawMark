import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  FederationInboundPackage,
  FederationInboxRecord,
  FederationPackageState,
  SurfaceRoleOverlay,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";

const ALLOWED_PACKAGE_TYPES = new Set<FederationInboundPackage["type"]>([
  "coordinator-suggestion",
  "shared-strategy-package",
  "team-knowledge-package",
  "role-optimization-package",
  "runtime-policy-overlay-package",
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
  const record = toRecord(value);
  return (
    typeof record?.schemaVersion === "string" &&
    record.schemaVersion === "v1" &&
    typeof record.type === "string" &&
    ALLOWED_PACKAGE_TYPES.has(record.type as FederationInboundPackage["type"]) &&
    typeof record.sourceRuntimeId === "string" &&
    typeof record.generatedAt === "number" &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
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
      return Array.isArray(pkg.payload.records) ? [] : ["payload.records must be an array"];
    case "role-optimization-package":
      return [
        typeof pkg.payload.summary === "string" && pkg.payload.summary.trim().length > 0
          ? null
          : "payload.summary is required",
        toRecord(pkg.payload.proposedOverlay) ? null : "payload.proposedOverlay must be an object",
      ].filter((value): value is string => value != null);
    case "runtime-policy-overlay-package":
      return toRecord(pkg.payload.policy) ? [] : ["payload.policy must be an object"];
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
  const existingOverlay = userConsoleStore.surfaceRoleOverlays.find(
    (entry) => entry.surfaceId === payload.surfaceId,
  );
  const proposed = toRecord(payload.proposedOverlay) ?? {};
  const nextOverlay: SurfaceRoleOverlay = {
    id: existingOverlay?.id ?? `surface-role-${payload.surfaceId}`,
    surfaceId: payload.surfaceId,
    role:
      typeof proposed.role === "string" && proposed.role.trim().length > 0
        ? proposed.role
        : (existingOverlay?.role ?? "optimized-surface-role"),
    businessGoal:
      typeof proposed.businessGoal === "string"
        ? proposed.businessGoal
        : existingOverlay?.businessGoal,
    tone: typeof proposed.tone === "string" ? proposed.tone : existingOverlay?.tone,
    initiative:
      proposed.initiative === "low" ||
      proposed.initiative === "medium" ||
      proposed.initiative === "high"
        ? proposed.initiative
        : existingOverlay?.initiative,
    allowedTopics: Array.isArray(proposed.allowedTopics)
      ? proposed.allowedTopics.filter((value): value is string => typeof value === "string")
      : (existingOverlay?.allowedTopics ?? []),
    restrictedTopics: Array.isArray(proposed.restrictedTopics)
      ? proposed.restrictedTopics.filter((value): value is string => typeof value === "string")
      : (existingOverlay?.restrictedTopics ?? []),
    reportTarget:
      typeof proposed.reportTarget === "string"
        ? proposed.reportTarget
        : existingOverlay?.reportTarget,
    localBusinessPolicy:
      toRecord(proposed.localBusinessPolicy) ?? existingOverlay?.localBusinessPolicy,
    createdAt: existingOverlay?.createdAt ?? now,
    updatedAt: now,
    metadata: existingOverlay?.metadata,
  };
  stores.userConsoleStore = {
    ...userConsoleStore,
    surfaceRoleOverlays: upsertById(userConsoleStore.surfaceRoleOverlays, nextOverlay),
  };
  return {
    ...record,
    metadata: {
      ...record.metadata,
      previousSurfaceRoleOverlay: existingOverlay ?? null,
    },
  };
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
  if (record.payload.type === "team-knowledge-package") {
    const records = record.payload.payload.records.map((entry) => ({
      ...entry,
      namespace: "team-shareable" as const,
      sourceRuntimeId: entry.sourceRuntimeId ?? record.sourceRuntimeId,
      metadata: {
        ...entry.metadata,
        federationPackageId: record.id,
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
          policy: record.payload.payload.policy,
          appliedAt: now,
        },
      },
    };
    return record;
  }
  return record;
}

function revertAdoptedPackage(stores: RuntimeStoreBundle, record: FederationInboxRecord): void {
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
    const previousValue = record.metadata?.previousSurfaceRoleOverlay;
    if (previousValue === null) {
      stores.userConsoleStore = {
        ...userConsoleStore,
        surfaceRoleOverlays: userConsoleStore.surfaceRoleOverlays.filter(
          (entry) => entry.surfaceId !== surfaceId,
        ),
      };
      return;
    }
    const previousOverlay = toRecord(previousValue) as SurfaceRoleOverlay | undefined;
    if (!previousOverlay) {
      return;
    }
    stores.userConsoleStore = {
      ...userConsoleStore,
      surfaceRoleOverlays: upsertById(userConsoleStore.surfaceRoleOverlays, previousOverlay),
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
  const nextInbox = [...federationStore.inbox];
  let received = 0;
  let updated = 0;
  let invalid = 0;
  let lastInboxEnvelopeId = federationStore.syncCursor?.lastInboxEnvelopeId;
  const newRecordIds: string[] = [];

  for (const filePath of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      invalid += 1;
      continue;
    }
    if (!isFederationInboundPackage(parsed)) {
      invalid += 1;
      continue;
    }
    const pkg = parsed;
    const id = resolveFederationPackageId(pkg);
    const validationErrors = validateFederationPackage(pkg);
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
    revertAdoptedPackage(stores, current);
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
