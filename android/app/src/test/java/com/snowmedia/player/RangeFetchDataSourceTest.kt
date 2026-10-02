package com.snowmedia.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * RangeFetchDataSource against a local HTTP server that serves a file with
 * Range support, the way a Plex server serves /library/parts/: the pieces
 * come back as one stream in order, from any start, over several connections
 * at once; the window stays busy while one piece is slow; a failed, short or
 * stalled piece is asked for again from where it stopped; a refusal lowers
 * the connections; a small open costs one request; bytes are counted as
 * they arrive; and the end, a seek past the end, a server that ignores
 * ranges, a redirect and an error status all behave as Media3's own HTTP
 * source does.
 */
class RangeFetchDataSourceTest {
    private lateinit var server: HttpServer
    private val file = ByteArray(12 * 1024 * 1024 + 123).also { b -> for (i in b.indices) b[i] = (i * 31 + (i shr 10)).toByte() }
    private val requests = AtomicInteger(0)
    private val concurrent = AtomicInteger(0)
    @Volatile private var peakConcurrent = 0
    /** Every ranged request's first byte, in the order they arrived. */
    private val ranges = Collections.synchronizedList(ArrayList<Long>())
    @Volatile private var ignoreRange = false
    @Volatile private var status = 0
    /** The first request at this byte waits this long before its body (a slow piece). */
    @Volatile private var slowFrom = -1L
    @Volatile private var slowMs = 0L
    @Volatile private var requestsDuringSlow = -1
    /** The first request at this byte sends its headers and then nothing for 5 s. */
    @Volatile private var hangFrom = -1L
    /** The first request at this byte sends only half its bytes, then closes. */
    @Volatile private var shortFrom = -1L
    /** The first request at this byte is answered with this status. */
    @Volatile private var failFrom = -1L
    @Volatile private var failStatus = 500
    /** More than this many at once are refused with 503 (0: no limit). */
    @Volatile private var maxConcurrent = 0
    private val seen = Collections.synchronizedSet(HashSet<Long>())

    private val path = "/library/parts/1/0/file.mkv"

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = java.util.concurrent.Executors.newCachedThreadPool()
        server.createContext(path) { ex -> serve(ex) }
        server.createContext("/old/file.mkv") { ex -> redirect(ex, path) }
        server.createContext("/older/file.mkv") { ex -> redirect(ex, "/old/file.mkv") }
        server.start()
    }

    @After
    fun stop() { server.stop(0) }

    private fun redirect(ex: HttpExchange, to: String) {
        requests.incrementAndGet()
        ex.responseHeaders.add("Location", to)
        ex.sendResponseHeaders(302, -1)
        ex.close()
    }

    private fun serve(ex: HttpExchange) {
        requests.incrementAndGet()
        val now = concurrent.incrementAndGet()
        synchronized(this) { if (now > peakConcurrent) peakConcurrent = now }
        var counted = true
        try {
            if (status != 0) {
                ex.sendResponseHeaders(status, -1); ex.close(); return
            }
            val range = ex.requestHeaders.getFirst("Range")
            if (range == null || ignoreRange) {
                ex.sendResponseHeaders(200, file.size.toLong())
                ex.responseBody.use { it.write(file) }
                return
            }
            val m = Regex("bytes=(\\d+)-(\\d*)").find(range) ?: run { ex.sendResponseHeaders(400, -1); ex.close(); return }
            val from = m.groupValues[1].toLong()
            val to = m.groupValues[2].toLongOrNull()?.coerceAtMost(file.size - 1L) ?: (file.size - 1L)
            ranges.add(from)
            if (maxConcurrent > 0 && now > maxConcurrent) {
                ex.sendResponseHeaders(503, -1); ex.close(); return
            }
            if (from == failFrom && seen.add(from)) {
                ex.sendResponseHeaders(failStatus, -1); ex.close(); return
            }
            if (from >= file.size) {
                ex.responseHeaders.add("Content-Range", "bytes */${file.size}")
                ex.sendResponseHeaders(416, -1)
                ex.close()
                return
            }
            if (from == slowFrom && seen.add(from)) {
                val before = requests.get()
                Thread.sleep(slowMs)
                requestsDuringSlow = requests.get() - before
            }
            ex.responseHeaders.add("Content-Range", "bytes $from-$to/${file.size}")
            val len = (to - from + 1).toInt()
            val short = from == shortFrom && seen.add(from)
            // A short piece is chunked, so the body ends cleanly after half the bytes.
            ex.sendResponseHeaders(206, if (short) 0L else len.toLong())
            if (from == hangFrom && seen.add(from)) {
                Thread.sleep(5000)
            }
            // Slowly enough that pieces overlap in time.
            try {
                ex.responseBody.use { out ->
                    var off = from.toInt()
                    val endAt = if (short) from.toInt() + len / 2 else from.toInt() + len
                    while (off < endAt) {
                        val n = minOf(64 * 1024, endAt - off)
                        if (off + n >= endAt && !short) {
                            // Done with it before the last bytes go out, so the
                            // client's next request never sees this one as still open.
                            concurrent.decrementAndGet()
                            counted = false
                        }
                        out.write(file, off, n)
                        out.flush()
                        off += n
                        Thread.sleep(1)
                    }
                }
            } catch (_: java.io.IOException) {
                // A piece cut short, or the client gone: the server's stream complains; fine.
            }
        } finally {
            if (counted) concurrent.decrementAndGet()
        }
    }

    /** Small pieces and a small window, so a 12 MiB file exercises the whole window. */
    private fun small(
        connections: Int = 4,
        windowBytes: Int = 4 * 1024 * 1024,
        arrival: AtomicLong? = null,
        minPieceBytes: Int = 256 * 1024,
        maxPieceBytes: Int = 1024 * 1024,
        rampBytes: Int = 256 * 1024,
        stallMs: Long = RangeFetchDataSource.DEFAULT_STALL_MS,
    ) = RangeFetchDataSource.Shared(
        connections = connections, windowBytes = windowBytes, arrival = arrival, slabBytes = 64 * 1024,
        rampBytes = rampBytes, minPieceBytes = minPieceBytes, maxPieceBytes = maxPieceBytes, stallMs = stallMs,
    )

    private fun source(shared: RangeFetchDataSource.Shared = small()) =
        RangeFetchDataSource("Test/1", 5000, 5000, shared)

    private fun uri(p: String = path): Uri = Uri.parse("http://127.0.0.1:${server.address.port}$p")

    private fun readAll(ds: RangeFetchDataSource, max: Int = Int.MAX_VALUE): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(7919)
        while (out.size() < max) {
            val n = ds.read(buf, 0, minOf(buf.size, max - out.size()))
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun requestsAt(from: Long): Int = synchronized(ranges) { ranges.count { it == from } }

    /** Waits for the server and the source to have no connection left. */
    private fun settle(shared: RangeFetchDataSource.Shared? = null) {
        var waited = 0
        while ((concurrent.get() > 0 || (shared?.liveConnections?.get() ?: 0) > 0) && waited < 3000) { Thread.sleep(20); waited += 20 }
    }

    @Test
    fun `the whole file, in order, over several connections at once`() {
        val ds = source()
        val length = ds.open(DataSpec.Builder().setUri(uri()).build())
        assertEquals(file.size.toLong(), length)
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        assertTrue("pieces overlapped (peak $peakConcurrent)", peakConcurrent >= 2)
        assertTrue("more than one request (${requests.get()})", requests.get() > 1)
        // Pieces grew from the smallest to the largest while reads stayed sequential.
        val sizes = synchronized(ranges) { ranges.sorted().zipWithNext { a, b -> b - a } }
        assertTrue("pieces grew (${sizes.take(12)})", sizes.contains(256L * 1024) && sizes.contains(1024L * 1024))
    }

    @Test
    fun `an open part-way (a seek) reads from there, and a bounded length stops at it`() {
        val ds = source()
        val from = 1_234_567L
        assertEquals(file.size - from, ds.open(DataSpec.Builder().setUri(uri()).setPosition(from).build()))
        val got = readAll(ds, 300_000)
        assertArrayEquals(file.copyOfRange(from.toInt(), from.toInt() + 300_000), got)
        ds.close()
        val bounded = DataSpec.Builder().setUri(uri()).setPosition(from).setLength(100_000L).build()
        assertEquals(100_000L, ds.open(bounded))
        val part = readAll(ds)
        assertEquals(100_000, part.size)
        assertArrayEquals(file.copyOfRange(from.toInt(), from.toInt() + 100_000), part)
        ds.close()
    }

    @Test
    fun `the first bytes come before the first piece is complete`() {
        val ds = source(small(rampBytes = 2 * 1024 * 1024))
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val buf = ByteArray(16)
        val t0 = System.nanoTime()
        val n = ds.read(buf, 0, buf.size)
        val ms = (System.nanoTime() - t0) / 1_000_000
        ds.close()
        assertEquals(16, n)
        assertArrayEquals(file.copyOfRange(0, 16), buf)
        // A 2 MiB piece at 64 KB/ms takes >30 ms to arrive in full.
        assertTrue("first read waited $ms ms", ms < 1000)
    }

    @Test
    fun `a slow head piece never idles the other connections`() {
        val shared = small(minPieceBytes = 256 * 1024, maxPieceBytes = 256 * 1024)
        slowFrom = 256L * 1024
        slowMs = 1500L
        val ds = source(shared)
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        // While the head waited 1.5 s the others went on taking pieces until
        // the 4 MiB window was full: 15 pieces of 256 KiB besides the head.
        assertTrue("requests during the slow head: $requestsDuringSlow", requestsDuringSlow >= 8)
        // Slow is not stalled: it was asked for once.
        assertEquals(1, requestsAt(slowFrom))
    }

    @Test
    fun `a piece cut short is asked for again from where it stopped`() {
        shortFrom = 512L * 1024
        val ds = source(small(minPieceBytes = 256 * 1024, maxPieceBytes = 256 * 1024))
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        // The second request for that piece starts after the half that arrived.
        assertEquals(1, requestsAt(shortFrom))
        assertEquals(1, requestsAt(shortFrom + 128L * 1024))
    }

    @Test
    fun `a failed piece is retried, and a refusal on an extra range lowers the connections`() {
        failFrom = 768L * 1024
        failStatus = 503
        val shared = small(minPieceBytes = 256 * 1024, maxPieceBytes = 256 * 1024)
        assertEquals(4, shared.connectionCap)
        val ds = source(shared)
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        assertEquals(2, requestsAt(failFrom))
        assertEquals(3, shared.connectionCap)
        // The next load starts again with every connection.
        shared.newLoad()
        assertEquals(4, shared.connectionCap)
    }

    @Test
    fun `a server that allows two at once ends up with two connections, and the file still plays`() {
        maxConcurrent = 2
        val shared = small(minPieceBytes = 256 * 1024, maxPieceBytes = 256 * 1024)
        val ds = source(shared)
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        assertTrue("cap ${shared.connectionCap}", shared.connectionCap <= 2)
        assertTrue("cap ${shared.connectionCap}", shared.connectionCap >= 1)
    }

    @Test
    fun `a head piece that stops arriving is asked for again on a fresh connection`() {
        hangFrom = 512L * 1024
        val shared = small(minPieceBytes = 256 * 1024, maxPieceBytes = 256 * 1024, stallMs = 700L)
        val ds = source(shared)
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val t0 = System.nanoTime()
        val got = readAll(ds)
        val ms = (System.nanoTime() - t0) / 1_000_000
        ds.close()
        assertArrayEquals(file, got)
        assertEquals(2, requestsAt(hangFrom))
        assertTrue("took $ms ms", ms < 4500)
    }

    @Test
    fun `an open that reads under 1 MiB makes exactly one request`() {
        val ds = source(RangeFetchDataSource.Shared())
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds, 900 * 1024)
        ds.close()
        assertArrayEquals(file.copyOfRange(0, 900 * 1024), got)
        assertEquals(1, requests.get())
        // The same from a seek.
        ds.open(DataSpec.Builder().setUri(uri()).setPosition(5_000_000L).build())
        assertArrayEquals(file.copyOfRange(5_000_000, 5_000_000 + 4096), readAll(ds, 4096))
        ds.close()
        assertEquals(2, requests.get())
        // Past 1 MiB it fans out.
        ds.open(DataSpec.Builder().setUri(uri()).build())
        readAll(ds, 1536 * 1024)
        ds.close()
        assertTrue("requests ${requests.get()}", requests.get() >= 4)
    }

    @Test
    fun `bytes are counted as they arrive, not as the player reads them`() {
        val arrival = AtomicLong(0L)
        val ds = source(small(arrival = arrival))
        ds.open(DataSpec.Builder().setUri(uri()).build())
        val got = readAll(ds, 100 * 1024)
        assertEquals(100 * 1024, got.size)
        // The first piece (256 KiB) arrives in full while only 100 KiB were read.
        var waited = 0
        while (arrival.get() < 256L * 1024 && waited < 3000) { Thread.sleep(10); waited += 10 }
        assertEquals(256L * 1024, arrival.get())
        val rest = readAll(ds)
        ds.close()
        assertArrayEquals(file, got + rest)
        assertEquals(file.size.toLong(), arrival.get())
    }

    @Test
    fun `a start right after the end reads nothing, past it is a final error status`() {
        val ds = source()
        val atEnd = DataSpec.Builder().setUri(uri()).setPosition(file.size.toLong()).build()
        assertEquals(0L, ds.open(atEnd))
        assertEquals(C.RESULT_END_OF_INPUT, ds.read(ByteArray(8), 0, 8))
        ds.close()
        val past = DataSpec.Builder().setUri(uri()).setPosition(file.size + 10L).build()
        try {
            ds.open(past)
            fail("expected an error status")
        } catch (e: HttpDataSource.InvalidResponseCodeException) {
            assertEquals(416, e.responseCode)
            val cause = e.cause
            assertTrue("cause $cause", cause is DataSourceException && cause.reason == PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        }
        ds.close()
    }

    @Test
    fun `an error status is reported with its code, like the library's own source`() {
        status = 503
        val ds = source()
        try {
            ds.open(DataSpec.Builder().setUri(uri()).build())
            fail("expected an error status")
        } catch (e: HttpDataSource.InvalidResponseCodeException) {
            assertEquals(503, e.responseCode)
        }
        ds.close()
        settle()
        assertEquals(0, concurrent.get())
    }

    @Test
    fun `a server that ignores the range is read as one stream, skipped forward to the start asked for`() {
        ignoreRange = true
        val arrival = AtomicLong(0L)
        val ds = source(small(arrival = arrival))
        assertEquals(file.size.toLong(), ds.open(DataSpec.Builder().setUri(uri()).build()))
        val got = readAll(ds)
        ds.close()
        assertArrayEquals(file, got)
        assertEquals(1, requests.get())
        assertEquals(file.size.toLong(), arrival.get())
        // Part-way: the bytes before the start are read and dropped, as Media3 does.
        assertEquals(file.size - 100_000L, ds.open(DataSpec.Builder().setUri(uri()).setPosition(100_000L).build()))
        assertArrayEquals(file.copyOfRange(100_000, 150_000), readAll(ds, 50_000))
        ds.close()
        assertEquals(2, requests.get())
    }

    @Test
    fun `one redirect is followed per open, and every piece asks the address it led to`() {
        val ds = source()
        assertEquals(file.size.toLong(), ds.open(DataSpec.Builder().setUri(uri("/old/file.mkv")).build()))
        assertEquals(uri().toString(), ds.uri.toString())
        val got = readAll(ds, 2 * 1024 * 1024)
        ds.close()
        assertArrayEquals(file.copyOfRange(0, 2 * 1024 * 1024), got)
        // The redirect was asked once; every piece went straight to the file.
        assertTrue("requests ${requests.get()}, ranges ${ranges.size}", requests.get() == ranges.size + 1 && ranges.size >= 2)
        try {
            ds.open(DataSpec.Builder().setUri(uri("/older/file.mkv")).build())
            fail("expected an error after two redirects")
        } catch (e: HttpDataSource.HttpDataSourceException) {
            assertTrue(e !is HttpDataSource.InvalidResponseCodeException)
        }
        ds.close()
    }

    @Test
    fun `close mid-way ends the pieces in flight, and the source can open again`() {
        val shared = small()
        val ds = source(shared)
        ds.open(DataSpec.Builder().setUri(uri()).build())
        readAll(ds, 600_000)
        ds.close()
        settle(shared)
        assertEquals(0, concurrent.get())
        assertEquals(0, shared.liveConnections.get())
        assertEquals(file.size.toLong(), ds.open(DataSpec.Builder().setUri(uri()).build()))
        assertArrayEquals(file.copyOfRange(0, 50_000), readAll(ds, 50_000))
        ds.close()
        settle(shared)
        assertEquals(0, shared.liveConnections.get())
        // The slabs all came back: nothing is held past a close.
        assertTrue("pooled ${shared.pool.pooled()}", shared.pool.pooled() <= shared.windowSlabs)
    }

    @Test
    fun `the plan - the first piece, and the file size and start from Content-Range`() {
        assertEquals(RangeFetchDataSource.DEFAULT_RAMP_BYTES, RangeFetchDataSource.firstPieceLength(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.DEFAULT_RAMP_BYTES))
        assertEquals(1000, RangeFetchDataSource.firstPieceLength(1000L, 2 * 1024 * 1024))
        assertEquals(5000L, RangeFetchDataSource.documentSize("bytes 0-1023/5000"))
        assertEquals(5000L, RangeFetchDataSource.documentSize("bytes */5000"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.documentSize("bytes 0-1023/*"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.documentSize(null))
        assertEquals(1024L, RangeFetchDataSource.rangeStart("bytes 1024-2047/5000"))
        assertEquals(0L, RangeFetchDataSource.rangeStart("bytes 0-1023/*"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.rangeStart("bytes */5000"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.rangeStart(null))
        // The defaults: 4 connections, a 32 MiB window (16 on 2 GB boxes), pieces of 2 to 8 MiB.
        val shared = RangeFetchDataSource.Shared()
        assertEquals(4, shared.connections)
        assertEquals(32 * 1024 * 1024, shared.windowBytes)
        assertEquals(16 * 1024 * 1024, RangeFetchDataSource.LOW_RAM_WINDOW_BYTES)
        assertEquals(8, shared.maxPieceSlabs)
        // On a 16 MiB window a piece is at most its share: 4 MiB.
        assertEquals(4, RangeFetchDataSource.Shared(windowBytes = RangeFetchDataSource.LOW_RAM_WINDOW_BYTES).maxPieceSlabs)
    }
}
