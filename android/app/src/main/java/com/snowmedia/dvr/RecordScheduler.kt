package com.snowmedia.dvr

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.snowmedia.MainActivity
import com.snowmedia.R

/**
 * Sets the alarms that start scheduled recordings, and puts them back after a
 * reboot, an update or a clock change (RecordRearmReceiver, and every time
 * the recorder plugin loads).
 *
 * The alarm is setAlarmClock: exact, wakes a sleeping box, and on Android 12+
 * lets the app start a foreground service from the background. When the box
 * refuses exact alarms (Android 12 with "Alarms & reminders" revoked, or an
 * odd box) it falls back to an inexact alarm five minutes early; if Android
 * then refuses the service start, the schedule fails with a plain reason and
 * the Recordings screen offers the settings page.
 *
 * The alarm's PendingIntent carries only the schedule's id (and an
 * smc-schedule: address made from it, so each schedule's alarm is its own).
 * No stream address, user name or password is stored or logged here: the
 * address is rebuilt when the alarm fires (ScheduleAlarmReceiver, LineCreds).
 * Notifications name the channel and the programme title only.
 */
internal object RecordScheduler {
    private const val TAG = "SmcSchedule"
    const val ACTION_FIRE = "com.snowmedia.dvr.SCHEDULE_FIRE"
    const val EXTRA_SCHEDULE = "scheduleId"
    /** With only inexact alarms the start is asked for this much early. */
    const val INEXACT_LEAD_MS = 5L * 60_000L

    /** Exact alarms are allowed (always before Android 12 and from 13, where USE_EXACT_ALARM is granted). */
    fun canExact(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        return try { am.canScheduleExactAlarms() } catch (_: Throwable) { false }
    }

    /** Android 12 and 12L: the viewer can allow exact alarms on a settings page. */
    fun canOpenSettings(): Boolean = Build.VERSION.SDK_INT in Build.VERSION_CODES.S..Build.VERSION_CODES.S_V2

    /** The system's "Alarms & reminders" page for this app (its app info page where there is none). */
    fun settingsIntent(ctx: Context): Intent {
        val i = if (canOpenSettings()) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun flags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        else PendingIntent.FLAG_UPDATE_CURRENT

    /** The alarm's intent: this receiver, one action, the schedule id. Nothing else. */
    private fun fireIntent(ctx: Context, id: String): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, id.hashCode(),
            Intent(ctx, ScheduleAlarmReceiver::class.java)
                .setAction(ACTION_FIRE)
                .setData(Uri.parse("smc-schedule:$id"))
                .putExtra(EXTRA_SCHEDULE, id),
            flags(),
        )

    /**
     * Arms [s] to go off at [atMs] (its padded start, or a few seconds from
     * now). True when the alarm is exact.
     */
    fun arm(ctx: Context, s: Sched, atMs: Long): Boolean {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        val pi = fireIntent(ctx, s.id)
        val now = System.currentTimeMillis()
        if (canExact(ctx)) {
            try {
                val show = PendingIntent.getActivity(
                    ctx, 0,
                    Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    flags(),
                )
                am.setAlarmClock(AlarmManager.AlarmClockInfo(maxOf(atMs, now + 1_000L), show), pi)
                return true
            } catch (t: Throwable) {
                // Revoked between the check and the call: the inexact way below.
                Log.w(TAG, "Exact alarm refused (${t.javaClass.simpleName})")
            }
        }
        val at = maxOf(now + ScheduleRules.NOW_LEAD_MS, atMs - INEXACT_LEAD_MS)
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (t: Throwable) {
            Log.w(TAG, "Alarm could not be set (${t.javaClass.simpleName})")
        }
        return false
    }

    fun cancel(ctx: Context, id: String) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        try { am.cancel(fireIntent(ctx, id)) } catch (_: Throwable) { /* nothing to cancel */ }
    }

    /**
     * Puts every alarm back and settles what the clock has moved past
     * (ScheduleRules.rearmPlan): armed, started now (through an alarm a few
     * seconds ahead, never straight from a boot receiver), marked missed
     * (with one notification), or dropped after a week.
     */
    fun rearm(ctx: Context) {
        val list = ScheduleStore.all(ctx)
        if (list.isEmpty()) return
        val now = System.currentTimeMillis()
        val byId = list.associateBy { it.id }
        var changed = false
        for (a in ScheduleRules.rearmPlan(list, now, RecordingService.busyIds())) {
            val s = byId[a.id] ?: continue
            when (a.kind) {
                RearmKind.ARM, RearmKind.START_NOW -> arm(ctx, s, a.atMs)
                RearmKind.MARK_MISSED -> {
                    miss(ctx, s, now)
                    changed = true
                }
                RearmKind.RESTART -> {
                    // The recording died with the process or the box: carry on in a new file.
                    ScheduleStore.update(ctx, s.id) { it.copy(status = ScheduleStatus.SCHEDULED, recordingId = null) }
                    arm(ctx, s, a.atMs)
                    changed = true
                }
                RearmKind.MARK_DONE -> {
                    ScheduleStore.update(ctx, s.id) { it.copy(status = ScheduleStatus.DONE, finishedAtMs = now) }
                    changed = true
                }
                RearmKind.PURGE -> {
                    ScheduleStore.remove(ctx, s.id)
                    changed = true
                }
            }
        }
        if (changed) RecorderPlugin.emitChanged()
    }

    // ---- outcomes (status + one notification) ----

    fun miss(ctx: Context, s: Sched, now: Long) {
        ScheduleStore.update(ctx, s.id) { it.copy(status = ScheduleStatus.MISSED, reason = ScheduleReasons.MISSED, finishedAtMs = now) }
        cancel(ctx, s.id)
        notify(
            ctx, s.id + "m", "Missed recording: ${label(s)}",
            "${clock(s.startUtcMs)}–${clock(s.endUtcMs)}. ${ScheduleReasons.MISSED}",
        )
    }

    fun fail(ctx: Context, s: Sched, reason: String, now: Long = System.currentTimeMillis()) {
        ScheduleStore.update(ctx, s.id) { it.copy(status = ScheduleStatus.FAILED, reason = reason, finishedAtMs = now) }
        cancel(ctx, s.id)
        notify(ctx, s.id + "f", "Scheduled recording didn't start: ${label(s)}", reason)
        RecorderPlugin.emitChanged()
    }

    fun startedLate(ctx: Context, s: Sched, endsAt: Long) {
        notify(
            ctx, s.id + "l", "Started late: ${label(s)}",
            "The box was off at ${clock(ScheduleRules.paddedStart(s))}. Recording until ${clock(endsAt)}.",
        )
    }

    /** "The News (CNN)": the programme and the channel, nothing about the line. */
    fun label(s: Sched): String {
        val title = s.programmeTitle.ifBlank { "Recording" }
        return if (s.channelName.isBlank()) title else "$title (${s.channelName})"
    }

    fun clock(ms: Long): String =
        java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(ms))

    /** One notification on the recordings channel; a box that has notifications off simply shows none (the screen has the status). */
    fun notify(ctx: Context, key: String, title: String, text: String) {
        try {
            RecordingService.ensureChannel(ctx)
            val open = PendingIntent.getActivity(
                ctx, 0,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                flags(),
            )
            val n = NotificationCompat.Builder(ctx, RecordingService.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_snow)
                .setContentTitle(title)
                .setContentText(text)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build()
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(key.hashCode(), n)
        } catch (_: Throwable) { /* notifications off */ }
    }
}
