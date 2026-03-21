import type {
  EvolutionMemoryRecord,
  FederationPackageRiskLevel,
  RuntimeEvolutionObservationMetrics,
  RuntimeMetadata,
} from "./contracts.js";

export type RuntimeEvolutionRiskReview = {
  riskLevel: FederationPackageRiskLevel;
  autoApplyEligible: boolean;
  requiresReasonOnAdopt: boolean;
  summary: string;
  signals: string[];
};

export type RuntimeEvolutionAutoApplyStatus = {
  ready: boolean;
  promoteReady: boolean;
  adoptReady: boolean;
  blockers: string[];
  summary: string;
};

export type RuntimeEvolutionVerificationState =
  | "pending"
  | "healthy"
  | "watch"
  | "revert_recommended";

export type RuntimeEvolutionVerificationReview = {
  state: RuntimeEvolutionVerificationState;
  revertRecommended: boolean;
  summary: string;
  signals: string[];
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
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

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMetric(value: number, digits = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
}

function readSkillIds(metadata: RuntimeMetadata | undefined): string[] {
  const raw = Array.isArray(metadata?.skillIds) ? metadata.skillIds : [];
  return uniqueStrings(raw.filter((value): value is string => typeof value === "string"));
}

function readEvolutionLifecycleStatus(metadata: RuntimeMetadata | undefined): {
  stale: boolean;
  reason?: string;
  agedMemoryIds: string[];
  weakenedStrategyIds: string[];
} {
  const lifecycle = toRecord(metadata?.lifecycle);
  return {
    stale: lifecycle?.stale === true,
    reason: normalizeText(lifecycle?.staleReason) || undefined,
    agedMemoryIds: readStringArray(lifecycle?.agedMemoryIds),
    weakenedStrategyIds: readStringArray(lifecycle?.weakenedStrategyIds),
  };
}

function elevateRiskLevel(
  current: FederationPackageRiskLevel,
  next: FederationPackageRiskLevel,
): FederationPackageRiskLevel {
  if (current === "high" || next === "high") {
    return "high";
  }
  if (current === "medium" || next === "medium") {
    return "medium";
  }
  return "low";
}

function matchesRiskySkill(skillId: string): boolean {
  const normalized = skillId.toLowerCase();
  return /(^|[-_])(browser|deploy|exec|gateway|mcp|remote|shell|terminal)([-_]|$)/.test(normalized);
}

export function buildRuntimeEvolutionRiskReview(
  candidate: Pick<EvolutionMemoryRecord, "candidateType" | "targetLayer" | "metadata">,
): RuntimeEvolutionRiskReview {
  const metadata = toRecord(candidate.metadata);
  const lane = normalizeText(metadata?.lane);
  const worker = normalizeText(metadata?.worker) || "main";
  const skillIds = readSkillIds(metadata);
  let riskLevel: FederationPackageRiskLevel = "low";
  const signals: string[] = [];

  if (
    candidate.candidateType === "model_route" ||
    candidate.candidateType === "prompt_context_policy" ||
    candidate.candidateType === "retry_policy" ||
    candidate.candidateType === "retry_policy_review" ||
    candidate.candidateType === "strategy_refresh" ||
    candidate.candidateType === "worker_routing"
  ) {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Touches routing or runtime policy behavior.");
  }

  if (
    candidate.candidateType === "intel_source" ||
    candidate.candidateType === "intel_source_reweight"
  ) {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Changes the news/info source policy.");
  }

  if (candidate.targetLayer === "governance") {
    riskLevel = elevateRiskLevel(riskLevel, "high");
    signals.push("Targets governance state and requires explicit operator review.");
  }

  if (lane === "system2") {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Depends on a deeper System 2 lane instead of the stable fast path.");
  }

  if (candidate.targetLayer === "task_loop" && worker !== "main") {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push(`Routes work to specialized worker ${worker}.`);
  }

  if (skillIds.length >= 3) {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Expands the active skill bundle beyond a minimal local path.");
  }

  if (skillIds.some(matchesRiskySkill)) {
    riskLevel = elevateRiskLevel(riskLevel, "medium");
    signals.push("Includes higher-impact runtime skills that should stay operator-reviewed.");
  }

  if (
    candidate.candidateType === "route_default_lane" &&
    lane === "system1" &&
    signals.length === 0
  ) {
    signals.push("Stable route-default lane recommendation with no elevated signals.");
  }

  if (
    candidate.candidateType === "route_skill_bundle" &&
    skillIds.length > 0 &&
    signals.length === 0
  ) {
    signals.push("Small route-native skill bundle with no elevated execution signals.");
  }

  const autoApplyEligible = riskLevel === "low";
  return {
    riskLevel,
    autoApplyEligible,
    requiresReasonOnAdopt: riskLevel !== "low",
    summary:
      riskLevel === "low"
        ? "Low-risk local optimization. Eligible for automatic promotion/adoption once observation thresholds are met."
        : riskLevel === "medium"
          ? "Medium-risk optimization. Keep it in shadow/review unless the operator explicitly adopts it."
          : "High-impact optimization. Manual operator approval is required before adoption.",
    signals,
  };
}

export function readRuntimeEvolutionObservationMetrics(
  metadata: RuntimeMetadata | undefined,
): RuntimeEvolutionObservationMetrics | undefined {
  const metrics = toRecord(metadata?.observationMetrics);
  if (!metrics) {
    return undefined;
  }
  const observationCount = Math.max(0, Math.trunc(toNumber(metrics.observationCount, 0)));
  if (observationCount <= 0) {
    return undefined;
  }
  return {
    observationCount,
    successCount: Math.max(0, Math.trunc(toNumber(metrics.successCount, 0))),
    completionCount: Math.max(0, Math.trunc(toNumber(metrics.completionCount, 0))),
    waitingUserCount: Math.max(0, Math.trunc(toNumber(metrics.waitingUserCount, 0))),
    blockedCount: Math.max(0, Math.trunc(toNumber(metrics.blockedCount, 0))),
    failedCount: Math.max(0, Math.trunc(toNumber(metrics.failedCount, 0))),
    averageCompletionScore: roundMetric(toNumber(metrics.averageCompletionScore, 0)),
    averageLatencyMs: roundMetric(toNumber(metrics.averageLatencyMs, 0), 0),
    averageTokenEstimate: roundMetric(toNumber(metrics.averageTokenEstimate, 0), 0),
    averageInterruptionCount: roundMetric(toNumber(metrics.averageInterruptionCount, 0)),
    averageRemoteCallCount: roundMetric(toNumber(metrics.averageRemoteCallCount, 0)),
    successRate: roundMetric(toNumber(metrics.successRate, 0)),
    regressionRiskScore: roundMetric(toNumber(metrics.regressionRiskScore, 0)),
    lastObservedAt: Math.max(0, Math.trunc(toNumber(metrics.lastObservedAt, 0))),
  };
}

export function readRuntimeEvolutionVerificationMetrics(
  metadata: RuntimeMetadata | undefined,
): RuntimeEvolutionObservationMetrics | undefined {
  const verification = toRecord(metadata?.verificationMetrics);
  if (!verification) {
    return undefined;
  }
  const observationCount = Math.max(0, Math.trunc(toNumber(verification.observationCount, 0)));
  if (observationCount <= 0) {
    return undefined;
  }
  return {
    observationCount,
    successCount: Math.max(0, Math.trunc(toNumber(verification.successCount, 0))),
    completionCount: Math.max(0, Math.trunc(toNumber(verification.completionCount, 0))),
    waitingUserCount: Math.max(0, Math.trunc(toNumber(verification.waitingUserCount, 0))),
    blockedCount: Math.max(0, Math.trunc(toNumber(verification.blockedCount, 0))),
    failedCount: Math.max(0, Math.trunc(toNumber(verification.failedCount, 0))),
    averageCompletionScore: roundMetric(toNumber(verification.averageCompletionScore, 0)),
    averageLatencyMs: roundMetric(toNumber(verification.averageLatencyMs, 0), 0),
    averageTokenEstimate: roundMetric(toNumber(verification.averageTokenEstimate, 0), 0),
    averageInterruptionCount: roundMetric(toNumber(verification.averageInterruptionCount, 0)),
    averageRemoteCallCount: roundMetric(toNumber(verification.averageRemoteCallCount, 0)),
    successRate: roundMetric(toNumber(verification.successRate, 0)),
    regressionRiskScore: roundMetric(toNumber(verification.regressionRiskScore, 0)),
    lastObservedAt: Math.max(0, Math.trunc(toNumber(verification.lastObservedAt, 0))),
  };
}

export function buildRuntimeEvolutionVerificationReview(params: {
  candidate: Pick<EvolutionMemoryRecord, "targetLayer" | "metadata">;
  metrics?: RuntimeEvolutionObservationMetrics | null;
}): RuntimeEvolutionVerificationReview {
  const lifecycleStatus = readEvolutionLifecycleStatus(params.candidate.metadata);
  const metrics =
    params.metrics ?? readRuntimeEvolutionVerificationMetrics(params.candidate.metadata);
  if (!metrics || metrics.observationCount <= 0) {
    return {
      state: "pending",
      revertRecommended: false,
      summary:
        "Awaiting post-adoption telemetry before verifying this optimization on the live path.",
      signals: [],
    };
  }

  const severeSignals: string[] = [];
  const watchSignals: string[] = [];
  if (lifecycleStatus.stale) {
    const staleDetail =
      lifecycleStatus.weakenedStrategyIds.length > 0
        ? `linked strategies ${lifecycleStatus.weakenedStrategyIds.join(", ")} weakened during lifecycle review`
        : lifecycleStatus.agedMemoryIds.length > 0
          ? `linked memories ${lifecycleStatus.agedMemoryIds.join(", ")} aged during lifecycle review`
          : lifecycleStatus.reason || "supporting lineage is stale";
    severeSignals.push(`Lifecycle review marked the live lineage stale because ${staleDetail}.`);
  }
  if (metrics.failedCount > 0) {
    severeSignals.push(`Observed ${metrics.failedCount} failed live runs after adoption.`);
  }
  if (metrics.blockedCount > 0) {
    severeSignals.push(`Observed ${metrics.blockedCount} blocked live runs after adoption.`);
  }
  if (metrics.successRate < 0.45) {
    severeSignals.push(
      `Post-adoption success rate ${Math.round(metrics.successRate * 100)}% is below 45%.`,
    );
  }
  if (metrics.averageCompletionScore < 60) {
    severeSignals.push(
      `Post-adoption completion ${Math.round(metrics.averageCompletionScore)} is below 60.`,
    );
  }
  if (metrics.regressionRiskScore > 0.4) {
    severeSignals.push(
      `Post-adoption regression risk ${Math.round(metrics.regressionRiskScore * 100)}% exceeds 40%.`,
    );
  }

  if (metrics.waitingUserCount > 0) {
    watchSignals.push(`Observed ${metrics.waitingUserCount} waiting-user runs after adoption.`);
  }
  if (metrics.observationCount < 2) {
    watchSignals.push(
      `Need at least 2 post-adoption observations; have ${metrics.observationCount}.`,
    );
  }
  if (metrics.successRate < 0.72) {
    watchSignals.push(
      `Post-adoption success rate ${Math.round(metrics.successRate * 100)}% is below 72%.`,
    );
  }
  if (metrics.averageCompletionScore < 78) {
    watchSignals.push(
      `Post-adoption completion ${Math.round(metrics.averageCompletionScore)} is below 78.`,
    );
  }
  if (metrics.regressionRiskScore > 0.25) {
    watchSignals.push(
      `Post-adoption regression risk ${Math.round(metrics.regressionRiskScore * 100)}% exceeds 25%.`,
    );
  }
  if (metrics.averageInterruptionCount > 0.5) {
    watchSignals.push(
      `Post-adoption interruptions ${roundMetric(metrics.averageInterruptionCount)} exceed 0.5.`,
    );
  }
  if (metrics.averageLatencyMs > 90 * 60 * 1000) {
    watchSignals.push(
      `Post-adoption latency ${Math.round(metrics.averageLatencyMs / 60000)}m exceeds 90m.`,
    );
  }
  if (metrics.averageTokenEstimate > 12_000) {
    watchSignals.push(
      `Post-adoption token estimate ${Math.round(metrics.averageTokenEstimate)} exceeds 12000.`,
    );
  }

  if (severeSignals.length > 0) {
    return {
      state: "revert_recommended",
      revertRecommended: true,
      summary:
        severeSignals[0] || "Post-adoption telemetry regressed. Revert or rework the optimization.",
      signals: uniqueStrings([...severeSignals, ...watchSignals]),
    };
  }
  if (watchSignals.length > 0) {
    return {
      state: "watch",
      revertRecommended: false,
      summary:
        watchSignals[0] ||
        "Post-adoption telemetry is mixed. Keep this optimization under watch before calling it healthy.",
      signals: uniqueStrings(watchSignals),
    };
  }
  return {
    state: "healthy",
    revertRecommended: false,
    summary: "Post-adoption telemetry remains healthy. Keep this optimization live.",
    signals: [],
  };
}

export function buildRuntimeEvolutionAutoApplyStatus(params: {
  candidate: Pick<EvolutionMemoryRecord, "candidateType" | "targetLayer" | "metadata">;
  metrics?: RuntimeEvolutionObservationMetrics | null;
}): RuntimeEvolutionAutoApplyStatus {
  const riskReview = buildRuntimeEvolutionRiskReview(params.candidate);
  const lifecycleStatus = readEvolutionLifecycleStatus(params.candidate.metadata);
  const metrics = params.metrics ?? undefined;
  const promoteBlockers: string[] = [];
  const adoptBlockers: string[] = [];

  if (lifecycleStatus.stale) {
    const staleDetail =
      lifecycleStatus.weakenedStrategyIds.length > 0
        ? `linked strategies ${lifecycleStatus.weakenedStrategyIds.join(", ")} weakened during lifecycle review`
        : lifecycleStatus.agedMemoryIds.length > 0
          ? `linked memories ${lifecycleStatus.agedMemoryIds.join(", ")} aged during lifecycle review`
          : "supporting runtime evidence is stale";
    promoteBlockers.push(
      `Lifecycle review marked this candidate stale because ${staleDetail}. Reinforce the supporting lineage before auto-apply.`,
    );
    adoptBlockers.push(
      `Lifecycle review marked this candidate stale because ${staleDetail}. Reinforce the supporting lineage before auto-apply.`,
    );
  }

  if (!riskReview.autoApplyEligible) {
    promoteBlockers.push("Risk level requires manual operator review.");
    adoptBlockers.push("Risk level requires manual operator review.");
  }

  if (!metrics || metrics.observationCount <= 0) {
    promoteBlockers.push("No structured observation telemetry yet.");
    adoptBlockers.push("No structured observation telemetry yet.");
  } else {
    if (metrics.observationCount < 3) {
      promoteBlockers.push(`Need at least 3 observations; have ${metrics.observationCount}.`);
    }
    if (metrics.successRate < 0.6) {
      promoteBlockers.push(`Success rate ${Math.round(metrics.successRate * 100)}% is below 60%.`);
    }
    if (metrics.averageCompletionScore < 70) {
      promoteBlockers.push(
        `Average completion ${Math.round(metrics.averageCompletionScore)} is below 70.`,
      );
    }
    if (metrics.regressionRiskScore > 0.34) {
      promoteBlockers.push(
        `Regression risk ${Math.round(metrics.regressionRiskScore * 100)}% exceeds 34%.`,
      );
    }
    if (metrics.averageInterruptionCount > 1) {
      promoteBlockers.push(
        `Average interruptions ${roundMetric(metrics.averageInterruptionCount)} exceeds 1.`,
      );
    }
    if (metrics.averageLatencyMs > 2 * 60 * 60 * 1000) {
      promoteBlockers.push(
        `Average latency ${Math.round(metrics.averageLatencyMs / 60000)}m exceeds 120m.`,
      );
    }
    if (metrics.averageTokenEstimate > 18_000) {
      promoteBlockers.push(
        `Estimated token cost ${Math.round(metrics.averageTokenEstimate)} exceeds 18000.`,
      );
    }

    adoptBlockers.push(...promoteBlockers);
    if (metrics.observationCount < 5) {
      adoptBlockers.push(`Need at least 5 observations; have ${metrics.observationCount}.`);
    }
    if (metrics.successRate < 0.72) {
      adoptBlockers.push(`Success rate ${Math.round(metrics.successRate * 100)}% is below 72%.`);
    }
    if (metrics.averageCompletionScore < 78) {
      adoptBlockers.push(
        `Average completion ${Math.round(metrics.averageCompletionScore)} is below 78.`,
      );
    }
    if (metrics.regressionRiskScore > 0.25) {
      adoptBlockers.push(
        `Regression risk ${Math.round(metrics.regressionRiskScore * 100)}% exceeds 25%.`,
      );
    }
    if (metrics.averageInterruptionCount > 0.5) {
      adoptBlockers.push(
        `Average interruptions ${roundMetric(metrics.averageInterruptionCount)} exceeds 0.5.`,
      );
    }
    if (metrics.averageLatencyMs > 90 * 60 * 1000) {
      adoptBlockers.push(
        `Average latency ${Math.round(metrics.averageLatencyMs / 60000)}m exceeds 90m.`,
      );
    }
    if (metrics.averageTokenEstimate > 12_000) {
      adoptBlockers.push(
        `Estimated token cost ${Math.round(metrics.averageTokenEstimate)} exceeds 12000.`,
      );
    }
  }

  const uniquePromoteBlockers = uniqueStrings(promoteBlockers);
  const uniqueAdoptBlockers = uniqueStrings(adoptBlockers);
  const promoteReady = uniquePromoteBlockers.length === 0;
  const adoptReady = uniqueAdoptBlockers.length === 0;
  return {
    ready: adoptReady,
    promoteReady,
    adoptReady,
    blockers: adoptReady ? [] : uniqueAdoptBlockers,
    summary: adoptReady
      ? "Structured telemetry supports automatic promotion and adoption."
      : promoteReady
        ? "Structured telemetry supports promotion, but adoption still needs stronger results."
        : uniqueAdoptBlockers[0] || "Automatic adoption is currently gated.",
  };
}

export function resolveRuntimeEvolutionControls(metadata: RuntimeMetadata | undefined): {
  enabled: boolean;
  autoApplyLowRisk: boolean;
  autoCanaryEvolution: boolean;
} {
  const meta = toRecord(metadata);
  return {
    enabled: meta?.enabled !== false,
    autoApplyLowRisk: meta?.autoApplyLowRisk === true,
    autoCanaryEvolution: meta?.autoCanaryEvolution === true,
  };
}
