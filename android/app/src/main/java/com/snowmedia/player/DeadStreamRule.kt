package com.snowmedia.player

/**
 * When a live channel that never started is given up as off the air
 * (SnowPlayerPlugin.onPlayerError). Plain arithmetic with no Android in it,
 * so it can be checked off the device.
 *
 * A dead channel's address answers at once that the stream isn't there
 * (HTTP 404 / 410) or that the server can't serve it (500 / 502 / 503 /
 * 504). It used to be treated like a channel that keeps dropping: 20
 * reconnects, each after the player's own quiet retries, then the WebView's
 * fresh start and 20 more. Minutes of "Buffering… your connection looks
 * slow, try a VPN" for a channel that is simply not on the air, and a
 * failover to the viewer's other service that came only after all that.
 *
 * Now, for a live channel that has drawn nothing since it was loaded:
 * - the player does not retry such an answer quietly (skipLoaderRetry), so
 *   each try is one request;
 * - the same answer twice in a row for "not there" (the first and one
 *   retry), four times for a server error, and it is given up as
 *   RECONNECT_EXHAUSTED with the status.
 * Unchanged: 401 / 403 (the line's connection limit, or a block), timeouts
 * and connections that fail (the viewer's own internet), any other answer,
 * films, and a channel that has played since it was loaded (one that was
 * playing and drops keeps its patient 20 reconnects).
 */
internal object DeadStreamRule {
    enum class Kind { GONE, SERVER }

    /** "Not there" (404 / 410): the first try and one retry. */
    const val GONE_TRIES = 2
    /** A server error (5xx): a server can be busy for a moment. */
    const val SERVER_TRIES = 4

    fun kindOf(httpStatus: Int?): Kind? = when (httpStatus) {
        404, 410 -> Kind.GONE
        500, 502, 503, 504 -> Kind.SERVER
        else -> null
    }

    fun tries(kind: Kind): Int = if (kind == Kind.GONE) GONE_TRIES else SERVER_TRIES

    /** The run of the same answer after this error: one more of the same
     *  kind, 1 for another kind, 0 for any other error (in a row only). */
    fun streak(prevKind: Kind?, prevStreak: Int, kind: Kind?): Int = when {
        kind == null -> 0
        kind == prevKind -> prevStreak + 1
        else -> 1
    }

    /** Give up now: a live channel, nothing drawn since it was loaded, and the run has reached its tries. */
    fun givesUp(live: Boolean, pictureThisLoad: Boolean, kind: Kind?, streak: Int): Boolean =
        live && !pictureThisLoad && kind != null && streak >= tries(kind)

    /** The player's own quiet retries of this answer are skipped: each try is one request, counted here. */
    fun skipLoaderRetry(live: Boolean, pictureThisLoad: Boolean, httpStatus: Int?): Boolean =
        live && !pictureThisLoad && kindOf(httpStatus) != null
}
