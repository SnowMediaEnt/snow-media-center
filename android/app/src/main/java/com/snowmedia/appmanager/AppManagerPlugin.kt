package com.snowmedia.appmanager

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "AppManager")
class AppManagerPlugin : Plugin() {

  @PluginMethod
  fun isInstalled(call: PluginCall) {
    val pkg = call.getString("packageName")
    if (pkg.isNullOrBlank()) { call.reject("packageName required"); return }
    val pm = context.packageManager
    val installed = try { pm.getPackageInfo(pkg, 0); true } catch (_: Exception) { false }
    call.resolve(JSObject().put("installed", installed))
  }

  @PluginMethod
  fun installApk(call: PluginCall) {
    val path = call.getString("filePath")
    if (path.isNullOrBlank()) { call.reject("filePath required"); return }
    
    // Handle different path formats (file:// URI or raw path)
    val cleanPath = path
      .removePrefix("file://")
      .removePrefix("content://")
    
    val file = File(cleanPath)
    if (!file.exists()) { 
      // Try the cache directory path
      val cacheFile = File(context.cacheDir, cleanPath.substringAfter("cache/"))
      if (!cacheFile.exists()) {
        call.reject("APK file not found at $cleanPath or ${cacheFile.absolutePath}"); 
        return 
      }
      // Use the cache file instead
      val uri = FileProvider.getUriForFile(
        context,
        context.packageName + ".fileprovider",
        cacheFile
      )
      startInstallIntent(uri, call)
      return
    }

    val uri = FileProvider.getUriForFile(
      context,
      context.packageName + ".fileprovider",
      file
    )
    startInstallIntent(uri, call)
  }
  
  private fun startInstallIntent(uri: Uri, call: PluginCall) {
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try { context.startActivity(intent); call.resolve() }
    catch (e: Exception) { call.reject("Failed to start installer: ${e.message}") }
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