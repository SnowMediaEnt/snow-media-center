package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which audio decoder comes first (AudioOrder): hardware / passthrough for a
 * film on the main player, FFmpeg for Live TV and tiles, FFmpeg again for a
 * film whose hardware sound failed; and a heavy track FFmpeg would decode
 * swapped for a same-language one the box plays in hardware.
 */
class AudioOrderTest {

    @Test fun `films get hardware first, Live TV and tiles FFmpeg first`() {
        assertEquals(AudioOrder.HARDWARE_FIRST, AudioOrder.mode(isMain = true, live = false, hwFirst = true, fellBack = false))
        assertEquals(AudioOrder.FFMPEG_FIRST, AudioOrder.mode(isMain = true, live = true, hwFirst = true, fellBack = false))
        assertEquals(AudioOrder.FFMPEG_FIRST, AudioOrder.mode(isMain = false, live = false, hwFirst = true, fellBack = false))
    }

    @Test fun `the switch off, the viewer's decode-here, or a failed title - FFmpeg first`() {
        assertEquals(AudioOrder.FFMPEG_FIRST, AudioOrder.mode(isMain = true, live = false, hwFirst = false, fellBack = false))
        assertEquals(AudioOrder.FFMPEG_FIRST, AudioOrder.mode(isMain = true, live = false, hwFirst = true, fellBack = true))
    }

    @Test fun `the order matches Media3's extension modes`() {
        // DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON = 1, _PREFER = 2.
        assertEquals(1, AudioOrder.HARDWARE_FIRST)
        assertEquals(2, AudioOrder.FFMPEG_FIRST)
    }

    @Test fun `a sound error falls back once, and only when hardware came first`() {
        assertTrue(AudioOrder.canFallBack(AudioOrder.HARDWARE_FIRST, fellBack = false))
        assertFalse(AudioOrder.canFallBack(AudioOrder.HARDWARE_FIRST, fellBack = true))
        assertFalse(AudioOrder.canFallBack(AudioOrder.FFMPEG_FIRST, fellBack = false))
    }

    @Test fun `heavy tracks`() {
        assertTrue(AudioOrder.isHeavy("audio/true-hd", 8))
        assertTrue(AudioOrder.isHeavy("audio/vnd.dts.hd", 6))
        assertTrue(AudioOrder.isHeavy("audio/vnd.dts.uhd;profile=p2", 8))
        assertTrue(AudioOrder.isHeavy("audio/eac3", 8))
        assertFalse(AudioOrder.isHeavy("audio/ac3", 6))
        assertFalse(AudioOrder.isHeavy("audio/mp4a-latm", 2))
    }

    private fun c(group: Int, lang: String?, ch: Int, hw: Boolean = true) = AudioOrder.Candidate(0, group, 0, lang, ch, hw)

    @Test fun `TrueHD 7_1 on FFmpeg gives way to the same language's AC3 5_1 in hardware`() {
        val pick = AudioOrder.lighter("audio/true-hd", 8, "en", selectedByFfmpeg = true, userPicked = false,
            candidates = listOf(c(1, "fr", 6), c(2, "eng", 2), c(3, "en", 6)))
        assertEquals(3, pick!!.group)
    }

    @Test fun `never over the viewer's pick, never for a light track, never when hardware plays it already`() {
        val cands = listOf(c(1, "en", 6))
        assertNull(AudioOrder.lighter("audio/true-hd", 8, "en", selectedByFfmpeg = true, userPicked = true, candidates = cands))
        assertNull(AudioOrder.lighter("audio/ac3", 6, "en", selectedByFfmpeg = true, userPicked = false, candidates = cands))
        assertNull(AudioOrder.lighter("audio/true-hd", 8, "en", selectedByFfmpeg = false, userPicked = false, candidates = cands))
    }

    @Test fun `no same-language hardware track - keep the heavy one`() {
        assertNull(AudioOrder.lighter("audio/true-hd", 8, "en", selectedByFfmpeg = true, userPicked = false,
            candidates = listOf(c(1, "de", 6), c(2, "en", 6, hw = false))))
        // No language on either side counts as the same.
        assertEquals(1, AudioOrder.lighter("audio/vnd.dts.hd", 8, null, selectedByFfmpeg = true, userPicked = false,
            candidates = listOf(c(1, "und", 6)))!!.group)
    }
}
