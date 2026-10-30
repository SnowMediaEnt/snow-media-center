package com.snowmedia.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Support › Device check's native scan: the pure readings (DeviceScan.kt). */
class DeviceScanTest {
    @Test
    fun linkOnlyWhenReal() {
        assertEquals(433, DeviceScan.linkOf(433))
        assertNull(DeviceScan.linkOf(-1))
        assertNull(DeviceScan.linkOf(0))
        assertNull(DeviceScan.linkOf(null))
        assertNull(DeviceScan.linkOf(200_000))
    }

    @Test
    fun softwareDecoderNames() {
        assertTrue(DeviceScan.looksSoftware("OMX.google.h264.decoder"))
        assertTrue(DeviceScan.looksSoftware("c2.android.hevc.decoder"))
        assertTrue(DeviceScan.looksSoftware("OMX.ffmpeg.vp9.decoder"))
        assertTrue(DeviceScan.looksSoftware("OMX.vendor.video.decoder.avc.sw"))
        assertFalse(DeviceScan.looksSoftware("OMX.amlogic.hevc.decoder.awesome"))
        assertFalse(DeviceScan.looksSoftware("c2.mtk.hevc.decoder"))
    }

    @Test
    fun tenBitProfiles() {
        assertTrue(DeviceScan.tenBitProfile("video/hevc", 0x2))
        assertTrue(DeviceScan.tenBitProfile("video/hevc", 0x1000))
        assertFalse(DeviceScan.tenBitProfile("video/hevc", 0x1))
        assertTrue(DeviceScan.tenBitProfile("video/x-vnd.on2.vp9", 0x4))
        assertFalse(DeviceScan.tenBitProfile("video/x-vnd.on2.vp9", 0x1))
        assertTrue(DeviceScan.tenBitProfile("video/av01", 0x2))
        assertFalse(DeviceScan.tenBitProfile("video/av01", 0x1))
        assertFalse(DeviceScan.tenBitProfile("video/avc", 0x2))
    }

    @Test
    fun hdrNames() {
        assertEquals("dolbyVision", DeviceScan.hdrName(1))
        assertEquals("hdr10", DeviceScan.hdrName(2))
        assertEquals("hlg", DeviceScan.hdrName(3))
        assertEquals("hdr10plus", DeviceScan.hdrName(4))
        assertNull(DeviceScan.hdrName(9))
    }

    @Test
    fun asksTheUsualVideoTypes() {
        assertEquals(listOf("avc", "hevc", "vp9", "av1", "dolbyVision"), DeviceScan.VIDEO_TYPES.map { it.first })
    }
}
