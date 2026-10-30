package com.snowmedia.player

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.snowmedia.dvr.TimeshiftTee

/**
 * Rewind live TV on one connection: the main player's live HTTP source,
 * with every byte it reads handed to the rewind buffer (TimeshiftTee) as
 * well. Nothing changes for the player: same requests, same bytes, same
 * timing; the tee only copies (the buffer writes on its own thread).
 *
 * Only while [tapping] (the main slot playing a live channel); anything else
 * (a film, Plex) goes straight through. [channelUrl] is the channel's own
 * address, to tell its raw stream from the pieces of an HLS channel.
 */
internal class TimeshiftTapDataSource(
    private val inner: DataSource,
    private val tee: TimeshiftTee,
    private val tapping: () -> Boolean,
    private val channelUrl: () -> String?,
) : DataSource {
    private var reader: TimeshiftTee.Reader? = null

    override fun addTransferListener(transferListener: TransferListener) {
        inner.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        reader?.close()
        reader = null
        if (tapping()) {
            val uri = dataSpec.uri.toString()
            // Counted as open from before the request goes out: the rewind
            // buffer never opens its own connection while this one may be.
            reader = tee.begin(uri, dataSpec.position, uri == channelUrl())
        }
        try {
            val length = inner.open(dataSpec)
            // A playlist's segments resolve against where it was finally served from (as Media3 does).
            reader?.setBase(inner.uri?.toString())
            return length
        } catch (t: Throwable) {
            // close() is normally called after a failed open too; never count it twice.
            reader?.close()
            reader = null
            throw t
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val n = inner.read(buffer, offset, length)
        if (n > 0) reader?.bytes(buffer, offset, n)
        return n
    }

    override fun getUri(): Uri? = inner.uri

    override fun getResponseHeaders(): Map<String, List<String>> = inner.responseHeaders

    override fun close() {
        try {
            inner.close()
        } finally {
            // After the connection is closed, never before.
            reader?.close()
            reader = null
        }
    }

    class Factory(
        private val inner: DataSource.Factory,
        private val tee: TimeshiftTee,
        private val tapping: () -> Boolean,
        private val channelUrl: () -> String?,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource =
            TimeshiftTapDataSource(inner.createDataSource(), tee, tapping, channelUrl)
    }
}
