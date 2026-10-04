package com.snowmedia.player

import java.util.Locale

/**
 * Which display mode a film should play in, as plain arithmetic with no
 * Android in it, so it can be checked off the device (SnowPlayerPlugin hands
 * it Display.Mode's numbers and applies the answer as the window's
 * preferredDisplayModeId).
 *
 * A 23.976 fps film on a 60 Hz screen is shown with 3:2 pulldown: one frame
 * for three refreshes, the next for two. The uneven rhythm is the "a little
 * lag" the owner sees on 4K films. In a mode whose refresh rate is a whole
 * multiple of the film's rate every frame is on screen for the same time.
 *
 * Rules:
 * - Same resolution as the mode the screen is in; only the refresh rate
 *   moves. A change of size would also be a configuration change for the
 *   activity, never asked for.
 * - A mode fits when its rate is the film's times 1, 2, 3, 4 or 5. For x1
 *   and x2 within 0.05 Hz (60.00 does not fit 29.97, 59.94 does); for x3 to
 *   x5 within 0.025 Hz per repeat, so 120.00 fits 23.976 as loosely as 24.00
 *   does (one frame repeated every ~42 s).
 * - Exact first: a mode within 0.01 Hz per frame of the film's own rate.
 *   23.976 -> 23.976, then 47.952, then 119.88, and only then 24.000 or
 *   120.000. Among exact modes the preferred multiple: films (under 24.5 fps)
 *   x1, x2, x5; 25 / 29.97 / 30 fps x2 (50 / 59.94 / 60 Hz), then x4, x1;
 *   50 fps and up x1. Then the rate nearest the screen's present one.
 * - The screen's present mode is kept (no 1-3 s HDMI blank) when it is exact
 *   for the film, or when it fits and no exact mode exists. 24.000 Hz is not
 *   kept for a 23.976 film when a 23.976 mode is there.
 * - x2.5 (24 on 60 Hz) is 3:2 pulldown itself, the judder this exists to
 *   remove. It never counts as a fit; it is only a last resort when nothing
 *   fits and the screen's own mode is worse still (24 fps on a 50 Hz screen
 *   with no 24 Hz mode: 60 Hz).
 */
internal object FrameRateMatch {
    data class Mode(val id: Int, val width: Int, val height: Int, val refreshRate: Float)

    /** Refresh tolerance for x1 and x2, Hz. */
    const val TOLERANCE_HZ = 0.05f
    /** Per repeat, for x3 and up. */
    private const val TOLERANCE_PER_REPEAT_HZ = 0.025f
    /** Within this (per frame) a mode counts as the film's exact rate. */
    private const val EXACT_HZ = 0.01f
    private const val PULLDOWN = 2.5f

    /** The multiples tried, in order of preference, for a frame rate. */
    fun preferredMultiples(fps: Float): IntArray = when {
        fps < 24.5f -> intArrayOf(1, 2, 5, 4, 3)
        fps < 45f -> intArrayOf(2, 4, 1, 3, 5)
        else -> intArrayOf(1, 2, 3, 4, 5)
    }

    private fun tolerance(mult: Int): Float = if (mult <= 2) TOLERANCE_HZ else TOLERANCE_PER_REPEAT_HZ * mult

    /** The whole multiple of `fps` that `refresh` is, or 0 when none fits. */
    fun multipleOf(refresh: Float, fps: Float): Int {
        if (!(fps > 0f) || !(refresh > 0f)) return 0
        for (m in preferredMultiples(fps)) {
            if (Math.abs(refresh - fps * m) <= tolerance(m)) return m
        }
        return 0
    }

    fun fits(refresh: Float, fps: Float): Boolean = multipleOf(refresh, fps) > 0

    /** A fit within 0.01 Hz per frame: no repeated frame for minutes on end. */
    fun isExact(refresh: Float, fps: Float): Boolean {
        val m = multipleOf(refresh, fps)
        return m > 0 && Math.abs(refresh / m - fps) <= EXACT_HZ
    }

    private fun fitsPulldown(refresh: Float, fps: Float): Boolean =
        fps > 0f && Math.abs(refresh - fps * PULLDOWN) <= TOLERANCE_HZ

    private fun usable(fps: Float): Boolean = fps > 0f && !fps.isNaN() && !fps.isInfinite()

    /**
     * The mode to ask for, or null to leave the screen as it is: the frame
     * rate is unknown, the present mode already does (see the rules above),
     * or no mode of the same resolution does better.
     */
    fun pick(current: Mode, modes: List<Mode>, fps: Float): Mode? {
        if (!usable(fps)) return null
        val sameSize = modes.filter { it.width == current.width && it.height == current.height }
        val order = preferredMultiples(fps)
        val fitting = sameSize
            .filter { fits(it.refreshRate, fps) }
            .sortedWith(
                compareBy<Mode>(
                    { if (isExact(it.refreshRate, fps)) 0 else 1 },
                    { order.indexOf(multipleOf(it.refreshRate, fps)) },
                    { Math.abs(it.refreshRate / multipleOf(it.refreshRate, fps) - fps) },
                    { Math.abs(it.refreshRate - current.refreshRate) },
                ),
            )
        val anyExact = fitting.any { isExact(it.refreshRate, fps) }
        if (isExact(current.refreshRate, fps)) return null
        if (fits(current.refreshRate, fps) && !anyExact) return null
        val best = fitting.firstOrNull()
        if (best != null) return if (best.id == current.id) null else best
        // Last resort: 3:2 pulldown, only where the screen's own mode is not that already.
        if (fitsPulldown(current.refreshRate, fps)) return null
        return sameSize
            .filter { fitsPulldown(it.refreshRate, fps) }
            .minByOrNull { Math.abs(it.refreshRate - fps * PULLDOWN) }
    }

    /** Frame rates a film or an episode really comes in; an estimate snaps to the nearest. */
    private val KNOWN_RATES = floatArrayOf(23.976f, 24f, 25f, 29.97f, 30f, 47.952f, 48f, 50f, 59.94f, 60f)

    /**
     * The frame rate from the presentation times (microseconds) of frames as
     * they are shown, in order. Containers often store times to the
     * millisecond (Matroska), so single gaps of a 23.976 film read 41 or
     * 42 ms: the rate is the whole span over the number of frame periods in
     * it, each gap counted as the whole number of periods it holds (a frame
     * dropped in between is two). Snapped to the nearest rate films and
     * episodes come in, within 1%. Null with fewer than `minFrames` frames,
     * or with a gap that is no whole number of periods (variable frame rate,
     * a jump).
     */
    fun estimate(ptsUs: LongArray, count: Int, minFrames: Int = 24): Float? {
        if (count < minFrames || count > ptsUs.size) return null
        val gaps = LongArray(count - 1) { ptsUs[it + 1] - ptsUs[it] }
        if (gaps.any { it <= 0L || it > 200_000L }) return null
        val sorted = gaps.sortedArray()
        val median = sorted[sorted.size / 2].toDouble()
        var periods = 0L
        for (g in gaps) {
            val k = Math.round(g / median)
            if (k < 1 || Math.abs(g - k * median) > median * 0.25) return null
            periods += k
        }
        val span = (ptsUs[count - 1] - ptsUs[0]).toDouble()
        if (periods <= 0 || span <= 0.0) return null
        val raw = (periods * 1_000_000.0 / span).toFloat()
        val nearest = KNOWN_RATES.minByOrNull { Math.abs(it - raw) } ?: return null
        return if (Math.abs(nearest - raw) <= nearest * 0.01f) nearest else null
    }

    /** "23.976", "59.94", "60": for the log and the stats. */
    fun label(hz: Float): String {
        val s = String.format(Locale.US, "%.3f", hz)
        return if (s.contains('.')) s.trimEnd('0').trimEnd('.') else s
    }
}
