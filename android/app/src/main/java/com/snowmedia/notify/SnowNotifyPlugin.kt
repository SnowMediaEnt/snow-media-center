package com.snowmedia.notify

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Bridge for device alerts — notifications that reach the viewer when SMC is
 * closed or they are in another app.
 *
 * The web side owns the switch and the Supabase credentials; this owns the
 * background poll and the notification itself. See AlertPollWorker for why the
 * poll is a self-chaining one-shot rather than a periodic worker.
 */
/**
 * Top level, NOT inside the class's own companion: an annotation on a class
 * cannot safely resolve a constant declared inside that same class.
 */
private const val ALIAS_POST_NOTIFICATIONS = "postNotifications"

@CapacitorPlugin(
    name = "SnowNotify",
    permissions = [
        Permission(alias = ALIAS_POST_NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class SnowNotifyPlugin : Plugin() {

    /** Whether this build can show notifications at all right now. */
    @PluginMethod
    fun status(call: PluginCall) {
        val store = AlertStore(context)
        call.resolve(
            JSObject()
                .put("enabled", store.enabled)
                .put("permission", permissionLabel())
                .put("channelBlocked", !NotificationManagerCompat.from(context).areNotificationsEnabled()),
        )
    }

    /**
     * Turn alerts on. Takes the Supabase URL and anon key so the background
     * poll reads the same project the app does, without the values being
     * duplicated into Kotlin.
     */
    @PluginMethod
    fun enable(call: PluginCall) {
        val url = call.getString("supabaseUrl")
        val key = call.getString("supabaseKey")
        if (url.isNullOrBlank() || key.isNullOrBlank()) {
            call.reject("supabaseUrl and supabaseKey are required")
            return
        }
        val store = AlertStore(context)
        store.supabaseUrl = url
        store.supabaseKey = key

        if (needsRuntimePermission()) {
            // Ask, then finish in the callback below.
            requestPermissionForAlias(ALIAS_POST_NOTIFICATIONS, call, "permissionResult")
            return
        }
        finishEnable(call)
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        if (needsRuntimePermission()) {
            // Refused. Say so plainly rather than switching on something that
            // will never show anything.
            call.resolve(JSObject().put("enabled", false).put("permission", "denied"))
            return
        }
        finishEnable(call)
    }

    private fun finishEnable(call: PluginCall) {
        val store = AlertStore(context)
        store.enabled = true
        AlertNotifier.ensureChannel(context)
        AlertPollScheduler.start(context)
        call.resolve(JSObject().put("enabled", true).put("permission", permissionLabel()))
    }

    /** Turn alerts off and clear anything already on screen. */
    @PluginMethod
    fun disable(call: PluginCall) {
        val store = AlertStore(context)
        store.enabled = false
        for (id in store.shown) AlertNotifier.cancel(context, id)
        store.clearPosted()
        AlertPollScheduler.stop(context)
        call.resolve(JSObject().put("enabled", false))
    }

    /**
     * Run a poll immediately instead of waiting for the next five-minute tick.
     * Called when SMC comes to the foreground, so the shade is never showing
     * something the app itself already knows is gone.
     */
    @PluginMethod
    fun pollNow(call: PluginCall) {
        if (!AlertStore(context).enabled) {
            call.resolve(JSObject().put("enabled", false))
            return
        }
        AlertPollScheduler.start(context)
        call.resolve(JSObject().put("enabled", true))
    }

    private fun needsRuntimePermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED

    private fun permissionLabel(): String = if (needsRuntimePermission()) "denied" else "granted"
}
