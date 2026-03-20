import 'package:flutter/material.dart';

Map<String, dynamic> asMap(Object? value) {
  if (value is! Map) {
    return const <String, dynamic>{};
  }
  final output = <String, dynamic>{};
  for (final entry in value.entries) {
    output[entry.key.toString()] = entry.value;
  }
  return output;
}

List<Map<String, dynamic>> asMapList(Object? value) {
  if (value is! List) {
    return const <Map<String, dynamic>>[];
  }
  return value
      .map(asMap)
      .where((entry) => entry.isNotEmpty)
      .toList(growable: false);
}

List<String> asStringList(Object? value) {
  if (value is! List) {
    return const <String>[];
  }
  return value
      .map((entry) => asString(entry))
      .where((entry) => entry.isNotEmpty)
      .toList(growable: false);
}

String asString(Object? value, [String fallback = ""]) {
  if (value == null) {
    return fallback;
  }
  if (value is String) {
    return value;
  }
  return value.toString();
}

int asInt(Object? value, [int fallback = 0]) {
  if (value is int) {
    return value;
  }
  if (value is double) {
    return value.round();
  }
  if (value is String) {
    return int.tryParse(value) ?? fallback;
  }
  return fallback;
}

bool asBool(Object? value, [bool fallback = false]) {
  if (value is bool) {
    return value;
  }
  if (value is String) {
    if (value == "true") {
      return true;
    }
    if (value == "false") {
      return false;
    }
  }
  return fallback;
}

enum DesktopPage { home, tasks, memory, governance, federation, settings }

extension DesktopPagePresentation on DesktopPage {
  String get label => switch (this) {
    DesktopPage.home => "首页",
    DesktopPage.tasks => "任务",
    DesktopPage.memory => "记忆",
    DesktopPage.governance => "治理",
    DesktopPage.federation => "联邦",
    DesktopPage.settings => "设置",
  };

  String get headline => switch (this) {
    DesktopPage.home => "运行时工作台",
    DesktopPage.tasks => "任务控制",
    DesktopPage.memory => "记忆与策略",
    DesktopPage.governance => "治理队列",
    DesktopPage.federation => "联邦平面",
    DesktopPage.settings => "本地运行时设置",
  };

  String get description => switch (this) {
    DesktopPage.home =>
      "在同一个操作闭环里提交工作、观察执行状态，并处理审批。",
    DesktopPage.tasks =>
      "查看根任务、子运行、检查点和恢复状态。",
    DesktopPage.memory =>
      "浏览正式记忆、关联策略和保留状态。",
    DesktopPage.governance =>
      "在不丢失审计线索的前提下采纳、拒绝或回退受控运行时变更。",
    DesktopPage.federation =>
      "查看同步状态、收件包和外发日志状态。",
    DesktopPage.settings =>
      "检查实例根目录、网关连线、任务循环默认值和本地桌面姿态。",
  };

  IconData get icon => switch (this) {
    DesktopPage.home => Icons.dashboard_customize_outlined,
    DesktopPage.tasks => Icons.playlist_add_check_circle_outlined,
    DesktopPage.memory => Icons.auto_stories_outlined,
    DesktopPage.governance => Icons.gavel_outlined,
    DesktopPage.federation => Icons.hub_outlined,
    DesktopPage.settings => Icons.settings_outlined,
  };
}

class TaskSummary {
  const TaskSummary({
    required this.id,
    required this.title,
    required this.status,
    required this.route,
    required this.priority,
    required this.updatedAt,
    required this.worker,
    required this.nextAction,
  });

  factory TaskSummary.fromJson(Map<String, dynamic> json) {
    return TaskSummary(
      id: asString(json["id"]),
      title: asString(json["title"], "未命名任务"),
      status: asString(json["status"], "queued"),
      route: asString(json["route"], "general"),
      priority: asString(json["priority"], "normal"),
      updatedAt: asInt(json["updatedAt"]),
      worker: asString(json["worker"], "main"),
      nextAction: asString(json["nextAction"]),
    );
  }

  final String id;
  final String title;
  final String status;
  final String route;
  final String priority;
  final int updatedAt;
  final String worker;
  final String nextAction;

  bool get needsAttention =>
      status == "waiting_user" ||
      status == "blocked" ||
      status == "waiting_external";
}

class ActionQueueItem {
  const ActionQueueItem({
    required this.id,
    required this.kind,
    required this.priority,
    required this.title,
    required this.summary,
    required this.updatedAt,
    this.taskId,
    this.localTaskId,
    this.candidateId,
    this.packageId,
    this.packageType,
    this.packageState,
    this.coordinatorSuggestionId,
    this.sourceTaskId,
    this.localTaskStatus,
    this.lastLocalTaskId,
    this.rematerializeReason,
    this.surfaceLabel,
    this.taskCreationPolicy,
    this.escalationTarget,
    this.actionBlockedReason,
    this.mirrorPath,
    this.estimatedImpact,
    this.requiresReasonOnAdopt = false,
  });

  factory ActionQueueItem.fromJson(Map<String, dynamic> json) {
    return ActionQueueItem(
      id: asString(json["id"]),
      kind: asString(json["kind"]),
      priority: asString(json["priority"], "medium"),
      title: asString(json["title"], "待处理动作"),
      summary: asString(json["summary"]),
      updatedAt: asInt(json["updatedAt"]),
      taskId: _nullableString(json["taskId"]),
      localTaskId: _nullableString(json["localTaskId"]),
      candidateId: _nullableString(json["candidateId"]),
      packageId: _nullableString(json["packageId"]),
      packageType: _nullableString(json["packageType"]),
      packageState: _nullableString(json["packageState"]),
      coordinatorSuggestionId: _nullableString(json["coordinatorSuggestionId"]),
      sourceTaskId: _nullableString(json["sourceTaskId"]),
      localTaskStatus: _nullableString(json["localTaskStatus"]),
      lastLocalTaskId: _nullableString(json["lastLocalTaskId"]),
      rematerializeReason: _nullableString(json["rematerializeReason"]),
      surfaceLabel: _nullableString(json["surfaceLabel"]),
      taskCreationPolicy: _nullableString(json["taskCreationPolicy"]),
      escalationTarget: _nullableString(json["escalationTarget"]),
      actionBlockedReason: _nullableString(json["actionBlockedReason"]),
      mirrorPath: _nullableString(json["mirrorPath"]),
      estimatedImpact: _nullableString(json["estimatedImpact"]),
      requiresReasonOnAdopt: asBool(json["requiresReasonOnAdopt"]),
    );
  }

  final String id;
  final String kind;
  final String priority;
  final String title;
  final String summary;
  final int updatedAt;
  final String? taskId;
  final String? localTaskId;
  final String? candidateId;
  final String? packageId;
  final String? packageType;
  final String? packageState;
  final String? coordinatorSuggestionId;
  final String? sourceTaskId;
  final String? localTaskStatus;
  final String? lastLocalTaskId;
  final String? rematerializeReason;
  final String? surfaceLabel;
  final String? taskCreationPolicy;
  final String? escalationTarget;
  final String? actionBlockedReason;
  final String? mirrorPath;
  final String? estimatedImpact;
  final bool requiresReasonOnAdopt;

  bool get isWaitingUserTask => kind == "waiting_user_task";
  bool get isEvolutionReview =>
      kind == "evolution_candidate_review" ||
      kind == "evolution_revert_recommendation";
  bool get isUserModelOptimization => kind == "user_model_optimization";
  bool get isRoleOptimization => kind == "role_optimization";
  bool get isUserModelMirrorImport => kind == "user_model_mirror_import";
  bool get isFederationPackage => kind == "federation_package";
  bool get isCoordinatorSuggestion => kind == "coordinator_suggestion";
  bool get canMaterializeCoordinatorSuggestion =>
      isCoordinatorSuggestion &&
      (coordinatorSuggestionId ?? "").isNotEmpty &&
      (actionBlockedReason ?? "").isEmpty;
}

class DesktopShellState {
  const DesktopShellState({
    required this.page,
    required this.bootstrap,
    required this.dashboard,
    required this.settings,
    required this.selectedTask,
    required this.selectedTaskId,
    required this.selectedActionId,
    required this.isRefreshing,
    required this.lastStatusMessage,
  });

  factory DesktopShellState.fromPayloads({
    required DesktopPage page,
    required Map<String, dynamic> bootstrap,
    required Map<String, dynamic> dashboard,
    required Map<String, dynamic> settings,
    required Map<String, dynamic>? selectedTask,
    required String? selectedTaskId,
    required String? selectedActionId,
    required String? lastStatusMessage,
    bool isRefreshing = false,
  }) {
    return DesktopShellState(
      page: page,
      bootstrap: bootstrap,
      dashboard: dashboard,
      settings: settings,
      selectedTask: selectedTask,
      selectedTaskId: selectedTaskId,
      selectedActionId: selectedActionId,
      isRefreshing: isRefreshing,
      lastStatusMessage: lastStatusMessage,
    );
  }

  final DesktopPage page;
  final Map<String, dynamic> bootstrap;
  final Map<String, dynamic> dashboard;
  final Map<String, dynamic> settings;
  final Map<String, dynamic>? selectedTask;
  final String? selectedTaskId;
  final String? selectedActionId;
  final bool isRefreshing;
  final String? lastStatusMessage;

  DesktopShellState copyWith({
    DesktopPage? page,
    Map<String, dynamic>? bootstrap,
    Map<String, dynamic>? dashboard,
    Map<String, dynamic>? settings,
    Map<String, dynamic>? selectedTask,
    String? selectedTaskId,
    String? selectedActionId,
    bool? isRefreshing,
    String? lastStatusMessage,
  }) {
    return DesktopShellState(
      page: page ?? this.page,
      bootstrap: bootstrap ?? this.bootstrap,
      dashboard: dashboard ?? this.dashboard,
      settings: settings ?? this.settings,
      selectedTask: selectedTask ?? this.selectedTask,
      selectedTaskId: selectedTaskId ?? this.selectedTaskId,
      selectedActionId: selectedActionId ?? this.selectedActionId,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      lastStatusMessage: lastStatusMessage ?? this.lastStatusMessage,
    );
  }

  Map<String, dynamic> get runtimeSection => asMap(bootstrap["runtime"]);
  Map<String, dynamic> get runtimeHealth => asMap(dashboard["runtimeHealth"]);
  Map<String, dynamic> get productSection => asMap(bootstrap["product"]);
  Map<String, dynamic> get gatewaySection => asMap(bootstrap["gateway"]);
  Map<String, dynamic> get instanceSection =>
      asMap(bootstrap["instanceManifest"]);
  Map<String, dynamic> get taskSection => asMap(dashboard["tasks"]);
  Map<String, dynamic> get userConsoleSection =>
      asMap(dashboard["userConsole"]);
  Map<String, dynamic> get memorySection => asMap(dashboard["memory"]);
  Map<String, dynamic> get capabilitySection =>
      asMap(dashboard["capabilities"]);
  Map<String, dynamic> get intelSection => asMap(dashboard["intel"]);
  Map<String, dynamic> get evolutionSection => asMap(dashboard["evolution"]);
  Map<String, dynamic> get federationSection => asMap(dashboard["federation"]);
  Map<String, dynamic> get federationInboxSection =>
      asMap(federationSection["inbox"]);
  Map<String, dynamic> get federationAssignmentInboxSection =>
      asMap(federationSection["assignmentInbox"]);
  Map<String, dynamic> get userModel => asMap(userConsoleSection["model"]);
  Map<String, dynamic> get userModelMirror =>
      asMap(userConsoleSection["mirror"]);

  List<TaskSummary> get tasks => asMapList(
    taskSection["tasks"],
  ).map(TaskSummary.fromJson).toList(growable: false);

  List<ActionQueueItem> get actionQueue => asMapList(
    userConsoleSection["actionQueue"],
  ).map(ActionQueueItem.fromJson).toList(growable: false);

  List<Map<String, dynamic>> get memories =>
      asMapList(memorySection["memories"]);
  List<Map<String, dynamic>> get strategies =>
      asMapList(memorySection["strategies"]);
  List<Map<String, dynamic>> get agents => asMapList(dashboard["agents"]);
  List<Map<String, dynamic>> get surfaces => asMapList(dashboard["surfaces"]);
  List<Map<String, dynamic>> get agentRecords =>
      asMapList(dashboard["agentRecords"]);
  List<Map<String, dynamic>> get agentOverlays =>
      asMapList(dashboard["agentOverlays"]);
  List<Map<String, dynamic>> get surfaceRecords =>
      asMapList(dashboard["surfaceRecords"]);
  List<Map<String, dynamic>> get surfaceRoleOverlays =>
      asMapList(dashboard["surfaceRoleOverlays"]);
  List<Map<String, dynamic>> get governanceEntries =>
      asMapList(capabilitySection["entries"]);
  List<Map<String, dynamic>> get capabilityMcpGrants =>
      asMapList(capabilitySection["mcpGrants"]);
  List<Map<String, dynamic>> get capabilityRecentActivity =>
      asMapList(capabilitySection["recentActivity"]);
  List<Map<String, dynamic>> get evolutionCandidates =>
      asMapList(evolutionSection["candidates"]);
  List<Map<String, dynamic>> get intelRecentItems =>
      asMapList(intelSection["recentItems"]);
  List<Map<String, dynamic>> get federationPackages =>
      asMapList(federationInboxSection["latestPackages"]);
  List<Map<String, dynamic>> get federationCoordinatorSuggestions =>
      asMapList(federationInboxSection["latestCoordinatorSuggestions"]);
  List<Map<String, dynamic>> get federationAssignments =>
      asMapList(federationAssignmentInboxSection["latestAssignments"]);

  int get totalTaskCount => asInt(taskSection["total"]);
  int get pendingActionCount => asInt(userConsoleSection["pendingActionCount"]);
  int get waitingUserCount => asInt(userConsoleSection["waitingUserTaskCount"]);
  int get recommendedUserModelOptimizationCount =>
      asInt(userConsoleSection["recommendedUserModelOptimizationCount"]);
  int get recommendedRoleOptimizationCount =>
      asInt(userConsoleSection["recommendedRoleOptimizationCount"]);
  int get outboxPendingCount =>
      asInt(federationSection["pendingOutboxEventCount"]);
  int get reviewCount => asInt(taskSection["reviewCount"]);
  int get memoryCount => asInt(memorySection["total"]);
  int get strategyCount => asInt(memorySection["strategyCount"]);

  String get runtimeVersion => asString(
    runtimeSection["runtimeVersion"],
    asString(dashboard["runtimeVersion"], "unknown"),
  );
  String get runtimeWsUrl => asString(
    runtimeSection["wsUrl"],
    asString(gatewaySection["url"]),
  );
  String get instanceRoot => asString(instanceSection["instanceRoot"]);
  List<String> get warnings => asStringList(bootstrap["warnings"]);

  ActionQueueItem? get selectedAction {
    final actionId = selectedActionId;
    if (actionId == null || actionId.isEmpty) {
      return actionQueue.isEmpty ? null : actionQueue.first;
    }
    for (final entry in actionQueue) {
      if (entry.id == actionId) {
        return entry;
      }
    }
    return actionQueue.isEmpty ? null : actionQueue.first;
  }

  TaskSummary? get selectedTaskSummary {
    final taskId = selectedTaskId;
    if (taskId == null || taskId.isEmpty) {
      return null;
    }
    for (final task in tasks) {
      if (task.id == taskId) {
        return task;
      }
    }
    return null;
  }

  TaskSummary? get defaultTaskFocus {
    final current = selectedTaskSummary;
    if (current != null) {
      return current;
    }
    for (final task in tasks) {
      if (task.status != "completed" && task.status != "cancelled") {
        return task;
      }
    }
    return tasks.isEmpty ? null : tasks.first;
  }
}

String? _nullableString(Object? value) {
  final text = asString(value).trim();
  return text.isEmpty ? null : text;
}
