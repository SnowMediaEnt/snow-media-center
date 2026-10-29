package com.snowmedia.player

/**
 * A film (Plex or VOD) whose server answers a server error (HTTP 5xx) while
 * it plays: how long the plugin keeps trying, quietly, before the usual
 * give-up (SnowPlayerPlugin.onPlayerError). Plain arithmetic with no Android
 * in it, so it can be checked off the device.
 *
 * The player's own retries keep going while the buffer lasts (the error only
 * comes out once the buffer is empty and about 15 s of refusals have
 * passed). After that a film used to get three reconnects in a row
 * (MAX_VOD_RECONNECTS), each about 15 s against a refusal: about a minute,
 * then the WebView's one fresh start and the error card. A busy remote Plex
 * server answered 503 for about two minutes on 2026-10-28 and then sent
 * again by itself, so the film should still be there when it does.
 *
 * Here a 5xx run is retried from the same place with a growing wait (2 s,
 * 4 s, 8 s, then every 15 s), for MAX_MS from the first refusal, without
 * spending the film's normal reconnects. A picture in between ends the run.
 * Live TV, 4xx answers and errors without a status keep their own rules.
 */
internal object ServerBusyRule {
    /** Keep trying this long after the first 5xx of a run. */
    const val MAX_MS = 240_000L
    /** The longest wait between two tries. */
    const val MAX_GAP_MS = 15_000L

    fun isServerError(httpStatus: Int?): Boolean = httpStatus != null && httpStatus in 500..599

    /** Retry quietly now: a film, a 5xx, within MAX_MS of the run's first one
     *  (`sinceFirstMs`, 0 for the first). */
    fun keepsTrying(live: Boolean, httpStatus: Int?, sinceFirstMs: Long): Boolean =
        !live && isServerError(httpStatus) && sinceFirstMs < MAX_MS

    /** The wait before try number `tries` (1 = the first) of a run. */
    fun retryDelayMs(tries: Int): Long =
        minOf(MAX_GAP_MS, 2000L shl (tries - 1).coerceIn(0, 3))
}
