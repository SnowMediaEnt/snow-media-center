package com.snowmedia

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.webkit.WebView
import com.getcapacitor.JSObject

/**
 * The page's renderer died under the app (MainActivity.onRenderProcessGone):
 * a small record of it, kept on the box until the page that comes up next
 * hands it to analytics once (AppManager.takeRendererGone, src/lib/
 * rendererGone.ts). On an old box's WebView (an X96's Chrome 66) a renderer
 * that runs out of memory takes the page with it while the native player
 * under it plays on: what the viewer sees is a black screen with sound. This
 * says how often, on which boxes and WebViews, and how short of memory they
 * were. Device facts only: never an address, a line or a name.
 */
internal object RendererGone {
    private const val PREFS = "smc_renderer_gone"
    private const val MIB = 1024L * 1024L

    /** Kept with commit(): the process may not outlive the next moment. Never throws. */
    fun save(ctx: Context, didCrash: Boolean, priority: Int, playerActive: Boolean) {
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val mem = ActivityManager.MemoryInfo()
            (ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(mem)
            prefs.edit()
                .putLong("at", System.currentTimeMillis())
                .putBoolean("didCrash", didCrash)
                .putInt("priority", priority)
                .putBoolean("playerActive", playerActive)
                .putString("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
                .putInt("sdk", Build.VERSION.SDK_INT)
                .putLong("totalMemMb", mem.totalMem / MIB)
                .putLong("availMemMb", mem.availMem / MIB)
                .putBoolean("lowMemory", mem.lowMemory)
                .putString("webView", webViewVersion())
                // Deaths since the last one was reported (a page that dies
                // again before it can report adds up here).
                .putInt("count", prefs.getInt("count", 0) + 1)
                .commit()
        } catch (_: Throwable) { /* telemetry only */ }
    }

    /** The record, once: read and cleared. Null when there is none. */
    fun take(ctx: Context): JSObject? = try {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains("at")) {
            null
        } else {
            val o = JSObject()
                .put("at", prefs.getLong("at", 0L))
                .put("didCrash", prefs.getBoolean("didCrash", false))
                .put("priority", prefs.getInt("priority", -1))
                .put("playerActive", prefs.getBoolean("playerActive", false))
                .put("model", prefs.getString("model", "") ?: "")
                .put("sdk", prefs.getInt("sdk", 0))
                .put("totalMemMb", prefs.getLong("totalMemMb", 0L))
                .put("availMemMb", prefs.getLong("availMemMb", 0L))
                .put("lowMemory", prefs.getBoolean("lowMemory", false))
                .put("webView", prefs.getString("webView", "") ?: "")
                .put("count", prefs.getInt("count", 1))
            prefs.edit().clear().commit()
            o
        }
    } catch (_: Throwable) {
        null
    }

    /** "com.google.android.webview 66.0.3359.158": the WebView the page ran in. */
    private fun webViewVersion(): String = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebView.getCurrentWebViewPackage()?.let { "${it.packageName} ${it.versionName}" } ?: ""
        } else {
            ""
        }
    } catch (_: Throwable) {
        ""
    }
}
