package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A live channel that never started and whose server says the stream isn't
 * there (404 / 410) is given up after 2 tries, one with server errors (5xx)
 * after 4; everything else keeps the patient reconnects (DeadStreamRule).
 */
class DeadStreamRuleTest {

    /** The run of errors, as onPlayerError counts them; true when it gives up at the last one. */
    private fun run(statuses: List<Int?>, live: Boolean = true, picture: Boolean = false): Boolean {
        var kind: DeadStreamRule.Kind? = null
        var streak = 0
        var gaveUp = false
        for (status in statuses) {
            val k = DeadStreamRule.kindOf(status)
            streak = DeadStreamRule.streak(kind, streak, k)
            kind = k
            gaveUp = DeadStreamRule.givesUp(live, picture, k, streak)
            if (gaveUp) break
        }
        return gaveUp
    }

    @Test fun `which answers count`() {
        assertEquals(DeadStreamRule.Kind.GONE, DeadStreamRule.kindOf(404))
        assertEquals(DeadStreamRule.Kind.GONE, DeadStreamRule.kindOf(410))
        for (s in listOf(500, 502, 503, 504)) assertEquals(DeadStreamRule.Kind.SERVER, DeadStreamRule.kindOf(s))
        for (s in listOf(null, 200, 206, 301, 400, 401, 403, 416, 429, 501, 505)) assertNull("$s", DeadStreamRule.kindOf(s))
    }

    @Test fun `404 and 410 give up at the second try in a row`() {
        assertFalse(run(listOf(404)))
        assertTrue(run(listOf(404, 404)))
        assertTrue(run(listOf(410, 410)))
        assertTrue(run(listOf(404, 410)))
    }

    @Test fun `5xx gives up at the fourth try in a row`() {
        assertFalse(run(listOf(503, 503, 503)))
        assertTrue(run(listOf(503, 503, 503, 503)))
        assertTrue(run(listOf(500, 502, 503, 504)))
    }

    @Test fun `only in a row - another error starts the count over`() {
        assertFalse(run(listOf(404, null, 404)))
        assertFalse(run(listOf(503, 503, 403, 503, 503)))
        // A 404 after server errors is a new run of its own.
        assertFalse(run(listOf(503, 404)))
        assertTrue(run(listOf(503, 404, 404)))
    }

    @Test fun `401, 403, timeouts and other answers never give up early`() {
        assertFalse(run(List(30) { 403 }))
        assertFalse(run(List(30) { 401 }))
        assertFalse(run(List(30) { null }))
        assertFalse(run(List(30) { 429 }))
    }

    @Test fun `a channel that has drawn a picture since it was loaded keeps the patient reconnects`() {
        assertFalse(run(List(30) { 404 }, picture = true))
        assertFalse(run(List(30) { 503 }, picture = true))
    }

    @Test fun `films are never given up this way`() {
        assertFalse(run(List(30) { 404 }, live = false))
    }

    @Test fun `the player's quiet retries are skipped only for those answers, on a live channel with no picture yet`() {
        assertTrue(DeadStreamRule.skipLoaderRetry(live = true, pictureThisLoad = false, httpStatus = 404))
        assertTrue(DeadStreamRule.skipLoaderRetry(live = true, pictureThisLoad = false, httpStatus = 503))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, pictureThisLoad = false, httpStatus = 403))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, pictureThisLoad = false, httpStatus = null))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = true, pictureThisLoad = true, httpStatus = 404))
        assertFalse(DeadStreamRule.skipLoaderRetry(live = false, pictureThisLoad = false, httpStatus = 404))
    }
}
