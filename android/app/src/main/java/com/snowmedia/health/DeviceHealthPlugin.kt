package com.snowmedia.health

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Device Health's native side (src/capacitor/DeviceHealth.ts):
 *   * getDeviceVitals(): memory, storage, Wi-Fi / wired, uptimes, model, sdk.
 *     Cheap reads only (no PSS); works on Fire OS 7 (API 28).
 *   * takeLastExits(): how the last run(s) ended (HealthStore), once.
 * Numbers and device facts only: never an SSID, an address or a name.
 */
@CapacitorPlugin(name = "DeviceHealth")
class DeviceHealthPlugin : Plugin() {

    @PluginMethod
    fun getDeviceVitals(call: PluginCall) {
        call.resolve(vitals(context))
    }

    @PluginMethod
    fun takeLastExits(call: PluginCall) {
        val arr = HealthStore.takePending(context)
        val out = JSArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.put(JSObject.fromJSONObject(o))
        }
        call.resolve(JSObject().put("exits", out))
    }

    companion object {
        private const val MIB = 1024L * 1024L

        fun vitals(ctx: Context): JSObject {
            val o = JSObject()
            o.put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
            o.put("sdk", Build.VERSION.SDK_INT)
            try {
                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                val mem = ActivityManager.MemoryInfo()
                am.getMemoryInfo(mem)
                o.put("memAvailMb", mem.availMem / MIB)
                o.put("memTotalMb", mem.totalMem / MIB)
                o.put("lowMemory", mem.lowMemory)
                o.put("lowRamDevice", am.isLowRamDevice)
            } catch (_: Throwable) { /* left out */ }
            try {
                val stat = StatFs(Environment.getDataDirectory().path)
                o.put("storageFreeMb", stat.availableBlocksLong * stat.blockSizeLong / MIB)
            } catch (_: Throwable) { /* left out */ }
            var wired = false
            var onWifi = false
            var online = false
            try {
                val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
                if (caps != null) {
                    online = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    wired = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    onWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                }
                o.put("wired", wired)
                o.put("online", online)
            } catch (_: Throwable) { /* no permission or no service: left out */ }
            if (onWifi) {
                try {
                    val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    @Suppress("DEPRECATION")
                    val info = wm.connectionInfo
                    if (info != null) {
                        val rssi = info.rssi
                        if (rssi in -126..0) o.put("wifiRssi", rssi)
                        if (info.linkSpeed > 0) o.put("wifiLinkMbps", info.linkSpeed)
                        if (info.frequency > 0) o.put("wifiFreqMhz", info.frequency)
                    }
                } catch (_: Throwable) { /* left out */ }
            }
            o.put("uptimeSec", SystemClock.elapsedRealtime() / 1000L)
            try {
                o.put("appUptimeSec", (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()) / 1000L)
            } catch (_: Throwable) { /* left out */ }
            return o
        }
    }
}
