package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The mpv option list for Live TV (MpvOptions's own doc). Plain data, so
 * every option is checked by name here rather than trusting mpv to read it
 * right — and that no URL is ever among them.
 */
class MpvOptionsTest {
    private fun opt(list: List<Pair<String, String>>, key: String): String? = list.firstOrNull { it.first == key }?.second

    @Test fun `the fixed decode and cache options are all there`() {
        val o = MpvOptions.buildOptions("SMC/1.0", isLowRamBox = false)
        assertEquals("mediacodec_embed", opt(o, "vo"))
        assertEquals("mediacodec", opt(o, "hwdec"))
        assertEquals("all", opt(o, "hwdec-codecs"))
        assertEquals("yes", opt(o, "idle"))
        assertEquals("no", opt(o, "keep-open"))
        assertEquals("audiotrack,opensles", opt(o, "ao"))
        assertEquals("150", opt(o, "volume-max"))
        assertEquals("yes", opt(o, "cache"))
        assertEquals("0", opt(o, "demuxer-max-back-bytes"))
        assertEquals("10", opt(o, "demuxer-readahead-secs"))
        assertEquals("no", opt(o, "cache-pause-initial"))
        assertEquals("2", opt(o, "cache-pause-wait"))
        assertEquals("15", opt(o, "network-timeout"))
        assertEquals(
            "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4",
            opt(o, "stream-lavf-o-append"),
        )
    }

    @Test fun `demuxer-max-bytes is 32 MiB, or 16 on a low-RAM box`() {
        assertEquals("32MiB", opt(MpvOptions.buildOptions("ua", isLowRamBox = false), "demuxer-max-bytes"))
        assertEquals("16MiB", opt(MpvOptions.buildOptions("ua", isLowRamBox = true), "demuxer-max-bytes"))
    }

    @Test fun `the user agent passed in goes out verbatim, and only there`() {
        val ua = "SnowMediaCenter/1.8.0 (Linux; Android 9) ExoPlayerLib/1.5.0"
        val o = MpvOptions.buildOptions(ua, isLowRamBox = false)
        assertEquals(ua, opt(o, "user-agent"))
        assertEquals(1, o.count { it.first == "user-agent" })
    }

    @Test fun `no URL is ever in the option list`() {
        val o = MpvOptions.buildOptions("ua", isLowRamBox = false)
        for ((k, v) in o) {
            assertFalse("$k should not carry a URL", v.contains("://"))
        }
    }

    @Test fun `every key is present exactly once`() {
        val o = MpvOptions.buildOptions("ua", isLowRamBox = false)
        val keys = o.map { it.first }
        assertEquals(keys.size, keys.toSet().size)
        assertTrue(keys.isNotEmpty())
    }
}
