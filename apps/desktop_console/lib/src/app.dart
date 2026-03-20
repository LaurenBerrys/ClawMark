import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'console_shell.dart';
import 'desktop_host.dart';
import 'models.dart';

class ClawMarkDesktopApp extends StatelessWidget {
  const ClawMarkDesktopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: "ClawMark 桌面控制台",
      theme: _buildTheme(),
      home: const _DesktopRoot(),
    );
  }
}

class _DesktopRoot extends ConsumerWidget {
  const _DesktopRoot();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrapAsync = ref.watch(bootstrapControllerProvider);
    return bootstrapAsync.when(
      loading: () => const _BootstrapLoadingView(),
      error: (error, _) => _BootstrapErrorView(error: error),
      data:
          (bootstrap) => AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child:
                bootstrap.isReady
                    ? const ConsoleShell(key: ValueKey("console-shell"))
                    : _BootstrapWorkbench(
                      key: ValueKey("bootstrap-${bootstrap.phase}"),
                      bootstrap: bootstrap,
                    ),
          ),
    );
  }
}

class _BootstrapLoadingView extends StatelessWidget {
  const _BootstrapLoadingView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
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
                "正在准备 ClawMark 桌面端…",
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(
                "正在检查本地 ClawMark Core 槽位、启动描述符和运行时会话。",
                style: Theme.of(context).textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BootstrapErrorView extends ConsumerWidget {
  const _BootstrapErrorView({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "启动检查失败",
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      error.toString(),
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed:
                          () => ref.invalidate(bootstrapControllerProvider),
                      icon: const Icon(Icons.refresh),
                      label: const Text("重新检查启动状态"),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BootstrapWorkbench extends ConsumerWidget {
  const _BootstrapWorkbench({
    super.key,
    required this.bootstrap,
  });

  final DesktopBootstrapViewState bootstrap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(bootstrapControllerProvider.notifier);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "ClawMark 桌面端启动面板",
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              const SizedBox(height: 10),
              Text(
                _phaseHeadline(bootstrap),
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 20),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      flex: 5,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _StatusChip(
                                label: _phaseLabel(bootstrap.phase),
                                color:
                                    bootstrap.phase == "failed"
                                        ? const Color(0xFF9D4B32)
                                        : Theme.of(context).colorScheme.primary,
                              ),
                              const SizedBox(height: 18),
                              Text(
                                bootstrap.statusMessage ??
                                    _phaseSupportText(bootstrap),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 10),
                              if ((bootstrap.errorMessage ?? "").isNotEmpty)
                                Text(
                                  bootstrap.errorMessage!,
                                  style: Theme.of(
                                    context,
                                  ).textTheme.bodyMedium?.copyWith(
                                    color: const Color(0xFF8A4A34),
                                  ),
                                ),
                              if (bootstrap.progress != null) ...[
                                const SizedBox(height: 16),
                                LinearProgressIndicator(value: bootstrap.progress),
                              ],
                              const SizedBox(height: 24),
                              Wrap(
                                spacing: 12,
                                runSpacing: 12,
                                children: [
                                  if (_showDownloadAction(bootstrap))
                                    FilledButton.icon(
                                      onPressed:
                                          bootstrap.isBusy
                                              ? null
                                              : () => controller.downloadCore(),
                                      icon: const Icon(Icons.download_rounded),
                                      label: const Text("下载 ClawMark Core"),
                                    ),
                                  if (_showRestartAction(bootstrap))
                                    FilledButton.icon(
                                      onPressed:
                                          bootstrap.isBusy
                                              ? null
                                              : () => controller.restartRuntime(),
                                      icon: const Icon(Icons.play_arrow_rounded),
                                      label: Text(
                                        bootstrap.hasInstalledCore
                                            ? "启动本地运行时"
                                            : "重试启动运行时",
                                      ),
                                    ),
                                  OutlinedButton.icon(
                                    onPressed:
                                        bootstrap.isBusy
                                            ? null
                                            : () => controller.checkForUpdates(
                                      force: true,
                                            ),
                                    icon: const Icon(Icons.system_update_alt),
                                    label: Text(
                                      bootstrap.releaseStatus == "missing"
                                          ? "重新检查发布"
                                          : "检查更新",
                                    ),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed:
                                        bootstrap.isBusy
                                            ? null
                                            : () => controller.refresh(
                                              statusMessage:
                                                  "已刷新桌面启动状态。",
                                            ),
                                    icon: const Icon(Icons.refresh),
                                    label: const Text("刷新状态"),
                                  ),
                                  TextButton.icon(
                                    onPressed:
                                        bootstrap.isBusy
                                            ? null
                                            : () => controller.openLogs(),
                                    icon: const Icon(Icons.folder_open),
                                    label: const Text("打开日志"),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 24),
                              Expanded(
                                child: SingleChildScrollView(
                                  child: Column(
                                    children: [
                                      _InfoTile(
                                        label: "当前来源",
                                        value: bootstrap.currentSource,
                                      ),
                                      _InfoTile(
                                        label: "当前版本",
                                        value:
                                            bootstrap.currentVersion.isEmpty
                                                ? "未安装"
                                                : bootstrap.currentVersion,
                                      ),
                                      _InfoTile(
                                        label: "最新发布",
                                        value:
                                            bootstrap.latestRelease == null
                                                ? _latestReleaseLabel(bootstrap)
                                                : "${bootstrap.latestRelease!.version} (${bootstrap.latestRelease!.assetName})",
                                      ),
                                      _InfoTile(
                                        label: "远程发布状态",
                                        value:
                                            bootstrap.releaseStatusMessage ??
                                            _releaseStatusLabel(
                                              bootstrap.releaseStatus,
                                            ),
                                      ),
                                      _InfoTile(
                                        label: "平台",
                                        value:
                                            "${bootstrap.platform} / ${bootstrap.arch}",
                                      ),
                                      _InfoTile(
                                        label: "描述符",
                                        value: bootstrap.descriptorPath,
                                      ),
                                      _InfoTile(
                                        label: "日志",
                                        value: bootstrap.logRoot,
                                      ),
                                      _InfoTile(
                                        label: "实例根目录",
                                        value: bootstrap.instanceRoot,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      flex: 4,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                "下一步会发生什么",
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 16),
                              _ChecklistLine(
                                done: bootstrap.hasInstalledCore,
                                text:
                                    "本地 Core 槽位里已经存在 ClawMark Core 载荷。",
                              ),
                              _ChecklistLine(
                                done:
                                    bootstrap.latestRelease != null ||
                                    bootstrap.hasInstalledCore,
                                text:
                                    bootstrap.releaseStatus == "missing"
                                        ? "当前仓库还没有已发布的 ClawMarkCore 版本，需要先发布 Release。"
                                        : bootstrap.releaseStatus == "incompatible"
                                        ? "当前仓库已有 Release，但还没有适用于这台设备的安装包。"
                                        : "GitHub Releases 的版本元数据已经可用，可用于选择安装包。",
                              ),
                              _ChecklistLine(
                                done:
                                    bootstrap.phase == "starting_runtime" ||
                                    bootstrap.isReady,
                                text:
                                    "桌面宿主会使用动态 loopback 端点和会话 token 启动运行时。",
                              ),
                              _ChecklistLine(
                                done: bootstrap.isReady,
                                text:
                                    "Flutter 会使用原生宿主上报的描述符，而不是猜测固定端口。",
                              ),
                              const SizedBox(height: 24),
                              Text(
                                "告警",
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 10),
                              if (bootstrap.errorMessage == null &&
                                  asStringList(bootstrap.hostStatus["warnings"]).isEmpty)
                                Text(
                                  "当前没有启动告警。",
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                              ...asStringList(
                                bootstrap.hostStatus["warnings"],
                              ).map(
                                (warning) => Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Text(
                                    warning,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodyMedium?.copyWith(
                                      color: const Color(0xFF8A4A34),
                                    ),
                                  ),
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
            ],
          ),
        ),
      ),
    );
  }
}

bool _showDownloadAction(DesktopBootstrapViewState bootstrap) {
  if (bootstrap.isBusy || bootstrap.isReady) {
    return false;
  }
  if (!bootstrap.hasInstalledCore) {
    return bootstrap.latestRelease != null;
  }
  return bootstrap.updateAvailable;
}

bool _showRestartAction(DesktopBootstrapViewState bootstrap) {
  if (bootstrap.isBusy || bootstrap.isReady) {
    return false;
  }
  return bootstrap.hasInstalledCore || bootstrap.hasBundledFallback;
}

String _phaseLabel(String phase) => switch (phase) {
  "core_missing" => "缺少 Core",
  "release_missing" => "未发布 Core",
  "download_available" => "可下载安装",
  "downloading" => "下载中",
  "verifying" => "校验中",
  "installing" => "安装中",
  "starting_runtime" => "启动运行时",
  "ready" => "已就绪",
  "failed" => "需要处理",
  _ => phase,
};

String _phaseHeadline(DesktopBootstrapViewState bootstrap) => switch (bootstrap.phase) {
  "core_missing" =>
    "当前桌面安装里还没有本地 ClawMark Core 载荷。",
  "release_missing" =>
    "当前 GitHub Releases 里还没有可安装的 ClawMark Core。",
  "download_available" =>
    "已经找到兼容的 ClawMark Core 发布包，可以直接安装。",
  "downloading" =>
    "正在从 GitHub Releases 下载 ClawMark Core。",
  "verifying" =>
    "安装前正在校验 ClawMark Core。",
  "installing" =>
    "桌面宿主正在暂存新的 ClawMark Core 载荷。",
  "starting_runtime" =>
    "桌面宿主正在启动本地运行时，并写入新的会话描述符。",
  "ready" =>
    "本地运行时已经就绪，桌面控制台可以连接了。",
  "failed" =>
    "桌面宿主需要操作员处理后，控制台才能继续。",
  _ => "正在准备本地运行时会话。",
};

String _phaseSupportText(DesktopBootstrapViewState bootstrap) => switch (bootstrap.phase) {
  "core_missing" =>
    "请从 GitHub Releases 下载最新的 ClawMark Core 包，完成一体化安装启动。",
  "release_missing" =>
    "需要先把 ClawMarkCore 资产发布到仓库 Releases；发布完成后，再点“重新检查发布”即可下载安装。",
  "download_available" =>
    "安装最新兼容的运行时载荷后，就可以进入完整桌面控制台。",
  "failed" =>
    "可以打开日志或重试启动本地运行时，恢复当前启动会话。",
  _ => "ClawMark 桌面端会把运行时保持在本地，并由操作员控制。",
};

String _latestReleaseLabel(DesktopBootstrapViewState bootstrap) {
  return switch (bootstrap.releaseStatus) {
    "missing" => "仓库还没有已发布的 ClawMarkCore 版本",
    "incompatible" => "已有发布，但没有适用于当前平台的安装包",
    "error" => "检查发布失败",
    _ => "尚未检查",
  };
}

String _releaseStatusLabel(String status) {
  return switch (status) {
    "available" => "已找到可安装的发布版本",
    "missing" => "仓库还没有发布任何 ClawMarkCore 版本",
    "incompatible" => "当前仓库没有适用于这台设备的安装包",
    "error" => "检查更新失败",
    _ => "尚未检查远程发布状态",
  };
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(color: color),
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          SelectableText(
            value,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

class _ChecklistLine extends StatelessWidget {
  const _ChecklistLine({required this.done, required this.text});

  final bool done;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            done ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 18,
            color:
                done
                    ? Theme.of(context).colorScheme.primary
                    : const Color(0xFF8A8376),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

ThemeData _buildTheme() {
  const seed = Color(0xFFBB5A37);
  final colorScheme = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: Brightness.light,
    surface: const Color(0xFFF7F2EA),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: const Color(0xFFF3EDE4),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
      margin: EdgeInsets.zero,
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(fontSize: 34, fontWeight: FontWeight.w700, color: Color(0xFF1C1C18)),
      headlineMedium: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Color(0xFF1C1C18)),
      titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF1C1C18)),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF2B2B26)),
      bodyLarge: TextStyle(fontSize: 15, height: 1.45, color: Color(0xFF2E2B26)),
      bodyMedium: TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF5A564D)),
      labelLarge: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFF7F2EA),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: BorderSide(color: colorScheme.primary, width: 1.2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
    ),
  );
}
