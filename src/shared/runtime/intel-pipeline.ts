import type {
  IntelCandidate,
  IntelDigestItem,
  IntelItemRankRecord,
  IntelSourceProfile,
  IntelTopicProfile,
  IntelUsefulnessRecord,
} from "./contracts.js";
import {
  DEFAULT_RUNTIME_INFO_DOMAINS,
  normalizeRuntimeInfoDomain,
  type RuntimeInfoDomain,
} from "./intel-domains.js";
import {
  appendRuntimeEvent,
  loadRuntimeIntelStore,
  saveRuntimeIntelStore,
  type RuntimeStoreOptions,
} from "./store.js";

const DIGEST_HISTORY_RETENTION_DAYS = 14;
const DIGEST_HISTORY_RETENTION_ITEMS = 400;
const RANK_HISTORY_RETENTION_DAYS = 14;
const RANK_HISTORY_RETENTION_ITEMS = 800;
const RECENT_DIGEST_TOPIC_WINDOW_DAYS = 5;

const INTEL_DOMAINS = DEFAULT_RUNTIME_INFO_DOMAINS;

export type IntelDomain = RuntimeInfoDomain;

export type RuntimeIntelCandidateInput = {
  id?: string;
  domain: string;
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
};

function resolveNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values?.length) {
    return [];
  }
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

function averageNumber(values: Array<number | null | undefined>): number {
  const normalized = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (normalized.length === 0) {
    return 0;
  }
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
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
  return normalizeRuntimeInfoDomain(value);
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

function scoreRecency(value: number, now: number, windowHours = 72): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const ageHours = Math.max(0, (now - value) / (60 * 60 * 1000));
  if (ageHours >= windowHours) {
    return 0;
  }
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
    .toSorted();
  const fallback =
    extractTopicTokens(candidate.title).join("|") || candidate.sourceId || candidate.id;
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
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : now,
    metadata,
  };
}

type DigestRankingContext = {
  sourceTrustScores: Map<string, number>;
  sourceUsefulnessScores: Map<string, number>;
  topicWeightScores: Map<string, number>;
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
  if (limit <= 0) {
    return [];
  }
  const output: IntelCandidate[] = [];
  for (const domain of INTEL_DOMAINS) {
    output.push(...candidates.filter((candidate) => candidate.domain === domain).slice(0, limit));
  }
  return output;
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
    if (entry.domain !== domain) {
      continue;
    }
    if (!Number.isFinite(entry.createdAt) || now - entry.createdAt > lookbackMs) {
      continue;
    }
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
  sourceProfiles: IntelSourceProfile[],
  domain: IntelDomain,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const profile of sourceProfiles) {
    if (profile.domain !== domain) {
      continue;
    }
    scores.set(
      profile.label,
      (scores.get(profile.label) ?? 0) +
        Math.max(-12, Math.min(12, Number(profile.trustScore ?? 0) / 6)),
    );
  }
  return scores;
}

function buildDigestRankingContext(
  digestItems: IntelDigestItem[],
  sourceProfiles: IntelSourceProfile[],
  topicProfiles: IntelTopicProfile[],
  usefulnessRecords: IntelUsefulnessRecord[],
  domain: IntelDomain,
  now: number,
): DigestRankingContext {
  const recentSignals = buildRecentDigestSignals(digestItems, domain, now);
  return {
    sourceTrustScores: buildSourceTrustSignals(sourceProfiles, domain),
    sourceUsefulnessScores: buildUsefulnessSignals(usefulnessRecords, domain),
    topicWeightScores: buildTopicWeightSignals(topicProfiles, domain),
    recentSourceCounts: recentSignals.sourceCounts,
    recentTopicCounts: recentSignals.topicCounts,
  };
}

function buildUsefulnessSignals(
  usefulnessRecords: IntelUsefulnessRecord[],
  domain: IntelDomain,
): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const record of usefulnessRecords) {
    if (record.domain !== domain) {
      continue;
    }
    const scores = grouped.get(record.sourceId) ?? [];
    scores.push(Math.max(0, Math.min(100, Number(record.usefulnessScore ?? 0))));
    grouped.set(record.sourceId, scores);
  }
  const output = new Map<string, number>();
  for (const [sourceId, scores] of grouped.entries()) {
    output.set(sourceId, Math.max(-12, Math.min(16, averageNumber(scores) / 8 - 6)));
  }
  return output;
}

function buildTopicWeightSignals(
  topicProfiles: IntelTopicProfile[],
  domain: IntelDomain,
): Map<string, number> {
  const output = new Map<string, number>();
  for (const profile of topicProfiles) {
    if (profile.domain !== domain) {
      continue;
    }
    const topic = normalizeText(profile.topic).toLowerCase();
    if (!topic) {
      continue;
    }
    output.set(topic, Math.max(-10, Math.min(18, Number(profile.weight ?? 0) / 8 - 5)));
  }
  return output;
}

function rankDomainCandidates(
  candidates: IntelCandidate[],
  context: DigestRankingContext,
  now: number,
): IntelCandidate[] {
  return candidates
    .map((candidate) => {
      const topicFingerprint = buildTopicFingerprint(candidate);
      const topicTokens = extractTopicTokens(
        [candidate.title, candidate.summary].filter(Boolean).join(" "),
      );
      const matchedTopics = topicTokens.filter((topic) =>
        context.topicWeightScores.has(topic.toLowerCase()),
      );
      const sourceRecencyCount = context.recentSourceCounts.get(candidate.sourceId) ?? 0;
      const recentTopicCount = context.recentTopicCounts.get(topicFingerprint) ?? 0;
      const sourceTrustBoost = Math.max(
        -16,
        Math.min(16, Number(context.sourceTrustScores.get(candidate.sourceId) ?? 0)),
      );
      const sourceUsefulnessBoost = Math.max(
        -12,
        Math.min(16, Number(context.sourceUsefulnessScores.get(candidate.sourceId) ?? 0)),
      );
      const topicWeightBoost = Math.max(
        -10,
        Math.min(
          18,
          averageNumber(
            matchedTopics.length > 0
              ? matchedTopics.map(
                  (topic) => context.topicWeightScores.get(topic.toLowerCase()) ?? 0,
                )
              : [0],
          ),
        ),
      );
      const sourceDiversityBoost = Math.max(0, 9 - sourceRecencyCount * 3);
      const recentTopicPenalty = recentTopicCount * 10;
      const selectionScore =
        Number(candidate.score ?? 0) +
        sourceTrustBoost +
        sourceUsefulnessBoost +
        topicWeightBoost +
        sourceDiversityBoost -
        recentTopicPenalty;
      const noveltyScore =
        readNumericMetadata(candidate.metadata, "noveltyScore") || candidate.score || 0;
      const explorationScore =
        noveltyScore * 0.55 +
        selectionScore * 0.25 +
        sourceDiversityBoost * 1.8 -
        recentTopicCount * 4;
      return {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          topicFingerprint,
          selectionScore,
          explorationScore,
          sourceTrustBoost,
          sourceUsefulnessBoost,
          topicWeightBoost,
          sourceDiversityBoost,
          recentTopicPenalty,
          matchedTopics,
          recencyScore: scoreRecency(candidate.createdAt, now, 24 * 7),
        },
      } satisfies IntelCandidate;
    })
    .toSorted((left, right) => {
      const leftScore = readNumericMetadata(left.metadata, "selectionScore") || left.score || 0;
      const rightScore = readNumericMetadata(right.metadata, "selectionScore") || right.score || 0;
      return (
        rightScore - leftScore ||
        (right.score ?? 0) - (left.score ?? 0) ||
        right.createdAt - left.createdAt
      );
    });
}

function pruneDigestHistory(digestItems: IntelDigestItem[], now: number): IntelDigestItem[] {
  const retentionMs = DIGEST_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return digestItems
    .filter((entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt <= retentionMs)
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, DIGEST_HISTORY_RETENTION_ITEMS);
}

function pruneRankHistory(rankRecords: IntelItemRankRecord[], now: number): IntelItemRankRecord[] {
  const retentionMs = RANK_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return rankRecords
    .filter((entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt <= retentionMs)
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, RANK_HISTORY_RETENTION_ITEMS);
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

function ensureSourceProfile(
  profiles: IntelSourceProfile[],
  candidate: IntelCandidate,
  now: number,
): IntelSourceProfile {
  const existing = profiles.find(
    (entry) => entry.domain === candidate.domain && entry.label === candidate.sourceId,
  );
  const sourcePriority = Math.max(
    1,
    readNumericMetadata(candidate.metadata, "sourcePriority") || 1,
  );
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
      ...existing?.metadata,
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
    whyItMatters: exploit
      ? `score=${clampPercent(candidate.score ?? 0)}`
      : `novelty=${clampPercent(noveltyScore || candidate.score || 0)}`,
    recommendedAttention: exploit ? "review" : "scan",
    recommendedAction: exploit ? "reference" : "observe",
    sourceIds: [candidate.sourceId],
    exploit,
    createdAt: now,
    metadata: {
      ...candidate.metadata,
      candidateId: candidate.id,
      candidateScore: clampPercent(candidate.score ?? 0),
      digestDate: buildLocalDateKey(now),
      topicFingerprint:
        normalizeText(candidate.metadata?.topicFingerprint) || buildTopicFingerprint(candidate),
    },
  };
}

function appendRankHistoryEntries(
  rankRecords: IntelItemRankRecord[],
  candidates: IntelCandidate[],
  selected: { exploit: IntelCandidate[]; explore: IntelCandidate[] },
  now: number,
): IntelItemRankRecord[] {
  const selectionRankById = new Map(
    [...candidates]
      .toSorted((left, right) => {
        const leftScore = readNumericMetadata(left.metadata, "selectionScore") || left.score || 0;
        const rightScore =
          readNumericMetadata(right.metadata, "selectionScore") || right.score || 0;
        return (
          rightScore - leftScore ||
          (right.score ?? 0) - (left.score ?? 0) ||
          right.createdAt - left.createdAt
        );
      })
      .map((candidate, index) => [candidate.id, index + 1] as const),
  );
  const explorationRankById = new Map(
    [...candidates]
      .toSorted((left, right) => {
        const leftScore = readNumericMetadata(left.metadata, "explorationScore");
        const rightScore = readNumericMetadata(right.metadata, "explorationScore");
        return (
          rightScore - leftScore ||
          (right.score ?? 0) - (left.score ?? 0) ||
          right.createdAt - left.createdAt
        );
      })
      .map((candidate, index) => [candidate.id, index + 1] as const),
  );
  const selectedModeById = new Map<string, "exploit" | "explore">();
  for (const candidate of selected.exploit) {
    selectedModeById.set(candidate.id, "exploit");
  }
  for (const candidate of selected.explore) {
    selectedModeById.set(candidate.id, "explore");
  }
  for (const candidate of candidates) {
    rankRecords.unshift({
      id: buildStableId("intel_rank_record", [candidate.id, now]),
      intelId: candidate.id,
      sourceId: candidate.sourceId,
      domain: candidate.domain,
      selectionRank: selectionRankById.get(candidate.id),
      explorationRank: explorationRankById.get(candidate.id),
      selectionScore:
        readNumericMetadata(candidate.metadata, "selectionScore") || candidate.score || 0,
      explorationScore: readNumericMetadata(candidate.metadata, "explorationScore"),
      selected: selectedModeById.has(candidate.id),
      selectedMode: selectedModeById.get(candidate.id) ?? "none",
      createdAt: now,
      metadata: {
        title: candidate.title,
        topicFingerprint: normalizeText(candidate.metadata?.topicFingerprint) || undefined,
        sourceTrustBoost: readNumericMetadata(candidate.metadata, "sourceTrustBoost"),
        sourceUsefulnessBoost: readNumericMetadata(candidate.metadata, "sourceUsefulnessBoost"),
        topicWeightBoost: readNumericMetadata(candidate.metadata, "topicWeightBoost"),
        sourceDiversityBoost: readNumericMetadata(candidate.metadata, "sourceDiversityBoost"),
        recentTopicPenalty: readNumericMetadata(candidate.metadata, "recentTopicPenalty"),
        matchedTopics: Array.isArray(candidate.metadata?.matchedTopics)
          ? candidate.metadata.matchedTopics
          : undefined,
      },
    });
  }
  return pruneRankHistory(rankRecords, now);
}

function selectDigestCandidates(
  candidates: IntelCandidate[],
  itemLimit: number,
  exploitItemLimit: number,
  exploreItemLimit: number,
  maxItemsPerSource: number,
): { exploit: IntelCandidate[]; explore: IntelCandidate[] } {
  const ranked = [...candidates].toSorted((left, right) => {
    const leftSelection = readNumericMetadata(left.metadata, "selectionScore") || left.score || 0;
    const rightSelection =
      readNumericMetadata(right.metadata, "selectionScore") || right.score || 0;
    return (
      rightSelection - leftSelection ||
      (right.score ?? 0) - (left.score ?? 0) ||
      right.createdAt - left.createdAt
    );
  });
  const exploit: IntelCandidate[] = [];
  const explore: IntelCandidate[] = [];
  const selectedIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const cappedItemLimit = Math.max(0, Math.trunc(itemLimit));
  const cappedExploitLimit = Math.max(0, Math.min(cappedItemLimit, Math.trunc(exploitItemLimit)));
  const cappedExploreLimit = Math.max(
    0,
    Math.min(cappedItemLimit - cappedExploitLimit, Math.trunc(exploreItemLimit)),
  );

  function trySelect(
    target: IntelCandidate[],
    candidate: IntelCandidate,
    limit: number,
    explorationMode: boolean,
    opts: {
      enforceSourceCap?: boolean;
      enforceExploreTopicGate?: boolean;
    } = {},
  ) {
    if (target.length >= limit || selectedIds.has(candidate.id)) {
      return;
    }
    const sourceId = normalizeText(candidate.sourceId) || "unknown-source";
    const count = sourceCounts.get(sourceId) ?? 0;
    if (opts.enforceSourceCap !== false && count >= maxItemsPerSource) {
      return;
    }
    const topicPenalty = readNumericMetadata(candidate.metadata, "recentTopicPenalty");
    if (
      explorationMode &&
      opts.enforceExploreTopicGate !== false &&
      topicPenalty > 20 &&
      exploit.length + explore.length < cappedItemLimit
    ) {
      return;
    }
    target.push(candidate);
    selectedIds.add(candidate.id);
    sourceCounts.set(sourceId, count + 1);
  }

  for (const candidate of ranked) {
    trySelect(exploit, candidate, cappedExploitLimit, false);
  }

  const explorationRanked = [...ranked].toSorted((left, right) => {
    const leftScore = readNumericMetadata(left.metadata, "explorationScore");
    const rightScore = readNumericMetadata(right.metadata, "explorationScore");
    return (
      rightScore - leftScore ||
      (right.score ?? 0) - (left.score ?? 0) ||
      right.createdAt - left.createdAt
    );
  });
  for (const candidate of explorationRanked) {
    trySelect(explore, candidate, cappedExploreLimit, true);
  }

  for (const candidate of ranked) {
    if (exploit.length < cappedExploitLimit) {
      trySelect(exploit, candidate, cappedExploitLimit, false);
      continue;
    }
    if (explore.length < cappedExploreLimit) {
      trySelect(explore, candidate, cappedExploreLimit, true);
    }
  }

  if (exploit.length < cappedExploitLimit) {
    for (const candidate of ranked) {
      trySelect(exploit, candidate, cappedExploitLimit, false, {
        enforceSourceCap: false,
      });
      if (exploit.length >= cappedExploitLimit) {
        break;
      }
    }
  }

  if (explore.length < cappedExploreLimit) {
    for (const candidate of explorationRanked) {
      trySelect(explore, candidate, cappedExploreLimit, true, {
        enforceSourceCap: false,
        enforceExploreTopicGate: false,
      });
      if (explore.length >= cappedExploreLimit) {
        break;
      }
    }
  }

  return { exploit, explore };
}

export function runRuntimeIntelPipeline(
  inputs: RuntimeIntelCandidateInput[],
  opts: RuntimeStoreOptions = {},
): RuntimeIntelPipelineResult {
  const now = resolveNow(opts.now);
  const intelStore = loadRuntimeIntelStore({
    ...opts,
    now,
  });
  if (!intelStore.enabled) {
    return {
      candidates: intelStore.candidates,
      digestItems: [],
    };
  }
  const incoming = inputs.map((input) => normalizeCandidate(input, now));
  const mergedCandidates = limitCandidatesPerDomain(
    dedupeCandidates([...intelStore.candidates, ...incoming]),
    intelStore.candidateLimitPerDomain,
  );
  intelStore.candidates = mergedCandidates;
  intelStore.digestItems = pruneDigestHistory(intelStore.digestItems, now);

  const digestItems: IntelDigestItem[] = [];
  const rankedCandidatesById = new Map<string, IntelCandidate>();

  for (const domain of INTEL_DOMAINS) {
    const domainCandidates = rankDomainCandidates(
      mergedCandidates.filter((candidate) => candidate.domain === domain),
      buildDigestRankingContext(
        intelStore.digestItems,
        intelStore.sourceProfiles,
        intelStore.topicProfiles,
        intelStore.usefulnessRecords,
        domain,
        now,
      ),
      now,
    );
    const rankedById = new Map(domainCandidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of domainCandidates) {
      candidate.selected = false;
      ensureSourceProfile(intelStore.sourceProfiles, candidate, now);
      upsertTopicProfiles(intelStore.topicProfiles, candidate, now);
      rankedCandidatesById.set(candidate.id, candidate);
    }
    for (const candidate of mergedCandidates) {
      if (candidate.domain !== domain) {
        continue;
      }
      const ranked = rankedById.get(candidate.id);
      if (!ranked) {
        continue;
      }
      candidate.score = ranked.score;
      candidate.selected = ranked.selected;
      candidate.metadata = ranked.metadata;
    }
  }

  for (const candidate of mergedCandidates) {
    candidate.selected = false;
  }

  if (intelStore.digestEnabled) {
    const maxItemsPerSource = Math.max(
      1,
      Math.trunc(readNumericMetadata(intelStore.metadata, "maxItemsPerSourceInDigest") || 2),
    );
    for (const domain of INTEL_DOMAINS) {
      const selected = selectDigestCandidates(
        [...rankedCandidatesById.values()].filter((candidate) => candidate.domain === domain),
        intelStore.digestItemLimitPerDomain,
        intelStore.exploitItemsPerDigest,
        intelStore.exploreItemsPerDigest,
        maxItemsPerSource,
      );
      intelStore.rankRecords = appendRankHistoryEntries(
        intelStore.rankRecords,
        [...rankedCandidatesById.values()].filter((candidate) => candidate.domain === domain),
        selected,
        now,
      );
      for (const candidate of selected.exploit) {
        candidate.selected = true;
        const digestItem = buildDigestItem(candidate, true, now);
        digestItems.push(digestItem);
        upsertById(intelStore.digestItems, digestItem);
      }
      for (const candidate of selected.explore) {
        candidate.selected = true;
        const digestItem = buildDigestItem(candidate, false, now);
        digestItems.push(digestItem);
        upsertById(intelStore.digestItems, digestItem);
      }
    }
  } else {
    for (const domain of INTEL_DOMAINS) {
      intelStore.rankRecords = appendRankHistoryEntries(
        intelStore.rankRecords,
        [...rankedCandidatesById.values()].filter((candidate) => candidate.domain === domain),
        {
          exploit: [],
          explore: [],
        },
        now,
      );
    }
  }

  const selectedCandidateIds = new Set(
    digestItems
      .map((item) => item.metadata?.candidateId)
      .filter((value): value is string => typeof value === "string"),
  );
  for (const candidate of mergedCandidates) {
    candidate.selected = selectedCandidateIds.has(candidate.id);
  }

  intelStore.lastImportedAt = now;
  intelStore.digestItems = pruneDigestHistory(intelStore.digestItems, now);
  intelStore.rankRecords = pruneRankHistory(intelStore.rankRecords, now);
  saveRuntimeIntelStore(intelStore, {
    ...opts,
    now,
  });
  appendRuntimeEvent(
    "runtime_intel_pipeline_ran",
    {
      candidateCount: mergedCandidates.length,
      digestItemCount: digestItems.length,
    },
    {
      ...opts,
      now,
    },
  );

  return {
    candidates: mergedCandidates,
    digestItems,
  };
}
