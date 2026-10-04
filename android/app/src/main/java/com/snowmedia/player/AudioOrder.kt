package com.snowmedia.player

/**
 * Which audio decoder comes first, and when a film's heavy sound track is
 * swapped for a lighter one, as plain rules with no Android or Media3 in them
 * (SnowPlayerPlugin applies them), so they can be checked off the device.
 *
 * Media3 builds a player's renderers once, in an order: with the FFmpeg
 * extension "preferred" every audio track went to FFmpeg first and was
 * decoded on the CPU, a 4K remux's TrueHD Atmos or DTS-HD MA 7.1 included,
 * next to the 4K picture, with the audio clock driving the frames. A film now
 * gets MediaCodec first (the box's hardware decoder, or the bitstream passed
 * through to the TV or receiver) and FFmpeg only for what that can't play.
 * Live TV keeps FFmpeg first: live channels' AC3 sound is what FFmpeg was
 * added for.
 *
 * Why the order is a player rebuild and not a disabled renderer: Media3 maps
 * each track group to one renderer before it looks at disabled renderers.
 * With MediaCodec first, a track both can play (AC3) maps to MediaCodec;
 * disabling MediaCodec then leaves that track with no renderer at all, and
 * the film silent. A player built FFmpeg-first maps it to FFmpeg instead.
 */
internal object AudioOrder {
    /** DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON / _PREFER. */
    const val HARDWARE_FIRST = 1
    const val FFMPEG_FIRST = 2

    /**
     * The order a load needs: hardware first only for a film on the main
     * player, with the remote switch on (and the viewer's "Decode audio on
     * this box" off, which the WebView folds into `hwFirst`), and not after
     * this title's hardware sound has failed once.
     */
    fun mode(isMain: Boolean, live: Boolean, hwFirst: Boolean, fellBack: Boolean): Int =
        if (isMain && !live && hwFirst && !fellBack) HARDWARE_FIRST else FFMPEG_FIRST

    /** A sound error while hardware came first, not tried again yet: FFmpeg first, same place. */
    fun canFallBack(mode: Int, fellBack: Boolean): Boolean = mode == HARDWARE_FIRST && !fellBack

    private val HEAVY_MIMES = setOf("audio/true-hd", "audio/vnd.dts.hd", "audio/vnd.dts.uhd;profile=p2", "audio/vnd.dts.uhd")

    /** TrueHD, DTS-HD, DTS:X, or 7 channels and more: heavy work for FFmpeg on a TV box's CPU. */
    fun isHeavy(mime: String?, channels: Int): Boolean = (mime != null && mime in HEAVY_MIMES) || channels >= 7

    /** An audio track the player could switch to: renderer, group and track
     *  index as Media3 maps them. `hardware`: MediaCodec plays it (the box's
     *  decoder or passthrough). */
    data class Candidate(val renderer: Int, val group: Int, val track: Int, val language: String?, val channels: Int, val hardware: Boolean)

    /**
     * The track to switch to, or null to keep the selected one: only when the
     * selected one is heavy and FFmpeg would play it, the viewer did not
     * pick it, and a same-language track plays in hardware (the most
     * channels of those).
     */
    fun lighter(
        selectedMime: String?,
        selectedChannels: Int,
        selectedLanguage: String?,
        selectedByFfmpeg: Boolean,
        userPicked: Boolean,
        candidates: List<Candidate>,
    ): Candidate? {
        if (userPicked || !selectedByFfmpeg || !isHeavy(selectedMime, selectedChannels)) return null
        val lang = norm(selectedLanguage)
        return candidates
            .filter { it.hardware && norm(it.language) == lang }
            .maxByOrNull { it.channels }
    }

    private fun norm(l: String?): String = l?.trim()?.lowercase()?.substringBefore('-')?.takeIf { it.isNotEmpty() && it != "und" } ?: ""
}
