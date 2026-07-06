@file:androidx.media3.common.util.UnstableApi

package com.snowmedia.player

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
import androidx.media3.exoplayer.DefaultLoadControl
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
 * Slot-based native video plugin. Keeps a map of PlayerSlot keyed by screenId
 * (default "main" for legacy callers). Each slot owns its own ExoPlayer,
 * container, surface + timers. Behavior for the "main" slot is byte-for-byte
 * identical to the pre-multiview single-instance implementation.
 */
@CapacitorPlugin(name = "SnowPlayer")
class SnowPlayerPlugin : Plugin() {

    private class PlayerSlot {
        var player: ExoPlayer? = null
        var trackSelector: DefaultTrackSelector? = null
        var textureView: TextureView? = null
        var subtitleView: SubtitleView? = null
        var container: FrameLayout? = null
        var volume: Float = 1f
        var currentUrl: String? = null
        var currentSubtitles: JSArray? = null
        var isLive: Boolean = true
        var lastPositionMs: Long = 0L
        var reconnectAttempts: Int = 0
        var firstFrameSeen: Boolean = false
        var watchdogRunnable: Runnable? = null
        var reconnectRunnable: Runnable? = null
        var positionTickRunnable: Runnable? = null
        // VOD only: while we hold playback with playWhenReady=false until the
        // decoder has ≥10s buffered (or 12s wall-clock elapse). Prevents the
        // initial "playing → immediate rebuffer" flash on slow Plex servers.
        var preBufferRunnable: Runnable? = null
        // Rect requested BEFORE the surface existed (or before load()). load()
        // applies this after ensureSurface. Null = "no explicit rect yet".
        // IntArray of size 5: [x, y, w, h, fullscreenFlag(0/1)].
        var pendingRect: IntArray? = null
    }

    private val slots = HashMap<String, PlayerSlot>()
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val MAIN = "main"
        private const val MAX_RECONNECTS = 20
        private const val RECONNECT_DELAY_MS = 500L
        private const val FIRST_FRAME_TIMEOUT_MS = 8000L
        private const val POSITION_TICK_MS = 5000L
    }

    private fun screenIdOf(call: PluginCall): String = call.getString("screenId") ?: MAIN

    private fun slot(call: PluginCall): PlayerSlot = slotFor(screenIdOf(call))

    private fun slotFor(screenId: String): PlayerSlot {
        var s = slots[screenId]
        if (s == null) { s = PlayerSlot(); slots[screenId] = s }
        return s
    }

    private fun anySlotStreaming(): Boolean = slots.values.any { it.currentUrl != null }

    private fun cancelTimers(s: PlayerSlot) {
        s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        s.watchdogRunnable = null
        s.reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        s.reconnectRunnable = null
        s.positionTickRunnable?.let { mainHandler.removeCallbacks(it) }
        s.positionTickRunnable = null
        s.preBufferRunnable?.let { mainHandler.removeCallbacks(it) }
        s.preBufferRunnable = null
    }

    private fun schedulePositionTick(s: PlayerSlot) {
        s.positionTickRunnable?.let { mainHandler.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                val p = s.player
                if (p != null && p.isPlaying) {
                    val pos = p.currentPosition
                    if (pos > 0) s.lastPositionMs = pos
                }
                mainHandler.postDelayed(this, POSITION_TICK_MS)
            }
        }
        s.positionTickRunnable = r
        mainHandler.postDelayed(r, POSITION_TICK_MS)
    }

    private fun scheduleWatchdog(s: PlayerSlot, screenId: String) {
        s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            if (s.currentUrl != null && !s.firstFrameSeen) reconnect(s, screenId)
        }
        s.watchdogRunnable = r
        mainHandler.postDelayed(r, FIRST_FRAME_TIMEOUT_MS)
    }

    /** VOD pre-buffer: hold playWhenReady=false for up to 12s or until the
     *  player has buffered ≥10s ahead of the current position. Live streams
     *  keep the legacy behavior (start immediately). */
    private fun schedulePreBuffer(s: PlayerSlot) {
        s.preBufferRunnable?.let { mainHandler.removeCallbacks(it) }
        val startedAt = SystemClock.elapsedRealtime()
        val r = object : Runnable {
            override fun run() {
                val p = s.player ?: return
                if (s.currentUrl == null) return
                val bufMs = p.bufferedPosition - p.currentPosition
                val elapsed = SystemClock.elapsedRealtime() - startedAt
                val readyEnough = p.playbackState == Player.STATE_READY && bufMs >= 4000L
                if (bufMs >= 10000L || elapsed >= 12000L || readyEnough) {
                    p.playWhenReady = true
                    s.preBufferRunnable = null
                    return
                }
                mainHandler.postDelayed(this, 500L)
            }
        }
        s.preBufferRunnable = r
        mainHandler.postDelayed(r, 500L)
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

    private fun reconnect(s: PlayerSlot, screenId: String) {
        val url = s.currentUrl ?: return
        if (s.reconnectAttempts >= MAX_RECONNECTS) {
            notifyListeners(
                "playerError",
                JSObject().put("screenId", screenId)
                    .put("code", "RECONNECT_EXHAUSTED")
                    .put("message", "The stream keeps dropping. Try again."),
            )
            return
        }
        s.reconnectAttempts++
        notifyListeners("playerState", JSObject().put("screenId", screenId).put("state", "buffering"))
        s.reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        val resumeAt = if (!s.isLive) s.lastPositionMs else 0L
        val r = Runnable {
            val p = s.player ?: return@Runnable
            if (s.currentUrl == null) return@Runnable
            s.firstFrameSeen = false
            p.setMediaItem(buildMediaItem(url, s.currentSubtitles))
            p.prepare()
            if (resumeAt > 0) p.seekTo(resumeAt)
            p.playWhenReady = true
            scheduleWatchdog(s, screenId)
        }
        s.reconnectRunnable = r
        mainHandler.postDelayed(r, RECONNECT_DELAY_MS)
    }

    private fun ensureSurface(s: PlayerSlot): Boolean {
        if (s.container != null && s.textureView != null) return true
        val act = activity ?: return false
        val webView = bridge?.webView ?: return false
        val parent = webView.parent as? ViewGroup ?: return false
        webView.setBackgroundColor(Color.TRANSPARENT)
        // Ensure every transparency gap around/behind the WebView reads BLACK,
        // never the light-theme window default (white flash on layout).
        act.window.decorView.setBackgroundColor(Color.BLACK)
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
        s.subtitleView = sv
        fl.visibility = View.GONE
        parent.addView(fl, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        s.container = fl
        s.textureView = tv
        return true
    }

    private fun buildPlayer(s: PlayerSlot, screenId: String) {
        val act = activity ?: return
        val ts = DefaultTrackSelector(act)
        val offloadOff = TrackSelectionParameters.AudioOffloadPreferences.Builder()
            .setAudioOffloadMode(TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED)
            .build()
        val tsParamsBuilder = ts.buildUponParameters()
        tsParamsBuilder.setAudioOffloadPreferences(offloadOff)
        ts.setParameters(tsParamsBuilder)
        s.trackSelector = ts
        val renderersFactory = DefaultRenderersFactory(act)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        val httpFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000)
        val dataSourceFactory = DefaultDataSource.Factory(act, httpFactory)
        val builder = ExoPlayer.Builder(act, renderersFactory)
            .setTrackSelector(ts)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(dataSourceFactory)
                    .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6)),
            )
        // Trimmed buffers for non-main slots so up to 4 concurrent players fit
        // in Fire TV memory. "main" keeps the library default (no LoadControl).
        if (screenId != MAIN) {
            val loadControl = DefaultLoadControl.Builder()
                .setBufferDurationsMs(4000, 15000, 1000, 2000)
                .build()
            builder.setLoadControl(loadControl)
        }
        val p = builder.build()
        p.setVideoTextureView(s.textureView)
        p.volume = s.volume
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && s.currentUrl != null) {
                    if (s.isLive) { reconnect(s, screenId); return }
                    notifyListeners("playerState", JSObject().put("screenId", screenId).put("state", "ended"))
                    return
                }
                val str = when (state) {
                    Player.STATE_IDLE -> "idle"
                    Player.STATE_BUFFERING -> "buffering"
                    Player.STATE_READY -> "ready"
                    Player.STATE_ENDED -> "ended"
                    else -> "unknown"
                }
                notifyListeners("playerState", JSObject().put("screenId", screenId).put("state", str))
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                notifyListeners("playerState", JSObject().put("screenId", screenId).put("playing", isPlaying))
            }
            override fun onRenderedFirstFrame() {
                s.firstFrameSeen = true
                s.reconnectAttempts = 0
                s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
                s.watchdogRunnable = null
            }
            override fun onPlayerError(error: PlaybackException) {
                val code = error.errorCode
                val isAudio = code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                    code == PlaybackException.ERROR_CODE_DECODING_FAILED ||
                    code == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED ||
                    code == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED
                if (isAudio) {
                    notifyListeners(
                        "playerError",
                        JSObject().put("screenId", screenId).put("code", "AUDIO_DECODE").put("message", error.message ?: "Audio decoder failed"),
                    )
                    return
                }
                if (s.currentUrl != null && s.reconnectAttempts < MAX_RECONNECTS) {
                    reconnect(s, screenId)
                    return
                }
                notifyListeners("playerError", JSObject().put("screenId", screenId).put("code", error.errorCodeName).put("message", error.message ?: "Playback error"))
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                notifyListeners("tracksChanged", JSObject().put("screenId", screenId))
            }
            override fun onCues(cueGroup: CueGroup) {
                s.subtitleView?.setCues(cueGroup.cues)
            }
        })
        s.player = p
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        val live = call.getBoolean("live", true) ?: true
        val subs = call.getArray("subtitles", null)
        val screenId = screenIdOf(call)
        val s = slotFor(screenId)
        activity?.runOnUiThread {
            if (!ensureSurface(s)) { call.reject("no activity/webview"); return@runOnUiThread }
            if (s.player == null) buildPlayer(s, screenId)
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // Apply any pendingRect captured before the surface existed. Non-main
            // slots with NO pendingRect stay INVISIBLE until setRect flips them
            // VISIBLE so a freshly-loaded multiview slot never briefly paints
            // fullscreen over the other tiles.
            val pending = s.pendingRect
            val c = s.container
            if (c != null) {
                if (pending != null) {
                    val fs = pending[4] == 1
                    val lp = c.layoutParams
                    if (fs) {
                        lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                        lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                        c.x = 0f; c.y = 0f
                    } else {
                        lp.width = pending[2]
                        lp.height = pending[3]
                        c.x = pending[0].toFloat()
                        c.y = pending[1].toFloat()
                    }
                    c.layoutParams = lp
                    c.requestLayout()
                    c.visibility = View.VISIBLE
                } else if (screenId == MAIN) {
                    c.visibility = View.VISIBLE
                } else {
                    c.visibility = View.INVISIBLE
                }
            }
            val p = s.player ?: run { call.reject("player init failed"); return@runOnUiThread }
            cancelTimers(s)
            s.currentUrl = url
            s.currentSubtitles = subs
            s.isLive = live
            s.lastPositionMs = 0L
            s.reconnectAttempts = 0
            s.firstFrameSeen = false
            p.setMediaItem(buildMediaItem(url, subs))
            p.prepare()
            if (live) {
                p.playWhenReady = true
            } else {
                // VOD: pre-buffer ≥10s (or 12s wall-clock) before starting so
                // slow Plex servers don't cause the "playing → immediate
                // rebuffer" flash and the JS overlay's slow-load watchdog.
                p.playWhenReady = false
                schedulePreBuffer(s)
            }
            scheduleWatchdog(s, screenId)
            schedulePositionTick(s)
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) { val s = slot(call); activity?.runOnUiThread { s.player?.play(); call.resolve() } }

    @PluginMethod
    fun pause(call: PluginCall) { val s = slot(call); activity?.runOnUiThread { s.player?.pause(); call.resolve() } }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val pos = call.getDouble("position") ?: 0.0
        val s = slot(call)
        activity?.runOnUiThread {
            val p = s.player
            if (p != null) {
                val ms = (pos * 1000.0).toLong().coerceAtLeast(0L)
                p.seekTo(ms)
                s.lastPositionMs = ms
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun getPosition(call: PluginCall) {
        val s = slot(call)
        activity?.runOnUiThread {
            val p = s.player
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

    private fun stopSlot(s: PlayerSlot) {
        s.currentUrl = null
        s.currentSubtitles = null
        s.lastPositionMs = 0L
        cancelTimers(s)
        s.reconnectAttempts = 0
        s.firstFrameSeen = false
        s.player?.stop()
        s.player?.clearMediaItems()
        s.subtitleView?.setCues(emptyList())
        s.container?.visibility = View.GONE
        s.pendingRect = null
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val s = slot(call)
        activity?.runOnUiThread {
            stopSlot(s)
            if (!anySlotStreaming()) {
                activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun stopAll(call: PluginCall) {
        activity?.runOnUiThread {
            for (s in slots.values) stopSlot(s)
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val v = call.getFloat("volume") ?: 1f
        val s = slot(call)
        s.volume = v.coerceIn(0f, 1f)
        activity?.runOnUiThread { s.player?.volume = s.volume; call.resolve() }
    }

    @PluginMethod
    fun setAudioEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", true) ?: true
        val s = slot(call)
        activity?.runOnUiThread {
            val p = s.player
            if (p != null) {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, !enabled)
                    .build()
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun setRect(call: PluginCall) {
        val x = call.getInt("x") ?: 0
        val y = call.getInt("y") ?: 0
        val w = call.getInt("width") ?: 0
        val h = call.getInt("height") ?: 0
        val fs = call.getBoolean("fullscreen", false) ?: false
        val cssW = call.getInt("cssW") ?: 0
        val cssH = call.getInt("cssH") ?: 0
        val s = slot(call)
        val screenId = screenIdOf(call)
        activity?.runOnUiThread {
            // Guard: only an explicit fullscreen=true request may size to
            // MATCH_PARENT. Degenerate zero/negative multiview rects are
            // dropped so they can NEVER accidentally cover other tiles.
            if (!fs && (w <= 0 || h <= 0)) { call.resolve(); return@runOnUiThread }

            ensureSurface(s)
            val c = s.container ?: run {
                // Surface not built yet — remember the request for load().
                s.pendingRect = if (fs) intArrayOf(0, 0, 0, 0, 1)
                    else intArrayOf(x, y, w, h, 0)
                call.resolve(); return@runOnUiThread
            }
            val lp = c.layoutParams
            if (fs) {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                c.x = 0f; c.y = 0f
                s.pendingRect = intArrayOf(0, 0, 0, 0, 1)
            } else {
                val wvW = bridge?.webView?.width ?: 0
                val wvH = bridge?.webView?.height ?: 0
                val density = activity?.resources?.displayMetrics?.density ?: 1f
                val sx = if (cssW > 0 && wvW > 0) wvW.toFloat() / cssW else density
                val sy = if (cssH > 0 && wvH > 0) wvH.toFloat() / cssH else density
                val devX = Math.round(x * sx)
                val devY = Math.round(y * sy)
                val devW = Math.round(w * sx)
                val devH = Math.round(h * sy)
                lp.width = devW
                lp.height = devH
                c.x = devX.toFloat()
                c.y = devY.toFloat()
                s.pendingRect = intArrayOf(devX, devY, devW, devH, 0)
            }
            c.layoutParams = lp
            c.requestLayout()
            // Non-main slots that already have a URL loaded must become VISIBLE
            // now that a real rect has arrived.
            if (screenId != MAIN && s.currentUrl != null && c.visibility != View.VISIBLE) {
                c.visibility = View.VISIBLE
            }
            // Z-order guard: keep our container directly BENEATH the WebView so
            // the transparent HTML chrome always composites above the video.
            val parent = c.parent as? ViewGroup
            val wv = bridge?.webView
            if (parent != null && wv != null) {
                val wvIdx = parent.indexOfChild(wv)
                if (wvIdx > 0 && parent.indexOfChild(c) != wvIdx - 1) {
                    parent.removeView(c)
                    parent.addView(c, parent.indexOfChild(wv))
                }
            }
            call.resolve()
        }
    }

    private fun listTracks(call: PluginCall, type: Int) {
        val s = slot(call)
        activity?.runOnUiThread {
            val out = JSArray()
            val p = s.player
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
        val s = slot(call)
        activity?.runOnUiThread {
            val p = s.player
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
            for (s in slots.values) {
                cancelTimers(s)
                s.currentUrl = null
                s.player?.release()
                s.player = null
            }
            slots.clear()
        }
        super.handleOnDestroy()
    }
}
