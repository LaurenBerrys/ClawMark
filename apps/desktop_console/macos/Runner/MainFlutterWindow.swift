import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let idealSize = NSSize(width: 1440, height: 920)
    let minimumSize = NSSize(width: 1200, height: 780)
    var windowFrame = self.frame
    windowFrame.size.width = max(windowFrame.size.width, idealSize.width)
    windowFrame.size.height = max(windowFrame.size.height, idealSize.height)
    self.contentViewController = flutterViewController
    self.minSize = minimumSize
    self.setFrame(windowFrame, display: true)
    self.center()

    RegisterGeneratedPlugins(registry: flutterViewController)
    let desktopChannel = FlutterMethodChannel(
      name: "clawmark/desktop",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    )
    desktopChannel.setMethodCallHandler { call, result in
      switch call.method {
      case "getBootstrapStatus":
        result(DesktopRuntimeHost.shared.bootstrapStatus())
      case "restartRuntime":
        result(DesktopRuntimeHost.shared.restartRuntime())
      case "openLogs":
        result(DesktopRuntimeHost.shared.openLogs())
      case "installCoreArchive":
        guard
          let arguments = call.arguments as? [String: Any],
          let archivePath = arguments["archivePath"] as? String
        else {
          result(
            FlutterError(
              code: "invalid-arguments",
              message: "archivePath is required",
              details: nil
            )
          )
          return
        }
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let installed = try DesktopRuntimeHost.shared.installCoreArchive(at: archivePath)
            DispatchQueue.main.async {
              result(installed)
            }
          } catch {
            DispatchQueue.main.async {
              result(
                FlutterError(
                  code: "install-failed",
                  message: error.localizedDescription,
                  details: nil
                )
              )
            }
          }
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    super.awakeFromNib()
  }
}
