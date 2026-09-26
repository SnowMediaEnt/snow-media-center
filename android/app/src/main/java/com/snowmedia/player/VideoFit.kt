package com.snowmedia.player

/**
 * Screen format and the black shutter, as plain arithmetic with no Android in
 * it, so it can be checked off the device (SnowPlayerPlugin.applyFormat and
 * openShutterIfReady use it).
 *
 * The picture's own view (a TextureView) is sized to the picture and centred
 * in the player's black box. It used to fill the box and have "fit" shrink the
 * picture inside it with a matrix, which left the letterbox bars as parts of
 * that view nothing painted. A TextureView is opaque by default, so the black
 * box under it counted as covered and the bars kept whatever was last drawn
 * there: on the owner's TV a bright green band (YUV zeros) over the bottom bar
 * of a 1920x804 film (bugs/plex-green-bar.md). Sized to the picture, the bars
 * are the box's own black.
 */
internal object VideoFit {
    /**
     * The picture view's size in a `boxW` x `boxH` box, or null when there is
     * nothing to fit yet (no layout, or no picture decoded) and the view stays
     * as it is.
     *
     *   fit   letterbox / pillarbox: the whole picture, its own shape, inside the box.
     *   fill  the box, shape ignored.
     *   zoom  its own shape, covering the box; the box crops the rest.
     *   wide  16:9 whatever the stream says, inside the box.
     */
    fun viewSize(format: String, boxW: Int, boxH: Int, videoW: Int, videoH: Int, pixelRatio: Float): IntArray? {
        if (boxW <= 0 || boxH <= 0) return null
        if (format == "fill") return intArrayOf(boxW, boxH)
        val src = when {
            format == "wide" -> 16f / 9f
            videoW > 0 && videoH > 0 -> videoW * pixelRatio / videoH
            else -> return null
        }
        if (src <= 0f || !src.isFinite()) return null
        val box = boxW.toFloat() / boxH
        val wider = src > box
        val cover = format == "zoom"
        // Fit keeps the side the picture is longer on; zoom the other one.
        return if (wider != cover) {
            val h = Math.round(boxW / src)
            intArrayOf(boxW, if (cover) h else h.coerceIn(1, boxH))
        } else {
            val w = Math.round(boxH * src)
            intArrayOf(if (cover) w else w.coerceIn(1, boxW), boxH)
        }
    }

    /**
     * The shutter (black over the picture view) opens once this stream has
     * drawn its first frame and the start-up hold is over. During the hold the
     * first frame is drawn paused; "Getting ready…" shows over black, and the
     * picture appears when it starts to play (or the viewer pauses or plays).
     */
    fun shutterOpen(firstFrameSeen: Boolean, holding: Boolean): Boolean = firstFrameSeen && !holding
}
