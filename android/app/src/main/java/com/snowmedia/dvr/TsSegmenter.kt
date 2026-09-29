package com.snowmedia.dvr

import android.os.SystemClock

/**
 * Cuts a live MPEG-TS byte stream into HLS segments (Rewind live TV).
 *
 * Bytes arrive in whatever pieces the network hands over; they are put back
 * together into 188-byte packets and passed on to [Output] untouched. A new
 * segment starts at a PAT packet (PID 0, start of a section) once the current
 * one is at least [targetMs] long: encoders put the PAT/PMT right before a
 * key frame, so a segment the player jumps into finds its program table and a
 * picture at once. A stream that never repeats its PAT is cut anyway at
 * [maxMs], on any packet.
 *
 * Durations come from the stream's own clock (PCR, 90 kHz), so the playlist
 * matches the media; a stream without one falls back to the wall clock (a live
 * stream arrives in real time). A clock that jumps (the source restarted, or a
 * reconnect) starts a new segment marked as a discontinuity, which the
 * playlist carries as #EXT-X-DISCONTINUITY.
 *
 * Nothing here is held beyond one packet. Capture thread only.
 */
internal class TsSegmenter(
    private val targetMs: Long,
    private val maxMs: Long,
    private val out: Output,
) {
    interface Output {
        /** A new segment starts; [discontinuity]: timestamps jump here. */
        fun beginSegment(discontinuity: Boolean)
        /** One 188-byte packet of the current segment. */
        fun writePacket(buf: ByteArray, off: Int)
        /** The current segment is complete and [durationMs] long. */
        fun endSegment(durationMs: Long)
    }

    private val carry = ByteArray(PACKET)
    private var carryLen = 0
    private var inSegment = false
    private var pendingDiscontinuity = false
    private var pcrPid = -1
    private var lastPcr = -1L
    private var segStartPcr = -1L
    private var segStartWall = 0L

    /** Feed bytes as they arrive. */
    fun feed(buf: ByteArray, off: Int, len: Int) {
        var i = off
        val end = off + len
        if (carryLen > 0) {
            val need = PACKET - carryLen
            if (len < need) {
                System.arraycopy(buf, off, carry, carryLen, len)
                carryLen += len
                return
            }
            System.arraycopy(buf, off, carry, carryLen, need)
            carryLen = 0
            i += need
            packet(carry, 0)
        }
        while (i < end) {
            if (buf[i] != SYNC) { i++; continue } // lost sync: look for the next packet start
            if (end - i < PACKET) {
                System.arraycopy(buf, i, carry, 0, end - i)
                carryLen = end - i
                return
            }
            packet(buf, i)
            i += PACKET
        }
    }

    /** The source was reopened: what follows is not continuous with what came before. */
    fun markDiscontinuity() {
        // What was written so far is a whole segment; the reopened stream
        // starts the next one, flagged, on its own clock.
        if (inSegment) {
            out.endSegment(currentMs())
            inSegment = false
        }
        carryLen = 0
        lastPcr = -1L
        segStartPcr = -1L
        pendingDiscontinuity = true
    }

    /** Close the segment being written (the capture is ending). */
    fun finish() {
        if (inSegment) {
            out.endSegment(currentMs())
            inSegment = false
        }
        carryLen = 0
    }

    /** How long the segment being written is so far (the not-yet-listed live edge). */
    fun currentMs(): Long {
        if (!inSegment) return 0L
        if (segStartPcr >= 0 && lastPcr >= 0) return pcrDelta(segStartPcr, lastPcr) / 90L
        return SystemClock.elapsedRealtime() - segStartWall
    }

    private fun packet(b: ByteArray, p: Int) {
        val pid = ((b[p + 1].toInt() and 0x1F) shl 8) or (b[p + 2].toInt() and 0xFF)
        val unitStart = (b[p + 1].toInt() and 0x40) != 0
        val pcr = pcrOf(b, p)
        var jumped = false
        if (pcr >= 0) {
            if (pcrPid < 0) pcrPid = pid
            if (pid == pcrPid) {
                if (lastPcr >= 0) {
                    val d = pcrDelta(lastPcr, pcr)
                    if (d < 0 || d > MAX_PCR_STEP) jumped = true
                }
                if (!jumped) {
                    lastPcr = pcr
                    if (inSegment && segStartPcr < 0) segStartPcr = pcr
                }
            }
        }
        if (!inSegment) {
            begin(pendingDiscontinuity, pcr, pid)
        } else if (jumped || pendingDiscontinuity) {
            out.endSegment(currentMs())
            begin(true, pcr, pid)
        } else {
            val ms = currentMs()
            if ((pid == 0 && unitStart && ms >= targetMs) || ms >= maxMs) {
                out.endSegment(ms)
                begin(false, lastPcr, -1)
            }
        }
        out.writePacket(b, p)
    }

    private fun begin(discontinuity: Boolean, pcr: Long, pid: Int) {
        inSegment = true
        pendingDiscontinuity = false
        if (discontinuity && pcr >= 0 && (pid == pcrPid || pid < 0)) lastPcr = pcr
        segStartPcr = if (pcr >= 0 && (pid == pcrPid || pid < 0)) pcr else -1L
        if (discontinuity && segStartPcr < 0) lastPcr = -1L
        segStartWall = SystemClock.elapsedRealtime()
        out.beginSegment(discontinuity)
    }

    companion object {
        const val PACKET = 188
        private const val SYNC: Byte = 0x47
        /** PCR base wraps at 2^33 (about 26.5 hours at 90 kHz). */
        private const val PCR_WRAP = 1L shl 33
        /** A clock step over 10 s (or backwards) is a jump, not time passing. */
        private const val MAX_PCR_STEP = 10L * 90_000L

        /** 90 kHz ticks from [from] to [to], across the 33-bit wrap. */
        fun pcrDelta(from: Long, to: Long): Long {
            var d = to - from
            if (d < -(PCR_WRAP / 2)) d += PCR_WRAP
            else if (d > PCR_WRAP / 2) d -= PCR_WRAP
            return d
        }

        /** The packet's PCR base (90 kHz), or -1 when it carries none. */
        fun pcrOf(b: ByteArray, p: Int): Long {
            val afc = (b[p + 3].toInt() shr 4) and 0x3
            if (afc != 2 && afc != 3) return -1L
            val afLen = b[p + 4].toInt() and 0xFF
            if (afLen < 7) return -1L
            if ((b[p + 5].toInt() and 0x10) == 0) return -1L
            return ((b[p + 6].toLong() and 0xFF) shl 25) or
                ((b[p + 7].toLong() and 0xFF) shl 17) or
                ((b[p + 8].toLong() and 0xFF) shl 9) or
                ((b[p + 9].toLong() and 0xFF) shl 1) or
                ((b[p + 10].toLong() and 0xFF) shr 7)
        }
    }
}
