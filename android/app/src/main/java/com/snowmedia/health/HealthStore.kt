package com.snowmedia.health

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Device Health (src/lib/deviceHealth.ts): how the last run of the app ended,
 * kept on the box until the next page takes it (DeviceHealthPlugin.takeLastExits).
 *
 *   * The on-screen marker: set when the activity is started, cleared when it
 *     stops (Home, another app, the box going to sleep, Back out of the app).
 *     A new process that finds it still set knows the last one died while it
 *     was on screen: the viewer saw SMC stop. Dying in the background is how
 *     Android frees memory and is not reported (unless Android says crash/ANR).
 *   * The box's boot time goes with the marker: a different one now means the
 *     box itself restarted (power cut, reboot) while SMC was on screen.
 *   * API >= 30: ApplicationExitInfo says why (low memory, ANR, crash, ...).
 *   * Older Fire OS (API 28): the marker, plus our own uncaught-exception
 *     handler, which writes the exception's class and top 5 frames (never its
 *     message: it may hold an address) to a small file before the app dies.
 *   * The page's renderer gone (MainActivity.onRenderProcessGone).
 *
 * Device facts and code locations only: never an address, a line or a name.
 * Never throws.
 */
object HealthStore {
    private const val TAG = "SMC-Health"
    private const val PREFS = "smc_device_health"
    private const val CRASH_FILE = "health_crash.txt"
    private const val MAX_PENDING = 5
    private const val MIB = 1024L * 1024L

    @Volatile private var started = false
    @Volatile private var handlerInstalled = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Wall-clock time the box booted, to the second or so. */
    private fun bootWallMs(): Long = System.currentTimeMillis() - SystemClock.elapsedRealtime()

    /**
     * Once per process, before the activity's first onStart: read how the last
     * run ended into the pending list, and install the crash handler.
     */
    fun onProcessStart(ctx: Context) {
        if (started) return
        started = true
        try {
            val app = ctx.applicationContext
            val p = prefs(app)
            val wasOnScreen = p.getBoolean("fg", false)
            val lastPid = p.getInt("pid", 0)
            val lastBoot = p.getLong("boot", 0L)
            val fgSince = p.getLong("fgSince", 0L)
            val dirty = wasOnScreen && lastPid != Process.myPid()
            val rebooted = dirty && lastBoot > 0 && Math.abs(bootWallMs() - lastBoot) > 120_000L

            val crashFile = File(app.filesDir, CRASH_FILE)
            val crashText = try { if (crashFile.exists()) crashFile.readText().take(1200) else null } catch (_: Throwable) { null }
            try { crashFile.delete() } catch (_: Throwable) { /* ignore */ }

            var record: JSONObject? = null
            val exit = latestExit(app, p.getLong("lastExitTs", 0L))
            if (exit != null) p.edit().putLong("lastExitTs", exit.optLong("at", 0L)).apply()
            val exitReason = exit?.optString("exitReason", "") ?: ""
            val exitForeground = exit?.optBoolean("foreground", false) ?: false

            if (crashText != null || exitReason == "crash" || exitReason == "crash_native") {
                record = JSONObject()
                    .put("kind", "crash")
                    .put("exitReason", if (exitReason.isNotEmpty()) exitReason else "crash")
                    .put("stack", crashText ?: "")
                    .put("at", exit?.optLong("at", 0L) ?: p.getLong("crashAt", 0L))
            } else if (exit != null && exitReason in setOf("anr", "low_memory", "excessive_resource_usage")
                && (dirty || exitForeground)) {
                record = JSONObject().put("kind", "killed").put("exitReason", exitReason).put("at", exit.optLong("at", 0L))
            } else if (dirty) {
                val skip = exitReason in setOf("user_requested", "user_stopped", "exit_self", "package_updated",
                    "package_state_change", "permission_change", "dependency_died")
                if (!skip) {
                    val reason = when {
                        rebooted -> "box_restarted"
                        exitReason.isNotEmpty() -> exitReason
                        else -> "unknown"
                    }
                    record = JSONObject().put("kind", "killed").put("exitReason", reason)
                        .put("at", exit?.optLong("at", 0L) ?: 0L)
                }
            }
            if (record != null) {
                if (fgSince > 0) record.put("onScreenSec", ((p.getLong("lastBeat", fgSince) - fgSince) / 1000L).coerceAtLeast(0L))
                exit?.let { e ->
                    if (e.has("pssMb")) record.put("pssMb", e.optLong("pssMb"))
                    if (e.has("status")) record.put("exitStatus", e.optInt("status"))
                }
                addPending(app, record)
            }
            p.edit().putBoolean("fg", false).putInt("pid", Process.myPid()).apply()
        } catch (t: Throwable) {
            Log.w(TAG, "Last exit not read", t)
        }
        installCrashHandler(ctx.applicationContext)
    }

    /** The newest exit of this package after `afterTs` (API >= 30), as a small record. */
    private fun latestExit(ctx: Context, afterTs: Long): JSONObject? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
            val list = am.getHistoricalProcessExitReasons(ctx.packageName, 0, 5)
            val e = list.filter { it.timestamp > afterTs && it.pid != Process.myPid() }.maxByOrNull { it.timestamp } ?: return null
            JSONObject()
                .put("at", e.timestamp)
                .put("exitReason", reasonName(e.reason))
                .put("foreground", e.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE)
                .put("pssMb", e.pss / 1024L)
                .put("status", e.status)
        } catch (_: Throwable) {
            null
        }
    }

    private fun reasonName(r: Int): String = when (r) {
        ApplicationExitInfo.REASON_EXIT_SELF -> "exit_self"
        ApplicationExitInfo.REASON_SIGNALED -> "signaled"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
        ApplicationExitInfo.REASON_CRASH -> "crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash_native"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission_change"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource_usage"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
        ApplicationExitInfo.REASON_USER_STOPPED -> "user_stopped"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
        ApplicationExitInfo.REASON_OTHER -> "other"
        // Newer reasons (freezer, package state/updated) by number: compiled against 35.
        14 -> "freezer"
        15 -> "package_state_change"
        16 -> "package_updated"
        else -> "unknown"
    }

    /** The activity came on screen (onStart) / left it (onStop). */
    fun setOnScreen(ctx: Context, on: Boolean) {
        try {
            val now = System.currentTimeMillis()
            val e = prefs(ctx).edit().putBoolean("fg", on).putInt("pid", Process.myPid()).putLong("boot", bootWallMs()).putLong("lastBeat", now)
            if (on) e.putLong("fgSince", now)
            // commit() on the way off screen: the process may be gone the next moment.
            if (on) e.apply() else e.commit()
        } catch (_: Throwable) { /* telemetry only */ }
    }

    /** The page's renderer died (MainActivity): kept for the next page. */
    fun noteRendererGone(ctx: Context, didCrash: Boolean, playerActive: Boolean) {
        try {
            val mem = ActivityManager.MemoryInfo()
            (ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(mem)
            addPending(ctx, JSONObject()
                .put("kind", "crash")
                .put("exitReason", if (didCrash) "renderer_crashed" else "renderer_killed")
                .put("at", System.currentTimeMillis())
                .put("playerActive", playerActive)
                .put("memAvailMb", mem.availMem / MIB)
                .put("memTotalMb", mem.totalMem / MIB)
                .put("lowMemory", mem.lowMemory))
        } catch (_: Throwable) { /* telemetry only */ }
    }

    @Synchronized
    private fun addPending(ctx: Context, rec: JSONObject) {
        val p = prefs(ctx)
        val arr = try { JSONArray(p.getString("pending", "[]")) } catch (_: Throwable) { JSONArray() }
        arr.put(rec)
        val out = JSONArray()
        val from = (arr.length() - MAX_PENDING).coerceAtLeast(0)
        for (i in from until arr.length()) out.put(arr.get(i))
        p.edit().putString("pending", out.toString()).commit()
    }

    /** The exits waiting, once: read and cleared. */
    @Synchronized
    fun takePending(ctx: Context): JSONArray {
        return try {
            val p = prefs(ctx)
            val arr = JSONArray(p.getString("pending", "[]"))
            p.edit().remove("pending").apply()
            arr
        } catch (_: Throwable) {
            JSONArray()
        }
    }

    private fun installCrashHandler(app: Context) {
        if (handlerInstalled) return
        handlerInstalled = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                File(app.filesDir, CRASH_FILE).writeText(stackSummary(error))
                prefs(app).edit().putLong("crashAt", System.currentTimeMillis()).commit()
            } catch (_: Throwable) { /* dying anyway */ }
            previous?.uncaughtException(thread, error)
        }
    }

    /** "java.lang.IllegalStateException\n at a.b.C.d(C.kt:12)" ×5, root cause's class added. No messages. */
    fun stackSummary(error: Throwable): String {
        val sb = StringBuilder(error.javaClass.name)
        error.stackTrace.take(5).forEach { f -> sb.append("\n at ").append(f.className).append('.').append(f.methodName).append('(').append(f.fileName ?: "?").append(':').append(f.lineNumber).append(')') }
        var root: Throwable = error
        var guard = 0
        while (root.cause != null && root.cause !== root && guard < 10) { root = root.cause!!; guard += 1 }
        if (root !== error) sb.append("\ncaused by ").append(root.javaClass.name)
        return sb.toString().take(1200)
    }
}
