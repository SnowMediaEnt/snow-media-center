package com.snowmedia.player

/**
 * A film that says "Buffering" while it holds plenty of the film already:
 * when the plugin steps in (SnowPlayerPlugin.schedulePositionTick). Plain
 * arithmetic with no Android in it, so it can be checked off the device.
 *
 * On 2026-10-28 the owner's Fire TV stopped twice this way (a 1080p episode
 * at 1:02, a 4K one at 2:44): 50 s of the film buffered, nothing loading
 * (the buffer was full), the server and the line fine, and the player still
 * in BUFFERING for two minutes, until the viewer left the title. Nothing in
 * the log said why; a renderer that stopped being ready with its samples in
 * hand. A normal stall never looks like this: it waits for data that is on
 * its way (loading), and a 4K restart waits for 18 s at most.
 *
 * Here, after STUCK_MS of that, the first step seeks to the same place (the
 * renderers are flushed and start again from the key frame before it, the
 * buffer mostly kept). Still stuck STUCK_MS later, the second rebuilds the
 * player at that place (as for a missing picture). Then nothing more: the
 * WebView's own stall handling has it. Playing again ends the run.
 */
internal object StuckBufferRule {
    /** This long stuck before each step. */
    const val STUCK_MS = 5_000L
    /** Buffered ahead of the playhead to count as "in hand", not loading. */
    const val AHEAD_MS = 20_000L
    /** …or this much, even if the player says it is still loading. */
    const val AHEAD_LOADING_MS = 30_000L

    enum class Step { NONE, SEEK, REBUILD }

    /** Buffering with the film in hand: a film past its first picture, the
     *  viewer wanting it to play, not held by the plugin itself. */
    fun stuck(
        live: Boolean,
        playWhenReady: Boolean,
        buffering: Boolean,
        firstFrameSeen: Boolean,
        holding: Boolean,
        loading: Boolean,
        aheadMs: Long,
    ): Boolean =
        !live && playWhenReady && buffering && firstFrameSeen && !holding &&
            (aheadMs >= AHEAD_LOADING_MS || (!loading && aheadMs >= AHEAD_MS))

    /** The step due after `stuckForMs` stuck, with `stepsTaken` already. */
    fun step(stuckForMs: Long, stepsTaken: Int): Step = when {
        stuckForMs < STUCK_MS -> Step.NONE
        stepsTaken == 0 -> Step.SEEK
        stepsTaken == 1 -> Step.REBUILD
        else -> Step.NONE
    }
}
