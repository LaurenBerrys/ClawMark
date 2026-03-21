import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  FederationRemoteSyncPreview,
  FederationRuntimeSnapshot,
  LegacyRuntimeImportApplyResult,
  LegacyRuntimeImportReport,
  RuntimeDashboardSnapshot,
  RuntimeUserConsoleStore,
} from "../types.ts";

export type RuntimeReportPolicy = "silent" | "reply" | "proactive" | "reply_and_proactive";
export type RuntimeInterruptionThreshold = "low" | "medium" | "high";
export type RuntimeReportVerbosity = "brief" | "balanced" | "detailed";
export type RuntimeConfirmationBoundary = "strict" | "balanced" | "light";
export type RuntimeSurfaceInitiative = "low" | "medium" | "high";
export type RuntimeSurfaceTaskCreation = "disabled" | "recommend_only";
export type RuntimeSurfaceEscalationTarget = "runtime-user" | "surface-owner";

export type RuntimeUserModelInput = {
  displayName?: string;
  communicationStyle?: string;
  interruptionThreshold?: RuntimeInterruptionThreshold;
  reportVerbosity?: RuntimeReportVerbosity;
  confirmationBoundary?: RuntimeConfirmationBoundary;
  reportPolicy?: RuntimeReportPolicy;
};

export type RuntimeSessionPreferenceInput = {
  id?: string;
  sessionId: string;
  label?: string;
  communicationStyle?: string;
  interruptionThreshold?: RuntimeInterruptionThreshold;
  reportVerbosity?: RuntimeReportVerbosity;
  confirmationBoundary?: RuntimeConfirmationBoundary;
  reportPolicy?: RuntimeReportPolicy;
  notes?: string;
  expiresAt?: number | null;
};

export type RuntimeAgentInput = {
  id?: string;
  name: string;
  description?: string;
  roleBase?: string;
  memoryNamespace?: string;
  skillIds?: string[];
  active?: boolean;
  overlay?: {
    communicationStyle?: string;
    reportPolicy?: RuntimeReportPolicy;
    notes?: string;
  };
};

export type RuntimeSurfaceInput = {
  id?: string;
  channel: string;
  accountId: string;
  label: string;
  ownerKind: "user" | "agent";
  ownerId?: string;
  active?: boolean;
};

export type RuntimeSurfaceRoleInput = {
  id?: string;
  surfaceId: string;
  role: string;
  businessGoal?: string;
  tone?: string;
  initiative?: RuntimeSurfaceInitiative;
  allowedTopics?: string[];
  restrictedTopics?: string[];
  reportTarget?: string;
  localBusinessPolicy?: {
    taskCreation?: RuntimeSurfaceTaskCreation;
    escalationTarget?: RuntimeSurfaceEscalationTarget;
    roleScope?: string;
  };
};

export type RuntimeRoleOptimizationRejectInput = {
  id: string;
  reason?: string;
};

export type RuntimeUserModelOptimizationRejectInput = {
  id: string;
  reason?: string;
};

export type RuntimeUserConsoleMaintenanceConfigureInput = {
  enabled?: boolean;
  reviewIntervalHours?: number;
};

export type RuntimeCapabilityRegistryEntryInput = {
  id?: string;
  registryType: "agent" | "skill" | "mcp";
  targetId: string;
  state: "blocked" | "shadow" | "candidate" | "adopted" | "core";
  summary?: string;
  reason?: string;
};

export type RuntimeCapabilityMcpGrantInput = {
  id?: string;
  agentId: string;
  mcpServerId: string;
  state: "allowed" | "denied";
  summary?: string;
  reason?: string;
};

export type RuntimeIntelConfigureInput = {
  enabled?: boolean;
  digestEnabled?: boolean;
  refreshMinutes?: number;
  enabledDomainIds?: Array<"military" | "tech" | "ai" | "business">;
  dailyPushEnabled?: boolean;
  dailyPushItemCount?: number;
  dailyPushHourLocal?: number;
  dailyPushMinuteLocal?: number;
  instantPushEnabled?: boolean;
  instantPushMinScore?: number;
  dailyPushTargetIds?: string[];
  instantPushTargetIds?: string[];
  candidateLimitPerDomain?: number;
  digestItemLimitPerDomain?: number;
  exploitItemsPerDigest?: number;
  exploreItemsPerDigest?: number;
  selectedSourceIds?: string[];
};

export type RuntimeIntelSourceInput = {
  id?: string;
  domain: "military" | "tech" | "ai" | "business";
  kind: "rss" | "github_search";
  label: string;
  url?: string;
  priority?: number;
  enabled?: boolean;
};

export type RuntimeEvolutionConfigureInput = {
  enabled?: boolean;
  autoApplyLowRisk?: boolean;
  autoCanaryEvolution?: boolean;
  reviewIntervalHours?: number;
};

export type RuntimeEvolutionCandidateStateInput = {
  id: string;
  state: "candidate" | "adopted" | "reverted";
  reason?: string;
};

export type RuntimeEvolutionVerificationAcknowledgeInput = {
  id: string;
  note?: string;
};

export type RuntimeTaskLoopConfigureInput = {
  defaultBudgetMode?: "strict" | "balanced" | "deep";
  defaultRetrievalMode?: "off" | "light" | "deep";
  maxInputTokensPerTurn?: number;
  maxContextChars?: number;
  compactionWatermark?: number;
  maxRemoteCallsPerTask?: number;
  leaseDurationMs?: number;
  maxConcurrentRunsPerWorker?: number;
  maxConcurrentRunsPerRoute?: number;
};

export type RuntimeTaskUpsertInput = {
  id?: string;
  parentTaskId?: string;
  agentId?: string;
  surfaceId?: string;
  sessionId?: string;
  title: string;
  route?: string;
  priority?: "low" | "normal" | "high";
  budgetMode?: "strict" | "balanced" | "deep";
  retrievalMode?: "off" | "light" | "deep";
  goal?: string;
  successCriteria?: string;
  tags?: string[];
  worker?: string;
  skillIds?: string[];
  recurring?: boolean;
  maintenance?: boolean;
  scheduleIntervalMinutes?: number;
  reportPolicy?: RuntimeReportPolicy;
  nextRunAt?: number;
};

export type RuntimeTaskWaitingUserResponseInput = {
  taskId: string;
  response: string;
  respondedBy?: string;
  nextAction?: string;
};

export type RuntimeIntelPinInput = {
  intelId: string;
  promotedBy?: string;
  summary?: string;
  detail?: string;
  tags?: string[];
};

export type RuntimeMemoryReinforcementInput = {
  memoryIds: string[];
  reason?: string;
  confidenceBoost?: number;
};

export type RuntimeMemoryInvalidationInput = {
  memoryIds: string[];
  reasonEventId?: string;
};

export type RuntimeMemoryRollbackInput = {
  invalidationEventId: string;
};

export type RuntimeMemoryConfigureInput = {
  enabled?: boolean;
  reviewIntervalHours?: number;
  decayGraceDays?: number;
  minDecayIncreasePerReview?: number;
  agePressurePerDay?: number;
  confidencePenaltyDivisor?: number;
  linkedStrategyConfidencePenalty?: number;
  highDecayThreshold?: number;
};

export type RuntimeFederationPackageTransitionInput = {
  id: string;
  state:
    | "received"
    | "validated"
    | "shadowed"
    | "recommended"
    | "adopted"
    | "rejected"
    | "expired"
    | "reverted";
  reason?: string;
};

export type RuntimeCoordinatorSuggestionMaterializeInput = {
  id: string;
};

export type RuntimeFederationAssignmentTransitionInput = {
  id: string;
  state: "pending" | "blocked" | "applied";
  reason?: string;
};

export type RuntimeFederationAssignmentMaterializeInput = {
  id: string;
};

export type RuntimeFederationInboxMaintenanceConfigureInput = {
  enabled?: boolean;
  reviewIntervalHours?: number;
  expireReceivedAfterHours?: number;
  expireValidatedAfterHours?: number;
  expireShadowedAfterHours?: number;
  expireRecommendedAfterHours?: number;
};

export type RuntimeFederationPushPolicyConfigureInput = {
  allowedPushScopes?: string[];
};

export type RuntimeFederationRemoteMaintenanceConfigureInput = {
  enabled?: boolean;
  syncIntervalMinutes?: number;
  retryAfterFailureMinutes?: number;
};

export type RuntimeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  runtimeLoading: boolean;
  runtimeError: string | null;
  runtimeSnapshot: RuntimeDashboardSnapshot | null;
  runtimeConsoleStore: RuntimeUserConsoleStore | null;
  runtimeImportPreview: LegacyRuntimeImportReport | null;
  runtimeImportBusy: boolean;
  runtimeImportApplyResult: LegacyRuntimeImportApplyResult | null;
  federationLoading: boolean;
  federationError: string | null;
  federationStatus: FederationRuntimeSnapshot | null;
  federationPreviewError: string | null;
  federationPreview: FederationRemoteSyncPreview | null;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadRuntime(state: RuntimeState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.runtimeLoading = true;
  state.federationLoading = true;
  state.runtimeError = null;
  state.federationError = null;
  state.federationPreviewError = null;
  state.federationPreview = null;
  try {
    const [snapshotRes, previewRes, federationRes, consoleStoreRes] = await Promise.allSettled([
      state.client.request("runtime.snapshot", {}),
      state.client.request("runtime.import.preview", {}),
      state.client.request("federation.status", {}),
      state.client.request("runtime.user.console.detail", {}),
    ]);

    if (snapshotRes.status === "fulfilled") {
      state.runtimeSnapshot = snapshotRes.value as RuntimeDashboardSnapshot;
    } else {
      state.runtimeError = toErrorMessage(snapshotRes.reason);
    }

    if (previewRes.status === "fulfilled") {
      state.runtimeImportPreview = previewRes.value as LegacyRuntimeImportReport;
    } else if (!state.runtimeImportPreview && state.runtimeSnapshot) {
      state.runtimeImportPreview = state.runtimeSnapshot.importPreview;
    } else if (!state.runtimeError) {
      state.runtimeError = toErrorMessage(previewRes.reason);
    }

    if (federationRes.status === "fulfilled") {
      state.federationStatus = federationRes.value as FederationRuntimeSnapshot;
    } else if (!state.federationStatus && state.runtimeSnapshot) {
      state.federationStatus = state.runtimeSnapshot.federation;
    } else {
      state.federationError = toErrorMessage(federationRes.reason);
    }

    if (consoleStoreRes.status === "fulfilled") {
      state.runtimeConsoleStore = consoleStoreRes.value as RuntimeUserConsoleStore;
    } else if (!state.runtimeError) {
      state.runtimeError = toErrorMessage(consoleStoreRes.reason);
    }
  } finally {
    state.runtimeLoading = false;
    state.federationLoading = false;
  }
}

export async function applyRuntimeLegacyImport(state: RuntimeState) {
  if (!state.client || !state.connected || state.runtimeImportBusy) {
    return;
  }
  state.runtimeImportBusy = true;
  state.runtimeError = null;
  try {
    const result = await state.client.request("runtime.import.apply", {});
    state.runtimeImportApplyResult = result as LegacyRuntimeImportApplyResult;
    await loadRuntime(state);
  } catch (error) {
    state.runtimeError = toErrorMessage(error);
  } finally {
    state.runtimeImportBusy = false;
  }
}

export async function previewRuntimeFederationRemote(state: RuntimeState) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  state.federationPreviewError = null;
  try {
    const [preview, federationRes, snapshotRes] = await Promise.all([
      state.client.request("federation.remote.preview", {}),
      state.client.request("federation.status", {}),
      state.client.request("runtime.snapshot", {}),
    ]);
    state.federationPreview = preview as FederationRemoteSyncPreview;
    state.federationStatus = federationRes as FederationRuntimeSnapshot;
    state.runtimeSnapshot = snapshotRes as RuntimeDashboardSnapshot;
  } catch (error) {
    state.federationPreviewError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function syncRuntimeFederationRemote(state: RuntimeState) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request("federation.remote.sync", {});
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function configureRuntimeFederationRemoteMaintenance(
  state: RuntimeState,
  input: RuntimeFederationRemoteMaintenanceConfigureInput,
) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request(
      "federation.remote.maintenance.configure",
      input as Record<string, unknown>,
    );
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function reviewRuntimeFederationInboxMaintenance(state: RuntimeState) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request("federation.inbox.maintenance.review", {});
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function configureRuntimeFederationInboxMaintenance(
  state: RuntimeState,
  input: RuntimeFederationInboxMaintenanceConfigureInput,
) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request(
      "federation.inbox.maintenance.configure",
      input as Record<string, unknown>,
    );
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function configureRuntimeFederationPushPolicy(
  state: RuntimeState,
  input: RuntimeFederationPushPolicyConfigureInput,
) {
  if (!state.client || !state.connected || state.federationLoading) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request("federation.push.configure", input as Record<string, unknown>);
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function transitionRuntimeFederationPackage(
  state: RuntimeState,
  input: RuntimeFederationPackageTransitionInput,
) {
  if (!state.client || !state.connected || state.federationLoading || !input.id.trim()) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request("federation.package.transition", input as Record<string, unknown>);
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function materializeRuntimeCoordinatorSuggestion(
  state: RuntimeState,
  input: RuntimeCoordinatorSuggestionMaterializeInput,
) {
  if (!state.client || !state.connected || state.federationLoading || !input.id.trim()) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request(
      "federation.coordinator-suggestion.materialize",
      input as Record<string, unknown>,
    );
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function transitionRuntimeFederationAssignment(
  state: RuntimeState,
  input: RuntimeFederationAssignmentTransitionInput,
) {
  if (!state.client || !state.connected || state.federationLoading || !input.id.trim()) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request(
      "federation.assignment.transition",
      input as Record<string, unknown>,
    );
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

export async function materializeRuntimeFederationAssignment(
  state: RuntimeState,
  input: RuntimeFederationAssignmentMaterializeInput,
) {
  if (!state.client || !state.connected || state.federationLoading || !input.id.trim()) {
    return;
  }
  state.federationLoading = true;
  state.federationError = null;
  try {
    await state.client.request(
      "federation.assignment.materialize",
      input as Record<string, unknown>,
    );
    await loadRuntime(state);
  } catch (error) {
    state.federationError = toErrorMessage(error);
  } finally {
    state.federationLoading = false;
  }
}

async function runRuntimeMutation(
  state: RuntimeState,
  method: string,
  params: Record<string, unknown>,
) {
  if (!state.client || !state.connected || state.runtimeLoading) {
    return;
  }
  state.runtimeLoading = true;
  state.runtimeError = null;
  try {
    await state.client.request(method, params);
    state.runtimeLoading = false;
    await loadRuntime(state);
  } catch (error) {
    state.runtimeError = toErrorMessage(error);
    state.runtimeLoading = false;
  }
}

export async function saveRuntimeUserModel(state: RuntimeState, input: RuntimeUserModelInput) {
  await runRuntimeMutation(state, "runtime.user.update", input as Record<string, unknown>);
}

export async function syncRuntimeUserModelMirror(state: RuntimeState, force = false) {
  await runRuntimeMutation(state, "runtime.user.mirror.sync", { force });
}

export async function importRuntimeUserModelMirror(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.user.mirror.import", {});
}

export async function saveRuntimeSessionPreference(
  state: RuntimeState,
  input: RuntimeSessionPreferenceInput,
) {
  await runRuntimeMutation(state, "runtime.user.session.upsert", input as Record<string, unknown>);
}

export async function removeRuntimeSessionPreference(state: RuntimeState, id: string) {
  if (!id.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.user.session.delete", { id });
}

export async function saveRuntimeAgent(state: RuntimeState, input: RuntimeAgentInput) {
  await runRuntimeMutation(state, "runtime.agent.upsert", input as Record<string, unknown>);
}

export async function removeRuntimeAgent(state: RuntimeState, id: string) {
  if (!id.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.agent.delete", { id });
}

export async function saveRuntimeSurface(state: RuntimeState, input: RuntimeSurfaceInput) {
  await runRuntimeMutation(state, "runtime.surface.upsert", input as Record<string, unknown>);
}

export async function saveRuntimeSurfaceRole(state: RuntimeState, input: RuntimeSurfaceRoleInput) {
  await runRuntimeMutation(state, "runtime.surface.role.upsert", input as Record<string, unknown>);
}

export async function reviewRuntimeRoleOptimization(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.role.optimization.review", {});
}

export async function reviewRuntimeUserModelOptimization(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.user.model.optimization.review", {});
}

export async function reviewRuntimeUserConsoleMaintenance(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.user.console.maintenance.review", {});
}

export async function configureRuntimeUserConsoleMaintenance(
  state: RuntimeState,
  input: RuntimeUserConsoleMaintenanceConfigureInput,
) {
  await runRuntimeMutation(
    state,
    "runtime.user.console.maintenance.configure",
    input as Record<string, unknown>,
  );
}

export async function adoptRuntimeRoleOptimization(state: RuntimeState, id: string) {
  if (!id.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.role.optimization.adopt", { id });
}

export async function adoptRuntimeUserModelOptimization(state: RuntimeState, id: string) {
  if (!id.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.user.model.optimization.adopt", { id });
}

export async function rejectRuntimeRoleOptimization(
  state: RuntimeState,
  input: RuntimeRoleOptimizationRejectInput,
) {
  if (!input.id.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.role.optimization.reject",
    input as Record<string, unknown>,
  );
}

export async function rejectRuntimeUserModelOptimization(
  state: RuntimeState,
  input: RuntimeUserModelOptimizationRejectInput,
) {
  if (!input.id.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.user.model.optimization.reject",
    input as Record<string, unknown>,
  );
}

export async function syncRuntimeCapabilities(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.capabilities.sync", {});
}

export async function setRuntimeCapabilityRegistryEntry(
  state: RuntimeState,
  input: RuntimeCapabilityRegistryEntryInput,
) {
  if (!input.targetId.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.capabilities.entry.set",
    input as Record<string, unknown>,
  );
}

export async function setRuntimeCapabilityMcpGrant(
  state: RuntimeState,
  input: RuntimeCapabilityMcpGrantInput,
) {
  if (!input.agentId.trim() || !input.mcpServerId.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.capabilities.mcp.grant.set",
    input as Record<string, unknown>,
  );
}

export async function configureRuntimeIntel(
  state: RuntimeState,
  input: RuntimeIntelConfigureInput,
) {
  await runRuntimeMutation(state, "runtime.intel.configure", input as Record<string, unknown>);
}

export async function refreshRuntimeIntel(
  state: RuntimeState,
  domains?: Array<"military" | "tech" | "ai" | "business">,
) {
  await runRuntimeMutation(state, "runtime.intel.refresh", {
    force: true,
    domains,
  });
}

export async function dispatchRuntimeIntelDeliveries(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.intel.delivery.dispatch", {});
}

export async function pinRuntimeIntel(state: RuntimeState, input: RuntimeIntelPinInput) {
  await runRuntimeMutation(state, "runtime.intel.pin", input as Record<string, unknown>);
}

export async function saveRuntimeIntelSource(state: RuntimeState, input: RuntimeIntelSourceInput) {
  if (!input.label.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.intel.source.upsert", input as Record<string, unknown>);
}

export async function removeRuntimeIntelSource(state: RuntimeState, id: string) {
  if (!id.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.intel.source.delete", { id });
}

export async function reviewRuntimeMemory(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.memory.review", {});
}

export async function configureRuntimeMemory(
  state: RuntimeState,
  input: RuntimeMemoryConfigureInput,
) {
  await runRuntimeMutation(state, "runtime.memory.configure", input as Record<string, unknown>);
}

export async function reinforceRuntimeMemory(
  state: RuntimeState,
  input: RuntimeMemoryReinforcementInput,
) {
  if (!Array.isArray(input.memoryIds) || input.memoryIds.length === 0) {
    return;
  }
  await runRuntimeMutation(state, "runtime.memory.reinforce", input as Record<string, unknown>);
}

export async function invalidateRuntimeMemory(
  state: RuntimeState,
  input: RuntimeMemoryInvalidationInput,
) {
  if (!Array.isArray(input.memoryIds) || input.memoryIds.length === 0) {
    return;
  }
  await runRuntimeMutation(state, "runtime.memory.invalidate", input as Record<string, unknown>);
}

export async function rollbackRuntimeMemoryInvalidation(
  state: RuntimeState,
  input: RuntimeMemoryRollbackInput,
) {
  if (!input.invalidationEventId.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.memory.rollback", input as Record<string, unknown>);
}

export async function runRuntimeEvolutionReview(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.evolution.run", {});
}

export async function configureRuntimeEvolution(
  state: RuntimeState,
  input: RuntimeEvolutionConfigureInput,
) {
  await runRuntimeMutation(state, "runtime.evolution.configure", input as Record<string, unknown>);
}

export async function setRuntimeEvolutionCandidateState(
  state: RuntimeState,
  input: RuntimeEvolutionCandidateStateInput,
) {
  if (!input.id.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.evolution.candidate.set",
    input as Record<string, unknown>,
  );
}

export async function acknowledgeRuntimeEvolutionVerification(
  state: RuntimeState,
  input: RuntimeEvolutionVerificationAcknowledgeInput,
) {
  if (!input.id.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.evolution.candidate.verification.ack",
    input as Record<string, unknown>,
  );
}

export async function configureRuntimeTaskLoop(
  state: RuntimeState,
  input: RuntimeTaskLoopConfigureInput,
) {
  await runRuntimeMutation(state, "runtime.tasks.configure", input as Record<string, unknown>);
}

export async function saveRuntimeTask(state: RuntimeState, input: RuntimeTaskUpsertInput) {
  if (!input.title.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.task.upsert", input as Record<string, unknown>);
}

export async function tickRuntimeTaskLoop(state: RuntimeState) {
  await runRuntimeMutation(state, "runtime.tick", {});
}

export async function planRuntimeTask(state: RuntimeState, taskId: string) {
  if (!taskId.trim()) {
    return;
  }
  await runRuntimeMutation(state, "runtime.task.plan", { taskId });
}

export async function respondRuntimeWaitingUserTask(
  state: RuntimeState,
  input: RuntimeTaskWaitingUserResponseInput,
) {
  if (!input.taskId.trim() || !input.response.trim()) {
    return;
  }
  await runRuntimeMutation(
    state,
    "runtime.task.waiting_user.respond",
    input as Record<string, unknown>,
  );
}
