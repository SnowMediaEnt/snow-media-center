package com.snowmedia.dvr

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * LiveSource against a fake Xtream panel serving HLS the way DreamStreams'
 * output=m3u8 does: /live/u/p/7.m3u8 redirects to a token path whose
 * playlist lists its segments relatively; any other address under /live/
 * is never answered (a panel holds a request for a stream it doesn't know).
 * Fire TV, 2026-10-30: the buffer's own connection got nothing, timing out
 * every 30 s, because the segments were resolved against /live/u/p/.
 */
class LiveSourceHlsTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val paths = Collections.synchronizedList(ArrayList<String>())
    /** First media sequence number listed; moves on with every playlist read. */
    private val first = AtomicLong(100)
    @Volatile private var numbered = true
    private val hung = AtomicInteger(0)
    private val logs = Collections.synchronizedList(ArrayList<String>())

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                paths.add(path)
                return when {
                    path == "/live/u/p/7.m3u8" -> MockResponse().setResponseCode(302).addHeader("Location", "/hls/tok123/7.m3u8")
                    path == "/hls/tok123/7.m3u8" -> {
                        val f = first.getAndIncrement()
                        val head = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n" +
                            (if (numbered) "#EXT-X-MEDIA-SEQUENCE:$f\n" else "")
                        val body = head + (0 until 3).joinToString("") { "#EXTINF:2.0,\n7_${f + it}.ts\n" }
                        MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(body)
                    }
                    path.startsWith("/hls/tok123/7_") ->
                        MockResponse().setHeader("Content-Type", "video/mp2t").setBody(Buffer().write(TimeshiftHandoverTest.ts(2)))
                    path == "/live/u/p/9.ts" -> MockResponse().setHeader("Content-Type", "video/mp2t")
                        .setBody(Buffer().write(TimeshiftHandoverTest.ts(2)))
                    else -> { hung.incrementAndGet(); MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE) }
                }
            }
        }
        server.start()
    }

    @After fun tearDown() { server.shutdown() }

    private fun url(path: String) = server.url(path).toString()

    /** Pumps on a thread until [bytes] have come (or 10 s), then cancels. Bytes received. */
    private fun pumpUntil(src: LiveSource, bytes: Long): Long {
        val got = AtomicLong(0)
        val t = Thread {
            try { src.pump { _, _, n -> got.addAndGet(n.toLong()) } } catch (_: Exception) { /* cancelled */ }
        }
        t.start()
        val until = System.currentTimeMillis() + 10_000
        while (got.get() < bytes && System.currentTimeMillis() < until) Thread.sleep(20)
        src.cancel()
        t.join(5000)
        assertFalse("the pump returns once cancelled", t.isAlive)
        return got.get()
    }

    @Test fun segmentsResolveAgainstTheRedirectedPlaylist() {
        val seg = TimeshiftHandoverTest.ts(2).size.toLong()
        val got = pumpUntil(LiveSource(url("/live/u/p/7.m3u8")) { logs.add(it) }, 2 * seg)
        assertTrue("segments arrived ($got B)", got >= 2 * seg)
        assertEquals("nothing asked under /live/u/p/ but the channel", 0, hung.get())
        assertTrue(paths.any { it.startsWith("/hls/tok123/7_") })
        // The diagnostics say what happened, never where.
        assertTrue(logs.any { it.startsWith("playlist: HTTP 302 -> same host") })
        assertTrue(logs.any { it.startsWith("segment: HTTP 200") })
        for (l in logs) {
            assertFalse(l, l.contains("tok123"))
            assertFalse(l, l.contains("/live/"))
            assertFalse(l, l.contains(server.hostName + ":" + server.port))
        }
    }

    @Test fun aPlaylistWithoutMediaSequenceStillMovesOn() {
        numbered = false
        val seg = TimeshiftHandoverTest.ts(2).size.toLong()
        // The joining segment, then at least two new ones over the reloads.
        val got = pumpUntil(LiveSource(url("/live/u/p/7.m3u8")), 3 * seg)
        assertTrue("new segments kept coming ($got B)", got >= 3 * seg)
    }

    @Test fun cancelReturnsFromARequestThePanelNeverAnswers() {
        val src = LiveSource(url("/live/u/p/404.ts"))
        val done = CountDownLatch(1)
        Thread {
            try { src.pump { _, _, _ -> } } catch (_: Exception) { /* cancelled */ }
            done.countDown()
        }.start()
        while (hung.get() == 0) Thread.sleep(10)
        val t0 = System.currentTimeMillis()
        src.cancel()
        assertTrue("returned promptly", done.await(3, TimeUnit.SECONDS))
        assertTrue(System.currentTimeMillis() - t0 < 3000)
    }

    @Test fun goLiveAfterATakeOverWhoseOwnConnectionHangs() {
        // The session's own connection asks for something the panel never
        // answers; Go live must still be released promptly.
        val tee = TimeshiftTee()
        val sess = TimeshiftSession("k", url("/live/u/p/404.ts"), tmp.newFolder(), { TimeshiftLimits(0L, 1L shl 40) }, tee,
            clock = { System.nanoTime() / 1_000_000L }, takeoverGraceMs = 50L, handbackGraceMs = 50L)
        sess.start()
        val r = tee.begin(url("/live/u/p/9.ts"), 0, true)
        val g = TimeshiftHandoverTest.ts(30)
        r.bytes(g, 0, g.size)
        sess.takeOver()
        r.close()
        val until = System.currentTimeMillis() + 5000
        while (hung.get() == 0 && System.currentTimeMillis() < until) Thread.sleep(10)
        assertEquals("the own connection is waiting on the panel", 1, hung.get())
        val released = CountDownLatch(1)
        sess.handBack(Runnable { released.countDown() })
        assertTrue("Go live released", released.await(3, TimeUnit.SECONDS))
        assertFalse(sess.holdsConnection())
        sess.close()
    }

    @Test fun theOwnConnectionGoesOnFromThePlayersMediaPlaylist() {
        val tee = TimeshiftTee()
        val opened = Collections.synchronizedList(ArrayList<String>())
        val sess = TimeshiftSession("k", url("/live/u/p/7.m3u8"), tmp.newFolder(), { TimeshiftLimits(0L, 1L shl 40) }, tee,
            openSource = { u -> opened.add(u); LiveSource(u) },
            clock = { System.nanoTime() / 1_000_000L }, takeoverGraceMs = 50L, handbackGraceMs = 50L)
        sess.start()
        // The player: the channel address (redirected), its playlist, a segment.
        val pl = tee.begin(url("/live/u/p/7.m3u8"), 0, true)
        pl.setBase(url("/hls/tok123/7.m3u8"))
        val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:5\n#EXTINF:2.0,\n7_5.ts\n".toByteArray()
        pl.bytes(text, 0, text.size)
        pl.close()
        val seg = tee.begin(url("/hls/tok123/7_5.ts"), 0, false)
        val g = TimeshiftHandoverTest.ts(30)
        seg.bytes(g, 0, g.size)
        seg.close()
        sess.takeOver()
        val until = System.currentTimeMillis() + 5000
        while (opened.isEmpty() && System.currentTimeMillis() < until) Thread.sleep(10)
        assertEquals(listOf(url("/hls/tok123/7.m3u8")), opened.toList())
        val released = CountDownLatch(1)
        sess.handBack(Runnable { released.countDown() })
        assertTrue(released.await(3, TimeUnit.SECONDS))
        sess.close()
    }
}
