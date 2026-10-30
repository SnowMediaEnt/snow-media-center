package com.snowmedia.dvr

import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/** The source can be read, but not saved safely (fMP4, encrypted, not MPEG-TS). */
internal class UnsupportedSourceException(message: String) : IOException(message)

/** The server answered with an HTTP error. Only the status is kept: never the address. */
internal class HttpStatusException(val status: Int) : IOException("HTTP $status")

/**
 * One connection to a live channel that pushes its MPEG-TS bytes out
 * (LiveSource; a test's fake). [pump] blocks the calling thread until the
 * stream ends, fails (IOException) or is cancelled; [cancel] may be called
 * from any thread and makes it return promptly. When [pump] has returned the
 * connection is closed.
 */
internal interface LiveFeed {
    fun pump(sink: (ByteArray, Int, Int) -> Unit)
    fun cancel()
}

/**
 * Reads one live channel as MPEG-TS bytes, for recordings and for Rewind
 * live TV while the player is on the rewind buffer (then nothing else on this
 * box is connected to the channel: see TimeshiftSession).
 *
 * - A raw MPEG-TS channel (…/live/u/p/1.ts, what the native player plays) is
 *   passed through as it arrives.
 * - An HLS channel (.m3u8, or a server that answers with a playlist) has its
 *   media playlist followed and each new MPEG-TS segment passed through in
 *   order. fMP4, encrypted or byte-range playlists are refused
 *   (UnsupportedSourceException): the channel is then simply not captured.
 *
 * The address carries the line's username and password: it is never logged,
 * and no exception made here carries it (see HttpStatusException).
 *
 * [pump] blocks the calling (capture) thread; [cancel] may be called from any
 * thread and makes it return promptly.
 */
internal class LiveSource(
    private val url: String,
    /** Diagnostics (no address ever goes in): Log.i under [TAG] on the box. */
    private val log: (String) -> Unit = ::logInfo,
) : LiveFeed {
    @Volatile private var conn: HttpURLConnection? = null
    @Volatile var cancelled = false
        private set
    /** Redirects followed by the last open(), and the address it ended at. */
    private var lastHops = 0

    override fun cancel() {
        cancelled = true
        val c = conn ?: return
        // disconnect() closes the socket, which unblocks a read in progress.
        // Not on the caller's thread: it may be the main thread.
        Thread({ try { c.disconnect() } catch (_: Throwable) { /* already closed */ } }, "smc-live-cancel").start()
    }

    /**
     * Pushes the channel's bytes to [sink] until the stream ends (returns),
     * fails (IOException) or is cancelled (returns).
     */
    override fun pump(sink: (ByteArray, Int, Int) -> Unit) {
        if (cancelled) return
        if (looksHls(url)) { pumpHls(URL(url), sink); return }
        val t0 = now()
        val c = open(URL(url), "stream")
        try {
            val type = c.contentType?.lowercase(Locale.US) ?: ""
            if (type.contains("mpegurl")) {
                // A playlist behind a .ts-looking address: follow it as HLS,
                // its segments relative to where it was served from.
                val base = c.url
                val text = readText(c.inputStream)
                c.disconnect()
                log("stream address answered with a playlist (${text.length} B, ${now() - t0} ms): following it as HLS")
                pumpHls(URL(url), sink, text, base)
                return
            }
            val n = copy(c.inputStream, sink, checkTs = true)
            log("stream ended: ${n} B in ${now() - t0} ms")
        } finally {
            try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
            conn = null
        }
    }

    /** Bytes passed on. */
    private fun copy(input: InputStream, sink: (ByteArray, Int, Int) -> Unit, checkTs: Boolean): Long {
        val buf = ByteArray(BUF)
        var first = checkTs
        var total = 0L
        while (!cancelled) {
            val n = input.read(buf, 0, buf.size)
            if (n < 0) return total
            if (n == 0) continue
            if (first) {
                first = false
                if (!looksTs(buf, n)) throw UnsupportedSourceException("not MPEG-TS")
            }
            sink(buf, 0, n)
            total += n
        }
        return total
    }

    // ---- HLS ----

    private class Playlist(
        val variants: List<URL>,
        val segments: List<Pair<Long, URL>>,
        val targetMs: Long,
        val ended: Boolean,
        val unsupported: String?,
        /** The playlist said #EXT-X-MEDIA-SEQUENCE (else its numbers start at 0 every time). */
        val numbered: Boolean,
    )

    /**
     * Follows an HLS channel. [start] is asked for again on every reload (as
     * Media3 does); what it lists is resolved against the address it was
     * finally served from, after redirects (an Xtream panel sends
     * /live/u/p/1.m3u8 on to /hls/<token>/...: resolved against the first
     * address, its relative segments pointed back at /live/u/p/ and the
     * panel never answered).
     */
    private fun pumpHls(start: URL, sink: (ByteArray, Int, Int) -> Unit, firstText: String? = null, firstBase: URL? = null) {
        var listUrl = start
        var text = firstText
        var base = firstBase ?: start
        var lastSeq = -1L
        val done = LinkedHashSet<String>()
        var hops = 0
        while (!cancelled) {
            val body: String
            if (text != null) {
                body = text
                text = null
            } else {
                val t0 = now()
                val (b, finalUrl) = fetchText(listUrl)
                body = b
                base = finalUrl
                log("playlist: ${b.length} B, $lastHops redirect(s), ${now() - t0} ms")
            }
            val pl = parse(body, base)
            if (pl.variants.isNotEmpty()) {
                // A master playlist: the first variant listed (the provider's default).
                if (++hops > 3) throw UnsupportedSourceException("playlist loop")
                listUrl = pl.variants.first()
                log("multivariant playlist: ${pl.variants.size} variant(s), following the first")
                continue
            }
            if (pl.unsupported != null) throw UnsupportedSourceException(pl.unsupported)
            var fresh = pl.segments.filter { (seq, u) ->
                if (pl.numbered) seq > lastSeq else !done.contains(u.toString())
            }
            // Joining: only the newest segment, the live edge.
            if (lastSeq < 0 && done.isEmpty() && fresh.size > 1) fresh = fresh.takeLast(1)
            if (fresh.isEmpty()) log("playlist: ${pl.segments.size} segment(s), nothing new (target ${pl.targetMs} ms)")
            for ((seq, segUrl) in fresh) {
                if (cancelled) return
                val t0 = now()
                val c = open(segUrl, "segment")
                val n = try {
                    copy(c.inputStream, sink, checkTs = true)
                } finally {
                    try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
                    conn = null
                }
                log("segment: $n B, ${now() - t0} ms")
                lastSeq = seq
                done.add(segUrl.toString())
                if (done.size > 64) done.remove(done.first())
            }
            if (pl.ended) return
            // Reload after half a target duration (at least 1 s), in small
            // steps so a cancel returns quickly.
            val wait = (pl.targetMs / 2).coerceIn(1000L, 5000L)
            var slept = 0L
            while (!cancelled && slept < wait) {
                try { Thread.sleep(200) } catch (_: InterruptedException) { return }
                slept += 200
            }
        }
    }

    private fun parse(text: String, base: URL): Playlist {
        val variants = ArrayList<URL>()
        val segments = ArrayList<Pair<Long, URL>>()
        var seq = 0L
        var numbered = false
        var targetMs = 6000L
        var ended = false
        var unsupported: String? = null
        var nextIsVariant = false
        var nextIsSegment = false
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("#")) {
                when {
                    line.startsWith("#EXT-X-STREAM-INF") -> nextIsVariant = true
                    line.startsWith("#EXTINF") -> nextIsSegment = true
                    line.startsWith("#EXT-X-MEDIA-SEQUENCE:") -> {
                        seq = line.substringAfter(':').trim().toLongOrNull() ?: 0L
                        numbered = true
                    }
                    line.startsWith("#EXT-X-TARGETDURATION:") ->
                        targetMs = (line.substringAfter(':').trim().toDoubleOrNull() ?: 6.0).times(1000).toLong()
                    line.startsWith("#EXT-X-ENDLIST") -> ended = true
                    line.startsWith("#EXT-X-MAP") -> unsupported = "fMP4"
                    line.startsWith("#EXT-X-BYTERANGE") -> unsupported = "byte ranges"
                    line.startsWith("#EXT-X-KEY") && !line.contains("METHOD=NONE") -> unsupported = "encrypted"
                }
                continue
            }
            val u = try { URL(base, line) } catch (_: Exception) { null }
            if (nextIsVariant) {
                if (u != null) variants.add(u)
                nextIsVariant = false
            } else if (nextIsSegment) {
                if (u != null) segments.add(seq to u)
                seq++
                nextIsSegment = false
            }
        }
        return Playlist(variants, segments, targetMs, ended, unsupported, numbered)
    }

    /** The playlist's text, and the address it was finally served from. */
    private fun fetchText(u: URL): Pair<String, URL> {
        val c = open(u, "playlist")
        try {
            return readText(c.inputStream) to c.url
        } finally {
            try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
            conn = null
        }
    }

    private fun readText(input: InputStream): String {
        val bytes = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            bytes.write(buf, 0, n)
            if (bytes.size() > MAX_PLAYLIST) throw UnsupportedSourceException("playlist too large")
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    // ---- HTTP ----

    /**
     * GET with redirects followed by hand, http <-> https included (as the
     * player's own source allows). Quick timeouts and no user agent of our
     * own, like the player: some IPTV panels turn away agents they don't know.
     * [what] (playlist / segment / stream) only names it in the log.
     */
    private fun open(start: URL, what: String): HttpURLConnection {
        var u = start
        var hops = 0
        val t0 = now()
        while (true) {
            if (cancelled) throw InterruptedIOException("cancelled")
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = READ_TIMEOUT_MS
            c.setRequestProperty("Accept-Encoding", "identity")
            conn = c
            val code = try { c.responseCode } catch (e: IOException) {
                conn = null
                try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
                val why = if (cancelled) "cancelled" else e.javaClass.simpleName
                log("$what: no answer ($why) after ${now() - t0} ms, $hops redirect(s)")
                throw if (cancelled) InterruptedIOException("cancelled") else IOException(e.javaClass.simpleName)
            }
            if (code in 300..399) {
                val loc = c.getHeaderField("Location")
                c.disconnect()
                conn = null
                if (loc == null || ++hops > MAX_REDIRECTS) {
                    log("$what: HTTP $code, redirect not followed ($hops)")
                    throw HttpStatusException(code)
                }
                val next = URL(u, loc)
                val where = if (next.host == u.host && next.port == u.port) "same host" else "another host"
                log("$what: HTTP $code -> $where")
                u = next
                continue
            }
            if (code !in 200..299) {
                c.disconnect()
                conn = null
                log("$what: HTTP $code after ${now() - t0} ms, $hops redirect(s)")
                throw HttpStatusException(code)
            }
            lastHops = hops
            log("$what: HTTP $code, ${c.contentType ?: "no type"}, $hops redirect(s), headers in ${now() - t0} ms")
            return c
        }
    }

    companion object {
        const val TAG = "SmcLiveSource"
        private const val BUF = 64 * 1024
        private const val TIMEOUT_MS = 10_000
        // A 24/7 channel on a busy panel can take 12 s before its first byte
        // (DreamStreams, 2026-10-26); 10 s hung up on it and retried forever.
        // The player's own source waits 30 s too.
        private const val READ_TIMEOUT_MS = 30_000
        private const val MAX_REDIRECTS = 5
        private const val MAX_PLAYLIST = 1024 * 1024

        /** A packet start (0x47) near the beginning, and another one 188 bytes on when there is room. */
        fun looksTs(b: ByteArray, n: Int): Boolean {
            val limit = minOf(n, 188)
            for (i in 0 until limit) {
                if (b[i] != 0x47.toByte()) continue
                if (i + 188 >= n || b[i + 188] == 0x47.toByte()) return true
            }
            return false
        }

        fun looksHls(url: String): Boolean =
            url.substringBefore('?').lowercase(Locale.US).endsWith(".m3u8")
    }
}

private fun now(): Long = System.nanoTime() / 1_000_000L

private fun logInfo(msg: String) {
    try { android.util.Log.i(LiveSource.TAG, msg) } catch (_: Throwable) { /* no Android log (tests) */ }
}
