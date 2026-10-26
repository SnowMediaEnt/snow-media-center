package com.snowmedia.player

/**
 * How much of a live channel the main player holds before it plays, at the
 * start and again after a stall (owner, 2026-10-26: "sooo many complaints
 * about 24/7"). Plain arithmetic with no Android in it, so it can be checked
 * off the device.
 *
 * A live .ts stream arrives at about real-time speed, so what is buffered
 * when playback starts is the cushion the whole session keeps: start at
 * 2.5 s and any hiccup of the server longer than 2.5 s stalls. A 24/7
 * channel (a looped film on a busy origin) hiccups more, so the WebView asks
 * for more on it (lib/liveBuffer: the "Live buffer" setting and Auto), per
 * load. 0 is "the player's own" (2.5 s / 5 s): what every load got before,
 * and what a tile, a film and the rewind buffer still get.
 *
 * It never waits on a buffer that has stopped growing (the byte budget
 * spent: `stillLoading` false), and an HLS live stream (a target live
 * offset) keeps Media3's own cap at half of that offset, which the stream
 * may never get past.
 */
internal object LiveCushion {
    /** The most a load may ask for (a bad value can't hold a channel forever). */
    const val MAX_MS = 30_000

    /** What a load asked for, in ms: 0 (the player's own) for nothing, a negative or a nonsense value. */
    fun clamp(ms: Double?): Int {
        if (ms == null || ms.isNaN() || ms <= 0.0) return 0
        return ms.coerceAtMost(MAX_MS.toDouble()).toInt()
    }

    /**
     * May the player start (or start again after a stall) now, as far as the
     * cushion goes? Called only once Media3's own rule has said yes.
     * `targetLiveOffsetUs`: Media3's (C.TIME_UNSET = none, as for a .ts stream).
     */
    fun startsNow(
        bufferedUs: Long,
        rebuffering: Boolean,
        startMs: Int,
        rebufferMs: Int,
        targetLiveOffsetUs: Long,
        stillLoading: Boolean,
        unset: Long,
    ): Boolean {
        var needUs = (if (rebuffering) rebufferMs else startMs) * 1000L
        if (needUs <= 0L) return true
        if (targetLiveOffsetUs != unset && targetLiveOffsetUs > 0L) needUs = minOf(needUs, targetLiveOffsetUs / 2)
        return bufferedUs >= needUs || !stillLoading
    }

    /** For the stats: "live 8 / 10 s"; null for the player's own. */
    fun label(startMs: Int, rebufferMs: Int): String? {
        if (startMs <= 0 && rebufferMs <= 0) return null
        fun sec(ms: Int): String = if (ms % 1000 == 0) "${ms / 1000}" else String.format(java.util.Locale.US, "%.1f", ms / 1000.0)
        return "live ${sec(startMs)} / ${sec(rebufferMs)} s"
    }
}
