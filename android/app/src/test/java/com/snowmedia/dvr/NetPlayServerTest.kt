package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The playback server's Range handling and its path guard (no sockets). */
class NetPlayServerTest {
    private fun part(s: Long, e: Long) = HttpRange.Result.Part(s, e)

    @Test fun ranges() {
        assertEquals(HttpRange.Result.Full, HttpRange.parse(null, 1000))
        assertEquals(HttpRange.Result.Full, HttpRange.parse("", 1000))
        assertEquals(part(0, 999), HttpRange.parse("bytes=0-", 1000))
        assertEquals(part(100, 199), HttpRange.parse("bytes=100-199", 1000))
        assertEquals(part(100, 999), HttpRange.parse("bytes=100-5000", 1000))
        assertEquals(part(500, 999), HttpRange.parse("bytes=-500", 1000))
        assertEquals(part(0, 999), HttpRange.parse("bytes=-5000", 1000))
        assertEquals(part(999, 999), HttpRange.parse("bytes=999-", 1000))
        assertEquals(part(7, 7), HttpRange.parse("BYTES= 7-7 ", 1000))
        assertEquals(100L, part(100, 199).length)
    }

    @Test fun outsideTheFileIs416() {
        assertEquals(HttpRange.Result.Unsatisfiable, HttpRange.parse("bytes=1000-", 1000))
        assertEquals(HttpRange.Result.Unsatisfiable, HttpRange.parse("bytes=2000-3000", 1000))
        assertEquals(HttpRange.Result.Unsatisfiable, HttpRange.parse("bytes=-0", 1000))
        assertEquals(HttpRange.Result.Unsatisfiable, HttpRange.parse("bytes=0-", 0))
        assertEquals(HttpRange.Result.Unsatisfiable, HttpRange.parse("bytes=-10", 0))
    }

    @Test fun anythingElseIsIgnoredAndTheWholeFileSent() {
        for (h in listOf("items=0-5", "bytes=5-1", "bytes=0-1,4-5", "bytes=a-b", "bytes=-", "bytes=1", "bytes=--5", "bytes=1.5-2", "bytes=99999999999999999999-")) {
            assertEquals(h, HttpRange.Result.Full, HttpRange.parse(h, 1000))
        }
    }

    private val token = "0123456789abcdef0123456789abcdef"

    @Test fun pathsThatReachAFile() {
        assertEquals("CNN.ts", NetPlayServer.target("/net/$token/CNN.ts", token))
        assertEquals("News (CNN) – 20.00.ts", NetPlayServer.target("/net/$token/" + LineCreds.encodeUriComponent("News (CNN) – 20.00.ts"), token))
        assertEquals("a+b.ts", NetPlayServer.target("/net/$token/a+b.ts?x=1", token))
    }

    @Test fun pathsThatDoNot() {
        for (p in listOf(
            "/net/wrongtoken/CNN.ts", "/net/$token/", "/net/$token", "/other/$token/CNN.ts", "/net//CNN.ts",
            "/net/$token/../secret.ts", "/net/$token/%2e%2e%2fsecret.ts", "/net/$token/sub/CNN.ts", "/net/$token/sub%2FCNN.ts",
            "/net/$token/sub%5CCNN.ts", "/net/$token/CNN.ts%3Astream", "/net/$token/C%3A%5Cx.ts", "/net/$token/notes.txt",
            "/net/$token/%zz.ts", "/net/$token/%C3.ts", "/net/$token/.hidden.ts", "/net/$token/a%00.ts",
            "http://127.0.0.1/net/$token/CNN.ts",
        )) assertNull(p, NetPlayServer.target(p, token))
    }

    /** A stream that gives one byte per read and moves the clock on [stepMs] each time. */
    private class Trickle(text: String, private val clock: LongArray, private val stepMs: Long) : java.io.InputStream() {
        private val bytes = text.toByteArray(Charsets.ISO_8859_1)
        private var i = 0
        override fun read(): Int {
            clock[0] += stepMs
            return if (i < bytes.size) bytes[i++].toInt() and 0xFF else -1
        }
    }

    private val request = "GET /net/x/CNN.ts HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=0-\r\n\r\n"

    @Test fun headersInTimeAreRead() {
        val clock = longArrayOf(0L)
        val timeouts = ArrayList<Int>()
        val head = NetPlayServer.readHead(Trickle(request, clock, 1), NetPlayServer.HEAD_DEADLINE_MS, { clock[0] }) { timeouts.add(it) }
        assertEquals(request.removeSuffix("\r\n\r\n"), head)
        // Each read may only wait for what is left of the one overall deadline.
        assertEquals(NetPlayServer.HEAD_DEADLINE_MS.toInt(), timeouts.first())
        assertTrue(timeouts.zipWithNext().all { (a, b) -> b < a })
    }

    @Test fun aByteNowAndThenCantHoldAWorker() {
        // One byte every second: each read is "in time", the whole is not.
        val clock = longArrayOf(0L)
        assertNull(NetPlayServer.readHead(Trickle(request, clock, 1_000L), NetPlayServer.HEAD_DEADLINE_MS, { clock[0] }) { })
        assertTrue(clock[0] <= NetPlayServer.HEAD_DEADLINE_MS + 1_000L)
    }

    @Test fun aSocketTimeoutOrAnEarlyEndIsNoRequest() {
        val timesOut = object : java.io.InputStream() {
            override fun read(): Int = throw java.net.SocketTimeoutException()
        }
        assertNull(NetPlayServer.readHead(timesOut, Long.MAX_VALUE, { 0L }) { })
        assertNull(NetPlayServer.readHead("GET / HTTP/1.1\r\n".byteInputStream(), Long.MAX_VALUE, { 0L }) { })
        assertNull(NetPlayServer.readHead("x".repeat(20_000).byteInputStream(), Long.MAX_VALUE, { 0L }) { })
    }

    @Test fun percentDecoding() {
        assertEquals("a b", NetPlayServer.percentDecode("a%20b"))
        assertEquals("é", NetPlayServer.percentDecode("%C3%A9"))
        assertEquals("a+b", NetPlayServer.percentDecode("a+b"))
        assertNull(NetPlayServer.percentDecode("%"))
        assertNull(NetPlayServer.percentDecode("%4"))
        assertNull(NetPlayServer.percentDecode("%FF"))
    }
}
