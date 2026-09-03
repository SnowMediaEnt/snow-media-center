package com.snowmedia.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.snowmedia.MainActivity
import com.snowmedia.R

/**
 * Posts and clears Snow Media alerts as real Android notifications.
 *
 * FIRE TV: a notification only pops up over whatever is on screen — Amazon
 * calls it a heads-up notification — when it is HIGH priority AND on a channel
 * whose importance is IMPORTANCE_HIGH. Anything less quietly files itself in
 * the Fire TV notification centre, where nobody will ever look. Fire OS 7 is
 * Android 9, so the channel is mandatory: a notification with no channel id is
 * dropped without an error.
 *
 * One thing no setting can beat: a heads-up will not reliably draw over
 * another app's full-screen video. That is a platform limit, not ours.
 */
internal object AlertNotifier {
    const val CHANNEL_ID = "smc_alerts"
    const val ACTION_DISMISSED = "com.snowmedia.notify.DISMISSED"
    const val EXTRA_ALERT_ID = "alert_id"

    private const val SEVERITY_CRITICAL = "critical"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Snow Media alerts",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Service notices, outages and announcements from Snow Media."
            enableVibration(false)
            setShowBadge(true)
        }
        mgr.createNotificationChannel(channel)
    }

    /** Stable, collision-resistant notification id for an alert's UUID. */
    fun notificationId(alertId: String): Int = alertId.hashCode()

    fun post(context: Context, alert: Alert) {
        ensureChannel(context)

        // Tapping opens SMC. SINGLE_TOP so an app already running comes to the
        // front instead of starting a second copy behind the first.
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            context, notificationId(alert.id), open, pendingFlags(),
        )
        // Fires when the viewer swipes the notification away, so the poller can
        // stop re-posting something they have already dealt with.
        val deleteIntent = PendingIntent.getBroadcast(
            context,
            notificationId(alert.id),
            Intent(context, AlertDismissReceiver::class.java)
                .setAction(ACTION_DISMISSED)
                .putExtra(EXTRA_ALERT_ID, alert.id),
            pendingFlags(),
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_snow)
            .setContentTitle(alert.title.ifBlank { "Snow Media" })
            .setContentText(alert.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(alert.message))
            // PRIORITY_HIGH is what earns the heads-up popup on Fire TV. It is
            // deprecated in favour of channel importance on API 26+, but Fire
            // OS 5 boxes are still API 22 and read this field, so set both.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(contentIntent)
            .setDeleteIntent(deleteIntent)
            // Critical notices stay until acted on; everything else clears on tap.
            .setAutoCancel(alert.severity != SEVERITY_CRITICAL)
            .setOnlyAlertOnce(true)

        try {
            NotificationManagerCompat.from(context).notify(notificationId(alert.id), builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS refused on Android 13+. Nothing to do — the
            // in-app alert banner still covers this viewer.
        }
    }

    fun cancel(context: Context, alertId: String) {
        NotificationManagerCompat.from(context).cancel(notificationId(alertId))
    }

    private fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
}

internal data class Alert(
    val id: String,
    val title: String,
    val message: String,
    val severity: String,
)
