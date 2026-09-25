package com.snowmedia.player

/**
 * When a film's start-up hold ends (SnowPlayerPlugin.schedulePreBuffer).
 * Plain arithmetic with no Android in it, so it can be checked off the
 * device.
 *
 * A start from 0:00 is held until 25 s of video are buffered, or for 10 s
 * after load() at most. That stays as it is: on the owner's TV those starts
 * play without a single stall.
 *
 * A start part-way into a file (a resume, a quality change at the viewer's
 * place, a reconnect after an error) is different. Before the first frame at
 * the resume point can even be asked for, the player reads the file's
 * header, jumps to its index at the far end, comes back, and only then opens
 * the file a third time at the resume point, where a remote server
 * (typically reading from cloud storage) starts from cold. Those round trips
 * alone ate most of the 10 s, so a resumed film started with 2-3 s in hand,
 * stalled at once and again a few seconds later (the owner's "0:02 and
 * 0:16"), and those stalls then sent automatic quality to a conversion.
 * Here the 10 s count only from the moment video at the resume point starts
 * arriving, so the time goes to filling the buffer, as it does for a start
 * from 0:00; a server that never delivers there still starts (and shows its
 * stall) after 30 s in all.
 */
internal object PreBufferRule {
    /** Buffer to reach before starting. */
    const val TARGET_MS = 25000L
    /** Time spent filling: from load() for a start from 0:00, from the
     *  first video at the start position for one part-way into a file. */
    const val MAX_WAIT_MS = 10000L
    /** A start part-way into a file never waits longer than this in all. */
    const val MID_FILE_CAP_MS = 30000L
    /** Stopped loading (the byte budget spent) with at least this much: as
     *  full as the player's limits allow. */
    const val FULL_MIN_MS = 10000L

    /**
     * When the filling time started (0: not yet). A start from 0:00 is
     * counted from load() by isDone and needs none. Part-way into a file:
     * the first tick at which video at the start position is buffered (or
     * the player is ready to play there).
     */
    fun flowStart(flowAt: Long, now: Long, midFile: Boolean, bufferedMs: Long, ready: Boolean): Long {
        if (!midFile || flowAt > 0L) return flowAt
        return if (bufferedMs > 0L || ready) now else 0L
    }

    /**
     * Whether to start playing now. `sinceLoadMs`: since load() (or the
     * reconnect); `flowAt`/`now`: from flowStart, same clock.
     */
    fun isDone(
        midFile: Boolean,
        sinceLoadMs: Long,
        flowAt: Long,
        now: Long,
        bufferedMs: Long,
        ready: Boolean,
        loading: Boolean,
        ended: Boolean,
    ): Boolean {
        if (ended || bufferedMs >= TARGET_MS) return true
        // Stopped loading with a decent buffer: the byte budget is spent (or
        // the file ends). Not below 10 s: a converting server between
        // segments also reads as "not loading", and that is exactly when the
        // extra wait helps.
        if (ready && !loading && bufferedMs >= FULL_MIN_MS) return true
        if (!midFile) return sinceLoadMs >= MAX_WAIT_MS
        if (sinceLoadMs >= MID_FILE_CAP_MS) return true
        return flowAt > 0L && now - flowAt >= MAX_WAIT_MS
    }
}
