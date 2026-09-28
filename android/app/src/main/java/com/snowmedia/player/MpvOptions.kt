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
     * `userAgent`: the same string the live Exo data source sends — it sets
     * none of its own, so the OS default applies (MpvEngine works this out
     * the same way). `isLowRamBox`: halves the demuxer cache, like the main
     * player's own low-RAM profile. Live TV only, so demuxer-max-back-bytes
     * is 0 — nothing behind the live edge is worth keeping.
     */
    fun buildOptions(userAgent: String, isLowRamBox: Boolean): List<Pair<String, String>> {
        val demuxerMb = if (isLowRamBox) DEMUXER_MAX_BYTES_LOW_RAM_MB else DEMUXER_MAX_BYTES_MB
        return listOf(
            "vo" to "mediacodec_embed",
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
            "cache-pause-initial" to "no",
            "cache-pause-wait" to "2",
            "network-timeout" to "15",
            "stream-lavf-o-append" to "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4",
            "user-agent" to userAgent,
        )
    }
}
