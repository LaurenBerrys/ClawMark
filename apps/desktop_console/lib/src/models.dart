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

enum DesktopPage {
  chat,
  overview,
  runtime,
  channels,
  instances,
  sessions,
  cronJobs,
  agents,
  skills,
  nodes,
  config,
  debug,
  logs,
  execApprovals,
  update,
}

extension DesktopPagePresentation on DesktopPage {
  String get label => switch (this) {
    DesktopPage.chat => "聊天",
    DesktopPage.overview => "概览",
    DesktopPage.runtime => "Runtime",
    DesktopPage.channels => "频道",
    DesktopPage.instances => "实例",
    DesktopPage.sessions => "会话",
    DesktopPage.cronJobs => "定时任务",
    DesktopPage.agents => "代理",
    DesktopPage.skills => "技能",
    DesktopPage.nodes => "节点",
    DesktopPage.config => "配置",
    DesktopPage.debug => "调试",
    DesktopPage.logs => "日志",
    DesktopPage.execApprovals => "审批",
    DesktopPage.update => "部署",
  };

  String get headline => switch (this) {
    DesktopPage.chat => "Chat",
    DesktopPage.overview => "Overview",
    DesktopPage.runtime => "Runtime",
    DesktopPage.channels => "Channels",
    DesktopPage.instances => "Instances",
    DesktopPage.sessions => "Sessions",
    DesktopPage.cronJobs => "Cron",
    DesktopPage.agents => "Agents",
    DesktopPage.skills => "Skills",
    DesktopPage.nodes => "Nodes",
    DesktopPage.config => "Config",
    DesktopPage.debug => "Debug",
    DesktopPage.logs => "Logs",
    DesktopPage.execApprovals => "Approvals",
    DesktopPage.update => "Deploy",
  };

  String get description => switch (this) {
    DesktopPage.chat => "聊天入口，保留 OpenClaw 的对话优先路径。",
    DesktopPage.overview => "状态、入口动作和最近待处理项。",
    DesktopPage.runtime => "记忆、策略、情报和本地运行面板。",
    DesktopPage.channels => "频道和已绑定表面的当前状态。",
    DesktopPage.instances => "实例、桌面宿主和连接状态。",
    DesktopPage.sessions => "活动会话、任务运行和最近执行上下文。",
    DesktopPage.cronJobs => "定时任务和自动运行入口。",
    DesktopPage.agents => "代理、表面和治理相关能力。",
    DesktopPage.skills => "技能姿态和相关扩展上下文。",
    DesktopPage.nodes => "节点、配对对象和受控能力。",
    DesktopPage.config => "当前配置、用户偏好和本地设置。",
    DesktopPage.debug => "调试快照、健康信号和诊断上下文。",
    DesktopPage.logs => "日志目录、告警和常用日志动作。",
    DesktopPage.execApprovals => "审批和待确认动作的内部落点页。",
    DesktopPage.update => "部署、版本和核心更新入口。",
  };

  IconData get icon => switch (this) {
    DesktopPage.chat => Icons.chat_bubble_outline_rounded,
    DesktopPage.overview => Icons.bar_chart_rounded,
    DesktopPage.runtime => Icons.psychology_alt_outlined,
    DesktopPage.channels => Icons.language_rounded,
    DesktopPage.instances => Icons.dns_outlined,
    DesktopPage.sessions => Icons.history_rounded,
    DesktopPage.cronJobs => Icons.schedule_rounded,
    DesktopPage.agents => Icons.group_outlined,
    DesktopPage.skills => Icons.extension_outlined,
    DesktopPage.nodes => Icons.hub_outlined,
    DesktopPage.config => Icons.settings_outlined,
    DesktopPage.debug => Icons.bug_report_outlined,
    DesktopPage.logs => Icons.receipt_long_outlined,
    DesktopPage.execApprovals => Icons.fact_check_outlined,
    DesktopPage.update => Icons.rocket_launch_outlined,
  };
}

class DesktopNavGroup {
  const DesktopNavGroup({required this.label, required this.pages});

  final String label;
  final List<DesktopPage> pages;
}

const primaryDesktopNavGroups = <DesktopNavGroup>[
  DesktopNavGroup(label: "Chat", pages: <DesktopPage>[DesktopPage.chat]),
  DesktopNavGroup(
    label: "Control",
    pages: <DesktopPage>[
      DesktopPage.overview,
      DesktopPage.runtime,
      DesktopPage.channels,
      DesktopPage.instances,
      DesktopPage.sessions,
      DesktopPage.cronJobs,
    ],
  ),
  DesktopNavGroup(
    label: "Agent",
    pages: <DesktopPage>[
      DesktopPage.agents,
      DesktopPage.skills,
      DesktopPage.nodes,
    ],
  ),
  DesktopNavGroup(
    label: "Settings",
    pages: <DesktopPage>[
      DesktopPage.config,
      DesktopPage.debug,
      DesktopPage.logs,
    ],
  ),
];

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
    asString(dashboard["runtimeVersion"], "未知版本"),
  );
  String get runtimeWsUrl =>
      asString(runtimeSection["wsUrl"], asString(gatewaySection["url"]));
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
