@file:androidx.media3.common.util.UnstableApi

package com.snowmedia.player

import android.app.ActivityManager
import android.content.Context
import android.graphics.Color
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaLibraryInfo
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
// Direct reference so the build FAILS if the FFmpeg decoder dependency ever
// drops out, instead of silently regressing to "video plays, no sound".
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DecoderCounters
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultAllocator
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.SubtitleView
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.snowmedia.BuildConfig
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

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
        // The main player's load control (a film's 4K budget, start and
        // restart after a stall; see SteadyLoadControl). Null on tiles.
        var loadControl: SteadyLoadControl? = null
        var textureView: TextureView? = null
        // Opaque black view between the picture and the subtitles. A
        // TextureView keeps showing the last frame it was given — through
        // stop(), setMediaItem() and the container going GONE and back — so
        // without this every channel change, and Live TV → Plex, opened on a
        // frozen frame of the previous stream until the new one drew. Closed
        // on every load, opened on that load's first rendered frame (the
        // same thing PlayerView's exo_shutter does).
        var shutterView: View? = null
        var subtitleView: SubtitleView? = null
        var container: FrameLayout? = null
        /** 0..MAX_VOLUME. Past 1 the player stays at full volume and `boost`
         *  adds the rest. */
        var volume: Float = 1f
        /** The volume boost past 100% on this player's audio session. */
        var boost: LoudnessEnhancer? = null
        var currentUrl: String? = null
        var currentSubtitles: JSArray? = null
        var isLive: Boolean = true
        var lastPositionMs: Long = 0L
        var reconnectAttempts: Int = 0
        var firstFrameSeen: Boolean = false
        // Screen format. ExoPlayer stretches the picture to fill its
        // TextureView, so the view is sized to the picture's shape. These
        // three remember that shape, and applyFormat() does the work.
        var videoW: Int = 0
        var videoH: Int = 0
        var pixelRatio: Float = 1f
        var format: String = "fit"   // literal: see FORMAT_* in the companion
        var watchdogRunnable: Runnable? = null
        var reconnectRunnable: Runnable? = null
        var positionTickRunnable: Runnable? = null
        // VOD only: while we hold playback with playWhenReady=false until the
        // player has PREBUFFER_TARGET_MS buffered (or PreBufferRule's time limit
        // wall-clock elapse). Prevents the initial "playing → immediate
        // rebuffer" flash on slow Plex servers.
        var preBufferRunnable: Runnable? = null
        // Rect requested BEFORE the surface existed (or before load()). load()
        // applies this after ensureSurface. Null = "no explicit rect yet".
        // IntArray of size 5: [x, y, w, h, fullscreenFlag(0/1)].
        var pendingRect: IntArray? = null
        // True while schedulePreBuffer holds a VOD start at playWhenReady=false.
        // That is not the viewer pausing, so it is never reported as a pause.
        var holding: Boolean = false
        var reportedPaused: Boolean = false
        // Bytes the player's own HTTP sources have received (added on loader
        // threads), turned into Mb/s by the 'bandwidth' tick. Counting what
        // the player downloads anyway costs no extra network.
        val netBytes = AtomicLong(0L)
        var bandwidthRunnable: Runnable? = null
        var lastKbps: Long = -1L
        // What getStats reports. The speeds are the bandwidth tick's samples
        // since this load, counting only the windows in which data arrived
        // (a pause or a full buffer is not the server being slow).
        var kbpsMin: Long = -1L
        var kbpsMax: Long = -1L
        var kbpsSum: Long = 0L
        var kbpsSamples: Int = 0
        // Restarts of this title (the URL they belong to): a retry loads it
        // again but keeps its history; a stop ends it (clearStats).
        // lastError is the code name of the last error that made the player
        // restart or stop, set before its playerError goes out.
        var statsUrl: String? = null
        var restarts: Int = 0
        var lastRestartReason: String? = null
        var lastError: String? = null
        // Frames of this load: the decoder sessions that have ended, plus
        // the running one's own counters (see the analytics listener).
        var framesRendered: Long = 0L
        var framesDropped: Long = 0L
        var videoCounters: DecoderCounters? = null
        var framesSeen: Boolean = false
        // The decoders in use. Kept from one load to the next while the
        // player plays on: it keeps a hardware decoder for the next stream
        // when it can, and reports only when it lets one go. A stop releases
        // them, and clears these with the rest.
        var videoDecoderName: String? = null
        var audioDecoderName: String? = null
        var loadProfile: String? = null
        // The formats last described, so a panel asking every second gets
        // the same text back instead of it being built again each time.
        var videoFormatOf: Format? = null
        var videoFormatText: String? = null
        var audioFormatOf: Format? = null
        var audioFormatText: String? = null
    }

    private val slots = HashMap<String, PlayerSlot>()
    private val mainHandler = Handler(Looper.getMainLooper())
    // The main player's own Wi-Fi lock (see holdWifi). Created on first use.
    private var wifiLock: WifiManager.WifiLock? = null
    // Scratch for isCurrentItem (main thread only, like every player call).
    private val itemWindow = Timeline.Window()

    companion object {
        private const val MAIN = "main"
        private const val TAG = "SnowPlayer"
        /** Volume goes to 150%; the last 50% is a boost (see applyBoost). */
        private const val MAX_VOLUME = 1.5f
        /** Boost gain per 100% past full: +10 dB at 150%. LoudnessEnhancer
         *  limits, so the louder parts stay clean instead of clipping. */
        private const val BOOST_MB_PER_UNIT = 2000f
        // Screen format names, shared with the WebView (src/capacitor/SnowPlayer.ts).
        const val FORMAT_FIT = "fit"
        const val FORMAT_FILL = "fill"
        const val FORMAT_ZOOM = "zoom"
        const val FORMAT_WIDE = "wide"
        val FORMATS = listOf(FORMAT_FIT, FORMAT_FILL, FORMAT_ZOOM, FORMAT_WIDE)
        private const val MAX_RECONNECTS = 20
        // A film or episode gives up sooner. Each of these follows the
        // player's own seven tries at the connection (retry count 6 below,
        // waiting 15 s between them in all): against a Plex server that
        // doesn't answer at all (15 s per try to connect) that is about two
        // minutes; against one that turns the file down (an HTTP error, a
        // closed port) about 15 s. 20 in a row spun for over 40 minutes
        // before anything was said. With 3 the plugin gives up after the
        // fourth failure: about 8 minutes of a dead server, about a minute of
        // a refusal. The WebView then makes one fresh start, which takes as
        // long again, and shows the error: about 16 minutes after the server
        // went silent (5 took about 24), about 2 after a refusal. A picture
        // in between starts the count over.
        private const val MAX_VOD_RECONNECTS = 3
        private const val RECONNECT_DELAY_MS = 500L
        private const val FIRST_FRAME_TIMEOUT_MS = 8000L
        private const val POSITION_TICK_MS = 5000L
        private const val BANDWIDTH_TICK_MS = 3000L
        // VOD start: time spent on nothing but filling the buffer, so a film
        // starts with ~25 s in hand instead of the 2.5 s the player needs to
        // begin (which the first dip in the server's speed empties). A fast
        // connection gets there in a second or two and starts at once. How
        // long at most: PreBufferRule (a start part-way into a file counts
        // its 10 s from the first video at the resume point).
        private const val PREBUFFER_TARGET_MS = PreBufferRule.TARGET_MS
        private const val PREBUFFER_TICK_MS = 500L
        private const val MIB = 1024L * 1024L
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
        s.holding = false
        s.bandwidthRunnable?.let { mainHandler.removeCallbacks(it) }
        s.bandwidthRunnable = null
    }

    /**
     * Main slot: every 3 s, how fast the player's downloads are arriving
     * (network bytes over the window, kbps) as a 'bandwidth' event, so the
     * buffering card can show the speed right now next to what the video
     * needs. The bandwidth meter's own estimate is no use here: it starts from
     * a guess by network type and only updates when a transfer ends, which a
     * file played as-is (one long transfer) hardly ever does. Once nothing
     * flows (paused, buffer full) it reports the 0 once and then stays quiet.
     * Each window with data in it also goes into this stream's slowest,
     * fastest and average speed for getStats.
     */
    private fun scheduleBandwidthTick(s: PlayerSlot, screenId: String) {
        s.bandwidthRunnable?.let { mainHandler.removeCallbacks(it) }
        s.bandwidthRunnable = null
        if (screenId != MAIN) return
        s.lastKbps = -1L
        var lastBytes = s.netBytes.get()
        var lastAt = SystemClock.elapsedRealtime()
        val r = object : Runnable {
            override fun run() {
                if (s.currentUrl == null) return
                val now = SystemClock.elapsedRealtime()
                val bytes = s.netBytes.get()
                val ms = now - lastAt
                if (ms > 0) {
                    val kbps = (bytes - lastBytes) * 8L / ms
                    if (kbps > 0L || s.lastKbps != 0L) {
                        notifyListeners("bandwidth", JSObject().put("screenId", screenId).put("kbps", kbps))
                    }
                    s.lastKbps = kbps
                    if (kbps > 0L) {
                        if (s.kbpsMin < 0L || kbps < s.kbpsMin) s.kbpsMin = kbps
                        if (kbps > s.kbpsMax) s.kbpsMax = kbps
                        s.kbpsSum += kbps
                        s.kbpsSamples++
                    }
                }
                lastBytes = bytes
                lastAt = now
                mainHandler.postDelayed(this, BANDWIDTH_TICK_MS)
            }
        }
        s.bandwidthRunnable = r
        mainHandler.postDelayed(r, BANDWIDTH_TICK_MS)
    }

    /**
     * 'paused': playback is stopped on purpose — the viewer, or the system
     * (headphones out). Not a stall: 'playing' (isPlaying) also drops on every
     * rebuffer, so the control bar can't tell a pause from it. Not the VOD
     * pre-buffer hold either. Sent only when it changes.
     */
    private fun reportPaused(s: PlayerSlot, screenId: String) {
        val p = s.player ?: return
        val paused = !p.playWhenReady && !s.holding
        if (paused == s.reportedPaused) return
        s.reportedPaused = paused
        notifyListeners("playerState", JSObject().put("screenId", screenId).put("paused", paused))
    }

    /** A new load: this stream's speeds and frames start over. Its restarts
     *  and last error belong to the title, so loading the same one again (a
     *  retry, the WebView's fresh start after RECONNECT_EXHAUSTED) keeps
     *  them; another title clears them, and a stop everything (clearStats). */
    private fun resetStats(s: PlayerSlot, url: String) {
        s.kbpsMin = -1L
        s.kbpsMax = -1L
        s.kbpsSum = 0L
        s.kbpsSamples = 0
        s.framesRendered = 0L
        s.framesDropped = 0L
        s.videoCounters = null
        s.framesSeen = false
        if (url != s.statsUrl) {
            s.statsUrl = url
            s.restarts = 0
            s.lastRestartReason = null
            s.lastError = null
        }
    }

    /** A stop: nothing of the stream that was playing is left to report. Its
     *  speeds, frames, restarts and last error go, and so do its decoders and
     *  formats, which the next stream would otherwise show until its own
     *  arrive. The next load starts from nothing, the same title included. */
    private fun clearStats(s: PlayerSlot) {
        s.lastKbps = -1L
        s.kbpsMin = -1L
        s.kbpsMax = -1L
        s.kbpsSum = 0L
        s.kbpsSamples = 0
        s.framesRendered = 0L
        s.framesDropped = 0L
        s.videoCounters = null
        s.framesSeen = false
        s.statsUrl = null
        s.restarts = 0
        s.lastRestartReason = null
        s.lastError = null
        s.videoDecoderName = null
        s.audioDecoderName = null
        s.videoFormatOf = null
        s.videoFormatText = null
        s.audioFormatOf = null
        s.audioFormatText = null
    }

    /**
     * Whether an analytics callback is about the item the player holds now.
     * They reach this thread after the fact, so a stream's last ones (its
     * decoder let go, or even set up) can arrive once the next one has been
     * loaded or the player stopped, and would put that stream's decoder or
     * frames on the new one's stats. Every load (setMediaItem) is a playlist
     * entry with a uid of its own, and each callback carries the entry it was
     * raised for next to the player's current one. Nothing loaded: false.
     */
    private fun isCurrentItem(t: AnalyticsListener.EventTime): Boolean {
        val its = t.timeline
        val now = t.currentTimeline
        if (its.isEmpty || now.isEmpty) return false
        if (t.windowIndex !in 0 until its.windowCount || t.currentWindowIndex !in 0 until now.windowCount) return false
        val uid = its.getWindow(t.windowIndex, itemWindow).uid
        return uid == now.getWindow(t.currentWindowIndex, itemWindow).uid
    }

    /** A play or pause during the VOD pre-buffer hold ends it: the viewer's
     *  choice wins over the timer, which would otherwise start a paused film. */
    private fun releaseHold(s: PlayerSlot) {
        if (!s.holding) return
        s.preBufferRunnable?.let { mainHandler.removeCallbacks(it) }
        s.preBufferRunnable = null
        s.holding = false
        openShutterIfReady(s)
    }

    /** Uncover the picture: this stream has drawn its first frame and is not
     *  in its start-up hold (VideoFit.shutterOpen). The hold draws the first
     *  frame paused; "Getting ready…" stays over black until the film starts,
     *  or the viewer plays or pauses. The only place the shutter opens. */
    private fun openShutterIfReady(s: PlayerSlot) {
        if (s.currentUrl == null || !VideoFit.shutterOpen(s.firstFrameSeen, s.holding)) return
        s.shutterView?.visibility = View.INVISIBLE
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

    /** No picture within 8 s → reconnect. Not for a Plex film or episode:
     *  one that is slow to start is left to PlexSection's own watchdog (8 s
     *  for a file played as it is, 30 s for a conversion, then it offers what
     *  to do). Here it threw away whatever had loaded and started again from
     *  nothing, up to 20 times — a slow remote server never got to begin.
     *  Live channels and Backups films have no watchdog of their own in the
     *  WebView, so they keep this one. */
    private fun scheduleWatchdog(s: PlayerSlot, screenId: String) {
        s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        s.watchdogRunnable = null
        val url = s.currentUrl ?: return
        if (!s.isLive && isPlexStream(Uri.parse(url))) return
        val r = Runnable {
            // A radio channel never renders a video frame. It used to be torn
            // down and reconnected every 8 s (≈120 times) while playing fine.
            val p = s.player
            val audioOnly = p != null && p.isPlaying && !p.currentTracks.containsType(C.TRACK_TYPE_VIDEO)
            if (s.currentUrl != null && !s.firstFrameSeen && !audioOnly) reconnect(s, screenId, "no picture in 8 s")
        }
        s.watchdogRunnable = r
        mainHandler.postDelayed(r, FIRST_FRAME_TIMEOUT_MS)
    }

    /** VOD pre-buffer: hold playWhenReady=false until the player has
     *  PREBUFFER_TARGET_MS buffered ahead, has stopped loading (the buffer is
     *  as full as its limits allow — a 4K remux fills the byte cap well
     *  before 25 s — or the file is shorter), or has had its time to fill
     *  (PreBufferRule: 10 s from load() for a start from 0:00; for a start
     *  part-way into the file, `midFile`, 10 s from the first video at the
     *  resume point, 30 s in all at most; a 4K film until it has 20 s, or
     *  30 s of filling at most). Live streams keep the legacy
     *  behavior (start at once). The main slot reports progress as
     *  'preBuffer' events every tick, so the WebView can show "Getting
     *  ready…" instead of a still frame. */
    private fun schedulePreBuffer(s: PlayerSlot, screenId: String, midFile: Boolean) {
        s.preBufferRunnable?.let { mainHandler.removeCallbacks(it) }
        val startedAt = SystemClock.elapsedRealtime()
        val url = s.currentUrl
        var flowAt = 0L
        val r = object : Runnable {
            override fun run() {
                val p = s.player ?: return
                if (s.currentUrl == null || s.currentUrl != url) return
                val bufMs = (p.bufferedPosition - p.currentPosition).coerceAtLeast(0L)
                val now = SystemClock.elapsedRealtime()
                val elapsed = now - startedAt
                val state = p.playbackState
                val ready = state == Player.STATE_READY
                flowAt = PreBufferRule.flowStart(flowAt, now, midFile, bufMs, ready)
                // A 4K film (known once its tracks are selected) waits for a
                // steady buffer (PreBufferRule.UHD_*).
                val uhd = s.loadControl?.uhd == true
                val done = PreBufferRule.isDone(
                    midFile, elapsed, flowAt, now, bufMs, ready,
                    loading = p.isLoading, ended = state == Player.STATE_ENDED, uhd = uhd,
                )
                if (screenId == MAIN) {
                    // The indicator's clock: the filling time, which for a
                    // start part-way in begins once video arrives there.
                    val shownElapsed = if (!midFile) elapsed else if (flowAt > 0L) now - flowAt else 0L
                    notifyListeners(
                        "preBuffer",
                        JSObject().put("screenId", screenId)
                            .put("bufferedMs", bufMs)
                            .put("targetMs", PREBUFFER_TARGET_MS)
                            .put("elapsedMs", shownElapsed)
                            .put("maxWaitMs", PreBufferRule.maxWaitMs(uhd))
                            .put("done", done),
                    )
                }
                if (done) {
                    s.holding = false
                    p.playWhenReady = true
                    openShutterIfReady(s)
                    s.preBufferRunnable = null
                    return
                }
                mainHandler.postDelayed(this, PREBUFFER_TICK_MS)
            }
        }
        s.preBufferRunnable = r
        mainHandler.postDelayed(r, PREBUFFER_TICK_MS)
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

    /** `reason` is what the stats panel shows as the last restart. */
    private fun reconnect(s: PlayerSlot, screenId: String, reason: String) {
        val url = s.currentUrl ?: return
        if (s.reconnectAttempts >= MAX_RECONNECTS) {
            releaseWifiIfStopped(s)
            notifyListeners(
                "playerError",
                JSObject().put("screenId", screenId)
                    .put("code", "RECONNECT_EXHAUSTED")
                    .put("message", "The stream keeps dropping. Try again."),
            )
            return
        }
        s.reconnectAttempts++
        s.restarts++
        s.lastRestartReason = reason
        notifyListeners("playerState", JSObject().put("screenId", screenId).put("state", "buffering"))
        s.reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            val p = s.player ?: return@Runnable
            if (s.currentUrl == null) return@Runnable
            s.firstFrameSeen = false
            if (s.isLive) {
                p.setMediaItem(buildMediaItem(url, s.currentSubtitles))
                p.prepare()
                p.playWhenReady = true
                scheduleWatchdog(s, screenId)
            } else {
                resumeVod(s, screenId, p, url)
                scheduleWatchdog(s, screenId) // not for Plex (see there)
            }
        }
        s.reconnectRunnable = r
        mainHandler.postDelayed(r, RECONNECT_DELAY_MS)
    }

    /**
     * A film or episode whose connection failed carries on from the same
     * place. After a fatal error the player is idle but still holds the item,
     * its length and the position, so prepare() just opens a new connection
     * there. This used to load the item again from scratch at whatever the
     * 5-second tick had last seen, and force it to play: a paused film
     * started by itself, and a start still filling its buffer began at once.
     * The viewer's play or pause now stands, and a start-up hold that was
     * running starts over on the new connection.
     */
    private fun resumeVod(s: PlayerSlot, screenId: String, p: ExoPlayer, url: String) {
        val pos = p.currentPosition
        val resumeAt = if (pos > 0) pos else s.lastPositionMs
        if (resumeAt > 0) s.lastPositionMs = resumeAt
        val hold = s.holding
        s.preBufferRunnable?.let { mainHandler.removeCallbacks(it) }
        s.preBufferRunnable = null
        if (p.playbackState == Player.STATE_IDLE && p.currentMediaItem != null) {
            if (pos <= 0 && resumeAt > 0) p.seekTo(resumeAt)
        } else {
            // Not the usual failed, idle player: load the item afresh, still
            // at the viewer's place.
            p.setMediaItem(buildMediaItem(url, s.currentSubtitles), resumeAt)
        }
        p.prepare()
        if (hold) {
            p.playWhenReady = false
            schedulePreBuffer(s, screenId, midFile = resumeAt > 0)
        }
    }

    /**
     * What a film that has given up (RECONNECT_EXHAUSTED) tells the viewer,
     * by how the server failed. One that stopped answering is worth another
     * try; one that turned the file down (with its HTTP status when there is
     * one) will most likely do it again, and it used to be reported as
     * "stopped responding" too. Anything else in the player's own words.
     * Never a URL: of an HTTP error only the status is used, and a message
     * with an address in it gives way to a plain one.
     */
    private fun exhaustedMessage(error: PlaybackException, url: String): String {
        val server = if (isPlexStream(Uri.parse(url))) "The Plex server" else "The server"
        return when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            -> "The server stopped responding. Try again."
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> {
                val status = httpStatusOf(error)
                if (status != null) "$server refused this file (HTTP $status)." else "$server refused this file."
            }
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
            -> "$server refused this file."
            else -> error.message?.takeIf { it.isNotBlank() && !it.contains("://") } ?: "Playback error"
        }
    }

    /** The HTTP status behind ERROR_CODE_IO_BAD_HTTP_STATUS: the data
     *  source's own exception, somewhere down the cause chain. */
    private fun httpStatusOf(error: PlaybackException): Int? {
        var t: Throwable? = error.cause
        var depth = 0
        while (t != null && depth++ < 8) {
            if (t is HttpDataSource.InvalidResponseCodeException) return t.responseCode.takeIf { it > 0 }
            t = t.cause
        }
        return null
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
        // Sized to the picture and centred by applyFormat (VideoFit): the
        // letterbox bars are this box's black, never unpainted picture view.
        fl.addView(tv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        // A new box size (fullscreen, a tile, the first layout) fits the
        // picture again. Posted: this runs inside the layout pass.
        fl.addOnLayoutChangeListener { v, l, t, r, b, ol, ot, or, ob ->
            if (r - l != or - ol || b - t != ob - ot) v.post { applyFormat(s) }
        }
        // Above the picture, below the subtitles. Starts closed: nothing has
        // been drawn yet.
        val shutter = View(act)
        shutter.setBackgroundColor(Color.BLACK)
        fl.addView(shutter, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        s.shutterView = shutter
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

    /** What the stats panel shows as "how far ahead the player reads": the
     *  profile, and for a 4K film what it gets on top (its own byte budget
     *  where the heap allows one, and the 10 s restart after a stall). */
    private fun loadProfileOf(s: PlayerSlot): String? {
        val base = s.loadProfile ?: return null
        val lc = s.loadControl
        if (lc == null || !lc.uhd) return base
        val budget = if (lc.uhdBudgetBytes > 0 && lc.budgetBytes > 0) "${lc.budgetBytes / MIB} MB, " else ""
        return "$base · 4K: ${budget}${UhdBuffer.REBUFFER_MS / 1000} s restart"
    }

    private fun isLowRamBox(ctx: Context): Boolean {
        return try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            am.isLowRamDevice || mi.totalMem <= 2_200_000_000L
        } catch (e: Throwable) {
            false
        }
    }

    /**
     * A film or episode on the main player keeps the Wi-Fi radio at full
     * speed for as long as it is loaded: playing, paused, and while its start
     * is held to fill the buffer. Media3's own lock (setWakeMode in
     * buildPlayer) is held only while the player is set to play, so during
     * that start-up hold and every pause — both times when the buffer is
     * still being filled — the radio could drop into power saving.
     * Low-latency mode on Android 10 and later (it works only with the app in
     * front and the screen on, which is always the case while watching),
     * high-performance before that. A box with no Wi-Fi (Ethernet only)
     * simply has nothing to lock. Live TV — channels and the Live TV / Guide
     * preview boxes — never takes it and plays on Media3's lock alone, as it
     * always has. Let go on stop, when a channel loads, and when a film
     * stops on an error the plugin won't retry (releaseWifiIfStopped).
     */
    private fun holdWifi() {
        try {
            val lock = wifiLock ?: run {
                val wm = activity?.applicationContext?.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
                @Suppress("DEPRECATION")
                val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    else WifiManager.WIFI_MODE_FULL_HIGH_PERF
                wm.createWifiLock(mode, "SnowMediaCenter:player").also {
                    it.setReferenceCounted(false)
                    wifiLock = it
                }
            }
            if (!lock.isHeld) lock.acquire()
        } catch (e: Throwable) {
            Log.w(TAG, "No Wi-Fi lock for playback", e)
        }
    }

    private fun releaseWifi() {
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (_: Throwable) { /* never held */ }
    }

    /** A film on the main player that has stopped on an error the plugin
     *  won't retry lets the radio go, once nothing is loading any more: the
     *  error panel can sit there for as long as the viewer leaves it. The
     *  WebView's retry is a load(), which takes the lock again. Live TV never
     *  holds it, so this leaves a channel alone. */
    private fun releaseWifiIfStopped(s: PlayerSlot) {
        if (slots[MAIN] !== s || s.isLive || s.player?.isLoading == true) return
        releaseWifi()
    }

    /** Multi-Screen tiles: stop() only stopped the media, so after one visit
     *  up to four players (threads, views, last-frame buffers) stayed alive
     *  for the rest of the session. load() rebuilds all of this on demand. */
    private fun releaseSlot(s: PlayerSlot) {
        releaseBoost(s)
        s.player?.release()
        s.player = null
        s.trackSelector = null
        s.loadControl = null
        s.container?.let { c -> (c.parent as? ViewGroup)?.removeView(c) }
        s.container = null
        s.textureView = null
        s.shutterView = null
        s.subtitleView = null
        s.videoW = 0
        s.videoH = 0
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
        val meter = ByteMeter(s.netBytes)
        // Live TV and everything else: quick 8 s timeouts, and no user agent
        // of our own (some IPTV panels turn away agents they don't know).
        val httpFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000)
            .setTransferListener(meter)
        // Plex — a file played as it is, or a conversion — is patient. A
        // remote or shared server often goes quiet for more than 8 s: reading
        // from cloud storage, waking a drive, or converting, where the playlist
        // and first segments come only once the transcoder has them. At 8 s
        // the read was dropped and the file opened again, which costs more
        // than the pause did; up to 30 s the buffer simply rides it out. It
        // also says who is asking, like any Plex player, instead of the bare
        // "Dalvik/2.1.0" Android sends by default.
        val plexFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)
            .setUserAgent(
                "SnowMediaCenter/${BuildConfig.VERSION_NAME} (Linux; Android ${Build.VERSION.RELEASE}) " +
                    "ExoPlayerLib/${MediaLibraryInfo.VERSION}",
            )
            .setTransferListener(meter)
        // A conversion (playlist and segments) is as patient, but goes out
        // with Android's own user agent, as it did up to build 38, when the
        // owner's server still started conversions for SMC. Build 39 sent
        // the agent above on these too, and on the owner's TV no conversion
        // has started since (a quality change, the automatic drop). Of what
        // the player itself sends for a conversion, the agent is all that
        // changed, and a Plex server can pick how it converts by who asks,
        // so the conversions get back the agent they worked with. The file
        // played as it is keeps SMC's own, with which it plays well.
        val transcodeFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)
            .setTransferListener(meter)
        val dataSourceFactory = DefaultDataSource.Factory(act, PlexAwareFactory(httpFactory, plexFactory, transcodeFactory))
        // Closed captions on raw MPEG-TS live streams.
        //
        // By default Media3 only creates a caption track when the PMT carries an
        // ATSC caption_service_descriptor (tag 0x86). IPTV re-encoders routinely
        // pass the CEA-608 bytes through in the video SEI but drop that
        // descriptor — and with no descriptor the default closedCaptionFormats
        // list is empty, so SeiReader allocates ZERO track outputs and the
        // captions become permanently invisible (they exist in the stream, but
        // nothing ever surfaces them). FLAG_OVERRIDE_CAPTION_DESCRIPTORS plus an
        // explicit CEA-608 format makes the 608 track appear regardless.
        //
        // Trade-off: channels carrying no captions at all now also expose a CC
        // entry that renders nothing. That is the accepted cost of not losing
        // captions on every channel whose descriptor was stripped.
        val extractorsFactory = DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_OVERRIDE_CAPTION_DESCRIPTORS)
            .setTsSubtitleFormats(
                listOf(Format.Builder().setSampleMimeType(MimeTypes.APPLICATION_CEA608).build()),
            )
        val builder = ExoPlayer.Builder(act, renderersFactory)
            .setTrackSelector(ts)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory)
                    .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6)),
            )
        // Trimmed buffers for non-main slots so up to 4 concurrent players fit
        // in Fire TV memory — capped in bytes too, or a 15 Mb/s tile could
        // hold ~30 MB.
        //
        // "main" keeps its buffer topped up instead of filling it and then
        // waiting. It used to read up to a high mark (60 s, or two minutes)
        // and then stop until the buffer had fallen to a low one (20 s, or
        // one minute). For those 40-60 s the server's connection sat open
        // and unread, and a remote or shared Plex server (cloud storage
        // behind it, a reverse proxy, a router's NAT) drops or goes cold on a
        // connection left like that. The refill then needed a new connection,
        // a new request and a seek on the server, just when only 20 s were
        // left: the film started fine and then buffered, while the Plex app
        // on the same box played it through. With the low mark equal to the
        // high one (Media3's own default is 50 s and 50 s) the player reads a
        // little every second or so, as fast as the video plays, and the
        // connection never goes quiet.
        //
        // Size before time, as Media3 does by default and nearly every app
        // ships: the byte budget, not the time, caps the memory the buffer
        // holds (2 GB boxes keep a short floor under it, below). What size
        // first can't do is save a badly interleaved file that spends the
        // whole budget on one track before the other arrives; with 128 MB
        // and more that takes picture and sound stored over 100 MB apart in
        // the file, where real files keep them within a second or two of
        // each other.
        //
        // Live TV plays through this player too. A live stream can't be read
        // past its live edge, so it never reaches either mark and loads
        // non-stop exactly as it did; the start (2.5 s buffered) and the
        // restart after a stall (5 s) are unchanged.
        val lowRam = isLowRamBox(act)
        if (screenId != MAIN) {
            val loadControl = DefaultLoadControl.Builder()
                .setBufferDurationsMs(4000, 15000, 1000, 2000)
                .setTargetBufferBytes(if (lowRam) 6 * 1024 * 1024 else 10 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build()
            builder.setLoadControl(loadControl)
            s.loadProfile = if (lowRam) "tile · 15 s / 6 MB" else "tile · 15 s / 10 MB"
        } else if (lowRam) {
            // 2 GB-class boxes, where memory is what gets the WebView
            // killed: 50 s ahead within 128 MB, and never less than 20 s. A
            // 1080p film at 8-20 Mb/s keeps its full 50 s (50-125 MB), a
            // 30 Mb/s remux about 35 s. A 4K remux at 60-80 Mb/s would stop
            // at 13-18 s on the bytes alone, which one slow spell of the
            // server's empties; the floor carries it on to 20 s (150-200 MB),
            // what the old time-first profile held for it, and tops it up
            // there as it plays. Only a file above about 54 Mb/s goes past
            // 128 MB, and only as far as its 20 s. A 4K film keeps this
            // budget here (memory first), and gets the 4K start and restart
            // (SteadyLoadControl).
            val lc = SteadyLoadControl(
                minBufferMs = 50000,
                maxBufferMs = 50000,
                bufferForPlaybackMs = 2500,
                bufferForPlaybackAfterRebufferMs = 5000,
                targetBufferBytes = 128 * 1024 * 1024,
                floorMs = 20000,
                uhdBudgetBytes = 0,
            )
            builder.setLoadControl(lc)
            s.loadControl = lc
            s.loadProfile = "steady · 50 s / 128 MB, 20 s floor"
        } else {
            // Boxes with memory to spare: up to two minutes ahead within the
            // library's own byte budget (about 144 MB for a picture and a
            // sound track), the same ceiling as before. A 1080p film at
            // 8-20 Mb/s holds one to two minutes. A 4K film gets a budget of
            // its own, sized to the heap (UhdBuffer: half of it, 256 MiB at
            // most): 27-34 s of a 60-80 Mb/s remux on a 512 MiB heap instead
            // of 14-19 s. Exactly what DefaultLoadControl.Builder built here
            // before for anything that is not a 4K film.
            val uhdBytes = UhdBuffer.budgetBytes(Runtime.getRuntime().maxMemory(), 0)
            val lc = SteadyLoadControl(
                minBufferMs = 120000,
                maxBufferMs = 120000,
                bufferForPlaybackMs = 2500,
                bufferForPlaybackAfterRebufferMs = 5000,
                targetBufferBytes = C.LENGTH_UNSET,
                floorMs = 0,
                uhdBudgetBytes = uhdBytes,
            )
            builder.setLoadControl(lc)
            s.loadControl = lc
            s.loadProfile = "steady · 120 s / 144 MB"
        }
        val p = builder.build()
        // Keep the Wi-Fi radio at full speed while playing. Without a Wi-Fi
        // lock many Android TV boxes drop the radio into power saving once
        // the app is just "showing video", and throughput collapses: a
        // 1080p film buffers on a connection that plays it fine in the Plex
        // app, which (like every streaming app) holds this lock. A VPN can't
        // help with that. Held only while playing; released on pause/stop.
        // A film or episode on the main player also holds its own for the
        // whole stream (holdWifi); Live TV has this one only.
        p.setWakeMode(C.WAKE_MODE_NETWORK)
        p.setVideoTextureView(s.textureView)
        // Our own audio session, so the volume boost (past 100%) has a session
        // to attach to before the first sound is played.
        try { p.setAudioSessionId(Util.generateAudioSessionIdV21(act)) } catch (e: Exception) { Log.w(TAG, "No audio session for the volume boost", e) }
        p.volume = s.volume.coerceAtMost(1f)
        p.addListener(object : Player.Listener {
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                s.videoW = videoSize.width
                s.videoH = videoSize.height
                // Anamorphic content has non-square pixels: 720x480 flagged as
                // widescreen carries a ratio near 1.21, and ignoring it is the
                // difference between a correct picture and a squashed one.
                s.pixelRatio = if (videoSize.pixelWidthHeightRatio > 0f) videoSize.pixelWidthHeightRatio else 1f
                applyFormat(s)
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && s.currentUrl != null) {
                    if (s.isLive) { reconnect(s, screenId, "live stream ended"); return }
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
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                reportPaused(s, screenId)
            }
            override fun onRenderedFirstFrame() {
                // The new stream has drawn: uncover it (once its start-up
                // hold is over, see openShutterIfReady). Never on load or a
                // state change, so no earlier frame can show.
                s.firstFrameSeen = true
                openShutterIfReady(s)
                s.reconnectAttempts = 0
                s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
                s.watchdogRunnable = null
            }
            override fun onPlayerError(error: PlaybackException) {
                val code = error.errorCode
                // First, before any playerError goes out: a handler reads it
                // back with getStats (PlexSection tells a server that turned
                // the file down, ERROR_CODE_IO_BAD_HTTP_STATUS, from one that
                // is gone).
                s.lastError = error.errorCodeName
                val isAudioTrack = code == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED ||
                    code == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED
                val isDecoder = code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                    code == PlaybackException.ERROR_CODE_DECODING_FAILED
                // Only flag decoder failures as AUDIO_DECODE when the failing
                // renderer's format is actually audio; otherwise a video-decoder
                // failure would incorrectly suppress Live TV reconnect.
                val isAudioDecoder = isDecoder && run {
                    val fmt = (error as? androidx.media3.exoplayer.ExoPlaybackException)?.rendererFormat
                    fmt?.sampleMimeType?.startsWith("audio/") == true
                }
                if (isAudioTrack || isAudioDecoder) {
                    releaseWifiIfStopped(s)
                    notifyListeners(
                        "playerError",
                        JSObject().put("screenId", screenId).put("code", "AUDIO_DECODE").put("message", error.message ?: "Audio decoder failed"),
                    )
                    return
                }
                // A film or episode stops after MAX_VOD_RECONNECTS in a row.
                // When the server is what failed (ERROR_CODE_IO_*) it says
                // so as RECONNECT_EXHAUSTED, like a live channel that keeps
                // dropping: the WebView then makes one fresh start and shows
                // the error, in words that say how the server failed
                // (exhaustedMessage). Any other error keeps its own name,
                // which is what sends PlexSection to a server conversion
                // instead.
                val vodSpent = !s.isLive && s.reconnectAttempts >= MAX_VOD_RECONNECTS
                if (s.currentUrl != null && !vodSpent && s.reconnectAttempts < MAX_RECONNECTS) {
                    val reason = when (code) {
                        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                        -> "server stopped responding"
                        else -> "stream error " + error.errorCodeName.removePrefix("ERROR_CODE_")
                    }
                    reconnect(s, screenId, reason)
                    return
                }
                // Not retried here: the player has stopped.
                releaseWifiIfStopped(s)
                val url = s.currentUrl
                if (url != null && vodSpent && error.errorCodeName.startsWith("ERROR_CODE_IO_")) {
                    notifyListeners(
                        "playerError",
                        JSObject().put("screenId", screenId)
                            .put("code", "RECONNECT_EXHAUSTED")
                            .put("message", exhaustedMessage(error, url)),
                    )
                    return
                }
                notifyListeners("playerError", JSObject().put("screenId", screenId).put("code", error.errorCodeName).put("message", error.message ?: "Playback error"))
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                notifyListeners("tracksChanged", JSObject().put("screenId", screenId))

                // Silent-audio detection: the stream carries audio, but this
                // device can decode none of it. ExoPlayer raises no error here —
                // it just plays video with no sound — so surface it ourselves.
                val audioGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                if (audioGroups.isEmpty()) return
                val anySupported = audioGroups.any { g -> (0 until g.length).any { g.isTrackSupported(it) } }
                if (anySupported) return

                val codecs = audioGroups
                    .flatMap { g -> (0 until g.length).map { g.getTrackFormat(it) } }
                    .mapNotNull { it.sampleMimeType ?: it.codecs }
                    .distinct()
                    .joinToString(", ")
                notifyListeners(
                    "audioUnsupported",
                    JSObject()
                        .put("screenId", screenId)
                        .put("codecs", codecs)
                        .put("ffmpegAvailable", try { FfmpegLibrary.isAvailable() } catch (t: Throwable) { false }),
                )
            }
            override fun onCues(cueGroup: CueGroup) {
                s.subtitleView?.setCues(cueGroup.cues)
            }
        })
        // For getStats: which decoders are in use, and this load's frames.
        // Called on this thread, like the listener above; it only keeps
        // what the player hands it, and only for the item loaded now (see
        // isCurrentItem): a stream that has been replaced or stopped leaves
        // the new one's stats alone.
        p.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoDecoderInitialized(
                eventTime: AnalyticsListener.EventTime,
                decoderName: String,
                initializedTimestampMs: Long,
                initializationDurationMs: Long,
            ) { if (isCurrentItem(eventTime)) s.videoDecoderName = decoderName }
            override fun onVideoDecoderReleased(eventTime: AnalyticsListener.EventTime, decoderName: String) {
                if (isCurrentItem(eventTime)) s.videoDecoderName = null
            }
            override fun onAudioDecoderInitialized(
                eventTime: AnalyticsListener.EventTime,
                decoderName: String,
                initializedTimestampMs: Long,
                initializationDurationMs: Long,
            ) { if (isCurrentItem(eventTime)) s.audioDecoderName = decoderName }
            override fun onAudioDecoderReleased(eventTime: AnalyticsListener.EventTime, decoderName: String) {
                if (isCurrentItem(eventTime)) s.audioDecoderName = null
            }
            // Each (re)start of the picture gets fresh counters. A session
            // that ends is added to this load's totals — only the one this
            // load started: the last stream's arrives here after load() or
            // a stop has cleared videoCounters, and is left out.
            override fun onVideoEnabled(eventTime: AnalyticsListener.EventTime, decoderCounters: DecoderCounters) {
                if (!isCurrentItem(eventTime)) return
                s.videoCounters = decoderCounters
                s.framesSeen = true
            }
            override fun onVideoDisabled(eventTime: AnalyticsListener.EventTime, decoderCounters: DecoderCounters) {
                if (s.videoCounters !== decoderCounters) return
                decoderCounters.ensureUpdated()
                s.framesRendered += decoderCounters.renderedOutputBufferCount
                s.framesDropped += decoderCounters.droppedBufferCount
                s.videoCounters = null
            }
        })
        s.player = p
        applyBoost(s)
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        val live = call.getBoolean("live", true) ?: true
        val subs = call.getArray("subtitles", null)
        // Seconds; a film resumed part-way. Absent or 0: the player's own start.
        val startSec = call.getDouble("startPosition")
        val startMs = if (startSec != null && startSec > 0.0) (startSec * 1000.0).toLong() else 0L
        val screenId = screenIdOf(call)
        val s = slotFor(screenId)
        activity?.runOnUiThread {
            if (!ensureSurface(s)) { call.reject("no activity/webview"); return@runOnUiThread }
            if (s.player == null) buildPlayer(s, screenId)
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // Apply any pendingRect captured before the surface existed. A slot
            // that is about to stream is ALWAYS visible; without a pendingRect
            // yet, default the container to fullscreen so it composites (a
            // later setRect resizes it). Prior INVISIBLE default caused
            // "tile is black but audio plays" when a degenerate rect dropped.
            val pending = s.pendingRect
            s.container?.let { c ->
                c.visibility = View.VISIBLE
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
                } else if (screenId != MAIN) {
                    val lp = c.layoutParams
                    lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                    lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                    c.layoutParams = lp
                    c.x = 0f; c.y = 0f
                }
            }
            val p = s.player ?: run { call.reject("player init failed"); return@runOnUiThread }
            cancelTimers(s)
            s.reportedPaused = false
            s.currentUrl = url
            s.currentSubtitles = subs
            s.isLive = live
            s.lastPositionMs = startMs
            s.reconnectAttempts = 0
            s.firstFrameSeen = false
            resetStats(s, url)
            // A film or episode holds the Wi-Fi lock (see holdWifi); a
            // channel or preview box plays as it always has, without it, and
            // lets go of one a film left.
            if (screenId == MAIN) {
                if (live) releaseWifi() else holdWifi()
            }
            // Black until this stream's first frame; the TextureView still
            // holds the previous one. No stop()/re-create needed: covering it
            // costs nothing, so zapping is exactly as fast as before.
            s.shutterView?.visibility = View.VISIBLE
            // Straight to the resume point. Preparing at 0 and seeking once
            // load() had answered opened the file at its start first, then
            // again at the right place. Without one the player picks its own
            // start: 0 for a file, the live edge for a channel.
            val item = buildMediaItem(url, subs)
            // A film (not Live TV) on the main player may get the 4K budget,
            // start and restart; told before prepare() selects its tracks.
            s.loadControl?.beginStream(film = !live)
            if (startMs > 0) p.setMediaItem(item, startMs) else p.setMediaItem(item)
            p.prepare()
            if (live) {
                p.playWhenReady = true
            } else {
                // VOD: pre-buffer up to 25 s (at most 10 s wall-clock; a 4K
                // film until 20 s, 30 s at most) before
                // starting so slow Plex servers don't cause the "playing →
                // immediate rebuffer" flash (see schedulePreBuffer).
                s.holding = true
                p.playWhenReady = false
                schedulePreBuffer(s, screenId, midFile = startMs > 0)
            }
            scheduleWatchdog(s, screenId) // not for a Plex film (see scheduleWatchdog)
            schedulePositionTick(s)
            scheduleBandwidthTick(s, screenId)
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val s = slot(call)
        val screenId = screenIdOf(call)
        activity?.runOnUiThread { releaseHold(s); s.player?.play(); reportPaused(s, screenId); call.resolve() }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        val s = slot(call)
        val screenId = screenIdOf(call)
        // During the hold playWhenReady is already false, so no listener
        // event follows — reportPaused says it.
        activity?.runOnUiThread { releaseHold(s); s.player?.pause(); reportPaused(s, screenId); call.resolve() }
    }

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

    /**
     * The stats panel: what the player is doing right now, for one slot (main
     * unless screenId says otherwise). Everything is already at hand — the
     * player's own getters, the bandwidth tick's samples, the decoder names
     * the analytics listener kept — so a read costs the answer and nothing
     * more. Codec names, numbers and error code names only, never a URL or a
     * token. A slot with no player answers with zeros and nulls.
     */
    @PluginMethod
    fun getStats(call: PluginCall) {
        val screenId = screenIdOf(call)
        val act = activity ?: run { call.resolve(statsOf(null)); return }
        act.runOnUiThread { call.resolve(statsOf(slots[screenId])) }
    }

    private fun statsOf(s: PlayerSlot?): JSObject {
        val p = s?.player
        val o = JSObject()
        o.put(
            "state",
            when (p?.playbackState) {
                Player.STATE_BUFFERING -> "buffering"
                Player.STATE_READY -> "ready"
                Player.STATE_ENDED -> "ended"
                else -> "idle"
            },
        )
        o.put("playing", p?.isPlaying == true)
        val pos = p?.currentPosition?.coerceAtLeast(0L) ?: 0L
        val dur = p?.duration ?: C.TIME_UNSET
        o.put("positionSec", pos / 1000.0)
        o.put("durationSec", if (dur == C.TIME_UNSET || dur < 0L) 0.0 else dur / 1000.0)
        o.put("bufferedAheadSec", if (p == null) 0.0 else (p.bufferedPosition - pos).coerceAtLeast(0L) / 1000.0)
        // Speeds: the bandwidth tick's (main slot only), since this load.
        o.put("nowKbps", s?.lastKbps?.takeIf { it >= 0L } ?: JSONObject.NULL)
        if (s != null && s.kbpsSamples > 0) {
            o.put("avgKbps", s.kbpsSum / s.kbpsSamples)
            o.put("minKbps", s.kbpsMin)
            o.put("maxKbps", s.kbpsMax)
        } else {
            o.put("avgKbps", JSONObject.NULL)
            o.put("minKbps", JSONObject.NULL)
            o.put("maxKbps", JSONObject.NULL)
        }
        val vf = p?.videoFormat
        val af = p?.audioFormat
        o.put("videoDecoder", decoderLabel(s?.videoDecoderName, vf) ?: JSONObject.NULL)
        if (s != null && vf != null) {
            if (vf !== s.videoFormatOf) { s.videoFormatOf = vf; s.videoFormatText = describeVideo(vf) }
            o.put("videoFormat", s.videoFormatText ?: JSONObject.NULL)
        } else {
            o.put("videoFormat", JSONObject.NULL)
        }
        if (s != null && s.framesSeen) {
            val c = s.videoCounters
            c?.ensureUpdated()
            o.put("renderedFrames", s.framesRendered + (c?.renderedOutputBufferCount ?: 0))
            o.put("droppedFrames", s.framesDropped + (c?.droppedBufferCount ?: 0))
        } else {
            o.put("renderedFrames", JSONObject.NULL)
            o.put("droppedFrames", JSONObject.NULL)
        }
        o.put("audioDecoder", decoderLabel(s?.audioDecoderName, af) ?: JSONObject.NULL)
        if (s != null && af != null) {
            if (af !== s.audioFormatOf) { s.audioFormatOf = af; s.audioFormatText = describeAudio(af) }
            o.put("audioFormat", s.audioFormatText ?: JSONObject.NULL)
        } else {
            o.put("audioFormat", JSONObject.NULL)
        }
        o.put("restarts", s?.restarts ?: 0)
        o.put("lastRestartReason", s?.lastRestartReason ?: JSONObject.NULL)
        o.put("lastError", s?.lastError ?: JSONObject.NULL)
        o.put("loadProfile", s?.let { loadProfileOf(it) } ?: JSONObject.NULL)
        val rt = Runtime.getRuntime()
        o.put("javaHeapMb", (rt.totalMemory() - rt.freeMemory()) / MIB)
        o.put("nativeHeapMb", Debug.getNativeHeapAllocatedSize() / MIB)
        return o
    }

    /** What decodes a track: the decoder's own name ("c2.amlogic.hevc.decoder"),
     *  "FFmpeg (software)" for our FFmpeg extension, or "Passthrough" for
     *  Dolby or DTS sent on to the TV or receiver as it is, which no decoder
     *  here touches. Null when no track of that kind is playing. */
    private fun decoderLabel(name: String?, format: Format?): String? {
        if (format == null) return null
        if (name != null) return if (name.startsWith("ffmpeg", ignoreCase = true)) "FFmpeg (software)" else name
        return if (isBitstreamAudio(format.sampleMimeType)) "Passthrough" else null
    }

    private fun isBitstreamAudio(mime: String?): Boolean = when (mime) {
        MimeTypes.AUDIO_AC3, MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC, MimeTypes.AUDIO_AC4,
        MimeTypes.AUDIO_TRUEHD, MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS,
        MimeTypes.AUDIO_DTS_X,
        -> true
        else -> false
    }

    /** "HEVC 1920x804 23.98fps 21.6 Mb/s", leaving out what the stream doesn't
     *  say: a file played as it is rarely carries its bit rate, a conversion
     *  does. */
    private fun describeVideo(f: Format): String {
        val sb = StringBuilder(codecName(f.sampleMimeType))
        if (f.width > 0 && f.height > 0) sb.append(' ').append(f.width).append('x').append(f.height)
        if (f.frameRate > 0f) {
            val whole = Math.round(f.frameRate)
            sb.append(' ')
            if (Math.abs(f.frameRate - whole) < 0.01f) sb.append(whole) else sb.append(String.format(Locale.US, "%.2f", f.frameRate))
            sb.append("fps")
        }
        if (f.bitrate > 0) sb.append(' ').append(String.format(Locale.US, "%.1f Mb/s", f.bitrate / 1_000_000.0))
        return sb.toString()
    }

    /** "EAC3 8ch 48.0kHz". */
    private fun describeAudio(f: Format): String {
        val sb = StringBuilder(codecName(f.sampleMimeType))
        if (f.channelCount > 0) sb.append(' ').append(f.channelCount).append("ch")
        if (f.sampleRate > 0) sb.append(' ').append(String.format(Locale.US, "%.1fkHz", f.sampleRate / 1000.0))
        return sb.toString()
    }

    /** A codec's short name from its MIME type; the subtype for anything else. */
    private fun codecName(mime: String?): String = when (mime) {
        MimeTypes.VIDEO_H265 -> "HEVC"
        MimeTypes.VIDEO_H264 -> "H.264"
        MimeTypes.VIDEO_AV1 -> "AV1"
        MimeTypes.VIDEO_VP9 -> "VP9"
        MimeTypes.VIDEO_VP8 -> "VP8"
        MimeTypes.VIDEO_MPEG2 -> "MPEG-2"
        MimeTypes.VIDEO_MP4V -> "MPEG-4"
        MimeTypes.VIDEO_VC1 -> "VC-1"
        MimeTypes.VIDEO_DOLBY_VISION -> "Dolby Vision"
        MimeTypes.AUDIO_AC3 -> "AC3"
        MimeTypes.AUDIO_E_AC3 -> "EAC3"
        MimeTypes.AUDIO_E_AC3_JOC -> "EAC3 Atmos"
        MimeTypes.AUDIO_AC4 -> "AC4"
        MimeTypes.AUDIO_TRUEHD -> "TrueHD"
        MimeTypes.AUDIO_DTS -> "DTS"
        MimeTypes.AUDIO_DTS_HD -> "DTS-HD"
        MimeTypes.AUDIO_DTS_EXPRESS -> "DTS Express"
        MimeTypes.AUDIO_DTS_X -> "DTS:X"
        MimeTypes.AUDIO_AAC -> "AAC"
        MimeTypes.AUDIO_MPEG -> "MP3"
        MimeTypes.AUDIO_MPEG_L2 -> "MP2"
        MimeTypes.AUDIO_OPUS -> "Opus"
        MimeTypes.AUDIO_VORBIS -> "Vorbis"
        MimeTypes.AUDIO_FLAC -> "FLAC"
        MimeTypes.AUDIO_ALAC -> "ALAC"
        MimeTypes.AUDIO_RAW -> "PCM"
        else -> mime?.substringAfter('/')?.uppercase(Locale.US) ?: "?"
    }

    private fun stopSlot(s: PlayerSlot) {
        if (slots[MAIN] === s) releaseWifi()
        s.currentUrl = null
        clearStats(s)
        s.currentSubtitles = null
        s.lastPositionMs = 0L
        cancelTimers(s)
        s.reconnectAttempts = 0
        s.firstFrameSeen = false
        s.player?.stop()
        s.player?.clearMediaItems()
        s.subtitleView?.setCues(emptyList())
        // GONE keeps the TextureView and its last frame; the next load makes
        // the container VISIBLE again, so cover that frame now.
        s.shutterView?.visibility = View.VISIBLE
        s.container?.visibility = View.GONE
        s.pendingRect = null
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val s = slot(call)
        val screenId = screenIdOf(call)
        activity?.runOnUiThread {
            stopSlot(s)
            if (screenId != MAIN) releaseSlot(s)
            if (!anySlotStreaming()) {
                activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun stopAll(call: PluginCall) {
        activity?.runOnUiThread {
            for ((id, s) in slots) {
                stopSlot(s)
                if (id != MAIN) releaseSlot(s)
            }
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val v = call.getFloat("volume") ?: 1f
        val s = slot(call)
        s.volume = v.coerceIn(0f, MAX_VOLUME)
        activity?.runOnUiThread {
            s.player?.volume = s.volume.coerceAtMost(1f)
            applyBoost(s)
            call.resolve()
        }
    }

    /** Past 100%: Android's LoudnessEnhancer on this player's audio session,
     *  like VLC's volume past 100%. Off at 100% and under. A box without the
     *  effect simply stays at 100%. */
    private fun applyBoost(s: PlayerSlot) {
        val p = s.player ?: return
        val gainMb = if (s.volume > 1f) ((s.volume - 1f) * BOOST_MB_PER_UNIT).toInt() else 0
        if (gainMb <= 0) {
            s.boost?.let { e -> try { e.enabled = false } catch (_: Exception) { /* released */ } }
            return
        }
        try {
            val e = s.boost ?: LoudnessEnhancer(p.audioSessionId).also { s.boost = it }
            e.setTargetGain(gainMb)
            e.enabled = true
        } catch (e: Exception) {
            Log.w(TAG, "Volume boost is not available on this box", e)
        }
    }

    private fun releaseBoost(s: PlayerSlot) {
        try { s.boost?.release() } catch (_: Exception) { /* already gone */ }
        s.boost = null
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
        // A new stream is about to load into this rect: cover the old picture
        // now rather than in load(), one bridge round trip later — by then
        // this or the next setRect may already have moved it (preview box to
        // fullscreen on a different channel) and flashed it at the new size.
        val blank = call.getBoolean("blank", false) ?: false
        val s = slot(call)
        val screenId = screenIdOf(call)
        activity?.runOnUiThread {
            if (blank) s.shutterView?.visibility = View.VISIBLE
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
            // Z-order guard: keep our container BELOW the WebView so the
            // transparent HTML chrome always composites above the video.
            //
            // "Below", not "directly below". This used to insist on exactly
            // wvIdx - 1, which only ONE child can occupy — so with more than
            // one slot the tiles fought over that single position. Every
            // setRect moved a container there, pushing the previous one down,
            // and measureAndApply calls setRect for EVERY occupied slot and
            // re-runs on every `slots` change (buffering, state, EPG). The
            // result was a permanent removeView/addView churn.
            //
            // That is fatal here: detaching a view destroys its TextureView's
            // SurfaceTexture, so Media3's listener tears the video output down
            // and the next attach races the next detach. No tile ever held a
            // surface long enough to draw — every screen black, audio playing
            // normally, on all three layouts. The main player was fine because
            // a single slot satisfies "exactly wvIdx - 1" and then stops moving.
            //
            // Tiles never overlap, so their order amongst themselves does not
            // matter; only staying under the WebView does. ensureSurface adds
            // at index 0, so in practice this now never fires.
            val parent = c.parent as? ViewGroup
            val wv = bridge?.webView
            if (parent != null && wv != null) {
                val cIdx = parent.indexOfChild(c)
                val wvIdx = parent.indexOfChild(wv)
                if (cIdx >= 0 && wvIdx >= 0 && cIdx > wvIdx) {
                    // Genuinely above the WebView. Removing a child that sits
                    // after wv leaves wv's index unchanged, so re-reading it
                    // and inserting there puts us immediately beneath it.
                    parent.removeView(c)
                    parent.addView(c, parent.indexOfChild(wv))
                }
            }
            // The correction matrix is computed against the view's dimensions,
            // so a new rect invalidates it. Post it rather than calling inline:
            // the layout pass triggered above has not run yet, so the width and
            // height would still be the old ones.
            c.post { applyFormat(s) }
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
                            // Embedded broadcast captions carry no label or language,
                            // so name them properly instead of "Track 1".
                            val ccLabel = when (fmt.sampleMimeType) {
                                MimeTypes.APPLICATION_CEA608 -> "Closed Captions (CC1)"
                                MimeTypes.APPLICATION_CEA708 -> "Closed Captions (708)"
                                else -> null
                            }
                            o.put("label", fmt.label ?: ccLabel ?: fmt.language ?: codecLabel(fmt.codecs) ?: "Track ${i + 1}")
                            o.put("language", fmt.language ?: "")
                            o.put("codec", fmt.codecs ?: "")
                            o.put("selected", group.isTrackSelected(i))
                            // A track can be present, unsupported and unselected — that is
                            // exactly the silent-audio case. Report it so the UI can explain
                            // itself instead of just playing video with no sound.
                            o.put("supported", group.isTrackSupported(i))
                            o.put("mimeType", fmt.sampleMimeType ?: "")
                            o.put("channels", fmt.channelCount)
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

    /**
     * Reports whether the FFmpeg software-decode extension actually loaded on
     * THIS device. `EXTENSION_RENDERER_MODE_PREFER` is set unconditionally, but
     * it is a no-op unless libffmpegJNI.so is packaged for the device's ABI —
     * and when it is a no-op, Dolby (AC-3/E-AC-3) tracks are silently
     * deselected and playback continues with no sound. This turns that
     * invisible state into something a customer can read out.
     */
    /**
     * Screen format. ExoPlayer stretches the picture to fill its TextureView,
     * so applyFormat sizes that view to the shape the picture should have and
     * centres it in the black box (VideoFit). Only the picture view changes
     * size: the box, the subtitle layer and the touch/rect handling stay as
     * they are.
     *
     *   fit     letterbox / pillarbox — whole picture, correct shape. Default.
     *   fill    stretch to the panel, shape ignored. The old behaviour.
     *   zoom    correct shape, cropped to fill — no black bars, edges lost.
     *   wide    force 16:9 whatever the source claims. The escape hatch for a
     *           stream flagged with the wrong ratio, which is the case that
     *           looks "full when it should be wide".
     */
    @PluginMethod
    fun setResizeMode(call: PluginCall) {
        val mode = (call.getString("mode") ?: FORMAT_FIT).lowercase()
        if (mode !in FORMATS) {
            call.reject("Unknown mode '$mode'. Expected one of: ${FORMATS.joinToString(", ")}")
            return
        }
        val s = slot(call)
        s.format = mode
        activity?.runOnUiThread {
            applyFormat(s)
            call.resolve(JSObject().put("mode", mode))
        }
    }

    @PluginMethod
    fun getResizeMode(call: PluginCall) {
        call.resolve(JSObject().put("mode", slot(call).format))
    }

    /** Size the picture view to the picture in its black box (VideoFit).
     *  Safe to call at any time; the box's layout listener calls it again
     *  whenever the box changes size. */
    private fun applyFormat(s: PlayerSlot) {
        val tv = s.textureView ?: return
        val box = s.container ?: return
        // Before the first layout, or before anything is decoded, there is
        // nothing to fit; the layout listener and onVideoSizeChanged come back.
        val size = VideoFit.viewSize(s.format, box.width, box.height, s.videoW, s.videoH, s.pixelRatio) ?: return
        // No matrix: the view itself has the picture's shape. A shrunken
        // picture in a box-sized view left the bars unpainted (the band in
        // bugs/plex-green-bar.md).
        tv.setTransform(null)
        val lp = tv.layoutParams as? FrameLayout.LayoutParams ?: FrameLayout.LayoutParams(size[0], size[1])
        if (lp.width == size[0] && lp.height == size[1] && lp.gravity == Gravity.CENTER) return
        lp.width = size[0]
        lp.height = size[1]
        lp.gravity = Gravity.CENTER
        tv.layoutParams = lp
    }

    @PluginMethod
    fun getDecoderInfo(call: PluginCall) {
        val available = try { FfmpegLibrary.isAvailable() } catch (t: Throwable) { false }
        val version = try { FfmpegLibrary.getVersion() } catch (t: Throwable) { null }
        call.resolve(
            JSObject()
                .put("ffmpegAvailable", available)
                .put("ffmpegVersion", version ?: "")
                .put("abis", JSArray().also { arr -> android.os.Build.SUPPORTED_ABIS.forEach { arr.put(it) } })
                .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                .put("sdk", android.os.Build.VERSION.SDK_INT),
        )
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
                releaseBoost(s)
                s.player?.release()
                s.player = null
            }
            slots.clear()
            releaseWifi()
            wifiLock = null
        }
        super.handleOnDestroy()
    }
}

/**
 * The main player's load control. Size first, as DefaultLoadControl is, over
 * a time floor: while less than floorMs of media is buffered it keeps
 * loading whatever the byte budget says (2 GB boxes; 0 elsewhere). A high
 * bit-rate file then still gets its floor when the budget alone would stop
 * it short. Above the floor the parent decides, and it is always asked, so it
 * keeps its own record of whether each player is loading. ExoPlayer calls
 * shouldContinueLoading(Parameters) and onTracksSelected(Parameters, ...)
 * (Media3 1.5.0); the older overloads are never reached.
 *
 * A 4K film (`vod`, set by load() before prepare(), and a 4K picture
 * selected; see UhdBuffer) gets on top:
 * - its own byte budget, `uhdBudgetBytes`, where the library's own budget is
 *   in use (calculateTargetBufferBytes; 0 keeps the library's);
 * - after a stall, 10 s buffered before it plays on instead of 5 s, or less
 *   when the buffer can't take more (the budget spent).
 * Anything else — 1080p, a conversion, Live TV — behaves exactly as the
 * DefaultLoadControl (or the floored one) built here before.
 */
private class SteadyLoadControl(
    minBufferMs: Int,
    maxBufferMs: Int,
    bufferForPlaybackMs: Int,
    bufferForPlaybackAfterRebufferMs: Int,
    targetBufferBytes: Int,
    floorMs: Int,
    val uhdBudgetBytes: Int,
) : DefaultLoadControl(
    DefaultAllocator(/* trimOnReset= */ true, C.DEFAULT_BUFFER_SEGMENT_SIZE),
    minBufferMs,
    maxBufferMs,
    bufferForPlaybackMs,
    bufferForPlaybackAfterRebufferMs,
    targetBufferBytes,
    /* prioritizeTimeOverSizeThresholds= */ false,
    DefaultLoadControl.DEFAULT_BACK_BUFFER_DURATION_MS,
    DefaultLoadControl.DEFAULT_RETAIN_BACK_BUFFER_FROM_KEYFRAME,
) {
    private val floorUs = floorMs * 1000L
    private val uhdRebufferUs = UhdBuffer.REBUFFER_MS * 1000L

    /** A film on the main player (not Live TV). */
    @Volatile private var vod: Boolean = false
    /** A 4K film: set when its tracks are selected (playback thread), read
     *  by the start-up hold and the stats (main thread). */
    @Volatile var uhd: Boolean = false
        private set

    /** A new stream on the main player (load(), main thread, before
     *  prepare()): a film or Live TV. Not 4K until its tracks say so. */
    fun beginStream(film: Boolean) {
        vod = film
        uhd = false
    }
    /** The byte budget last worked out from the tracks (0: a fixed one). */
    @Volatile var budgetBytes: Int = 0
        private set
    /** What shouldContinueLoading last answered. */
    @Volatile private var loadingNow: Boolean = true

    override fun onTracksSelected(
        parameters: LoadControl.Parameters,
        trackGroups: TrackGroupArray,
        trackSelections: Array<ExoTrackSelection?>,
    ) {
        // Before the parent, which sizes the byte budget from it.
        uhd = vod && trackSelections.any { sel ->
            val f = sel?.selectedFormat
            f != null && UhdBuffer.isUhd(f.width, f.height)
        }
        loadingNow = true
        super.onTracksSelected(parameters, trackGroups, trackSelections)
    }

    override fun calculateTargetBufferBytes(trackSelectionArray: Array<ExoTrackSelection?>): Int {
        val library = super.calculateTargetBufferBytes(trackSelectionArray)
        val bytes = if (uhd && uhdBudgetBytes > library) uhdBudgetBytes else library
        budgetBytes = bytes
        return bytes
    }

    override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
        val bySize = super.shouldContinueLoading(parameters)
        val go = bySize || parameters.bufferedDurationUs < floorUs
        loadingNow = go
        return go
    }

    override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean {
        if (!super.shouldStartPlayback(parameters)) return false
        if (!uhd || !parameters.rebuffering) return true
        // Never waits on a buffer that has stopped growing: the budget is
        // spent (or the file ends, which the player starts on by itself).
        return parameters.bufferedDurationUs >= uhdRebufferUs || !loadingNow
    }
}

/** Counts the bytes the player's HTTP sources receive (loader threads). */
private class ByteMeter(private val total: AtomicLong) : TransferListener {
    override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
    override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
    override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
        if (isNetwork) total.addAndGet(bytesTransferred.toLong())
    }
    override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
}

/**
 * A Plex stream: a file played as it is ({base}/library/parts/{id}/{ts}/file.ext)
 * or a conversion (/video/:/transcode/universal/, playlist and segments).
 * Matched anywhere in the path so a server behind a reverse proxy with a
 * path prefix still counts.
 */
private fun isPlexStream(uri: Uri): Boolean {
    val path = uri.path ?: return false
    return path.contains("/library/parts/") || path.contains("/transcode/universal/")
}

/** A Plex conversion: its playlist and segments. */
private fun isPlexTranscode(uri: Uri): Boolean = uri.path?.contains("/transcode/universal/") == true

/** Plex streams get the patient sources (a file played as it is, and a
 *  conversion, each with its own user agent); everything else (Live TV) the
 *  quick one. */
private class PlexAwareFactory(
    private val normal: DataSource.Factory,
    private val plex: DataSource.Factory,
    private val transcode: DataSource.Factory,
) : DataSource.Factory {
    override fun createDataSource(): DataSource =
        PlexAwareDataSource(normal.createDataSource(), plex.createDataSource(), transcode.createDataSource())
}

private class PlexAwareDataSource(
    private val normal: DataSource,
    private val plex: DataSource,
    private val transcode: DataSource,
) : DataSource {
    private var current: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        normal.addTransferListener(transferListener)
        plex.addTransferListener(transferListener)
        transcode.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val uri = dataSpec.uri
        val src = when {
            isPlexTranscode(uri) -> transcode
            isPlexStream(uri) -> plex
            else -> normal
        }
        current = src
        return src.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        current?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT

    override fun getUri(): Uri? = current?.uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        current?.responseHeaders ?: emptyMap()

    override fun close() {
        val src = current
        current = null
        src?.close()
    }
}
