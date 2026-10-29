package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A film buffering with the film in hand (StuckBufferRule). */
class StuckBufferRuleTest {

    private fun stuck(
        live: Boolean = false,
        playWhenReady: Boolean = true,
        buffering: Boolean = true,
        firstFrameSeen: Boolean = true,
        holding: Boolean = false,
        loading: Boolean = false,
        aheadMs: Long = 50_000,
    ) = StuckBufferRule.stuck(live, playWhenReady, buffering, firstFrameSeen, holding, loading, aheadMs)

    @Test fun `the 2026-10-28 freeze counts, 50 s in hand and nothing loading`() {
        assertTrue(stuck())
    }

    @Test fun `a normal stall waiting for data does not`() {
        assertFalse(stuck(aheadMs = 3_000))
        assertFalse(stuck(aheadMs = 18_000)) // a 4K restart's wait
        assertFalse(stuck(loading = true, aheadMs = 25_000))
        assertTrue(stuck(loading = true, aheadMs = 30_000))
    }

    @Test fun `live, paused, start-up, the plugin's hold and playing never count`() {
        assertFalse(stuck(live = true))
        assertFalse(stuck(playWhenReady = false))
        assertFalse(stuck(firstFrameSeen = false))
        assertFalse(stuck(holding = true))
        assertFalse(stuck(buffering = false))
    }

    @Test fun `a seek after 5 s, then a rebuild, then nothing`() {
        assertEquals(StuckBufferRule.Step.NONE, StuckBufferRule.step(4_999, 0))
        assertEquals(StuckBufferRule.Step.SEEK, StuckBufferRule.step(5_000, 0))
        assertEquals(StuckBufferRule.Step.NONE, StuckBufferRule.step(2_000, 1))
        assertEquals(StuckBufferRule.Step.REBUILD, StuckBufferRule.step(5_000, 1))
        assertEquals(StuckBufferRule.Step.NONE, StuckBufferRule.step(60_000, 2))
    }
}
