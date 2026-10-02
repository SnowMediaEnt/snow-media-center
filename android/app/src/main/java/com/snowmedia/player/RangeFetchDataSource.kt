package com.snowmedia.player

import android.net.Uri
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * A Plex file played as it is from a remote server, fetched over several HTTP
 * range requests at once (bugs/plex-buffering-remote.md).
 *
 * Media3's own HTTP source reads a file through ONE connection, opened once
 * with "Range: bytes=N-" and read until the end. One TCP connection to a far
 * server is held back by that one path's round-trip time and whatever packets
 * it loses or whatever shapes it on the way, and on such a line it carried a
 * customer's 12 Mb/s film at 1.4-5.7 Mb/s while the official Plex app on the
 * same box played the same file directly without a stall. Download managers
 * beat a slow single flow by reading a file in parallel pieces; this source
 * does the same for the player: the next `connections` pieces of `chunkBytes`
 * each are in flight at once, each on its own keep-alive connection, and the
 * extractor reads them back in order, as one stream, exactly as it would from
 * the single connection. Memory in flight is bounded by connections × chunk
 * (6 MiB on a 2 GB box, 8 MiB elsewhere: see buildPlayer).
 *
 * The first piece of every open is small (FIRST_CHUNK_BYTES) so the first
 * bytes arrive after one round trip, as before; a seek closes everything in
 * flight and opens afresh at the new place, as before. A server that ignores
 * the Range header (200 instead of 206) is read as one stream from the first
 * response, which is what the single connection did. Errors are reported the
 * way the library's own source reports them (InvalidResponseCodeException for
 * an error status, HttpDataSourceException otherwise), so SnowPlayerPlugin's
 * restart and HTTP-status handling stay the same. Never logs: the address
 * carries the token.
 */
class RangeFetchDataSource(
    private val userAgent: String?,
    private val connectTimeoutMs: Int,
    private val readTimeoutMs: Int,
    private val connections: Int,
    private val chunkBytes: Int,
) : BaseDataSource(/* isNetwork = */ true) {

    /** Builds sources with one shared transfer listener (the byte meter). */
    class Factory(
        private val userAgent: String?,
        private val connectTimeoutMs: Int,
        private val readTimeoutMs: Int,
        private val connections: Int,
        private val chunkBytes: Int,
    ) : DataSource.Factory {
        private var listener: TransferListener? = null

        fun setTransferListener(l: TransferListener?): Factory {
            listener = l
            return this
        }

        override fun createDataSource(): DataSource {
            val ds = RangeFetchDataSource(userAgent, connectTimeoutMs, readTimeoutMs, connections.coerceAtLeast(1), chunkBytes.coerceAtLeast(64 * 1024))
            listener?.let { ds.addTransferListener(it) }
            return ds
        }
    }

    /** One piece of the file, filled by a worker thread. */
    private class Chunk(val start: Long, val length: Int) {
        val data = ByteArray(length)
        /** Bytes in `data` so far; only ever grows. */
        @Volatile var filled = 0
        /** The worker has finished with it, with or without all its bytes. */
        @Volatile var done = false
        /** The file ended inside (or before) this piece. */
        @Volatile var eof = false
        @Volatile var error: IOException? = null
        @Volatile var cancelled = false
        @Volatile var connection: HttpURLConnection? = null
    }

    private val lock = java.lang.Object()
    private var dataSpec: DataSpec? = null
    private var opened = false
    /** The server ignored the range: one stream, read on the caller's thread. */
    private var plain: InputStream? = null
    private var plainConnection: HttpURLConnection? = null
    /** In order; [0] is the piece being read. Guarded by `lock`. */
    private val chunks = ArrayList<Chunk>()
    private var readInChunk = 0
    private var nextStart = 0L
    /** Where to stop fetching (exclusive); C.LENGTH_UNSET when the end is not known. */
    private var end = UNSET
    private var bytesRemaining = UNSET
    private var responseHeaders: Map<String, List<String>> = emptyMap()

    override fun getUri(): Uri? = dataSpec?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = responseHeaders

    @Throws(HttpDataSource.HttpDataSourceException::class)
    override fun open(dataSpec: DataSpec): Long {
        close()
        this.dataSpec = dataSpec
        if (dataSpec.httpMethod != DataSpec.HTTP_METHOD_GET) {
            throw HttpDataSource.HttpDataSourceException(
                "Only GET is supported", dataSpec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_OPEN,
            )
        }
        transferInitializing(dataSpec)
        val position = dataSpec.position
        val wanted = dataSpec.length
        val firstLen = firstChunkLength(wanted, chunkBytes)
        val conn: HttpURLConnection
        val code: Int
        try {
            conn = connect(dataSpec, position, position + firstLen - 1)
            code = conn.responseCode
        } catch (e: IOException) {
            throw HttpDataSource.HttpDataSourceException.createForIOException(e, dataSpec, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
        }
        responseHeaders = headersOf(conn)
        if (code < 200 || code > 299) {
            val body = errorBody(conn)
            val size = if (code == 416) documentSize(conn.getHeaderField("Content-Range")) else UNSET
            conn.disconnect()
            if (code == 416 && size != UNSET && position == size) {
                // Asked for the byte right after the end: nothing to read, as
                // the library's own source treats it.
                opened = true
                bytesRemaining = 0L
                transferStarted(dataSpec)
                return 0L
            }
            throw HttpDataSource.InvalidResponseCodeException(code, conn.responseMessage, null, responseHeaders, dataSpec, body)
        }
        if (code != 206) {
            // The whole file from its start, whatever the range asked for.
            if (position > 0) {
                conn.disconnect()
                throw HttpDataSource.HttpDataSourceException(
                    "Server ignored the range request", dataSpec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_OPEN,
                )
            }
            val total = contentLength(conn)
            plain = try { conn.inputStream } catch (e: IOException) {
                conn.disconnect()
                throw HttpDataSource.HttpDataSourceException.createForIOException(e, dataSpec, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
            }
            plainConnection = conn
            bytesRemaining = if (wanted != UNSET) wanted else total
            opened = true
            transferStarted(dataSpec)
            return bytesRemaining
        }
        val total = documentSize(conn.getHeaderField("Content-Range"))
        end = when {
            wanted != UNSET -> position + wanted
            total != UNSET -> total
            else -> UNSET
        }
        bytesRemaining = if (end != UNSET) (end - position).coerceAtLeast(0L) else UNSET
        val first = Chunk(position, clip(position, firstLen))
        nextStart = position + first.length
        synchronized(lock) {
            chunks.add(first)
            POOL.execute { fetch(first, conn) }
            scheduleAhead()
        }
        opened = true
        transferStarted(dataSpec)
        return bytesRemaining
    }

    @Throws(HttpDataSource.HttpDataSourceException::class)
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (bytesRemaining == 0L) return C.RESULT_END_OF_INPUT
        val spec = dataSpec ?: throw HttpDataSource.HttpDataSourceException(
            "Not open", DataSpec(Uri.EMPTY), PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
        )
        val want = if (bytesRemaining != UNSET) minOf(length.toLong(), bytesRemaining).toInt() else length
        val n = plain?.let { readPlain(it, buffer, offset, want, spec) } ?: readChunks(buffer, offset, want, spec)
        if (n > 0) {
            if (bytesRemaining != UNSET) bytesRemaining -= n
            bytesTransferred(n)
        }
        return n
    }

    override fun close() {
        val wasOpened = opened
        opened = false
        synchronized(lock) {
            for (c in chunks) {
                c.cancelled = true
                try { c.connection?.disconnect() } catch (_: Throwable) { /* already gone */ }
            }
            chunks.clear()
            readInChunk = 0
            lock.notifyAll()
        }
        plain?.let { try { it.close() } catch (_: IOException) { /* closing */ } }
        plain = null
        plainConnection?.let { try { it.disconnect() } catch (_: Throwable) { /* closing */ } }
        plainConnection = null
        bytesRemaining = UNSET
        end = UNSET
        nextStart = 0L
        if (wasOpened) transferEnded()
    }

    // ── pieces ──────────────────────────────────────────────────────────────

    /** How much of the file is left to ask for from `start`, at most `len`. */
    private fun clip(start: Long, len: Int): Int =
        if (end == UNSET) len else minOf(len.toLong(), (end - start).coerceAtLeast(0L)).toInt()

    /** Keeps `connections` pieces in flight (the one being read included). Call with `lock` held. */
    private fun scheduleAhead() {
        while (chunks.size < connections && (end == UNSET || nextStart < end)) {
            val c = Chunk(nextStart, clip(nextStart, chunkBytes))
            if (c.length <= 0) break
            nextStart += c.length
            chunks.add(c)
            POOL.execute { fetch(c, null) }
        }
    }

    /** The piece being read is used up: drop it and ask for the next one. Call with `lock` held. */
    private fun advance() {
        if (chunks.isNotEmpty()) chunks.removeAt(0)
        readInChunk = 0
        scheduleAhead()
    }

    @Throws(HttpDataSource.HttpDataSourceException::class)
    private fun readChunks(buffer: ByteArray, offset: Int, want: Int, spec: DataSpec): Int {
        val deadline = SystemClock.elapsedRealtime() + readTimeoutMs
        synchronized(lock) {
            while (true) {
                val c = chunks.firstOrNull() ?: return C.RESULT_END_OF_INPUT
                val avail = c.filled - readInChunk
                if (avail > 0) {
                    val n = minOf(avail, want)
                    System.arraycopy(c.data, readInChunk, buffer, offset, n)
                    readInChunk += n
                    if (readInChunk >= c.length) advance()
                    return n
                }
                c.error?.let { throw it as? HttpDataSource.HttpDataSourceException
                    ?: HttpDataSource.HttpDataSourceException(it, spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ) }
                if (c.eof) return C.RESULT_END_OF_INPUT
                if (c.done) {
                    if (c.filled >= c.length) { advance(); continue }
                    throw HttpDataSource.HttpDataSourceException(
                        "The range ended early", spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
                    )
                }
                val left = deadline - SystemClock.elapsedRealtime()
                if (left <= 0L) {
                    throw HttpDataSource.HttpDataSourceException(
                        SocketTimeoutException("No data in $readTimeoutMs ms"), spec,
                        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, HttpDataSource.HttpDataSourceException.TYPE_READ,
                    )
                }
                try {
                    lock.wait(minOf(left, 500L))
                } catch (e: InterruptedException) {
                    // The loader was cancelled (a seek, a stop): end this read.
                    Thread.currentThread().interrupt()
                    throw HttpDataSource.HttpDataSourceException(
                        InterruptedIOException(), spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
                    )
                }
            }
        }
    }

    @Throws(HttpDataSource.HttpDataSourceException::class)
    private fun readPlain(input: InputStream, buffer: ByteArray, offset: Int, want: Int, spec: DataSpec): Int {
        val n = try {
            input.read(buffer, offset, want)
        } catch (e: IOException) {
            throw HttpDataSource.HttpDataSourceException.createForIOException(e, spec, HttpDataSource.HttpDataSourceException.TYPE_READ)
        }
        return if (n < 0) C.RESULT_END_OF_INPUT else n
    }

    /** A worker: fills `c` from its own connection (`pre` when open() already made it). */
    private fun fetch(c: Chunk, pre: HttpURLConnection?) {
        val spec = dataSpec
        var conn: HttpURLConnection? = pre
        var finished = false
        try {
            if (c.cancelled || spec == null) return
            if (conn == null) {
                conn = connect(spec, c.start, c.start + c.length - 1)
                c.connection = conn
                if (c.cancelled) return
                val code = conn.responseCode
                if (code == 416) {
                    // Nothing there: the file ends before this piece.
                    c.eof = true
                    finished = true
                    return
                }
                if (code != 206) {
                    c.error = if (code in 200..299) {
                        HttpDataSource.HttpDataSourceException(
                            "Server ignored the range request", spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
                        )
                    } else {
                        HttpDataSource.InvalidResponseCodeException(code, conn.responseMessage, null, headersOf(conn), spec, errorBody(conn))
                    }
                    return
                }
            } else {
                c.connection = conn
            }
            val input = conn.inputStream
            while (c.filled < c.length && !c.cancelled) {
                val n = input.read(c.data, c.filled, c.length - c.filled)
                if (n < 0) {
                    c.eof = true
                    break
                }
                if (n > 0) {
                    c.filled += n
                    synchronized(lock) { lock.notifyAll() }
                }
            }
            if (!c.cancelled) {
                // Read to the end and closed: the connection goes back to the
                // pool for the next piece (a disconnect would close it).
                try { input.close() } catch (_: IOException) { /* done with it */ }
                finished = true
            }
        } catch (e: IOException) {
            if (!c.cancelled) c.error = HttpDataSource.HttpDataSourceException.createForIOException(e, spec ?: DataSpec(Uri.EMPTY), HttpDataSource.HttpDataSourceException.TYPE_READ)
        } catch (e: RuntimeException) {
            if (!c.cancelled) c.error = HttpDataSource.HttpDataSourceException(
                IOException(e), spec ?: DataSpec(Uri.EMPTY), PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
            )
        } finally {
            if (!finished) {
                try { conn?.disconnect() } catch (_: Throwable) { /* already gone */ }
            }
            c.connection = null
            c.done = true
            synchronized(lock) { lock.notifyAll() }
        }
    }

    @Throws(IOException::class)
    private fun connect(spec: DataSpec, from: Long, to: Long): HttpURLConnection {
        val conn = URL(spec.uri.toString()).openConnection() as HttpURLConnection
        conn.connectTimeout = connectTimeoutMs
        conn.readTimeout = readTimeoutMs
        conn.instanceFollowRedirects = true
        for ((k, v) in spec.httpRequestHeaders) conn.setRequestProperty(k, v)
        userAgent?.let { conn.setRequestProperty("User-Agent", it) }
        conn.setRequestProperty("Accept-Encoding", "identity")
        conn.setRequestProperty("Range", "bytes=$from-$to")
        conn.requestMethod = "GET"
        conn.doOutput = false
        conn.connect()
        return conn
    }

    companion object {
        private val UNSET: Long = C.LENGTH_UNSET.toLong()
        /** The first piece of an open: small, so the first bytes come after one round trip. */
        const val FIRST_CHUNK_BYTES = 512 * 1024
        private val threadNo = AtomicInteger(0)
        private val POOL: ExecutorService = Executors.newCachedThreadPool { r ->
            Thread(r, "SnowPlayer:RangeFetch-${threadNo.incrementAndGet()}").apply { isDaemon = true }
        }

        /** How big the first piece of an open is: FIRST_CHUNK_BYTES, never
         *  more than a piece, nor than what the open asks for. */
        fun firstChunkLength(wanted: Long, chunkBytes: Int): Int {
            var n = minOf(FIRST_CHUNK_BYTES, chunkBytes)
            if (wanted != UNSET && wanted < n) n = wanted.toInt()
            return n.coerceAtLeast(1)
        }

        /** The file's size from a Content-Range header ("bytes 0-1023/5000",
         *  "bytes * /5000"), or C.LENGTH_UNSET. */
        fun documentSize(contentRange: String?): Long {
            if (contentRange == null) return UNSET
            val slash = contentRange.lastIndexOf('/')
            if (slash < 0) return UNSET
            val total = contentRange.substring(slash + 1).trim()
            return total.toLongOrNull()?.takeIf { it >= 0L } ?: UNSET
        }

        private fun contentLength(conn: HttpURLConnection): Long {
            val h = conn.getHeaderField("Content-Length") ?: return UNSET
            return h.trim().toLongOrNull()?.takeIf { it >= 0L } ?: UNSET
        }

        /** The response headers, without the status line's null key. */
        private fun headersOf(conn: HttpURLConnection): Map<String, List<String>> {
            val out = LinkedHashMap<String, List<String>>()
            val fields = try { conn.headerFields } catch (_: Throwable) { null } ?: return out
            for ((k, v) in fields) if (k != null && v != null) out[k] = v
            return out
        }

        private fun errorBody(conn: HttpURLConnection): ByteArray =
            try { conn.errorStream?.use { it.readBytes() } ?: ByteArray(0) } catch (_: Throwable) { ByteArray(0) }
    }
}
