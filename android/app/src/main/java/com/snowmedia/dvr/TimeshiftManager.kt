package com.snowmedia.dvr

import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * Rewind live TV's buffers: the channel being watched ([current]) and, for a
 * few seconds after a channel change, the one before it ([previous]), so
 * zapping straight back keeps what was rewindable. Everything lives under
 * [root] (cacheDir/timeshift) and nowhere else; recordings are elsewhere and
 * never touched here.
 *
 * Main thread only (the plugin calls it from runOnUiThread).
 */
internal class TimeshiftManager(private val root: File) {
    var current: TimeshiftSession? = null
        private set
    private var previous: TimeshiftSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private val dropPrevious = Runnable { previous?.close(); previous = null }

    @Volatile var limits = TimeshiftLimits(0L, DEFAULT_HARD_CAP)

    /** Capture [key] (a channel) from [url]. The same channel again is a no-op. */
    fun start(key: String, url: String, newLimits: TimeshiftLimits) {
        limits = newLimits
        val cur = current
        if (cur != null && cur.key == key) return
        val prev = previous
        if (prev != null && prev.key == key && prev.alive) {
            // Back to the channel just left: its buffer is still there.
            handler.removeCallbacks(dropPrevious)
            previous = null
            current = prev
            if (cur != null) retire(cur)
            return
        }
        if (cur != null) retire(cur)
        current = TimeshiftSession(key, url, File(root, "c" + System.nanoTime()), { limits }).also { it.start() }
    }

    /** Stop capturing. [graceMs] > 0 keeps the buffer that long for a quick return. */
    fun stop(graceMs: Long) {
        val cur = current ?: return
        current = null
        if (graceMs > 0) retire(cur, graceMs) else cur.close()
    }

    /** Delete every buffer, now: leaving the player, Home, sign-out, app closed. */
    fun wipeAll() {
        handler.removeCallbacks(dropPrevious)
        current?.close()
        previous?.close()
        current = null
        previous = null
        wipeFolder(root)
    }

    fun usedBytes(): Long = (current?.usedBytes() ?: 0L) + (previous?.usedBytes() ?: 0L)

    private fun retire(s: TimeshiftSession, graceMs: Long = GRACE_MS) {
        handler.removeCallbacks(dropPrevious)
        previous?.close()
        previous = s
        handler.postDelayed(dropPrevious, graceMs)
    }

    companion object {
        /** The old channel's buffer is kept this long after a channel change. */
        const val GRACE_MS = 8000L
        const val DEFAULT_HARD_CAP = 4L * 1024L * 1024L * 1024L

        /** Everything left in [root] (also left-overs of a run that was killed). */
        fun wipeFolder(root: File) {
            // Listed now, deleted in the background: a buffer started right
            // after this call is not in the list.
            val victims = try { root.listFiles() } catch (_: Throwable) { null } ?: return
            if (victims.isEmpty()) return
            Thread({
                for (f in victims) try { f.deleteRecursively() } catch (_: Throwable) { /* best effort */ }
            }, "smc-timeshift-wipe").start()
        }
    }
}
