import 'dart:async';
import 'package:desktop_console/src/app.dart';
import 'package:desktop_console/src/console_shell.dart';
import 'package:desktop_console/src/desktop_host.dart';
import 'package:desktop_console/src/gateway.dart';
import 'package:desktop_console/src/models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'bootstrap workbench shows localized onboarding when core is missing',
    (WidgetTester tester) async {
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
      });
      await tester.binding.setSurfaceSize(const Size(1440, 900));

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            bootstrapControllerProvider.overrideWith(
              _MissingBootstrapController.new,
            ),
          ],
          child: const ClawMarkDesktopApp(),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('启动桌面核心'), findsOneWidget);
      expect(find.text('安装与切换信息'), findsOneWidget);
      expect(find.text('检查更新'), findsOneWidget);
      expect(find.text('打开日志'), findsOneWidget);
      expect(find.text('当前来源'), findsOneWidget);
    },
  );

  testWidgets('ready shell renders OpenClaw-style navigation and chat home', (
    WidgetTester tester,
  ) async {
    addTearDown(() async {
      await tester.binding.setSurfaceSize(null);
    });
    await tester.binding.setSurfaceSize(const Size(1440, 900));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          bootstrapControllerProvider.overrideWith(
            _ReadyBootstrapController.new,
          ),
          gatewayClientProvider.overrideWithValue(_ReadyGatewayDesktopClient()),
        ],
        child: const ClawMarkDesktopApp(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('聊天'), findsWidgets);
    expect(find.text('概览'), findsWidgets);
    expect(find.text('Runtime'), findsWidgets);
    expect(find.text('频道'), findsWidgets);
    expect(find.text('实例'), findsWidgets);
    expect(find.text('会话'), findsWidgets);
    expect(find.text('定时任务'), findsWidgets);
    expect(find.text('代理'), findsWidgets);
    expect(find.text('技能'), findsWidgets);
    expect(find.text('节点'), findsWidgets);
    expect(find.text('配置'), findsWidgets);
    expect(find.text('调试'), findsWidgets);
    expect(find.text('日志'), findsWidgets);
    expect(find.text('部署'), findsOneWidget);
    expect(find.text('对话输入'), findsOneWidget);
    expect(find.text('Seed task'), findsWidgets);
    expect(find.text('搜索任务、设置与运行时状态'), findsNothing);
  });

  testWidgets('chat shell no longer renders the old global dashboard search', (
    WidgetTester tester,
  ) async {
    addTearDown(() async {
      await tester.binding.setSurfaceSize(null);
    });
    await tester.binding.setSurfaceSize(const Size(1360, 900));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          bootstrapControllerProvider.overrideWith(
            _ReadyBootstrapController.new,
          ),
          gatewayClientProvider.overrideWithValue(_ReadyGatewayDesktopClient()),
        ],
        child: const ClawMarkDesktopApp(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('检索神经模块...'), findsOneWidget);
    expect(find.text('搜索任务、设置与运行时状态'), findsNothing);
    expect(find.text('联邦同步'), findsNothing);
    expect(find.text('任务执行'), findsNothing);
  });

  testWidgets('left navigation remains scrollable on shorter windows', (
    WidgetTester tester,
  ) async {
    addTearDown(() async {
      await tester.binding.setSurfaceSize(null);
    });
    await tester.binding.setSurfaceSize(const Size(1200, 700));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          bootstrapControllerProvider.overrideWith(
            _ReadyBootstrapController.new,
          ),
          gatewayClientProvider.overrideWithValue(_ReadyGatewayDesktopClient()),
        ],
        child: const ClawMarkDesktopApp(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Operator'), findsNothing);

    await tester.drag(
      find.byType(CustomScrollView).first,
      const Offset(0, -900),
    );
    await tester.pumpAndSettle();

    expect(find.text('Operator'), findsOneWidget);
  });

  testWidgets('navigation switches to update and logs pages', (
    WidgetTester tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        bootstrapControllerProvider.overrideWith(_ReadyBootstrapController.new),
        gatewayClientProvider.overrideWithValue(_ReadyGatewayDesktopClient()),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await tester.binding.setSurfaceSize(null);
    });
    await tester.binding.setSurfaceSize(const Size(1200, 900));

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const ClawMarkDesktopApp(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await tester.tap(find.text('部署'));
    await tester.pumpAndSettle();
    expect(find.text('当前版本'), findsWidgets);
    expect(find.text('检查更新'), findsWidgets);

    await container
        .read(shellControllerProvider.notifier)
        .setPage(DesktopPage.logs);
    await tester.pumpAndSettle();
    expect(find.text('日志状态'), findsWidgets);
    expect(find.text('打开日志'), findsWidgets);
  });
}

class _MissingBootstrapController extends DesktopBootstrapController {
  @override
  Future<DesktopBootstrapViewState> build() async {
    return DesktopBootstrapViewState(
      hostStatus: const <String, dynamic>{
        'state': 'core_missing',
        'platform': 'macos',
        'arch': 'arm64',
        'core': <String, dynamic>{
          'installed': false,
          'bundledAvailable': false,
          'version': '',
          'source': 'missing',
        },
        'directories': <String, dynamic>{
          'downloadsRoot': '/tmp/clawmark/downloads',
          'currentRoot': '/tmp/clawmark/current',
          'stagedRoot': '/tmp/clawmark/staged',
          'descriptorPath': '/tmp/clawmark/runtime-descriptor.json',
          'logRoot': '/tmp/clawmark/logs',
          'instanceRoot': '/tmp/clawmark/instance',
        },
        'connection': <String, dynamic>{},
        'warnings': <String>[],
      },
      phase: 'download_available',
      latestRelease: const ClawMarkCoreRelease(
        version: '2026.3.12',
        platform: 'macos',
        arch: 'arm64',
        assetName: 'ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
        archiveFormat: 'tar.gz',
        sha256:
            'b78878411ce311a0938f305115dd6e8288565d76741bf1945ab54d8a7755377f',
        sizeBytes: 227170227,
        downloadUrl:
            'https://example.com/ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
        publishedAt: '2026-03-20T18:41:21.143Z',
      ),
      releaseStatus: 'available',
      lastCheckedAt: 1893456000000,
      progress: null,
      statusMessage: '已经找到适用于当前设备的核心运行时，可以直接安装。',
      releaseStatusMessage: '已找到可安装的 ClawMark 核心版本。',
      errorMessage: null,
    );
  }
}

class _ReadyBootstrapController extends DesktopBootstrapController {
  @override
  Future<DesktopBootstrapViewState> build() async {
    return DesktopBootstrapViewState(
      hostStatus: const <String, dynamic>{
        'state': 'ready',
        'platform': 'macos',
        'arch': 'arm64',
        'core': <String, dynamic>{
          'installed': true,
          'bundledAvailable': false,
          'version': '2026.3.12',
          'source': 'installed',
        },
        'directories': <String, dynamic>{
          'downloadsRoot': '/tmp/clawmark/downloads',
          'currentRoot': '/tmp/clawmark/current',
          'stagedRoot': '/tmp/clawmark/staged',
          'descriptorPath': '/tmp/clawmark/runtime-descriptor.json',
          'logRoot': '/tmp/clawmark/logs',
          'instanceRoot': '/tmp/clawmark/instance',
        },
        'connection': <String, dynamic>{
          'wsUrl': 'ws://127.0.0.1:54300',
          'authToken': 'token-1',
          'coreVersion': '2026.3.12',
        },
        'warnings': <String>[],
      },
      phase: 'ready',
      latestRelease: const ClawMarkCoreRelease(
        version: '2026.3.12',
        platform: 'macos',
        arch: 'arm64',
        assetName: 'ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
        archiveFormat: 'tar.gz',
        sha256:
            'b78878411ce311a0938f305115dd6e8288565d76741bf1945ab54d8a7755377f',
        sizeBytes: 227170227,
        downloadUrl:
            'https://example.com/ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
        publishedAt: '2026-03-20T18:41:21.143Z',
      ),
      releaseStatus: 'available',
      lastCheckedAt: 1893456000000,
      progress: null,
      statusMessage: '本地运行时已经就绪。',
      releaseStatusMessage: '已找到可安装的 ClawMark 核心版本。',
      errorMessage: null,
    );
  }
}

class _ReadyGatewayDesktopClient extends GatewayDesktopClient {
  _ReadyGatewayDesktopClient();

  final StreamController<GatewayEventFrame> _eventsController =
      StreamController<GatewayEventFrame>.broadcast();

  static const Map<String, dynamic> _bootstrap = {
    'product': {'layout': 'left_navigation_center_interaction_right_workboard'},
    'runtime': {'runtimeVersion': '2026.3.12', 'wsUrl': 'ws://127.0.0.1:54300'},
    'gateway': {
      'url': 'ws://127.0.0.1:54300',
      'transport': 'websocket-rpc',
      'localOnly': true,
      'authMode': 'token',
    },
    'instanceManifest': {
      'instanceRoot': '/tmp/clawmark',
      'workspaceRoot': '/tmp/clawmark/workspace',
      'logRoot': '/tmp/clawmark/logs',
    },
    'warnings': <String>[],
  };

  static const Map<String, dynamic> _settings = {
    'taskDefaults': {
      'defaultBudgetMode': 'balanced',
      'defaultRetrievalMode': 'light',
      'maxInputTokensPerTurn': 2048,
      'maxContextChars': 8000,
      'compactionWatermark': 4000,
      'maxRemoteCallsPerTask': 4,
    },
    'evolution': {
      'enabled': true,
      'autoApplyLowRisk': false,
      'autoCanaryEvolution': false,
      'reviewIntervalHours': 24,
    },
    'intel': {
      'enabled': true,
      'digestEnabled': true,
      'refreshMinutes': 180,
      'dailyPushEnabled': false,
      'dailyPushItemCount': 6,
      'dailyPushHourLocal': 9,
      'dailyPushMinuteLocal': 0,
      'instantPushEnabled': false,
      'instantPushMinScore': 90,
    },
    'capabilities': {
      'preset': 'managed_high',
      'browserEnabled': false,
      'sandboxMode': 'workspace-write',
      'workspaceRoot': '/tmp/clawmark/workspace',
    },
    'gateway': {'url': 'ws://127.0.0.1:54300'},
    'instanceManifest': {
      'instanceRoot': '/tmp/clawmark',
      'workspaceRoot': '/tmp/clawmark/workspace',
      'logRoot': '/tmp/clawmark/logs',
    },
  };

  static const Map<String, dynamic> _task = {
    'id': 'task-seed-1',
    'title': 'Seed task',
    'status': 'running',
    'route': 'desktop-console',
    'priority': 'normal',
    'updatedAt': 1700000000000,
    'worker': 'main',
    'nextAction': 'Observe runtime status',
    'goal': 'Keep the workboard hydrated for desktop tests.',
  };

  static final Map<String, dynamic> _dashboard = {
    'runtimeVersion': '2026.3.12',
    'tasks': {
      'total': 1,
      'reviewCount': 0,
      'tasks': [_task],
    },
    'userConsole': {
      'pendingActionCount': 0,
      'waitingUserTaskCount': 0,
      'recommendedUserModelOptimizationCount': 0,
      'recommendedRoleOptimizationCount': 0,
      'model': {
        'displayName': 'Operator',
        'communicationStyle': 'calm and direct',
        'interruptionThreshold': 'medium',
        'reportVerbosity': 'balanced',
        'confirmationBoundary': 'balanced',
        'reportPolicy': 'reply_and_proactive',
      },
      'mirror': {
        'path': '/tmp/USER.md',
        'pendingImport': false,
        'syncNeeded': false,
        'lastModifiedAt': 1700000000000,
      },
      'actionQueue': const <Map<String, dynamic>>[],
    },
    'memory': {
      'total': 1,
      'strategyCount': 1,
      'memories': const [
        {
          'id': 'memory-1',
          'summary': 'User prefers direct updates.',
          'detail': 'The operator usually prefers direct status updates.',
          'memoryType': 'communication',
          'route': 'general',
          'scope': 'runtime',
          'confidence': 0.8,
          'decayScore': 0.1,
          'updatedAt': 1700000000000,
          'invalidatedBy': <String>[],
        },
      ],
      'strategies': const [
        {
          'id': 'strategy-1',
          'summary': 'Prefer concise control-loop narration.',
          'route': 'general',
          'worker': 'main',
          'updatedAt': 1700000000000,
        },
      ],
    },
    'agents': const [
      {
        'id': 'research',
        'name': 'Research',
        'roleBase': 'research analyst',
        'active': true,
        'skillCount': 2,
        'surfaceCount': 1,
        'openTaskCount': 1,
        'waitingUserTaskCount': 0,
        'recentReportCount': 1,
        'recentCompletionReportCount': 0,
        'followUpPressureCount': 0,
        'blockedReportCount': 0,
        'waitingExternalReportCount': 0,
        'recentIntelDeliveryCount': 0,
        'pendingRoleOptimizationCount': 0,
        'pendingCoordinatorSuggestionCount': 0,
        'materializedCoordinatorSuggestionCount': 0,
        'reportPolicy': 'reply_and_proactive',
        'latestActivityAt': 1700000000000,
        'recentActivity': <Map<String, dynamic>>[],
        'updatedAt': 1700000000000,
      },
    ],
    'surfaces': const [
      {
        'id': 'surface-research',
        'label': 'Research ops',
        'channel': 'slack',
        'accountId': 'workspace:research',
        'ownerKind': 'agent',
        'ownerId': 'research',
        'ownerLabel': 'Research',
        'active': true,
        'role': 'research concierge',
        'businessGoal': 'Keep the research surface triaged.',
        'tone': 'precise and calm',
        'initiative': 'medium',
        'reportTarget': 'surface-owner',
        'allowedTopics': ['research', 'analysis'],
        'restrictedTopics': ['secrets'],
        'localBusinessPolicy': {
          'taskCreation': 'recommend_only',
          'escalationTarget': 'surface-owner',
          'roleScope': 'research triage',
        },
        'localBusinessPolicySource': 'overlay',
        'overlayPresent': true,
        'roleSource': 'overlay',
        'toneSource': 'overlay',
        'openTaskCount': 1,
        'waitingUserTaskCount': 0,
        'recentReportCount': 1,
        'recentCompletionReportCount': 0,
        'followUpPressureCount': 0,
        'blockedReportCount': 0,
        'waitingExternalReportCount': 0,
        'recentIntelDeliveryCount': 0,
        'pendingRoleOptimizationCount': 0,
        'pendingCoordinatorSuggestionCount': 0,
        'materializedCoordinatorSuggestionCount': 0,
        'latestActivityAt': 1700000000000,
        'recentActivity': <Map<String, dynamic>>[],
        'updatedAt': 1700000000000,
      },
    ],
    'capabilities': {
      'entries': const <Map<String, dynamic>>[],
      'mcpGrants': const <Map<String, dynamic>>[],
      'recentActivity': const <Map<String, dynamic>>[],
    },
    'intel': {
      'enabled': true,
      'digestEnabled': true,
      'refreshMinutes': 180,
      'dailyPushEnabled': false,
      'dailyPushItemCount': 6,
      'dailyPushHourLocal': 9,
      'dailyPushMinuteLocal': 0,
      'instantPushEnabled': false,
      'instantPushMinScore': 90,
      'enabledDomainIds': const ['ai', 'technology'],
      'pendingDailyDigestCount': 0,
      'pendingInstantAlertCount': 0,
      'recentItems': const <Map<String, dynamic>>[],
      'domains': const [
        {'id': 'ai', 'label': 'AI', 'enabled': true},
        {'id': 'technology', 'label': 'Technology', 'enabled': true},
      ],
    },
    'evolution': {'candidates': const <Map<String, dynamic>>[]},
    'federation': {
      'pendingOutboxEventCount': 0,
      'pendingAssignments': 0,
      'acknowledgedOutboxEventId': null,
      'inbox': {
        'latestPackages': const <Map<String, dynamic>>[],
        'latestCoordinatorSuggestions': const <Map<String, dynamic>>[],
      },
      'assignmentInbox': {'latestAssignments': const <Map<String, dynamic>>[]},
    },
  };

  @override
  Stream<GatewayEventFrame> get events => _eventsController.stream;

  @override
  Future<void> connect() async {}

  @override
  Future<dynamic> request(String method, [Object? params]) async {
    switch (method) {
      case 'desktop.getShellSnapshot':
        return {
          'bootstrap': _bootstrap,
          'dashboard': _dashboard,
          'settings': _settings,
        };
      case 'runtime.getHealth':
        return const {
          'generatedAt': 1700000001002,
          'process': {
            'pid': 43210,
            'uptimeMs': 42000,
            'rssBytes': 157286400,
            'heapUsedBytes': 33554432,
          },
          'runtimeVersion': '2026.3.12',
          'tasks': {'total': 1, 'runnable': 1, 'active': 1, 'waitingUser': 0},
          'memory': {'total': 1, 'strategies': 1, 'invalidated': 0},
          'federation': {
            'enabled': false,
            'remoteConfigured': false,
            'pendingOutboxEventCount': 0,
            'pendingAssignments': 0,
          },
          'warnings': <String>[],
        };
      case 'runtime.getTask':
        return {
          'task': _task,
          'runs': const <Map<String, dynamic>>[],
          'reviews': const <Map<String, dynamic>>[],
          'reports': const <Map<String, dynamic>>[],
          'activeSteps': const <Map<String, dynamic>>[],
          'archivedSteps': const <Map<String, dynamic>>[],
        };
      case 'runtime.user.console.detail':
        return const {
          'agents': <Map<String, dynamic>>[],
          'agentOverlays': <Map<String, dynamic>>[],
          'surfaces': <Map<String, dynamic>>[],
          'surfaceRoleOverlays': <Map<String, dynamic>>[],
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
    final value = await request(method, params);
    if (value is Map<String, dynamic>) {
      return value;
    }
    if (value is Map) {
      return value.map((key, entry) => MapEntry(key.toString(), entry));
    }
    return const <String, dynamic>{};
  }

  @override
  void dispose() {
    unawaited(_eventsController.close());
  }
}
