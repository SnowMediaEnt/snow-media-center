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
 */
@CapacitorPlugin(name = "SnowRecorder")
class RecorderPlugin : Plugin() {

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
}
