@file:androidx.media3.common.util.UnstableApi

package com.snowmedia.player

import android.graphics.Color
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.text.CueGroup
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.SubtitleView
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SnowPlayer")
class SnowPlayerPlugin : Plugin() {

    private var player: ExoPlayer? = null
    private var trackSelector: DefaultTrackSelector? = null
    private var textureView: TextureView? = null
    private var subtitleView: SubtitleView? = null
    private var container: FrameLayout? = null
    private var volume: Float = 1f
    private var lastRect: IntArray? = null

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
        // Closed-caption / subtitle renderer, layered above the video surface.
        // Cues arrive via Player.Listener.onCues when a text track is selected.
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
        val p = ExoPlayer.Builder(act).setTrackSelector(ts).build()
        p.setVideoTextureView(textureView)
        p.volume = volume
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
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
            override fun onPlayerError(error: PlaybackException) {
                notifyListeners("playerError", JSObject().put("code", error.errorCodeName).put("message", error.message ?: "Playback error"))
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                notifyListeners("tracksChanged", JSObject())
            }
        })
        player = p
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        activity?.runOnUiThread {
            if (!ensureSurface()) { call.reject("no activity/webview"); return@runOnUiThread }
            if (player == null) buildPlayer()
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            container?.visibility = View.VISIBLE
            val p = player ?: run { call.reject("player init failed"); return@runOnUiThread }
            p.setMediaItem(MediaItem.fromUri(url))
            p.prepare()
            p.playWhenReady = true
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) { activity?.runOnUiThread { player?.play(); call.resolve() } }

    @PluginMethod
    fun pause(call: PluginCall) { activity?.runOnUiThread { player?.pause(); call.resolve() } }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity?.runOnUiThread {
            player?.stop()
            player?.clearMediaItems()
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
            player?.release()
            player = null
        }
        super.handleOnDestroy()
    }
}
