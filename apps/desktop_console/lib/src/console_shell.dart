import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'desktop_host.dart';
import 'gateway.dart';
import 'models.dart';

final gatewayClientProvider = Provider<GatewayDesktopClient>((ref) {
  final bridge = ref.watch(desktopBridgeProvider);
  final client = GatewayDesktopClient(bridge: bridge);
  ref.onDispose(client.dispose);
  return client;
});

final shellControllerProvider =
    AsyncNotifierProvider<DesktopShellController, DesktopShellState>(
      DesktopShellController.new,
    );

class DesktopShellController extends AsyncNotifier<DesktopShellState> {
  StreamSubscription<GatewayEventFrame>? _eventSub;
  Timer? _refreshDebounce;

  GatewayDesktopClient get _client => ref.read(gatewayClientProvider);
  DesktopBridge get _desktopBridge => ref.read(desktopBridgeProvider);

  @override
  Future<DesktopShellState> build() async {
    ref.onDispose(() {
      _refreshDebounce?.cancel();
      _eventSub?.cancel();
    });
    await _client.connect();
    _eventSub = _client.events.listen(_handleEvent);
    return _load();
  }

  Future<void> refresh({String? statusMessage}) async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    state = await AsyncValue.guard(
      () => _load(
        page: current?.page,
        selectedTaskId: current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage: statusMessage ?? current?.lastStatusMessage,
      ),
    );
  }

  Future<void> setPage(DesktopPage page) async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    state = AsyncData(current.copyWith(page: page));
  }

  Future<void> focusTask(String? taskId) async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    state = AsyncData(current.copyWith(isRefreshing: true));
    state = await AsyncValue.guard(
      () => _load(
        page: current.page,
        selectedTaskId: taskId,
        selectedActionId: current.selectedActionId,
        statusMessage: current.lastStatusMessage,
      ),
    );
  }

  Future<void> focusAction(String? actionId) async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    final action =
        current.actionQueue
            .where((entry) => entry.id == actionId)
            .cast<ActionQueueItem?>()
            .firstOrNull;
    final targetPage = switch (action?.kind) {
      "user_model_mirror_import" ||
      "user_model_optimization" => DesktopPage.settings,
      "role_optimization" => DesktopPage.governance,
      "evolution_candidate_review" ||
      "evolution_revert_recommendation" => DesktopPage.governance,
      "federation_package" ||
      "coordinator_suggestion" => DesktopPage.federation,
      _ => current.page,
    };
    final taskId =
        action?.taskId ?? action?.localTaskId ?? current.selectedTaskId;
    state = AsyncData(current.copyWith(isRefreshing: true));
    state = await AsyncValue.guard(
      () => _load(
        page: targetPage,
        selectedTaskId: taskId,
        selectedActionId: actionId,
        statusMessage: current.lastStatusMessage,
      ),
    );
  }

  Future<void> submitComposer(String text) async {
    final prompt = text.trim();
    if (prompt.isEmpty) {
      return;
    }
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    final selectedAction = current.selectedAction;
    if (selectedAction?.isWaitingUserTask == true &&
        (selectedAction?.taskId ?? selectedAction?.localTaskId)?.isNotEmpty ==
            true) {
      final taskId =
          selectedAction?.taskId ?? selectedAction?.localTaskId ?? "";
      await _runCommand(
        () => _client.request(
          "runtime.task.waiting_user.respond",
          <String, Object?>{
            "taskId": taskId,
            "response": prompt,
            "respondedBy": "desktop-console",
          },
        ),
        successMessage: "Response sent to the waiting task.",
        selectedTaskId: taskId,
      );
      return;
    }
    final taskTitle =
        prompt.length > 72
            ? "${prompt.substring(0, 72).trimRight()}..."
            : prompt;
    final created = await _client.requestMap(
      "runtime.task.upsert",
      <String, Object?>{
        "title": taskTitle,
        "goal": prompt,
        "route": "desktop-console",
        "status": "queued",
        "priority": "normal",
        "budgetMode": "balanced",
        "retrievalMode": "light",
        "planSummary": "Queued from Desktop Console",
        "reportPolicy": "reply_and_proactive",
        "metadata": <String, Object?>{
          "source": "desktop-console",
          "intakeText": prompt,
          "operatorSurface": "desktop_console",
        },
      },
    );
    await refresh(
      statusMessage: "Queued a new runtime task from the desktop console.",
    );
    final taskId = asString(created["id"]);
    if (taskId.isNotEmpty) {
      await focusTask(taskId);
    }
  }

  Future<void> retryTask(String taskId) async {
    await _runCommand(
      () => _client.request("runtime.task.retry", <String, Object?>{
        "taskId": taskId,
        "requestedBy": "desktop-console",
      }),
      successMessage: "Queued the task for another run.",
      selectedTaskId: taskId,
    );
  }

  Future<void> cancelTask(String taskId) async {
    await _runCommand(
      () => _client.request("runtime.task.cancel", <String, Object?>{
        "taskId": taskId,
        "summary": "Cancelled from Desktop Console",
      }),
      successMessage: "Cancelled the active task.",
      selectedTaskId: taskId,
    );
  }

  Future<void> adoptEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.adopt", <String, Object?>{
        "id": candidateId,
        "reason": "Adopted from Desktop Console",
      }),
      successMessage: "Adopted the evolution candidate.",
      page: DesktopPage.governance,
    );
  }

  Future<void> rejectEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.reject", <String, Object?>{
        "id": candidateId,
        "reason": "Rejected from Desktop Console",
      }),
      successMessage: "Rejected the evolution candidate.",
      page: DesktopPage.governance,
    );
  }

  Future<void> revertEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.revert", <String, Object?>{
        "id": candidateId,
        "reason": "Reverted from Desktop Console",
      }),
      successMessage: "Reverted the evolution candidate.",
      page: DesktopPage.governance,
    );
  }

  Future<void> importUserModelMirror() async {
    await _runCommand(
      () => _client.request("runtime.user.mirror.import"),
      successMessage:
          "Imported the pending USER.md edits into the runtime user model.",
      page: DesktopPage.settings,
    );
  }

  Future<void> discardPendingUserModelMirror() async {
    await _runCommand(
      () => _client.request("runtime.user.mirror.sync", const <String, Object?>{
        "force": true,
      }),
      successMessage:
          "Discarded pending USER.md edits and resynced the mirror from runtime truth.",
      page: DesktopPage.settings,
    );
  }

  Future<void> adoptUserModelOptimization(String candidateId) async {
    await _runCommand(
      () => _client.request(
        "runtime.user.model.optimization.adopt",
        <String, Object?>{"id": candidateId},
      ),
      successMessage: "Applied the long-term user-model optimization.",
      page: DesktopPage.settings,
    );
  }

  Future<void> rejectUserModelOptimization(String candidateId) async {
    await _runCommand(
      () => _client.request(
        "runtime.user.model.optimization.reject",
        <String, Object?>{
          "id": candidateId,
          "reason": "Rejected from Desktop Console",
        },
      ),
      successMessage: "Rejected the long-term user-model optimization.",
      page: DesktopPage.settings,
    );
  }

  Future<void> adoptRoleOptimization(String candidateId) async {
    await _runCommand(
      () => _client.request(
        "runtime.role.optimization.adopt",
        <String, Object?>{"id": candidateId},
      ),
      successMessage: "Applied the surface-role optimization.",
      page: DesktopPage.governance,
    );
  }

  Future<void> rejectRoleOptimization(String candidateId) async {
    await _runCommand(
      () =>
          _client.request("runtime.role.optimization.reject", <String, Object?>{
            "id": candidateId,
            "reason": "Rejected from Desktop Console",
          }),
      successMessage: "Rejected the surface-role optimization.",
      page: DesktopPage.governance,
    );
  }

  Future<void> updateUserModel({
    required String displayName,
    required String communicationStyle,
    required String interruptionThreshold,
    required String reportVerbosity,
    required String confirmationBoundary,
    required String reportPolicy,
  }) async {
    await _runCommand(
      () => _client.request("runtime.user.update", <String, Object?>{
        "displayName": displayName,
        "communicationStyle": communicationStyle,
        "interruptionThreshold": interruptionThreshold,
        "reportVerbosity": reportVerbosity,
        "confirmationBoundary": confirmationBoundary,
        "reportPolicy": reportPolicy,
      }),
      successMessage: "Updated the runtime user model.",
      page: DesktopPage.settings,
    );
  }

  Future<void> syncCapabilities() async {
    await _runCommand(
      () => _client.request("runtime.capabilities.sync"),
      successMessage: "Synced the runtime capability registry.",
      page: DesktopPage.governance,
    );
  }

  Future<void> setCapabilityEntryState({
    required String registryType,
    required String targetId,
    required String stateValue,
    String? entryId,
  }) async {
    await _runCommand(
      () => _client.request("runtime.capabilities.entry.set", <String, Object?>{
        if ((entryId ?? "").isNotEmpty) "id": entryId,
        "registryType": registryType,
        "targetId": targetId,
        "state": stateValue,
        "reason": "Updated from Desktop Console",
      }),
      successMessage: "Updated the capability governance state.",
      page: DesktopPage.governance,
    );
  }

  Future<void> setMcpGrantState({
    required String agentId,
    required String mcpServerId,
    required String stateValue,
    String? grantId,
  }) async {
    await _runCommand(
      () => _client
          .request("runtime.capabilities.mcp.grant.set", <String, Object?>{
            if ((grantId ?? "").isNotEmpty) "id": grantId,
            "agentId": agentId,
            "mcpServerId": mcpServerId,
            "state": stateValue,
            "reason": "Updated from Desktop Console",
          }),
      successMessage: "Updated the MCP grant posture.",
      page: DesktopPage.governance,
    );
  }

  Future<void> reinforceMemory(String memoryId, {String? sourceTaskId}) async {
    await _runCommand(
      () => _client.request("runtime.memory.reinforce", <String, Object?>{
        "memoryIds": [memoryId],
        "reason": "Reinforced from Desktop Console",
        if ((sourceTaskId ?? "").isNotEmpty) "sourceTaskId": sourceTaskId,
      }),
      successMessage: "Reinforced the formal memory lineage.",
      page: DesktopPage.memory,
    );
  }

  Future<void> invalidateMemory(String memoryId) async {
    await _runCommand(
      () => _client.request("runtime.memory.invalidate", <String, Object?>{
        "memoryIds": [memoryId],
      }),
      successMessage: "Invalidated the selected memory lineage.",
      page: DesktopPage.memory,
    );
  }

  Future<void> rollbackMemoryInvalidation(String invalidationEventId) async {
    await _runCommand(
      () => _client.request("runtime.memory.rollback", <String, Object?>{
        "invalidationEventId": invalidationEventId,
      }),
      successMessage: "Rolled back the selected invalidation event.",
      page: DesktopPage.memory,
    );
  }

  Future<void> reviewMemoryLifecycle() async {
    await _runCommand(
      () => _client.request("runtime.memory.review"),
      successMessage: "Ran a memory lifecycle review.",
      page: DesktopPage.memory,
    );
  }

  Future<void> pinIntelToKnowledge(String intelId) async {
    await _runCommand(
      () => _client.request("runtime.intel.pin", <String, Object?>{
        "intelId": intelId,
        "promotedBy": "desktop-console",
      }),
      successMessage: "Promoted the intel item into knowledge memory.",
      page: DesktopPage.memory,
    );
  }

  Future<void> upsertAgent({
    String? agentId,
    required String name,
    required String description,
    required String roleBase,
    required String memoryNamespace,
    required List<String> skillIds,
    required bool active,
    String? communicationStyle,
    String? reportPolicy,
    String? notes,
  }) async {
    final overlay = <String, Object?>{};
    if ((communicationStyle ?? "").trim().isNotEmpty) {
      overlay["communicationStyle"] = communicationStyle!.trim();
    }
    if ((reportPolicy ?? "").trim().isNotEmpty) {
      overlay["reportPolicy"] = reportPolicy!.trim();
    }
    if ((notes ?? "").trim().isNotEmpty) {
      overlay["notes"] = notes!.trim();
    }
    await _runCommand(
      () => _client.request("runtime.agent.upsert", <String, Object?>{
        if ((agentId ?? "").isNotEmpty) "id": agentId,
        "name": name,
        "description": description,
        "roleBase": roleBase,
        "memoryNamespace": memoryNamespace,
        "skillIds": skillIds,
        "active": active,
        if (overlay.isNotEmpty) "overlay": overlay,
      }),
      successMessage: "Saved the runtime agent profile.",
      page: DesktopPage.governance,
    );
  }

  Future<void> deleteAgent(String agentId) async {
    await _runCommand(
      () => _client.request("runtime.agent.delete", <String, Object?>{
        "id": agentId,
      }),
      successMessage: "Removed the runtime agent.",
      page: DesktopPage.governance,
    );
  }

  Future<void> upsertSurface({
    String? surfaceId,
    required String channel,
    required String accountId,
    required String label,
    required String ownerKind,
    String? ownerId,
    required bool active,
  }) async {
    await _runCommand(
      () => _client.request("runtime.surface.upsert", <String, Object?>{
        if ((surfaceId ?? "").isNotEmpty) "id": surfaceId,
        "channel": channel,
        "accountId": accountId,
        "label": label,
        "ownerKind": ownerKind,
        if (ownerKind == "agent" && (ownerId ?? "").isNotEmpty) "ownerId": ownerId,
        "active": active,
      }),
      successMessage: "Saved the surface binding.",
      page: DesktopPage.governance,
    );
  }

  Future<void> upsertSurfaceRole({
    String? overlayId,
    required String surfaceId,
    required String role,
    required String businessGoal,
    required String tone,
    required String initiative,
    required List<String> allowedTopics,
    required List<String> restrictedTopics,
    required String reportTarget,
    required String taskCreation,
    required String escalationTarget,
    required String roleScope,
  }) async {
    await _runCommand(
      () => _client.request("runtime.surface.role.upsert", <String, Object?>{
        if ((overlayId ?? "").isNotEmpty) "id": overlayId,
        "surfaceId": surfaceId,
        "role": role,
        "businessGoal": businessGoal,
        "tone": tone,
        "initiative": initiative,
        "allowedTopics": allowedTopics,
        "restrictedTopics": restrictedTopics,
        "reportTarget": reportTarget,
        "localBusinessPolicy": <String, Object?>{
          "taskCreation": taskCreation,
          "escalationTarget": escalationTarget,
          "roleScope": roleScope,
        },
      }),
      successMessage: "Saved the surface role overlay.",
      page: DesktopPage.governance,
    );
  }

  Future<void> adoptFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "adopted",
        "reason": "Adopted from Desktop Console",
      }),
      successMessage: "Adopted the federation package locally.",
      page: DesktopPage.federation,
    );
  }

  Future<void> rejectFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "rejected",
        "reason": "Rejected from Desktop Console",
      }),
      successMessage: "Rejected the federation package locally.",
      page: DesktopPage.federation,
    );
  }

  Future<void> revertFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "reverted",
        "reason": "Reverted from Desktop Console",
      }),
      successMessage: "Reverted the adopted federation package locally.",
      page: DesktopPage.federation,
    );
  }

  Future<void> materializeCoordinatorSuggestion(String suggestionId) async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    final result = await _client.requestMap(
      "federation.coordinator-suggestion.materialize",
      <String, Object?>{"id": suggestionId},
    );
    final taskId = asString(asMap(result["task"])["id"]);
    final created = asBool(result["created"]);
    state = await AsyncValue.guard(
      () => _load(
        page: DesktopPage.federation,
        selectedTaskId: taskId.isNotEmpty ? taskId : current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage:
            created
                ? "Materialized the coordinator suggestion into a local runtime task."
                : "Opened the existing local task for this coordinator suggestion.",
      ),
    );
  }

  Future<void> materializeFederationAssignment(String assignmentId) async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    final result = await _client.requestMap(
      "federation.assignment.materialize",
      <String, Object?>{"id": assignmentId},
    );
    final taskId = asString(asMap(result["task"])["id"]);
    final created = asBool(result["created"]);
    state = await AsyncValue.guard(
      () => _load(
        page: DesktopPage.federation,
        selectedTaskId: taskId.isNotEmpty ? taskId : current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage:
            created
                ? "Materialized the federation assignment into a local runtime task."
                : "Opened the existing local task for this federation assignment.",
      ),
    );
  }

  Future<void> blockFederationAssignment(String assignmentId) async {
    await _runCommand(
      () =>
          _client.request("federation.assignment.transition", <String, Object?>{
            "id": assignmentId,
            "state": "blocked",
            "reason": "Blocked from Desktop Console",
          }),
      successMessage: "Blocked the federation assignment locally.",
      page: DesktopPage.federation,
    );
  }

  Future<void> resetFederationAssignment(String assignmentId) async {
    await _runCommand(
      () =>
          _client.request("federation.assignment.transition", <String, Object?>{
            "id": assignmentId,
            "state": "pending",
            "reason": "Reset from Desktop Console",
          }),
      successMessage: "Reset the federation assignment back to pending.",
      page: DesktopPage.federation,
    );
  }

  Future<void> markFederationAssignmentApplied(String assignmentId) async {
    await _runCommand(
      () =>
          _client.request("federation.assignment.transition", <String, Object?>{
            "id": assignmentId,
            "state": "applied",
            "reason": "Marked applied from Desktop Console",
          }),
      successMessage: "Marked the federation assignment as applied.",
      page: DesktopPage.federation,
    );
  }

  Future<void> configureTaskDefaults({
    required String defaultBudgetMode,
    required String defaultRetrievalMode,
    required int maxInputTokensPerTurn,
    required int maxContextChars,
    required int compactionWatermark,
    required int maxRemoteCallsPerTask,
  }) async {
    await _runCommand(
      () => _client.request("runtime.tasks.configure", <String, Object?>{
        "defaultBudgetMode": defaultBudgetMode,
        "defaultRetrievalMode": defaultRetrievalMode,
        "maxInputTokensPerTurn": maxInputTokensPerTurn,
        "maxContextChars": maxContextChars,
        "compactionWatermark": compactionWatermark,
        "maxRemoteCallsPerTask": maxRemoteCallsPerTask,
      }),
      successMessage: "Updated the runtime task-loop defaults.",
      page: DesktopPage.settings,
    );
  }

  Future<void> configureEvolutionControls({
    required bool enabled,
    required bool autoApplyLowRisk,
    required bool autoCanaryEvolution,
    required int reviewIntervalHours,
  }) async {
    await _runCommand(
      () => _client.request("runtime.evolution.configure", <String, Object?>{
        "enabled": enabled,
        "autoApplyLowRisk": autoApplyLowRisk,
        "autoCanaryEvolution": autoCanaryEvolution,
        "reviewIntervalHours": reviewIntervalHours,
      }),
      successMessage: "Updated local evolution governance controls.",
      page: DesktopPage.settings,
    );
  }

  Future<void> runEvolutionReview() async {
    await _runCommand(
      () => _client.request("runtime.evolution.run"),
      successMessage: "Ran an on-demand evolution review.",
      page: DesktopPage.settings,
    );
  }

  Future<void> configureIntelControls({
    required bool enabled,
    required bool digestEnabled,
    required int refreshMinutes,
    required List<String> enabledDomainIds,
    required bool dailyPushEnabled,
    required int dailyPushItemCount,
    required int dailyPushHourLocal,
    required int dailyPushMinuteLocal,
    required bool instantPushEnabled,
    required int instantPushMinScore,
  }) async {
    await _runCommand(
      () => _client.request("runtime.intel.configure", <String, Object?>{
        "enabled": enabled,
        "digestEnabled": digestEnabled,
        "refreshMinutes": refreshMinutes,
        "enabledDomainIds": enabledDomainIds,
        "dailyPushEnabled": dailyPushEnabled,
        "dailyPushItemCount": dailyPushItemCount,
        "dailyPushHourLocal": dailyPushHourLocal,
        "dailyPushMinuteLocal": dailyPushMinuteLocal,
        "instantPushEnabled": instantPushEnabled,
        "instantPushMinScore": instantPushMinScore,
      }),
      successMessage: "Updated the runtime intel panel controls.",
      page: DesktopPage.settings,
    );
  }

  Future<void> refreshIntel() async {
    await _runCommand(
      () => _client.request("runtime.intel.refresh", <String, Object?>{
        "force": true,
      }),
      successMessage: "Triggered a manual intel refresh.",
      page: DesktopPage.settings,
    );
  }

  Future<void> dispatchIntelDeliveries() async {
    await _runCommand(
      () => _client.request("runtime.intel.delivery.dispatch"),
      successMessage: "Dispatched pending intel deliveries.",
      page: DesktopPage.settings,
    );
  }

  Future<void> syncFederation() async {
    await _runCommand(
      () => _client.request("runtime.federation.sync"),
      successMessage: "Triggered a manual federation sync.",
      page: DesktopPage.federation,
    );
  }

  Future<void> initializeInstance() async {
    final result = await _client.requestMap("desktop.initializeInstance");
    final createdPaths = asMapList(result["createdPaths"]);
    final createdCount =
        result["createdPaths"] is List
            ? (result["createdPaths"] as List).length
            : createdPaths.length;
    final createdConfig = asBool(result["createdConfig"]);
    await refresh(
      statusMessage:
          "Initialized desktop instance roots (${createdCount.toString()} paths${createdConfig ? ", config created" : ""}).",
    );
  }

  Future<void> restartRuntime() async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    await _desktopBridge.restartRuntime();
    final message =
        "Requested a local runtime restart. Reconnecting through the desktop bootstrap session...";
    if (current != null) {
      state = AsyncData(
        current.copyWith(isRefreshing: true, lastStatusMessage: message),
      );
    }
    await Future<void>.delayed(const Duration(milliseconds: 800));
    ref.invalidate(bootstrapControllerProvider);
    ref.invalidate(gatewayClientProvider);
    ref.invalidateSelf();
  }

  Future<void> tickRuntime() async {
    await _runCommand(
      () => _client.request("runtime.tick"),
      successMessage: "Ticked the runtime task loop.",
    );
  }

  Future<void> openLogs() async {
    final result = await _desktopBridge.openLogs();
    await refresh(
      statusMessage:
          asBool(result["opened"])
              ? "Opened logs at ${asString(result["logRoot"], "the runtime log root")}."
              : "Logs are available at ${asString(result["logRoot"], "the runtime log root")}.",
    );
  }

  Future<void> _runCommand(
    Future<dynamic> Function() command, {
    String? successMessage,
    String? selectedTaskId,
    DesktopPage? page,
  }) async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    await command();
    state = await AsyncValue.guard(
      () => _load(
        page: page ?? current?.page,
        selectedTaskId: selectedTaskId ?? current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage: successMessage ?? current?.lastStatusMessage,
      ),
    );
  }

  void _handleEvent(GatewayEventFrame event) {
    const refreshEvents = <String>{
      "runtime.dashboard.updated",
      "runtime.health.updated",
      "task.updated",
      "governance.updated",
      "federation.updated",
      "desktop.runtime.state_changed",
    };
    if (!refreshEvents.contains(event.event)) {
      return;
    }
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(const Duration(milliseconds: 250), () {
      unawaited(refresh());
    });
  }

  Future<DesktopShellState> _load({
    DesktopPage? page,
    String? selectedTaskId,
    String? selectedActionId,
    String? statusMessage,
  }) async {
    final current = state.valueOrNull;
    final shellSnapshot = await _client.requestMap("desktop.getShellSnapshot");
    final bootstrap = asMap(shellSnapshot["bootstrap"]);
    final dashboard = asMap(shellSnapshot["dashboard"]);
    final settings = asMap(shellSnapshot["settings"]);
    try {
      dashboard["runtimeHealth"] = asMap(await _client.request("runtime.getHealth"));
    } catch (_) {
      dashboard["runtimeHealth"] = const <String, dynamic>{};
    }
    try {
      final userConsoleDetail = asMap(
        await _client.request("runtime.user.console.detail"),
      );
      dashboard["agentRecords"] = asMapList(userConsoleDetail["agents"]);
      dashboard["agentOverlays"] = asMapList(
        userConsoleDetail["agentOverlays"],
      );
      dashboard["surfaceRecords"] = asMapList(userConsoleDetail["surfaces"]);
      dashboard["surfaceRoleOverlays"] = asMapList(
        userConsoleDetail["surfaceRoleOverlays"],
      );
    } catch (_) {
      dashboard["agentRecords"] = const <Map<String, dynamic>>[];
      dashboard["agentOverlays"] = const <Map<String, dynamic>>[];
      dashboard["surfaceRecords"] = const <Map<String, dynamic>>[];
      dashboard["surfaceRoleOverlays"] = const <Map<String, dynamic>>[];
    }

    final taskRows = asMapList(asMap(dashboard["tasks"])["tasks"]);
    String? resolvedTaskId = selectedTaskId ?? current?.selectedTaskId;
    if (resolvedTaskId == null ||
        resolvedTaskId.isEmpty ||
        !taskRows.any((entry) => asString(entry["id"]) == resolvedTaskId)) {
      resolvedTaskId = taskRows.isEmpty ? null : asString(taskRows.first["id"]);
    }

    final actionRows = asMapList(
      asMap(dashboard["userConsole"])["actionQueue"],
    );
    String? resolvedActionId = selectedActionId ?? current?.selectedActionId;
    if (resolvedActionId != null &&
        resolvedActionId.isNotEmpty &&
        !actionRows.any((entry) => asString(entry["id"]) == resolvedActionId)) {
      resolvedActionId = null;
    }
    if ((resolvedActionId == null || resolvedActionId.isEmpty) &&
        actionRows.isNotEmpty) {
      resolvedActionId = asString(actionRows.first["id"]);
    }

    Map<String, dynamic>? selectedTask;
    if (resolvedTaskId != null && resolvedTaskId.isNotEmpty) {
      try {
        selectedTask = await _client.requestMap(
          "runtime.getTask",
          <String, Object?>{"taskId": resolvedTaskId},
        );
      } catch (_) {
        selectedTask = null;
      }
    }

    return DesktopShellState.fromPayloads(
      page: page ?? current?.page ?? DesktopPage.home,
      bootstrap: bootstrap,
      dashboard: dashboard,
      settings: settings,
      selectedTask: selectedTask,
      selectedTaskId: resolvedTaskId,
      selectedActionId: resolvedActionId,
      lastStatusMessage: statusMessage ?? current?.lastStatusMessage,
    );
  }
}

class ConsoleShell extends ConsumerStatefulWidget {
  const ConsoleShell({super.key});

  @override
  ConsumerState<ConsoleShell> createState() => _ConsoleShellState();
}

class _ConsoleShellState extends ConsumerState<ConsoleShell> {
  late final TextEditingController _composerController;

  @override
  void initState() {
    super.initState();
    _composerController = TextEditingController();
  }

  @override
  void dispose() {
    _composerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shellAsync = ref.watch(shellControllerProvider);
    return Scaffold(
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: shellAsync.when(
            loading: () => const _LoadingState(),
            error: (error, _) => _ErrorState(error: error),
            data:
                (shell) => Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    children: [
                      _TopBar(shell: shell),
                      const SizedBox(height: 14),
                      Expanded(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SizedBox(
                              width: 256,
                              child: _LeftNavigation(shell: shell),
                            ),
                            const SizedBox(width: 14),
                            SizedBox(
                              width: 420,
                              child: _CenterInteractionPane(
                                shell: shell,
                                controller: _composerController,
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(child: _RightWorkboard(shell: shell)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
          ),
        ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 42,
            height: 42,
            child: CircularProgressIndicator(strokeWidth: 3),
          ),
          const SizedBox(height: 18),
          Text(
            "正在把桌面控制台连接到本地运行时...",
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 8),
          Text(
            "桌面应用正在等待原生启动宿主提供一个可用的本地运行时会话。",
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends ConsumerWidget {
  const _ErrorState({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrapRequired =
        error is DesktopBootstrapRequired ||
        error.toString().contains("DesktopBootstrapRequired");
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  bootstrapRequired
                      ? "ClawMark Core 需要处理"
                      : "桌面控制台尚未连接",
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 12),
                Text(
                  error.toString(),
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                Text(
                  bootstrapRequired
                      ? "原生桌面宿主还没有上报一个已就绪的本地运行时会话。请回到启动工作台检查、下载或重启 ClawMark Core。"
                      : "Flutter 壳启动前，我们期望本地运行时网关已经可用并完成鉴权。",
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: () {
                    ref.invalidate(bootstrapControllerProvider);
                    ref.invalidate(gatewayClientProvider);
                    ref.invalidate(shellControllerProvider);
                  },
                  icon: const Icon(Icons.refresh),
                  label: Text(
                    bootstrapRequired
                        ? "打开启动工作台"
                        : "重试连接",
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "ClawMark 桌面控制台",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    "一个本地运行时，一个操作工作台，不依赖浏览器。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.end,
              children: [
                _MetricPill(
                  icon: Icons.memory,
                  label: "运行时",
                  value: shell.runtimeVersion,
                ),
                _MetricPill(
                  icon: Icons.play_circle_outline,
                  label: "任务",
                  value: shell.totalTaskCount.toString(),
                ),
                _MetricPill(
                  icon: Icons.pending_actions_outlined,
                  label: "待处理",
                  value: shell.pendingActionCount.toString(),
                ),
                _MetricPill(
                  icon: Icons.mark_chat_unread_outlined,
                  label: "等待用户",
                  value: shell.waitingUserCount.toString(),
                ),
                _MetricPill(
                  icon: Icons.outbox_outlined,
                  label: "外发队列",
                  value: shell.outboxPendingCount.toString(),
                ),
              ],
            ),
            const SizedBox(width: 12),
            IconButton(
              tooltip: "刷新",
              onPressed: shell.isRefreshing ? null : () => controller.refresh(),
              icon: const Icon(Icons.sync),
            ),
            IconButton(
              tooltip: "触发运行时轮询",
              onPressed:
                  shell.isRefreshing ? null : () => controller.tickRuntime(),
              icon: const Icon(Icons.play_arrow_rounded),
            ),
          ],
        ),
      ),
    );
  }
}

class _LeftNavigation extends ConsumerWidget {
  const _LeftNavigation({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    color: const Color(0xFF1E1D19),
                  ),
                  child: const Icon(Icons.hub_rounded, color: Colors.white),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "操作面",
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        asString(
                          shell.productSection["layout"],
                          "desktop_console",
                        ),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            ...DesktopPage.values.map(
              (page) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _NavButton(
                  selected: shell.page == page,
                  icon: page.icon,
                  label: page.label,
                  subtitle: page.description,
                  onTap: () => controller.setPage(page),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text("对象", style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            Expanded(
              child: ListView.separated(
                itemCount: shell.tasks.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final task = shell.tasks[index];
                  return _ObjectTile(
                    title: task.title,
                    subtitle: "${task.route} · ${task.worker}",
                    badge: task.status,
                    highlighted: shell.selectedTaskId == task.id,
                    onTap: () => controller.focusTask(task.id),
                  );
                },
              ),
            ),
            if (shell.warnings.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                "运行时告警",
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ...shell.warnings
                  .take(2)
                  .map(
                    (warning) => Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        "• $warning",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CenterInteractionPane extends ConsumerWidget {
  const _CenterInteractionPane({required this.shell, required this.controller});

  final DesktopShellState shell;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtime = ref.read(shellControllerProvider.notifier);
    final selectedAction = shell.selectedAction;
    final runtimeHealth = shell.runtimeHealth;
    final runtimeHealthProcess = asMap(runtimeHealth["process"]);
    final runtimeHealthWarnings = asStringList(runtimeHealth["warnings"]);
    final runtimeSection = shell.runtimeSection;
    final gatewaySection = shell.gatewaySection;
    final instanceSection = shell.instanceSection;
    final composerLabel =
        selectedAction?.isWaitingUserTask == true
            ? "回复等待中的任务"
            : "给 ClawMark 一个新目标";
    final composerHint =
        selectedAction?.isWaitingUserTask == true
            ? "补充上下文、回复运行时，或批准下一步..."
            : "描述接下来要做什么，运行时会把它落成任务或工作流。";
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              shell.page.headline,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              shell.page.description,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 18),
            _SectionCard(
              title: composerLabel,
              subtitle: composerHint,
              child: Column(
                children: [
                  if (selectedAction != null)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF7F2EA),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            selectedAction.title,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            selectedAction.summary,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                          if ((selectedAction.estimatedImpact ?? "")
                              .isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Text(
                              "预估影响：${selectedAction.estimatedImpact}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ],
                        ],
                      ),
                    ),
                  TextField(
                    controller: controller,
                    minLines: 6,
                    maxLines: 10,
                    decoration: InputDecoration(hintText: composerHint),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed:
                              shell.isRefreshing
                                  ? null
                                  : () async {
                                    final input = controller.text;
                                    controller.clear();
                                    await runtime.submitComposer(input);
                                  },
                          icon: const Icon(Icons.send_rounded),
                          label: Text(
                            selectedAction?.isWaitingUserTask == true
                                ? "发送回复"
                                : "加入目标队列",
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      OutlinedButton.icon(
                        onPressed:
                            shell.isRefreshing
                                ? null
                                : () {
                                  controller.clear();
                                },
                        icon: const Icon(Icons.layers_clear_outlined),
                        label: const Text("清空"),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: ListView(
                children: [
                  _SectionCard(
                    title: "一体化安装就绪度",
                    subtitle:
                        "在首次开始控制前，桌面壳、运行时宿主、本地网关和实例根目录都应该清晰可见。",
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _FactGrid(
                          items: [
                            (
                              "内置宿主",
                              asBool(
                                    runtimeSection["bundledHostReady"],
                                    true,
                                  )
                                  ? "就绪"
                                  : "未就绪",
                            ),
                            (
                              "网关传输",
                              asString(
                                gatewaySection["transport"],
                                "websocket-rpc",
                              ),
                            ),
                            (
                              "仅 loopback",
                              asBool(gatewaySection["localOnly"], true)
                                  ? "是"
                                  : "否",
                            ),
                            (
                              "鉴权模式",
                              asString(gatewaySection["authMode"], "token"),
                            ),
                            (
                              "实例根目录",
                              asString(instanceSection["instanceRoot"], "n/a"),
                            ),
                            (
                              "工作区根目录",
                              asString(
                                instanceSection["workspaceRoot"],
                                "n/a",
                              ),
                            ),
                            (
                              "运行时 PID",
                              asString(
                                runtimeHealthProcess["pid"],
                                asString(runtimeSection["pid"], "n/a"),
                              ),
                            ),
                            (
                              "运行时长",
                              _formatDuration(
                                asInt(
                                  runtimeHealthProcess["uptimeMs"],
                                  asInt(runtimeSection["uptimeMs"]),
                                ),
                              ),
                            ),
                            (
                              "RSS",
                              _formatBytes(
                                asInt(runtimeHealthProcess["rssBytes"]),
                              ),
                            ),
                            (
                              "堆内存占用",
                              _formatBytes(
                                asInt(runtimeHealthProcess["heapUsedBytes"]),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Column(
                          children: [
                            _ReadinessRow(
                              ready: asBool(
                                runtimeSection["bundledHostReady"],
                                true,
                              ),
                              title: "内置桌面运行时宿主",
                              summary:
                                  "操作端应用应该自带本地控制链路。",
                            ),
                            _ReadinessRow(
                              ready: asBool(gatewaySection["localOnly"], true),
                              title: "仅使用本地网关",
                              summary:
                                  "桌面控制应该停留在 loopback，不依赖浏览器控制台。",
                            ),
                            _ReadinessRow(
                              ready: shell.warnings.isEmpty,
                              title: "启动告警已清空",
                              summary:
                                  shell.warnings.isEmpty
                                      ? "当前没有看到启动告警。"
                                      : shell.warnings.first,
                            ),
                            _ReadinessRow(
                              ready: runtimeHealthWarnings.isEmpty,
                              title: "运行时健康告警",
                              summary:
                                  runtimeHealthWarnings.isEmpty
                                  ? "当前运行时健康快照是干净的。"
                                  : runtimeHealthWarnings.join("  "),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.openLogs(),
                              icon: const Icon(Icons.folder_open_outlined),
                              label: const Text("打开日志"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.initializeInstance(),
                              icon: const Icon(Icons.inventory_2_outlined),
                              label: const Text("初始化实例"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.restartRuntime(),
                              icon: const Icon(Icons.restart_alt_outlined),
                              label: const Text("重启运行时"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.setPage(
                                        DesktopPage.settings,
                                      ),
                              icon: const Icon(Icons.settings_outlined),
                              label: const Text("打开设置"),
                            ),
                            if (shell.warnings.isNotEmpty)
                              OutlinedButton.icon(
                                onPressed:
                                    shell.isRefreshing
                                        ? null
                                        : () => runtime.refresh(),
                                icon: const Icon(Icons.sync_problem_outlined),
                                label: const Text("重新检查启动状态"),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  _SectionCard(
                    title: "审批与快捷动作",
                    subtitle:
                        "中间栏用于承载当前审批、打断请求和操作快捷入口。",
                    child: Column(
                      children: [
                        Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: [
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.refresh(),
                              icon: const Icon(Icons.sync),
                              label: const Text("刷新"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.tickRuntime(),
                              icon: const Icon(Icons.bolt_outlined),
                              label: const Text("触发运行时轮询"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.syncFederation(),
                              icon: const Icon(Icons.hub_outlined),
                              label: const Text("同步联邦"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.openLogs(),
                              icon: const Icon(Icons.folder_open_outlined),
                              label: const Text("打开日志"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.initializeInstance(),
                              icon: const Icon(Icons.inventory_2_outlined),
                              label: const Text("初始化实例"),
                            ),
                            OutlinedButton.icon(
                              onPressed:
                                  shell.isRefreshing
                                      ? null
                                      : () => runtime.restartRuntime(),
                              icon: const Icon(Icons.restart_alt_outlined),
                              label: const Text("重启运行时"),
                            ),
                          ],
                        ),
                        if ((shell.lastStatusMessage ?? "").isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF7F2EA),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Text(
                              shell.lastStatusMessage!,
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  _SectionCard(
                    title: "审批队列",
                    subtitle:
                        "需要人工参与的动作会明确显示在这里，而不是藏在后台守护进程后面。",
                    child: Column(
                      children:
                          shell.actionQueue.isEmpty
                              ? [
                                Text(
                                  "当前没有待处理动作，运行时可以继续推进。",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                              ]
                              : shell.actionQueue
                                  .map(
                                    (item) => Padding(
                                      padding: const EdgeInsets.only(
                                        bottom: 10,
                                      ),
                                      child: _ActionQueueTile(
                                        shell: shell,
                                        item: item,
                                      ),
                                    ),
                                  )
                                  .toList(growable: false),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionQueueTile extends ConsumerWidget {
  const _ActionQueueTile({required this.shell, required this.item});

  final DesktopShellState shell;
  final ActionQueueItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final isSelected = shell.selectedActionId == item.id;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        color: isSelected ? const Color(0xFF1E1D19) : const Color(0xFFF9F5EF),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _StatusBadge(label: item.priority, tone: item.priority),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: isSelected ? Colors.white : null,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            item.summary,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: isSelected ? Colors.white70 : null,
            ),
          ),
          if ((item.actionBlockedReason ?? "").isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              item.actionBlockedReason!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: isSelected ? Colors.white70 : const Color(0xFFA24634),
              ),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: () => controller.focusAction(item.id),
                child: const Text("Focus"),
              ),
              if (item.isEvolutionReview && (item.candidateId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptEvolution(item.candidateId!),
                  child: const Text("Adopt"),
                ),
              if (item.isEvolutionReview && (item.candidateId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectEvolution(item.candidateId!),
                  child: const Text("Reject"),
                ),
              if (item.isUserModelOptimization &&
                  (item.candidateId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptUserModelOptimization(
                            item.candidateId!,
                          ),
                  child: const Text("Apply to runtime user model"),
                ),
              if (item.isUserModelOptimization &&
                  (item.candidateId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectUserModelOptimization(
                            item.candidateId!,
                          ),
                  child: const Text("Keep current user model"),
                ),
              if (item.isRoleOptimization &&
                  (item.candidateId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptRoleOptimization(
                            item.candidateId!,
                          ),
                  child: const Text("Apply to surface role"),
                ),
              if (item.isRoleOptimization &&
                  (item.candidateId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectRoleOptimization(
                            item.candidateId!,
                          ),
                  child: const Text("Keep current role"),
                ),
              if (item.isUserModelMirrorImport)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.importUserModelMirror(),
                  child: const Text("Import edits"),
                ),
              if (item.isUserModelMirrorImport)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.discardPendingUserModelMirror(),
                  child: const Text("Discard mirror edits"),
                ),
              if (item.isWaitingUserTask)
                OutlinedButton.icon(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.focusAction(item.id),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text("Reply in center"),
                ),
              if (item.isFederationPackage && (item.packageId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptFederationPackage(
                            item.packageId!,
                          ),
                  child: const Text("Adopt package"),
                ),
              if (item.isFederationPackage && (item.packageId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectFederationPackage(
                            item.packageId!,
                          ),
                  child: const Text("Reject package"),
                ),
              if (item.isFederationPackage)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.setPage(DesktopPage.federation),
                  child: const Text("Open federation"),
                ),
              if (item.isCoordinatorSuggestion)
                FilledButton(
                  onPressed:
                      shell.isRefreshing ||
                              !item.canMaterializeCoordinatorSuggestion
                          ? null
                          : () => controller.materializeCoordinatorSuggestion(
                            item.coordinatorSuggestionId!,
                          ),
                  child: Text(
                    item.canMaterializeCoordinatorSuggestion
                        ? "Materialize task"
                        : "Materialize blocked",
                  ),
                ),
              if (item.isCoordinatorSuggestion)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.setPage(DesktopPage.federation),
                  child: const Text("Open federation"),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RightWorkboard extends StatelessWidget {
  const _RightWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: switch (shell.page) {
          DesktopPage.home || DesktopPage.tasks => _TaskWorkboard(shell: shell),
          DesktopPage.memory => _MemoryWorkboard(shell: shell),
          DesktopPage.governance => _GovernanceWorkboard(shell: shell),
          DesktopPage.federation => _FederationWorkboard(shell: shell),
          DesktopPage.settings => _SettingsWorkboard(shell: shell),
        },
      ),
    );
  }
}

class _TaskWorkboard extends ConsumerWidget {
  const _TaskWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final selectedTask = shell.selectedTask;
    final task = asMap(selectedTask?["task"]);
    final runs = asMapList(selectedTask?["runs"]);
    final reviews = asMapList(selectedTask?["reviews"]);
    final activeSteps = asMapList(selectedTask?["activeSteps"]);
    final archivedSteps = asMapList(selectedTask?["archivedSteps"]);
    final selectedTaskId = asString(
      task["id"],
      shell.defaultTaskFocus?.id ?? "",
    );
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Task / execution workboard",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "The right side is the live execution surface: status, active steps, reviews, and checkpointed history.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            if (selectedTaskId.isNotEmpty) ...[
              OutlinedButton.icon(
                onPressed: () => controller.retryTask(selectedTaskId),
                icon: const Icon(Icons.replay),
                label: const Text("Retry"),
              ),
              const SizedBox(width: 10),
              OutlinedButton.icon(
                onPressed: () => controller.cancelTask(selectedTaskId),
                icon: const Icon(Icons.stop_circle_outlined),
                label: const Text("Cancel"),
              ),
            ],
          ],
        ),
        const SizedBox(height: 18),
        if (task.isNotEmpty)
          _SectionCard(
            title: asString(task["title"], "Selected task"),
            subtitle:
                "${asString(task["status"], "queued")} · ${asString(task["route"], "general")} · ${asString(task["worker"], "main")}",
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FactGrid(
                  items: [
                    ("Task ID", asString(task["id"])),
                    ("Priority", asString(task["priority"], "normal")),
                    (
                      "Next action",
                      asString(task["nextAction"], "None queued yet"),
                    ),
                    ("Updated", _formatTimestamp(asInt(task["updatedAt"]))),
                  ],
                ),
                const SizedBox(height: 12),
                if (asString(task["goal"]).isNotEmpty)
                  Text(
                    asString(task["goal"]),
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
              ],
            ),
          )
        else
          _SectionCard(
            title: "No task selected",
            subtitle:
                "Choose a task from the left rail or queue a new objective from the center pane.",
            child: Text(
              "The workboard becomes the canonical execution view once a task is materialized.",
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Active execution steps",
          subtitle:
              "These are the steps still in the live context window after compaction.",
          child:
              activeSteps.isEmpty
                  ? Text(
                    "No active steps in the current run.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                  : Column(
                    children: activeSteps
                        .map(
                          (step) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(
                                step["title"],
                                asString(step["kind"], "step"),
                              ),
                              subtitle: asString(
                                step["summary"],
                                asString(step["output"], "No output recorded"),
                              ),
                              trailing: _formatTimestamp(
                                asInt(step["updatedAt"]),
                              ),
                            ),
                          ),
                        )
                        .toList(growable: false),
                  ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Runs & reviews",
          subtitle:
              "The task loop keeps runs, reviews, and archive-backed steps visible instead of hiding them behind chat logs.",
          child: Column(
            children: [
              if (runs.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    "No runs recorded yet.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ...runs
                  .take(4)
                  .map(
                    (run) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _TimelineTile(
                        title: asString(run["id"], "run"),
                        subtitle:
                            "${asString(run["status"], "queued")} · ${asString(run["thinkingLane"], "system1")}",
                        trailing: _formatTimestamp(asInt(run["updatedAt"])),
                      ),
                    ),
                  ),
              if (reviews.isNotEmpty) ...[
                const Divider(height: 28),
                ...reviews
                    .take(3)
                    .map(
                      (review) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _TimelineTile(
                          title: asString(review["summary"], "Review"),
                          subtitle: asString(review["outcome"], "recorded"),
                          trailing: _formatTimestamp(
                            asInt(review["createdAt"]),
                          ),
                        ),
                      ),
                    ),
              ],
              if (archivedSteps.isNotEmpty) ...[
                const Divider(height: 28),
                Text(
                  "${archivedSteps.length} steps already compacted into the archive layer.",
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _MemoryWorkboard extends ConsumerWidget {
  const _MemoryWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final selectedTaskId = shell.selectedTaskSummary?.id;
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Memory / strategy workboard",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "ClawMark keeps formal memory and strategy visible, not buried under a single chat transcript.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed:
                  shell.isRefreshing
                      ? null
                      : () => controller.reviewMemoryLifecycle(),
              icon: const Icon(Icons.history_toggle_off),
              label: const Text("Run lifecycle review"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "Memory posture",
          subtitle:
              "Formal memory is runtime-owned truth, but operator governance actions stay local and explicit.",
          child: _FactGrid(
            items: [
              ("Formal memories", shell.memoryCount.toString()),
              ("Strategies", shell.strategyCount.toString()),
              (
                "Invalidated memories",
                shell.memories
                    .where(
                      (memory) =>
                          asStringList(memory["invalidatedBy"]).isNotEmpty,
                    )
                    .length
                    .toString(),
              ),
              ("Recent intel items", shell.intelRecentItems.length.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Memory kernel",
          subtitle:
              "${shell.memoryCount} formal memories · ${shell.strategyCount} strategies",
          child: Column(
            children:
                shell.memories.isEmpty
                    ? [
                      Text(
                        "No formal memories are visible right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.memories
                        .take(8)
                        .map((memory) {
                          final memoryId = asString(memory["id"]);
                          final invalidatedBy = asStringList(
                            memory["invalidatedBy"],
                          );
                          final latestInvalidation =
                              invalidatedBy.isEmpty ? "" : invalidatedBy.last;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(memory["summary"], "Memory"),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(
                                        label:
                                            invalidatedBy.isEmpty
                                                ? "active"
                                                : "invalidated",
                                        tone:
                                            invalidatedBy.isEmpty
                                                ? "adopted"
                                                : "blocked",
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "${asString(memory["memoryType"], "knowledge")} · ${asString(memory["route"], "general")} · ${asString(memory["scope"], "runtime")}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "confidence=${asString(memory["confidence"], "0")} · decay=${asString(memory["decayScore"], "0")} · updated=${_formatTimestamp(asInt(memory["updatedAt"]))}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  if (asString(
                                    memory["detail"],
                                  ).isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      asString(memory["detail"]),
                                      style:
                                          Theme.of(
                                            context,
                                          ).textTheme.bodyMedium,
                                    ),
                                  ],
                                  if (latestInvalidation.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      "Latest invalidation: $latestInvalidation",
                                      style:
                                          Theme.of(
                                            context,
                                          ).textTheme.bodyMedium,
                                    ),
                                  ],
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilledButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    memoryId.isEmpty
                                                ? null
                                                : () =>
                                                    controller.reinforceMemory(
                                                      memoryId,
                                                      sourceTaskId:
                                                          selectedTaskId,
                                                    ),
                                        child: const Text("Reinforce"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    memoryId.isEmpty ||
                                                    invalidatedBy.isNotEmpty
                                                ? null
                                                : () => controller
                                                    .invalidateMemory(memoryId),
                                        child: const Text("Invalidate"),
                                      ),
                                      if (latestInvalidation.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller
                                                      .rollbackMemoryInvalidation(
                                                        latestInvalidation,
                                                      ),
                                          child: const Text(
                                            "Rollback invalidation",
                                          ),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Strategy plane",
          subtitle:
              "Active route-level strategy remains inspectable from the desktop shell.",
          child: Column(
            children: shell.strategies
                .take(8)
                .map((strategy) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _TimelineTile(
                      title: asString(strategy["summary"], "Strategy"),
                      subtitle:
                          "${asString(strategy["route"], "general")} · ${asString(strategy["worker"], "main")}",
                      trailing: _formatTimestamp(asInt(strategy["updatedAt"])),
                    ),
                  );
                })
                .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Recent intel items",
          subtitle:
              "Intel stays a sidecar until you explicitly promote something into knowledge memory.",
          child: Column(
            children:
                shell.intelRecentItems.isEmpty
                    ? [
                      Text(
                        "No recent intel items are visible right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.intelRecentItems
                        .take(8)
                        .map((item) {
                          final intelId = asString(item["id"]);
                          final pinned = asBool(item["pinned"]);
                          final selected = asBool(item["selected"]);
                          final tone =
                              pinned
                                  ? "adopted"
                                  : selected
                                  ? "candidate"
                                  : "shadow";
                          final label =
                              pinned
                                  ? "pinned"
                                  : selected
                                  ? "selected"
                                  : "recent";
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(item["title"], "Intel item"),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: label, tone: tone),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "${asString(item["kind"], "candidate")} · ${asString(item["domain"], "ai")} · score=${asString(item["score"], "0")}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(item["summary"]),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilledButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    pinned ||
                                                    intelId.isEmpty
                                                ? null
                                                : () => controller
                                                    .pinIntelToKnowledge(
                                                      intelId,
                                                    ),
                                        child: Text(
                                          pinned
                                              ? "Already promoted"
                                              : "Promote to knowledge",
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
      ],
    );
  }
}

class _GovernanceWorkboard extends ConsumerStatefulWidget {
  const _GovernanceWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  ConsumerState<_GovernanceWorkboard> createState() =>
      _GovernanceWorkboardState();
}

class _GovernanceWorkboardState extends ConsumerState<_GovernanceWorkboard> {
  late final TextEditingController _agentNameController;
  late final TextEditingController _agentDescriptionController;
  late final TextEditingController _agentRoleBaseController;
  late final TextEditingController _agentMemoryNamespaceController;
  late final TextEditingController _agentSkillIdsController;
  late final TextEditingController _agentCommunicationStyleController;
  late final TextEditingController _agentNotesController;
  late final TextEditingController _surfaceChannelController;
  late final TextEditingController _surfaceAccountIdController;
  late final TextEditingController _surfaceLabelController;
  late final TextEditingController _surfaceRoleController;
  late final TextEditingController _surfaceBusinessGoalController;
  late final TextEditingController _surfaceToneController;
  late final TextEditingController _surfaceAllowedTopicsController;
  late final TextEditingController _surfaceRestrictedTopicsController;
  late final TextEditingController _surfaceRoleScopeController;

  String? _editingAgentId;
  bool _agentActive = true;
  String _agentReportPolicy = "reply";
  String? _editingSurfaceId;
  String _surfaceOwnerKind = "user";
  String _surfaceOwnerAgentId = "";
  bool _surfaceActive = true;
  String _surfaceInitiative = "medium";
  String _surfaceReportTarget = "runtime-user";
  String _surfaceTaskCreation = "recommend_only";
  String _surfaceEscalationTarget = "runtime-user";

  DesktopShellState get shell => widget.shell;

  @override
  void initState() {
    super.initState();
    _agentNameController = TextEditingController();
    _agentDescriptionController = TextEditingController();
    _agentRoleBaseController = TextEditingController();
    _agentMemoryNamespaceController = TextEditingController();
    _agentSkillIdsController = TextEditingController();
    _agentCommunicationStyleController = TextEditingController();
    _agentNotesController = TextEditingController();
    _surfaceChannelController = TextEditingController();
    _surfaceAccountIdController = TextEditingController();
    _surfaceLabelController = TextEditingController();
    _surfaceRoleController = TextEditingController();
    _surfaceBusinessGoalController = TextEditingController();
    _surfaceToneController = TextEditingController();
    _surfaceAllowedTopicsController = TextEditingController();
    _surfaceRestrictedTopicsController = TextEditingController();
    _surfaceRoleScopeController = TextEditingController();
    _syncFromShell();
  }

  @override
  void didUpdateWidget(covariant _GovernanceWorkboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shell.dashboard != widget.shell.dashboard) {
      _syncFromShell();
    }
  }

  @override
  void dispose() {
    _agentNameController.dispose();
    _agentDescriptionController.dispose();
    _agentRoleBaseController.dispose();
    _agentMemoryNamespaceController.dispose();
    _agentSkillIdsController.dispose();
    _agentCommunicationStyleController.dispose();
    _agentNotesController.dispose();
    _surfaceChannelController.dispose();
    _surfaceAccountIdController.dispose();
    _surfaceLabelController.dispose();
    _surfaceRoleController.dispose();
    _surfaceBusinessGoalController.dispose();
    _surfaceToneController.dispose();
    _surfaceAllowedTopicsController.dispose();
    _surfaceRestrictedTopicsController.dispose();
    _surfaceRoleScopeController.dispose();
    super.dispose();
  }

  Map<String, dynamic>? _rowById(
    List<Map<String, dynamic>> rows,
    String? id,
  ) {
    if ((id ?? "").isEmpty) {
      return null;
    }
    for (final row in rows) {
      if (asString(row["id"]) == id) {
        return row;
      }
    }
    return null;
  }

  List<String> _splitValues(String text) {
    final values = text
        .split(RegExp(r"[\n,]"))
        .map((entry) => entry.trim())
        .where((entry) => entry.isNotEmpty)
        .toList(growable: false);
    final seen = <String>{};
    final output = <String>[];
    for (final value in values) {
      final key = value.toLowerCase();
      if (seen.add(key)) {
        output.add(value);
      }
    }
    return output;
  }

  void _syncFromShell() {
    _resetAgentDraft(agentId: _editingAgentId);
    _resetSurfaceDraft(surfaceId: _editingSurfaceId);
  }

  void _resetAgentDraft({String? agentId}) {
    final record =
        _rowById(shell.agentRecords, agentId) ??
        (shell.agentRecords.isNotEmpty ? shell.agentRecords.first : null);
    final overlay = shell.agentOverlays
        .where((entry) => asString(entry["agentId"]) == asString(record?["id"]))
        .cast<Map<String, dynamic>?>()
        .firstOrNull;
    _editingAgentId = record == null ? null : asString(record["id"]);
    _agentNameController.text = asString(record?["name"]);
    _agentDescriptionController.text = asString(record?["description"]);
    _agentRoleBaseController.text = asString(record?["roleBase"]);
    _agentMemoryNamespaceController.text = asString(record?["memoryNamespace"]);
    _agentSkillIdsController.text = asStringList(record?["skillIds"]).join(", ");
    _agentCommunicationStyleController.text = asString(
      overlay?["communicationStyle"],
    );
    _agentNotesController.text = asString(overlay?["notes"]);
    _agentReportPolicy = asString(overlay?["reportPolicy"], "reply");
    _agentActive = record == null ? true : asBool(record["active"], true);
  }

  void _clearAgentDraft() {
    _editingAgentId = null;
    _agentNameController.clear();
    _agentDescriptionController.clear();
    _agentRoleBaseController.clear();
    _agentMemoryNamespaceController.clear();
    _agentSkillIdsController.clear();
    _agentCommunicationStyleController.clear();
    _agentNotesController.clear();
    _agentReportPolicy = "reply";
    _agentActive = true;
  }

  void _resetSurfaceDraft({String? surfaceId}) {
    final record =
        _rowById(shell.surfaceRecords, surfaceId) ??
        (shell.surfaceRecords.isNotEmpty ? shell.surfaceRecords.first : null);
    final status =
        _rowById(shell.surfaces, asString(record?["id"])) ??
        _rowById(shell.surfaces, surfaceId);
    _editingSurfaceId = record == null ? null : asString(record["id"]);
    _surfaceChannelController.text = asString(record?["channel"]);
    _surfaceAccountIdController.text = asString(record?["accountId"]);
    _surfaceLabelController.text = asString(record?["label"]);
    _surfaceOwnerKind = asString(record?["ownerKind"], "user");
    _surfaceOwnerAgentId = asString(record?["ownerId"]);
    _surfaceActive = record == null ? true : asBool(record["active"], true);
    _surfaceRoleController.text = asString(status?["role"]);
    _surfaceBusinessGoalController.text = asString(status?["businessGoal"]);
    _surfaceToneController.text = asString(status?["tone"]);
    _surfaceInitiative = asString(status?["initiative"], "medium");
    _surfaceReportTarget = asString(
      status?["reportTarget"],
      "runtime-user",
    );
    _surfaceAllowedTopicsController.text = asStringList(
      status?["allowedTopics"],
    ).join(", ");
    _surfaceRestrictedTopicsController.text = asStringList(
      status?["restrictedTopics"],
    ).join(", ");
    final localBusinessPolicy = asMap(status?["localBusinessPolicy"]);
    _surfaceTaskCreation = asString(
      localBusinessPolicy["taskCreation"],
      "recommend_only",
    );
    _surfaceEscalationTarget = asString(
      localBusinessPolicy["escalationTarget"],
      "runtime-user",
    );
    _surfaceRoleScopeController.text = asString(localBusinessPolicy["roleScope"]);
    if (_surfaceOwnerKind == "agent" &&
        _surfaceOwnerAgentId.isEmpty &&
        shell.agentRecords.isNotEmpty) {
      _surfaceOwnerAgentId = asString(shell.agentRecords.first["id"]);
    }
  }

  void _clearSurfaceDraft() {
    _editingSurfaceId = null;
    _surfaceChannelController.clear();
    _surfaceAccountIdController.clear();
    _surfaceLabelController.clear();
    _surfaceOwnerKind = "user";
    _surfaceOwnerAgentId = "";
    _surfaceActive = true;
    _surfaceRoleController.clear();
    _surfaceBusinessGoalController.clear();
    _surfaceToneController.clear();
    _surfaceInitiative = "medium";
    _surfaceReportTarget = "runtime-user";
    _surfaceAllowedTopicsController.clear();
    _surfaceRestrictedTopicsController.clear();
    _surfaceTaskCreation = "recommend_only";
    _surfaceEscalationTarget = "runtime-user";
    _surfaceRoleScopeController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.read(shellControllerProvider.notifier);
    final capabilitySection = shell.capabilitySection;
    final governanceStateCounts = asMap(
      capabilitySection["governanceStateCounts"],
    );
    final roleOptimizationActions = shell.actionQueue
        .where((entry) => entry.isRoleOptimization)
        .toList(growable: false);
    final selectedAgentStatus = _rowById(shell.agents, _editingAgentId);
    final selectedSurfaceStatus = _rowById(shell.surfaces, _editingSurfaceId);
    final activeAgentCount = shell.agentRecords
        .where((entry) => asBool(entry["active"], true))
        .length;
    final activeSurfaceCount = shell.surfaceRecords
        .where((entry) => asBool(entry["active"], true))
        .length;
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Governance workboard",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Candidate, adopted, shadow, and blocked capability state remains operator-visible.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed:
                  shell.isRefreshing
                      ? null
                      : () => controller.syncCapabilities(),
              icon: const Icon(Icons.sync),
              label: const Text("Sync registry"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "Governance posture",
          subtitle:
              "Runtime capability policy stays explicit, inspectable, and locally owned.",
          child: _FactGrid(
            items: [
              ("Preset", asString(capabilitySection["preset"], "managed_high")),
              ("Entries", shell.governanceEntries.length.toString()),
              ("MCP grants", shell.capabilityMcpGrants.length.toString()),
              ("Overlays", asString(capabilitySection["overlayCount"])),
              ("Agents", shell.agentRecords.length.toString()),
              ("Active agents", activeAgentCount.toString()),
              ("Surfaces", shell.surfaceRecords.length.toString()),
              ("Active surfaces", activeSurfaceCount.toString()),
              ("Blocked", asString(governanceStateCounts["blocked"], "0")),
              ("Shadow", asString(governanceStateCounts["shadow"], "0")),
              ("Candidate", asString(governanceStateCounts["candidate"], "0")),
              ("Adopted", asString(governanceStateCounts["adopted"], "0")),
              ("Core", asString(governanceStateCounts["core"], "0")),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Agent roster",
          subtitle:
              "${shell.agentRecords.length} runtime agents with governed local ownership.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  FilledButton.icon(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_clearAgentDraft),
                    icon: const Icon(Icons.person_add_alt_1_outlined),
                    label: const Text("New agent"),
                  ),
                  if ((_editingAgentId ?? "").isNotEmpty)
                    OutlinedButton.icon(
                      onPressed:
                          shell.isRefreshing
                              ? null
                              : () => setState(
                                () => _resetAgentDraft(agentId: _editingAgentId),
                              ),
                      icon: const Icon(Icons.refresh),
                      label: const Text("Reset draft"),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              if (shell.agents.isEmpty)
                Text(
                  "No runtime agents are defined yet.",
                  style: Theme.of(context).textTheme.bodyMedium,
                )
              else
                Column(
                  children: shell.agents.take(8).map((agent) {
                    final agentId = asString(agent["id"]);
                    final raw = _rowById(shell.agentRecords, agentId);
                    final selected = agentId == (_editingAgentId ?? "");
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          color:
                              selected
                                  ? const Color(0xFFEFE4D6)
                                  : const Color(0xFFF9F5EF),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    asString(agent["name"], "Agent"),
                                    style:
                                        Theme.of(context).textTheme.titleMedium,
                                  ),
                                ),
                                _StatusBadge(
                                  label:
                                      asBool(agent["active"], true)
                                          ? "active"
                                          : "inactive",
                                  tone:
                                      asBool(agent["active"], true)
                                          ? "adopted"
                                          : "blocked",
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              "${asString(agent["roleBase"], "No role base")} · ${asString(raw?["memoryNamespace"], "memory namespace auto")}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              "skills=${asString(raw?["skillIds"] is List ? (raw?["skillIds"] as List).length : 0)} · surfaces=${asString(agent["surfaceCount"], "0")} · open tasks=${asString(agent["openTaskCount"], "0")} · report=${asString(agent["reportPolicy"], "default")}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            if (asString(raw?["description"]).isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Text(
                                asString(raw?["description"]),
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                            ],
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                OutlinedButton(
                                  onPressed:
                                      shell.isRefreshing
                                          ? null
                                          : () => setState(
                                            () =>
                                                _resetAgentDraft(agentId: agentId),
                                          ),
                                  child: const Text("Edit"),
                                ),
                                if (asInt(agent["surfaceCount"]) > 0)
                                  OutlinedButton(
                                    onPressed:
                                        shell.isRefreshing
                                            ? null
                                            : () {
                                              final ownedSurface = shell.surfaceRecords
                                                  .where(
                                                    (surface) =>
                                                        asString(surface["ownerKind"]) ==
                                                            "agent" &&
                                                        asString(surface["ownerId"]) ==
                                                            agentId,
                                                  )
                                                  .cast<Map<String, dynamic>?>()
                                                  .firstOrNull;
                                              if (ownedSurface == null) {
                                                return;
                                              }
                                              setState(() {
                                                _resetSurfaceDraft(
                                                  surfaceId: asString(
                                                    ownedSurface["id"],
                                                  ),
                                                );
                                              });
                                            },
                                    child: const Text("Open surface"),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(growable: false),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Agent editor",
          subtitle:
              (_editingAgentId ?? "").isEmpty
                  ? "Create a new ecology agent without leaving the desktop operator surface."
                  : "Update the selected runtime agent and keep governance local.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: 240,
                    child: TextFormField(
                      controller: _agentNameController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Agent name",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 280,
                    child: TextFormField(
                      controller: _agentRoleBaseController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Role base",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 320,
                    child: TextFormField(
                      controller: _agentMemoryNamespaceController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Memory namespace",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _agentSkillIdsController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Skill IDs (comma separated)",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _agentCommunicationStyleController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Communication style",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("agent-report-policy-$_agentReportPolicy"),
                      initialValue: _agentReportPolicy,
                      decoration: const InputDecoration(
                        labelText: "Report policy",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items:
                          const [
                                "silent",
                                "reply",
                                "proactive",
                                "reply_and_proactive",
                              ]
                              .map(
                                (entry) => DropdownMenuItem<String>(
                                  value: entry,
                                  child: Text(entry),
                                ),
                              )
                              .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _agentReportPolicy = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 720,
                    child: TextFormField(
                      controller: _agentDescriptionController,
                      enabled: !shell.isRefreshing,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: "Description",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 720,
                    child: TextFormField(
                      controller: _agentNotesController,
                      enabled: !shell.isRefreshing,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: "Agent notes",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: 220,
                child: SwitchListTile.adaptive(
                  value: _agentActive,
                  onChanged:
                      shell.isRefreshing
                          ? null
                          : (value) => setState(() {
                            _agentActive = value;
                          }),
                  contentPadding: EdgeInsets.zero,
                  title: const Text("Agent active"),
                ),
              ),
              if ((_editingAgentId ?? "").isNotEmpty &&
                  selectedAgentStatus != null) ...[
                const SizedBox(height: 8),
                _FactGrid(
                  items: [
                    (
                      "Open tasks",
                      asString(selectedAgentStatus["openTaskCount"], "0"),
                    ),
                    (
                      "Waiting user",
                      asString(
                        selectedAgentStatus["waitingUserTaskCount"],
                        "0",
                      ),
                    ),
                    (
                      "Recent completions",
                      asString(
                        selectedAgentStatus["recentCompletionReportCount"],
                        "0",
                      ),
                    ),
                    (
                      "Recent intel",
                      asString(
                        selectedAgentStatus["recentIntelDeliveryCount"],
                        "0",
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing ||
                                _agentNameController.text.trim().isEmpty
                            ? null
                            : () => controller.upsertAgent(
                              agentId: _editingAgentId,
                              name: _agentNameController.text.trim(),
                              description: _agentDescriptionController.text,
                              roleBase: _agentRoleBaseController.text,
                              memoryNamespace:
                                  _agentMemoryNamespaceController.text,
                              skillIds: _splitValues(
                                _agentSkillIdsController.text,
                              ),
                              active: _agentActive,
                              communicationStyle:
                                  _agentCommunicationStyleController.text,
                              reportPolicy: _agentReportPolicy,
                              notes: _agentNotesController.text,
                            ),
                    child: Text(
                      (_editingAgentId ?? "").isEmpty
                          ? "Create agent"
                          : "Save agent",
                    ),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(
                              () => _resetAgentDraft(agentId: _editingAgentId),
                            ),
                    child: const Text("Reset"),
                  ),
                  if ((_editingAgentId ?? "").isNotEmpty)
                    OutlinedButton(
                      onPressed:
                          shell.isRefreshing
                              ? null
                              : () => controller.deleteAgent(
                                _editingAgentId!,
                              ),
                      child: const Text("Delete agent"),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Surface roster",
          subtitle:
              "${shell.surfaceRecords.length} local operator and agent-bound surfaces under runtime policy.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  FilledButton.icon(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_clearSurfaceDraft),
                    icon: const Icon(Icons.add_link_outlined),
                    label: const Text("New surface"),
                  ),
                  if ((_editingSurfaceId ?? "").isNotEmpty)
                    OutlinedButton.icon(
                      onPressed:
                          shell.isRefreshing
                              ? null
                              : () => setState(
                                () => _resetSurfaceDraft(
                                  surfaceId: _editingSurfaceId,
                                ),
                              ),
                      icon: const Icon(Icons.refresh),
                      label: const Text("Reset draft"),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              if (shell.surfaces.isEmpty)
                Text(
                  "No surfaces are defined yet.",
                  style: Theme.of(context).textTheme.bodyMedium,
                )
              else
                Column(
                  children: shell.surfaces.take(10).map((surface) {
                    final surfaceId = asString(surface["id"]);
                    final selected = surfaceId == (_editingSurfaceId ?? "");
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          color:
                              selected
                                  ? const Color(0xFFEFE4D6)
                                  : const Color(0xFFF9F5EF),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    asString(surface["label"], "Surface"),
                                    style:
                                        Theme.of(context).textTheme.titleMedium,
                                  ),
                                ),
                                _StatusBadge(
                                  label:
                                      asBool(surface["active"], true)
                                          ? "active"
                                          : "inactive",
                                  tone:
                                      asBool(surface["active"], true)
                                          ? "adopted"
                                          : "blocked",
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              "${asString(surface["channel"], "channel")} · ${asString(surface["accountId"], "account")} · ${asString(surface["ownerLabel"], "runtime user")}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              "${asString(surface["role"], "No role overlay")} · task creation=${asString(asMap(surface["localBusinessPolicy"])["taskCreation"], "recommend_only")} · escalation=${asString(surface["reportTarget"], "runtime-user")}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              "open tasks=${asString(surface["openTaskCount"], "0")} · waiting-user=${asString(surface["waitingUserTaskCount"], "0")} · coordinator pending=${asString(surface["pendingCoordinatorSuggestionCount"], "0")}",
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                OutlinedButton(
                                  onPressed:
                                      shell.isRefreshing
                                          ? null
                                          : () => setState(
                                            () => _resetSurfaceDraft(
                                              surfaceId: surfaceId,
                                            ),
                                          ),
                                  child: const Text("Edit"),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(growable: false),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Surface editor",
          subtitle:
              (_editingSurfaceId ?? "").isEmpty
                  ? "Bind a new surface to the desktop console or a specific agent."
                  : "Update ownership and routing metadata for the selected surface.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: 220,
                    child: TextFormField(
                      controller: _surfaceChannelController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Channel",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 280,
                    child: TextFormField(
                      controller: _surfaceAccountIdController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Account ID",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 320,
                    child: TextFormField(
                      controller: _surfaceLabelController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Surface label",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("surface-owner-kind-$_surfaceOwnerKind"),
                      initialValue: _surfaceOwnerKind,
                      decoration: const InputDecoration(
                        labelText: "Owner kind",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["user", "agent"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _surfaceOwnerKind = value;
                                  if (value == "agent" &&
                                      _surfaceOwnerAgentId.isEmpty &&
                                      shell.agentRecords.isNotEmpty) {
                                    _surfaceOwnerAgentId = asString(
                                      shell.agentRecords.first["id"],
                                    );
                                  }
                                });
                              },
                    ),
                  ),
                  if (_surfaceOwnerKind == "agent")
                    SizedBox(
                      width: 260,
                      child: DropdownButtonFormField<String>(
                        key: ValueKey("surface-owner-agent-$_surfaceOwnerAgentId"),
                        initialValue:
                            _surfaceOwnerAgentId.isEmpty
                                ? null
                                : _surfaceOwnerAgentId,
                        decoration: const InputDecoration(
                          labelText: "Owning agent",
                          filled: true,
                          fillColor: Color(0xFFF7F2EA),
                        ),
                        items: shell.agentRecords
                            .map(
                              (agent) => DropdownMenuItem<String>(
                                value: asString(agent["id"]),
                                child: Text(asString(agent["name"], "Agent")),
                              ),
                            )
                            .toList(growable: false),
                        onChanged:
                            shell.isRefreshing
                                ? null
                                : (value) {
                                  setState(() {
                                    _surfaceOwnerAgentId = value ?? "";
                                  });
                                },
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: 220,
                child: SwitchListTile.adaptive(
                  value: _surfaceActive,
                  onChanged:
                      shell.isRefreshing
                          ? null
                          : (value) => setState(() {
                            _surfaceActive = value;
                          }),
                  contentPadding: EdgeInsets.zero,
                  title: const Text("Surface active"),
                ),
              ),
              if ((_editingSurfaceId ?? "").isNotEmpty &&
                  selectedSurfaceStatus != null) ...[
                const SizedBox(height: 8),
                _FactGrid(
                  items: [
                    (
                      "Owner",
                      asString(selectedSurfaceStatus["ownerLabel"], "runtime"),
                    ),
                    (
                      "Role source",
                      asString(selectedSurfaceStatus["roleSource"], "derived"),
                    ),
                    (
                      "Open tasks",
                      asString(selectedSurfaceStatus["openTaskCount"], "0"),
                    ),
                    (
                      "Recent activity",
                      _formatTimestamp(
                        asInt(selectedSurfaceStatus["latestActivityAt"]),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing ||
                                _surfaceChannelController.text.trim().isEmpty ||
                                _surfaceAccountIdController.text.trim().isEmpty ||
                                _surfaceLabelController.text.trim().isEmpty ||
                                (_surfaceOwnerKind == "agent" &&
                                    _surfaceOwnerAgentId.isEmpty)
                            ? null
                            : () => controller.upsertSurface(
                              surfaceId: _editingSurfaceId,
                              channel: _surfaceChannelController.text.trim(),
                              accountId:
                                  _surfaceAccountIdController.text.trim(),
                              label: _surfaceLabelController.text.trim(),
                              ownerKind: _surfaceOwnerKind,
                              ownerId:
                                  _surfaceOwnerKind == "agent"
                                      ? _surfaceOwnerAgentId
                                      : null,
                              active: _surfaceActive,
                            ),
                    child: Text(
                      (_editingSurfaceId ?? "").isEmpty
                          ? "Create surface"
                          : "Save surface",
                    ),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(
                              () => _resetSurfaceDraft(
                                surfaceId: _editingSurfaceId,
                              ),
                            ),
                    child: const Text("Reset"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Surface role overlay",
          subtitle:
              (_editingSurfaceId ?? "").isEmpty
                  ? "Save a surface first, then promote a role overlay into local runtime truth."
                  : "Role, tone, topic bounds, and local-business policy stay allowlisted and runtime-owned.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: 260,
                    child: TextFormField(
                      controller: _surfaceRoleController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Role",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: TextFormField(
                      controller: _surfaceBusinessGoalController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Business goal",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 280,
                    child: TextFormField(
                      controller: _surfaceToneController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Tone",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("surface-initiative-$_surfaceInitiative"),
                      initialValue: _surfaceInitiative,
                      decoration: const InputDecoration(
                        labelText: "Initiative",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["low", "medium", "high"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing ||
                                  (_editingSurfaceId ?? "").isEmpty
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _surfaceInitiative = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey(
                        "surface-report-target-$_surfaceReportTarget",
                      ),
                      initialValue: _surfaceReportTarget,
                      decoration: const InputDecoration(
                        labelText: "Report target",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["runtime-user", "surface-owner"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing ||
                                  (_editingSurfaceId ?? "").isEmpty
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _surfaceReportTarget = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("surface-task-creation-$_surfaceTaskCreation"),
                      initialValue: _surfaceTaskCreation,
                      decoration: const InputDecoration(
                        labelText: "Task creation",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["recommend_only", "disabled"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing ||
                                  (_editingSurfaceId ?? "").isEmpty
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _surfaceTaskCreation = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey(
                        "surface-escalation-$_surfaceEscalationTarget",
                      ),
                      initialValue: _surfaceEscalationTarget,
                      decoration: const InputDecoration(
                        labelText: "Escalation target",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["runtime-user", "surface-owner"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing ||
                                  (_editingSurfaceId ?? "").isEmpty
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _surfaceEscalationTarget = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 320,
                    child: TextFormField(
                      controller: _surfaceRoleScopeController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Role scope",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 340,
                    child: TextFormField(
                      controller: _surfaceAllowedTopicsController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Allowed topics (comma separated)",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 340,
                    child: TextFormField(
                      controller: _surfaceRestrictedTopicsController,
                      enabled:
                          !shell.isRefreshing &&
                          (_editingSurfaceId ?? "").isNotEmpty,
                      decoration: const InputDecoration(
                        labelText: "Restricted topics (comma separated)",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing ||
                                (_editingSurfaceId ?? "").isEmpty ||
                                _surfaceRoleController.text.trim().isEmpty
                            ? null
                            : () => controller.upsertSurfaceRole(
                              surfaceId: _editingSurfaceId!,
                              role: _surfaceRoleController.text.trim(),
                              businessGoal: _surfaceBusinessGoalController.text,
                              tone: _surfaceToneController.text,
                              initiative: _surfaceInitiative,
                              allowedTopics: _splitValues(
                                _surfaceAllowedTopicsController.text,
                              ),
                              restrictedTopics: _splitValues(
                                _surfaceRestrictedTopicsController.text,
                              ),
                              reportTarget: _surfaceReportTarget,
                              taskCreation: _surfaceTaskCreation,
                              escalationTarget: _surfaceEscalationTarget,
                              roleScope: _surfaceRoleScopeController.text,
                            ),
                    child: const Text("Save overlay"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(
                              () => _resetSurfaceDraft(
                                surfaceId: _editingSurfaceId,
                              ),
                            ),
                    child: const Text("Reset overlay"),
                  ),
                ],
              ),
              if ((_editingSurfaceId ?? "").isNotEmpty &&
                  selectedSurfaceStatus != null) ...[
                const SizedBox(height: 12),
                _FactGrid(
                  items: [
                    (
                      "Overlay present",
                      asString(selectedSurfaceStatus["overlayPresent"]),
                    ),
                    (
                      "Role source",
                      asString(selectedSurfaceStatus["roleSource"], "derived"),
                    ),
                    (
                      "Tone source",
                      asString(selectedSurfaceStatus["toneSource"], "derived"),
                    ),
                    (
                      "Policy source",
                      asString(
                        selectedSurfaceStatus["localBusinessPolicySource"],
                        "derived",
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Evolution candidates",
          subtitle:
              "${shell.evolutionCandidates.length} candidates in the local queue",
          child: Column(
            children:
                shell.evolutionCandidates.isEmpty
                    ? [
                      Text(
                        "No evolution candidates are pending local review right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.evolutionCandidates
                        .take(8)
                        .map((candidate) {
                          final id = asString(candidate["id"]);
                          final state = asString(
                            candidate["state"],
                            "candidate",
                          );
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            candidate["summary"],
                                            "Evolution candidate",
                                          ),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: state, tone: state),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(
                                      candidate["estimatedImpact"],
                                      "Estimated impact not provided.",
                                    ),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilledButton(
                                        onPressed:
                                            shell.isRefreshing || id.isEmpty
                                                ? null
                                                : () => controller
                                                    .adoptEvolution(id),
                                        child: const Text("Adopt"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing || id.isEmpty
                                                ? null
                                                : () => controller
                                                    .rejectEvolution(id),
                                        child: const Text("Reject"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing || id.isEmpty
                                                ? null
                                                : () => controller
                                                    .revertEvolution(id),
                                        child: const Text("Revert"),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Role optimization queue",
          subtitle:
              "${roleOptimizationActions.length} operator-visible surface-role recommendations are pending in the action queue.",
          child: Column(
            children:
                roleOptimizationActions.isEmpty
                    ? [
                      Text(
                        "No role optimization actions are waiting right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : roleOptimizationActions
                        .take(6)
                        .map((action) {
                          final candidateId = action.candidateId ?? "";
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          action.title,
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(
                                        label: action.priority,
                                        tone: action.priority,
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    action.summary,
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilledButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    candidateId.isEmpty
                                                ? null
                                                : () => controller
                                                    .adoptRoleOptimization(
                                                      candidateId,
                                                    ),
                                        child: const Text("Adopt overlay"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    candidateId.isEmpty
                                                ? null
                                                : () => controller
                                                    .rejectRoleOptimization(
                                                      candidateId,
                                                    ),
                                        child: const Text("Reject overlay"),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Capability registry",
          subtitle:
              "${shell.governanceEntries.length} governed entries across skills, agents, and MCP.",
          child: Column(
            children:
                shell.governanceEntries.isEmpty
                    ? [
                      Text(
                        "No governed capability entries are visible in the runtime snapshot.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.governanceEntries
                        .take(10)
                        .map((entry) {
                          final entryId = asString(entry["id"]);
                          final registryType = asString(
                            entry["registryType"],
                            "skill",
                          );
                          final targetId = asString(entry["targetId"]);
                          final state = asString(entry["state"], "shadow");
                          const candidateStates = <String>[
                            "blocked",
                            "shadow",
                            "candidate",
                            "adopted",
                            "core",
                          ];
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          targetId.isEmpty ? "entry" : targetId,
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: state, tone: state),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "$registryType · ${asString(entry["executionSummary"], asString(entry["summary"], "governed"))}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    _formatTimestamp(asInt(entry["updatedAt"])),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: candidateStates
                                        .map(
                                          (stateValue) => FilterChip(
                                            label: Text(stateValue),
                                            selected: state == stateValue,
                                            onSelected:
                                                shell.isRefreshing ||
                                                        entryId.isEmpty ||
                                                        targetId.isEmpty
                                                    ? null
                                                    : (selected) {
                                                      if (!selected ||
                                                          state == stateValue) {
                                                        return;
                                                      }
                                                      controller
                                                          .setCapabilityEntryState(
                                                            entryId: entryId,
                                                            registryType:
                                                                registryType,
                                                            targetId: targetId,
                                                            stateValue:
                                                                stateValue,
                                                          );
                                                    },
                                          ),
                                        )
                                        .toList(growable: false),
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "MCP grants",
          subtitle:
              "${shell.capabilityMcpGrants.length} host-owned agent-to-MCP grants are currently visible.",
          child: Column(
            children:
                shell.capabilityMcpGrants.isEmpty
                    ? [
                      Text(
                        "No MCP grants are visible right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.capabilityMcpGrants
                        .take(10)
                        .map((grant) {
                          final grantId = asString(grant["id"]);
                          final agentId = asString(grant["agentId"]);
                          final mcpServerId = asString(grant["mcpServerId"]);
                          final state = asString(grant["state"], "denied");
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          "${asString(grant["agentLabel"], agentId)} -> $mcpServerId",
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: state, tone: state),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(grant["summary"]),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilterChip(
                                        label: const Text("allowed"),
                                        selected: state == "allowed",
                                        onSelected:
                                            shell.isRefreshing ||
                                                    grantId.isEmpty ||
                                                    agentId.isEmpty ||
                                                    mcpServerId.isEmpty
                                                ? null
                                                : (selected) {
                                                  if (!selected ||
                                                      state == "allowed") {
                                                    return;
                                                  }
                                                  controller.setMcpGrantState(
                                                    grantId: grantId,
                                                    agentId: agentId,
                                                    mcpServerId: mcpServerId,
                                                    stateValue: "allowed",
                                                  );
                                                },
                                      ),
                                      FilterChip(
                                        label: const Text("denied"),
                                        selected: state == "denied",
                                        onSelected:
                                            shell.isRefreshing ||
                                                    grantId.isEmpty ||
                                                    agentId.isEmpty ||
                                                    mcpServerId.isEmpty
                                                ? null
                                                : (selected) {
                                                  if (!selected ||
                                                      state == "denied") {
                                                    return;
                                                  }
                                                  controller.setMcpGrantState(
                                                    grantId: grantId,
                                                    agentId: agentId,
                                                    mcpServerId: mcpServerId,
                                                    stateValue: "denied",
                                                  );
                                                },
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Recent governance activity",
          subtitle:
              "Local governance changes and overlay effects stay visible instead of disappearing into logs.",
          child: Column(
            children:
                shell.capabilityRecentActivity.isEmpty
                    ? [
                      Text(
                        "No recent governance activity was found in the runtime snapshot.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.capabilityRecentActivity
                        .take(10)
                        .map((activity) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(activity["title"], "Activity"),
                              subtitle: asString(
                                activity["summary"],
                                asString(activity["kind"], "governance"),
                              ),
                              trailing: _formatTimestamp(
                                asInt(activity["updatedAt"]),
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
      ],
    );
  }
}

class _FederationWorkboard extends ConsumerWidget {
  const _FederationWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Federation workboard",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Sync is operator-governed and never bypasses local truth ownership.",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed: () => controller.syncFederation(),
              icon: const Icon(Icons.sync),
              label: const Text("Sync now"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "Remote posture",
          subtitle:
              "Loopback-controlled desktop shell, outbound federation sync.",
          child: _FactGrid(
            items: [
              (
                "Remote configured",
                asString(shell.federationSection["remoteConfigured"]),
              ),
              ("Pending outbox", shell.outboxPendingCount.toString()),
              (
                "Pending assignments",
                asString(shell.federationSection["pendingAssignments"]),
              ),
              (
                "Acknowledged head",
                asString(
                  shell.federationSection["acknowledgedOutboxEventId"],
                  "None",
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Inbox packages",
          subtitle:
              "${shell.federationPackages.length} package previews available from the runtime snapshot.",
          child: Column(
            children:
                shell.federationPackages.isEmpty
                    ? [
                      Text(
                        "No inbox packages are visible right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.federationPackages
                        .take(8)
                        .map((pkg) {
                          final packageId = asString(pkg["id"]);
                          final state = asString(pkg["state"], "received");
                          final payloadPreview = asStringList(
                            pkg["payloadPreview"],
                          );
                          final validationErrors = asStringList(
                            pkg["validationErrors"],
                          );
                          final localLandingSummary = asString(
                            pkg["localLandingSummary"],
                          );
                          final reviewSummary = asString(pkg["reviewSummary"]);
                          final actionable = asBool(pkg["actionable"]);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            pkg["summary"],
                                            asString(
                                              pkg["packageType"],
                                              "package",
                                            ),
                                          ),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: state, tone: state),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "${asString(pkg["packageType"], "package")} · ${asString(pkg["sourceRuntimeId"], "unknown-runtime")}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  if (reviewSummary.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      reviewSummary,
                                      style:
                                          Theme.of(
                                            context,
                                          ).textTheme.bodyMedium,
                                    ),
                                  ],
                                  if (localLandingSummary.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      localLandingSummary,
                                      style:
                                          Theme.of(
                                            context,
                                          ).textTheme.bodyMedium,
                                    ),
                                  ],
                                  if (payloadPreview.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    ...payloadPreview
                                        .take(3)
                                        .map(
                                          (line) => Padding(
                                            padding: const EdgeInsets.only(
                                              bottom: 4,
                                            ),
                                            child: Text(
                                              "• $line",
                                              style:
                                                  Theme.of(
                                                    context,
                                                  ).textTheme.bodyMedium,
                                            ),
                                          ),
                                        ),
                                  ],
                                  if (validationErrors.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    ...validationErrors
                                        .take(2)
                                        .map(
                                          (line) => Padding(
                                            padding: const EdgeInsets.only(
                                              bottom: 4,
                                            ),
                                            child: Text(
                                              line,
                                              style: Theme.of(
                                                context,
                                              ).textTheme.bodyMedium?.copyWith(
                                                color: const Color(0xFFA24634),
                                              ),
                                            ),
                                          ),
                                        ),
                                  ],
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      if (state == "recommended" &&
                                          packageId.isNotEmpty &&
                                          actionable)
                                        FilledButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller
                                                      .adoptFederationPackage(
                                                        packageId,
                                                      ),
                                          child: const Text("Adopt package"),
                                        ),
                                      if (state == "recommended" &&
                                          packageId.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller
                                                      .rejectFederationPackage(
                                                        packageId,
                                                      ),
                                          child: const Text("Reject package"),
                                        ),
                                      if (state == "adopted" &&
                                          packageId.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller
                                                      .revertFederationPackage(
                                                        packageId,
                                                      ),
                                          child: const Text("Revert package"),
                                        ),
                                      if (packageId.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller.focusAction(
                                                    "federation-package:$packageId",
                                                  ),
                                          child: const Text("Focus in queue"),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Coordinator suggestions",
          subtitle:
              "${shell.federationCoordinatorSuggestions.length} local coordinator suggestions are currently visible.",
          child: Column(
            children:
                shell.federationCoordinatorSuggestions.isEmpty
                    ? [
                      Text(
                        "No adopted coordinator suggestions are waiting in the local queue.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.federationCoordinatorSuggestions
                        .take(8)
                        .map((entry) {
                          final suggestionId = asString(entry["id"]);
                          final localTaskId = asString(entry["localTaskId"]);
                          final lastLocalTaskId = asString(
                            entry["lastLocalTaskId"],
                          );
                          final materializeTarget =
                              localTaskId.isNotEmpty
                                  ? localTaskId
                                  : lastLocalTaskId;
                          final rematerializeReason = asString(
                            entry["rematerializeReason"],
                          );
                          final localStatus = asString(
                            entry["localTaskStatus"],
                            localTaskId.isNotEmpty ? "materialized" : "queued",
                          );
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            entry["title"],
                                            "Coordinator suggestion",
                                          ),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(
                                        label: localStatus,
                                        tone: localStatus,
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(entry["summary"]),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "${asString(entry["sourceRuntimeId"], "unknown-runtime")} · localTask=${materializeTarget.isEmpty ? "none" : materializeTarget}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  if (rematerializeReason.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      rematerializeReason,
                                      style:
                                          Theme.of(
                                            context,
                                          ).textTheme.bodyMedium,
                                    ),
                                  ],
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      FilledButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    suggestionId.isEmpty
                                                ? null
                                                : () => controller
                                                    .materializeCoordinatorSuggestion(
                                                      suggestionId,
                                                    ),
                                        child: Text(
                                          materializeTarget.isEmpty
                                              ? "Materialize task"
                                              : "Open or rematerialize",
                                        ),
                                      ),
                                      if (materializeTarget.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () async {
                                                    await controller.focusTask(
                                                      materializeTarget,
                                                    );
                                                    await controller.setPage(
                                                      DesktopPage.tasks,
                                                    );
                                                  },
                                          child: const Text("Open task"),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Assignment inbox",
          subtitle:
              "${shell.federationAssignments.length} assignment previews are visible from the local federation assignment inbox.",
          child: Column(
            children:
                shell.federationAssignments.isEmpty
                    ? [
                      Text(
                        "No federation assignments are waiting right now.",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.federationAssignments
                        .take(8)
                        .map((entry) {
                          final assignmentId = asString(entry["id"]);
                          final state = asString(entry["state"], "pending");
                          final availableActions = asStringList(
                            entry["availableActions"],
                          );
                          final localTaskId = asString(entry["localTaskId"]);
                          final blockedReason = asString(
                            entry["blockedReason"],
                          );
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: const Color(0xFFF9F5EF),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            entry["title"],
                                            "Federation assignment",
                                          ),
                                          style:
                                              Theme.of(
                                                context,
                                              ).textTheme.titleMedium,
                                        ),
                                      ),
                                      _StatusBadge(label: state, tone: state),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(entry["summary"]),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "${asString(entry["sourceRuntimeId"], "unknown-runtime")} · ${asString(entry["route"], "route-unset")} · ${asString(entry["worker"], "worker-unset")}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  if (blockedReason.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      blockedReason,
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodyMedium?.copyWith(
                                        color: const Color(0xFFA24634),
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      if (availableActions.contains(
                                        "materialize",
                                      ))
                                        FilledButton(
                                          onPressed:
                                              shell.isRefreshing ||
                                                      assignmentId.isEmpty
                                                  ? null
                                                  : () => controller
                                                      .materializeFederationAssignment(
                                                        assignmentId,
                                                      ),
                                          child: const Text("Materialize"),
                                        ),
                                      if (availableActions.contains("block"))
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing ||
                                                      assignmentId.isEmpty
                                                  ? null
                                                  : () => controller
                                                      .blockFederationAssignment(
                                                        assignmentId,
                                                      ),
                                          child: const Text("Block"),
                                        ),
                                      if (availableActions.contains("reset"))
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing ||
                                                      assignmentId.isEmpty
                                                  ? null
                                                  : () => controller
                                                      .resetFederationAssignment(
                                                        assignmentId,
                                                      ),
                                          child: const Text("Reset"),
                                        ),
                                      if (availableActions.contains(
                                        "mark_applied",
                                      ))
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing ||
                                                      assignmentId.isEmpty
                                                  ? null
                                                  : () => controller
                                                      .markFederationAssignmentApplied(
                                                        assignmentId,
                                                      ),
                                          child: const Text("Mark applied"),
                                        ),
                                      if (localTaskId.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () async {
                                                    await controller.focusTask(
                                                      localTaskId,
                                                    );
                                                    await controller.setPage(
                                                      DesktopPage.tasks,
                                                    );
                                                  },
                                          child: const Text("Open task"),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
      ],
    );
  }
}

class _SettingsWorkboard extends ConsumerStatefulWidget {
  const _SettingsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  ConsumerState<_SettingsWorkboard> createState() => _SettingsWorkboardState();
}

class _SettingsWorkboardState extends ConsumerState<_SettingsWorkboard> {
  late final TextEditingController _displayNameController;
  late final TextEditingController _communicationStyleController;
  late final TextEditingController _maxInputTokensController;
  late final TextEditingController _maxContextCharsController;
  late final TextEditingController _compactionWatermarkController;
  late final TextEditingController _maxRemoteCallsController;
  late final TextEditingController _reviewIntervalHoursController;
  late final TextEditingController _refreshMinutesController;
  late final TextEditingController _dailyPushItemCountController;
  late final TextEditingController _dailyPushHourController;
  late final TextEditingController _dailyPushMinuteController;
  late final TextEditingController _instantPushMinScoreController;

  String _userInterruptionThreshold = "medium";
  String _userReportVerbosity = "balanced";
  String _userConfirmationBoundary = "balanced";
  String _userReportPolicy = "reply";
  String _taskBudgetMode = "balanced";
  String _taskRetrievalMode = "light";
  bool _evolutionEnabled = true;
  bool _autoApplyLowRisk = false;
  bool _autoCanaryEvolution = false;
  bool _intelEnabled = true;
  bool _intelDigestEnabled = true;
  bool _dailyPushEnabled = false;
  bool _instantPushEnabled = false;
  Set<String> _enabledIntelDomainIds = <String>{};

  @override
  void initState() {
    super.initState();
    _displayNameController = TextEditingController();
    _communicationStyleController = TextEditingController();
    _maxInputTokensController = TextEditingController();
    _maxContextCharsController = TextEditingController();
    _compactionWatermarkController = TextEditingController();
    _maxRemoteCallsController = TextEditingController();
    _reviewIntervalHoursController = TextEditingController();
    _refreshMinutesController = TextEditingController();
    _dailyPushItemCountController = TextEditingController();
    _dailyPushHourController = TextEditingController();
    _dailyPushMinuteController = TextEditingController();
    _instantPushMinScoreController = TextEditingController();
    _syncFromShell();
  }

  @override
  void didUpdateWidget(covariant _SettingsWorkboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shell.settings != widget.shell.settings ||
        oldWidget.shell.dashboard != widget.shell.dashboard) {
      _syncFromShell();
    }
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    _communicationStyleController.dispose();
    _maxInputTokensController.dispose();
    _maxContextCharsController.dispose();
    _compactionWatermarkController.dispose();
    _maxRemoteCallsController.dispose();
    _reviewIntervalHoursController.dispose();
    _refreshMinutesController.dispose();
    _dailyPushItemCountController.dispose();
    _dailyPushHourController.dispose();
    _dailyPushMinuteController.dispose();
    _instantPushMinScoreController.dispose();
    super.dispose();
  }

  void _syncFromShell() {
    final userModel = widget.shell.userModel;
    final taskDefaults = asMap(widget.shell.settings["taskDefaults"]);
    final evolution = asMap(widget.shell.settings["evolution"]);
    final intel = widget.shell.intelSection;
    final enabledDomainIds = asStringList(intel["enabledDomainIds"]);
    final domainRows = asMapList(intel["domains"]);
    final fallbackDomainIds =
        domainRows
            .where((entry) => asBool(entry["enabled"]))
            .map((entry) => asString(entry["id"]))
            .where((entry) => entry.isNotEmpty)
            .toSet();

    _displayNameController.text = asString(userModel["displayName"]);
    _communicationStyleController.text = asString(
      userModel["communicationStyle"],
    );
    _userInterruptionThreshold = asString(
      userModel["interruptionThreshold"],
      _userInterruptionThreshold,
    );
    _userReportVerbosity = asString(
      userModel["reportVerbosity"],
      _userReportVerbosity,
    );
    _userConfirmationBoundary = asString(
      userModel["confirmationBoundary"],
      _userConfirmationBoundary,
    );
    _userReportPolicy = asString(userModel["reportPolicy"], _userReportPolicy);

    _taskBudgetMode = asString(
      taskDefaults["defaultBudgetMode"],
      _taskBudgetMode,
    );
    _taskRetrievalMode = asString(
      taskDefaults["defaultRetrievalMode"],
      _taskRetrievalMode,
    );
    _maxInputTokensController.text = asString(
      taskDefaults["maxInputTokensPerTurn"],
    );
    _maxContextCharsController.text = asString(taskDefaults["maxContextChars"]);
    _compactionWatermarkController.text = asString(
      taskDefaults["compactionWatermark"],
    );
    _maxRemoteCallsController.text = asString(
      taskDefaults["maxRemoteCallsPerTask"],
    );

    _evolutionEnabled = asBool(evolution["enabled"], _evolutionEnabled);
    _autoApplyLowRisk = asBool(
      evolution["autoApplyLowRisk"],
      _autoApplyLowRisk,
    );
    _autoCanaryEvolution = asBool(
      evolution["autoCanaryEvolution"],
      _autoCanaryEvolution,
    );
    _reviewIntervalHoursController.text = asString(
      evolution["reviewIntervalHours"],
    );

    _intelEnabled = asBool(intel["enabled"], _intelEnabled);
    _intelDigestEnabled = asBool(intel["digestEnabled"], _intelDigestEnabled);
    _dailyPushEnabled = asBool(intel["dailyPushEnabled"], _dailyPushEnabled);
    _instantPushEnabled = asBool(
      intel["instantPushEnabled"],
      _instantPushEnabled,
    );
    _refreshMinutesController.text = asString(intel["refreshMinutes"]);
    _dailyPushItemCountController.text = asString(intel["dailyPushItemCount"]);
    _dailyPushHourController.text = asString(intel["dailyPushHourLocal"]);
    _dailyPushMinuteController.text = asString(intel["dailyPushMinuteLocal"]);
    _instantPushMinScoreController.text = asString(
      intel["instantPushMinScore"],
    );
    _enabledIntelDomainIds =
        enabledDomainIds.isNotEmpty
            ? enabledDomainIds.toSet()
            : fallbackDomainIds;
  }

  int _readInt(
    TextEditingController controller,
    int fallback, {
    int? min,
    int? max,
  }) {
    final parsed = int.tryParse(controller.text.trim());
    var value = parsed ?? fallback;
    if (min != null && value < min) {
      value = min;
    }
    if (max != null && value > max) {
      value = max;
    }
    return value;
  }

  @override
  Widget build(BuildContext context) {
    final shell = widget.shell;
    final controller = ref.read(shellControllerProvider.notifier);
    final taskDefaults = asMap(shell.settings["taskDefaults"]);
    final capabilities = asMap(shell.settings["capabilities"]);
    final gateway = asMap(shell.settings["gateway"]);
    final userModel = shell.userModel;
    final userModelMirror = shell.userModelMirror;
    final evolution = asMap(shell.settings["evolution"]);
    final intel = shell.intelSection;
    final intelDomainRows = asMapList(intel["domains"]);
    final primaryUserModelAction =
        shell.actionQueue
            .where((entry) => entry.isUserModelOptimization)
            .cast<ActionQueueItem?>()
            .firstOrNull;
    final primaryUserModelCandidateId =
        primaryUserModelAction?.candidateId ?? "";
    final pendingImport = asBool(userModelMirror["pendingImport"]);
    final syncNeeded = asBool(userModelMirror["syncNeeded"]);
    return ListView(
      children: [
        Text(
          "Settings workboard",
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 8),
        Text(
          "These are runtime-owned settings surfaced through the desktop console, not local UI truth.",
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "Runtime user model",
          subtitle:
              "Long-term operator preferences stay in Runtime Core and can be updated through reviewed proposals.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  (
                    "Display name",
                    asString(userModel["displayName"], "Not set"),
                  ),
                  (
                    "Communication style",
                    asString(userModel["communicationStyle"], "Not set"),
                  ),
                  (
                    "Interruption threshold",
                    asString(userModel["interruptionThreshold"], "Not set"),
                  ),
                  (
                    "Report verbosity",
                    asString(userModel["reportVerbosity"], "Not set"),
                  ),
                  (
                    "Confirmation boundary",
                    asString(userModel["confirmationBoundary"], "Not set"),
                  ),
                  (
                    "Report policy",
                    asString(userModel["reportPolicy"], "Not set"),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: 220,
                    child: TextFormField(
                      controller: _displayNameController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Display name",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _communicationStyleController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "Communication style",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey(
                        "user-interruption-$_userInterruptionThreshold",
                      ),
                      initialValue: _userInterruptionThreshold,
                      decoration: const InputDecoration(
                        labelText: "Interruption threshold",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["low", "medium", "high"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _userInterruptionThreshold = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("user-verbosity-$_userReportVerbosity"),
                      initialValue: _userReportVerbosity,
                      decoration: const InputDecoration(
                        labelText: "Report verbosity",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["brief", "balanced", "detailed"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _userReportVerbosity = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey(
                        "user-confirmation-$_userConfirmationBoundary",
                      ),
                      initialValue: _userConfirmationBoundary,
                      decoration: const InputDecoration(
                        labelText: "Confirmation boundary",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["strict", "balanced", "light"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _userConfirmationBoundary = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("user-report-policy-$_userReportPolicy"),
                      initialValue: _userReportPolicy,
                      decoration: const InputDecoration(
                        labelText: "Report policy",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const [
                            "silent",
                            "reply",
                            "proactive",
                            "reply_and_proactive",
                          ]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _userReportPolicy = value;
                                });
                              },
                    ),
                  ),
                ],
              ),
              if (primaryUserModelAction != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton(
                      onPressed:
                          shell.isRefreshing ||
                                  primaryUserModelCandidateId.isEmpty
                              ? null
                              : () => controller.adoptUserModelOptimization(
                                primaryUserModelCandidateId,
                              ),
                      child: const Text("Adopt top recommendation"),
                    ),
                    OutlinedButton(
                      onPressed:
                          shell.isRefreshing ||
                                  primaryUserModelCandidateId.isEmpty
                              ? null
                              : () => controller.rejectUserModelOptimization(
                                primaryUserModelCandidateId,
                              ),
                      child: const Text("Reject recommendation"),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.updateUserModel(
                              displayName: _displayNameController.text,
                              communicationStyle:
                                  _communicationStyleController.text,
                              interruptionThreshold: _userInterruptionThreshold,
                              reportVerbosity: _userReportVerbosity,
                              confirmationBoundary: _userConfirmationBoundary,
                              reportPolicy: _userReportPolicy,
                            ),
                    child: const Text("Apply user model"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_syncFromShell),
                    child: const Text("Reset draft"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "USER.md mirror",
          subtitle:
              "The human-editable mirror stays secondary to runtime truth and surfaces import pressure here instead of silently overwriting the core model.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  (
                    "Mirror path",
                    asString(userModelMirror["path"], "Unavailable"),
                  ),
                  (
                    "Pending import",
                    asString(userModelMirror["pendingImport"], "false"),
                  ),
                  (
                    "Sync needed",
                    asString(userModelMirror["syncNeeded"], "false"),
                  ),
                  (
                    "Last modified",
                    _formatTimestamp(asInt(userModelMirror["lastModifiedAt"])),
                  ),
                  (
                    "Recommended user-model changes",
                    shell.recommendedUserModelOptimizationCount.toString(),
                  ),
                  (
                    "Recommended role changes",
                    shell.recommendedRoleOptimizationCount.toString(),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing || !pendingImport
                            ? null
                            : () => controller.importUserModelMirror(),
                    child: const Text("Import pending mirror"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing || (!pendingImport && !syncNeeded)
                            ? null
                            : () => controller.discardPendingUserModelMirror(),
                    child: const Text("Discard and resync"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Instance roots",
          subtitle:
              "All stores stay instance-rooted and desktop initialization should keep them invisible to the operator by default.",
          child: _FactGrid(
            items: [
              (
                "Instance root",
                asString(shell.instanceSection["instanceRoot"]),
              ),
              (
                "Workspace root",
                asString(shell.instanceSection["workspaceRoot"]),
              ),
              ("Log root", asString(shell.instanceSection["logRoot"])),
              ("Gateway URL", asString(gateway["url"])),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Task loop defaults",
          subtitle:
              "Runtime control stays local even when the desktop app owns the outer shell.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  (
                    "Default budget",
                    asString(taskDefaults["defaultBudgetMode"]),
                  ),
                  (
                    "Default retrieval",
                    asString(taskDefaults["defaultRetrievalMode"]),
                  ),
                  (
                    "Max input tokens",
                    asString(taskDefaults["maxInputTokensPerTurn"]),
                  ),
                  (
                    "Max context chars",
                    asString(taskDefaults["maxContextChars"]),
                  ),
                  (
                    "Compaction watermark",
                    asString(taskDefaults["compactionWatermark"]),
                  ),
                  (
                    "Max remote calls",
                    asString(taskDefaults["maxRemoteCallsPerTask"]),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("task-budget-$_taskBudgetMode"),
                      initialValue: _taskBudgetMode,
                      decoration: const InputDecoration(
                        labelText: "Budget mode",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["strict", "balanced", "deep"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _taskBudgetMode = value;
                                });
                              },
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("task-retrieval-$_taskRetrievalMode"),
                      initialValue: _taskRetrievalMode,
                      decoration: const InputDecoration(
                        labelText: "Retrieval mode",
                        filled: true,
                        fillColor: Color(0xFFF7F2EA),
                      ),
                      items: const ["off", "light", "deep"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(entry),
                            ),
                          )
                          .toList(growable: false),
                      onChanged:
                          shell.isRefreshing
                              ? null
                              : (value) {
                                if (value == null) {
                                  return;
                                }
                                setState(() {
                                  _taskRetrievalMode = value;
                                });
                              },
                    ),
                  ),
                  _SettingsNumberField(
                    controller: _maxInputTokensController,
                    label: "Max input tokens",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _maxContextCharsController,
                    label: "Max context chars",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _compactionWatermarkController,
                    label: "Compaction watermark",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _maxRemoteCallsController,
                    label: "Max remote calls",
                    enabled: !shell.isRefreshing,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.configureTaskDefaults(
                              defaultBudgetMode: _taskBudgetMode,
                              defaultRetrievalMode: _taskRetrievalMode,
                              maxInputTokensPerTurn: _readInt(
                                _maxInputTokensController,
                                asInt(taskDefaults["maxInputTokensPerTurn"]),
                                min: 1,
                              ),
                              maxContextChars: _readInt(
                                _maxContextCharsController,
                                asInt(taskDefaults["maxContextChars"]),
                                min: 1,
                              ),
                              compactionWatermark: _readInt(
                                _compactionWatermarkController,
                                asInt(taskDefaults["compactionWatermark"]),
                                min: 1,
                              ),
                              maxRemoteCallsPerTask: _readInt(
                                _maxRemoteCallsController,
                                asInt(taskDefaults["maxRemoteCallsPerTask"]),
                                min: 1,
                              ),
                            ),
                    child: const Text("Apply task defaults"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_syncFromShell),
                    child: const Text("Reset draft"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Evolution controls",
          subtitle:
              "Local review stays sovereign by default. Candidate promotion and canary posture remain operator-governed.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("Enabled", asString(evolution["enabled"])),
                  (
                    "Auto-apply low risk",
                    asString(evolution["autoApplyLowRisk"]),
                  ),
                  (
                    "Auto canary evolution",
                    asString(evolution["autoCanaryEvolution"]),
                  ),
                  (
                    "Review interval (hours)",
                    asString(evolution["reviewIntervalHours"]),
                  ),
                  (
                    "Pending candidates",
                    shell.evolutionCandidates.length.toString(),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _SettingsToggleTile(
                    label: "Evolution enabled",
                    subtitle: "Keep the review/distill loop active locally.",
                    value: _evolutionEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _evolutionEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "Auto-apply low risk",
                    subtitle:
                        "Only low-risk paths can move without extra review.",
                    value: _autoApplyLowRisk,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _autoApplyLowRisk = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "Auto canary evolution",
                    subtitle:
                        "Allow shadow-then-canary promotion for unattended paths.",
                    value: _autoCanaryEvolution,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _autoCanaryEvolution = value;
                        }),
                  ),
                  _SettingsNumberField(
                    controller: _reviewIntervalHoursController,
                    label: "Review interval (hours)",
                    enabled: !shell.isRefreshing,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.configureEvolutionControls(
                              enabled: _evolutionEnabled,
                              autoApplyLowRisk: _autoApplyLowRisk,
                              autoCanaryEvolution: _autoCanaryEvolution,
                              reviewIntervalHours: _readInt(
                                _reviewIntervalHoursController,
                                asInt(evolution["reviewIntervalHours"]),
                                min: 1,
                                max: 168,
                              ),
                            ),
                    child: const Text("Apply evolution controls"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.runEvolutionReview(),
                    child: const Text("Run review now"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Intel controls",
          subtitle:
              "News/info remains a sidecar module. You can tune cadence and delivery without turning it into runtime truth.",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("Enabled", asString(intel["enabled"])),
                  ("Digest enabled", asString(intel["digestEnabled"])),
                  ("Refresh minutes", asString(intel["refreshMinutes"])),
                  (
                    "Daily push",
                    "${asString(intel["dailyPushEnabled"])} @ ${asString(intel["dailyPushHourLocal"]).padLeft(2, "0")}:${asString(intel["dailyPushMinuteLocal"]).padLeft(2, "0")}",
                  ),
                  (
                    "Instant push",
                    "${asString(intel["instantPushEnabled"])} @ score ${asString(intel["instantPushMinScore"])}",
                  ),
                  (
                    "Pending deliveries",
                    "${asString(intel["pendingDailyDigestCount"])} daily / ${asString(intel["pendingInstantAlertCount"])} instant",
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _SettingsToggleTile(
                    label: "Intel enabled",
                    subtitle:
                        "Allow the sidecar to fetch and rank operator intel.",
                    value: _intelEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _intelEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "Digest enabled",
                    subtitle: "Permit digest assembly and scheduled dispatch.",
                    value: _intelDigestEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _intelDigestEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "Daily push",
                    subtitle: "Send scheduled local digest deliveries.",
                    value: _dailyPushEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _dailyPushEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "Instant push",
                    subtitle: "Send urgent high-score bulletins immediately.",
                    value: _instantPushEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _instantPushEnabled = value;
                        }),
                  ),
                  _SettingsNumberField(
                    controller: _refreshMinutesController,
                    label: "Refresh minutes",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushItemCountController,
                    label: "Daily push item count",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushHourController,
                    label: "Daily push hour",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushMinuteController,
                    label: "Daily push minute",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _instantPushMinScoreController,
                    label: "Instant push min score",
                    enabled: !shell.isRefreshing,
                  ),
                ],
              ),
              if (intelDomainRows.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  "Enabled intel domains",
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: intelDomainRows
                      .map((domain) {
                        final domainId = asString(domain["id"]);
                        final selected = _enabledIntelDomainIds.contains(
                          domainId,
                        );
                        return FilterChip(
                          label: Text(asString(domain["label"], domainId)),
                          selected: selected,
                          onSelected:
                              shell.isRefreshing || domainId.isEmpty
                                  ? null
                                  : (value) {
                                    setState(() {
                                      if (value) {
                                        _enabledIntelDomainIds = <String>{
                                          ..._enabledIntelDomainIds,
                                          domainId,
                                        };
                                        return;
                                      }
                                      if (_enabledIntelDomainIds.length == 1 &&
                                          _enabledIntelDomainIds.contains(
                                            domainId,
                                          )) {
                                        return;
                                      }
                                      _enabledIntelDomainIds =
                                          _enabledIntelDomainIds
                                              .where(
                                                (entry) => entry != domainId,
                                              )
                                              .toSet();
                                    });
                                  },
                        );
                      })
                      .toList(growable: false),
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.configureIntelControls(
                              enabled: _intelEnabled,
                              digestEnabled: _intelDigestEnabled,
                              refreshMinutes: _readInt(
                                _refreshMinutesController,
                                asInt(intel["refreshMinutes"]),
                                min: 5,
                                max: 1440,
                              ),
                              enabledDomainIds:
                                  _enabledIntelDomainIds.isEmpty
                                      ? asStringList(intel["enabledDomainIds"])
                                      : _enabledIntelDomainIds.toList(
                                        growable: false,
                                      ),
                              dailyPushEnabled: _dailyPushEnabled,
                              dailyPushItemCount: _readInt(
                                _dailyPushItemCountController,
                                asInt(intel["dailyPushItemCount"]),
                                min: 1,
                                max: 50,
                              ),
                              dailyPushHourLocal: _readInt(
                                _dailyPushHourController,
                                asInt(intel["dailyPushHourLocal"]),
                                min: 0,
                                max: 23,
                              ),
                              dailyPushMinuteLocal: _readInt(
                                _dailyPushMinuteController,
                                asInt(intel["dailyPushMinuteLocal"]),
                                min: 0,
                                max: 59,
                              ),
                              instantPushEnabled: _instantPushEnabled,
                              instantPushMinScore: _readInt(
                                _instantPushMinScoreController,
                                asInt(intel["instantPushMinScore"]),
                                min: 1,
                                max: 100,
                              ),
                            ),
                    child: const Text("Apply intel controls"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.refreshIntel(),
                    child: const Text("Refresh intel now"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.dispatchIntelDeliveries(),
                    child: const Text("Dispatch deliveries"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Capability posture",
          subtitle:
              "The desktop shell reads governance posture from runtime-owned settings.",
          child: _FactGrid(
            items: [
              ("Preset", asString(capabilities["preset"])),
              ("Sandbox mode", asString(capabilities["sandboxMode"])),
              ("Browser enabled", asString(capabilities["browserEnabled"])),
              ("Workspace root", asString(capabilities["workspaceRoot"])),
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsNumberField extends StatelessWidget {
  const _SettingsNumberField({
    required this.controller,
    required this.label,
    required this.enabled,
  });

  final TextEditingController controller;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 220,
      child: TextFormField(
        controller: controller,
        enabled: enabled,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          labelText: label,
          filled: true,
          fillColor: const Color(0xFFF7F2EA),
        ),
      ),
    );
  }
}

class _SettingsToggleTile extends StatelessWidget {
  const _SettingsToggleTile({
    required this.label,
    required this.subtitle,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final String subtitle;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 260,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F2EA),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Switch.adaptive(
              value: value,
              onChanged: enabled ? onChanged : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadinessRow extends StatelessWidget {
  const _ReadinessRow({
    required this.ready,
    required this.title,
    required this.summary,
  });

  final bool ready;
  final String title;
  final String summary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            ready ? Icons.check_circle_outline : Icons.error_outline,
            size: 20,
            color: ready ? const Color(0xFF3A6E48) : const Color(0xFFA24634),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(summary, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F2EA),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodyMedium),
              Text(value, style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
        ],
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          color: selected ? const Color(0xFF1E1D19) : const Color(0xFFF7F2EA),
        ),
        child: Row(
          children: [
            Icon(icon, color: selected ? Colors.white : null),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: selected ? Colors.white : null,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: selected ? Colors.white70 : null,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ObjectTile extends StatelessWidget {
  const _ObjectTile({
    required this.title,
    required this.subtitle,
    required this.badge,
    required this.highlighted,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final String badge;
  final bool highlighted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color:
              highlighted ? const Color(0xFFEAD8D1) : const Color(0xFFF9F5EF),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(width: 8),
                _StatusBadge(label: badge, tone: badge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _TimelineTile extends StatelessWidget {
  const _TimelineTile({
    required this.title,
    required this.subtitle,
    required this.trailing,
  });

  final String title;
  final String subtitle;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 10,
          height: 10,
          margin: const EdgeInsets.only(top: 6),
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: Color(0xFFBB5A37),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Text(trailing, style: Theme.of(context).textTheme.bodyMedium),
      ],
    );
  }
}

class _FactGrid extends StatelessWidget {
  const _FactGrid({required this.items});

  final List<(String, String)> items;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: items
          .map(
            (item) => SizedBox(
              width: 220,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F2EA),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.$1,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      item.$2.isEmpty ? "—" : item.$2,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ),
            ),
          )
          .toList(growable: false),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.label, required this.tone});

  final String label;
  final String tone;

  @override
  Widget build(BuildContext context) {
    final palette = _toneToPalette(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.$1,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: palette.$2,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

(Color, Color) _toneToPalette(String tone) {
  switch (tone) {
    case "high":
    case "blocked":
    case "cancelled":
    case "reverted":
      return (const Color(0xFFF8D9D0), const Color(0xFF9C3824));
    case "medium":
    case "waiting_user":
    case "waiting_external":
    case "candidate":
      return (const Color(0xFFF6E7C7), const Color(0xFF8E5A08));
    case "low":
    case "completed":
    case "adopted":
    case "core":
      return (const Color(0xFFD9EEDB), const Color(0xFF2D6A39));
    default:
      return (const Color(0xFFE7E3DA), const Color(0xFF5A564D));
  }
}

String _formatBytes(int bytes) {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = <String>["B", "KB", "MB", "GB", "TB"];
  var value = bytes.toDouble();
  var unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  final fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return "${value.toStringAsFixed(fractionDigits)} ${units[unitIndex]}";
}

String _formatDuration(int milliseconds) {
  if (milliseconds <= 0) {
    return "0s";
  }
  final duration = Duration(milliseconds: milliseconds);
  if (duration.inHours >= 1) {
    final minutes = duration.inMinutes.remainder(60);
    return "${duration.inHours}h ${minutes}m";
  }
  if (duration.inMinutes >= 1) {
    final seconds = duration.inSeconds.remainder(60);
    return "${duration.inMinutes}m ${seconds}s";
  }
  return "${duration.inSeconds}s";
}

String _formatTimestamp(int value) {
  if (value <= 0) {
    return "—";
  }
  final dateTime = DateTime.fromMillisecondsSinceEpoch(value).toLocal();
  final month = dateTime.month.toString().padLeft(2, "0");
  final day = dateTime.day.toString().padLeft(2, "0");
  final hour = dateTime.hour.toString().padLeft(2, "0");
  final minute = dateTime.minute.toString().padLeft(2, "0");
  return "$month-$day $hour:$minute";
}

extension _FirstOrNullExtension<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    if (!iterator.moveNext()) {
      return null;
    }
    return iterator.current;
  }
}
