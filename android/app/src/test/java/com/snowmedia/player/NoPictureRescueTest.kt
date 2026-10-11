package com.snowmedia.player

import com.snowmedia.player.NoPictureRescue.Cover
import com.snowmedia.player.NoPictureRescue.Decoder
import com.snowmedia.player.NoPictureRescue.Ladder
import com.snowmedia.player.NoPictureRescue.Playback
import com.snowmedia.player.NoPictureRescue.Seen
import com.snowmedia.player.NoPictureRescue.Step
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A black screen with the sound playing (owner, 2026-10-11: a Vibez channel on
 * an X96, backed out of and gone into again): when the player acts, in what
 * order and after how long, and when it leaves a stream alone.
 */
class NoPictureRescueTest {

    private val playingBlack = Seen(
        firstFrameSeen = false, ready = true, playing = true, videoSelected = true,
        holding = false, advancing = true, tunneled = false, rewindBuffer = false,
    )

    /** Looks every TICK_MS from `from` to `to` (inclusive) with `sound`; the steps taken, with when. */
    private fun run(l: Ladder, from: Long, to: Long, sound: Boolean = true, canSwitch: Boolean = true): List<Pair<Long, Step>> {
        val out = ArrayList<Pair<Long, Step>>()
        var t = from
        while (t <= to) {
            l.tick(t, sound) { canSwitch }?.let { out.add(t to it) }
            t += NoPictureRescue.TICK_MS
        }
        return out
    }

    @Test fun `sound playing, a video track chosen and nothing drawn is the case`() {
        assertTrue(NoPictureRescue.soundWithoutPicture(playingBlack))
    }

    @Test fun `a picture already drawn is never touched`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(firstFrameSeen = true)))
    }

    @Test fun `a radio channel (no video track) is left alone`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(videoSelected = false)))
    }

    @Test fun `a film's start-up hold, a pause and a stream still buffering are not the case`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(holding = true)))
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(playing = false)))
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(ready = false, playing = false)))
    }

    @Test fun `a clock that does not move is not sound playing`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(advancing = false)))
    }

    @Test fun `tunneled playback and the rewind buffer are left alone`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(tunneled = true)))
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(rewindBuffer = true)))
    }

    @Test fun `nothing while the app is off screen (Home, another app)`() {
        assertFalse(NoPictureRescue.soundWithoutPicture(playingBlack.copy(onScreen = false)))
    }

    @Test fun `ExoPlayer only, and never a Plex film or trailer`() {
        assertTrue(NoPictureRescue.applies(exo = true, plexFilm = false))
        assertFalse(NoPictureRescue.applies(exo = true, plexFilm = true))
        assertFalse(NoPictureRescue.applies(exo = false, plexFilm = false))
    }

    @Test fun `main player - surface after 4 s, rebuild 3 s later, the other decoder 3 s later, then give up`() {
        val l = Ladder(main = true)
        val steps = run(l, 10_000L, 40_000L)
        assertEquals(
            listOf(14_000L to Step.SURFACE, 17_000L to Step.REBUILD, 20_000L to Step.DECODER, 23_000L to Step.GIVE_UP),
            steps,
        )
        assertTrue(l.finished)
    }

    @Test fun `nothing more once given up`() {
        val l = Ladder(main = true)
        run(l, 0L, 30_000L)
        assertNull(l.tick(60_000L, true) { true })
        assertEquals(Step.GIVE_UP, l.taken)
    }

    @Test fun `a tile gets the surface and the rebuild, never the other decoder`() {
        val l = Ladder(main = false)
        assertEquals(
            listOf(4_000L to Step.SURFACE, 7_000L to Step.REBUILD, 10_000L to Step.GIVE_UP),
            run(l, 0L, 20_000L),
        )
    }

    @Test fun `no decoder of the other kind on this box - straight from the rebuild to giving up`() {
        val l = Ladder(main = true)
        val steps = run(l, 0L, 20_000L, canSwitch = false)
        assertEquals(listOf(4_000L to Step.SURFACE, 7_000L to Step.REBUILD, 10_000L to Step.GIVE_UP), steps)
    }

    @Test fun `the other kind is only asked about when that step is due`() {
        val l = Ladder(main = true)
        var asked = 0
        var t = 0L
        while (t <= 9_500L) { l.tick(t, true) { asked++; true }; t += NoPictureRescue.TICK_MS }
        assertEquals(0, asked)
        assertEquals(Step.DECODER, l.tick(10_000L, true) { asked++; true })
        assertEquals(1, asked)
    }

    @Test fun `a stream that never plays sound without a picture takes no step at all`() {
        val l = Ladder(main = true)
        assertTrue(run(l, 0L, 120_000L, sound = false).isEmpty())
        assertNull(l.taken)
    }

    @Test fun `a break in it (a rebuffer) starts the wait over`() {
        val l = Ladder(main = true)
        assertTrue(run(l, 0L, 3_500L).isEmpty())
        assertNull(l.tick(4_000L, false) { true })
        // Seen again from 5 s: the surface step at 9 s, not at 4 s.
        val steps = run(l, 5_000L, 9_000L)
        assertEquals(listOf(9_000L to Step.SURFACE), steps)
    }

    @Test fun `after a step the next wait starts from the next sight of it (a rebuilt player buffers first)`() {
        val l = Ladder(main = true)
        run(l, 0L, 4_000L)
        assertEquals(Step.SURFACE, l.taken)
        // The rebuilt-looking player buffers for 6 s, then plays black again.
        assertTrue(run(l, 4_500L, 10_000L, sound = false).isEmpty())
        assertEquals(listOf(13_500L to Step.REBUILD), run(l, 10_500L, 13_500L))
    }

    @Test fun `each step has its Stats for nerds reason`() {
        assertEquals("no picture: surface re-attached", NoPictureRescue.reason(Step.SURFACE))
        assertEquals("no picture: player rebuilt", NoPictureRescue.reason(Step.REBUILD))
        assertEquals("no picture: software decoder", NoPictureRescue.reason(Step.DECODER, NoPictureRescue.ORDER_SOFTWARE_FIRST))
        assertEquals("no picture: hardware decoder", NoPictureRescue.reason(Step.DECODER, NoPictureRescue.ORDER_HARDWARE_FIRST))
        assertEquals("no picture: gave up", NoPictureRescue.reason(Step.GIVE_UP))
    }

    // ---- The blank cover ----

    @Test fun `a blank with no load behind it is lifted over a stream that drew and plays`() {
        assertEquals(Cover.LIFT, NoPictureRescue.blankGuard("a", "a", 3, 3, firstFrameSeen = true, playback = Playback.SHOWING))
    }

    @Test fun `a load that came, even one still on its way to the main thread, keeps the cover`() {
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard("a", "a", 3, 4, true, Playback.SHOWING))
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard("a", "b", 3, 4, false, Playback.BUFFERING))
    }

    @Test fun `a stop, or nothing playing when the blank came, keeps the cover`() {
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard("a", null, 3, 3, false, Playback.STOPPED))
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard(null, null, 3, 3, false, Playback.STOPPED))
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard("a", "a", 3, 3, true, Playback.STOPPED))
    }

    @Test fun `a stream that has not drawn yet is opened by its own first frame`() {
        assertEquals(Cover.LEAVE, NoPictureRescue.blankGuard("a", "a", 3, 3, false, Playback.SHOWING))
    }

    @Test fun `a stream buffering is looked at again`() {
        assertEquals(Cover.WAIT, NoPictureRescue.blankGuard("a", "a", 3, 3, true, Playback.BUFFERING))
    }

    // ---- The other kind of decoder ----

    private val box = listOf(
        Decoder("OMX.amlogic.avc.decoder.awesome", software = false),
        Decoder("OMX.google.h264.decoder", software = true),
    )

    @Test fun `a hardware decoder that drew nothing - software first`() {
        assertEquals(NoPictureRescue.ORDER_SOFTWARE_FIRST, NoPictureRescue.otherOrder("OMX.amlogic.avc.decoder.awesome", box))
    }

    @Test fun `a software decoder that drew nothing - hardware first`() {
        assertEquals(NoPictureRescue.ORDER_HARDWARE_FIRST, NoPictureRescue.otherOrder("OMX.google.h264.decoder", box))
        // Not in the list (another format's): known by its name.
        assertEquals(NoPictureRescue.ORDER_HARDWARE_FIRST, NoPictureRescue.otherOrder("c2.android.avc.decoder", box))
    }

    @Test fun `no decoder started - the failing one is taken to be Media3's hardware pick`() {
        assertEquals(NoPictureRescue.ORDER_SOFTWARE_FIRST, NoPictureRescue.otherOrder(null, box))
    }

    @Test fun `no decoder of the other kind - no such step`() {
        val hwOnly = listOf(Decoder("OMX.amlogic.hevc.decoder.awesome", software = false))
        assertNull(NoPictureRescue.otherOrder("OMX.amlogic.hevc.decoder.awesome", hwOnly))
        val swOnly = listOf(Decoder("c2.android.mpeg2.decoder", software = true))
        assertNull(NoPictureRescue.otherOrder("c2.android.mpeg2.decoder", swOnly))
    }

    @Test fun `reorder puts one kind first, each kind in its own order, and leaves the default alone`() {
        val list = listOf(
            Decoder("hw1", false), Decoder("sw1", true), Decoder("hw2", false), Decoder("sw2", true),
        )
        assertEquals(listOf("sw1", "sw2", "hw1", "hw2"), NoPictureRescue.reorder(list, NoPictureRescue.ORDER_SOFTWARE_FIRST) { it.software }.map { it.name })
        assertEquals(listOf("hw1", "hw2", "sw1", "sw2"), NoPictureRescue.reorder(list, NoPictureRescue.ORDER_HARDWARE_FIRST) { it.software }.map { it.name })
        assertTrue(NoPictureRescue.reorder(list, NoPictureRescue.ORDER_DEFAULT) { it.software } === list)
    }

    @Test fun `Android's own software decoders are known by name`() {
        assertTrue(NoPictureRescue.looksSoftware("c2.android.hevc.decoder"))
        assertTrue(NoPictureRescue.looksSoftware("OMX.google.h264.decoder"))
        assertFalse(NoPictureRescue.looksSoftware("OMX.amlogic.avc.decoder.awesome"))
        assertFalse(NoPictureRescue.looksSoftware("c2.amlogic.hevc.decoder"))
    }
}
