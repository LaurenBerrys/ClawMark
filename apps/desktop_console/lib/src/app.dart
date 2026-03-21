import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'console_shell.dart';
import 'desktop_design.dart';
import 'desktop_host.dart';
import 'models.dart';

class ClawMarkDesktopApp extends StatelessWidget {
  const ClawMarkDesktopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: "ClawMark 桌面控制台",
      theme: buildDesktopTheme(),
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
    return _BootstrapChrome(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: DesktopSurfaceCard(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: DesktopTokens.surfaceMuted,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: DesktopTokens.border),
                  ),
                  alignment: Alignment.center,
                  child: const SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(strokeWidth: 2.6),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  "正在准备 ClawMark 桌面端",
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 10),
                Text(
                  "ClawMark 正在检查桌面核心、启动描述符和当前连接会话，稍后会自动进入控制台。",
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
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
    return _BootstrapChrome(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: DesktopSurfaceCard(
            padding: const EdgeInsets.all(28),
            tone: DesktopSurfaceTone.danger,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DesktopStatusPill(
                  label: "启动检查失败",
                  tone: DesktopSurfaceTone.danger,
                ),
                const SizedBox(height: 18),
                Text(
                  "桌面宿主没有完成启动检查",
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 10),
                Text(
                  "先恢复本地启动状态，再继续进入控制台。技术细节会保留在下方，方便排查。",
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 18),
                SelectableText(
                  error.toString(),
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 22),
                FilledButton.icon(
                  onPressed: () => ref.invalidate(bootstrapControllerProvider),
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text("重新检查启动状态"),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BootstrapWorkbench extends ConsumerWidget {
  const _BootstrapWorkbench({super.key, required this.bootstrap});

  final DesktopBootstrapViewState bootstrap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(bootstrapControllerProvider.notifier);
    final warnings = asStringList(bootstrap.hostStatus["warnings"]);
    return _BootstrapChrome(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact =
              constraints.maxWidth < 1180 || constraints.maxHeight < 760;
          final details = _BootstrapDetailsGrid(bootstrap: bootstrap);
          final readiness = _BootstrapReadinessCard(bootstrap: bootstrap);
          final diagnostics = _BootstrapDiagnosticsCard(
            bootstrap: bootstrap,
            warnings: warnings,
          );

          if (compact) {
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _BootstrapRail(bootstrap: bootstrap),
                  const SizedBox(height: 20),
                  _BootstrapPrimaryCard(
                    bootstrap: bootstrap,
                    controller: controller,
                  ),
                  const SizedBox(height: 20),
                  details,
                  const SizedBox(height: 20),
                  readiness,
                  const SizedBox(height: 20),
                  diagnostics,
                ],
              ),
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: 256, child: _BootstrapRail(bootstrap: bootstrap)),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _BootstrapPrimaryCard(
                      bootstrap: bootstrap,
                      controller: controller,
                    ),
                    const SizedBox(height: 20),
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: details),
                          const SizedBox(width: 20),
                          SizedBox(
                            width: 360,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Expanded(child: readiness),
                                const SizedBox(height: 20),
                                diagnostics,
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _BootstrapPrimaryCard extends StatelessWidget {
  const _BootstrapPrimaryCard({
    required this.bootstrap,
    required this.controller,
  });

  final DesktopBootstrapViewState bootstrap;
  final DesktopBootstrapController controller;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 20,
            runSpacing: 20,
            crossAxisAlignment: WrapCrossAlignment.start,
            children: [
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 280, maxWidth: 680),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    DesktopStatusPill(
                      label: _phaseLabel(bootstrap.phase),
                      tone: _phaseTone(bootstrap),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      "启动桌面核心",
                      style: Theme.of(context).textTheme.headlineLarge,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _phaseHeadline(bootstrap),
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      bootstrap.statusMessage ?? _phaseSupportText(bootstrap),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 180, maxWidth: 220),
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: DesktopTokens.surfaceMuted,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: DesktopTokens.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "当前会话",
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        bootstrap.currentVersion.isEmpty
                            ? "未安装桌面核心"
                            : bootstrap.currentVersion,
                        style: Theme.of(
                          context,
                        ).textTheme.headlineMedium?.copyWith(fontSize: 28),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        "${bootstrap.platform} / ${bootstrap.arch}",
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (bootstrap.progress != null) ...[
            const SizedBox(height: 22),
            LinearProgressIndicator(
              value: bootstrap.progress,
              minHeight: 6,
              borderRadius: BorderRadius.circular(999),
            ),
          ],
          if ((bootstrap.errorMessage ?? "").isNotEmpty) ...[
            const SizedBox(height: 18),
            DesktopSurfaceCard(
              padding: const EdgeInsets.all(16),
              tone: DesktopSurfaceTone.danger,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "需要处理的错误",
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    bootstrap.errorMessage!,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              if (_showDownloadAction(bootstrap))
                FilledButton.icon(
                  onPressed:
                      bootstrap.isBusy ? null : () => controller.downloadCore(),
                  icon: const Icon(Icons.download_rounded),
                  label: Text(
                    bootstrap.updateAvailable ? "下载最新桌面核心" : "下载 ClawMark 核心",
                  ),
                ),
              if (_showRestartAction(bootstrap))
                FilledButton.icon(
                  onPressed:
                      bootstrap.isBusy
                          ? null
                          : () => controller.restartRuntime(),
                  icon: const Icon(Icons.play_arrow_rounded),
                  label: Text(bootstrap.hasInstalledCore ? "启动桌面核心" : "重试启动核心"),
                ),
              OutlinedButton.icon(
                onPressed:
                    bootstrap.isBusy
                        ? null
                        : () => controller.checkForUpdates(force: true),
                icon: const Icon(Icons.system_update_alt_rounded),
                label: Text(
                  bootstrap.releaseStatus == "missing" ? "重新检查发布" : "检查更新",
                ),
              ),
              OutlinedButton.icon(
                onPressed:
                    bootstrap.isBusy
                        ? null
                        : () => controller.refresh(statusMessage: "已刷新桌面启动状态。"),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text("刷新状态"),
              ),
              TextButton.icon(
                onPressed:
                    bootstrap.isBusy ? null : () => controller.openLogs(),
                icon: const Icon(Icons.folder_open_rounded),
                label: const Text("打开日志"),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BootstrapDetailsGrid extends StatelessWidget {
  const _BootstrapDetailsGrid({required this.bootstrap});

  final DesktopBootstrapViewState bootstrap;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const DesktopSectionHeader(
            title: "安装与切换信息",
            subtitle: "这里展示当前本地槽位、可用核心版本和接下来会发生什么。",
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              DesktopFactTile(
                label: "当前来源",
                value: _sourceLabel(bootstrap.currentSource),
              ),
              DesktopFactTile(
                label: "当前版本",
                value:
                    bootstrap.currentVersion.isEmpty
                        ? "未安装"
                        : bootstrap.currentVersion,
              ),
              DesktopFactTile(
                label: "可用版本",
                value:
                    bootstrap.latestRelease == null
                        ? _latestReleaseLabel(bootstrap)
                        : "${bootstrap.latestRelease!.version}\n${bootstrap.latestRelease!.assetName}",
                tone: DesktopSurfaceTone.accent,
              ),
              DesktopFactTile(
                label: "核心发布状态",
                value:
                    bootstrap.releaseStatusMessage ??
                    _releaseStatusLabel(bootstrap.releaseStatus),
              ),
              DesktopFactTile(label: "描述符路径", value: bootstrap.descriptorPath),
              DesktopFactTile(label: "日志目录", value: bootstrap.logRoot),
              DesktopFactTile(label: "实例根目录", value: bootstrap.instanceRoot),
              DesktopFactTile(label: "下载目录", value: bootstrap.downloadsRoot),
            ],
          ),
        ],
      ),
    );
  }
}

class _BootstrapReadinessCard extends StatelessWidget {
  const _BootstrapReadinessCard({required this.bootstrap});

  final DesktopBootstrapViewState bootstrap;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const DesktopSectionHeader(
            title: "就绪路径",
            subtitle: "只有启动链路完整闭环后，桌面端才会进入正式控制台。",
          ),
          const SizedBox(height: 18),
          _ChecklistLine(
            done: bootstrap.hasInstalledCore,
            text: "本地设备已具备可执行的 ClawMark 核心载荷。",
          ),
          _ChecklistLine(
            done: bootstrap.latestRelease != null || bootstrap.hasInstalledCore,
            text:
                bootstrap.releaseStatus == "missing"
                    ? "当前公开发布页里还没有可安装的核心版本，需要先发布桌面核心。"
                    : bootstrap.releaseStatus == "incompatible"
                    ? "当前已经有公开发布，但没有适用于这台设备的安装包。"
                    : "当前公开发布清单已经可用于选择安装包。",
          ),
          _ChecklistLine(
            done: bootstrap.phase == "starting_runtime" || bootstrap.isReady,
            text: "桌面宿主会使用动态本地回环端点和会话 token 拉起桌面核心。",
          ),
          _ChecklistLine(
            done: bootstrap.isReady,
            text: "桌面控制台会使用原生宿主上报的描述符，而不是猜测固定端口。",
          ),
        ],
      ),
    );
  }
}

class _BootstrapDiagnosticsCard extends StatelessWidget {
  const _BootstrapDiagnosticsCard({
    required this.bootstrap,
    required this.warnings,
  });

  final DesktopBootstrapViewState bootstrap;
  final List<String> warnings;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: const EdgeInsets.all(24),
      tone:
          warnings.isEmpty
              ? DesktopSurfaceTone.muted
              : DesktopSurfaceTone.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const DesktopSectionHeader(
            title: "诊断与告警",
            subtitle: "保留必要的技术细节，但不让它抢占主流程。",
          ),
          const SizedBox(height: 14),
          if (warnings.isEmpty && bootstrap.errorMessage == null)
            Text("当前没有启动告警。", style: Theme.of(context).textTheme.bodyMedium),
          ...warnings.map(
            (warning) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                warning,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: DesktopTokens.warning),
              ),
            ),
          ),
          if ((bootstrap.errorMessage ?? "").isNotEmpty)
            SelectableText(
              bootstrap.errorMessage!,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
        ],
      ),
    );
  }
}

class _BootstrapRail extends StatelessWidget {
  const _BootstrapRail({required this.bootstrap});

  final DesktopBootstrapViewState bootstrap;

  @override
  Widget build(BuildContext context) {
    return DesktopSurfaceCard(
      padding: EdgeInsets.zero,
      child: Container(
        decoration: const BoxDecoration(
          color: DesktopTokens.sidebar,
          borderRadius: BorderRadius.all(Radius.circular(18)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "ClawMark",
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontFamily: DesktopTokens.bodyFont,
                  color: DesktopTokens.accent,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text("本地自治控制台", style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 24),
              DesktopSurfaceCard(
                padding: const EdgeInsets.all(16),
                tone: _phaseTone(bootstrap),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("当前阶段", style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 10),
                    Text(
                      _phaseLabel(bootstrap.phase),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _phaseSupportText(bootstrap),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              DesktopSurfaceCard(
                padding: const EdgeInsets.all(16),
                tone: DesktopSurfaceTone.muted,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("本地姿态", style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 12),
                    _RailInfoLine(
                      label: "来源",
                      value: _sourceLabel(bootstrap.currentSource),
                    ),
                    _RailInfoLine(
                      label: "版本",
                      value:
                          bootstrap.currentVersion.isEmpty
                              ? "未安装"
                              : bootstrap.currentVersion,
                    ),
                    _RailInfoLine(
                      label: "平台",
                      value: "${bootstrap.platform} / ${bootstrap.arch}",
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              DesktopSurfaceCard(
                padding: const EdgeInsets.all(16),
                tone: DesktopSurfaceTone.accent,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "进入控制台之前",
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      "启动面板会先把桌面核心、宿主和连接链路准备好，再把你送进正式操作面。",
                      style: Theme.of(context).textTheme.bodyMedium,
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

class _RailInfoLine extends StatelessWidget {
  const _RailInfoLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          Text(value, style: Theme.of(context).textTheme.titleMedium),
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
            done ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
            size: 18,
            color: done ? DesktopTokens.accent : DesktopTokens.textMuted,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

class _BootstrapChrome extends StatelessWidget {
  const _BootstrapChrome({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(color: DesktopTokens.background),
        child: Stack(
          children: [
            Positioned(
              left: -120,
              top: -80,
              child: Container(
                width: 320,
                height: 320,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: DesktopTokens.accent.withValues(alpha: 0.08),
                ),
              ),
            ),
            Positioned(
              right: -80,
              bottom: -80,
              child: Container(
                width: 280,
                height: 280,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: DesktopTokens.accentStrong.withValues(alpha: 0.12),
                ),
              ),
            ),
            SafeArea(
              child: Padding(padding: const EdgeInsets.all(24), child: child),
            ),
          ],
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

String _sourceLabel(String source) => switch (source) {
  "installed" => "已安装",
  "bundled" => "应用内置",
  "missing" => "未安装",
  _ => source,
};

String _phaseLabel(String phase) => switch (phase) {
  "core_missing" => "缺少桌面核心",
  "release_missing" => "未发布桌面核心",
  "download_available" => "可下载安装",
  "downloading" => "下载中",
  "verifying" => "校验中",
  "installing" => "安装中",
  "starting_runtime" => "启动桌面核心",
  "ready" => "已就绪",
  "failed" => "需要处理",
  _ => phase,
};

String _phaseHeadline(DesktopBootstrapViewState bootstrap) => switch (bootstrap
    .phase) {
  "core_missing" => "当前设备还没有安装桌面核心。",
  "release_missing" => "当前公开发布页里还没有可安装的桌面核心。",
  "download_available" => "已经找到适用于当前设备的桌面核心，可以直接安装。",
  "downloading" => "正在下载 ClawMark 桌面核心。",
  "verifying" => "安装前正在校验刚下载的桌面核心。",
  "installing" => "桌面宿主正在安装新的桌面核心版本。",
  "starting_runtime" => "桌面宿主正在启动桌面核心，并写入新的会话描述符。",
  "ready" => "桌面核心已经就绪，控制台可以连接了。",
  "failed" => "桌面宿主需要操作员处理后，控制台才能继续。",
  _ => "正在准备桌面连接会话。",
};

String _phaseSupportText(DesktopBootstrapViewState bootstrap) =>
    switch (bootstrap.phase) {
      "core_missing" => "请先下载最新桌面核心，完成一体化启动。",
      "release_missing" => "需要先把桌面核心发布到公开发布页；发布完成后，再点“重新检查发布”。",
      "download_available" => "安装最新兼容的桌面核心后，就可以进入完整桌面控制台。",
      "failed" => "可以打开日志或重试启动桌面核心，恢复当前启动会话。",
      _ => "ClawMark 桌面端会把核心能力保持在本地，并由操作员控制。",
    };

String _latestReleaseLabel(DesktopBootstrapViewState bootstrap) {
  return switch (bootstrap.releaseStatus) {
    "missing" => "暂未发现已发布的核心版本",
    "incompatible" => "已发现发布，但当前设备没有兼容安装包",
    "error" => "检查发布失败",
    _ => "尚未检查可用版本",
  };
}

String _releaseStatusLabel(String status) {
  return switch (status) {
    "available" => "已找到可下载安装的核心版本",
    "missing" => "公开发布页里还没有任何核心版本",
    "incompatible" => "当前公开发布页没有适用于这台设备的安装包",
    "error" => "检查更新失败",
    _ => "尚未检查核心发布状态",
  };
}

DesktopSurfaceTone _phaseTone(DesktopBootstrapViewState bootstrap) {
  return switch (bootstrap.phase) {
    "failed" || "release_missing" => DesktopSurfaceTone.danger,
    "core_missing" => DesktopSurfaceTone.warning,
    "download_available" ||
    "downloading" ||
    "verifying" ||
    "installing" ||
    "starting_runtime" => DesktopSurfaceTone.accent,
    "ready" => DesktopSurfaceTone.success,
    _ => DesktopSurfaceTone.base,
  };
}
