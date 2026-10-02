package com.snowmedia.player

import android.net.Uri
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * A Plex file played as it is from a remote server, fetched over several HTTP
 * range requests at once (bugs/plex-buffering-remote.md, docs/plex-audit-2026-10.md
 * section A).
 *
 * Media3's own HTTP source reads a file through ONE connection, opened once
 * with "Range: bytes=N-" and read until the end; one TCP flow to a far server
 * is held back by that path's round trip and losses. This source reads the
 * file as a WORK-CONSERVING WINDOW of pieces: up to `connections` requests
 * are in flight at once, each on its own keep-alive connection, and whenever
 * one finishes its worker takes the next unfetched piece straight away, as
 * long as the bytes unread plus in flight stay under `windowBytes`. A slow
 * piece never idles the others, and a connection never sits idle long enough
 * to fall back into TCP slow start while there is room in the window. The
 * extractor reads the pieces back in order, as one stream, exactly as it
 * would from the single connection.
 *
 * Memory is a fixed pool of slabs (Shared.pool) sized to the window; a piece
 * is a run of slabs, and each slab goes back to the pool as soon as the
 * reader has consumed it. Pieces start at 2 MiB and grow to 8 MiB (4 MiB
 * where the window is 16 MiB) while reads stay sequential.
 *
 * Every open ramps up: it starts with ONE piece of `rampBytes` (1 MiB) and
 * fans out only once the reader has consumed all of it, so the extractor's
 * small opens (an MKV header, its Cues, a resume or a seek that reads a few
 * KB and jumps) cost one request each, as with plain Media3. On close, a
 * piece with DRAIN_BYTES or less left is allowed to finish so its connection
 * goes back to the pool instead of being cut.
 *
 * Robustness: a piece that fails (an error status, a reset, a short 206)
 * is re-queued from where it stopped, MAX_TRIES times with a backoff; a
 * refusal (4xx/5xx, connection refused) of any piece but the open's first
 * lowers the connection cap for the rest of the load (Shared.connectionCap,
 * down to 1); a piece with no progress for `stallMs` while a connection is
 * free is re-requested from where it stopped; one redirect is resolved per
 * open and every piece uses the resolved address; a 416 carries the
 * out-of-range cause Media3 treats as final; a 200 at an offset skips
 * forward as Media3 does. Errors are reported the way the library's own
 * source reports them (InvalidResponseCodeException for an error status,
 * HttpDataSourceException otherwise) so SnowPlayerPlugin's restart and
 * HTTP-status handling stay the same.
 *
 * Bytes are counted twice, for two readers: `Shared.arrival` is added to on
 * the worker threads as the bytes ARRIVE from the network (the plugin's byte
 * meter and every speed rule built on it), and bytesTransferred() is still
 * called in read() for Media3's own bandwidth meter. Never logs: the address
 * carries the token.
 */
class RangeFetchDataSource(
    private val userAgent: String?,
    private val connectTimeoutMs: Int,
    private val readTimeoutMs: Int,
    private val shared: Shared,
) : BaseDataSource(/* isNetwork = */ true) {

    /**
     * What every source of one player shares: the slab pool (so memory stays
     * at the window whatever Media3 opens), the live connection count for
     * the stats, the connection cap lowered by refusals (reset per load by
     * newLoad()), and the arrival counter. The sizes are parameters so tests
     * can use small ones; the plugin uses the defaults.
     */
    class Shared(
        val connections: Int = DEFAULT_CONNECTIONS,
        val windowBytes: Int = DEFAULT_WINDOW_BYTES,
        val arrival: AtomicLong? = null,
        val slabBytes: Int = DEFAULT_SLAB_BYTES,
        val rampBytes: Int = DEFAULT_RAMP_BYTES,
        val minPieceBytes: Int = DEFAULT_MIN_PIECE_BYTES,
        val maxPieceBytes: Int = DEFAULT_MAX_PIECE_BYTES,
        val stallMs: Long = DEFAULT_STALL_MS,
    ) {
        /** Connections open right now, across every source built from this. */
        val liveConnections = AtomicInteger(0)
        /** How many pieces may be in flight: `connections`, lowered by a
         *  refusal, back to `connections` at the next load. */
        @Volatile var connectionCap: Int = connections.coerceAtLeast(1)
            private set
        internal val windowSlabs: Int = (windowBytes / slabBytes).coerceAtLeast(1)
        /** A piece never takes more than its share of the window, so all
         *  `connections` can be busy at once. */
        internal val maxPieceSlabs: Int =
            (minOf(maxPieceBytes.toLong(), windowBytes.toLong() / connections.coerceAtLeast(1)) / slabBytes).toInt().coerceAtLeast(1)
        internal val pool = SlabPool(windowSlabs, slabBytes)

        fun newLoad() { connectionCap = connections.coerceAtLeast(1) }

        internal fun lowerCap() { connectionCap = (connectionCap - 1).coerceAtLeast(1) }
    }

    /** Builds sources over one Shared. */
    class Factory(
        private val userAgent: String?,
        private val connectTimeoutMs: Int,
        private val readTimeoutMs: Int,
        private val shared: Shared,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = RangeFetchDataSource(userAgent, connectTimeoutMs, readTimeoutMs, shared)
    }

    /** Fixed-size byte arrays, at most `cap` kept; more may be handed out
     *  for a moment (a source closing while the next opens) and are dropped
     *  when they come back. */
    internal class SlabPool(private val cap: Int, private val slabBytes: Int) {
        private val free = ArrayList<ByteArray>()
        @Synchronized fun take(): ByteArray = if (free.isEmpty()) ByteArray(slabBytes) else free.removeAt(free.size - 1)
        @Synchronized fun give(b: ByteArray) { if (free.size < cap) free.add(b) }
        @Synchronized fun pooled(): Int = free.size
    }

    /** One open: its spec, the address every piece of it asks, and where it stops. */
    private class Open(val spec: DataSpec, val url: URL, val end: Long)

    private enum class State { QUEUED, STARTING, FETCHING, DONE, FAILED }

    /** One piece of the file. The counters are guarded by `lock` unless marked volatile. */
    private class Piece(val open: Open, val start: Long, val length: Int, val first: Boolean, slabCount: Int) {
        val slabs = arrayOfNulls<ByteArray>(slabCount)
        /** Bytes received so far; only ever grows. Written by the worker, read by the reader. */
        @Volatile var filled = 0
        @Volatile var state = State.QUEUED
        /** The file ended inside (or before) this piece. */
        @Volatile var eof = false
        var error: IOException? = null
        /** Tries made (a stall re-request counts). */
        var attempts = 0
        /** The attempt a worker must hold to act on this piece; bumped by a re-request. */
        var attempt = 0
        /** Worker tasks queued or running for it. */
        var workers = 0
        var notBefore = 0L
        var released = false
        @Volatile var cancelled = false
        /** Cancelled, but allowed to finish (DRAIN_BYTES or less left). */
        @Volatile var drain = false
        @Volatile var connection: HttpURLConnection? = null
        @Volatile var lastProgressAt = 0L
        val remaining: Int get() = length - filled
    }

    private val lock = java.lang.Object()
    private var dataSpec: DataSpec? = null
    private var open: Open? = null
    private var opened = false
    /** The server ignored the range: one stream, read on the caller's thread. */
    private var plain: InputStream? = null
    private var plainConnection: HttpURLConnection? = null
    /** In file order; [0] is the piece being read. Guarded by `lock`. */
    private val pieces = ArrayList<Piece>()
    /** pieces[0], for the workers (the reader is woken only for its progress). */
    @Volatile private var head: Piece? = null
    private var readInPiece = 0
    private var readSinceOpen = 0L
    private var rampedUp = false
    private var scheduledAfterRamp = 0
    private var heldSlabs = 0
    private var nextStart = 0L
    private var bytesRemaining = UNSET
    private var responseHeaders: Map<String, List<String>> = emptyMap()
    private var resolvedUri: Uri? = null

    override fun getUri(): Uri? = resolvedUri ?: dataSpec?.uri

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
        val firstLen = firstPieceLength(wanted, shared.rampBytes)
        var conn: HttpURLConnection? = null
        try {
            var url = URL(dataSpec.uri.toString())
            var redirected = false
            var code: Int
            while (true) {
                val c = connect(url, dataSpec, position, position + firstLen - 1)
                conn = c
                code = c.responseCode
                if (code !in REDIRECTS) break
                // One redirect per open (any protocol); every piece then
                // asks the address it led to.
                val location = c.getHeaderField("Location")
                c.disconnect()
                conn = null
                if (redirected || location.isNullOrBlank()) {
                    throw HttpDataSource.HttpDataSourceException(
                        if (redirected) "Too many redirects" else "Redirect without a location",
                        dataSpec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_OPEN,
                    )
                }
                url = URL(url, location)
                redirected = true
            }
            val c = conn!!
            responseHeaders = headersOf(c)
            resolvedUri = if (redirected) Uri.parse(url.toString()) else dataSpec.uri
            if (code < 200 || code > 299) {
                val body = errorBody(c)
                val size = if (code == 416) documentSize(c.getHeaderField("Content-Range")) else UNSET
                val message = c.responseMessage
                c.disconnect()
                conn = null
                if (code == 416 && size != UNSET && position == size) {
                    // Asked for the byte right after the end: nothing to
                    // read, as the library's own source treats it.
                    opened = true
                    bytesRemaining = 0L
                    transferStarted(dataSpec)
                    return 0L
                }
                // A 416 is final for Media3 only with this cause; without it
                // the player retries a seek past the end for 15 s.
                val cause = if (code == 416) DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE) else null
                throw HttpDataSource.InvalidResponseCodeException(code, message, cause, responseHeaders, dataSpec, body)
            }
            if (code != 206) {
                // The whole file from its start, whatever the range asked
                // for: one stream, skipped forward to `position` as the
                // library's own source does.
                val total = contentLength(c)
                val input = c.inputStream
                plain = input
                plainConnection = c
                conn = null
                shared.liveConnections.incrementAndGet()
                bytesRemaining = if (wanted != UNSET) wanted else if (total != UNSET) (total - position).coerceAtLeast(0L) else UNSET
                opened = true
                transferStarted(dataSpec)
                try {
                    skipFully(input, position)
                } catch (e: HttpDataSource.HttpDataSourceException) {
                    close()
                    throw e
                } catch (e: IOException) {
                    close()
                    throw HttpDataSource.HttpDataSourceException.createForIOException(e, dataSpec, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
                }
                return bytesRemaining
            }
            val range = c.getHeaderField("Content-Range")
            val rangeStart = rangeStart(range)
            if (rangeStart != UNSET && rangeStart != position) {
                c.disconnect()
                conn = null
                throw HttpDataSource.HttpDataSourceException(
                    "Content-Range starts at the wrong byte", dataSpec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_OPEN,
                )
            }
            val total = documentSize(range)
            val end = when {
                wanted != UNSET -> position + wanted
                total != UNSET -> total
                else -> UNSET
            }
            bytesRemaining = if (end != UNSET) (end - position).coerceAtLeast(0L) else UNSET
            val o = Open(dataSpec, url, end)
            synchronized(lock) {
                open = o
                nextStart = position
                val first = newPiece(o, clip(end, position, firstLen), first = true)
                first.workers = 1
                first.attempt = 1
                first.attempts = 1
                first.state = State.STARTING
                pieces.add(first)
                head = first
                opened = true
                conn = null
                POOL.execute { fetch(first, 1, c) }
            }
            transferStarted(dataSpec)
            return bytesRemaining
        } catch (e: HttpDataSource.HttpDataSourceException) {
            try { conn?.disconnect() } catch (_: Throwable) { /* already gone */ }
            throw e
        } catch (e: IOException) {
            try { conn?.disconnect() } catch (_: Throwable) { /* already gone */ }
            throw HttpDataSource.HttpDataSourceException.createForIOException(e, dataSpec, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
        }
    }

    @Throws(HttpDataSource.HttpDataSourceException::class)
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (bytesRemaining == 0L) return C.RESULT_END_OF_INPUT
        val spec = dataSpec ?: throw HttpDataSource.HttpDataSourceException(
            "Not open", DataSpec(Uri.EMPTY), PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
        )
        val want = if (bytesRemaining != UNSET) minOf(length.toLong(), bytesRemaining).toInt() else length
        val n = plain?.let { readPlain(it, buffer, offset, want, spec) } ?: readPieces(buffer, offset, want, spec)
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
            for (c in pieces) {
                c.cancelled = true
                if (c.state == State.FETCHING) {
                    // Nearly done: let it finish so its connection stays
                    // pooled; a cut connection is never reused.
                    if (c.remaining <= DRAIN_BYTES) c.drain = true else cut(c.connection)
                }
                if (c.workers == 0) release(c)
            }
            pieces.clear()
            head = null
            readInPiece = 0
            readSinceOpen = 0L
            rampedUp = false
            scheduledAfterRamp = 0
            nextStart = 0L
            open = null
            lock.notifyAll()
        }
        plain?.let {
            try { it.close() } catch (_: IOException) { /* closing */ }
            shared.liveConnections.decrementAndGet()
        }
        plain = null
        plainConnection?.let { try { it.disconnect() } catch (_: Throwable) { /* closing */ } }
        plainConnection = null
        bytesRemaining = UNSET
        resolvedUri = null
        if (wasOpened) transferEnded()
    }

    // ── the window (all with `lock` held) ───────────────────────────────────

    private fun newPiece(o: Open, length: Int, first: Boolean): Piece {
        val slabCount = (length + shared.slabBytes - 1) / shared.slabBytes
        val p = Piece(o, nextStart, length, first, slabCount)
        for (i in 0 until slabCount) p.slabs[i] = shared.pool.take()
        heldSlabs += slabCount
        nextStart += length
        return p
    }

    /** Gives back every slab of `c` the reader has not already given back. */
    private fun release(c: Piece) {
        if (c.released) return
        c.released = true
        for (i in c.slabs.indices) releaseSlab(c, i)
    }

    private fun releaseSlab(c: Piece, i: Int) {
        val b = c.slabs[i] ?: return
        c.slabs[i] = null
        heldSlabs--
        shared.pool.give(b)
    }

    /** The piece being read is used up: drop it and move to the next. */
    private fun advance() {
        if (pieces.isNotEmpty()) release(pieces.removeAt(0))
        readInPiece = 0
        head = pieces.firstOrNull()
    }

    private fun inFlight(): Int = pieces.count { it.state == State.STARTING || it.state == State.FETCHING }

    private fun cap(): Int = if (rampedUp) minOf(shared.connections, shared.connectionCap) else 1

    /** The size of the next new piece: 2 MiB, doubling every `connections`
     *  pieces of this open, up to the piece's share of the window. */
    private fun nextPieceSlabs(): Int {
        val minSlabs = (shared.minPieceBytes / shared.slabBytes).coerceAtLeast(1)
        val grown = minSlabs.toLong() shl minOf(20, scheduledAfterRamp / shared.connections.coerceAtLeast(1))
        return minOf(grown, shared.maxPieceSlabs.toLong()).toInt()
    }

    /** Keeps the window full: re-queued pieces first, then (once the open
     *  has ramped up) new ones, while there is a free connection and room
     *  for their slabs. */
    private fun schedule() {
        val o = open ?: return
        if (!opened) return
        var flying = inFlight()
        val cap = cap()
        val now = SystemClock.elapsedRealtime()
        for (c in pieces) {
            if (flying >= cap) return
            // A superseded worker may still be on its way out (`workers`);
            // the piece does not wait for it.
            if (c.state != State.QUEUED || now < c.notBefore) continue
            start(c)
            flying++
        }
        if (!rampedUp) return
        while (flying < cap && (o.end == UNSET || nextStart < o.end)) {
            val free = shared.windowSlabs - heldSlabs
            var slabs = nextPieceSlabs()
            if (slabs > free) {
                // No room for a whole piece: a smaller one keeps the reader
                // fed only when nothing else is on the way.
                if (free <= 0 || flying > 0) return
                slabs = free
            }
            val length = clip(o.end, nextStart, (slabs.toLong() * shared.slabBytes).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
            if (length <= 0) return
            val c = newPiece(o, length, first = false)
            scheduledAfterRamp++
            pieces.add(c)
            if (head == null) head = c
            start(c)
            flying++
        }
    }

    private fun start(c: Piece) {
        c.workers++
        c.attempt++
        c.attempts++
        c.state = State.STARTING
        c.lastProgressAt = SystemClock.elapsedRealtime()
        val attempt = c.attempt
        POOL.execute { fetch(c, attempt, null) }
    }

    /** A piece with no progress for `stallMs` while a connection is free is
     *  asked for again from where it stopped (the reader, while it waits).
     *  The old worker's attempt is over: whatever its read still returns is
     *  dropped, and its connection is cut. */
    private fun reRequestStalled(now: Long) {
        if (inFlight() >= cap()) return
        for (c in pieces) {
            if (c.state != State.FETCHING || now - c.lastProgressAt < shared.stallMs || c.attempts >= MAX_TRIES) continue
            // Ends the old attempt now (start() hands out the next number);
            // whatever its read still returns is dropped.
            c.attempt++
            c.state = State.QUEUED
            c.notBefore = 0L
            c.lastProgressAt = now
            cut(c.connection)
            return
        }
    }

    /** Cuts a connection another thread is reading from, off this thread:
     *  Android's disconnect() only cancels, but a stack whose disconnect()
     *  waits for the blocked read to end must never hold up the reader. */
    private fun cut(conn: HttpURLConnection?) {
        if (conn == null) return
        CUTTER.execute { try { conn.disconnect() } catch (_: Throwable) { /* already gone */ } }
    }

    /** A worker task is over: a cancelled piece's slabs go back after its last one. */
    private fun workerDone(c: Piece) {
        c.workers--
        if (c.workers == 0 && c.cancelled) release(c)
    }

    /** The attempt failed: again from start+filled after a backoff, or FAILED. */
    private fun retryOrFail(c: Piece, attempt: Int, e: IOException, refusal: Boolean) {
        if (attempt != c.attempt || c.cancelled) return
        if (refusal && !c.first) shared.lowerCap()
        if (c.attempts < MAX_TRIES) {
            c.state = State.QUEUED
            c.notBefore = SystemClock.elapsedRealtime() + (RETRY_BACKOFF_MS shl (c.attempts - 1))
        } else {
            c.state = State.FAILED
            c.error = e
        }
    }

    // ── reading ─────────────────────────────────────────────────────────────

    @Throws(HttpDataSource.HttpDataSourceException::class)
    private fun readPieces(buffer: ByteArray, offset: Int, want: Int, spec: DataSpec): Int {
        val deadline = SystemClock.elapsedRealtime() + readTimeoutMs
        synchronized(lock) {
            while (true) {
                val c = pieces.firstOrNull() ?: return C.RESULT_END_OF_INPUT
                val avail = c.filled - readInPiece
                if (avail > 0) {
                    val slab = readInPiece / shared.slabBytes
                    val off = readInPiece % shared.slabBytes
                    val n = minOf(avail, want, shared.slabBytes - off)
                    System.arraycopy(c.slabs[slab]!!, off, buffer, offset, n)
                    readInPiece += n
                    readSinceOpen += n
                    if (readInPiece / shared.slabBytes > slab) releaseSlab(c, slab)
                    if (readInPiece >= c.length) advance()
                    if (!rampedUp && readSinceOpen >= shared.rampBytes) rampedUp = true
                    schedule()
                    return n
                }
                if (c.state == State.FAILED) {
                    val e = c.error!!
                    throw e as? HttpDataSource.HttpDataSourceException
                        ?: HttpDataSource.HttpDataSourceException(e, spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ)
                }
                if (c.eof) return C.RESULT_END_OF_INPUT
                if (c.state == State.DONE) { advance(); continue }
                val now = SystemClock.elapsedRealtime()
                reRequestStalled(now)
                schedule()
                val left = deadline - now
                if (left <= 0L) {
                    throw HttpDataSource.HttpDataSourceException(
                        SocketTimeoutException("No data in $readTimeoutMs ms"), spec,
                        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, HttpDataSource.HttpDataSourceException.TYPE_READ,
                    )
                }
                try {
                    lock.wait(minOf(left, WAIT_SLICE_MS))
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
        if (n > 0) shared.arrival?.addAndGet(n.toLong())
        return if (n < 0) C.RESULT_END_OF_INPUT else n
    }

    /** A 200 to a ranged request: the stream starts at 0, so `position`
     *  bytes are read and dropped first, as the library's own source does. */
    @Throws(IOException::class)
    private fun skipFully(input: InputStream, position: Long) {
        if (position <= 0L) return
        val scratch = ByteArray(64 * 1024)
        var left = position
        while (left > 0L) {
            val n = input.read(scratch, 0, minOf(left, scratch.size.toLong()).toInt())
            if (n < 0) {
                throw HttpDataSource.HttpDataSourceException(
                    dataSpec ?: DataSpec(Uri.EMPTY), PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE, HttpDataSource.HttpDataSourceException.TYPE_OPEN,
                )
            }
            shared.arrival?.addAndGet(n.toLong())
            left -= n
        }
    }

    // ── workers ─────────────────────────────────────────────────────────────

    /** One attempt at `c` from start+filled, on its own connection (`pre`
     *  when open() already made it). Never touches a slab unless it holds
     *  the piece's current attempt. */
    private fun fetch(c: Piece, attempt: Int, pre: HttpURLConnection?) {
        synchronized(lock) {
            if (c.cancelled || attempt != c.attempt) {
                try { pre?.disconnect() } catch (_: Throwable) { /* already gone */ }
                workerDone(c)
                return
            }
            c.state = State.FETCHING
            c.lastProgressAt = SystemClock.elapsedRealtime()
        }
        val spec = c.open.spec
        var conn: HttpURLConnection? = pre
        var counted = false
        var keepAlive = false
        var failure: IOException? = null
        var refusal = false
        try {
            if (conn == null) {
                val from = c.start + c.filled
                conn = connect(c.open.url, spec, from, c.start + c.length - 1)
                c.connection = conn
                shared.liveConnections.incrementAndGet()
                counted = true
                if (c.cancelled && !c.drain) return
                val code = conn.responseCode
                when {
                    code == 416 -> {
                        // Nothing there: the file ends before this piece.
                        errorBody(conn)
                        keepAlive = true
                        c.eof = true
                        synchronized(lock) { if (attempt == c.attempt) c.state = State.DONE }
                        return
                    }
                    code == 206 -> {
                        val rangeStart = rangeStart(conn.getHeaderField("Content-Range"))
                        if (rangeStart != UNSET && rangeStart != from) {
                            throw IOException("Content-Range starts at the wrong byte")
                        }
                    }
                    code in 200..299 -> {
                        refusal = true
                        throw HttpDataSource.HttpDataSourceException(
                            "Server ignored the range request", spec, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, HttpDataSource.HttpDataSourceException.TYPE_READ,
                        )
                    }
                    else -> {
                        refusal = true
                        throw HttpDataSource.InvalidResponseCodeException(code, conn.responseMessage, null, headersOf(conn), spec, errorBody(conn))
                    }
                }
            } else {
                c.connection = conn
                shared.liveConnections.incrementAndGet()
                counted = true
            }
            val input = conn.inputStream
            // Read into this thread's own scratch and copied into the slabs
            // under the lock, so a worker whose attempt was superseded (a
            // stall re-request) can never write over the one that took over.
            val scratch = SCRATCH.get()!!
            while (true) {
                val filled = c.filled
                if (filled >= c.length) break
                if (c.cancelled && !c.drain) return
                val n = input.read(scratch, 0, minOf(c.length - filled, scratch.size))
                if (n < 0) {
                    // The stream ended early. The end of the file, when it
                    // is not known or is right here; otherwise the server
                    // cut the range short and the rest is asked for again.
                    if (c.open.end == UNSET || c.start + filled >= c.open.end) {
                        c.eof = true
                        break
                    }
                    throw IOException("The range ended early")
                }
                if (n > 0) {
                    synchronized(lock) {
                        if (attempt != c.attempt) return
                        val at = c.filled
                        val take = minOf(n, c.length - at)
                        var copied = 0
                        while (copied < take) {
                            val slab = (at + copied) / shared.slabBytes
                            val off = (at + copied) % shared.slabBytes
                            val m = minOf(take - copied, shared.slabBytes - off)
                            System.arraycopy(scratch, copied, c.slabs[slab] ?: return, off, m)
                            copied += m
                        }
                        c.filled = at + take
                        c.lastProgressAt = SystemClock.elapsedRealtime()
                        if (head === c) lock.notifyAll()
                    }
                    shared.arrival?.addAndGet(n.toLong())
                }
            }
            // Read to the end and closed: the connection goes back to the
            // pool for the next piece (a disconnect would close it).
            try { input.close() } catch (_: IOException) { /* done with it */ }
            keepAlive = true
            synchronized(lock) { if (attempt == c.attempt) c.state = State.DONE }
        } catch (e: IOException) {
            refusal = refusal || e is ConnectException
            failure = e
        } catch (e: RuntimeException) {
            failure = IOException(e)
        } finally {
            if (!keepAlive) {
                try { conn?.disconnect() } catch (_: Throwable) { /* already gone */ }
            }
            if (counted) shared.liveConnections.decrementAndGet()
            c.connection = null
            synchronized(lock) {
                val e = failure
                if (e != null && !c.cancelled && attempt == c.attempt) {
                    val wrapped = e as? HttpDataSource.HttpDataSourceException
                        ?: HttpDataSource.HttpDataSourceException.createForIOException(e, spec, HttpDataSource.HttpDataSourceException.TYPE_READ)
                    retryOrFail(c, attempt, wrapped, refusal)
                }
                workerDone(c)
                lock.notifyAll()
                schedule()
            }
        }
    }

    @Throws(IOException::class)
    private fun connect(url: URL, spec: DataSpec, from: Long, to: Long): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = connectTimeoutMs
        conn.readTimeout = readTimeoutMs
        conn.instanceFollowRedirects = false
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
        private const val MIB = 1024 * 1024
        const val DEFAULT_CONNECTIONS = 4
        /** Unread plus in-flight bytes: boxes with memory to spare. */
        const val DEFAULT_WINDOW_BYTES = 32 * MIB
        /** The same on 2 GB boxes (taken out of the player's buffer budget). */
        const val LOW_RAM_WINDOW_BYTES = 16 * MIB
        const val DEFAULT_SLAB_BYTES = MIB
        /** The one piece every open starts with, and what the reader must
         *  consume before the open fans out. */
        const val DEFAULT_RAMP_BYTES = MIB
        const val DEFAULT_MIN_PIECE_BYTES = 2 * MIB
        const val DEFAULT_MAX_PIECE_BYTES = 8 * MIB
        /** No progress for this long, with a connection free: ask again. */
        const val DEFAULT_STALL_MS = 6000L
        /** On close, a piece with this much or less left finishes. */
        const val DRAIN_BYTES = 256 * 1024
        /** Tries per piece (the first included), with RETRY_BACKOFF_MS doubling. */
        const val MAX_TRIES = 3
        const val RETRY_BACKOFF_MS = 250L
        private const val WAIT_SLICE_MS = 500L
        /** One socket read at a time, per worker thread. */
        private const val READ_BYTES = 64 * 1024
        private val SCRATCH = object : ThreadLocal<ByteArray>() {
            override fun initialValue(): ByteArray = ByteArray(READ_BYTES)
        }
        private val REDIRECTS = setOf(301, 302, 303, 307, 308)
        private val threadNo = AtomicInteger(0)
        /** Bounded: at most this many workers for the whole process (a
         *  piece in flight each, plus a few finishing after a close). */
        private const val POOL_THREADS = 8
        private val POOL: ThreadPoolExecutor = ThreadPoolExecutor(
            POOL_THREADS, POOL_THREADS, 30L, TimeUnit.SECONDS, LinkedBlockingQueue(),
        ) { r -> Thread(r, "SnowPlayer:RangeFetch-${threadNo.incrementAndGet()}").apply { isDaemon = true } }
            .apply { allowCoreThreadTimeOut(true) }
        /** Disconnects only (see cut): short tasks, apart from the workers so
         *  a cut never queues behind the read it is meant to end. */
        private val CUTTER = Executors.newCachedThreadPool { r ->
            Thread(r, "SnowPlayer:RangeFetch-cut").apply { isDaemon = true }
        }

        /** The first piece of an open: `rampBytes`, never more than the open asks for. */
        fun firstPieceLength(wanted: Long, rampBytes: Int): Int {
            var n = rampBytes
            if (wanted != UNSET && wanted < n) n = wanted.toInt()
            return n.coerceAtLeast(1)
        }

        /** How much of the file is left to ask for from `start`, at most `len`. */
        private fun clip(end: Long, start: Long, len: Int): Int =
            if (end == UNSET) len else minOf(len.toLong(), (end - start).coerceAtLeast(0L)).toInt()

        /** The file's size from a Content-Range header ("bytes 0-1023/5000",
         *  "bytes * /5000"), or C.LENGTH_UNSET. */
        fun documentSize(contentRange: String?): Long {
            if (contentRange == null) return UNSET
            val slash = contentRange.lastIndexOf('/')
            if (slash < 0) return UNSET
            val total = contentRange.substring(slash + 1).trim()
            return total.toLongOrNull()?.takeIf { it >= 0L } ?: UNSET
        }

        /** The first byte a Content-Range header covers ("bytes 1024-2047/5000"
         *  → 1024), or C.LENGTH_UNSET when it names none ("bytes * /5000"). */
        fun rangeStart(contentRange: String?): Long {
            if (contentRange == null) return UNSET
            val s = contentRange.trim()
            if (!s.startsWith("bytes", ignoreCase = true)) return UNSET
            val spec = s.substring(5).trim()
            val dash = spec.indexOf('-')
            if (dash <= 0) return UNSET
            return spec.substring(0, dash).trim().toLongOrNull()?.takeIf { it >= 0L } ?: UNSET
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
