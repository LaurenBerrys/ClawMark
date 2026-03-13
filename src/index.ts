#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getReplyFromConfig } from "./auto-reply/reply.js";
import { applyTemplate } from "./auto-reply/templating.js";
import { monitorWebChannel } from "./channel-web.js";
import { createDefaultDeps } from "./cli/deps.js";
import { promptYesNo } from "./cli/prompt.js";
import { waitForever } from "./cli/wait.js";
import { loadConfig } from "./config/config.js";
import {
  deriveSessionKey,
  loadSessionStore,
  resolveSessionKey,
  resolveStorePath,
  saveSessionStore,
} from "./config/sessions.js";
import { ensureBinary } from "./infra/binaries.js";
import { loadDotEnv } from "./infra/dotenv.js";
import { normalizeEnv } from "./infra/env.js";
import { formatUncaughtError } from "./infra/errors.js";
import { isMainModule } from "./infra/is-main.js";
import { ensureOpenClawCliOnPath } from "./infra/path-env.js";
import {
  describePortOwner,
  ensurePortAvailable,
  handlePortError,
  PortInUseError,
} from "./infra/ports.js";
import { assertSupportedRuntime } from "./infra/runtime-guard.js";
import { installUnhandledRejectionHandler } from "./infra/unhandled-rejections.js";
import { resolveInstanceManifest, resolvePathResolver } from "./instance/paths.js";
import { enableConsoleCapture } from "./logging.js";
import { runCommandWithTimeout, runExec } from "./process/exec.js";
import {
  buildDecisionRecord,
  buildDecisionPromptBlock,
  buildDecisionRetrievalQuery,
  buildFallbackOrder,
  buildLocalFirstPlan,
  buildRemoteModelPlan,
  shouldUseSystem2,
} from "./shared/runtime/decision-core.js";
import { buildContextPack, buildRouteDomains } from "./shared/runtime/retrieval-orchestrator.js";
import {
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildGovernanceSnapshotMetadata,
  buildLatestIntelDigestEnvelope,
  buildLatestStrategyDigestEnvelope,
  buildLegacyRuntimeImportPreview,
  buildRuntimeCapabilitiesStatus,
  buildRuntimeDashboardSnapshot,
  buildRuntimeEvolutionStatus,
  buildRuntimeIntelStatus,
  buildRuntimeMemoryList,
  buildRuntimeRetrievalStatus,
  buildRuntimeTasksList,
} from "./shared/runtime/runtime-dashboard.js";
import {
  buildShareableReviewEnvelope,
  buildTaskLifecycleArtifacts,
  buildTaskRecordSnapshot,
  buildTaskReviewOutcome,
  buildTaskReviewRecord,
  buildTaskRunSnapshot,
  buildTaskStepSnapshot,
  buildTaskTransitionStep,
} from "./shared/runtime/task-artifacts.js";
import {
  buildTaskStatusCounts,
  compareTaskQueueOrder,
  getTaskStatusAliases,
  isRunnableTaskStatus,
  isTerminalTaskStatus,
  normalizeOptionalTaskStatus,
  normalizeTaskStatus,
  shouldTaskRun,
} from "./shared/runtime/task-loop.js";
import { assertWebChannel, normalizeE164, toWhatsappJid } from "./utils.js";

loadDotEnv({ quiet: true });
normalizeEnv();
ensureOpenClawCliOnPath();

// Capture all console output into structured logs while keeping stdout/stderr behavior.
enableConsoleCapture();

// Enforce the minimum supported runtime before doing any work.
assertSupportedRuntime();

import { buildProgram } from "./cli/program.js";

const program = buildProgram();

export {
  assertWebChannel,
  applyTemplate,
  buildContextPack,
  buildDecisionRecord,
  buildDecisionPromptBlock,
  buildDecisionRetrievalQuery,
  buildFallbackOrder,
  buildLocalFirstPlan,
  buildRemoteModelPlan,
  buildRouteDomains,
  buildTaskStatusCounts,
  buildTaskLifecycleArtifacts,
  buildTaskRecordSnapshot,
  buildTaskReviewOutcome,
  buildTaskReviewRecord,
  buildTaskRunSnapshot,
  buildTaskStepSnapshot,
  buildTaskTransitionStep,
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildGovernanceSnapshotMetadata,
  buildLatestIntelDigestEnvelope,
  buildLatestStrategyDigestEnvelope,
  buildLegacyRuntimeImportPreview,
  buildRuntimeCapabilitiesStatus,
  buildRuntimeDashboardSnapshot,
  buildRuntimeEvolutionStatus,
  buildRuntimeIntelStatus,
  buildRuntimeMemoryList,
  buildRuntimeRetrievalStatus,
  buildRuntimeTasksList,
  compareTaskQueueOrder,
  createDefaultDeps,
  deriveSessionKey,
  describePortOwner,
  ensureBinary,
  ensurePortAvailable,
  getReplyFromConfig,
  handlePortError,
  getTaskStatusAliases,
  isRunnableTaskStatus,
  isTerminalTaskStatus,
  loadConfig,
  loadSessionStore,
  monitorWebChannel,
  normalizeOptionalTaskStatus,
  normalizeTaskStatus,
  normalizeE164,
  PortInUseError,
  promptYesNo,
  resolveInstanceManifest,
  resolvePathResolver,
  resolveSessionKey,
  resolveStorePath,
  runCommandWithTimeout,
  runExec,
  saveSessionStore,
  buildShareableReviewEnvelope,
  shouldTaskRun,
  shouldUseSystem2,
  toWhatsappJid,
  waitForever,
};

export type {
  BudgetMode,
  DecisionBudget,
  DecisionConfig,
  DecisionRecord,
  DecisionTaskInput,
  CapabilityGovernanceSnapshot,
  ContextPack,
  GovernanceRegistryEntry,
  InstanceManifest,
  IntelCandidate,
  IntelDigestEnvelope,
  IntelDigestItem,
  IntelSourceProfile,
  IntelTopicProfile,
  IntelUsefulnessRecord,
  ManualPinnedIntelRecord,
  MemoryRecord,
  MetaLearningRecord,
  PathResolver,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalMode,
  RetrievalSourceSet,
  RuntimeManifest,
  ShadowEvaluationRecord,
  ShadowTelemetryEnvelope,
  ShareableMemoryEnvelope,
  ShareableReviewRecord,
  StrategyDigestEnvelope,
  StrategyRecord,
  TaskRecord,
  TaskPriority,
  TaskReview,
  TaskRun,
  TaskStatus,
  TaskStep,
} from "./shared/runtime/contracts.js";

export type {
  ShareableReviewEnvelopeInput,
  TaskLifecycleArtifacts,
  TaskLifecycleArtifactsInput,
  TaskRecordSnapshotInput,
  TaskReviewInput,
  TaskRunSnapshotInput,
  TaskStepSnapshotInput,
  TaskStepKind,
  TaskStepStatus,
  TaskTransitionStepInput,
} from "./shared/runtime/task-artifacts.js";

export type { TaskQueueInput, TaskStatusCounts } from "./shared/runtime/task-loop.js";

export type {
  CapabilityPolicyPreset,
  FederationRuntimeSnapshot,
  LegacyRuntimeImportApplyResult,
  LegacyRuntimeImportReport,
  RuntimeCapabilitiesStatus,
  RuntimeDashboardSnapshot,
  RuntimeEvolutionStatus,
  RuntimeImportPlan,
  RuntimeIntelStatus,
  RuntimeMemoryListResult,
  RuntimeMemorySummary,
  RuntimeRetrievalStatus,
  RuntimeTaskSummary,
  RuntimeTasksListResult,
} from "./shared/runtime/runtime-dashboard.js";

const isMain = isMainModule({
  currentFile: fileURLToPath(import.meta.url),
});

if (isMain) {
  // Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
  // These log the error and exit gracefully instead of crashing without trace.
  installUnhandledRejectionHandler();

  process.on("uncaughtException", (error) => {
    console.error("[openclaw] Uncaught exception:", formatUncaughtError(error));
    process.exit(1);
  });

  void program.parseAsync(process.argv).catch((err) => {
    console.error("[openclaw] CLI failed:", formatUncaughtError(err));
    process.exit(1);
  });
}
