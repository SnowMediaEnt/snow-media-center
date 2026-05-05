package com.snowmedia.appmanager

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import androidx.core.content.FileProvider
import androidx.activity.result.ActivityResult
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "AppManager")
class AppManagerPlugin : Plugin() {

  private val TAG = "AppManagerPlugin"
  private var pendingUninstallCall: PluginCall? = null
  private var pendingUninstallPackage: String? = null

  @PluginMethod
  fun isInstalled(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val pm = context.packageManager
    val installed = try {
      pm.getPackageInfo(pkg, 0)
      true
    } catch (_: Exception) { false }
    call.resolve(JSObject().put("installed", installed))
  }

  @PluginMethod
  fun getInstalledApps(call: PluginCall) {
    try {
      val pm = context.packageManager
      val packages = pm.getInstalledPackages(0)
      val apps = JSArray()

      for (info in packages) {
        try {
          val appInfo = info.applicationInfo ?: continue
          val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
          val isUpdatedSystem = (appInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
          if (isSystem && !isUpdatedSystem) continue
          if (appInfo.packageName == context.packageName) continue

          val obj = JSObject()
          obj.put("packageName", appInfo.packageName)
          obj.put("appName", pm.getApplicationLabel(appInfo).toString())
          obj.put("versionName", info.versionName ?: "")
          obj.put("versionCode", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
            info.longVersionCode else info.versionCode.toLong())
          obj.put("isLaunchable", pm.getLaunchIntentForPackage(appInfo.packageName) != null)
          apps.put(obj)
        } catch (e: Exception) {
          Log.w(TAG, "Skipping package due to error: ${e.message}")
        }
      }

      Log.d(TAG, "getInstalledApps returning ${apps.length()} apps")
      val result = JSObject()
      result.put("apps", apps)
      call.resolve(result)
    } catch (e: Exception) {
      Log.e(TAG, "getInstalledApps failed", e)
      call.reject("Failed to enumerate installed apps: ${e.message}")
    }
  }

  @PluginMethod
  fun listCachedApks(call: PluginCall) {
    try {
      val apkDir = File(context.cacheDir, "apk")
      val files = JSArray()
      var totalBytes = 0L

      if (apkDir.exists() && apkDir.isDirectory) {
        apkDir.listFiles()?.forEach { f ->
          if (f.isFile && f.name.endsWith(".apk", ignoreCase = true)) {
            val obj = JSObject()
            obj.put("name", f.name)
            obj.put("path", f.absolutePath)
            obj.put("sizeBytes", f.length())
            obj.put("modifiedAt", f.lastModified())
            files.put(obj)
            totalBytes += f.length()
          }
        }
      }

      val result = JSObject()
      result.put("files", files)
      result.put("totalBytes", totalBytes)
      result.put("count", files.length())
      call.resolve(result)
    } catch (e: Exception) {
      Log.e(TAG, "listCachedApks failed", e)
      call.reject("Failed to list cached APKs: ${e.message}")
    }
  }

  @PluginMethod
  fun deleteCachedApk(call: PluginCall) {
    val name = call.getString("name")
    if (name.isNullOrBlank()) { call.reject("name required"); return }
    if (name.contains("/") || name.contains("\\") || name.contains("..")) {
      call.reject("Invalid filename"); return
    }
    try {
      val target = File(File(context.cacheDir, "apk"), name)
      if (!target.exists()) {
        call.resolve(JSObject().put("deleted", false))
        return
      }
      val ok = target.delete()
      call.resolve(JSObject().put("deleted", ok))
    } catch (e: Exception) {
      Log.e(TAG, "deleteCachedApk failed", e)
      call.reject("Failed to delete: ${e.message}")
    }
  }

  /** Clear our own app's cache directory (no permissions needed). */
  @PluginMethod
  fun clearOwnCache(call: PluginCall) {
    try {
      val freed = clearDir(context.cacheDir)
      // Also clear webview cache
      val webCache = File(context.cacheDir, "WebView")
      val webFreed = if (webCache.exists()) clearDir(webCache) else 0L
      val result = JSObject()
      result.put("freedBytes", freed + webFreed)
      call.resolve(result)
    } catch (e: Exception) {
      Log.e(TAG, "clearOwnCache failed", e)
      call.reject("Failed to clear cache: ${e.message}")
    }
  }

  private fun clearDir(dir: File): Long {
    var freed = 0L
    if (!dir.exists() || !dir.isDirectory) return 0
    dir.listFiles()?.forEach { f ->
      freed += if (f.isDirectory) {
        val sub = clearDir(f); f.delete(); sub
      } else {
        val s = f.length(); if (f.delete()) s else 0
      }
    }
    return freed
  }

  @PluginMethod
  fun installApk(call: PluginCall) {
    val path = call.getString("filePath")
    if (path.isNullOrBlank()) { call.reject("filePath required"); return }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val canInstall = context.packageManager.canRequestPackageInstalls()
        if (!canInstall) {
          try {
            val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
              .setData(Uri.parse("package:" + context.packageName))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(settingsIntent)
          } catch (e: Exception) {
            Log.e(TAG, "Could not open install-unknown-apps settings", e)
          }
          call.reject("Install permission not granted. Please enable 'Install unknown apps' for Snow Media Center, then tap Install again.")
          return
        }
      }

      val cleanPath = path.removePrefix("file://").removePrefix("content://")
      var file = File(cleanPath)

      if (!file.exists()) {
        val cacheSubPath = cleanPath.substringAfter("cache/", "")
        if (cacheSubPath.isNotEmpty()) file = File(context.cacheDir, cacheSubPath)
      }
      if (!file.exists()) {
        val filename = cleanPath.substringAfterLast("/")
        file = File(context.cacheDir, "apk/$filename")
      }
      if (!file.exists()) { call.reject("APK file not found"); return }

      val uri = FileProvider.getUriForFile(
        context, context.packageName + ".fileprovider", file
      )

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }

      context.startActivity(intent)
      call.resolve()
    } catch (e: Exception) {
      Log.e(TAG, "Install failed", e)
      call.reject("Failed to start installer: ${e.message}")
    }
  }

  @PluginMethod
  fun launch(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val pm = context.packageManager
    val intent = pm.getLaunchIntentForPackage(pkg)
    if (intent == null) { call.reject("Launch intent not found"); return }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    call.resolve()
  }

  /**
   * Uninstall flow:
   *   1. If the device is rooted AND `su` accepts our command, run
   *      `pm uninstall <pkg>` directly — completely silent, no dialog,
   *      no Accessibility Service. This is what rooted Android TV boxes
   *      and dev builds expect.
   *   2. Otherwise fall back to the existing ACTION_DELETE / ACTION_UNINSTALL_PACKAGE
   *      Intent flow that Firesticks and stock devices use today.
   */
  @PluginMethod
  fun uninstall(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    try {
      // Verify the package actually exists first
      try { context.packageManager.getPackageInfo(pkg, 0) }
      catch (_: Exception) { call.reject("Package not installed: $pkg"); return }

      // ---- 1) Try root path first (silent, no UI) ----
      if (tryRootUninstall(pkg)) {
        val stillInstalled = try {
          context.packageManager.getPackageInfo(pkg, 0); true
        } catch (_: Exception) { false }
        if (!stillInstalled) {
          Log.d(TAG, "Root uninstall succeeded for $pkg")
          call.resolve(
            JSObject()
              .put("started", true)
              .put("uninstalled", true)
              .put("packageName", pkg)
              .put("method", "root")
          )
          return
        }
        Log.d(TAG, "Root uninstall command ran but package still present — falling back to Intent")
      }

      // ---- 2) Fall back to standard Intent flow ----
      pendingUninstallCall = call
      pendingUninstallPackage = pkg
      saveCall(call)

      @Suppress("DEPRECATION")
      val intent = Intent(Intent.ACTION_DELETE).apply {
        data = Uri.parse("package:$pkg")
        putExtra(Intent.EXTRA_RETURN_RESULT, true)
      }
      try {
        startActivityForResult(call, intent, "uninstallResult")
        return
      } catch (_: Exception) { /* fall through to UNINSTALL_PACKAGE */ }

      @Suppress("DEPRECATION")
      val fallback = Intent(Intent.ACTION_UNINSTALL_PACKAGE).apply {
        data = Uri.parse("package:$pkg")
        putExtra(Intent.EXTRA_RETURN_RESULT, true)
      }
      startActivityForResult(call, fallback, "uninstallResult")
    } catch (e: Exception) {
      pendingUninstallCall = null
      pendingUninstallPackage = null
      Log.e(TAG, "uninstall failed", e)
      call.reject("Failed to start uninstaller: ${e.message}")
    }
  }

  @ActivityCallback
  private fun uninstallResult(call: PluginCall, result: ActivityResult?) {
    val pendingCall = pendingUninstallCall ?: call
    val packageName = pendingUninstallPackage
    pendingUninstallCall = null
    pendingUninstallPackage = null

    try {
      if (packageName.isNullOrBlank()) {
        pendingCall.resolve(JSObject().put("started", true).put("uninstalled", false))
        return
      }

      val stillInstalled = try {
        context.packageManager.getPackageInfo(packageName, 0)
        true
      } catch (_: Exception) {
        false
      }

      val response = JSObject()
      response.put("started", true)
      response.put("uninstalled", !stillInstalled)
      response.put("packageName", packageName)

      if (result?.resultCode == Activity.RESULT_CANCELED && stillInstalled) {
        response.put("cancelled", true)
      }

      pendingCall.resolve(response)
    } catch (e: Exception) {
      Log.e(TAG, "uninstall result handling failed", e)
      pendingCall.reject("Uninstall finished, but result could not be verified: ${e.message}")
    }
  }

  @PluginMethod
  fun openAppSettings(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(Uri.parse("package:$pkg"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    call.resolve()
  }

  // ---------- Cache-clear Accessibility Service bridge ----------

  /** Returns true if the user has enabled our CacheClearService in Accessibility settings. */
  @PluginMethod
  fun isAccessibilityEnabled(call: PluginCall) {
    val enabled = isAccessibilityServiceEnabled()
    call.resolve(JSObject().put("enabled", enabled))
  }

  /** Opens the system Accessibility Settings so the user can enable our service. */
  @PluginMethod
  fun openAccessibilitySettings(call: PluginCall) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      call.resolve()
    } catch (e: Exception) {
      call.reject("Could not open Accessibility Settings: ${e.message}")
    }
  }

  /**
   * Triggers the auto-cache-clear flow for one app:
   * 1. Tells the Accessibility Service which package to clear.
   * 2. Opens that app's App Info screen.
   * The service watches for the screen, taps Storage → Clear cache, then back.
   */
  @PluginMethod
  fun clearAppCache(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }

    // ---- 1) Try root path first (silent, no Accessibility Service needed) ----
    if (tryRootClearCache(pkg)) {
      Log.d(TAG, "Root cache clear succeeded for $pkg")
      call.resolve(JSObject().put("method", "root"))
      return
    }

    // ---- 2) Fall back to Accessibility Service flow ----
    if (!isAccessibilityServiceEnabled()) {
      call.reject("ACCESSIBILITY_DISABLED")
      return
    }
    try {
      // Hand the target to the service via static state
      CacheClearService.setTarget(pkg, clearData = false)
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.parse("package:$pkg"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      call.resolve(JSObject().put("method", "accessibility"))
    } catch (e: Exception) {
      call.reject("Failed to start cache clear: ${e.message}")
    }
  }

  private fun isAccessibilityServiceEnabled(): Boolean {
    val expectedId = context.packageName + "/" + CacheClearService::class.java.name
    val enabledServices = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabledServices)
    while (splitter.hasNext()) {
      if (splitter.next().equals(expectedId, ignoreCase = true)) return true
    }
    return false
  }

  // ---------- Root (su) helpers ----------

  /**
   * Runs a single shell command via `su -c`. Returns true only if `su` was
   * available AND the command exited with status 0. Anything else (no su,
   * permission denied, non-zero exit) returns false so callers can fall back
   * to the non-root flow. Capped at 4s so we never hang the UI.
   */
  private fun runAsRoot(cmd: String): Boolean {
    return try {
      val proc = Runtime.getRuntime().exec(arrayOf("su", "-c", cmd))
      // Hard timeout — su prompts on some ROMs and we don't want to block
      val finished = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          proc.waitFor(4, java.util.concurrent.TimeUnit.SECONDS)
        } else {
          val t = Thread { try { proc.waitFor() } catch (_: Exception) {} }
          t.start(); t.join(4000); !t.isAlive
        }
      } catch (_: Exception) { false }
      if (!finished) {
        try { proc.destroy() } catch (_: Exception) {}
        Log.d(TAG, "su timed out for: $cmd")
        return false
      }
      val ok = proc.exitValue() == 0
      Log.d(TAG, "su exit=${proc.exitValue()} for: $cmd")
      ok
    } catch (e: Exception) {
      // No su binary, denied, or any other failure — treat as not rooted
      Log.d(TAG, "su unavailable: ${e.message}")
      false
    }
  }

  private fun tryRootUninstall(pkg: String): Boolean {
    if (pkg.isBlank()) return false
    // pm uninstall works on all rooted Android versions
    return runAsRoot("pm uninstall $pkg") || runAsRoot("cmd package uninstall $pkg")
  }

  private fun tryRootClearCache(pkg: String): Boolean {
    if (pkg.isBlank()) return false
    // `pm trim-caches` only trims when storage is low, so use the per-package
    // cache directories directly. We deliberately do NOT touch /data/data/<pkg>
    // beyond cache/ and code_cache/ — that would wipe user data.
    val cmd = "rm -rf /data/data/$pkg/cache/* /data/data/$pkg/code_cache/* 2>/dev/null; true"
    return runAsRoot(cmd)
  }
}
