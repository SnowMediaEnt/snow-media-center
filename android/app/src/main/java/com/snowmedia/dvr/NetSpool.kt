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
        /** The viewer deleted the recording in the app while it was still going: the rest is dropped. */
        val gone: Boolean = false,
        /**
         * Which file of the recording is being filled: 1, or 2, 3… after the
         * file went missing on the computer mid-way (renamed, moved or deleted
         * there) and the rest carried on in "<name> (part 2).ts".
         */
        val part: Int = 1,
    ) {
        /** The name it has (or will have) on the share. */
        val shownName: String get() = remoteName ?: wantedName(this)
    }

    /** The name to create the current file under (before making it unique): "CNN.ts", then "CNN (part 2).ts". Pure. */
    fun wantedName(m: Manifest): String =
        if (m.part <= 1) m.name else "${m.name.removeSuffix(".ts")} (part ${m.part}).ts"

    /**
     * The file on the share is gone (renamed, moved or deleted on the
     * computer): nothing is dropped, the rest goes into a new file, the next
     * part. The chunks already sent stay counted in [Manifest.lastChunk]. Pure.
     */
    fun continueInNewFile(m: Manifest): Manifest =
        if (m.remoteName == null) m else m.copy(remoteName = null, remoteBytes = 0L, part = m.part + 1)

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
        .put("part", m.part)
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
                part = o.optInt("part", 1).coerceAtLeast(1),
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

    /**
     * Every change to a manifest (the uploader's progress, the recording's
     * end, a delete from the app) goes through this one lock and re-reads the
     * file first, so no writer can put back an older copy: a stale
     * remoteBytes would send the next chunk to an old offset, over what is
     * already there.
     */
    private val manifestLock = Any()

    /** The first manifest of a recording (the recording service, when the job starts). */
    fun create(dir: File, m: Manifest) = synchronized(manifestLock) {
        dir.mkdirs()
        writeFile(dir, m)
    }

    /** Re-reads the manifest, applies [change] and writes it, in one step. Null (and nothing written) when there is none any more. */
    fun update(dir: File, change: (Manifest) -> Manifest): Manifest? = synchronized(manifestLock) {
        val cur = read(dir) ?: return null
        val next = change(cur)
        if (next != cur) writeFile(dir, next)
        next
    }

    /** Written whole to a temp file of its own and renamed into place: a crash leaves the old one or the new one, never half. */
    private fun writeFile(dir: File, m: Manifest) {
        val tmp = File.createTempFile("$MANIFEST.", ".tmp", dir)
        try {
            tmp.writeText(toJson(m))
            if (!tmp.renameTo(File(dir, MANIFEST))) throw java.io.IOException("manifest")
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }

    /** Bytes on the box still waiting to go. */
    fun pendingBytes(dir: File): Long = chunks(dir).sumOf { it.length() }

    fun deleteAll(dir: File) = synchronized(manifestLock) {
        dir.listFiles()?.forEach { it.delete() }
        dir.delete()
        Unit
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
 * box's own free space (RecordingService's usual floor). A problem with one
 * file only (the viewer has it open on the computer, no right to write it)
 * holds that recording back the same way and lets the others carry on. A
 * file that disappears from the computer mid-way (renamed, moved, deleted
 * there) is never a reason to drop anything: the rest goes into
 * "<name> (part 2).ts". When the share has less than 1 GB free, recordings
 * to it stop as "The drive is full".
 */
internal object NetUploader {
    private const val TAG = "SmcNetUpload"
    private const val FIRST_BACKOFF_MS = 15_000L
    private const val MAX_BACKOFF_MS = 60_000L
    /** While recordings only have the chunk being written, look again at least this often. */
    private const val WAITING_MS = 30_000L
    /** How often the share's free space is checked while uploading. */
    private const val SPACE_EVERY_MS = 5L * 60_000L
    /** A file that keeps vanishing (something on the computer removes each new part) is retried later, not chased. */
    private const val MAX_NEW_FILES_PER_PASS = 3

    /** Recording id -> the chunk its recording thread is writing (that one never goes until it is closed). */
    private val writing = ConcurrentHashMap<String, Int>()
    /** Recording id -> when to try its file again, and its current wait, after a problem with that file only. */
    private val retryAt = ConcurrentHashMap<String, Long>()
    private val fileBackoff = ConcurrentHashMap<String, Long>()
    private val lock = Object()
    private var thread: Thread? = null
    private var kicked = false
    @Volatile private var lastSpaceCheck = 0L
    /** How long the last WAITING pass may sleep before looking again. */
    @Volatile private var nextWakeMs = WAITING_MS
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
        NetSpool.update(d) { it.copy(gone = true) }
        NetSpool.chunks(d).forEach { it.delete() }
        if (writing[id] == null) NetSpool.deleteAll(d)
        retryAt.remove(id)
        fileBackoff.remove(id)
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
                Pass.WAITING -> { backoff = FIRST_BACKOFF_MS; waitForKick(nextWakeMs) }
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
        if (!kicked) try { lock.wait(ms.coerceAtLeast(1L)) } catch (_: InterruptedException) { /* go round */ }
    }

    private fun sleepQuietly(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) { /* go round */ }

    /** The next wait for a file that had a problem of its own: 15 s, 30 s, then 60 s. Pure. */
    fun nextFileBackoff(previous: Long?): Long = if (previous == null) FIRST_BACKOFF_MS else minOf(previous * 2, MAX_BACKOFF_MS)

    private fun pass(app: Context): Pass {
        val dirs = (NetSpool.root(app).listFiles() ?: emptyArray()).filter { it.isDirectory }
        if (dirs.isEmpty()) return Pass.IDLE
        val cfg = NetFolderStore.read(app)
        var waiting = false
        var wake = WAITING_MS
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
            // This file had a problem of its own a moment ago: its turn comes later, the others go now.
            val now = System.currentTimeMillis()
            val at = retryAt[id]
            if (at != null && at > now) {
                waiting = true
                wake = minOf(wake, at - now)
                continue
            }
            try {
                upload(app, cfg, dir, ready)
                stalled = false
                retryAt.remove(id)
                fileBackoff.remove(id)
            } catch (t: Throwable) {
                if (NetErrors.uploadScope(t) == NetErrors.Scope.FILE) {
                    val b = nextFileBackoff(fileBackoff[id])
                    fileBackoff[id] = b
                    retryAt[id] = System.currentTimeMillis() + b
                    waiting = true
                    wake = minOf(wake, b)
                    NetStatus.record(cfg.key, true)
                    Log.w(TAG, "One upload is held back (${t.javaClass.simpleName})")
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
            if (!RecordingService.jobs.containsKey(id) && writing[id] == null && NetSpool.chunks(dir).isEmpty()) {
                NetSpool.deleteAll(dir)
                RecorderPlugin.emitChanged()
            } else {
                waiting = true
            }
        }
        nextWakeMs = wake
        return if (waiting || (NetSpool.root(app).listFiles() ?: emptyArray()).any { it.isDirectory }) Pass.WAITING else Pass.IDLE
    }

    /** A spool folder with no readable manifest: a start that never became a recording (or a damaged one). */
    private fun orphan(d: File) {
        val id = d.name
        if (RecordingService.jobs.containsKey(id) || writing.containsKey(id)) return
        if (System.currentTimeMillis() - d.lastModified() < 60_000L) return
        NetSpool.deleteAll(d)
    }

    /** The current file on the share for this recording: created (under a free name) when there is none yet. */
    private fun ensureRemote(app: Context, cfg: NetFolder, c: NetConn, dir: File, m: NetSpool.Manifest): NetSpool.Manifest? {
        var cur = m
        val root = NetFolderRules.smbRoot(cfg)
        if (cur.remoteName != null && !cur.root.equals(root, ignoreCase = true)) {
            // The network folder was changed while this one was half-way: the old one can't be reached
            // any more (its sign-in is gone), so the rest becomes a file of its own in the new folder.
            cur = NetSpool.update(dir) { NetSpool.continueInNewFile(it) } ?: return null
        }
        if (cur.remoteName != null) return cur
        val wanted = NetSpool.wantedName(cur)
        var name = NetShare.uniqueName(c, wanted)
        var tries = 0
        while (true) {
            try { NetShare.createNew(c, name); break } catch (t: Throwable) {
                if (!NetErrors.isNameTaken(t) || ++tries > 5) throw t
                name = NetShare.uniqueName(c, wanted)
            }
        }
        val made = NetSpool.update(dir) { it.copy(remoteName = name, remoteBytes = 0L, root = root, label = cfg.label) } ?: return null
        RecordingStore.setPath(app, made.id, NetFolderRules.smbUrl(cfg, name))
        RecorderPlugin.emitChanged()
        return made
    }

    private fun upload(app: Context, cfg: NetFolder, dir: File, ready: List<File>) {
        NetShare.withShare(app) { c ->
            NetShare.ensureFolder(c)
            var newFiles = 0
            for (chunk in ready) {
                if (!chunk.exists()) continue
                val idx = NetSpool.chunkIndex(chunk.name) ?: continue
                while (true) {
                    // Fresh each time: the recording's end or a delete from the app may have changed it.
                    val m0 = NetSpool.read(dir) ?: return@withShare
                    if (m0.gone) return@withShare
                    // Already in the file (the app stopped between sending it and deleting it here).
                    if (idx <= m0.lastChunk) { chunk.delete(); break }
                    val m = ensureRemote(app, cfg, c, dir, m0) ?: return@withShare
                    val remote = m.remoteName ?: return@withShare
                    try {
                        NetShare.writeAt(c, remote, m.remoteBytes, chunk)
                    } catch (t: Throwable) {
                        // Renamed, moved or deleted on the computer: carry on in the next part, drop nothing.
                        if (NetErrors.isGone(t) && ++newFiles <= MAX_NEW_FILES_PER_PASS) {
                            NetSpool.update(dir) { NetSpool.continueInNewFile(it) }
                            continue
                        }
                        throw t
                    }
                    NetSpool.update(dir) { it.copy(remoteBytes = it.remoteBytes + chunk.length(), lastChunk = idx) } ?: return@withShare
                    chunk.delete()
                    break
                }
            }
            val now = System.currentTimeMillis()
            if (now - lastSpaceCheck > SPACE_EVERY_MS) {
                lastSpaceCheck = now
                // Some servers can't say (no full-size volume information): unknown is not full.
                val space = try { NetShare.space(c) } catch (_: Throwable) { null }
                if (space != null) {
                    val (free, total) = space
                    NetStatus.record(cfg.key, true, free, total)
                    if (NetShare.isShareFull(free, total)) RecordingService.shareFull()
                } else {
                    NetStatus.record(cfg.key, true)
                }
            } else {
                NetStatus.record(cfg.key, true)
            }
        }
    }
}
