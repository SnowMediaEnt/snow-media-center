package com.snowmedia.dvr

import android.content.Context
import android.util.Log
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** HTTP Range requests (RFC 9110 §14), single byte ranges only. Pure: HttpRangeTest. */
internal object HttpRange {
    sealed class Result {
        /** No usable Range header: the whole file, 200. */
        object Full : Result()
        /** Bytes [start]..[end] inclusive, 206. */
        data class Part(val start: Long, val end: Long) : Result() { val length: Long get() = end - start + 1 }
        /** A valid range that lies outside the file: 416. */
        object Unsatisfiable : Result()
    }

    /**
     * "bytes=0-", "bytes=100-199", "bytes=-500" (the last 500). A header
     * that is not one well-formed byte range (another unit, several ranges,
     * garbage) is ignored, as the RFC allows: the whole file is sent.
     */
    fun parse(header: String?, size: Long): Result {
        val h = header?.trim() ?: return Result.Full
        if (!h.regionMatches(0, "bytes=", 0, 6, ignoreCase = true)) return Result.Full
        val spec = h.substring(6).trim()
        if (spec.isEmpty() || spec.contains(',')) return Result.Full
        val dash = spec.indexOf('-')
        if (dash < 0) return Result.Full
        val a = spec.substring(0, dash).trim()
        val b = spec.substring(dash + 1).trim()
        if (a.isEmpty()) {
            // Suffix: the last n bytes.
            val n = b.toLongStrict() ?: return Result.Full
            if (n == 0L || size == 0L) return Result.Unsatisfiable
            return Result.Part(maxOf(0L, size - n), size - 1)
        }
        val start = a.toLongStrict() ?: return Result.Full
        val end = if (b.isEmpty()) null else (b.toLongStrict() ?: return Result.Full)
        if (end != null && end < start) return Result.Full
        if (start >= size) return Result.Unsatisfiable
        return Result.Part(start, minOf(end ?: (size - 1), size - 1))
    }

    private fun String.toLongStrict(): Long? = if (isNotEmpty() && length <= 18 && all { it in '0'..'9' }) toLong() else null
}

/**
 * The tiny HTTP server that plays network recordings: the player takes an
 * http:// address, this reads the file from the share as it is asked.
 *
 * - Listens on 127.0.0.1 only (nothing else on the network can reach it),
 *   on a random port, started the first time a network recording is listed.
 * - Every address carries a random token made when the app starts:
 *   http://127.0.0.1:<port>/net/<token>/<file name>. Another app on the box
 *   can't guess it.
 * - GET and HEAD only; only "*.ts" files directly in the network folder
 *   (no "..", no slashes, no other paths: [target]).
 * - Ranges (206, Content-Range, Accept-Ranges) for seeking; several requests
 *   at once (the player opens a new one on every seek); a player that hangs
 *   up mid-file is not an error.
 * Nothing is logged but an exception's class name.
 */
internal object NetPlayServer {
    private const val TAG = "SmcNetPlay"
    private const val MAX_HEAD = 16 * 1024
    private const val MAX_CLIENTS = 8

    private val token: String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { String.format("%02x", it) }
    private val lock = Any()
    @Volatile private var server: ServerSocket? = null
    private val pool = ThreadPoolExecutor(0, MAX_CLIENTS, 30L, TimeUnit.SECONDS, SynchronousQueue()) { r ->
        Thread(r, "smc-net-play").apply { isDaemon = true }
    }

    /** The address the player uses for [name] (a file in the network folder); starts the server if needed. */
    fun url(ctx: Context, name: String): String {
        val port = ensureStarted(ctx)
        return "http://127.0.0.1:$port/net/$token/${LineCreds.encodeUriComponent(name)}"
    }

    private fun ensureStarted(ctx: Context): Int = synchronized(lock) {
        server?.takeIf { !it.isClosed }?.let { return it.localPort }
        val app = ctx.applicationContext
        val ss = ServerSocket(0, 16, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
        server = ss
        Thread({ accept(app, ss) }, "smc-net-play-accept").apply { isDaemon = true }.start()
        ss.localPort
    }

    private fun accept(app: Context, ss: ServerSocket) {
        while (!ss.isClosed) {
            val s = try { ss.accept() } catch (_: IOException) { break }
            try {
                pool.execute { serve(app, s) }
            } catch (_: RejectedExecutionException) {
                try { s.close() } catch (_: IOException) { /* gone */ }
            }
        }
        synchronized(lock) { if (server === ss) server = null }
    }

    /**
     * The file name a request path asks for, or null when it isn't one of
     * ours: wrong token, another path, a name with a slash, "..", a stream
     * (":"), or not a .ts file. Pure: NetPlayServerTest.
     */
    fun target(path: String, token: String): String? {
        val p = path.substringBefore('?').substringBefore('#')
        val prefix = "/net/"
        if (!p.startsWith(prefix)) return null
        val rest = p.substring(prefix.length)
        val slash = rest.indexOf('/')
        if (slash <= 0) return null
        if (!constantTimeEquals(rest.substring(0, slash), token)) return null
        val encoded = rest.substring(slash + 1)
        if (encoded.isEmpty() || encoded.contains('/')) return null
        val name = percentDecode(encoded) ?: return null
        return if (NetPathGuard.isRecordingName(name)) name else null
    }

    private fun constantTimeEquals(a: String, b: String): Boolean =
        MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

    /** Strict percent-decoding as UTF-8 (a bad escape or bad UTF-8 is null; "+" stays "+"). */
    fun percentDecode(s: String): String? {
        val out = ByteArrayOutputStream(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%') {
                if (i + 2 >= s.length) return null
                val hi = Character.digit(s[i + 1], 16)
                val lo = Character.digit(s[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                out.write((hi shl 4) or lo)
                i += 3
            } else {
                out.write(c.toString().toByteArray(Charsets.UTF_8))
                i++
            }
        }
        val bytes = out.toByteArray()
        val decoder = Charsets.UTF_8.newDecoder()
        return try { decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString() } catch (_: Throwable) { null }
    }

    /** The player hung up: not an SMB failure, so never a reason to drop the shared connection. */
    private class ClientGone : RuntimeException()

    /** Headers already went out, so the request can't be retried: just end it. */
    private class Aborted : RuntimeException()

    private fun serve(app: Context, s: Socket) {
        try {
            s.soTimeout = 20_000
            s.tcpNoDelay = true
            val input = s.getInputStream()
            val out = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
            val head = readHead(input) ?: return
            val lines = head.split("\r\n")
            val req = lines.first().split(' ')
            if (req.size < 3) { status(out, 400, "Bad Request"); return }
            val method = req[0]
            val headers = HashMap<String, String>()
            for (l in lines.drop(1)) {
                val c = l.indexOf(':')
                if (c > 0) headers[l.substring(0, c).trim().lowercase()] = l.substring(c + 1).trim()
            }
            if (method != "GET" && method != "HEAD") { status(out, 405, "Method Not Allowed", "Allow: GET, HEAD\r\n"); return }
            val name = target(req[1], token) ?: run { status(out, 404, "Not Found"); return }
            var sent = false
            try {
                NetShare.withShare(app) { c ->
                    val f = NetShare.openRead(c, name)
                    try {
                        val size = NetShare.sizeOf(f)
                        val range = HttpRange.parse(headers["range"], size)
                        val (start, length) = when (range) {
                            is HttpRange.Result.Unsatisfiable -> {
                                status(out, 416, "Range Not Satisfiable", "Content-Range: bytes */$size\r\n")
                                sent = true
                                return@withShare
                            }
                            is HttpRange.Result.Part -> range.start to range.length
                            HttpRange.Result.Full -> 0L to size
                        }
                        val sb = StringBuilder()
                        if (range is HttpRange.Result.Part) {
                            sb.append("HTTP/1.1 206 Partial Content\r\n")
                            sb.append("Content-Range: bytes ${range.start}-${range.end}/$size\r\n")
                        } else {
                            sb.append("HTTP/1.1 200 OK\r\n")
                        }
                        sb.append("Content-Type: video/mp2t\r\n")
                        sb.append("Content-Length: $length\r\n")
                        sb.append("Accept-Ranges: bytes\r\n")
                        sb.append("Cache-Control: no-store\r\n")
                        sb.append("Connection: close\r\n\r\n")
                        clientWrite { out.write(sb.toString().toByteArray(Charsets.US_ASCII)) }
                        sent = true
                        if (method == "HEAD") { clientWrite { out.flush() }; return@withShare }
                        val buf = ByteArray(c.readChunk)
                        var pos = start
                        var left = length
                        while (left > 0) {
                            val n = try {
                                f.read(buf, pos, 0, minOf(buf.size.toLong(), left).toInt())
                            } catch (t: Throwable) {
                                throw Aborted()
                            }
                            if (n <= 0) break
                            clientWrite { out.write(buf, 0, n) }
                            pos += n
                            left -= n
                        }
                        clientWrite { out.flush() }
                    } finally {
                        try { f.close() } catch (_: Throwable) { /* the connection may be gone */ }
                    }
                }
            } catch (_: ClientGone) {
                // The player seeked or stopped: normal.
            } catch (_: Aborted) {
                // The share stopped answering mid-file: the player sees a short read and asks again.
            } catch (t: Throwable) {
                if (!sent) {
                    when {
                        NetErrors.isNotFound(t) -> status(out, 404, "Not Found")
                        else -> {
                            Log.w(TAG, "Network recording not readable (${t.javaClass.simpleName})")
                            status(out, 503, "Service Unavailable")
                        }
                    }
                }
            }
        } catch (_: IOException) {
            // The player went away before or while asking.
        } catch (t: Throwable) {
            Log.w(TAG, "Playback request failed (${t.javaClass.simpleName})")
        } finally {
            try { s.close() } catch (_: IOException) { /* gone */ }
        }
    }

    private inline fun clientWrite(block: () -> Unit) {
        try { block() } catch (_: IOException) { throw ClientGone() }
    }

    private fun status(out: OutputStream, code: Int, text: String, extra: String = "") {
        try {
            out.write("HTTP/1.1 $code $text\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
            out.flush()
        } catch (_: IOException) { /* the player went away */ }
    }

    /** The request line and headers, up to the blank line; null if the client sends nothing sensible. */
    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream(512)
        var matched = 0
        val end = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte(), '\r'.code.toByte(), '\n'.code.toByte())
        while (buf.size() < MAX_HEAD) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            matched = if (b.toByte() == end[matched]) matched + 1 else if (b.toByte() == end[0]) 1 else 0
            if (matched == 4) {
                val s = buf.toString("ISO-8859-1")
                return s.substring(0, s.length - 4)
            }
        }
        return null
    }
}
