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
import { syncRuntimeCapabilityRegistry } from "./shared/runtime/capability-plane.js";
import {
  buildDecisionRecord,
  buildDecisionPromptBlock,
  buildDecisionRetrievalQuery,
  buildFallbackOrder,
  buildLocalFirstPlan,
  buildRemoteModelPlan,
  shouldUseSystem2,
} from "./shared/runtime/decision-core.js";
import {
  listRuntimeFederationInbox,
  syncRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
} from "./shared/runtime/federation-inbox.js";
import { syncRuntimeFederationOutbox } from "./shared/runtime/federation-outbox.js";
import { syncRuntimeFederationRemote } from "./shared/runtime/federation-sync.js";
import { runRuntimeIntelPipeline } from "./shared/runtime/intel-pipeline.js";
import { refreshRuntimeIntelPipeline } from "./shared/runtime/intel-refresh.js";
import {
  distillTaskOutcomeToMemory,
  invalidateMemoryLineage,
  materializeAdoptedEvolutionStrategies,
  maybeAutoApplyLowRiskEvolution,
  observeTaskOutcomeForEvolution,
  persistTaskLifecycleArtifacts,
  reviewRuntimeEvolution,
} from "./shared/runtime/mutations.js";
import { buildContextPack, buildRouteDomains } from "./shared/runtime/retrieval-orchestrator.js";
import {
  applyLegacyRuntimeImport,
  buildFederationRuntimeSnapshot,
  buildGovernanceSnapshotMetadata,
  buildLatestNewsDigestEnvelope,
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
  appendRuntimeEvent,
  buildRuntimeRetrievalSourceSet,
  hasAuthoritativeRuntimeStore,
  loadRuntimeFederationStore,
  loadRuntimeGovernanceStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeStoreBundle,
  loadRuntimeTaskStore,
  readRuntimeEvents,
  resolveRuntimeStorePaths,
  saveRuntimeGovernanceStore,
  saveRuntimeFederationStore,
  saveRuntimeIntelStore,
  saveRuntimeMemoryStore,
  saveRuntimeStoreBundle,
  saveRuntimeTaskStore,
} from "./shared/runtime/store.js";
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
  applyRuntimeTaskResult,
  planRuntimeTask,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
} from "./shared/runtime/task-engine.js";
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
  refreshRuntimeIntelPipeline,
  syncRuntimeFederationOutbox,
  syncRuntimeFederationRemote,
  syncRuntimeFederationInbox,
  listRuntimeFederationInbox,
  transitionRuntimeFederationPackage,
  runRuntimeIntelPipeline,
  syncRuntimeCapabilityRegistry,
  buildRuntimeRetrievalSourceSet,
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
  buildLatestNewsDigestEnvelope,
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
  hasAuthoritativeRuntimeStore,
  isRunnableTaskStatus,
  isTerminalTaskStatus,
  invalidateMemoryLineage,
  loadConfig,
  loadRuntimeGovernanceStore,
  loadRuntimeFederationStore,
  loadRuntimeIntelStore,
  loadRuntimeMemoryStore,
  loadRuntimeStoreBundle,
  loadRuntimeTaskStore,
  loadSessionStore,
  materializeAdoptedEvolutionStrategies,
  maybeAutoApplyLowRiskEvolution,
  monitorWebChannel,
  normalizeOptionalTaskStatus,
  normalizeTaskStatus,
  normalizeE164,
  observeTaskOutcomeForEvolution,
  planRuntimeTask,
  PortInUseError,
  persistTaskLifecycleArtifacts,
  promptYesNo,
  appendRuntimeEvent,
  applyRuntimeTaskResult,
  distillTaskOutcomeToMemory,
  readRuntimeEvents,
  reviewRuntimeEvolution,
  resolveInstanceManifest,
  resolvePathResolver,
  resolveRuntimeStorePaths,
  resolveSessionKey,
  resolveStorePath,
  runCommandWithTimeout,
  runExec,
  saveRuntimeGovernanceStore,
  saveRuntimeFederationStore,
  saveRuntimeIntelStore,
  saveRuntimeMemoryStore,
  saveRuntimeStoreBundle,
  saveRuntimeTaskStore,
  saveSessionStore,
  buildShareableReviewEnvelope,
  shouldTaskRun,
  shouldUseSystem2,
  tickRuntimeTaskLoop,
  upsertRuntimeTask,
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
  FederationInboxRecord,
  FederationInboundPackage,
  FederationPackageState,
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
  RuntimeFederationStore,
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
  FederationInboxStatus,
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
