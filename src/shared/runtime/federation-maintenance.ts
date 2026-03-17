import type { FederationInboxRecord, FederationPackageState, RuntimeMetadata } from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";

const ACTIONABLE_FEDERATION_PACKAGE_STATES = [
  "received",
  "validated",
  "shadowed",
  "recommended",
] as const;

type ActionableFederationPackageState = (typeof ACTIONABLE_FEDERATION_PACKAGE_STATES)[number];

export type FederationInboxMaintenanceControls = {
  enabled: boolean;
  reviewIntervalHours: number;
  expireReceivedAfterHours: number;
  expireValidatedAfterHours: number;
  expireShadowedAfterHours: number;
  expireRecommendedAfterHours: number;
  lastReviewAt?: number;
  lastExpiredAt?: number;
  lastExpiredCount?: number;
};

export type FederationPackageMaintenanceStatus = {
  actionable: boolean;
  state?: ActionableFederationPackageState;
  reviewStartedAt?: number;
  expiresAt?: number;
  expireAfterHours?: number;
  stale: boolean;
};

export type FederationInboxMaintenanceSummary = {
  pendingReviewCount: number;
  stalePackageCount: number;
  nextExpiryAt?: number;
};

export type FederationInboxMaintenanceResult = {
  reviewedAt: number;
  expiredCount: number;
  expiredPackageIds: string[];
  pendingReviewCount: number;
  stalePackageCount: number;
  nextExpiryAt?: number;
};

export type ConfigureFederationInboxMaintenanceInput = {
  enabled?: boolean;
  reviewIntervalHours?: number;
  expireReceivedAfterHours?: number;
  expireValidatedAfterHours?: number;
  expireShadowedAfterHours?: number;
  expireRecommendedAfterHours?: number;
};

export type ConfigureFederationInboxMaintenanceResult = FederationInboxMaintenanceControls & {
  configuredAt: number;
};

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(24 * 365, Math.trunc(value)))
    : fallback;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
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

function resolveStateTimestamp(
  record: FederationInboxRecord,
  state: ActionableFederationPackageState,
): number | undefined {
  if (state === "received") {
    return normalizeTimestamp(record.receivedAt) ?? normalizeTimestamp(record.updatedAt);
  }
  if (state === "validated") {
    return (
      normalizeTimestamp(record.validatedAt) ??
      normalizeTimestamp(record.receivedAt) ??
      normalizeTimestamp(record.updatedAt)
    );
  }
  if (state === "shadowed") {
    return (
      normalizeTimestamp(record.shadowedAt) ??
      normalizeTimestamp(record.validatedAt) ??
      normalizeTimestamp(record.receivedAt) ??
      normalizeTimestamp(record.updatedAt)
    );
  }
  return (
    normalizeTimestamp(record.recommendedAt) ??
    normalizeTimestamp(record.shadowedAt) ??
    normalizeTimestamp(record.validatedAt) ??
    normalizeTimestamp(record.receivedAt) ??
    normalizeTimestamp(record.updatedAt)
  );
}

function resolveExpirationHours(
  controls: FederationInboxMaintenanceControls,
  state: ActionableFederationPackageState,
): number {
  if (state === "received") {
    return controls.expireReceivedAfterHours;
  }
  if (state === "validated") {
    return controls.expireValidatedAfterHours;
  }
  if (state === "shadowed") {
    return controls.expireShadowedAfterHours;
  }
  return controls.expireRecommendedAfterHours;
}

export function isFederationPackageActionableState(
  state: FederationPackageState,
): state is ActionableFederationPackageState {
  return ACTIONABLE_FEDERATION_PACKAGE_STATES.includes(state as ActionableFederationPackageState);
}

export function readFederationInboxMaintenanceControls(
  metadata: RuntimeMetadata | undefined,
): FederationInboxMaintenanceControls {
  const record = toRecord(metadata);
  return {
    enabled: record?.enabled !== false,
    reviewIntervalHours: normalizePositiveInteger(record?.reviewIntervalHours, 12),
    expireReceivedAfterHours: normalizePositiveInteger(record?.expireReceivedAfterHours, 72),
    expireValidatedAfterHours: normalizePositiveInteger(record?.expireValidatedAfterHours, 96),
    expireShadowedAfterHours: normalizePositiveInteger(record?.expireShadowedAfterHours, 120),
    expireRecommendedAfterHours: normalizePositiveInteger(record?.expireRecommendedAfterHours, 168),
    lastReviewAt: normalizeTimestamp(record?.lastReviewAt),
    lastExpiredAt: normalizeTimestamp(record?.lastExpiredAt),
    lastExpiredCount:
      typeof record?.lastExpiredCount === "number" && Number.isFinite(record.lastExpiredCount)
        ? Math.max(0, Math.trunc(record.lastExpiredCount))
        : undefined,
  };
}

export function resolveFederationPackageMaintenanceStatus(
  record: FederationInboxRecord,
  controls: FederationInboxMaintenanceControls,
  now: number,
): FederationPackageMaintenanceStatus {
  if (!isFederationPackageActionableState(record.state)) {
    return {
      actionable: false,
      stale: false,
    };
  }
  const reviewStartedAt = resolveStateTimestamp(record, record.state);
  const expireAfterHours = resolveExpirationHours(controls, record.state);
  const expiresAt = reviewStartedAt ? reviewStartedAt + expireAfterHours * 60 * 60 * 1000 : undefined;
  return {
    actionable: true,
    state: record.state,
    reviewStartedAt,
    expiresAt,
    expireAfterHours,
    stale: typeof expiresAt === "number" ? expiresAt <= now : false,
  };
}

export function summarizeFederationInboxMaintenance(
  records: FederationInboxRecord[],
  controls: FederationInboxMaintenanceControls,
  now: number,
): FederationInboxMaintenanceSummary {
  let pendingReviewCount = 0;
  let stalePackageCount = 0;
  let nextExpiryAt: number | undefined;
  for (const record of records) {
    const status = resolveFederationPackageMaintenanceStatus(record, controls, now);
    if (!status.actionable) {
      continue;
    }
    pendingReviewCount += 1;
    if (status.stale) {
      stalePackageCount += 1;
      continue;
    }
    if (typeof status.expiresAt !== "number") {
      continue;
    }
    if (nextExpiryAt == null || status.expiresAt < nextExpiryAt) {
      nextExpiryAt = status.expiresAt;
    }
  }
  return {
    pendingReviewCount,
    stalePackageCount,
    nextExpiryAt,
  };
}

export function configureRuntimeFederationInboxMaintenance(
  input: ConfigureFederationInboxMaintenanceInput,
  opts: RuntimeStoreOptions = {},
): ConfigureFederationInboxMaintenanceResult {
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
  const current = readFederationInboxMaintenanceControls(federationStore.metadata);
  federationStore.metadata = {
    ...toRecord(federationStore.metadata),
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    reviewIntervalHours: normalizePositiveInteger(
      input.reviewIntervalHours,
      current.reviewIntervalHours,
    ),
    expireReceivedAfterHours: normalizePositiveInteger(
      input.expireReceivedAfterHours,
      current.expireReceivedAfterHours,
    ),
    expireValidatedAfterHours: normalizePositiveInteger(
      input.expireValidatedAfterHours,
      current.expireValidatedAfterHours,
    ),
    expireShadowedAfterHours: normalizePositiveInteger(
      input.expireShadowedAfterHours,
      current.expireShadowedAfterHours,
    ),
    expireRecommendedAfterHours: normalizePositiveInteger(
      input.expireRecommendedAfterHours,
      current.expireRecommendedAfterHours,
    ),
    lastReviewAt: current.lastReviewAt,
    lastExpiredAt: current.lastExpiredAt,
    lastExpiredCount: current.lastExpiredCount,
  };
  saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  const configured = readFederationInboxMaintenanceControls(federationStore.metadata);
  appendRuntimeEvent(
    "runtime_federation_inbox_maintenance_configured",
    {
      enabled: configured.enabled,
      reviewIntervalHours: configured.reviewIntervalHours,
      expireReceivedAfterHours: configured.expireReceivedAfterHours,
      expireValidatedAfterHours: configured.expireValidatedAfterHours,
      expireShadowedAfterHours: configured.expireShadowedAfterHours,
      expireRecommendedAfterHours: configured.expireRecommendedAfterHours,
      lastReviewAt: configured.lastReviewAt,
      lastExpiredAt: configured.lastExpiredAt,
      lastExpiredCount: configured.lastExpiredCount,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    ...configured,
  };
}

export function reviewRuntimeFederationInboxMaintenance(
  opts: RuntimeStoreOptions = {},
): FederationInboxMaintenanceResult {
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
  const controls = readFederationInboxMaintenanceControls(federationStore.metadata);
  const expiredPackageIds: string[] = [];
  const expiredEntries: FederationInboxRecord[] = [];

  federationStore.inbox = federationStore.inbox.map((record) => {
    const status = resolveFederationPackageMaintenanceStatus(record, controls, now);
    if (!status.stale) {
      return record;
    }
    const next = setStateTimestamp(
      {
        ...record,
        state: "expired",
        metadata: {
          ...record.metadata,
          lastTransitionReason: "runtime-federation-inbox-maintenance-expired-stale-package",
          expiredFromState: record.state,
          expiresAt: status.expiresAt,
          expireAfterHours: status.expireAfterHours,
          expiredBy: "runtime-federation-inbox-maintenance",
        },
      },
      "expired",
      now,
    );
    expiredPackageIds.push(next.id);
    expiredEntries.push(next);
    return next;
  });

  const summary = summarizeFederationInboxMaintenance(federationStore.inbox, controls, now);
  federationStore.metadata = {
    ...federationStore.metadata,
    enabled: controls.enabled,
    reviewIntervalHours: controls.reviewIntervalHours,
    expireReceivedAfterHours: controls.expireReceivedAfterHours,
    expireValidatedAfterHours: controls.expireValidatedAfterHours,
    expireShadowedAfterHours: controls.expireShadowedAfterHours,
    expireRecommendedAfterHours: controls.expireRecommendedAfterHours,
    lastReviewAt: now,
    lastExpiredAt: expiredPackageIds.length > 0 ? now : controls.lastExpiredAt,
    lastExpiredCount: expiredPackageIds.length,
  };
  if (expiredPackageIds.length > 0) {
    federationStore.syncCursor = {
      ...(federationStore.syncCursor ?? { updatedAt: now }),
      lastInboxEnvelopeId: expiredPackageIds[expiredPackageIds.length - 1],
      updatedAt: now,
    };
  }
  stores.federationStore = federationStore;
  saveRuntimeStoreBundle(stores, {
    env: opts.env,
    homedir: opts.homedir,
    now,
  });

  for (const entry of expiredEntries) {
    appendRuntimeEvent(
      "federation.package.expired",
      {
        packageId: entry.id,
        packageType: entry.packageType,
        sourceRuntimeId: entry.sourceRuntimeId,
        reason: "runtime-federation-inbox-maintenance-expired-stale-package",
      },
      {
        env: opts.env,
        homedir: opts.homedir,
        now,
      },
    );
  }

  appendRuntimeEvent(
    "runtime_federation_inbox_maintenance_reviewed",
    {
      reviewedAt: now,
      expiredCount: expiredPackageIds.length,
      expiredPackageIds,
      pendingReviewCount: summary.pendingReviewCount,
      stalePackageCount: summary.stalePackageCount,
      nextExpiryAt: summary.nextExpiryAt,
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );

  return {
    reviewedAt: now,
    expiredCount: expiredPackageIds.length,
    expiredPackageIds,
    pendingReviewCount: summary.pendingReviewCount,
    stalePackageCount: summary.stalePackageCount,
    nextExpiryAt: summary.nextExpiryAt,
  };
}
