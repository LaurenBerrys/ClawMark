import fs from "node:fs";
import path from "node:path";
import { resolveFetch } from "../../infra/fetch.js";
import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import type { SsrFPolicy } from "../../infra/net/ssrf.js";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  FederationSyncCursor,
  FederationSyncAttemptRecord,
  FederationSyncAttemptStage,
  RuntimeMetadata,
} from "./contracts.js";
import { persistRuntimeFederationAssignments } from "./federation-assignments.js";
import { syncRuntimeFederationInbox, type FederationInboxSyncResult } from "./federation-inbox.js";
import {
  syncRuntimeFederationOutbox,
  type FederationOutboxJournalEventRecord,
  type FederationOutboxSyncOptions,
  type FederationOutboxSyncResult,
} from "./federation-outbox.js";
import { buildFederationPushScopeSuppressions } from "./federation-policy.js";
import { withFederationRemoteSyncMaintenanceAttempt } from "./federation-remote-maintenance.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import { loadRuntimeStoreBundle, saveRuntimeStoreBundle } from "./store.js";

type RuntimeOutboxBatchEnvelope = {
  schemaVersion: "v1";
  type: "runtime-outbox-batch";
  sourceRuntimeId: string;
  generatedAt: number;
  cursor?: FederationSyncCursor;
  events: FederationOutboxJournalEventRecord[];
  envelopes: Record<string, unknown>;
};

type RuntimeInboxPullRequest = {
  schemaVersion: "v1";
  type: "runtime-inbox-pull";
  sourceRuntimeId: string;
  generatedAt: number;
  cursor?: FederationSyncCursor;
};

type RuntimeInboxPullResponse = {
  schemaVersion?: string;
  packages?: unknown[];
  assignments?: unknown[];
  payload?: {
    packages?: unknown[];
    assignments?: unknown[];
  };
  cursor?: RuntimeMetadata;
  metadata?: RuntimeMetadata;
};

export type FederationRemoteSyncOptions = FederationOutboxSyncOptions & {
  fetchImpl?: typeof fetch;
  policy?: SsrFPolicy;
  trigger?: "manual" | "scheduled";
};

export type FederationRemoteSyncResult = {
  generatedAt: number;
  pushUrl: string;
  pullUrl: string;
  pushedEnvelopeKeys: string[];
  pulledPackageCount: number;
  pulledAssignmentCount: number;
  outboxSync: FederationOutboxSyncResult;
  inboxSync: FederationInboxSyncResult;
};

export type FederationRemoteSyncPreview = {
  generatedAt: number;
  enabled: boolean;
  remoteConfigured: boolean;
  ready: boolean;
  issue: string | null;
  pushUrl: string | null;
  pullUrl: string | null;
  timeoutMs: number | null;
  allowedPushScopes: string[];
  blockedPushScopes: string[];
  suppressedPushScopes: Array<{
    scope: string;
    envelopeCount: number;
    envelopeKinds: string[];
  }>;
  localOutboxHeadEventId: string | null;
  acknowledgedOutboxEventId: string | null;
  pendingOutboxEventCount: number;
  pushedEnvelopeKeys: string[];
  envelopeCounts: {
    runtimeManifest: number;
    shareableReviews: number;
    shareableMemories: number;
    strategyDigest: number;
    newsDigest: number;
    shadowTelemetry: number;
    capabilityGovernance: number;
    teamKnowledge: number;
  };
  pendingEvents: Array<{
    id: string;
    envelopeKey: string;
    envelopeType: string;
    envelopeId?: string;
    operation: "upsert" | "delete";
    generatedAt: number;
    summary: string;
  }>;
  cursor: FederationSyncCursor | null;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function trimToString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string")));
}

function joinUrlPath(baseUrl: string, segment: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(segment.replace(/^\/+/, ""), normalizedBase).toString();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFederationConfigRecord(
  config: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const direct = toRecord(config?.federation);
  if (direct) {
    return direct;
  }
  const runtime = toRecord(config?.runtime);
  const runtimeFederation = toRecord(runtime?.federation);
  if (runtimeFederation) {
    return runtimeFederation;
  }
  const brain = toRecord(config?.brain);
  return toRecord(brain?.federation);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonFiles(filePaths: string[]): unknown[] {
  return filePaths.map((filePath) => readJsonFile(filePath));
}

function resolveRemoteHeaders(remote: Record<string, unknown> | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token =
    trimToString(remote?.bearerToken) ??
    trimToString(remote?.token) ??
    trimToString(remote?.apiKey);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const extraHeaders = toRecord(remote?.headers);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    const normalized = trimToString(value);
    if (!normalized) {
      continue;
    }
    headers[key] = normalized;
  }
  return headers;
}

function resolveRemotePolicy(
  remote: Record<string, unknown> | null,
  override?: SsrFPolicy,
): SsrFPolicy | undefined {
  if (override) {
    return override;
  }
  const allowedHostnamesRaw = Array.isArray(remote?.allowedHostnames)
    ? remote.allowedHostnames
    : [];
  const hostnameAllowlistRaw = Array.isArray(remote?.hostnameAllowlist)
    ? remote.hostnameAllowlist
    : [];
  const allowedHostnames = uniqueStrings(allowedHostnamesRaw.map((value) => trimToString(value)));
  const hostnameAllowlist = uniqueStrings(hostnameAllowlistRaw.map((value) => trimToString(value)));
  if (
    remote?.allowPrivateNetwork !== true &&
    remote?.dangerouslyAllowPrivateNetwork !== true &&
    allowedHostnames.length === 0 &&
    hostnameAllowlist.length === 0
  ) {
    return undefined;
  }
  return {
    allowPrivateNetwork: remote?.allowPrivateNetwork === true,
    dangerouslyAllowPrivateNetwork: remote?.dangerouslyAllowPrivateNetwork === true,
    allowedHostnames,
    hostnameAllowlist,
  };
}

function resolveRemoteEndpoints(config: Record<string, unknown> | null): {
  pushUrl: string;
  pullUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  policy?: SsrFPolicy;
} {
  const federation = readFederationConfigRecord(config);
  const remote = toRecord(federation?.remote);
  if (federation?.enabled === false || remote?.enabled === false) {
    throw new Error("federation remote sync is disabled");
  }
  const baseUrl =
    trimToString(remote?.url) ??
    trimToString(remote?.endpoint) ??
    trimToString(remote?.baseUrl) ??
    trimToString(remote?.origin);
  const explicitPushUrl =
    trimToString(remote?.pushUrl) ??
    trimToString(remote?.outboxUrl) ??
    trimToString(remote?.publishUrl);
  const explicitPullUrl =
    trimToString(remote?.pullUrl) ??
    trimToString(remote?.inboxUrl) ??
    trimToString(remote?.assignmentInbox);
  const pushUrl = explicitPushUrl ?? (baseUrl ? joinUrlPath(baseUrl, "outbox") : undefined);
  const pullUrl = explicitPullUrl ?? (baseUrl ? joinUrlPath(baseUrl, "inbox") : undefined);
  if (!pushUrl || !pullUrl) {
    throw new Error("federation remote push/pull endpoints are not fully configured");
  }
  return {
    pushUrl,
    pullUrl,
    headers: resolveRemoteHeaders(remote),
    timeoutMs:
      typeof remote?.timeoutMs === "number" && Number.isFinite(remote.timeoutMs)
        ? Math.max(1_000, Math.trunc(remote.timeoutMs))
        : 15_000,
    policy: resolveRemotePolicy(remote),
  };
}

function resolvePushEnvelopes(
  snapshot: ReturnType<typeof buildFederationRuntimeSnapshot>,
  outboxSync: FederationOutboxSyncResult,
): Record<string, unknown> {
  const envelopes: Record<string, unknown> = {
    runtimeManifest: readJsonFile(outboxSync.runtimeManifestPath),
  };
  if (snapshot.allowedPushScopes.includes("shareable_derived")) {
    if (outboxSync.shareableReviewPaths.length > 0) {
      envelopes.shareableReviews = readJsonFiles(outboxSync.shareableReviewPaths);
    }
    if (outboxSync.shareableMemoryPaths.length > 0) {
      envelopes.shareableMemories = readJsonFiles(outboxSync.shareableMemoryPaths);
    }
  }
  if (snapshot.allowedPushScopes.includes("strategy_digest")) {
    envelopes.strategyDigest = readJsonFile(outboxSync.strategyDigestPath);
  }
  if (snapshot.allowedPushScopes.includes("news_digest")) {
    envelopes.newsDigest = readJsonFile(outboxSync.newsDigestPath);
  }
  if (snapshot.allowedPushScopes.includes("shadow_telemetry")) {
    envelopes.shadowTelemetry = readJsonFile(outboxSync.shadowTelemetryPath);
  }
  if (snapshot.allowedPushScopes.includes("capability_governance")) {
    envelopes.capabilityGovernance = readJsonFile(outboxSync.capabilityGovernancePath);
  }
  if (
    snapshot.allowedPushScopes.includes("team_shareable_knowledge") &&
    outboxSync.teamKnowledgePath
  ) {
    envelopes.teamKnowledge = readJsonFile(outboxSync.teamKnowledgePath);
  }
  return envelopes;
}

function buildPreviewEnvelopeCounts(
  envelopes: Record<string, unknown>,
): FederationRemoteSyncPreview["envelopeCounts"] {
  const countEntries = (value: unknown): number =>
    Array.isArray(value) ? value.length : value ? 1 : 0;
  return {
    runtimeManifest: countEntries(envelopes.runtimeManifest),
    shareableReviews: countEntries(envelopes.shareableReviews),
    shareableMemories: countEntries(envelopes.shareableMemories),
    strategyDigest: countEntries(envelopes.strategyDigest),
    newsDigest: countEntries(envelopes.newsDigest),
    shadowTelemetry: countEntries(envelopes.shadowTelemetry),
    capabilityGovernance: countEntries(envelopes.capabilityGovernance),
    teamKnowledge: countEntries(envelopes.teamKnowledge),
  };
}

function summarizePendingEvent(event: FederationOutboxJournalEventRecord): string {
  if (event.operation === "delete") {
    return `delete ${event.envelopeType}`;
  }
  if (event.envelopeId) {
    return `${event.envelopeType} ${event.envelopeId}`;
  }
  return `${event.envelopeType} ${event.envelopeKey}`;
}

function resolveInboxPackages(payload: RuntimeInboxPullResponse): unknown[] {
  if (Array.isArray(payload.packages)) {
    return payload.packages;
  }
  if (Array.isArray(payload.payload?.packages)) {
    return payload.payload.packages;
  }
  return [];
}

function resolveAssignmentPayloads(payload: RuntimeInboxPullResponse): unknown[] {
  if (Array.isArray(payload.assignments)) {
    return payload.assignments;
  }
  if (Array.isArray(payload.payload?.assignments)) {
    return payload.payload.assignments;
  }
  return [];
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolvePackageGeneratedAt(raw: unknown): number | undefined {
  const record = toRecord(raw);
  if (typeof record?.generatedAt === "number" && Number.isFinite(record.generatedAt)) {
    return Math.trunc(record.generatedAt);
  }
  return undefined;
}

function resolvePackageType(raw: unknown): string | undefined {
  return trimToString(toRecord(raw)?.type);
}

function resolvePackageSourceRuntimeId(raw: unknown): string | undefined {
  return trimToString(toRecord(raw)?.sourceRuntimeId);
}

function resolvePackagePayloadId(raw: unknown): string | undefined {
  return trimToString(toRecord(toRecord(raw)?.payload)?.id);
}

function resolvePackageFileStem(raw: unknown, now: number): string {
  const declaredType = resolvePackageType(raw);
  const payloadId = resolvePackagePayloadId(raw);
  if (declaredType === "coordinator-suggestion" && payloadId) {
    return sanitizeFileName(payloadId);
  }
  return sanitizeFileName(
    `${declaredType ?? "invalid-package"}-${resolvePackageSourceRuntimeId(raw) ?? "unknown-runtime"}-${resolvePackageGeneratedAt(raw) ?? now}`,
  );
}

function readSyncAttempts(metadata: RuntimeMetadata | undefined): FederationSyncAttemptRecord[] {
  const raw = Array.isArray(toRecord(metadata)?.syncAttempts)
    ? (toRecord(metadata)?.syncAttempts as unknown[])
    : [];
  return raw
    .map((entry) => {
      const record = toRecord(entry);
      if (!record || typeof record.id !== "string") {
        return null;
      }
      const stage = record.stage;
      const attempt: FederationSyncAttemptRecord = {
        id: record.id,
        status: record.status === "failed" ? "failed" : "success",
        stage:
          stage === "prepare" ||
          stage === "push" ||
          stage === "pull" ||
          stage === "persist_inbox" ||
          stage === "sync_inbox"
            ? stage
            : "prepare",
        startedAt:
          typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
            ? Number(record.startedAt)
            : 0,
        completedAt:
          typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
            ? Number(record.completedAt)
            : 0,
        pushUrl: trimToString(record.pushUrl),
        pullUrl: trimToString(record.pullUrl),
        pushedEnvelopeKeys: Array.isArray(record.pushedEnvelopeKeys)
          ? record.pushedEnvelopeKeys.filter((value): value is string => typeof value === "string")
          : [],
        pulledPackageCount:
          typeof record.pulledPackageCount === "number" &&
          Number.isFinite(record.pulledPackageCount)
            ? Number(record.pulledPackageCount)
            : 0,
        inboxProcessedCount:
          typeof record.inboxProcessedCount === "number" &&
          Number.isFinite(record.inboxProcessedCount)
            ? Number(record.inboxProcessedCount)
            : 0,
        retryable: record.retryable !== false,
        error: trimToString(record.error),
        metadata: toRecord(record.metadata) ?? undefined,
      };
      return attempt;
    })
    .filter((entry): entry is FederationSyncAttemptRecord => entry != null);
}

function writeSyncAttempt(
  stores: ReturnType<typeof loadRuntimeStoreBundle>,
  attempt: FederationSyncAttemptRecord,
  opts: FederationRemoteSyncOptions,
): void {
  const federationStore = stores.federationStore;
  if (!federationStore) {
    return;
  }
  const existing = readSyncAttempts(federationStore.metadata);
  const nextAttempts = [attempt, ...existing.filter((entry) => entry.id !== attempt.id)]
    .toSorted(
      (left, right) => right.completedAt - left.completedAt || left.id.localeCompare(right.id),
    )
    .slice(0, 20);
  stores.federationStore = {
    ...federationStore,
    metadata: {
      ...withFederationRemoteSyncMaintenanceAttempt(
        {
          ...federationStore.metadata,
          syncAttempts: nextAttempts,
        },
        {
          trigger: opts.trigger ?? "manual",
          status: attempt.status,
          completedAt: attempt.completedAt,
          attemptId: attempt.id,
          error: attempt.error,
        },
      ),
    },
  };
  saveRuntimeStoreBundle(stores, {
    env: opts.env,
    homedir: opts.homedir,
    now: attempt.completedAt,
  });
}

function persistInboundPackages(packages: unknown[], opts: FederationRemoteSyncOptions): number {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const inboxRoot = resolver.resolveDataPath("federation", "inbox", "remote");
  let written = 0;
  for (const pkg of packages) {
    const targetRoot = path.join(inboxRoot, resolvePackageType(pkg) ?? "invalid-package");
    ensureDir(targetRoot);
    const targetPath = path.join(
      targetRoot,
      `${resolvePackageFileStem(pkg, resolveNow(opts.now))}.json`,
    );
    fs.writeFileSync(targetPath, JSON.stringify(pkg, null, 2), "utf8");
    written += 1;
  }
  return written;
}

function persistInboundAssignments(
  assignments: unknown[],
  opts: FederationRemoteSyncOptions,
): number {
  return persistRuntimeFederationAssignments(assignments, opts).length;
}

async function postJson(
  url: string,
  body: unknown,
  params: {
    fetchImpl?: typeof fetch;
    headers: Record<string, string>;
    timeoutMs: number;
    policy?: SsrFPolicy;
  },
): Promise<RuntimeInboxPullResponse | null> {
  const result = await fetchWithSsrFGuard({
    url,
    fetchImpl: resolveFetch(params.fetchImpl),
    timeoutMs: params.timeoutMs,
    policy: params.policy,
    init: {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(body),
    },
  });
  try {
    if (!result.response.ok) {
      throw new Error(`federation remote sync failed with status ${result.response.status}`);
    }
    const text = await result.response.text();
    if (!text.trim()) {
      return null;
    }
    return JSON.parse(text) as RuntimeInboxPullResponse;
  } finally {
    await result.release();
  }
}

export function previewRuntimeFederationRemote(
  opts: FederationRemoteSyncOptions = {},
): FederationRemoteSyncPreview {
  const now = resolveNow(opts.now);
  const outboxSync = syncRuntimeFederationOutbox({
    ...opts,
    now,
  });
  const snapshot = buildFederationRuntimeSnapshot({
    ...opts,
    now,
  });
  const envelopes = resolvePushEnvelopes(snapshot, outboxSync);
  const envelopeCounts = buildPreviewEnvelopeCounts(envelopes);
  let endpoints: ReturnType<typeof resolveRemoteEndpoints> | null = null;
  let issue: string | null = null;
  try {
    endpoints = resolveRemoteEndpoints(opts.config ?? null);
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error);
  }
  return {
    generatedAt: now,
    enabled: snapshot.enabled,
    remoteConfigured: snapshot.remoteConfigured,
    ready: issue == null,
    issue,
    pushUrl: endpoints?.pushUrl ?? null,
    pullUrl: endpoints?.pullUrl ?? null,
    timeoutMs: endpoints?.timeoutMs ?? null,
    allowedPushScopes: [...snapshot.allowedPushScopes],
    blockedPushScopes: [...snapshot.blockedPushScopes],
    suppressedPushScopes: buildFederationPushScopeSuppressions({
      allowedPushScopes: snapshot.allowedPushScopes,
      counts: snapshot.outboxEnvelopeCounts,
    }),
    localOutboxHeadEventId: snapshot.localOutboxHeadEventId,
    acknowledgedOutboxEventId: snapshot.acknowledgedOutboxEventId,
    pendingOutboxEventCount: outboxSync.pendingOutboxEventCount,
    pushedEnvelopeKeys: Object.keys(envelopes),
    envelopeCounts,
    pendingEvents: outboxSync.pendingEvents.slice(0, 12).map((event) => ({
      id: event.id,
      envelopeKey: event.envelopeKey,
      envelopeType: event.envelopeType,
      envelopeId: event.envelopeId,
      operation: event.operation,
      generatedAt: event.generatedAt,
      summary: summarizePendingEvent(event),
    })),
    cursor: snapshot.syncCursor,
  };
}

export async function syncRuntimeFederationRemote(
  opts: FederationRemoteSyncOptions = {},
): Promise<FederationRemoteSyncResult> {
  const now = resolveNow(opts.now);
  const endpoints = resolveRemoteEndpoints(opts.config ?? null);
  const outboxSync = syncRuntimeFederationOutbox({
    ...opts,
    now,
  });
  const snapshot = buildFederationRuntimeSnapshot({
    ...opts,
    now,
  });
  const stores = loadRuntimeStoreBundle({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const pushBatch: RuntimeOutboxBatchEnvelope = {
    schemaVersion: "v1",
    type: "runtime-outbox-batch",
    sourceRuntimeId: snapshot.manifest.instanceId,
    generatedAt: now,
    cursor: stores.federationStore?.syncCursor,
    events: outboxSync.pendingEvents,
    envelopes: resolvePushEnvelopes(snapshot, outboxSync),
  };
  let stage: FederationSyncAttemptStage = "prepare";
  let packages: unknown[] = [];
  let assignments: unknown[] = [];
  let inboxSync: FederationInboxSyncResult | null = null;
  let pullResponse: RuntimeInboxPullResponse | null = null;
  const pushedEnvelopeKeys = Object.keys(pushBatch.envelopes);

  try {
    stage = "push";
    await postJson(endpoints.pushUrl, pushBatch, {
      fetchImpl: opts.fetchImpl,
      headers: endpoints.headers,
      timeoutMs: endpoints.timeoutMs,
      policy: endpoints.policy,
    });

    const pullRequest: RuntimeInboxPullRequest = {
      schemaVersion: "v1",
      type: "runtime-inbox-pull",
      sourceRuntimeId: snapshot.manifest.instanceId,
      generatedAt: now,
      cursor: stores.federationStore?.syncCursor,
    };
    stage = "pull";
    pullResponse = await postJson(endpoints.pullUrl, pullRequest, {
      fetchImpl: opts.fetchImpl,
      headers: endpoints.headers,
      timeoutMs: endpoints.timeoutMs,
      policy: endpoints.policy,
    });
    packages = pullResponse ? resolveInboxPackages(pullResponse) : [];
    assignments = pullResponse ? resolveAssignmentPayloads(pullResponse) : [];

    stage = "persist_inbox";
    persistInboundPackages(packages, opts);
    persistInboundAssignments(assignments, opts);

    stage = "sync_inbox";
    inboxSync = syncRuntimeFederationInbox({
      ...opts,
      now,
    });

    const refreshedStores = loadRuntimeStoreBundle({
      env: opts.env,
      homedir: opts.homedir,
      now,
    });
    const federationStore = refreshedStores.federationStore;
    if (federationStore) {
      refreshedStores.federationStore = {
        ...federationStore,
        syncCursor: {
          ...(federationStore.syncCursor ?? { updatedAt: now }),
          lastPushedAt: now,
          lastPulledAt: now,
          lastOutboxEventId:
            outboxSync.latestOutboxEventId ?? federationStore.syncCursor?.lastOutboxEventId,
          lastInboxEnvelopeId:
            refreshedStores.federationStore?.syncCursor?.lastInboxEnvelopeId ??
            federationStore.syncCursor?.lastInboxEnvelopeId,
          updatedAt: now,
          metadata: {
            ...federationStore.syncCursor?.metadata,
            localOutboxHeadEventId: outboxSync.latestOutboxEventId,
            pendingOutboxEventCount: 0,
            remotePushUrl: endpoints.pushUrl,
            remotePullUrl: endpoints.pullUrl,
            lastRemotePullPackageCount: packages.length,
            lastRemotePullAssignmentCount: assignments.length,
            remoteCursor: pullResponse?.cursor ?? pullResponse?.metadata,
          },
        },
      };
      writeSyncAttempt(
        refreshedStores,
        {
          id: `federation-sync-${now}`,
          status: "success",
          stage: "sync_inbox",
          startedAt: now,
          completedAt: now,
          pushUrl: endpoints.pushUrl,
          pullUrl: endpoints.pullUrl,
          pushedEnvelopeKeys,
          pulledPackageCount: packages.length,
          inboxProcessedCount: inboxSync.processed,
          retryable: false,
          metadata: {
            received: inboxSync.received,
            updated: inboxSync.updated,
            invalid: inboxSync.invalid,
            pulledAssignmentCount: assignments.length,
            pushedEventIds: outboxSync.pendingEvents.map((event) => event.id),
            acknowledgedOutboxEventId: outboxSync.latestOutboxEventId,
          },
        },
        opts,
      );
    }

    return {
      generatedAt: now,
      pushUrl: endpoints.pushUrl,
      pullUrl: endpoints.pullUrl,
      pushedEnvelopeKeys,
      pulledPackageCount: packages.length,
      pulledAssignmentCount: assignments.length,
      outboxSync,
      inboxSync,
    };
  } catch (error) {
    writeSyncAttempt(
      loadRuntimeStoreBundle({
        env: opts.env,
        homedir: opts.homedir,
        now,
      }),
      {
        id: `federation-sync-${now}`,
        status: "failed",
        stage,
        startedAt: now,
        completedAt: now,
        pushUrl: endpoints.pushUrl,
        pullUrl: endpoints.pullUrl,
        pushedEnvelopeKeys,
        pulledPackageCount: packages.length,
        inboxProcessedCount: inboxSync?.processed ?? 0,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          pulledAssignmentCount: assignments.length,
        },
      },
      opts,
    );
    throw error;
  }
}
