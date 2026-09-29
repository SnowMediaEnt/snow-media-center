package com.snowmedia.dvr

import android.content.Context
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Scheduled recordings, kept in filesDir/record-schedules.json (private to
 * the app). It holds ids, the line's host and a short account hash, the
 * channel name and programme title, UTC times, padding, the chosen drive and
 * the status. It never holds a stream address, user name or password: those
 * are rebuilt when the recording starts (LineCreds).
 */
internal object ScheduleStore {
    private const val FILE = "record-schedules.json"
    private val lock = Any()

    private fun file(ctx: Context) = File(ctx.filesDir, FILE)

    private fun toJson(s: Sched): JSONObject = JSONObject()
        .put("id", s.id)
        .put("streamId", s.streamId)
        .put("host", s.host)
        .put("userTag", s.userTag)
        .put("channelName", s.channelName)
        .put("programmeTitle", s.programmeTitle)
        .put("startUtcMs", s.startUtcMs)
        .put("endUtcMs", s.endUtcMs)
        .put("padBeforeMin", s.padBeforeMin)
        .put("padAfterMin", s.padAfterMin)
        .put("volumeId", s.volumeId)
        .put("maxConnections", s.maxConnections)
        .put("status", s.status)
        .put("finishedAtMs", s.finishedAtMs)
        .also { o ->
            if (s.reason != null) o.put("reason", s.reason)
            if (s.recordingId != null) o.put("recordingId", s.recordingId)
        }

    private fun fromJson(o: JSONObject): Sched? {
        val id = o.optString("id")
        if (id.isEmpty()) return null
        return Sched(
            id = id,
            streamId = o.optLong("streamId"),
            host = o.optString("host"),
            userTag = o.optString("userTag"),
            startUtcMs = o.optLong("startUtcMs"),
            endUtcMs = o.optLong("endUtcMs"),
            padBeforeMin = o.optInt("padBeforeMin"),
            padAfterMin = o.optInt("padAfterMin"),
            status = o.optString("status", ScheduleStatus.SCHEDULED),
            channelName = o.optString("channelName"),
            programmeTitle = o.optString("programmeTitle"),
            volumeId = o.optString("volumeId", "box"),
            maxConnections = o.optInt("maxConnections"),
            reason = o.optString("reason").takeIf { it.isNotEmpty() },
            recordingId = o.optString("recordingId").takeIf { it.isNotEmpty() },
            finishedAtMs = o.optLong("finishedAtMs"),
        )
    }

    private fun read(ctx: Context): List<Sched> = try {
        val f = file(ctx)
        if (!f.exists()) emptyList() else {
            val arr = JSONArray(f.readText())
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::fromJson) }
        }
    } catch (_: Throwable) {
        emptyList()
    }

    private fun write(ctx: Context, list: List<Sched>) {
        try {
            val arr = JSONArray()
            list.forEach { arr.put(toJson(it)) }
            val tmp = File(ctx.filesDir, "$FILE.tmp")
            tmp.writeText(arr.toString())
            tmp.renameTo(file(ctx))
        } catch (_: Throwable) { /* the alarms still stand; the list is rebuilt on the next change */ }
    }

    fun all(ctx: Context): List<Sched> = synchronized(lock) { read(ctx) }

    fun get(ctx: Context, id: String): Sched? = synchronized(lock) { read(ctx).firstOrNull { it.id == id } }

    fun add(ctx: Context, s: Sched) = synchronized(lock) {
        write(ctx, read(ctx).filter { it.id != s.id } + s)
    }

    /** Changes one schedule; false when it isn't there any more. */
    fun update(ctx: Context, id: String, change: (Sched) -> Sched): Boolean = synchronized(lock) {
        val list = read(ctx)
        if (list.none { it.id == id }) return false
        write(ctx, list.map { if (it.id == id) change(it) else it })
        true
    }

    fun remove(ctx: Context, id: String) = synchronized(lock) {
        write(ctx, read(ctx).filter { it.id != id })
    }

    fun removeAll(ctx: Context) = synchronized(lock) { write(ctx, emptyList()) }

    /** These schedules are being recorded by [recordingId]. */
    fun markRecording(ctx: Context, ids: Collection<String>, recordingId: String) = synchronized(lock) {
        write(ctx, read(ctx).map {
            if (it.id in ids) it.copy(status = ScheduleStatus.RECORDING, recordingId = recordingId, reason = null) else it
        })
    }

    /** The recording ended: every schedule it carried is done (with the reason it stopped early, if any). */
    fun finishRecording(ctx: Context, recordingId: String, now: Long, reason: String?) = synchronized(lock) {
        val list = read(ctx)
        if (list.none { it.recordingId == recordingId && it.status == ScheduleStatus.RECORDING }) return@synchronized
        write(ctx, list.map {
            if (it.recordingId == recordingId && it.status == ScheduleStatus.RECORDING) {
                it.copy(status = ScheduleStatus.DONE, reason = reason, finishedAtMs = now)
            } else it
        })
    }

    /** A start that never became a recording: the schedules waiting on [recordingId] failed. */
    fun failRecording(ctx: Context, recordingId: String, now: Long, reason: String) = synchronized(lock) {
        val list = read(ctx)
        if (list.none { it.recordingId == recordingId && it.status == ScheduleStatus.RECORDING }) return@synchronized
        write(ctx, list.map {
            if (it.recordingId == recordingId && it.status == ScheduleStatus.RECORDING) {
                it.copy(status = ScheduleStatus.FAILED, reason = reason, finishedAtMs = now)
            } else it
        })
    }

    /** For the web list: names, times, ids and status. The line's host and account hash stay here. */
    fun toJs(s: Sched): JSObject = JSObject()
        .put("id", s.id)
        .put("streamId", s.streamId)
        .put("channelName", s.channelName)
        .put("programmeTitle", s.programmeTitle)
        .put("startUtcMs", s.startUtcMs)
        .put("endUtcMs", s.endUtcMs)
        .put("padBeforeMin", s.padBeforeMin)
        .put("padAfterMin", s.padAfterMin)
        .put("volumeId", s.volumeId)
        .put("status", s.status)
        .put("finishedAtMs", s.finishedAtMs)
        .also { o ->
            if (s.reason != null) o.put("reason", s.reason)
            if (s.recordingId != null) o.put("recordingId", s.recordingId)
        }
}
