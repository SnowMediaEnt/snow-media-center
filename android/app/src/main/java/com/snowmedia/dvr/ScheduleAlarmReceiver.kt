package com.snowmedia.dvr

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * A scheduled recording's alarm went off (not exported: only the alarm
 * manager, holding this app's own PendingIntent, can reach it). The intent
 * carries the schedule's id and nothing else, so everything is looked up
 * here:
 *  1. the schedule; too late (past its padded end) means "Missed";
 *  2. joins a recording already running on the same channel (the previous
 *     programme, back to back) instead of opening a second stream;
 *  3. rebuilds the stream address from the saved Player login (LineCreds): no
 *     login, or a different line, is a plain-words failure;
 *  4. the drive (a missing USB drive falls back to the box when it has room),
 *     the free space and the number of recordings the plan allows;
 *  5. starts RecordingService, which updates the schedule as it goes.
 * The address is put in one in-app intent to the service and nowhere else:
 * never stored, logged, or put in a PendingIntent.
 */
class ScheduleAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RecordScheduler.ACTION_FIRE) return
        val id = intent.getStringExtra(RecordScheduler.EXTRA_SCHEDULE) ?: return
        val ctx = context.applicationContext
        try {
            fire(ctx, id)
        } catch (t: Throwable) {
            // Never the message: nothing near here should hold an address, but be sure.
            Log.w(TAG, "Scheduled start failed (${t.javaClass.simpleName})")
            ScheduleStore.get(ctx, id)?.let { RecordScheduler.fail(ctx, it, ScheduleReasons.START_FAILED) }
        }
    }

    private fun fire(ctx: Context, id: String) {
        val s = ScheduleStore.get(ctx, id) ?: return
        if (s.status != ScheduleStatus.SCHEDULED) return
        val now = System.currentTimeMillis()
        val kind = ScheduleRules.planAtFire(s, now)
        if (kind == Fire.MISSED) {
            RecordScheduler.miss(ctx, s, now)
            RecorderPlugin.emitChanged()
            return
        }

        // Programmes of this channel that run into each other are one job.
        val waiting = ScheduleStore.all(ctx).filter { it.status == ScheduleStatus.SCHEDULED }
        val group = ScheduleRules.mergeAdjacent(waiting).firstOrNull { id in it.ids }
        val ids = group?.ids ?: listOf(id)
        val endsAt = group?.endMs ?: ScheduleRules.paddedEnd(s)
        val chain = waiting.filter { it.id in ids }.sortedBy { ScheduleRules.paddedStart(it) }
        val title = chain.map { it.programmeTitle }.filter { it.isNotBlank() }.distinct().joinToString(" + ")
        val lineKey = ScheduleRules.lineKey(s)

        // The previous programme is still recording: run on to this one's end.
        val running = RecordingService.jobs.values.firstOrNull {
            !it.stopped && it.lineKey == lineKey && it.streamId == s.streamId
        }
        if (running != null) {
            ScheduleStore.markRecording(ctx, ids, running.id)
            ids.filter { it != id }.forEach { RecordScheduler.cancel(ctx, it) }
            val joinedTitle = listOfNotNull(running.title?.takeIf { it.isNotBlank() }, title.takeIf { it.isNotBlank() }).joinToString(" + ")
            try {
                ctx.startService(
                    Intent(ctx, RecordingService::class.java)
                        .setAction(RecordingService.ACTION_EXTEND)
                        .putExtra(RecordingService.EXTRA_ID, running.id)
                        .putExtra(RecordingService.EXTRA_ENDS_AT, endsAt)
                        .putExtra(RecordingService.EXTRA_TITLE, joinedTitle),
                )
            } catch (t: Throwable) {
                Log.w(TAG, "Joining the running recording failed (${t.javaClass.simpleName})")
                ids.forEach { ScheduleStore.get(ctx, it)?.let { x -> RecordScheduler.fail(ctx, x, ScheduleReasons.BLOCKED) } }
                return
            }
            RecorderPlugin.emitChanged()
            return
        }

        // The address: rebuilt from the saved login, straight into the intent below.
        val url = when (val r = LineCreds.resolve(ctx, s.host, s.userTag, s.streamId)) {
            is LineCreds.Resolved.Ok -> r.url
            LineCreds.Resolved.NoLogin -> return RecordScheduler.fail(ctx, s, ScheduleReasons.NO_LOGIN)
            LineCreds.Resolved.OtherLine -> return RecordScheduler.fail(ctx, s, ScheduleReasons.OTHER_LINE)
        }

        // The drive. A USB drive that is not there falls back to the box if it has room for a while.
        var vol = RecordingStore.volume(ctx, s.volumeId)
        var moved = false
        if (vol == null) {
            val box = RecordingStore.volume(ctx, "box")
            val need = RecordingStore.BOX_MIN_FREE_BYTES + RecordingStore.START_HEADROOM_BYTES + FALLBACK_EXTRA_BYTES
            if (box == null || box.freeBytes < need) return RecordScheduler.fail(ctx, s, ScheduleReasons.USB_GONE)
            vol = box
            moved = true
        }
        if (!vol.dir.exists() && !vol.dir.mkdirs()) return RecordScheduler.fail(ctx, s, ScheduleReasons.START_FAILED)
        if (vol.freeBytes < RecordingStore.minFreeBytes(vol.removable) + RecordingStore.START_HEADROOM_BYTES) {
            return RecordScheduler.fail(ctx, s, ScheduleReasons.NO_SPACE)
        }

        // The plan's limit on recordings at once (manual ones count too).
        val cap = if (s.maxConnections >= 1) minOf(s.maxConnections, RecordingService.MAX_SIMULTANEOUS) else RecordingService.MAX_SIMULTANEOUS
        val runId = UUID.randomUUID().toString()
        if (!RecordingService.tryReserve(runId, cap)) {
            return RecordScheduler.fail(ctx, s, ScheduleReasons.tooMany(RecordingService.activeCount().coerceAtLeast(1)))
        }

        val stamp = SimpleDateFormat("yyyy-MM-dd HH.mm", Locale.US).format(Date(s.startUtcMs))
        val first = chain.firstOrNull() ?: s
        val name = if (first.programmeTitle.isBlank()) "${s.channelName} – $stamp" else "${first.programmeTitle} (${s.channelName}) – $stamp"
        val file = RecordingStore.uniqueFile(vol.dir, RecordingStore.safeName(name))
        ScheduleStore.markRecording(ctx, ids, runId)
        val intent = Intent(ctx, RecordingService::class.java)
            .setAction(RecordingService.ACTION_START)
            .putExtra(RecordingService.EXTRA_ID, runId)
            .putExtra(RecordingService.EXTRA_URL, url)
            .putExtra(RecordingService.EXTRA_PATH, file.absolutePath)
            .putExtra(RecordingService.EXTRA_CHANNEL, s.channelName.ifBlank { "Channel" })
            .putExtra(RecordingService.EXTRA_ENDS_AT, endsAt)
            .putExtra(RecordingService.EXTRA_REMOVABLE, vol.removable)
            .putExtra(RecordingService.EXTRA_SCHEDULE_ID, id)
            .putExtra(RecordingService.EXTRA_TITLE, title)
            .putExtra(RecordingService.EXTRA_STREAM_ID, s.streamId)
            .putExtra(RecordingService.EXTRA_LINE_KEY, lineKey)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
        } catch (t: Throwable) {
            Log.w(TAG, "Scheduled start refused (${t.javaClass.simpleName})")
            RecordingService.release(runId)
            ids.forEach { ScheduleStore.get(ctx, it)?.let { x -> RecordScheduler.fail(ctx, x, ScheduleReasons.BLOCKED) } }
            return
        }
        ids.filter { it != id }.forEach { RecordScheduler.cancel(ctx, it) }
        if (kind == Fire.START_LATE) RecordScheduler.startedLate(ctx, s, endsAt)
        if (moved) RecordScheduler.movedToBox(ctx, s)
        RecorderPlugin.emitChanged()
    }

    private companion object {
        const val TAG = "SmcSchedule"
        /** A USB drive that is missing: the box takes over only with room for about 15 more minutes (2.5 GB an hour). */
        const val FALLBACK_EXTRA_BYTES = 640L * 1024L * 1024L
    }
}
