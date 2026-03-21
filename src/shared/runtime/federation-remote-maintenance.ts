import type {
  FederationSyncAttemptRecord,
  FederationSyncCursor,
  RuntimeMetadata,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeFederationStore,
  saveRuntimeFederationStore,
  type RuntimeStoreOptions,
} from "./store.js";

export type FederationRemoteSyncMaintenanceControls = {
  enabled: boolean;
  syncIntervalMinutes: number;
  retryAfterFailureMinutes: number;
  configuredAt?: number;
  lastAutoSyncAttemptAt?: number;
  lastAutoSyncAttemptId?: string;
  lastAutoSyncStatus?: "success" | "failed";
  lastAutoSyncSucceededAt?: number;
  lastAutoSyncFailedAt?: number;
  lastAutoSyncError?: string;
};

export type FederationRemoteSyncMaintenanceSummary = {
  enabled: boolean;
  remoteEnabled: boolean;
  remoteConfigured: boolean;
  due: boolean;
  nextSyncAt?: number;
  lastSuccessfulSyncAt?: number;
  lastFailedSyncAt?: number;
  lastAttemptAt?: number;
  lastAttemptStatus?: "success" | "failed";
  blockedReason?: string;
};

export type ConfigureFederationRemoteSyncMaintenanceInput = {
  enabled?: boolean;
  syncIntervalMinutes?: number;
  retryAfterFailureMinutes?: number;
};

export type ConfigureFederationRemoteSyncMaintenanceResult =
  FederationRemoteSyncMaintenanceControls & {
    configuredAt: number;
  };

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(limits.min, Math.min(limits.max, Math.trunc(value)));
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function normalizeSyncStatus(value: unknown): "success" | "failed" | undefined {
  return value === "success" || value === "failed" ? value : undefined;
}

function resolveLastSuccessfulSyncAt(
  syncCursor: FederationSyncCursor | null | undefined,
  controls: FederationRemoteSyncMaintenanceControls,
): number | undefined {
  const lastPushedAt = normalizeTimestamp(syncCursor?.lastPushedAt);
  const lastPulledAt = normalizeTimestamp(syncCursor?.lastPulledAt);
  const lastAutoSyncSucceededAt = normalizeTimestamp(controls.lastAutoSyncSucceededAt);
  const candidates = [lastPushedAt, lastPulledAt, lastAutoSyncSucceededAt].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return Math.max(...candidates);
}

function resolveLastFailedSyncAt(
  controls: FederationRemoteSyncMaintenanceControls,
  latestAttempt?: FederationSyncAttemptRecord | null,
): number | undefined {
  const latestAttemptFailedAt =
    latestAttempt?.status === "failed" ? normalizeTimestamp(latestAttempt.completedAt) : undefined;
  const lastAutoSyncFailedAt = normalizeTimestamp(controls.lastAutoSyncFailedAt);
  const candidates = [latestAttemptFailedAt, lastAutoSyncFailedAt].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return Math.max(...candidates);
}

export function readFederationRemoteSyncMaintenanceControls(
  metadata: RuntimeMetadata | undefined,
): FederationRemoteSyncMaintenanceControls {
  const record = toRecord(metadata?.remoteSyncMaintenance);
  return {
    enabled: record?.enabled !== false,
    syncIntervalMinutes: normalizePositiveInteger(record?.syncIntervalMinutes, 60, {
      min: 1,
      max: 24 * 60,
    }),
    retryAfterFailureMinutes: normalizePositiveInteger(record?.retryAfterFailureMinutes, 15, {
      min: 1,
      max: 24 * 60,
    }),
    configuredAt: normalizeTimestamp(record?.configuredAt),
    lastAutoSyncAttemptAt: normalizeTimestamp(record?.lastAutoSyncAttemptAt),
    lastAutoSyncAttemptId:
      typeof record?.lastAutoSyncAttemptId === "string" ? record.lastAutoSyncAttemptId : undefined,
    lastAutoSyncStatus: normalizeSyncStatus(record?.lastAutoSyncStatus),
    lastAutoSyncSucceededAt: normalizeTimestamp(record?.lastAutoSyncSucceededAt),
    lastAutoSyncFailedAt: normalizeTimestamp(record?.lastAutoSyncFailedAt),
    lastAutoSyncError:
      typeof record?.lastAutoSyncError === "string" && record.lastAutoSyncError.trim().length > 0
        ? record.lastAutoSyncError.trim()
        : undefined,
  };
}

export function summarizeFederationRemoteSyncMaintenance(params: {
  controls: FederationRemoteSyncMaintenanceControls;
  remoteEnabled: boolean;
  remoteConfigured: boolean;
  syncCursor?: FederationSyncCursor | null;
  latestAttempt?: FederationSyncAttemptRecord | null;
  now: number;
}): FederationRemoteSyncMaintenanceSummary {
  const { controls, remoteEnabled, remoteConfigured, syncCursor, latestAttempt, now } = params;
  const lastSuccessfulSyncAt = resolveLastSuccessfulSyncAt(syncCursor, controls);
  const lastFailedSyncAt = resolveLastFailedSyncAt(controls, latestAttempt);
  const lastAttemptAt =
    normalizeTimestamp(latestAttempt?.completedAt) ?? controls.lastAutoSyncAttemptAt;
  const lastAttemptStatus = latestAttempt?.status ?? controls.lastAutoSyncStatus;

  if (!controls.enabled) {
    return {
      enabled: controls.enabled,
      remoteEnabled,
      remoteConfigured,
      due: false,
      lastSuccessfulSyncAt,
      lastFailedSyncAt,
      lastAttemptAt,
      lastAttemptStatus,
      blockedReason: "disabled",
    };
  }
  if (!remoteEnabled) {
    return {
      enabled: controls.enabled,
      remoteEnabled,
      remoteConfigured,
      due: false,
      lastSuccessfulSyncAt,
      lastFailedSyncAt,
      lastAttemptAt,
      lastAttemptStatus,
      blockedReason: "remote_disabled",
    };
  }
  if (!remoteConfigured) {
    return {
      enabled: controls.enabled,
      remoteEnabled,
      remoteConfigured,
      due: false,
      lastSuccessfulSyncAt,
      lastFailedSyncAt,
      lastAttemptAt,
      lastAttemptStatus,
      blockedReason: "remote_unconfigured",
    };
  }

  let nextSyncAt: number | undefined;
  if (
    typeof lastFailedSyncAt === "number" &&
    (typeof lastSuccessfulSyncAt !== "number" || lastFailedSyncAt >= lastSuccessfulSyncAt)
  ) {
    nextSyncAt = lastFailedSyncAt + controls.retryAfterFailureMinutes * 60 * 1000;
  } else if (typeof lastSuccessfulSyncAt === "number") {
    nextSyncAt = lastSuccessfulSyncAt + controls.syncIntervalMinutes * 60 * 1000;
  } else {
    nextSyncAt = now;
  }

  return {
    enabled: controls.enabled,
    remoteEnabled,
    remoteConfigured,
    due: nextSyncAt <= now,
    nextSyncAt,
    lastSuccessfulSyncAt,
    lastFailedSyncAt,
    lastAttemptAt,
    lastAttemptStatus,
  };
}

export function withFederationRemoteSyncMaintenanceAttempt(
  metadata: RuntimeMetadata | undefined,
  input: {
    trigger: "manual" | "scheduled";
    status: "success" | "failed";
    completedAt: number;
    attemptId: string;
    error?: string;
  },
): RuntimeMetadata {
  const nextMetadata: RuntimeMetadata = {
    ...metadata,
  };
  if (input.trigger !== "scheduled") {
    return nextMetadata;
  }
  const current = readFederationRemoteSyncMaintenanceControls(nextMetadata);
  nextMetadata.remoteSyncMaintenance = {
    enabled: current.enabled,
    syncIntervalMinutes: current.syncIntervalMinutes,
    retryAfterFailureMinutes: current.retryAfterFailureMinutes,
    configuredAt: current.configuredAt,
    lastAutoSyncAttemptAt: input.completedAt,
    lastAutoSyncAttemptId: input.attemptId,
    lastAutoSyncStatus: input.status,
    lastAutoSyncSucceededAt:
      input.status === "success" ? input.completedAt : current.lastAutoSyncSucceededAt,
    lastAutoSyncFailedAt:
      input.status === "failed" ? input.completedAt : current.lastAutoSyncFailedAt,
    lastAutoSyncError: input.status === "failed" ? input.error : undefined,
  };
  return nextMetadata;
}

export function configureRuntimeFederationRemoteSyncMaintenance(
  input: ConfigureFederationRemoteSyncMaintenanceInput,
  opts: RuntimeStoreOptions = {},
): ConfigureFederationRemoteSyncMaintenanceResult {
  const now = resolveNow(opts.now);
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const current = readFederationRemoteSyncMaintenanceControls(federationStore.metadata);
  const metadata: RuntimeMetadata = {
    ...federationStore.metadata,
    remoteSyncMaintenance: {
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      syncIntervalMinutes: normalizePositiveInteger(
        input.syncIntervalMinutes,
        current.syncIntervalMinutes,
        { min: 1, max: 24 * 60 },
      ),
      retryAfterFailureMinutes: normalizePositiveInteger(
        input.retryAfterFailureMinutes,
        current.retryAfterFailureMinutes,
        { min: 1, max: 24 * 60 },
      ),
      configuredAt: now,
      lastAutoSyncAttemptAt: current.lastAutoSyncAttemptAt,
      lastAutoSyncAttemptId: current.lastAutoSyncAttemptId,
      lastAutoSyncStatus: current.lastAutoSyncStatus,
      lastAutoSyncSucceededAt: current.lastAutoSyncSucceededAt,
      lastAutoSyncFailedAt: current.lastAutoSyncFailedAt,
      lastAutoSyncError: current.lastAutoSyncError,
    },
  };
  saveRuntimeFederationStore(
    {
      ...federationStore,
      metadata,
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
  const configured = readFederationRemoteSyncMaintenanceControls(metadata);
  appendRuntimeEvent(
    "runtime_federation_remote_sync_maintenance_configured",
    {
      enabled: configured.enabled,
      syncIntervalMinutes: configured.syncIntervalMinutes,
      retryAfterFailureMinutes: configured.retryAfterFailureMinutes,
      configuredAt: now,
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
  return {
    ...configured,
    configuredAt: now,
  };
}
