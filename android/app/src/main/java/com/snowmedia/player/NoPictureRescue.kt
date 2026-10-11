package com.snowmedia.player

/**
 * A black screen with the sound playing, and what is done about it, as plain
 * rules with no Android or Media3 in them (SnowPlayerPlugin applies them), so
 * they can be checked off the device.
 *
 * A stream ends up heard and not seen in two ways.
 *
 * The cover. Each player has an opaque black shutter over its picture, shut
 * while a new stream starts and opened on that stream's first frame. The
 * WebView shuts it a moment early, on the setRect it sends just before load()
 * (`blank`). When that load never comes (the WebView's run was overtaken, or
 * its page stopped answering), the stream already playing goes on under a
 * cover nothing opens again: its first frame was drawn long before. The
 * blank guard (blankGuard) lifts it once it is clear no load is coming.
 *
 * The picture itself. Media3 keeps the sound going when its video renderer
 * has no surface to draw on (it skips the frames), and on a weak box (an X96:
 * an old Amlogic decoder, few hardware decoder instances) a decoder can sit
 * there drawing nothing while the sound plays. The first-picture watchdog only
 * reconnected the same player, decoder and all, every 8 s, 20 times. The
 * Ladder goes further, one step at a time: the surface attached again, then a
 * new player (its decoders let go first), then on the main player the other
 * kind of video decoder, and then the viewer is told and the cover lifted.
 */
internal object NoPictureRescue {
    /** Sound with no picture this long: the first step. */
    const val SURFACE_AFTER_MS = 4000L
    /** Each later step waits this much more of it. */
    const val NEXT_STEP_AFTER_MS = 3000L
    /** How often a slot waiting for its first picture is looked at. */
    const val TICK_MS = 500L
    /** A blank cover with no load behind it this long is lifted again. */
    const val BLANK_GUARD_MS = 1500L

    /** The playerError code the WebView is sent once every step has failed. */
    const val ERROR_CODE = "NO_PICTURE"

    /** Video decoder order a player is built with: Media3's own, or one kind first. */
    const val ORDER_DEFAULT = 0
    const val ORDER_SOFTWARE_FIRST = 1
    const val ORDER_HARDWARE_FIRST = 2

    enum class Step { SURFACE, REBUILD, DECODER, GIVE_UP }

    /** What the stats panel shows as the last restart for a step. */
    fun reason(step: Step, order: Int = ORDER_DEFAULT): String = when (step) {
        Step.SURFACE -> "no picture: surface re-attached"
        Step.REBUILD -> "no picture: player rebuilt"
        Step.DECODER -> if (order == ORDER_HARDWARE_FIRST) "no picture: hardware decoder" else "no picture: software decoder"
        Step.GIVE_UP -> "no picture: gave up"
    }

    /**
     * Whether a load gets the steps at all: ExoPlayer only (mpv draws its own
     * way), and never a Plex film or episode, trailers included, which
     * PlexSection's own watchdog looks after.
     */
    fun applies(exo: Boolean, plexFilm: Boolean): Boolean = exo && !plexFilm

    /** One look at a slot that has not drawn its first frame yet. */
    data class Seen(
        val firstFrameSeen: Boolean,
        /** Media3's STATE_READY. */
        val ready: Boolean,
        /** Media3's isPlaying: set to play, and nothing holding it back. */
        val playing: Boolean,
        /** A video track is selected (a radio channel has none). */
        val videoSelected: Boolean,
        /** A film's start-up hold (paused on purpose while the buffer fills). */
        val holding: Boolean,
        /** The position moved since the last look: the clock really runs. */
        val advancing: Boolean,
        /** Tunneled playback: frames may be shown without the player hearing of it. */
        val tunneled: Boolean,
        /** The main player plays the rewind buffer, not the stream it loaded. */
        val rewindBuffer: Boolean,
        /** The app is on screen (Home or another app over it: no picture to show). */
        val onScreen: Boolean = true,
    )

    /**
     * The sound is playing, a video track is chosen and nothing has been
     * drawn. A stream whose picture starts normally never gets here: Media3's
     * video renderer is not "ready" until it has drawn its first frame, so the
     * player stays buffering until then. Only a renderer that drops its frames
     * (no surface) or is told to join without one lets the sound run ahead.
     */
    fun soundWithoutPicture(s: Seen): Boolean =
        !s.firstFrameSeen && s.ready && s.playing && s.videoSelected && s.advancing &&
            !s.holding && !s.tunneled && !s.rewindBuffer && s.onScreen

    /** The step after `taken` (null: none yet). A tile stops after the rebuild. */
    fun next(taken: Step?, main: Boolean): Step = when (taken) {
        null -> Step.SURFACE
        Step.SURFACE -> Step.REBUILD
        Step.REBUILD -> if (main) Step.DECODER else Step.GIVE_UP
        Step.DECODER, Step.GIVE_UP -> Step.GIVE_UP
    }

    /** How long the sound must play with no picture before `step`. */
    fun waitBefore(step: Step): Long = if (step == Step.SURFACE) SURFACE_AFTER_MS else NEXT_STEP_AFTER_MS

    /**
     * One load's steps, for one slot. Each wait counts sound without a
     * picture without a break, from its first sight or from the last step;
     * any look that sees otherwise (a rebuilt player buffering, a stall)
     * starts it over. A tile (Multi-
     * Screen) gets the surface and the rebuild only: four players share the
     * box's decoders and its CPU, and a software decoder on one tile would
     * slow all of them and the menus.
     */
    class Ladder(private val main: Boolean) {
        var taken: Step? = null
            private set
        val finished: Boolean get() = taken == Step.GIVE_UP
        private var since = NONE

        /**
         * A look at `nowMs`. Returns the step to take now, or null.
         * `canSwitchDecoder` is asked only when the decoder step is due: no
         * decoder of the other kind on this box goes straight to giving up.
         */
        fun tick(nowMs: Long, soundWithoutPicture: Boolean, canSwitchDecoder: () -> Boolean): Step? {
            if (finished) return null
            if (!soundWithoutPicture) { since = NONE; return null }
            if (since == NONE) { since = nowMs; return null }
            var step = next(taken, main)
            if (nowMs - since < waitBefore(step)) return null
            if (step == Step.DECODER && !canSwitchDecoder()) step = Step.GIVE_UP
            taken = step
            since = nowMs
            return step
        }

        private companion object {
            const val NONE = Long.MIN_VALUE
        }
    }

    // ---- The blank cover -----------------------------------------------------

    /** How a slot's player stands, for the blank guard. */
    enum class Playback { STOPPED, BUFFERING, SHOWING }

    enum class Cover {
        /** Lift it now: the stream it covers has drawn and plays on. */
        LIFT,
        /** Look again shortly: the stream is buffering. */
        WAIT,
        /** Leave it: a load came (its own first frame opens it), the slot
         *  stopped, or the stream has not drawn yet (its first frame opens it). */
        LEAVE,
    }

    /**
     * The guard on a blank cover. `blankUrl` / `loadsAtBlank`: the stream
     * playing and the number of loads asked for when the cover went on;
     * `loadsNow` counts each load() as it reaches the plugin, before it gets
     * to the main thread, so one on its way is never taken for none.
     */
    fun blankGuard(
        blankUrl: String?,
        nowUrl: String?,
        loadsAtBlank: Int,
        loadsNow: Int,
        firstFrameSeen: Boolean,
        playback: Playback,
    ): Cover = when {
        blankUrl == null || nowUrl != blankUrl || loadsNow != loadsAtBlank -> Cover.LEAVE
        !firstFrameSeen -> Cover.LEAVE
        playback == Playback.STOPPED -> Cover.LEAVE
        playback == Playback.BUFFERING -> Cover.WAIT
        else -> Cover.LIFT
    }

    // ---- The other kind of video decoder -------------------------------------

    /** A video decoder this box has for the stream's format. */
    data class Decoder(val name: String, val software: Boolean)

    /** Android's own software decoders, by name (when the box says nothing). */
    fun looksSoftware(name: String): Boolean =
        name.startsWith("c2.android.", ignoreCase = true) || name.startsWith("OMX.google.", ignoreCase = true) ||
            name.startsWith("c2.google.", ignoreCase = true)

    /**
     * The order to try for a stream whose decoder `used` (its name; null when
     * none started) drew nothing: the other kind first. With no decoder known,
     * the one that failed is taken to be Media3's first pick, a hardware one.
     * Null when this box has no decoder of the other kind for the format.
     */
    fun otherOrder(used: String?, decoders: List<Decoder>): Int? {
        val usedSoftware = decoders.firstOrNull { it.name == used }?.software ?: (used != null && looksSoftware(used))
        val wantSoftware = !usedSoftware
        if (decoders.none { it.software == wantSoftware }) return null
        return if (wantSoftware) ORDER_SOFTWARE_FIRST else ORDER_HARDWARE_FIRST
    }

    /** `list` with one kind first, each kind in its own order; as it is for ORDER_DEFAULT. */
    fun <T> reorder(list: List<T>, order: Int, software: (T) -> Boolean): List<T> {
        if (order != ORDER_SOFTWARE_FIRST && order != ORDER_HARDWARE_FIRST) return list
        val (first, rest) = list.partition { software(it) == (order == ORDER_SOFTWARE_FIRST) }
        return first + rest
    }
}
