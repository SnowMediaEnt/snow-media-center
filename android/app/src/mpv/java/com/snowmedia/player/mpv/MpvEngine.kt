package com.snowmedia.player.mpv

import android.content.Context
import android.os.Handler
import android.os.SystemClock
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.C
import com.getcapacitor.JSObject
import com.snowmedia.player.EngineChoice
import com.snowmedia.player.MpvOptions
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
 * Never forwards mpv's own log text to Log.* (see logMessage) — only the
 * mapped codes in onError go out, the same as ExoPlayer's errorCodeName.
 */
internal class MpvEngine(
    private val context: Context,
    private val mainHandler: Handler,
    private val callbacks: SecondEngine.Callbacks,
) : SecondEngine, MPVLib.EventObserver, MPVLib.LogObserver {

    companion object {
        private const val FIRST_FRAME_TIMEOUT_MS = 8000L
        private const val MAX_RESTARTS = 20
        private const val RESTART_DELAY_MS = 500L
        @Volatile private var created = false
    }

    private var container: ViewGroup? = null
    private var surfaceView: SurfaceView? = null

    private var url: String? = null
    private var live: Boolean = true
    private var restarts = 0
    private var lastRestartReason: String? = null
    private var lastError: String? = null
    private var loadStartedAt = 0L
    private var firstFrameMs: Long? = null
    private var stalls = 0
    private var stallStartedAt = 0L
    private var stallSecTotal = 0.0
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
        surfaceView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        val sv = SurfaceView(context)
        surfaceView = sv
        // Index 0: below the shutter and the SubtitleView, which the caller
        // already added to this same container (SnowPlayerPlugin.ensureSurface).
        container.addView(sv, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        sv.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                MPVLib.attachSurface(holder.surface)
                MPVLib.setOptionString("force-window", "yes")
            }
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                if (width > 0 && height > 0) MPVLib.setOptionString("android-surface-size", "${width}x$height")
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                MPVLib.setOptionString("vo", "null")
                MPVLib.detachSurface()
            }
        })
        ensureCreated()
    }

    private fun isLowRamBox(): Boolean = try {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        am.isLowRamDevice || mi.totalMem <= 2_200_000_000L
    } catch (_: Throwable) { false }

    private fun ensureCreated() {
        if (created) return
        MPVLib.create(context)
        MPVLib.init()
        created = true
        MPVLib.addObserver(this)
        MPVLib.addLogObserver(this)
        // Warn level only, if mpv allows it — never the raw text (logMessage).
        try { MPVLib.command(arrayOf("request_log_messages", "warn")) } catch (_: Throwable) { /* best effort */ }
        val lowRam = isLowRamBox()
        val ua = System.getProperty("http.agent") ?: "Mozilla/5.0 (Linux; Android)"
        for ((k, v) in MpvOptions.buildOptions(ua, lowRam)) {
            try { MPVLib.setOptionString(k, v) } catch (_: Throwable) { /* one bad option must not sink the rest */ }
        }
        val cacheMb = if (lowRam) MpvOptions.DEMUXER_MAX_BYTES_LOW_RAM_MB else MpvOptions.DEMUXER_MAX_BYTES_MB
        loadProfile = "mpv · cache $cacheMb MB · 10 s ahead"
        MPVLib.observeProperty("video-params/w", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("video-params/h", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("video-params/par", MPVLib.MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("track-list", MPVLib.MPV_FORMAT_NONE)
        MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG)
        MPVLib.observeProperty("cache-speed", MPVLib.MPV_FORMAT_INT64)
        MPVLib.observeProperty("sub-text", MPVLib.MPV_FORMAT_STRING)
    }

    override fun load(url: String, live: Boolean) {
        this.url = url
        this.live = live
        restarts = 0
        lastRestartReason = null
        lastError = null
        firstFrameMs = null
        stalls = 0
        stallStartedAt = 0L
        stallSecTotal = 0.0
        pendingW = 0; pendingH = 0; pendingPar = 1f
        lastKbps = -1L; kbpsMin = -1L; kbpsMax = -1L; kbpsSum = 0L; kbpsSamples = 0
        loadStartedAt = SystemClock.elapsedRealtime()
        lastState = "buffering"
        callbacks.onState("buffering")
        MPVLib.command(arrayOf("loadfile", url, "replace"))
        scheduleWatchdog()
    }

    private fun scheduleWatchdog() {
        watchdog?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            if (url != null && firstFrameMs == null) restart("no picture in 8 s")
        }
        watchdog = r
        mainHandler.postDelayed(r, FIRST_FRAME_TIMEOUT_MS)
    }

    /** Same contract as Exo's reconnect: up to MAX_RESTARTS, then
     *  RECONNECT_EXHAUSTED and no more tries until a fresh load(). */
    private fun restart(reason: String) {
        val u = url ?: return
        if (restarts >= MAX_RESTARTS) {
            callbacks.onError("RECONNECT_EXHAUSTED", "The stream keeps dropping. Try again.")
            return
        }
        restarts++
        lastRestartReason = reason
        lastState = "buffering"
        callbacks.onState("buffering")
        mainHandler.postDelayed({
            if (url == null) return@postDelayed
            firstFrameMs = null
            MPVLib.command(arrayOf("loadfile", u, "replace"))
            scheduleWatchdog()
        }, RESTART_DELAY_MS)
    }

    override fun play() { MPVLib.setPropertyBoolean("pause", false) }
    override fun pause() { MPVLib.setPropertyBoolean("pause", true) }
    override fun seekTo(seconds: Double) { MPVLib.command(arrayOf("seek", seconds.toString(), "absolute")) }

    override fun stop() {
        url = null
        watchdog?.let { mainHandler.removeCallbacks(it) }
        watchdog = null
        stallStartedAt = 0L
        lastState = "idle"
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
        val known = firstFrameMs != null
        o.put("videoDecoder", if (known) "MediaCodec (mpv)" else JSONObject.NULL)
        o.put("videoFormat", JSONObject.NULL)
        // mpv keeps its own render path; ExoPlayer's per-frame counters don't apply.
        o.put("renderedFrames", JSONObject.NULL)
        val dropped = (MPVLib.getPropertyInt("frame-drop-count") ?: 0) + (MPVLib.getPropertyInt("decoder-frame-drop-count") ?: 0)
        o.put("droppedFrames", dropped.toLong())
        o.put("audioDecoder", if (known) "mpv" else JSONObject.NULL)
        o.put("audioFormat", JSONObject.NULL)
        o.put("restarts", restarts)
        o.put("lastRestartReason", lastRestartReason ?: JSONObject.NULL)
        o.put("lastError", lastError ?: JSONObject.NULL)
        o.put("loadProfile", loadProfile ?: JSONObject.NULL)
        o.put("firstFrameMs", firstFrameMs ?: JSONObject.NULL)
        o.put("stalls", stalls)
        o.put("stallSec", Math.round(stallSecTotal * 10.0) / 10.0)
        return o
    }

    override fun release() {
        watchdog?.let { mainHandler.removeCallbacks(it) }
        watchdog = null
        try { MPVLib.removeObserver(this) } catch (_: Throwable) { /* never added */ }
        try { MPVLib.removeLogObserver(this) } catch (_: Throwable) { /* never added */ }
        try { MPVLib.destroy() } catch (_: Throwable) { /* already gone */ }
        created = false
    }

    private fun maybeReportVideoSize() {
        if (pendingW > 0 && pendingH > 0) callbacks.onVideoSize(pendingW, pendingH, if (pendingPar > 0f) pendingPar else 1f)
    }

    private fun onPausedForCache(active: Boolean) {
        if (active) {
            lastState = "buffering"
            callbacks.onState("buffering")
            if (firstFrameMs != null && stallStartedAt == 0L) {
                stallStartedAt = SystemClock.elapsedRealtime()
                stalls++
            }
        } else {
            if (stallStartedAt != 0L) {
                stallSecTotal += (SystemClock.elapsedRealtime() - stallStartedAt) / 1000.0
                stallStartedAt = 0L
            }
            lastState = "ready"
            callbacks.onState("ready")
        }
    }

    // ---- MPVLib.EventObserver — off the main thread; post everything. ----

    override fun event(eventId: Int) {
        mainHandler.post {
            when (eventId) {
                MPVLib.MPV_EVENT_START_FILE -> {
                    lastState = "buffering"
                    callbacks.onState("buffering")
                    scheduleWatchdog()
                }
                MPVLib.MPV_EVENT_PLAYBACK_RESTART -> {
                    if (firstFrameMs == null) {
                        firstFrameMs = SystemClock.elapsedRealtime() - loadStartedAt
                        watchdog?.let { mainHandler.removeCallbacks(it) }
                        watchdog = null
                        callbacks.onFirstFrame()
                    }
                    lastState = "ready"
                    lastPlaying = true
                    callbacks.onState("ready")
                    callbacks.onPlaying(true)
                }
                MPVLib.MPV_EVENT_END_FILE -> {
                    lastPlaying = false
                    if (live) restart("live stream ended")
                }
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
                // bytes/sec -> kbps, the same unit the 'bandwidth' event already uses.
                "cache-speed" -> { lastKbps = value * 8L / 1000L; callbacks.onBandwidth(lastKbps) }
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
                "paused-for-cache" -> onPausedForCache(value)
                "pause" -> { lastPlaying = !value; callbacks.onPaused(value) }
            }
        }
    }

    override fun eventProperty(property: String, value: String) {
        mainHandler.post {
            if (property == "sub-text") callbacks.onSubtitleText(value)
        }
    }

    // ---- MPVLib.LogObserver — never forwarded to Log.*; see the class doc. ----

    override fun logMessage(prefix: String, level: Int, text: String) {
        // Deliberately empty. Only mapped codes (RECONNECT_EXHAUSTED etc., via
        // onError) ever reach Log.* — mpv's own text never does.
    }
}
