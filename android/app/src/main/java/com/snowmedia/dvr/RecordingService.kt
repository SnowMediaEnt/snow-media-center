package com.snowmedia.dvr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import com.snowmedia.AppLocale
import com.snowmedia.MainActivity
import com.snowmedia.R
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Records live channels in the background: a foreground service (its
 * notification says what is recording and has a Stop button), so a recording
 * carries on when the viewer leaves the player or the app. Each recording has
 * its own connection to the channel (LiveSource, shared with Rewind live TV)
 * and writes the MPEG-TS as it arrives, straight to its file. It ends at its
 * set length, when stopped, or when the drive is nearly full.
 *
 * SMC rules on top of the plain recorder:
 * - At most [MAX_SIMULTANEOUS] recordings at once (each is one more stream on
 *   the viewer's line); [tryReserve] is the one place that decides.
 * - Stops before the drive is full: 1 GB kept free on the box's own storage
 *   (app updates and the WebView need it), 200 MB on a USB drive.
 * - A USB stick may be FAT32, which cannot hold a file over 4 GB: on a
 *   removable drive the recording carries on in "<name> (part 2).ts" at about
 *   3.9 GB, and so on.
 *
 * The stream address carries the line's username and password. It only
 * travels inside this app (the service is not exported), goes to the
 * recording thread and nowhere else: never logged, stored, put in a file
 * name or a PendingIntent. A job started by a schedule (ScheduleAlarmReceiver
 * rebuilds the address at that moment from the saved Player login) also
 * carries the schedule's id and the programme title, which are all a
 * notification or the index ever shows.
 *
 * Scheduled recordings: the job knows which schedules it carries (their
 * `recordingId` is the job's id), tells the schedule store when it ends, and
 * tells the web side (RecorderPlugin.emitChanged) whenever a recording starts
 * or ends, so the screen and the Rewind gate hear about a scheduled start.
 */
class RecordingService : Service() {

    internal class Job(
        val id: String,
        val channel: String,
        /** The first part's file; the later parts are named from it. */
        val firstFile: File,
        val startedAt: Long,
        /** Wall-clock end (absolute); 0 = until stopped. A later programme on the same channel can push it out. */
        @Volatile var endsAt: Long,
        /** Stop when the drive has less than this free. */
        val minFreeBytes: Long,
        /** Carry on in a new file at this size (a FAT32 stick holds less than 4 GB). */
        val partLimitBytes: Long,
        /** Set by a scheduled recording; a manual one has neither. */
        val scheduleId: String? = null,
        /** The programme title (or several, joined) of a scheduled recording. */
        @Volatile var title: String? = null,
        /** Which line and channel a scheduled recording is on, so the next programme of it can join this job. */
        val lineKey: String? = null,
        val streamId: Long = 0L,
    ) {
        /** Stops the job at [endsAt]; replaced when the end moves. */
        var stopTask: Runnable? = null
        /** The part being written, and its id in the recordings index (part 1's is [id]). */
        @Volatile var file: File = firstFile
        @Volatile var partId: String = id
        @Volatile var part = 1
        /** All parts together. */
        @Volatile var bytes = 0L
        @Volatile var stopped = false
        @Volatile var source: LiveSource? = null
        @Volatile var endReason: String? = null
        fun stop(reason: String? = null) {
            if (reason != null && endReason == null) endReason = reason
            stopped = true
            source?.cancel()
        }
    }

    /** Writing the file failed (drive full or removed): not worth reconnecting for. */
    private class DiskError : IOException("disk")

    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Foreground at once, whatever the command: Android requires it
        // within seconds of startForegroundService.
        goForeground()
        when (intent?.action) {
            ACTION_START -> startJob(intent)
            ACTION_STOP -> {
                val id = intent.getStringExtra(EXTRA_ID)
                if (id == null) jobs.values.forEach { it.stop() } else jobFor(id)?.stop()
            }
            ACTION_EXTEND -> extendJob(intent)
        }
        if (jobs.isEmpty()) finishIfIdle()
        return START_NOT_STICKY
    }

    private fun startJob(intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val url = intent.getStringExtra(EXTRA_URL)
        val path = intent.getStringExtra(EXTRA_PATH)
        if (url == null || path == null) { release(id); failSchedules(id, ScheduleReasons.START_FAILED); return }
        // Kept in English: this name is stored in the recordings index. The app always sends the real one.
        val channel = intent.getStringExtra(EXTRA_CHANNEL) ?: "Channel"
        val now = System.currentTimeMillis()
        // The end is a length from now, or (a scheduled start) a clock time.
        val durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
        val endsAt = intent.getLongExtra(EXTRA_ENDS_AT, 0L).takeIf { it > now } ?: if (durationMs > 0) now + durationMs else 0L
        val removable = intent.getBooleanExtra(EXTRA_REMOVABLE, false)
        val job = Job(
            id, channel, File(path), now, endsAt,
            minFreeBytes = RecordingStore.minFreeBytes(removable),
            partLimitBytes = RecordingStore.partLimitBytes(removable),
            scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID),
            title = intent.getStringExtra(EXTRA_TITLE),
            lineKey = intent.getStringExtra(EXTRA_LINE_KEY),
            streamId = intent.getLongExtra(EXTRA_STREAM_ID, 0L),
        )
        // The reservation turns into the job in one step, so two starts
        // arriving together can't both pass the cap.
        val accepted = synchronized(lock) {
            pending.remove(id)
            if (jobs.containsKey(id) || jobs.values.count { !it.stopped } >= MAX_SIMULTANEOUS) false else { jobs[id] = job; true }
        }
        if (!accepted) {
            failSchedules(id, ScheduleReasons.tooMany(activeCount().coerceAtLeast(1)))
            return
        }
        // The file exists before the index entry does, so a list() in between never sees an entry without one.
        try { job.file.parentFile?.mkdirs(); job.file.createNewFile() } catch (_: Throwable) { /* record() opens it again */ }
        RecordingStore.begin(applicationContext, id, job.file, channel, now, job.scheduleId, job.title)
        holdLocks()
        updateNotification()
        scheduleStop(job)
        RecorderPlugin.emitChanged()
        Thread({ record(job, url) }, "smc-record").apply { isDaemon = true }.start()
    }

    /** Stop [job] at its end time (again, if the end moved). */
    private fun scheduleStop(job: Job) {
        job.stopTask?.let { handler.removeCallbacks(it) }
        job.stopTask = null
        if (job.endsAt <= 0) return
        val task = Runnable { job.stop() }
        job.stopTask = task
        handler.postDelayed(task, (job.endsAt - System.currentTimeMillis()).coerceAtLeast(0L))
    }

    /**
     * The next programme on the same channel starts as this one ends: keep
     * the one connection and the one file, and run to the new end. Only ever
     * later (a shorter end is ignored).
     */
    private fun extendJob(intent: Intent) {
        val job = intent.getStringExtra(EXTRA_ID)?.let { jobFor(it) } ?: return
        if (job.stopped) return
        val to = intent.getLongExtra(EXTRA_ENDS_AT, 0L)
        if (job.endsAt <= 0 || to <= job.endsAt) return
        job.endsAt = to
        intent.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() }?.let { job.title = it }
        scheduleStop(job)
        updateNotification()
        RecorderPlugin.emitChanged()
    }

    /** A start that never became a job: the schedules waiting on it failed. */
    private fun failSchedules(recordingId: String, reason: String) {
        ScheduleStore.failRecording(applicationContext, recordingId, System.currentTimeMillis(), reason)
        RecorderPlugin.emitChanged()
    }

    /** Recording thread. Reconnects on its own until the job ends. */
    private fun record(job: Job, url: String) {
        var out: BufferedOutputStream? = null
        var partBytes = 0L
        try {
            job.file.parentFile?.mkdirs()
            out = BufferedOutputStream(FileOutputStream(job.file, true), 128 * 1024)
            var failures = 0
            var sinceCheck = 0L
            while (!job.stopped) {
                val src = LiveSource(url)
                job.source = src
                if (job.stopped) break
                val startedAt = SystemClock.elapsedRealtime()
                try {
                    src.pump { b, off, len ->
                        try { out?.write(b, off, len) } catch (_: IOException) { throw DiskError() }
                        job.bytes += len
                        partBytes += len
                        sinceCheck += len
                        if (partBytes >= job.partLimitBytes) {
                            out = nextPart(job, out)
                            partBytes = 0L
                        }
                        if (sinceCheck > CHECK_EVERY_BYTES) {
                            sinceCheck = 0L
                            val free = StorageBudget.volumeOf(job.file.parentFile ?: job.file)?.first ?: Long.MAX_VALUE
                            if (free < job.minFreeBytes) job.stop(REASON_DRIVE_FULL)
                        }
                        if (job.endsAt > 0 && System.currentTimeMillis() >= job.endsAt) job.stop()
                    }
                } catch (e: UnsupportedSourceException) {
                    job.stop(REASON_UNSUPPORTED)
                    break
                } catch (e: DiskError) {
                    job.stop(if (job.file.parentFile?.exists() == false) REASON_DRIVE_REMOVED else REASON_WRITE_FAILED)
                    break
                } catch (e: IOException) {
                    // Never the message: it can carry the address.
                    Log.w(TAG, "Recording connection dropped (${e.javaClass.simpleName})")
                    if (!job.stopped && e !is HttpStatusException && job.file.parentFile?.exists() == false) {
                        job.stop(REASON_DRIVE_REMOVED)
                        break
                    }
                }
                if (job.stopped) break
                failures = if (SystemClock.elapsedRealtime() - startedAt > 60_000L) 1 else failures + 1
                val wait = minOf(10_000L, 2000L * failures)
                var slept = 0L
                while (!job.stopped && slept < wait) {
                    try { Thread.sleep(250) } catch (_: InterruptedException) { break }
                    slept += 250
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Recording stopped (${t.javaClass.simpleName})")
            job.stop(REASON_WRITE_FAILED)
        } finally {
            try { out?.close() } catch (_: IOException) { /* the drive went away */ }
            RecordingStore.finish(applicationContext, job.partId, System.currentTimeMillis())
            handler.post { jobDone(job) }
        }
    }

    /**
     * The part being written is full: close it and carry on in the next one,
     * "<first name> (part 2).ts" in the same folder. Each part is a recording
     * of its own in the list. Cut where the chunk ended: a TS player finds
     * the next packet start by itself, as it does after a reconnect.
     */
    private fun nextPart(job: Job, current: BufferedOutputStream?): BufferedOutputStream {
        try { current?.close() } catch (_: IOException) { throw DiskError() }
        val now = System.currentTimeMillis()
        RecordingStore.finish(applicationContext, job.partId, now)
        val n = job.part + 1
        val next = RecordingStore.partFile(job.firstFile, n)
        val stream = try {
            BufferedOutputStream(FileOutputStream(next, true), 128 * 1024)
        } catch (_: IOException) {
            throw DiskError()
        }
        job.part = n
        job.partId = "${job.id}-p$n"
        job.file = next
        RecordingStore.begin(applicationContext, job.partId, next, job.channel, now, job.scheduleId, job.title)
        return stream
    }

    private fun jobDone(job: Job) {
        jobs.remove(job.id)
        if (job.scheduleId != null) ScheduleStore.finishRecording(applicationContext, job.id, System.currentTimeMillis(), job.endReason)
        RecorderPlugin.emitChanged()
        job.endReason?.let { notifyEnded(job, it) }
        if (jobs.isEmpty()) finishIfIdle() else updateNotification()
    }

    private fun finishIfIdle() {
        releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE) // API 24+, the app's minimum
        stopSelf()
    }

    override fun onDestroy() {
        jobs.values.forEach { it.stop() }
        releaseLocks()
        super.onDestroy()
    }

    // ---- notification ----

    private fun goForeground() {
        val n = buildNotification()
        // dataSync, matching the manifest's foregroundServiceType (Play
        // checklist A15: a recording is a network download to storage;
        // mediaProcessing needs API 35 and is for transcoding).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification() {
        try {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            mgr.notify(NOTIFICATION_ID, buildNotification())
        } catch (_: Throwable) { /* notifications off: recording goes on */ }
    }

    private fun buildNotification(): Notification {
        ensureChannel(this)
        val list = jobs.values.toList()
        val title = when (list.size) {
            0 -> AppLocale.string(this, R.string.rec_notif_title_none)
            // A scheduled one names its programme too: "Recording The News (CNN)".
            1 -> list[0].title?.takeIf { it.isNotBlank() }?.let { AppLocale.string(this, R.string.rec_notif_title_programme, it, list[0].channel) }
                ?: AppLocale.string(this, R.string.rec_notif_title_channel, list[0].channel)
            else -> AppLocale.plural(this, R.plurals.rec_notif_title_channels, list.size)
        }
        // Every recording is one more stream on the line: said in the
        // notification too, so it is never a surprise.
        val text = when (list.size) {
            0 -> AppLocale.string(this, R.string.rec_notif_text_starting)
            1 -> {
                if (list[0].endsAt > 0) AppLocale.string(this, R.string.rec_notif_text_until, clock(list[0].endsAt))
                else AppLocale.string(this, R.string.rec_notif_text_until_stopped)
            }
            else -> AppLocale.plural(this, R.plurals.rec_notif_text_streams, list.size)
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            pendingFlags(),
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, RecordingService::class.java).setAction(ACTION_STOP),
            pendingFlags(),
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_snow)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open)
            .addAction(0, AppLocale.string(this, R.string.rec_notif_stop), stop)
            .build()
    }

    private fun notifyEnded(job: Job, why: String) {
        try {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val n = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_snow)
                .setContentTitle(AppLocale.string(this, R.string.rec_ended_title, job.channel))
                .setContentText(reasonText(why))
                .setAutoCancel(true)
                .build()
            mgr.notify(job.id.hashCode(), n)
        } catch (_: Throwable) { /* notifications off */ }
    }

    private fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        else PendingIntent.FLAG_UPDATE_CURRENT

    private fun clock(ms: Long): String = AppLocale.clock(this, ms)

    /** An end reason as the notification shows it, in the app's language. The reason itself stays as stored (English). */
    private fun reasonText(why: String): String = when (why) {
        REASON_DRIVE_FULL -> AppLocale.string(this, R.string.rec_reason_drive_full)
        REASON_UNSUPPORTED -> AppLocale.string(this, R.string.rec_reason_unsupported)
        REASON_DRIVE_REMOVED -> AppLocale.string(this, R.string.rec_reason_drive_removed)
        REASON_WRITE_FAILED -> AppLocale.string(this, R.string.rec_reason_write_failed)
        else -> why
    }

    // ---- keep the box awake while recording ----

    private fun holdLocks() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SMC:record").apply { setReferenceCounted(false) }
            }
            wakeLock?.let { if (!it.isHeld) it.acquire(MAX_WAKE_MS) }
            if (wifiLock == null) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                @Suppress("DEPRECATION")
                wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "SMC:record")?.apply { setReferenceCounted(false) }
            }
            wifiLock?.let { if (!it.isHeld) it.acquire() }
        } catch (t: Throwable) {
            Log.w(TAG, "No wake lock for recording (${t.javaClass.simpleName})")
        }
    }

    private fun releaseLocks() {
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Throwable) { /* not held */ }
        try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Throwable) { /* not held */ }
    }

    companion object {
        private const val TAG = "SmcRecord"
        const val ACTION_START = "com.snowmedia.dvr.RECORD_START"
        const val ACTION_STOP = "com.snowmedia.dvr.RECORD_STOP"
        /** A scheduled programme joins the recording already running on its channel (EXTRA_ID, EXTRA_ENDS_AT, EXTRA_TITLE). */
        const val ACTION_EXTEND = "com.snowmedia.dvr.RECORD_EXTEND"
        const val EXTRA_ID = "id"
        const val EXTRA_URL = "url"
        const val EXTRA_PATH = "path"
        const val EXTRA_CHANNEL = "channel"
        const val EXTRA_DURATION_MS = "durationMs"
        /** Absolute end (wall clock, ms) instead of a length: for a scheduled recording. */
        const val EXTRA_ENDS_AT = "endsAt"
        /** The drive is a USB stick / SD card (smaller free-space floor, parts at 3.9 GB). */
        const val EXTRA_REMOVABLE = "removable"
        /** A scheduled recording's id and programme title; never an address. */
        const val EXTRA_SCHEDULE_ID = "scheduleId"
        const val EXTRA_TITLE = "title"
        /** Which channel and line a scheduled recording is on (the line as host + account hash: no login). */
        const val EXTRA_STREAM_ID = "streamId"
        const val EXTRA_LINE_KEY = "lineKey"
        const val CHANNEL_ID = "smc_recordings"

        // Why a recording ended. Stored with the schedule and shown by the Recordings screen as
        // written, so these stay English; the notification translates them (reasonText).
        private const val REASON_DRIVE_FULL = "The drive is full"
        private const val REASON_UNSUPPORTED = "This channel can't be recorded"
        private const val REASON_DRIVE_REMOVED = "The drive was removed"
        private const val REASON_WRITE_FAILED = "The recording could not be written"
        private const val NOTIFICATION_ID = 7301
        /** Recordings running at once: each is one more stream on the viewer's line. */
        const val MAX_SIMULTANEOUS = 2
        /** A start that was accepted but whose job never appeared frees its place after this. */
        private const val RESERVE_MS = 30_000L
        private const val CHECK_EVERY_BYTES = 8L * 1024L * 1024L
        /** The wake lock's own safety limit (a recording "until stopped" renews it on each start). */
        private const val MAX_WAKE_MS = 12L * 60L * 60L * 1000L

        internal val jobs = ConcurrentHashMap<String, Job>()
        private val lock = Any()
        /** Starts accepted by the plugin whose service has not registered the job yet: id -> when. */
        private val pending = HashMap<String, Long>()

        /** The job that owns [id]: its own id, or the id of the part it is writing. */
        internal fun jobFor(id: String): Job? = jobs[id] ?: jobs.values.firstOrNull { it.partId == id }

        fun isActive(id: String): Boolean = jobs.values.any { !it.stopped && it.partId == id }

        /** Ids of recordings running or about to (accepted, job not registered yet): what a re-arm must leave alone. */
        fun busyIds(): Set<String> = synchronized(lock) { jobs.keys.toSet() + pending.keys }

        /** Recordings running now (started, not stopped). */
        fun activeCount(): Int = jobs.values.count { !it.stopped }

        /**
         * A place for a new recording, or false when [cap] are already
         * running or about to (2 at most, less on a smaller plan). Call
         * before starting the service; [release] if it could not start.
         */
        fun tryReserve(id: String, cap: Int = MAX_SIMULTANEOUS): Boolean = synchronized(lock) {
            val now = SystemClock.elapsedRealtime()
            pending.values.removeAll { now - it > RESERVE_MS }
            if (activeCount() + pending.size >= cap.coerceIn(1, MAX_SIMULTANEOUS)) return false
            pending[id] = now
            true
        }

        fun release(id: String) = synchronized(lock) { pending.remove(id); Unit }

        /**
         * Creates the channel, and renames it when the app's language changed: creating a channel
         * that exists only updates its name and description, the viewer's own settings stay.
         */
        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, AppLocale.string(ctx, R.string.rec_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
                    description = AppLocale.string(ctx, R.string.rec_channel_desc)
                    setShowBadge(false)
                },
            )
        }
    }
}
