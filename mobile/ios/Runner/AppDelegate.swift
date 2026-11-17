import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Device-integrity hints for risk scoring (MASVS-RESILIENCE). Easy to fake on a
    // hostile device, so the server treats them as signals, never as proof.
    // App Attest is the stronger next step.
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "WillSpotDevice") {
      let channel = FlutterMethodChannel(name: "willspot/device", binaryMessenger: registrar.messenger())
      channel.setMethodCallHandler { call, result in
        guard call.method == "signals" else { return result(FlutterMethodNotImplemented) }
        result(["rooted": AppDelegate.isJailbroken(), "emulator": AppDelegate.isSimulator(), "debugger": AppDelegate.isDebuggerAttached()])
      }
    }
  }

  static func isSimulator() -> Bool {
    #if targetEnvironment(simulator)
      return true
    #else
      return false
    #endif
  }

  static func isJailbroken() -> Bool {
    if isSimulator() { return false }
    let paths = ["/Applications/Cydia.app", "/Library/MobileSubstrate/MobileSubstrate.dylib", "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/"]
    if paths.contains(where: { FileManager.default.fileExists(atPath: $0) }) { return true }
    // A sandboxed app must not be able to write outside its container.
    let probe = "/private/willspot_jb_probe.txt"
    if (try? "x".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
      try? FileManager.default.removeItem(atPath: probe)
      return true
    }
    return false
  }

  static func isDebuggerAttached() -> Bool {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    let ok = sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0)
    return ok == 0 && (info.kp_proc.p_flag & P_TRACED) != 0
  }
}
