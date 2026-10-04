package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The display mode a film is shown in (FrameRateMatch): the same resolution,
 * a refresh rate that is a whole multiple of the film's frame rate, and no
 * change at all when the screen's mode already fits.
 */
class FrameRateMatchTest {

    private var nextId = 1
    private fun uhd(hz: Float) = FrameRateMatch.Mode(nextId++, 3840, 2160, hz)
    private fun fhd(hz: Float) = FrameRateMatch.Mode(nextId++, 1920, 1080, hz)

    /** A Fire TV 4K's list: every common rate at 2160p, and the same at 1080p. */
    private val fireTv: List<FrameRateMatch.Mode> = listOf(
        23.976f, 24f, 25f, 29.97f, 30f, 50f, 59.94f, 60f,
    ).flatMap { listOf(uhd(it), fhd(it)) }
    private fun fireTvMode(w: Int, hz: Float) = fireTv.first { it.width == w && it.refreshRate == hz }
    private val at60 get() = fireTvMode(3840, 60f)

    private fun picked(fps: Float, current: FrameRateMatch.Mode = at60, modes: List<FrameRateMatch.Mode> = fireTv): Float? =
        FrameRateMatch.pick(current, modes, fps)?.refreshRate

    @Test fun `film rates on a 60 Hz Fire TV`() {
        assertEquals(23.976f, picked(23.976f))
        assertEquals(24f, picked(24f))
        assertEquals(50f, picked(25f))
        assertEquals(59.94f, picked(29.97f))
        assertEquals(50f, picked(50f))
        assertEquals(59.94f, picked(59.94f))
    }

    @Test fun `the mode already fits - nothing changes`() {
        assertNull(picked(30f))
        assertNull(picked(60f))
        assertNull(picked(24f, current = fireTvMode(3840, 24f)))
        assertNull(picked(25f, current = fireTvMode(3840, 50f)))
        assertNull(picked(23.976f, current = fireTvMode(3840, 23.976f)))
    }

    @Test fun `24_000 is not kept for a 23_976 film when an exact mode exists, and is when none does`() {
        assertEquals(23.976f, picked(23.976f, current = fireTvMode(3840, 24f)))
        val roundOnly = listOf(uhd(60f), uhd(24f))
        assertNull(FrameRateMatch.pick(roundOnly[1], roundOnly, 23.976f))
    }

    @Test fun `the resolution never changes`() {
        val m = FrameRateMatch.pick(fireTvMode(1920, 60f), fireTv, 23.976f)!!
        assertEquals(1920, m.width)
        assertEquals(1080, m.height)
        assertEquals(23.976f, m.refreshRate)
        // Only 4K modes have 24 Hz: a 1080p screen stays as it is.
        val only4k24 = listOf(fhd(60f), fhd(50f), uhd(24f), uhd(60f))
        assertNull(FrameRateMatch.pick(only4k24[0], only4k24, 24f))
    }

    @Test fun `the exact fractional rate wins over the round one`() {
        val modes = listOf(uhd(60f), uhd(24f), uhd(23.976f))
        assertEquals(23.976f, FrameRateMatch.pick(modes[0], modes, 23.976f)!!.refreshRate)
        assertEquals(24f, FrameRateMatch.pick(modes[0], modes, 24f)!!.refreshRate)
        // Only the round one there: it still beats 60 Hz pulldown.
        val roundOnly = listOf(uhd(60f), uhd(24f))
        assertEquals(24f, FrameRateMatch.pick(roundOnly[0], roundOnly, 23.976f)!!.refreshRate)
    }

    @Test fun `29_97 never takes a 60_00 mode, which is 0_06 Hz off`() {
        val modes = listOf(uhd(50f), uhd(60f))
        assertNull(FrameRateMatch.pick(modes[1], modes, 29.97f))
        assertFalse(FrameRateMatch.fits(60f, 29.97f))
        assertTrue(FrameRateMatch.fits(59.94f, 29.97f))
    }

    @Test fun `a 120 Hz box - 24 and 23_976 accept 120, but an exact film mode is preferred`() {
        val box = listOf(uhd(60f), uhd(120f), uhd(119.88f), uhd(24f), uhd(23.976f), uhd(50f), uhd(59.94f))
        // Already at 120: 5 refreshes per film frame, even pacing; no blank.
        assertNull(FrameRateMatch.pick(box[1], box, 24f))
        // 120.00 for 23.976 is not exact: with exact modes there, the film's own.
        assertEquals(23.976f, FrameRateMatch.pick(box[1], box, 23.976f)!!.refreshRate)
        assertNull(FrameRateMatch.pick(box[2], box, 23.976f))
        // From 60: the film's own rate.
        assertEquals(23.976f, FrameRateMatch.pick(box[0], box, 23.976f)!!.refreshRate)
        assertEquals(24f, FrameRateMatch.pick(box[0], box, 24f)!!.refreshRate)
        // No 24 Hz mode, only 120-class: those.
        val noFilm = listOf(uhd(60f), uhd(120f), uhd(119.88f))
        assertEquals(119.88f, FrameRateMatch.pick(noFilm[0], noFilm, 23.976f)!!.refreshRate)
        assertEquals(120f, FrameRateMatch.pick(noFilm[0], noFilm, 24f)!!.refreshRate)
        // 25 still prefers 50, 30 stays at 60.
        assertEquals(50f, FrameRateMatch.pick(box[0], box, 25f)!!.refreshRate)
        assertNull(FrameRateMatch.pick(box[0], box, 30f))
    }

    @Test fun `exact multiples first - 23_976, then 47_952, then 119_88, before 24 or 120`() {
        val all = listOf(uhd(60f), uhd(24f), uhd(120f), uhd(119.88f), uhd(47.952f), uhd(23.976f))
        fun next(modes: List<FrameRateMatch.Mode>) = FrameRateMatch.pick(modes[0], modes, 23.976f)?.refreshRate
        assertEquals(23.976f, next(all))
        assertEquals(47.952f, next(all.filter { it.refreshRate != 23.976f }))
        assertEquals(119.88f, next(all.filter { it.refreshRate != 23.976f && it.refreshRate != 47.952f }))
        assertEquals(24f, next(listOf(uhd(60f), uhd(24f), uhd(120f))))
    }

    @Test fun `25 prefers 50 over 25, and takes 25 when that is all there is`() {
        val both = listOf(uhd(60f), uhd(25f), uhd(50f))
        assertEquals(50f, FrameRateMatch.pick(both[0], both, 25f)!!.refreshRate)
        val only25 = listOf(uhd(60f), uhd(25f))
        assertEquals(25f, FrameRateMatch.pick(only25[0], only25, 25f)!!.refreshRate)
    }

    @Test fun `3 to 2 pulldown is never a fit, only a last resort`() {
        // 60 Hz is already where a 24 fps film would go with no 24 Hz mode: left alone.
        val noFilm = listOf(uhd(50f), uhd(60f))
        assertNull(FrameRateMatch.pick(noFilm[1], noFilm, 24f))
        // From 50 Hz (a 24 fps film hitches every half second there) 60 is better.
        assertEquals(60f, FrameRateMatch.pick(noFilm[0], noFilm, 24f)!!.refreshRate)
        // With a 24 Hz mode, never 60.
        val withFilm = listOf(uhd(50f), uhd(60f), uhd(24f))
        assertEquals(24f, FrameRateMatch.pick(withFilm[0], withFilm, 24f)!!.refreshRate)
        assertFalse(FrameRateMatch.fits(60f, 24f))
    }

    @Test fun `no frame rate, or nothing that fits - nothing changes`() {
        assertNull(picked(0f))
        assertNull(picked(-1f))
        assertNull(picked(Float.NaN))
        val only60 = listOf(uhd(60f))
        assertNull(FrameRateMatch.pick(only60[0], only60, 23.976f))
        assertNull(FrameRateMatch.pick(only60[0], emptyList(), 23.976f))
    }

    private fun pts(fps: Double, n: Int, msRounding: Boolean, dropAt: Int = -1): LongArray {
        val out = ArrayList<Long>()
        for (i in 0 until n + 1) {
            if (i == dropAt) continue
            val us = i * 1_000_000.0 / fps
            out.add(if (msRounding) Math.round(us / 1000.0) * 1000L else Math.round(us))
        }
        return out.take(n).toLongArray()
    }

    @Test fun `estimate from presentation times, millisecond containers and a dropped frame included`() {
        assertEquals(23.976f, FrameRateMatch.estimate(pts(24000.0 / 1001.0, 48, msRounding = true), 48))
        assertEquals(24f, FrameRateMatch.estimate(pts(24.0, 48, msRounding = true), 48))
        assertEquals(25f, FrameRateMatch.estimate(pts(25.0, 48, msRounding = false), 48))
        assertEquals(29.97f, FrameRateMatch.estimate(pts(30000.0 / 1001.0, 48, msRounding = false), 48))
        assertEquals(59.94f, FrameRateMatch.estimate(pts(60000.0 / 1001.0, 48, msRounding = false), 48))
        assertEquals(23.976f, FrameRateMatch.estimate(pts(24000.0 / 1001.0, 48, msRounding = true, dropAt = 20), 48))
    }

    @Test fun `no estimate from too few frames or a jump`() {
        assertNull(FrameRateMatch.estimate(pts(24.0, 10, msRounding = false), 10))
        val jump = pts(24.0, 48, msRounding = false).also { for (i in 30 until 48) it[i] += 700_000L }
        assertNull(FrameRateMatch.estimate(jump, 48))
    }

    @Test fun `a 50 Hz box with only 50 and 60 - films, 29_97 and 59_94 go to 60`() {
        val box = listOf(uhd(50f), uhd(60f))
        assertEquals(60f, FrameRateMatch.pick(box[0], box, 23.976f)!!.refreshRate)
        assertEquals(60f, FrameRateMatch.pick(box[0], box, 29.97f)!!.refreshRate)
        assertEquals(60f, FrameRateMatch.pick(box[0], box, 59.94f)!!.refreshRate)
        // Already at 60: near (29.97, 59.94) or pulldown (23.976) is as good as it gets.
        assertNull(FrameRateMatch.pick(box[1], box, 29.97f))
        assertNull(FrameRateMatch.pick(box[1], box, 59.94f))
        assertNull(FrameRateMatch.pick(box[1], box, 23.976f))
        assertTrue(FrameRateMatch.isNear(60f, 29.97f))
        assertTrue(FrameRateMatch.isNear(60f, 59.94f))
        assertFalse(FrameRateMatch.isNear(50f, 23.976f))
        assertTrue(FrameRateMatch.fitsPulldown(60f, 23.976f))
        assertFalse(FrameRateMatch.fitsPulldown(59.94f, 25f))
    }

    @Test fun `a new title is never kept in the last one's mode when that does not fit it`() {
        val box = listOf(uhd(60f), uhd(23.976f), uhd(59.94f), uhd(50f))
        val at60 = box[0]
        val film = box[1]
        // 29.97 after a 23.976 film: 59.94, not 24 Hz.
        assertEquals(FrameRateMatch.Decision.Request(box[2]), FrameRateMatch.decide(film, film, at60, box, 29.97f))
        // 30 after it: the screen's own 60 fits, so back to it.
        assertEquals(FrameRateMatch.Decision.Restore, FrameRateMatch.decide(film, film, at60, box, 30f))
        // The same rate again: kept, no blank.
        assertEquals(FrameRateMatch.Decision.Keep, FrameRateMatch.decide(film, film, at60, box, 23.976f))
        // Unknown, variable, or too short: back to the screen's own.
        assertEquals(FrameRateMatch.Decision.Restore, FrameRateMatch.decide(film, film, at60, box, null))
        assertEquals(FrameRateMatch.Decision.Keep, FrameRateMatch.decide(at60, null, null, box, null))
        // Nothing asked for yet: the plain pick.
        assertEquals(FrameRateMatch.Decision.Request(film), FrameRateMatch.decide(at60, null, null, box, 23.976f))
        assertEquals(FrameRateMatch.Decision.Keep, FrameRateMatch.decide(at60, null, null, box, 30f))
    }

    @Test fun `a restore in flight that already fits the next title is pinned, not blanked twice`() {
        val box = listOf(uhd(60f), uhd(23.976f))
        assertEquals(FrameRateMatch.Decision.Pin(box[1]), FrameRateMatch.decide(box[1], null, null, box, 23.976f, restoringFrom = box[1]))
        // A rate it doesn't fit: the plain pick.
        assertEquals(FrameRateMatch.Decision.Keep, FrameRateMatch.decide(box[0], null, null, box, 60f, restoringFrom = box[1]))
    }

    @Test fun `labels for the log and the stats`() {
        assertEquals("23.976", FrameRateMatch.label(23.976025f))
        assertEquals("59.94", FrameRateMatch.label(59.94006f))
        assertEquals("60", FrameRateMatch.label(60f))
        assertEquals("24", FrameRateMatch.label(24f))
    }
}
