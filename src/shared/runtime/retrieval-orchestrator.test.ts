import { describe, expect, it } from "vitest";
import type {
  MemoryRecord,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalSourceSet,
  StrategyRecord,
} from "./contracts.js";
import { buildContextPack, buildRouteDomains } from "./retrieval-orchestrator.js";

const strategies: StrategyRecord[] = [
  {
    id: "strategy-coder",
    layer: "strategies",
    route: "coder",
    worker: "main",
    skillIds: ["repo.read", "patch.apply"],
    summary: "先读仓库与文件差异，再做最小修改和验证。",
    fallback: "若命中未知场景则升级到 system2。",
    thinkingLane: "system1",
    confidence: 86,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    createdAt: 1,
    updatedAt: 1,
  },
];

const memories: MemoryRecord[] = [
  {
    id: "memory-execution",
    layer: "memories",
    memoryType: "execution",
    route: "coder",
    summary: "改代码前先用 rg 和文件树缩小修改范围。",
    detail: "优先查看差异点和已有测试，再决定 patch 范围。",
    scope: "tech",
    tags: ["rg", "repo", "tests"],
    confidence: 84,
    version: 1,
    invalidatedBy: [],
    sourceEventIds: [],
    sourceTaskIds: [],
    sourceReviewIds: [],
    sourceSessionIds: [],
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    createdAt: 1,
    updatedAt: 1,
  },
];

const sessions: RetrievalCandidate[] = [
  {
    id: "session-runtime",
    plane: "session",
    recordId: "session-runtime",
    title: "runtime refactor notes",
    excerpt: "shared/runtime 可复用为统一 decision/retrieval core。",
    score: 91,
    sourceRef: "session:web:user-console",
  },
];

const archive: RetrievalCandidate[] = [
  {
    id: "archive-workspace",
    plane: "archive",
    title: "workspace migration note",
    excerpt: "instance-root workspace path migration for coder route",
    score: 74,
    sourceRef: "archive:workspace-migration",
  },
];

function buildQuery(
  thinkingLane: RetrievalQuery["thinkingLane"],
  overrides: Partial<RetrievalQuery> = {},
): RetrievalQuery {
  return {
    id: `query:${thinkingLane}`,
    taskId: "task-coder",
    prompt: "把 shared runtime 收口到源码 core",
    thinkingLane,
    planes:
      thinkingLane === "system1"
        ? ["strategy", "memory", "session"]
        : ["strategy", "memory", "session", "archive"],
    route: "coder",
    worker: "main",
    topicHints: ["coder", "runtime", "build", "github"],
    maxCandidatesPerPlane: 4,
    ...overrides,
  };
}

function buildSources(): RetrievalSourceSet {
  return {
    strategies,
    memories,
    sessions,
    archive,
  };
}

describe("buildRouteDomains", () => {
  it("maps coder to engineering-heavy intel domains", () => {
    expect(buildRouteDomains("coder")).toEqual(["tech", "ai", "github"]);
  });
});

describe("buildContextPack", () => {
  it("keeps system1 focused on strategy and memory planes", () => {
    const contextPack = buildContextPack({
      query: buildQuery("system1"),
      sources: buildSources(),
    });

    expect(contextPack.summary).toBe("strategy=1 | memory=1 | session=1 | archive=0");
    expect(contextPack.strategyCandidates[0]?.recordId).toBe("strategy-coder");
    expect(contextPack.memoryCandidates[0]?.recordId).toBe("memory-execution");
    expect(contextPack.sessionCandidates[0]?.recordId).toBe("session-runtime");
    expect(contextPack.synthesis).toContain("route=coder");
    expect(contextPack.synthesis).toContain(
      "top-strategy=先读仓库与文件差异，再做最小修改和验证。",
    );
    expect(contextPack.synthesis).toContain("top-memory=改代码前先用 rg 和文件树缩小修改范围。");
  });

  it("expands system2 into session and archive planes", () => {
    const contextPack = buildContextPack({
      query: buildQuery("system2"),
      sources: buildSources(),
    });

    expect(contextPack.summary).toBe("strategy=1 | memory=1 | session=1 | archive=1");
    expect(contextPack.sessionCandidates[0]?.recordId).toBe("session-runtime");
    expect(contextPack.archiveCandidates[0]?.title).toBe("workspace migration note");
    expect(contextPack.synthesis).toContain("top-session=runtime refactor notes");
    expect(contextPack.synthesis).toContain("top-archive=workspace migration note");
  });

  it("prioritizes actionable runtime session signals over passive notes", () => {
    const contextPack = buildContextPack({
      query: buildQuery("system1"),
      sources: {
        strategies,
        memories,
        sessions: [
          {
            id: "session-note-generic",
            plane: "session",
            recordId: "session-note-generic",
            title: "approval note for workspace migration",
            excerpt: "Need approval to continue the runtime workspace migration for coder work.",
            score: 0.98,
            confidence: 0.95,
            sourceRef: "runtime-session-note",
          },
          {
            id: "session-task-report",
            plane: "session",
            recordId: "report-task-coder",
            title: "Task waiting for user confirmation",
            excerpt: "Need approval to continue the runtime workspace migration for coder work.",
            score: 0.9,
            confidence: 96,
            sourceRef: "runtime-task-report",
            metadata: {
              sessionSignalKind: "task-report",
              taskId: "task-coder",
              route: "coder",
              requiresUserAction: true,
              reportKind: "waiting_user",
              reportState: "pending",
            },
          },
          {
            id: "session-coordinator",
            plane: "session",
            recordId: "coord-coder",
            title: "Coordinator suggestion: keep the task blocked until approval",
            excerpt: "Shared routing says to wait for operator approval before resuming coder work.",
            score: 0.82,
            confidence: 84,
            sourceRef: "runtime-coordinator-suggestion",
            metadata: {
              sessionSignalKind: "coordinator-suggestion",
              taskId: "task-coder",
              route: "coder",
            },
          },
          {
            id: "session-coordinator-blocked",
            plane: "session",
            recordId: "coord-coder-blocked",
            title: "Coordinator suggestion: open a surface task",
            excerpt: "The sales surface asked to queue a local follow-up, but local task creation is disabled.",
            score: 0.88,
            confidence: 84,
            sourceRef: "runtime-coordinator-suggestion",
            metadata: {
              sessionSignalKind: "coordinator-suggestion",
              route: "coder",
              surfaceId: "surface-sales",
              taskCreationPolicy: "disabled",
              escalationTarget: "surface-owner",
              materializationBlocked: true,
            },
          },
          {
            id: "session-user-model-mirror",
            plane: "session",
            recordId: "runtime-user-model-mirror",
            title: "Pending USER.md import",
            excerpt: "Manual USER.md edits are waiting to be imported into the authoritative Runtime user model.",
            score: 0.93,
            confidence: 92,
            sourceRef: "runtime-user-model-mirror",
            metadata: {
              sessionSignalKind: "user-model-mirror",
              requiresUserAction: true,
              mirrorPath: "/tmp/instance/config/USER.md",
            },
          },
        ],
        archive,
      },
    });

    expect(contextPack.sessionCandidates[0]?.recordId).toBe("report-task-coder");
    expect(contextPack.sessionCandidates[1]?.recordId).toBe("coord-coder");
    expect(contextPack.sessionCandidates[2]?.recordId).toBe("runtime-user-model-mirror");
    expect(contextPack.sessionCandidates[3]?.recordId).toBe("coord-coder-blocked");
    expect(contextPack.sessionCandidates).toHaveLength(4);
  });

  it("prioritizes session and ecology-bound signals for the active task binding", () => {
    const contextPack = buildContextPack({
      query: buildQuery("system1", {
        metadata: {
          sessionId: "session-sales",
          agentId: "agent-sales",
          surfaceId: "surface-sales",
        },
      }),
      sources: {
        strategies,
        memories,
        sessions: [
          {
            id: "session-pref-other",
            plane: "session",
            recordId: "session-other",
            title: "Other session preference",
            excerpt: "reply_and_proactive for another coder session",
            score: 0.97,
            confidence: 95,
            sourceRef: "runtime-session-working-preference",
            metadata: {
              sessionSignalKind: "session-working-preference",
              sessionId: "session-other",
              route: "coder",
              reportPolicy: "reply_and_proactive",
            },
          },
          {
            id: "session-pref-sales",
            plane: "session",
            recordId: "session-sales",
            title: "Sales session preference",
            excerpt: "Use detailed updates and keep strict confirmation for the active sales session.",
            score: 0.72,
            confidence: 90,
            sourceRef: "runtime-session-working-preference",
            metadata: {
              sessionSignalKind: "session-working-preference",
              sessionId: "session-sales",
              route: "coder",
              reportVerbosity: "detailed",
              interruptionThreshold: "low",
              confirmationBoundary: "strict",
            },
          },
          {
            id: "session-role-sales",
            plane: "session",
            recordId: "role-sales",
            title: "Role recommended: Sales surface",
            excerpt: "The active sales surface should stay on the operator-reviewed route.",
            score: 0.74,
            confidence: 82,
            sourceRef: "runtime-role-optimization",
            metadata: {
              sessionSignalKind: "role-optimization",
              candidateState: "recommended",
              route: "coder",
              surfaceId: "surface-sales",
              agentId: "agent-sales",
            },
          },
          {
            id: "session-note-generic",
            plane: "session",
            recordId: "note-generic",
            title: "Generic runtime note",
            excerpt: "Shared runtime notes for coder work.",
            score: 0.98,
            confidence: 96,
            sourceRef: "runtime-session-note",
          },
        ],
        archive,
      },
    });

    expect(contextPack.sessionCandidates[0]?.recordId).toBe("role-sales");
    expect(contextPack.sessionCandidates[1]?.recordId).toBe("session-sales");
    expect(contextPack.sessionCandidates[2]?.recordId).toBe("session-other");
  });
});
