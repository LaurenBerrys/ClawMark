import type { RuntimeMetadata } from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeFederationStore,
  saveRuntimeFederationStore,
  type RuntimeStoreOptions,
} from "./store.js";

export const DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES = [
  "shareable_derived",
  "shadow_telemetry",
  "strategy_digest",
  "news_digest",
  "capability_governance",
  "team_shareable_knowledge",
] as const;

export const DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES = [
  "raw_chat",
  "secrets",
  "durable_private_memory_dump",
] as const;

export const KNOWN_FEDERATION_PUSH_SCOPES = [
  ...DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES,
  ...DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES,
] as const;

export type FederationPushScope = (typeof KNOWN_FEDERATION_PUSH_SCOPES)[number];

export type FederationPushPolicyControls = {
  allowedPushScopes: FederationPushScope[];
  blockedPushScopes: FederationPushScope[];
  shareablePushScopeCatalog: FederationPushScope[];
  requiredBlockedPushScopes: FederationPushScope[];
  configuredAt?: number;
};

export type FederationPushScopeSuppression = {
  scope: FederationPushScope;
  envelopeCount: number;
  envelopeKinds: string[];
};

export type ConfigureFederationPushPolicyInput = {
  allowedPushScopes?: string[];
};

export type ConfigureFederationPushPolicyResult = FederationPushPolicyControls & {
  configuredAt: number;
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function parseScopeList(value: unknown): FederationPushScope[] {
  if (typeof value === "string") {
    return uniqueStrings(
      value
        .split(/[,\s]+/)
        .map((entry) => entry.trim()),
    ).filter((entry): entry is FederationPushScope =>
      (KNOWN_FEDERATION_PUSH_SCOPES as readonly string[]).includes(entry),
    );
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value.map((entry) => (typeof entry === "string" ? entry.trim() : "")),
  ).filter((entry): entry is FederationPushScope =>
    (KNOWN_FEDERATION_PUSH_SCOPES as readonly string[]).includes(entry),
  );
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

function readConfiguredAt(metadata: RuntimeMetadata | undefined): number | undefined {
  const record = toRecord(metadata?.pushPolicy);
  const configuredAt = Number(record?.configuredAt);
  return Number.isFinite(configuredAt) && configuredAt > 0 ? Math.trunc(configuredAt) : undefined;
}

export function resolveFederationPushPolicy(
  config: Record<string, unknown> | null,
  metadata?: RuntimeMetadata,
): FederationPushPolicyControls & {
  enabled: boolean;
  remoteConfigured: boolean;
} {
  const federation = readFederationConfigRecord(config);
  const remote = toRecord(federation?.remote);
  const push = toRecord(federation?.push);
  const metadataPolicy = toRecord(metadata?.pushPolicy);
  const explicitAllowed = parseScopeList(
    push?.allowedScopes ?? push?.scopes ?? federation?.allowedPushScopes,
  );
  const explicitBlocked = parseScopeList(
    push?.blockedScopes ?? push?.deny ?? federation?.blockedPushScopes,
  );
  const hasMetadataAllowed = Array.isArray(metadataPolicy?.allowedPushScopes);
  const metadataAllowed = parseScopeList(metadataPolicy?.allowedPushScopes);
  const allowedSeed = hasMetadataAllowed
    ? metadataAllowed
    : explicitAllowed.length > 0
      ? explicitAllowed.filter((scope) =>
          (DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES as readonly string[]).includes(scope),
        )
      : [...DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES];
  const requiredBlockedPushScopes = [...DEFAULT_FEDERATION_BLOCKED_PUSH_SCOPES];
  const blockedPushScopes = uniqueStrings([
    ...requiredBlockedPushScopes,
    ...explicitBlocked,
  ]) as FederationPushScope[];
  const allowedPushScopes = uniqueStrings(
    allowedSeed.filter(
      (scope) =>
        (DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES as readonly string[]).includes(scope) &&
        !blockedPushScopes.includes(scope),
    ),
  ) as FederationPushScope[];
  const remoteConfigured =
    typeof remote?.enabled === "boolean"
      ? remote.enabled &&
        uniqueStrings([
          typeof remote.url === "string" ? remote.url : undefined,
          typeof remote.endpoint === "string" ? remote.endpoint : undefined,
          typeof remote.baseUrl === "string" ? remote.baseUrl : undefined,
          typeof remote.origin === "string" ? remote.origin : undefined,
          typeof remote.assignmentInbox === "string" ? remote.assignmentInbox : undefined,
        ]).length > 0
      : uniqueStrings([
          typeof remote?.url === "string" ? remote.url : undefined,
          typeof remote?.endpoint === "string" ? remote.endpoint : undefined,
          typeof remote?.baseUrl === "string" ? remote.baseUrl : undefined,
          typeof remote?.origin === "string" ? remote.origin : undefined,
          typeof remote?.assignmentInbox === "string" ? remote.assignmentInbox : undefined,
        ]).length > 0;
  return {
    enabled: federation?.enabled !== false,
    remoteConfigured,
    allowedPushScopes,
    blockedPushScopes,
    shareablePushScopeCatalog: [...DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES],
    requiredBlockedPushScopes,
    configuredAt: readConfiguredAt(metadata),
  };
}

export function configureRuntimeFederationPushPolicy(
  input: ConfigureFederationPushPolicyInput,
  opts: RuntimeStoreOptions = {},
): ConfigureFederationPushPolicyResult {
  const now = resolveNow(opts.now);
  const federationStore = loadRuntimeFederationStore({
    env: opts.env,
    homedir: opts.homedir,
    now,
  });
  const allowedPushScopes = parseScopeList(input.allowedPushScopes).filter((scope) =>
    (DEFAULT_FEDERATION_ALLOWED_PUSH_SCOPES as readonly string[]).includes(scope),
  );
  const metadata: RuntimeMetadata = {
    ...federationStore.metadata,
    pushPolicy: {
      allowedPushScopes,
      configuredAt: now,
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
  appendRuntimeEvent(
    "runtime_federation_push_policy_configured",
    {
      allowedPushScopes,
    },
    {
      env: opts.env,
      homedir: opts.homedir,
      now,
    },
  );
  const resolved = resolveFederationPushPolicy(null, metadata);
  return {
    configuredAt: now,
    allowedPushScopes: resolved.allowedPushScopes,
    blockedPushScopes: resolved.blockedPushScopes,
    shareablePushScopeCatalog: resolved.shareablePushScopeCatalog,
    requiredBlockedPushScopes: resolved.requiredBlockedPushScopes,
  };
}

export function buildFederationPushScopeSuppressions(params: {
  allowedPushScopes: string[];
  counts: {
    shareableReview: number;
    shareableMemory: number;
    strategyDigest: number;
    newsDigest: number;
    shadowTelemetry: number;
    capabilityGovernance: number;
    teamKnowledge: number;
  };
}): FederationPushScopeSuppression[] {
  const allowed = new Set(params.allowedPushScopes);
  const suppressionInputs: Array<{
    scope: FederationPushScope;
    count: number;
    kinds: string[];
  }> = [
    {
      scope: "shareable_derived",
      count: params.counts.shareableReview + params.counts.shareableMemory,
      kinds: [
        ...(params.counts.shareableReview > 0 ? ["shareable-review"] : []),
        ...(params.counts.shareableMemory > 0 ? ["shareable-memory"] : []),
      ],
    },
    {
      scope: "strategy_digest",
      count: params.counts.strategyDigest,
      kinds: params.counts.strategyDigest > 0 ? ["strategy-digest"] : [],
    },
    {
      scope: "news_digest",
      count: params.counts.newsDigest,
      kinds: params.counts.newsDigest > 0 ? ["news-digest"] : [],
    },
    {
      scope: "shadow_telemetry",
      count: params.counts.shadowTelemetry,
      kinds: params.counts.shadowTelemetry > 0 ? ["shadow-telemetry"] : [],
    },
    {
      scope: "capability_governance",
      count: params.counts.capabilityGovernance,
      kinds: params.counts.capabilityGovernance > 0 ? ["capability-governance"] : [],
    },
    {
      scope: "team_shareable_knowledge",
      count: params.counts.teamKnowledge,
      kinds: params.counts.teamKnowledge > 0 ? ["team-knowledge"] : [],
    },
  ];
  return suppressionInputs
    .filter((entry) => entry.count > 0 && !allowed.has(entry.scope))
    .map((entry) => ({
      scope: entry.scope,
      envelopeCount: entry.count,
      envelopeKinds: entry.kinds,
    }));
}
