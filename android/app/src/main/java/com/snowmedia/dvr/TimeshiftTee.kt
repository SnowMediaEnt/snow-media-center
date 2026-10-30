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
 *   apart by their first bytes). The media playlists the player reads are
 *   parsed here (never passed on) for each segment's media sequence number:
 *   a segment whose number was already passed on is skipped whole, whatever
 *   its address. That is what a variant switch does (Media3 loads the
 *   segment it was in again from the new variant, under another address).
 *   A segment read again under the same address (a retry, part of one
 *   resumed) is passed on only past what was already passed on. A segment
 *   whose number is not known (its playlist could not be matched) falls back
 *   to the address alone. A segment from another folder (another variant) is
 *   a discontinuity;
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
    /** Media sequence numbers of segments, from the media playlists read: address -> number. */
    private val seqOf = object : LinkedHashMap<String, Long>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > SEQ_KEPT
    }
    /** The player's last media playlist, where it was finally served from (an Xtream token path), and when (nanoTime). */
    private var lastPlaylist: String? = null
    private var lastPlaylistAt = 0L
    /** The highest media sequence number passed on (-1: none yet). */
    private var maxSeq = -1L
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
            maxSeq = -1L
            tellOther = if (openOther > 0) otherWhy else null
        }
        diag("sink attached; player connections open: ${openCount()}")
        if (tellOther != null) s.teeUnsupported(tellOther)
    }

    /** Stop passing bytes on to [s] (no-op when another sink replaced it). */
    fun detach(s: Sink) {
        val was = synchronized(lock) { (sink === s).also { if (it) sink = null } }
        if (was) diag("sink detached; player connections open: ${openCount()}")
    }

    /** The player's live connections open right now. */
    fun openCount(): Int = synchronized(lock) { open }

    /**
     * The media playlist the player read last, at the address it was finally
     * served from, if within [maxAgeMs]: the session's own connection goes on
     * from there, so the panel sees the player's HLS session carry on rather
     * than a new one. Null for a raw stream. Never logged.
     */
    fun recentMediaPlaylist(maxAgeMs: Long): String? = synchronized(lock) {
        val p = lastPlaylist ?: return null
        if ((System.nanoTime() - lastPlaylistAt) / 1_000_000L > maxAgeMs) null else p
    }

    /**
     * The player opens [uri] from byte [position]. [channelAddress]: it is
     * the channel's own address (a raw stream, or the top playlist), not a
     * piece of it. Counted as open until [Reader.close].
     */
    fun begin(uri: String, position: Long, channelAddress: Boolean): Reader {
        val now = synchronized(lock) { ++open }
        diag("player opened ${if (channelAddress) "the channel address" else "a piece"}; open: $now")
        return Reader(uri, position.coerceAtLeast(0L), channelAddress)
    }

    inner class Reader internal constructor(
        private val uri: String,
        position: Long,
        private val channelAddress: Boolean,
    ) {
        private var kind = if (looksPlaylistUri(uri)) KIND_PLAYLIST else KIND_UNKNOWN
        private var probe: ByteArray? = null
        /** A playlist's text, read to learn its segments' numbers. */
        private var text: java.io.ByteArrayOutputStream? = null
        /** Where relative addresses in a playlist are resolved from (the address after redirects). */
        private var base: String = uri
        /** This segment's media sequence number (-1: unknown); decided on its first bytes. */
        private var seq = -2L
        /** Skipped whole: its number was already passed on. */
        private var skipped = false

        /** The address the server finally answered from (after redirects). */
        fun setBase(finalUri: String?) { if (!finalUri.isNullOrEmpty()) base = finalUri }
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
                    } else if (kind == KIND_PLAYLIST) {
                        keepText(p, 0, probeLen)
                        if (len > n) keepText(b, off + n, len - n)
                    }
                    probe = null
                }
                KIND_PLAYLIST -> keepText(b, off, len)
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
                } else if (String(p, 0, probeLen, Charsets.UTF_8).trimStart('\uFEFF', ' ', '\r', '\n', '\t').startsWith("#EXT")) {
                    kind = KIND_PLAYLIST // a short playlist
                    keepText(p, 0, probeLen)
                }
            }
            probe = null
            closed = true
            val t = text
            text = null
            if (kind == KIND_PLAYLIST && t != null) learnSequence(t.toString(Charsets.UTF_8.name()))
            val left = synchronized(lock) {
                open--
                if (kind == KIND_OTHER) openOther--
                if (feeding === this) feeding = null
                open
            }
            diag("${kindName(kind)} ${if (channelAddress) "(channel address)" else "(piece)"} closed: ${offset} B read" +
                (if (skipped) ", skipped (number already written)" else "") + "; player connections open: $left")
        }

        private fun classify() {
            val p = probe!!
            val n = probeLen
            var i = 0
            // A UTF-8 byte order mark, then white space.
            if (n >= 3 && p[0] == 0xEF.toByte() && p[1] == 0xBB.toByte() && p[2] == 0xBF.toByte()) i = 3
            while (i < n && (p[i] == ' '.code.toByte() || p[i] == '\n'.code.toByte() || p[i] == '\r'.code.toByte() || p[i] == '\t'.code.toByte())) i++
            kind = when {
                startsWith(p, i, n, "#EXT") -> KIND_PLAYLIST
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

        private fun keepText(b: ByteArray, off: Int, len: Int) {
            val t = text ?: java.io.ByteArrayOutputStream(8 * 1024).also { text = it }
            if (t.size() + len > MAX_PLAYLIST) { text = null; kind = KIND_SKIP; return }
            t.write(b, off, len)
        }

        /** A media playlist's segments and their numbers (a multivariant playlist has none). */
        private fun learnSequence(body: String) {
            if (!body.contains("#EXTINF")) return
            val baseUri = try { java.net.URI(base) } catch (_: Exception) { return }
            var next = 0L
            var afterInf = false
            val found = ArrayList<Pair<String, Long>>()
            for (raw in body.lineSequence()) {
                val line = raw.trim()
                if (line.isEmpty()) continue
                if (line.startsWith("#")) {
                    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) next = line.substringAfter(':').trim().toLongOrNull() ?: 0L
                    else if (line.startsWith("#EXTINF")) afterInf = true
                    continue
                }
                if (!afterInf) continue
                afterInf = false
                val abs = try { baseUri.resolve(line).toString() } catch (_: Exception) { null }
                if (abs != null) found.add(abs to next)
                next++
            }
            synchronized(lock) {
                for ((u, n) in found) seqOf[u] = n
                if (found.isNotEmpty()) { lastPlaylist = base; lastPlaylistAt = System.nanoTime() }
            }
        }

        private fun feed(b: ByteArray, off: Int, len: Int) {
            var o = off
            var l = len
            var start = offset
            offset += len
            synchronized(lock) {
                val s = sink ?: return
                if (skipped) return
                var disc = false
                if (!channelAddress && seq == -2L) {
                    seq = seqOf[uri] ?: -1L
                    val upTo = fedUpTo[uri]
                    if (seq >= 0 && maxSeq >= 0 && upTo == null) {
                        if (seq <= maxSeq && seq > maxSeq - SEQ_RESTART) {
                            // Already passed on from another address (a variant switch).
                            skipped = true
                            return
                        }
                        // Far behind: the channel's numbering started again.
                        if (seq <= maxSeq) disc = true
                    }
                    if (seq >= 0 && (seq > maxSeq || disc)) maxSeq = seq
                }
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
        /** Subtitles, or a playlist too big to read: never passed on. */
        private const val KIND_SKIP = 2
        /** A playlist: never passed on, read for its segments' numbers. */
        private const val KIND_PLAYLIST = 4
        private const val MAX_PLAYLIST = 512 * 1024
        private const val SEQ_KEPT = 1024
        /** A number this far below the highest passed on means the numbering restarted. */
        private const val SEQ_RESTART = 30L
        private fun kindName(k: Int): String = when (k) {
            KIND_TS -> "MPEG-TS"
            KIND_SKIP -> "subtitles"
            KIND_OTHER -> "not MPEG-TS"
            KIND_PLAYLIST -> "playlist"
            else -> "short body"
        }
        const val TAG = "SmcTimeshiftTee"

        private fun diag(msg: String) {
            try { android.util.Log.d(TAG, msg) } catch (_: Throwable) { /* no Android log (tests) */ }
        }
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
