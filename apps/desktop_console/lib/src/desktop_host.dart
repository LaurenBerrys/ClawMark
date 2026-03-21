import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as path;

import 'models.dart';

const _desktopChannelName = "clawmark/desktop";
const _githubLatestReleaseUrl =
    "https://api.github.com/repos/LaurenBerrys/ClawMark/releases/latest";
const _releaseStateFileName = "release-state.json";

abstract class DesktopBridge {
  const DesktopBridge();

  Future<Map<String, dynamic>> getBootstrapStatus();
  Future<Map<String, dynamic>> restartRuntime();
  Future<Map<String, dynamic>> openLogs();
  Future<Map<String, dynamic>> installCoreArchive(String archivePath);
}

class MethodChannelDesktopBridge extends DesktopBridge {
  const MethodChannelDesktopBridge();

  static const MethodChannel _channel = MethodChannel(_desktopChannelName);

  @override
  Future<Map<String, dynamic>> getBootstrapStatus() async {
    final result = await _channel.invokeMethod<Object?>("getBootstrapStatus");
    return asMap(result);
  }

  @override
  Future<Map<String, dynamic>> restartRuntime() async {
    final result = await _channel.invokeMethod<Object?>("restartRuntime");
    return asMap(result);
  }

  @override
  Future<Map<String, dynamic>> openLogs() async {
    final result = await _channel.invokeMethod<Object?>("openLogs");
    return asMap(result);
  }

  @override
  Future<Map<String, dynamic>> installCoreArchive(String archivePath) async {
    final result = await _channel.invokeMethod<Object?>(
      "installCoreArchive",
      <String, Object?>{"archivePath": archivePath},
    );
    return asMap(result);
  }
}

class DesktopBootstrapRequired implements Exception {
  const DesktopBootstrapRequired(this.status);

  final Map<String, dynamic> status;

  @override
  String toString() => "桌面启动链路尚未就绪（${asString(status["state"], "不可用")}）";
}

class NoPublishedClawMarkCoreRelease implements Exception {
  const NoPublishedClawMarkCoreRelease();

  @override
  String toString() => "公开发布页中还没有已发布的 ClawMark 核心版本。";
}

class NoCompatibleClawMarkCoreAsset implements Exception {
  const NoCompatibleClawMarkCoreAsset({
    required this.platform,
    required this.arch,
  });

  final String platform;
  final String arch;

  @override
  String toString() => "公开发布页中还没有适用于 $platform / $arch 的 ClawMark 核心安装包。";
}

class ClawMarkCoreRelease {
  const ClawMarkCoreRelease({
    required this.version,
    required this.platform,
    required this.arch,
    required this.assetName,
    required this.archiveFormat,
    required this.sha256,
    required this.sizeBytes,
    required this.downloadUrl,
    required this.publishedAt,
    this.localArchivePath,
    this.downloadedAt,
  });

  factory ClawMarkCoreRelease.fromJson(Map<String, dynamic> json) {
    return ClawMarkCoreRelease(
      version: asString(json["version"]),
      platform: asString(json["platform"]),
      arch: asString(json["arch"]),
      assetName: asString(json["assetName"]),
      archiveFormat: asString(json["archiveFormat"]),
      sha256: asString(json["sha256"]).toLowerCase(),
      sizeBytes: asInt(json["sizeBytes"]),
      downloadUrl: asString(json["downloadUrl"]),
      publishedAt: asString(json["publishedAt"]),
      localArchivePath: _nullableString(json["localArchivePath"]),
      downloadedAt:
          json["downloadedAt"] is num
              ? (json["downloadedAt"] as num).toInt()
              : null,
    );
  }

  final String version;
  final String platform;
  final String arch;
  final String assetName;
  final String archiveFormat;
  final String sha256;
  final int sizeBytes;
  final String downloadUrl;
  final String publishedAt;
  final String? localArchivePath;
  final int? downloadedAt;

  bool get isDownloaded =>
      (localArchivePath ?? "").isNotEmpty &&
      File(localArchivePath!).existsSync();

  Map<String, Object?> toJson() {
    return <String, Object?>{
      "version": version,
      "platform": platform,
      "arch": arch,
      "assetName": assetName,
      "archiveFormat": archiveFormat,
      "sha256": sha256,
      "sizeBytes": sizeBytes,
      "downloadUrl": downloadUrl,
      "publishedAt": publishedAt,
      if (localArchivePath != null) "localArchivePath": localArchivePath,
      if (downloadedAt != null) "downloadedAt": downloadedAt,
    };
  }

  ClawMarkCoreRelease copyWith({String? localArchivePath, int? downloadedAt}) {
    return ClawMarkCoreRelease(
      version: version,
      platform: platform,
      arch: arch,
      assetName: assetName,
      archiveFormat: archiveFormat,
      sha256: sha256,
      sizeBytes: sizeBytes,
      downloadUrl: downloadUrl,
      publishedAt: publishedAt,
      localArchivePath: localArchivePath ?? this.localArchivePath,
      downloadedAt: downloadedAt ?? this.downloadedAt,
    );
  }
}

class DesktopBootstrapViewState {
  const DesktopBootstrapViewState({
    required this.hostStatus,
    required this.phase,
    required this.latestRelease,
    required this.releaseStatus,
    required this.lastCheckedAt,
    required this.progress,
    required this.statusMessage,
    required this.releaseStatusMessage,
    required this.errorMessage,
  });

  final Map<String, dynamic> hostStatus;
  final String phase;
  final ClawMarkCoreRelease? latestRelease;
  final String releaseStatus;
  final int lastCheckedAt;
  final double? progress;
  final String? statusMessage;
  final String? releaseStatusMessage;
  final String? errorMessage;

  Map<String, dynamic> get coreSection => asMap(hostStatus["core"]);
  Map<String, dynamic> get runtimeSection => asMap(hostStatus["runtime"]);
  Map<String, dynamic> get directoriesSection =>
      asMap(hostStatus["directories"]);
  Map<String, dynamic> get connectionSection => asMap(hostStatus["connection"]);

  bool get isReady => phase == "ready";
  bool get isBusy =>
      phase == "downloading" ||
      phase == "verifying" ||
      phase == "installing" ||
      phase == "starting_runtime";

  bool get hasInstalledCore =>
      asBool(coreSection["installed"]) ||
      asBool(coreSection["bundledAvailable"]);

  bool get hasBundledFallback => asBool(coreSection["bundledAvailable"]);

  bool get updateAvailable =>
      latestRelease != null &&
      currentVersion.isNotEmpty &&
      latestRelease!.version.isNotEmpty &&
      latestRelease!.version != currentVersion;

  String get currentVersion => asString(
    coreSection["version"],
    asString(connectionSection["coreVersion"]),
  );

  String get currentSource => asString(coreSection["source"], "missing");
  String get platform =>
      asString(hostStatus["platform"], Platform.operatingSystem);
  String get arch =>
      _normalizeArch(asString(hostStatus["arch"], Platform.version));
  String get downloadsRoot => asString(directoriesSection["downloadsRoot"]);
  String get currentRoot => asString(directoriesSection["currentRoot"]);
  String get stagedRoot => asString(directoriesSection["stagedRoot"]);
  String get descriptorPath => asString(directoriesSection["descriptorPath"]);
  String get logRoot => asString(directoriesSection["logRoot"]);
  String get instanceRoot => asString(directoriesSection["instanceRoot"]);

  DesktopBootstrapViewState copyWith({
    Map<String, dynamic>? hostStatus,
    String? phase,
    ClawMarkCoreRelease? latestRelease,
    String? releaseStatus,
    int? lastCheckedAt,
    Object? progress = _copySentinel,
    Object? statusMessage = _copySentinel,
    Object? releaseStatusMessage = _copySentinel,
    Object? errorMessage = _copySentinel,
  }) {
    return DesktopBootstrapViewState(
      hostStatus: hostStatus ?? this.hostStatus,
      phase: phase ?? this.phase,
      latestRelease: latestRelease ?? this.latestRelease,
      releaseStatus: releaseStatus ?? this.releaseStatus,
      lastCheckedAt: lastCheckedAt ?? this.lastCheckedAt,
      progress:
          identical(progress, _copySentinel)
              ? this.progress
              : progress as double?,
      statusMessage:
          identical(statusMessage, _copySentinel)
              ? this.statusMessage
              : statusMessage as String?,
      releaseStatusMessage:
          identical(releaseStatusMessage, _copySentinel)
              ? this.releaseStatusMessage
              : releaseStatusMessage as String?,
      errorMessage:
          identical(errorMessage, _copySentinel)
              ? this.errorMessage
              : errorMessage as String?,
    );
  }
}

class CachedReleaseState {
  const CachedReleaseState({
    required this.lastCheckedAt,
    required this.releaseStatus,
    required this.releaseStatusMessage,
    required this.release,
  });

  final int lastCheckedAt;
  final String releaseStatus;
  final String? releaseStatusMessage;
  final ClawMarkCoreRelease? release;
}

const Object _copySentinel = Object();

final desktopBridgeProvider = Provider<DesktopBridge>((ref) {
  return const MethodChannelDesktopBridge();
});

final bootstrapControllerProvider = AsyncNotifierProvider<
  DesktopBootstrapController,
  DesktopBootstrapViewState
>(DesktopBootstrapController.new);

class DesktopBootstrapController
    extends AsyncNotifier<DesktopBootstrapViewState> {
  bool _disposed = false;

  DesktopBridge get _bridge => ref.read(desktopBridgeProvider);

  @override
  Future<DesktopBootstrapViewState> build() async {
    _disposed = false;
    ref.onDispose(() {
      _disposed = true;
    });
    final hostStatus = await _bridge.getBootstrapStatus();
    final cachedReleaseState = await _readCachedReleaseState(hostStatus);
    final resolved = _compose(
      hostStatus,
      latestRelease: cachedReleaseState?.release,
      releaseStatus: cachedReleaseState?.releaseStatus,
      lastCheckedAt: cachedReleaseState?.lastCheckedAt,
      releaseStatusMessage: cachedReleaseState?.releaseStatusMessage,
    );
    if (resolved.phase == "starting_runtime") {
      unawaited(_monitorStartup(cachedReleaseState?.release));
    }
    if (_shouldAutoCheck(resolved)) {
      unawaited(checkForUpdates(force: false));
    }
    return resolved;
  }

  Future<void> refresh({String? statusMessage}) async {
    final current = state.valueOrNull;
    if (current != null) {
      state = AsyncData(
        current.copyWith(statusMessage: statusMessage ?? current.statusMessage),
      );
    }
    state = await AsyncValue.guard(() async {
      final hostStatus = await _bridge.getBootstrapStatus();
      final cachedReleaseState = await _readCachedReleaseState(hostStatus);
      return _compose(
        hostStatus,
        latestRelease: cachedReleaseState?.release,
        releaseStatus: cachedReleaseState?.releaseStatus,
        lastCheckedAt: cachedReleaseState?.lastCheckedAt,
        releaseStatusMessage: cachedReleaseState?.releaseStatusMessage,
        statusMessage: statusMessage ?? current?.statusMessage,
      );
    });
    final resolved = state.valueOrNull;
    if (resolved != null && resolved.phase == "starting_runtime") {
      unawaited(_monitorStartup(resolved.latestRelease));
    }
  }

  Future<void> checkForUpdates({required bool force}) async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    if (!force && !_shouldAutoCheck(current)) {
      return;
    }
    try {
      final latestRelease = await _fetchLatestRelease(current);
      await _writeCachedReleaseState(
        current,
        CachedReleaseState(
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatus: "available",
          releaseStatusMessage: "已找到可安装的 ClawMark 核心版本。",
          release: latestRelease,
        ),
      );
      final hostStatus = await _bridge.getBootstrapStatus();
      state = AsyncData(
        _compose(
          hostStatus,
          latestRelease: latestRelease,
          releaseStatus: "available",
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatusMessage: "已找到可安装的 ClawMark 核心版本。",
          statusMessage: "最新 ClawMark 核心版本：${latestRelease.version}。",
          errorMessage: null,
        ),
      );
    } on NoPublishedClawMarkCoreRelease catch (error) {
      await _writeCachedReleaseState(
        current,
        CachedReleaseState(
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatus: "missing",
          releaseStatusMessage: error.toString(),
          release: null,
        ),
      );
      final hostStatus = await _bridge.getBootstrapStatus();
      state = AsyncData(
        _compose(
          hostStatus,
          latestRelease: null,
          releaseStatus: "missing",
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatusMessage: error.toString(),
          statusMessage: error.toString(),
          errorMessage: null,
        ),
      );
    } on NoCompatibleClawMarkCoreAsset catch (error) {
      await _writeCachedReleaseState(
        current,
        CachedReleaseState(
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatus: "incompatible",
          releaseStatusMessage: error.toString(),
          release: null,
        ),
      );
      final hostStatus = await _bridge.getBootstrapStatus();
      state = AsyncData(
        _compose(
          hostStatus,
          latestRelease: null,
          releaseStatus: "incompatible",
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatusMessage: error.toString(),
          statusMessage: error.toString(),
          errorMessage: null,
        ),
      );
    } catch (error) {
      final hostStatus = await _bridge.getBootstrapStatus();
      state = AsyncData(
        _compose(
          hostStatus,
          latestRelease: current.latestRelease,
          releaseStatus: "error",
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatusMessage: "检查更新失败，请稍后再试。",
          statusMessage: current.statusMessage,
          errorMessage: _describeReleaseFetchError(error),
        ),
      );
    }
  }

  Future<void> downloadCore() async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    File? partialFile;
    File? finalFile;
    ClawMarkCoreRelease? release;
    try {
      state = AsyncData(
        current.copyWith(
          phase: "downloading",
          progress: 0.0,
          errorMessage: null,
          statusMessage: "正在准备下载 ClawMark 核心...",
        ),
      );
      release = current.latestRelease ?? await _fetchLatestRelease(current);
      final downloadsRoot = current.downloadsRoot;
      if (downloadsRoot.isEmpty) {
        throw StateError("桌面宿主没有上报下载目录。");
      }
      final downloadDirectory = Directory(downloadsRoot);
      await downloadDirectory.create(recursive: true);
      final partialPath = path.join(
        downloadDirectory.path,
        "${release.assetName}.part",
      );
      final finalPath = path.join(downloadDirectory.path, release.assetName);
      partialFile = File(partialPath);
      finalFile = File(finalPath);
      if (await partialFile.exists()) {
        await partialFile.delete();
      }

      state = AsyncData(
        state.requireValue.copyWith(
          latestRelease: release,
          phase: "downloading",
          progress: 0.0,
          errorMessage: null,
          statusMessage: "正在下载 ClawMark 核心 ${release.version}...",
        ),
      );
      await _downloadReleaseAsset(
        release,
        partialFile,
        onProgress: (fraction) {
          final latestState = state.valueOrNull;
          if (latestState == null) {
            return;
          }
          state = AsyncData(latestState.copyWith(progress: fraction));
        },
      );
      if (await finalFile.exists()) {
        await finalFile.delete();
      }
      await partialFile.rename(finalFile.path);

      state = AsyncData(
        state.requireValue.copyWith(
          phase: "verifying",
          progress: null,
          statusMessage: "正在校验已下载的 ClawMark 核心包...",
        ),
      );
      final digest = await _sha256OfFile(finalFile);
      if (digest != release.sha256.toLowerCase()) {
        throw StateError(
          "${release.assetName} 的 SHA-256 校验不匹配。期望 ${release.sha256}，实际 $digest。",
        );
      }

      final downloadedRelease = release.copyWith(
        localArchivePath: finalFile.path,
        downloadedAt: DateTime.now().millisecondsSinceEpoch,
      );
      await _writeCachedReleaseState(
        state.requireValue,
        CachedReleaseState(
          lastCheckedAt: DateTime.now().millisecondsSinceEpoch,
          releaseStatus: "available",
          releaseStatusMessage: "已找到可安装的 ClawMark 核心版本。",
          release: downloadedRelease,
        ),
      );

      state = AsyncData(
        state.requireValue.copyWith(
          phase: "installing",
          latestRelease: downloadedRelease,
          statusMessage: "正在把 ClawMark 核心安装到桌面核心槽位...",
        ),
      );
      final installedStatus = await _bridge.installCoreArchive(finalFile.path);

      state = AsyncData(
        _compose(
          installedStatus,
          latestRelease: downloadedRelease,
          phase: "starting_runtime",
          statusMessage: "正在启动刚安装好的 ClawMark 桌面核心...",
        ),
      );
      final readyStatus = await _waitForReady(downloadedRelease);
      state = AsyncData(
        _compose(
          readyStatus,
          latestRelease: downloadedRelease,
          statusMessage:
              "ClawMark 核心 ${downloadedRelease.version} 已安装完成，桌面已就绪。",
          errorMessage: null,
        ),
      );
    } catch (error) {
      if (partialFile != null && await partialFile.exists()) {
        await partialFile.delete();
      }
      await _setBootstrapFailureState(
        baseline: current,
        latestRelease: release,
        statusMessage: "ClawMark 核心下载或安装失败，请查看错误后重试。",
        error: error,
      );
    }
  }

  Future<void> restartRuntime() async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    try {
      state = AsyncData(
        current.copyWith(
          phase: "starting_runtime",
          progress: null,
          errorMessage: null,
          statusMessage: "正在启动本地 ClawMark 桌面核心...",
        ),
      );
      await _bridge.restartRuntime();
      final readyStatus = await _waitForReady(current.latestRelease);
      state = AsyncData(
        _compose(
          readyStatus,
          latestRelease: current.latestRelease,
          statusMessage: "桌面核心已经就绪。",
          errorMessage: null,
        ),
      );
    } catch (error) {
      await _setBootstrapFailureState(
        baseline: current,
        latestRelease: current.latestRelease,
        statusMessage: "桌面核心启动失败，请查看错误后重试。",
        error: error,
      );
    }
  }

  Future<void> openLogs() async {
    final current = state.valueOrNull;
    if (current == null) {
      return;
    }
    try {
      final result = await _bridge.openLogs();
      state = AsyncData(
        current.copyWith(
          statusMessage:
              asBool(result["opened"])
                  ? "已打开日志目录：${asString(result["logRoot"], current.logRoot)}。"
                  : "日志目录可在这里查看：${asString(result["logRoot"], current.logRoot)}。",
          errorMessage: null,
        ),
      );
    } catch (error) {
      await _setBootstrapFailureState(
        baseline: current,
        latestRelease: current.latestRelease,
        statusMessage: "打开日志目录失败。",
        error: error,
      );
    }
  }

  Future<void> _setBootstrapFailureState({
    required DesktopBootstrapViewState baseline,
    required String statusMessage,
    required Object error,
    ClawMarkCoreRelease? latestRelease,
  }) async {
    Map<String, dynamic> hostStatus = baseline.hostStatus;
    try {
      hostStatus = await _bridge.getBootstrapStatus();
    } catch (_) {}
    final resolvedRelease = latestRelease ?? baseline.latestRelease;
    state = AsyncData(
      _compose(
        hostStatus,
        latestRelease: resolvedRelease,
        releaseStatus: baseline.releaseStatus,
        lastCheckedAt: baseline.lastCheckedAt,
        releaseStatusMessage: baseline.releaseStatusMessage,
        phase: _failurePhaseForState(baseline, resolvedRelease),
        statusMessage: statusMessage,
        errorMessage: _describeBootstrapActionError(error),
      ),
    );
  }

  DesktopBootstrapViewState _compose(
    Map<String, dynamic> hostStatus, {
    ClawMarkCoreRelease? latestRelease,
    String? releaseStatus,
    int? lastCheckedAt,
    String? phase,
    String? statusMessage,
    String? releaseStatusMessage,
    String? errorMessage,
  }) {
    final hostState = asString(hostStatus["state"], "failed");
    final coreSection = asMap(hostStatus["core"]);
    final installed =
        asBool(coreSection["installed"]) ||
        asBool(coreSection["bundledAvailable"]);
    final resolvedReleaseStatus =
        releaseStatus ??
        (latestRelease != null
            ? "available"
            : (asInt(coreSection["lastCheckedAt"]) > 0
                ? "checked"
                : "unknown"));
    final resolvedLastCheckedAt =
        lastCheckedAt ?? asInt(coreSection["lastCheckedAt"]);
    final resolvedPhase =
        phase ??
        switch (hostState) {
          "ready" => "ready",
          "starting_runtime" => "starting_runtime",
          "core_missing" =>
            latestRelease != null
                ? "download_available"
                : ((resolvedReleaseStatus == "missing" ||
                        resolvedReleaseStatus == "incompatible")
                    ? "release_missing"
                    : "core_missing"),
          "failed" =>
            (!installed && latestRelease != null)
                ? "download_available"
                : "failed",
          _ =>
            (!installed && latestRelease != null)
                ? "download_available"
                : ((!installed &&
                        (resolvedReleaseStatus == "missing" ||
                            resolvedReleaseStatus == "incompatible"))
                    ? "release_missing"
                    : hostState),
        };
    return DesktopBootstrapViewState(
      hostStatus: hostStatus,
      phase: resolvedPhase,
      latestRelease: latestRelease,
      releaseStatus: resolvedReleaseStatus,
      lastCheckedAt: resolvedLastCheckedAt,
      progress: null,
      statusMessage: statusMessage,
      releaseStatusMessage: releaseStatusMessage,
      errorMessage:
          errorMessage ??
          _nullableString(hostStatus["error"]) ??
          _nullableString(coreSection["lastError"]),
    );
  }

  bool _shouldAutoCheck(DesktopBootstrapViewState state) {
    final lastCheckedAt = state.lastCheckedAt;
    if (lastCheckedAt <= 0) {
      return true;
    }
    final elapsed = DateTime.now().millisecondsSinceEpoch - lastCheckedAt;
    return elapsed >= const Duration(hours: 24).inMilliseconds;
  }

  Future<Map<String, dynamic>> _waitForReady(
    ClawMarkCoreRelease? release,
  ) async {
    Map<String, dynamic> lastStatus = const <String, dynamic>{};
    for (var attempt = 0; attempt < 40; attempt += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      lastStatus = await _bridge.getBootstrapStatus();
      final phase = asString(lastStatus["state"]);
      if (phase == "ready") {
        return lastStatus;
      }
      final current = state.valueOrNull;
      if (current != null) {
        state = AsyncData(
          _compose(
            lastStatus,
            latestRelease: release ?? current.latestRelease,
            phase: phase,
            statusMessage: "正在等待本地运行时就绪...",
          ),
        );
      }
    }
    throw StateError(
      "ClawMark 运行时未能在预期时间内完成启动。最后状态：${asString(lastStatus["state"], "未知")}。",
    );
  }

  Future<CachedReleaseState?> _readCachedReleaseState(
    Map<String, dynamic> hostStatus,
  ) async {
    final releaseStateFile = _releaseStateFile(hostStatus);
    if (releaseStateFile == null || !await releaseStateFile.exists()) {
      return null;
    }
    try {
      final decoded =
          jsonDecode(await releaseStateFile.readAsString())
              as Map<String, dynamic>;
      final lastCheckedAt =
          decoded["lastCheckedAt"] is num
              ? (decoded["lastCheckedAt"] as num).toInt()
              : 0;
      final coreSection = hostStatus["core"];
      if (coreSection is Map && lastCheckedAt > 0) {
        coreSection["lastCheckedAt"] = lastCheckedAt;
      }
      final releaseStatus = asString(decoded["releaseStatus"], "available");
      final releaseStatusMessage = _nullableString(
        decoded["releaseStatusMessage"],
      );
      final releasePayload =
          decoded["release"] is Map
              ? Map<String, dynamic>.from(decoded["release"] as Map)
              : decoded;
      final release =
          (releasePayload["assetName"] != null &&
                  asString(releasePayload["assetName"]).isNotEmpty)
              ? ClawMarkCoreRelease.fromJson(releasePayload)
              : null;
      return CachedReleaseState(
        lastCheckedAt: lastCheckedAt,
        releaseStatus: releaseStatus,
        releaseStatusMessage: releaseStatusMessage,
        release: release,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCachedReleaseState(
    DesktopBootstrapViewState state,
    CachedReleaseState cached,
  ) async {
    final releaseStateFile = _releaseStateFile(state.hostStatus);
    if (releaseStateFile == null) {
      return;
    }
    await releaseStateFile.parent.create(recursive: true);
    final payload = <String, Object?>{
      "lastCheckedAt": cached.lastCheckedAt,
      "releaseStatus": cached.releaseStatus,
      if (cached.releaseStatusMessage != null)
        "releaseStatusMessage": cached.releaseStatusMessage,
      if (cached.release != null) "release": cached.release!.toJson(),
    };
    await releaseStateFile.writeAsString(
      const JsonEncoder.withIndent("  ").convert(payload),
    );
  }

  File? _releaseStateFile(Map<String, dynamic> hostStatus) {
    final downloadsRoot = asString(
      asMap(hostStatus["directories"])["downloadsRoot"],
    );
    if (downloadsRoot.isEmpty) {
      return null;
    }
    return File(path.join(downloadsRoot, _releaseStateFileName));
  }

  Future<ClawMarkCoreRelease> _fetchLatestRelease(
    DesktopBootstrapViewState state,
  ) async {
    final client = HttpClient()..userAgent = "ClawMark/1.0";
    try {
      final request = await client.getUrl(Uri.parse(_githubLatestReleaseUrl));
      request.headers.set(
        HttpHeaders.acceptHeader,
        "application/vnd.github+json",
      );
      final response = await request.close();
      if (response.statusCode == 404) {
        throw const NoPublishedClawMarkCoreRelease();
      }
      if (response.statusCode != 200) {
        throw HttpException(
          "GitHub Releases returned ${response.statusCode}",
          uri: Uri.parse(_githubLatestReleaseUrl),
        );
      }
      final decoded = jsonDecode(await utf8.decoder.bind(response).join());
      final releaseJson = asMap(decoded);
      final version = asString(
        releaseJson["tag_name"],
      ).replaceFirst(RegExp(r"^v"), "");
      final publishedAt = asString(releaseJson["published_at"]);
      final assets = asMapList(releaseJson["assets"]);
      final manifestAsset = _firstWhereOrNull(
        assets,
        (entry) =>
            asString(entry["name"]).toLowerCase() ==
            "clawmark-core-manifest.json",
      );
      if (manifestAsset != null) {
        final manifest = await _fetchReleaseManifest(
          client,
          asString(manifestAsset["browser_download_url"]),
        );
        final resolved = _resolveReleaseFromManifest(
          manifest,
          platform: state.platform,
          arch: state.arch,
        );
        if (resolved != null) {
          return resolved.copyWith(
            localArchivePath: resolved.localArchivePath,
            downloadedAt: resolved.downloadedAt,
          );
        }
        throw NoCompatibleClawMarkCoreAsset(
          platform: state.platform,
          arch: state.arch,
        );
      }

      final expectedAssetName = _expectedAssetName(
        platform: state.platform,
        arch: state.arch,
        version: version,
      );
      final asset = _firstWhereOrNull(
        assets,
        (entry) => asString(entry["name"]) == expectedAssetName,
      );
      if (asset == null) {
        throw NoCompatibleClawMarkCoreAsset(
          platform: state.platform,
          arch: state.arch,
        );
      }
      return ClawMarkCoreRelease(
        version: version,
        platform: state.platform,
        arch: state.arch,
        assetName: asString(asset["name"]),
        archiveFormat: state.platform == "windows" ? "zip" : "tar.gz",
        sha256: asString(asMap(asset["digest"])["sha256"]),
        sizeBytes: asset["size"] is num ? (asset["size"] as num).toInt() : 0,
        downloadUrl: asString(asset["browser_download_url"]),
        publishedAt: publishedAt,
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, dynamic>> _fetchReleaseManifest(
    HttpClient client,
    String url,
  ) async {
    final request = await client.getUrl(Uri.parse(url));
    request.headers.set(HttpHeaders.acceptHeader, "application/json");
    final response = await request.close();
    if (response.statusCode != 200) {
      throw HttpException(
        "Failed to fetch ClawMarkCore manifest (${response.statusCode})",
      );
    }
    final decoded = jsonDecode(await utf8.decoder.bind(response).join());
    return asMap(decoded);
  }

  ClawMarkCoreRelease? _resolveReleaseFromManifest(
    Map<String, dynamic> manifest, {
    required String platform,
    required String arch,
  }) {
    final assets = asMapList(manifest["assets"]);
    final asset = _firstWhereOrNull(assets, (entry) {
      return _normalizePlatform(asString(entry["platform"])) ==
              _normalizePlatform(platform) &&
          _normalizeArch(asString(entry["arch"])) == _normalizeArch(arch);
    });
    if (asset == null) {
      return null;
    }
    return ClawMarkCoreRelease(
      version: asString(asset["version"], asString(manifest["version"])),
      platform: _normalizePlatform(asString(asset["platform"])),
      arch: _normalizeArch(asString(asset["arch"])),
      assetName: asString(asset["assetName"]),
      archiveFormat: asString(asset["archiveFormat"]),
      sha256: asString(asset["sha256"]).toLowerCase(),
      sizeBytes: asInt(asset["sizeBytes"]),
      downloadUrl: asString(asset["downloadUrl"]),
      publishedAt: asString(asset["publishedAt"]),
    );
  }

  Future<void> _downloadReleaseAsset(
    ClawMarkCoreRelease release,
    File destination, {
    required void Function(double? fraction) onProgress,
  }) async {
    final client = HttpClient()..userAgent = "ClawMark/1.0";
    try {
      final request = await client.getUrl(Uri.parse(release.downloadUrl));
      final response = await request.close();
      if (response.statusCode != 200) {
        throw HttpException(
          "Failed to download ${release.assetName} (${response.statusCode})",
          uri: Uri.parse(release.downloadUrl),
        );
      }
      final totalBytes =
          response.contentLength > 0 ? response.contentLength : null;
      var receivedBytes = 0;
      final sink = destination.openWrite();
      try {
        await for (final chunk in response) {
          sink.add(chunk);
          receivedBytes += chunk.length;
          if (totalBytes != null && totalBytes > 0) {
            onProgress(receivedBytes / totalBytes);
          } else {
            onProgress(null);
          }
        }
      } finally {
        await sink.close();
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<String> _sha256OfFile(File file) async {
    final digest = sha256.convert(await file.readAsBytes());
    return digest.toString().toLowerCase();
  }

  Future<void> _monitorStartup(ClawMarkCoreRelease? release) async {
    for (var attempt = 0; attempt < 20; attempt += 1) {
      if (_disposed) {
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
      if (_disposed) {
        return;
      }
      final hostStatus = await _bridge.getBootstrapStatus();
      final phase = asString(hostStatus["state"], "failed");
      final current = state.valueOrNull;
      if (current == null) {
        return;
      }
      state = AsyncData(
        _compose(
          hostStatus,
          latestRelease: release ?? current.latestRelease,
          phase: phase,
          statusMessage:
              phase == "ready" ? "本地运行时已经就绪。" : "正在等待桌面宿主完成本地运行时启动...",
        ),
      );
      if (phase == "ready" || phase != "starting_runtime") {
        return;
      }
    }
  }
}

String _describeReleaseFetchError(Object error) {
  if (error is HttpException) {
    return "检查 GitHub 发布页失败：${error.message}。";
  }
  if (error is SocketException) {
    return "当前网络不可用，无法连接 GitHub 发布页。";
  }
  return error.toString();
}

String _describeBootstrapActionError(Object error) {
  if (error is HttpException) {
    return "网络请求失败：${error.message}。";
  }
  if (error is SocketException) {
    return "网络连接失败，请检查网络后重试。";
  }
  if (error is FileSystemException) {
    return "本地文件操作失败：${error.message}${error.path == null ? "" : " (${error.path})"}。";
  }
  if (error is TimeoutException) {
    return "操作超时，请稍后重试。";
  }
  return error.toString();
}

String _failurePhaseForState(
  DesktopBootstrapViewState baseline,
  ClawMarkCoreRelease? latestRelease,
) {
  if (!baseline.hasInstalledCore) {
    if (latestRelease != null) {
      return "download_available";
    }
    if (baseline.releaseStatus == "missing" ||
        baseline.releaseStatus == "incompatible") {
      return "release_missing";
    }
    return "core_missing";
  }
  return "failed";
}

String _expectedAssetName({
  required String platform,
  required String arch,
  required String version,
}) {
  if (_normalizePlatform(platform) == "windows") {
    return "ClawMarkCore-windows-${_normalizeArch(arch)}-$version.zip";
  }
  return "ClawMarkCore-macos-${_normalizeArch(arch)}-$version.tar.gz";
}

String _normalizePlatform(String value) {
  final normalized = value.trim().toLowerCase();
  if (normalized == "darwin") {
    return "macos";
  }
  return normalized;
}

String _normalizeArch(String value) {
  final normalized = value.trim().toLowerCase();
  if (normalized == "x86_64" || normalized == "amd64") {
    return "x64";
  }
  return normalized;
}

T? _firstWhereOrNull<T>(Iterable<T> values, bool Function(T value) predicate) {
  for (final value in values) {
    if (predicate(value)) {
      return value;
    }
  }
  return null;
}

String? _nullableString(Object? value) {
  final text = asString(value).trim();
  return text.isEmpty ? null : text;
}
