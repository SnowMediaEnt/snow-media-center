package com.snowmedia.dvr

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Where recordings live and what is known about them.
 *
 * Files go to the app's own folder on each storage volume
 * (getExternalFilesDirs: the box itself, and a USB drive or SD card when one
 * is mounted), in "Download/Recordings". Those folders need no storage
 * permission on any Android version, and no document picker (Fire TV has
 * none). They are removed if the app is uninstalled.
 *
 * A small index (filesDir/recordings.json) keeps each recording's channel,
 * start and end; the files themselves are the truth (a file deleted from a
 * computer simply drops out of the list). Nothing here is under the rewind
 * buffer's folder, so its wipes never reach a recording. The index holds
 * names, times and ids only: never a stream address, a user name or a
 * password.
 *
 * SMC's space rules live here so the service, the plugin and (later) the
 * scheduler read the same numbers: the box keeps 1 GB free, a USB drive
 * 200 MB, and a removable drive (possibly FAT32) is split into parts.
 */
internal object RecordingStore {
    private const val INDEX = "recordings.json"
    private const val FOLDER = "Recordings"
    private val lock = Any()

    /** A recording stops before the box's own storage has less than this free (app updates and the WebView need it). */
    const val BOX_MIN_FREE_BYTES = 1L shl 30
    /** The same for a USB drive or SD card, which nothing else lives on. */
    const val USB_MIN_FREE_BYTES = 200L * 1024L * 1024L
    /** A new recording is refused unless it has this much room above the floor. */
    const val START_HEADROOM_BYTES = 100L * 1024L * 1024L
    /** FAT32 holds files up to 4 GiB - 1 byte: a part ends at about 3.9 GB, well inside it. */
    const val PART_LIMIT_BYTES = 39L * 1024L * 1024L * 1024L / 10L

    fun minFreeBytes(removable: Boolean): Long = if (removable) USB_MIN_FREE_BYTES else BOX_MIN_FREE_BYTES

    /** Parts only on a removable drive (a stick may be FAT32); the box's own storage has no such limit. */
    fun partLimitBytes(removable: Boolean): Long = if (removable) PART_LIMIT_BYTES else Long.MAX_VALUE

    class Volume(val id: String, val label: String, val dir: File, val removable: Boolean) {
        val freeBytes: Long get() = StorageBudget.volumeOf(dir)?.first ?: dir.usableSpace
        val totalBytes: Long get() = StorageBudget.volumeOf(dir)?.second ?: dir.totalSpace
    }

    /** Mounted volumes the app can write to, the box's own first. */
    fun volumes(ctx: Context): List<Volume> {
        val out = ArrayList<Volume>()
        val dirs = try { ctx.getExternalFilesDirs(Environment.DIRECTORY_DOWNLOADS) } catch (_: Throwable) { emptyArray<File?>() }
        val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
        dirs.forEachIndexed { i, base ->
            if (base == null) return@forEachIndexed
            val mounted = try { Environment.getExternalStorageState(base) == Environment.MEDIA_MOUNTED } catch (_: Throwable) { false }
            if (!mounted) return@forEachIndexed
            val sv = try { sm?.getStorageVolume(base) } catch (_: Throwable) { null }
            val removable = sv?.isRemovable ?: (i > 0)
            val id = if (i == 0) "box" else (sv?.uuid ?: "vol$i")
            val label = when {
                i == 0 && !removable -> "This box"
                else -> sv?.getDescription(ctx)?.takeIf { it.isNotBlank() } ?: "USB drive"
            }
            out.add(Volume(id, label, File(base, FOLDER), removable))
        }
        // Some boxes report no external files dir at all: fall back to internal storage.
        if (out.isEmpty()) out.add(Volume("box", "This box", File(ctx.filesDir, FOLDER), false))
        return out
    }

    fun volume(ctx: Context, id: String?): Volume? {
        val all = volumes(ctx)
        return all.firstOrNull { it.id == id } ?: if (id.isNullOrBlank()) all.firstOrNull() else null
    }

    /** A name safe on any file system (FAT on USB drives included), ".ts" added. */
    fun safeName(name: String): String {
        var n = name.replace(Regex("[\\\\/:*?\"<>|#%\\u0000-\\u001F]"), " ").replace(Regex("\\s+"), " ").trim()
        if (n.lowercase().endsWith(".ts")) n = n.dropLast(3).trim()
        n = n.trim('.', ' ')
        if (n.length > 120) n = n.take(120).trim()
        if (n.isEmpty()) n = "Recording"
        return "$n.ts"
    }

    /** [name] in [dir], with " (2)", " (3)"… when it is taken. */
    fun uniqueFile(dir: File, name: String): File {
        val base = name.removeSuffix(".ts")
        var f = File(dir, name)
        var n = 2
        while (f.exists()) { f = File(dir, "$base ($n).ts"); n++ }
        return f
    }

    /** "<first name> (part 2).ts", next to the first part; a taken name gets " (2)" like any other. */
    fun partFile(first: File, n: Int): File {
        val dir = first.parentFile ?: return first
        return uniqueFile(dir, "${first.name.removeSuffix(".ts")} (part $n).ts")
    }

    /** Is [f] one of our recordings (inside a Recordings folder of ours)? Guards rename and delete. */
    fun isOurs(ctx: Context, f: File): Boolean {
        val path = try { f.canonicalPath } catch (_: Throwable) { return false }
        if (!path.endsWith(".ts")) return false
        return volumes(ctx).any { v ->
            val root = try { v.dir.canonicalPath } catch (_: Throwable) { return@any false }
            path.startsWith(root + File.separator)
        }
    }

    fun playUrl(f: File): String = Uri.fromFile(f).toString()

    // ---- index ----

    private fun indexFile(ctx: Context) = File(ctx.filesDir, INDEX)

    private fun readIndex(ctx: Context): JSONArray = try {
        val f = indexFile(ctx)
        if (f.exists()) JSONArray(f.readText()) else JSONArray()
    } catch (_: Throwable) {
        JSONArray()
    }

    private fun writeIndex(ctx: Context, arr: JSONArray) {
        try {
            val tmp = File(ctx.filesDir, "$INDEX.tmp")
            tmp.writeText(arr.toString())
            tmp.renameTo(indexFile(ctx))
        } catch (_: Throwable) { /* the files still list, without their details */ }
    }

    /** [scheduleId] and [title] are set by a scheduled recording (later); a manual one has neither. */
    fun begin(
        ctx: Context, id: String, file: File, channel: String, startedAt: Long,
        scheduleId: String? = null, title: String? = null,
    ) = synchronized(lock) {
        val arr = readIndex(ctx)
        val o = JSONObject().put("id", id).put("path", file.absolutePath).put("channel", channel).put("startedAt", startedAt)
        if (scheduleId != null) o.put("scheduleId", scheduleId)
        if (title != null) o.put("title", title)
        arr.put(o)
        writeIndex(ctx, arr)
    }

    fun finish(ctx: Context, id: String, endedAt: Long) = synchronized(lock) {
        val arr = readIndex(ctx)
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == id) o.put("endedAt", endedAt)
        }
        writeIndex(ctx, arr)
    }

    fun renamed(ctx: Context, from: File, to: File) = synchronized(lock) {
        val arr = readIndex(ctx)
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("path") == from.absolutePath) o.put("path", to.absolutePath)
        }
        writeIndex(ctx, arr)
    }

    /** Every recording on every mounted volume, newest first; index entries whose file is gone are dropped. */
    fun list(ctx: Context): List<JSONObject> = synchronized(lock) {
        val arr = readIndex(ctx)
        val byPath = HashMap<String, JSONObject>()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { byPath[it.optString("path")] = it }
        val out = ArrayList<JSONObject>()
        val seen = HashSet<String>()
        for (v in volumes(ctx)) {
            val files = v.dir.listFiles { f -> f.isFile && f.name.endsWith(".ts") } ?: continue
            for (f in files) {
                val meta = byPath[f.absolutePath]
                seen.add(f.absolutePath)
                val id = meta?.optString("id")?.takeIf { it.isNotEmpty() }
                val active = id != null && RecordingService.isActive(id)
                val started = meta?.optLong("startedAt", 0L) ?: 0L
                val ended = meta?.optLong("endedAt", 0L) ?: 0L
                val end = when {
                    active -> System.currentTimeMillis()
                    ended > 0 -> ended
                    else -> f.lastModified()
                }
                out.add(
                    JSONObject()
                        .put("id", id ?: f.absolutePath)
                        .put("name", f.name.removeSuffix(".ts"))
                        .put("channel", meta?.optString("channel") ?: "")
                        .put("path", f.absolutePath)
                        .put("playUrl", playUrl(f))
                        .put("bytes", f.length())
                        .put("startedAt", if (started > 0) started else f.lastModified())
                        .put("durationSec", if (started > 0 && end > started) (end - started) / 1000L else 0L)
                        .put("recording", active)
                        .put("volumeId", v.id)
                        .put("volumeLabel", v.label),
                )
            }
        }
        // Forget files that are gone, but keep entries of volumes not mounted right now.
        val mountedRoots = volumes(ctx).map { it.dir.absolutePath + File.separator }
        val keep = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val path = o.optString("path")
            val onMounted = mountedRoots.any { path.startsWith(it) }
            if (!onMounted || seen.contains(path)) keep.put(o)
        }
        if (keep.length() != arr.length()) writeIndex(ctx, keep)
        out.sortByDescending { it.optLong("startedAt") }
        out
    }
}
