package com.snowmedia.dvr

import java.util.Locale

/**
 * Rewind live TV on ONE connection: the main player's own live bytes, handed
 * to the rewind buffer as the player reads them (the player's live DataSource
 * calls [begin] on every open, then [Reader.bytes] / [Reader.close]; see
 * TimeshiftTapDataSource). There is no second connection to the channel.
 *
 * What is passed on to the [Sink] (the TimeshiftSession, while it is fed by
 * the player):
 * - a raw MPEG-TS channel (the channel's own address): every byte, as read;
 *   each new open of it (the player's reconnect) starts at the live edge, so
 *   it is marked as a discontinuity;
 * - an HLS channel: the MPEG-TS media segments only, never playlists (told
 *   apart by their first bytes). A segment read again (a retry, a reload,
 *   part of one resumed) is passed on only past what was already passed on,
 *   so nothing is written twice or out of order; a segment from another
 *   folder (another variant) is a discontinuity;
 * - anything else that is media (fMP4/CMAF, packed audio, encrypted
 *   segments, a raw stream that is not MPEG-TS), and HLS with audio and video
 *   in separate segments (two loads at once): [Sink.teeUnsupported], and the
 *   channel is not buffered, as before.
 *
 * [openCount] is how many of the player's live connections are open right
 * now, playlists included, whether or not a sink is attached: the session
 * opens its own connection only once that is 0.
 *
 * Loader threads call the readers; [attach]/[detach] come from any thread.
 * The sink is called under this object's lock, and must not block (the
 * session copies the bytes into a queue its own thread writes to disk).
 * Addresses are kept only to compare them: never logged.
 */
internal class TimeshiftTee {
    interface Sink {
        /** MPEG-TS bytes, in order. Must not block or keep [b]. */
        fun teeBytes(b: ByteArray, off: Int, len: Int)
        /** What follows is not continuous with what came before. */
        fun teeDiscontinuity()
        /** The channel can't be buffered ([why] in a few words). */
        fun teeUnsupported(why: String)
    }

    private val lock = Any()
    private var sink: Sink? = null
    private var open = 0
    /** Open readers whose media is not MPEG-TS (told to a sink attached later). */
    private var openOther = 0
    private var otherWhy = "not MPEG-TS"
    /** The next bytes passed on start a new piece (a sink was just attached). */
    private var needDisc = true
    private var lastFed: Reader? = null
    private var lastFedStream = false
    private var lastDir: String? = null
    /** An HLS segment reader that is passing bytes on and still open. */
    private var feeding: Reader? = null
    /** HLS segments passed on lately: address -> end of what was passed on (absolute offset). */
    private val fedUpTo = object : LinkedHashMap<String, Long>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > SEGMENTS_KEPT
    }

    /** Start passing bytes on to [s] (it replaces any other sink). */
    fun attach(s: Sink) {
        val tellOther: String?
        synchronized(lock) {
            sink = s
            needDisc = true
            lastFed = null
            lastDir = null
            feeding = null
            fedUpTo.clear()
            tellOther = if (openOther > 0) otherWhy else null
        }
        if (tellOther != null) s.teeUnsupported(tellOther)
    }

    /** Stop passing bytes on to [s] (no-op when another sink replaced it). */
    fun detach(s: Sink) {
        synchronized(lock) { if (sink === s) sink = null }
    }

    /** The player's live connections open right now. */
    fun openCount(): Int = synchronized(lock) { open }

    /**
     * The player opens [uri] from byte [position]. [channelAddress]: it is
     * the channel's own address (a raw stream, or the top playlist), not a
     * piece of it. Counted as open until [Reader.close].
     */
    fun begin(uri: String, position: Long, channelAddress: Boolean): Reader {
        synchronized(lock) { open++ }
        return Reader(uri, position.coerceAtLeast(0L), channelAddress)
    }

    inner class Reader internal constructor(
        private val uri: String,
        position: Long,
        private val channelAddress: Boolean,
    ) {
        private var kind = if (looksPlaylistUri(uri)) KIND_SKIP else KIND_UNKNOWN
        private var probe: ByteArray? = null
        private var probeLen = 0
        /** Absolute offset (in [uri]) of the next byte read. */
        private var offset = position
        private var closed = false

        /** Bytes the player just read. Loader thread. */
        fun bytes(b: ByteArray, off: Int, len: Int) {
            if (len <= 0 || closed) return
            when (kind) {
                KIND_TS -> feed(b, off, len)
                KIND_UNKNOWN -> {
                    val p = probe ?: ByteArray(PROBE).also { probe = it }
                    val n = minOf(len, PROBE - probeLen)
                    System.arraycopy(b, off, p, probeLen, n)
                    probeLen += n
                    if (probeLen < PROBE) return
                    classify()
                    if (kind == KIND_TS) {
                        feed(p, 0, probeLen)
                        if (len > n) feed(b, off + n, len - n)
                    }
                    probe = null
                }
                else -> offset += len
            }
        }

        /** The player closed this connection (or its open failed). */
        fun close() {
            if (closed) return
            // A short body: decided on what came.
            if (kind == KIND_UNKNOWN && probeLen > 0) {
                val p = probe!!
                if (LiveSource.looksTs(p, probeLen)) {
                    kind = KIND_TS
                    feed(p, 0, probeLen)
                }
            }
            probe = null
            closed = true
            synchronized(lock) {
                open--
                if (kind == KIND_OTHER) openOther--
                if (feeding === this) feeding = null
            }
        }

        private fun classify() {
            val p = probe!!
            val n = probeLen
            var i = 0
            // A UTF-8 byte order mark, then white space.
            if (n >= 3 && p[0] == 0xEF.toByte() && p[1] == 0xBB.toByte() && p[2] == 0xBF.toByte()) i = 3
            while (i < n && (p[i] == ' '.code.toByte() || p[i] == '\n'.code.toByte() || p[i] == '\r'.code.toByte() || p[i] == '\t'.code.toByte())) i++
            kind = when {
                startsWith(p, i, n, "#EXT") -> KIND_SKIP // a playlist
                startsWith(p, i, n, "WEBVTT") -> KIND_SKIP // subtitles
                LiveSource.looksTs(p, n) -> KIND_TS
                else -> KIND_OTHER
            }
            if (kind != KIND_OTHER) return
            val why = when {
                n >= 8 && (boxIs(p, "ftyp") || boxIs(p, "styp") || boxIs(p, "moof") || boxIs(p, "sidx") || boxIs(p, "moov")) -> "fMP4"
                startsWith(p, 0, n, "ID3") -> "packed audio"
                else -> "not MPEG-TS"
            }
            val s: Sink?
            synchronized(lock) {
                openOther++
                otherWhy = why
                s = sink
            }
            s?.teeUnsupported(why)
        }

        private fun feed(b: ByteArray, off: Int, len: Int) {
            var o = off
            var l = len
            var start = offset
            offset += len
            synchronized(lock) {
                val s = sink ?: return
                var disc = false
                if (!channelAddress) {
                    val upTo = fedUpTo[uri]
                    if (upTo != null) {
                        if (start + l <= upTo) return // already passed on
                        if (start < upTo) {
                            val skip = (upTo - start).toInt()
                            o += skip
                            l -= skip
                            start = upTo
                        } else if (start > upTo) {
                            disc = true // a hole in this segment
                        }
                    } else if (start > 0L) {
                        disc = true // the rest of a segment whose start was never seen
                    }
                }
                if (lastFed !== this) {
                    val f = feeding
                    if (!channelAddress && f != null && f !== this) {
                        // Two segments loading at once: audio and video come separately.
                        sink = null
                        s.teeUnsupported("separate audio and video")
                        return
                    }
                    val dir = dirOf(uri)
                    if (needDisc || channelAddress || lastFedStream || (lastDir != null && dir != lastDir)) disc = true
                    lastFed = this
                    lastFedStream = channelAddress
                    lastDir = dir
                    if (!channelAddress) feeding = this
                }
                if (disc) s.teeDiscontinuity()
                needDisc = false
                s.teeBytes(b, o, l)
                if (!channelAddress) fedUpTo[uri] = start + l
            }
        }
    }

    companion object {
        private const val KIND_UNKNOWN = 0
        private const val KIND_TS = 1
        /** A playlist or subtitles: never passed on. */
        private const val KIND_SKIP = 2
        /** Media that is not MPEG-TS. */
        private const val KIND_OTHER = 3
        /** Enough for LiveSource.looksTs (a packet start, and the next one 188 bytes on). */
        private const val PROBE = 3 * 188
        private const val SEGMENTS_KEPT = 64

        fun looksPlaylistUri(uri: String): Boolean =
            uri.substringBefore('?').lowercase(Locale.US).let { it.endsWith(".m3u8") || it.endsWith(".m3u") }

        /** The folder an address is in (a variant's segments share one). */
        fun dirOf(uri: String): String = uri.substringBefore('?').substringBeforeLast('/')

        private fun startsWith(p: ByteArray, at: Int, n: Int, text: String): Boolean {
            if (n - at < text.length) return false
            for (k in text.indices) if (p[at + k] != text[k].code.toByte()) return false
            return true
        }

        private fun boxIs(p: ByteArray, type: String): Boolean = startsWith(p, 4, 8, type)
    }
}
