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
 * Reads one live channel as MPEG-TS bytes, for Rewind live TV and for
 * recordings: its own connection, separate from the player's.
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
internal class LiveSource(private val url: String) {
    @Volatile private var conn: HttpURLConnection? = null
    @Volatile var cancelled = false
        private set

    fun cancel() {
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
    fun pump(sink: (ByteArray, Int, Int) -> Unit) {
        if (cancelled) return
        if (looksHls(url)) { pumpHls(URL(url), sink); return }
        val c = open(URL(url))
        try {
            val type = c.contentType?.lowercase(Locale.US) ?: ""
            if (type.contains("mpegurl")) {
                // A playlist behind a .ts-looking address: follow it as HLS.
                val base = c.url
                val text = readText(c.inputStream)
                c.disconnect()
                pumpHls(base, sink, text)
                return
            }
            copy(c.inputStream, sink, checkTs = true)
        } finally {
            try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
            conn = null
        }
    }

    private fun copy(input: InputStream, sink: (ByteArray, Int, Int) -> Unit, checkTs: Boolean) {
        val buf = ByteArray(BUF)
        var first = checkTs
        while (!cancelled) {
            val n = input.read(buf, 0, buf.size)
            if (n < 0) return
            if (n == 0) continue
            if (first) {
                first = false
                if (!looksTs(buf, n)) throw UnsupportedSourceException("not MPEG-TS")
            }
            sink(buf, 0, n)
        }
    }

    // ---- HLS ----

    private class Playlist(
        val variants: List<URL>,
        val segments: List<Pair<Long, URL>>,
        val targetMs: Long,
        val ended: Boolean,
        val unsupported: String?,
    )

    private fun pumpHls(start: URL, sink: (ByteArray, Int, Int) -> Unit, firstText: String? = null) {
        var listUrl = start
        var text = firstText
        var lastSeq = -1L
        var hops = 0
        while (!cancelled) {
            val body = text ?: fetchText(listUrl)
            text = null
            val pl = parse(body, listUrl)
            if (pl.variants.isNotEmpty()) {
                // A master playlist: the first variant listed (the provider's default).
                if (++hops > 3) throw UnsupportedSourceException("playlist loop")
                listUrl = pl.variants.first()
                continue
            }
            if (pl.unsupported != null) throw UnsupportedSourceException(pl.unsupported)
            var fresh = pl.segments.filter { it.first > lastSeq }
            // Joining: only the newest segment, the live edge.
            if (lastSeq < 0 && fresh.size > 1) fresh = fresh.takeLast(1)
            for ((seq, segUrl) in fresh) {
                if (cancelled) return
                val c = open(segUrl)
                try {
                    copy(c.inputStream, sink, checkTs = true)
                } finally {
                    try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
                    conn = null
                }
                lastSeq = seq
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
                    line.startsWith("#EXT-X-MEDIA-SEQUENCE:") ->
                        seq = line.substringAfter(':').trim().toLongOrNull() ?: 0L
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
        return Playlist(variants, segments, targetMs, ended, unsupported)
    }

    private fun fetchText(u: URL): String {
        val c = open(u)
        try {
            return readText(c.inputStream)
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
     */
    private fun open(start: URL): HttpURLConnection {
        var u = start
        var hops = 0
        while (true) {
            if (cancelled) throw InterruptedIOException("cancelled")
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.setRequestProperty("Accept-Encoding", "identity")
            conn = c
            val code = try { c.responseCode } catch (e: IOException) {
                conn = null
                try { c.disconnect() } catch (_: Throwable) { /* ignore */ }
                throw if (cancelled) InterruptedIOException("cancelled") else IOException(e.javaClass.simpleName)
            }
            if (code in 300..399) {
                val loc = c.getHeaderField("Location")
                c.disconnect()
                conn = null
                if (loc == null || ++hops > MAX_REDIRECTS) throw HttpStatusException(code)
                u = URL(u, loc)
                continue
            }
            if (code !in 200..299) {
                c.disconnect()
                conn = null
                throw HttpStatusException(code)
            }
            return c
        }
    }

    companion object {
        private const val BUF = 64 * 1024
        private const val TIMEOUT_MS = 10_000
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
