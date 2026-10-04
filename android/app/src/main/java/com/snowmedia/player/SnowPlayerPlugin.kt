@file:androidx.media3.common.util.UnstableApi

package com.snowmedia.player

import android.app.ActivityManager
import android.content.Context
import android.media.MediaFormat
import android.graphics.Color
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.Gravity
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.annotation.StringRes
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
import androidx.media3.common.text.Cue
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
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultAllocator
import androidx.media3.exoplayer.video.VideoFrameMetadataListener
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
import com.snowmedia.AppLocale
import com.snowmedia.BuildConfig
import com.snowmedia.R
import com.snowmedia.dvr.StorageBudget
import com.snowmedia.dvr.TimeshiftLimits
import com.snowmedia.dvr.TimeshiftManager
import com.snowmedia.dvr.TimeshiftSession
import java.io.File
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
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
        // The picture's own view. The main player draws on a SurfaceView
        // (`video_surface_view`, on unless switched off remotely): its own
        // layer straight to the display, frame timing from the decoder, and
        // HDR10 / HLG / Dolby Vision passed through to an HDR TV. A
        // TextureView goes through the app's GPU composition every frame,
        // which at 4K paces frames unevenly and is always SDR. Tiles keep the
        // TextureView. `wantSurfaceView` is what load() asked for; a change
        // rebuilds the views (load()).
        var videoView: View? = null
        var usesSurfaceView: Boolean = false
        var wantSurfaceView: Boolean = false
        // MediaCodec's asynchronous queueing (`async_codec`, API 28+): what
        // the player was built with, and what load() asks for.
        var asyncCodec: Boolean = false
        var wantAsyncCodec: Boolean = false
        // The scaling mode last handed to the player (SurfaceView zoom).
        var scalingMode: Int = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        // Tunneled playback for this load (`tunneled_vod`, off by default).
        var tunneled: Boolean = false
        // Audio renderer order (`audio_hw_first`): the player is built with
        // one. ON puts MediaCodec first (the box's hardware decoder, or the
        // bitstream passed through to the TV or receiver) with FFmpeg as the
        // fallback; PREFER puts FFmpeg first (every track decoded on the
        // CPU, as Live TV has always played). `wantAudioMode` is what this
        // load needs; a change rebuilds the player (load()).
        var audioMode: Int = AudioOrder.FFMPEG_FIRST
        var wantAudioMode: Int = AudioOrder.FFMPEG_FIRST
        // This title's hardware audio failed once: FFmpeg first from then on
        // (restartWithSoftwareAudio), until another title loads.
        var audioSwFallback: Boolean = false
        var audioSwFallbackUrl: String? = null
        // The viewer picked an audio track (setAudioTrack): never overridden.
        var userPickedAudio: Boolean = false
        // The heavy-track check ran for this load (chooseLighterAudio).
        var audioChoiceDone: Boolean = false
        // The sound goes out as a bitstream (Dolby / DTS to the TV or
        // receiver): no volume or boost acts on it.
        var audioPassthrough: Boolean = false
        var audioUnderruns: Int = 0
        var audioUnderrunGapMs: Long = 0L
        // The video decoder sessions that have ended this load, added up
        // like framesRendered (statsOf adds the running one's).
        var framesSkipped: Long = 0L
        var maxConsecutiveDropped: Int = 0
        var droppedToKeyframe: Long = 0L
        var frameOffsetUs: Long = 0L
        var frameOffsetCount: Long = 0L
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
        // A Plex conversion the server answered with an error status, in this
        // load: the same session is tried again once, then JS is told
        // (PLEX_TRANSCODE_HTTP) and starts a fresh one instead.
        var transcodeHttpFails: Int = 0
        // A Plex file played as it is over several range requests at once
        // (RangeFetchDataSource): asked for by load() for a remote server.
        // Read by the data source at each open, so it holds for the whole
        // load, reconnects included. `rangeShared` (set by buildPlayer) is
        // what the sources share: the slab pool, the live connection count
        // the stats report, and the connection cap a refusal lowers.
        var rangeFetch: Boolean = false
        var rangeShared: RangeFetchDataSource.Shared? = null
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
        // The HTTP status behind the last ERROR_CODE_IO_BAD_HTTP_STATUS (a
        // number only, never the address), with lastError; null otherwise.
        var lastHttpStatus: Int? = null
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
        // Engine: "exo" (ExoPlayer, everything) or "mpv" (Live TV channels
        // and the Live/Guide preview boxes only, owner test builds — see
        // EngineChoice). `second` is the mpv engine once created for this
        // process; the same object every time (MPVLib is a single instance
        // for the whole app), left set even while this slot plays on exo.
        var engine: String = EngineChoice.EXO
        var second: SecondEngine? = null
        // Time-to-first-picture and stalls since load(), for both engines
        // (statsOf). Stalls count only after the first frame — the start-up
        // wait is firstFrameMs, not a stall.
        var loadStartWallMs: Long = 0L
        var loadStartCpuMs: Long = 0L
        var firstFrameMs: Long? = null
        var stalls: Int = 0
        var stallSec: Double = 0.0
        var stallStartedAtMs: Long = 0L
        // Frame-rate matching (FrameRateMatch, main slot only): this load
        // may change the display mode (a film or episode with the setting
        // and the remote switch on; never Live TV or a tile). Until
        // `modeSwitchUntilMs` the screen may be blank from a mode switch:
        // a stall then is not counted, and the first-picture watchdog has
        // been pushed back.
        var matchFrameRate: Boolean = false
        var modeSwitchUntilMs: Long = 0L
        // The frame rate the WebView knows for this load (Plex's metadata:
        // a Matroska file never states one to the player); 0 = none. Which
        // source the rate came from is logged once per load.
        var hintFps: Float = 0f
        var fpsLogged: Boolean = false
        // While a requested mode has not shown up yet (onDisplayChanged), the
        // start-up hold keeps the film paused, until this time at most.
        var modeWaitUntilMs: Long = 0L
        // No rate from the WebView or the stream: the first frames' times
        // (set on the main thread, filled on the playback thread).
        @Volatile var fpsEstimator: FpsEstimator? = null
    }

    /** Presentation times of the first frames shown (FrameRateMatch.estimate). */
    private class FpsEstimator(val url: String) {
        val pts = LongArray(FPS_ESTIMATE_FRAMES)
        var count = 0
        @Volatile var done = false
    }

    private val slots = HashMap<String, PlayerSlot>()
    private val mainHandler = Handler(Looper.getMainLooper())
    // The main player's own Wi-Fi lock (see holdWifi). Created on first use.
    private var wifiLock: WifiManager.WifiLock? = null
    // Scratch for isCurrentItem (main thread only, like every player call).
    private val itemWindow = Timeline.Window()
    // mpv, owner test builds only (see EngineChoice/BuildConfig.SMC_WITH_MPV).
    // One instance for the whole app, created the first time any load() asks
    // for it; `mpvInitFailed` marks it off for the rest of this process the
    // first time creating or starting it throws (a missing native lib
    // included) — never retried until the app restarts.
    private var mpvEngine: SecondEngine? = null
    private var mpvInitFailed = false
    // Debug.getPss() is a process-wide, costly read (it walks smaps): done
    // on its own thread every PSS_CACHE_MS, never on the UI thread, which
    // with a TextureView is also the thread that delivers frames. statsOf
    // (UI thread) only hands back the last value.
    @Volatile private var pssCacheMb: Long = -1L
    @Volatile private var pssCacheAtMs: Long = 0L
    private val pssRefreshing = AtomicBoolean(false)
    private val statsExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "SnowPlayer:stats").apply { isDaemon = true }
    }
    // Whether this box is low on RAM (isLowRamBox), read once.
    private var lowRamBox: Boolean? = null
    // Frame-rate matching: the display mode this plugin asked the window
    // for (preferredDisplayModeId; 0 = none, the system's own), and the mode
    // the screen was in before the first such request. One window, so one
    // request for the whole plugin, made for the main slot only.
    private var requestedModeId: Int = 0
    private var requestedMode: FrameRateMatch.Mode? = null
    private var modeBefore: FrameRateMatch.Mode? = null
    // Told when the requested mode is in place (the start-up hold waits for it).
    private var displayListener: DisplayManager.DisplayListener? = null
    // A stop puts the screen back a moment later, so a quality change, a
    // retry or the next episode (a stop and a load) keeps the film's mode.
    private val restoreModeRunnable = Runnable { restoreDisplayMode() }

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
        // A Plex conversion the server answers with an HTTP error status: the
        // same session is loaded this many times in all, then the WebView
        // starts a fresh session (a new id and decision) or another quality.
        // Restarting the identical session again and again got the same
        // error each time (a customer's box: 6 restarts, "Buffer 0.0 s").
        private const val TRANSCODE_HTTP_TRIES = 2
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
        private const val KIB_PER_MIB = 1024L
        private const val PSS_CACHE_MS = 15000L
        // Rewind live TV (see tsSwitchToBuffer and friends).
        private const val TS_TICK_MS = 1000L
        /** Never closer than this to the end of the buffer: the next segment is still being written. */
        private const val TS_HOLD_BACK_MS = 6000L
        /** At the end of the buffer (within this) while playing: the capture has stalled. */
        private const val TS_END_SLACK_MS = 1000L
        private const val TS_MAX_LAG_MS = 30_000L
        /** A live pause this long moves to the buffer (before the server drops the idle connection). */
        private const val TS_PAUSE_TO_BUFFER_MS = 20_000L
        private const val TS_RECOVER_GAP_MS = 10_000L
        private const val TS_OLDEST_MARGIN_MS = 30_000L
        /** A display mode switch blanks HDMI for 1-3 s: that long after one,
         *  a stall is the switch, not the stream. */
        private const val MODE_SWITCH_GRACE_MS = 4000L
        /** The start-up hold waits at most this long for a requested mode to show. */
        private const val MODE_WAIT_MS = 4000L
        /** After a stop, the screen goes back to its own mode this much later
         *  unless another film loads (Plex's quality change is a stop and a load). */
        private const val MODE_RESTORE_DELAY_MS = 2000L
        /** Shorter than this (a trailer, an extra): never worth a mode switch. */
        private const val MIN_MATCH_DURATION_MS = 5 * 60_000L
        /** Frames timed for a frame-rate estimate. */
        const val FPS_ESTIMATE_FRAMES = 48
    }

    private fun screenIdOf(call: PluginCall): String = call.getString("screenId") ?: MAIN

    private fun slot(call: PluginCall): PlayerSlot = slotFor(screenIdOf(call))

    private fun slotFor(screenId: String): PlayerSlot {
        var s = slots[screenId]
        if (s == null) {
            s = PlayerSlot()
            // setRect can build the main box before the first load() says
            // which view to use: the SurfaceView, as the switch is on unless
            // a row turns it off (load() rebuilds the box then).
            s.wantSurfaceView = screenId == MAIN
            slots[screenId] = s
        }
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
        clearVideoTelemetry(s)
        s.videoCounters = null
        s.framesSeen = false
        s.firstFrameMs = null
        s.stalls = 0
        s.stallSec = 0.0
        s.stallStartedAtMs = 0L
        s.loadStartWallMs = SystemClock.elapsedRealtime()
        s.loadStartCpuMs = Process.getElapsedCpuTime()
        if (url != s.statsUrl) {
            s.statsUrl = url
            s.restarts = 0
            s.lastRestartReason = null
            s.lastError = null
            s.lastHttpStatus = null
        }
    }

    private fun clearVideoTelemetry(s: PlayerSlot) {
        s.audioUnderruns = 0
        s.audioUnderrunGapMs = 0L
        s.framesSkipped = 0L
        s.maxConsecutiveDropped = 0
        s.droppedToKeyframe = 0L
        s.frameOffsetUs = 0L
        s.frameOffsetCount = 0L
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
        clearVideoTelemetry(s)
        s.videoCounters = null
        s.framesSeen = false
        s.statsUrl = null
        s.restarts = 0
        s.lastRestartReason = null
        s.lastError = null
        s.lastHttpStatus = null
        s.videoDecoderName = null
        s.audioDecoderName = null
        s.videoFormatOf = null
        s.videoFormatText = null
        s.audioFormatOf = null
        s.audioFormatText = null
        s.firstFrameMs = null
        s.stalls = 0
        s.stallSec = 0.0
        s.stallStartedAtMs = 0L
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
                // A display mode asked for during the hold: wait until the
                // screen is in it (or MODE_WAIT_MS), so its HDMI blank never
                // eats the film's first seconds.
                val done = PreBufferRule.isDone(
                    midFile, elapsed, flowAt, now, bufMs, ready,
                    loading = p.isLoading, ended = state == Player.STATE_ENDED, uhd = uhd,
                ) && !(s.modeWaitUntilMs != 0L && now < s.modeWaitUntilMs)
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
                    .put("message", localized(R.string.player_err_stream_dropping)),
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
        val plex = isPlexStream(Uri.parse(url))
        return when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            -> localized(R.string.player_err_server_stopped)
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> {
                val status = httpStatusOf(error)
                when {
                    status != null && plex -> localized(R.string.player_err_plex_refused_status, status)
                    status != null -> localized(R.string.player_err_refused_status, status)
                    plex -> localized(R.string.player_err_plex_refused)
                    else -> localized(R.string.player_err_refused)
                }
            }
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
            -> localized(if (plex) R.string.player_err_plex_refused else R.string.player_err_refused)
            else -> error.message?.takeIf { it.isNotBlank() && !it.contains("://") } ?: localized(R.string.player_err_playback)
        }
    }

    /** A message for the WebView in the app's language (strings.xml, AppLocale), not the box's. */
    private fun localized(@StringRes id: Int, vararg args: Any): String = AppLocale.string(context, id, *args)

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

    /** What the stats panel shows as the last restart for an error: its code
     *  name, and the HTTP status when there is one ("stream error
     *  IO_BAD_HTTP_STATUS · HTTP 503"). Never the address. */
    private fun httpRestartReason(error: PlaybackException, httpStatus: Int?): String {
        val base = "stream error " + error.errorCodeName.removePrefix("ERROR_CODE_")
        return if (httpStatus != null) "$base · HTTP $httpStatus" else base
    }

    private fun ensureSurface(s: PlayerSlot): Boolean {
        if (s.container != null && s.videoView != null) return true
        val act = activity ?: return false
        val webView = bridge?.webView ?: return false
        val parent = webView.parent as? ViewGroup ?: return false
        webView.setBackgroundColor(Color.TRANSPARENT)
        // Ensure every transparency gap around/behind the WebView reads BLACK,
        // never the light-theme window default (white flash on layout).
        act.window.decorView.setBackgroundColor(Color.BLACK)
        // The main player's SurfaceView keeps its default z-order: its layer
        // sits under the window, which shows it through the hole the view
        // punches. Never setZOrderOnTop / setZOrderMediaOverlay: the WebView
        // (transparent, its own layer type left as it is) and the shutter
        // and subtitles above must stay on top of the picture.
        val tv: View = if (s.wantSurfaceView) SurfaceView(act) else TextureView(act)
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
        s.videoView = tv
        s.usesSurfaceView = tv is SurfaceView
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

    // ---- Frame-rate matching -------------------------------------------------
    // A 23.976 fps film on the Fire TV's usual 60 Hz is shown with 3:2
    // pulldown: uneven, the "a little lag" of 4K films. A film or episode on
    // the main player (matchFrameRate, from the WebView: the viewer's setting
    // and the remote switch) asks the window for a display mode of the same
    // resolution whose refresh rate is a whole multiple of the film's
    // (FrameRateMatch), once, as soon as the rate is known. The window's
    // preferredDisplayModeId is what Fire OS honours (API 28); Surface.
    // setFrameRate is not used: the window's explicit mode outranks it on
    // API 30+, and two requests could disagree. Everything here runs on the
    // main thread.

    /** The display this activity is on; null if it can't be read. */
    @Suppress("DEPRECATION")
    private fun currentDisplay(): Display? {
        val act = activity ?: return null
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) act.display else act.windowManager.defaultDisplay
        } catch (_: Throwable) {
            null
        }
    }

    private fun modeOf(m: Display.Mode): FrameRateMatch.Mode =
        FrameRateMatch.Mode(m.modeId, m.physicalWidth, m.physicalHeight, m.refreshRate)

    private fun modeText(m: FrameRateMatch.Mode?): String =
        if (m == null) "?" else "${m.width}x${m.height}@${FrameRateMatch.label(m.refreshRate)}"

    /** The screen's refresh rate now, Hz to 3 decimals (stats); null if unknown. */
    private fun displayHz(): Double? {
        val d = currentDisplay() ?: return null
        val hz = try { d.mode.refreshRate } catch (_: Throwable) { return null }
        return if (hz > 0f) Math.round(hz * 1000.0) / 1000.0 else null
    }

    /** The video track being played, from a track list; null when none is selected. */
    private fun selectedVideoFormat(tracks: androidx.media3.common.Tracks): Format? {
        for (g in tracks.groups) {
            if (g.type != C.TRACK_TYPE_VIDEO || !g.isSelected) continue
            for (i in 0 until g.length) if (g.isTrackSelected(i)) return g.getTrackFormat(i)
        }
        return null
    }

    private fun inModeSwitch(s: PlayerSlot): Boolean =
        s.modeSwitchUntilMs != 0L && SystemClock.elapsedRealtime() < s.modeSwitchUntilMs

    /**
     * A film's frame rate is known (its tracks, or its decoder's input
     * format): the rate to match is the WebView's (Plex's metadata), else
     * the stream's own, else, when neither has one (a Matroska file states
     * none to the player), an estimate from the first frames shown
     * (FpsEstimator, see onVideoFrameAboutToBeRendered).
     */
    private fun matchFrameRate(s: PlayerSlot, screenId: String, format: Format?) {
        // Only once the picture's track is known: by then so is the length
        // (a trailer is left alone, see applyFrameRate).
        if (format == null || screenId != MAIN || !s.matchFrameRate || s.isLive) return
        val url = s.currentUrl ?: return
        when {
            s.hintFps > 0f -> applyFrameRate(s, screenId, s.hintFps, "plex")
            format.frameRate > 0f -> applyFrameRate(s, screenId, format.frameRate, "format")
            s.fpsEstimator == null -> s.fpsEstimator = FpsEstimator(url)
        }
    }

    /**
     * Ask for the mode that fits this film's frame rate, if the screen is not
     * in one already. Judged against the mode last asked for while one is
     * (the display reports the old one until the TV has switched, and keeps
     * reporting it if the TV ignored the request), so a second report of the
     * same rate (the track list, then the decoder; a quality change; a seek)
     * never asks again. Logs numbers only.
     */
    private fun applyFrameRate(s: PlayerSlot, screenId: String, fps: Float, source: String) {
        if (screenId != MAIN || !s.matchFrameRate || s.isLive || s.currentUrl == null) return
        if (!(fps > 0f)) return
        if (!s.fpsLogged) {
            s.fpsLogged = true
            Log.i(TAG, "fps=${FrameRateMatch.label(fps)} src=$source")
        }
        // A trailer or an extra: not worth 1-3 s of blank screen.
        val dur = s.player?.duration ?: C.TIME_UNSET
        if (dur != C.TIME_UNSET && dur in 1 until MIN_MATCH_DURATION_MS) return
        val act = activity ?: return
        val display = currentDisplay() ?: return
        val shown = try { modeOf(display.mode) } catch (_: Throwable) { return }
        val modes = try { display.supportedModes.map { modeOf(it) } } catch (_: Throwable) { return }
        val pick = FrameRateMatch.pick(requestedMode ?: shown, modes, fps) ?: return
        // Never a change of size: that would be a configuration change too.
        if (pick.id == requestedModeId || pick.width != shown.width || pick.height != shown.height) return
        try {
            val w = act.window
            val lp = w.attributes
            lp.preferredDisplayModeId = pick.id
            w.attributes = lp
        } catch (e: Throwable) {
            Log.w(TAG, "Display mode not changed (${e.javaClass.simpleName})")
            return
        }
        if (requestedModeId == 0) modeBefore = shown
        requestedModeId = pick.id
        requestedMode = pick
        Log.i(TAG, "fps ${FrameRateMatch.label(fps)} → mode ${modeText(pick)} (was ${modeText(shown)})")
        // The HDMI blank that follows is not a stall: stalls are not counted
        // for a while (onPlaybackStateChanged), and a first-picture watchdog
        // still waiting starts its 8 s again. The WebView treats it like a
        // seek for automatic quality. A start-up hold still running keeps the
        // film paused until the screen is in the new mode (watchDisplayMode).
        val now = SystemClock.elapsedRealtime()
        s.modeSwitchUntilMs = now + MODE_SWITCH_GRACE_MS
        if (s.holding) s.modeWaitUntilMs = now + MODE_WAIT_MS
        watchDisplayMode(s, pick.id)
        if (s.watchdogRunnable != null) scheduleWatchdog(s, screenId)
        notifyListeners(
            "displayMode",
            JSObject().put("screenId", screenId)
                .put("fps", Math.round(fps * 1000.0) / 1000.0)
                .put("refreshHz", Math.round(pick.refreshRate * 1000.0) / 1000.0),
        )
    }

    /** Until the display reports mode [modeId] (or MODE_WAIT_MS pass): then
     *  the start-up hold may end, and the blank's grace runs on from there. */
    private fun watchDisplayMode(s: PlayerSlot, modeId: Int) {
        unwatchDisplayMode()
        val dm = activity?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                val now = try { currentDisplay()?.mode?.modeId } catch (_: Throwable) { null }
                if (now != modeId) return
                unwatchDisplayMode()
                if (s.modeWaitUntilMs != 0L) {
                    s.modeWaitUntilMs = 0L
                    // The TV takes a moment more to show the picture.
                    s.modeSwitchUntilMs = maxOf(s.modeSwitchUntilMs, SystemClock.elapsedRealtime() + 1500L)
                }
            }
        }
        try {
            dm.registerDisplayListener(l, mainHandler)
            displayListener = l
        } catch (_: Throwable) { /* the hold's own limit ends the wait */ }
    }

    private fun unwatchDisplayMode() {
        val l = displayListener ?: return
        displayListener = null
        try { (activity?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.unregisterDisplayListener(l) } catch (_: Throwable) { /* gone */ }
    }

    /** Playback thread: a frame about to be shown, for a film whose rate is
     *  not known. The estimate goes to the main thread once. */
    private fun timeFrame(s: PlayerSlot, presentationTimeUs: Long) {
        val e = s.fpsEstimator ?: return
        if (e.done) return
        if (e.count > 0 && presentationTimeUs <= e.pts[e.count - 1]) { e.count = 0 }
        e.pts[e.count++] = presentationTimeUs
        if (e.count < FPS_ESTIMATE_FRAMES) return
        e.done = true
        val fps = FrameRateMatch.estimate(e.pts, e.count) ?: return
        mainHandler.post {
            if (s.fpsEstimator === e && s.currentUrl == e.url) applyFrameRate(s, MAIN, fps, "estimate")
        }
    }

    /** Back to the system's own display mode (preferredDisplayModeId 0), if this plugin asked for another. */
    private fun restoreDisplayMode() {
        mainHandler.removeCallbacks(restoreModeRunnable)
        unwatchDisplayMode()
        if (requestedModeId == 0) return
        val asked = requestedMode
        val before = modeBefore
        requestedModeId = 0
        requestedMode = null
        modeBefore = null
        try {
            val w = activity?.window ?: return
            val lp = w.attributes
            lp.preferredDisplayModeId = 0
            w.attributes = lp
            Log.i(TAG, "display mode back from ${modeText(asked)} to the system's (${modeText(before)})")
        } catch (e: Throwable) {
            Log.w(TAG, "Display mode not restored (${e.javaClass.simpleName})")
        }
    }

    // ---- Audio: hardware first for films -------------------------------------

    /** The sound goes out as a bitstream (or no longer does): the boost lets
     *  go, and the WebView's volume says to use the TV or receiver's. */
    private fun setPassthrough(s: PlayerSlot, screenId: String, on: Boolean) {
        if (s.audioPassthrough == on) return
        s.audioPassthrough = on
        applyBoost(s)
        if (screenId == MAIN) notifyListeners("audioOutput", JSObject().put("screenId", screenId).put("passthrough", on))
    }

    /**
     * A film's heavy sound (TrueHD, DTS-HD, 7.1) that FFmpeg would decode on
     * the CPU, next to a same-language track the box plays in hardware or
     * passes through: that one instead (AudioOrder.lighter). Once per load,
     * never over the viewer's own pick. Media3's default choice is the
     * "best" track (default flag, then channels), so TrueHD 7.1 beat AC3 5.1.
     */
    private fun chooseLighterAudio(s: PlayerSlot, p: ExoPlayer, tracks: androidx.media3.common.Tracks) {
        s.audioChoiceDone = true
        if (s.audioMode != AudioOrder.HARDWARE_FIRST || s.userPickedAudio) return
        val mapped = s.trackSelector?.currentMappedTrackInfo ?: return
        var selGroup: androidx.media3.common.TrackGroup? = null
        var sel: Format? = null
        for (g in tracks.groups) {
            if (g.type != C.TRACK_TYPE_AUDIO || !g.isSelected) continue
            for (i in 0 until g.length) if (g.isTrackSelected(i)) { selGroup = g.mediaTrackGroup; sel = g.getTrackFormat(i) }
        }
        val group = selGroup ?: return
        val fmt = sel ?: return
        var byFfmpeg = false
        val candidates = ArrayList<AudioOrder.Candidate>()
        for (r in 0 until mapped.rendererCount) {
            if (mapped.getRendererType(r) != C.TRACK_TYPE_AUDIO) continue
            val hw = p.getRenderer(r) is MediaCodecAudioRenderer
            val groups = mapped.getTrackGroups(r)
            for (gi in 0 until groups.length) {
                val tg = groups.get(gi)
                if (tg == group && !hw) byFfmpeg = true
                if (!hw) continue
                for (ti in 0 until tg.length) {
                    if (mapped.getTrackSupport(r, gi, ti) != C.FORMAT_HANDLED) continue
                    val f = tg.getFormat(ti)
                    candidates.add(AudioOrder.Candidate(r, gi, ti, f.language, f.channelCount, hardware = true))
                }
            }
        }
        val pick = AudioOrder.lighter(fmt.sampleMimeType, fmt.channelCount, fmt.language, byFfmpeg, s.userPickedAudio, candidates) ?: return
        val tg = mapped.getTrackGroups(pick.renderer).get(pick.group)
        val to = tg.getFormat(pick.track)
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(tg, pick.track))
            .build()
        Log.i(TAG, "audio: ${codecName(fmt.sampleMimeType)} ${fmt.channelCount}ch (FFmpeg) -> ${codecName(to.sampleMimeType)} ${to.channelCount}ch (hardware)")
    }

    /**
     * A film's hardware sound failed (the box's decoder, or a bitstream the
     * TV or receiver turned down): the same place again, once, on a player
     * built FFmpeg first, before anything is said to the WebView (whose
     * AUDIO_DECODE answer is a server conversion). The film keeps that order
     * until another title loads.
     */
    private fun restartWithSoftwareAudio(s: PlayerSlot, screenId: String, code: String) {
        val old = s.player ?: return
        val url = s.currentUrl ?: return
        val pos = old.currentPosition.takeIf { it > 0L } ?: s.lastPositionMs
        val play = old.playWhenReady || s.holding
        Log.w(TAG, "audio: hardware path failed (${code.removePrefix("ERROR_CODE_")}); FFmpeg first for this title")
        s.audioSwFallback = true
        s.audioSwFallbackUrl = url
        s.wantAudioMode = AudioOrder.FFMPEG_FIRST
        s.restarts++
        s.lastRestartReason = "sound on FFmpeg after ${code.removePrefix("ERROR_CODE_")}"
        cancelTimers(s)
        releasePlayer(s)
        buildPlayer(s, screenId)
        val p = s.player ?: return
        // What load() set up on the player it had.
        try {
            p.setVideoChangeFrameRateStrategy(
                if (s.matchFrameRate) C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF else C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS,
            )
        } catch (_: Throwable) { /* a player without it */ }
        s.trackSelector?.let { ts -> ts.setParameters(ts.buildUponParameters().setTunnelingEnabled(s.tunneled)) }
        s.loadControl?.beginStream(film = true)
        s.firstFrameSeen = false
        s.audioChoiceDone = false
        s.shutterView?.visibility = View.VISIBLE
        setPassthrough(s, screenId, false)
        applyFormat(s)
        p.setMediaItem(buildMediaItem(url, s.currentSubtitles), pos.coerceAtLeast(0L))
        p.prepare()
        p.playWhenReady = false
        if (play) {
            s.holding = true
            schedulePreBuffer(s, screenId, midFile = pos > 0L)
        }
        scheduleWatchdog(s, screenId)
        schedulePositionTick(s)
        scheduleBandwidthTick(s, screenId)
    }

    /** Multi-Screen tiles: stop() only stopped the media, so after one visit
     *  up to four players (threads, views, last-frame buffers) stayed alive
     *  for the rest of the session. load() rebuilds all of this on demand. */
    private fun releaseSlot(s: PlayerSlot) {
        if (slots[MAIN] === s) restoreDisplayMode()
        releasePlayer(s)
        s.container?.let { c -> (c.parent as? ViewGroup)?.removeView(c) }
        s.container = null
        s.videoView = null
        s.usesSurfaceView = false
        s.shutterView = null
        s.subtitleView = null
        s.videoW = 0
        s.videoH = 0
    }

    /** The player alone, the views kept: a rebuild for another renderer
     *  setup (asynchronous queueing) attaches the next one to the same view. */
    private fun releasePlayer(s: PlayerSlot) {
        releaseBoost(s)
        s.player?.release()
        s.player = null
        s.trackSelector = null
        s.loadControl = null
        s.scalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
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
        // The audio renderer order this player is built with (see
        // PlayerSlot.audioMode). Video is always MediaCodec: the FFmpeg
        // extension decodes no video.
        s.audioMode = s.wantAudioMode
        val renderersFactory = DefaultRenderersFactory(act)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(
                if (s.audioMode == AudioOrder.HARDWARE_FIRST) DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON
                else DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER,
            )
        // MediaCodec's asynchronous queueing: Media3 1.5 turns it on by
        // itself only on API 31+ (or a box reporting Amazon's TV feature);
        // generic API 28-30 boxes got the synchronous adapter, which feeds
        // a 4K decoder from the playback thread's own loop.
        s.asyncCodec = s.wantAsyncCodec && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        if (s.asyncCodec) renderersFactory.forceEnableMediaCodecAsynchronousQueueing()
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
        val plexAgent = "SnowMediaCenter/${BuildConfig.VERSION_NAME} (Linux; Android ${Build.VERSION.RELEASE}) " +
            "ExoPlayerLib/${MediaLibraryInfo.VERSION}"
        val plexFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)
            .setUserAgent(plexAgent)
            .setTransferListener(meter)
        // A file played as it is from a REMOTE server (load() says, by
        // route): the same agent and timeouts, but read over several range
        // requests at once (RangeFetchDataSource) as a window of unread plus
        // in-flight bytes: 4 connections on every box, 32 MiB (16 MiB on a
        // 2 GB box, taken out of its buffer budget below so memory does not
        // grow). One connection to a far server carried a customer's 12 Mb/s
        // film at 1.4-5.7 Mb/s while the Plex app on the same box played it
        // directly; parallel pieces are how a single slow flow is beaten.
        // Its bytes are counted as they ARRIVE, on its worker threads, into
        // the same counter the meter feeds for the other sources; the meter
        // itself is not attached to it (ByteMeter skips it too).
        val lowRam = isLowRamBox(act)
        lowRamBox = lowRam
        val rangeShared = RangeFetchDataSource.Shared(
            connections = RangeFetchDataSource.DEFAULT_CONNECTIONS,
            windowBytes = if (lowRam) RangeFetchDataSource.LOW_RAM_WINDOW_BYTES else RangeFetchDataSource.DEFAULT_WINDOW_BYTES,
            arrival = s.netBytes,
        )
        s.rangeShared = rangeShared
        val rangeFactory = RangeFetchDataSource.Factory(
            userAgent = plexAgent,
            connectTimeoutMs = 15000,
            readTimeoutMs = 30000,
            shared = rangeShared,
        )
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
        val dataSourceFactory = DefaultDataSource.Factory(act, PlexAwareFactory(httpFactory, plexFactory, transcodeFactory, rangeFactory) { s.rangeFetch })
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
            // killed: 50 s ahead within 112 MB, and never less than 20 s.
            // 128 MB was the budget, and still is for the file's bytes on
            // the box: the range reader's 16 MiB window (above) is taken
            // out of it, so a film played over several connections holds
            // no more memory than it did over one. A 1080p film at
            // 8-20 Mb/s keeps its full 50 s (50-112 MB), a 30 Mb/s remux
            // about 30 s. A 4K remux at 60-80 Mb/s would stop at 11-15 s on
            // the bytes alone, which one slow spell of the server's empties;
            // the floor carries it on to 20 s (150-200 MB), what the old
            // time-first profile held for it, and tops it up there as it
            // plays. Only a file above about 47 Mb/s goes past 112 MB, and
            // only as far as its 20 s. A 4K film keeps this budget here
            // (memory first), and gets the 4K start and restart
            // (SteadyLoadControl).
            val lc = SteadyLoadControl(
                minBufferMs = 50000,
                maxBufferMs = 50000,
                bufferForPlaybackMs = 2500,
                bufferForPlaybackAfterRebufferMs = 5000,
                targetBufferBytes = 128 * 1024 * 1024 - RangeFetchDataSource.LOW_RAM_WINDOW_BYTES,
                floorMs = 20000,
                uhdBudgetBytes = 0,
            )
            builder.setLoadControl(lc)
            s.loadControl = lc
            s.loadProfile = "steady · 50 s / 112 MB, 20 s floor"
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
        // Media3 handles the SurfaceView's surfaceCreated / surfaceDestroyed
        // itself (a placeholder surface in between), so no raw Surface here.
        when (val v = s.videoView) {
            is SurfaceView -> p.setVideoSurfaceView(v)
            is TextureView -> p.setVideoTextureView(v)
        }
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
                // Stalls/stallSec (statsOf), counted only after the first
                // picture — the start-up wait is firstFrameMs, not a stall.
                // A display mode switch under way (1-3 s of blank HDMI) is
                // not a stall either.
                if (state == Player.STATE_BUFFERING && s.firstFrameSeen && !inModeSwitch(s)) {
                    if (s.stallStartedAtMs == 0L) { s.stallStartedAtMs = SystemClock.elapsedRealtime(); s.stalls++ }
                } else if (s.stallStartedAtMs != 0L) {
                    s.stallSec += (SystemClock.elapsedRealtime() - s.stallStartedAtMs) / 1000.0
                    s.stallStartedAtMs = 0L
                }
                // Rewind live TV: the buffer ran out; back to the channel itself.
                if (state == Player.STATE_ENDED && screenId == MAIN && tsBuffer) { tsGoLive(s); return }
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
                // Time to first picture since load() — for both engines (statsOf).
                if (s.firstFrameMs == null) s.firstFrameMs = SystemClock.elapsedRealtime() - s.loadStartWallMs
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
                // Its HTTP status, a number only (the address carries the
                // token); with lastError, before anything is sent.
                val httpStatus = if (code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) httpStatusOf(error) else null
                s.lastHttpStatus = httpStatus
                // Rewind live TV: an error while playing the local buffer is
                // settled there (tsOnBufferError), never as a channel restart.
                if (screenId == MAIN && tsBuffer) { tsOnBufferError(s, error); return }
                // The sound output lost in a display mode switch (HDMI
                // renegotiating, a passthrough track to the TV or receiver
                // included): the same film again from where it was, not
                // "this sound can't be played" (which sends Plex to a
                // conversion).
                if (isAudioTrack && inModeSwitch(s) && s.currentUrl != null && !s.isLive && s.reconnectAttempts < MAX_VOD_RECONNECTS) {
                    reconnect(s, screenId, "sound reset by a display mode switch")
                    return
                }
                // A film whose hardware sound failed (the box's decoder, or a
                // bitstream the TV or receiver would not take): once, the
                // same place again with FFmpeg first, before anything is
                // said. AUDIO_DECODE sends Plex to a server conversion; that
                // must not happen more often than it did.
                if ((isAudioTrack || isAudioDecoder) && screenId == MAIN && !s.isLive && s.currentUrl != null &&
                    AudioOrder.canFallBack(s.audioMode, s.audioSwFallback)
                ) {
                    // Posted: the player is released and rebuilt, never from
                    // inside its own listener call.
                    val failed = p
                    val soundUrl = s.currentUrl
                    val codeName = error.errorCodeName
                    s.audioSwFallback = true
                    s.audioSwFallbackUrl = soundUrl
                    mainHandler.post {
                        if (s.player === failed && s.currentUrl == soundUrl) restartWithSoftwareAudio(s, screenId, codeName)
                    }
                    return
                }
                if (isAudioTrack || isAudioDecoder) {
                    releaseWifiIfStopped(s)
                    notifyListeners(
                        "playerError",
                        JSObject().put("screenId", screenId).put("code", "AUDIO_DECODE").put("message", error.message ?: localized(R.string.player_err_audio)),
                    )
                    return
                }
                // A Plex conversion the server answered with an error status
                // (a busy or confused transcoder): the same session once more,
                // then the WebView is told, with the status, and starts a
                // fresh session or another quality (PlexSection). Not the
                // identical session over and over.
                val failedUrl = s.currentUrl
                if (failedUrl != null && !s.isLive && code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS &&
                    isPlexTranscode(Uri.parse(failedUrl))
                ) {
                    s.transcodeHttpFails++
                    if (s.transcodeHttpFails < TRANSCODE_HTTP_TRIES && s.reconnectAttempts < MAX_RECONNECTS) {
                        reconnect(s, screenId, httpRestartReason(error, httpStatus))
                        return
                    }
                    releaseWifiIfStopped(s)
                    val ev = JSObject().put("screenId", screenId)
                        .put("code", "PLEX_TRANSCODE_HTTP")
                        .put("message", exhaustedMessage(error, failedUrl))
                    if (httpStatus != null) ev.put("httpStatus", httpStatus)
                    notifyListeners("playerError", ev)
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
                        else -> httpRestartReason(error, httpStatus)
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
                            .put("message", exhaustedMessage(error, url))
                            .put("httpStatus", httpStatus ?: JSONObject.NULL),
                    )
                    return
                }
                notifyListeners("playerError", JSObject().put("screenId", screenId).put("code", error.errorCodeName).put("message", error.message ?: localized(R.string.player_err_playback)))
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                notifyListeners("tracksChanged", JSObject().put("screenId", screenId))
                // Frame-rate matching, as early as the picture's frame rate
                // is known: the selected video track's (a file says it in
                // its header; a conversion may only say it once the first
                // segment is read, see onVideoInputFormatChanged).
                if (screenId == MAIN && s.matchFrameRate) matchFrameRate(s, screenId, selectedVideoFormat(tracks))
                // A film whose chosen sound is a heavy one FFmpeg would decode
                // on the CPU (TrueHD, DTS-HD, 7.1): a same-language track the
                // box plays in hardware or passes through, if there is one.
                if (screenId == MAIN && !s.isLive && !s.audioChoiceDone && !tracks.isEmpty) chooseLighterAudio(s, p, tracks)

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
            // The sound's output: a bitstream (passthrough) or PCM. Told to
            // the WebView when it changes (the volume shows "Volume on your
            // TV or receiver"), and the boost is let go of on a bitstream.
            override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
                setPassthrough(s, screenId, !Util.isEncodingLinearPcm(audioTrackConfig.encoding))
            }
            override fun onAudioUnderrun(
                eventTime: AnalyticsListener.EventTime,
                bufferSize: Int,
                bufferSizeMs: Long,
                elapsedSinceLastFeedMs: Long,
            ) {
                s.audioUnderruns++
                s.audioUnderrunGapMs += elapsedSinceLastFeedMs.coerceAtLeast(0L)
            }
            // The format the video decoder is handed: frame-rate matching's
            // second chance, for a stream whose track list had no rate.
            override fun onVideoInputFormatChanged(
                eventTime: AnalyticsListener.EventTime,
                format: Format,
                decoderReuseEvaluation: DecoderReuseEvaluation?,
            ) {
                if (screenId == MAIN && s.matchFrameRate && isCurrentItem(eventTime)) matchFrameRate(s, screenId, format)
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
                s.framesSkipped += decoderCounters.skippedOutputBufferCount
                s.maxConsecutiveDropped = maxOf(s.maxConsecutiveDropped, decoderCounters.maxConsecutiveDroppedBufferCount)
                s.droppedToKeyframe += decoderCounters.droppedToKeyframeCount
                s.frameOffsetUs += decoderCounters.totalVideoFrameProcessingOffsetUs
                s.frameOffsetCount += decoderCounters.videoFrameProcessingOffsetCount
                s.videoCounters = null
            }
        })
        // Frame-rate matching's last resort: the times of the first frames
        // shown, for a film whose rate nothing states (playback thread).
        if (screenId == MAIN) {
            p.setVideoFrameMetadataListener(object : VideoFrameMetadataListener {
                override fun onVideoFrameAboutToBeRendered(
                    presentationTimeUs: Long,
                    releaseTimeNs: Long,
                    format: Format,
                    mediaFormat: MediaFormat?,
                ) { timeFrame(s, presentationTimeUs) }
            })
        }
        s.player = p
        applyBoost(s)
    }

    /** Apply any pendingRect captured before the surface existed. A slot
     *  that is about to stream is ALWAYS visible; without a pendingRect
     *  yet, default the container to fullscreen so it composites (a
     *  later setRect resizes it). Prior INVISIBLE default caused
     *  "tile is black but audio plays" when a degenerate rect dropped.
     *  Either engine's load() (see there). */
    private fun applyPendingRect(s: PlayerSlot, screenId: String) {
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
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("url required"); return }
        val live = call.getBoolean("live", true) ?: true
        val subs = call.getArray("subtitles", null)
        // A Plex file from a remote server: read over several range requests
        // at once (RangeFetchDataSource). Off for Live TV, conversions, and a
        // server on this network, where one connection is all it takes.
        val rangeFetch = call.getBoolean("rangeFetch", false) ?: false
        // A film or episode may switch the display to its frame rate
        // (FrameRateMatch). Off unless asked for; never for Live TV or a tile.
        val matchFrameRate = call.getBoolean("matchFrameRate", false) ?: false
        // The film's frame rate as the WebView knows it (Plex's metadata); 0 = unknown.
        val hintFps = (call.getDouble("frameRate") ?: 0.0).toFloat().takeIf { it > 0f && it < 200f } ?: 0f
        // The remote switches for how the main player draws and decodes
        // (lib/playerFlags): a SurfaceView, MediaCodec's asynchronous
        // queueing, and (an A/B test, off unless asked) tunneled playback
        // for a film. Absent: off, as before these existed (tiles).
        val surfaceView = call.getBoolean("surfaceView", false) ?: false
        val asyncCodec = call.getBoolean("asyncCodec", false) ?: false
        val tunneled = call.getBoolean("tunneled", false) ?: false
        // Hardware audio first for a film (`audio_hw_first` and not the
        // viewer's "Decode audio on this box"). Absent: FFmpeg first.
        val audioHwFirst = call.getBoolean("audioHwFirst", false) ?: false
        // Seconds; a film resumed part-way. Absent or 0: the player's own start.
        val startSec = call.getDouble("startPosition")
        val startMs = if (startSec != null && startSec > 0.0) (startSec * 1000.0).toLong() else 0L
        val screenId = screenIdOf(call)
        val s = slotFor(screenId)
        // mpv (owner test builds only): "engine" defaults to exo, and is only
        // ever actually mpv for the main slot playing a live channel — see
        // EngineChoice. Read here (pure) so the UI-thread block below has it.
        val requestedEngine = call.getString("engine") ?: EngineChoice.EXO
        activity?.runOnUiThread {
            val availability = EngineChoice.Availability(
                inBuild = BuildConfig.SMC_WITH_MPV,
                androidOk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O,
                initFailed = mpvInitFailed,
            )
            val choice = EngineChoice.choose(requestedEngine, screenId, live, availability)
            var engine = choice.engine
            var fallbackReason = choice.fallbackReason
            if (engine == EngineChoice.MPV) {
                val second = secondEngineFor(screenId)
                if (second == null) {
                    engine = EngineChoice.EXO
                    fallbackReason = EngineChoice.INIT_FAILED
                } else {
                    s.second = second
                }
            }
            if (fallbackReason != null) {
                notifyListeners("engineFallback", JSObject().put("screenId", screenId).put("reason", fallbackReason))
            }
            // A change of engine tears the old one down first — its surface
            // (a TextureView or mpv's SurfaceView) belongs to the engine that
            // is leaving, not the one arriving.
            if (engine != s.engine) {
                if (s.engine == EngineChoice.MPV) s.second?.stop()
                // The rect the WebView just set (a preview box) is where the
                // new engine's picture goes too; stopSlot would forget it and
                // the rebuilt box would come up fullscreen.
                val keepRect = s.pendingRect
                stopSlot(s)
                releaseSlot(s)
                s.pendingRect = keepRect
                s.engine = engine
            }
            // ExoPlayer's view and codec setup for this slot. A change (a
            // remote switch flipped) tears down only what no longer fits:
            // the views for the other kind of view, the player alone for the
            // other codec setup (the next one draws on the same view).
            if (engine == EngineChoice.EXO) {
                val wantSv = VideoFit.useSurfaceView(screenId == MAIN, surfaceView)
                val wantAsync = screenId == MAIN && asyncCodec
                if (s.container != null && s.usesSurfaceView != wantSv) {
                    val keepRect = s.pendingRect
                    stopSlot(s)
                    releaseSlot(s)
                    s.pendingRect = keepRect
                }
                // A film keeps the FFmpeg order its hardware sound failed in.
                if (s.audioSwFallbackUrl != url) { s.audioSwFallback = false; s.audioSwFallbackUrl = null }
                val wantAudio = AudioOrder.mode(isMain = screenId == MAIN, live = live, hwFirst = audioHwFirst, fellBack = s.audioSwFallback)
                if (s.player != null && (s.wantAsyncCodec != wantAsync || s.audioMode != wantAudio)) {
                    cancelTimers(s)
                    releasePlayer(s)
                }
                s.wantSurfaceView = wantSv
                s.wantAsyncCodec = wantAsync
                s.wantAudioMode = wantAudio
            }
            if (!ensureSurface(s)) { call.reject("no activity/webview"); return@runOnUiThread }
            if (engine == EngineChoice.MPV) {
                val second = s.second ?: run { call.reject("mpv init failed"); return@runOnUiThread }
                // mpv plays live channels only: never a matched mode.
                s.matchFrameRate = false
                if (screenId == MAIN) restoreDisplayMode()
                activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                applyPendingRect(s, screenId)
                // mpv draws on its own SurfaceView (attach); ExoPlayer's
                // TextureView has no player behind it while mpv owns the slot.
                s.videoView?.visibility = View.INVISIBLE
                second.attach(s.container!!)
                applyFormat(s)
                cancelTimers(s)
                s.reportedPaused = false
                s.currentUrl = url
                s.currentSubtitles = null
                s.isLive = live
                s.lastPositionMs = startMs
                s.firstFrameSeen = false
                resetStats(s, url)
                s.shutterView?.visibility = View.VISIBLE
                second.load(url, live)
                second.setVolume(s.volume)
                schedulePositionTick(s)
                call.resolve()
                return@runOnUiThread
            }
            if (s.player == null) buildPlayer(s, screenId)
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            applyPendingRect(s, screenId)
            val p = s.player ?: run { call.reject("player init failed"); return@runOnUiThread }
            cancelTimers(s)
            // A new stream on the main player is always the channel itself.
            if (screenId == MAIN) tsReset()
            s.reportedPaused = false
            s.currentUrl = url
            s.currentSubtitles = subs
            s.isLive = live
            s.lastPositionMs = startMs
            s.reconnectAttempts = 0
            s.transcodeHttpFails = 0
            s.rangeFetch = rangeFetch && !live
            s.audioChoiceDone = false
            // Told again by the new stream's audio output (onAudioTrackInitialized).
            setPassthrough(s, screenId, false)
            // Tunneled playback (`tunneled_vod`, an A/B test, off by
            // default): a film on the main player's SurfaceView, never with
            // the volume boost (an effect on the audio session).
            if (screenId == MAIN) {
                s.tunneled = !live && tunneled && s.usesSurfaceView && s.volume <= 1f
                s.trackSelector?.let { ts -> ts.setParameters(ts.buildUponParameters().setTunnelingEnabled(s.tunneled)) }
            }
            // Frame-rate matching: a film or episode on the main player,
            // when the WebView asks (the setting and the remote switch).
            // Anything else puts the screen back in its own mode at once; a
            // film keeps the last one's mode until its own rate is known
            // (back-to-back episodes at the same rate blank nothing).
            s.matchFrameRate = matchFrameRate && !live && screenId == MAIN
            s.modeSwitchUntilMs = 0L
            s.modeWaitUntilMs = 0L
            s.hintFps = if (s.matchFrameRate) hintFps else 0f
            s.fpsLogged = false
            s.fpsEstimator = null
            if (screenId == MAIN) {
                mainHandler.removeCallbacks(restoreModeRunnable)
                if (!s.matchFrameRate) restoreDisplayMode()
                // While this plugin manages the mode, Media3 must not ask for
                // one of its own (Surface.setFrameRate, API 30+).
                try {
                    p.setVideoChangeFrameRateStrategy(
                        if (s.matchFrameRate) C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF else C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS,
                    )
                } catch (_: Throwable) { /* a player without it */ }
            }
            // Every connection again for this load: a refusal of the last
            // load's extra ranges lowered them for that load only.
            if (s.rangeFetch) s.rangeShared?.newLoad()
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
        activity?.runOnUiThread {
            if (s.engine == EngineChoice.MPV) { s.second?.play(); call.resolve(); return@runOnUiThread }
            // Rewind live TV: after a long pause the channel resumes from the
            // buffer where it stopped (tsOnPlay); otherwise exactly as before.
            releaseHold(s); if (!(screenId == MAIN && tsOnPlay(s))) s.player?.play(); reportPaused(s, screenId); call.resolve()
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        val s = slot(call)
        val screenId = screenIdOf(call)
        // During the hold playWhenReady is already false, so no listener
        // event follows — reportPaused says it.
        activity?.runOnUiThread {
            if (s.engine == EngineChoice.MPV) { s.second?.pause(); call.resolve(); return@runOnUiThread }
            releaseHold(s); s.player?.pause(); reportPaused(s, screenId)
            // Rewind live TV: a live channel with a buffer notes where it stopped.
            if (screenId == MAIN) tsOnPause(s)
            call.resolve()
        }
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val pos = call.getDouble("position") ?: 0.0
        val s = slot(call)
        activity?.runOnUiThread {
            if (s.engine == EngineChoice.MPV) {
                s.second?.seekTo(pos.coerceAtLeast(0.0))
                call.resolve()
                return@runOnUiThread
            }
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
            if (s.engine == EngineChoice.MPV) {
                val (pos, dur) = s.second?.position() ?: (0.0 to 0.0)
                call.resolve(JSObject().put("position", pos).put("duration", dur).put("playing", !s.reportedPaused))
                return@runOnUiThread
            }
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
     * token. A slot with no player answers with zeros and nulls. `memory`
     * (the stats panel) asks for the process's PSS too: Debug.getPss() is
     * not cheap, so the arrival poll every film runs leaves it out (null).
     */
    @PluginMethod
    fun getStats(call: PluginCall) {
        val screenId = screenIdOf(call)
        val memory = call.getBoolean("memory", false) == true
        val act = activity ?: run { call.resolve(statsOf(null, memory)); return }
        act.runOnUiThread { call.resolve(statsOf(slots[screenId], memory)) }
    }

    private fun statsOf(s: PlayerSlot?, memory: Boolean): JSObject {
        // mpv already builds this same shape (SecondEngine.stats) — only
        // engine/cpuPct/pssMb, which know about neither engine specifically,
        // are added here.
        if (s != null && s.engine == EngineChoice.MPV && s.second != null) {
            val o = s.second!!.stats()
            o.put("engine", EngineChoice.MPV)
            o.put("displayHz", displayHz() ?: JSONObject.NULL)
            o.put("cpuPct", cpuPctSince(s)?.let { Math.round(it * 10.0) / 10.0 } ?: JSONObject.NULL)
            o.put("pssMb", if (memory) cachedPssMb() else JSONObject.NULL)
            o.put("lowRamBox", isLowRamBoxCached())
            return o
        }
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
        // The meter counts bytes as they ARRIVE from the network for every
        // source (the range reader adds them on its worker threads; the
        // library's sources read straight off the socket), so `now` is the
        // arrival rate of the last window. `arrivalKbps` says so by name:
        // JS reads it where it must judge what the line delivers, and its
        // absence marks an older build whose range reader counted at read
        // time instead.
        o.put("nowKbps", s?.lastKbps?.takeIf { it >= 0L } ?: JSONObject.NULL)
        o.put("arrivalKbps", s?.lastKbps?.takeIf { it >= 0L } ?: JSONObject.NULL)
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
            // How the frames were paced (numbers only): frames skipped
            // because they were already late, the longest run dropped in a
            // row, drops back to a key frame, and how far ahead of their
            // time frames left the decoder on average (ms; negative = late).
            o.put("skippedFrames", s.framesSkipped + (c?.skippedOutputBufferCount ?: 0))
            o.put("maxConsecutiveDropped", maxOf(s.maxConsecutiveDropped, c?.maxConsecutiveDroppedBufferCount ?: 0))
            o.put("droppedToKeyframe", s.droppedToKeyframe + (c?.droppedToKeyframeCount ?: 0))
            val offUs = s.frameOffsetUs + (c?.totalVideoFrameProcessingOffsetUs ?: 0L)
            val offN = s.frameOffsetCount + (c?.videoFrameProcessingOffsetCount ?: 0)
            o.put("avgFrameOffsetMs", if (offN > 0) Math.round(offUs.toDouble() / offN / 100.0) / 10.0 else JSONObject.NULL)
        } else {
            o.put("renderedFrames", JSONObject.NULL)
            o.put("droppedFrames", JSONObject.NULL)
            o.put("skippedFrames", JSONObject.NULL)
            o.put("maxConsecutiveDropped", JSONObject.NULL)
            o.put("droppedToKeyframe", JSONObject.NULL)
            o.put("avgFrameOffsetMs", JSONObject.NULL)
        }
        // A software video decoder (Android's own c2.android.* / OMX.google.*):
        // a 4K film then plays on the CPU. Null with no video decoder.
        o.put("videoDecoderSoftware", s?.videoDecoderName?.let { isSoftwareDecoder(it) } ?: JSONObject.NULL)
        // How the picture reaches the screen (see PlayerSlot.videoView).
        o.put("surface", if (s?.videoView == null) JSONObject.NULL else if (s.usesSurfaceView) "SurfaceView" else "TextureView")
        o.put("tunneled", s?.tunneled == true)
        // The sound: which renderer comes first for this load, whether it goes
        // out as a bitstream, and the audio output's underruns (count, and
        // the time the output went unfed in them).
        o.put("audioOrder", if (s?.player == null) JSONObject.NULL else if (s.audioMode == AudioOrder.HARDWARE_FIRST) "hardware" else "ffmpeg")
        o.put("audioPassthrough", s?.audioPassthrough == true)
        o.put("audioUnderruns", s?.audioUnderruns ?: 0)
        o.put("audioUnderrunMs", s?.audioUnderrunGapMs ?: 0L)
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
        o.put("httpStatus", s?.lastHttpStatus ?: JSONObject.NULL)
        o.put("loadProfile", s?.let { loadProfileOf(it) } ?: JSONObject.NULL)
        // How many connections the file is being read over right now
        // (RangeFetchDataSource's live count: 0 while the window is full and
        // nothing is in flight); 1 for a conversion, Live TV, or a server on
        // this network.
        o.put("fetchConnections", if (s != null && s.rangeFetch) (s.rangeShared?.liveConnections?.get() ?: 0) else 1)
        // Whether this load reads the file over several connections, and how
        // many it may use at most (lowered by a refusal); 1 otherwise.
        val rangeFetch = s != null && s.rangeFetch
        o.put("rangeFetch", rangeFetch)
        o.put("connectionCap", if (rangeFetch) (s?.rangeShared?.connectionCap ?: 1) else 1)
        o.put("lowRamBox", isLowRamBoxCached())
        val rt = Runtime.getRuntime()
        o.put("javaHeapMb", (rt.totalMemory() - rt.freeMemory()) / MIB)
        o.put("nativeHeapMb", Debug.getNativeHeapAllocatedSize() / MIB)
        o.put("engine", s?.engine ?: EngineChoice.EXO)
        o.put("firstFrameMs", s?.firstFrameMs ?: JSONObject.NULL)
        o.put("stalls", s?.stalls ?: 0)
        o.put("stallSec", s?.let { Math.round(it.stallSec * 10.0) / 10.0 } ?: 0.0)
        o.put("cpuPct", s?.let { cpuPctSince(it) }?.let { Math.round(it * 10.0) / 10.0 } ?: JSONObject.NULL)
        o.put("pssMb", if (memory) cachedPssMb() else JSONObject.NULL)
        // The screen's refresh rate now, next to the video's frame rate:
        // whether frame-rate matching happened (23.976 next to "23.98fps").
        o.put("displayHz", displayHz() ?: JSONObject.NULL)
        return o
    }

    /** CPU used by this whole process since load(), against wall time since
     *  load() — the same figure for either engine (statsOf). Null before a
     *  load() has run (loadStartWallMs still 0). */
    private fun cpuPctSince(s: PlayerSlot): Double? {
        if (s.loadStartWallMs <= 0L) return null
        val wallMs = SystemClock.elapsedRealtime() - s.loadStartWallMs
        if (wallMs <= 0L) return null
        val cpuMs = Process.getElapsedCpuTime() - s.loadStartCpuMs
        return cpuMs.toDouble() / wallMs.toDouble() * 100.0
    }

    /** Debug.getPss() is process-wide and not cheap; good for PSS_CACHE_MS,
     *  and read on the stats thread, never on the caller's (the UI thread,
     *  where a stats panel polling every second would stall a slow box's
     *  frames). The caller gets the last value, or null before the first
     *  read has come back. It answers in KILOBYTES (smaps' Pss), not bytes:
     *  divided by MIB (build 46) a 300 MB process read as 0 MB on both
     *  engines. */
    private fun cachedPssMb(): Any {
        val now = SystemClock.elapsedRealtime()
        if ((pssCacheMb < 0L || now - pssCacheAtMs >= PSS_CACHE_MS) && pssRefreshing.compareAndSet(false, true)) {
            statsExecutor.execute {
                try {
                    pssCacheMb = Debug.getPss() / KIB_PER_MIB
                    pssCacheAtMs = SystemClock.elapsedRealtime()
                } catch (e: Throwable) {
                    // Keep the last value; asked again next time.
                } finally {
                    pssRefreshing.set(false)
                }
            }
        }
        val mb = pssCacheMb
        return if (mb < 0L) JSONObject.NULL else mb
    }

    /** isLowRamBox, read once per process (ActivityManager is a binder call). */
    private fun isLowRamBoxCached(): Boolean {
        lowRamBox?.let { return it }
        val act = activity ?: return false
        return isLowRamBox(act).also { lowRamBox = it }
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

    /** Android's own software decoders, by name. */
    private fun isSoftwareDecoder(name: String): Boolean =
        name.startsWith("c2.android.", ignoreCase = true) || name.startsWith("OMX.google.", ignoreCase = true) ||
            name.startsWith("ffmpeg", ignoreCase = true)

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
        // The codec string (a Dolby Vision profile shows as dvhe.07…) and
        // the transfer: PQ (HDR10 / Dolby Vision), HLG, or SDR.
        f.codecs?.takeIf { it.isNotBlank() }?.let { sb.append(" · ").append(it) }
        when (f.colorInfo?.colorTransfer) {
            C.COLOR_TRANSFER_ST2084 -> sb.append(" · PQ")
            C.COLOR_TRANSFER_HLG -> sb.append(" · HLG")
            C.COLOR_TRANSFER_SDR -> sb.append(" · SDR")
        }
        return sb.toString()
    }

    /** "EAC3 8ch 48.0kHz". */
    private fun describeAudio(f: Format): String {
        val sb = StringBuilder(codecName(f.sampleMimeType))
        if (f.channelCount > 0) {
            sb.append(' ').append(f.channelCount).append("ch")
            when (f.channelCount) { 8 -> sb.append(" (7.1)"); 6 -> sb.append(" (5.1)") }
        }
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
        if (slots[MAIN] === s) tsReset()
        // Leaving the film (Back, a stop, another screen): the screen goes
        // back to its own mode, never left at 24 Hz on the menus. A moment
        // later, so a stop followed by the next load of a film (a quality
        // change, a retry, the next episode) keeps it: that load cancels it.
        if (slots[MAIN] === s && requestedModeId != 0) {
            mainHandler.removeCallbacks(restoreModeRunnable)
            mainHandler.postDelayed(restoreModeRunnable, MODE_RESTORE_DELAY_MS)
        }
        s.matchFrameRate = false
        s.modeSwitchUntilMs = 0L
        s.modeWaitUntilMs = 0L
        s.fpsEstimator = null
        s.userPickedAudio = false
        setPassthrough(s, if (slots[MAIN] === s) MAIN else "", false)
        s.currentUrl = null
        clearStats(s)
        s.currentSubtitles = null
        s.lastPositionMs = 0L
        cancelTimers(s)
        s.reconnectAttempts = 0
        s.transcodeHttpFails = 0
        s.firstFrameSeen = false
        if (s.engine == EngineChoice.MPV) s.second?.stop()
        s.player?.stop()
        s.player?.clearMediaItems()
        s.subtitleView?.setCues(emptyList())
        // GONE keeps the TextureView and its last frame; the next load makes
        // the container VISIBLE again, so cover that frame now.
        s.shutterView?.visibility = View.VISIBLE
        // The main SurfaceView stays VISIBLE and attached: going GONE would
        // destroy its surface, and on the Fire TV models Media3 lists for its
        // output-surface workaround every surface change releases and
        // re-creates the decoder (black, then seconds waiting for a 4K key
        // frame) — a quality change or a retry is a stop and a load. The
        // closed shutter covers it; the box is as black as the decor behind.
        if (!s.usesSurfaceView) s.container?.visibility = View.GONE
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
            if (s.engine == EngineChoice.MPV) { s.second?.setVolume(s.volume); call.resolve(); return@runOnUiThread }
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
        // A bitstream to the TV or receiver can't be boosted (or turned
        // down here at all): no effect on its session.
        val gainMb = if (s.volume > 1f && !s.audioPassthrough) ((s.volume - 1f) * BOOST_MB_PER_UNIT).toInt() else 0
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
            if (s.engine == EngineChoice.MPV) { s.second?.setAudioEnabled(enabled); call.resolve(); return@runOnUiThread }
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
            // Never for the main box: it is added under the WebView once and
            // never moved (moving it would destroy its surface).
            if (screenId != MAIN && parent != null && wv != null) {
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
            if (s.engine == EngineChoice.MPV) {
                val mpvOut = JSArray()
                s.second?.tracks(type)?.forEach { mpvOut.put(it) }
                call.resolve(JSObject().put("tracks", mpvOut))
                return@runOnUiThread
            }
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
            if (s.engine == EngineChoice.MPV) {
                if (id != null) s.second?.selectTrack(type, id)
                call.resolve()
                return@runOnUiThread
            }
            val p = s.player
            if (p == null || id == null) { call.resolve(); return@runOnUiThread }
            if (type == C.TRACK_TYPE_AUDIO) s.userPickedAudio = true
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
        // mpv draws on its own view, which its MediaCodec output fills
        // edge to edge just as ExoPlayer fills the TextureView — so it is
        // sized the same way.
        val v: View = (if (s.engine == EngineChoice.MPV) s.second?.videoView() else s.videoView) ?: return
        val box = s.container ?: return
        // ExoPlayer's SurfaceView can't be transformed, and one larger than
        // its box may not be clipped by it: zoom keeps it the box's size and
        // has the decoder crop instead (VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_
        // CROPPING). Fit, fill and wide size it as the TextureView is.
        val exoSurface = s.engine == EngineChoice.EXO && v is SurfaceView
        if (exoSurface) {
            val mode = if (VideoFit.cropsInDecoder(s.format)) C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING else C.VIDEO_SCALING_MODE_SCALE_TO_FIT
            val p = s.player
            if (p != null && mode != s.scalingMode) { p.setVideoScalingMode(mode); s.scalingMode = mode }
        }
        // Before the first layout, or before anything is decoded, there is
        // nothing to fit; the layout listener and onVideoSizeChanged come back.
        val size = (if (exoSurface) VideoFit.surfaceViewSize(s.format, box.width, box.height, s.videoW, s.videoH, s.pixelRatio)
            else VideoFit.viewSize(s.format, box.width, box.height, s.videoW, s.videoH, s.pixelRatio)) ?: return
        // No matrix: the view itself has the picture's shape. A shrunken
        // picture in a box-sized view left the bars unpainted (the band in
        // bugs/plex-green-bar.md).
        (v as? TextureView)?.setTransform(null)
        val lp = v.layoutParams as? FrameLayout.LayoutParams ?: FrameLayout.LayoutParams(size[0], size[1])
        if (lp.width == size[0] && lp.height == size[1] && lp.gravity == Gravity.CENTER) return
        lp.width = size[0]
        lp.height = size[1]
        lp.gravity = Gravity.CENTER
        v.layoutParams = lp
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

    /** Whether mpv is offered on this box right now, and why not when it
     *  isn't (PlaybackScreen's disabled reason) — the same three EngineChoice
     *  reports for a real load(): not-in-build, android-too-old, init-failed. */
    @PluginMethod
    fun getEngines(call: PluginCall) {
        val availability = EngineChoice.Availability(
            inBuild = BuildConfig.SMC_WITH_MPV,
            androidOk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O,
            initFailed = mpvInitFailed,
        )
        val reason = when {
            !availability.inBuild -> EngineChoice.NOT_IN_BUILD
            !availability.androidOk -> EngineChoice.ANDROID_TOO_OLD
            availability.initFailed -> EngineChoice.INIT_FAILED
            else -> null
        }
        val mpv = JSObject().put("available", reason == null)
        if (reason != null) mpv.put("reason", reason)
        call.resolve(JSObject().put("mpv", mpv))
    }

    /**
     * mpv, for the whole app (MPVLib's API is static — one instance total).
     * Reached through Class.forName so a customer build (SMC_WITH_MPV off,
     * MpvEngine's class not even in the APK) never links MPVLib, even from
     * this line: a missing class just throws ClassNotFoundException, caught
     * below like any other failure to start it. `mpvInitFailed` then marks
     * mpv off for the rest of this process — never retried until a restart.
     */
    private fun secondEngineFor(screenId: String): SecondEngine? {
        mpvEngine?.let { return it }
        if (mpvInitFailed) return null
        val act = activity ?: return null
        return try {
            val cls = Class.forName("com.snowmedia.player.mpv.MpvEngine")
            val ctor = cls.getConstructor(Context::class.java, Handler::class.java, SecondEngine.Callbacks::class.java)
            val engine = ctor.newInstance(act.applicationContext, mainHandler, mpvCallbacks(screenId)) as SecondEngine
            mpvEngine = engine
            engine
        } catch (e: Throwable) {
            Log.w(TAG, "mpv did not start; playing on ExoPlayer (${e.javaClass.simpleName})")
            mpvInitFailed = true
            null
        }
    }

    /** Bridges mpv's events back into the SAME slot fields ExoPlayer's own
     *  Player.Listener updates, so statsOf and the JS events work the same
     *  for either engine. mpv only ever plays on `screenId` = "main"
     *  (EngineChoice), but nothing here assumes that. */
    private fun mpvCallbacks(screenId: String): SecondEngine.Callbacks = object : SecondEngine.Callbacks {
        override fun onState(state: String) {
            notifyListeners("playerState", JSObject().put("screenId", screenId).put("state", state))
        }
        override fun onPlaying(playing: Boolean) {
            notifyListeners("playerState", JSObject().put("screenId", screenId).put("playing", playing))
        }
        override fun onPaused(paused: Boolean) {
            val s = slotFor(screenId)
            if (paused == s.reportedPaused) return
            s.reportedPaused = paused
            notifyListeners("playerState", JSObject().put("screenId", screenId).put("paused", paused))
        }
        override fun onFirstFrame() {
            val s = slotFor(screenId)
            s.firstFrameSeen = true
            openShutterIfReady(s)
        }
        override fun onError(code: String, message: String) {
            slotFor(screenId).lastError = code
            notifyListeners("playerError", JSObject().put("screenId", screenId).put("code", code).put("message", message))
        }
        override fun onTracksChanged() {
            notifyListeners("tracksChanged", JSObject().put("screenId", screenId))
        }
        override fun onVideoSize(width: Int, height: Int, pixelRatio: Float) {
            val s = slotFor(screenId)
            s.videoW = width
            s.videoH = height
            s.pixelRatio = pixelRatio
            applyFormat(s)
        }
        override fun onBandwidth(kbps: Long) {
            if (screenId != MAIN) return
            val s = slotFor(screenId)
            s.lastKbps = kbps
            if (kbps > 0L) {
                if (s.kbpsMin < 0L || kbps < s.kbpsMin) s.kbpsMin = kbps
                if (kbps > s.kbpsMax) s.kbpsMax = kbps
                s.kbpsSum += kbps
                s.kbpsSamples++
            }
            notifyListeners("bandwidth", JSObject().put("screenId", screenId).put("kbps", kbps))
        }
        override fun onSubtitleText(text: String) {
            val s = slotFor(screenId)
            if (text.isBlank()) s.subtitleView?.setCues(emptyList())
            else s.subtitleView?.setCues(listOf(Cue.Builder().setText(text).build()))
        }
    }

    // ---- Rewind live TV (timeshift) -----------------------------------------
    // Idle unless the WebView calls timeshiftStart for a full-screen channel:
    // with no buffer every hook above returns at once and playback is exactly
    // as before. The channel keeps playing straight from the provider; a
    // second connection (TimeshiftManager) writes it to cacheDir/timeshift as
    // a local HLS playlist. A long pause, or a rewind, moves the main player
    // onto that playlist at the right moment; Go live (or forward past its
    // end) loads the channel itself again. Positions exchanged with the
    // WebView are "seconds behind live".
    //
    // ExoPlayer only. A channel playing on mpv (the owner-test engine) never
    // gets a buffer: timeshiftStart does nothing there, and the buffer is
    // never played on mpv's slot. The hooks are all in the ExoPlayer paths.

    private var tsManager: TimeshiftManager? = null
    /** The main player is playing the rewind buffer, not the channel. */
    private var tsBuffer = false
    /** A live pause with a buffer running: when (elapsedRealtime), and how far behind the channel's edge the picture was. */
    private var tsPausedAt = 0L
    private var tsPauseLagMs = 0L
    /** Last time an error in the buffer was recovered from, so a failing buffer can't loop. */
    private var tsRecoveredAt = 0L
    private val tsWindow = Timeline.Window()
    private val tsPauseRunnable = Runnable { tsPausedTooLong() }
    private val tsTickRunnable = object : Runnable {
        override fun run() {
            tsTick()
            if (tsBuffer) mainHandler.postDelayed(this, TS_TICK_MS)
        }
    }

    private fun tsManager(): TimeshiftManager? {
        tsManager?.let { return it }
        val root = context?.cacheDir?.let { File(it, "timeshift") } ?: return null
        // Left-overs of a run that was killed before it could wipe.
        TimeshiftManager.wipeFolder(root)
        return TimeshiftManager(root).also { tsManager = it }
    }

    /** Back to plain live playback bookkeeping (a new stream, a stop). */
    private fun tsReset() {
        tsBuffer = false
        tsClearPause()
        mainHandler.removeCallbacks(tsTickRunnable)
    }

    private fun tsClearPause() {
        tsPausedAt = 0L
        tsPauseLagMs = 0L
        mainHandler.removeCallbacks(tsPauseRunnable)
    }

    /** How far behind its newest data a live player shows the picture (what it has read but not played). */
    private fun tsLiveLag(p: ExoPlayer): Long =
        (p.bufferedPosition - p.currentPosition).coerceIn(0L, TS_MAX_LAG_MS)

    /** How far behind live the main player is while it plays the buffer; null when unknown. */
    private fun tsBehindMs(snap: TimeshiftSession.Snapshot): Long? {
        val p = slots[MAIN]?.player ?: return null
        var windowStartAbs = snap.epochMs + snap.startMs
        val tl = p.currentTimeline
        if (!tl.isEmpty) {
            tl.getWindow(p.currentMediaItemIndex, tsWindow)
            // The playlist's own dates (#EXT-X-PROGRAM-DATE-TIME), so a
            // window that has slid on since it was loaded is still exact.
            if (tsWindow.windowStartTimeMs != C.TIME_UNSET) windowStartAbs = tsWindow.windowStartTimeMs
        }
        val playheadAbs = windowStartAbs + p.currentPosition.coerceAtLeast(0L)
        return (snap.epochMs + snap.liveMs - playheadAbs).coerceAtLeast(0L)
    }

    /** Move the main player onto the buffer, [behindMs] behind live (clamped to what is there). */
    private fun tsSwitchToBuffer(s: PlayerSlot, behindMs: Long, play: Boolean): Boolean {
        val sess = tsManager?.current ?: return false
        val snap = sess.snapshot() ?: return false
        val p = s.player ?: return false
        val ctx = context ?: return false
        if (s.currentUrl == null || !s.isLive || s.engine != EngineChoice.EXO) return false
        val startAbs = snap.epochMs + snap.startMs
        val lastAbs = snap.epochMs + snap.endMs - TS_HOLD_BACK_MS
        if (lastAbs <= startAbs) return false
        val target = (snap.epochMs + snap.liveMs - behindMs).coerceIn(startAbs, lastAbs)
        tsClearPause()
        // Nothing of the channel's own connection may fire into the buffer.
        s.reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        s.reconnectRunnable = null
        s.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        s.watchdogRunnable = null
        tsBuffer = true
        val item = MediaItem.Builder()
            .setUri(Uri.fromFile(sess.playlist))
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            // Never speed up or slow down to chase a "live edge": the viewer chose this moment.
            .setLiveConfiguration(
                MediaItem.LiveConfiguration.Builder().setMinPlaybackSpeed(1f).setMaxPlaybackSpeed(1f).build(),
            )
            .build()
        val source = HlsMediaSource.Factory(DefaultDataSource.Factory(ctx)).createMediaSource(item)
        // A live-style stream for the load control (not a film's budget or start), told before prepare().
        s.loadControl?.beginStream(film = false)
        p.setMediaSource(source, target - startAbs)
        p.prepare()
        p.playWhenReady = play
        mainHandler.removeCallbacks(tsTickRunnable)
        mainHandler.postDelayed(tsTickRunnable, TS_TICK_MS)
        return true
    }

    /** Load the channel itself again (Go live). */
    private fun tsGoLive(s: PlayerSlot) {
        tsReset()
        val url = s.currentUrl ?: return
        val p = s.player ?: return
        s.firstFrameSeen = false
        s.loadControl?.beginStream(film = false)
        p.setMediaItem(buildMediaItem(url, s.currentSubtitles))
        p.prepare()
        p.playWhenReady = true
        scheduleWatchdog(s, MAIN)
    }

    /** Rewind (negative) or forward (positive) by [deltaMs]. */
    private fun tsSeekBy(s: PlayerSlot, deltaMs: Long) {
        val p = s.player ?: return
        if (!tsBuffer) {
            if (deltaMs >= 0) return // already live
            val behind = if (tsPausedAt > 0L) SystemClock.elapsedRealtime() - tsPausedAt + tsPauseLagMs else tsLiveLag(p)
            tsSwitchToBuffer(s, behind - deltaMs, play = p.playWhenReady)
            return
        }
        val snap = tsManager?.current?.snapshot() ?: run { tsGoLive(s); return }
        val behind = tsBehindMs(snap) ?: return
        // Forward past the end of the buffer: the channel itself.
        if (deltaMs > 0 && behind - deltaMs < (snap.liveMs - snap.endMs) + TS_HOLD_BACK_MS) { tsGoLive(s); return }
        val dur = p.duration
        var pos = (p.currentPosition + deltaMs).coerceAtLeast(0L)
        if (dur != C.TIME_UNSET && dur > TS_HOLD_BACK_MS) pos = minOf(pos, dur - TS_HOLD_BACK_MS)
        p.seekTo(pos)
    }

    /** pause() on the main player: a live channel with a buffer notes where it stopped. */
    private fun tsOnPause(s: PlayerSlot) {
        if (tsBuffer || !s.isLive || s.currentUrl == null) return
        if (tsManager?.current?.alive != true) return
        val p = s.player ?: return
        tsPausedAt = SystemClock.elapsedRealtime()
        tsPauseLagMs = tsLiveLag(p)
        mainHandler.removeCallbacks(tsPauseRunnable)
        mainHandler.postDelayed(tsPauseRunnable, TS_PAUSE_TO_BUFFER_MS)
    }

    /**
     * play() on the main player. A short pause resumes the channel as before
     * (the player still holds it in memory). A long one has normally moved
     * to the buffer already (tsPausedTooLong); if that could not happen then,
     * it is tried now. True when the buffer took over.
     */
    private fun tsOnPlay(s: PlayerSlot): Boolean {
        if (tsPausedAt == 0L || tsBuffer) { tsClearPause(); return false }
        val behind = SystemClock.elapsedRealtime() - tsPausedAt + tsPauseLagMs
        tsClearPause()
        if (behind < TS_PAUSE_TO_BUFFER_MS) return false
        return tsSwitchToBuffer(s, behind, play = true)
    }

    /**
     * Paused on a live channel for a while: move to the buffer (still paused)
     * before the channel's idle connection is dropped by the server, whose
     * reconnect would jump to live and play by itself.
     */
    private fun tsPausedTooLong() {
        val s = slots[MAIN] ?: return
        if (tsPausedAt == 0L || tsBuffer) return
        // Playing again by other means (a reconnect resumes by itself): no longer a pause.
        if (s.player?.playWhenReady != false) { tsClearPause(); return }
        val behind = SystemClock.elapsedRealtime() - tsPausedAt + tsPauseLagMs
        if (!tsSwitchToBuffer(s, behind, play = false)) {
            // Nothing captured yet: try again shortly.
            mainHandler.postDelayed(tsPauseRunnable, TS_PAUSE_TO_BUFFER_MS)
        }
    }

    /** An error while playing the buffer. */
    private fun tsOnBufferError(s: PlayerSlot, error: PlaybackException) {
        val now = SystemClock.elapsedRealtime()
        val snap = tsManager?.current?.snapshot()
        // The part being watched was dropped (the buffer is full and slides
        // on): carry on from a little after the oldest part left, once.
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && snap != null &&
            now - tsRecoveredAt > TS_RECOVER_GAP_MS) {
            tsRecoveredAt = now
            val play = s.player?.playWhenReady ?: true
            if (tsSwitchToBuffer(s, snap.liveMs - snap.startMs - TS_OLDEST_MARGIN_MS, play)) return
        }
        Log.w(TAG, "Rewind buffer error ${error.errorCodeName}; back to live")
        tsGoLive(s)
    }

    /** Every second while the buffer plays: caught up with its end (the capture stalled) means back to live. */
    private fun tsTick() {
        if (!tsBuffer) return
        val s = slots[MAIN] ?: return
        val snap = tsManager?.current?.snapshot() ?: run { tsGoLive(s); return }
        val p = s.player ?: return
        val behind = tsBehindMs(snap) ?: return
        if (p.playWhenReady && behind <= (snap.liveMs - snap.endMs) + TS_END_SLACK_MS) tsGoLive(s)
    }

    private fun tsStatus(): JSObject {
        val o = JSObject()
        val sess = tsManager?.current
        val snap = sess?.snapshot()
        o.put("state", sess?.state ?: "off")
        o.put("mode", if (tsBuffer) "buffer" else "live")
        o.put("availableSec", if (snap == null) 0.0 else (snap.liveMs - snap.startMs) / 1000.0)
        val behind = if (tsBuffer && snap != null) tsBehindMs(snap) ?: 0L else 0L
        o.put("behindSec", behind / 1000.0)
        o.put("usedBytes", tsManager?.usedBytes() ?: 0L)
        sess?.reason?.let { o.put("reason", it) }
        return o
    }

    /** Start (or keep) the rewind buffer of the channel [key] from [url]. Never logged: the URL carries the line. */
    @PluginMethod
    fun timeshiftStart(call: PluginCall) {
        val url = call.getString("url")
        val key = call.getString("key")
        if (url.isNullOrBlank() || key.isNullOrBlank()) { call.reject("url and key required"); return }
        val maxMinutes = (call.getInt("maxMinutes") ?: 0).coerceAtLeast(0)
        val capMb = (call.getInt("hardCapMb") ?: 4096).coerceAtLeast(64)
        activity?.runOnUiThread {
            // The buffer is ExoPlayer only: a channel on mpv gets none (status stays "off").
            if (slots[MAIN]?.engine == EngineChoice.MPV) { call.resolve(); return@runOnUiThread }
            val m = tsManager() ?: run { call.reject("no storage"); return@runOnUiThread }
            m.start(key, url, TimeshiftLimits(maxMinutes * 60_000L, capMb.toLong() * MIB))
            call.resolve()
        }
    }

    /** Stop capturing and delete the buffer now. The player goes back to live first. */
    @PluginMethod
    fun timeshiftStop(call: PluginCall) {
        activity?.runOnUiThread {
            slots[MAIN]?.let { if (tsBuffer) tsGoLive(it) }
            tsManager?.stop()
            call.resolve()
        }
    }

    /** Delete every rewind buffer now (leaving the player, sign-out). Recordings are elsewhere and untouched. */
    @PluginMethod
    fun timeshiftWipe(call: PluginCall) {
        activity?.runOnUiThread {
            slots[MAIN]?.let { if (tsBuffer) tsGoLive(it) }
            tsReset()
            tsManager?.wipeAll()
            call.resolve()
        } ?: run {
            // No activity (closing): still clear the disk.
            context?.cacheDir?.let { TimeshiftManager.wipeFolder(File(it, "timeshift")) }
            call.resolve()
        }
    }

    @PluginMethod
    fun timeshiftStatus(call: PluginCall) {
        activity?.runOnUiThread { call.resolve(tsStatus()) }
    }

    /** Rewind / forward by deltaSec (negative = back). Answers with the new status. */
    @PluginMethod
    fun timeshiftSeek(call: PluginCall) {
        val delta = ((call.getDouble("deltaSec") ?: 0.0) * 1000.0).toLong()
        activity?.runOnUiThread {
            slots[MAIN]?.let { s -> if (s.currentUrl != null) tsSeekBy(s, delta) }
            call.resolve(tsStatus())
        }
    }

    @PluginMethod
    fun timeshiftGoLive(call: PluginCall) {
        activity?.runOnUiThread {
            slots[MAIN]?.let { if (tsBuffer) tsGoLive(it) }
            call.resolve(tsStatus())
        }
    }

    /** Disk figures for Settings: what the buffer holds now, and the free / total space it is judged against. */
    @PluginMethod
    fun timeshiftUsage(call: PluginCall) {
        activity?.runOnUiThread {
            val vol = context?.cacheDir?.let { StorageBudget.volumeOf(it) }
            call.resolve(
                JSObject()
                    .put("usedBytes", tsManager?.usedBytes() ?: 0L)
                    .put("freeBytes", vol?.first ?: 0L)
                    .put("totalBytes", vol?.second ?: 0L),
            )
        }
    }

    /**
     * Home, another app over this one, the box going to sleep: the rewind
     * buffer is wiped (owner rule). Recordings run in their own service and
     * files, and carry on.
     */
    override fun handleOnStop() {
        tsReset()
        tsManager?.wipeAll()
        // A film doesn't play on behind the screen (with a SurfaceView a 4K
        // decoder would keep going into the placeholder surface). Paused;
        // playing again is the viewer's choice, as before (the WebView loads
        // the film again on return).
        slots[MAIN]?.let { s ->
            if (!s.isLive && s.currentUrl != null && s.engine == EngineChoice.EXO) {
                releaseHold(s)
                s.player?.playWhenReady = false
            }
        }
        // The app leaves the screen: so does a film's display mode. The
        // WebView stops the player too and loads it again on return, which
        // matches the mode again.
        restoreDisplayMode()
        super.handleOnStop()
    }

    override fun handleOnDestroy() {
        // The app is closing: the rewind buffer goes with it.
        tsReset()
        tsManager?.wipeAll()
        activity?.runOnUiThread {
            restoreDisplayMode()
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
            mpvEngine?.release()
            mpvEngine = null
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

/** Counts the bytes the player's HTTP sources receive (loader threads), as
 *  they arrive: the library's sources hand bytes on straight off the
 *  socket. The range reader (RangeFetchDataSource) counts its own on its
 *  worker threads, as its pieces arrive, and its read-time
 *  bytesTransferred() is for Media3's bandwidth meter only: counted here
 *  as well, a slow head piece would hide the bytes the other connections
 *  were bringing in, and then land them all in one window. */
private class ByteMeter(private val total: AtomicLong) : TransferListener {
    override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
    override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
    override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
        if (isNetwork && source !is RangeFetchDataSource) total.addAndGet(bytesTransferred.toLong())
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

/** A Plex file played as it is ({base}/library/parts/...). */
private fun isPlexFile(uri: Uri): Boolean = uri.path?.contains("/library/parts/") == true

/** Plex streams get the patient sources (a file played as it is, and a
 *  conversion, each with its own user agent); everything else (Live TV) the
 *  quick one. A file from a remote server (`rangeFetch`, per load) is read
 *  over several range requests at once (RangeFetchDataSource). */
private class PlexAwareFactory(
    private val normal: DataSource.Factory,
    private val plex: DataSource.Factory,
    private val transcode: DataSource.Factory,
    private val range: DataSource.Factory,
    private val rangeFetch: () -> Boolean,
) : DataSource.Factory {
    override fun createDataSource(): DataSource =
        PlexAwareDataSource(normal.createDataSource(), plex.createDataSource(), transcode.createDataSource(), range.createDataSource(), rangeFetch)
}

private class PlexAwareDataSource(
    private val normal: DataSource,
    private val plex: DataSource,
    private val transcode: DataSource,
    private val range: DataSource,
    private val rangeFetch: () -> Boolean,
) : DataSource {
    private var current: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        normal.addTransferListener(transferListener)
        plex.addTransferListener(transferListener)
        transcode.addTransferListener(transferListener)
        range.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val uri = dataSpec.uri
        val src = when {
            isPlexTranscode(uri) -> transcode
            isPlexFile(uri) && rangeFetch() -> range
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
