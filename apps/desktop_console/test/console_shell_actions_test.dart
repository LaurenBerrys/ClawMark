import 'dart:async';
import 'package:desktop_console/src/console_shell.dart';
import 'package:desktop_console/src/desktop_host.dart';
import 'package:desktop_console/src/gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  test(
    'controller dispatches operator action RPCs to the local gateway',
    () async {
      final client = _FakeGatewayDesktopClient(
        actionQueue: const [
          {
            "id": "mirror-import",
            "kind": "user_model_mirror_import",
            "priority": "medium",
            "title": "Import pending USER.md edits",
            "summary": "Mirror edits are pending.",
            "updatedAt": 1700000000001,
            "mirrorPath": "/tmp/USER.md",
          },
        ],
      );
      final bridge = _FakeDesktopBridge();
      final container = ProviderContainer(
        overrides: [
          gatewayClientProvider.overrideWithValue(client),
          desktopBridgeProvider.overrideWithValue(bridge),
        ],
      );
      addTearDown(container.dispose);

      await container.read(shellControllerProvider.future);
      final controller = container.read(shellControllerProvider.notifier);

      await controller.importUserModelMirror();
      await controller.discardPendingUserModelMirror();
      await controller.adoptUserModelOptimization(
        "user-model-opt-report-verbosity",
      );
      await controller.rejectUserModelOptimization(
        "user-model-opt-report-verbosity",
      );
      await controller.adoptRoleOptimization("role-opt-service-surface");
      await controller.rejectRoleOptimization("role-opt-service-surface");
      await controller.updateUserModel(
        displayName: "Operator Prime",
        communicationStyle: "calm and concise",
        interruptionThreshold: "medium",
        reportVerbosity: "balanced",
        confirmationBoundary: "balanced",
        reportPolicy: "reply_and_proactive",
      );
      await controller.syncCapabilities();
      await controller.setCapabilityEntryState(
        entryId: "gov-skill-browser",
        registryType: "skill",
        targetId: "browser",
        stateValue: "adopted",
      );
      await controller.setMcpGrantState(
        grantId: "grant-research-github",
        agentId: "research",
        mcpServerId: "github",
        stateValue: "allowed",
      );
      await controller.upsertAgent(
        agentId: "research",
        name: "Research",
        description: "Monitors research-facing surfaces.",
        roleBase: "research analyst",
        memoryNamespace: "agent/research",
        skillIds: const ["browser", "github"],
        active: true,
        communicationStyle: "precise and calm",
        reportPolicy: "reply_and_proactive",
        notes: "Keep research escalations tightly scoped.",
      );
      await controller.deleteAgent("research");
      await controller.upsertSurface(
        surfaceId: "surface-research",
        channel: "slack",
        accountId: "workspace:research",
        label: "Research ops",
        ownerKind: "agent",
        ownerId: "research",
        active: true,
      );
      await controller.upsertSurfaceRole(
        surfaceId: "surface-research",
        role: "research concierge",
        businessGoal: "Keep the research surface triaged.",
        tone: "precise and calm",
        initiative: "medium",
        allowedTopics: const ["research", "analysis"],
        restrictedTopics: const ["secrets"],
        reportTarget: "surface-owner",
        taskCreation: "recommend_only",
        escalationTarget: "surface-owner",
        roleScope: "research triage",
      );
      await controller.adoptFederationPackage("pkg-coordinator-1");
      await controller.rejectFederationPackage("pkg-coordinator-1");
      await controller.revertFederationPackage("pkg-coordinator-1");
      await controller.materializeCoordinatorSuggestion("coord-suggestion-1");
      await controller.materializeFederationAssignment("assignment-1");
      await controller.blockFederationAssignment("assignment-1");
      await controller.resetFederationAssignment("assignment-1");
      await controller.markFederationAssignmentApplied("assignment-1");
      await controller.configureTaskDefaults(
        defaultBudgetMode: "deep",
        defaultRetrievalMode: "deep",
        maxInputTokensPerTurn: 4096,
        maxContextChars: 12000,
        compactionWatermark: 5000,
        maxRemoteCallsPerTask: 6,
      );
      await controller.configureEvolutionControls(
        enabled: true,
        autoApplyLowRisk: false,
        autoCanaryEvolution: false,
        reviewIntervalHours: 12,
      );
      await controller.runEvolutionReview();
      await controller.configureIntelControls(
        enabled: true,
        digestEnabled: true,
        refreshMinutes: 60,
        enabledDomainIds: const ["ai", "technology"],
        dailyPushEnabled: true,
        dailyPushItemCount: 6,
        dailyPushHourLocal: 9,
        dailyPushMinuteLocal: 30,
        instantPushEnabled: true,
        instantPushMinScore: 90,
      );
      await controller.refreshIntel();
      await controller.dispatchIntelDeliveries();
      await controller.reinforceMemory("memory-1", sourceTaskId: "task-seed-1");
      await controller.invalidateMemory("memory-1");
      await controller.rollbackMemoryInvalidation(
        "runtime-memory-invalidate-1",
      );
      await controller.reviewMemoryLifecycle();
      await controller.pinIntelToKnowledge("intel-ai-1");
      await controller.initializeInstance();
      await controller.openLogs();
      await controller.restartRuntime();

      final actionMethods = client.calls
          .map((call) => call.method)
          .where(
            (method) =>
                method != "desktop.getShellSnapshot" &&
                method != "runtime.getTask" &&
                method != "runtime.user.console.detail" &&
                method != "runtime.getHealth",
          )
          .toList(growable: false);

      expect(actionMethods, <String>[
        "runtime.user.mirror.import",
        "runtime.user.mirror.sync",
        "runtime.user.model.optimization.adopt",
        "runtime.user.model.optimization.reject",
        "runtime.role.optimization.adopt",
        "runtime.role.optimization.reject",
        "runtime.user.update",
        "runtime.capabilities.sync",
        "runtime.capabilities.entry.set",
        "runtime.capabilities.mcp.grant.set",
        "runtime.agent.upsert",
        "runtime.agent.delete",
        "runtime.surface.upsert",
        "runtime.surface.role.upsert",
        "federation.package.transition",
        "federation.package.transition",
        "federation.package.transition",
        "federation.coordinator-suggestion.materialize",
        "federation.assignment.materialize",
        "federation.assignment.transition",
        "federation.assignment.transition",
        "federation.assignment.transition",
        "runtime.tasks.configure",
        "runtime.evolution.configure",
        "runtime.evolution.run",
        "runtime.intel.configure",
        "runtime.intel.refresh",
        "runtime.intel.delivery.dispatch",
        "runtime.memory.reinforce",
        "runtime.memory.invalidate",
        "runtime.memory.rollback",
        "runtime.memory.review",
        "runtime.intel.pin",
        "desktop.initializeInstance",
      ]);
      expect(bridge.calls, <String>["openLogs", "restartRuntime"]);
    },
  );
}

class _FakeDesktopBridge extends DesktopBridge {
  final List<String> calls = <String>[];

  @override
  Future<Map<String, dynamic>> getBootstrapStatus() async {
    return const {
      "state": "ready",
      "core": {"installed": true, "bundledAvailable": false, "version": "3.41.5"},
      "directories": {
        "downloadsRoot": "/tmp/clawmark/downloads",
        "descriptorPath": "/tmp/clawmark/runtime-descriptor.json",
        "logRoot": "/tmp/clawmark/logs",
        "instanceRoot": "/tmp/clawmark",
      },
      "connection": {
        "wsUrl": "ws://127.0.0.1:54300",
        "authToken": "token-1",
        "coreVersion": "3.41.5",
      },
      "warnings": <String>[],
    };
  }

  @override
  Future<Map<String, dynamic>> installCoreArchive(String archivePath) async {
    calls.add("installCoreArchive");
    return await getBootstrapStatus();
  }

  @override
  Future<Map<String, dynamic>> openLogs() async {
    calls.add("openLogs");
    return const {
      "generatedAt": 1700000001001,
      "logRoot": "/tmp/clawmark/logs",
      "opened": true,
    };
  }

  @override
  Future<Map<String, dynamic>> restartRuntime() async {
    calls.add("restartRuntime");
    return await getBootstrapStatus();
  }
}

class _FakeGatewayDesktopClient extends GatewayDesktopClient {
  _FakeGatewayDesktopClient({required List<Map<String, dynamic>> actionQueue})
    : _dashboard = _buildDashboard(actionQueue);

  final StreamController<GatewayEventFrame> _eventsController =
      StreamController<GatewayEventFrame>.broadcast();
  final List<_GatewayCall> calls = <_GatewayCall>[];
  final Map<String, dynamic> _bootstrap = const {
    "product": {"layout": "left_navigation_center_interaction_right_workboard"},
    "runtime": {"runtimeVersion": "3.41.5", "wsUrl": "ws://127.0.0.1:18789"},
    "gateway": {"url": "ws://127.0.0.1:18789"},
    "instanceManifest": {
      "instanceRoot": "/tmp/clawmark",
      "workspaceRoot": "/tmp/clawmark/workspace",
      "logRoot": "/tmp/clawmark/logs",
    },
    "warnings": <String>[],
  };
  final Map<String, dynamic> _settings = const {
    "taskDefaults": {
      "defaultBudgetMode": "balanced",
      "defaultRetrievalMode": "light",
      "maxInputTokensPerTurn": 2048,
      "maxContextChars": 8000,
      "compactionWatermark": 4000,
      "maxRemoteCallsPerTask": 4,
    },
    "evolution": {
      "enabled": true,
      "autoApplyLowRisk": false,
      "autoCanaryEvolution": false,
      "reviewIntervalHours": 24,
    },
    "intel": {
      "enabled": true,
      "digestEnabled": true,
      "refreshMinutes": 180,
      "dailyPushEnabled": false,
      "dailyPushItemCount": 6,
      "dailyPushHourLocal": 9,
      "dailyPushMinuteLocal": 0,
      "instantPushEnabled": false,
      "instantPushMinScore": 90,
    },
    "capabilities": {
      "preset": "managed_high",
      "browserEnabled": false,
      "sandboxMode": "danger-full-access",
      "workspaceRoot": "/tmp/clawmark/workspace",
    },
    "gateway": {"url": "ws://127.0.0.1:18789"},
    "instanceManifest": {
      "instanceRoot": "/tmp/clawmark",
      "workspaceRoot": "/tmp/clawmark/workspace",
      "logRoot": "/tmp/clawmark/logs",
    },
  };
  final Map<String, dynamic> _seedTask = const {
    "id": "task-seed-1",
    "title": "Seed task",
    "status": "running",
    "route": "desktop-console",
    "priority": "normal",
    "updatedAt": 1700000000000,
    "worker": "main",
    "nextAction": "Observe runtime status",
    "goal": "Keep the workboard hydrated for desktop tests.",
  };

  final Map<String, dynamic> _dashboard;

  @override
  Stream<GatewayEventFrame> get events => _eventsController.stream;

  @override
  Future<void> connect() async {}

  @override
  Future<dynamic> request(String method, [Object? params]) async {
    calls.add(_GatewayCall(method: method, params: params));
    switch (method) {
      case "desktop.getShellSnapshot":
        return {
          "bootstrap": _bootstrap,
          "dashboard": _dashboard,
          "settings": _settings,
        };
      case "desktop.getBootstrapState":
        return _bootstrap;
      case "desktop.initializeInstance":
        return const {
          "generatedAt": 1700000001000,
          "createdPaths": ["/tmp/clawmark/runtime", "/tmp/clawmark/logs"],
          "createdConfig": false,
        };
      case "desktop.openLogs":
        return const {
          "generatedAt": 1700000001001,
          "logRoot": "/tmp/clawmark/logs",
          "opened": true,
        };
      case "runtime.getDashboard":
        return _dashboard;
      case "runtime.getSettings":
        return _settings;
      case "runtime.getHealth":
        return const {
          "generatedAt": 1700000001002,
          "process": {
            "pid": 43210,
            "uptimeMs": 42000,
            "rssBytes": 157286400,
            "heapUsedBytes": 33554432,
          },
          "runtimeVersion": "3.41.5",
          "tasks": {
            "total": 1,
            "runnable": 1,
            "active": 1,
            "waitingUser": 0,
          },
          "memory": {
            "total": 1,
            "strategies": 1,
            "invalidated": 0,
          },
          "federation": {
            "enabled": false,
            "remoteConfigured": false,
            "pendingOutboxEventCount": 0,
            "pendingAssignments": 0,
          },
          "warnings": <String>[],
        };
      case "runtime.getTask":
        return {
          "task": _seedTask,
          "runs": const <Map<String, dynamic>>[],
          "reviews": const <Map<String, dynamic>>[],
          "reports": const <Map<String, dynamic>>[],
          "activeSteps": const <Map<String, dynamic>>[],
          "archivedSteps": const <Map<String, dynamic>>[],
        };
      case "runtime.user.console.detail":
        return const {
          "agents": _agentRecords,
          "agentOverlays": _agentOverlays,
          "surfaces": _surfaceRecords,
          "surfaceRoleOverlays": _surfaceRoleOverlays,
        };
      case "desktop.restartRuntime":
        return const {
          "mode": "spawned",
          "accepted": true,
        };
      case "federation.coordinator-suggestion.materialize":
        return {
          "created": true,
          "task": {
            ..._seedTask,
            "id": "task-materialized-1",
            "title": "Materialized coordinator suggestion",
          },
        };
      case "federation.assignment.materialize":
        return {
          "created": true,
          "task": {
            ..._seedTask,
            "id": "task-assignment-1",
            "title": "Materialized federation assignment",
          },
        };
      default:
        return const <String, dynamic>{};
    }
  }

  @override
  Future<Map<String, dynamic>> requestMap(
    String method, [
    Object? params,
  ]) async {
    return _toMap(await request(method, params));
  }

  @override
  void dispose() {
    unawaited(_eventsController.close());
  }
}

class _GatewayCall {
  const _GatewayCall({required this.method, required this.params});

  final String method;
  final Object? params;
}

const List<Map<String, dynamic>> _agentRecords = [
  {
    "id": "research",
    "name": "Research",
    "description": "Monitors research-facing surfaces.",
    "roleBase": "research analyst",
    "memoryNamespace": "agent/research",
    "skillIds": ["browser", "github"],
    "active": true,
    "updatedAt": 1700000000000,
  },
];

const List<Map<String, dynamic>> _agentOverlays = [
  {
    "id": "agent-overlay-research",
    "agentId": "research",
    "communicationStyle": "precise and calm",
    "reportPolicy": "reply_and_proactive",
    "notes": "Keep research escalations tightly scoped.",
    "updatedAt": 1700000000000,
  },
];

const List<Map<String, dynamic>> _surfaceRecords = [
  {
    "id": "surface-research",
    "channel": "slack",
    "accountId": "workspace:research",
    "label": "Research ops",
    "ownerKind": "agent",
    "ownerId": "research",
    "active": true,
    "updatedAt": 1700000000000,
  },
];

const List<Map<String, dynamic>> _surfaceRoleOverlays = [
  {
    "id": "surface-role-surface-research",
    "surfaceId": "surface-research",
    "role": "research concierge",
    "businessGoal": "Keep the research surface triaged.",
    "tone": "precise and calm",
    "initiative": "medium",
    "allowedTopics": ["research", "analysis"],
    "restrictedTopics": ["secrets"],
    "reportTarget": "surface-owner",
    "localBusinessPolicy": {
      "taskCreation": "recommend_only",
      "escalationTarget": "surface-owner",
      "roleScope": "research triage",
    },
    "updatedAt": 1700000000000,
  },
];

Map<String, dynamic> _buildDashboard(List<Map<String, dynamic>> actionQueue) {
  return {
    "runtimeVersion": "3.41.5",
    "tasks": {
      "total": 1,
      "reviewCount": 0,
      "tasks": [
        {
          "id": "task-seed-1",
          "title": "Seed task",
          "status": "running",
          "route": "desktop-console",
          "priority": "normal",
          "updatedAt": 1700000000000,
          "worker": "main",
          "nextAction": "Observe runtime status",
        },
      ],
    },
    "userConsole": {
      "pendingActionCount": actionQueue.length,
      "waitingUserTaskCount": 0,
      "recommendedUserModelOptimizationCount": 1,
      "recommendedRoleOptimizationCount": 1,
      "model": {
        "displayName": "Operator",
        "communicationStyle": "calm and direct",
        "interruptionThreshold": "medium",
        "reportVerbosity": "balanced",
        "confirmationBoundary": "balanced",
        "reportPolicy": "reply_and_proactive",
      },
      "mirror": {
        "path": "/tmp/USER.md",
        "pendingImport": true,
        "syncNeeded": true,
        "lastModifiedAt": 1700000000000,
      },
      "actionQueue": actionQueue,
    },
    "memory": {
      "total": 1,
      "strategyCount": 1,
      "memories": const [
        {
          "id": "memory-1",
          "summary": "User prefers direct updates.",
          "detail": "The operator usually prefers direct status updates.",
          "memoryType": "communication",
          "route": "general",
          "scope": "runtime",
          "confidence": 0.8,
          "decayScore": 0.1,
          "updatedAt": 1700000000000,
          "invalidatedBy": <String>[],
        },
      ],
      "strategies": const [
        {
          "id": "strategy-1",
          "summary": "Prefer concise control-loop narration.",
          "route": "general",
          "worker": "main",
          "updatedAt": 1700000000000,
        },
      ],
    },
    "agents": const [
      {
        "id": "research",
        "name": "Research",
        "roleBase": "research analyst",
        "active": true,
        "skillCount": 2,
        "surfaceCount": 1,
        "openTaskCount": 1,
        "waitingUserTaskCount": 0,
        "recentReportCount": 1,
        "recentCompletionReportCount": 0,
        "followUpPressureCount": 0,
        "blockedReportCount": 0,
        "waitingExternalReportCount": 0,
        "recentIntelDeliveryCount": 1,
        "pendingRoleOptimizationCount": 0,
        "pendingCoordinatorSuggestionCount": 0,
        "materializedCoordinatorSuggestionCount": 0,
        "reportPolicy": "reply_and_proactive",
        "latestActivityAt": 1700000000000,
        "recentActivity": <Map<String, dynamic>>[],
        "updatedAt": 1700000000000,
      },
    ],
    "surfaces": const [
      {
        "id": "surface-research",
        "label": "Research ops",
        "channel": "slack",
        "accountId": "workspace:research",
        "ownerKind": "agent",
        "ownerId": "research",
        "ownerLabel": "Research",
        "active": true,
        "role": "research concierge",
        "businessGoal": "Keep the research surface triaged.",
        "tone": "precise and calm",
        "initiative": "medium",
        "reportTarget": "surface-owner",
        "allowedTopics": ["research", "analysis"],
        "restrictedTopics": ["secrets"],
        "localBusinessPolicy": {
          "taskCreation": "recommend_only",
          "escalationTarget": "surface-owner",
          "roleScope": "research triage",
        },
        "localBusinessPolicySource": "overlay",
        "overlayPresent": true,
        "roleSource": "overlay",
        "toneSource": "overlay",
        "openTaskCount": 1,
        "waitingUserTaskCount": 0,
        "recentReportCount": 1,
        "recentCompletionReportCount": 0,
        "followUpPressureCount": 0,
        "blockedReportCount": 0,
        "waitingExternalReportCount": 0,
        "recentIntelDeliveryCount": 1,
        "pendingRoleOptimizationCount": 0,
        "pendingCoordinatorSuggestionCount": 0,
        "materializedCoordinatorSuggestionCount": 0,
        "latestActivityAt": 1700000000000,
        "recentActivity": <Map<String, dynamic>>[],
        "updatedAt": 1700000000000,
      },
    ],
    "capabilities": {
      "entries": const [
        {
          "id": "gov-skill-browser",
          "registryType": "skill",
          "targetId": "browser",
          "state": "shadow",
          "summary": "Browser skill is shadowed by default.",
          "executionSummary": "Shadow only.",
          "executionPreferenceLabel": "shadow",
          "updatedAt": 1700000000000,
        },
      ],
      "mcpGrants": const [
        {
          "id": "grant-research-github",
          "agentId": "research",
          "agentLabel": "Research",
          "mcpServerId": "github",
          "state": "denied",
          "summary": "GitHub MCP is denied for research by default.",
          "updatedAt": 1700000000000,
        },
      ],
      "recentActivity": const [
        {
          "id": "activity-1",
          "title": "Capability registry synced",
          "summary": "Authoritative runtime registry is up to date.",
          "updatedAt": 1700000000000,
          "kind": "registry_sync",
        },
      ],
    },
    "intel": {
      "enabled": true,
      "digestEnabled": true,
      "refreshMinutes": 180,
      "dailyPushEnabled": false,
      "dailyPushItemCount": 6,
      "dailyPushHourLocal": 9,
      "dailyPushMinuteLocal": 0,
      "instantPushEnabled": false,
      "instantPushMinScore": 90,
      "enabledDomainIds": const ["ai", "technology"],
      "pendingDailyDigestCount": 0,
      "pendingInstantAlertCount": 0,
      "recentItems": const [
        {
          "id": "intel-ai-1",
          "kind": "candidate",
          "domain": "ai",
          "title": "Recent AI update",
          "summary": "A new AI item is available for review.",
          "score": 91,
          "selected": true,
          "pinned": false,
        },
      ],
      "domains": const [
        {"id": "ai", "label": "AI", "enabled": true},
        {"id": "technology", "label": "Technology", "enabled": true},
      ],
    },
    "evolution": {"candidates": const <Map<String, dynamic>>[]},
    "federation": {
      "pendingOutboxEventCount": 0,
      "pendingAssignments": 0,
      "acknowledgedOutboxEventId": null,
      "inbox": {
        "latestPackages": const <Map<String, dynamic>>[],
        "latestCoordinatorSuggestions": const <Map<String, dynamic>>[],
      },
      "assignmentInbox": {"latestAssignments": const <Map<String, dynamic>>[]},
    },
  };
}

Map<String, dynamic> _toMap(Object? value) {
  if (value is! Map) {
    return const <String, dynamic>{};
  }
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
