import { loadConfig } from "../../config/config.js";
import { syncRuntimeCapabilityRegistry } from "../../shared/runtime/capability-plane.js";
import {
  listRuntimeFederationInbox,
  syncRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
} from "../../shared/runtime/federation-inbox.js";
import { syncRuntimeFederationOutbox } from "../../shared/runtime/federation-outbox.js";
import { syncRuntimeFederationRemote } from "../../shared/runtime/federation-sync.js";
import { runRuntimeIntelPipeline } from "../../shared/runtime/intel-pipeline.js";
import {
  configureRuntimeIntelPanel,
  refreshRuntimeIntelPipeline,
} from "../../shared/runtime/intel-refresh.js";
import { invalidateMemoryLineage, reviewRuntimeEvolution } from "../../shared/runtime/mutations.js";
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
  planRuntimeTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "../../shared/runtime/task-engine.js";
import {
  deleteRuntimeAgent,
  getRuntimeUserModel,
  listRuntimeAgents,
  listRuntimeSurfaces,
  updateRuntimeUserModel,
  upsertRuntimeAgent,
  upsertRuntimeSurface,
  upsertRuntimeSurfaceRoleOverlay,
} from "../../shared/runtime/user-console.js";
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

export const runtimeHandlers: GatewayRequestHandlers = {
  "runtime.snapshot": async ({ respond }) => {
    respond(true, buildRuntimeDashboardSnapshot({ config: loadConfigSafe() }), undefined);
  },
  "runtime.tasks.list": async ({ respond }) => {
    respond(true, buildRuntimeTasksList(), undefined);
  },
  "runtime.memory.list": async ({ respond }) => {
    respond(true, buildRuntimeMemoryList(), undefined);
  },
  "runtime.user.get": async ({ respond }) => {
    respond(true, getRuntimeUserModel(), undefined);
  },
  "runtime.user.update": async ({ params, respond }) => {
    respond(
      true,
      updateRuntimeUserModel({
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
        localBusinessPolicy:
          typeof params.localBusinessPolicy === "object" &&
          params.localBusinessPolicy !== null &&
          !Array.isArray(params.localBusinessPolicy)
            ? (params.localBusinessPolicy as Record<string, unknown>)
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
      invalidateMemoryLineage({
        memoryIds,
        reasonEventId:
          typeof params.reasonEventId === "string" && params.reasonEventId.trim().length > 0
            ? params.reasonEventId
            : `runtime-memory-invalidate-${Date.now()}`,
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
      ? params.domains.filter(
          (entry): entry is "tech" | "ai" | "business" | "github" =>
            entry === "tech" || entry === "ai" || entry === "business" || entry === "github",
        )
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
  "runtime.intel.configure": async ({ params, respond }) => {
    respond(
      true,
      configureRuntimeIntelPanel({
        enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
        refreshMinutes:
          typeof params.refreshMinutes === "number" ? params.refreshMinutes : undefined,
        dailyPushEnabled:
          typeof params.dailyPushEnabled === "boolean" ? params.dailyPushEnabled : undefined,
        dailyPushItemCount:
          typeof params.dailyPushItemCount === "number" ? params.dailyPushItemCount : undefined,
        dailyPushHourLocal:
          typeof params.dailyPushHourLocal === "number" ? params.dailyPushHourLocal : undefined,
        dailyPushMinuteLocal:
          typeof params.dailyPushMinuteLocal === "number" ? params.dailyPushMinuteLocal : undefined,
        selectedSourceIds: Array.isArray(params.selectedSourceIds)
          ? params.selectedSourceIds.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
            )
          : undefined,
      }),
      undefined,
    );
  },
  "runtime.capabilities.status": async ({ respond }) => {
    respond(true, buildRuntimeCapabilitiesStatus({ config: loadConfigSafe() }), undefined);
  },
  "runtime.capabilities.sync": async ({ respond }) => {
    respond(true, syncRuntimeCapabilityRegistry(loadConfigSafe()), undefined);
  },
  "runtime.evolution.status": async ({ respond }) => {
    respond(true, buildRuntimeEvolutionStatus(), undefined);
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
  "federation.remote.sync": async ({ respond }) => {
    respond(true, await syncRuntimeFederationRemote({ config: loadConfigSafe() }), undefined);
  },
  "federation.inbox.sync": async ({ respond }) => {
    respond(true, syncRuntimeFederationInbox(), undefined);
  },
  "federation.inbox.list": async ({ respond }) => {
    respond(true, listRuntimeFederationInbox(), undefined);
  },
  "runtime.tick": async ({ respond }) => {
    respond(true, tickRuntimeTaskLoop(), undefined);
  },
  "runtime.task.plan": async ({ params, respond }) => {
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    respond(true, planRuntimeTask(taskId), undefined);
  },
  "runtime.task.upsert": async ({ params, respond }) => {
    respond(
      true,
      upsertRuntimeTask({
        id: typeof params.id === "string" ? params.id : undefined,
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
