package com.snowmedia.dvr

import android.os.SystemClock
import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** What the viewer set: 0 = Auto (disk only). */
internal data class TimeshiftLimits(val maxDurationMs: Long, val hardCapBytes: Long)

/**
 * One channel's rewind buffer, on ONE connection to the channel: cut into
 * MPEG-TS segments in [dir] and listed in a growing local HLS playlist
 * ([playlist]) that the player can open at any point.
 *
 * Where the bytes come from:
 * - While the viewer watches live, from the player itself: the main
 *   player's live DataSource hands every byte it reads to [tee], which
 *   passes them on here ([MODE_TEE]). No connection of our own.
 * - Once the player has moved onto this buffer (a long pause, a rewind:
 *   [takeOver]), the player's live connection closes. Only after the tee
 *   says every one of the player's connections is closed, and a short grace
 *   ([takeoverGraceMs]) has passed, does this session open ONE connection of
 *   its own ([openSource], LiveSource) to keep recording the live edge
 *   ([MODE_OWN]).
 * - Go live ([handBack]): that connection is closed first; the callback
 *   runs once it is, after [handbackGraceMs], and only then may the player
 *   open the channel again. The session is fed by the tee from then on.
 * So two connections to the channel are never open at once. Each handover
 * leaves a small gap, marked as a discontinuity in the playlist.
 *
 * The oldest segments are dropped as the buffer reaches the viewer's "Max
 * rewind" or the disk budget (StorageBudget), so rewinding always reaches as
 * far back as the box can afford and the newest part is never lost. Only
 * small buffers are held in memory (a few MB of the player's bytes waiting to
 * be written, one 64 KB read, one write buffer); the media is on disk.
 *
 * The writing runs on its own thread; the tee's calls only copy into a queue
 * (never blocking the player: bytes that don't fit are dropped and marked as
 * a gap). [snapshot] may be read from any thread.
 */
internal class TimeshiftSession(
    val key: String,
    /** The channel's address (carries the line's login: never logged). */
    val url: String,
    val dir: File,
    private val limits: () -> TimeshiftLimits,
    private val tee: TimeshiftTee,
    private val openSource: (String) -> LiveFeed = { LiveSource(it) },
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
    private val takeoverGraceMs: Long = TAKEOVER_GRACE_MS,
    private val handbackGraceMs: Long = HANDBACK_GRACE_MS,
) : TimeshiftTee.Sink {
    class Seg(val seq: Long, val file: File, val startMs: Long, val durMs: Long, val bytes: Long, val discontinuity: Boolean)

    /** What the player and the WebView need, taken under the lock. */
    class Snapshot(
        /** Wall-clock time the capture's media timeline starts at (the playlist's dates). */
        val epochMs: Long,
        /** First listed segment's start, on the capture timeline. */
        val startMs: Long,
        /** End of the last listed segment. */
        val endMs: Long,
        /** End of what has been received, the segment still being written included. */
        val liveMs: Long,
        val segments: Int,
        val usedBytes: Long,
    )

    private val lock = Any()
    private val segs = ArrayDeque<Seg>()
    private var nextSeq = 0L
    private var discSeq = 0L
    private var totalMs = 0L
    private var usedBytes = 0L
    @Volatile private var partialMs = 0L

    @Volatile var state: String = STATE_STARTING
        private set
    /** Why the channel can't be rewound, in the viewer's words. */
    @Volatile var reason: String? = null
        private set

    val epochMs: Long = System.currentTimeMillis()
    val playlist: File get() = File(dir, PLAYLIST)

    @Volatile private var stopped = false
    private var deleteWhenDone = false
    private var running = false
    @Volatile private var source: LiveFeed? = null

    /** Where the bytes come from now: MODE_TEE (the player) or MODE_OWN (our own connection). */
    @Volatile var mode: Int = MODE_TEE
        private set
    /** Our own connection is open, opening, or closing (its grace included). Under the lock. */
    private var ownActive = false
    /** Run once our own connection is closed (handBack / close). Under the lock. */
    private val whenReleased = ArrayList<Runnable>()

    // The player's bytes, on their way from the tee to the capture thread.
    private class Item(val buf: ByteArray?, val len: Int, val kind: Int)
    private val queue = LinkedBlockingQueue<Item>()
    private val free = ArrayDeque<ByteArray>()
    private var chunks = 0
    private var dropping = false
    /** The newest chunk, still being filled (small reads are packed into it). Under [free]. */
    private var fill: ByteArray? = null
    private var fillLen = 0
    /** Bytes the tee handed over that were dropped (the queue was full). */
    @Volatile internal var droppedBytes = 0L
        private set

    val alive: Boolean get() = !stopped && state != STATE_UNAVAILABLE

    fun start() {
        synchronized(lock) { running = true }
        tee.attach(this)
        Thread({ run() }, "smc-timeshift").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }.start()
    }

    /** Stop capturing and delete everything this session wrote. Any thread. [released]: as for [handBack]. */
    fun close(released: Runnable? = null) {
        tee.detach(this)
        var runNow = false
        val deleteNow = synchronized(lock) {
            stopped = true
            if (running) deleteWhenDone = true
            if (released != null) {
                if (ownActive) whenReleased.add(released) else runNow = true
            }
            !running
        }
        info("closed (own connection ${if (runNow || released == null) "not waited for" else "closing"})")
        source?.cancel()
        if (runNow) released?.run()
        if (deleteNow) deleteDir()
    }

    /**
     * The player has moved onto this buffer (main thread): keep recording on
     * a connection of our own, once the player's is closed.
     */
    fun takeOver() {
        synchronized(lock) {
            if (stopped || !running || state == STATE_UNAVAILABLE) {
                info("take over refused (stopped=$stopped running=$running state=$state)")
                return
            }
            mode = MODE_OWN
        }
        info("take over: waiting for the player's live connections (${tee.openCount()} open) to close")
    }

    /**
     * Go live (main thread): close our own connection and be fed by the
     * player again. [released] runs once nothing of ours is connected to the
     * channel (at once when nothing was; else on the capture thread, after
     * [handbackGraceMs]): the player opens the channel only then.
     */
    fun handBack(released: Runnable) {
        var runNow = false
        synchronized(lock) {
            mode = MODE_TEE
            if (ownActive && running) whenReleased.add(released) else runNow = true
        }
        if (runNow) {
            released.run()
        } else {
            info("hand back: closing our own connection first")
            handBackAt = clock()
            source?.cancel()
        }
    }

    @Volatile private var handBackAt = 0L

    /**
     * [released] runs once our own connection is closed (and its grace has
     * passed): at once when none is open, else on the capture thread. For a
     * session already closed (TimeshiftManager's closing ones).
     */
    fun whenReleased(released: Runnable) {
        val runNow = synchronized(lock) {
            if (ownActive && running) { whenReleased.add(released); false } else true
        }
        if (runNow) released.run()
    }

    /** Our own connection is open or about to be (the player must wait before opening the channel). */
    fun holdsConnection(): Boolean = synchronized(lock) { ownActive || (mode == MODE_OWN && running && !stopped) }

    fun snapshot(): Snapshot? {
        synchronized(lock) {
            if (segs.isEmpty()) return null
            return Snapshot(epochMs, segs.first().startMs, totalMs, totalMs + partialMs, segs.size, usedBytes)
        }
    }

    fun usedBytes(): Long = synchronized(lock) { usedBytes }

    /** The listed segments (tests). */
    internal fun segments(): List<Seg> = synchronized(lock) { segs.toList() }

    // ---- the tee (loader threads; never block) ----

    override fun teeBytes(b: ByteArray, off: Int, len: Int) {
        var o = off
        var left = len
        synchronized(free) {
            while (left > 0) {
                var chunk = fill
                if (chunk == null) {
                    chunk = free.pollFirst() ?: if (chunks < MAX_CHUNKS) { chunks++; ByteArray(CHUNK) } else null
                    if (chunk == null) {
                        // The disk can't keep up: drop, and say so once the queue has room.
                        dropping = true
                        droppedBytes += left
                        return
                    }
                    if (dropping) {
                        dropping = false
                        queue.offer(Item(null, 0, ITEM_DISC))
                    }
                    fill = chunk
                    fillLen = 0
                }
                // Packed after what is already in the chunk: a player's reads
                // are a few KB, and a whole chunk each held a fraction of the budget.
                val n = minOf(left, CHUNK - fillLen)
                System.arraycopy(b, o, chunk, fillLen, n)
                fillLen += n
                o += n
                left -= n
                if (fillLen == CHUNK) {
                    queue.offer(Item(chunk, CHUNK, ITEM_DATA))
                    fill = null
                    fillLen = 0
                }
            }
        }
    }

    override fun teeDiscontinuity() {
        synchronized(free) {
            flushFill()
            queue.offer(Item(null, 0, ITEM_DISC))
        }
    }

    override fun teeUnsupported(why: String) {
        unsupportedWhy = why
        synchronized(free) {
            flushFill()
            queue.offer(Item(null, 0, ITEM_UNSUPPORTED))
        }
    }

    /** Under [free]: the chunk being filled goes on the queue as it is. */
    private fun flushFill() {
        val f = fill ?: return
        if (fillLen > 0) queue.offer(Item(f, fillLen, ITEM_DATA)) else free.addLast(f)
        fill = null
        fillLen = 0
    }

    /** The oldest of the player's bytes waiting, the chunk still being filled last. */
    private fun nextItem(timeoutMs: Long): Item? {
        synchronized(free) {
            queue.poll()?.let { return it }
            if (fillLen > 0) { flushFill(); return queue.poll() }
        }
        if (timeoutMs <= 0L) return null
        queue.poll(timeoutMs, TimeUnit.MILLISECONDS)?.let { return it }
        synchronized(free) {
            queue.poll()?.let { return it }
            if (fillLen > 0) { flushFill(); return queue.poll() }
        }
        return null
    }

    /** Bytes waiting to be written (tests). */
    internal fun queuedBytes(): Long = synchronized(free) { queue.sumOf { it.len.toLong() } + fillLen }

    @Volatile private var unsupportedWhy = ""

    private fun recycle(chunk: ByteArray) {
        synchronized(free) { free.addLast(chunk) }
    }

    // ---- capture thread ----

    private fun run() {
        var segmenterRef: TsSegmenter? = null
        try {
            if (!dir.mkdirs() && !dir.isDirectory) throw IOException("no buffer folder")
            val writer = Writer()
            val segmenter = TsSegmenter(TARGET_SEG_MS, MAX_SEG_MS, writer, clock)
            segmenterRef = segmenter
            var fed = false
            /** One item from the player: false when the session must end. */
            fun take(item: Item): Boolean {
                when (item.kind) {
                    ITEM_DATA -> {
                        try {
                            segmenter.feed(item.buf!!, 0, item.len)
                        } finally {
                            recycle(item.buf!!)
                        }
                        fed = true
                        partialMs = segmenter.currentMs()
                    }
                    ITEM_DISC -> if (fed) segmenter.markDiscontinuity()
                    ITEM_UNSUPPORTED -> {
                        fail("This channel can't be rewound ($unsupportedWhy).")
                        return false
                    }
                }
                if (writer.failed != null || writer.overBudget) {
                    fail(if (writer.overBudget) "Not enough free space on this box to rewind."
                        else "The rewind buffer could not be written (storage full or cleared).")
                    return false
                }
                return true
            }
            fun drain(): Boolean {
                while (true) {
                    val item = nextItem(0L) ?: return true
                    if (!take(item)) return false
                }
            }
            loop@ while (!stopped) {
                if (mode == MODE_TEE) {
                    val item = nextItem(POLL_MS) ?: continue@loop
                    if (!take(item)) break@loop
                    continue@loop
                }
                // MODE_OWN. What the player read before it let go is kept;
                // our own connection opens only once all of its are closed.
                if (!awaitPlayerClosed(::take)) {
                    if (stopped || state == STATE_UNAVAILABLE) break@loop
                    continue@loop // Go live came first: still fed by the player
                }
                val go = synchronized(lock) {
                    if (stopped || mode != MODE_OWN) false else { ownActive = true; true }
                }
                if (!go) continue@loop
                tee.detach(this)
                if (!drain()) { released(); break@loop }
                if (fed) segmenter.markDiscontinuity()
                val ended = !ownConnection(writer, segmenter)
                if (ended) { released(); break@loop }
                // Back to the player's bytes: what comes next starts a new piece.
                fed = true
                released()
                segmenter.markDiscontinuity()
            }
        } catch (t: Throwable) {
            warn("Capture stopped (${t.javaClass.simpleName})")
            fail("Rewind stopped on this channel.")
        } finally {
            tee.detach(this)
            try { segmenterRef?.finish() } catch (_: Throwable) { /* closing */ }
            synchronized(free) { flushFill() }
            while (true) { val item = queue.poll() ?: break; item.buf?.let { recycle(it) } }
            val (deleteNow, pending) = synchronized(lock) {
                running = false
                ownActive = false
                val p = whenReleased.toList()
                whenReleased.clear()
                deleteWhenDone to p
            }
            for (r in pending) try { r.run() } catch (_: Throwable) { /* the caller's */ }
            if (deleteNow) deleteDir()
        }
    }

    /**
     * Waits, still writing what the player read, until none of the player's
     * live connections is open and [takeoverGraceMs] has passed since. Never
     * gives up waiting: opening ours while the player's is still open would
     * be two connections (a 1-stream line refuses the second). False when Go
     * live came first, the session is closing, or the channel can't be buffered.
     */
    private fun awaitPlayerClosed(take: (Item) -> Boolean): Boolean {
        var quietSince = -1L
        val since = clock()
        var told = false
        while (!stopped && mode == MODE_OWN) {
            val item = nextItem(WAIT_STEP_MS)
            if (item != null && !take(item)) return false
            val now = clock()
            if (tee.openCount() > 0) {
                quietSince = -1L
                if (!told && now - since > SLOW_CLOSE_MS) {
                    told = true
                    warn("The player's live connection is still open; rewind waits for it")
                }
                continue
            }
            if (quietSince < 0L) quietSince = now
            if (now - quietSince >= takeoverGraceMs) {
                info("the player's connections closed ${quietSince - since} ms after the take over; opening our own")
                return true
            }
        }
        return false
    }

    /**
     * Our own connection, while the player is on the buffer: reconnects as
     * needed until Go live ([mode] back to MODE_TEE) or the end. False when
     * the session must end (closing, or the channel can't be buffered).
     */
    private fun ownConnection(writer: Writer, segmenter: TsSegmenter): Boolean {
        var failures = 0
        // An HLS channel goes on from the player's own media playlist (an
        // Xtream /hls/<token>/ path): the panel sees the player's session
        // carry on, not a new viewer. Its first failure falls back to the
        // channel's address.
        var from = tee.recentMediaPlaylist(PLAYLIST_FRESH_MS)
        while (!stopped && mode == MODE_OWN) {
            info("own connection: opening (${if (from != null) "the player's media playlist" else "the channel's address"}, attempt ${failures + 1})")
            val src = openSource(from ?: url)
            source = src
            if (stopped || mode != MODE_OWN) { source = null; break }
            val startedAt = clock()
            try {
                src.pump { b, o, l ->
                    segmenter.feed(b, o, l)
                    partialMs = segmenter.currentMs()
                    if (writer.failed != null) throw writer.failed!!
                }
            } catch (e: UnsupportedSourceException) {
                source = null
                fail("This channel can't be rewound (${e.message}).")
                return false
            } catch (e: WriteFailed) {
                source = null
                fail(if (writer.overBudget) "Not enough free space on this box to rewind."
                    else "The rewind buffer could not be written (storage full or cleared).")
                return false
            } catch (e: IOException) {
                // Never the message: it can carry the address.
                warn("Capture connection dropped (${e.javaClass.simpleName}${if (e is HttpStatusException) " ${e.status}" else ""}) after ${clock() - startedAt} ms")
            }
            from = null
            source = null
            if (stopped) return false
            if (mode != MODE_OWN) break
            if (writer.overBudget) {
                fail("Not enough free space on this box to rewind.")
                return false
            }
            // A connection that ran a while counts as a fresh start.
            failures = if (clock() - startedAt > 30_000L) 1 else failures + 1
            if (failures > MAX_FAILURES) {
                fail("The channel stopped sending, so rewind is paused.")
                return false
            }
            segmenter.markDiscontinuity()
            val wait = minOf(5000L, 1000L * failures)
            var slept = 0L
            while (!stopped && mode == MODE_OWN && slept < wait) {
                try { Thread.sleep(200) } catch (_: InterruptedException) { break }
                slept += 200
            }
        }
        return !stopped
    }

    /**
     * Our own connection is closed (it was when its pump returned). After
     * the grace, the player may open the channel: back on the tee, then the
     * waiting callbacks run.
     */
    private fun released() {
        info("own connection closed${if (handBackAt > 0L) " ${clock() - handBackAt} ms after the hand back" else ""}")
        if (handbackGraceMs > 0) {
            var slept = 0L
            while (slept < handbackGraceMs) {
                try { Thread.sleep(minOf(50L, handbackGraceMs - slept)) } catch (_: InterruptedException) { break }
                slept += 50L
            }
        }
        val pending = synchronized(lock) {
            ownActive = false
            if (!stopped && mode == MODE_TEE) tee.attach(this)
            val p = whenReleased.toList()
            whenReleased.clear()
            p
        }
        info("released after the grace: fed by the player again=${!stopped && mode == MODE_TEE}, ${pending.size} waiting")
        handBackAt = 0L
        for (r in pending) try { r.run() } catch (_: Throwable) { /* the caller's */ }
    }

    private fun warn(msg: String) {
        try { Log.w(TAG, msg) } catch (_: Throwable) { /* no Android log (tests) */ }
    }

    private fun info(msg: String) {
        try { Log.i(TAG, msg) } catch (_: Throwable) { /* no Android log (tests) */ }
    }

    private fun fail(why: String) {
        reason = why
        state = STATE_UNAVAILABLE
    }

    private class WriteFailed : IOException("write failed")

    /** Segment files and the playlist (capture thread). */
    private inner class Writer : TsSegmenter.Output {
        private var out: OutputStream? = null
        private var file: File? = null
        private var bytes = 0L
        private var disc = false
        @Volatile var failed: IOException? = null
        var overBudget = false

        override fun beginSegment(discontinuity: Boolean) {
            if (failed != null) return
            val f = File(dir, "s$nextSeq.ts")
            file = f
            bytes = 0L
            disc = discontinuity
            out = try {
                BufferedOutputStream(FileOutputStream(f), WRITE_BUF)
            } catch (_: IOException) {
                failed = WriteFailed(); null
            }
        }

        override fun writePacket(buf: ByteArray, off: Int) {
            val o = out ?: return
            try {
                o.write(buf, off, TsSegmenter.PACKET)
                bytes += TsSegmenter.PACKET
            } catch (_: IOException) {
                failed = WriteFailed()
                out = null
            }
        }

        override fun endSegment(durationMs: Long) {
            val o = out
            val f = file
            out = null
            file = null
            if (o == null || f == null) return
            try { o.close() } catch (_: IOException) { failed = WriteFailed(); return }
            if (bytes == 0L || durationMs <= 0L) { f.delete(); return }
            synchronized(lock) {
                segs.addLast(Seg(nextSeq, f, totalMs, durationMs, bytes, disc))
                nextSeq++
                totalMs += durationMs
                usedBytes += bytes
                partialMs = 0L
                trim()
            }
            try {
                writePlaylist()
            } catch (_: IOException) {
                failed = WriteFailed()
                return
            }
            if (state == STATE_STARTING) state = STATE_CAPTURING
            if (overBudget) failed = WriteFailed()
        }

        /** Under the lock: drop the oldest segments past the viewer's limit or the disk budget. */
        private fun trim() {
            val lim = limits()
            val vol = StorageBudget.volumeOf(dir)
            val budget = if (vol == null) lim.hardCapBytes
                else StorageBudget.allowedBytes(vol.first, vol.second, usedBytes, lim.hardCapBytes)
            while (segs.size > MIN_SEGMENTS) {
                val first = segs.first()
                val span = totalMs - first.startMs
                val tooLong = lim.maxDurationMs > 0 && span - first.durMs >= lim.maxDurationMs
                if (!tooLong && usedBytes <= budget) break
                drop()
            }
            // Even the newest few segments don't fit: stop instead of filling the box.
            if (usedBytes > budget) overBudget = true
        }

        private fun drop() {
            val first = segs.removeFirst()
            usedBytes -= first.bytes
            if (first.discontinuity) discSeq++
            first.file.delete()
        }

        private fun writePlaylist() {
            val sb = StringBuilder(4096)
            synchronized(lock) {
                if (segs.isEmpty()) return
                sb.append("#EXTM3U\n#EXT-X-VERSION:3\n")
                sb.append("#EXT-X-TARGETDURATION:").append(TARGET_DURATION_S).append('\n')
                sb.append("#EXT-X-MEDIA-SEQUENCE:").append(segs.first().seq).append('\n')
                sb.append("#EXT-X-DISCONTINUITY-SEQUENCE:").append(discSeq).append('\n')
                for (s in segs) {
                    if (s.discontinuity) sb.append("#EXT-X-DISCONTINUITY\n")
                    sb.append("#EXT-X-PROGRAM-DATE-TIME:").append(isoDate(epochMs + s.startMs)).append('\n')
                    sb.append("#EXTINF:").append(String.format(Locale.US, "%.3f", s.durMs / 1000.0)).append(",\n")
                    sb.append(s.file.name).append('\n')
                }
            }
            // Written aside and renamed over, so the player never reads half a list.
            val tmp = File(dir, "$PLAYLIST.tmp")
            FileOutputStream(tmp).use { it.write(sb.toString().toByteArray(Charsets.US_ASCII)) }
            if (!tmp.renameTo(playlist)) throw IOException("rename")
        }
    }

    private fun deleteDir() {
        Thread({ try { dir.deleteRecursively() } catch (_: Throwable) { /* best effort */ } }, "smc-timeshift-rm").start()
    }

    companion object {
        private const val TAG = "SmcTimeshift"
        const val STATE_STARTING = "starting"
        const val STATE_CAPTURING = "capturing"
        const val STATE_UNAVAILABLE = "unavailable"
        const val PLAYLIST = "live.m3u8"
        /** Segments of about 4 s, cut at the stream's program table. */
        private const val TARGET_SEG_MS = 4000L
        /** A stream that never repeats its program table is cut at 10 s. */
        private const val MAX_SEG_MS = 10_000L
        /** #EXT-X-TARGETDURATION: never below any segment's length. */
        private const val TARGET_DURATION_S = 11
        /** The live edge always stays listed. */
        private const val MIN_SEGMENTS = 3
        private const val MAX_FAILURES = 30
        private const val WRITE_BUF = 64 * 1024
        const val MODE_TEE = 0
        const val MODE_OWN = 1
        /** After the player's last live connection closed, before ours opens. */
        const val TAKEOVER_GRACE_MS = 1000L
        /** After ours closed, before the player may open the channel again. */
        const val HANDBACK_GRACE_MS = 300L
        /** The player's media playlist is gone on from if it read it this recently. */
        private const val PLAYLIST_FRESH_MS = 60_000L
        private const val POLL_MS = 200L
        private const val WAIT_STEP_MS = 50L
        /** Said once in the log when the player's connection takes longer than this to close. */
        private const val SLOW_CLOSE_MS = 10_000L
        /** The player's bytes waiting to be written: up to 48 x 64 KB, packed full (3 MB, about 1 s at 25 Mb/s). */
        private const val CHUNK = 64 * 1024
        private const val MAX_CHUNKS = 48
        private const val ITEM_DATA = 0
        private const val ITEM_DISC = 1
        private const val ITEM_UNSUPPORTED = 2

        private val ISO = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
        }

        fun isoDate(ms: Long): String = ISO.get()!!.format(Date(ms))
    }
}
