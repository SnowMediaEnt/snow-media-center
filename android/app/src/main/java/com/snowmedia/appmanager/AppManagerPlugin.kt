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
      // Handle different path formats
      val cleanPath = path
        .removePrefix("file://")
        .removePrefix("content://")
      
      Log.d(TAG, "Cleaned path: $cleanPath")
      
      // Try to find the file in multiple locations
      var file = File(cleanPath)
      
      if (!file.exists()) {
        // Try cache directory
        val cacheSubPath = cleanPath.substringAfter("cache/", "")
        if (cacheSubPath.isNotEmpty()) {
          file = File(context.cacheDir, cacheSubPath)
          Log.d(TAG, "Trying cache path: ${file.absolutePath}")
        }
      }
      
      if (!file.exists()) {
        // Try extracting just the filename and looking in cache/apk
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
      
      // Get content URI via FileProvider
      val uri = FileProvider.getUriForFile(
        context,
        context.packageName + ".fileprovider",
        file
      )
      
      Log.d(TAG, "FileProvider URI: $uri")
      
      // Create install intent
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      
      // Start the installer activity
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