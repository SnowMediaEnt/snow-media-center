package com.snowmedia.player

import android.view.View
import android.view.ViewGroup
import com.getcapacitor.JSObject

/**
 * A second video engine a PlayerSlot can use in place of ExoPlayer — mpv, for
 * Live TV channels and the Live/Guide preview boxes (see EngineChoice; owner
 * test builds only, BuildConfig.SMC_WITH_MPV). This file has no reference to
 * mpv or MPVLib, so it always compiles, in every build. The only
 * implementation, MpvEngine, lives under src/mpv and is reached through
 * Class.forName so a customer build never links against it.
 *
 * Track type ids are the same androidx.media3.common.C.TRACK_TYPE_* the rest
 * of the plugin already uses — this interface itself pulls in nothing else
 * from Media3.
 */
internal interface SecondEngine {
    /** The slot's black container (below the shutter and the SubtitleView,
     *  which the plugin already owns): the engine adds its own surface. */
    fun attach(container: ViewGroup)
    /** The view the picture is drawn in (a direct child of the container),
     *  once attach() has made it: the plugin sizes it to the picture's shape
     *  (applyFormat / VideoFit), as it does ExoPlayer's TextureView. */
    fun videoView(): View?
    fun load(url: String, live: Boolean)
    fun play()
    fun pause()
    /** Seconds. */
    fun seekTo(seconds: Double)
    fun stop()
    /** position, duration — seconds; duration 0 for a live channel. */
    fun position(): Pair<Double, Double>
    /** 0..1.5, like ExoPlayer's own (SnowPlayerPlugin.MAX_VOLUME). */
    fun setVolume(volume: Float)
    fun setAudioEnabled(enabled: Boolean)
    /** C.TRACK_TYPE_AUDIO or C.TRACK_TYPE_TEXT. */
    fun tracks(type: Int): List<JSObject>
    /** id: "0:<mpvId>", or "-1" for off. */
    fun selectTrack(type: Int, id: String)
    /** The same shape statsOf() builds for ExoPlayer — see SnowPlayerPlugin. */
    fun stats(): JSObject
    fun release()

    /** Posted to the plugin's mainHandler; never called off it. */
    interface Callbacks {
        fun onState(state: String)
        fun onPlaying(playing: Boolean)
        fun onPaused(paused: Boolean)
        fun onFirstFrame()
        fun onError(code: String, message: String)
        fun onTracksChanged()
        fun onVideoSize(width: Int, height: Int, pixelRatio: Float)
        fun onBandwidth(kbps: Long)
        /** Text-only, from mpv's sub-text; blank clears the SubtitleView. */
        fun onSubtitleText(text: String)
    }
}
