import type {
  ContextPack,
  DecisionConfig,
  DecisionRecord,
  DecisionTaskInput,
  FormalMemoryType,
  RetrievalCandidate,
  RetrievalPlane,
  RetrievalQuery,
  RetrievalSourceSet,
  StrategyRecord,
  ThinkingLane,
} from "./contracts.js";
import { buildContextPack, buildRouteDomains } from "./retrieval-orchestrator.js";
import type { RuntimeCapabilityPolicy } from "./capability-plane.js";

type StrategyInsight = {
  id?: string;
  summary: string;
  confidence: number;
  worker?: string;
  skillIds: string[];
  thinkingLane?: ThinkingLane;
  fallback?: string;
};

type DecisionPreferenceSource = "user-model" | "session-working-preference";

type DecisionUserPreferenceField =
  | "communicationStyle"
  | "reportPolicy"
  | "reportVerbosity"
  | "interruptionThreshold"
  | "confirmationBoundary";

type DecisionUserPreferenceView = {
  communicationStyle?: string;
  reportPolicy?: string;
  reportVerbosity?: string;
  interruptionThreshold?: string;
  confirmationBoundary?: string;
  sources: Partial<Record<DecisionUserPreferenceField, DecisionPreferenceSource>>;
  pendingUserModelImport: boolean;
};

type DecisionSurfacePolicyView = {
  role: string;
  allowedTopics: string[];
  restrictedTopics: string[];
  reportTarget?: string;
};

type DecisionRecordParams = {
  task: DecisionTaskInput;
  config: DecisionConfig;
  policy?: RuntimeCapabilityPolicy;
  sources?: RetrievalSourceSet;
  contextPack?: ContextPack;
  topStrategy?: StrategyRecord | null;
  now?: number;
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

function normalizeText(value: string | undefined | null): string {
  return value?.trim() || "";
}

function truncateText(value: string | undefined | null, maxLength = 160): string {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function resolveTaskRoute(task: DecisionTaskInput): string {
  return normalizeText(task.route || task.taskKind || "general") || "general";
}

function buildRouteSkillHints(route: string): string[] {
  switch (route) {
    case "coder":
      return ["workspace-read", "patch-edit", "test-verify"];
    case "ops":
      return ["logs-inspect", "process-inspect", "config-audit"];
    case "research":
      return ["context-retrieve", "news-digest"];
    case "office":
      return ["message-compose", "workflow-update"];
    case "media":
      return ["ocr-extract", "media-segment"];
    default:
      return ["stable-local-tools"];
  }
}

function tokenizeTopicHints(text: string): string[] {
  const matches = text.match(/[\p{L}\p{N}_-]{3,}/gu) || [];
  return uniqueStrings(matches.map((token) => token.toLowerCase())).slice(0, 8);
}

function buildDecisionTopicHints(task: DecisionTaskInput): string[] {
  const compositeText = [
    task.title,
    task.goal,
    task.blockedReason,
    task.lastError,
    ...(task.tags || []),
  ]
    .filter(Boolean)
    .join(" ");

  return uniqueStrings([
    resolveTaskRoute(task),
    task.agentId,
    task.surfaceId,
    task.sessionId,
    task.taskKind,
    ...task.tags,
    ...buildRouteDomains(resolveTaskRoute(task)),
    ...tokenizeTopicHints(compositeText),
  ]);
}

function buildPrompt(task: DecisionTaskInput): string {
  return [
    task.title,
    task.goal,
    task.blockedReason ? `blocked: ${task.blockedReason}` : null,
    task.lastError ? `error: ${task.lastError}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function clampMaxCandidates(
  task: DecisionTaskInput,
  lane: ThinkingLane,
  config: DecisionConfig,
): number {
  if (config.maxCandidatesPerPlane && Number.isFinite(config.maxCandidatesPerPlane)) {
    return Math.max(1, Math.trunc(config.maxCandidatesPerPlane));
  }

  if (lane === "system2" && task.retrievalMode === "deep") {
    return 6;
  }
  if (lane === "system2") {
    return 4;
  }
  return 3;
}

function buildPlanes(task: DecisionTaskInput, lane: ThinkingLane): RetrievalPlane[] {
  const base: RetrievalPlane[] = ["strategy", "memory", "session"];
  if (lane !== "system2") {
    return base;
  }
  if (task.retrievalMode === "off") {
    return base;
  }
  return [...base, "archive"];
}

function defaultWorkerForRoute(_route: string): string {
  return "main";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function readMetadataString(candidate: RetrievalCandidate, key: string): string | undefined {
  const metadata = isObject(candidate.metadata) ? candidate.metadata : {};
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readMetadataBoolean(candidate: RetrievalCandidate, key: string): boolean {
  const metadata = isObject(candidate.metadata) ? candidate.metadata : {};
  return metadata[key] === true;
}

function readMetadataStringArray(candidate: RetrievalCandidate, key: string): string[] {
  const metadata = isObject(candidate.metadata) ? candidate.metadata : {};
  return readStringArray(metadata[key]);
}

function readSessionSignalKind(candidate: RetrievalCandidate): string | undefined {
  return readMetadataString(candidate, "sessionSignalKind");
}

function isPendingWaitingUserSignal(candidate: RetrievalCandidate): boolean {
  return (
    readSessionSignalKind(candidate) === "task-report" &&
    readMetadataString(candidate, "reportKind") === "waiting_user" &&
    readMetadataString(candidate, "reportState") === "pending" &&
    readMetadataBoolean(candidate, "requiresUserAction")
  );
}

function isPendingBlockedSignal(candidate: RetrievalCandidate): boolean {
  return (
    readSessionSignalKind(candidate) === "task-report" &&
    readMetadataString(candidate, "reportKind") === "blocked" &&
    readMetadataString(candidate, "reportState") === "pending"
  );
}

function isPendingWaitingExternalSignal(candidate: RetrievalCandidate): boolean {
  return (
    readSessionSignalKind(candidate) === "task-report" &&
    readMetadataString(candidate, "reportKind") === "waiting_external" &&
    readMetadataString(candidate, "reportState") === "pending"
  );
}

function isCoordinatorSuggestionSignal(candidate: RetrievalCandidate): boolean {
  if (readSessionSignalKind(candidate) !== "coordinator-suggestion") {
    return false;
  }
  return !(
    readMetadataString(candidate, "taskCreationPolicy") === "disabled" &&
    !readMetadataString(candidate, "localTaskId")
  );
}

function isStrategyRecord(value: StrategyRecord | RetrievalCandidate): value is StrategyRecord {
  return "layer" in value && value.layer === "strategies";
}

function toStrategyInsight(
  value: StrategyRecord | RetrievalCandidate | null | undefined,
): StrategyInsight | null {
  if (!value) {
    return null;
  }

  if (isStrategyRecord(value)) {
    return {
      id: value.id,
      summary: value.summary,
      confidence: value.confidence,
      worker: value.worker,
      skillIds: value.skillIds,
      thinkingLane: value.thinkingLane,
      fallback: value.fallback,
    };
  }

  const metadata = isObject(value.metadata) ? value.metadata : {};
  const thinkingLane = metadata.thinkingLane === "system2" ? "system2" : "system1";

  return {
    id: value.recordId,
    summary: value.title,
    confidence: value.confidence ?? 0,
    worker: typeof metadata.worker === "string" ? metadata.worker : undefined,
    skillIds: readStringArray(metadata.skillIds),
    thinkingLane,
    fallback: typeof metadata.fallback === "string" ? metadata.fallback : undefined,
  };
}

function pickTopStrategy(
  contextPack: ContextPack | undefined,
  topStrategy?: StrategyRecord | RetrievalCandidate | null,
): StrategyInsight | null {
  return toStrategyInsight(topStrategy) || toStrategyInsight(contextPack?.strategyCandidates[0]);
}

function readMemoryType(candidate: RetrievalCandidate): FormalMemoryType | undefined {
  const metadata = isObject(candidate.metadata) ? candidate.metadata : {};
  const value = metadata.memoryType;
  return typeof value === "string" ? (value as FormalMemoryType) : undefined;
}

function deriveDecisionUserPreferenceView(
  task: DecisionTaskInput,
  sessions: RetrievalCandidate[],
): DecisionUserPreferenceView | null {
  const view: DecisionUserPreferenceView = {
    sources: {},
    pendingUserModelImport: sessions.some(
      (candidate) =>
        readSessionSignalKind(candidate) === "user-model-mirror" &&
        readMetadataBoolean(candidate, "requiresUserAction"),
    ),
  };

  const applyCandidate = (candidate: RetrievalCandidate | undefined, source: DecisionPreferenceSource) => {
    if (!candidate) {
      return;
    }
    const communicationStyle = readMetadataString(candidate, "communicationStyle");
    const reportPolicy = readMetadataString(candidate, "reportPolicy");
    const reportVerbosity = readMetadataString(candidate, "reportVerbosity");
    const interruptionThreshold = readMetadataString(candidate, "interruptionThreshold");
    const confirmationBoundary = readMetadataString(candidate, "confirmationBoundary");
    if (communicationStyle) {
      view.communicationStyle = communicationStyle;
      view.sources.communicationStyle = source;
    }
    if (reportPolicy) {
      view.reportPolicy = reportPolicy;
      view.sources.reportPolicy = source;
    }
    if (reportVerbosity) {
      view.reportVerbosity = reportVerbosity;
      view.sources.reportVerbosity = source;
    }
    if (interruptionThreshold) {
      view.interruptionThreshold = interruptionThreshold;
      view.sources.interruptionThreshold = source;
    }
    if (confirmationBoundary) {
      view.confirmationBoundary = confirmationBoundary;
      view.sources.confirmationBoundary = source;
    }
  };

  applyCandidate(
    sessions.find((candidate) => readSessionSignalKind(candidate) === "user-model"),
    "user-model",
  );
  if (task.sessionId) {
    applyCandidate(
      sessions.find(
        (candidate) =>
          readSessionSignalKind(candidate) === "session-working-preference" &&
          readMetadataString(candidate, "sessionId") === task.sessionId,
      ),
      "session-working-preference",
    );
  }

  if (
    !view.pendingUserModelImport &&
    !view.communicationStyle &&
    !view.reportPolicy &&
    !view.reportVerbosity &&
    !view.interruptionThreshold &&
    !view.confirmationBoundary
  ) {
    return null;
  }
  return view;
}

function deriveSurfacePolicyView(
  task: DecisionTaskInput,
  sessions: RetrievalCandidate[],
): DecisionSurfacePolicyView | null {
  const candidate = sessions.find(
    (c) =>
      readSessionSignalKind(c) === "surface-role-overlay" &&
      readMetadataString(c, "surfaceId") === task.surfaceId,
  );
  if (!candidate) {return null;}

  return {
    role: readMetadataString(candidate, "role") || "general",
    allowedTopics: readMetadataStringArray(candidate, "allowedTopics"),
    restrictedTopics: readMetadataStringArray(candidate, "restrictedTopics"),
    reportTarget: readMetadataString(candidate, "reportTarget"),
  };
}

function isHighConfidenceExecutionMemory(candidate: RetrievalCandidate): boolean {
  const memoryType = readMemoryType(candidate);
  if (!memoryType) {
    return false;
  }
  return (
    (memoryType === "execution" ||
      memoryType === "efficiency" ||
      memoryType === "completion" ||
      memoryType === "resource") &&
    (candidate.confidence ?? 0) >= 68
  );
}

function computeBudgetLimit(
  task: DecisionTaskInput,
  config: DecisionConfig,
  thinkingLane: ThinkingLane,
): DecisionRecord["budgetLimit"] {
  const remoteCallCount = task.runState?.remoteCallCount || 0;
  const budgetFactor =
    task.budgetMode === "strict"
      ? thinkingLane === "system1"
        ? 0.55
        : 0.7
      : task.budgetMode === "deep"
        ? thinkingLane === "system2"
          ? 1
          : 0.85
        : thinkingLane === "system1"
          ? 0.72
          : 0.9;

  return {
    maxInputTokens: Math.max(512, Math.floor(config.maxInputTokensPerTurn * budgetFactor)),
    maxRemoteCallsRemaining: Math.max(0, config.maxRemoteCallsPerTask - remoteCallCount),
  };
}

function collectRecordIds(candidates: RetrievalCandidate[]): string[] {
  return uniqueStrings(candidates.map((candidate) => candidate.recordId).filter(Boolean));
}

function toContextBullet(prefix: string, candidates: RetrievalCandidate[], maxItems = 3): string[] {
  return candidates.slice(0, maxItems).map((candidate) => {
    const idTag = candidate.recordId ? `ID: ${candidate.recordId} | ` : "";
    const bullet = `- [${prefix}] ${idTag}${truncateText(candidate.title, 120)}`;
    if (candidate.excerpt && candidate.excerpt.trim().length > 0) {
      return `${bullet}\n  详情：${truncateText(candidate.excerpt.trim(), 1000)}`;
    }
    return bullet;
  });
}

type ShouldUseSystem2Input = {
  task: DecisionTaskInput;
  topStrategy?: StrategyRecord | RetrievalCandidate | null;
  contextPack?: ContextPack;
  relevantMemories?: RetrievalCandidate[];
  relevantSessions?: RetrievalCandidate[];
};

function normalizeShouldUseSystem2Args(
  inputOrTask: ShouldUseSystem2Input | DecisionTaskInput,
  topStrategy?: StrategyRecord | RetrievalCandidate | null,
  relevantMemoriesOrContext?: RetrievalCandidate[] | ContextPack,
  relevantSessions: RetrievalCandidate[] = [],
): {
  task: DecisionTaskInput;
  topStrategy: StrategyInsight | null;
  relevantMemories: RetrievalCandidate[];
  relevantSessions: RetrievalCandidate[];
} {
  if (isObject(inputOrTask) && "task" in inputOrTask) {
    const contextPack = inputOrTask.contextPack;
    return {
      task: inputOrTask.task,
      topStrategy: pickTopStrategy(contextPack, inputOrTask.topStrategy),
      relevantMemories: inputOrTask.relevantMemories || contextPack?.memoryCandidates || [],
      relevantSessions: inputOrTask.relevantSessions || contextPack?.sessionCandidates || [],
    };
  }

  if (isObject(relevantMemoriesOrContext) && "queryId" in relevantMemoriesOrContext) {
    return {
      task: inputOrTask,
      topStrategy: pickTopStrategy(relevantMemoriesOrContext, topStrategy),
      relevantMemories: relevantMemoriesOrContext.memoryCandidates,
      relevantSessions: relevantMemoriesOrContext.sessionCandidates,
    };
  }

  return {
    task: inputOrTask,
    topStrategy: toStrategyInsight(topStrategy),
    relevantMemories: Array.isArray(relevantMemoriesOrContext) ? relevantMemoriesOrContext : [],
    relevantSessions,
  };
}

export function buildDecisionRetrievalQuery(
  task: DecisionTaskInput,
  lane: ThinkingLane,
  config: DecisionConfig,
): RetrievalQuery {
  return {
    id: `decision:${task.id}:${lane}`,
    taskId: task.id,
    prompt: buildPrompt(task),
    thinkingLane: lane,
    planes: buildPlanes(task, lane),
    route: resolveTaskRoute(task),
    worker: normalizeText(task.worker) || undefined,
    topicHints: buildDecisionTopicHints(task),
    maxCandidatesPerPlane: clampMaxCandidates(task, lane, config),
    metadata: {
      priority: task.priority,
      budgetMode: task.budgetMode,
      retrievalMode: task.retrievalMode,
      agentId: task.agentId,
      sessionId: task.sessionId,
      surfaceId: task.surfaceId,
    },
  };
}

export function buildLocalFirstPlan(task: DecisionTaskInput, lane: ThinkingLane): string {
  const route = resolveTaskRoute(task);
  if (route === "coder") {
    return "先读仓库与文件差异，尽量在本地完成修改、验证和总结。";
  }
  if (route === "ops") {
    return "先查日志、端口、进程和配置，本地定位后再动远程链路。";
  }
  if (route === "office") {
    return "先复用现有办公技能和本地结构化脚本，再决定是否重推理。";
  }
  if (route === "research") {
    return "先读既有知识摘要和本地资料，再补最少量外部检索。";
  }
  if (route === "media") {
    return "先做 OCR、抽取、分段等本地处理，再让模型做高层判断。";
  }
  return lane === "system1"
    ? "优先走稳定规则、本地工具和已有策略，不做重规划。"
    : "先压缩上下文和已知记忆，再决定是否升级到重推理。";
}

export function buildRemoteModelPlan(task: DecisionTaskInput, lane: ThinkingLane): string {
  if (lane === "system1") {
    return "只有本地路径和稳定 skill 不足时才升级到远程模型。";
  }
  if (task.route === "coder" || task.route === "ops") {
    return "允许更深推理，但先带入最少必要记忆和资料，不做长上下文裸跑。";
  }
  return "只把最相关的记忆、资料和当前状态送入远程推理链。";
}

export function buildFallbackOrder(
  task: DecisionTaskInput,
  worker: string,
  skills: string[],
  lane: ThinkingLane,
): string[] {
  const route = resolveTaskRoute(task);
  return uniqueStrings([
    "stable-local-tools",
    skills[0] ? `skill:${skills[0]}` : null,
    worker ? `worker:${worker}` : null,
    lane === "system2" ? "route-replan" : "system2-escalation",
    route !== "general" ? "worker:main" : null,
  ]);
}

export function shouldUseSystem2(
  inputOrTask: ShouldUseSystem2Input | DecisionTaskInput,
  topStrategy?: StrategyRecord | RetrievalCandidate | null,
  relevantMemoriesOrContext?: RetrievalCandidate[] | ContextPack,
  relevantSessions?: RetrievalCandidate[],
): boolean {
  const normalized = normalizeShouldUseSystem2Args(
    inputOrTask,
    topStrategy,
    relevantMemoriesOrContext,
    relevantSessions,
  );
  const { task, topStrategy: strategy, relevantMemories, relevantSessions: sessions } = normalized;
  const stableSkillCount = uniqueStrings([...task.skillIds, ...(strategy?.skillIds || [])]).length;
  const highConfidenceExecutionMemories = relevantMemories.filter(
    isHighConfidenceExecutionMemory,
  ).length;
  const promptLength = normalizeText(
    [task.title, task.goal, task.blockedReason, task.lastError].join(" "),
  ).length;
  const consecutiveFailures = task.runState?.consecutiveFailures || 0;
  const remoteCallCount = task.runState?.remoteCallCount || 0;
  const hasPendingUserActionSignal = sessions.some(isPendingWaitingUserSignal);
  const hasPendingBlockedSignal = sessions.some(isPendingBlockedSignal);
  const hasPendingWaitingExternalSignal = sessions.some(isPendingWaitingExternalSignal);
  const hasCoordinatorSuggestion = sessions.some(isCoordinatorSuggestionSignal);
  const preferenceView = deriveDecisionUserPreferenceView(task, sessions);

  if (hasPendingUserActionSignal) {
    return false;
  }

  if (
    preferenceView &&
    (hasPendingBlockedSignal || hasPendingWaitingExternalSignal) &&
    (preferenceView.confirmationBoundary === "strict" ||
      (preferenceView.interruptionThreshold === "low" && task.priority !== "high"))
  ) {
    return false;
  }

  if (strategy?.thinkingLane === "system2") {
    return true;
  }

  if (strategy?.thinkingLane === "system1" && strategy.confidence >= 68) {
    if (consecutiveFailures === 0 && remoteCallCount < 2) {
      return false;
    }
  }

  if (
    !strategy &&
    promptLength <= 180 &&
    consecutiveFailures === 0 &&
    remoteCallCount <= 1 &&
    stableSkillCount >= 1 &&
    highConfidenceExecutionMemories >= 1 &&
    relevantMemories.length >= 2
  ) {
    return false;
  }

  if (
    !strategy &&
    hasCoordinatorSuggestion &&
    promptLength <= 220 &&
    consecutiveFailures === 0 &&
    remoteCallCount <= 1
  ) {
    return false;
  }

  if (!strategy) {
    return true;
  }
  if (consecutiveFailures > 0) {
    return true;
  }
  if (remoteCallCount >= 2) {
    return true;
  }
  if (task.blockedReason || task.lastError) {
    return true;
  }
  if (
    resolveTaskRoute(task) === "general" &&
    highConfidenceExecutionMemories < 2 &&
    stableSkillCount < 2
  ) {
    return true;
  }
  if (promptLength > 220) {
    return true;
  }
  if (task.priority === "high" && relevantMemories.length < 2) {
    return true;
  }
  return strategy.confidence < 68;
}

function normalizeDecisionRecordArgs(
  paramsOrTask: DecisionRecordParams | DecisionTaskInput,
  config?: DecisionConfig,
  contextPack?: ContextPack,
  topStrategy?: StrategyRecord | null,
  now?: number,
): DecisionRecordParams {
  if (isObject(paramsOrTask) && "task" in paramsOrTask) {
    return paramsOrTask;
  }

  return {
    task: paramsOrTask,
    config: config as DecisionConfig,
    policy: (paramsOrTask as Record<string, unknown>).policy as RuntimeCapabilityPolicy | undefined,
    contextPack,
    topStrategy,
    now,
  };
}

export function buildDecisionRecord(params: DecisionRecordParams): DecisionRecord;
export function buildDecisionRecord(
  task: DecisionTaskInput,
  config: DecisionConfig,
  contextPack: ContextPack,
  topStrategy?: StrategyRecord | null,
  now?: number,
): DecisionRecord;
export function buildDecisionRecord(
  paramsOrTask: DecisionRecordParams | DecisionTaskInput,
  config?: DecisionConfig,
  contextPack?: ContextPack,
  topStrategy?: StrategyRecord | null,
  now?: number,
): DecisionRecord {
  const params = normalizeDecisionRecordArgs(paramsOrTask, config, contextPack, topStrategy, now);

  if (!params.contextPack && !params.sources) {
    throw new Error("buildDecisionRecord requires either sources or contextPack");
  }

  const task = params.task;
  const system1Query = params.sources
    ? buildDecisionRetrievalQuery(task, "system1", params.config)
    : undefined;
  const system1ContextPack =
    params.contextPack ||
    (params.sources
      ? buildContextPack({
          query: system1Query as RetrievalQuery,
          sources: params.sources,
          policy: params.policy,
        })
      : undefined);

  const initialTopStrategy = pickTopStrategy(system1ContextPack, params.topStrategy);
  const contextRequestedSystem2 = params.contextPack?.thinkingLane === "system2";
  const escalateToSystem2 =
    contextRequestedSystem2 ||
    shouldUseSystem2({
      task,
      topStrategy: params.topStrategy || undefined,
      contextPack: system1ContextPack,
    });

  let finalContextPack = system1ContextPack as ContextPack;
  let finalQuery = system1Query;

  if (params.sources && escalateToSystem2) {
    finalQuery = buildDecisionRetrievalQuery(task, "system2", params.config);
    finalContextPack = buildContextPack({
      query: finalQuery,
      sources: params.sources,
      policy: params.policy,
    });
  }

  const finalTopStrategy =
    pickTopStrategy(finalContextPack, params.topStrategy) || initialTopStrategy;
  const thinkingLane: ThinkingLane = escalateToSystem2 ? "system2" : "system1";
  const recommendedWorker =
    normalizeText(finalTopStrategy?.worker) ||
    normalizeText(task.worker) ||
    defaultWorkerForRoute(resolveTaskRoute(task));
  const recommendedSkills = uniqueStrings([
    ...task.skillIds,
    ...(finalTopStrategy?.skillIds || []),
    ...buildRouteSkillHints(resolveTaskRoute(task)),
  ])
    .filter((skillId) => {
      if (!params.policy) {return true;}
      return params.policy.resolveExecutionStatus("skill", skillId).mode !== "blocked";
    })
    .slice(0, 12);
  const preferenceView = deriveDecisionUserPreferenceView(task, finalContextPack.sessionCandidates);
  const surfacePolicyView = deriveSurfacePolicyView(task, finalContextPack.sessionCandidates);
  const fallbackOrder = buildFallbackOrder(
    task,
    recommendedWorker,
    recommendedSkills,
    thinkingLane,
  );
  const relevantMemoryIds = collectRecordIds(finalContextPack.memoryCandidates);
  const relevantSessionIds = collectRecordIds(finalContextPack.sessionCandidates);
  const summary = [
    `lane=${thinkingLane}`,
    `worker=${recommendedWorker}`,
    finalTopStrategy ? `strategy=${truncateText(finalTopStrategy.summary, 96)}` : "strategy=none",
    finalContextPack.summary,
    preferenceView?.reportPolicy || preferenceView?.reportVerbosity
      ? `prefs=${[
          preferenceView.reportPolicy,
          preferenceView.reportVerbosity,
          preferenceView.interruptionThreshold,
          preferenceView.confirmationBoundary,
        ]
          .filter(Boolean)
          .join("/")}`
      : null,
    thinkingLane === "system1"
      ? "优先快通道，直接复用稳定路径。"
      : "进入慢通道，需要显式规划、裁剪上下文并准备 fallback。",
    surfacePolicyView && surfacePolicyView.restrictedTopics.length > 0
      ? `surface_restricted=${surfacePolicyView.restrictedTopics.join(",")}`
      : null,
  ].join(" | ");

  return {
    builtAt: params.now ?? Date.now(),
    thinkingLane,
    summary,
    recommendedWorker,
    recommendedSkills,
    relevantMemoryIds,
    relevantSessionIds,
    fallbackOrder,
    localFirstPlan: buildLocalFirstPlan(task, thinkingLane),
    remoteModelPlan: buildRemoteModelPlan(task, thinkingLane),
    budgetLimit: computeBudgetLimit(task, params.config, thinkingLane),
    contextPack: finalContextPack,
    metadata: {
      route: resolveTaskRoute(task),
      routeDomains: buildRouteDomains(resolveTaskRoute(task)),
      ecologyBinding: {
        agentId: task.agentId,
        sessionId: task.sessionId,
        surfaceId: task.surfaceId,
      },
      retrievalQueryId: finalQuery?.id ?? finalContextPack.queryId,
      initialQueryId: system1Query?.id,
      topStrategyId: finalTopStrategy?.id,
      topStrategyConfidence: finalTopStrategy?.confidence,
      userPreferenceView: preferenceView,
      surfacePolicyView: surfacePolicyView,
      fallback: finalTopStrategy?.fallback,
      recommendedSkills,
      contextSummary: finalContextPack.summary,
      synthesis: finalContextPack.synthesis,
      memoryBullets: toContextBullet("memory", finalContextPack.memoryCandidates),
    },
  };
}

export function buildDecisionPromptBlock(decision: DecisionRecord | null | undefined): string {
  if (!decision) {
    return "";
  }

  const metadata = isObject(decision.metadata) ? decision.metadata : {};
  const ecologyBinding = isObject(metadata.ecologyBinding) ? metadata.ecologyBinding : {};
  const userPreferenceView = isObject(metadata.userPreferenceView) ? metadata.userPreferenceView : {};
  const memoryLines = toContextBullet("memory", decision.contextPack.memoryCandidates);
  const sessionLines = toContextBullet("session", decision.contextPack.sessionCandidates);
  const synthesisLines = decision.contextPack.synthesis.map((line) => `- ${line}`);
  const ecologyParts = uniqueStrings([
    typeof ecologyBinding.agentId === "string" ? `agent=${ecologyBinding.agentId}` : null,
    typeof ecologyBinding.surfaceId === "string" ? `surface=${ecologyBinding.surfaceId}` : null,
    typeof ecologyBinding.sessionId === "string" ? `session=${ecologyBinding.sessionId}` : null,
  ]);
  const preferenceParts = uniqueStrings([
    typeof userPreferenceView.reportPolicy === "string"
      ? `report=${userPreferenceView.reportPolicy}`
      : null,
    typeof userPreferenceView.reportVerbosity === "string"
      ? `verbosity=${userPreferenceView.reportVerbosity}`
      : null,
    typeof userPreferenceView.interruptionThreshold === "string"
      ? `interrupt=${userPreferenceView.interruptionThreshold}`
      : null,
    typeof userPreferenceView.confirmationBoundary === "string"
      ? `confirm=${userPreferenceView.confirmationBoundary}`
      : null,
    userPreferenceView.pendingUserModelImport === true ? "pending-user-md-import" : null,
  ]);

  return [
    "决策内核输出：",
    `- 决策通道：${decision.thinkingLane || "system1"}`,
    `- 决策摘要：${decision.summary}`,
    `- 推荐执行者：${decision.recommendedWorker || "main"}`,
    ecologyParts.length ? `- 生态绑定：${ecologyParts.join(" · ")}` : "",
    preferenceParts.length ? `- 用户偏好：${preferenceParts.join(" · ")}` : "",
    decision.recommendedSkills.length
      ? `- 推荐 skills：${decision.recommendedSkills.join(", ")}`
      : "",
    decision.fallbackOrder.length ? `- fallback 顺序：${decision.fallbackOrder.join(" -> ")}` : "",
    decision.localFirstPlan ? `- 本地优先：${decision.localFirstPlan}` : "",
    decision.remoteModelPlan ? `- 远程推理：${decision.remoteModelPlan}` : "",
    decision.contextPack.summary ? `- 上下文摘要：${decision.contextPack.summary}` : "",
    memoryLines.length ? "- 相关记忆：" : "",
    ...memoryLines,
    sessionLines.length ? "- 当前信号：" : "",
    ...sessionLines,
    synthesisLines.length ? "- 综合上下文：" : "",
    ...synthesisLines,
  ]
    .filter(Boolean)
    .join("\n");
}
