import type {
  ContextPack,
  MemoryRecord,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalSourceSet,
  StrategyRecord,
} from "./contracts.js";

type ScoredRecord<T> = {
  record: T;
  score: number;
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(trimmed);
  }
  return out;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value as number));
}

export function buildRouteDomains(route?: string): string[] {
  switch ((route || "").trim().toLowerCase()) {
    case "coder":
      return ["tech", "ai", "github"];
    case "ops":
      return ["tech", "github"];
    case "research":
      return ["ai", "business", "tech", "github"];
    case "office":
      return ["business"];
    case "media":
      return ["tech", "ai"];
    default:
      return ["ai", "tech", "business", "github"];
  }
}

function buildQueryHints(query: RetrievalQuery): string[] {
  return uniqueStrings([query.route, query.worker, query.prompt, ...query.topicHints]);
}

function countTextHits(parts: Array<string | undefined>, hints: string[]): number {
  const haystack = parts
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
  if (!haystack) {
    return 0;
  }

  let hits = 0;
  for (const hint of hints) {
    const normalized = hint.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (haystack.includes(normalized)) {
      hits += 1;
    }
  }
  return hits;
}

function scoreMemoryRecord(record: MemoryRecord, query: RetrievalQuery, hints: string[]): number {
  if (record.invalidatedBy.length > 0) {
    return -1000;
  }

  let score = record.confidence;
  if (record.route && query.route && record.route === query.route) {
    score += 24;
  }
  if (
    record.memoryType === "knowledge" &&
    record.scope &&
    buildRouteDomains(query.route).includes(record.scope)
  ) {
    score += 16;
  }
  if (query.taskId && record.sourceTaskIds.includes(query.taskId)) {
    score += 24;
  }
  score += countTextHits([record.summary, record.detail, ...record.tags], hints) * 8;
  if (record.memoryType === "execution" || record.memoryType === "efficiency") {
    score += 8;
  }
  return score;
}

function scoreStrategyRecord(
  record: StrategyRecord,
  query: RetrievalQuery,
  hints: string[],
): number {
  if (record.invalidatedBy.length > 0) {
    return -1000;
  }

  let score = record.confidence;
  if (query.route && record.route === query.route) {
    score += 24;
  }
  if (query.worker && record.worker === query.worker) {
    score += 8;
  }
  if (record.thinkingLane === query.thinkingLane) {
    score += 4;
  }
  score += countTextHits([record.summary, record.worker, ...record.skillIds], hints) * 8;
  return score;
}

function scoreArchiveCandidate(
  record: RetrievalCandidate,
  query: RetrievalQuery,
  hints: string[],
): number {
  let score = Number(record.score || 0);
  if (!Number.isFinite(score)) {
    score = 0;
  }
  if (query.route && record.sourceRef?.includes(query.route)) {
    score += 8;
  }
  score += countTextHits([record.title, record.excerpt, record.sourceRef], hints) * 6;
  return score;
}

export function buildStructuredMatches(params: {
  query: RetrievalQuery;
  sources: RetrievalSourceSet;
}): {
  strategies: Array<ScoredRecord<StrategyRecord>>;
  memories: Array<ScoredRecord<MemoryRecord>>;
  sessions: Array<ScoredRecord<RetrievalCandidate>>;
  archive: Array<ScoredRecord<RetrievalCandidate>>;
} {
  const hints = buildQueryHints(params.query);
  const strategies = params.sources.strategies
    .map((record) => ({ record, score: scoreStrategyRecord(record, params.query, hints) }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score);
  const memories = params.sources.memories
    .map((record) => ({ record, score: scoreMemoryRecord(record, params.query, hints) }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score);
  const sessions = (params.sources.sessions ?? [])
    .map((record) => ({
      record: {
        ...record,
        plane: "session" as const,
      },
      score: scoreArchiveCandidate(
        {
          ...record,
          plane: "session",
        },
        params.query,
        hints,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score);
  const archive = (params.sources.archive ?? [])
    .map((record) => ({ record, score: scoreArchiveCandidate(record, params.query, hints) }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score);

  return { strategies, memories, sessions, archive };
}

function toStrategyCandidate(entry: ScoredRecord<StrategyRecord>): RetrievalCandidate {
  return {
    id: `strategy:${entry.record.id}`,
    plane: "strategy",
    recordId: entry.record.id,
    title: entry.record.summary,
    excerpt: [entry.record.worker, entry.record.thinkingLane].filter(Boolean).join(" | "),
    score: entry.score,
    confidence: entry.record.confidence,
    sourceRef: `strategy:${entry.record.id}`,
    metadata: {
      worker: entry.record.worker,
      skillIds: entry.record.skillIds,
      thinkingLane: entry.record.thinkingLane,
    },
  };
}

function toMemoryCandidate(entry: ScoredRecord<MemoryRecord>): RetrievalCandidate {
  return {
    id: `memory:${entry.record.id}`,
    plane: "memory",
    recordId: entry.record.id,
    title: entry.record.summary,
    excerpt: entry.record.detail,
    score: entry.score,
    confidence: entry.record.confidence,
    sourceRef: `memory:${entry.record.id}`,
    metadata: {
      memoryType: entry.record.memoryType,
      route: entry.record.route,
      scope: entry.record.scope,
      tags: entry.record.tags,
    },
  };
}
export function buildHybridCandidateGeneration(params: {
  query: RetrievalQuery;
  structured: ReturnType<typeof buildStructuredMatches>;
}): {
  strategyCandidates: RetrievalCandidate[];
  memoryCandidates: RetrievalCandidate[];
  sessionCandidates: RetrievalCandidate[];
  archiveCandidates: RetrievalCandidate[];
} {
  const limit = clampLimit(params.query.maxCandidatesPerPlane, 4);
  const planes = new Set(params.query.planes);

  const strategyCandidates = planes.has("strategy")
    ? params.structured.strategies.slice(0, limit).map(toStrategyCandidate)
    : [];
  const memoryCandidates = planes.has("memory")
    ? params.structured.memories.slice(0, limit).map(toMemoryCandidate)
    : [];
  const sessionCandidates = planes.has("session")
    ? params.structured.sessions.slice(0, limit).map((entry) => ({
        ...entry.record,
        plane: "session" as const,
        score: entry.score,
      }))
    : [];
  const archiveCandidates = planes.has("archive")
    ? params.structured.archive.slice(0, limit).map((entry) => ({
        ...entry.record,
        plane: "archive" as const,
        score: entry.score,
      }))
    : [];

  return {
    strategyCandidates,
    memoryCandidates,
    sessionCandidates,
    archiveCandidates,
  };
}

export function buildContextPack(params: {
  query: RetrievalQuery;
  sources: RetrievalSourceSet;
}): ContextPack {
  const structured = buildStructuredMatches(params);
  const hybrid = buildHybridCandidateGeneration({
    query: params.query,
    structured,
  });
  const summary = [
    `strategy=${hybrid.strategyCandidates.length}`,
    `memory=${hybrid.memoryCandidates.length}`,
    `session=${hybrid.sessionCandidates.length}`,
    `archive=${hybrid.archiveCandidates.length}`,
  ].join(" | ");
  const synthesis = uniqueStrings([
    `route=${(params.query.route || "general").trim() || "general"}`,
    params.query.worker ? `worker=${params.query.worker}` : null,
    hybrid.strategyCandidates[0]?.title
      ? `top-strategy=${hybrid.strategyCandidates[0].title}`
      : null,
    hybrid.memoryCandidates[0]?.title ? `top-memory=${hybrid.memoryCandidates[0].title}` : null,
    hybrid.sessionCandidates[0]?.title ? `top-session=${hybrid.sessionCandidates[0].title}` : null,
    hybrid.archiveCandidates[0]?.title ? `top-archive=${hybrid.archiveCandidates[0].title}` : null,
  ]);

  return {
    id: `context:${params.query.id}`,
    queryId: params.query.id,
    thinkingLane: params.query.thinkingLane,
    summary,
    strategyCandidates: hybrid.strategyCandidates,
    memoryCandidates: hybrid.memoryCandidates,
    sessionCandidates: hybrid.sessionCandidates,
    archiveCandidates: hybrid.archiveCandidates,
    synthesis,
    metadata: {
      stages: {
        structuredMatch: {
          strategyCount: structured.strategies.length,
          memoryCount: structured.memories.length,
          sessionCount: structured.sessions.length,
          archiveCount: structured.archive.length,
        },
        hybridCandidateGeneration: {
          strategyCount: hybrid.strategyCandidates.length,
          memoryCount: hybrid.memoryCandidates.length,
          sessionCount: hybrid.sessionCandidates.length,
          archiveCount: hybrid.archiveCandidates.length,
        },
        contextPackSynthesis: {
          summary,
          synthesis,
        },
      },
    },
  };
}
