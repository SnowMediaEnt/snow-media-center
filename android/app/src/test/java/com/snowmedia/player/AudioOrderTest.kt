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

    private fun t(group: Int, ch: Int, label: String? = null, role: Int = 0, sel: Int = 0) =
        AudioOrder.Candidate(0, group, 0, "en", ch, true, label, role, sel)
    private fun lighterOf(vararg c: AudioOrder.Candidate) =
        AudioOrder.lighter("audio/true-hd", 8, "en", selectedByFfmpeg = true, userPicked = false, candidates = c.toList())?.group

    @Test fun `never commentary or audio description, by role or by name`() {
        assertNull(lighterOf(t(1, 6, role = AudioOrder.ROLE_COMMENTARY)))
        assertNull(lighterOf(t(1, 6, role = AudioOrder.ROLE_DESCRIBES_VIDEO)))
        assertNull(lighterOf(t(1, 6, role = AudioOrder.ROLE_DESCRIBES_MUSIC_AND_SOUND)))
        assertNull(lighterOf(t(1, 6, label = "Director's Commentary")))
        assertNull(lighterOf(t(1, 6, label = "Audio Description")))
        assertEquals(2, lighterOf(t(1, 6, label = "COMMENTARY"), t(2, 6, label = "English 5.1")))
    }

    @Test fun `never down to fewer channels than min(6, the selected)`() {
        assertNull(lighterOf(t(1, 2)))
        assertEquals(2, lighterOf(t(1, 2), t(2, 6)))
        // A 6-channel heavy track (DTS-HD 5.1) never goes to stereo either.
        assertNull(AudioOrder.lighter("audio/vnd.dts.hd", 6, "en", true, false, listOf(t(1, 2))))
    }

    @Test fun `the default track first, then the most channels`() {
        assertEquals(1, lighterOf(t(1, 6, sel = AudioOrder.SELECTION_DEFAULT), t(2, 8)))
        assertEquals(2, lighterOf(t(1, 6), t(2, 8)))
    }

    @Test fun `a title's key leaves out per-session and quality parameters`() {
        val a = "https://srv.plex.direct:32400/library/parts/42/170/file.mkv?X-Plex-Token=t&X-Plex-Session-Identifier=s1&X-Plex-Client-Identifier=c"
        val b = "https://srv.plex.direct:32400/library/parts/42/170/file.mkv?X-Plex-Session-Identifier=s2&X-Plex-Token=t"
        assertEquals(AudioOrder.titleKey(a), AudioOrder.titleKey(b))
        val t1 = "https://h/video/:/transcode/universal/start.m3u8?path=%2Flibrary%2Fmetadata%2F7&session=a&maxVideoBitrate=8000&mediaIndex=0"
        val t2 = "https://h/video/:/transcode/universal/start.m3u8?mediaIndex=0&path=%2Flibrary%2Fmetadata%2F7&session=b&maxVideoBitrate=4000"
        assertEquals(AudioOrder.titleKey(t1), AudioOrder.titleKey(t2))
        assertFalse(AudioOrder.titleKey(t1) == AudioOrder.titleKey(t1.replace("%2F7", "%2F8")))
        assertEquals("http://line/movie/u/p/9.mkv", AudioOrder.titleKey("http://line/movie/u/p/9.mkv"))
    }

    @Test fun `a bitstream is muted by turning the audio off, only at volume 0`() {
        assertTrue(AudioOrder.muteByDisabling(passthrough = true, volume = 0f))
        assertFalse(AudioOrder.muteByDisabling(passthrough = true, volume = 0.1f))
        assertFalse(AudioOrder.muteByDisabling(passthrough = false, volume = 0f))
    }
}
