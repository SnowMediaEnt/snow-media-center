package com.snowmedia.player

/**
 * A 4K film on the main player: how to tell one, and how many bytes its
 * buffer may hold. Plain arithmetic with no Android in it, so it can be
 * checked off the device (SteadyLoadControl in SnowPlayerPlugin.kt uses it).
 *
 * The library's own byte budget (about 144 MB for a picture and a sound
 * track) holds one to two minutes of a 1080p film but only 15-19 s of a 4K
 * remux at 60-80 Mb/s, about what the Plex app keeps and with no room for a
 * slow spell of the server. The app runs with largeHeap, and the buffer lives
 * in that heap, so a 4K film may use up to half of it, 256 MiB at most
 * (27-34 s at 60-80 Mb/s on a box whose heap is 512 MiB), never less than
 * the library's own. 1080p and Live TV keep the library's budget.
 */
internal object UhdBuffer {
    /** A picture this tall, or this wide (a 3840x1600 scope film), is 4K. */
    const val MIN_HEIGHT = 1800
    const val MIN_WIDTH = 3200
    /** The most a 4K film's buffer may hold. */
    const val MAX_BUDGET_BYTES = 256 * 1024 * 1024
    /** After a stall a 4K film plays on with this much buffered, not the
     *  5 s a 1080p one needs (at ~1.2x its own rate 5 s is gone again in the
     *  next slow spell). Sooner when the buffer can't take more. */
    const val REBUFFER_MS = 10000

    fun isUhd(width: Int, height: Int): Boolean = height >= MIN_HEIGHT || width >= MIN_WIDTH

    /** The byte budget for a 4K film: half of `maxHeapBytes` (what the app's
     *  heap may grow to), at most MAX_BUDGET_BYTES, never below
     *  `libraryBytes` (the library's own budget for the same tracks). */
    fun budgetBytes(maxHeapBytes: Long, libraryBytes: Int): Int {
        val half = (maxHeapBytes / 2).coerceIn(0L, MAX_BUDGET_BYTES.toLong()).toInt()
        return maxOf(libraryBytes, half)
    }
}
