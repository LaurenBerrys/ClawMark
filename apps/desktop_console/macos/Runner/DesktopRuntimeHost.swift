import Darwin
import Foundation

private struct DesktopConnectionDescriptorPayload: Codable {
  let version: String
  let coreVersion: String
  let transport: String
  let wsUrl: String
  let authToken: String
  let issuedAt: Int64
  let expiresAt: Int64
  let hostPid: Int32
  let runtimePid: Int32
  let instanceRoot: String
  let logRoot: String
}

private struct DesktopCoreManifestPayload: Codable {
  let version: String
  let platform: String?
  let arch: String?
  let assetName: String?
  let archiveFormat: String?
  let generatedAt: Int64?
}

final class DesktopRuntimeHost {
  static let shared = DesktopRuntimeHost()

  private let runtimeRootRelativePath = "DesktopRuntime"
  private let runtimeAppRelativePath = "app"
  private let runtimeBinRelativePath = "bin/node"
  private let runtimeEntrypointRelativePath = "app/openclaw.mjs"
  private let autostartDisableEnv = "CLAWMARK_DESKTOP_DISABLE_LOCAL_RUNTIME_AUTOSTART"
  private let logFileName = "desktop-runtime-host.log"
  private let descriptorFileName = "runtime-descriptor.json"

  private var process: Process?
  private var logHandle: FileHandle?
  private var lastStartError: String?
  private var lastLaunchAttemptAtMs: Int64?
  private var activePort: Int?
  private var activeToken: String?
  private var activeCoreRoot: URL?
  private var activeCoreSource: String = "missing"

  private init() {}

  func startIfAvailable() {
    self.logInfo("attempting desktop runtime start")
    guard ProcessInfo.processInfo.environment[self.autostartDisableEnv] != "1" else {
      self.logInfo("desktop runtime autostart disabled by environment")
      return
    }

    if let existing = self.process {
      if existing.isRunning {
        self.logDebug("desktop runtime already running; skipping duplicate start")
        return
      }
      self.process = nil
    }

    guard let runtimeSelection = self.resolveRuntimeRootForLaunch() else {
      self.activeCoreRoot = nil
      self.activeCoreSource = "missing"
      self.lastStartError = nil
      self.removeDescriptor()
      self.logDebug("no installed or bundled ClawMarkCore payload found")
      return
    }

    let runtimeRoot = runtimeSelection.url
    let nodeURL = runtimeRoot.appendingPathComponent(self.runtimeBinRelativePath)
    let entrypointURL = runtimeRoot.appendingPathComponent(self.runtimeEntrypointRelativePath)
    guard FileManager.default.isExecutableFile(atPath: nodeURL.path) else {
      self.lastStartError = "bundled node runtime is missing or not executable"
      self.logError("node runtime missing at \(nodeURL.path)")
      return
    }
    guard FileManager.default.isReadableFile(atPath: entrypointURL.path) else {
      self.lastStartError = "runtime entrypoint is missing or unreadable"
      self.logError("runtime entrypoint missing at \(entrypointURL.path)")
      return
    }

    guard let port = self.allocateLoopbackPort() else {
      self.lastStartError = "failed to reserve a loopback port"
      self.logError("failed to reserve a loopback port")
      return
    }

    let authToken = self.generateAuthToken()
    let wsUrl = "ws://127.0.0.1:\(port)"
    let descriptorURL = self.descriptorURL()
    let instanceRoot = self.instanceRootURL()
    let logRoot = self.logsRootURL()
    let coreVersion = self.readCoreVersion(from: runtimeRoot) ?? "unknown"

    do {
      try FileManager.default.createDirectory(
        at: self.applicationSupportRootURL(),
        withIntermediateDirectories: true,
        attributes: nil
      )
      try FileManager.default.createDirectory(
        at: self.coreRootURL(),
        withIntermediateDirectories: true,
        attributes: nil
      )
      try FileManager.default.createDirectory(
        at: self.stagedCoreURL(),
        withIntermediateDirectories: true,
        attributes: nil
      )
      try FileManager.default.createDirectory(
        at: self.downloadsRootURL(),
        withIntermediateDirectories: true,
        attributes: nil
      )
      try FileManager.default.createDirectory(
        at: instanceRoot,
        withIntermediateDirectories: true,
        attributes: nil
      )
      try FileManager.default.createDirectory(
        at: logRoot,
        withIntermediateDirectories: true,
        attributes: nil
      )

      let handle = try self.prepareLogHandle()
      let process = Process()
      var environment = ProcessInfo.processInfo.environment
      let runtimeBinRoot = runtimeRoot.appendingPathComponent("bin").path
      let existingPath = environment["PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      environment["PATH"] = existingPath.isEmpty ? runtimeBinRoot : "\(runtimeBinRoot):\(existingPath)"
      environment["CLAWMARK_DESKTOP_RUNTIME_HOST"] = "1"
      environment["CLAWMARK_DESKTOP_WS_URL"] = wsUrl
      environment["CLAWMARK_DESKTOP_AUTH_TOKEN"] = authToken
      environment["CLAWMARK_DESKTOP_CORE_VERSION"] = coreVersion
      environment["CLAWMARK_DESKTOP_CORE_ROOT"] = runtimeRoot.path
      environment["CLAWMARK_DESKTOP_HOST_PID"] = "\(ProcessInfo.processInfo.processIdentifier)"
      environment["CLAWMARK_DESKTOP_RUNTIME_DESCRIPTOR_PATH"] = descriptorURL.path
      environment["OPENCLAW_INSTANCE_ROOT"] = instanceRoot.path
      environment["OPENCLAW_GATEWAY_TOKEN"] = authToken

      process.executableURL = nodeURL
      process.arguments = [
        entrypointURL.path,
        "gateway",
        "run",
        "--port",
        "\(port)",
        "--bind",
        "loopback",
        "--auth",
        "token",
        "--allow-unconfigured",
      ]
      process.currentDirectoryURL = runtimeRoot.appendingPathComponent(self.runtimeAppRelativePath)
      process.environment = environment
      process.standardOutput = handle
      process.standardError = handle
      process.terminationHandler = { [weak self] terminatedProcess in
        DispatchQueue.main.async {
          self?.handleTermination(of: terminatedProcess)
        }
      }

      self.process = process
      self.logHandle = handle
      self.lastLaunchAttemptAtMs = Self.nowMillis()
      self.activePort = port
      self.activeToken = authToken
      self.activeCoreRoot = runtimeRoot
      self.activeCoreSource = runtimeSelection.source
      self.lastStartError = nil
      try process.run()
      try self.writeDescriptor(
        DesktopConnectionDescriptorPayload(
          version: "v1",
          coreVersion: coreVersion,
          transport: "websocket-rpc",
          wsUrl: wsUrl,
          authToken: authToken,
          issuedAt: Self.nowMillis(),
          expiresAt: Self.nowMillis() + 86_400_000,
          hostPid: ProcessInfo.processInfo.processIdentifier,
          runtimePid: process.processIdentifier,
          instanceRoot: instanceRoot.path,
          logRoot: logRoot.path
        )
      )
      self.logInfo(
        "started desktop runtime pid=\(process.processIdentifier) source=\(runtimeSelection.source) port=\(port)"
      )
    } catch {
      self.lastStartError = error.localizedDescription
      self.process = nil
      self.activePort = nil
      self.activeToken = nil
      self.closeLogHandle()
      self.removeDescriptor()
      self.logError("failed to launch desktop runtime: \(error.localizedDescription)")
    }
  }

  func stopIfOwned() {
    guard let process = self.process else {
      self.closeProcessState()
      self.removeDescriptor()
      return
    }
    self.process = nil
    if process.isRunning {
      process.terminate()
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2) {
        if process.isRunning {
          process.interrupt()
        }
      }
    }
    self.closeLogHandle()
    self.removeDescriptor()
    self.logInfo("stopped desktop runtime")
  }

  func restartRuntime() -> [String: Any] {
    self.stopIfOwned()
    self.startIfAvailable()
    return self.bootstrapStatus()
  }

  func installCoreArchive(at archivePath: String) throws -> [String: Any] {
    let archiveURL = URL(fileURLWithPath: archivePath)
    guard FileManager.default.fileExists(atPath: archiveURL.path) else {
      throw NSError(
        domain: "ClawMarkDesktopRuntimeHost",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "archive not found at \(archiveURL.path)"]
      )
    }

    let fileManager = FileManager.default
    let stagedRoot = self.stagedCoreURL()
    let tempRoot = stagedRoot.appendingPathComponent(".install-\(UUID().uuidString)", isDirectory: true)
    let backupRoot = self.coreRootURL().appendingPathComponent("previous", isDirectory: true)
    let currentRoot = self.currentCoreURL()

    try fileManager.createDirectory(at: stagedRoot, withIntermediateDirectories: true, attributes: nil)
    try fileManager.createDirectory(
      at: self.coreRootURL(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    try? fileManager.removeItem(at: tempRoot)
    try fileManager.createDirectory(at: tempRoot, withIntermediateDirectories: true, attributes: nil)

    defer {
      try? fileManager.removeItem(at: tempRoot)
    }

    let extractionResult = try self.runExtractionCommand(archiveURL: archiveURL, destination: tempRoot)
    if extractionResult != 0 {
      throw NSError(
        domain: "ClawMarkDesktopRuntimeHost",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "archive extraction failed with code \(extractionResult)"]
      )
    }

    let extractedRoot = try self.resolveExtractedRuntimeRoot(in: tempRoot)
    let nodeBinary = extractedRoot.appendingPathComponent(self.runtimeBinRelativePath)
    if fileManager.fileExists(atPath: nodeBinary.path) {
      try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodeBinary.path)
    }

    self.stopIfOwned()
    try? fileManager.removeItem(at: backupRoot)
    if fileManager.fileExists(atPath: currentRoot.path) {
      try fileManager.moveItem(at: currentRoot, to: backupRoot)
    }
    do {
      try fileManager.moveItem(at: extractedRoot, to: currentRoot)
      try? fileManager.removeItem(at: backupRoot)
    } catch {
      if fileManager.fileExists(atPath: backupRoot.path) {
        try? fileManager.moveItem(at: backupRoot, to: currentRoot)
      }
      throw error
    }

    self.lastStartError = nil
    self.startIfAvailable()
    return self.bootstrapStatus()
  }

  func openLogs() -> [String: Any] {
    let logRoot = self.logsRootURL()
    try? FileManager.default.createDirectory(
      at: logRoot,
      withIntermediateDirectories: true,
      attributes: nil
    )
    let opened: Bool
    do {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
      process.arguments = [logRoot.path]
      try process.run()
      process.waitUntilExit()
      opened = process.terminationStatus == 0
    } catch {
      opened = false
    }
    return [
      "generatedAt": Self.nowMillis(),
      "logRoot": logRoot.path,
      "opened": opened,
    ]
  }

  func bootstrapStatus() -> [String: Any] {
    let installedRoot = self.resolveInstalledRuntimeRoot()
    let bundledRoot = self.resolveBundledRuntimeRoot()
    let descriptor = self.readDescriptor()
    let runtimeRunning = self.process?.isRunning == true
    let state: String
    if descriptor != nil && runtimeRunning {
      state = "ready"
    } else if runtimeRunning {
      state = "starting_runtime"
    } else if installedRoot == nil && bundledRoot == nil {
      state = "core_missing"
    } else if (self.lastLaunchAttemptAtMs ?? 0) > 0 &&
      Self.nowMillis() - (self.lastLaunchAttemptAtMs ?? 0) < 8_000 {
      state = "starting_runtime"
    } else if self.lastStartError != nil {
      state = "failed"
    } else {
      state = "failed"
    }

    let activeRoot = installedRoot ?? bundledRoot
    let activeSource = installedRoot != nil ? "installed" : (bundledRoot != nil ? "bundled" : "missing")
    let installedVersion = activeRoot.flatMap(self.readCoreVersion)

    return [
      "generatedAt": Self.nowMillis(),
      "state": state,
      "platform": "macos",
      "arch": Self.resolveCurrentArch(),
      "core": [
        "state": state,
        "source": activeSource,
        "installed": installedRoot != nil,
        "bundledAvailable": bundledRoot != nil,
        "currentRoot": self.currentCoreURL().path,
        "stagedRoot": self.stagedCoreURL().path,
        "downloadsRoot": self.downloadsRootURL().path,
        "version": installedVersion ?? "",
        "lastError": self.lastStartError ?? "",
      ],
      "runtime": [
        "running": runtimeRunning,
        "pid": self.process?.processIdentifier ?? 0,
        "source": self.activeCoreSource,
        "coreRoot": self.activeCoreRoot?.path ?? activeRoot?.path ?? "",
        "port": self.activePort ?? 0,
        "logRoot": self.logsRootURL().path,
      ],
      "directories": [
        "appSupportRoot": self.applicationSupportRootURL().path,
        "coreRoot": self.coreRootURL().path,
        "currentRoot": self.currentCoreURL().path,
        "stagedRoot": self.stagedCoreURL().path,
        "downloadsRoot": self.downloadsRootURL().path,
        "descriptorPath": self.descriptorURL().path,
        "instanceRoot": self.instanceRootURL().path,
        "logRoot": self.logsRootURL().path,
      ],
      "connection": self.descriptorDictionary(from: descriptor) ?? NSNull(),
      "warnings": self.lastStartError == nil ? [] : [self.lastStartError!],
    ]
  }

  private func handleTermination(of terminatedProcess: Process) {
    guard self.process === terminatedProcess else { return }
    self.process = nil
    self.closeLogHandle()
    self.removeDescriptor()
    self.lastStartError =
      "desktop runtime exited status=\(terminatedProcess.terminationStatus) reason=\(terminatedProcess.terminationReason.rawValue)"
    self.logWarning(self.lastStartError ?? "desktop runtime exited")
  }

  private func resolveRuntimeRootForLaunch() -> (url: URL, source: String)? {
    if let installed = self.resolveInstalledRuntimeRoot() {
      return (installed, "installed")
    }
    if let bundled = self.resolveBundledRuntimeRoot() {
      return (bundled, "bundled")
    }
    return nil
  }

  private func resolveInstalledRuntimeRoot() -> URL? {
    let root = self.currentCoreURL()
    return FileManager.default.fileExists(atPath: root.path) ? root : nil
  }

  private func resolveBundledRuntimeRoot() -> URL? {
    guard let resources = Bundle.main.resourceURL else { return nil }
    let root = resources.appendingPathComponent(self.runtimeRootRelativePath, isDirectory: true)
    return FileManager.default.fileExists(atPath: root.path) ? root : nil
  }

  private func prepareLogHandle() throws -> FileHandle {
    let logDirectory = self.logsRootURL()
    try FileManager.default.createDirectory(
      at: logDirectory,
      withIntermediateDirectories: true,
      attributes: nil
    )
    let logURL = logDirectory.appendingPathComponent(self.logFileName)
    if !FileManager.default.fileExists(atPath: logURL.path) {
      _ = FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    let handle = try FileHandle(forWritingTo: logURL)
    handle.seekToEndOfFile()
    return handle
  }

  private func applicationSupportRootURL() -> URL {
    let base =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ??
      URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
    return base
      .appendingPathComponent("ClawMark", isDirectory: true)
      .appendingPathComponent("DesktopConsole", isDirectory: true)
  }

  private func coreRootURL() -> URL {
    self.applicationSupportRootURL().appendingPathComponent("core", isDirectory: true)
  }

  private func currentCoreURL() -> URL {
    self.coreRootURL().appendingPathComponent("current", isDirectory: true)
  }

  private func stagedCoreURL() -> URL {
    self.coreRootURL().appendingPathComponent("staged", isDirectory: true)
  }

  private func downloadsRootURL() -> URL {
    self.coreRootURL().appendingPathComponent("downloads", isDirectory: true)
  }

  private func logsRootURL() -> URL {
    self.applicationSupportRootURL().appendingPathComponent("logs", isDirectory: true)
  }

  private func descriptorURL() -> URL {
    self.applicationSupportRootURL().appendingPathComponent(self.descriptorFileName)
  }

  private func instanceRootURL() -> URL {
    self.applicationSupportRootURL().appendingPathComponent("instance", isDirectory: true)
  }

  private func closeLogHandle() {
    self.logHandle?.closeFile()
    self.logHandle = nil
  }

  private func closeProcessState() {
    self.process = nil
    self.activePort = nil
    self.activeToken = nil
    self.activeCoreRoot = nil
    self.activeCoreSource = "missing"
    self.closeLogHandle()
  }

  private func readCoreVersion(from root: URL) -> String? {
    let manifestURL = root.appendingPathComponent("manifest.json")
    if let data = try? Data(contentsOf: manifestURL),
      let manifest = try? JSONDecoder().decode(DesktopCoreManifestPayload.self, from: data),
      !manifest.version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      return manifest.version
    }

    let packageURL = root.appendingPathComponent("app/package.json")
    if
      let data = try? Data(contentsOf: packageURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? String,
      !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      return version
    }
    return nil
  }

  private func writeDescriptor(_ descriptor: DesktopConnectionDescriptorPayload) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(descriptor)
    try FileManager.default.createDirectory(
      at: self.applicationSupportRootURL(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    try data.write(to: self.descriptorURL(), options: .atomic)
  }

  private func readDescriptor() -> DesktopConnectionDescriptorPayload? {
    let descriptorURL = self.descriptorURL()
    guard FileManager.default.fileExists(atPath: descriptorURL.path) else { return nil }
    guard let data = try? Data(contentsOf: descriptorURL) else { return nil }
    return try? JSONDecoder().decode(DesktopConnectionDescriptorPayload.self, from: data)
  }

  private func removeDescriptor() {
    try? FileManager.default.removeItem(at: self.descriptorURL())
  }

  private func descriptorDictionary(from descriptor: DesktopConnectionDescriptorPayload?) -> [String: Any]? {
    guard let descriptor else { return nil }
    return [
      "version": descriptor.version,
      "coreVersion": descriptor.coreVersion,
      "transport": descriptor.transport,
      "wsUrl": descriptor.wsUrl,
      "authToken": descriptor.authToken,
      "issuedAt": descriptor.issuedAt,
      "expiresAt": descriptor.expiresAt,
      "hostPid": Int(descriptor.hostPid),
      "runtimePid": Int(descriptor.runtimePid),
      "instanceRoot": descriptor.instanceRoot,
      "logRoot": descriptor.logRoot,
    ]
  }

  private func allocateLoopbackPort() -> Int? {
    let socketHandle = socket(AF_INET, SOCK_STREAM, 0)
    guard socketHandle >= 0 else { return nil }
    defer { close(socketHandle) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(0).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bindResult == 0 else { return nil }

    var boundAddress = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameResult = withUnsafeMutablePointer(to: &boundAddress) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        getsockname(socketHandle, $0, &length)
      }
    }
    guard nameResult == 0 else { return nil }
    return Int(UInt16(bigEndian: boundAddress.sin_port))
  }

  private func generateAuthToken() -> String {
    let first = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    let second = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    return "\(first)\(second)"
  }

  private func runExtractionCommand(archiveURL: URL, destination: URL) throws -> Int32 {
    let process = Process()
    if archiveURL.pathExtension.lowercased() == "zip" {
      process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
      process.arguments = ["-q", archiveURL.path, "-d", destination.path]
    } else {
      process.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
      process.arguments = ["-xzf", archiveURL.path, "-C", destination.path]
    }
    try process.run()
    process.waitUntilExit()
    return process.terminationStatus
  }

  private func resolveExtractedRuntimeRoot(in tempRoot: URL) throws -> URL {
    let contents = try FileManager.default.contentsOfDirectory(
      at: tempRoot,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    )
    if contents.count == 1 {
      return contents[0]
    }
    return tempRoot
  }

  private func logDebug(_ message: String) {
    NSLog("[ClawMark][DesktopRuntimeHost][DEBUG] %@", message)
    self.appendDiagnosticLine(level: "DEBUG", message: message)
  }

  private func logInfo(_ message: String) {
    NSLog("[ClawMark][DesktopRuntimeHost][INFO] %@", message)
    self.appendDiagnosticLine(level: "INFO", message: message)
  }

  private func logWarning(_ message: String) {
    NSLog("[ClawMark][DesktopRuntimeHost][WARN] %@", message)
    self.appendDiagnosticLine(level: "WARN", message: message)
  }

  private func logError(_ message: String) {
    NSLog("[ClawMark][DesktopRuntimeHost][ERROR] %@", message)
    self.appendDiagnosticLine(level: "ERROR", message: message)
  }

  private func appendDiagnosticLine(level: String, message: String) {
    let logURL = self.logsRootURL().appendingPathComponent(self.logFileName)
    try? FileManager.default.createDirectory(
      at: logURL.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    if !FileManager.default.fileExists(atPath: logURL.path) {
      _ = FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: logURL) else { return }
    defer { handle.closeFile() }
    handle.seekToEndOfFile()
    let line = "[\(level)] \(message)\n"
    if let data = line.data(using: .utf8) {
      handle.write(data)
    }
  }

  private static func nowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
  }

  private static func resolveCurrentArch() -> String {
    #if arch(arm64)
      return "arm64"
    #elseif arch(x86_64)
      return "x64"
    #else
      return "unknown"
    #endif
  }
}
