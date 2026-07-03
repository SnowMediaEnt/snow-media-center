@file:androidx.media3.common.util.UnstableApi

package com.snowmedia.player

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.ui.SubtitleView
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native video player (Media3/ExoPlayer) on a TextureView behind the transparent
 * WebView. Handles both live IPTV (auto-reconnect on drops) and VOD (Plex movies:
 * legitimate STATE_ENDED, resume-at-position on reconnect, sidecar subtitles,
 * seek + position query).
 */
@CapacitorPlugin(name = "SnowPlayer")
class SnowPlayerPlugin : Plugin() {

    private var player: ExoPlayer? = null
    private var trackSelector: DefaultTrackSelector? = null
    private var textureView: TextureView? = null
    private var subtitleView: SubtitleView? = null
    private var container: FrameLayout? = null
    private var volume: Float = 1f
    private var lastRect: IntArray? = null

    // ── resilience / state ──────────────────────────────────────────────
    private var currentUrl: String? = null
    private var currentSubtitles: JSArray? = null
    private var isLive: Boolean = true
    private var lastPositionMs: Long = 0L
    private var reconnectAttempts = 0
    private var firstFrameSeen = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var watchdogRunnable: Runnable? = null
    private var reconnectRunnable: Runnable? = null
    private var positionTickRunnable: Runnable? = null

    companion object {
        private const val MAX_RECONNECTS = 20
        private const val RECONNECT_DELAY_MS = 500L
        private const val FIRST_FRAME_TIMEOUT_MS = 8000L
        private const val POSITION_TICK_MS = 5000L
    }

    private fun cancelTimers() {
        watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        watchdogRunnable = null
        reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        reconnectRunnable = null
        positionTickRunnable?.let { mainHandler.removeCallbacks(it) }
        positionTickRunnable = null
    }

    private fun schedulePositionTick() {
        positionTickRunnable?.let { mainHandler.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                val p = player
                if (p != null && p.isPlaying) {
                    val pos = p.currentPosition
                    if (pos > 0) lastPositionMs = pos
                }
                mainHandler.postDelayed(this, POSITION_TICK_MS)
            }
        }
        positionTickRunnable = r
        mainHandler.postDelayed(r, POSITION_TICK_MS)
    }

    /** If no video frame renders within the window, the stream stalled — reconnect. */
    private fun scheduleWatchdog() {
        watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            if (currentUrl != null && !firstFrameSeen) reconnect()
        }
        watchdogRunnable = r
        mainHandler.postDelayed(r, FIRST_FRAME_TIMEOUT_MS)
    }

    private fun buildMediaItem(url: String, subs: JSArray?): MediaItem {
        val builder = MediaItem.Builder().setUri(Uri.parse(url))
        if (subs != null && subs.length() > 0) {
            val list = ArrayList<MediaItem.SubtitleConfiguration>()
            for (i in 0 until subs.length()) {
                try {
                    val o = subs.getJSONObject(i)
                    val su = o.optString("url", "")
                    if (su.isBlank()) continue
                    val mime = o.optString("mime", "").ifBlank { MimeTypes.APPLICATION_SUBRIP }
                    val lang = o.optString("lang", "")
                    val label = o.optString("label", "")
                    val sc = MediaItem.SubtitleConfiguration.Builder(Uri.parse(su))
                        .setMimeType(mime)
                        .setLanguage(if (lang.isBlank()) null else lang)
                        .setLabel(if (label.isBlank()) null else label)
                        .setSelectionFlags(0)
                        .build()
                    list.add(sc)
                } catch (_: Exception) { /* skip malformed row */ }
            }
            if (list.isNotEmpty()) builder.setSubtitleConfigurations(list)
        }
        return builder.build()
    }

    /** Re-request the current URL (fresh connection). VOD resumes at lastPositionMs. */
    private fun reconnect() {
        val url = currentUrl ?: return
        if (reconnectAttempts >= MAX_RECONNECTS) {
            notifyListeners(
                "playerError",
                JSObject().put("code", "RECONNECT_EXHAUSTED")
                    .put("message", "The stream keeps dropping. Try again."),
            )
            return
        }
        reconnectAttempts++
        notifyListeners("playerState", JSObject().put("state", "buffering"))
        reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        val resumeAt = if (!isLive) lastPositionMs else 0L
        val r = Runnable {
            val p = player ?: return@Runnable
            if (currentUrl == null) return@Runnable
            firstFrameSeen = false
            p.setMediaItem(buildMediaItem(url, currentSubtitles))
            p.prepare()
            if (resumeAt > 0) p.seekTo(resumeAt)
            p.playWhenReady = true
            scheduleWatchdog()
        }
        reconnectRunnable = r
        mainHandler.postDelayed(r, RECONNECT_DELAY_MS)
    }

    private fun ensureSurface(): Boolean {
        if (container != null && textureView != null) return true
        val act = activity ?: return false
        val webView = bridge?.webView ?: return false
        val parent = webView.parent as? ViewGroup ?: return false
        webView.setBackgroundColor(Color.TRANSPARENT)
        val tv = TextureView(act)
        val fl = FrameLayout(act)
        fl.setBackgroundColor(Color.BLACK)
        fl.addView(tv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        val sv = SubtitleView(act)
        sv.setUserDefaultStyle()
        sv.setUserDefaultTextSize()
        fl.addView(
            sv,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        subtitleView = sv
        fl.visibility = View.GONE
        parent.addView(fl, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        container = fl
        textureView = tv
        return true
    }

    private fun buildPlayer() {
        val act = activity ?: return
        val ts = DefaultTrackSelector(act)
        trackSelector = ts
        val httpFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000)
        val dataSourceFactory = DefaultDataSource.Factory(act, httpFactory)
        val p = ExoPlayer.Builder(act)
            .setTrackSelector(ts)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(dataSourceFactory)
                    .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6)),
            )
            .build()
        p.setVideoTextureView(textureView)
        p.volume = volume
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && currentUrl != null) {
                    if (isLive) {
                        // Live streams never legitimately end — treat as a drop.
                        reconnect()
                        return
                    }
                    // VOD: legitimate end-of-file — surface to JS, do NOT reconnect.
                    notifyListeners("playerState", JSObject().put("state", "ended"))
                    return
                }
                val s = when (state) {
                    Player.STATE_IDLE -> "idle"
                    Player.STATE_BUFFERING -> "buffering"
                    Player.STATE_READY -> "ready"
                    Player.STATE_ENDED -> "ended"
                    else -> "unknown"
                }
                notifyListeners("playerState", JSObject().put("state", s))
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                notifyListeners("playerState", JSObject().put("playing", isPlaying))
            }
            override fun onRenderedFirstFrame() {
                firstFrameSeen = true
                reconnectAttempts = 0
                watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
                watchdogRunnable = null
            }
            override fun onPlayerError(error: PlaybackException) {
                if (currentUrl != null && reconnectAttempts < MAX_RECONNECTS) {
                    reconnect()
                    return
                }
                notifyListeners("playerError", JSObject().put("code", error.errorCodeName).put("message", error.message ?: "Playback error"))
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                notifyListeners("tracksChanged", JSObject())
            }
            override fun onCues(cueGroup: CueGroup) {
                subtitleView?.setCues(cueGroup.cues)
            }
        })
        player = p
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        val live = call.getBoolean("live", true) ?: true
        val subs = call.getArray("subtitles", null)
        activity?.runOnUiThread {
            if (!ensureSurface()) { call.reject("no activity/webview"); return@runOnUiThread }
            if (player == null) buildPlayer()
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            container?.visibility = View.VISIBLE
            val p = player ?: run { call.reject("player init failed"); return@runOnUiThread }
            cancelTimers()
            currentUrl = url
            currentSubtitles = subs
            isLive = live
            lastPositionMs = 0L
            reconnectAttempts = 0
            firstFrameSeen = false
            p.setMediaItem(buildMediaItem(url, subs))
            p.prepare()
            p.playWhenReady = true
            scheduleWatchdog()
            schedulePositionTick()
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) { activity?.runOnUiThread { player?.play(); call.resolve() } }

    @PluginMethod
    fun pause(call: PluginCall) { activity?.runOnUiThread { player?.pause(); call.resolve() } }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val pos = call.getDouble("position") ?: 0.0
        activity?.runOnUiThread {
            val p = player
            if (p != null) {
                val ms = (pos * 1000.0).toLong().coerceAtLeast(0L)
                p.seekTo(ms)
                lastPositionMs = ms
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun getPosition(call: PluginCall) {
        activity?.runOnUiThread {
            val p = player
            val ret = JSObject()
            if (p == null) {
                ret.put("position", 0.0); ret.put("duration", 0.0); ret.put("playing", false)
            } else {
                val pos = p.currentPosition
                val dur = p.duration
                ret.put("position", (if (pos > 0) pos else 0L) / 1000.0)
                ret.put("duration", if (dur == C.TIME_UNSET) 0.0 else dur / 1000.0)
                ret.put("playing", p.isPlaying)
            }
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity?.runOnUiThread {
            currentUrl = null
            currentSubtitles = null
            lastPositionMs = 0L
            cancelTimers()
            reconnectAttempts = 0
            firstFrameSeen = false
            player?.stop()
            player?.clearMediaItems()
            subtitleView?.setCues(emptyList())
            container?.visibility = View.GONE
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val v = call.getFloat("volume") ?: 1f
        volume = v.coerceIn(0f, 1f)
        activity?.runOnUiThread { player?.volume = volume; call.resolve() }
    }

    @PluginMethod
    fun setRect(call: PluginCall) {
        val x = call.getInt("x") ?: 0
        val y = call.getInt("y") ?: 0
        val w = call.getInt("width") ?: 0
        val h = call.getInt("height") ?: 0
        activity?.runOnUiThread {
            ensureSurface()
            val c = container ?: run { call.resolve(); return@runOnUiThread }
            val lp = c.layoutParams
            lp.width = if (w > 0) w else ViewGroup.LayoutParams.MATCH_PARENT
            lp.height = if (h > 0) h else ViewGroup.LayoutParams.MATCH_PARENT
            c.layoutParams = lp
            c.x = x.toFloat()
            c.y = y.toFloat()
            c.requestLayout()
            lastRect = intArrayOf(x, y, w, h)
            call.resolve()
        }
    }

    private fun listTracks(call: PluginCall, type: Int) {
        activity?.runOnUiThread {
            val out = JSArray()
            val p = player
            if (p != null) {
                var groupIndex = 0
                for (group in p.currentTracks.groups) {
                    if (group.type == type) {
                        for (i in 0 until group.length) {
                            val fmt = group.getTrackFormat(i)
                            val o = JSObject()
                            o.put("id", "$groupIndex:$i")
                            o.put("label", fmt.label ?: fmt.language ?: codecLabel(fmt.codecs) ?: "Track ${i + 1}")
                            o.put("language", fmt.language ?: "")
                            o.put("codec", fmt.codecs ?: "")
                            o.put("selected", group.isTrackSelected(i))
                            out.put(o)
                        }
                    }
                    groupIndex++
                }
            }
            call.resolve(JSObject().put("tracks", out))
        }
    }

    private fun codecLabel(codecs: String?): String? {
        if (codecs == null) return null
        return when {
            codecs.startsWith("ac-3") || codecs.startsWith("ac3") -> "Dolby Digital"
            codecs.startsWith("ec-3") || codecs.startsWith("eac3") -> "Dolby Digital+"
            codecs.startsWith("mp4a") -> "AAC"
            else -> codecs
        }
    }

    private fun selectTrack(call: PluginCall, type: Int) {
        val id = call.getString("id")
        activity?.runOnUiThread {
            val p = player
            if (p == null || id == null) { call.resolve(); return@runOnUiThread }
            if (id == "-1") {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(type, true).build()
                call.resolve(); return@runOnUiThread
            }
            val parts = id.split(":")
            if (parts.size != 2) { call.resolve(); return@runOnUiThread }
            val gi = parts[0].toIntOrNull() ?: return@runOnUiThread
            val ti = parts[1].toIntOrNull() ?: return@runOnUiThread
            val groups = p.currentTracks.groups
            if (gi < 0 || gi >= groups.size) { call.resolve(); return@runOnUiThread }
            val group = groups[gi]
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, ti)).build()
            call.resolve()
        }
    }

    @PluginMethod fun getAudioTracks(call: PluginCall) = listTracks(call, C.TRACK_TYPE_AUDIO)
    @PluginMethod fun setAudioTrack(call: PluginCall) = selectTrack(call, C.TRACK_TYPE_AUDIO)
    @PluginMethod fun getSubtitleTracks(call: PluginCall) = listTracks(call, C.TRACK_TYPE_TEXT)
    @PluginMethod fun setSubtitleTrack(call: PluginCall) = selectTrack(call, C.TRACK_TYPE_TEXT)

    override fun handleOnDestroy() {
        activity?.runOnUiThread {
            cancelTimers()
            currentUrl = null
            player?.release()
            player = null
        }
        super.handleOnDestroy()
    }
}
