package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The start-up hold (SnowPlayerPlugin.schedulePreBuffer) of a 4K film, and
 * its byte budget (bugs/plex-4k.md). A simulated start is ticked every 500 ms
 * like the plugin does. `videoPerSec`: seconds of video arriving per second
 * (the line's speed over the file's bitrate); `fullAtMs`: the player stops
 * loading (its byte budget spent) with this much buffered.
 */
class PreBufferRuleUhdTest {

    private fun simulate(midFile: Boolean, uhd: Boolean, setupMs: Long, videoPerSec: Double, fullAtMs: Long = Long.MAX_VALUE): Pair<Long, Long> {
        var flowAt = 0L
        var t = 0L
        var buf = 0.0
        while (true) {
            t += 500
            if (t > setupMs && buf < fullAtMs) buf = minOf(fullAtMs.toDouble(), buf + videoPerSec * 500)
            val bufMs = buf.toLong()
            val ready = bufMs >= 2500
            flowAt = PreBufferRule.flowStart(flowAt, t, midFile, bufMs, ready)
            if (PreBufferRule.isDone(midFile, t, flowAt, t, bufMs, ready, loading = bufMs < fullAtMs, ended = false, uhd = uhd)) return t to bufMs
            if (t > 120_000) error("never ended")
        }
    }

    @Test fun `a 4K start waits for a steady buffer where 1_7_9 started with under 10 s`() {
        // A 60-80 Mb/s remux over a line averaging ~84 Mb/s (the Plex app's
        // own figure on the owner's TV): 1.2 s of video per second, after 2 s
        // of header and index reads.
        val (oldAt, oldBuf) = simulate(midFile = false, uhd = false, setupMs = 2000, videoPerSec = 1.2)
        assertEquals(10_000L, oldAt)
        assertTrue("1.7.9 started it with $oldBuf ms", oldBuf < 10_000L)
        val (at, buf) = simulate(midFile = false, uhd = true, setupMs = 2000, videoPerSec = 1.2)
        assertTrue("ended with $buf ms", buf >= PreBufferRule.UHD_START_MS)
        assertTrue("ended at $at ms", at <= PreBufferRule.UHD_MAX_WAIT_MS)
    }

    @Test fun `a 4K start on a fast line starts on the 25 s target`() {
        val (at, buf) = simulate(midFile = false, uhd = true, setupMs = 1000, videoPerSec = 4.0)
        assertTrue(buf >= PreBufferRule.TARGET_MS)
        assertTrue(at < 9000)
    }

    @Test fun `a 4K start whose byte budget is spent starts at once`() {
        val (at, buf) = simulate(midFile = false, uhd = true, setupMs = 1000, videoPerSec = 2.0, fullAtMs = 15_000)
        assertEquals(15_000L, buf)
        assertTrue(at <= 9000)
    }

    @Test fun `a dead server still starts at the cap`() {
        assertEquals(PreBufferRule.UHD_MAX_WAIT_MS, simulate(midFile = false, uhd = true, setupMs = 1_000_000, videoPerSec = 1.0).first)
        assertEquals(PreBufferRule.UHD_MID_FILE_CAP_MS, simulate(midFile = true, uhd = true, setupMs = 1_000_000, videoPerSec = 1.0).first)
    }

    @Test fun `a 4K resume counts from the first video at the resume point`() {
        val (at, buf) = simulate(midFile = true, uhd = true, setupMs = 8000, videoPerSec = 1.2)
        assertTrue(buf >= PreBufferRule.UHD_START_MS)
        assertTrue(at <= PreBufferRule.UHD_MID_FILE_CAP_MS)
    }

    @Test fun `1080p keeps the 1_7_9 rule`() {
        assertEquals(PreBufferRule.MAX_WAIT_MS, simulate(midFile = false, uhd = false, setupMs = 2000, videoPerSec = 1.2).first)
        val (fastAt, fastBuf) = simulate(midFile = false, uhd = false, setupMs = 1000, videoPerSec = 20.0)
        assertTrue(fastBuf >= PreBufferRule.TARGET_MS && fastAt < 3000)
        assertEquals(18_500L, simulate(midFile = true, uhd = false, setupMs = 8000, videoPerSec = 1.5).first)
        assertEquals(PreBufferRule.MID_FILE_CAP_MS, simulate(midFile = true, uhd = false, setupMs = 1_000_000, videoPerSec = 1.0).first)
        assertEquals(PreBufferRule.MAX_WAIT_MS, PreBufferRule.maxWaitMs(uhd = false))
        assertEquals(PreBufferRule.UHD_MAX_WAIT_MS, PreBufferRule.maxWaitMs(uhd = true))
    }

    @Test fun `4K is told by the picture size`() {
        assertTrue(UhdBuffer.isUhd(3840, 2160))
        assertTrue(UhdBuffer.isUhd(3840, 1600))
        assertFalse(UhdBuffer.isUhd(1920, 1080))
        assertFalse(UhdBuffer.isUhd(-1, -1))
    }

    @Test fun `the 4K budget is half the heap, 256 MiB at most, never below the library's own`() {
        val mib = 1024L * 1024L
        val library = 144_310_272 // video + audio + text (Media3 1.5 defaults)
        assertEquals((256 * mib).toInt(), UhdBuffer.budgetBytes(512 * mib, library))
        assertEquals((192 * mib).toInt(), UhdBuffer.budgetBytes(384 * mib, library))
        assertEquals(library, UhdBuffer.budgetBytes(256 * mib, library))
        assertEquals((256 * mib).toInt(), UhdBuffer.budgetBytes(1024 * mib, library))
    }

    @Test fun `a 4K start waits for 25 s, not the 20 s it used to`() {
        // The 2026-10-28 episode: ~19 Mb/s over a line bringing ~1.5x that.
        val (at, buf) = simulate(midFile = false, uhd = true, setupMs = 2000, videoPerSec = 1.5)
        assertTrue("ended with $buf ms", buf >= 25_000L)
        assertTrue("ended at $at ms", at <= PreBufferRule.UHD_MAX_WAIT_MS)
        assertEquals(25_000L, PreBufferRule.UHD_START_MS)
        // A file shorter than the cushion starts when it is all in.
        assertTrue(PreBufferRule.isDone(false, 3000, 0, 3000, 8000, ready = true, loading = false, ended = true, uhd = true))
    }

    @Test fun `a server gap at 10 s does not start a 4K film with 10 s in hand`() {
        // The player shows not loading for a moment (the server pausing
        // between bursts), but the load control still wants more.
        val loading = PreBufferRule.loadingFor(uhd = true, playerLoading = false, controlWantsMore = true)
        assertTrue(loading)
        assertFalse(PreBufferRule.isDone(false, 10_000, 0, 10_000, 10_000, ready = true, loading = loading, ended = false, uhd = true))
        // The budget really spent: starts with what it has.
        val full = PreBufferRule.loadingFor(uhd = true, playerLoading = false, controlWantsMore = false)
        assertTrue(PreBufferRule.isDone(false, 10_000, 0, 10_000, 20_000, ready = true, loading = full, ended = false, uhd = true))
        // 1080p keeps reading the player's own flag.
        assertFalse(PreBufferRule.loadingFor(uhd = false, playerLoading = false, controlWantsMore = true))
    }

    @Test fun `a 4K film plays on after a stall with 18 s, not 10`() {
        assertEquals(18_000, UhdBuffer.REBUFFER_MS)
    }
}
