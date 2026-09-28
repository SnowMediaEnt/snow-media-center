package com.snowmedia.player

/**
 * The mpv option list for Live TV playback (SnowPlayer's mpv engine — see
 * EngineChoice, owner test builds only). Plain data, no Android and no
 * MPVLib in it, so it can be checked off the device; MpvEngine (src/mpv) is
 * the only file that ever hands these to MPVLib.setOptionString, and never
 * with a URL among them — the stream address goes only to `loadfile`.
 */
internal object MpvOptions {
    /** Matches the main player's low-RAM byte budget (SnowPlayerPlugin.isLowRamBox). */
    const val DEMUXER_MAX_BYTES_MB = 32
    const val DEMUXER_MAX_BYTES_LOW_RAM_MB = 16

    /**
     * MediaCodec decodes straight onto mpv's SurfaceView: the same
     * MediaCodec-to-Surface path ExoPlayer already proves on these boxes, and
     * no GL rendering on top. It needs the surface ("wid") before it starts,
     * so MpvEngine sets it again every time a surface arrives and "null"
     * when one goes (as mpv-android and Findroid do), and loads a stream only
     * while it has one. It fills the whole surface, so the plugin sizes the
     * SurfaceView to the picture's shape (VideoFit), as it does ExoPlayer's
     * TextureView.
     */
    const val VIDEO_OUTPUT = "mediacodec_embed"

    /**
     * `userAgent`: the same string the live Exo data source sends — it sets
     * none of its own, so the OS default applies (MpvEngine works this out
     * the same way). `isLowRamBox`: halves the demuxer cache, like the main
     * player's own low-RAM profile. Live TV only, so demuxer-max-back-bytes
     * is 0 — nothing behind the live edge is worth keeping.
     *
     * Set before mpv_initialize (MpvEngine.ensureCreated), as the reference
     * apps do.
     */
    fun buildOptions(userAgent: String, isLowRamBox: Boolean): List<Pair<String, String>> {
        val demuxerMb = if (isLowRamBox) DEMUXER_MAX_BYTES_LOW_RAM_MB else DEMUXER_MAX_BYTES_MB
        return listOf(
            "vo" to VIDEO_OUTPUT,
            "hwdec" to "mediacodec",
            "hwdec-codecs" to "all",
            "idle" to "yes",
            "keep-open" to "no",
            "ao" to "audiotrack,opensles",
            "volume-max" to "150",
            "cache" to "yes",
            "demuxer-max-bytes" to "${demuxerMb}MiB",
            "demuxer-max-back-bytes" to "0",
            "demuxer-readahead-secs" to "10",
            // Live MPEG-TS: FFmpeg reads up to 5 s of the stream to describe
            // every elementary stream before anything plays, and IPTV TS
            // carries teletext/data/spare audio PIDs that never describe
            // themselves, so it often reads all 5 s (build 46: 4.3 s to first
            // picture against ExoPlayer's 0.5 s). One second is plenty for
            // the video and audio a channel actually plays.
            "demuxer-lavf-analyzeduration" to "1",
            "cache-pause-initial" to "no",
            "cache-pause-wait" to "2",
            "network-timeout" to "15",
            // The plain key: a list, split at commas. "stream-lavf-o-append"
            // (build 46) is a command-line-only form; through the client API
            // it is an unknown option, so none of these were ever applied.
            "stream-lavf-o" to "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4",
            "user-agent" to userAgent,
        )
    }
}
