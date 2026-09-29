package com.snowmedia.dvr

import android.os.StatFs
import java.io.File

/**
 * How much disk Rewind live TV may use. The box always keeps at least
 * max(1 GB, 15% of the volume) free for everything else; within that the
 * buffer takes what is left, up to the hard cap. Same math as
 * rewindBudgetBytes in src/lib/liveRewind.ts (tested there).
 */
internal object StorageBudget {
    const val MIN_FREE_BYTES = 1L shl 30          // 1 GiB
    const val MIN_FREE_PERCENT = 15L

    fun reserveBytes(totalBytes: Long): Long =
        maxOf(MIN_FREE_BYTES, totalBytes / 100L * MIN_FREE_PERCENT)

    /** [usedBytes] is what the buffer already holds (it counts as available to itself). */
    fun allowedBytes(freeBytes: Long, totalBytes: Long, usedBytes: Long, hardCapBytes: Long): Long =
        maxOf(0L, minOf(hardCapBytes, usedBytes + freeBytes - reserveBytes(totalBytes)))

    /** Free and total bytes of the volume holding [dir]; null when it can't be read. */
    fun volumeOf(dir: File): Pair<Long, Long>? = try {
        val st = StatFs(dir.path)
        st.availableBytes to st.totalBytes
    } catch (_: Throwable) {
        null
    }
}
