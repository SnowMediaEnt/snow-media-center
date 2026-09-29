package com.snowmedia.notify

import android.Manifest
import android.appwidget.AppWidgetManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
import com.snowmedia.AppLocale
import com.snowmedia.dvr.RecordingService
import com.snowmedia.widget.SmcNewsWidget

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

    /** Loads with the app, before any other native text is needed: AppLocale learns the app's Context here. */
    override fun load() {
        AppLocale.attach(context)
    }

    /**
     * The language picked in SMC ("en", "es", "fr", "de" or "ar"), saved for all native text (see
     * AppLocale). The web side calls this at start and on every change. The channels are created
     * again so their names change too, and the news widget is redrawn.
     */
    @PluginMethod
    fun setLanguage(call: PluginCall) {
        val lang = call.getString("lang")
        if (lang == null || !AppLocale.setLanguage(context, lang)) {
            call.reject("lang must be one of ${AppLocale.SUPPORTED.joinToString(", ")}")
            return
        }
        try {
            // Only channels that already exist are renamed; none is created just for this.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (mgr.getNotificationChannel(AlertNotifier.CHANNEL_ID) != null) AlertNotifier.ensureChannel(context)
                if (mgr.getNotificationChannel(RecordingService.CHANNEL_ID) != null) RecordingService.ensureChannel(context)
            }
            val ids = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, SmcNewsWidget::class.java))
            if (ids.isNotEmpty()) {
                context.sendBroadcast(
                    Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                        .setClass(context, SmcNewsWidget::class.java)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
                )
            }
        } catch (_: Throwable) { /* the language is saved; names and widget catch up next time */ }
        call.resolve(JSObject().put("lang", lang))
    }

    /** Whether this build can show notifications at all right now. */
    @PluginMethod
    fun status(call: PluginCall) {
        val store = AlertStore(context)
        call.resolve(
            JSObject()
                .put("enabled", store.enabled)
                .put("configured", store.configured)
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
        // Set BEFORE the permission prompt, not after. If the viewer refuses,
        // this is what stops the app auto-enabling — and re-prompting — on
        // every single launch from then on.
        store.configured = true

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
            // Refused. Record it, so nothing claims to be on that can never
            // show anything, and so the poll does not run for no reason.
            val store = AlertStore(context)
            store.enabled = false
            AlertPollScheduler.stop(context)
            call.resolve(
                JSObject().put("enabled", false).put("configured", true).put("permission", "denied"),
            )
            return
        }
        finishEnable(call)
    }

    private fun finishEnable(call: PluginCall) {
        val store = AlertStore(context)
        store.enabled = true
        AlertNotifier.ensureChannel(context)
        AlertPollScheduler.start(context)
        call.resolve(JSObject().put("enabled", true).put("configured", true).put("permission", permissionLabel()))
    }

    /** Turn alerts off and clear anything already on screen. */
    @PluginMethod
    fun disable(call: PluginCall) {
        val store = AlertStore(context)
        store.enabled = false
        for (id in store.shown) AlertNotifier.cancel(context, id)
        store.clearPosted()
        AlertPollScheduler.stop(context)
        // configured stays true: an explicit "off" must survive the next launch.
        call.resolve(JSObject().put("enabled", false).put("configured", true))
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

    /**
     * Plex requests from this box (src/lib/overseerr.ts): remember the key and
     * whether anything is pending, and poll now so a fresh request is watched
     * from the next tick.
     */
    @PluginMethod
    fun watchRequests(call: PluginCall) {
        val key = call.getString("deviceKey")?.trim().orEmpty()
        val pending = call.getBoolean("pending", false) ?: false
        val store = AlertStore(context)
        if (key.isNotEmpty()) store.requestKey = key
        store.requestPending = pending
        if (pending && store.enabled && store.configured) AlertPollScheduler.start(context)
        call.resolve()
    }

    private fun needsRuntimePermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED

    private fun permissionLabel(): String = if (needsRuntimePermission()) "denied" else "granted"
}
