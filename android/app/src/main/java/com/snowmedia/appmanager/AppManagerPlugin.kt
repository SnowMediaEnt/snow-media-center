package com.snowmedia.appmanager

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "AppManager")
class AppManagerPlugin : Plugin() {

  private val TAG = "AppManagerPlugin"

  @PluginMethod
  fun isInstalled(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val pm = context.packageManager
    val installed = try { 
      pm.getPackageInfo(pkg, 0)
      Log.d(TAG, "Package $pkg is installed")
      true 
    } catch (_: Exception) { 
      Log.d(TAG, "Package $pkg is NOT installed")
      false 
    }
    call.resolve(JSObject().put("installed", installed))
  }

  @PluginMethod
  fun installApk(call: PluginCall) {
    val path = call.getString("filePath")
    if (path.isNullOrBlank()) { call.reject("filePath required"); return }

    Log.d(TAG, "installApk called with path: $path")

    try {
      // Android 8+ requires the user to grant per-app "Install unknown apps" permission.
      // If we don't have it, send them straight to the system settings screen for our app
      // and reject with a clear message so the UI can prompt them to retry.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val canInstall = context.packageManager.canRequestPackageInstalls()
        Log.d(TAG, "canRequestPackageInstalls = $canInstall")
        if (!canInstall) {
          try {
            val settingsIntent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
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

      // Handle different path formats
      val cleanPath = path
        .removePrefix("file://")
        .removePrefix("content://")

      Log.d(TAG, "Cleaned path: $cleanPath")

      // Try to find the file in multiple locations
      var file = File(cleanPath)

      if (!file.exists()) {
        val cacheSubPath = cleanPath.substringAfter("cache/", "")
        if (cacheSubPath.isNotEmpty()) {
          file = File(context.cacheDir, cacheSubPath)
          Log.d(TAG, "Trying cache path: ${file.absolutePath}")
        }
      }

      if (!file.exists()) {
        val filename = cleanPath.substringAfterLast("/")
        file = File(context.cacheDir, "apk/$filename")
        Log.d(TAG, "Trying apk folder: ${file.absolutePath}")
      }

      if (!file.exists()) {
        Log.e(TAG, "APK file not found. Tried paths: $cleanPath, ${context.cacheDir}/apk/")
        call.reject("APK file not found")
        return
      }

      Log.d(TAG, "Found APK at: ${file.absolutePath}, size: ${file.length()}")

      val uri = FileProvider.getUriForFile(
        context,
        context.packageName + ".fileprovider",
        file
      )

      Log.d(TAG, "FileProvider URI: $uri")

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }

      context.startActivity(intent)
      Log.d(TAG, "Install intent started successfully")
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

  @PluginMethod
  fun uninstall(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    call.resolve()
  }

  @PluginMethod
  fun openAppSettings(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(Uri.parse("package:$pkg"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    call.resolve()
  }
}