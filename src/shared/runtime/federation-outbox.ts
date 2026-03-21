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
  buildLatestShareableMemoryEnvelopes,
  buildLatestShareableReviewEnvelopes,
  buildLatestNewsDigestEnvelope,
  buildLatestStrategyDigestEnvelope,
  buildLatestTeamKnowledgeEnvelope,
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
  journalRoot: string;
  latestOutboxEventId: string | null;
  pendingOutboxEventCount: number;
  pendingEvents: FederationOutboxJournalEventRecord[];
  runtimeManifestPath: string;
  shareableReviewPaths: string[];
  shareableMemoryPaths: string[];
  strategyDigestPath: string;
  newsDigestPath: string;
  shadowTelemetryPath: string;
  capabilityGovernancePath: string;
  teamKnowledgePath: string | null;
  syncCursorPath: string;
};

export type FederationOutboxJournalEventRecord = {
  id: string;
  generatedAt: number;
  sequence: number;
  envelopeKey: string;
  envelopeType: string;
  envelopeId?: string;
  sourceRuntimeId?: string;
  operation: "upsert" | "delete";
  payloadPath?: string | null;
  payloadHash?: string;
  payload?: unknown;
};

type FederationOutboxJournalStateRecord = {
  envelopeKey: string;
  envelopeType: string;
  envelopeId?: string;
  payloadHash: string;
  lastEventId: string;
  lastGeneratedAt: number;
};

type FederationOutboxEmission = {
  envelopeKey: string;
  envelopeType: string;
  envelopeId?: string;
  sourceRuntimeId?: string;
  payloadPath?: string | null;
  payload: unknown;
};

type FederationOutboxEmissionOptions = {
  envelopeId?: string;
  sourceRuntimeId?: string;
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

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hashPayload(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function stripGeneratedAtDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripGeneratedAtDeep(entry));
  }
  const record = toRecord(value);
  if (!record) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "generatedAt") {
      continue;
    }
    normalized[key] = stripGeneratedAtDeep(entry);
  }
  return normalized;
}

function omitRecordKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function normalizePayloadForJournalHash(envelopeType: string, value: unknown): unknown {
  const normalized = stripGeneratedAtDeep(value);
  const record = toRecord(normalized);
  if (!record) {
    return normalized;
  }
  if (
    envelopeType === "shareable-review" ||
    envelopeType === "shareable-memory" ||
    envelopeType === "strategy-digest" ||
    envelopeType === "shadow-telemetry" ||
    envelopeType === "capability-governance"
  ) {
    return omitRecordKeys(record, ["id"]);
  }
  return normalized;
}

function buildJournalEventId(now: number, sequence: number, envelopeKey: string): string {
  return `${String(now).padStart(16, "0")}_${String(sequence).padStart(4, "0")}_${sanitizeFileStem(
    envelopeKey,
  )}`;
}

function readJournalState(
  metadata: RuntimeMetadata | undefined,
): Record<string, FederationOutboxJournalStateRecord> {
  const record = toRecord(metadata);
  const stateRecord = toRecord(record?.outboxJournalState);
  if (!stateRecord) {
    return {};
  }
  const state: Record<string, FederationOutboxJournalStateRecord> = {};
  for (const [key, value] of Object.entries(stateRecord)) {
    const entry = toRecord(value);
    if (!entry) {
      continue;
    }
    const lastEventId =
      typeof entry.lastEventId === "string" && entry.lastEventId.trim()
        ? entry.lastEventId.trim()
        : undefined;
    const payloadHash =
      typeof entry.payloadHash === "string" && entry.payloadHash.trim()
        ? entry.payloadHash.trim()
        : undefined;
    const lastGeneratedAt =
      typeof entry.lastGeneratedAt === "number" && Number.isFinite(entry.lastGeneratedAt)
        ? Math.trunc(entry.lastGeneratedAt)
        : undefined;
    if (!lastEventId || !payloadHash || !lastGeneratedAt) {
      continue;
    }
    state[key] = {
      envelopeKey: key,
      envelopeType:
        typeof entry.envelopeType === "string" && entry.envelopeType.trim()
          ? entry.envelopeType.trim()
          : key,
      envelopeId:
        typeof entry.envelopeId === "string" && entry.envelopeId.trim()
          ? entry.envelopeId.trim()
          : undefined,
      payloadHash,
      lastEventId,
      lastGeneratedAt,
    };
  }
  return state;
}

function writeJournalEvent(journalRoot: string, event: FederationOutboxJournalEventRecord): string {
  ensureDir(journalRoot);
  const targetPath = path.join(journalRoot, `${event.id}.json`);
  fs.writeFileSync(targetPath, JSON.stringify(event, null, 2), "utf8");
  return targetPath;
}

function readJournalEvents(journalRoot: string): FederationOutboxJournalEventRecord[] {
  try {
    return fs
      .readdirSync(journalRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(
        (entry) =>
          JSON.parse(
            fs.readFileSync(path.join(journalRoot, entry.name), "utf8"),
          ) as FederationOutboxJournalEventRecord,
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));
  } catch {
    return [];
  }
}

function clearJsonFiles(root: string): void {
  ensureDir(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      fs.rmSync(path.join(root, entry.name), { force: true });
    }
  }
}

function writeEnvelopeCollection<T extends { id: string }>(root: string, payloads: T[]): string[] {
  clearJsonFiles(root);
  return payloads.map((payload) =>
    writeEnvelope(root, `${sanitizeFileStem(payload.id)}.json`, payload),
  );
}

function createEmission(
  envelopeKey: string,
  envelopeType: string,
  payload: unknown,
  payloadPath?: string | null,
  options: FederationOutboxEmissionOptions = {},
): FederationOutboxEmission {
  const record = toRecord(payload);
  const envelopeId =
    options.envelopeId?.trim() ||
    (typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined);
  const sourceRuntimeId =
    options.sourceRuntimeId?.trim() ||
    (typeof record?.sourceRuntimeId === "string" && record.sourceRuntimeId.trim()
      ? record.sourceRuntimeId.trim()
      : undefined);
  return {
    envelopeKey,
    envelopeType,
    envelopeId,
    sourceRuntimeId,
    payloadPath: payloadPath ?? undefined,
    payload,
  };
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
      mcpGrants: [],
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
    mcpGrants: [...governanceStore.mcpGrants]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 120),
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
  const journalRoot = path.join(federationRoot, "outbox-journal");
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
  const shareableReviews = buildLatestShareableReviewEnvelopes({
    ...opts,
    now,
  });
  const shareableMemories = buildLatestShareableMemoryEnvelopes({
    ...opts,
    now,
  });
  const newsDigest = buildLatestNewsDigestEnvelope({
    ...opts,
    now,
  });
  const teamKnowledge = buildLatestTeamKnowledgeEnvelope({
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
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const previousJournalState = readJournalState(federationStore.metadata);
  const existingJournalEvents = readJournalEvents(journalRoot);
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
  const shareableReviewPaths = writeEnvelopeCollection(
    path.join(outboxRoot, "shareable-review"),
    shareableReviews,
  );
  const shareableMemoryPaths = writeEnvelopeCollection(
    path.join(outboxRoot, "shareable-memory"),
    shareableMemories,
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
  const teamKnowledgeRoot = path.join(outboxRoot, "team-knowledge");
  clearJsonFiles(teamKnowledgeRoot);
  const teamKnowledgePath =
    teamKnowledge.payload.records.length > 0
      ? writeEnvelope(
          teamKnowledgeRoot,
          `${sanitizeFileStem(`${teamKnowledge.sourceRuntimeId}-${teamKnowledge.generatedAt}`)}.json`,
          teamKnowledge,
        )
      : null;
  const emissions: FederationOutboxEmission[] = [
    createEmission(
      "runtimeManifest",
      "runtime-manifest",
      runtimeManifestEnvelope,
      runtimeManifestPath,
      {
        envelopeId: dashboard.runtimeManifest.instanceId,
        sourceRuntimeId: dashboard.runtimeManifest.instanceId,
      },
    ),
    ...shareableReviews.map((payload, index) =>
      createEmission(
        `shareableReview:${payload.taskReview.id}`,
        "shareable-review",
        payload,
        shareableReviewPaths[index] ?? null,
        {
          envelopeId: payload.taskReview.id,
        },
      ),
    ),
    ...shareableMemories.map((payload, index) =>
      createEmission(
        `shareableMemory:${payload.memory.id}`,
        "shareable-memory",
        payload,
        shareableMemoryPaths[index] ?? null,
        {
          envelopeId: payload.memory.id,
        },
      ),
    ),
    createEmission("strategyDigest", "strategy-digest", strategyDigest, strategyDigestPath),
    createEmission("newsDigest", "news-digest", newsDigest, newsDigestPath),
    createEmission("shadowTelemetry", "shadow-telemetry", shadowTelemetry, shadowTelemetryPath),
    createEmission(
      "capabilityGovernance",
      "capability-governance",
      capabilityGovernance,
      capabilityGovernancePath,
    ),
  ];
  if (teamKnowledgePath) {
    emissions.push(
      createEmission(
        `teamKnowledge:${teamKnowledge.sourceRuntimeId}`,
        "team-knowledge",
        teamKnowledge,
        teamKnowledgePath,
        {
          envelopeId: teamKnowledge.sourceRuntimeId,
          sourceRuntimeId: teamKnowledge.sourceRuntimeId,
        },
      ),
    );
  }
  let sequence = existingJournalEvents.length + 1;
  const nextJournalState: Record<string, FederationOutboxJournalStateRecord> = {};
  const emittedEvents: FederationOutboxJournalEventRecord[] = [];
  const activeKeys = new Set<string>();
  for (const emission of emissions) {
    activeKeys.add(emission.envelopeKey);
    const payloadHash = hashPayload(
      normalizePayloadForJournalHash(emission.envelopeType, emission.payload),
    );
    const previous = previousJournalState[emission.envelopeKey];
    if (previous?.payloadHash === payloadHash) {
      nextJournalState[emission.envelopeKey] = previous;
      continue;
    }
    const event: FederationOutboxJournalEventRecord = {
      id: buildJournalEventId(now, sequence, emission.envelopeKey),
      generatedAt: now,
      sequence,
      envelopeKey: emission.envelopeKey,
      envelopeType: emission.envelopeType,
      envelopeId: emission.envelopeId,
      sourceRuntimeId: emission.sourceRuntimeId,
      operation: "upsert",
      payloadPath: emission.payloadPath ?? null,
      payloadHash,
      payload: emission.payload,
    };
    sequence += 1;
    writeJournalEvent(journalRoot, event);
    emittedEvents.push(event);
    nextJournalState[emission.envelopeKey] = {
      envelopeKey: emission.envelopeKey,
      envelopeType: emission.envelopeType,
      envelopeId: emission.envelopeId,
      payloadHash,
      lastEventId: event.id,
      lastGeneratedAt: now,
    };
  }
  for (const [envelopeKey, previous] of Object.entries(previousJournalState)) {
    if (activeKeys.has(envelopeKey)) {
      continue;
    }
    const event: FederationOutboxJournalEventRecord = {
      id: buildJournalEventId(now, sequence, envelopeKey),
      generatedAt: now,
      sequence,
      envelopeKey,
      envelopeType: previous.envelopeType,
      envelopeId: previous.envelopeId,
      operation: "delete",
      payloadPath: null,
      payloadHash: previous.payloadHash,
    };
    sequence += 1;
    writeJournalEvent(journalRoot, event);
    emittedEvents.push(event);
  }
  const allJournalEvents = [...existingJournalEvents, ...emittedEvents].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const latestOutboxEventId = allJournalEvents.at(-1)?.id ?? null;
  const acknowledgedOutboxEventId = federationStore.syncCursor?.lastOutboxEventId;
  const pendingEvents = acknowledgedOutboxEventId
    ? allJournalEvents.filter((event) => event.id.localeCompare(acknowledgedOutboxEventId) > 0)
    : allJournalEvents;
  const federationSnapshot = buildFederationRuntimeSnapshot({
    ...opts,
    now,
    runtimeManifest: dashboard.runtimeManifest,
  });
  const syncCursorPath = path.join(federationRoot, "sync-cursor.json");
  const syncCursor = {
    ...(federationStore.syncCursor ?? { updatedAt: now }),
    updatedAt: now,
    metadata: {
      ...federationStore.syncCursor?.metadata,
      outboxRoot,
      journalRoot,
      localOutboxHeadEventId: latestOutboxEventId,
      pendingOutboxEventCount: pendingEvents.length,
      runtimeManifestPath,
      shareableReviewPaths,
      shareableMemoryPaths,
      strategyDigestPath,
      newsDigestPath,
      shadowTelemetryPath,
      capabilityGovernancePath,
      teamKnowledgePath,
      pendingAssignments: federationSnapshot.pendingAssignments,
    },
  };
  ensureDir(path.dirname(syncCursorPath));
  fs.writeFileSync(syncCursorPath, JSON.stringify(syncCursor, null, 2), "utf8");
  saveRuntimeFederationStore(
    {
      ...federationStore,
      metadata: {
        ...federationStore.metadata,
        outboxJournalState: nextJournalState,
      },
      syncCursor: {
        ...syncCursor,
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
    journalRoot,
    latestOutboxEventId,
    pendingOutboxEventCount: pendingEvents.length,
    pendingEvents,
    runtimeManifestPath,
    shareableReviewPaths,
    shareableMemoryPaths,
    strategyDigestPath,
    newsDigestPath,
    shadowTelemetryPath,
    capabilityGovernancePath,
    teamKnowledgePath,
    syncCursorPath,
  };
}
