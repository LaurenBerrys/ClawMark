import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  applyRuntimeTaskResult,
  planRuntimeTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "../../shared/runtime/task-engine.js";
import { syncRuntimeCapabilityRegistry } from "../../shared/runtime/capability-plane.js";
import { syncRuntimeFederationOutbox } from "../../shared/runtime/federation-outbox.js";
import { refreshRuntimeIntelPipeline } from "../../shared/runtime/intel-refresh.js";
import { runRuntimeIntelPipeline } from "../../shared/runtime/intel-pipeline.js";
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
import type { GatewayRequestHandlers } from "./types.js";

function loadConfigSafe(): Record<string, unknown> | null {
  try {
    return loadConfig() as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
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
  "runtime.memory.invalidate": async ({ params, respond }) => {
    const memoryIds = Array.isArray(params.memoryIds)
      ? params.memoryIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
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
        retrievalMode:
          typeof params.retrievalMode === "string" ? params.retrievalMode : undefined,
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
        intelRefs: Array.isArray(params.intelRefs)
          ? params.intelRefs.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        recurring: typeof params.recurring === "boolean" ? params.recurring : undefined,
        maintenance: typeof params.maintenance === "boolean" ? params.maintenance : undefined,
        planSummary: typeof params.planSummary === "string" ? params.planSummary : undefined,
        nextAction: typeof params.nextAction === "string" ? params.nextAction : undefined,
        blockedReason:
          typeof params.blockedReason === "string" ? params.blockedReason : undefined,
        lastError: typeof params.lastError === "string" ? params.lastError : undefined,
        reportPolicy:
          typeof params.reportPolicy === "string" ? params.reportPolicy : undefined,
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
        blockedReason:
          typeof params.blockedReason === "string" ? params.blockedReason : undefined,
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
  "federation.status": async ({ respond }) => {
    const config = loadConfigSafe();
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
