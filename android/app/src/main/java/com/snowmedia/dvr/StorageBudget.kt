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

    /**
     * [dir] itself when it exists, else its nearest parent that does (null when none does).
     * A folder that has not been created yet sits on the same volume as that parent.
     */
    fun nearestExisting(dir: File): File? {
        var d: File? = dir
        while (d != null && !d.exists()) d = d.parentFile
        return d
    }

    /**
     * Free and total bytes of the volume holding [dir]; null when it can't be read.
     * [dir] need not exist yet (the Recordings folder is only created by the
     * first recording): StatFs throws on a missing path, so the nearest existing
     * parent is measured instead. Never report 0 for a folder that is merely new.
     */
    fun volumeOf(dir: File): Pair<Long, Long>? = try {
        val at = nearestExisting(dir)
        if (at == null) null else {
            val st = StatFs(at.path)
            st.availableBytes to st.totalBytes
        }
    } catch (_: Throwable) {
        null
    }
}
