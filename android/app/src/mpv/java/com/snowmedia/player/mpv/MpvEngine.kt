package com.snowmedia.player.mpv

import android.content.Context
import android.os.Handler
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.C
import com.getcapacitor.JSObject
import com.snowmedia.player.MpvOptions
import com.snowmedia.player.MpvPlaybackClock
import com.snowmedia.player.SecondEngine
import dev.jdtech.mpv.MPVLib
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * mpv, for Live TV channels and the Live/Guide preview boxes only (see
 * EngineChoice) — compiled only when SMC_WITH_MPV is on (an owner test
 * build). MPVLib's API is a set of static JNI calls with no per-instance
 * handle, so there is exactly one MPVLib for the whole app: created and
 * init'd once (ensureCreated), kept across channel changes — a new channel
 * is `loadfile <url> replace`, never a fresh create/init — and destroyed
 * only in release() (SnowPlayerPlugin.handleOnDestroy).
 *
 * mpv's own events arrive off the main thread; every one of them is posted
 * to `mainHandler` before touching anything, including the callbacks.
 *
 * The picture: mpv draws with MediaCodec straight onto this engine's own
 * SurfaceView (MpvOptions.VIDEO_OUTPUT), never ExoPlayer's TextureView —
 * the plugin releases ExoPlayer when a slot changes engine. That output
 * needs the surface before it starts, so a stream is only ever loaded while
 * the surface exists (startFile), and the output is set again every time a
 * surface arrives: the SurfaceView's surface goes whenever the player box
 * is hidden (every stop()), and build 46 set the output to "null" then and
 * never back — every stream after the first stop played as sound over black.
 *
 * Logging: nothing here ever logs a URL or mpv's own text. Only option
 * NAMES that mpv turned down and the mapped codes in onError go out. (The
 * libmpv 0.5.1 JNI layer itself asks mpv for "v"-level messages and prints
 * each one to logcat before any of this code sees it; that cannot be turned
 * down from here — see bugs/mpv-black-screen.md.)
 */
internal class MpvEngine(
    private val context: Context,
    private val mainHandler: Handler,
    private val callbacks: SecondEngine.Callbacks,
) : SecondEngine, MPVLib.EventObserver {

    companion object {
        private const val TAG = "SnowPlayer"
        private const val FIRST_FRAME_TIMEOUT_MS = 8000L
        private const val MAX_RESTARTS = 20
        private const val RESTART_DELAY_MS = 500L
        @Volatile private var created = false
    }

    private var container: ViewGroup? = null
    private var surfaceView: SurfaceView? = null
    // The SurfaceView's surface exists and mpv has it (surfaceCreated).
    private var surfaceReady = false
    // A start that is waiting for the surface (startFile).
    private var startPending = false

    private var url: String? = null
    private var live: Boolean = true
    private val clock = MpvPlaybackClock(MAX_RESTARTS)
    // mpv's playback-restart has come for this attempt: it is playing.
    private var playbackStarted = false
    private var lastRestartReason: String? = null
    private var lastError: String? = null
    private var lastState = "idle"
    private var lastPlaying = false
    private var loadProfile: String? = null

    private var pendingW = 0
    private var pendingH = 0
    private var pendingPar = 1f

    private var lastKbps = -1L
    private var kbpsMin = -1L
    private var kbpsMax = -1L
    private var kbpsSum = 0L
    private var kbpsSamples = 0

    private var watchdog: Runnable? = null
    private var restartRunnable: Runnable? = null

    init {
        // Eagerly, so a missing native lib for this ABI (UnsatisfiedLinkError)
        // or any other failure to create/init mpv throws HERE — inside the
        // caller's try/catch around Class.forName + this constructor
        // (SnowPlayerPlugin.secondEngineFor) — instead of surfacing later
        // from inside a load() with nothing catching it.
        ensureCreated()
    }

    override fun attach(container: ViewGroup) {
        this.container = container
        if (surfaceView?.parent === container) { ensureCreated(); return }
        // Removing the old view destroys its surface right here (its
        // surfaceDestroyed runs while it is still `surfaceView`).
        surfaceView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        val sv = SurfaceView(context)
        surfaceView = sv
        // Index 0: below the shutter and the SubtitleView, which the caller
        // already added to this same container (SnowPlayerPlugin.ensureSurface).
        // Sized to the picture later (SnowPlayerPlugin.applyFormat).
        container.addView(sv, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        sv.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                if (holder !== surfaceView?.holder) return
                // mpv-android / Findroid order: the surface ("wid"), then the
                // output that draws on it. force-window keeps that output
                // alive between channels instead of rebuilding it each time.
                MPVLib.attachSurface(holder.surface)
                setOption("vo", MpvOptions.VIDEO_OUTPUT)
                setOption("force-window", "yes")
                surfaceReady = true
                if (startPending) startFile()
            }
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                if (holder !== surfaceView?.holder) return
                if (width > 0 && height > 0) setOption("android-surface-size", "${width}x$height")
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                if (holder !== surfaceView?.holder) return
                surfaceReady = false
                // Off the surface before it goes; surfaceCreated puts it back.
                setOption("vo", "null")
                setOption("force-window", "no")
                MPVLib.detachSurface()
            }
        })
        ensureCreated()
    }

    override fun videoView(): View? = surfaceView

    private fun isLowRamBox(): Boolean = try {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        am.isLowRamDevice || mi.totalMem <= 2_200_000_000L
    } catch (_: Throwable) { false }

    /** An option mpv turns down is named in the log (the name only — never
     *  its value), so a bad one can't go unnoticed the way build 46's
     *  stream-lavf-o-append did. */
    private fun setOption(key: String, value: String) {
        val r = try { MPVLib.setOptionString(key, value) } catch (_: Throwable) { -1 }
        if (r < 0) Log.w(TAG, "mpv did not accept option $key ($r)")
    }

    private fun ensureCreated() {
        if (created) return
        MPVLib.create(context)
        // Options before mpv_initialize, as mpv-android and Findroid set them.
        val lowRam = isLowRamBox()
        val ua = System.getProperty("http.agent") ?: "Mozilla/5.0 (Linux; Android)"
        for ((k, v) in MpvOptions.buildOptions(ua, lowRam)) setOption(k, v)
        MPVLib.init()
        created = true
        MPVLib.addObserver(this)
        val cacheMb = if (lowRam) MpvOptions.DEMUXER_MAX_BYTES_LOW_RAM_MB else MpvOptions.DEMUXER_MAX_BYTES_MB
        loadProfile = "mpv · cache $cacheMb MB · 10 s ahead"
        MPVLib.observeProperty("video-params/w", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("video-params/h", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("video-params/par", MPVLib.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("video-out-params/w", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("track-list", MPVLib.MPV_FORMAT_NONE)
        MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("idle-active", MPVLib.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("cache-speed", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("sub-text", MPVLib.MPV_FORMAT_STRING)
    }

    private fun setState(state: String) {
        lastState = state
        callbacks.onState(state)
    }

    override fun load(url: String, live: Boolean) {
        this.url = url
        this.live = live
        cancelRestart()
        lastRestartReason = null
        lastError = null
        clock.load(SystemClock.elapsedRealtime())
        pendingW = 0; pendingH = 0; pendingPar = 1f
        lastKbps = -1L; kbpsMin = -1L; kbpsMax = -1L; kbpsSum = 0L; kbpsSamples = 0
        setState("buffering")
        startFile()
        scheduleWatchdog()
    }

    /** Open `url` in mpv now, or as soon as the surface is there. */
    private fun startFile() {
        val u = url ?: return
        playbackStarted = false
        if (!surfaceReady) { startPending = true; return }
        startPending = false
        MPVLib.command(arrayOf("loadfile", u, "replace"))
    }

    private fun scheduleWatchdog() {
        watchdog?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            watchdog = null
            if (url != null && !clock.pictureUp) restart("no picture in 8 s")
        }
        watchdog = r
        mainHandler.postDelayed(r, FIRST_FRAME_TIMEOUT_MS)
    }

    private fun cancelWatchdog() {
        watchdog?.let { mainHandler.removeCallbacks(it) }
        watchdog = null
    }

    private fun cancelRestart() {
        restartRunnable?.let { mainHandler.removeCallbacks(it) }
        restartRunnable = null
    }

    /** Same contract as Exo's reconnect: up to MAX_RESTARTS in a row with no
     *  picture, then RECONNECT_EXHAUSTED and no more tries until a fresh
     *  load(). The stream is read from `url` when the restart runs, so one
     *  still waiting when the channel changes starts the new channel, never
     *  the old one again. */
    private fun restart(reason: String) {
        if (url == null || restartRunnable != null) return
        if (!clock.restart(SystemClock.elapsedRealtime())) {
            cancelWatchdog()
            lastError = "RECONNECT_EXHAUSTED"
            callbacks.onError("RECONNECT_EXHAUSTED", "The stream keeps dropping. Try again.")
            return
        }
        lastRestartReason = reason
        playbackStarted = false
        setState("buffering")
        val r = Runnable {
            restartRunnable = null
            if (url == null) return@Runnable
            startFile()
            scheduleWatchdog()
        }
        restartRunnable = r
        mainHandler.postDelayed(r, RESTART_DELAY_MS)
    }

    override fun play() { MPVLib.setPropertyBoolean("pause", false) }
    override fun pause() { MPVLib.setPropertyBoolean("pause", true) }
    override fun seekTo(seconds: Double) { MPVLib.command(arrayOf("seek", seconds.toString(), "absolute")) }

    override fun stop() {
        url = null
        cancelWatchdog()
        cancelRestart()
        startPending = false
        playbackStarted = false
        lastState = "idle"
        lastPlaying = false
        try { MPVLib.command(arrayOf("stop")) } catch (_: Throwable) { /* nothing loaded */ }
    }

    override fun position(): Pair<Double, Double> {
        val pos = MPVLib.getPropertyDouble("time-pos") ?: 0.0
        val dur = MPVLib.getPropertyDouble("duration") ?: 0.0
        return pos to dur
    }

    override fun setVolume(volume: Float) {
        MPVLib.setPropertyInt("volume", (volume.coerceIn(0f, 1.5f) * 100f).roundToInt())
    }

    override fun setAudioEnabled(enabled: Boolean) {
        MPVLib.setPropertyString("aid", if (enabled) "auto" else "no")
    }

    override fun tracks(type: Int): List<JSObject> {
        val want = if (type == C.TRACK_TYPE_AUDIO) "audio" else "sub"
        val count = MPVLib.getPropertyInt("track-list/count") ?: 0
        val out = ArrayList<JSObject>()
        for (i in 0 until count) {
            val base = "track-list/$i"
            if (MPVLib.getPropertyString("$base/type") != want) continue
            val mpvId = MPVLib.getPropertyInt("$base/id") ?: continue
            val lang = MPVLib.getPropertyString("$base/lang") ?: ""
            val title = MPVLib.getPropertyString("$base/title") ?: ""
            val o = JSObject()
            o.put("id", "0:$mpvId")
            o.put("label", title.ifBlank { lang.ifBlank { "Track ${i + 1}" } })
            o.put("language", lang)
            o.put("codec", MPVLib.getPropertyString("$base/codec") ?: "")
            o.put("selected", MPVLib.getPropertyBoolean("$base/selected") == true)
            o.put("supported", true)
            o.put("mimeType", "")
            o.put("channels", 0)
            out.add(o)
        }
        return out
    }

    private fun videoTrackCount(tracks: Int): Int =
        (0 until tracks).count { MPVLib.getPropertyString("track-list/$it/type") == "video" }

    override fun selectTrack(type: Int, id: String) {
        val prop = if (type == C.TRACK_TYPE_AUDIO) "aid" else "sid"
        if (id == "-1") { MPVLib.setPropertyString(prop, "no"); return }
        MPVLib.setPropertyString(prop, id.substringAfter(":", id))
    }

    /** The same shape SnowPlayerPlugin.statsOf() builds for ExoPlayer, plus
     *  firstFrameMs/stalls/stallSec — engine/cpuPct/pssMb are added by the
     *  caller, which knows about neither engine specifically. */
    override fun stats(): JSObject {
        val o = JSObject()
        val (pos, dur) = position()
        o.put("state", lastState)
        o.put("playing", lastPlaying)
        o.put("positionSec", pos)
        o.put("durationSec", dur)
        o.put("bufferedAheadSec", MPVLib.getPropertyDouble("demuxer-cache-duration") ?: 0.0)
        o.put("nowKbps", if (lastKbps >= 0L) lastKbps else JSONObject.NULL)
        if (kbpsSamples > 0) {
            o.put("avgKbps", kbpsSum / kbpsSamples)
            o.put("minKbps", kbpsMin)
            o.put("maxKbps", kbpsMax)
        } else {
            o.put("avgKbps", JSONObject.NULL)
            o.put("minKbps", JSONObject.NULL)
            o.put("maxKbps", JSONObject.NULL)
        }
        val known = clock.firstFrameMs != null
        // What actually decodes: "mediacodec" is the hardware path onto the
        // surface; "no" would be FFmpeg in software.
        val hwdec = if (known) MPVLib.getPropertyString("hwdec-current") else null
        o.put(
            "videoDecoder",
            when {
                !known -> JSONObject.NULL
                hwdec == null || hwdec.isBlank() -> "mpv"
                hwdec == "no" -> "FFmpeg (software, mpv)"
                else -> "MediaCodec (mpv)"
            },
        )
        o.put("videoFormat", JSONObject.NULL)
        // mpv keeps its own render path; ExoPlayer's per-frame counters don't apply.
        o.put("renderedFrames", JSONObject.NULL)
        val dropped = (MPVLib.getPropertyInt("frame-drop-count") ?: 0) + (MPVLib.getPropertyInt("decoder-frame-drop-count") ?: 0)
        o.put("droppedFrames", dropped.toLong())
        o.put("audioDecoder", if (known) "mpv" else JSONObject.NULL)
        o.put("audioFormat", JSONObject.NULL)
        o.put("restarts", clock.restarts)
        o.put("lastRestartReason", lastRestartReason ?: JSONObject.NULL)
        o.put("lastError", lastError ?: JSONObject.NULL)
        o.put("loadProfile", loadProfile ?: JSONObject.NULL)
        o.put("firstFrameMs", clock.firstFrameMs ?: JSONObject.NULL)
        o.put("stalls", clock.stalls)
        o.put("stallSec", clock.stallSec(SystemClock.elapsedRealtime()))
        return o
    }

    override fun release() {
        cancelWatchdog()
        cancelRestart()
        url = null
        try { MPVLib.removeObserver(this) } catch (_: Throwable) { /* never added */ }
        try { MPVLib.destroy() } catch (_: Throwable) { /* already gone */ }
        created = false
        surfaceReady = false
    }

    private fun maybeReportVideoSize() {
        if (pendingW > 0 && pendingH > 0) callbacks.onVideoSize(pendingW, pendingH, if (pendingPar > 0f) pendingPar else 1f)
    }

    /** This attempt has a picture on screen (MpvPlaybackClock.isPicture). */
    private fun onPicture() {
        if (url == null || clock.pictureUp) return
        val first = clock.picture(SystemClock.elapsedRealtime())
        cancelWatchdog()
        setState("ready")
        if (first) callbacks.onFirstFrame()
    }

    private fun onPausedForCache(active: Boolean) {
        clock.cachePause(active, SystemClock.elapsedRealtime())
        // Before this attempt's picture it stays "buffering" either way.
        if (active) setState("buffering") else if (clock.pictureUp) setState("ready")
    }

    /** mpv went idle: the stream ended or never opened (endedByItself). */
    private fun onIdle() {
        val idleNow = MPVLib.getPropertyBoolean("idle-active") == true
        val pending = startPending || restartRunnable != null
        if (!MpvPlaybackClock.endedByItself(idleNow, url != null, pending)) return
        lastPlaying = false
        if (live) restart("live stream ended") else setState("ended")
    }

    // ---- MPVLib.EventObserver — off the main thread; post everything. ----

    override fun event(eventId: Int) {
        mainHandler.post {
            when (eventId) {
                MPVLib.MPV_EVENT_START_FILE -> {
                    if (url != null && !clock.pictureUp) setState("buffering")
                }
                MPVLib.MPV_EVENT_PLAYBACK_RESTART -> {
                    if (url == null) return@post
                    playbackStarted = true
                    lastPlaying = true
                    callbacks.onPlaying(true)
                    if (!clock.pictureUp) {
                        val outW = MPVLib.getPropertyInt("video-out-params/w") ?: 0
                        val tracks = MPVLib.getPropertyInt("track-list/count") ?: 0
                        if (MpvPlaybackClock.isPicture(outW, tracks, videoTrackCount(tracks))) onPicture()
                    }
                }
                // Not a restart: mpv sends END_FILE for the file a channel
                // change (or a restart) replaces, too. See onIdle.
                MPVLib.MPV_EVENT_END_FILE -> lastPlaying = false
            }
        }
    }

    override fun eventProperty(property: String) {
        if (property == "track-list") mainHandler.post { callbacks.onTracksChanged() }
    }

    override fun eventProperty(property: String, value: Long) {
        mainHandler.post {
            when (property) {
                "video-params/w" -> { pendingW = value.toInt(); maybeReportVideoSize() }
                "video-params/h" -> { pendingH = value.toInt(); maybeReportVideoSize() }
                // A frame reached the output after playback had already
                // started (playback-restart came first): that is the picture.
                "video-out-params/w" -> if (value > 0L && playbackStarted) onPicture()
                // bytes/sec -> kbps, the same unit the 'bandwidth' event already uses.
                "cache-speed" -> {
                    lastKbps = value * 8L / 1000L
                    if (lastKbps > 0L) {
                        if (kbpsMin < 0L || lastKbps < kbpsMin) kbpsMin = lastKbps
                        if (lastKbps > kbpsMax) kbpsMax = lastKbps
                        kbpsSum += lastKbps
                        kbpsSamples++
                    }
                    callbacks.onBandwidth(lastKbps)
                }
            }
        }
    }

    override fun eventProperty(property: String, value: Double) {
        mainHandler.post {
            if (property == "video-params/par") { pendingPar = value.toFloat(); maybeReportVideoSize() }
        }
    }

    override fun eventProperty(property: String, value: Boolean) {
        mainHandler.post {
            when (property) {
                "paused-for-cache" -> if (url != null) onPausedForCache(value)
                "pause" -> { lastPlaying = !value; callbacks.onPaused(value) }
                "idle-active" -> if (value) onIdle()
            }
        }
    }

    override fun eventProperty(property: String, value: String) {
        mainHandler.post {
            if (property == "sub-text") callbacks.onSubtitleText(value)
        }
    }
}
