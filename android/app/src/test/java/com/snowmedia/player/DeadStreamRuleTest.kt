package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A live channel that never played and whose own address keeps answering
 * that the stream isn't there (404 / 410: twice in a row) or can't be served
 * (5xx: four times) is given up as off the air, never before 8 s after it
 * was loaded, the tries spread out meanwhile. Everything else keeps the
 * patient reconnects (DeadStreamRule).
 */
class DeadStreamRuleTest {

    /** One error as onPlayerError sees it: the status, whether it was the
     *  stream's own address, and whether playback got going just before it. */
    private data class Err(val status: Int?, val address: Boolean = true, val playingBefore: Boolean = false)

    /**
     * Runs the errors the way the plugin does, each try one request answered
     * after `rttMs`, the next one after retryDelayMs (or the usual 500 ms when
     * the error does not count). Returns the time it gave up, or null.
     */
    private fun run(errors: List<Err>, live: Boolean = true, played: Boolean = false, rttMs: Long = 100L): Long? {
        var kind: DeadStreamRule.Kind? = null
        var streak = 0
        var now = 0L
        for (e in errors) {
            now += rttMs
            if (e.playingBefore) { kind = null; streak = 0 }
            val k = DeadStreamRule.kindOf(e.status, e.address)
            streak = DeadStreamRule.streak(kind, streak, k)
            kind = k
            if (DeadStreamRule.givesUp(live, played, k, streak, now)) return now
            now += if (k != null && !played) DeadStreamRule.retryDelayMs(streak, now) else DeadStreamRule.MIN_GAP_MS
        }
        return null
    }

    private fun times(n: Int, status: Int?, address: Boolean = true) = List(n) { Err(status, address) }

    @Test fun `which answers count, and only for the stream's own address`() {
        assertEquals(DeadStreamRule.Kind.GONE, DeadStreamRule.kindOf(404, address = true))
        assertEquals(DeadStreamRule.Kind.GONE, DeadStreamRule.kindOf(410, address = true))
        for (s in listOf(500, 502, 503, 504)) assertEquals(DeadStreamRule.Kind.SERVER, DeadStreamRule.kindOf(s, address = true))
        for (s in listOf(null, 200, 206, 301, 400, 401, 403, 416, 429, 501, 505)) assertNull("$s", DeadStreamRule.kindOf(s, address = true))
        // An HLS segment's 404 / 503 says nothing about the channel.
        assertNull(DeadStreamRule.kindOf(404, address = false))
        assertNull(DeadStreamRule.kindOf(503, address = false))
    }

    @Test fun `the wait between tries - 1 s, 2 s, 4 s, then no later than the 8 s floor`() {
        assertEquals(1000L, DeadStreamRule.retryDelayMs(1, 100))
        assertEquals(2000L, DeadStreamRule.retryDelayMs(2, 1200))
        assertEquals(4000L, DeadStreamRule.retryDelayMs(3, 3300))
        assertEquals(600L, DeadStreamRule.retryDelayMs(4, 7400))
        // Never under the usual reconnect delay.
        assertEquals(DeadStreamRule.MIN_GAP_MS, DeadStreamRule.retryDelayMs(4, 7900))
        // Past the floor: the plain backoff, at most 8 s.
        assertEquals(2000L, DeadStreamRule.retryDelayMs(2, 9000))
        assertEquals(8000L, DeadStreamRule.retryDelayMs(4, 9000))
        assertEquals(8000L, DeadStreamRule.retryDelayMs(9, 20000))
    }

    @Test fun `a dead channel says so soon after 8 s, five requests in all - 404 and 5xx alike`() {
        val gone = run(times(10, 404))!!
        assertTrue("$gone", gone in 8000L..9000L)
        val server = run(times(10, 503))!!
        assertTrue("$server", server in 8000L..9000L)
        assertEquals(5, countTries(times(10, 404)))
    }

    private fun countTries(errors: List<Err>): Int {
        var kind: DeadStreamRule.Kind? = null
        var streak = 0
        var now = 0L
        errors.forEachIndexed { i, e ->
            now += 100
            val k = DeadStreamRule.kindOf(e.status, e.address)
            streak = DeadStreamRule.streak(kind, streak, k)
            kind = k
            if (DeadStreamRule.givesUp(true, false, k, streak, now)) return i + 1
            now += DeadStreamRule.retryDelayMs(streak, now)
        }
        return -1
    }

    @Test fun `never before 8 s - a source starting up or a zap's last connection gets its chance`() {
        // Twice 404 at once is not enough any more.
        assertFalse(DeadStreamRule.givesUp(true, false, DeadStreamRule.Kind.GONE, 2, 1200))
        assertFalse(DeadStreamRule.givesUp(true, false, DeadStreamRule.Kind.SERVER, 4, 7999))
        assertTrue(DeadStreamRule.givesUp(true, false, DeadStreamRule.Kind.GONE, 2, 8000))
        // Slow answers (2 s each): given up at the first count past the floor.
        val slow = run(times(10, 404), rttMs = 2000L)!!
        assertTrue("$slow", slow in 8000L..12000L)
    }

    @Test fun `5xx needs four in a row even past the floor`() {
        assertFalse(DeadStreamRule.givesUp(true, false, DeadStreamRule.Kind.SERVER, 3, 20000))
        assertTrue(DeadStreamRule.givesUp(true, false, DeadStreamRule.Kind.SERVER, 4, 20000))
    }

    @Test fun `only in a row - another error, or playback getting going, starts the count over`() {
        // A timeout in between, every time: never.
        assertNull(run(List(20) { i -> if (i % 2 == 0) Err(404) else Err(null) }))
        // A 403 between server errors.
        assertNull(run(listOf(Err(503), Err(503), Err(403), Err(503), Err(503), Err(403), Err(503), Err(503))))
        // Playback got going before each 404 (a radio channel's rare segment
        // trouble, or a stream that comes and goes): never.
        assertNull(run(List(20) { Err(404, playingBefore = true) }))
    }

    @Test fun `segment errors never count`() {
        assertNull(run(times(20, 404, address = false)))
        assertNull(run(times(20, 503, address = false)))
    }

    @Test fun `401, 403, timeouts and other answers never give up early`() {
        assertNull(run(times(30, 403)))
        assertNull(run(times(30, 401)))
        assertNull(run(times(30, null)))
        assertNull(run(times(30, 429)))
    }

    @Test fun `a channel that has played since it was loaded (a picture, or a radio playing) keeps the patient reconnects`() {
        assertNull(run(times(30, 404), played = true))
        assertNull(run(times(30, 503), played = true))
    }

    @Test fun `films are never given up this way`() {
        assertNull(run(times(30, 404), live = false))
    }

    @Test fun `the player's quiet retries are skipped only for the address's answer, on a live channel that has not played`() {
        assertTrue(DeadStreamRule.skipLoaderRetry(live = true, played = false, httpStatus = 404, address = true))
        assertTrue(DeadStreamRule.skipLoaderRetry(live = true, played = false, httpStatus = 503, address = true))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, played = false, httpStatus = 404, address = false))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, played = false, httpStatus = 403, address = true))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, played = false, httpStatus = null, address = true))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, played = true, httpStatus = 404, address = true))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = false, played = false, httpStatus = 404, address = true))
    }
}
