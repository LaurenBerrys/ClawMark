import { describe, expect, it } from "vitest";

import type {
  IntelCandidate,
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
    sourceTaskIds: ["task-coder"],
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
    sourceIntelIds: [],
    derivedFromMemoryIds: [],
    createdAt: 1,
    updatedAt: 1,
  },
];

const intel: IntelCandidate[] = [
  {
    id: "intel-runtime",
    domain: "github",
    sourceId: "repo:openclaw/openclaw",
    title: "runtime refactor notes",
    summary: "shared/runtime 可复用为统一 decision/retrieval core。",
    score: 91,
    selected: true,
    createdAt: 1,
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

function buildQuery(thinkingLane: RetrievalQuery["thinkingLane"]): RetrievalQuery {
  return {
    id: `query:${thinkingLane}`,
    taskId: "task-coder",
    prompt: "把 shared runtime 收口到源码 core",
    thinkingLane,
    planes:
      thinkingLane === "system1"
        ? ["strategy", "memory"]
        : ["strategy", "memory", "intel", "archive"],
    route: "coder",
    worker: "main",
    topicHints: ["coder", "runtime", "build", "github"],
    maxCandidatesPerPlane: 4,
  };
}

function buildSources(): RetrievalSourceSet {
  return {
    strategies,
    memories,
    intel,
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

    expect(contextPack.summary).toBe("strategy=1 | memory=1 | intel=0 | archive=0");
    expect(contextPack.strategyCandidates[0]?.recordId).toBe("strategy-coder");
    expect(contextPack.memoryCandidates[0]?.recordId).toBe("memory-execution");
    expect(contextPack.synthesis).toContain("route=coder");
    expect(contextPack.synthesis).toContain(
      "top-strategy=先读仓库与文件差异，再做最小修改和验证。",
    );
    expect(contextPack.synthesis).toContain("top-memory=改代码前先用 rg 和文件树缩小修改范围。");
  });

  it("expands system2 into intel and archive planes", () => {
    const contextPack = buildContextPack({
      query: buildQuery("system2"),
      sources: buildSources(),
    });

    expect(contextPack.summary).toBe("strategy=1 | memory=1 | intel=1 | archive=1");
    expect(contextPack.intelCandidates[0]?.recordId).toBe("intel-runtime");
    expect(contextPack.archiveCandidates[0]?.title).toBe("workspace migration note");
    expect(contextPack.synthesis).toContain("top-intel=runtime refactor notes");
    expect(contextPack.synthesis).toContain("top-archive=workspace migration note");
  });
});
