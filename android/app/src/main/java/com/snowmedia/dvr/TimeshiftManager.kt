package com.snowmedia.dvr

import java.io.File

/**
 * Rewind live TV's buffer: only the channel being watched ([current]), fed by
 * the main player's own bytes through [tee] (one connection to the channel:
 * see TimeshiftSession). A channel change closes the old one at once (capture
 * stopped, files deleted). Everything lives under [root] (cacheDir/timeshift)
 * and nowhere else; recordings are elsewhere and never touched here.
 *
 * Main thread only (the plugin calls it from runOnUiThread).
 */
internal class TimeshiftManager(private val root: File, private val tee: TimeshiftTee) {
    var current: TimeshiftSession? = null
        private set

    @Volatile var limits = TimeshiftLimits(0L, DEFAULT_HARD_CAP)

    /**
     * Sessions closed while their own connection was open: it is being
     * closed on their capture thread. The player must not open a channel
     * until they have let go too (a channel change while rewound closes the
     * old session here, before the new channel's load arrives).
     */
    private val closing = ArrayList<TimeshiftSession>()

    private fun noteClosing(s: TimeshiftSession) {
        if (s.holdsConnection()) closing.add(s)
    }

    /** Closed sessions still holding their own connection. */
    fun closingSessions(): List<TimeshiftSession> {
        closing.removeAll { !it.holdsConnection() }
        return closing.toList()
    }

    /**
     * The buffer's own connection would not close (its thread stuck past
     * Go live's wait): stop the buffer and cancel every connection of it
     * again, so the player can have the channel. How many were stuck.
     */
    fun stopStuck(): Int {
        var n = 0
        if (current?.holdsConnection() == true) { n++; stop() }
        for (c in closingSessions()) { n++; c.close() }
        return n
    }

    /** Anything of the buffer's is connected to a channel (or about to be). */
    fun holdsAny(): Boolean = current?.holdsConnection() == true || closingSessions().isNotEmpty()

    /** Capture [key] (a channel) from [url]. The same channel again is a no-op; a new one closes the old first. */
    fun start(key: String, url: String, newLimits: TimeshiftLimits) {
        limits = newLimits
        val cur = current
        if (cur != null && cur.key == key) return
        cur?.close()
        cur?.let { noteClosing(it) }
        current = TimeshiftSession(key, url, File(root, "c" + System.nanoTime()), { limits }, tee).also { it.start() }
    }

    /**
     * Stop capturing and delete the buffer now. [released] runs once the
     * session's own connection (if it had one) is closed: at once, or on its
     * capture thread (see TimeshiftSession.close).
     */
    fun stop(released: Runnable? = null) {
        val cur = current ?: run { released?.run(); return }
        current = null
        cur.close(released)
        noteClosing(cur)
    }

    /** Delete every buffer, now: leaving the player, Home, sign-out, app closed. [released]: as for [stop]. */
    fun wipeAll(released: Runnable? = null) {
        val cur = current
        current = null
        if (cur != null) { cur.close(released); noteClosing(cur) } else released?.run()
        wipeFolder(root)
    }

    fun usedBytes(): Long = current?.usedBytes() ?: 0L

    companion object {
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
