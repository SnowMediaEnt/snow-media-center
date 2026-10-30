package com.snowmedia.dvr

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Rewind live TV on one connection (TimeshiftTee + TimeshiftSession), with
 * fake sources: the player's live connection feeding the buffer through the
 * tee, the session's own connection while the player is on the buffer, and
 * back. At no moment are two connections to the channel open, and segments
 * keep coming across both handovers, each marked as a discontinuity.
 */
class TimeshiftHandoverTest {
    @get:Rule val tmp = TemporaryFolder()

    private val open = AtomicInteger(0)
    @Volatile private var maxOpen = 0
    private val ownSources = Collections.synchronizedList(ArrayList<FakeOwn>())
    private val players = ArrayList<FakePlayer>()
    private var session: TimeshiftSession? = null

    private fun connect() {
        val n = open.incrementAndGet()
        synchronized(this) { if (n > maxOpen) maxOpen = n }
    }

    @After fun tearDown() {
        players.forEach { it.halt() }
        session?.close()
    }

    @Test fun teeThenOwnConnectionThenTeeNeverTwoAtOnce() {
        val tee = TimeshiftTee()
        val sess = newSession(tee)
        val p1 = player(tee)
        waitFor("segments from the player") { sess.segments().size >= 3 }
        val fromPlayer = sess.segments().size
        assertTrue("no connection of its own while the player is live", ownSources.isEmpty())

        // Rewind: the player moves onto the buffer; its live connection
        // closes a little later. The session must not open before that.
        sess.takeOver()
        Thread.sleep(300)
        assertTrue("waits for the player's connection to close", ownSources.isEmpty())
        p1.halt()
        waitFor("the session's own connection") { ownSources.size == 1 && ownSources[0].pumping }
        waitFor("segments from the session's own connection") { sess.segments().size >= fromPlayer + 3 }
        val fromOwn = sess.segments().size

        // Go live: the session closes its connection first; the player opens only then.
        val released = CountDownLatch(1)
        var p2: FakePlayer? = null
        var openAtRelease = -1
        sess.handBack(Runnable {
            openAtRelease = open.get()
            p2 = player(tee)
            released.countDown()
        })
        assertTrue("handed back", released.await(5, TimeUnit.SECONDS))
        assertEquals("own connection closed before the player opens", 0, openAtRelease)
        assertTrue(ownSources[0].cancelled)
        waitFor("segments from the player again") { sess.segments().size >= fromOwn + 3 }
        assertEquals("no new connection of the session's own", 1, ownSources.size)

        assertEquals("max concurrent connections", 1, maxOpen)
        val discs = sess.segments().count { it.discontinuity }
        assertTrue("both handovers marked as discontinuities ($discs)", discs >= 2)
        assertFalse(sess.segments().first().discontinuity)
        assertTrue(sess.alive)
        p2!!.halt()
    }

    @Test fun goLiveBeforeTheTakeOverOpenedNeedsNoWait() {
        val tee = TimeshiftTee()
        val sess = newSession(tee)
        val p1 = player(tee)
        waitFor("segments") { sess.segments().size >= 2 }
        sess.takeOver()
        assertTrue(sess.holdsConnection())
        // The player never let go: Go live comes first.
        var ranNow = false
        sess.handBack(Runnable { ranNow = true })
        assertTrue("nothing of the session's was open", ranNow)
        val before = sess.segments().size
        waitFor("still fed by the player") { sess.segments().size >= before + 2 }
        assertTrue(ownSources.isEmpty())
        assertEquals(1, maxOpen)
        p1.halt()
    }

    @Test fun closeWhileOnItsOwnConnectionReleasesItFirst() {
        val tee = TimeshiftTee()
        val sess = newSession(tee)
        val p1 = player(tee)
        waitFor("segments") { sess.segments().size >= 2 }
        sess.takeOver()
        p1.halt()
        waitFor("own connection") { ownSources.size == 1 && ownSources[0].pumping }
        val released = CountDownLatch(1)
        var openAtRelease = -1
        sess.close(Runnable {
            openAtRelease = open.get()
            released.countDown()
        })
        session = null
        assertTrue(released.await(5, TimeUnit.SECONDS))
        assertEquals(0, openAtRelease)
        assertEquals(1, maxOpen)
    }

    // ---- the tee on its own -------------------------------------------------

    private class Rec : TimeshiftTee.Sink {
        val bytes = java.io.ByteArrayOutputStream()
        var discs = 0
        var unsupported: String? = null
        val events = ArrayList<String>()
        override fun teeBytes(b: ByteArray, off: Int, len: Int) { bytes.write(b, off, len); events.add("b$len") }
        override fun teeDiscontinuity() { discs++; events.add("d") }
        override fun teeUnsupported(why: String) { unsupported = why }
    }

    @Test fun hlsSegmentsArePassedOnOnceAndPlaylistsNever() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        val seg = ts(4)
        val pl = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n".toByteArray() + ByteArray(600) { 'x'.code.toByte() }

        read(tee, "http://h/live/u/p/1.m3u8", 0, pl, channel = true)
        read(tee, "http://h/hls/a/media.php?x", 0, pl, channel = false) // a playlist without .m3u8: told by its bytes
        assertEquals(0, rec.bytes.size())

        read(tee, "http://h/hls/a/s1.ts", 0, seg, channel = false)
        assertEquals(seg.size, rec.bytes.size())
        // The same segment again (a retry), and part of it resumed: nothing new.
        read(tee, "http://h/hls/a/s1.ts", 0, seg, channel = false)
        read(tee, "http://h/hls/a/s1.ts", 188, seg.copyOfRange(188, seg.size), channel = false)
        assertEquals(seg.size, rec.bytes.size())
        val discsBefore = rec.discs
        read(tee, "http://h/hls/a/s2.ts", 0, seg, channel = false)
        assertEquals("the next segment of the same variant is continuous", discsBefore, rec.discs)
        read(tee, "http://h/hls/b/s3.ts", 0, seg, channel = false)
        assertEquals("another variant is a discontinuity", discsBefore + 1, rec.discs)
        assertEquals(3 * seg.size, rec.bytes.size())
        assertEquals(null, rec.unsupported)
        assertEquals(0, tee.openCount())
    }

    @Test fun aRetriedSegmentCutShortIsCompletedNotRepeated() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        val seg = ts(6)
        read(tee, "http://h/s/s1.ts", 0, seg.copyOfRange(0, 700), channel = false) // dropped part-way
        read(tee, "http://h/s/s1.ts", 0, seg, channel = false) // retried from the start
        assertEquals(seg.toList(), rec.bytes.toByteArray().toList())
    }

    @Test fun rawStreamReopenIsADiscontinuity() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        read(tee, URL, 0, ts(3), channel = true)
        val d = rec.discs
        read(tee, URL, 0, ts(3), channel = true)
        assertEquals(d + 1, rec.discs)
    }

    @Test fun fmp4IsUnsupported() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        val box = ByteArray(1000)
        "\u0000\u0000\u0000\u0018styp".toByteArray().copyInto(box)
        read(tee, "http://h/hls/a/s1.m4s", 0, box, channel = false)
        assertEquals("fMP4", rec.unsupported)
        assertEquals(0, rec.bytes.size())
    }

    @Test fun separateAudioAndVideoSegmentsAreUnsupported() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        val v = tee.begin("http://h/v/s1.ts", 0, false)
        val a = tee.begin("http://h/a/s1.ts", 0, false)
        val seg = ts(3)
        v.bytes(seg, 0, seg.size)
        a.bytes(seg, 0, seg.size)
        assertEquals("separate audio and video", rec.unsupported)
        v.close(); a.close()
        assertEquals(0, tee.openCount())
    }

    @Test fun aStreamAlreadyOpenFeedsASinkAttachedLater() {
        val tee = TimeshiftTee()
        val r = tee.begin(URL, 0, true)
        val seg = ts(3)
        r.bytes(seg, 0, seg.size)
        val rec = Rec()
        tee.attach(rec)
        r.bytes(seg, 0, seg.size)
        assertEquals(seg.size, rec.bytes.size())
        assertEquals("d", rec.events.first())
        assertEquals(1, tee.openCount())
        r.close()
        assertEquals(0, tee.openCount())
    }

    @Test fun smallReadsArePackedSoTheQueueHoldsAbout3MB() {
        val tee = TimeshiftTee()
        // Not started: nothing drains the queue, as when the disk stalls.
        val sess = TimeshiftSession("k", URL, tmp.newFolder(), { TimeshiftLimits(0L, 1L shl 40) }, tee,
            openSource = { FakeOwn() }, clock = { System.nanoTime() / 1_000_000L })
        val read = ByteArray(9400) // an ExoPlayer TS read: 50 packets
        var handed = 0L
        while (handed + read.size <= 3_000_000L) { sess.teeBytes(read, 0, read.size); handed += read.size }
        assertEquals("nothing dropped below 3 MB", 0L, sess.droppedBytes)
        assertEquals(handed, sess.queuedBytes())
        repeat(30) { sess.teeBytes(read, 0, read.size) }
        assertTrue("past 48 x 64 KB the rest is dropped", sess.droppedBytes > 0L)
        assertEquals(48L * 64 * 1024, sess.queuedBytes())
    }

    @Test fun aClosedSessionHoldingItsConnectionReleasesLaterCallbacksToo() {
        val tee = TimeshiftTee()
        val sess = newSession(tee)
        val p1 = player(tee)
        waitFor("segments") { sess.segments().size >= 2 }
        sess.takeOver()
        p1.halt()
        waitFor("own connection") { ownSources.size == 1 && ownSources[0].pumping }
        sess.close()
        session = null
        val released = CountDownLatch(1)
        var openAtRelease = -1
        sess.whenReleased(Runnable { openAtRelease = open.get(); released.countDown() })
        assertTrue(released.await(5, TimeUnit.SECONDS))
        assertEquals(0, openAtRelease)
        assertFalse(sess.holdsConnection())
    }

    @Test fun aVariantSwitchSkipsTheSegmentAlreadyPassedOnByItsNumber() {
        val tee = TimeshiftTee()
        val rec = Rec()
        tee.attach(rec)
        fun playlist(dir: String, first: Long) = ("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:$first\n" +
            (0 until 3).joinToString("") { "#EXTINF:4.0,\nseg${first + it}.ts\n" }).toByteArray()
        val seg = ts(4)
        read(tee, "http://h/hls/low/index.m3u8", 0, playlist("low", 100), channel = false)
        read(tee, "http://h/hls/low/seg100.ts", 0, seg, channel = false)
        read(tee, "http://h/hls/low/seg101.ts", 0, seg, channel = false)
        // Switch: the new variant's playlist, then segment 101 again from it (another address).
        read(tee, "http://h/hls/high/index.m3u8", 0, playlist("high", 100), channel = false)
        val before = rec.bytes.size()
        val discs = rec.discs
        read(tee, "http://h/hls/high/seg101.ts", 0, seg, channel = false)
        assertEquals("the same seconds are not written twice", before, rec.bytes.size())
        read(tee, "http://h/hls/high/seg102.ts", 0, seg, channel = false)
        assertEquals(before + seg.size, rec.bytes.size())
        assertEquals("the new variant starts a new piece", discs + 1, rec.discs)
        // A playlist whose numbering started again is followed, not skipped.
        read(tee, "http://h/hls/high/index.m3u8", 0, playlist("high", 0), channel = false)
        read(tee, "http://h/hls/high/seg0.ts", 0, seg, channel = false)
        assertEquals(before + 2 * seg.size, rec.bytes.size())
    }

    // ---- fakes ----------------------------------------------------------------

    private fun newSession(tee: TimeshiftTee): TimeshiftSession {
        val s = TimeshiftSession(
            key = "k",
            url = URL,
            dir = tmp.newFolder(),
            limits = { TimeshiftLimits(0L, 1L shl 40) },
            tee = tee,
            openSource = { FakeOwn().also { ownSources.add(it) } },
            clock = { System.nanoTime() / 1_000_000L },
            takeoverGraceMs = 100L,
            handbackGraceMs = 50L,
        )
        session = s
        s.start()
        return s
    }

    private fun player(tee: TimeshiftTee): FakePlayer = FakePlayer(tee).also { players.add(it); it.start() }

    /** The player's live connection: a raw MPEG-TS channel read through the tee. */
    private inner class FakePlayer(private val tee: TimeshiftTee) : Thread("fake-player") {
        @Volatile private var stop = false
        override fun run() {
            // As TimeshiftTapDataSource: counted by the tee before the request goes out.
            val reader = tee.begin(URL, 0, true)
            connect()
            var pcr = 0L
            try {
                while (!stop) {
                    val g = group(pcr)
                    reader.bytes(g, 0, g.size)
                    pcr += 90_000L
                    sleep(2)
                }
            } catch (_: InterruptedException) {
            } finally {
                // The connection closes, then the source's close() reaches the tee.
                open.decrementAndGet()
                reader.close()
            }
        }
        fun halt() { stop = true; join(5000) }
    }

    /** The session's own connection. */
    private inner class FakeOwn : LiveFeed {
        @Volatile var cancelled = false
        @Volatile var pumping = false
        override fun pump(sink: (ByteArray, Int, Int) -> Unit) {
            if (cancelled) return
            connect()
            pumping = true
            try {
                var pcr = 50_000_000L
                while (!cancelled) {
                    val g = group(pcr)
                    sink(g, 0, g.size)
                    pcr += 90_000L
                    Thread.sleep(2)
                }
            } finally {
                pumping = false
                open.decrementAndGet()
            }
        }
        override fun cancel() { cancelled = true }
    }

    private fun waitFor(what: String, cond: () -> Boolean) {
        val until = System.currentTimeMillis() + 10_000
        while (!cond()) {
            if (System.currentTimeMillis() > until) throw AssertionError("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    companion object {
        private const val URL = "http://h.test/live/u/p/1.ts"

        /** One "second" of a stream: a PAT, a packet with the PCR, and three payload packets. */
        fun group(pcr: Long): ByteArray {
            val out = ByteArray(5 * 188)
            pat(out, 0)
            pcrPacket(out, 188, pcr)
            for (k in 2 until 5) payload(out, k * 188)
            return out
        }

        /** [seconds] groups in a row. */
        fun ts(seconds: Int): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            for (i in 0 until seconds) out.write(group(i * 90_000L))
            return out.toByteArray()
        }

        private fun pat(b: ByteArray, p: Int) {
            b.fill(0xFF.toByte(), p, p + 188)
            b[p] = 0x47; b[p + 1] = 0x40; b[p + 2] = 0x00; b[p + 3] = 0x10
            b[p + 4] = 0x00 // pointer field
        }

        private fun pcrPacket(b: ByteArray, p: Int, pcr: Long) {
            b.fill(0xFF.toByte(), p, p + 188)
            b[p] = 0x47; b[p + 1] = 0x01; b[p + 2] = 0x00
            b[p + 3] = 0x20 // adaptation field only
            b[p + 4] = 183.toByte()
            b[p + 5] = 0x10 // PCR flag
            b[p + 6] = (pcr shr 25).toByte()
            b[p + 7] = (pcr shr 17).toByte()
            b[p + 8] = (pcr shr 9).toByte()
            b[p + 9] = (pcr shr 1).toByte()
            b[p + 10] = (((pcr and 1L) shl 7) or 0x7E).toByte()
            b[p + 11] = 0
        }

        private fun payload(b: ByteArray, p: Int) {
            b.fill(0x00, p, p + 188)
            b[p] = 0x47; b[p + 1] = 0x01; b[p + 2] = 0x00; b[p + 3] = 0x10
        }

        private fun read(tee: TimeshiftTee, uri: String, position: Long, body: ByteArray, channel: Boolean) {
            val r = tee.begin(uri, position, channel)
            // In uneven pieces, as a socket hands them over.
            var i = 0
            var step = 97
            while (i < body.size) {
                val n = minOf(step, body.size - i)
                r.bytes(body, i, n)
                i += n
                step = if (step > 900) 97 else step * 2
            }
            r.close()
        }
    }
}
