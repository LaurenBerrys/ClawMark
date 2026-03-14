import fs from "node:fs";
import path from "node:path";
import { resolveFetch } from "../../infra/fetch.js";
import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import type { SsrFPolicy } from "../../infra/net/ssrf.js";
import { resolvePathResolver } from "../../instance/paths.js";
import type { FederationInboundPackage, RuntimeMetadata } from "./contracts.js";
import { syncRuntimeFederationInbox, type FederationInboxSyncResult } from "./federation-inbox.js";
import {
  syncRuntimeFederationOutbox,
  type FederationOutboxSyncOptions,
  type FederationOutboxSyncResult,
} from "./federation-outbox.js";
import { buildFederationRuntimeSnapshot } from "./runtime-dashboard.js";
import { loadRuntimeStoreBundle, saveRuntimeStoreBundle } from "./store.js";

type RuntimeOutboxBatchEnvelope = {
  schemaVersion: "v1";
  type: "runtime-outbox-batch";
  sourceRuntimeId: string;
  generatedAt: number;
  cursor?: RuntimeMetadata;
  envelopes: Record<string, unknown>;
};

type RuntimeInboxPullRequest = {
  schemaVersion: "v1";
  type: "runtime-inbox-pull";
  sourceRuntimeId: string;
  generatedAt: number;
  cursor?: RuntimeMetadata;
};

type RuntimeInboxPullResponse = {
  schemaVersion?: string;
  packages?: FederationInboundPackage[];
  payload?: {
    packages?: FederationInboundPackage[];
  };
  cursor?: RuntimeMetadata;
  metadata?: RuntimeMetadata;
};

export type FederationRemoteSyncOptions = FederationOutboxSyncOptions & {
  fetchImpl?: typeof fetch;
  policy?: SsrFPolicy;
};

export type FederationRemoteSyncResult = {
  generatedAt: number;
  pushUrl: string;
  pullUrl: string;
  pushedEnvelopeKeys: string[];
  pulledPackageCount: number;
  outboxSync: FederationOutboxSyncResult;
  inboxSync: FederationInboxSyncResult;
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
  return envelopes;
}

function resolveInboxPackages(payload: RuntimeInboxPullResponse): FederationInboundPackage[] {
  if (Array.isArray(payload.packages)) {
    return payload.packages;
  }
  if (Array.isArray(payload.payload?.packages)) {
    return payload.payload.packages;
  }
  return [];
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolvePackageFileStem(pkg: FederationInboundPackage): string {
  if (pkg.type === "coordinator-suggestion" && typeof pkg.payload.id === "string") {
    return sanitizeFileName(pkg.payload.id);
  }
  return sanitizeFileName(`${pkg.type}-${pkg.sourceRuntimeId}-${pkg.generatedAt}`);
}

function persistInboundPackages(
  packages: FederationInboundPackage[],
  opts: FederationRemoteSyncOptions,
): number {
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const inboxRoot = resolver.resolveDataPath("federation", "inbox", "remote");
  let written = 0;
  for (const pkg of packages) {
    const targetRoot = path.join(inboxRoot, pkg.type);
    ensureDir(targetRoot);
    const targetPath = path.join(targetRoot, `${resolvePackageFileStem(pkg)}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(pkg, null, 2), "utf8");
    written += 1;
  }
  return written;
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
    cursor: stores.federationStore?.syncCursor?.metadata,
    envelopes: resolvePushEnvelopes(snapshot, outboxSync),
  };
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
    cursor: stores.federationStore?.syncCursor?.metadata,
  };
  const pullResponse = await postJson(endpoints.pullUrl, pullRequest, {
    fetchImpl: opts.fetchImpl,
    headers: endpoints.headers,
    timeoutMs: endpoints.timeoutMs,
    policy: endpoints.policy,
  });
  const packages = pullResponse ? resolveInboxPackages(pullResponse) : [];
  persistInboundPackages(packages, opts);
  const inboxSync = syncRuntimeFederationInbox({
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
        updatedAt: now,
        metadata: {
          ...federationStore.syncCursor?.metadata,
          remotePushUrl: endpoints.pushUrl,
          remotePullUrl: endpoints.pullUrl,
          lastRemotePullPackageCount: packages.length,
          remoteCursor: pullResponse?.cursor ?? pullResponse?.metadata,
        },
      },
    };
    saveRuntimeStoreBundle(refreshedStores, {
      env: opts.env,
      homedir: opts.homedir,
      now,
    });
  }

  return {
    generatedAt: now,
    pushUrl: endpoints.pushUrl,
    pullUrl: endpoints.pullUrl,
    pushedEnvelopeKeys: Object.keys(pushBatch.envelopes),
    pulledPackageCount: packages.length,
    outboxSync,
    inboxSync,
  };
}
