import { loadConfig } from "../../config/config.js";
import { restartGatewayProcessWithFreshPid } from "../../infra/process-respawn.js";
import {
  syncRuntimeCapabilityRegistry,
  upsertRuntimeMcpGrant,
  upsertRuntimeCapabilityRegistryEntry,
} from "../../shared/runtime/capability-plane.js";
import {
  buildDesktopBootstrapState,
  buildDesktopOpenLogsResult,
  buildDesktopRuntimeProcessState,
  buildDesktopRuntimeShellSnapshot,
  buildDesktopSettingsSnapshot,
  buildRuntimeHealthSnapshot,
  buildRuntimeTaskDetailSnapshot,
  initializeDesktopInstance,
  loadDesktopConfigSafe,
} from "../../shared/runtime/desktop-control.js";
import {
  materializeRuntimeFederationAssignmentTask,
  transitionRuntimeFederationAssignment,
} from "../../shared/runtime/federation-assignments.js";
import {
  configureRuntimeFederationInboxMaintenance,
  configureRuntimeFederationPushPolicy,
  listRuntimeFederationInbox,
  materializeRuntimeCoordinatorSuggestionTask,
  reviewRuntimeFederationInboxMaintenance,
  syncRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
} from "../../shared/runtime/federation-inbox.js";
import { syncRuntimeFederationOutbox } from "../../shared/runtime/federation-outbox.js";
import { configureRuntimeFederationRemoteSyncMaintenance } from "../../shared/runtime/federation-remote-maintenance.js";
import {
  previewRuntimeFederationRemote,
  syncRuntimeFederationRemote,
} from "../../shared/runtime/federation-sync.js";
import { dispatchRuntimeIntelDeliveries } from "../../shared/runtime/intel-delivery.js";
import {
  isRuntimeInfoDomain,
  normalizeRuntimeInfoDomain,
} from "../../shared/runtime/intel-domains.js";
import { runRuntimeIntelPipeline } from "../../shared/runtime/intel-pipeline.js";
import {
  configureRuntimeIntelPanel,
  deleteRuntimeIntelSource,
  refreshRuntimeIntelPipeline,
  upsertRuntimeIntelSource,
} from "../../shared/runtime/intel-refresh.js";
import {
  applyRuntimeMemoryInvalidationRollback,
  applyRuntimeMemoryLifecycleReview,
  applyRuntimeMemoryLineageInvalidation,
  applyRuntimeMemoryLineageReinforcement,
  applyRuntimePinnedIntelKnowledgePromotion,
} from "../../shared/runtime/memory-update-engine.js";
import {
  acknowledgeRuntimeEvolutionVerification,
  configureRuntimeMemoryLifecycle,
  configureRuntimeEvolution,
  reviewRuntimeEvolution,
  setRuntimeEvolutionCandidateState,
} from "../../shared/runtime/mutations.js";
import {
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildRuntimeCapabilitiesStatus,
  buildRuntimeDashboardSnapshot,
  buildRuntimeEvolutionStatus,
  buildRuntimeIntelStatus,
  buildRuntimeMemoryList,
  buildRuntimeRetrievalStatus,
  buildRuntimeTasksList,
} from "../../shared/runtime/runtime-dashboard.js";
import {
  applyRuntimeTaskResult,
  configureRuntimeTaskLoop,
  planRuntimeTask,
  respondRuntimeWaitingUserTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "../../shared/runtime/task-engine.js";
import {
  adoptRuntimeRoleOptimizationCandidate,
  adoptRuntimeUserModelOptimizationCandidate,
  configureRuntimeUserConsoleMaintenance,
  deleteRuntimeAgent,
  deleteRuntimeSessionWorkingPreference,
  getRuntimeUserConsoleStore,
  listRuntimeRoleOptimizationCandidates,
  listRuntimeUserModelOptimizationCandidates,
  getRuntimeUserModel,
  listRuntimeAgents,
  listRuntimeSessionWorkingPreferences,
  listRuntimeSurfaces,
  rejectRuntimeRoleOptimizationCandidate,
  rejectRuntimeUserModelOptimizationCandidate,
  reviewRuntimeUserConsoleMaintenance,
  reviewRuntimeUserModelOptimizations,
  reviewRuntimeRoleOptimizations,
  resolveRuntimeUserPreferenceView,
  updateRuntimeUserModel,
  upsertRuntimeAgent,
  upsertRuntimeSessionWorkingPreference,
  upsertRuntimeSurface,
  upsertRuntimeSurfaceRoleOverlay,
} from "../../shared/runtime/user-console.js";
import {
  markRuntimeUserModelMirrorImported,
  readRuntimeUserModelMirrorImport,
  syncRuntimeUserModelMirror,
} from "../../shared/runtime/user-model-mirror.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function loadConfigSafe(): Record<string, unknown> | null {
  try {
    return loadConfig() as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeReportPolicy(
  value: unknown,
): "silent" | "reply" | "proactive" | "reply_and_proactive" | undefined {
  return value === "silent" ||
    value === "reply" ||
    value === "proactive" ||
    value === "reply_and_proactive"
    ? value
    : undefined;
}

function normalizeBudgetMode(value: unknown): "strict" | "balanced" | "deep" | undefined {
  return value === "strict" || value === "balanced" || value === "deep" ? value : undefined;
}

function normalizeRetrievalMode(value: unknown): "off" | "light" | "deep" | undefined {
  return value === "off" || value === "light" || value === "deep" ? value : undefined;
}

export const runtimeHandlers: GatewayRequestHandlers = {
  "desktop.getBootstrapState": async ({ respond }) => {
    respond(
      true,
      buildDesktopBootstrapState({
        config: loadDesktopConfigSafe(),
      }),
      undefined,
    );
  },
  "desktop.getShellSnapshot": async ({ respond }) => {
    respond(
      true,
      buildDesktopRuntimeShellSnapshot({
        config: loadDesktopConfigSafe(),
      }),
      undefined,
    );
  },
  "desktop.initializeInstance": async ({ respond }) => {
    respond(true, initializeDesktopInstance(), undefined);
  },
  "desktop.getRuntimeProcessState": async ({ respond }) => {
    respond(
      true,
      buildDesktopRuntimeProcessState({
        config: loadDesktopConfigSafe(),
      }),
      undefined,
    );
  },
  "desktop.restartRuntime": async ({ respond }) => {
    const restart = restartGatewayProcessWithFreshPid();
    const accepted = restart.mode === "spawned" || restart.mode === "supervised";
    respond(
      true,
      {
        ...restart,
        accepted,
      },
      undefined,
    );
    if (accepted) {
      setTimeout(() => {
        process.exit(0);
      }, 250).unref();
    }
  },
  "desktop.openLogs": async ({ respond }) => {
    respond(true, buildDesktopOpenLogsResult(), undefined);
  },
  "runtime.snapshot": async ({ respond }) => {
    respond(true, buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }), undefined);
  },
  "runtime.getDashboard": async ({ respond }) => {
    respond(true, buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }), undefined);
  },
  "runtime.getHealth": async ({ respond }) => {
    respond(
      true,
      buildRuntimeHealthSnapshot({
        config: loadDesktopConfigSafe(),
      }),
      undefined,
    );
  },
  "runtime.tasks.list": async ({ respond }) => {
    respond(true, buildRuntimeTasksList(), undefined);
  },
  "runtime.getTask": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    try {
      respond(true, buildRuntimeTaskDetailSnapshot(taskId), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "runtime.tasks.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeTaskLoop({
        defaultBudgetMode: normalizeBudgetMode(params.defaultBudgetMode),
        defaultRetrievalMode: normalizeRetrievalMode(params.defaultRetrievalMode),
        maxInputTokensPerTurn:
          typeof params.maxInputTokensPerTurn === "number"
            ? params.maxInputTokensPerTurn
            : undefined,
        maxContextChars:
          typeof params.maxContextChars === "number" ? params.maxContextChars : undefined,
        compactionWatermark:
          typeof params.compactionWatermark === "number" ? params.compactionWatermark : undefined,
        maxRemoteCallsPerTask:
          typeof params.maxRemoteCallsPerTask === "number"
            ? params.maxRemoteCallsPerTask
            : undefined,
        leaseDurationMs:
          typeof params.leaseDurationMs === "number" ? params.leaseDurationMs : undefined,
        maxConcurrentRunsPerWorker:
          typeof params.maxConcurrentRunsPerWorker === "number"
            ? params.maxConcurrentRunsPerWorker
            : undefined,
        maxConcurrentRunsPerRoute:
          typeof params.maxConcurrentRunsPerRoute === "number"
            ? params.maxConcurrentRunsPerRoute
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.memory.list": async ({ respond }) => {
    respond(true, buildRuntimeMemoryList(), undefined);
  },
  "runtime.listMemories": async ({ respond }) => {
    respond(true, buildRuntimeMemoryList().memories, undefined);
  },
  "runtime.listStrategies": async ({ respond }) => {
    respond(true, buildRuntimeMemoryList().strategies, undefined);
  },
  "runtime.user.get": async ({ respond }) => {
    respond(true, getRuntimeUserModel(), undefined);
  },
  "runtime.user.console.detail": async ({ respond }) => {
    respond(true, getRuntimeUserConsoleStore(), undefined);
  },
  "runtime.role.optimization.list": async ({ respond }) => {
    respond(true, listRuntimeRoleOptimizationCandidates(), undefined);
  },
  "runtime.user.model.optimization.list": async ({ respond }) => {
    respond(true, listRuntimeUserModelOptimizationCandidates(), undefined);
  },
  "runtime.user.session.list": async ({ respond }) => {
    respond(true, listRuntimeSessionWorkingPreferences(), undefined);
  },
  "runtime.user.update": async ({ params, respond }) => {
    const userModel = updateRuntimeUserModel({
      displayName: typeof params.displayName === "string" ? params.displayName : undefined,
      communicationStyle:
        typeof params.communicationStyle === "string" ? params.communicationStyle : undefined,
      interruptionThreshold:
        params.interruptionThreshold === "low" ||
        params.interruptionThreshold === "medium" ||
        params.interruptionThreshold === "high"
          ? params.interruptionThreshold
          : undefined,
      reportVerbosity:
        params.reportVerbosity === "brief" ||
        params.reportVerbosity === "balanced" ||
        params.reportVerbosity === "detailed"
          ? params.reportVerbosity
          : undefined,
      confirmationBoundary:
        params.confirmationBoundary === "strict" ||
        params.confirmationBoundary === "balanced" ||
        params.confirmationBoundary === "light"
          ? params.confirmationBoundary
          : undefined,
      reportPolicy: normalizeReportPolicy(params.reportPolicy),
      metadata:
        typeof params.metadata === "object" &&
        params.metadata !== null &&
        !Array.isArray(params.metadata)
          ? (params.metadata as Record<string, unknown>)
          : undefined,
    });
    respond(
      true,
      {
        userModel,
        mirror: syncRuntimeUserModelMirror(),
      },
      undefined,
    );
  },
  "runtime.user.mirror.sync": async ({ params, respond }) => {
    respond(
      true,
      syncRuntimeUserModelMirror({
        force: params.force === true,
      }),
      undefined,
    );
  },
  "runtime.user.mirror.import": async ({ respond }) => {
    const imported = readRuntimeUserModelMirrorImport();
    const userModel = updateRuntimeUserModel(imported.patch);
    const mirrorStatus = markRuntimeUserModelMirrorImported({
      lastModifiedAt: imported.lastModifiedAt,
    });
    respond(
      true,
      {
        imported,
        mirrorStatus,
        mirrorSync: syncRuntimeUserModelMirror({ force: true }),
        userModel,
      },
      undefined,
    );
  },
  "runtime.user.session.upsert": async ({ params, respond }) => {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
    if (!sessionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId is required"));
      return;
    }
    respond(
      true,
      upsertRuntimeSessionWorkingPreference({
        id: typeof params.id === "string" ? params.id : undefined,
        sessionId,
        label: typeof params.label === "string" ? params.label : undefined,
        communicationStyle:
          typeof params.communicationStyle === "string" ? params.communicationStyle : undefined,
        interruptionThreshold:
          params.interruptionThreshold === "low" ||
          params.interruptionThreshold === "medium" ||
          params.interruptionThreshold === "high"
            ? params.interruptionThreshold
            : undefined,
        reportVerbosity:
          params.reportVerbosity === "brief" ||
          params.reportVerbosity === "balanced" ||
          params.reportVerbosity === "detailed"
            ? params.reportVerbosity
            : undefined,
        confirmationBoundary:
          params.confirmationBoundary === "strict" ||
          params.confirmationBoundary === "balanced" ||
          params.confirmationBoundary === "light"
            ? params.confirmationBoundary
            : undefined,
        reportPolicy: normalizeReportPolicy(params.reportPolicy),
        notes: typeof params.notes === "string" ? params.notes : undefined,
        expiresAt:
          typeof params.expiresAt === "number" && Number.isFinite(params.expiresAt)
            ? params.expiresAt
            : params.expiresAt === null
              ? null
              : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.user.session.delete": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, deleteRuntimeSessionWorkingPreference(id), undefined);
  },
  "runtime.user.preferences.resolve": async ({ params, respond }) => {
    respond(
      true,
      resolveRuntimeUserPreferenceView({
        agentId: typeof params.agentId === "string" ? params.agentId : undefined,
        sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
      }),
      undefined,
    );
  },
  "runtime.agents.list": async ({ respond }) => {
    respond(true, listRuntimeAgents(), undefined);
  },
  "runtime.agent.upsert": async ({ params, respond }) => {
    const overlay =
      typeof params.overlay === "object" &&
      params.overlay !== null &&
      !Array.isArray(params.overlay)
        ? (params.overlay as Record<string, unknown>)
        : null;
    respond(
      true,
      upsertRuntimeAgent({
        id: typeof params.id === "string" ? params.id : undefined,
        name: typeof params.name === "string" ? params.name : "Untitled agent",
        description: typeof params.description === "string" ? params.description : undefined,
        avatarUrl: typeof params.avatarUrl === "string" ? params.avatarUrl : undefined,
        roleBase: typeof params.roleBase === "string" ? params.roleBase : undefined,
        memoryNamespace:
          typeof params.memoryNamespace === "string" ? params.memoryNamespace : undefined,
        skillIds: Array.isArray(params.skillIds)
          ? params.skillIds.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        active: typeof params.active === "boolean" ? params.active : undefined,
        overlay: overlay
          ? {
              communicationStyle:
                typeof overlay.communicationStyle === "string"
                  ? overlay.communicationStyle
                  : undefined,
              reportPolicy: normalizeReportPolicy(overlay.reportPolicy),
              notes: typeof overlay.notes === "string" ? overlay.notes : undefined,
            }
          : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.agent.delete": async ({ params, respond }) => {
    const agentId = typeof params.id === "string" ? params.id.trim() : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, deleteRuntimeAgent(agentId), undefined);
  },
  "runtime.surfaces.list": async ({ respond }) => {
    respond(true, listRuntimeSurfaces(), undefined);
  },
  "runtime.surface.upsert": async ({ params, respond }) => {
    const channel = typeof params.channel === "string" ? params.channel.trim() : "";
    const accountId = typeof params.accountId === "string" ? params.accountId.trim() : "";
    const label = typeof params.label === "string" ? params.label.trim() : "";
    if (!channel || !accountId || !label) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channel, accountId, and label are required"),
      );
      return;
    }
    respond(
      true,
      upsertRuntimeSurface({
        id: typeof params.id === "string" ? params.id : undefined,
        channel,
        accountId,
        label,
        ownerKind: params.ownerKind === "agent" ? "agent" : "user",
        ownerId: typeof params.ownerId === "string" ? params.ownerId : undefined,
        active: typeof params.active === "boolean" ? params.active : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.surface.role.upsert": async ({ params, respond }) => {
    const surfaceId = typeof params.surfaceId === "string" ? params.surfaceId.trim() : "";
    const role = typeof params.role === "string" ? params.role.trim() : "";
    if (!surfaceId || !role) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "surfaceId and role are required"),
      );
      return;
    }
    respond(
      true,
      upsertRuntimeSurfaceRoleOverlay({
        id: typeof params.id === "string" ? params.id : undefined,
        surfaceId,
        role,
        businessGoal: typeof params.businessGoal === "string" ? params.businessGoal : undefined,
        tone: typeof params.tone === "string" ? params.tone : undefined,
        initiative:
          params.initiative === "low" ||
          params.initiative === "medium" ||
          params.initiative === "high"
            ? params.initiative
            : undefined,
        allowedTopics: Array.isArray(params.allowedTopics)
          ? params.allowedTopics.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        restrictedTopics: Array.isArray(params.restrictedTopics)
          ? params.restrictedTopics.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        reportTarget: typeof params.reportTarget === "string" ? params.reportTarget : undefined,
        localBusinessPolicy: (() => {
          if (
            typeof params.localBusinessPolicy !== "object" ||
            params.localBusinessPolicy === null ||
            Array.isArray(params.localBusinessPolicy)
          ) {
            return undefined;
          }
          const policy = params.localBusinessPolicy as Record<string, unknown>;
          return {
            taskCreation:
              policy.taskCreation === "disabled" || policy.taskCreation === "recommend_only"
                ? policy.taskCreation
                : undefined,
            escalationTarget:
              policy.escalationTarget === "runtime-user" ||
              policy.escalationTarget === "surface-owner"
                ? policy.escalationTarget
                : undefined,
            roleScope: typeof policy.roleScope === "string" ? policy.roleScope : undefined,
          };
        })(),
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.role.optimization.review": async ({ respond }) => {
    respond(true, reviewRuntimeRoleOptimizations(), undefined);
  },
  "runtime.user.model.optimization.review": async ({ respond }) => {
    respond(true, reviewRuntimeUserModelOptimizations(), undefined);
  },
  "runtime.user.console.maintenance.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeUserConsoleMaintenance({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        reviewIntervalHours:
          typeof params.reviewIntervalHours === "number" ? params.reviewIntervalHours : undefined,
      }),
      undefined,
    );
  },
  "runtime.user.console.maintenance.review": async ({ respond }) => {
    respond(true, reviewRuntimeUserConsoleMaintenance(), undefined);
  },
  "runtime.role.optimization.adopt": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, adoptRuntimeRoleOptimizationCandidate(id), undefined);
  },
  "runtime.user.model.optimization.adopt": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = adoptRuntimeUserModelOptimizationCandidate(id);
    respond(
      true,
      {
        ...result,
        mirror: syncRuntimeUserModelMirror(),
      },
      undefined,
    );
  },
  "runtime.role.optimization.reject": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(
      true,
      rejectRuntimeRoleOptimizationCandidate({
        id,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "runtime.user.model.optimization.reject": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(
      true,
      rejectRuntimeUserModelOptimizationCandidate({
        id,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "runtime.memory.invalidate": async ({ params, respond }) => {
    const memoryIds = Array.isArray(params.memoryIds)
      ? params.memoryIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];
    if (memoryIds.length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "memoryIds is required"));
      return;
    }
    respond(
      true,
      applyRuntimeMemoryLineageInvalidation({
        memoryIds,
        reasonEventId:
          typeof params.reasonEventId === "string" && params.reasonEventId.trim().length > 0
            ? params.reasonEventId
            : `runtime-memory-invalidate-${Date.now()}`,
      }),
      undefined,
    );
  },
  "runtime.memory.reinforce": async ({ params, respond }) => {
    const memoryIds = Array.isArray(params.memoryIds)
      ? params.memoryIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];
    if (memoryIds.length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "memoryIds is required"));
      return;
    }
    respond(
      true,
      applyRuntimeMemoryLineageReinforcement({
        memoryIds,
        reason: typeof params.reason === "string" ? params.reason : undefined,
        sourceTaskId: typeof params.sourceTaskId === "string" ? params.sourceTaskId : undefined,
        sourceEventId:
          typeof params.sourceEventId === "string" && params.sourceEventId.trim().length > 0
            ? params.sourceEventId
            : `runtime-memory-reinforce-${Date.now()}`,
        confidenceBoost:
          typeof params.confidenceBoost === "number" ? params.confidenceBoost : undefined,
      }),
      undefined,
    );
  },
  "runtime.memory.review": async ({ respond }) => {
    respond(true, applyRuntimeMemoryLifecycleReview(), undefined);
  },
  "runtime.memory.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeMemoryLifecycle({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        reviewIntervalHours:
          typeof params.reviewIntervalHours === "number" ? params.reviewIntervalHours : undefined,
        decayGraceDays:
          typeof params.decayGraceDays === "number" ? params.decayGraceDays : undefined,
        minDecayIncreasePerReview:
          typeof params.minDecayIncreasePerReview === "number"
            ? params.minDecayIncreasePerReview
            : undefined,
        agePressurePerDay:
          typeof params.agePressurePerDay === "number" ? params.agePressurePerDay : undefined,
        confidencePenaltyDivisor:
          typeof params.confidencePenaltyDivisor === "number"
            ? params.confidencePenaltyDivisor
            : undefined,
        linkedStrategyConfidencePenalty:
          typeof params.linkedStrategyConfidencePenalty === "number"
            ? params.linkedStrategyConfidencePenalty
            : undefined,
        highDecayThreshold:
          typeof params.highDecayThreshold === "number" ? params.highDecayThreshold : undefined,
      }),
      undefined,
    );
  },
  "runtime.memory.rollback": async ({ params, respond }) => {
    const invalidationEventId =
      typeof params.invalidationEventId === "string" ? params.invalidationEventId.trim() : "";
    if (!invalidationEventId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalidationEventId is required"),
      );
      return;
    }
    respond(
      true,
      applyRuntimeMemoryInvalidationRollback({
        invalidationEventId,
      }),
      undefined,
    );
  },
  "runtime.retrieval.status": async ({ respond }) => {
    respond(true, buildRuntimeRetrievalStatus(), undefined);
  },
  "runtime.intel.status": async ({ respond }) => {
    respond(true, buildRuntimeIntelStatus(), undefined);
  },
  "runtime.intel.refresh": async ({ params, respond }) => {
    const domains = Array.isArray(params.domains)
      ? params.domains.filter(isRuntimeInfoDomain)
      : undefined;
    respond(
      true,
      await refreshRuntimeIntelPipeline({
        domains,
        force: params.force === true,
        githubToken: typeof params.githubToken === "string" ? params.githubToken : undefined,
      }),
      undefined,
    );
  },
  "runtime.intel.delivery.dispatch": async ({ respond }) => {
    respond(true, dispatchRuntimeIntelDeliveries(), undefined);
  },
  "runtime.intel.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeIntelPanel({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        digestEnabled: typeof params.digestEnabled === "boolean" ? params.digestEnabled : undefined,
        refreshMinutes:
          typeof params.refreshMinutes === "number" ? params.refreshMinutes : undefined,
        enabledDomainIds: Array.isArray(params.enabledDomainIds)
          ? params.enabledDomainIds.filter(isRuntimeInfoDomain)
          : undefined,
        dailyPushEnabled:
          typeof params.dailyPushEnabled === "boolean" ? params.dailyPushEnabled : undefined,
        dailyPushItemCount:
          typeof params.dailyPushItemCount === "number" ? params.dailyPushItemCount : undefined,
        dailyPushHourLocal:
          typeof params.dailyPushHourLocal === "number" ? params.dailyPushHourLocal : undefined,
        dailyPushMinuteLocal:
          typeof params.dailyPushMinuteLocal === "number" ? params.dailyPushMinuteLocal : undefined,
        instantPushEnabled:
          typeof params.instantPushEnabled === "boolean" ? params.instantPushEnabled : undefined,
        instantPushMinScore:
          typeof params.instantPushMinScore === "number" ? params.instantPushMinScore : undefined,
        dailyPushTargetIds: Array.isArray(params.dailyPushTargetIds)
          ? params.dailyPushTargetIds.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : undefined,
        instantPushTargetIds: Array.isArray(params.instantPushTargetIds)
          ? params.instantPushTargetIds.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : undefined,
        candidateLimitPerDomain:
          typeof params.candidateLimitPerDomain === "number"
            ? params.candidateLimitPerDomain
            : undefined,
        digestItemLimitPerDomain:
          typeof params.digestItemLimitPerDomain === "number"
            ? params.digestItemLimitPerDomain
            : undefined,
        exploitItemsPerDigest:
          typeof params.exploitItemsPerDigest === "number"
            ? params.exploitItemsPerDigest
            : undefined,
        exploreItemsPerDigest:
          typeof params.exploreItemsPerDigest === "number"
            ? params.exploreItemsPerDigest
            : undefined,
        selectedSourceIds: Array.isArray(params.selectedSourceIds)
          ? params.selectedSourceIds.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : undefined,
      }),
      undefined,
    );
  },
  "runtime.intel.source.upsert": async ({ params, respond }) => {
    const label = typeof params.label === "string" ? params.label.trim() : "";
    if (!label) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "label is required"));
      return;
    }
    const domain = normalizeRuntimeInfoDomain(params.domain);
    const kind = params.kind === "github_search" ? "github_search" : "rss";
    if (kind === "rss" && (typeof params.url !== "string" || params.url.trim().length === 0)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "url is required for rss sources"),
      );
      return;
    }
    respond(
      true,
      upsertRuntimeIntelSource({
        id: typeof params.id === "string" ? params.id : undefined,
        domain,
        kind,
        label,
        url: typeof params.url === "string" ? params.url : undefined,
        priority: typeof params.priority === "number" ? params.priority : undefined,
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
      }),
      undefined,
    );
  },
  "runtime.intel.source.delete": async ({ params, respond }) => {
    const sourceId = typeof params.id === "string" ? params.id.trim() : "";
    if (!sourceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, deleteRuntimeIntelSource(sourceId), undefined);
  },
  "runtime.intel.pin": async ({ params, respond }) => {
    const intelId = typeof params.intelId === "string" ? params.intelId.trim() : "";
    if (!intelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "intelId is required"));
      return;
    }
    respond(
      true,
      applyRuntimePinnedIntelKnowledgePromotion({
        intelId,
        promotedBy:
          typeof params.promotedBy === "string" && params.promotedBy.trim().length > 0
            ? params.promotedBy
            : "runtime-user",
        summary: typeof params.summary === "string" ? params.summary : undefined,
        detail: typeof params.detail === "string" ? params.detail : undefined,
        tags: Array.isArray(params.tags)
          ? params.tags.filter((entry): entry is string => typeof entry === "string")
          : undefined,
      }),
      undefined,
    );
  },
  "runtime.capabilities.status": async ({ respond }) => {
    respond(true, buildRuntimeCapabilitiesStatus({ config: loadConfigSafe() }), undefined);
  },
  "runtime.getGovernanceState": async ({ respond }) => {
    respond(true, buildRuntimeCapabilitiesStatus({ config: loadConfigSafe() }), undefined);
  },
  "runtime.capabilities.sync": async ({ respond }) => {
    respond(true, syncRuntimeCapabilityRegistry(loadConfigSafe()), undefined);
  },
  "runtime.capabilities.entry.set": async ({ params, respond }) => {
    if (
      params.registryType !== "agent" &&
      params.registryType !== "skill" &&
      params.registryType !== "mcp"
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "registryType is invalid"));
      return;
    }
    const targetId = typeof params.targetId === "string" ? params.targetId.trim() : "";
    if (!targetId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "targetId is required"));
      return;
    }
    if (
      params.state !== "blocked" &&
      params.state !== "shadow" &&
      params.state !== "candidate" &&
      params.state !== "adopted" &&
      params.state !== "core"
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "state is invalid"));
      return;
    }
    respond(
      true,
      upsertRuntimeCapabilityRegistryEntry({
        id: typeof params.id === "string" ? params.id : undefined,
        registryType: params.registryType,
        targetId,
        state: params.state,
        summary: typeof params.summary === "string" ? params.summary : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "runtime.capabilities.mcp.grant.set": async ({ params, respond }) => {
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    const mcpServerId = typeof params.mcpServerId === "string" ? params.mcpServerId.trim() : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    if (!mcpServerId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "mcpServerId is required"));
      return;
    }
    if (params.state !== "allowed" && params.state !== "denied") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "state is invalid"));
      return;
    }
    respond(
      true,
      upsertRuntimeMcpGrant({
        id: typeof params.id === "string" ? params.id : undefined,
        agentId,
        mcpServerId,
        state: params.state,
        summary: typeof params.summary === "string" ? params.summary : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "runtime.evolution.status": async ({ respond }) => {
    respond(true, buildRuntimeEvolutionStatus(), undefined);
  },
  "runtime.listEvolutionCandidates": async ({ respond }) => {
    respond(true, buildRuntimeEvolutionStatus().candidates, undefined);
  },
  "runtime.getSettings": async ({ respond }) => {
    respond(
      true,
      buildDesktopSettingsSnapshot({
        config: loadDesktopConfigSafe(),
      }),
      undefined,
    );
  },
  "runtime.evolution.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeEvolution({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        autoApplyLowRisk:
          typeof params.autoApplyLowRisk === "boolean" ? params.autoApplyLowRisk : undefined,
        autoCanaryEvolution:
          typeof params.autoCanaryEvolution === "boolean" ? params.autoCanaryEvolution : undefined,
        reviewIntervalHours:
          typeof params.reviewIntervalHours === "number" ? params.reviewIntervalHours : undefined,
      }),
      undefined,
    );
  },
  "runtime.evolution.run": async ({ respond }) => {
    respond(
      true,
      {
        review: reviewRuntimeEvolution(),
        status: buildRuntimeEvolutionStatus(),
      },
      undefined,
    );
  },
  "runtime.evolution.candidate.set": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    if (params.state !== "candidate" && params.state !== "adopted" && params.state !== "reverted") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "state is invalid"));
      return;
    }
    respond(
      true,
      {
        transition: setRuntimeEvolutionCandidateState({
          id,
          state: params.state,
          reason: typeof params.reason === "string" ? params.reason : undefined,
        }),
        status: buildRuntimeEvolutionStatus(),
      },
      undefined,
    );
  },
  "runtime.evolution.adopt": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      respond(
        true,
        {
          transition: setRuntimeEvolutionCandidateState({
            id,
            state: "adopted",
            reason: typeof params.reason === "string" ? params.reason : undefined,
          }),
          status: buildRuntimeEvolutionStatus(),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "runtime.evolution.reject": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      respond(
        true,
        {
          transition: setRuntimeEvolutionCandidateState({
            id,
            state: "reverted",
            reason:
              typeof params.reason === "string" && params.reason.trim().length > 0
                ? params.reason
                : "Rejected in desktop console",
          }),
          status: buildRuntimeEvolutionStatus(),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "runtime.evolution.revert": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      respond(
        true,
        {
          transition: setRuntimeEvolutionCandidateState({
            id,
            state: "reverted",
            reason: typeof params.reason === "string" ? params.reason : undefined,
          }),
          status: buildRuntimeEvolutionStatus(),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "runtime.evolution.candidate.verification.ack": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(
      true,
      {
        acknowledgement: acknowledgeRuntimeEvolutionVerification({
          id,
          note: typeof params.note === "string" ? params.note : undefined,
        }),
        status: buildRuntimeEvolutionStatus(),
      },
      undefined,
    );
  },
  "runtime.import.preview": async ({ respond }) => {
    respond(
      true,
      buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }).importPreview,
      undefined,
    );
  },
  "runtime.import.apply": async ({ respond }) => {
    respond(true, applyLegacyRuntimeImport({ config: loadConfigSafe() }), undefined);
  },
  "federation.outbox.sync": async ({ respond }) => {
    respond(true, syncRuntimeFederationOutbox({ config: loadConfigSafe() }), undefined);
  },
  "runtime.getFederationState": async ({ respond }) => {
    respond(true, buildFederationRuntimeSnapshot({ config: loadConfigSafe() }), undefined);
  },
  "runtime.federation.sync": async ({ respond }) => {
    respond(
      true,
      await syncRuntimeFederationRemote({ config: loadConfigSafe(), trigger: "manual" }),
      undefined,
    );
  },
  "federation.remote.sync": async ({ respond }) => {
    respond(
      true,
      await syncRuntimeFederationRemote({ config: loadConfigSafe(), trigger: "manual" }),
      undefined,
    );
  },
  "federation.remote.preview": async ({ respond }) => {
    respond(true, previewRuntimeFederationRemote({ config: loadConfigSafe() }), undefined);
  },
  "federation.remote.maintenance.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeFederationRemoteSyncMaintenance({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        syncIntervalMinutes:
          typeof params.syncIntervalMinutes === "number" ? params.syncIntervalMinutes : undefined,
        retryAfterFailureMinutes:
          typeof params.retryAfterFailureMinutes === "number"
            ? params.retryAfterFailureMinutes
            : undefined,
      }),
      undefined,
    );
  },
  "federation.inbox.sync": async ({ respond }) => {
    respond(true, syncRuntimeFederationInbox(), undefined);
  },
  "federation.inbox.list": async ({ respond }) => {
    respond(true, listRuntimeFederationInbox(), undefined);
  },
  "federation.inbox.maintenance.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeFederationInboxMaintenance({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        reviewIntervalHours:
          typeof params.reviewIntervalHours === "number" ? params.reviewIntervalHours : undefined,
        expireReceivedAfterHours:
          typeof params.expireReceivedAfterHours === "number"
            ? params.expireReceivedAfterHours
            : undefined,
        expireValidatedAfterHours:
          typeof params.expireValidatedAfterHours === "number"
            ? params.expireValidatedAfterHours
            : undefined,
        expireShadowedAfterHours:
          typeof params.expireShadowedAfterHours === "number"
            ? params.expireShadowedAfterHours
            : undefined,
        expireRecommendedAfterHours:
          typeof params.expireRecommendedAfterHours === "number"
            ? params.expireRecommendedAfterHours
            : undefined,
      }),
      undefined,
    );
  },
  "federation.inbox.maintenance.review": async ({ respond }) => {
    respond(true, reviewRuntimeFederationInboxMaintenance(), undefined);
  },
  "federation.push.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeFederationPushPolicy({
        allowedPushScopes: Array.isArray(params.allowedPushScopes)
          ? params.allowedPushScopes
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
          : undefined,
      }),
      undefined,
    );
  },
  "runtime.tick": async ({ respond }) => {
    respond(true, await tickRuntimeTaskLoop({ config: loadConfigSafe() }), undefined);
  },
  "runtime.task.plan": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    respond(true, planRuntimeTask(taskId), undefined);
  },
  "runtime.task.waiting_user.respond": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const responseText = typeof params.response === "string" ? params.response.trim() : "";
    if (!taskId || !responseText) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskId and response are required"),
      );
      return;
    }
    respond(
      true,
      respondRuntimeWaitingUserTask({
        taskId,
        response: responseText,
        respondedBy: typeof params.respondedBy === "string" ? params.respondedBy : undefined,
        nextAction: typeof params.nextAction === "string" ? params.nextAction : undefined,
      }),
      undefined,
    );
  },
  "runtime.task.retry": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    try {
      const detail = buildRuntimeTaskDetailSnapshot(taskId);
      respond(
        true,
        upsertRuntimeTask({
          id: taskId,
          status: "queued",
          nextRunAt: Date.now(),
          blockedReason: "",
          lastError: "",
          nextAction:
            typeof params.nextAction === "string" && params.nextAction.trim().length > 0
              ? params.nextAction
              : detail.task.nextAction,
          metadata: {
            ...detail.task.metadata,
            manualRetryRequestedAt: Date.now(),
            manualRetryRequestedBy:
              typeof params.requestedBy === "string" ? params.requestedBy : "desktop-console",
          },
        }),
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "runtime.task.cancel": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    respond(
      true,
      applyRuntimeTaskResult({
        taskId,
        status: "cancelled",
        summary:
          typeof params.summary === "string" && params.summary.trim().length > 0
            ? params.summary
            : "Cancelled from desktop console",
      }),
      undefined,
    );
  },
  "runtime.task.upsert": async ({ params, respond }) => {
    respond(
      true,
      upsertRuntimeTask({
        id: typeof params.id === "string" ? params.id : undefined,
        rootTaskId: typeof params.rootTaskId === "string" ? params.rootTaskId : undefined,
        parentTaskId: typeof params.parentTaskId === "string" ? params.parentTaskId : undefined,
        ...(typeof params.agentId === "string" || params.agentId === null
          ? {
              agentId: typeof params.agentId === "string" ? params.agentId : null,
            }
          : {}),
        ...(typeof params.surfaceId === "string" || params.surfaceId === null
          ? {
              surfaceId: typeof params.surfaceId === "string" ? params.surfaceId : null,
            }
          : {}),
        ...(typeof params.sessionId === "string" || params.sessionId === null
          ? {
              sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
            }
          : {}),
        title: typeof params.title === "string" ? params.title : undefined,
        route: typeof params.route === "string" ? params.route : undefined,
        status: typeof params.status === "string" ? params.status : undefined,
        priority: typeof params.priority === "string" ? params.priority : undefined,
        budgetMode: typeof params.budgetMode === "string" ? params.budgetMode : undefined,
        retrievalMode: typeof params.retrievalMode === "string" ? params.retrievalMode : undefined,
        goal: typeof params.goal === "string" ? params.goal : undefined,
        successCriteria:
          typeof params.successCriteria === "string" ? params.successCriteria : undefined,
        tags: Array.isArray(params.tags)
          ? params.tags.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        worker: typeof params.worker === "string" ? params.worker : undefined,
        skillIds: Array.isArray(params.skillIds)
          ? params.skillIds.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        memoryRefs: Array.isArray(params.memoryRefs)
          ? params.memoryRefs.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        artifactRefs: Array.isArray(params.artifactRefs)
          ? params.artifactRefs.filter((entry): entry is string => typeof entry === "string")
          : Array.isArray(params.intelRefs)
            ? params.intelRefs.filter((entry): entry is string => typeof entry === "string")
            : undefined,
        recurring: typeof params.recurring === "boolean" ? params.recurring : undefined,
        maintenance: typeof params.maintenance === "boolean" ? params.maintenance : undefined,
        scheduleIntervalMinutes:
          typeof params.scheduleIntervalMinutes === "number"
            ? params.scheduleIntervalMinutes
            : undefined,
        planSummary: typeof params.planSummary === "string" ? params.planSummary : undefined,
        nextAction: typeof params.nextAction === "string" ? params.nextAction : undefined,
        blockedReason: typeof params.blockedReason === "string" ? params.blockedReason : undefined,
        lastError: typeof params.lastError === "string" ? params.lastError : undefined,
        reportPolicy: typeof params.reportPolicy === "string" ? params.reportPolicy : undefined,
        nextRunAt: typeof params.nextRunAt === "number" ? params.nextRunAt : undefined,
        metadata:
          typeof params.metadata === "object" &&
          params.metadata !== null &&
          !Array.isArray(params.metadata)
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      }),
      undefined,
    );
  },
  "runtime.task.result.apply": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const status = typeof params.status === "string" ? params.status.trim() : "";
    if (!taskId || !status) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskId and status are required"),
      );
      return;
    }
    respond(
      true,
      applyRuntimeTaskResult({
        taskId,
        status,
        summary: typeof params.summary === "string" ? params.summary : undefined,
        lastResult: typeof params.lastResult === "string" ? params.lastResult : undefined,
        lastError: typeof params.lastError === "string" ? params.lastError : undefined,
        blockedReason: typeof params.blockedReason === "string" ? params.blockedReason : undefined,
        needsUser: typeof params.needsUser === "string" ? params.needsUser : undefined,
        nextRunInMinutes:
          typeof params.nextRunInMinutes === "number" ? params.nextRunInMinutes : undefined,
        planSummary: typeof params.planSummary === "string" ? params.planSummary : undefined,
        nextAction: typeof params.nextAction === "string" ? params.nextAction : undefined,
        workerOutput: typeof params.workerOutput === "string" ? params.workerOutput : undefined,
        cliExitCode: typeof params.cliExitCode === "number" ? params.cliExitCode : undefined,
      }),
      undefined,
    );
  },
  "runtime.intel.pipeline.run": async ({ params, respond }) => {
    const candidates = Array.isArray(params.candidates) ? params.candidates : [];
    respond(
      true,
      runRuntimeIntelPipeline(
        candidates
          .filter(
            (entry): entry is Record<string, unknown> =>
              typeof entry === "object" && entry !== null && !Array.isArray(entry),
          )
          .map((entry) => ({
            id: typeof entry.id === "string" ? entry.id : undefined,
            domain: typeof entry.domain === "string" ? entry.domain : "tech",
            sourceId: typeof entry.sourceId === "string" ? entry.sourceId : "unknown-source",
            title: typeof entry.title === "string" ? entry.title : "Untitled intel",
            url: typeof entry.url === "string" ? entry.url : undefined,
            summary: typeof entry.summary === "string" ? entry.summary : undefined,
            score: typeof entry.score === "number" ? entry.score : undefined,
            createdAt: typeof entry.createdAt === "number" ? entry.createdAt : undefined,
            metadata:
              typeof entry.metadata === "object" &&
              entry.metadata !== null &&
              !Array.isArray(entry.metadata)
                ? (entry.metadata as Record<string, unknown>)
                : undefined,
          })),
      ),
      undefined,
    );
  },
  "federation.package.transition": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    if (
      params.state !== "received" &&
      params.state !== "validated" &&
      params.state !== "shadowed" &&
      params.state !== "recommended" &&
      params.state !== "adopted" &&
      params.state !== "rejected" &&
      params.state !== "expired" &&
      params.state !== "reverted"
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "state is invalid"));
      return;
    }
    respond(
      true,
      transitionRuntimeFederationPackage({
        id,
        state: params.state,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "federation.coordinator-suggestion.materialize": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, materializeRuntimeCoordinatorSuggestionTask(id), undefined);
  },
  "federation.assignment.transition": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    if (params.state !== "pending" && params.state !== "blocked" && params.state !== "applied") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "state is invalid"));
      return;
    }
    respond(
      true,
      transitionRuntimeFederationAssignment({
        id,
        state: params.state,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      }),
      undefined,
    );
  },
  "federation.assignment.materialize": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, materializeRuntimeFederationAssignmentTask(id), undefined);
  },
  "federation.status": async ({ respond }) => {
    const config = loadConfigSafe();
    syncRuntimeFederationInbox();
    const dashboard = buildRuntimeDashboardSnapshot({ config });
    respond(
      true,
      buildFederationRuntimeSnapshot({
        config,
        runtimeManifest: dashboard.runtimeManifest,
      }),
      undefined,
    );
  },
};
