package com.snowmedia.player

/**
 * Which engine a load() should use — ExoPlayer or mpv (owner test builds
 * only; see BuildConfig.SMC_WITH_MPV). Plain arithmetic with no Android in
 * it, so it can be checked off the device (SnowPlayerPlugin.load uses it).
 *
 * mpv is a Live TV thing only: the main slot, playing a channel (live=true).
 * Every other case — a Multi-Screen tile, Plex, Backups, a VOD film —
 * silently plays on ExoPlayer, as it always has; mpv was never offered
 * there, so no fallback reason is reported for it.
 */
internal object EngineChoice {
    const val EXO = "exo"
    const val MPV = "mpv"

    /** mpv isn't compiled into this build (SMC_WITH_MPV off). */
    const val NOT_IN_BUILD = "not-in-build"
    /** Below Android 8 (API 26) — where this app first offers mpv. */
    const val ANDROID_TOO_OLD = "android-too-old"
    /** mpv failed to start once already this process; never retried. */
    const val INIT_FAILED = "init-failed"

    /** What SnowPlayerPlugin knows without asking mpv anything. */
    data class Availability(
        val inBuild: Boolean,
        val androidOk: Boolean,
        val initFailed: Boolean,
    )

    data class Choice(val engine: String, val fallbackReason: String? = null)

    /**
     * `requested`: the load() "engine" option ("mpv" or anything else, which
     * behaves as "exo"). `screenId`/`live`: the slot being loaded.
     */
    fun choose(requested: String, screenId: String, live: Boolean, availability: Availability): Choice {
        if (requested != MPV) return Choice(EXO)
        if (screenId != "main" || !live) return Choice(EXO)
        if (!availability.inBuild) return Choice(EXO, NOT_IN_BUILD)
        if (!availability.androidOk) return Choice(EXO, ANDROID_TOO_OLD)
        if (availability.initFailed) return Choice(EXO, INIT_FAILED)
        return Choice(MPV)
    }
}
