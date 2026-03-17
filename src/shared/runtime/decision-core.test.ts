import { describe, expect, it } from "vitest";
import type {
  DecisionConfig,
  DecisionTaskInput,
  MemoryRecord,
  RetrievalCandidate,
  RetrievalSourceSet,
  StrategyRecord,
} from "./contracts.js";
import {
  buildDecisionPromptBlock,
  buildDecisionRecord,
  buildDecisionRetrievalQuery,
  shouldUseSystem2,
} from "./decision-core.js";
import { buildContextPack } from "./retrieval-orchestrator.js";

function buildSources(): RetrievalSourceSet {
  const strategies: StrategyRecord[] = [
    {
      id: "strategy-coder",
      layer: "strategies",
      route: "coder",
      worker: "main",
      skillIds: ["repo.read", "patch.apply"],
      summary: "先读仓库与文件差异，再做最小修改和验证。",
      fallback: "若失败则升级到 system2 并补充上下文。",
      thinkingLane: "system1",
      confidence: 86,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: ["task-coder"],
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
      sourceTaskIds: ["task-coder"],
      sourceReviewIds: [],
      sourceSessionIds: [],
      sourceIntelIds: [],
      derivedFromMemoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "memory-efficiency",
      layer: "memories",
      memoryType: "efficiency",
      route: "coder",
      summary: "定向测试优先于全量构建。",
      detail: "先跑命中的模块测试，再做全量 build。",
      scope: "tech",
      tags: ["tests", "build"],
      confidence: 78,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: ["task-coder"],
      sourceReviewIds: [],
      sourceSessionIds: [],
      sourceIntelIds: [],
      derivedFromMemoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "memory-resource",
      layer: "memories",
      memoryType: "resource",
      route: "coder",
      summary: "优先沿用 reviewer worker 和 patch-edit 技能组合。",
      detail: "已验证可复用资源：worker=reviewer | skills=patch-edit/test-verify。",
      scope: "tech",
      tags: ["worker", "skills"],
      confidence: 74,
      version: 1,
      invalidatedBy: [],
      sourceEventIds: [],
      sourceTaskIds: ["task-coder"],
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
      title: "recent runtime control session",
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

  return { strategies, memories, sessions, archive };
}

const baseTask: DecisionTaskInput = {
  id: "task-coder",
  title: "把 shared runtime 收口到源码 core",
  goal: "抽出统一 retrieval 和 decision 模块，并恢复源码仓可构建。",
  route: "coder",
  agentId: "agent-runtime",
  sessionId: "session-runtime",
  surfaceId: "surface-runtime",
  priority: "normal",
  budgetMode: "balanced",
  retrievalMode: "deep",
  worker: "main",
  skillIds: ["repo.read"],
  tags: ["runtime", "refactor", "build"],
  runState: {
    consecutiveFailures: 0,
    remoteCallCount: 0,
  },
};

const config: DecisionConfig = {
  maxInputTokensPerTurn: 16000,
  maxRemoteCallsPerTask: 3,
  maxCandidatesPerPlane: 4,
  maxContextChars: 4000,
};

describe("buildDecisionRetrievalQuery", () => {
  it("keeps system1 on strategy and memory only", () => {
    const query = buildDecisionRetrievalQuery(baseTask, "system1", config);
    expect(query.planes).toEqual(["strategy", "memory", "session"]);
    expect(query.route).toBe("coder");
    expect(query.topicHints).toContain("coder");
    expect(query.metadata).toMatchObject({
      agentId: "agent-runtime",
      sessionId: "session-runtime",
      surfaceId: "surface-runtime",
    });
  });

  it("expands system2 to session and archive in deep mode", () => {
    const query = buildDecisionRetrievalQuery(baseTask, "system2", config);
    expect(query.planes).toEqual(["strategy", "memory", "session", "archive"]);
  });
});

describe("shouldUseSystem2", () => {
  it("stays on system1 with a strong strategy and enough execution memory", () => {
    const sources = buildSources();
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(baseTask, "system1", config),
      sources,
    });
    expect(shouldUseSystem2({ task: baseTask, contextPack })).toBe(false);
  });

  it("escalates when the task has consecutive failures", () => {
    const sources = buildSources();
    const task: DecisionTaskInput = {
      ...baseTask,
      runState: {
        consecutiveFailures: 2,
        remoteCallCount: 1,
      },
    };
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(task, "system1", config),
      sources,
    });
    expect(shouldUseSystem2({ task, contextPack })).toBe(true);
  });

  it("stays on system1 when the task is clearly waiting for user action", () => {
    const task: DecisionTaskInput = {
      ...baseTask,
      title: "Wait for operator approval before sending the change",
      route: "office",
      skillIds: [],
      runState: {
        consecutiveFailures: 1,
        remoteCallCount: 1,
      },
    };
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(task, "system1", config),
      sources: {
        strategies: [],
        memories: [],
        sessions: [
          {
            id: "session-task-report",
            plane: "session",
            recordId: "report-office-approval",
            title: "Task waiting for user confirmation",
            excerpt: "Approval is required before the runtime sends the operator update.",
            score: 0.92,
            confidence: 96,
            sourceRef: "runtime-task-report",
            metadata: {
              sessionSignalKind: "task-report",
              taskId: "task-coder",
              route: "office",
              requiresUserAction: true,
              reportKind: "waiting_user",
              reportState: "pending",
            },
          },
        ],
      },
    });

    expect(shouldUseSystem2({ task, contextPack })).toBe(false);
  });

  it("stays on system1 when low-interruption preferences already explain a waiting-external hold", () => {
    const task: DecisionTaskInput = {
      ...baseTask,
      priority: "low",
      runState: {
        consecutiveFailures: 1,
        remoteCallCount: 1,
      },
    };
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(task, "system1", config),
      sources: {
        strategies: [],
        memories: [],
        sessions: [
          {
            id: "session-user-model",
            plane: "session",
            recordId: "runtime-user",
            title: "User control context",
            excerpt: "reply · balanced",
            score: 0.88,
            confidence: 92,
            sourceRef: "runtime-user-model",
            metadata: {
              sessionSignalKind: "user-model",
              reportPolicy: "reply",
              interruptionThreshold: "medium",
              confirmationBoundary: "balanced",
            },
          },
          {
            id: "session-working-pref",
            plane: "session",
            recordId: "session-runtime",
            title: "Runtime session",
            excerpt: "low interruption · strict confirmation",
            score: 0.72,
            confidence: 91,
            sourceRef: "runtime-session-working-preference",
            metadata: {
              sessionSignalKind: "session-working-preference",
              sessionId: "session-runtime",
              interruptionThreshold: "low",
              confirmationBoundary: "strict",
            },
          },
          {
            id: "session-waiting-external",
            plane: "session",
            recordId: "report-runtime-waiting-external",
            title: "Task waiting on an external runtime dependency",
            excerpt:
              "The active runtime task is waiting for an external dependency before it can continue.",
            score: 0.88,
            confidence: 90,
            sourceRef: "runtime-task-report",
            metadata: {
              sessionSignalKind: "task-report",
              taskId: "task-coder",
              route: "coder",
              reportKind: "waiting_external",
              reportState: "pending",
            },
          },
        ],
      },
    });

    expect(shouldUseSystem2({ task, contextPack })).toBe(false);
  });

  it("does not treat task-creation-blocked coordinator suggestions as a fast-path planning signal", () => {
    const task: DecisionTaskInput = {
      ...baseTask,
      title: "Review blocked surface coordination suggestion",
      route: "sales",
      skillIds: [],
      runState: {
        consecutiveFailures: 0,
        remoteCallCount: 0,
      },
    };
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(task, "system1", config),
      sources: {
        strategies: [],
        memories: [],
        sessions: [
          {
            id: "session-coordinator-blocked",
            plane: "session",
            recordId: "coord-sales-blocked",
            title: "Coordinator suggestion: open a sales follow-up task",
            excerpt: "The bound sales surface has local task creation disabled, so the suggestion stays in review mode.",
            score: 0.82,
            confidence: 84,
            sourceRef: "runtime-coordinator-suggestion",
            metadata: {
              sessionSignalKind: "coordinator-suggestion",
              route: "sales",
              surfaceId: "surface-sales",
              taskCreationPolicy: "disabled",
            },
          },
        ],
      },
    });

    expect(shouldUseSystem2({ task, contextPack })).toBe(true);
  });
});

describe("buildDecisionRecord", () => {
  it("builds a system1 decision from sources when the path is stable", () => {
    const decision = buildDecisionRecord({
      task: baseTask,
      config,
      sources: buildSources(),
      now: 123,
    });

    expect(decision.builtAt).toBe(123);
    expect(decision.thinkingLane).toBe("system1");
    expect(decision.recommendedWorker).toBe("main");
    expect(decision.relevantMemoryIds).toHaveLength(3);
    expect(decision.relevantMemoryIds).toEqual(
      expect.arrayContaining(["memory-execution", "memory-efficiency", "memory-resource"]),
    );
    expect(decision.relevantSessionIds).toEqual(["session-runtime"]);
    expect(decision.contextPack.summary).toBe("strategy=1 | memory=3 | session=1 | archive=0");
  });

  it("rebuilds context for system2 when the task needs escalation", () => {
    const decision = buildDecisionRecord({
      task: {
        ...baseTask,
        priority: "high",
        runState: {
          consecutiveFailures: 1,
          remoteCallCount: 1,
        },
      },
      config,
      sources: buildSources(),
      now: 456,
    });

    expect(decision.builtAt).toBe(456);
    expect(decision.thinkingLane).toBe("system2");
    expect(decision.relevantSessionIds).toEqual(["session-runtime"]);
    expect(decision.contextPack.summary).toBe("strategy=1 | memory=3 | session=1 | archive=1");
  });

  it("surfaces effective user preferences and ecology bindings in the decision output", () => {
    const decision = buildDecisionRecord({
      task: baseTask,
      config,
      sources: {
        ...buildSources(),
        sessions: [
          {
            id: "session-user-model",
            plane: "session",
            recordId: "runtime-user",
            title: "User control context",
            excerpt: "reply · balanced",
            score: 0.88,
            confidence: 92,
            sourceRef: "runtime-user-model",
            metadata: {
              sessionSignalKind: "user-model",
              reportPolicy: "reply",
              reportVerbosity: "balanced",
              interruptionThreshold: "medium",
              confirmationBoundary: "balanced",
            },
          },
          {
            id: "session-working-pref",
            plane: "session",
            recordId: "session-runtime",
            title: "Runtime session",
            excerpt: "detailed updates for the active session",
            score: 0.75,
            confidence: 95,
            sourceRef: "runtime-session-working-preference",
            metadata: {
              sessionSignalKind: "session-working-preference",
              sessionId: "session-runtime",
              reportPolicy: "reply_and_proactive",
              reportVerbosity: "detailed",
              interruptionThreshold: "low",
              confirmationBoundary: "strict",
            },
          },
        ],
      },
      now: 777,
    });

    expect(decision.metadata).toMatchObject({
      ecologyBinding: {
        agentId: "agent-runtime",
        sessionId: "session-runtime",
        surfaceId: "surface-runtime",
      },
      userPreferenceView: {
        reportPolicy: "reply_and_proactive",
        reportVerbosity: "detailed",
        interruptionThreshold: "low",
        confirmationBoundary: "strict",
      },
    });
    expect(decision.summary).toContain("prefs=reply_and_proactive/detailed/low/strict");
    expect(buildDecisionPromptBlock(decision)).toContain(
      "用户偏好：report=reply_and_proactive · verbosity=detailed · interrupt=low · confirm=strict",
    );
  });

  it("supports compatibility mode with a prebuilt context pack", () => {
    const sources = buildSources();
    const contextPack = buildContextPack({
      query: buildDecisionRetrievalQuery(baseTask, "system1", config),
      sources,
    });
    const decision = buildDecisionRecord(baseTask, config, contextPack, sources.strategies[0], 789);

    expect(decision.builtAt).toBe(789);
    expect(decision.thinkingLane).toBe("system1");
    expect(decision.summary).toContain("lane=system1");
  });
});

describe("buildDecisionPromptBlock", () => {
  it("renders a readable decision block", () => {
    const decision = buildDecisionRecord({
      task: baseTask,
      config,
      sources: buildSources(),
      now: 999,
    });
    const promptBlock = buildDecisionPromptBlock(decision);

    expect(promptBlock).toContain("决策内核输出：");
    expect(promptBlock).toContain("推荐执行者：main");
    expect(promptBlock).toContain("生态绑定：agent=agent-runtime · surface=surface-runtime · session=session-runtime");
    expect(promptBlock).toContain("上下文摘要：strategy=1 | memory=3 | session=1 | archive=0");
    expect(promptBlock).toContain("当前信号");
    expect(promptBlock).toContain("[session] recent runtime control session");
    expect(promptBlock).toContain("route=coder");
  });
});
