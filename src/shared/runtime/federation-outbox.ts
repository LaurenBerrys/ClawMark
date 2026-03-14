import fs from "node:fs";
import path from "node:path";
import { resolvePathResolver } from "../../instance/paths.js";
import type {
  CapabilityGovernanceSnapshot,
  RuntimeMetadata,
  RuntimeManifestEnvelope,
  ShadowTelemetryEnvelope,
} from "./contracts.js";
import {
  buildFederationRuntimeSnapshot,
  buildGovernanceSnapshotMetadata,
  buildLatestNewsDigestEnvelope,
  buildLatestStrategyDigestEnvelope,
  buildRuntimeDashboardSnapshot,
} from "./runtime-dashboard.js";
import {
  hasAuthoritativeRuntimeStore,
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  saveRuntimeFederationStore,
} from "./store.js";

export type FederationOutboxSyncOptions = {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  now?: number;
  config?: Record<string, unknown> | null;
};

export type FederationOutboxSyncResult = {
  generatedAt: number;
  runtimeManifestPath: string;
  strategyDigestPath: string;
  newsDigestPath: string;
  shadowTelemetryPath: string;
  capabilityGovernancePath: string;
  syncCursorPath: string;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeEnvelope(root: string, filename: string, payload: unknown): string {
  ensureDir(root);
  const targetPath = path.join(root, filename);
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
  return targetPath;
}

function buildLatestShadowTelemetryEnvelope(
  opts: FederationOutboxSyncOptions = {},
): ShadowTelemetryEnvelope {
  const now = resolveNow(opts.now);
  if (!hasAuthoritativeRuntimeStore({ env: opts.env, homedir: opts.homedir, now })) {
    return {
      id: `shadow-telemetry-${now}`,
      evaluations: [],
      generatedAt: now,
    };
  }
  const governanceStore = loadRuntimeGovernanceStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return {
    id: `shadow-telemetry-${now}`,
    evaluations: [...governanceStore.shadowEvaluations]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 40),
    generatedAt: now,
  };
}

function buildCapabilityGovernanceSnapshot(
  opts: FederationOutboxSyncOptions = {},
): CapabilityGovernanceSnapshot {
  const now = resolveNow(opts.now);
  if (!hasAuthoritativeRuntimeStore({ env: opts.env, homedir: opts.homedir, now })) {
    return {
      id: `capability-governance-${now}`,
      entries: [],
      generatedAt: now,
      metadata: buildGovernanceSnapshotMetadata(opts),
    };
  }
  const governanceStore = loadRuntimeGovernanceStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  return {
    id: `capability-governance-${now}`,
    entries: [...governanceStore.entries]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 80),
    generatedAt: now,
    metadata: buildGovernanceSnapshotMetadata(opts),
  };
}

export function syncRuntimeFederationOutbox(
  opts: FederationOutboxSyncOptions = {},
): FederationOutboxSyncResult {
  const now = resolveNow(opts.now);
  const resolver = resolvePathResolver({
    env: opts.env,
    homedir: opts.homedir,
  });
  const federationRoot = resolver.resolveDataPath("federation");
  const outboxRoot = path.join(federationRoot, "outbox");
  const dashboard = buildRuntimeDashboardSnapshot({
    ...opts,
    now,
  });
  const runtimeManifestEnvelope: RuntimeManifestEnvelope = {
    schemaVersion: "v1",
    type: "runtime-manifest",
    sourceRuntimeId: dashboard.runtimeManifest.instanceId,
    generatedAt: now,
    payload: dashboard.runtimeManifest,
  };
  const strategyDigest = buildLatestStrategyDigestEnvelope({
    ...opts,
    now,
  });
  const newsDigest = buildLatestNewsDigestEnvelope({
    ...opts,
    now,
  });
  const shadowTelemetry = buildLatestShadowTelemetryEnvelope({
    ...opts,
    now,
  });
  const capabilityGovernance = buildCapabilityGovernanceSnapshot({
    ...opts,
    now,
  });
  const runtimeManifestPath = writeEnvelope(
    path.join(outboxRoot, "runtime-manifest"),
    `${dashboard.runtimeManifest.instanceId.replace(/[^a-zA-Z0-9._-]+/g, "_")}-${now}.json`,
    runtimeManifestEnvelope,
  );
  const strategyDigestPath = writeEnvelope(
    path.join(outboxRoot, "strategy-digest"),
    `${strategyDigest.id}.json`,
    strategyDigest,
  );
  const newsDigestPath = writeEnvelope(
    path.join(outboxRoot, "news-digest"),
    `${newsDigest.sourceRuntimeId.replace(/[^a-zA-Z0-9._-]+/g, "_")}-${now}.json`,
    newsDigest,
  );
  const shadowTelemetryPath = writeEnvelope(
    path.join(outboxRoot, "shadow-telemetry"),
    `${shadowTelemetry.id}.json`,
    shadowTelemetry,
  );
  const capabilityGovernancePath = writeEnvelope(
    path.join(outboxRoot, "capability-governance"),
    `${capabilityGovernance.id}.json`,
    capabilityGovernance,
  );
  const federationSnapshot = buildFederationRuntimeSnapshot({
    ...opts,
    now,
    runtimeManifest: dashboard.runtimeManifest,
  });
  const syncCursorPath = path.join(federationRoot, "sync-cursor.json");
  const syncCursor: RuntimeMetadata = {
    generatedAt: now,
    outboxRoot,
    runtimeManifestPath,
    strategyDigestPath,
    newsDigestPath,
    shadowTelemetryPath,
    capabilityGovernancePath,
    pendingAssignments: federationSnapshot.pendingAssignments,
  };
  ensureDir(path.dirname(syncCursorPath));
  fs.writeFileSync(syncCursorPath, JSON.stringify(syncCursor, null, 2), "utf8");
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  saveRuntimeFederationStore(
    {
      ...federationStore,
      syncCursor: {
        ...(federationStore.syncCursor ?? { updatedAt: now }),
        lastPushedAt: now,
        updatedAt: now,
        metadata: {
          ...federationStore.syncCursor?.metadata,
          runtimeManifestPath,
          strategyDigestPath,
          newsDigestPath,
          shadowTelemetryPath,
          capabilityGovernancePath,
        },
      },
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
  return {
    generatedAt: now,
    runtimeManifestPath,
    strategyDigestPath,
    newsDigestPath,
    shadowTelemetryPath,
    capabilityGovernancePath,
    syncCursorPath,
  };
}
