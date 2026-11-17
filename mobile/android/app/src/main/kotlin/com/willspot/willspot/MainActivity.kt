package com.willspot.willspot

import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Release builds: balances, account numbers and PIN entry must not leak into
        // screenshots, screen recordings or the recent-apps thumbnail (MASVS-PLATFORM).
        // Debug builds skip it so developers and automated UI checks can take screenshots.
        if (!isDebuggable()) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Device-integrity hints sent with sensitive requests (MASVS-RESILIENCE).
        // They are easy to fake on a hostile device, so the server treats them as
        // signals for risk scoring, never as proof. Play Integrity is the next step.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "willspot/device").setMethodCallHandler { call, result ->
            if (call.method == "signals") {
                result.success(mapOf("rooted" to isRooted(), "emulator" to isEmulator(), "debugger" to Debug.isDebuggerConnected()))
            } else {
                result.notImplemented()
            }
        }
    }

    private fun isDebuggable() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun isRooted(): Boolean {
        if (Build.TAGS?.contains("test-keys") == true) return true
        val paths = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/app/Superuser.apk", "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su")
        return paths.any { File(it).exists() }
    }

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.contains("emulator") ||
            Build.MODEL.contains("Emulator") ||
            Build.MODEL.contains("Android SDK built for") ||
            Build.MODEL.startsWith("sdk_gphone") ||
            Build.HARDWARE.contains("goldfish") ||
            Build.HARDWARE.contains("ranchu") ||
            Build.PRODUCT.contains("sdk")
}
