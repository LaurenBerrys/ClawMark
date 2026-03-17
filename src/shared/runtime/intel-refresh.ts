import type { RuntimeIntelStore, RuntimeMetadata } from "./contracts.js";
import {
  DEFAULT_RUNTIME_INFO_DOMAINS,
  normalizeRuntimeInfoDomain,
} from "./intel-domains.js";
import {
  runRuntimeIntelPipeline,
  type IntelDomain,
  type RuntimeIntelCandidateInput,
} from "./intel-pipeline.js";
import {
  appendRuntimeEvent,
  loadRuntimeIntelStore,
  saveRuntimeIntelStore,
  type RuntimeStoreOptions,
} from "./store.js";

export type RuntimeIntelSourceDefinition = {
  id: string;
  kind: "rss" | "github_search";
  label: string;
  url?: string;
  priority: number;
  custom?: boolean;
};

export type RuntimeIntelDomainDefinition = {
  id: IntelDomain;
  label: string;
  keywords: string[];
  sources: RuntimeIntelSourceDefinition[];
};

export type RuntimeIntelRefreshDomainResult = {
  domain: IntelDomain;
  fetchedCount: number;
  digestCount: number;
  skipped: boolean;
  errors: string[];
};

export type RuntimeIntelRefreshResult = {
  refreshedAt: number;
  domains: RuntimeIntelRefreshDomainResult[];
  pipeline: ReturnType<typeof runRuntimeIntelPipeline>;
};

export type RuntimeIntelRefreshOutcome =
  | "never"
  | "success"
  | "partial"
  | "error"
  | "skipped"
  | "disabled";

export type RuntimeIntelRefreshDomainAudit = {
  domain: IntelDomain;
  enabled: boolean;
  sourceCount: number;
  enabledSourceCount: number;
  refreshMinutes: number;
  lastRefreshAt: number | null;
  lastSuccessfulRefreshAt: number | null;
  lastFetchedAt: number | null;
  lastFetchedCount: number;
  lastError?: string;
  nextRefreshAt: number | null;
  stale: boolean;
  status: "healthy" | "stale" | "error" | "paused";
};

export type RuntimeIntelRefreshAudit = {
  enabled: boolean;
  refreshMinutes: number;
  lastRefreshAt: number | null;
  lastSuccessfulRefreshAt: number | null;
  lastRefreshOutcome: RuntimeIntelRefreshOutcome;
  nextRefreshAt: number | null;
  stale: boolean;
  staleDomainCount: number;
  errorDomainCount: number;
  modulePausedReason?: string;
  domains: RuntimeIntelRefreshDomainAudit[];
};

export type RuntimeIntelRefreshOptions = RuntimeStoreOptions & {
  domains?: IntelDomain[];
  force?: boolean;
  fetchImpl?: typeof fetch;
  githubToken?: string;
};

export type RuntimeIntelPanelSource = {
  id: string;
  domain: IntelDomain;
  kind: "rss" | "github_search";
  label: string;
  priority: number;
  enabled: boolean;
  custom: boolean;
  url?: string;
};

export type RuntimeIntelPanelConfig = {
  enabled: boolean;
  digestEnabled: boolean;
  refreshMinutes: number;
  enabledDomainIds: IntelDomain[];
  dailyPushEnabled: boolean;
  dailyPushItemCount: number;
  dailyPushHourLocal: number;
  dailyPushMinuteLocal: number;
  instantPushEnabled: boolean;
  instantPushMinScore: number;
  dailyPushTargetIds: string[];
  instantPushTargetIds: string[];
  candidateLimitPerDomain: number;
  digestItemLimitPerDomain: number;
  exploitItemsPerDigest: number;
  exploreItemsPerDigest: number;
  selectedSourceIds: string[];
};

export type ConfigureRuntimeIntelPanelInput = {
  enabled?: boolean;
  digestEnabled?: boolean;
  refreshMinutes?: number;
  enabledDomainIds?: IntelDomain[];
  dailyPushEnabled?: boolean;
  dailyPushItemCount?: number;
  dailyPushHourLocal?: number;
  dailyPushMinuteLocal?: number;
  instantPushEnabled?: boolean;
  instantPushMinScore?: number;
  dailyPushTargetIds?: string[];
  instantPushTargetIds?: string[];
  candidateLimitPerDomain?: number;
  digestItemLimitPerDomain?: number;
  exploitItemsPerDigest?: number;
  exploreItemsPerDigest?: number;
  selectedSourceIds?: string[];
};

export type RuntimeIntelSourceUpsertInput = {
  id?: string;
  domain: IntelDomain;
  kind: "rss" | "github_search";
  label: string;
  url?: string;
  priority?: number;
  enabled?: boolean;
};

export type RuntimeIntelSourceUpsertResult = {
  configuredAt: number;
  source: RuntimeIntelPanelSource;
  config: RuntimeIntelPanelConfig;
  sources: RuntimeIntelPanelSource[];
};

export type RuntimeIntelSourceDeleteResult = {
  configuredAt: number;
  deleted: boolean;
  deletedId: string;
  config: RuntimeIntelPanelConfig;
  sources: RuntimeIntelPanelSource[];
};

const DEFAULT_REFRESH_MINUTES = 180;
const DEFAULT_GITHUB_SEARCH_WINDOW_DAYS = 7;
const DEFAULT_DAILY_PUSH_ITEM_COUNT = 10;
const DEFAULT_DAILY_PUSH_HOUR_LOCAL = 9;
const DEFAULT_DAILY_PUSH_MINUTE_LOCAL = 0;
const DEFAULT_INSTANT_PUSH_MIN_SCORE = 88;

export const DEFAULT_RUNTIME_INTEL_DOMAINS: RuntimeIntelDomainDefinition[] = [
  {
    id: "military",
    label: "Military",
    keywords: ["military", "defense", "security", "conflict", "weapon", "army", "navy"],
    sources: [
      {
        id: "defense-one",
        kind: "rss",
        label: "Defense One",
        url: "https://www.defenseone.com/rss/all/",
        priority: 1.0,
      },
      {
        id: "breaking-defense",
        kind: "rss",
        label: "Breaking Defense",
        url: "https://breakingdefense.com/feed/",
        priority: 0.95,
      },
      {
        id: "reuters-world",
        kind: "rss",
        label: "Reuters World",
        url: "https://feeds.reuters.com/reuters/worldNews",
        priority: 0.8,
      },
    ],
  },
  {
    id: "tech",
    label: "Tech",
    keywords: ["technology", "tech", "startup", "chip", "software", "cloud", "developer"],
    sources: [
      {
        id: "hn-frontpage",
        kind: "rss",
        label: "Hacker News",
        url: "https://hnrss.org/frontpage",
        priority: 1.0,
      },
      {
        id: "techcrunch",
        kind: "rss",
        label: "TechCrunch",
        url: "https://techcrunch.com/feed/",
        priority: 0.9,
      },
      {
        id: "theverge",
        kind: "rss",
        label: "The Verge",
        url: "https://www.theverge.com/rss/index.xml",
        priority: 0.8,
      },
      {
        id: "arstechnica",
        kind: "rss",
        label: "Ars Technica",
        url: "https://feeds.arstechnica.com/arstechnica/index",
        priority: 0.8,
      },
    ],
  },
  {
    id: "ai",
    label: "AI",
    keywords: ["ai", "artificial intelligence", "model", "agent", "llm", "inference", "gpu"],
    sources: [
      {
        id: "openai-news",
        kind: "rss",
        label: "OpenAI",
        url: "https://openai.com/news/rss.xml",
        priority: 1.0,
      },
      {
        id: "anthropic-news",
        kind: "rss",
        label: "Anthropic",
        url: "https://www.anthropic.com/news/rss.xml",
        priority: 0.95,
      },
      {
        id: "mit-ai",
        kind: "rss",
        label: "MIT Technology Review",
        url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
        priority: 0.85,
      },
      {
        id: "google-ai",
        kind: "rss",
        label: "Google AI",
        url: "https://blog.google/technology/ai/rss/",
        priority: 0.8,
      },
    ],
  },
  {
    id: "business",
    label: "Business",
    keywords: ["business", "market", "company", "funding", "finance", "policy", "economy"],
    sources: [
      {
        id: "reuters-business",
        kind: "rss",
        label: "Reuters Business",
        url: "https://feeds.reuters.com/reuters/businessNews",
        priority: 1.0,
      },
      {
        id: "cnbc-business",
        kind: "rss",
        label: "CNBC Business",
        url: "https://www.cnbc.com/id/10001147/device/rss/rss.html",
        priority: 0.9,
      },
      {
        id: "reuters-top",
        kind: "rss",
        label: "Reuters Top",
        url: "https://feeds.reuters.com/reuters/topNews",
        priority: 0.75,
      },
      {
        id: "marketwatch",
        kind: "rss",
        label: "MarketWatch",
        url: "https://feeds.marketwatch.com/marketwatch/topstories/",
        priority: 0.75,
      },
    ],
  },
];

function clampInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function sanitizeSourceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSourceKind(value: unknown): RuntimeIntelSourceDefinition["kind"] {
  return value === "github_search" ? "github_search" : "rss";
}

function normalizeDomainId(value: unknown): IntelDomain {
  return normalizeRuntimeInfoDomain(value);
}

function readCustomSourceDefinitions(
  metadata: RuntimeMetadata | undefined,
): Array<RuntimeIntelSourceDefinition & { domain: IntelDomain }> {
  const raw = Array.isArray(metadata?.customSources) ? metadata.customSources : [];
  const definitions: Array<RuntimeIntelSourceDefinition & { domain: IntelDomain }> = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const label = normalizeText(record.label);
    const id = sanitizeSourceId(normalizeText(record.id) || label);
    if (!id || !label || seen.has(id)) {
      continue;
    }
    const kind = normalizeSourceKind(record.kind);
    const url = normalizeText(record.url) || undefined;
    if (kind === "rss" && !url) {
      continue;
    }
    seen.add(id);
    definitions.push({
      id,
      domain: normalizeDomainId(record.domain),
      kind,
      label,
      url,
      priority: Math.max(0.1, Math.min(5, Number(record.priority) || 1)),
      custom: true,
    });
  }
  return definitions.toSorted(
    (left, right) => right.priority - left.priority || left.label.localeCompare(right.label),
  );
}

function writeCustomSourceDefinitions(
  metadata: RuntimeMetadata | undefined,
  sources: Array<RuntimeIntelSourceDefinition & { domain: IntelDomain }>,
): RuntimeMetadata {
  return {
    ...metadata,
    customSources: sources.map((source) => ({
      id: source.id,
      domain: source.domain,
      kind: source.kind,
      label: source.label,
      url: source.url,
      priority: source.priority,
      custom: true,
    })),
  };
}

export function listRuntimeIntelDomainDefinitions(
  store?: Pick<RuntimeIntelStore, "metadata">,
): RuntimeIntelDomainDefinition[] {
  const definitions = DEFAULT_RUNTIME_INTEL_DOMAINS.map((domain) => ({
    ...domain,
    sources: domain.sources.map((source) => ({ ...source })),
  }));
  const byId = new Map(definitions.map((domain) => [domain.id, domain]));
  for (const customSource of readCustomSourceDefinitions(store?.metadata)) {
    const domain = byId.get(customSource.domain);
    if (!domain) {
      continue;
    }
    const existingIndex = domain.sources.findIndex((entry) => entry.id === customSource.id);
    if (existingIndex >= 0) {
      domain.sources[existingIndex] = customSource;
    } else {
      domain.sources.push(customSource);
    }
  }
  return definitions;
}

export function listRuntimeIntelSourceDefinitions(): Array<
  Omit<RuntimeIntelPanelSource, "enabled">
> {
  return listRuntimeIntelDomainDefinitions().flatMap((domain) =>
    domain.sources.map((source) => ({
      id: source.id,
      domain: domain.id,
      kind: source.kind,
      label: source.label,
      priority: source.priority,
      custom: source.custom === true,
      url: source.url,
    })),
  );
}

export function listRuntimeIntelResolvedSourceDefinitions(
  store: Pick<RuntimeIntelStore, "metadata">,
): Array<Omit<RuntimeIntelPanelSource, "enabled">> {
  return listRuntimeIntelDomainDefinitions(store).flatMap((domain) =>
    domain.sources.map((source) => ({
      id: source.id,
      domain: domain.id,
      kind: source.kind,
      label: source.label,
      priority: source.priority,
      custom: source.custom === true,
      url: source.url,
    })),
  );
}

export function resolveRuntimeIntelPanelConfig(
  store: Pick<
    RuntimeIntelStore,
    | "enabled"
    | "digestEnabled"
    | "candidateLimitPerDomain"
    | "digestItemLimitPerDomain"
    | "exploitItemsPerDigest"
    | "exploreItemsPerDigest"
    | "metadata"
  >,
): RuntimeIntelPanelConfig {
  const metadata = store.metadata;
  const sourceDefinitions = listRuntimeIntelResolvedSourceDefinitions(store);
  const allDomainIds = [...DEFAULT_RUNTIME_INFO_DOMAINS];
  const selectedSourceIds = uniqueStrings(
    Array.isArray(metadata?.selectedSourceIds)
      ? metadata.selectedSourceIds.filter((value): value is string => typeof value === "string")
      : sourceDefinitions.map((source) => source.id),
  );
  const enabledDomainIdSet = new Set(
    uniqueStrings(
      Array.isArray(metadata?.enabledDomainIds)
        ? metadata.enabledDomainIds.filter((value): value is string => typeof value === "string")
        : allDomainIds,
    ).map((entry) => normalizeDomainId(entry)),
  );
  const enabledDomainIds = DEFAULT_RUNTIME_INFO_DOMAINS.filter((domainId) =>
    enabledDomainIdSet.has(domainId),
  );
  return {
    enabled: store.enabled,
    digestEnabled: store.digestEnabled,
    refreshMinutes: readRefreshMinutes(metadata),
    enabledDomainIds: enabledDomainIds.length > 0 ? enabledDomainIds : [...allDomainIds],
    dailyPushEnabled: metadata?.dailyPushEnabled !== false,
    dailyPushItemCount: clampInteger(
      Number(metadata?.dailyPushItemCount),
      DEFAULT_DAILY_PUSH_ITEM_COUNT,
      1,
      50,
    ),
    dailyPushHourLocal: clampInteger(
      Number(metadata?.dailyPushHourLocal),
      DEFAULT_DAILY_PUSH_HOUR_LOCAL,
      0,
      23,
    ),
    dailyPushMinuteLocal: clampInteger(
      Number(metadata?.dailyPushMinuteLocal),
      DEFAULT_DAILY_PUSH_MINUTE_LOCAL,
      0,
      59,
    ),
    instantPushEnabled: metadata?.instantPushEnabled === true,
    instantPushMinScore: clampInteger(
      Number(metadata?.instantPushMinScore),
      DEFAULT_INSTANT_PUSH_MIN_SCORE,
      1,
      100,
    ),
    dailyPushTargetIds: uniqueStrings(
      Array.isArray(metadata?.dailyPushTargetIds)
        ? metadata.dailyPushTargetIds.filter((value): value is string => typeof value === "string")
        : ["runtime-user"],
    ),
    instantPushTargetIds: uniqueStrings(
      Array.isArray(metadata?.instantPushTargetIds)
        ? metadata.instantPushTargetIds.filter((value): value is string => typeof value === "string")
        : ["runtime-user"],
    ),
    candidateLimitPerDomain: clampInteger(store.candidateLimitPerDomain, 20, 1, 100),
    digestItemLimitPerDomain: clampInteger(store.digestItemLimitPerDomain, 10, 1, 25),
    exploitItemsPerDigest: clampInteger(store.exploitItemsPerDigest, 8, 0, 25),
    exploreItemsPerDigest: clampInteger(store.exploreItemsPerDigest, 2, 0, 25),
    selectedSourceIds,
  };
}

export function listRuntimeIntelPanelSources(
  store: Pick<
    RuntimeIntelStore,
    | "enabled"
    | "digestEnabled"
    | "candidateLimitPerDomain"
    | "digestItemLimitPerDomain"
    | "exploitItemsPerDigest"
    | "exploreItemsPerDigest"
    | "metadata"
  >,
): RuntimeIntelPanelSource[] {
  const config = resolveRuntimeIntelPanelConfig(store);
  const selected = new Set(config.selectedSourceIds);
  return listRuntimeIntelResolvedSourceDefinitions(store).map((source) => ({
    ...source,
    enabled: selected.has(source.id),
  }));
}

export function configureRuntimeIntelPanel(
  input: ConfigureRuntimeIntelPanelInput,
  opts: RuntimeStoreOptions = {},
): { configuredAt: number; config: RuntimeIntelPanelConfig; sources: RuntimeIntelPanelSource[] } {
  const now = resolveNow(opts.now);
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const current = resolveRuntimeIntelPanelConfig(store);
  const knownSourceIds = new Set(listRuntimeIntelResolvedSourceDefinitions(store).map((source) => source.id));
  const selectedSourceIds =
    input.selectedSourceIds == null
      ? current.selectedSourceIds
      : uniqueStrings(input.selectedSourceIds).filter((sourceId) => knownSourceIds.has(sourceId));
  const enabledDomainIds =
    input.enabledDomainIds == null
      ? current.enabledDomainIds
      : uniqueStrings(input.enabledDomainIds)
          .map((domainId) => normalizeDomainId(domainId))
          .filter((domainId, index, values) => values.indexOf(domainId) === index);
  const dailyPushTargetIds =
    input.dailyPushTargetIds == null
      ? current.dailyPushTargetIds
      : uniqueStrings(input.dailyPushTargetIds);
  const instantPushTargetIds =
    input.instantPushTargetIds == null
      ? current.instantPushTargetIds
      : uniqueStrings(input.instantPushTargetIds);
  store.enabled = input.enabled ?? current.enabled;
  store.digestEnabled = input.digestEnabled ?? current.digestEnabled;
  store.candidateLimitPerDomain = clampInteger(
    Number(input.candidateLimitPerDomain),
    current.candidateLimitPerDomain,
    1,
    100,
  );
  store.digestItemLimitPerDomain = clampInteger(
    Number(input.digestItemLimitPerDomain),
    current.digestItemLimitPerDomain,
    1,
    25,
  );
  store.exploitItemsPerDigest = clampInteger(
    Number(input.exploitItemsPerDigest),
    current.exploitItemsPerDigest,
    0,
    25,
  );
  store.exploreItemsPerDigest = clampInteger(
    Number(input.exploreItemsPerDigest),
    current.exploreItemsPerDigest,
    0,
    25,
  );
  if (store.exploitItemsPerDigest + store.exploreItemsPerDigest > store.digestItemLimitPerDomain) {
    store.exploreItemsPerDigest = Math.max(
      0,
      store.digestItemLimitPerDomain - store.exploitItemsPerDigest,
    );
  }
  store.metadata = {
    ...store.metadata,
    refreshMinutes: clampInteger(Number(input.refreshMinutes), current.refreshMinutes, 5, 24 * 60),
    enabledDomainIds: enabledDomainIds.length > 0 ? enabledDomainIds : current.enabledDomainIds,
    dailyPushEnabled: input.dailyPushEnabled ?? current.dailyPushEnabled,
    dailyPushItemCount: clampInteger(
      Number(input.dailyPushItemCount),
      current.dailyPushItemCount,
      1,
      50,
    ),
    dailyPushHourLocal: clampInteger(
      Number(input.dailyPushHourLocal),
      current.dailyPushHourLocal,
      0,
      23,
    ),
    dailyPushMinuteLocal: clampInteger(
      Number(input.dailyPushMinuteLocal),
      current.dailyPushMinuteLocal,
      0,
      59,
    ),
    instantPushEnabled: input.instantPushEnabled ?? current.instantPushEnabled,
    instantPushMinScore: clampInteger(
      Number(input.instantPushMinScore),
      current.instantPushMinScore,
      1,
      100,
    ),
    dailyPushTargetIds: dailyPushTargetIds.length > 0 ? dailyPushTargetIds : ["runtime-user"],
    instantPushTargetIds: instantPushTargetIds.length > 0 ? instantPushTargetIds : ["runtime-user"],
    selectedSourceIds,
  };
  const saved = saveRuntimeIntelStore(store, {
    ...opts,
    now,
  });
  const config = resolveRuntimeIntelPanelConfig(saved);
  const sources = listRuntimeIntelPanelSources(saved);
  appendRuntimeEvent(
    "runtime_intel_configured",
    {
      enabled: config.enabled,
      digestEnabled: config.digestEnabled,
      refreshMinutes: config.refreshMinutes,
      enabledDomainIds: config.enabledDomainIds,
      dailyPushEnabled: config.dailyPushEnabled,
      dailyPushItemCount: config.dailyPushItemCount,
      dailyPushHourLocal: config.dailyPushHourLocal,
      dailyPushMinuteLocal: config.dailyPushMinuteLocal,
      instantPushEnabled: config.instantPushEnabled,
      instantPushMinScore: config.instantPushMinScore,
      dailyPushTargetIds: config.dailyPushTargetIds,
      instantPushTargetIds: config.instantPushTargetIds,
      candidateLimitPerDomain: config.candidateLimitPerDomain,
      digestItemLimitPerDomain: config.digestItemLimitPerDomain,
      exploitItemsPerDigest: config.exploitItemsPerDigest,
      exploreItemsPerDigest: config.exploreItemsPerDigest,
      selectedSourceIds: config.selectedSourceIds,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    config,
    sources,
  };
}

export function upsertRuntimeIntelSource(
  input: RuntimeIntelSourceUpsertInput,
  opts: RuntimeStoreOptions = {},
): RuntimeIntelSourceUpsertResult {
  const now = resolveNow(opts.now);
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const label = normalizeText(input.label);
  if (!label) {
    throw new Error("source label is required");
  }
  const kind = normalizeSourceKind(input.kind);
  const url = normalizeText(input.url) || undefined;
  if (kind === "rss" && !url) {
    throw new Error("rss source url is required");
  }
  const id = sanitizeSourceId(normalizeText(input.id) || label);
  if (!id) {
    throw new Error("source id is invalid");
  }
  const domain = normalizeDomainId(input.domain);
  const customSources = readCustomSourceDefinitions(store.metadata).filter((source) => source.id !== id);
  customSources.push({
    id,
    domain,
    kind,
    label,
    url,
    priority: Math.max(0.1, Math.min(5, Number(input.priority) || 1)),
    custom: true,
  });
  store.metadata = writeCustomSourceDefinitions(store.metadata, customSources);
  const current = resolveRuntimeIntelPanelConfig(store);
  const nextSelectedSourceIds =
    input.enabled === false
      ? current.selectedSourceIds.filter((sourceId) => sourceId !== id)
      : uniqueStrings([...current.selectedSourceIds, id]);
  store.metadata = {
    ...store.metadata,
    selectedSourceIds: nextSelectedSourceIds,
  };
  const saved = saveRuntimeIntelStore(store, {
    ...opts,
    now,
  });
  const config = resolveRuntimeIntelPanelConfig(saved);
  const sources = listRuntimeIntelPanelSources(saved);
  const source = sources.find((entry) => entry.id === id);
  if (!source) {
    throw new Error("configured source was not persisted");
  }
  appendRuntimeEvent(
    "runtime_intel_source_upserted",
    {
      id: source.id,
      domain: source.domain,
      kind: source.kind,
      label: source.label,
      priority: source.priority,
      enabled: source.enabled,
      custom: source.custom,
      url: source.url,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    source,
    config,
    sources,
  };
}

export function deleteRuntimeIntelSource(
  sourceId: string,
  opts: RuntimeStoreOptions = {},
): RuntimeIntelSourceDeleteResult {
  const now = resolveNow(opts.now);
  const id = sanitizeSourceId(sourceId);
  if (!id) {
    throw new Error("source id is required");
  }
  const store = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const currentSources = readCustomSourceDefinitions(store.metadata);
  const nextSources = currentSources.filter((source) => source.id !== id);
  const deleted = nextSources.length !== currentSources.length;
  store.metadata = writeCustomSourceDefinitions(store.metadata, nextSources);
  const current = resolveRuntimeIntelPanelConfig(store);
  store.metadata = {
    ...store.metadata,
    selectedSourceIds: current.selectedSourceIds.filter((entry) => entry !== id),
  };
  const saved = saveRuntimeIntelStore(store, {
    ...opts,
    now,
  });
  const config = resolveRuntimeIntelPanelConfig(saved);
  const sources = listRuntimeIntelPanelSources(saved);
  appendRuntimeEvent(
    "runtime_intel_source_deleted",
    {
      id,
      deleted,
    },
    {
      ...opts,
      now,
    },
  );
  return {
    configuredAt: now,
    deleted,
    deletedId: id,
    config,
    sources,
  };
}

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(text);
  }
  return output;
}

function intersectionSize(
  left: Array<string | null | undefined>,
  right: Array<string | null | undefined>,
): number {
  const leftSet = new Set(uniqueStrings(left));
  const rightSet = new Set(uniqueStrings(right));
  let count = 0;
  for (const entry of leftSet) {
    if (rightSet.has(entry)) {
      count += 1;
    }
  }
  return count;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywordTags(text: string, extra: string[] = []): string[] {
  const source = `${normalizeText(text)} ${uniqueStrings(extra).join(" ")}`.toLowerCase();
  if (!source) {
    return [];
  }
  const english = source.match(/[a-z][a-z0-9._-]{2,}/g) ?? [];
  const chinese = source.match(/[\u4e00-\u9fff]{2,6}/g) ?? [];
  return uniqueStrings([...english, ...chinese]).slice(0, 24);
}

function scoreRecency(timestamp: number, now: number, windowHours = 72): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  const ageHours = Math.max(0, (now - timestamp) / (60 * 60 * 1000));
  if (ageHours >= windowHours) {
    return 0;
  }
  return Math.round((1 - ageHours / windowHours) * 100);
}

function parseOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractXmlTagValue(block: string, tagNames: string[]): string {
  for (const name of tagNames) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = String(block || "").match(pattern);
    if (match?.[1]) {
      return stripHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    }
  }
  return "";
}

function extractXmlLink(block: string): string {
  const hrefMatch = String(block || "").match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch?.[1]) {
    return hrefMatch[1].trim();
  }
  return normalizeText(extractXmlTagValue(block, ["link", "id"]));
}

function parseFeedEntries(xmlText: string): Array<{
  title: string;
  summary: string;
  url: string;
  publishedAt?: number;
}> {
  const xml = String(xmlText || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  return blocks
    .map((block) => ({
      title: extractXmlTagValue(block, ["title"]),
      summary: extractXmlTagValue(block, ["description", "summary", "content:encoded", "content"]),
      url: extractXmlLink(block),
      publishedAt: parseOptionalTimestamp(
        extractXmlTagValue(block, ["pubDate", "published", "updated"]),
      ),
    }))
    .filter((entry) => entry.title && entry.url);
}

async function fetchTextWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: HeadersInit,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: HeadersInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function readRefreshMinutes(metadata: RuntimeMetadata | undefined): number {
  const refreshMinutes = Number(metadata?.refreshMinutes);
  return Number.isFinite(refreshMinutes) && refreshMinutes > 0
    ? refreshMinutes
    : DEFAULT_REFRESH_MINUTES;
}

function readNullableTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function normalizeRefreshOutcome(value: unknown): RuntimeIntelRefreshOutcome {
  return value === "success" ||
    value === "partial" ||
    value === "error" ||
    value === "skipped" ||
    value === "disabled"
    ? value
    : "never";
}

function readDomainFetchMetadata(
  metadata: RuntimeMetadata | undefined,
  domain: IntelDomain,
): Record<string, unknown> {
  const domains = metadata?.domains;
  if (!domains || typeof domains !== "object" || Array.isArray(domains)) {
    return {};
  }
  const domainMetadata = (domains as Record<string, unknown>)[domain];
  if (!domainMetadata || typeof domainMetadata !== "object" || Array.isArray(domainMetadata)) {
    return {};
  }
  return domainMetadata as Record<string, unknown>;
}

function writeDomainFetchMetadata(
  metadata: RuntimeMetadata | undefined,
  domain: IntelDomain,
  value: Record<string, unknown>,
): RuntimeMetadata {
  const domains =
    metadata?.domains && typeof metadata.domains === "object" && !Array.isArray(metadata.domains)
      ? { ...(metadata.domains as Record<string, unknown>) }
      : {};
  domains[domain] = value;
  return {
    ...metadata,
    domains,
  };
}

function readSourceFetchMetadata(
  metadata: RuntimeMetadata | undefined,
  sourceId: string,
): Record<string, unknown> {
  const sources = metadata?.sources;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    return {};
  }
  const sourceMetadata = (sources as Record<string, unknown>)[sourceId];
  if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) {
    return {};
  }
  return sourceMetadata as Record<string, unknown>;
}

function writeSourceFetchMetadata(
  metadata: RuntimeMetadata | undefined,
  sourceId: string,
  value: Record<string, unknown>,
): RuntimeMetadata {
  const sources =
    metadata?.sources && typeof metadata.sources === "object" && !Array.isArray(metadata.sources)
      ? { ...(metadata.sources as Record<string, unknown>) }
      : {};
  sources[sourceId] = value;
  return {
    ...metadata,
    sources,
  };
}

function buildRuntimeIntelRefreshOutcome(
  attemptedResults: RuntimeIntelRefreshDomainResult[],
): RuntimeIntelRefreshOutcome {
  if (attemptedResults.length === 0) {
    return "skipped";
  }
  const errorCount = attemptedResults.reduce((sum, entry) => sum + entry.errors.length, 0);
  if (errorCount === 0) {
    return "success";
  }
  return attemptedResults.some((entry) => entry.fetchedCount > 0) ? "partial" : "error";
}

export function buildRuntimeIntelRefreshAudit(
  store: Pick<
    RuntimeIntelStore,
    | "enabled"
    | "digestEnabled"
    | "candidateLimitPerDomain"
    | "digestItemLimitPerDomain"
    | "exploitItemsPerDigest"
    | "exploreItemsPerDigest"
    | "metadata"
  >,
  now = Date.now(),
): RuntimeIntelRefreshAudit {
  const panelConfig = resolveRuntimeIntelPanelConfig(store);
  const sources = listRuntimeIntelPanelSources(store);
  const domains = listRuntimeIntelDomainDefinitions(store).map((domain) => {
    const domainMetadata = readDomainFetchMetadata(store.metadata, domain.id);
    const lastRefreshAt = readNullableTimestamp(domainMetadata.lastRefreshAt);
    const lastSuccessfulRefreshAt = readNullableTimestamp(domainMetadata.lastSuccessfulRefreshAt);
    const lastFetchedAt = readNullableTimestamp(
      domainMetadata.lastFetchedAt ?? domainMetadata.latestFetchAt,
    );
    const enabled = store.enabled && panelConfig.enabledDomainIds.includes(domain.id);
    const domainSources = sources.filter((entry) => entry.domain === domain.id);
    const enabledSourceCount = domainSources.filter((entry) => entry.enabled).length;
    const refreshMinutes = readRefreshMinutes(domainMetadata);
    const lastError =
      typeof domainMetadata.lastError === "string" && domainMetadata.lastError.trim().length > 0
        ? domainMetadata.lastError.trim()
        : undefined;
    const nextRefreshAt =
      enabled && enabledSourceCount > 0
        ? lastFetchedAt
          ? lastFetchedAt + refreshMinutes * 60 * 1000
          : now
        : null;
    const stale =
      enabled && enabledSourceCount > 0 ? nextRefreshAt == null || now >= nextRefreshAt : false;
    const status = !enabled || enabledSourceCount === 0
      ? "paused"
      : lastError
        ? "error"
        : stale
          ? "stale"
          : "healthy";
    return {
      domain: domain.id,
      enabled,
      sourceCount: domainSources.length,
      enabledSourceCount,
      refreshMinutes,
      lastRefreshAt,
      lastSuccessfulRefreshAt,
      lastFetchedAt,
      lastFetchedCount:
        typeof domainMetadata.fetchedCount === "number" && Number.isFinite(domainMetadata.fetchedCount)
          ? Math.max(0, Math.trunc(domainMetadata.fetchedCount))
          : 0,
      lastError,
      nextRefreshAt,
      stale,
      status,
    } satisfies RuntimeIntelRefreshDomainAudit;
  });
  const enabledDomains = domains.filter((entry) => entry.enabled && entry.enabledSourceCount > 0);
  const staleDomainCount = enabledDomains.filter((entry) => entry.stale).length;
  const errorDomainCount = enabledDomains.filter((entry) => entry.status === "error").length;
  const nextRefreshAt =
    enabledDomains
      .map((entry) => entry.nextRefreshAt)
      .filter((entry): entry is number => Number.isFinite(entry))
      .reduce((earliest, entry) => Math.min(earliest, entry), Number.POSITIVE_INFINITY);
  const modulePausedReason = store.enabled
    ? enabledDomains.length === 0
      ? "No enabled domains or sources."
      : undefined
    : "News / Info module disabled.";
  return {
    enabled: store.enabled,
    refreshMinutes: panelConfig.refreshMinutes,
    lastRefreshAt: readNullableTimestamp(store.metadata?.lastRefreshAt),
    lastSuccessfulRefreshAt: readNullableTimestamp(store.metadata?.lastSuccessfulRefreshAt),
    lastRefreshOutcome: normalizeRefreshOutcome(store.metadata?.lastRefreshOutcome),
    nextRefreshAt: Number.isFinite(nextRefreshAt) ? nextRefreshAt : null,
    stale: staleDomainCount > 0,
    staleDomainCount,
    errorDomainCount,
    modulePausedReason,
    domains,
  };
}

function buildScoredCandidateInput(params: {
  domain: RuntimeIntelDomainDefinition;
  source: RuntimeIntelSourceDefinition;
  title: string;
  summary: string;
  url: string;
  publishedAt?: number;
  rawText: string;
  tags: string[];
  existingIds: Set<string>;
  extraMetadata?: Record<string, unknown>;
  now: number;
}): RuntimeIntelCandidateInput {
  const keywordHits = params.domain.keywords.filter((keyword) =>
    params.rawText.toLowerCase().includes(keyword.toLowerCase()),
  ).length;
  const candidateId = `intel_${hashText(`${params.title}|${params.url}|${params.summary}`)}`;
  const sameHash = params.existingIds.has(candidateId);
  const credibilityBase = Math.round(params.source.priority * 100);
  const credibilityScore = clampPercent(credibilityBase);
  let importanceBoost =
    /launch|release|funding|raising|security|policy|benchmark|earnings|acquisition|agent|model|chip|gpu|open source|deploy|pricing|attack|breach|partnership/i.test(
      params.rawText,
    )
      ? 28
      : 0;
  const starCount = Number(params.extraMetadata?.starCount ?? 0);
  if (Number.isFinite(starCount) && starCount > 0) {
    importanceBoost += Math.min(24, Math.round(Math.log10(starCount + 1) * 8));
  }
  const publishedAt = params.publishedAt ?? params.now;
  const importanceScore = clampPercent(
    38 + keywordHits * 14 + importanceBoost + scoreRecency(publishedAt, params.now, 24 * 5) * 0.18,
  );
  const noveltyScore = clampPercent(
    sameHash
      ? 8
      : 52 +
          scoreRecency(publishedAt, params.now, 24 * 7) * 0.28 +
          Math.max(0, 18 - keywordHits * 2),
  );
  const relevanceScore = clampPercent(
    25 + keywordHits * 18 + intersectionSize(params.tags, params.domain.keywords) * 10,
  );
  const overallScore = clampPercent(
    credibilityScore * 0.24 + importanceScore * 0.31 + noveltyScore * 0.2 + relevanceScore * 0.25,
  );
  const actionability =
    overallScore >= 82
      ? "建议重点关注"
      : overallScore >= 70
        ? "建议关注"
        : noveltyScore >= 82
          ? "建议观察"
          : "建议忽略";
  return {
    id: candidateId,
    domain: params.domain.id,
    sourceId: params.source.id,
    title: params.title,
    url: params.url,
    summary: params.summary,
    score: overallScore,
    createdAt: publishedAt,
    metadata: {
      sourceType: params.source.kind,
      sourcePriority: params.source.priority,
      sourceLabel: params.source.label,
      credibilityScore,
      importanceScore,
      noveltyScore,
      relevanceScore,
      actionability,
      judgement: `${params.domain.label} signal: ${actionability}; credibility ${credibilityScore} / novelty ${noveltyScore} / importance ${importanceScore}.`,
      tags: params.tags,
      ...params.extraMetadata,
    },
  };
}

async function fetchRssCandidates(params: {
  domain: RuntimeIntelDomainDefinition;
  source: RuntimeIntelSourceDefinition;
  existingIds: Set<string>;
  fetchImpl: typeof fetch;
  candidateLimitPerDomain: number;
  now: number;
}): Promise<RuntimeIntelCandidateInput[]> {
  const xml = await fetchTextWithTimeout(params.fetchImpl, params.source.url ?? "", 20_000, {
    "user-agent": "openclaw-runtime/1.0",
  });
  return parseFeedEntries(xml)
    .slice(0, params.candidateLimitPerDomain * 2)
    .map((entry) => {
      const rawText = `${entry.title}\n${entry.summary}`.trim();
      return buildScoredCandidateInput({
        domain: params.domain,
        source: params.source,
        title: entry.title,
        summary: entry.summary.slice(0, 320),
        url: entry.url,
        publishedAt: entry.publishedAt,
        rawText,
        tags: extractKeywordTags(rawText, [...params.domain.keywords, params.domain.label]),
        existingIds: params.existingIds,
        now: params.now,
      });
    });
}

async function fetchGitHubCandidates(params: {
  domain: RuntimeIntelDomainDefinition;
  source: RuntimeIntelSourceDefinition;
  existingIds: Set<string>;
  fetchImpl: typeof fetch;
  candidateLimitPerDomain: number;
  githubToken?: string;
  now: number;
}): Promise<RuntimeIntelCandidateInput[]> {
  const createdAfter = new Date(
    params.now - DEFAULT_GITHUB_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const query = new URLSearchParams({
    q: `created:>${createdAfter} stars:>10 archived:false`,
    sort: "stars",
    order: "desc",
    per_page: String(params.candidateLimitPerDomain * 2),
  });
  const headers: HeadersInit = {
    "user-agent": "openclaw-runtime/1.0",
    accept: "application/vnd.github+json",
  };
  if (normalizeText(params.githubToken)) {
    headers.authorization = `Bearer ${normalizeText(params.githubToken)}`;
  }
  const payload = await fetchJsonWithTimeout<{
    items?: Array<Record<string, unknown>>;
  }>(
    params.fetchImpl,
    `https://api.github.com/search/repositories?${query.toString()}`,
    20_000,
    headers,
  );
  return (Array.isArray(payload.items) ? payload.items : [])
    .slice(0, params.candidateLimitPerDomain * 2)
    .map((item) => {
      const fullName = normalizeText(item.full_name) || normalizeText(item.name) || "unknown/repo";
      const description = normalizeText(item.description);
      const language = normalizeText(item.language);
      const stars = Number(item.stargazers_count ?? 0);
      const summary = [description, language ? `language=${language}` : "", `stars=${stars}`]
        .filter(Boolean)
        .join(" | ");
      const rawText = `${fullName} ${description} ${language}`.trim();
      return buildScoredCandidateInput({
        domain: params.domain,
        source: params.source,
        title: fullName,
        summary,
        url: normalizeText(item.html_url) || `https://github.com/${fullName}`,
        publishedAt:
          parseOptionalTimestamp(item.pushed_at) ?? parseOptionalTimestamp(item.created_at),
        rawText,
        tags: extractKeywordTags(rawText, [
          ...params.domain.keywords,
          params.domain.label,
          language,
          normalizeText((item.owner as Record<string, unknown> | undefined)?.login),
        ]),
        existingIds: params.existingIds,
        extraMetadata: {
          repoFullName: fullName,
          language,
          starCount: stars,
        },
        now: params.now,
      });
    });
}

function resolveRequestedDomains(
  store: Pick<RuntimeIntelStore, "metadata">,
  enabledDomainIds: IntelDomain[],
  domains?: IntelDomain[],
): RuntimeIntelDomainDefinition[] {
  const domainDefinitions = listRuntimeIntelDomainDefinitions(store);
  const enabled = new Set(enabledDomainIds);
  const requested = domains?.length ? new Set(domains) : null;
  return domainDefinitions.filter(
    (entry) => enabled.has(entry.id) && (!requested || requested.has(entry.id)),
  );
}

export async function refreshRuntimeIntelPipeline(
  opts: RuntimeIntelRefreshOptions = {},
): Promise<RuntimeIntelRefreshResult> {
  const now = resolveNow(opts.now);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable.");
  }

  const intelStore = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  if (!intelStore.enabled) {
    const existingDigestCountByDomain = new Map<IntelDomain, number>();
    for (const item of intelStore.digestItems) {
      existingDigestCountByDomain.set(item.domain, (existingDigestCountByDomain.get(item.domain) ?? 0) + 1);
    }
    const requestedDomainIds = (
      opts.domains?.length
        ? uniqueStrings(opts.domains).map((domainId) => normalizeDomainId(domainId))
        : listRuntimeIntelDomainDefinitions(intelStore).map((domain) => domain.id)
    ).filter((domainId, index, values) => values.indexOf(domainId) === index);
    const domains = requestedDomainIds.map((domainId) => ({
      domain: domainId,
      fetchedCount: 0,
      digestCount: existingDigestCountByDomain.get(domainId) ?? 0,
      skipped: true,
      errors: ["runtime intel disabled"],
    }));
    intelStore.metadata = {
      ...intelStore.metadata,
      lastRefreshAt: now,
      lastRefreshOutcome: "disabled",
    };
    saveRuntimeIntelStore(intelStore, {
      ...opts,
      now,
    });
    appendRuntimeEvent(
      "runtime_intel_refresh_skipped",
      {
        reason: "disabled",
        domains: domains.map((entry) => entry.domain),
      },
      {
        ...opts,
        now,
      },
    );
    return {
      refreshedAt: now,
      domains,
      pipeline: {
        candidates: intelStore.candidates,
        digestItems: intelStore.digestItems,
      },
    };
  }
  const panelConfig = resolveRuntimeIntelPanelConfig(intelStore);
  const refreshMinutes = panelConfig.refreshMinutes;
  const selectedDomains = resolveRequestedDomains(
    intelStore,
    panelConfig.enabledDomainIds,
    opts.domains,
  );
  const enabledSourceIds = new Set(panelConfig.selectedSourceIds);
  const existingIds = new Set(intelStore.candidates.map((entry) => entry.id));
  const inputs: RuntimeIntelCandidateInput[] = [];
  const results: RuntimeIntelRefreshDomainResult[] = [];
  let nextMetadata = intelStore.metadata;

  if (opts.domains?.length) {
    const enabledDomainIdSet = new Set(panelConfig.enabledDomainIds);
    for (const domainId of opts.domains) {
      if (enabledDomainIdSet.has(domainId)) {
        continue;
      }
      results.push({
        domain: domainId,
        fetchedCount: 0,
        digestCount: intelStore.digestItems.filter((entry) => entry.domain === domainId).length,
        skipped: true,
        errors: ["domain disabled"],
      });
    }
  }

  for (const domain of selectedDomains) {
    const domainMetadata = readDomainFetchMetadata(nextMetadata, domain.id);
    const lastFetchedAt = Number(domainMetadata.lastFetchedAt);
    if (
      !opts.force &&
      Number.isFinite(lastFetchedAt) &&
      now - lastFetchedAt < refreshMinutes * 60 * 1000
    ) {
      results.push({
        domain: domain.id,
        fetchedCount: 0,
        digestCount: 0,
        skipped: true,
        errors: [],
      });
      continue;
    }

    const domainInputs: RuntimeIntelCandidateInput[] = [];
    const errors: string[] = [];
    for (const source of domain.sources.filter((entry) => enabledSourceIds.has(entry.id))) {
      const sourceMetadata = readSourceFetchMetadata(nextMetadata, source.id);
      let sourceFetchedCount = 0;
      let sourceError: string | undefined;
      try {
        const fetched =
          source.kind === "github_search"
            ? await fetchGitHubCandidates({
                domain,
                source,
                existingIds,
                fetchImpl,
                candidateLimitPerDomain: intelStore.candidateLimitPerDomain,
                githubToken: opts.githubToken,
                now,
              })
            : await fetchRssCandidates({
                domain,
                source,
                existingIds,
                fetchImpl,
                candidateLimitPerDomain: intelStore.candidateLimitPerDomain,
                now,
              });
        for (const candidate of fetched) {
          existingIds.add(candidate.id ?? "");
        }
        sourceFetchedCount = fetched.length;
        domainInputs.push(...fetched);
      } catch (error) {
        sourceError = `${source.id}: ${String((error as Error)?.message || error)}`;
        errors.push(sourceError);
      }
      nextMetadata = writeSourceFetchMetadata(nextMetadata, source.id, {
        ...sourceMetadata,
        domain: domain.id,
        label: source.label,
        kind: source.kind,
        lastRefreshAt: now,
        lastSuccessfulRefreshAt:
          sourceError == null ? now : readNullableTimestamp(sourceMetadata.lastSuccessfulRefreshAt),
        lastFetchedAt:
          sourceError == null ? now : readNullableTimestamp(sourceMetadata.lastFetchedAt),
        lastError: sourceError,
        fetchedCount: sourceFetchedCount,
        priority: source.priority,
      });
    }

    inputs.push(...domainInputs);
    nextMetadata = writeDomainFetchMetadata(nextMetadata, domain.id, {
      ...domainMetadata,
      label: domain.label,
      lastRefreshAt: now,
      lastSuccessfulRefreshAt:
        errors.length === 0 ? now : readNullableTimestamp(domainMetadata.lastSuccessfulRefreshAt),
      lastFetchedAt: now,
      refreshMinutes,
      lastError: errors.length > 0 ? errors.join(" | ") : undefined,
      sourceCount: domain.sources.filter((entry) => enabledSourceIds.has(entry.id)).length,
      fetchedCount: domainInputs.length,
    });
    results.push({
      domain: domain.id,
      fetchedCount: domainInputs.length,
      digestCount: 0,
      skipped: false,
      errors,
    });
  }

  const pipeline =
    inputs.length > 0
      ? runRuntimeIntelPipeline(inputs, {
          ...opts,
          now,
        })
      : {
          candidates: intelStore.candidates,
          digestItems: intelStore.digestItems,
        };

  const nextStore = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  const attemptedResults = results.filter((entry) => !entry.skipped);
  const refreshOutcome = buildRuntimeIntelRefreshOutcome(attemptedResults);
  nextStore.metadata = {
    ...nextMetadata,
    lastRefreshAt: now,
    lastRefreshOutcome: refreshOutcome,
    lastSuccessfulRefreshAt:
      refreshOutcome === "success" || refreshOutcome === "partial"
        ? now
        : readNullableTimestamp(nextMetadata?.lastSuccessfulRefreshAt),
    lastRefreshErrorCount: attemptedResults.reduce((sum, entry) => sum + entry.errors.length, 0),
    lastRefreshAttemptedDomains: attemptedResults.map((entry) => entry.domain),
    lastRefreshSkippedDomains: results.filter((entry) => entry.skipped).map((entry) => entry.domain),
  };
  saveRuntimeIntelStore(nextStore, {
    ...opts,
    now,
  });

  const digestCountByDomain = new Map<IntelDomain, number>();
  for (const item of pipeline.digestItems) {
    digestCountByDomain.set(item.domain, (digestCountByDomain.get(item.domain) ?? 0) + 1);
  }
  for (const result of results) {
    result.digestCount = digestCountByDomain.get(result.domain) ?? 0;
  }

  appendRuntimeEvent(
    "runtime_intel_refreshed",
    {
      domains: results,
      candidateCount: pipeline.candidates.length,
      digestItemCount: pipeline.digestItems.length,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    refreshedAt: now,
    domains: results,
    pipeline,
  };
}

/**
 * Checks if a scheduled intel refresh is due and runs it if so.
 * Aligns with v6 News Module scheduler requirements.
 */
export async function maybeRunScheduledIntelRefresh(
  opts: RuntimeStoreOptions = {},
): Promise<RuntimeIntelRefreshResult | false> {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  if (!intelStore.enabled) {
    return false;
  }
  const panelConfig = resolveRuntimeIntelPanelConfig(intelStore);
  // Default to 60 minutes if invalid
  const refreshIntervalMs =
    (Number.isFinite(panelConfig.refreshMinutes) && panelConfig.refreshMinutes > 0
      ? panelConfig.refreshMinutes
      : 60) *
    60 *
    1000;
  const lastRefreshAt = readNullableTimestamp(intelStore.metadata?.lastRefreshAt);
  if (lastRefreshAt && now - lastRefreshAt < refreshIntervalMs) {
    return false;
  }
  return await refreshRuntimeIntelPipeline({
    ...opts,
    now,
  });
}
