import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'desktop_design.dart';
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
      "user_model_optimization" => DesktopPage.config,
      "role_optimization" => DesktopPage.execApprovals,
      "evolution_candidate_review" ||
      "evolution_revert_recommendation" => DesktopPage.execApprovals,
      "federation_package" ||
      "coordinator_suggestion" => DesktopPage.execApprovals,
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
        successMessage: "已将回复发送给等待中的任务。",
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
    await refresh(statusMessage: "已从桌面控制台加入新的运行时任务。");
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
      successMessage: "已将任务加入再次运行队列。",
      selectedTaskId: taskId,
    );
  }

  Future<void> cancelTask(String taskId) async {
    await _runCommand(
      () => _client.request("runtime.task.cancel", <String, Object?>{
        "taskId": taskId,
        "summary": "Cancelled from Desktop Console",
      }),
      successMessage: "已取消当前任务。",
      selectedTaskId: taskId,
    );
  }

  Future<void> adoptEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.adopt", <String, Object?>{
        "id": candidateId,
        "reason": "Adopted from Desktop Console",
      }),
      successMessage: "已采纳演化候选项。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> rejectEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.reject", <String, Object?>{
        "id": candidateId,
        "reason": "Rejected from Desktop Console",
      }),
      successMessage: "已拒绝演化候选项。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> revertEvolution(String candidateId) async {
    await _runCommand(
      () => _client.request("runtime.evolution.revert", <String, Object?>{
        "id": candidateId,
        "reason": "Reverted from Desktop Console",
      }),
      successMessage: "已回退演化候选项。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> importUserModelMirror() async {
    await _runCommand(
      () => _client.request("runtime.user.mirror.import"),
      successMessage: "已将待处理的 USER.md 修改导入运行时用户模型。",
      page: DesktopPage.config,
    );
  }

  Future<void> discardPendingUserModelMirror() async {
    await _runCommand(
      () => _client.request("runtime.user.mirror.sync", const <String, Object?>{
        "force": true,
      }),
      successMessage: "已丢弃待处理的 USER.md 修改，并按运行时真相重新同步镜像。",
      page: DesktopPage.config,
    );
  }

  Future<void> adoptUserModelOptimization(String candidateId) async {
    await _runCommand(
      () => _client.request(
        "runtime.user.model.optimization.adopt",
        <String, Object?>{"id": candidateId},
      ),
      successMessage: "已应用长期用户模型优化。",
      page: DesktopPage.config,
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
      successMessage: "已拒绝长期用户模型优化。",
      page: DesktopPage.config,
    );
  }

  Future<void> adoptRoleOptimization(String candidateId) async {
    await _runCommand(
      () => _client.request(
        "runtime.role.optimization.adopt",
        <String, Object?>{"id": candidateId},
      ),
      successMessage: "已应用表面角色优化。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> rejectRoleOptimization(String candidateId) async {
    await _runCommand(
      () =>
          _client.request("runtime.role.optimization.reject", <String, Object?>{
            "id": candidateId,
            "reason": "Rejected from Desktop Console",
          }),
      successMessage: "已拒绝表面角色优化。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已更新运行时用户模型。",
      page: DesktopPage.config,
    );
  }

  Future<void> syncCapabilities() async {
    await _runCommand(
      () => _client.request("runtime.capabilities.sync"),
      successMessage: "已同步运行时能力注册表。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已更新能力治理状态。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已更新 MCP 授权姿态。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> reinforceMemory(String memoryId, {String? sourceTaskId}) async {
    await _runCommand(
      () => _client.request("runtime.memory.reinforce", <String, Object?>{
        "memoryIds": [memoryId],
        "reason": "Reinforced from Desktop Console",
        if ((sourceTaskId ?? "").isNotEmpty) "sourceTaskId": sourceTaskId,
      }),
      successMessage: "已强化正式记忆链路。",
      page: DesktopPage.debug,
    );
  }

  Future<void> invalidateMemory(String memoryId) async {
    await _runCommand(
      () => _client.request("runtime.memory.invalidate", <String, Object?>{
        "memoryIds": [memoryId],
      }),
      successMessage: "已标记所选记忆链路为失效。",
      page: DesktopPage.debug,
    );
  }

  Future<void> rollbackMemoryInvalidation(String invalidationEventId) async {
    await _runCommand(
      () => _client.request("runtime.memory.rollback", <String, Object?>{
        "invalidationEventId": invalidationEventId,
      }),
      successMessage: "已回滚所选失效事件。",
      page: DesktopPage.debug,
    );
  }

  Future<void> reviewMemoryLifecycle() async {
    await _runCommand(
      () => _client.request("runtime.memory.review"),
      successMessage: "已执行记忆生命周期复审。",
      page: DesktopPage.debug,
    );
  }

  Future<void> pinIntelToKnowledge(String intelId) async {
    await _runCommand(
      () => _client.request("runtime.intel.pin", <String, Object?>{
        "intelId": intelId,
        "promotedBy": "desktop-console",
      }),
      successMessage: "已将该情报提升为知识记忆。",
      page: DesktopPage.debug,
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
      successMessage: "已保存运行时智能体档案。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> deleteAgent(String agentId) async {
    await _runCommand(
      () => _client.request("runtime.agent.delete", <String, Object?>{
        "id": agentId,
      }),
      successMessage: "已移除运行时智能体。",
      page: DesktopPage.execApprovals,
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
        if (ownerKind == "agent" && (ownerId ?? "").isNotEmpty)
          "ownerId": ownerId,
        "active": active,
      }),
      successMessage: "已保存表面绑定。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已保存表面角色覆层。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> adoptFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "adopted",
        "reason": "Adopted from Desktop Console",
      }),
      successMessage: "已在本地采纳联邦包。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> rejectFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "rejected",
        "reason": "Rejected from Desktop Console",
      }),
      successMessage: "已在本地拒绝联邦包。",
      page: DesktopPage.execApprovals,
    );
  }

  Future<void> revertFederationPackage(String packageId) async {
    await _runCommand(
      () => _client.request("federation.package.transition", <String, Object?>{
        "id": packageId,
        "state": "reverted",
        "reason": "Reverted from Desktop Console",
      }),
      successMessage: "已在本地回退已采纳的联邦包。",
      page: DesktopPage.execApprovals,
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
        page: DesktopPage.execApprovals,
        selectedTaskId: taskId.isNotEmpty ? taskId : current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage: created ? "已将协调建议实体化为本地运行时任务。" : "已打开该协调建议对应的本地任务。",
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
        page: DesktopPage.execApprovals,
        selectedTaskId: taskId.isNotEmpty ? taskId : current?.selectedTaskId,
        selectedActionId: current?.selectedActionId,
        statusMessage: created ? "已将联邦指派实体化为本地运行时任务。" : "已打开该联邦指派对应的本地任务。",
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
      successMessage: "已在本地阻止该联邦指派。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已将联邦指派重置为待处理。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已将联邦指派标记为已应用。",
      page: DesktopPage.execApprovals,
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
      successMessage: "已更新运行时任务循环默认值。",
      page: DesktopPage.config,
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
      successMessage: "已更新本地演化治理控制项。",
      page: DesktopPage.config,
    );
  }

  Future<void> runEvolutionReview() async {
    await _runCommand(
      () => _client.request("runtime.evolution.run"),
      successMessage: "已执行一次按需演化复审。",
      page: DesktopPage.config,
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
      successMessage: "已更新运行时情报面板控制项。",
      page: DesktopPage.config,
    );
  }

  Future<void> refreshIntel() async {
    await _runCommand(
      () => _client.request("runtime.intel.refresh", <String, Object?>{
        "force": true,
      }),
      successMessage: "已触发一次手动情报刷新。",
      page: DesktopPage.config,
    );
  }

  Future<void> dispatchIntelDeliveries() async {
    await _runCommand(
      () => _client.request("runtime.intel.delivery.dispatch"),
      successMessage: "已派发待处理的情报投递。",
      page: DesktopPage.config,
    );
  }

  Future<void> syncFederation() async {
    await _runCommand(
      () => _client.request("runtime.federation.sync"),
      successMessage: "已触发一次手动联邦同步。",
      page: DesktopPage.execApprovals,
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
          "已初始化桌面实例根目录（${createdCount.toString()} 条路径${createdConfig ? "，并已创建配置" : ""}）。",
    );
  }

  Future<void> restartRuntime() async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(current.copyWith(isRefreshing: true));
    }
    await _desktopBridge.restartRuntime();
    final message = "已请求重启本地运行时，正在通过桌面引导会话重新连接……";
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
      successMessage: "已触发一次运行时任务循环。",
    );
  }

  Future<void> openLogs() async {
    final result = await _desktopBridge.openLogs();
    await refresh(
      statusMessage:
          asBool(result["opened"])
              ? "已打开日志目录：${asString(result["logRoot"], "运行时日志根目录")}。"
              : "日志位于：${asString(result["logRoot"], "运行时日志根目录")}。",
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
      dashboard["runtimeHealth"] = asMap(
        await _client.request("runtime.getHealth"),
      );
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
      page: page ?? current?.page ?? DesktopPage.chat,
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
  late final TextEditingController _searchController;
  String _searchQuery = "";

  @override
  void initState() {
    super.initState();
    _composerController = TextEditingController();
    _searchController = TextEditingController();
    _searchController.addListener(_handleSearchChanged);
  }

  @override
  void dispose() {
    _searchController
      ..removeListener(_handleSearchChanged)
      ..dispose();
    _composerController.dispose();
    super.dispose();
  }

  void _handleSearchChanged() {
    final next = _searchController.text.trim();
    if (next == _searchQuery) {
      return;
    }
    setState(() {
      _searchQuery = next;
    });
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
                (shell) => LayoutBuilder(
                  builder: (context, constraints) {
                    final layout = _ShellLayoutSpec.fromWidth(
                      constraints.maxWidth,
                    );
                    return Padding(
                      padding: const EdgeInsets.all(18),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SizedBox(
                            width: layout.leftRailWidth,
                            child: _LeftNavigation(shell: shell),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: DesktopSurfaceCard(
                              padding: EdgeInsets.zero,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      18,
                                      18,
                                      18,
                                      14,
                                    ),
                                    child: _TopBar(
                                      shell: shell,
                                      searchController: _searchController,
                                      stackControls: layout.stackTopBarControls,
                                    ),
                                  ),
                                  Container(
                                    height: 1,
                                    color: DesktopTokens.border,
                                  ),
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.all(18),
                                      child: _WorkspaceBody(
                                        shell: shell,
                                        composerController: _composerController,
                                        searchQuery: _searchQuery,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
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
            "正在把桌面控制台连接到桌面核心...",
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 8),
          Text(
            "桌面应用正在等待原生启动宿主提供一个可用的桌面连接会话。",
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
        child: DesktopSurfaceCard(
          padding: const EdgeInsets.all(28),
          tone:
              bootstrapRequired
                  ? DesktopSurfaceTone.warning
                  : DesktopSurfaceTone.base,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                bootstrapRequired ? "ClawMark 核心需要处理" : "桌面控制台尚未连接",
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 12),
              SelectableText(
                error.toString(),
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 20),
              Text(
                bootstrapRequired
                    ? "原生桌面宿主还没有上报一个已就绪的桌面连接会话。请回到启动工作台检查、下载或重启 ClawMark 核心。"
                    : "桌面界面启动前，我们期望桌面核心已经可用，并且当前会话已经完成鉴权。",
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
                label: Text(bootstrapRequired ? "打开启动工作台" : "重试连接"),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar({
    required this.shell,
    required this.searchController,
    required this.stackControls,
  });

  final DesktopShellState shell;
  final TextEditingController searchController;
  final bool stackControls;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final controls = Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _TopShortcutButton(
          icon: Icons.language_rounded,
          tooltip: "频道",
          active: shell.page == DesktopPage.channels,
          onPressed:
              shell.isRefreshing
                  ? null
                  : () => controller.setPage(DesktopPage.channels),
        ),
        _TopShortcutButton(
          icon: Icons.bar_chart_rounded,
          tooltip: "概览",
          active: shell.page == DesktopPage.overview,
          onPressed:
              shell.isRefreshing
                  ? null
                  : () => controller.setPage(DesktopPage.overview),
        ),
        _TopShortcutButton(
          icon: Icons.account_circle_outlined,
          tooltip: "代理",
          active: shell.page == DesktopPage.agents,
          onPressed:
              shell.isRefreshing
                  ? null
                  : () => controller.setPage(DesktopPage.agents),
        ),
        OutlinedButton(
          onPressed:
              shell.isRefreshing
                  ? null
                  : () => controller.setPage(DesktopPage.update),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
            backgroundColor: DesktopTokens.accentSurface,
            side: const BorderSide(color: DesktopTokens.borderStrong),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          child: const Text("部署"),
        ),
      ],
    );
    final searchField = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 60),
      child: TextField(
        controller: searchController,
        decoration: const InputDecoration(
          hintText: "检索神经模块...",
          prefixIcon: Icon(Icons.search_rounded),
        ),
      ),
    );
    return stackControls
        ? Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [searchField, const SizedBox(height: 14), controls],
        )
        : Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: searchField),
            const SizedBox(width: 16),
            SizedBox(width: 320, child: controls),
          ],
        );
  }
}

class _TopShortcutButton extends StatelessWidget {
  const _TopShortcutButton({
    required this.icon,
    required this.tooltip,
    required this.active,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final bool active;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          color: active ? DesktopTokens.accentSurface : Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: active ? DesktopTokens.borderStrong : DesktopTokens.border,
          ),
        ),
        child: IconButton(
          onPressed: onPressed,
          icon: Icon(icon, size: 26),
          color: active ? DesktopTokens.accent : DesktopTokens.textSecondary,
          splashRadius: 24,
        ),
      ),
    );
  }
}

class _WorkspaceBody extends StatelessWidget {
  const _WorkspaceBody({
    required this.shell,
    required this.composerController,
    required this.searchQuery,
  });

  final DesktopShellState shell;
  final TextEditingController composerController;
  final String searchQuery;

  @override
  Widget build(BuildContext context) {
    return switch (shell.page) {
      DesktopPage.chat => _ChatWorkspace(
        shell: shell,
        composerController: composerController,
        searchQuery: searchQuery,
      ),
      DesktopPage.overview => _OverviewWorkboard(
        shell: shell,
        searchQuery: searchQuery,
      ),
      DesktopPage.runtime => _MemoryWorkboard(
        shell: shell,
        searchQuery: searchQuery,
      ),
      DesktopPage.channels => _ChannelsWorkboard(shell: shell),
      DesktopPage.instances => _InstancesWorkboard(shell: shell),
      DesktopPage.sessions => _SessionsWorkboard(
        shell: shell,
        searchQuery: searchQuery,
      ),
      DesktopPage.cronJobs => _CronJobsWorkboard(shell: shell),
      DesktopPage.agents => _GovernanceWorkboard(
        shell: shell,
        searchQuery: searchQuery,
      ),
      DesktopPage.skills => _SkillsWorkboard(shell: shell),
      DesktopPage.nodes => _NodesWorkboard(shell: shell),
      DesktopPage.config => _SettingsWorkboard(
        shell: shell,
        searchQuery: searchQuery,
      ),
      DesktopPage.debug => _DebugWorkboard(shell: shell),
      DesktopPage.logs => _LogsWorkboard(shell: shell),
      DesktopPage.execApprovals => _ExecApprovalsWorkboard(shell: shell),
      DesktopPage.update => const _UpdateWorkboard(),
    };
  }
}

class _ChatWorkspace extends StatelessWidget {
  const _ChatWorkspace({
    required this.shell,
    required this.composerController,
    required this.searchQuery,
  });

  final DesktopShellState shell;
  final TextEditingController composerController;
  final String searchQuery;

  @override
  Widget build(BuildContext context) {
    return _ChatCenterPane(
      shell: shell,
      controller: composerController,
      searchQuery: searchQuery,
    );
  }
}

class _ShellLayoutSpec {
  const _ShellLayoutSpec({
    required this.leftRailWidth,
    required this.stackTopBarControls,
  });

  final double leftRailWidth;
  final bool stackTopBarControls;

  factory _ShellLayoutSpec.fromWidth(double width) {
    var left = (width * 0.19).clamp(220.0, 320.0).toDouble();
    final available = width - 14;
    if (left > available * 0.32) {
      left = (available * 0.32).clamp(200.0, 320.0).toDouble();
    }
    return _ShellLayoutSpec(
      leftRailWidth: left,
      stackTopBarControls: width < 1500,
    );
  }
}

class _LeftNavigation extends ConsumerWidget {
  const _LeftNavigation({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final displayName = asString(shell.userModel["displayName"], "当前操作员");
    final operatorStatus = shell.warnings.isEmpty ? "桌面已连接" : "请先处理系统提示";
    return DesktopSurfaceCard(
      padding: EdgeInsets.zero,
      child: Container(
        decoration: const BoxDecoration(
          color: DesktopTokens.sidebar,
          borderRadius: BorderRadius.all(Radius.circular(18)),
        ),
        child: Scrollbar(
          child: CustomScrollView(
            primary: true,
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(18, 22, 18, 0),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "ClawMark",
                        style: Theme.of(
                          context,
                        ).textTheme.headlineMedium?.copyWith(
                          fontFamily: DesktopTokens.bodyFont,
                          color: DesktopTokens.accent,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        "Desktop Console",
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 24),
                      ...primaryDesktopNavGroups.map(
                        (group) => Padding(
                          padding: const EdgeInsets.only(bottom: 18),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                group.label,
                                style: Theme.of(context).textTheme.labelLarge,
                              ),
                              const SizedBox(height: 8),
                              ...group.pages.map(
                                (page) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: _NavButton(
                                    selected: shell.page == page,
                                    icon: page.icon,
                                    label: page.label,
                                    onTap: () => controller.setPage(page),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (shell.warnings.isNotEmpty)
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
                  sliver: SliverToBoxAdapter(
                    child: DesktopSurfaceCard(
                      padding: const EdgeInsets.all(14),
                      tone: DesktopSurfaceTone.warning,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "系统提示",
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          ...shell.warnings
                              .take(2)
                              .map(
                                (warning) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Text(
                                    warning,
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                ),
                              ),
                        ],
                      ),
                    ),
                  ),
                ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 22),
                sliver: SliverToBoxAdapter(
                  child: DesktopSurfaceCard(
                    padding: const EdgeInsets.all(14),
                    tone: DesktopSurfaceTone.muted,
                    child: Row(
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: DesktopTokens.surfaceElevated,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            displayName.characters.firstOrNull?.toUpperCase() ??
                                "O",
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(color: DesktopTokens.accent),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                displayName,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                operatorStatus,
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ignore: unused_element
class _CenterInteractionPane extends ConsumerWidget {
  const _CenterInteractionPane({required this.shell, required this.controller});

  final DesktopShellState shell;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(16),
      child: switch (shell.page) {
        DesktopPage.chat => _ChatCenterPane(
          shell: shell,
          controller: controller,
          searchQuery: "",
        ),
        DesktopPage.overview => const SizedBox.shrink(),
        DesktopPage.runtime => const SizedBox.shrink(),
        DesktopPage.channels => _ChannelsCenterPane(shell: shell),
        DesktopPage.instances => _InstancesCenterPane(shell: shell),
        DesktopPage.sessions => _SessionsCenterPane(shell: shell),
        DesktopPage.cronJobs => _CronJobsCenterPane(shell: shell),
        DesktopPage.agents => const SizedBox.shrink(),
        DesktopPage.skills => _SkillsCenterPane(shell: shell),
        DesktopPage.nodes => _NodesCenterPane(shell: shell),
        DesktopPage.config => _ConfigCenterPane(shell: shell),
        DesktopPage.debug => _DebugCenterPane(shell: shell),
        DesktopPage.logs => _LogsCenterPane(shell: shell),
        DesktopPage.execApprovals => _ExecApprovalsCenterPane(shell: shell),
        DesktopPage.update => const _UpdateCenterPane(),
      },
    );
  }
}

class _ChatCenterPane extends ConsumerWidget {
  const _ChatCenterPane({
    required this.shell,
    required this.controller,
    required this.searchQuery,
  });

  final DesktopShellState shell;
  final TextEditingController controller;
  final String searchQuery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtime = ref.read(shellControllerProvider.notifier);
    final selectedAction = shell.selectedAction;
    final composerLabel =
        selectedAction?.isWaitingUserTask == true ? "回复" : "发送消息";
    final composerHint =
        selectedAction?.isWaitingUserTask == true
            ? "补充上下文、回复当前流程，或批准下一步..."
            : "输入消息或目标，ClawMark 会按当前控制台流程进入执行。";
    final task = shell.defaultTaskFocus;
    final visibleActions = shell.actionQueue
        .where(
          (item) => _matchesSearch(searchQuery, [
            item.title,
            item.summary,
            item.priority,
          ]),
        )
        .take(3)
        .toList(growable: false);
    return LayoutBuilder(
      builder:
          (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _SectionCard(
                    title: "对话输入",
                    subtitle: "沿用 OpenClaw 的 chat-first 入口，先从对话和 composer 开始。",
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        TextField(
                          controller: controller,
                          minLines: 4,
                          maxLines: 7,
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
                                label: Text(composerLabel),
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
                  _SectionCard(
                    title: "当前执行上下文",
                    subtitle: "保留 OpenClaw 首页需要看到的当前任务、等待确认和连接状态。",
                    child: _FactGrid(
                      items: [
                        ("当前任务", task?.title ?? "暂无"),
                        (
                          "任务状态",
                          task == null
                              ? "暂无"
                              : _localizedStatusLabel(task.status),
                        ),
                        ("待处理审批", shell.pendingActionCount.toString()),
                        ("等待用户", shell.waitingUserCount.toString()),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  _SectionCard(
                    title: "执行审批",
                    subtitle: "当前对话相关的待确认动作直接收在首页，不再拆出内部产品概念。",
                    child:
                        visibleActions.isEmpty
                            ? Text(
                              searchQuery.isEmpty
                                  ? "当前没有和对话直接相关的待确认动作。"
                                  : "当前搜索词下没有匹配的待确认动作。",
                              style: Theme.of(context).textTheme.bodyMedium,
                            )
                            : Column(
                              children: visibleActions
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
                  const SizedBox(height: 14),
                  _SectionCard(
                    title: "最近会话与摘要",
                    subtitle: "会话视图里的核心摘要在首页保留一个轻量入口。",
                    child: _FactGrid(
                      items: [
                        ("活动任务", shell.totalTaskCount.toString()),
                        ("最近复盘", shell.reviewCount.toString()),
                        ("正式记忆", shell.memoryCount.toString()),
                        ("核心版本", shell.runtimeVersion),
                      ],
                    ),
                  ),
                  if ((shell.lastStatusMessage ?? "").isNotEmpty) ...[
                    const SizedBox(height: 14),
                    DesktopSurfaceCard(
                      padding: const EdgeInsets.all(12),
                      tone: DesktopSurfaceTone.muted,
                      child: Text(
                        shell.lastStatusMessage!,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
    );
  }
}

class _SessionsWorkboard extends ConsumerWidget {
  const _SessionsWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final selectedTask = shell.selectedTask;
    final task = asMap(selectedTask?["task"]);
    final runs = asMapList(selectedTask?["runs"]);
    final reviews = asMapList(selectedTask?["reviews"]);
    final visibleTasks = shell.tasks
        .where(
          (entry) => _matchesSearch(searchQuery, [
            entry.title,
            entry.status,
            entry.route,
            entry.worker,
          ]),
        )
        .toList(growable: false);
    final visibleRuns = runs
        .where(
          (run) => _matchesSearch(searchQuery, [
            run["id"],
            run["status"],
            run["thinkingLane"],
            run["summary"],
          ]),
        )
        .toList(growable: false);
    final visibleReviews = reviews
        .where(
          (review) => _matchesSearch(searchQuery, [
            review["summary"],
            review["outcome"],
          ]),
        )
        .toList(growable: false);
    return ListView(
      children: [
        _SectionCard(
          title: "会话列表",
          subtitle: "当前桌面快照还没有独立 sessions 数据面时，先用活动任务承接会话列表。",
          child:
              visibleTasks.isEmpty
                  ? Text(
                    searchQuery.isEmpty ? "当前没有活动会话。" : "没有匹配当前搜索词的会话。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                  : Column(
                    children: visibleTasks
                        .take(8)
                        .map(
                          (entry) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _ObjectTile(
                              title: entry.title,
                              subtitle:
                                  "${_localizedStatusLabel(entry.status)} · ${_localizedOptionLabel(entry.route)}",
                              badge: entry.status,
                              highlighted: shell.selectedTaskId == entry.id,
                              onTap: () => controller.focusTask(entry.id),
                            ),
                          ),
                        )
                        .toList(growable: false),
                  ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "当前会话详情",
          subtitle: "聚焦当前会话关联的运行、复盘和最近一步。",
          child: _FactGrid(
            items: [
              ("当前会话", asString(task["title"], "未选择")),
              ("状态", _localizedStatusLabel(asString(task["status"], "queued"))),
              ("下一步", asString(task["nextAction"], "暂未排入下一动作")),
              ("更新时间", _formatTimestamp(asInt(task["updatedAt"]))),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "最近运行与复盘",
          subtitle: "保持 OpenClaw 会话页的上下文感，但不额外暴露内部 runtime 模型。",
          child: Column(
            children: [
              if (visibleRuns.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    searchQuery.isEmpty ? "当前会话还没有运行记录。" : "没有匹配当前搜索词的运行记录。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ...visibleRuns
                  .take(4)
                  .map(
                    (run) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _TimelineTile(
                        title: asString(run["id"], "运行记录"),
                        subtitle:
                            "${_localizedStatusLabel(asString(run["status"], "queued"))} · ${_localizedOptionLabel(asString(run["thinkingLane"], "system1"))}",
                        trailing: _formatTimestamp(asInt(run["updatedAt"])),
                      ),
                    ),
                  ),
              if (visibleReviews.isNotEmpty) ...[
                const Divider(height: 28),
                ...visibleReviews
                    .take(3)
                    .map(
                      (review) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _TimelineTile(
                          title: asString(review["summary"], "复盘记录"),
                          subtitle: asString(review["outcome"], "已记录"),
                          trailing: _formatTimestamp(
                            asInt(review["createdAt"]),
                          ),
                        ),
                      ),
                    ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _ChannelsCenterPane extends StatelessWidget {
  const _ChannelsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return _PageIntroCard(
      title: "渠道",
      subtitle: "按 OpenClaw 的渠道入口组织。桌面版当前用本地表面绑定来承接可见内容。",
      child: _FactGrid(
        items: [
          ("渠道绑定", shell.surfaces.length.toString()),
          (
            "活动表面",
            shell.surfaces
                .where((entry) => asBool(entry["active"]))
                .length
                .toString(),
          ),
          ("待处理审批", shell.pendingActionCount.toString()),
          (
            "本地模式",
            asBool(shell.gatewaySection["localOnly"], true) ? "仅本地回环" : "已放开",
          ),
        ],
      ),
    );
  }
}

class _InstancesCenterPane extends ConsumerWidget {
  const _InstancesCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runtime = ref.read(shellControllerProvider.notifier);
    return _PageIntroCard(
      title: "实例",
      subtitle: "本地实例、宿主和运行时状态都在这一页查看。",
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FactGrid(
            items: [
              ("实例根目录", asString(shell.instanceSection["instanceRoot"], "n/a")),
              (
                "工作区根目录",
                asString(shell.instanceSection["workspaceRoot"], "n/a"),
              ),
              ("运行时版本", shell.runtimeVersion),
              (
                "告警",
                shell.warnings.isEmpty ? "无" : shell.warnings.length.toString(),
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
                        : () => runtime.initializeInstance(),
                icon: const Icon(Icons.inventory_2_outlined),
                label: const Text("初始化实例"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing ? null : () => runtime.restartRuntime(),
                icon: const Icon(Icons.restart_alt_outlined),
                label: const Text("重启运行时"),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SessionsCenterPane extends ConsumerWidget {
  const _SessionsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    return _PageIntroCard(
      title: "会话",
      subtitle: "当前桌面快照未暴露独立会话列表时，这里优先展示活动执行上下文。",
      child: Column(
        children: [
          if (shell.tasks.isEmpty)
            Text("当前没有活动会话。", style: Theme.of(context).textTheme.bodyMedium)
          else
            ...shell.tasks
                .take(6)
                .map(
                  (task) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _ObjectTile(
                      title: task.title,
                      subtitle:
                          "${_localizedStatusLabel(task.status)} · ${_localizedOptionLabel(task.route)}",
                      badge: task.status,
                      highlighted: shell.selectedTaskId == task.id,
                      onTap: () => controller.focusTask(task.id),
                    ),
                  ),
                ),
        ],
      ),
    );
  }
}

class _CronJobsCenterPane extends StatelessWidget {
  const _CronJobsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return _PageIntroCard(
      title: "定时任务",
      subtitle: "保留 OpenClaw 的 cron jobs 页面入口。当前桌面快照未携带独立定时任务清单。",
      child: _FactGrid(
        items: [
          ("活动任务", shell.totalTaskCount.toString()),
          ("待用户处理", shell.waitingUserCount.toString()),
          ("最近复盘", shell.reviewCount.toString()),
          ("状态", "等待接入独立 cron 快照"),
        ],
      ),
    );
  }
}

class _SkillsCenterPane extends StatelessWidget {
  const _SkillsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    final activeAgents = shell.agents
        .where((entry) => asBool(entry["active"]))
        .toList(growable: false);
    return _PageIntroCard(
      title: "技能",
      subtitle: "保留 OpenClaw 的 skills 页面入口，当前用技能包与能力姿态的本地快照承接。",
      child: _FactGrid(
        items: [
          ("活动代理", activeAgents.length.toString()),
          ("受控条目", shell.governanceEntries.length.toString()),
          ("MCP 授权", shell.capabilityMcpGrants.length.toString()),
          ("近期活动", shell.capabilityRecentActivity.length.toString()),
        ],
      ),
    );
  }
}

class _NodesCenterPane extends StatelessWidget {
  const _NodesCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return _PageIntroCard(
      title: "节点",
      subtitle: "当前桌面端默认只有一个本地节点：桌面宿主拉起的本地运行时。",
      child: _FactGrid(
        items: [
          ("本地节点", "1"),
          ("运行时版本", shell.runtimeVersion),
          ("活动代理", shell.agents.length.toString()),
          ("表面数", shell.surfaces.length.toString()),
        ],
      ),
    );
  }
}

class _ExecApprovalsCenterPane extends StatelessWidget {
  const _ExecApprovalsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _PageIntroCard(
          title: "执行审批",
          subtitle: "所有需要人工确认的动作都收口到这里，而不是拆成治理、联邦、用户模型等内部页面。",
          child: _FactGrid(
            items: [
              ("待处理总数", shell.pendingActionCount.toString()),
              ("等待用户", shell.waitingUserCount.toString()),
              (
                "用户模型建议",
                shell.recommendedUserModelOptimizationCount.toString(),
              ),
              ("角色建议", shell.recommendedRoleOptimizationCount.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Expanded(
          child: ListView(
            children:
                shell.actionQueue.isEmpty
                    ? [
                      Text(
                        "当前没有待处理审批。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.actionQueue
                        .map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _ActionQueueTile(shell: shell, item: item),
                          ),
                        )
                        .toList(growable: false),
          ),
        ),
      ],
    );
  }
}

class _ConfigCenterPane extends StatelessWidget {
  const _ConfigCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return _PageIntroCard(
      title: "配置",
      subtitle: "按 OpenClaw 的 config 页面组织，当前展示桌面端已可见的本地配置入口。",
      child: _FactGrid(
        items: [
          ("显示名称", asString(shell.userModel["displayName"], "未设置")),
          ("沟通风格", asString(shell.userModel["communicationStyle"], "未设置")),
          ("实例根目录", shell.instanceRoot),
          ("网关地址", shell.runtimeWsUrl.isEmpty ? "未上报" : shell.runtimeWsUrl),
        ],
      ),
    );
  }
}

class _DebugCenterPane extends StatelessWidget {
  const _DebugCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    final process = asMap(shell.runtimeHealth["process"]);
    return _PageIntroCard(
      title: "调试",
      subtitle: "这里保留本地运行时诊断、告警和快照统计。",
      child: _FactGrid(
        items: [
          ("PID", asString(process["pid"], "n/a")),
          ("运行时长", _formatDuration(asInt(process["uptimeMs"]))),
          ("RSS", _formatBytes(asInt(process["rssBytes"]))),
          (
            "告警",
            shell.warnings.isEmpty ? "无" : shell.warnings.length.toString(),
          ),
        ],
      ),
    );
  }
}

class _LogsCenterPane extends ConsumerWidget {
  const _LogsCenterPane({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    return _PageIntroCard(
      title: "日志",
      subtitle: "日志入口保持独立，不和首页混在一起。",
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FactGrid(
            items: [
              ("日志目录", asString(shell.instanceSection["logRoot"], "n/a")),
              ("当前告警", shell.warnings.isEmpty ? "无" : shell.warnings.first),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing ? null : () => controller.openLogs(),
                icon: const Icon(Icons.folder_open_outlined),
                label: const Text("打开日志"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing ? null : () => controller.refresh(),
                icon: const Icon(Icons.sync),
                label: const Text("刷新状态"),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _UpdateCenterPane extends ConsumerWidget {
  const _UpdateCenterPane();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrapAsync = ref.watch(bootstrapControllerProvider);
    final controller = ref.read(bootstrapControllerProvider.notifier);
    return bootstrapAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error:
          (error, _) => _PageIntroCard(
            title: "更新",
            subtitle: "更新页依赖原生宿主的启动状态。",
            child: Text(
              error.toString(),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
      data:
          (bootstrap) => _PageIntroCard(
            title: "更新",
            subtitle: "按 OpenClaw 的 update 页面入口组织，当前对接 ClawMark Core 发布流。",
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FactGrid(
                  items: [
                    (
                      "当前版本",
                      bootstrap.currentVersion.isEmpty
                          ? "未安装"
                          : bootstrap.currentVersion,
                    ),
                    (
                      "可用版本",
                      bootstrap.latestRelease == null
                          ? "未检查"
                          : bootstrap.latestRelease!.version,
                    ),
                    (
                      "发布状态",
                      bootstrap.releaseStatusMessage ?? bootstrap.releaseStatus,
                    ),
                    ("平台", "${bootstrap.platform} / ${bootstrap.arch}"),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed:
                          bootstrap.isBusy
                              ? null
                              : () => controller.checkForUpdates(force: true),
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text("检查更新"),
                    ),
                    FilledButton.icon(
                      onPressed:
                          bootstrap.isBusy ||
                                  bootstrap.latestRelease == null ||
                                  bootstrap.updateAvailable == false &&
                                      bootstrap.currentVersion.isNotEmpty
                              ? null
                              : () => controller.downloadCore(),
                      icon: const Icon(Icons.download_rounded),
                      label: Text(
                        bootstrap.currentVersion.isEmpty ? "下载核心" : "安装最新版本",
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
    );
  }
}

class _PageIntroCard extends StatelessWidget {
  const _PageIntroCard({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder:
          (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 18),
                  DesktopSurfaceCard(
                    padding: const EdgeInsets.all(18),
                    tone: DesktopSurfaceTone.base,
                    child: child,
                  ),
                ],
              ),
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
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(16),
      tone: isSelected ? DesktopSurfaceTone.accent : DesktopSurfaceTone.muted,
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
                    color: isSelected ? DesktopTokens.textPrimary : null,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            item.summary,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color:
                  isSelected
                      ? DesktopTokens.textSecondary
                      : DesktopTokens.textSecondary,
            ),
          ),
          if ((item.actionBlockedReason ?? "").isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              item.actionBlockedReason!,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: DesktopTokens.warning),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: () => controller.focusAction(item.id),
                child: const Text("聚焦"),
              ),
              if (item.isEvolutionReview && (item.candidateId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptEvolution(item.candidateId!),
                  child: const Text("采纳"),
                ),
              if (item.isEvolutionReview && (item.candidateId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectEvolution(item.candidateId!),
                  child: const Text("拒绝"),
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
                  child: const Text("应用到用户模型"),
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
                  child: const Text("保持当前用户模型"),
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
                  child: const Text("应用到表面角色"),
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
                  child: const Text("保持当前角色"),
                ),
              if (item.isUserModelMirrorImport)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.importUserModelMirror(),
                  child: const Text("导入镜像编辑"),
                ),
              if (item.isUserModelMirrorImport)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.discardPendingUserModelMirror(),
                  child: const Text("丢弃镜像编辑"),
                ),
              if (item.isWaitingUserTask)
                OutlinedButton.icon(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.focusAction(item.id),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text("去中栏回复"),
                ),
              if (item.isFederationPackage && (item.packageId ?? "").isNotEmpty)
                FilledButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.adoptFederationPackage(
                            item.packageId!,
                          ),
                  child: const Text("采纳包"),
                ),
              if (item.isFederationPackage && (item.packageId ?? "").isNotEmpty)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.rejectFederationPackage(
                            item.packageId!,
                          ),
                  child: const Text("拒绝包"),
                ),
              if (item.isFederationPackage)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.setPage(DesktopPage.execApprovals),
                  child: const Text("打开审批页"),
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
                        ? "生成本地任务"
                        : "当前不可生成",
                  ),
                ),
              if (item.isCoordinatorSuggestion)
                OutlinedButton(
                  onPressed:
                      shell.isRefreshing
                          ? null
                          : () => controller.setPage(DesktopPage.execApprovals),
                  child: const Text("打开审批页"),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ignore: unused_element
class _RightWorkboard extends StatelessWidget {
  const _RightWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(18),
      child: switch (shell.page) {
        DesktopPage.chat => _TaskWorkboard(
          shell: shell,
          searchQuery: "",
          title: "当前执行",
          subtitle: "当前对话关联的任务、步骤和复盘会在这里展开。",
        ),
        DesktopPage.overview => _OverviewWorkboard(
          shell: shell,
          searchQuery: "",
        ),
        DesktopPage.runtime => _MemoryWorkboard(shell: shell, searchQuery: ""),
        DesktopPage.channels => _ChannelsWorkboard(shell: shell),
        DesktopPage.instances => _InstancesWorkboard(shell: shell),
        DesktopPage.sessions => _TaskWorkboard(
          shell: shell,
          searchQuery: "",
          title: "会话详情",
          subtitle: "当前会话关联的执行上下文和最近运行记录。",
        ),
        DesktopPage.cronJobs => _CronJobsWorkboard(shell: shell),
        DesktopPage.agents => _GovernanceWorkboard(
          shell: shell,
          searchQuery: "",
        ),
        DesktopPage.skills => _SkillsWorkboard(shell: shell),
        DesktopPage.nodes => _NodesWorkboard(shell: shell),
        DesktopPage.config => _SettingsWorkboard(shell: shell, searchQuery: ""),
        DesktopPage.debug => _DebugWorkboard(shell: shell),
        DesktopPage.logs => _LogsWorkboard(shell: shell),
        DesktopPage.execApprovals => _ExecApprovalsWorkboard(shell: shell),
        DesktopPage.update => const _UpdateWorkboard(),
      },
    );
  }
}

class _OverviewWorkboard extends ConsumerWidget {
  const _OverviewWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final focusedTask = shell.defaultTaskFocus;
    final visibleActions = shell.actionQueue
        .where(
          (item) => _matchesSearch(searchQuery, [
            item.title,
            item.summary,
            item.priority,
          ]),
        )
        .take(4)
        .toList(growable: false);
    return ListView(
      children: [
        Text("Overview", style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 8),
        Text(
          "把 OpenClaw 第一屏真正需要看到的状态、入口动作和待处理项收回到产品层表达，不再把内部运行时术语顶在最上面。",
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "当前状态",
          subtitle: "这里先看任务、确认项和记忆规模，不直接暴露内部宿主细节。",
          child: _FactGrid(
            items: [
              ("活动任务", shell.totalTaskCount.toString()),
              ("待确认", shell.pendingActionCount.toString()),
              ("等待用户", shell.waitingUserCount.toString()),
              ("正式记忆", shell.memoryCount.toString()),
              ("策略", shell.strategyCount.toString()),
              ("联邦待同步", shell.outboxPendingCount.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "快速入口",
          subtitle: "把最常用的页面跳转和部署动作放在第一屏。",
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.setPage(DesktopPage.chat),
                icon: const Icon(Icons.chat_bubble_outline_rounded),
                label: const Text("打开聊天"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.setPage(DesktopPage.sessions),
                icon: const Icon(Icons.history_rounded),
                label: const Text("查看会话"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.setPage(DesktopPage.logs),
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text("打开日志"),
              ),
              FilledButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.setPage(DesktopPage.update),
                icon: const Icon(Icons.rocket_launch_outlined),
                label: const Text("部署"),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "当前关注任务",
          subtitle: "当前任务焦点仍然保留，但只作为工作摘要而不是产品身份。",
          child:
              focusedTask == null
                  ? Text(
                    "当前没有处于焦点中的任务。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                  : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _FactGrid(
                        items: [
                          ("任务", focusedTask.title),
                          ("状态", _localizedStatusLabel(focusedTask.status)),
                          ("路由", _localizedOptionLabel(focusedTask.route)),
                          (
                            "下一步",
                            focusedTask.nextAction.isEmpty
                                ? "未提供"
                                : focusedTask.nextAction,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed:
                            shell.isRefreshing
                                ? null
                                : () => controller.focusTask(focusedTask.id),
                        icon: const Icon(Icons.open_in_new_rounded),
                        label: const Text("打开任务详情"),
                      ),
                    ],
                  ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "待处理动作",
          subtitle: "审批仍然存在，但不再占据顶部主标题。",
          child:
              visibleActions.isEmpty
                  ? Text(
                    searchQuery.isEmpty ? "当前没有需要立刻处理的动作。" : "没有匹配当前搜索词的待处理动作。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                  : Column(
                    children: visibleActions
                        .map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _ActionQueueTile(shell: shell, item: item),
                          ),
                        )
                        .toList(growable: false),
                  ),
        ),
      ],
    );
  }
}

class _ChannelsWorkboard extends StatelessWidget {
  const _ChannelsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        _SectionCard(
          title: "渠道状态",
          subtitle: "对齐 OpenClaw 的 Channels 页面，先展示当前可见绑定的在线状态和归属关系。",
          child: Column(
            children:
                shell.surfaces.isEmpty
                    ? [
                      Text(
                        "当前没有可见渠道绑定。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : shell.surfaces
                        .take(8)
                        .map(
                          (surface) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(surface["label"], "未命名渠道"),
                              subtitle:
                                  "${asString(surface["channel"], "unknown")} · ${asString(surface["ownerLabel"], "未绑定")}",
                              trailing: asBool(surface["active"]) ? "在线" : "停用",
                            ),
                          ),
                        )
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        DesktopSurfaceCard(
          padding: const EdgeInsets.all(16),
          tone: DesktopSurfaceTone.muted,
          child: Text(
            "当前桌面快照没有独立的渠道登录、二维码接入和渠道配置写入口，因此这里只保留 OpenClaw 的页面骨架和现有状态映射。",
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _InstancesWorkboard extends ConsumerWidget {
  const _InstancesWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final process = asMap(shell.runtimeHealth["process"]);
    final controller = ref.read(shellControllerProvider.notifier);
    return ListView(
      children: [
        _SectionCard(
          title: "本地实例",
          subtitle: "按 OpenClaw 的 Instances 页面展示当前实例、宿主和连接姿态。",
          child: _FactGrid(
            items: [
              ("实例根目录", asString(shell.instanceSection["instanceRoot"], "n/a")),
              (
                "工作区根目录",
                asString(shell.instanceSection["workspaceRoot"], "n/a"),
              ),
              ("PID", asString(process["pid"], "n/a")),
              ("运行时长", _formatDuration(asInt(process["uptimeMs"]))),
              ("网关地址", shell.runtimeWsUrl.isEmpty ? "未上报" : shell.runtimeWsUrl),
              (
                "传输",
                asString(shell.gatewaySection["transport"], "websocket-rpc"),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "宿主操作",
          subtitle: "实例页承接本地初始化、刷新和重启操作。",
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing ? null : () => controller.refresh(),
                icon: const Icon(Icons.sync_rounded),
                label: const Text("刷新状态"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.initializeInstance(),
                icon: const Icon(Icons.inventory_2_outlined),
                label: const Text("初始化实例"),
              ),
              OutlinedButton.icon(
                onPressed:
                    shell.isRefreshing
                        ? null
                        : () => controller.restartRuntime(),
                icon: const Icon(Icons.restart_alt_outlined),
                label: const Text("重启运行时"),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _CronJobsWorkboard extends StatelessWidget {
  const _CronJobsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        _SectionCard(
          title: "Cron Jobs",
          subtitle: "保留 OpenClaw 的计划任务页面职责；当前只展示现有数据面里最接近自动运行的信号。",
          child: _FactGrid(
            items: [
              ("活动任务", shell.totalTaskCount.toString()),
              ("待处理审批", shell.pendingActionCount.toString()),
              ("待用户处理", shell.waitingUserCount.toString()),
              ("状态", "等待独立 cron 快照"),
            ],
          ),
        ),
        const SizedBox(height: 14),
        DesktopSurfaceCard(
          padding: const EdgeInsets.all(16),
          tone: DesktopSurfaceTone.muted,
          child: Text(
            "当前桌面快照未暴露独立 cron 列表、启停和手动触发入口，这一版先不通过 UI 反推新的服务接口。",
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _SkillsWorkboard extends StatelessWidget {
  const _SkillsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    final visibleAgents = shell.agents.take(8).toList(growable: false);
    return ListView(
      children: [
        _SectionCard(
          title: "技能状态",
          subtitle: "对齐 OpenClaw 的 Skills 页面，先承接当前可见的技能承载对象和启用状态。",
          child: Column(
            children:
                visibleAgents.isEmpty
                    ? [
                      Text(
                        "当前没有可见技能包。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleAgents
                        .map(
                          (agent) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(agent["name"], "未命名代理"),
                              subtitle:
                                  "技能 ${asString(agent["skillCount"], "0")} · 表面 ${asString(agent["surfaceCount"], "0")}",
                              trailing: asBool(agent["active"]) ? "活动中" : "停用",
                            ),
                          ),
                        )
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        DesktopSurfaceCard(
          padding: const EdgeInsets.all(16),
          tone: DesktopSurfaceTone.muted,
          child: Text(
            "安装新技能、更新 API Key 和更细的技能开关仍需要独立的数据面；这一版不在 UI 层伪造这些动作。",
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _NodesWorkboard extends StatelessWidget {
  const _NodesWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        _SectionCard(
          title: "节点列表",
          subtitle: "按 OpenClaw 的 Nodes 页面展示本地节点、能力和当前承载对象。",
          child: _FactGrid(
            items: [
              ("节点类型", "本地运行时"),
              ("运行时版本", shell.runtimeVersion),
              ("活动代理", shell.agents.length.toString()),
              ("渠道绑定", shell.surfaces.length.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "节点能力",
          subtitle: "节点级别的受控能力和当前运行姿态。",
          child: _FactGrid(
            items: [
              (
                "能力预设",
                _localizedOptionLabel(
                  asString(shell.capabilitySection["preset"], "managed_high"),
                ),
              ),
              ("MCP 授权", shell.capabilityMcpGrants.length.toString()),
              ("受控条目", shell.governanceEntries.length.toString()),
              ("近期活动", shell.capabilityRecentActivity.length.toString()),
            ],
          ),
        ),
      ],
    );
  }
}

class _ExecApprovalsWorkboard extends StatelessWidget {
  const _ExecApprovalsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        _SectionCard(
          title: "Ask Policy",
          subtitle: "执行审批页先对齐 OpenClaw 的 ask policy 语义，而不是暴露内部审批模型。",
          child: _FactGrid(
            items: [
              ("网关侧 ask policy", "等待独立 exec.approvals 快照"),
              ("节点数", "1"),
              ("本地网关", shell.runtimeWsUrl.isEmpty ? "未上报" : shell.runtimeWsUrl),
              ("待人工确认", shell.pendingActionCount.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "Node Allowlist",
          subtitle: "当前版本先保留页面骨架；待独立数据面接入后再还原更细的节点授权配置。",
          child: _FactGrid(
            items: [
              ("允许节点", "1"),
              ("默认节点", "本地运行时"),
              ("待确认请求", shell.pendingActionCount.toString()),
              (
                "最近动作",
                shell.actionQueue.isEmpty ? "无" : shell.actionQueue.first.title,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ConfigWorkboard extends StatelessWidget {
  const _ConfigWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    final capabilitySection = shell.capabilitySection;
    return ListView(
      children: [
        _SectionCard(
          title: "当前配置",
          subtitle: "按 OpenClaw 的 Config 页面展示当前本地配置真相和目录路径。",
          child: _FactGrid(
            items: [
              (
                "工作区根目录",
                asString(shell.instanceSection["workspaceRoot"], "n/a"),
              ),
              ("实例根目录", shell.instanceRoot),
              ("网关地址", shell.runtimeWsUrl.isEmpty ? "未上报" : shell.runtimeWsUrl),
              (
                "传输",
                asString(shell.gatewaySection["transport"], "websocket-rpc"),
              ),
              (
                "能力预设",
                _localizedOptionLabel(
                  asString(capabilitySection["preset"], "managed_high"),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        DesktopSurfaceCard(
          padding: const EdgeInsets.all(16),
          tone: DesktopSurfaceTone.muted,
          child: Text(
            "当前桌面端还没有独立的 config 读写提交接口，这一版只做配置展示，不在 UI 层伪造写入能力。",
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _DebugWorkboard extends StatelessWidget {
  const _DebugWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    final process = asMap(shell.runtimeHealth["process"]);
    return ListView(
      children: [
        _SectionCard(
          title: "Status & Health",
          subtitle: "按 OpenClaw 的 Debug 页面保留进程状态、健康和调试计数。",
          child: _FactGrid(
            items: [
              ("PID", asString(process["pid"], "n/a")),
              ("RSS", _formatBytes(asInt(process["rssBytes"]))),
              ("记忆", shell.memoryCount.toString()),
              ("策略", shell.strategyCount.toString()),
              ("联邦出站", shell.outboxPendingCount.toString()),
              ("演化候选", shell.evolutionCandidates.length.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "调试快照",
          subtitle: "展示当前桌面已经拿到的调试上下文，而不扩展新的服务接口。",
          child: _FactGrid(
            items: [
              ("待处理审批", shell.pendingActionCount.toString()),
              ("当前告警", shell.warnings.isEmpty ? "无" : shell.warnings.first),
              ("最近状态", shell.lastStatusMessage ?? "无"),
              ("网关地址", shell.runtimeWsUrl.isEmpty ? "未上报" : shell.runtimeWsUrl),
            ],
          ),
        ),
      ],
    );
  }
}

class _LogsWorkboard extends StatelessWidget {
  const _LogsWorkboard({required this.shell});

  final DesktopShellState shell;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        _SectionCard(
          title: "日志状态",
          subtitle: "按 OpenClaw 的 Logs 页面收口日志目录、告警和常用日志动作。",
          child: _FactGrid(
            items: [
              ("日志目录", asString(shell.instanceSection["logRoot"], "n/a")),
              ("当前告警", shell.warnings.isEmpty ? "无" : shell.warnings.first),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Consumer(
          builder: (context, ref, _) {
            final controller = ref.read(shellControllerProvider.notifier);
            return Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  onPressed:
                      shell.isRefreshing ? null : () => controller.openLogs(),
                  icon: const Icon(Icons.folder_open_outlined),
                  label: const Text("打开日志"),
                ),
                OutlinedButton.icon(
                  onPressed:
                      shell.isRefreshing ? null : () => controller.refresh(),
                  icon: const Icon(Icons.sync),
                  label: const Text("刷新状态"),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _UpdateWorkboard extends ConsumerWidget {
  const _UpdateWorkboard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrapAsync = ref.watch(bootstrapControllerProvider);
    return bootstrapAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Text(error.toString()),
      data:
          (bootstrap) => ListView(
            children: [
              _SectionCard(
                title: "当前版本",
                subtitle: "按 OpenClaw 的 Update 页面展示当前版本和可用更新。",
                child: _FactGrid(
                  items: [
                    (
                      "当前版本",
                      bootstrap.currentVersion.isEmpty
                          ? "未安装"
                          : bootstrap.currentVersion,
                    ),
                    (
                      "可用版本",
                      bootstrap.latestRelease == null
                          ? "未检查"
                          : bootstrap.latestRelease!.version,
                    ),
                    (
                      "发布状态",
                      bootstrap.releaseStatusMessage ?? bootstrap.releaseStatus,
                    ),
                    ("下载目录", bootstrap.downloadsRoot),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  OutlinedButton.icon(
                    onPressed:
                        bootstrap.isBusy
                            ? null
                            : () => ref
                                .read(bootstrapControllerProvider.notifier)
                                .checkForUpdates(force: true),
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text("检查更新"),
                  ),
                  FilledButton.icon(
                    onPressed:
                        bootstrap.isBusy || bootstrap.latestRelease == null
                            ? null
                            : () =>
                                ref
                                    .read(bootstrapControllerProvider.notifier)
                                    .downloadCore(),
                    icon: const Icon(Icons.download_rounded),
                    label: const Text("下载核心"),
                  ),
                ],
              ),
            ],
          ),
    );
  }
}

class _TaskWorkboard extends ConsumerWidget {
  const _TaskWorkboard({
    required this.shell,
    required this.searchQuery,
    this.title = "任务执行工作台",
    this.subtitle = "这里承载运行中的任务详情、步骤、检查点与复盘时间线，是桌面端的正式执行视图。",
  });

  final DesktopShellState shell;
  final String searchQuery;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final selectedTask = shell.selectedTask;
    final task = asMap(selectedTask?["task"]);
    final runs = asMapList(selectedTask?["runs"]);
    final reviews = asMapList(selectedTask?["reviews"]);
    final activeSteps = asMapList(selectedTask?["activeSteps"]);
    final archivedSteps = asMapList(selectedTask?["archivedSteps"]);
    final taskMatches = _matchesSearch(searchQuery, [
      task["title"],
      task["status"],
      task["route"],
      task["worker"],
      task["goal"],
      task["nextAction"],
    ]);
    final visibleRuns = runs
        .where(
          (run) => _matchesSearch(searchQuery, [
            run["id"],
            run["status"],
            run["thinkingLane"],
            run["summary"],
          ]),
        )
        .toList(growable: false);
    final visibleReviews = reviews
        .where(
          (review) => _matchesSearch(searchQuery, [
            review["summary"],
            review["outcome"],
            review["createdAt"],
          ]),
        )
        .toList(growable: false);
    final visibleActiveSteps = activeSteps
        .where(
          (step) => _matchesSearch(searchQuery, [
            step["title"],
            step["kind"],
            step["summary"],
            step["output"],
          ]),
        )
        .toList(growable: false);
    final searchHasResults =
        searchQuery.isEmpty ||
        taskMatches ||
        visibleRuns.isNotEmpty ||
        visibleReviews.isNotEmpty ||
        visibleActiveSteps.isNotEmpty;
    final selectedTaskId = asString(
      task["id"],
      shell.defaultTaskFocus?.id ?? "",
    );
    return ListView(
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final stackActions = constraints.maxWidth < 360;
            final actions =
                selectedTaskId.isEmpty
                    ? const <Widget>[]
                    : [
                      OutlinedButton.icon(
                        onPressed: () => controller.retryTask(selectedTaskId),
                        icon: const Icon(Icons.replay),
                        label: const Text("重试"),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => controller.cancelTask(selectedTaskId),
                        icon: const Icon(Icons.stop_circle_outlined),
                        label: const Text("取消任务"),
                      ),
                    ];
            return stackActions
                ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    if (actions.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Wrap(spacing: 10, runSpacing: 10, children: actions),
                    ],
                  ],
                )
                : Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: Theme.of(context).textTheme.headlineMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            subtitle,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                    if (actions.isNotEmpty) ...[
                      const SizedBox(width: 12),
                      Wrap(spacing: 10, runSpacing: 10, children: actions),
                    ],
                  ],
                );
          },
        ),
        const SizedBox(height: 18),
        if (!searchHasResults)
          _SectionCard(
            title: "没有匹配内容",
            subtitle: "试试搜索任务标题、状态、步骤摘要或复盘结果。",
            child: Text(
              "当前搜索词没有命中这个任务工作板里的内容。",
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          )
        else if (task.isNotEmpty && (searchQuery.isEmpty || taskMatches))
          _SectionCard(
            title: asString(task["title"], "当前任务"),
            subtitle:
                "${_localizedStatusLabel(asString(task["status"], "queued"))} · ${_localizedOptionLabel(asString(task["route"], "general"))} · ${_localizedOptionLabel(asString(task["worker"], "main"))}",
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FactGrid(
                  items: [
                    ("任务 ID", asString(task["id"])),
                    (
                      "优先级",
                      _localizedOptionLabel(
                        asString(task["priority"], "normal"),
                      ),
                    ),
                    ("下一步动作", asString(task["nextAction"], "暂未排入下一动作")),
                    ("更新时间", _formatTimestamp(asInt(task["updatedAt"]))),
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
            title: "尚未选择任务",
            subtitle: "从左侧任务列表选中一个任务，或在中栏提交一个新的目标。",
            child: Text(
              "任务一旦被运行时正式物化，这里就会成为它的标准执行视图。",
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "活动执行步骤",
          subtitle: "这些是当前仍保留在活动上下文窗口里的执行步骤。",
          child:
              visibleActiveSteps.isEmpty
                  ? Text(
                    searchQuery.isEmpty ? "当前运行里还没有活动步骤。" : "没有匹配当前搜索词的活动步骤。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                  : Column(
                    children: visibleActiveSteps
                        .map(
                          (step) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(
                                step["title"],
                                asString(step["kind"], "步骤"),
                              ),
                              subtitle: asString(
                                step["summary"],
                                asString(step["output"], "尚未记录输出"),
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
          title: "运行与评审",
          subtitle: "任务循环会把运行、复盘和已归档步骤显式展开，而不是把它们埋进聊天记录。",
          child: Column(
            children: [
              if (visibleRuns.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    searchQuery.isEmpty ? "当前还没有记录到任务运行。" : "没有匹配当前搜索词的任务运行。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ...visibleRuns
                  .take(4)
                  .map(
                    (run) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _TimelineTile(
                        title: asString(run["id"], "运行记录"),
                        subtitle:
                            "${_localizedStatusLabel(asString(run["status"], "queued"))} · ${_localizedOptionLabel(asString(run["thinkingLane"], "system1"))}",
                        trailing: _formatTimestamp(asInt(run["updatedAt"])),
                      ),
                    ),
                  ),
              if (visibleReviews.isNotEmpty) ...[
                const Divider(height: 28),
                ...visibleReviews
                    .take(3)
                    .map(
                      (review) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _TimelineTile(
                          title: asString(review["summary"], "复盘记录"),
                          subtitle: asString(review["outcome"], "已记录"),
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
                  "已有 ${archivedSteps.length} 个步骤被压缩进归档层。",
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

// ignore: unused_element
class _MemoryWorkboard extends ConsumerWidget {
  const _MemoryWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final selectedTaskId = shell.selectedTaskSummary?.id;
    final visibleMemories = shell.memories
        .where(
          (memory) => _matchesSearch(searchQuery, [
            memory["summary"],
            memory["detail"],
            memory["memoryType"],
            memory["route"],
            memory["scope"],
          ]),
        )
        .toList(growable: false);
    final visibleStrategies = shell.strategies
        .where(
          (strategy) => _matchesSearch(searchQuery, [
            strategy["summary"],
            strategy["route"],
            strategy["worker"],
          ]),
        )
        .toList(growable: false);
    final visibleIntelItems = shell.intelRecentItems
        .where(
          (item) => _matchesSearch(searchQuery, [
            item["title"],
            item["summary"],
            item["kind"],
            item["domain"],
          ]),
        )
        .toList(growable: false);
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "记忆与策略工作台",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "ClawMark 会把正式记忆和策略显式摊开，而不是埋在单一会话文本里。",
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
              label: const Text("执行生命周期复审"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "记忆姿态",
          subtitle: "正式记忆由 Runtime Core 持有，但治理动作仍然保持本地、显式和可审计。",
          child: _FactGrid(
            items: [
              ("正式记忆", visibleMemories.length.toString()),
              ("策略数量", visibleStrategies.length.toString()),
              (
                "失效记忆",
                visibleMemories
                    .where(
                      (memory) =>
                          asStringList(memory["invalidatedBy"]).isNotEmpty,
                    )
                    .length
                    .toString(),
              ),
              ("近期情报项", visibleIntelItems.length.toString()),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "记忆内核",
          subtitle:
              searchQuery.isEmpty
                  ? "${shell.memoryCount} 条正式记忆 · ${shell.strategyCount} 条策略"
                  : "已按当前搜索词筛选记忆内容",
          child: Column(
            children:
                visibleMemories.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty
                            ? "当前还没有可见的正式记忆。"
                            : "没有匹配当前搜索词的正式记忆。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleMemories
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone:
                                  invalidatedBy.isEmpty
                                      ? DesktopSurfaceTone.muted
                                      : DesktopSurfaceTone.danger,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(memory["summary"], "记忆项"),
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
                                    "${_localizedOptionLabel(asString(memory["memoryType"], "knowledge"))} · ${_localizedOptionLabel(asString(memory["route"], "general"))} · ${_localizedOptionLabel(asString(memory["scope"], "runtime"))}",
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    "置信度=${asString(memory["confidence"], "0")} · 衰减=${asString(memory["decayScore"], "0")} · 更新时间=${_formatTimestamp(asInt(memory["updatedAt"]))}",
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
                                      "最近一次失效事件：$latestInvalidation",
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
                                        child: const Text("强化"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing ||
                                                    memoryId.isEmpty ||
                                                    invalidatedBy.isNotEmpty
                                                ? null
                                                : () => controller
                                                    .invalidateMemory(memoryId),
                                        child: const Text("失效化"),
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
                                          child: const Text("回滚失效"),
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
          title: "策略平面",
          subtitle: "当前生效的路由级策略会继续在桌面控制台里保持可检视。",
          child: Column(
            children:
                visibleStrategies.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty ? "当前还没有可见策略。" : "没有匹配当前搜索词的策略。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleStrategies
                        .take(8)
                        .map((strategy) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(strategy["summary"], "策略项"),
                              subtitle:
                                  "${_localizedOptionLabel(asString(strategy["route"], "general"))} · ${_localizedOptionLabel(asString(strategy["worker"], "main"))}",
                              trailing: _formatTimestamp(
                                asInt(strategy["updatedAt"]),
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "近期情报项",
          subtitle: "情报保持为旁路模块，直到你明确把某条内容提升为正式知识记忆。",
          child: Column(
            children:
                visibleIntelItems.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty ? "当前没有近期情报项。" : "没有匹配当前搜索词的情报项。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleIntelItems
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(item["title"], "情报项"),
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
                                    "${_localizedOptionLabel(asString(item["kind"], "candidate"))} · ${_localizedOptionLabel(asString(item["domain"], "ai"))} · 评分=${asString(item["score"], "0")}",
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
                                        child: Text(pinned ? "已提升" : "提升为知识"),
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
  const _GovernanceWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

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

  Map<String, dynamic>? _rowById(List<Map<String, dynamic>> rows, String? id) {
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
    final overlay =
        shell.agentOverlays
            .where(
              (entry) => asString(entry["agentId"]) == asString(record?["id"]),
            )
            .cast<Map<String, dynamic>?>()
            .firstOrNull;
    _editingAgentId = record == null ? null : asString(record["id"]);
    _agentNameController.text = asString(record?["name"]);
    _agentDescriptionController.text = asString(record?["description"]);
    _agentRoleBaseController.text = asString(record?["roleBase"]);
    _agentMemoryNamespaceController.text = asString(record?["memoryNamespace"]);
    _agentSkillIdsController.text = asStringList(
      record?["skillIds"],
    ).join(", ");
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
    _surfaceReportTarget = asString(status?["reportTarget"], "runtime-user");
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
    _surfaceRoleScopeController.text = asString(
      localBusinessPolicy["roleScope"],
    );
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
    final query = widget.searchQuery;
    final governanceStateCounts = asMap(
      capabilitySection["governanceStateCounts"],
    );
    final roleOptimizationActions = shell.actionQueue
        .where((entry) => entry.isRoleOptimization)
        .toList(growable: false);
    final visibleAgents = shell.agents
        .where((agent) {
          final agentId = asString(agent["id"]);
          final raw = _rowById(shell.agentRecords, agentId);
          return _matchesSearch(query, [
            agent["name"],
            agent["roleBase"],
            agent["reportPolicy"],
            raw?["description"],
            raw?["memoryNamespace"],
            raw?["skillIds"],
          ]);
        })
        .toList(growable: false);
    final visibleSurfaces = shell.surfaces
        .where(
          (surface) => _matchesSearch(query, [
            surface["label"],
            surface["channel"],
            surface["accountId"],
            surface["ownerLabel"],
            surface["role"],
            surface["reportTarget"],
            asMap(surface["localBusinessPolicy"])["taskCreation"],
          ]),
        )
        .toList(growable: false);
    final visibleEvolutionCandidates = shell.evolutionCandidates
        .where(
          (candidate) => _matchesSearch(query, [
            candidate["summary"],
            candidate["estimatedImpact"],
            candidate["state"],
          ]),
        )
        .toList(growable: false);
    final visibleRoleOptimizationActions = roleOptimizationActions
        .where(
          (action) => _matchesSearch(query, [
            action.title,
            action.summary,
            action.priority,
            action.estimatedImpact,
            action.candidateId,
          ]),
        )
        .toList(growable: false);
    final visibleGovernanceEntries = shell.governanceEntries
        .where(
          (entry) => _matchesSearch(query, [
            entry["targetId"],
            entry["registryType"],
            entry["summary"],
            entry["executionSummary"],
            entry["state"],
          ]),
        )
        .toList(growable: false);
    final visibleMcpGrants = shell.capabilityMcpGrants
        .where(
          (grant) => _matchesSearch(query, [
            grant["agentLabel"],
            grant["agentId"],
            grant["mcpServerId"],
            grant["state"],
            grant["summary"],
          ]),
        )
        .toList(growable: false);
    final visibleRecentActivity = shell.capabilityRecentActivity
        .where(
          (activity) => _matchesSearch(query, [
            activity["title"],
            activity["summary"],
            activity["kind"],
          ]),
        )
        .toList(growable: false);
    final selectedAgentStatus = _rowById(shell.agents, _editingAgentId);
    final selectedSurfaceStatus = _rowById(shell.surfaces, _editingSurfaceId);
    final activeAgentCount =
        shell.agentRecords
            .where((entry) => asBool(entry["active"], true))
            .length;
    final activeSurfaceCount =
        shell.surfaceRecords
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
                    "治理工作板",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "候选、已采纳、影子和阻止等能力状态会持续保持对操作员可见。",
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
              label: const Text("同步注册表"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        if (query.isNotEmpty) ...[
          _SectionCard(
            title: "搜索已生效",
            subtitle: "治理列表已经按当前关键词筛选，表单编辑器仍保持可用。",
            child: _FactGrid(
              items: [
                ("关键词", query),
                ("智能体", visibleAgents.length.toString()),
                ("表面", visibleSurfaces.length.toString()),
                ("演化候选", visibleEvolutionCandidates.length.toString()),
                ("角色优化", visibleRoleOptimizationActions.length.toString()),
                ("注册表", visibleGovernanceEntries.length.toString()),
                ("MCP 授权", visibleMcpGrants.length.toString()),
                ("最近活动", visibleRecentActivity.length.toString()),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        _SectionCard(
          title: "治理姿态",
          subtitle: "运行时能力策略保持显式、可检查且本地拥有。",
          child: _FactGrid(
            items: [
              (
                "预设",
                _localizedOptionLabel(
                  asString(capabilitySection["preset"], "managed_high"),
                ),
              ),
              ("条目数", shell.governanceEntries.length.toString()),
              ("MCP 授权", shell.capabilityMcpGrants.length.toString()),
              ("覆层数", asString(capabilitySection["overlayCount"])),
              ("智能体", shell.agentRecords.length.toString()),
              ("已启用智能体", activeAgentCount.toString()),
              ("表面数", shell.surfaceRecords.length.toString()),
              ("已启用表面", activeSurfaceCount.toString()),
              ("阻止", asString(governanceStateCounts["blocked"], "0")),
              ("影子", asString(governanceStateCounts["shadow"], "0")),
              ("候选", asString(governanceStateCounts["candidate"], "0")),
              ("已采纳", asString(governanceStateCounts["adopted"], "0")),
              ("核心", asString(governanceStateCounts["core"], "0")),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "智能体列表",
          subtitle:
              query.isEmpty
                  ? "${shell.agentRecords.length} 个受治理约束、拥有本地所有权的运行时智能体。"
                  : "已按当前搜索词筛选智能体列表。",
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
                    label: const Text("新建智能体"),
                  ),
                  if ((_editingAgentId ?? "").isNotEmpty)
                    OutlinedButton.icon(
                      onPressed:
                          shell.isRefreshing
                              ? null
                              : () => setState(
                                () =>
                                    _resetAgentDraft(agentId: _editingAgentId),
                              ),
                      icon: const Icon(Icons.refresh),
                      label: const Text("重置草稿"),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              if (visibleAgents.isEmpty)
                Text(
                  query.isEmpty ? "当前还没有定义运行时智能体。" : "没有匹配当前搜索词的智能体。",
                  style: Theme.of(context).textTheme.bodyMedium,
                )
              else
                Column(
                  children: visibleAgents
                      .take(8)
                      .map((agent) {
                        final agentId = asString(agent["id"]);
                        final raw = _rowById(shell.agentRecords, agentId);
                        final selected = agentId == (_editingAgentId ?? "");
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: DesktopSurfaceCard(
                            padding: const EdgeInsets.all(14),
                            tone:
                                selected
                                    ? DesktopSurfaceTone.accent
                                    : DesktopSurfaceTone.muted,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        asString(agent["name"], "智能体"),
                                        style:
                                            Theme.of(
                                              context,
                                            ).textTheme.titleMedium,
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
                                  "${asString(agent["roleBase"], "未设置角色基底")} · ${asString(raw?["memoryNamespace"], "自动分配记忆命名空间")}",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  "技能=${asString(raw?["skillIds"] is List ? (raw?["skillIds"] as List).length : 0)} · 表面=${asString(agent["surfaceCount"], "0")} · 打开任务=${asString(agent["openTaskCount"], "0")} · 汇报=${_localizedOptionLabel(asString(agent["reportPolicy"], "default"))}",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                                if (asString(
                                  raw?["description"],
                                ).isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    asString(raw?["description"]),
                                    style:
                                        Theme.of(context).textTheme.bodyMedium,
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
                                                () => _resetAgentDraft(
                                                  agentId: agentId,
                                                ),
                                              ),
                                      child: const Text("编辑"),
                                    ),
                                    if (asInt(agent["surfaceCount"]) > 0)
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing
                                                ? null
                                                : () {
                                                  final ownedSurface =
                                                      shell.surfaceRecords
                                                          .where(
                                                            (surface) =>
                                                                asString(
                                                                      surface["ownerKind"],
                                                                    ) ==
                                                                    "agent" &&
                                                                asString(
                                                                      surface["ownerId"],
                                                                    ) ==
                                                                    agentId,
                                                          )
                                                          .cast<
                                                            Map<
                                                              String,
                                                              dynamic
                                                            >?
                                                          >()
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
                                        child: const Text("打开表面"),
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
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "智能体编辑器",
          subtitle:
              (_editingAgentId ?? "").isEmpty
                  ? "无需离开桌面操作面，就可以创建新的生态智能体。"
                  : "更新所选运行时智能体，同时让治理继续保持本地化。",
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
                        labelText: "智能体名称",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 280,
                    child: TextFormField(
                      controller: _agentRoleBaseController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "角色基底",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 320,
                    child: TextFormField(
                      controller: _agentMemoryNamespaceController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "记忆命名空间",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _agentSkillIdsController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "技能 ID（逗号分隔）",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _agentCommunicationStyleController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "沟通风格",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("agent-report-policy-$_agentReportPolicy"),
                      initialValue: _agentReportPolicy,
                      decoration: const InputDecoration(
                        labelText: "汇报策略",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "描述",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "智能体备注",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                  title: const Text("启用智能体"),
                ),
              ),
              if ((_editingAgentId ?? "").isNotEmpty &&
                  selectedAgentStatus != null) ...[
                const SizedBox(height: 8),
                _FactGrid(
                  items: [
                    (
                      "打开任务",
                      asString(selectedAgentStatus["openTaskCount"], "0"),
                    ),
                    (
                      "等待用户",
                      asString(
                        selectedAgentStatus["waitingUserTaskCount"],
                        "0",
                      ),
                    ),
                    (
                      "近期完成",
                      asString(
                        selectedAgentStatus["recentCompletionReportCount"],
                        "0",
                      ),
                    ),
                    (
                      "近期情报",
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
                      (_editingAgentId ?? "").isEmpty ? "创建智能体" : "保存智能体",
                    ),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(
                              () => _resetAgentDraft(agentId: _editingAgentId),
                            ),
                    child: const Text("重置"),
                  ),
                  if ((_editingAgentId ?? "").isNotEmpty)
                    OutlinedButton(
                      onPressed:
                          shell.isRefreshing
                              ? null
                              : () => controller.deleteAgent(_editingAgentId!),
                      child: const Text("删除智能体"),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "表面列表",
          subtitle:
              query.isEmpty
                  ? "${shell.surfaceRecords.length} 个受运行时策略约束的本地操作员表面与智能体绑定表面。"
                  : "已按当前搜索词筛选表面列表。",
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
                    label: const Text("新建表面"),
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
                      label: const Text("重置草稿"),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              if (visibleSurfaces.isEmpty)
                Text(
                  query.isEmpty ? "当前还没有定义表面。" : "没有匹配当前搜索词的表面。",
                  style: Theme.of(context).textTheme.bodyMedium,
                )
              else
                Column(
                  children: visibleSurfaces
                      .take(10)
                      .map((surface) {
                        final surfaceId = asString(surface["id"]);
                        final selected = surfaceId == (_editingSurfaceId ?? "");
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: DesktopSurfaceCard(
                            padding: const EdgeInsets.all(14),
                            tone:
                                selected
                                    ? DesktopSurfaceTone.accent
                                    : DesktopSurfaceTone.muted,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        asString(surface["label"], "表面"),
                                        style:
                                            Theme.of(
                                              context,
                                            ).textTheme.titleMedium,
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
                                  "${asString(surface["channel"], "渠道")} · ${asString(surface["accountId"], "账号")} · ${asString(surface["ownerLabel"], "运行时用户")}",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  "${asString(surface["role"], "未设置角色覆层")} · 任务创建=${_localizedOptionLabel(asString(asMap(surface["localBusinessPolicy"])["taskCreation"], "recommend_only"))} · 升级目标=${_localizedOptionLabel(asString(surface["reportTarget"], "runtime-user"))}",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  "打开任务=${asString(surface["openTaskCount"], "0")} · 等待用户=${asString(surface["waitingUserTaskCount"], "0")} · 协调待处理=${asString(surface["pendingCoordinatorSuggestionCount"], "0")}",
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
                                      child: const Text("编辑"),
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
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "表面编辑器",
          subtitle:
              (_editingSurfaceId ?? "").isEmpty
                  ? "把新的表面绑定到桌面控制台或某个指定智能体。"
                  : "更新所选表面的归属信息与路由元数据。",
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
                        labelText: "渠道",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 280,
                    child: TextFormField(
                      controller: _surfaceAccountIdController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "账号 ID",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 320,
                    child: TextFormField(
                      controller: _surfaceLabelController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "表面标签",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("surface-owner-kind-$_surfaceOwnerKind"),
                      initialValue: _surfaceOwnerKind,
                      decoration: const InputDecoration(
                        labelText: "所属对象类型",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["user", "agent"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        key: ValueKey(
                          "surface-owner-agent-$_surfaceOwnerAgentId",
                        ),
                        initialValue:
                            _surfaceOwnerAgentId.isEmpty
                                ? null
                                : _surfaceOwnerAgentId,
                        decoration: const InputDecoration(
                          labelText: "所属智能体",
                          filled: true,
                          fillColor: DesktopTokens.surfaceMuted,
                        ),
                        items: shell.agentRecords
                            .map(
                              (agent) => DropdownMenuItem<String>(
                                value: asString(agent["id"]),
                                child: Text(asString(agent["name"], "智能体")),
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
                  title: const Text("启用表面"),
                ),
              ),
              if ((_editingSurfaceId ?? "").isNotEmpty &&
                  selectedSurfaceStatus != null) ...[
                const SizedBox(height: 8),
                _FactGrid(
                  items: [
                    (
                      "所属对象",
                      asString(selectedSurfaceStatus["ownerLabel"], "运行时"),
                    ),
                    (
                      "角色来源",
                      _localizedOptionLabel(
                        asString(
                          selectedSurfaceStatus["roleSource"],
                          "derived",
                        ),
                      ),
                    ),
                    (
                      "打开任务",
                      asString(selectedSurfaceStatus["openTaskCount"], "0"),
                    ),
                    (
                      "最近活动",
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
                                _surfaceAccountIdController.text
                                    .trim()
                                    .isEmpty ||
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
                      (_editingSurfaceId ?? "").isEmpty ? "创建表面" : "保存表面",
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
                    child: const Text("重置"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "表面角色覆层",
          subtitle:
              (_editingSurfaceId ?? "").isEmpty
                  ? "请先保存表面，再把角色覆层提升为本地运行时真相。"
                  : "角色、语气、话题边界与本地业务策略始终保持白名单化并由运行时持有。",
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
                        labelText: "角色",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "业务目标",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "语气",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 220,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey("surface-initiative-$_surfaceInitiative"),
                      initialValue: _surfaceInitiative,
                      decoration: const InputDecoration(
                        labelText: "主动性",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["low", "medium", "high"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "汇报目标",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["runtime-user", "surface-owner"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                      key: ValueKey(
                        "surface-task-creation-$_surfaceTaskCreation",
                      ),
                      initialValue: _surfaceTaskCreation,
                      decoration: const InputDecoration(
                        labelText: "任务创建",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["recommend_only", "disabled"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "升级目标",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["runtime-user", "surface-owner"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "角色范围",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "允许话题（逗号分隔）",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "限制话题（逗号分隔）",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                    child: const Text("保存覆层"),
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
                    child: const Text("重置覆层"),
                  ),
                ],
              ),
              if ((_editingSurfaceId ?? "").isNotEmpty &&
                  selectedSurfaceStatus != null) ...[
                const SizedBox(height: 12),
                _FactGrid(
                  items: [
                    (
                      "已存在覆层",
                      _localizedOptionLabel(
                        asString(selectedSurfaceStatus["overlayPresent"]),
                      ),
                    ),
                    (
                      "角色来源",
                      _localizedOptionLabel(
                        asString(
                          selectedSurfaceStatus["roleSource"],
                          "derived",
                        ),
                      ),
                    ),
                    (
                      "语气来源",
                      _localizedOptionLabel(
                        asString(
                          selectedSurfaceStatus["toneSource"],
                          "derived",
                        ),
                      ),
                    ),
                    (
                      "策略来源",
                      _localizedOptionLabel(
                        asString(
                          selectedSurfaceStatus["localBusinessPolicySource"],
                          "derived",
                        ),
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
          title: "演化候选项",
          subtitle:
              query.isEmpty
                  ? "${shell.evolutionCandidates.length} 个候选项正在本地队列中等待处理"
                  : "已按当前搜索词筛选演化候选项。",
          child: Column(
            children:
                visibleEvolutionCandidates.isEmpty
                    ? [
                      Text(
                        query.isEmpty
                            ? "当前没有等待本地复审的演化候选项。"
                            : "没有匹配当前搜索词的演化候选项。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleEvolutionCandidates
                        .take(8)
                        .map((candidate) {
                          final id = asString(candidate["id"]);
                          final state = asString(
                            candidate["state"],
                            "candidate",
                          );
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            candidate["summary"],
                                            "演化候选项",
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
                                      "尚未提供预估影响。",
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
                                        child: const Text("采纳"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing || id.isEmpty
                                                ? null
                                                : () => controller
                                                    .rejectEvolution(id),
                                        child: const Text("拒绝"),
                                      ),
                                      OutlinedButton(
                                        onPressed:
                                            shell.isRefreshing || id.isEmpty
                                                ? null
                                                : () => controller
                                                    .revertEvolution(id),
                                        child: const Text("回退"),
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
          title: "角色优化队列",
          subtitle:
              query.isEmpty
                  ? "${roleOptimizationActions.length} 条操作员可见的表面角色建议仍在动作队列中等待处理。"
                  : "已按当前搜索词筛选角色优化动作。",
          child: Column(
            children:
                visibleRoleOptimizationActions.isEmpty
                    ? [
                      Text(
                        query.isEmpty ? "当前没有等待中的角色优化动作。" : "没有匹配当前搜索词的角色优化动作。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleRoleOptimizationActions
                        .take(6)
                        .map((action) {
                          final candidateId = action.candidateId ?? "";
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
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
                                        child: const Text("采纳覆层"),
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
                                        child: const Text("拒绝覆层"),
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
          title: "能力注册表",
          subtitle:
              query.isEmpty
                  ? "${shell.governanceEntries.length} 条受治理约束的技能、智能体和 MCP 注册项。"
                  : "已按当前搜索词筛选治理注册表。",
          child: Column(
            children:
                visibleGovernanceEntries.isEmpty
                    ? [
                      Text(
                        query.isEmpty
                            ? "当前运行时快照里没有可见的受治理能力条目。"
                            : "没有匹配当前搜索词的治理能力条目。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleGovernanceEntries
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          targetId.isEmpty ? "条目" : targetId,
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
                                    "$registryType · ${asString(entry["executionSummary"], asString(entry["summary"], "受治理"))}",
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
                                            label: Text(
                                              _localizedOptionLabel(stateValue),
                                            ),
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
          title: "MCP 授权",
          subtitle:
              query.isEmpty
                  ? "${shell.capabilityMcpGrants.length} 条宿主持有的智能体到 MCP 授权当前可见。"
                  : "已按当前搜索词筛选 MCP 授权列表。",
          child: Column(
            children:
                visibleMcpGrants.isEmpty
                    ? [
                      Text(
                        query.isEmpty
                            ? "当前没有可见的 MCP 授权。"
                            : "没有匹配当前搜索词的 MCP 授权。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleMcpGrants
                        .take(10)
                        .map((grant) {
                          final grantId = asString(grant["id"]);
                          final agentId = asString(grant["agentId"]);
                          final mcpServerId = asString(grant["mcpServerId"]);
                          final state = asString(grant["state"], "denied");
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
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
                                        label: const Text("允许"),
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
                                        label: const Text("拒绝"),
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
          title: "最近治理活动",
          subtitle:
              query.isEmpty
                  ? "本地治理变更与覆层影响会持续保持可见，而不是消失在日志里。"
                  : "已按当前搜索词筛选最近治理活动。",
          child: Column(
            children:
                visibleRecentActivity.isEmpty
                    ? [
                      Text(
                        query.isEmpty
                            ? "当前运行时快照里没有发现最近治理活动。"
                            : "没有匹配当前搜索词的最近治理活动。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleRecentActivity
                        .take(10)
                        .map((activity) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _TimelineTile(
                              title: asString(activity["title"], "活动"),
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

// ignore: unused_element
class _FederationWorkboard extends ConsumerWidget {
  const _FederationWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(shellControllerProvider.notifier);
    final visiblePackages = shell.federationPackages
        .where(
          (pkg) => _matchesSearch(searchQuery, [
            pkg["summary"],
            pkg["packageType"],
            pkg["sourceRuntimeId"],
            pkg["state"],
            pkg["reviewSummary"],
            pkg["localLandingSummary"],
          ]),
        )
        .toList(growable: false);
    final visibleCoordinatorSuggestions = shell.federationCoordinatorSuggestions
        .where(
          (entry) => _matchesSearch(searchQuery, [
            entry["title"],
            entry["summary"],
            entry["sourceRuntimeId"],
            entry["localTaskId"],
            entry["localTaskStatus"],
            entry["rematerializeReason"],
          ]),
        )
        .toList(growable: false);
    final visibleAssignments = shell.federationAssignments
        .where(
          (entry) => _matchesSearch(searchQuery, [
            entry["title"],
            entry["summary"],
            entry["sourceRuntimeId"],
            entry["route"],
            entry["worker"],
            entry["state"],
            entry["blockedReason"],
          ]),
        )
        .toList(growable: false);
    return ListView(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "联邦工作板",
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "同步由操作员治理，绝不会绕过本地真相所有权。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed: () => controller.syncFederation(),
              icon: const Icon(Icons.sync),
              label: const Text("立即同步"),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: "远端姿态",
          subtitle: "桌面壳通过本地回环控制，联邦同步保持出站模式。",
          child: _FactGrid(
            items: [
              ("已配置远端", asString(shell.federationSection["remoteConfigured"])),
              ("待发出站", shell.outboxPendingCount.toString()),
              (
                "待处理指派",
                asString(shell.federationSection["pendingAssignments"]),
              ),
              (
                "已确认头指针",
                asString(
                  shell.federationSection["acknowledgedOutboxEventId"],
                  "无",
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "收件包",
          subtitle:
              searchQuery.isEmpty
                  ? "${shell.federationPackages.length} 个包预览来自当前运行时快照。"
                  : "已按当前搜索词筛选联邦收件包。",
          child: Column(
            children:
                visiblePackages.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty ? "当前没有可见的收件包。" : "没有匹配当前搜索词的收件包。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visiblePackages
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(
                                            pkg["summary"],
                                            asString(pkg["packageType"], "包"),
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
                                    "${_localizedOptionLabel(asString(pkg["packageType"], "包"))} · ${asString(pkg["sourceRuntimeId"], "未知运行时")}",
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
                                                color: DesktopTokens.danger,
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
                                          child: const Text("采纳包"),
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
                                          child: const Text("拒绝包"),
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
                                          child: const Text("回退包"),
                                        ),
                                      if (packageId.isNotEmpty)
                                        OutlinedButton(
                                          onPressed:
                                              shell.isRefreshing
                                                  ? null
                                                  : () => controller.focusAction(
                                                    "federation-package:$packageId",
                                                  ),
                                          child: const Text("在队列中定位"),
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
          title: "协调建议",
          subtitle:
              searchQuery.isEmpty
                  ? "${shell.federationCoordinatorSuggestions.length} 条本地协调建议当前可见。"
                  : "已按当前搜索词筛选协调建议。",
          child: Column(
            children:
                visibleCoordinatorSuggestions.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty
                            ? "当前没有已采纳且仍在本地队列中等待的协调建议。"
                            : "没有匹配当前搜索词的协调建议。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleCoordinatorSuggestions
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(entry["title"], "协调建议"),
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
                                    "${asString(entry["sourceRuntimeId"], "未知运行时")} · 本地任务=${materializeTarget.isEmpty ? "无" : materializeTarget}",
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
                                              ? "生成本地任务"
                                              : "打开或重新生成",
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
                                                      DesktopPage.sessions,
                                                    );
                                                  },
                                          child: const Text("打开任务"),
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
          title: "指派收件箱",
          subtitle:
              searchQuery.isEmpty
                  ? "${shell.federationAssignments.length} 个指派预览来自本地联邦指派收件箱。"
                  : "已按当前搜索词筛选联邦指派。",
          child: Column(
            children:
                visibleAssignments.isEmpty
                    ? [
                      Text(
                        searchQuery.isEmpty
                            ? "当前没有等待中的联邦指派。"
                            : "没有匹配当前搜索词的联邦指派。",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ]
                    : visibleAssignments
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
                            child: DesktopSurfaceCard(
                              padding: const EdgeInsets.all(14),
                              tone: DesktopSurfaceTone.muted,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          asString(entry["title"], "联邦指派"),
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
                                    "${asString(entry["sourceRuntimeId"], "未知运行时")} · ${_localizedOptionLabel(asString(entry["route"], "未设置路由"))} · ${_localizedOptionLabel(asString(entry["worker"], "未设置工作器"))}",
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
                                        color: DesktopTokens.danger,
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
                                          child: const Text("生成"),
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
                                          child: const Text("阻止"),
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
                                          child: const Text("重置"),
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
                                          child: const Text("标记为已应用"),
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
                                                      DesktopPage.sessions,
                                                    );
                                                  },
                                          child: const Text("打开任务"),
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
  const _SettingsWorkboard({required this.shell, required this.searchQuery});

  final DesktopShellState shell;
  final String searchQuery;

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
    final query = widget.searchQuery;
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
    final visibleIntelDomainRows = intelDomainRows
        .where(
          (domain) => _matchesSearch(query, [
            domain["id"],
            domain["label"],
            domain["summary"],
          ]),
        )
        .toList(growable: false);
    return ListView(
      children: [
        Text("设置工作板", style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 8),
        Text(
          "这些设置由运行时持有，只是通过桌面控制台呈现出来，并不是本地 UI 自己的真相。",
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 18),
        if (query.isNotEmpty) ...[
          _SectionCard(
            title: "搜索已生效",
            subtitle: "设置页会保留表单可编辑性，同时帮助你定位相关配置分区。",
            child: _FactGrid(
              items: [
                ("关键词", query),
                (
                  "用户模型建议",
                  shell.recommendedUserModelOptimizationCount.toString(),
                ),
                ("角色建议", shell.recommendedRoleOptimizationCount.toString()),
                ("情报领域命中", visibleIntelDomainRows.length.toString()),
                ("待处理演化候选", shell.evolutionCandidates.length.toString()),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        _SectionCard(
          title: "运行时用户模型",
          subtitle: "长期操作偏好保留在 Runtime Core 中，并通过经过审查的提案来更新。",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("显示名称", asString(userModel["displayName"], "未设置")),
                  ("沟通风格", asString(userModel["communicationStyle"], "未设置")),
                  ("打断阈值", asString(userModel["interruptionThreshold"], "未设置")),
                  ("汇报详细度", asString(userModel["reportVerbosity"], "未设置")),
                  ("确认边界", asString(userModel["confirmationBoundary"], "未设置")),
                  (
                    "汇报策略",
                    _localizedOptionLabel(
                      asString(userModel["reportPolicy"], "未设置"),
                    ),
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
                        labelText: "显示名称",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 420,
                    child: TextFormField(
                      controller: _communicationStyleController,
                      enabled: !shell.isRefreshing,
                      decoration: const InputDecoration(
                        labelText: "沟通风格",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                        labelText: "打断阈值",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["low", "medium", "high"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "汇报详细度",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["brief", "balanced", "detailed"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "确认边界",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["strict", "balanced", "light"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "汇报策略",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
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
                              child: Text(_localizedOptionLabel(entry)),
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
                      child: const Text("采纳首个建议"),
                    ),
                    OutlinedButton(
                      onPressed:
                          shell.isRefreshing ||
                                  primaryUserModelCandidateId.isEmpty
                              ? null
                              : () => controller.rejectUserModelOptimization(
                                primaryUserModelCandidateId,
                              ),
                      child: const Text("拒绝建议"),
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
                    child: const Text("应用用户模型"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_syncFromShell),
                    child: const Text("重置草稿"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "USER.md mirror",
          subtitle: "可人工编辑的镜像始终从属于运行时真相，并把导入压力显式展示在这里，而不是静默覆盖核心模型。",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("镜像路径", asString(userModelMirror["path"], "不可用")),
                  (
                    "待导入",
                    _localizedOptionLabel(
                      asString(userModelMirror["pendingImport"], "false"),
                    ),
                  ),
                  (
                    "需要同步",
                    _localizedOptionLabel(
                      asString(userModelMirror["syncNeeded"], "false"),
                    ),
                  ),
                  (
                    "最后修改时间",
                    _formatTimestamp(asInt(userModelMirror["lastModifiedAt"])),
                  ),
                  (
                    "推荐用户模型变更",
                    shell.recommendedUserModelOptimizationCount.toString(),
                  ),
                  ("推荐角色变更", shell.recommendedRoleOptimizationCount.toString()),
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
                    child: const Text("导入待处理镜像"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing || (!pendingImport && !syncNeeded)
                            ? null
                            : () => controller.discardPendingUserModelMirror(),
                    child: const Text("丢弃并重新同步"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "实例根目录",
          subtitle: "所有存储都保持实例根目录隔离，桌面初始化应默认把这些细节隐藏在操作员身后。",
          child: _FactGrid(
            items: [
              ("实例根目录", asString(shell.instanceSection["instanceRoot"])),
              ("工作区根目录", asString(shell.instanceSection["workspaceRoot"])),
              ("日志根目录", asString(shell.instanceSection["logRoot"])),
              ("网关地址", asString(gateway["url"])),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "任务循环默认值",
          subtitle: "即便桌面应用承接了外层壳体，运行时控制也依然保持本地化。",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  (
                    "默认预算",
                    _localizedOptionLabel(
                      asString(taskDefaults["defaultBudgetMode"]),
                    ),
                  ),
                  (
                    "默认检索",
                    _localizedOptionLabel(
                      asString(taskDefaults["defaultRetrievalMode"]),
                    ),
                  ),
                  (
                    "最大输入 Token 数",
                    asString(taskDefaults["maxInputTokensPerTurn"]),
                  ),
                  ("最大上下文字符数", asString(taskDefaults["maxContextChars"])),
                  ("压缩水位线", asString(taskDefaults["compactionWatermark"])),
                  ("最大远程调用次数", asString(taskDefaults["maxRemoteCallsPerTask"])),
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
                        labelText: "预算模式",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["strict", "balanced", "deep"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                        labelText: "检索模式",
                        filled: true,
                        fillColor: DesktopTokens.surfaceMuted,
                      ),
                      items: const ["off", "light", "deep"]
                          .map(
                            (entry) => DropdownMenuItem<String>(
                              value: entry,
                              child: Text(_localizedOptionLabel(entry)),
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
                    label: "最大输入 Token 数",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _maxContextCharsController,
                    label: "最大上下文字符数",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _compactionWatermarkController,
                    label: "压缩水位线",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _maxRemoteCallsController,
                    label: "最大远程调用次数",
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
                    child: const Text("应用任务默认值"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => setState(_syncFromShell),
                    child: const Text("重置草稿"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "演化控制",
          subtitle: "本地复审默认保持主权，候选项晋升与金丝雀姿态继续由操作员治理。",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("已启用", asString(evolution["enabled"])),
                  ("自动应用低风险", asString(evolution["autoApplyLowRisk"])),
                  ("自动金丝雀演化", asString(evolution["autoCanaryEvolution"])),
                  ("审查间隔（小时）", asString(evolution["reviewIntervalHours"])),
                  ("待处理候选项", shell.evolutionCandidates.length.toString()),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _SettingsToggleTile(
                    label: "启用演化",
                    subtitle: "让本地复审与蒸馏循环持续保持活跃。",
                    value: _evolutionEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _evolutionEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "自动应用低风险",
                    subtitle: "只有低风险路径才能在不追加复审的前提下前进。",
                    value: _autoApplyLowRisk,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _autoApplyLowRisk = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "自动金丝雀演化",
                    subtitle: "允许无人值守路径走影子后再金丝雀晋升。",
                    value: _autoCanaryEvolution,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _autoCanaryEvolution = value;
                        }),
                  ),
                  _SettingsNumberField(
                    controller: _reviewIntervalHoursController,
                    label: "审查间隔（小时）",
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
                    child: const Text("应用演化控制"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.runEvolutionReview(),
                    child: const Text("立即执行复审"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "情报控制",
          subtitle: "新闻/信息仍然是侧车模块，你可以调整节奏与投递方式，而不必把它变成运行时真相。",
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FactGrid(
                items: [
                  ("已启用", asString(intel["enabled"])),
                  ("已启用摘要", asString(intel["digestEnabled"])),
                  ("刷新间隔（分钟）", asString(intel["refreshMinutes"])),
                  (
                    "每日推送",
                    "${asString(intel["dailyPushEnabled"])} @ ${asString(intel["dailyPushHourLocal"]).padLeft(2, "0")}:${asString(intel["dailyPushMinuteLocal"]).padLeft(2, "0")}",
                  ),
                  (
                    "即时推送",
                    "${asString(intel["instantPushEnabled"])} @ score ${asString(intel["instantPushMinScore"])}",
                  ),
                  (
                    "待发送项",
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
                    label: "启用情报",
                    subtitle: "允许侧车模块抓取并排序操作员情报。",
                    value: _intelEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _intelEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "启用摘要",
                    subtitle: "允许生成摘要并执行定时投递。",
                    value: _intelDigestEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _intelDigestEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "每日推送",
                    subtitle: "按计划发送本地摘要投递。",
                    value: _dailyPushEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _dailyPushEnabled = value;
                        }),
                  ),
                  _SettingsToggleTile(
                    label: "即时推送",
                    subtitle: "立即发送高分紧急简报。",
                    value: _instantPushEnabled,
                    enabled: !shell.isRefreshing,
                    onChanged:
                        (value) => setState(() {
                          _instantPushEnabled = value;
                        }),
                  ),
                  _SettingsNumberField(
                    controller: _refreshMinutesController,
                    label: "刷新间隔（分钟）",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushItemCountController,
                    label: "每日推送条数",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushHourController,
                    label: "每日推送小时",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _dailyPushMinuteController,
                    label: "每日推送分钟",
                    enabled: !shell.isRefreshing,
                  ),
                  _SettingsNumberField(
                    controller: _instantPushMinScoreController,
                    label: "即时推送最低分",
                    enabled: !shell.isRefreshing,
                  ),
                ],
              ),
              if (intelDomainRows.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text("已启用情报领域", style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (visibleIntelDomainRows.isEmpty && query.isNotEmpty)
                  Text(
                    "没有匹配当前搜索词的情报领域。",
                    style: Theme.of(context).textTheme.bodyMedium,
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: visibleIntelDomainRows
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
                                        if (_enabledIntelDomainIds.length ==
                                                1 &&
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
                    child: const Text("应用情报控制"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.refreshIntel(),
                    child: const Text("立即刷新情报"),
                  ),
                  OutlinedButton(
                    onPressed:
                        shell.isRefreshing
                            ? null
                            : () => controller.dispatchIntelDeliveries(),
                    child: const Text("派发投递"),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: "能力姿态",
          subtitle: "桌面壳会从运行时自有设置中读取治理姿态。",
          child: _FactGrid(
            items: [
              ("预设", _localizedOptionLabel(asString(capabilities["preset"]))),
              (
                "沙箱模式",
                _localizedOptionLabel(asString(capabilities["sandboxMode"])),
              ),
              (
                "已启用浏览器",
                _localizedOptionLabel(asString(capabilities["browserEnabled"])),
              ),
              ("工作区根目录", asString(capabilities["workspaceRoot"])),
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
        decoration: InputDecoration(labelText: label),
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
      child: DesktopSurfaceCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        tone: value ? DesktopSurfaceTone.accent : DesktopSurfaceTone.muted,
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
              activeTrackColor: DesktopTokens.accentStrong,
            ),
          ],
        ),
      ),
    );
  }
}

// ignore: unused_element
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
            color: ready ? DesktopTokens.accent : DesktopTokens.warning,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
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
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(18),
      tone: DesktopSurfaceTone.base,
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
    return DesktopMetricChip(icon: icon, label: label, value: value);
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color:
              selected
                  ? DesktopTokens.accentSurface
                  : DesktopTokens.sidebar.withValues(alpha: 0),
          border: Border.all(
            color:
                selected
                    ? DesktopTokens.borderStrong
                    : DesktopTokens.sidebar.withValues(alpha: 0),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color:
                    selected
                        ? DesktopTokens.accent.withValues(alpha: 0.12)
                        : DesktopTokens.surfaceMuted,
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Icon(
                icon,
                size: 16,
                color:
                    selected
                        ? DesktopTokens.accent
                        : DesktopTokens.textSecondary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color:
                      selected
                          ? DesktopTokens.accent
                          : DesktopTokens.textPrimary,
                ),
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
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color:
              highlighted
                  ? DesktopTokens.accentSurface
                  : DesktopTokens.surfaceMuted,
          border: Border.all(
            color:
                highlighted ? DesktopTokens.borderStrong : DesktopTokens.border,
          ),
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
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color:
                    highlighted
                        ? DesktopTokens.textSecondary
                        : DesktopTokens.textMuted,
              ),
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
            color: DesktopTokens.accent,
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
        Text(
          trailing,
          style: Theme.of(
            context,
          ).textTheme.labelLarge?.copyWith(color: DesktopTokens.textMuted),
        ),
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
          .map((item) => DesktopFactTile(label: item.$1, value: item.$2))
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
    return DesktopStatusPill(
      label: _localizedStatusLabel(label),
      tone: _toneToSurfaceTone(tone),
    );
  }
}

String _localizedStatusLabel(String label) {
  switch (label) {
    case "active":
      return "启用";
    case "inactive":
      return "停用";
    case "invalidated":
      return "已失效";
    case "pinned":
      return "已置顶";
    case "selected":
      return "已选中";
    case "recent":
      return "近期";
    case "blocked":
      return "阻止";
    case "shadow":
      return "影子";
    case "candidate":
      return "候选";
    case "adopted":
      return "已采纳";
    case "core":
      return "核心";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "reverted":
      return "已回退";
    case "waiting_user":
      return "等待用户";
    case "waiting_external":
      return "等待外部";
    case "queued":
      return "已排队";
    case "planning":
      return "规划中";
    case "ready":
      return "就绪";
    case "running":
      return "运行中";
    case "allowed":
      return "允许";
    case "denied":
      return "拒绝";
    case "pending":
      return "待处理";
    case "applied":
      return "已应用";
    case "materialized":
      return "已生成";
    default:
      return label;
  }
}

bool _matchesSearch(String query, Iterable<Object?> fields) {
  final normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.isEmpty) {
    return true;
  }
  for (final field in fields) {
    final value =
        field is Iterable
            ? field.map((entry) => asString(entry)).join(" ")
            : asString(field);
    final normalizedValue = value.trim().toLowerCase();
    if (normalizedValue.isNotEmpty &&
        normalizedValue.contains(normalizedQuery)) {
      return true;
    }
  }
  return false;
}

String _localizedOptionLabel(String value) {
  switch (value) {
    case "true":
      return "是";
    case "false":
      return "否";
    case "user":
      return "用户";
    case "agent":
      return "智能体";
    case "general":
      return "通用路由";
    case "desktop-console":
      return "桌面控制台";
    case "coordinator_suggestion":
      return "协调建议";
    case "role_optimization":
      return "角色优化";
    case "coordinator-suggestion":
      return "协调建议";
    case "shared-strategy-package":
      return "共享策略包";
    case "team-knowledge-package":
      return "团队知识包";
    case "role-optimization-package":
      return "角色优化包";
    case "runtime-policy-overlay-package":
      return "运行时策略覆层包";
    case "invalid-package":
      return "无效包";
    case "package":
      return "包";
    case "main":
      return "主工作器";
    case "normal":
      return "常规";
    case "system1":
      return "系统 1";
    case "system2":
      return "系统 2";
    case "token":
      return "令牌";
    case "websocket-rpc":
      return "WebSocket RPC";
    case "knowledge":
      return "知识";
    case "execution":
      return "执行";
    case "avoidance":
      return "规避";
    case "efficiency":
      return "效率";
    case "completion":
      return "完成";
    case "resource":
      return "资源";
    case "communication":
      return "沟通";
    case "runtime":
      return "运行时";
    case "derived":
      return "派生";
    case "managed_high":
      return "高治理";
    case "managed_medium":
      return "中治理";
    case "managed_low":
      return "低治理";
    case "workspace-write":
      return "工作区可写";
    case "read-only":
      return "只读";
    case "danger-full-access":
      return "完全访问";
    case "ai":
      return "AI";
    case "technology":
      return "科技";
    case "business":
      return "商业";
    case "military":
      return "军事";
    case "research":
      return "研究";
    case "default":
      return "默认";
    case "installed":
      return "已安装";
    case "bundled":
      return "内置";
    case "missing":
      return "缺失";
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "brief":
      return "简洁";
    case "balanced":
      return "平衡";
    case "detailed":
      return "详细";
    case "strict":
      return "严格";
    case "light":
      return "轻量";
    case "deep":
      return "深入";
    case "off":
      return "关闭";
    case "silent":
      return "静默";
    case "reply":
      return "仅回复";
    case "proactive":
      return "主动";
    case "reply_and_proactive":
      return "回复并主动";
    case "runtime-user":
      return "运行时用户";
    case "surface-owner":
      return "表面所有者";
    case "recommend_only":
      return "仅建议";
    case "disabled":
      return "禁用";
    case "blocked":
      return "阻止";
    case "shadow":
      return "影子";
    case "candidate":
      return "候选";
    case "adopted":
      return "已采纳";
    case "core":
      return "核心";
    default:
      return value;
  }
}

DesktopSurfaceTone _toneToSurfaceTone(String tone) {
  switch (tone) {
    case "high":
    case "blocked":
    case "cancelled":
    case "reverted":
      return DesktopSurfaceTone.danger;
    case "medium":
    case "waiting_user":
    case "waiting_external":
    case "candidate":
      return DesktopSurfaceTone.warning;
    case "low":
    case "completed":
    case "adopted":
    case "core":
      return DesktopSurfaceTone.success;
    case "shadow":
      return DesktopSurfaceTone.base;
    default:
      return DesktopSurfaceTone.base;
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
  final fractionDigits =
      value >= 100
          ? 0
          : value >= 10
          ? 1
          : 2;
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
