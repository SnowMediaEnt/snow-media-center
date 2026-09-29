package com.snowmedia.dvr

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Puts the scheduled recordings' alarms back when Android forgets them: after
 * a reboot (BOOT_COMPLETED, and QUICKBOOT_POWERON on Fire TV), after an update
 * of the app, when the clock or time zone changes, and when the viewer allows
 * exact alarms again. (The recorder plugin also re-arms every time the app
 * starts.) Exported, like the alert poll's BootReceiver, because the system
 * sends the boot messages; it only reacts to the actions listed here. It
 * never starts a recording itself: a schedule already under way is started
 * through an alarm a few seconds ahead (ScheduleRules.rearmPlan), which is
 * allowed on every Android version, where a boot receiver starting a
 * foreground service is not.
 */
class RecordRearmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in ACTIONS) return
        try {
            RecordScheduler.rearm(context.applicationContext)
        } catch (_: Throwable) { /* the next app start re-arms */ }
    }

    companion object {
        val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED,
        )
    }
}
