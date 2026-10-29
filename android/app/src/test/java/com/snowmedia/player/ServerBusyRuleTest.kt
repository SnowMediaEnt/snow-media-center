package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A film's server answering 5xx while it plays (ServerBusyRule). */
class ServerBusyRuleTest {

    @Test fun `only a film's 5xx is retried quietly`() {
        assertTrue(ServerBusyRule.keepsTrying(live = false, httpStatus = 503, sinceFirstMs = 0))
        assertTrue(ServerBusyRule.keepsTrying(live = false, httpStatus = 500, sinceFirstMs = 60_000))
        assertFalse(ServerBusyRule.keepsTrying(live = true, httpStatus = 503, sinceFirstMs = 0))
        assertFalse(ServerBusyRule.keepsTrying(live = false, httpStatus = 404, sinceFirstMs = 0))
        assertFalse(ServerBusyRule.keepsTrying(live = false, httpStatus = null, sinceFirstMs = 0))
    }

    @Test fun `the wait grows 2, 4, 8, then 15 s`() {
        assertEquals(listOf(2000L, 4000L, 8000L, 15_000L, 15_000L, 15_000L), (1..6).map { ServerBusyRule.retryDelayMs(it) })
    }

    @Test fun `a two-minute 503 is ridden out, and the run stops after four minutes`() {
        // Each try: the wait, then about 15 s of the player's own retries
        // against the refusal before the error comes out again.
        var t = 0L
        var tries = 0
        while (ServerBusyRule.keepsTrying(false, 503, t)) {
            tries++
            t += ServerBusyRule.retryDelayMs(tries) + 15_000L
            if (t > 600_000) error("never stopped")
        }
        assertTrue("stopped after $t ms", t >= 180_000L)
        assertTrue("stopped after $t ms", t <= ServerBusyRule.MAX_MS + ServerBusyRule.MAX_GAP_MS + 15_000L)
        assertTrue(ServerBusyRule.keepsTrying(false, 503, 120_000L))
    }
}
