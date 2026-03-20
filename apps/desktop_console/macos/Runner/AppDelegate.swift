import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  override init() {
    super.init()
    DesktopRuntimeHost.shared.startIfAvailable()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleApplicationWillTerminate(_:)),
      name: NSApplication.willTerminateNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleApplicationWillTerminate(_ notification: Notification) {
    DesktopRuntimeHost.shared.stopIfOwned()
  }

  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }
}
