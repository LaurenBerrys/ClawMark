import 'package:flutter_test/flutter_test.dart';

import 'package:desktop_console/src/gateway.dart';

void main() {
  test("buildConnectParams matches the current desktop operator handshake", () {
    final params = buildConnectParams(
      token: "  token-123  ",
      password: "  ",
      platform: "macos",
      locale: "en_US",
    );

    expect(params["minProtocol"], 3);
    expect(params["maxProtocol"], 3);
    expect(params.containsKey("nonce"), isFalse);

    final client = params["client"] as Map<String, Object?>;
    expect(client["id"], GatewayDesktopClient.desktopMacClientId);
    expect(client["mode"], GatewayDesktopClient.desktopClientMode);
    expect(client["platform"], "macos");

    final auth = params["auth"] as Map<String, Object?>;
    expect(auth["token"], "token-123");
    expect(auth.containsKey("password"), isFalse);
  });
}
