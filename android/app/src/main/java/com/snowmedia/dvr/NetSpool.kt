package com.snowmedia.dvr

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * A recording to the network folder is never streamed straight to the
 * computer: the recording thread writes it on the box first, in chunks of
 * about 32 MB (getExternalFilesDir/net-spool/<recording id>/c00000.ts…),
 * and [NetUploader] appends each finished chunk to the one file on the
 * share, then deletes it. A computer that sleeps, reboots or drops off the
 * Wi-Fi costs nothing but box space for a while; the chunks wait and go when
 * it is back. A small manifest (upload.json) in the same folder says where
 * the file is going and how much of it is there, so uploading resumes after
 * the app or the box restarts.
 *
 * The manifest holds names, sizes, times and the folder's smb:// root (a
 * computer name, a share and a folder): no user name, no password.
 */
internal object NetSpool {
    /** A chunk is closed and handed to the uploader at this size (about 45 s of an HD channel). */
    const val CHUNK_BYTES = 32L * 1024L * 1024L
    private const val ROOT = "net-spool"
    private const val MANIFEST = "upload.json"
    private val CHUNK = Regex("^c(\\d{5,9})\\.ts$")

    fun root(ctx: Context): File = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, ROOT)

    fun dir(ctx: Context, id: String): File = File(root(ctx), id)

    // ---- chunks (pure) ----

    fun chunkName(index: Int): String = String.format(Locale.US, "c%05d.ts", index)

    fun chunkIndex(name: String): Int? = CHUNK.matchEntire(name)?.groupValues?.get(1)?.toIntOrNull()

    /** The chunk files of [dir] in recording order (by number, not by name: c100000 comes after c99999). */
    fun chunks(dir: File): List<File> =
        (dir.listFiles() ?: emptyArray()).mapNotNull { f -> chunkIndex(f.name)?.let { it to f } }.sortedBy { it.first }.map { it.second }

    /** The chunks that may go now: all of them, or only those before the one still being written. */
    fun uploadable(chunks: List<File>, writingIndex: Int?): List<File> =
        if (writingIndex == null) chunks else chunks.filter { (chunkIndex(it.name) ?: Int.MAX_VALUE) < writingIndex }

    fun next(current: File): File = File(current.parentFile, chunkName((chunkIndex(current.name) ?: 0) + 1))

    // ---- manifest (pure JSON, file I/O separate) ----

    data class Manifest(
        val id: String,
        /** The name asked for ("CNN.ts"); the share may need "CNN (2).ts". */
        val name: String,
        /** The file created on the share, once it is. */
        val remoteName: String? = null,
        /** Bytes already in that file (all chunks uploaded so far): the next chunk is written here. */
        val remoteBytes: Long = 0L,
        /**
         * The last chunk whose bytes are in [remoteBytes]. Written together with it, so a restart
         * between "uploaded" and "deleted" neither sends a chunk twice nor writes over one.
         */
        val lastChunk: Int = -1,
        /** The recording ended: every chunk left may go. */
        val finished: Boolean = false,
        val channel: String = "",
        val startedAt: Long = 0L,
        /** "smb://computer/share/folder/" when it started: where it is shown as going, even if the folder is changed later. */
        val root: String = "",
        val label: String = "",
        /** The file was deleted from the computer while uploading: the rest is dropped. */
        val gone: Boolean = false,
    ) {
        /** The name it has (or will have) on the share. */
        val shownName: String get() = remoteName ?: name
    }

    fun toJson(m: Manifest): String = JSONObject()
        .put("id", m.id)
        .put("name", m.name)
        .put("remoteName", m.remoteName ?: JSONObject.NULL)
        .put("remoteBytes", m.remoteBytes)
        .put("lastChunk", m.lastChunk)
        .put("finished", m.finished)
        .put("channel", m.channel)
        .put("startedAt", m.startedAt)
        .put("root", m.root)
        .put("label", m.label)
        .put("gone", m.gone)
        .toString()

    fun fromJson(s: String?): Manifest? {
        if (s.isNullOrBlank()) return null
        return try {
            val o = JSONObject(s)
            val id = o.optString("id")
            val name = o.optString("name")
            if (id.isEmpty() || !NetPathGuard.isRecordingName(name)) return null
            val remote = if (o.isNull("remoteName")) null else o.optString("remoteName").takeIf { NetPathGuard.isRecordingName(it) }
            Manifest(
                id = id, name = name, remoteName = remote,
                remoteBytes = o.optLong("remoteBytes", 0L).coerceAtLeast(0L),
                lastChunk = o.optInt("lastChunk", -1),
                finished = o.optBoolean("finished", false),
                channel = o.optString("channel"),
                startedAt = o.optLong("startedAt", 0L),
                root = o.optString("root"),
                label = o.optString("label"),
                gone = o.optBoolean("gone", false),
            )
        } catch (_: Throwable) {
            null
        }
    }

    fun read(dir: File): Manifest? = try {
        val f = File(dir, MANIFEST)
        if (f.exists()) fromJson(f.readText()) else null
    } catch (_: Throwable) {
        null
    }

    /** Written whole and renamed into place, so a crash leaves the old one or the new one, never half. */
    fun write(dir: File, m: Manifest) {
        dir.mkdirs()
        val tmp = File(dir, "$MANIFEST.tmp")
        tmp.writeText(toJson(m))
        if (!tmp.renameTo(File(dir, MANIFEST))) throw java.io.IOException("manifest")
    }

    /** Bytes on the box still waiting to go. */
    fun pendingBytes(dir: File): Long = chunks(dir).sumOf { it.length() }

    fun deleteAll(dir: File) {
        dir.listFiles()?.forEach { it.delete() }
        dir.delete()
    }
}

/**
 * Moves finished chunks from the box to the network folder, one recording
 * after another, on one background thread. Started by a new chunk, a
 * finished recording, the plugin loading, the Recordings list and the
 * recording service starting (any of them resumes what an earlier run left).
 *
 * When the computer can't be reached the chunks stay and it tries again
 * after 15 s, then 30, then every 60 s; nothing stops a recording but the
 * box's own free space (RecordingService's usual floor). When the share has
 * less than 1 GB free, recordings to it stop as "The drive is full".
 */
internal object NetUploader {
    private const val TAG = "SmcNetUpload"
    private const val FIRST_BACKOFF_MS = 15_000L
    private const val MAX_BACKOFF_MS = 60_000L
    /** While recordings only have the chunk being written, look again at least this often. */
    private const val WAITING_MS = 30_000L
    /** How often the share's free space is checked while uploading. */
    private const val SPACE_EVERY_MS = 5L * 60_000L

    /** Recording id -> the chunk its recording thread is writing (that one never goes until it is closed). */
    private val writing = ConcurrentHashMap<String, Int>()
    private val lock = Object()
    private var thread: Thread? = null
    private var kicked = false
    @Volatile private var lastSpaceCheck = 0L
    /** The last attempt couldn't reach the share: the recording service doesn't wait for uploads then. */
    @Volatile var stalled = false
        private set

    fun writingChunk(id: String, index: Int) { writing[id] = index }

    fun doneWriting(id: String) { writing.remove(id) }

    /** Something may be ready: start the thread if it isn't running, wake it if it is. */
    fun kick(ctx: Context) {
        val app = ctx.applicationContext
        synchronized(lock) {
            kicked = true
            if (thread?.isAlive != true) {
                thread = Thread({ run(app) }, "smc-net-upload").apply { isDaemon = true; start() }
            }
            lock.notifyAll()
        }
    }

    /** Anything in the spool at all (cheap: one directory listing). */
    fun hasWork(ctx: Context): Boolean = NetSpool.root(ctx).listFiles()?.any { it.isDirectory } == true

    /** A recording waiting to go (or going) to the share, as the Recordings list shows it. */
    class Pending(val manifest: NetSpool.Manifest, val pendingBytes: Long)

    fun pending(ctx: Context): List<Pending> =
        (NetSpool.root(ctx).listFiles() ?: emptyArray()).filter { it.isDirectory }.mapNotNull { d ->
            val m = NetSpool.read(d) ?: return@mapNotNull null
            if (m.gone) null else Pending(m, NetSpool.pendingBytes(d))
        }

    /** The viewer deleted a recording that hadn't finished going to the share: drop what is left on the box. */
    fun discard(ctx: Context, id: String) {
        val d = NetSpool.dir(ctx, id)
        synchronized(lock) {
            val m = NetSpool.read(d)
            if (m != null) try { NetSpool.write(d, m.copy(gone = true)) } catch (_: Throwable) { /* deleted below anyway */ }
            NetSpool.chunks(d).forEach { it.delete() }
            if (writing[id] == null) NetSpool.deleteAll(d)
        }
    }

    private enum class Pass { IDLE, WAITING, FAILED, NO_FOLDER }

    private fun run(app: Context) {
        var backoff = FIRST_BACKOFF_MS
        while (true) {
            synchronized(lock) { kicked = false }
            val outcome = try { pass(app) } catch (t: Throwable) {
                Log.w(TAG, "Upload pass failed (${t.javaClass.simpleName})")
                Pass.FAILED
            }
            when (outcome) {
                Pass.IDLE -> synchronized(lock) {
                    stalled = false
                    if (!kicked) { thread = null; return }
                }
                // Chunks wait for a network folder to be set up again (saveNetworkFolder kicks).
                Pass.NO_FOLDER -> synchronized(lock) {
                    stalled = true
                    if (!kicked) { thread = null; return }
                }
                Pass.WAITING -> { backoff = FIRST_BACKOFF_MS; waitForKick(WAITING_MS) }
                Pass.FAILED -> {
                    stalled = true
                    // The full wait: a new chunk arriving every 45 s must not turn the backoff into hammering.
                    sleepQuietly(backoff)
                    backoff = minOf(backoff * 2, MAX_BACKOFF_MS)
                }
            }
        }
    }

    private fun waitForKick(ms: Long) = synchronized(lock) {
        if (!kicked) try { lock.wait(ms) } catch (_: InterruptedException) { /* go round */ }
    }

    private fun sleepQuietly(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) { /* go round */ }

    private fun pass(app: Context): Pass {
        val dirs = (NetSpool.root(app).listFiles() ?: emptyArray()).filter { it.isDirectory }
        if (dirs.isEmpty()) return Pass.IDLE
        val cfg = NetFolderStore.read(app)
        var waiting = false
        val work = dirs.mapNotNull { d -> NetSpool.read(d)?.let { d to it } ?: run { orphan(d); null } }.sortedBy { it.second.startedAt }
        for ((dir, m0) in work) {
            val id = m0.id
            val active = RecordingService.jobs.containsKey(id)
            val writingIdx = writing[id]
            if (m0.gone) {
                NetSpool.chunks(dir).filter { writingIdx == null || (NetSpool.chunkIndex(it.name) ?: 0) < writingIdx }.forEach { it.delete() }
                if (!active && writingIdx == null) NetSpool.deleteAll(dir)
                continue
            }
            val ready = NetSpool.uploadable(NetSpool.chunks(dir), writingIdx)
            if (ready.isEmpty()) {
                if (!active && writingIdx == null && m0.remoteName != null) {
                    // Everything is on the share: done.
                    NetSpool.deleteAll(dir)
                    RecorderPlugin.emitChanged()
                } else if (!active && writingIdx == null && NetSpool.chunks(dir).isEmpty()) {
                    // Ended before writing a byte: nothing to send.
                    NetSpool.deleteAll(dir)
                    RecordingStore.forget(app, id)
                    RecorderPlugin.emitChanged()
                } else {
                    waiting = true
                }
                continue
            }
            // No folder set up (it was cleared): keep the chunks until one is, or the viewer deletes the recording.
            if (cfg == null) return Pass.NO_FOLDER
            try {
                upload(app, cfg, dir, m0, ready)
                stalled = false
            } catch (t: Throwable) {
                if (t is NetFailure && t.reason == GONE) {
                    // Deleted on the computer while still uploading: drop the rest, it isn't wanted, and
                    // stop recording it if it still is (a stream on the line for nothing otherwise).
                    NetSpool.read(dir)?.let { NetSpool.write(dir, it.copy(gone = true)) }
                    RecordingService.jobFor(id)?.stop()
                    RecordingStore.forget(app, id)
                    RecorderPlugin.emitChanged()
                    continue
                }
                if (NetErrors.isDiskFull(t)) {
                    // Reached, but full: the recordings going there stop; what is spooled waits for room.
                    NetStatus.record(cfg.key, true, 0L)
                    RecordingService.shareFull()
                } else {
                    NetStatus.record(cfg.key, false)
                }
                // Never the message (it may name the computer or the folder).
                Log.w(TAG, "Upload waiting for the network folder (${t.javaClass.simpleName})")
                return Pass.FAILED
            }
            if (!active && writing[id] == null && NetSpool.chunks(dir).isEmpty()) {
                NetSpool.deleteAll(dir)
                RecorderPlugin.emitChanged()
            } else {
                waiting = true
            }
        }
        return if (waiting) Pass.WAITING else if ((NetSpool.root(app).listFiles() ?: emptyArray()).any { it.isDirectory }) Pass.WAITING else Pass.IDLE
    }

    /** A spool folder with no readable manifest: a start that never became a recording (or a damaged one). */
    private fun orphan(d: File) {
        val id = d.name
        if (RecordingService.jobs.containsKey(id) || writing.containsKey(id)) return
        if (System.currentTimeMillis() - d.lastModified() < 60_000L) return
        NetSpool.deleteAll(d)
    }

    private const val GONE = "gone"

    private fun upload(app: Context, cfg: NetFolder, dir: File, m0: NetSpool.Manifest, ready: List<File>) {
        NetShare.withShare(app) { c ->
            NetShare.ensureFolder(c)
            var m = NetSpool.read(dir) ?: m0
            val root = NetFolderRules.smbRoot(cfg)
            if (m.remoteName != null && !m.root.equals(root, ignoreCase = true)) {
                // The network folder was changed while this one was half-way: the old one can't be reached
                // any more (its sign-in is gone), so the rest becomes a file of its own in the new folder.
                m = m.copy(remoteName = null, remoteBytes = 0L)  // lastChunk stays: those chunks went to the old folder
            }
            if (m.remoteName == null) {
                // The file is created on its first chunk, under a name nobody else has (another box, an older recording).
                var name = NetShare.uniqueName(c, m.name)
                var tries = 0
                while (true) {
                    try { NetShare.createNew(c, name); break } catch (t: Throwable) {
                        if (!NetErrors.isNameTaken(t) || ++tries > 5) throw t
                        name = NetShare.uniqueName(c, m.name)
                    }
                }
                m = m.copy(remoteName = name, remoteBytes = 0L, root = NetFolderRules.smbRoot(cfg), label = cfg.label)
                NetSpool.write(dir, m)
                RecordingStore.setPath(app, m.id, NetFolderRules.smbUrl(cfg, name))
                RecorderPlugin.emitChanged()
            }
            val remote = m.remoteName ?: return@withShare
            for (chunk in ready) {
                if (!chunk.exists()) continue
                // Already in the file (the app stopped between sending it and deleting it here).
                if ((NetSpool.chunkIndex(chunk.name) ?: Int.MAX_VALUE) <= m.lastChunk) { chunk.delete(); continue }
                try {
                    NetShare.writeAt(c, remote, m.remoteBytes, chunk)
                } catch (t: Throwable) {
                    if (NetErrors.isNotFound(t)) throw NetFailure(GONE, t)
                    throw t
                }
                m = m.copy(remoteBytes = m.remoteBytes + chunk.length(), lastChunk = NetSpool.chunkIndex(chunk.name) ?: m.lastChunk)
                NetSpool.write(dir, m)
                chunk.delete()
            }
            val now = System.currentTimeMillis()
            if (now - lastSpaceCheck > SPACE_EVERY_MS) {
                lastSpaceCheck = now
                val (free, total) = NetShare.space(c)
                NetStatus.record(cfg.key, true, free, total)
                if (free in 0 until NetShare.SHARE_MIN_FREE_BYTES) RecordingService.shareFull()
            } else {
                NetStatus.record(cfg.key, true)
            }
        }
    }
}
