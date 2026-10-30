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

/** What the viewer set: 0 = Auto (disk only). */
internal data class TimeshiftLimits(val maxDurationMs: Long, val hardCapBytes: Long)

/**
 * One channel's rewind buffer: its own connection to the channel, cut into
 * MPEG-TS segments in [dir] and listed in a growing local HLS playlist
 * ([playlist]) that the player can open at any point.
 *
 * The oldest segments are dropped as the buffer reaches the viewer's "Max
 * rewind" or the disk budget (StorageBudget), so rewinding always reaches as
 * far back as the box can afford and the newest part is never lost. Only
 * small buffers are held in memory (one 64 KB read, one write buffer); the
 * media is on disk.
 *
 * The capture runs on its own thread. [snapshot] may be read from any thread.
 */
internal class TimeshiftSession(
    val key: String,
    private val url: String,
    val dir: File,
    private val limits: () -> TimeshiftLimits,
) {
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
    @Volatile private var source: LiveSource? = null

    val alive: Boolean get() = !stopped && state != STATE_UNAVAILABLE

    fun start() {
        synchronized(lock) { running = true }
        Thread({ run() }, "smc-timeshift").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }.start()
    }

    /** Stop capturing and delete everything this session wrote. Any thread. */
    fun close() {
        val deleteNow = synchronized(lock) {
            stopped = true
            if (running) deleteWhenDone = true
            !running
        }
        source?.cancel()
        if (deleteNow) deleteDir()
    }

    fun snapshot(): Snapshot? {
        synchronized(lock) {
            if (segs.isEmpty()) return null
            return Snapshot(epochMs, segs.first().startMs, totalMs, totalMs + partialMs, segs.size, usedBytes)
        }
    }

    fun usedBytes(): Long = synchronized(lock) { usedBytes }

    // ---- capture thread ----

    private fun run() {
        var failures = 0
        var segmenterRef: TsSegmenter? = null
        try {
            if (!dir.mkdirs() && !dir.isDirectory) throw IOException("no buffer folder")
            val writer = Writer()
            val segmenter = TsSegmenter(TARGET_SEG_MS, MAX_SEG_MS, writer)
            segmenterRef = segmenter
            while (!stopped) {
                val src = LiveSource(url)
                source = src
                if (stopped) break
                val startedAt = SystemClock.elapsedRealtime()
                try {
                    src.pump { b, o, l ->
                        segmenter.feed(b, o, l)
                        partialMs = segmenter.currentMs()
                        if (writer.failed != null) throw writer.failed!!
                    }
                } catch (e: UnsupportedSourceException) {
                    fail("This channel can't be rewound (${e.message}).")
                    break
                } catch (e: WriteFailed) {
                    fail(if (writer.overBudget) "Not enough free space on this box to rewind."
                        else "The rewind buffer could not be written (storage full or cleared).")
                    break
                } catch (e: IOException) {
                    // Never the message: it can carry the address.
                    Log.w(TAG, "Capture connection dropped (${e.javaClass.simpleName})")
                }
                if (stopped) break
                if (writer.overBudget) {
                    fail("Not enough free space on this box to rewind.")
                    break
                }
                // A connection that ran a while counts as a fresh start.
                failures = if (SystemClock.elapsedRealtime() - startedAt > 30_000L) 1 else failures + 1
                if (failures > MAX_FAILURES) {
                    fail("The channel stopped sending, so rewind is paused.")
                    break
                }
                segmenter.markDiscontinuity()
                val wait = minOf(5000L, 1000L * failures)
                var slept = 0L
                while (!stopped && slept < wait) {
                    try { Thread.sleep(200) } catch (_: InterruptedException) { break }
                    slept += 200
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Capture stopped (${t.javaClass.simpleName})")
            fail("Rewind stopped on this channel.")
        } finally {
            try { segmenterRef?.finish() } catch (_: Throwable) { /* closing */ }
            val deleteNow = synchronized(lock) {
                running = false
                deleteWhenDone
            }
            if (deleteNow) deleteDir()
        }
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

        private val ISO = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
        }

        fun isoDate(ms: Long): String = ISO.get()!!.format(Date(ms))
    }
}
