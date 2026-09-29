package com.snowmedia.player

/**
 * mpv's time to first picture, restarts and stalls for one load() (the mpv
 * engine, owner test builds only; see EngineChoice). Plain arithmetic with
 * no Android and no MPVLib in it, so it can be checked off the device;
 * MpvEngine feeds it mpv's events and reads the numbers back for stats().
 *
 * An "attempt" is the load itself or one restart of it. A stall is time the
 * viewer had a picture and then lost it: mpv pausing for its cache, or the
 * stream dropping and being started again. The wait before the very first
 * picture is firstFrameMs, never a stall (the same rule ExoPlayer's own
 * stall count follows in SnowPlayerPlugin).
 */
internal class MpvPlaybackClock(private val maxRestarts: Int) {
    var firstFrameMs: Long? = null
        private set
    var stalls: Int = 0
        private set
    /** Restarts since load(): what the stats panel shows. */
    var restarts: Int = 0
        private set
    /** This attempt has put a picture on screen (or, on a radio channel with
     *  no video track at all, started playing). */
    var pictureUp: Boolean = false
        private set

    // Restarts since the last picture: the cap. A picture starts it over,
    // as it does for ExoPlayer's reconnects.
    private var restartsSincePicture = 0
    private var loadStartedAt = 0L
    private var stallStartedAt = 0L
    private var stallMsTotal = 0L

    val stalled: Boolean get() = stallStartedAt != 0L

    fun load(now: Long) {
        firstFrameMs = null
        stalls = 0
        restarts = 0
        pictureUp = false
        restartsSincePicture = 0
        loadStartedAt = now
        stallStartedAt = 0L
        stallMsTotal = 0L
    }

    /** The stream ended or showed nothing in time. False once maxRestarts
     *  in a row have gone by without a picture: give up (RECONNECT_EXHAUSTED). */
    fun restart(now: Long): Boolean {
        if (restartsSincePicture >= maxRestarts) return false
        restartsSincePicture++
        restarts++
        // The viewer had a picture and has lost it. A restart of a restart
        // that never showed one is the same stall carrying on.
        if (pictureUp) beginStall(now)
        pictureUp = false
        return true
    }

    /** A picture is on screen. True the first time for this load(). */
    fun picture(now: Long): Boolean {
        pictureUp = true
        restartsSincePicture = 0
        endStall(now)
        if (firstFrameMs != null) return false
        firstFrameMs = (now - loadStartedAt).coerceAtLeast(0L)
        return true
    }

    /** mpv's paused-for-cache. Before this attempt's picture it is part of
     *  the start-up (or of a restart's stall, already running), not a stall
     *  of its own. */
    fun cachePause(active: Boolean, now: Long) {
        if (!pictureUp) return
        if (active) beginStall(now) else endStall(now)
    }

    /** Seconds stalled since load(), a stall still running included, to 0.1. */
    fun stallSec(now: Long): Double {
        val running = if (stallStartedAt != 0L) (now - stallStartedAt).coerceAtLeast(0L) else 0L
        return Math.round((stallMsTotal + running) / 100.0) / 10.0
    }

    private fun beginStall(now: Long) {
        if (stallStartedAt != 0L) return
        stallStartedAt = now
        stalls++
    }

    private fun endStall(now: Long) {
        if (stallStartedAt == 0L) return
        stallMsTotal += (now - stallStartedAt).coerceAtLeast(0L)
        stallStartedAt = 0L
    }

    companion object {
        /**
         * Whether mpv has stopped playing on its own (the stream ended or
         * could not be opened) and should be started again.
         *
         * Not mpv's END_FILE event: mpv sends one for the file being replaced
         * on every `loadfile … replace` too, so a channel change, and each
         * restart itself, looked like the stream ending. That restarted it
         * 500 ms later, which ended the file again: a reload every half
         * second, for good (bugs/mpv-black-screen.md). mpv going idle is the
         * real sign: a replace goes straight to the next file and never
         * passes through idle; a stream that ends or fails with nothing
         * after it does.
         *
         * `idleNow`: mpv's idle-active read now, on the main thread, not the
         * value the (posted, possibly stale) change notice carried — after
         * a loadfile it is already false. `wanted`: a stream is loaded.
         * `startPending`: a start is already on its way (waiting for the
         * surface, or a restart's delay).
         */
        fun endedByItself(idleNow: Boolean, wanted: Boolean, startPending: Boolean): Boolean =
            idleNow && wanted && !startPending

        /**
         * At mpv's playback-restart: is there a picture? `videoOutWidth` is
         * video-out-params/w (0 while no frame has reached the video output,
         * as when the video decoder or output failed and mpv carries on with
         * sound alone). `tracks` / `videoTracks`: how many tracks, and video
         * tracks, the stream has. A radio channel has tracks but no video,
         * and its sound is all there is; no tracks at all means the stream
         * is not open yet, which is never a picture.
         */
        fun isPicture(videoOutWidth: Int, tracks: Int, videoTracks: Int): Boolean =
            videoOutWidth > 0 || (tracks > 0 && videoTracks == 0)
    }
}
