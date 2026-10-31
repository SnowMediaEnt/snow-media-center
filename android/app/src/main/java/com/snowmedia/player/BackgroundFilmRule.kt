package com.snowmedia.player

/**
 * A film off screen (SnowPlayerPlugin.handleOnStop until handleOnStart):
 * parked. Plain decisions with no Android in them, so they can be checked
 * off the device.
 *
 * On 2026-10-30 the owner started a Plex film on the Fire TV and pressed
 * Home. Minutes later SMC, still behind the launcher, showed "Still
 * preparing…" and "Buffering · 277s" with the connection being measured:
 * the film kept trying to start off screen. On stop the film was only
 * paused (playWhenReady false). A paused Media3 player keeps loading up to
 * its buffer target, and every way the plugin restarts a film by itself
 * (a reconnect, a busy server's retries, a rebuild for the picture, the
 * stuck-buffer steps, the end of the start-up hold, a new load from the
 * page) went on as if it were on screen, and some of them set it playing
 * again: the viewer's bandwidth, a Plex transcode on the server, and sound
 * behind another app.
 *
 * Parked: the player is stopped where it was (Media3 keeps the item and
 * its place), its timers gone, and nothing may load or play it until the
 * app is back. Live TV (the rewind buffer has its own rules) and the
 * Multi-Screen tiles are not parked; mpv plays live channels only.
 */
internal object BackgroundFilmRule {
    /** Back on screen, a film still parked is prepared again (paused) this
     *  long after handleOnStart, unless the page's own load came first: the
     *  WebView loads the film again on return (useNativePlayer), and opening
     *  the file twice would cost a second start on a slow server. */
    const val RETURN_PREPARE_DELAY_MS = 1_500L

    /** A stream that is parked while the app is stopped: a film (not Live
     *  TV) on the main player's ExoPlayer. */
    fun parks(appStopped: Boolean, main: Boolean, live: Boolean, exo: Boolean): Boolean =
        appStopped && main && !live && exo

    enum class Return { NOTHING, FORGET, PREPARE_PAUSED }

    /** On screen again (after RETURN_PREPARE_DELAY_MS): a slot still parked
     *  with its film is prepared again, paused (playing again is the
     *  viewer's choice); one whose film went (a stop) is just not parked. */
    fun onReturn(parked: Boolean, hasStream: Boolean): Return = when {
        !parked -> Return.NOTHING
        !hasStream -> Return.FORGET
        else -> Return.PREPARE_PAUSED
    }
}
