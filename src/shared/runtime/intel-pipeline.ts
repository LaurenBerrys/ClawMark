import type {
  FormalMemoryType,
  IntelCandidate,
  IntelDigestItem,
  IntelSourceProfile,
  IntelTopicProfile,
  MemoryRecord,
  RuntimeMemoryStore,
} from "./contracts.js";
import {
  appendRuntimeEvent,
  loadRuntimeStoreBundle,
  saveRuntimeStoreBundle,
  type RuntimeStoreOptions,
} from "./store.js";

const INTEL_DOMAINS = ["tech", "ai", "business", "github"] as const;
const DIGEST_HISTORY_RETENTION_DAYS = 14;
const DIGEST_HISTORY_RETENTION_ITEMS = 400;
const RECENT_DIGEST_TOPIC_WINDOW_DAYS = 5;

export type IntelDomain = (typeof INTEL_DOMAINS)[number];

export type RuntimeIntelCandidateInput = {
  id?: string;
  domain: IntelDomain | string;
  sourceId: string;
  title: string;
  url?: string;
  summary?: string;
  score?: number;
  createdAt?: number;
  metadata?: Record<string, unknown>;
};

export type RuntimeIntelPipelineResult = {
  candidates: IntelCandidate[];
  digestItems: IntelDigestItem[];
  knowledgeMemoryIds: string[];
  sourceTrustMemoryIds: string[];
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function averageNumber(values: Array<number | null | undefined>): number {
  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (normalized.length === 0) return 0;
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

function intersectionSize(
  left: Array<string | null | undefined> | null | undefined,
  right: Array<string | null | undefined> | null | undefined,
): number {
  const leftSet = new Set(uniqueStrings(left));
  const rightSet = new Set(uniqueStrings(right));
  let count = 0;
  for (const entry of leftSet) {
    if (rightSet.has(entry)) count += 1;
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

function buildStableId(prefix: string, parts: Array<string | number | null | undefined>): string {
  const seed = parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join("|");
  return `${prefix}_${hashText(seed || prefix)}`;
}

function normalizeDomain(value: string): IntelDomain {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "tech" ||
    normalized === "ai" ||
    normalized === "business" ||
    normalized === "github"
  ) {
    return normalized;
  }
  return "tech";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreRecency(value: number, now: number, windowHours = 72): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ageHours = Math.max(0, (now - value) / (60 * 60 * 1000));
  if (ageHours >= windowHours) return 0;
  return Math.round((1 - ageHours / windowHours) * 100);
}

function buildLocalDateKey(now: number): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readNumericMetadata(metadata: Record<string, unknown> | undefined, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBooleanMetadata(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function extractTopicTokens(value: string): string[] {
  const matches = value.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  return uniqueStrings(matches).slice(0, 6);
}

function buildTopicFingerprint(candidate: IntelCandidate): string {
  const tags = uniqueStrings([
    ...(Array.isArray(candidate.metadata?.tags)
      ? candidate.metadata.tags.filter((value): value is string => typeof value === "string")
      : []),
    ...extractTopicTokens([candidate.title, candidate.summary].filter(Boolean).join(" ")),
  ])
    .filter((tag) => tag !== candidate.sourceId)
    .slice(0, 6)
    .sort();
  const fallback = extractTopicTokens(candidate.title).join("|") || candidate.sourceId || candidate.id;
  return hashText(`${candidate.domain}|${tags.join("|") || fallback}`);
}

function normalizeCandidate(input: RuntimeIntelCandidateInput, now: number): IntelCandidate {
  const metadata = input.metadata ?? {};
  const scoreBase = clampPercent(typeof input.score === "number" ? input.score : 0);
  const noveltyBoost = Math.min(20, readNumericMetadata(metadata, "noveltyScore") * 0.2);
  const selected = readBooleanMetadata(metadata, "selected");
  return {
    id:
      normalizeText(input.id) ||
      buildStableId("intel_candidate", [input.domain, input.sourceId, input.url || input.title]),
    domain: normalizeDomain(input.domain),
    sourceId: normalizeText(input.sourceId) || "unknown-source",
    title: normalizeText(input.title) || "Untitled intel",
    url: normalizeText(input.url) || undefined,
    summary: normalizeText(input.summary) || undefined,
    score: clampPercent(scoreBase + noveltyBoost),
    selected,
    createdAt:
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : now,
    metadata,
  };
}

type DigestRankingContext = {
  sourceTrustScores: Map<string, number>;
  intelUsefulnessScores: Map<string, number>;
  recentSourceCounts: Map<string, number>;
  recentTopicCounts: Map<string, number>;
};

function candidateDedupeKey(candidate: IntelCandidate): string {
  return [candidate.domain, candidate.url || candidate.title, candidate.sourceId]
    .map((part) => normalizeText(part).toLowerCase())
    .join("|");
}

function dedupeCandidates(candidates: IntelCandidate[]): IntelCandidate[] {
  const byKey = new Map<string, IntelCandidate>();
  for (const candidate of candidates) {
    const key = candidateDedupeKey(candidate);
    const existing = byKey.get(key);
    if (!existing || (candidate.score ?? 0) > (existing.score ?? 0)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].toSorted(
    (left, right) => (right.score ?? 0) - (left.score ?? 0) || right.createdAt - left.createdAt,
  );
}

function limitCandidatesPerDomain(
  candidates: IntelCandidate[],
  candidateLimitPerDomain: number,
): IntelCandidate[] {
  const limit = Math.max(0, Math.floor(candidateLimitPerDomain));
  if (limit <= 0) return [];
  const output: IntelCandidate[] = [];
  for (const domain of INTEL_DOMAINS) {
    output.push(
      ...candidates
        .filter((candidate) => candidate.domain === domain)
        .slice(0, limit),
    );
  }
  return output;
}

function resolveDigestLimits(params: {
  digestItemLimitPerDomain: number;
  exploitItemsPerDigest: number;
  exploreItemsPerDigest: number;
}): { exploitLimit: number; exploreLimit: number } {
  const digestLimit = Math.max(0, Math.floor(params.digestItemLimitPerDomain));
  if (digestLimit <= 0) {
    return { exploitLimit: 0, exploreLimit: 0 };
  }
  const exploitLimit = Math.min(
    digestLimit,
    Math.max(0, Math.floor(params.exploitItemsPerDigest)),
  );
  const exploreLimit = Math.min(
    Math.max(0, digestLimit - exploitLimit),
    Math.max(0, Math.floor(params.exploreItemsPerDigest)),
  );
  return { exploitLimit, exploreLimit };
}

function buildRecentDigestSignals(
  digestItems: IntelDigestItem[],
  domain: IntelDomain,
  now: number,
): { sourceCounts: Map<string, number>; topicCounts: Map<string, number> } {
  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const lookbackMs = RECENT_DIGEST_TOPIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of digestItems) {
    if (entry.domain !== domain) continue;
    if (!Number.isFinite(entry.createdAt) || now - entry.createdAt > lookbackMs) continue;
    const sourceIds = uniqueStrings(entry.sourceIds);
    for (const sourceId of sourceIds) {
      sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
    }
    const topicFingerprint = normalizeText(entry.metadata?.topicFingerprint);
    if (topicFingerprint) {
      topicCounts.set(topicFingerprint, (topicCounts.get(topicFingerprint) ?? 0) + 1);
    }
  }
  return { sourceCounts, topicCounts };
}

function buildSourceTrustSignals(
  memories: MemoryRecord[],
  sourceProfiles: IntelSourceProfile[],
  domain: IntelDomain,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const profile of sourceProfiles) {
    if (profile.domain !== domain) continue;
    scores.set(
      profile.label,
      (scores.get(profile.label) ?? 0) + Math.max(-12, Math.min(12, Number(profile.trustScore ?? 0) / 6)),
    );
  }
  for (const memory of memories) {
    if (memory.invalidatedBy.length > 0) continue;
    if (memory.scope !== domain) continue;
    if (!memory.tags.includes("source-trust")) continue;
    const sourceId =
      normalizeText(memory.metadata?.sourceId) ||
      memory.tags.find((tag) => tag !== "intel" && tag !== "source-trust" && tag !== domain) ||
      "";
    if (!sourceId) continue;
    const weightedScore =
      ((memory.confidence || 0) - (memory.decayScore || 0) * 0.45) / 6 - (memory.avoidWhen ? 4 : 0);
    scores.set(sourceId, (scores.get(sourceId) ?? 0) + weightedScore);
  }
  return scores;
}

function buildIntelUsefulnessSignals(
  memories: MemoryRecord[],
  domain: IntelDomain,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const memory of memories) {
    if (memory.invalidatedBy.length > 0) continue;
    if (!memory.sourceIntelIds.length) continue;
    const typeWeight =
      memory.memoryType === "efficiency"
        ? 16
        : memory.memoryType === "execution"
          ? 14
          : memory.memoryType === "knowledge"
            ? 8
            : 6;
    const confidenceWeight = Math.max(
      0.15,
      (Number(memory.confidence || 0) - Number(memory.decayScore || 0) * 0.35) / 100,
    );
    const scopeWeight = memory.scope === domain ? 1.15 : 1;
    const totalWeight = typeWeight * confidenceWeight * scopeWeight;
    for (const intelId of memory.sourceIntelIds) {
      if (!intelId) continue;
      scores.set(intelId, (scores.get(intelId) ?? 0) + totalWeight);
    }
  }
  return scores;
}

function buildDigestRankingContext(
  memoryStore: RuntimeMemoryStore,
  digestItems: IntelDigestItem[],
  sourceProfiles: IntelSourceProfile[],
  domain: IntelDomain,
  now: number,
): DigestRankingContext {
  const recentSignals = buildRecentDigestSignals(digestItems, domain, now);
  return {
    sourceTrustScores: buildSourceTrustSignals(memoryStore.memories, sourceProfiles, domain),
    intelUsefulnessScores: buildIntelUsefulnessSignals(memoryStore.memories, domain),
    recentSourceCounts: recentSignals.sourceCounts,
    recentTopicCounts: recentSignals.topicCounts,
  };
}

function rankDomainCandidates(
  candidates: IntelCandidate[],
  context: DigestRankingContext,
  now: number,
): IntelCandidate[] {
  return candidates
    .map((candidate) => {
      const topicFingerprint = buildTopicFingerprint(candidate);
      const sourceRecencyCount = context.recentSourceCounts.get(candidate.sourceId) ?? 0;
      const recentTopicCount = context.recentTopicCounts.get(topicFingerprint) ?? 0;
      const sourceTrustBoost = Math.max(
        -16,
        Math.min(16, Number(context.sourceTrustScores.get(candidate.sourceId) ?? 0)),
      );
      const usefulnessBoost = Math.max(
        -6,
        Math.min(18, Number(context.intelUsefulnessScores.get(candidate.id) ?? 0)),
      );
      const sourceDiversityBoost = Math.max(0, 9 - sourceRecencyCount * 3);
      const recentTopicPenalty = recentTopicCount * 10;
      const selectionScore =
        Number(candidate.score ?? 0) +
        sourceTrustBoost +
        usefulnessBoost +
        sourceDiversityBoost -
        recentTopicPenalty;
      const noveltyScore = readNumericMetadata(candidate.metadata, "noveltyScore") || candidate.score || 0;
      const explorationScore =
        noveltyScore * 0.55 +
        selectionScore * 0.25 +
        sourceDiversityBoost * 1.8 -
        recentTopicCount * 4;
      return {
        ...candidate,
        metadata: {
          ...(candidate.metadata ?? {}),
          topicFingerprint,
          selectionScore,
          explorationScore,
          sourceTrustBoost,
          usefulnessBoost,
          sourceDiversityBoost,
          recentTopicPenalty,
          recencyScore: scoreRecency(candidate.createdAt, now, 24 * 7),
        },
      } satisfies IntelCandidate;
    })
    .toSorted((left, right) => {
      const leftScore = readNumericMetadata(left.metadata, "selectionScore") || left.score || 0;
      const rightScore = readNumericMetadata(right.metadata, "selectionScore") || right.score || 0;
      return rightScore - leftScore || (right.score ?? 0) - (left.score ?? 0) || right.createdAt - left.createdAt;
    });
}

function pruneDigestHistory(digestItems: IntelDigestItem[], now: number): IntelDigestItem[] {
  const retentionMs = DIGEST_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return digestItems
    .filter((entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt <= retentionMs)
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, DIGEST_HISTORY_RETENTION_ITEMS);
}

function upsertById<T extends { id: string }>(entries: T[], next: T): T {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    entries.unshift(next);
    return next;
  }
  entries[index] = next;
  return next;
}

function upsertMemory(store: MemoryRecord[], entry: MemoryRecord): MemoryRecord {
  const existing = store.find((candidate) => candidate.id === entry.id);
  if (!existing) {
    store.unshift(entry);
    return entry;
  }
  const merged: MemoryRecord = {
    ...existing,
    ...entry,
    tags: uniqueStrings([...(existing.tags ?? []), ...(entry.tags ?? [])]),
    confidence: Math.max(existing.confidence, entry.confidence),
    version: Math.max(existing.version, entry.version),
    invalidatedBy: uniqueStrings([...(existing.invalidatedBy ?? []), ...(entry.invalidatedBy ?? [])]),
    sourceEventIds: uniqueStrings([...(existing.sourceEventIds ?? []), ...(entry.sourceEventIds ?? [])]),
    sourceTaskIds: uniqueStrings([...(existing.sourceTaskIds ?? []), ...(entry.sourceTaskIds ?? [])]),
    sourceIntelIds: uniqueStrings([...(existing.sourceIntelIds ?? []), ...(entry.sourceIntelIds ?? [])]),
    derivedFromMemoryIds: uniqueStrings([
      ...(existing.derivedFromMemoryIds ?? []),
      ...(entry.derivedFromMemoryIds ?? []),
    ]),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    lastReinforcedAt: Math.max(existing.lastReinforcedAt ?? 0, entry.lastReinforcedAt ?? 0) || undefined,
    decayScore:
      existing.decayScore == null
        ? entry.decayScore
        : entry.decayScore == null
          ? existing.decayScore
          : Math.min(existing.decayScore, entry.decayScore),
  };
  return upsertById(store, merged);
}

function ensureSourceProfile(
  profiles: IntelSourceProfile[],
  candidate: IntelCandidate,
  now: number,
): IntelSourceProfile {
  const existing = profiles.find(
    (entry) => entry.domain === candidate.domain && entry.label === candidate.sourceId,
  );
  const sourcePriority = Math.max(1, readNumericMetadata(candidate.metadata, "sourcePriority") || 1);
  const trustScore = clampPercent(
    averageNumber([
      existing?.trustScore,
      (candidate.score ?? 0) * 0.9,
      readNumericMetadata(candidate.metadata, "credibilityScore"),
    ]),
  );
  return upsertById(profiles, {
    id: existing?.id ?? buildStableId("intel_source", [candidate.domain, candidate.sourceId]),
    domain: candidate.domain,
    label: candidate.sourceId,
    priority: Math.max(existing?.priority ?? 1, sourcePriority),
    trustScore,
    metadata: {
      ...(existing?.metadata ?? {}),
      latestFetchAt: now,
      lastFetchedAt: now,
      sourceType: normalizeText(candidate.metadata?.sourceType) || undefined,
    },
  });
}

function upsertTopicProfiles(
  profiles: IntelTopicProfile[],
  candidate: IntelCandidate,
  now: number,
): void {
  const tokens = extractTopicTokens([candidate.title, candidate.summary].filter(Boolean).join(" "));
  for (const topic of tokens) {
    upsertById(profiles, {
      id: buildStableId("intel_topic", [candidate.domain, topic]),
      domain: candidate.domain,
      topic,
      weight: clampPercent((candidate.score ?? 0) * 0.8),
      updatedAt: now,
      metadata: {
        sourceId: candidate.sourceId,
      },
    });
  }
}

function buildDigestItem(
  candidate: IntelCandidate,
  exploit: boolean,
  now: number,
): IntelDigestItem {
  const metadata = candidate.metadata ?? {};
  const noveltyScore = readNumericMetadata(metadata, "noveltyScore");
  const conclusion =
    normalizeText(metadata.judgement) ||
    (exploit
      ? `${candidate.domain} signal selected for exploitation.`
      : `${candidate.domain} signal selected for exploration.`);
  return {
    id: buildStableId("intel_digest_item", [
      candidate.id,
      exploit ? "exploit" : "explore",
      buildLocalDateKey(now),
    ]),
    domain: candidate.domain,
    title: candidate.title,
    conclusion,
    whyItMatters:
      exploit
        ? `score=${clampPercent(candidate.score ?? 0)}`
        : `novelty=${clampPercent(noveltyScore || candidate.score || 0)}`,
    recommendedAttention: exploit ? "review" : "scan",
    recommendedAction: exploit ? "reference" : "observe",
    sourceIds: [candidate.sourceId],
    exploit,
    createdAt: now,
    metadata: {
      ...(candidate.metadata ?? {}),
      digestDate: buildLocalDateKey(now),
      topicFingerprint:
        normalizeText(candidate.metadata?.topicFingerprint) || buildTopicFingerprint(candidate),
    },
  };
}

function selectDigestCandidates(
  candidates: IntelCandidate[],
  exploitLimit: number,
  exploreLimit: number,
): Array<{ candidate: IntelCandidate; exploit: boolean }> {
  const ranked = [...candidates].toSorted(
    (left, right) => {
      const leftSelection = readNumericMetadata(left.metadata, "selectionScore") || left.score || 0;
      const rightSelection =
        readNumericMetadata(right.metadata, "selectionScore") || right.score || 0;
      return (
        rightSelection - leftSelection ||
        (right.score ?? 0) - (left.score ?? 0) ||
        right.createdAt - left.createdAt
      );
    },
  );
  const selectedIds = new Set<string>();
  const output: Array<{ candidate: IntelCandidate; exploit: boolean }> = [];

  for (const candidate of ranked) {
    if (output.length >= exploitLimit) break;
    output.push({ candidate, exploit: true });
    selectedIds.add(candidate.id);
  }

  const exploreRanked = ranked
    .filter((candidate) => !selectedIds.has(candidate.id))
    .toSorted((left, right) => {
      const leftExploration =
        readNumericMetadata(left.metadata, "explorationScore") ||
        readNumericMetadata(left.metadata, "noveltyScore") ||
        left.score ||
        0;
      const rightExploration =
        readNumericMetadata(right.metadata, "explorationScore") ||
        readNumericMetadata(right.metadata, "noveltyScore") ||
        right.score ||
        0;
      return (
        rightExploration - leftExploration ||
        (right.score ?? 0) - (left.score ?? 0) ||
        right.createdAt - left.createdAt
      );
    });
  for (const candidate of exploreRanked) {
    if (output.length >= exploitLimit + exploreLimit) break;
    output.push({ candidate, exploit: false });
    selectedIds.add(candidate.id);
  }

  return output;
}

function buildKnowledgeMemory(
  candidate: IntelCandidate,
  digestItem: IntelDigestItem,
  now: number,
): MemoryRecord {
  return {
    id: buildStableId("intel_knowledge_memory", [candidate.domain, candidate.url || candidate.title]),
    layer: "memories",
    memoryType: "knowledge" satisfies FormalMemoryType,
    route: candidate.domain,
    scope: candidate.domain,
    summary: `${candidate.title}: ${digestItem.conclusion}`,
    detail: candidate.summary,
    appliesWhen: `domain=${candidate.domain}`,
    avoidWhen: undefined,
    tags: uniqueStrings([
      "intel",
      candidate.domain,
      digestItem.exploit ? "exploit" : "explore",
      `source:${candidate.sourceId}`,
      ...extractTopicTokens(candidate.title),
    ]),
    confidence: clampPercent(candidate.score ?? 0),
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [],
    sourceTaskIds: [],
    sourceIntelIds: [candidate.id],
    derivedFromMemoryIds: [],
    lastReinforcedAt: now,
    decayScore: digestItem.exploit ? 18 : 26,
    createdAt: now,
    updatedAt: now,
    metadata: {
      digestItemId: digestItem.id,
    },
  };
}

function buildSourceTrustMemory(candidate: IntelCandidate, now: number): MemoryRecord {
  return {
    id: buildStableId("intel_source_trust_memory", [candidate.domain, candidate.sourceId]),
    layer: "memories",
    memoryType: "knowledge",
    route: candidate.domain,
    scope: candidate.domain,
    summary: `${candidate.sourceId} is repeatedly selected in ${candidate.domain}.`,
    detail: `source=${candidate.sourceId}`,
    appliesWhen: `source=${candidate.sourceId}`,
    avoidWhen: undefined,
    tags: ["intel", "source-trust", candidate.domain, candidate.sourceId],
    confidence: clampPercent((candidate.score ?? 0) * 0.85),
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [],
    sourceTaskIds: [],
    sourceIntelIds: [candidate.id],
    derivedFromMemoryIds: [],
    lastReinforcedAt: now,
    decayScore: 20,
    createdAt: now,
    updatedAt: now,
    metadata: {
      sourceId: candidate.sourceId,
    },
  };
}

export function runRuntimeIntelPipeline(
  inputs: RuntimeIntelCandidateInput[],
  opts: RuntimeStoreOptions = {},
): RuntimeIntelPipelineResult {
  const now = resolveNow(opts.now);
  const stores = loadRuntimeStoreBundle({
    ...opts,
    now,
  });
  const incoming = inputs.map((input) => normalizeCandidate(input, now));
  const mergedCandidates = limitCandidatesPerDomain(
    dedupeCandidates([...stores.intelStore.candidates, ...incoming]),
    stores.intelStore.candidateLimitPerDomain,
  );
  stores.intelStore.candidates = mergedCandidates;
  stores.intelStore.digestItems = pruneDigestHistory(stores.intelStore.digestItems, now);

  const digestItems: IntelDigestItem[] = [];
  const knowledgeMemoryIds: string[] = [];
  const sourceTrustMemoryIds: string[] = [];

  for (const domain of INTEL_DOMAINS) {
    const domainCandidates = rankDomainCandidates(
      mergedCandidates.filter((candidate) => candidate.domain === domain),
      buildDigestRankingContext(
        stores.memoryStore,
        stores.intelStore.digestItems,
        stores.intelStore.sourceProfiles,
        domain,
        now,
      ),
      now,
    );
    const { exploitLimit, exploreLimit } = resolveDigestLimits({
      digestItemLimitPerDomain: stores.intelStore.digestItemLimitPerDomain,
      exploitItemsPerDigest: stores.intelStore.exploitItemsPerDigest,
      exploreItemsPerDigest: stores.intelStore.exploreItemsPerDigest,
    });
    const selected = selectDigestCandidates(
      domainCandidates,
      stores.intelStore.digestEnabled ? exploitLimit : 0,
      stores.intelStore.digestEnabled ? exploreLimit : 0,
    );
    const rankedById = new Map(domainCandidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of domainCandidates) {
      candidate.selected = selected.some((entry) => entry.candidate.id === candidate.id);
      ensureSourceProfile(stores.intelStore.sourceProfiles, candidate, now);
      upsertTopicProfiles(stores.intelStore.topicProfiles, candidate, now);
    }
    for (const candidate of mergedCandidates) {
      if (candidate.domain !== domain) continue;
      const ranked = rankedById.get(candidate.id);
      if (!ranked) continue;
      candidate.score = ranked.score;
      candidate.selected = ranked.selected;
      candidate.metadata = ranked.metadata;
    }
    if (!stores.intelStore.digestEnabled) {
      continue;
    }
    for (const entry of selected) {
      const digestItem = buildDigestItem(entry.candidate, entry.exploit, now);
      digestItems.push(digestItem);
      upsertById(stores.intelStore.digestItems, digestItem);
      const knowledgeMemory = upsertMemory(
        stores.memoryStore.memories,
        buildKnowledgeMemory(entry.candidate, digestItem, now),
      );
      knowledgeMemoryIds.push(knowledgeMemory.id);
      const sourceTrustMemory = upsertMemory(
        stores.memoryStore.memories,
        buildSourceTrustMemory(entry.candidate, now),
      );
      sourceTrustMemoryIds.push(sourceTrustMemory.id);
    }
  }

  stores.intelStore.lastImportedAt = now;
  stores.memoryStore.lastImportedAt = now;
  stores.intelStore.digestItems = pruneDigestHistory(stores.intelStore.digestItems, now);
  saveRuntimeStoreBundle(stores, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_intel_pipeline_ran",
    {
      candidateCount: mergedCandidates.length,
      digestItemCount: digestItems.length,
      knowledgeMemoryIds,
      sourceTrustMemoryIds,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    candidates: mergedCandidates,
    digestItems,
    knowledgeMemoryIds: uniqueStrings(knowledgeMemoryIds),
    sourceTrustMemoryIds: uniqueStrings(sourceTrustMemoryIds),
  };
}
