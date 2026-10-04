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
     *  decoder or passthrough). `roleFlags` / `selectionFlags`: Format's. */
    data class Candidate(
        val renderer: Int,
        val group: Int,
        val track: Int,
        val language: String?,
        val channels: Int,
        val hardware: Boolean,
        val label: String? = null,
        val roleFlags: Int = 0,
        val selectionFlags: Int = 0,
    )

    /** C.ROLE_FLAG_COMMENTARY, _DESCRIBES_VIDEO, _DESCRIBES_MUSIC_AND_SOUND. */
    const val ROLE_COMMENTARY = 1 shl 3
    const val ROLE_DESCRIBES_VIDEO = 1 shl 9
    const val ROLE_DESCRIBES_MUSIC_AND_SOUND = 1 shl 10
    /** C.SELECTION_FLAG_DEFAULT. */
    const val SELECTION_DEFAULT = 1

    /** Commentary or audio description, by role or by name: never a stand-in for the film's sound. */
    fun isSideTrack(c: Candidate): Boolean {
        if (c.roleFlags and (ROLE_COMMENTARY or ROLE_DESCRIBES_VIDEO or ROLE_DESCRIBES_MUSIC_AND_SOUND) != 0) return true
        val l = c.label?.lowercase() ?: return false
        return "comment" in l || "descri" in l
    }

    /**
     * The track to switch to, or null to keep the selected one: only when the
     * selected one is heavy and FFmpeg would play it, the viewer did not
     * pick it, and a same-language track plays in hardware. Never commentary
     * or audio description, never fewer channels than min(6, the selected
     * one's) (no 7.1 film down to stereo); the file's default track first,
     * then the most channels.
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
        val minChannels = minOf(6, selectedChannels)
        return candidates
            .filter { it.hardware && norm(it.language) == lang && !isSideTrack(it) && it.channels >= minChannels }
            .maxWithOrNull(compareBy<Candidate>({ if (it.selectionFlags and SELECTION_DEFAULT != 0) 1 else 0 }, { it.channels }))
    }

    /** Passthrough at volume 0: the only way to silence a bitstream here is to turn the audio track off. */
    fun muteByDisabling(passthrough: Boolean, volume: Float): Boolean = passthrough && volume <= 0f

    /** Query parameters that change from one session or quality of a title to the next. */
    private val PER_SESSION = setOf(
        "session", "offset", "fastseek", "maxvideobitrate", "videoresolution", "videoquality", "autoadjustquality",
        "location", "directplay", "directstream", "protocol", "audiocodec", "maxaudiochannels", "copyts",
    )

    /**
     * The title a stream address belongs to, for what is kept per title (the
     * FFmpeg fallback, the viewer's own sound pick): the path and its
     * parameters without the per-session ones (Plex's session ids, client
     * headers, quality). Never logged: it can carry a line's login.
     */
    fun titleKey(url: String): String {
        val q = url.indexOf('?')
        if (q < 0) return url
        val kept = url.substring(q + 1).split('&')
            .filter { it.isNotEmpty() }
            .filter { p ->
                val name = p.substringBefore('=').lowercase()
                !name.startsWith("x-plex-") && name !in PER_SESSION
            }
            .sorted()
        return if (kept.isEmpty()) url.substring(0, q) else url.substring(0, q) + "?" + kept.joinToString("&")
    }

    private fun norm(l: String?): String = l?.trim()?.lowercase()?.substringBefore('-')?.takeIf { it.isNotEmpty() && it != "und" } ?: ""
}
