package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The mpv engine's start-up, restart and stall bookkeeping (MpvPlaybackClock). */
class MpvPlaybackClockTest {

    @Test fun `a channel change is not a stream end - the replace never makes mpv idle`() {
        // mpv's END_FILE for the replaced file used to restart the stream,
        // whose own replace ended it again: a reload every 500 ms. Only mpv
        // actually sitting idle while a stream is wanted is an end.
        assertFalse(MpvPlaybackClock.endedByItself(idleNow = false, wanted = true, startPending = false))
        assertTrue(MpvPlaybackClock.endedByItself(idleNow = true, wanted = true, startPending = false))
    }

    @Test fun `idle after a stop, or with a start already on its way, is not an end`() {
        assertFalse(MpvPlaybackClock.endedByItself(idleNow = true, wanted = false, startPending = false))
        assertFalse(MpvPlaybackClock.endedByItself(idleNow = true, wanted = true, startPending = true))
    }

    @Test fun `a picture needs a frame at the video output, unless the stream has no video`() {
        assertTrue(MpvPlaybackClock.isPicture(videoOutWidth = 1920, tracks = 2, videoTracks = 1))
        // Sound playing, video decoder/output failed: black, not a picture.
        assertFalse(MpvPlaybackClock.isPicture(videoOutWidth = 0, tracks = 2, videoTracks = 1))
        // A radio channel.
        assertTrue(MpvPlaybackClock.isPicture(videoOutWidth = 0, tracks = 1, videoTracks = 0))
        // Nothing open yet (a stale notice from the channel before).
        assertFalse(MpvPlaybackClock.isPicture(videoOutWidth = 0, tracks = 0, videoTracks = 0))
    }

    @Test fun `first picture is timed from load and reported once`() {
        val c = MpvPlaybackClock(maxRestarts = 20)
        c.load(1_000)
        assertNull(c.firstFrameMs)
        assertTrue(c.picture(1_540))
        assertEquals(540L, c.firstFrameMs)
        assertFalse(c.picture(9_000))
        assertEquals(540L, c.firstFrameMs)
    }

    @Test fun `cache pauses before the first picture are start-up, after it they are stalls`() {
        val c = MpvPlaybackClock(maxRestarts = 20)
        c.load(0)
        c.cachePause(true, 100)
        c.cachePause(false, 400)
        assertEquals(0, c.stalls)
        c.picture(500)
        c.cachePause(true, 10_000)
        assertTrue(c.stalled)
        assertEquals(1, c.stalls)
        // A stall still running counts in the seconds.
        assertEquals(1.5, c.stallSec(11_500), 0.0001)
        c.cachePause(false, 12_000)
        assertFalse(c.stalled)
        c.cachePause(true, 20_000)
        c.cachePause(false, 20_500)
        assertEquals(2, c.stalls)
        assertEquals(2.5, c.stallSec(99_000), 0.0001)
    }

    @Test fun `losing the picture to a restart is one stall until the picture is back`() {
        val c = MpvPlaybackClock(maxRestarts = 20)
        c.load(0)
        c.picture(500)
        assertTrue(c.restart(10_000))
        assertEquals(1, c.stalls)
        assertFalse(c.pictureUp)
        // The restart's own start-up: cache pauses and a second restart are
        // the same stall carrying on.
        c.cachePause(true, 10_100)
        c.cachePause(false, 10_200)
        assertTrue(c.restart(18_000))
        assertEquals(1, c.stalls)
        assertEquals(2, c.restarts)
        assertFalse(c.picture(20_000))
        assertEquals(10.0, c.stallSec(30_000), 0.0001)
        // First picture stays the load's own.
        assertEquals(500L, c.firstFrameMs)
    }

    @Test fun `restarts give up after the cap in a row, and a picture starts the count over`() {
        val c = MpvPlaybackClock(maxRestarts = 3)
        c.load(0)
        assertTrue(c.restart(1))
        assertTrue(c.restart(2))
        assertTrue(c.restart(3))
        assertFalse(c.restart(4))
        c.picture(5)
        assertTrue(c.restart(6))
        assertEquals(4, c.restarts)
    }

    @Test fun `a restart before any picture is not a stall`() {
        val c = MpvPlaybackClock(maxRestarts = 20)
        c.load(0)
        assertTrue(c.restart(8_000))
        assertEquals(0, c.stalls)
        assertTrue(c.picture(9_000))
        assertEquals(9_000L, c.firstFrameMs)
    }

    @Test fun `load starts everything over`() {
        val c = MpvPlaybackClock(maxRestarts = 20)
        c.load(0)
        c.picture(100)
        c.cachePause(true, 200)
        c.restart(300)
        c.load(1_000)
        assertNull(c.firstFrameMs)
        assertEquals(0, c.stalls)
        assertEquals(0, c.restarts)
        assertFalse(c.stalled)
        assertEquals(0.0, c.stallSec(5_000), 0.0001)
    }
}
