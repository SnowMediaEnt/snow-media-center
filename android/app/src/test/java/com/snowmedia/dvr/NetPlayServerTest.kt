package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test fun percentDecoding() {
        assertEquals("a b", NetPlayServer.percentDecode("a%20b"))
        assertEquals("é", NetPlayServer.percentDecode("%C3%A9"))
        assertEquals("a+b", NetPlayServer.percentDecode("a+b"))
        assertNull(NetPlayServer.percentDecode("%"))
        assertNull(NetPlayServer.percentDecode("%4"))
        assertNull(NetPlayServer.percentDecode("%FF"))
    }
}
