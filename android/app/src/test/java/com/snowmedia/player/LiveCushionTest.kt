package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveCushionTest {
    private val unset = Long.MIN_VALUE + 1 // C.TIME_UNSET

    @Test fun clampsWhatALoadAsks() {
        assertEquals(0, LiveCushion.clamp(null))
        assertEquals(0, LiveCushion.clamp(-5.0))
        assertEquals(0, LiveCushion.clamp(Double.NaN))
        assertEquals(8000, LiveCushion.clamp(8000.0))
        assertEquals(LiveCushion.MAX_MS, LiveCushion.clamp(999_999.0))
    }

    @Test fun noCushionIsThePlayersOwn() {
        assertTrue(LiveCushion.startsNow(0L, false, 0, 0, unset, true, unset))
        assertTrue(LiveCushion.startsNow(0L, true, 0, 0, unset, true, unset))
    }

    @Test fun startWaitsForTheStartCushion() {
        assertFalse(LiveCushion.startsNow(7_999_000L, false, 8000, 10000, unset, true, unset))
        assertTrue(LiveCushion.startsNow(8_000_000L, false, 8000, 10000, unset, true, unset))
    }

    @Test fun afterAStallWaitsForTheRebufferCushion() {
        assertFalse(LiveCushion.startsNow(9_000_000L, true, 8000, 10000, unset, true, unset))
        assertTrue(LiveCushion.startsNow(10_000_000L, true, 8000, 10000, unset, true, unset))
    }

    @Test fun neverWaitsOnABufferThatStoppedGrowing() {
        assertTrue(LiveCushion.startsNow(3_000_000L, false, 15000, 18000, unset, false, unset))
    }

    @Test fun hlsLiveKeepsHalfItsTargetOffset() {
        // A 12 s target offset: never more than 6 s asked.
        assertTrue(LiveCushion.startsNow(6_000_000L, false, 15000, 18000, 12_000_000L, true, unset))
        assertFalse(LiveCushion.startsNow(5_000_000L, false, 15000, 18000, 12_000_000L, true, unset))
    }

    @Test fun labelForTheStats() {
        assertNull(LiveCushion.label(0, 0))
        assertEquals("live 8 / 10 s", LiveCushion.label(8000, 10000))
        assertEquals("live 2.5 / 5 s", LiveCushion.label(2500, 5000))
    }
}
