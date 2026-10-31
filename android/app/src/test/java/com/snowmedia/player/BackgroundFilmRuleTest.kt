package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A film off screen is parked (BackgroundFilmRule). */
class BackgroundFilmRuleTest {

    @Test fun `the 2026-10-30 Plex film behind the launcher is parked`() {
        assertTrue(BackgroundFilmRule.parks(appStopped = true, main = true, live = false, exo = true))
    }

    @Test fun `on screen nothing is parked`() {
        assertFalse(BackgroundFilmRule.parks(appStopped = false, main = true, live = false, exo = true))
    }

    @Test fun `Live TV, a Multi-Screen tile and mpv keep their own rules`() {
        assertFalse(BackgroundFilmRule.parks(appStopped = true, main = true, live = true, exo = true))
        assertFalse(BackgroundFilmRule.parks(appStopped = true, main = false, live = false, exo = true))
        assertFalse(BackgroundFilmRule.parks(appStopped = true, main = true, live = false, exo = false))
    }

    @Test fun `back on screen a parked film is prepared again, paused`() {
        assertEquals(BackgroundFilmRule.Return.PREPARE_PAUSED, BackgroundFilmRule.onReturn(parked = true, hasStream = true))
    }

    @Test fun `one the page stopped meanwhile is only let go`() {
        assertEquals(BackgroundFilmRule.Return.FORGET, BackgroundFilmRule.onReturn(parked = true, hasStream = false))
    }

    @Test fun `one never parked is left alone`() {
        assertEquals(BackgroundFilmRule.Return.NOTHING, BackgroundFilmRule.onReturn(parked = false, hasStream = true))
        assertEquals(BackgroundFilmRule.Return.NOTHING, BackgroundFilmRule.onReturn(parked = false, hasStream = false))
    }

    @Test fun `the page's own load on return has time to come first`() {
        assertTrue(BackgroundFilmRule.RETURN_PREPARE_DELAY_MS in 1_000L..3_000L)
    }
}
