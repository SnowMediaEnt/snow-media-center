package com.snowmedia.dvr

import android.content.Intent
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.UUID

/**
 * Record live channels (src/capacitor/SnowRecorder.ts): where they can go,
 * start and stop, and the list of recordings with rename and delete. The
 * recording itself runs in RecordingService. Capacitor runs these calls off
 * the main thread, so the file work here is fine where it is.
 *
 * Scheduled recordings (a programme from the Guide) are set, listed and
 * cancelled here; the alarms are RecordScheduler's. A schedule never holds a
 * stream address, user name or password: [schedule] only checks that the
 * line asked for is the one the Player is signed in to, and keeps a short
 * hash of the account.
 *
 * The 'recordingsChanged' event tells the web side that a recording or a
 * schedule started, ended or changed on its own (a scheduled start, a full
 * drive), so the Recordings screen, the REC badge and the Rewind gate follow.
 */
@CapacitorPlugin(name = "SnowRecorder")
class RecorderPlugin : Plugin() {

    override fun load() {
        instance = this
        // Every app start puts the alarms back (a force-stop deletes them).
        Thread({ try { RecordScheduler.rearm(context) } catch (_: Throwable) { /* next start */ } }, "smc-rearm").apply { isDaemon = true }.start()
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        super.handleOnDestroy()
    }

    internal fun fireChanged() = notifyListeners("recordingsChanged", JSObject())

    companion object {
        @Volatile private var instance: RecorderPlugin? = null

        /** Tell the web side (if it is there) that recordings or schedules changed. */
        fun emitChanged() {
            try { instance?.fireChanged() } catch (_: Throwable) { /* no bridge right now */ }
        }
    }

    private fun volumesJson(): JSArray {
        val arr = JSArray()
        for (v in RecordingStore.volumes(context)) {
            arr.put(
                JSObject()
                    .put("id", v.id)
                    .put("label", v.label)
                    .put("removable", v.removable)
                    .put("freeBytes", v.freeBytes)
                    .put("totalBytes", v.totalBytes),
            )
        }
        return arr
    }

    @PluginMethod
    fun getVolumes(call: PluginCall) {
        call.resolve(JSObject().put("volumes", volumesJson()))
    }

    /**
     * Start recording. The URL carries the line's credentials: passed to the
     * service only, never logged. Refused, with a plain reason, when the
     * drive is nearly full or [RecordingService.MAX_SIMULTANEOUS] recordings
     * (or fewer, if the plan allows fewer: "maxSimultaneous") already run.
     */
    @PluginMethod
    fun start(call: PluginCall) {
        val url = call.getString("url")
        val channel = call.getString("channel")?.takeIf { it.isNotBlank() } ?: "Channel"
        val fileName = call.getString("fileName") ?: channel
        val minutes = call.getInt("durationMin") ?: 0
        val cap = (call.getInt("maxSimultaneous") ?: RecordingService.MAX_SIMULTANEOUS)
            .coerceIn(1, RecordingService.MAX_SIMULTANEOUS)
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        val vol = RecordingStore.volume(context, call.getString("volumeId"))
            ?: run { call.reject("That drive is not available"); return }
        if (!vol.dir.exists() && !vol.dir.mkdirs()) { call.reject("Can't write to ${vol.label}"); return }
        // Room above the floor the recording will stop at (1 GB on the box, 200 MB on a USB drive).
        if (vol.freeBytes < RecordingStore.minFreeBytes(vol.removable) + RecordingStore.START_HEADROOM_BYTES) {
            call.reject("Not enough free space on ${vol.label}.", "NO_SPACE")
            return
        }
        val id = UUID.randomUUID().toString()
        if (!RecordingService.tryReserve(id, cap)) {
            // A start still being set up counts too, so never "0 are running".
            val running = RecordingService.activeCount().coerceAtLeast(1)
            val what = if (running == 1) "1 recording is" else "$running recordings are"
            call.reject(
                "$what already running (at most $cap at once). Stop one first.",
                "TOO_MANY",
                JSObject().put("maxSimultaneous", cap),
            )
            return
        }
        val file = RecordingStore.uniqueFile(vol.dir, RecordingStore.safeName(fileName))
        val intent = Intent(context, RecordingService::class.java)
            .setAction(RecordingService.ACTION_START)
            .putExtra(RecordingService.EXTRA_ID, id)
            .putExtra(RecordingService.EXTRA_URL, url)
            .putExtra(RecordingService.EXTRA_PATH, file.absolutePath)
            .putExtra(RecordingService.EXTRA_CHANNEL, channel)
            .putExtra(RecordingService.EXTRA_DURATION_MS, if (minutes > 0) minutes * 60_000L else 0L)
            .putExtra(RecordingService.EXTRA_REMOVABLE, vol.removable)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        } catch (t: Throwable) {
            RecordingService.release(id)
            call.reject("Recording could not start (${t.javaClass.simpleName})")
            return
        }
        call.resolve(JSObject().put("id", id).put("name", file.name.removeSuffix(".ts")).put("volumeLabel", vol.label))
    }

    /** Stop one recording (id), or all of them. */
    @PluginMethod
    fun stop(call: PluginCall) {
        val id = call.getString("id")
        if (id != null && RecordingService.jobFor(id) == null) { call.resolve(); return }
        if (RecordingService.jobs.isEmpty()) { call.resolve(); return }
        val intent = Intent(context, RecordingService::class.java).setAction(RecordingService.ACTION_STOP)
        if (id != null) intent.putExtra(RecordingService.EXTRA_ID, id)
        try { context.startService(intent) } catch (_: Throwable) {
            // The service is running (it has jobs), so this only fails if it is going away.
            if (id == null) RecordingService.jobs.values.forEach { it.stop() } else RecordingService.jobFor(id)?.stop()
        }
        call.resolve()
    }

    /** Recordings in progress. */
    @PluginMethod
    fun active(call: PluginCall) {
        val arr = JSArray()
        for (j in RecordingService.jobs.values) {
            if (j.stopped) continue
            arr.put(
                JSObject()
                    .put("id", j.id)
                    .put("channel", j.channel)
                    .put("name", j.file.name.removeSuffix(".ts"))
                    .put("startedAt", j.startedAt)
                    .put("endsAt", j.endsAt)
                    .put("bytes", j.bytes),
            )
        }
        call.resolve(JSObject().put("jobs", arr))
    }

    /** Every recording, newest first, and the drives with their free space. */
    @PluginMethod
    fun list(call: PluginCall) {
        val arr = JSArray()
        for (o in RecordingStore.list(context)) arr.put(o)
        call.resolve(JSObject().put("recordings", arr).put("volumes", volumesJson()))
    }

    @PluginMethod
    fun rename(call: PluginCall) {
        val path = call.getString("path")
        val name = call.getString("name")
        if (path.isNullOrBlank() || name.isNullOrBlank()) { call.reject("path and name required"); return }
        val from = File(path)
        if (!from.exists() || !RecordingStore.isOurs(context, from)) { call.reject("Recording not found"); return }
        if (RecordingService.jobs.values.any { !it.stopped && it.file.absolutePath == from.absolutePath }) {
            call.reject("Stop the recording before renaming it"); return
        }
        val safe = RecordingStore.safeName(name)
        if (safe == from.name) { call.resolve(JSObject().put("path", from.absolutePath)); return }
        val to = File(from.parentFile, safe)
        if (to.exists()) { call.reject("A recording with that name already exists"); return }
        if (!from.renameTo(to)) { call.reject("Could not rename"); return }
        RecordingStore.renamed(context, from, to)
        call.resolve(JSObject().put("path", to.absolutePath).put("name", to.name.removeSuffix(".ts")).put("playUrl", RecordingStore.playUrl(to)))
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) { call.reject("path required"); return }
        val f = File(path)
        if (!RecordingStore.isOurs(context, f)) { call.reject("Recording not found"); return }
        if (RecordingService.jobs.values.any { !it.stopped && it.file.absolutePath == f.absolutePath }) {
            call.reject("Stop the recording before deleting it"); return
        }
        if (f.exists() && !f.delete()) { call.reject("Could not delete"); return }
        call.resolve()
    }

    // ---- scheduled recordings ----

    // PluginCall.getLong / getInt only accept that exact boxed type (a stream id like 301 arrives as an
    // Integer, a timestamp as a Long); any JSON number is read here, and null or missing is 0.
    private fun PluginCall.long(name: String): Long = (data.opt(name) as? Number)?.toLong() ?: 0L
    private fun PluginCall.int(name: String): Int = (data.opt(name) as? Number)?.toInt() ?: 0

    /**
     * Set a programme to record later. Refused, with a code, when it is
     * already over (OVER), when the Player is signed out (NO_LOGIN) or in to
     * another line (OTHER_LINE), or when it would run more recordings at once
     * than the plan allows (CONFLICT, with `atMs` and `count`). A programme
     * already on is fine: it starts a few seconds from now, through the alarm.
     */
    @PluginMethod
    fun schedule(call: PluginCall) {
        val streamId = call.long("streamId")
        val host = call.getString("host")?.trim().orEmpty()
        val channel = call.getString("channel")?.takeIf { it.isNotBlank() } ?: "Channel"
        val title = call.getString("title")?.trim().orEmpty()
        val start = call.long("startUtcMs")
        val end = call.long("endUtcMs")
        val before = call.int("padBeforeMin").coerceIn(0, 60)
        val after = call.int("padAfterMin").coerceIn(0, 60)
        val plan = call.int("maxConnections")
        if (streamId <= 0 || host.isEmpty() || start <= 0 || end <= start) { call.reject("That programme can't be scheduled"); return }

        val login = LineCreds.read(context)
        if (login == null) { call.reject(ScheduleReasons.NO_LOGIN, "NO_LOGIN"); return }
        if (login.host.trimEnd('/') != host.trimEnd('/')) { call.reject(ScheduleReasons.OTHER_LINE, "OTHER_LINE"); return }
        val tag = LineCreds.userTag(login.host, login.username)

        val candidate = Sched(
            id = UUID.randomUUID().toString(), streamId = streamId, host = login.host.trimEnd('/'), userTag = tag,
            startUtcMs = start, endUtcMs = end, padBeforeMin = before, padAfterMin = after,
            channelName = channel, programmeTitle = title, volumeId = call.getString("volumeId") ?: "box",
            maxConnections = plan,
        )
        val now = System.currentTimeMillis()
        if (now >= ScheduleRules.paddedEnd(candidate)) { call.reject("That programme is already over", "OVER"); return }

        // The plan's limit: other schedules, and recordings running now (until they end, or for good if open-ended).
        val cap = if (plan >= 1) minOf(plan, RecordingService.MAX_SIMULTANEOUS) else RecordingService.MAX_SIMULTANEOUS
        val running = RecordingService.jobs.values.filter { !it.stopped }.mapIndexed { i, j ->
            Sched(
                id = "job:${j.id}", streamId = -1L - i, host = "", userTag = "", startUtcMs = j.startedAt,
                endUtcMs = if (j.endsAt > now) j.endsAt else now + ScheduleRules.MAX_RECORD_MS,
                padBeforeMin = 0, padAfterMin = 0, status = ScheduleStatus.RECORDING,
            )
        }
        val clash = ScheduleRules.conflicts(ScheduleStore.all(context) + running, candidate, cap)
        if (clash != null) {
            val n = clash.count
            call.reject(
                "You already have $n recording${if (n == 1) "" else "s"} then. Cancel one first.",
                "CONFLICT",
                JSObject().put("atMs", clash.atMs).put("count", n),
            )
            return
        }

        ScheduleStore.add(context, candidate)
        val startAt = maxOf(ScheduleRules.paddedStart(candidate), now + ScheduleRules.NOW_LEAD_MS)
        val exact = RecordScheduler.arm(context, candidate, startAt)
        emitChanged()
        call.resolve(JSObject().put("id", candidate.id).put("exact", exact))
    }

    /** Cancel one schedule (or dismiss a missed / failed one); with no id, all of them (sign-out). */
    @PluginMethod
    fun cancelSchedule(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            ScheduleStore.all(context).forEach { RecordScheduler.cancel(context, it.id) }
            ScheduleStore.removeAll(context)
        } else {
            val s = ScheduleStore.get(context, id)
            // One being recorded is stopped from the recordings list, not from here.
            if (s != null && s.status != ScheduleStatus.RECORDING) {
                RecordScheduler.cancel(context, id)
                ScheduleStore.remove(context, id)
            }
        }
        emitChanged()
        call.resolve()
    }

    /** Every schedule, soonest first (finished ones a week at most). */
    @PluginMethod
    fun listSchedules(call: PluginCall) {
        val arr = JSArray()
        for (s in ScheduleStore.all(context).sortedBy { it.startUtcMs }) arr.put(ScheduleStore.toJs(s))
        call.resolve(JSObject().put("schedules", arr))
    }

    /** Whether alarms can be exact here, and whether there is a settings page for allowing them. */
    @PluginMethod
    fun exactAlarmStatus(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("canExact", RecordScheduler.canExact(context))
                .put("canOpenSettings", RecordScheduler.canOpenSettings()),
        )
    }

    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        try {
            context.startActivity(RecordScheduler.settingsIntent(context))
            call.resolve()
        } catch (t: Throwable) {
            call.reject("Settings could not be opened (${t.javaClass.simpleName})")
        }
    }
}
