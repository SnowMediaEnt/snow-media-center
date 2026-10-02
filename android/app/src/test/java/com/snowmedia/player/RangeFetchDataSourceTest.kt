package com.snowmedia.player

import android.net.Uri
import androidx.media3.common.C
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
import java.util.concurrent.atomic.AtomicInteger

/**
 * RangeFetchDataSource against a local HTTP server that serves a file with
 * Range support, the way a Plex server serves /library/parts/: the pieces
 * come back as one stream in order, from any start, over several connections
 * at once; the end, a seek past the end, a server that ignores ranges, and
 * an error status all behave as Media3's own HTTP source does.
 */
class RangeFetchDataSourceTest {
    private lateinit var server: HttpServer
    private val file = ByteArray(5 * 1024 * 1024 + 123).also { b -> for (i in b.indices) b[i] = (i * 31 + (i shr 10)).toByte() }
    private val requests = AtomicInteger(0)
    private val concurrent = AtomicInteger(0)
    private var peakConcurrent = 0
    @Volatile private var ignoreRange = false
    @Volatile private var status = 0

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = java.util.concurrent.Executors.newCachedThreadPool()
        server.createContext("/library/parts/1/0/file.mkv") { ex -> serve(ex) }
        server.start()
    }

    @After
    fun stop() { server.stop(0) }

    private fun serve(ex: HttpExchange) {
        requests.incrementAndGet()
        val now = concurrent.incrementAndGet()
        synchronized(this) { if (now > peakConcurrent) peakConcurrent = now }
        try {
            if (status != 0) {
                ex.sendResponseHeaders(status, 0); ex.responseBody.close(); return
            }
            val range = ex.requestHeaders.getFirst("Range")
            if (range == null || ignoreRange) {
                ex.sendResponseHeaders(200, file.size.toLong())
                ex.responseBody.use { it.write(file) }
                return
            }
            val m = Regex("bytes=(\\d+)-(\\d*)").find(range) ?: run { ex.sendResponseHeaders(400, -1); return }
            val from = m.groupValues[1].toLong()
            val to = m.groupValues[2].toLongOrNull()?.coerceAtMost(file.size - 1L) ?: (file.size - 1L)
            if (from >= file.size) {
                ex.responseHeaders.add("Content-Range", "bytes */${file.size}")
                ex.sendResponseHeaders(416, -1)
                return
            }
            ex.responseHeaders.add("Content-Range", "bytes $from-$to/${file.size}")
            val len = (to - from + 1).toInt()
            ex.sendResponseHeaders(206, len.toLong())
            // Slowly enough that pieces overlap in time.
            ex.responseBody.use { out ->
                var off = from.toInt()
                val endAt = from.toInt() + len
                while (off < endAt) {
                    val n = minOf(64 * 1024, endAt - off)
                    out.write(file, off, n)
                    out.flush()
                    off += n
                    Thread.sleep(1)
                }
            }
        } finally {
            concurrent.decrementAndGet()
        }
    }

    private fun source(connections: Int = 4, chunk: Int = 256 * 1024) =
        RangeFetchDataSource("Test/1", 5000, 5000, connections, chunk)

    private fun uri(): Uri = Uri.parse("http://127.0.0.1:${server.address.port}/library/parts/1/0/file.mkv")

    private fun readAll(ds: RangeFetchDataSource, spec: DataSpec, max: Int = Int.MAX_VALUE): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(7919)
        while (out.size() < max) {
            val n = ds.read(buf, 0, minOf(buf.size, max - out.size()))
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    @Test
    fun `the whole file, in order, over several connections at once`() {
        val ds = source()
        val spec = DataSpec.Builder().setUri(uri()).build()
        val length = ds.open(spec)
        assertEquals(file.size.toLong(), length)
        val got = readAll(ds, spec)
        ds.close()
        assertArrayEquals(file, got)
        assertTrue("pieces overlapped (peak $peakConcurrent)", peakConcurrent >= 2)
        assertTrue("more than one request (${requests.get()})", requests.get() > 1)
    }

    @Test
    fun `an open part-way (a seek) reads from there, and a bounded length stops at it`() {
        val ds = source()
        val from = 1_234_567L
        val spec = DataSpec.Builder().setUri(uri()).setPosition(from).build()
        assertEquals(file.size - from, ds.open(spec))
        val got = readAll(ds, spec, 300_000)
        assertArrayEquals(file.copyOfRange(from.toInt(), from.toInt() + 300_000), got)
        ds.close()
        val bounded = DataSpec.Builder().setUri(uri()).setPosition(from).setLength(100_000L).build()
        assertEquals(100_000L, ds.open(bounded))
        val part = readAll(ds, bounded)
        assertEquals(100_000, part.size)
        assertArrayEquals(file.copyOfRange(from.toInt(), from.toInt() + 100_000), part)
        ds.close()
    }

    @Test
    fun `the first bytes come before the first piece is complete`() {
        val ds = source(connections = 2, chunk = 2 * 1024 * 1024)
        val spec = DataSpec.Builder().setUri(uri()).build()
        ds.open(spec)
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
    fun `a start right after the end reads nothing, past it is an error status`() {
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
    }

    @Test
    fun `a server that ignores the range is read as one stream from the start`() {
        ignoreRange = true
        val ds = source()
        val spec = DataSpec.Builder().setUri(uri()).build()
        assertEquals(file.size.toLong(), ds.open(spec))
        val got = readAll(ds, spec)
        ds.close()
        assertArrayEquals(file, got)
        assertEquals(1, requests.get())
        // Part-way it can't skip gigabytes: an error, which the player retries.
        try {
            ds.open(DataSpec.Builder().setUri(uri()).setPosition(1000L).build())
            fail("expected an error")
        } catch (e: HttpDataSource.HttpDataSourceException) {
            assertTrue(e !is HttpDataSource.InvalidResponseCodeException)
        }
        ds.close()
    }

    @Test
    fun `close mid-way ends the pieces in flight, and the source can open again`() {
        val ds = source()
        val spec = DataSpec.Builder().setUri(uri()).build()
        ds.open(spec)
        readAll(ds, spec, 100_000)
        ds.close()
        // Nothing left running after a moment.
        var waited = 0
        while (concurrent.get() > 0 && waited < 3000) { Thread.sleep(20); waited += 20 }
        assertEquals(0, concurrent.get())
        assertEquals(file.size.toLong(), ds.open(spec))
        assertArrayEquals(file.copyOfRange(0, 50_000), readAll(ds, spec, 50_000))
        ds.close()
    }

    @Test
    fun `the plan - a small first piece, and the file size from Content-Range`() {
        assertEquals(RangeFetchDataSource.FIRST_CHUNK_BYTES, RangeFetchDataSource.firstChunkLength(C.LENGTH_UNSET.toLong(), 2 * 1024 * 1024))
        assertEquals(64 * 1024, RangeFetchDataSource.firstChunkLength(C.LENGTH_UNSET.toLong(), 64 * 1024))
        assertEquals(1000, RangeFetchDataSource.firstChunkLength(1000L, 2 * 1024 * 1024))
        assertEquals(5000L, RangeFetchDataSource.documentSize("bytes 0-1023/5000"))
        assertEquals(5000L, RangeFetchDataSource.documentSize("bytes */5000"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.documentSize("bytes 0-1023/*"))
        assertEquals(C.LENGTH_UNSET.toLong(), RangeFetchDataSource.documentSize(null))
    }
}
