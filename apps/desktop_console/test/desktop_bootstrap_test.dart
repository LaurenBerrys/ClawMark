import 'dart:convert';
import 'dart:io';

import 'package:desktop_console/src/desktop_host.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('downloadCore surfaces visible failure state instead of silently stalling', () async {
    final tempDir = await Directory.systemTemp.createTemp('clawmark-bootstrap-test-');
    addTearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    final releaseStateFile = File('${tempDir.path}/release-state.json');
    await releaseStateFile.writeAsString(
      const JsonEncoder.withIndent('  ').convert({
        'lastCheckedAt': 1774050965464,
        'releaseStatus': 'available',
        'releaseStatusMessage': '已找到可安装的 ClawMarkCore 版本。',
        'release': {
          'version': '2026.3.12',
          'platform': 'macos',
          'arch': 'arm64',
          'assetName': 'ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
          'archiveFormat': 'tar.gz',
          'sha256':
              'b78878411ce311a0938f305115dd6e8288565d76741bf1945ab54d8a7755377f',
          'sizeBytes': 227170227,
          'downloadUrl': 'http://127.0.0.1:9/ClawMarkCore-macos-arm64-2026.3.12.tar.gz',
          'publishedAt': '2026-03-20T18:41:21.143Z',
        },
      }),
    );

    final bridge = _BootstrapTestBridge(downloadsRoot: tempDir.path);
    final container = ProviderContainer(
      overrides: [desktopBridgeProvider.overrideWithValue(bridge)],
    );
    addTearDown(container.dispose);

    final initial = await container.read(bootstrapControllerProvider.future);
    expect(initial.phase, 'download_available');

    final controller = container.read(bootstrapControllerProvider.notifier);
    await controller.downloadCore();

    final resolved = container.read(bootstrapControllerProvider).requireValue;
    expect(resolved.phase, 'download_available');
    expect(resolved.statusMessage, 'ClawMarkCore 下载或安装失败，请查看错误后重试。');
    expect(resolved.errorMessage, isNotNull);
    expect(resolved.errorMessage, contains('网络连接失败'));
  });
}

class _BootstrapTestBridge extends DesktopBridge {
  _BootstrapTestBridge({required this.downloadsRoot});

  final String downloadsRoot;

  @override
  Future<Map<String, dynamic>> getBootstrapStatus() async {
    return <String, dynamic>{
      'state': 'core_missing',
      'platform': 'macos',
      'arch': 'arm64',
      'core': <String, dynamic>{
        'installed': false,
        'bundledAvailable': false,
        'version': '',
        'source': 'missing',
        'lastCheckedAt': 1774050965464,
      },
      'directories': <String, dynamic>{
        'downloadsRoot': downloadsRoot,
        'currentRoot': '$downloadsRoot/current',
        'stagedRoot': '$downloadsRoot/staged',
        'descriptorPath': '$downloadsRoot/runtime-descriptor.json',
        'logRoot': '$downloadsRoot/logs',
        'instanceRoot': '$downloadsRoot/instance',
      },
      'connection': <String, dynamic>{},
    };
  }

  @override
  Future<Map<String, dynamic>> installCoreArchive(String archivePath) async {
    fail('installCoreArchive should not be reached when download fails');
  }

  @override
  Future<Map<String, dynamic>> openLogs() async {
    return <String, dynamic>{'opened': false, 'logRoot': '$downloadsRoot/logs'};
  }

  @override
  Future<Map<String, dynamic>> restartRuntime() async {
    return await getBootstrapStatus();
  }
}
