package com.snowmedia.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The picture's own view inside the player's black box (bugs/plex-green-bar.md).
 * A letterboxed film is drawn in a view the size of the picture, so the bars
 * are the box's black and never a part of the picture's view left unpainted.
 */
class VideoFitTest {

    @Test fun `a 1920x804 film on a 1080p screen is a 1920x804 view with 138 px bars above and below`() {
        val v = VideoFit.viewSize("fit", 1920, 1080, 1920, 804, 1f)!!
        assertArrayEquals(intArrayOf(1920, 804), v)
        // The bottom bar: the band in the owner's photo was 12.9% of the screen.
        val bar = (1080 - v[1]) / 2
        assertTrue(bar == 138)
    }

    @Test fun `a 3840x1600 film on a 4K box and a 1920x800 one both fit inside the box`() {
        assertArrayEquals(intArrayOf(3840, 1600), VideoFit.viewSize("fit", 3840, 2160, 3840, 1600, 1f))
        assertArrayEquals(intArrayOf(1920, 800), VideoFit.viewSize("fit", 1920, 1080, 1920, 800, 1f))
        // The same film on a 1080p panel.
        assertArrayEquals(intArrayOf(1920, 800), VideoFit.viewSize("fit", 1920, 1080, 3840, 1600, 1f))
    }

    @Test fun `a 4 by 3 picture is pillarboxed, and a 16 by 9 one fills the box`() {
        assertArrayEquals(intArrayOf(1440, 1080), VideoFit.viewSize("fit", 1920, 1080, 640, 480, 1f))
        assertArrayEquals(intArrayOf(1920, 1080), VideoFit.viewSize("fit", 1920, 1080, 1280, 720, 1f))
    }

    @Test fun `anamorphic pixels count`() {
        // 720x480 flagged widescreen: pixel ratio ~1.21 makes it 16:9.
        assertArrayEquals(intArrayOf(1920, 1080), VideoFit.viewSize("fit", 1920, 1080, 720, 480, 1.185f))
    }

    @Test fun `a tile fits inside its own box`() {
        assertArrayEquals(intArrayOf(640, 268), VideoFit.viewSize("fit", 640, 360, 1920, 804, 1f))
    }

    @Test fun `fit never makes the view bigger than the box, whatever the sizes`() {
        for (bw in listOf(320, 641, 960, 1280, 1920, 3840)) for (bh in listOf(180, 361, 540, 720, 1080, 2160)) {
            for ((w, h) in listOf(1920 to 804, 1920 to 800, 3840 to 1600, 1440 to 1080, 720 to 576, 1080 to 1920, 1920 to 1080)) {
                val v = VideoFit.viewSize("fit", bw, bh, w, h, 1f)!!
                assertTrue("$w x $h in $bw x $bh -> ${v[0]} x ${v[1]}", v[0] in 1..bw && v[1] in 1..bh)
                assertTrue("touches two sides", v[0] == bw || v[1] == bh)
            }
        }
    }

    @Test fun `zoom covers the box and the box crops the rest`() {
        val v = VideoFit.viewSize("zoom", 1920, 1080, 1920, 804, 1f)!!
        assertTrue(v[0] >= 1920 && v[1] >= 1080)
        assertArrayEquals(intArrayOf(2579, 1080), v)
    }

    @Test fun `wide is 16 by 9 whatever the stream says, fill is the whole box`() {
        assertArrayEquals(intArrayOf(1920, 1080), VideoFit.viewSize("wide", 1920, 1080, 1920, 804, 1f))
        assertArrayEquals(intArrayOf(1440, 810), VideoFit.viewSize("wide", 1440, 1080, 640, 480, 1f))
        assertArrayEquals(intArrayOf(1920, 1080), VideoFit.viewSize("fill", 1920, 1080, 1920, 804, 1f))
    }

    @Test fun `nothing to fit yet leaves the view as it is`() {
        assertNull(VideoFit.viewSize("fit", 0, 0, 1920, 804, 1f))
        assertNull(VideoFit.viewSize("fit", 1920, 1080, 0, 0, 1f))
        assertNull(VideoFit.viewSize("fit", 1920, 1080, 1920, 804, Float.NaN))
    }

    @Test fun `the shutter opens on the first frame, but not while the start-up hold is still filling`() {
        assertFalse(VideoFit.shutterOpen(firstFrameSeen = false, holding = false))
        assertFalse("Getting ready stays black", VideoFit.shutterOpen(firstFrameSeen = true, holding = true))
        assertFalse(VideoFit.shutterOpen(firstFrameSeen = false, holding = true))
        assertTrue(VideoFit.shutterOpen(firstFrameSeen = true, holding = false))
    }
}
