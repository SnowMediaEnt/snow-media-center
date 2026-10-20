package com.snowmedia.player

/**
 * When a live channel that never started is given up as off the air
 * (SnowPlayerPlugin.onPlayerError). Plain arithmetic with no Android in it,
 * so it can be checked off the device.
 *
 * A dead channel's address answers that the stream isn't there (HTTP 404 /
 * 410) or that the server can't serve it (500 / 502 / 503 / 504). It used to
 * be treated like a channel that keeps dropping: 20 reconnects, each after
 * the player's own quiet retries, then the WebView's fresh start and 20
 * more. Minutes of "Buffering… your connection looks slow, try a VPN" for a
 * channel that is simply not on the air, and a failover to the viewer's
 * other service only after all that.
 *
 * An "off the air" verdict is also the channel's report to every box on the
 * service, so it must be right more than it must be fast. A channel is given
 * up only when all of these hold:
 * - it is live, and has not played since it was loaded: no picture and not
 *   playing (a radio channel never draws a picture, but it plays);
 * - the answer came for the stream's own address (its playlist, or the raw
 *   stream), never for a piece of it (an HLS segment, which keeps the
 *   player's own retries and does not count here);
 * - the same answer that many times in a row (twice for 404 / 410, four
 *   times for 5xx), "in a row" ending at any other error and whenever
 *   playback gets going;
 * - at least FLOOR_MS since it was loaded: a panel answers 404 / 503 for a
 *   few seconds while a source starts or switches to its backup, a load
 *   balancer 502 / 503 for a moment, a one-connection line 503 to a zap
 *   while the last channel's connection is still closing. The tries are
 *   spread out meanwhile (retryDelayMs: 1 s, 2 s, 4 s…), one request each.
 * A dead channel then says so after about 8 s, five requests. Unchanged:
 * 401 / 403 (the line's connection limit, or a block), timeouts and failed
 * connections, any other answer, films, and a channel that has played (one
 * that was playing and drops keeps its patient 20 reconnects).
 */
internal object DeadStreamRule {
    enum class Kind { GONE, SERVER }

    /** "Not there" (404 / 410) this many times in a row… */
    const val GONE_TRIES = 2
    /** …a server error (5xx) this many (a server can be busy for a moment)… */
    const val SERVER_TRIES = 4
    /** …and never before this long after load(): the first-picture watchdog's 8 s. */
    const val FLOOR_MS = 8000L
    /** The shortest wait between two tries (the plugin's usual reconnect delay). */
    const val MIN_GAP_MS = 500L

    /** What an answer says, for the stream's own address (`address`); a piece of it says nothing. */
    fun kindOf(httpStatus: Int?, address: Boolean): Kind? = if (!address) null else when (httpStatus) {
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

    /** Give up now (see the rules above). `sinceLoadMs`: time since load(). */
    fun givesUp(live: Boolean, played: Boolean, kind: Kind?, streak: Int, sinceLoadMs: Long): Boolean =
        live && !played && kind != null && streak >= tries(kind) && sinceLoadMs >= FLOOR_MS

    /** The wait before the next try of a counted answer: 1 s, 2 s, 4 s, 8 s
     *  as the run grows, but before the floor no later than the floor itself
     *  (a dead channel says so soon after it), never under MIN_GAP_MS. */
    fun retryDelayMs(streak: Int, sinceLoadMs: Long): Long {
        val backoff = 1000L shl (streak - 1).coerceIn(0, 3)
        val toFloor = FLOOR_MS - sinceLoadMs
        return if (toFloor > 0) maxOf(MIN_GAP_MS, minOf(backoff, toFloor)) else backoff
    }

    /** The player's own quiet retries (six, about 15 s) are skipped for such
     *  an answer to the stream's own address: each try is one request, and
     *  the plugin spreads them (retryDelayMs). Pieces keep theirs. */
    fun skipLoaderRetry(live: Boolean, played: Boolean, httpStatus: Int?, address: Boolean): Boolean =
        live && !played && kindOf(httpStatus, address) != null
}
