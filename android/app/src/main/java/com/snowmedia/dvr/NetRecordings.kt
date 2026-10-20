package com.snowmedia.dvr

import android.content.Context
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** A refusal the viewer reads as it is (plain words, no host or path in it). */
internal class NetUserError(message: String) : Exception(message)

/**
 * Recordings in the network folder, as the Recordings screen and the Record
 * dialog see them: the "net" drive, the list (the folder's *.ts files, so a
 * file added or deleted on the computer shows up or drops out, merged with
 * the index for channel and times, plus what is still on its way from the
 * box), rename and delete on the share, and where a new recording goes.
 */
internal object NetRecordings {
    const val VOLUME_ID = "net"
    /** list() waits this long for the folder's listing; past it, the recordings still on the box are shown alone. */
    private const val LIST_WAIT_MS = 4_000L
    /** getVolumes never waits longer than this on the network (a stale answer comes back instead). */
    private const val VOLUME_WAIT_MS = 2_000L
    /** After a failed attempt, list() doesn't wait on the network again for this long. */
    private const val UNREACHABLE_SKIP_MS = 15_000L

    private val exec = Executors.newCachedThreadPool { r -> Thread(r, "smc-net-list").apply { isDaemon = true } }

    /** The last listing's names (lowercase) for a folder key: a new recording's name is chosen against it without a network call. */
    @Volatile private var lastNames: Pair<String, Set<String>>? = null

    /** The "net" drive for getVolumes / list, or null when no network folder is set up. */
    fun volumeJson(ctx: Context): JSObject? {
        val f = NetFolderStore.read(ctx) ?: return null
        val s = NetStatus.current(ctx, f, VOLUME_WAIT_MS)
        return JSObject()
            .put("id", VOLUME_ID)
            .put("label", f.label)
            .put("removable", false)
            .put("freeBytes", s?.freeBytes ?: 0L)
            .put("totalBytes", s?.totalBytes ?: 0L)
            .put("network", true)
            .put("reachable", s?.reachable == true)
    }

    /** Where recording [id] goes: its name on the share and its first chunk on the box. */
    class Target(val name: String, val firstChunk: File, val path: String)

    /**
     * Picks the name (free in the folder as last listed, and among the
     * recordings still on their way) and the first chunk. No network call:
     * the uploader makes sure of the name when it creates the file.
     */
    fun prepare(ctx: Context, id: String, fileName: String): Target? {
        val f = NetFolderStore.read(ctx) ?: return null
        val taken = HashSet<String>()
        lastNames?.takeIf { it.first == f.key }?.second?.let { taken.addAll(it) }
        val root = NetFolderRules.smbRoot(f)
        for (p in NetUploader.pending(ctx)) if (p.manifest.root.equals(root, ignoreCase = true)) taken.add(p.manifest.shownName.lowercase())
        val name = uniqueAgainst(RecordingStore.safeName(fileName), taken)
        return Target(name, File(NetSpool.dir(ctx, id), NetSpool.chunkName(0)), NetFolderRules.smbUrl(f, name))
    }

    /** [name], or "<name> (2).ts", "(3)"… when [takenLower] has it. Pure: NetRecordingsTest. */
    fun uniqueAgainst(name: String, takenLower: Set<String>): String {
        val base = name.removeSuffix(".ts")
        var candidate = name
        var n = 2
        while (candidate.lowercase() in takenLower && n < 10_000) { candidate = "$base ($n).ts"; n++ }
        return candidate
    }

    /** The recording service took the job: its manifest and index entry, and the uploader learns which chunk is open. */
    fun began(ctx: Context, id: String, name: String, firstChunk: File, channel: String, startedAt: Long, scheduleId: String?, title: String?) {
        val f = NetFolderStore.read(ctx)
        val root = f?.let { NetFolderRules.smbRoot(it) } ?: ""
        NetUploader.writingChunk(id, NetSpool.chunkIndex(firstChunk.name) ?: 0)
        val dir = firstChunk.parentFile ?: NetSpool.dir(ctx, id)
        try {
            NetSpool.create(dir, NetSpool.Manifest(id = id, name = name, channel = channel, startedAt = startedAt, root = root, label = f?.label ?: ""))
        } catch (_: Throwable) { /* the recording still writes; the uploader rebuilds nothing without it, see orphan() */ }
        RecordingStore.beginNet(ctx, id, root + name, channel, startedAt, scheduleId, title)
    }

    /** The recording thread closed its last chunk: everything left may go. */
    fun ended(ctx: Context, id: String) {
        NetUploader.doneWriting(id)
        val dir = NetSpool.dir(ctx, id)
        // Through the manifest lock, re-read first: never an older copy written over the uploader's progress.
        try { NetSpool.update(dir) { it.copy(finished = true) } } catch (_: Throwable) { /* informational */ }
        NetUploader.kick(ctx)
    }

    // ---- list ----

    private fun listing(ctx: Context, f: NetFolder): List<NetShare.RemoteFile>? {
        val s = NetStatus.peek(f.key)
        if (s != null && !s.reachable && System.currentTimeMillis() - s.atMs < UNREACHABLE_SKIP_MS) return null
        val fut = exec.submit(Callable { NetShare.withShare(ctx) { NetShare.listRecordings(it) } })
        return try {
            fut.get(LIST_WAIT_MS, TimeUnit.MILLISECONDS).also { NetStatus.record(f.key, true) }
        } catch (_: TimeoutException) {
            null // still trying in the background; the next list() may have it
        } catch (_: ExecutionException) {
            NetStatus.record(f.key, false)
            null
        } catch (_: Throwable) {
            null
        }
    }

    /** The network recordings, in the shape RecordingStore.list gives local ones (plus "uploading"). */
    fun list(ctx: Context): List<JSONObject> {
        val app = ctx.applicationContext
        val f = NetFolderStore.read(app)
        val pend = NetUploader.pending(app)
        if (pend.isNotEmpty()) NetUploader.kick(app)
        if (f == null && pend.isEmpty()) return emptyList()
        val index = RecordingStore.netEntries(app)
        val byId = index.associateBy { it.optString("id") }
        val byPath = index.associateBy { it.optString("path").lowercase() }
        val pendById = pend.associateBy { it.manifest.id }
        val shown = HashSet<String>()
        val out = ArrayList<JSONObject>()
        val remote = f?.let { listing(app, it) }
        if (f != null && remote != null) {
            val root = NetFolderRules.smbRoot(f)
            for (r in remote) {
                val path = NetFolderRules.smbUrl(f, r.name)
                val meta = byPath[path.lowercase()]
                val id = meta?.optString("id")?.takeIf { it.isNotEmpty() }
                val p = id?.let { pendById[it] }
                out.add(item(id ?: path, r.name, meta, path, NetPlayServer.url(app, r.name), r.bytes + (p?.pendingBytes ?: 0L), r.modifiedMs, p != null, f.label))
                if (id != null) shown.add(id)
            }
            val names = remote.map { it.name.lowercase() }.toSet()
            lastNames = f.key to names
            RecordingStore.pruneNet(app, root, names) { o ->
                val id = o.optString("id")
                RecordingService.jobs.containsKey(id) || pendById.containsKey(id)
            }
        }
        // Still (partly) on the box: not on the share yet, or the share can't be reached right now.
        val root = f?.let { NetFolderRules.smbRoot(it) }
        for (p in pend) {
            val m = p.manifest
            if (m.id in shown) continue
            val meta = byId[m.id]
            val path = meta?.optString("path")?.takeIf { it.isNotEmpty() } ?: (m.root + m.shownName)
            val here = root != null && path.regionMatches(0, root, 0, root.length, ignoreCase = true)
            val label = if (here) f!!.label else m.label
            // Playable only once its file exists on the share under a name of its own: before that the name
            // is a guess (the uploader may still need "(2)", and that file could be another box's).
            val url = if (here && m.remoteName != null) NetPlayServer.url(app, m.remoteName) else ""
            out.add(item(m.id, path.substringAfterLast('/'), meta, path, url, m.remoteBytes + p.pendingBytes, System.currentTimeMillis(), true, label))
        }
        return out
    }

    private fun item(
        id: String, fileName: String, meta: JSONObject?, path: String, playUrl: String,
        bytes: Long, modifiedMs: Long, uploading: Boolean, label: String,
    ): JSONObject {
        val active = RecordingService.isActive(id)
        val started = meta?.optLong("startedAt", 0L) ?: 0L
        val ended = meta?.optLong("endedAt", 0L) ?: 0L
        val end = when {
            active -> System.currentTimeMillis()
            ended > 0 -> ended
            else -> modifiedMs
        }
        return JSONObject()
            .put("id", id)
            .put("name", fileName.removeSuffix(".ts"))
            .put("channel", meta?.optString("channel") ?: "")
            .put("path", path)
            .put("playUrl", playUrl)
            .put("bytes", bytes)
            .put("startedAt", if (started > 0) started else modifiedMs)
            .put("durationSec", if (started > 0 && end > started) (end - started) / 1000L else 0L)
            .put("recording", active)
            .put("uploading", uploading)
            .put("volumeId", VOLUME_ID)
            .put("volumeLabel", label)
    }

    fun isNetPath(path: String?): Boolean = path?.startsWith("smb://", ignoreCase = true) == true

    private fun idForPath(ctx: Context, path: String): String? =
        RecordingStore.netEntries(ctx).firstOrNull { it.optString("path").equals(path, ignoreCase = true) }?.optString("id")?.takeIf { it.isNotEmpty() }

    private fun pendingFor(ctx: Context, path: String, id: String?): NetUploader.Pending? =
        NetUploader.pending(ctx).firstOrNull { it.manifest.id == id || (it.manifest.root + it.manifest.shownName).equals(path, ignoreCase = true) }

    private fun unreachable(f: NetFolder?): NetUserError = NetUserError("${f?.label ?: "The network folder"} can't be reached right now")

    /** Renames a network recording on the share. Throws [NetUserError] with what to tell the viewer. */
    fun rename(ctx: Context, path: String, newName: String): JSObject {
        val f = NetFolderStore.read(ctx) ?: throw NetUserError("Recording not found")
        val from = NetFolderRules.nameFromSmbUrl(f, path) ?: throw NetUserError("Recording not found")
        val id = idForPath(ctx, path)
        if (id != null && RecordingService.isActive(id)) throw NetUserError("Stop the recording before renaming it")
        // The uploader appends to the file by name until the last chunk is there.
        if (pendingFor(ctx, path, id) != null) throw NetUserError("Wait until it has finished saving to ${f.label}")
        val to = RecordingStore.safeName(newName)
        val newPath = NetFolderRules.smbUrl(f, to)
        if (to != from) {
            try {
                NetShare.withShare(ctx) { c ->
                    if (!NetShare.exists(c, from)) throw NetUserError("Recording not found")
                    if (!to.equals(from, ignoreCase = true) && NetShare.exists(c, to)) throw NetUserError("A recording with that name already exists")
                    NetShare.rename(c, from, to)
                }
            } catch (e: NetUserError) {
                throw e
            } catch (t: Throwable) {
                if (NetErrors.reason(t, NetStage.WRITE) == NetReason.UNREACHABLE) throw unreachable(f)
                throw NetUserError("Could not rename")
            }
            RecordingStore.renamedPath(ctx, path, newPath)
        }
        return JSObject().put("path", newPath).put("name", to.removeSuffix(".ts")).put("playUrl", NetPlayServer.url(ctx, to))
    }

    /** Deletes a network recording: from the share, and whatever of it is still on the box. */
    fun remove(ctx: Context, path: String) {
        val f = NetFolderStore.read(ctx)
        val id = idForPath(ctx, path)
        if (id != null && RecordingService.isActive(id)) throw NetUserError("Stop the recording before deleting it")
        val pending = pendingFor(ctx, path, id)
        val name = f?.let { NetFolderRules.nameFromSmbUrl(it, path) }
        if (name == null && pending == null) throw NetUserError("Recording not found")
        pending?.let { NetUploader.discard(ctx, it.manifest.id) }
        if (name != null) {
            try {
                NetShare.withShare(ctx) { NetShare.remove(it, name) }
            } catch (t: Throwable) {
                // Its chunks are gone from the box already; what reached the share stays until it can be reached.
                if (pending == null) {
                    if (NetErrors.reason(t, NetStage.WRITE) == NetReason.UNREACHABLE) throw unreachable(f)
                    throw NetUserError("Could not delete")
                }
            }
        }
        (id ?: pending?.manifest?.id)?.let { RecordingStore.forget(ctx, it) }
    }
}
