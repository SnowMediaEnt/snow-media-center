package com.snowmedia.appmanager

import android.content.Intent
import android.content.pm.ApplicationInfo
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

  /**
   * Returns every user-installed app on the device (skips pre-installed system apps).
   * Requires QUERY_ALL_PACKAGES permission for full visibility on Android 11+.
   */
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
          // Skip pre-installed system apps the user didn't add/update themselves.
          if (isSystem && !isUpdatedSystem) continue
          // Skip our own app
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

  /**
   * Lists all .apk files cached in the app's private cache/apk/ folder
   * with their sizes in bytes.
   */
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

  /**
   * Deletes a single cached APK by filename (relative to cache/apk/).
   */
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

  @PluginMethod
  fun installApk(call: PluginCall) {
    val path = call.getString("filePath")
    if (path.isNullOrBlank()) { call.reject("filePath required"); return }

    Log.d(TAG, "installApk called with path: $path")

    try {
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

      val cleanPath = path
        .removePrefix("file://")
        .removePrefix("content://")

      Log.d(TAG, "Cleaned path: $cleanPath")

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
