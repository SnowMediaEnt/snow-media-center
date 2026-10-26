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

    // ── Catch-up: a bigger cushion asked for while the channel plays ────────
    //
    // The player is asked about its start only while it buffers, so a cushion
    // raised mid-play (a preview going full screen) would wait for the next
    // stall, which the viewer then sees. Instead it plays at CATCH_UP_SPEED
    // (the pitch kept) until that much is buffered ahead: at 0.93x a live
    // stream gains 0.07 s a second, so 7.5 s more takes about 107 s. Never
    // longer than CATCH_UP_MAX_MS; a stall, a seek, a pause or another
    // channel ends it at once (the plugin).

    const val CATCH_UP_SPEED = 0.93f
    const val CATCH_UP_MAX_MS = 180_000L
    /** Less short of the cushion than this: not worth slowing down for. */
    const val CATCH_UP_MIN_SHORT_MS = 1000L

    /** Start a catch-up: playing, and the new start cushion is that far ahead of what is buffered. */
    fun needsCatchUp(playing: Boolean, bufferedMs: Long, startMs: Int): Boolean =
        playing && startMs > 0 && startMs - bufferedMs >= CATCH_UP_MIN_SHORT_MS

    /** Why a running catch-up ends now ("filled", "timeout"), or null to go on. */
    fun catchUpEnd(bufferedMs: Long, startMs: Int, elapsedMs: Long): String? = when {
        bufferedMs >= startMs -> "filled"
        elapsedMs >= CATCH_UP_MAX_MS -> "timeout"
        else -> null
    }

    /**
     * How long a load may go without a first picture before the plugin's
     * watchdog reconnects it: its own wait (20 s for live), plus the start cushion the player
     * is told to wait for. A 10 s cushion on a stream that arrives at
     * real-time speed can't show a picture inside 8 s, and the reconnect
     * threw the half-filled cushion away to start again from nothing, over
     * and over (seen on the Fire TV, 2026-10-26).
     */
    fun firstFrameTimeoutMs(baseMs: Long, startMs: Int): Long =
        baseMs + startMs.coerceIn(0, MAX_MS)

    /** For the stats: "live 8 / 10 s"; null for the player's own. */
    fun label(startMs: Int, rebufferMs: Int): String? {
        if (startMs <= 0 && rebufferMs <= 0) return null
        fun sec(ms: Int): String = if (ms % 1000 == 0) "${ms / 1000}" else String.format(java.util.Locale.US, "%.1f", ms / 1000.0)
        return "live ${sec(startMs)} / ${sec(rebufferMs)} s"
    }
}
