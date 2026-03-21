import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'desktop_host.dart';

class GatewayRequestError implements Exception {
  GatewayRequestError({
    required this.code,
    required this.message,
    this.details,
  });

  final String code;
  final String message;
  final Object? details;

  @override
  String toString() => "GatewayRequestError($code): $message";
}

class GatewayEventFrame {
  const GatewayEventFrame({
    required this.event,
    required this.payload,
    this.seq,
  });

  factory GatewayEventFrame.fromJson(Map<String, dynamic> json) {
    return GatewayEventFrame(
      event: _asString(json["event"], "unknown"),
      payload: _asMap(json["payload"]),
      seq: json["seq"] is num ? (json["seq"] as num).toInt() : null,
    );
  }

  final String event;
  final Map<String, dynamic> payload;
  final int? seq;
}

class GatewayDesktopClient {
  GatewayDesktopClient({DesktopBridge? bridge})
    : _bridge = bridge ?? const MethodChannelDesktopBridge(),
      _configuredUrl = _resolveRuntimeValue("CLAWMARK_DESKTOP_WS_URL", ""),
      _configuredToken = _resolveRuntimeValue(
        "CLAWMARK_DESKTOP_AUTH_TOKEN",
        "",
      ),
      _configuredPassword = _resolveRuntimeValue(
        "CLAWMARK_DESKTOP_AUTH_PASSWORD",
        "",
      );

  static const String defaultWsUrl = "ws://127.0.0.1:18789";
  static const String desktopClientFallbackId = "gateway-client";
  static const String desktopMacClientId = "openclaw-macos";
  static const String desktopClientMode = "ui";
  static const Duration _startupRetryWindow = Duration(seconds: 8);
  static const Duration _startupRetryBackoff = Duration(milliseconds: 250);
  static const String _compiledWsUrl = String.fromEnvironment(
    "CLAWMARK_DESKTOP_WS_URL",
  );
  static const String _compiledAuthToken = String.fromEnvironment(
    "CLAWMARK_DESKTOP_AUTH_TOKEN",
  );
  static const String _compiledAuthPassword = String.fromEnvironment(
    "CLAWMARK_DESKTOP_AUTH_PASSWORD",
  );

  final DesktopBridge _bridge;
  final String _configuredUrl;
  final String _configuredToken;
  final String _configuredPassword;
  final StreamController<GatewayEventFrame> _events =
      StreamController<GatewayEventFrame>.broadcast();
  final Map<String, Completer<dynamic>> _pending =
      <String, Completer<dynamic>>{};

  String _sessionUrl = "";
  String _sessionToken = "";
  String _sessionPassword = "";
  WebSocket? _socket;
  Completer<void>? _ready;
  Timer? _connectTimer;
  bool _connectSent = false;
  bool _disposed = false;
  int _requestCounter = 0;

  static String _resolveRuntimeValue(String key, String fallback) {
    final compiled =
        switch (key) {
          "CLAWMARK_DESKTOP_WS_URL" => _compiledWsUrl,
          "CLAWMARK_DESKTOP_AUTH_TOKEN" => _compiledAuthToken,
          "CLAWMARK_DESKTOP_AUTH_PASSWORD" => _compiledAuthPassword,
          _ => "",
        }.trim();
    if (compiled.isNotEmpty) {
      return compiled;
    }
    final runtime = Platform.environment[key]?.trim();
    if (runtime != null && runtime.isNotEmpty) {
      return runtime;
    }
    return fallback;
  }

  Stream<GatewayEventFrame> get events => _events.stream;

  String get url => _sessionUrl.isNotEmpty ? _sessionUrl : _configuredUrl;

  Future<void> _resolveSessionConnection() async {
    if (_configuredUrl.isNotEmpty) {
      _sessionUrl = _configuredUrl;
      _sessionToken = _configuredToken;
      _sessionPassword = _configuredPassword;
      return;
    }
    final status = await _bridge.getBootstrapStatus();
    final phase = _asString(status["state"], "failed");
    final connection = _asMap(status["connection"]);
    final wsUrl = _asString(connection["wsUrl"]);
    if (phase != "ready" || wsUrl.isEmpty) {
      throw DesktopBootstrapRequired(status);
    }
    _sessionUrl = wsUrl;
    _sessionToken =
        _configuredToken.isNotEmpty
            ? _configuredToken
            : _asString(connection["authToken"]);
    _sessionPassword = _configuredPassword;
  }

  Future<void> _refreshSessionConnectionFromBridge() async {
    if (_configuredUrl.isNotEmpty) {
      return;
    }
    try {
      await _resolveSessionConnection();
    } on DesktopBootstrapRequired {
      _sessionUrl = "";
      _sessionToken = "";
      _sessionPassword = "";
    }
  }

  Future<WebSocket> _connectSocketWithRetry() async {
    final retryUntil = DateTime.now().add(_startupRetryWindow);
    while (true) {
      try {
        return await WebSocket.connect(url);
      } on SocketException {
        await _refreshSessionConnectionFromBridge();
        if (url.isEmpty && DateTime.now().isBefore(retryUntil)) {
          await Future<void>.delayed(_startupRetryBackoff);
          continue;
        }
        if (!_shouldRetryInitialConnect() ||
            DateTime.now().isAfter(retryUntil)) {
          rethrow;
        }
        if (_disposed) {
          throw StateError("gateway client disposed");
        }
        await Future<void>.delayed(_startupRetryBackoff);
      }
    }
  }

  bool _shouldRetryInitialConnect() {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != "ws") {
      return false;
    }
    final host = uri.host.trim().toLowerCase();
    return host == "127.0.0.1" || host == "localhost" || host == "::1";
  }

  Future<void> connect() async {
    if (_disposed) {
      throw StateError("gateway client already disposed");
    }
    if (_socket != null && _ready?.isCompleted == true) {
      return;
    }
    final inFlight = _ready;
    if (inFlight != null) {
      return inFlight.future;
    }
    final ready = Completer<void>();
    _ready = ready;
    try {
      await _resolveSessionConnection();
      final socket = await _connectSocketWithRetry();
      _socket = socket;
      socket.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDone,
        cancelOnError: false,
      );
      _queueConnect();
      return ready.future;
    } catch (error) {
      if (!ready.isCompleted) {
        ready.completeError(error);
      }
      _ready = null;
      rethrow;
    }
  }

  Future<dynamic> request(String method, [Object? params]) async {
    await connect();
    return _sendRequest(method, params);
  }

  Future<Map<String, dynamic>> requestMap(
    String method, [
    Object? params,
  ]) async {
    return _asMap(await request(method, params));
  }

  void dispose() {
    _disposed = true;
    _connectTimer?.cancel();
    final socket = _socket;
    _socket = null;
    socket?.close();
    _rejectPending(StateError("gateway client disposed"));
    if (!_events.isClosed) {
      _events.close();
    }
  }

  void _queueConnect() {
    _connectSent = false;
    _connectTimer?.cancel();
    _connectTimer = Timer(const Duration(milliseconds: 700), () {
      unawaited(_sendConnect());
    });
  }

  Future<void> _sendConnect() async {
    if (_connectSent || _socket == null) {
      return;
    }
    _connectSent = true;
    try {
      await _sendRequest(
        "connect",
        buildConnectParams(
          token: _sessionToken,
          password: _sessionPassword,
          platform: Platform.operatingSystem,
          locale: Platform.localeName,
        ),
        waitForReady: false,
      );
      final ready = _ready;
      if (ready != null && !ready.isCompleted) {
        ready.complete();
      }
    } catch (error) {
      final ready = _ready;
      if (ready != null && !ready.isCompleted) {
        ready.completeError(error);
      }
      rethrow;
    }
  }

  Future<dynamic> _sendRequest(
    String method,
    Object? params, {
    bool waitForReady = true,
  }) async {
    if (waitForReady) {
      final ready = _ready;
      if (ready != null) {
        await ready.future;
      }
    }
    final socket = _socket;
    if (socket == null) {
      throw StateError("gateway socket is not connected");
    }
    final id = _nextRequestId();
    final completer = Completer<dynamic>();
    _pending[id] = completer;
    socket.add(
      jsonEncode(<String, Object?>{
        "type": "req",
        "id": id,
        "method": method,
        "params": params,
      }),
    );
    return completer.future.timeout(
      const Duration(seconds: 20),
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException(
          "gateway request timed out while calling $method",
        );
      },
    );
  }

  String _nextRequestId() {
    _requestCounter += 1;
    return "${DateTime.now().microsecondsSinceEpoch}-${_requestCounter.toString().padLeft(4, "0")}";
  }

  void _handleMessage(dynamic rawFrame) {
    final raw =
        rawFrame is String ? rawFrame : utf8.decode(rawFrame as List<int>);
    final decoded = jsonDecode(raw);
    final frame = _asMap(decoded);
    final type = _asString(frame["type"]);
    if (type == "event") {
      final event = GatewayEventFrame.fromJson(frame);
      if (event.event == "connect.challenge") {
        unawaited(_sendConnect());
        return;
      }
      _events.add(event);
      return;
    }
    if (type != "res") {
      return;
    }
    final id = _asString(frame["id"]);
    final completer = _pending.remove(id);
    if (completer == null) {
      return;
    }
    final ok = frame["ok"] == true;
    if (ok) {
      completer.complete(frame["payload"]);
      return;
    }
    final error = _asMap(frame["error"]);
    completer.completeError(
      GatewayRequestError(
        code: _asString(error["code"], "UNAVAILABLE"),
        message: _asString(error["message"], "gateway request failed"),
        details: error["details"],
      ),
    );
  }

  void _handleDone() {
    _connectTimer?.cancel();
    _connectTimer = null;
    _connectSent = false;
    _socket = null;
    _sessionUrl = "";
    _sessionToken = "";
    _sessionPassword = "";
    final error = StateError("gateway connection closed");
    _rejectPending(error);
    final ready = _ready;
    if (ready != null && !ready.isCompleted) {
      ready.completeError(error);
    }
    _ready = null;
  }

  void _handleError(Object error) {
    final ready = _ready;
    if (ready != null && !ready.isCompleted) {
      ready.completeError(error);
    }
  }

  void _rejectPending(Object error) {
    final pending = Map<String, Completer<dynamic>>.from(_pending);
    _pending.clear();
    for (final completer in pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(error);
      }
    }
  }
}

Map<String, Object?> buildConnectParams({
  required String token,
  required String password,
  required String platform,
  required String locale,
}) {
  final trimmedToken = token.trim();
  final trimmedPassword = password.trim();
  final normalizedPlatform = platform.trim().toLowerCase();
  final clientId =
      normalizedPlatform == "macos"
          ? GatewayDesktopClient.desktopMacClientId
          : GatewayDesktopClient.desktopClientFallbackId;
  return <String, Object?>{
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": <String, Object?>{
      "id": clientId,
      "version": "clawmark-desktop-v1",
      "platform": platform,
      "mode": GatewayDesktopClient.desktopClientMode,
    },
    "role": "operator",
    "scopes": const <String>[
      "operator.read",
      "operator.write",
      "operator.admin",
      "operator.approvals",
      "operator.pairing",
    ],
    "caps": const <String>["tool-events"],
    if (trimmedToken.isNotEmpty || trimmedPassword.isNotEmpty)
      "auth": <String, Object?>{
        if (trimmedToken.isNotEmpty) "token": trimmedToken,
        if (trimmedPassword.isNotEmpty) "password": trimmedPassword,
      },
    "locale": locale,
    "userAgent": "ClawMark",
  };
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is! Map) {
    return const <String, dynamic>{};
  }
  final output = <String, dynamic>{};
  for (final entry in value.entries) {
    output[entry.key.toString()] = entry.value;
  }
  return output;
}

String _asString(Object? value, [String fallback = ""]) {
  if (value == null) {
    return fallback;
  }
  if (value is String) {
    return value;
  }
  return value.toString();
}
