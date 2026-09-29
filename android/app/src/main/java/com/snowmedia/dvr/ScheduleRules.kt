package com.snowmedia.dvr

/**
 * Scheduled recordings, the rules only: no Android, no files, no clock of
 * its own (the caller passes "now"). Pure so the JVM tests can pin them, with
 * the same vectors the web side reads (src/lib/recordSchedule.vectors.json;
 * src/lib/recordSchedule.ts is the twin of the window / merge / conflict
 * rules). Change one side, change the other.
 *
 * A schedule is one programme: its true UTC start and end, and the padding it
 * was made with (a later change of the setting never moves it). It holds no
 * stream address, user name or password: those are rebuilt at fire time from
 * the login the Player has saved (LineCreds).
 */

/** The words in a schedule's `status`, shared with the JS side. */
internal object ScheduleStatus {
    const val SCHEDULED = "scheduled"
    const val RECORDING = "recording"
    const val DONE = "done"
    const val MISSED = "missed"
    const val FAILED = "failed"
}

/**
 * One scheduled programme. [host] and [userTag] name the line it was made on
 * (userTag is a short hash, LineCreds.userTag: never the user name).
 */
internal data class Sched(
    val id: String,
    val streamId: Long,
    val host: String,
    val userTag: String,
    /** The programme's own UTC start and end, ms. */
    val startUtcMs: Long,
    val endUtcMs: Long,
    val padBeforeMin: Int,
    val padAfterMin: Int,
    val status: String = ScheduleStatus.SCHEDULED,
    val channelName: String = "",
    val programmeTitle: String = "",
    val volumeId: String = "box",
    /** Streams the plan allowed when it was scheduled; 0 = not known. */
    val maxConnections: Int = 0,
    /** Why it failed or was missed, in plain words. */
    val reason: String? = null,
    /** The recording (RecordingService job) that is carrying it out. */
    val recordingId: String? = null,
    /** When it became done / missed / failed, ms (0 = not yet). */
    val finishedAtMs: Long = 0L,
)

/** Jobs that will run: same line and channel, padded windows joined. */
internal data class Merged(val lineKey: String, val streamId: Long, val startMs: Long, val endMs: Long, val ids: List<String>)

/** More recordings than the plan allows: at [atMs], [count] others are already running. */
internal data class Conflict(val atMs: Long, val count: Int)

internal enum class Fire { START, START_LATE, MISSED }

internal enum class RearmKind { ARM, START_NOW, MARK_MISSED, RESTART, MARK_DONE, PURGE }

internal data class Rearm(val id: String, val kind: RearmKind, val atMs: Long)

internal object ScheduleRules {
    /** One recording never runs longer than this. */
    const val MAX_RECORD_MS = 12L * 60L * 60L * 1000L
    /** An alarm this much after the padded start still counts as on time (alarms drift a little). */
    const val LATE_SLACK_MS = 3L * 60L * 1000L
    /** Done, missed and failed entries are kept this long. */
    const val KEEP_MS = 7L * 24L * 60L * 60L * 1000L
    /** "Start now" goes through an alarm this far ahead (never straight from a boot receiver). */
    const val NOW_LEAD_MS = 5_000L
    /** A recording that died with less than this left is not worth restarting. */
    const val RESTART_MIN_LEFT_MS = 60_000L
    private const val MIN_MS = 60_000L

    fun lineKey(s: Sched): String = s.host + "|" + s.userTag

    fun paddedStart(s: Sched): Long = s.startUtcMs - s.padBeforeMin * MIN_MS

    /** Padded end, cut at [MAX_RECORD_MS] after the padded start. */
    fun paddedEnd(s: Sched): Long = minOf(s.endUtcMs + s.padAfterMin * MIN_MS, paddedStart(s) + MAX_RECORD_MS)

    fun isActive(s: Sched): Boolean = s.status == ScheduleStatus.SCHEDULED || s.status == ScheduleStatus.RECORDING

    /**
     * Back-to-back recordings of one channel on one line become one job (one
     * stream, one file): windows that touch or overlap are joined, as long as
     * the joined job stays within [MAX_RECORD_MS]. Sorted by start.
     */
    fun mergeAdjacent(list: List<Sched>): List<Merged> {
        val out = ArrayList<Merged>()
        for ((key, group) in list.groupBy { lineKey(it) to it.streamId }) {
            var cur: Merged? = null
            for (s in group.sortedWith(compareBy({ paddedStart(it) }, { it.id }))) {
                val ps = paddedStart(s)
                val pe = paddedEnd(s)
                val c = cur
                if (c != null && ps <= c.endMs && maxOf(c.endMs, pe) - c.startMs <= MAX_RECORD_MS) {
                    cur = c.copy(endMs = maxOf(c.endMs, pe), ids = c.ids + s.id)
                } else {
                    if (c != null) out.add(c)
                    cur = Merged(key.first, key.second, ps, pe, listOf(s.id))
                }
            }
            cur?.let { out.add(it) }
        }
        return out.sortedWith(compareBy({ it.startMs }, { it.ids.first() }))
    }

    /**
     * Would [candidate] make more than [cap] recordings run at once? Only
     * schedules still to run count, joined as they will be. The first moment
     * inside the candidate's job where the limit is passed, and how many
     * others are running then; null when it fits. A candidate with an id
     * already in [existing] replaces it.
     */
    fun conflicts(existing: List<Sched>, candidate: Sched, cap: Int): Conflict? {
        val limit = cap.coerceAtLeast(1)
        val all = existing.filter { isActive(it) && it.id != candidate.id } + candidate
        val merged = mergeAdjacent(all)
        val mine = merged.firstOrNull { candidate.id in it.ids } ?: return null
        // Ends sort before starts at the same moment: one ending as the next begins is not a clash.
        val events = merged
            .flatMap { listOf(it.startMs to 1, it.endMs to -1) }
            .sortedWith(compareBy({ it.first }, { it.second }))
        var running = 0
        for ((t, d) in events) {
            running += d
            if (d > 0 && running > limit && t >= mine.startMs && t < mine.endMs) return Conflict(t, running - 1)
        }
        return null
    }

    /** What an alarm that just went off should do. */
    fun planAtFire(s: Sched, now: Long): Fire = when {
        now >= paddedEnd(s) -> Fire.MISSED
        now - paddedStart(s) > LATE_SLACK_MS -> Fire.START_LATE
        else -> Fire.START
    }

    /**
     * What to do with every schedule after a reboot, an update, a clock
     * change or an app start. [busyIds] are the recordings really running (or
     * about to). Answers only for schedules that need something done, in the
     * order given.
     */
    fun rearmPlan(list: List<Sched>, now: Long, busyIds: Set<String> = emptySet()): List<Rearm> {
        val out = ArrayList<Rearm>()
        for (s in list) {
            val ps = paddedStart(s)
            val pe = paddedEnd(s)
            when (s.status) {
                ScheduleStatus.SCHEDULED -> when {
                    now >= pe -> out.add(Rearm(s.id, RearmKind.MARK_MISSED, now))
                    now >= ps -> out.add(Rearm(s.id, RearmKind.START_NOW, now + NOW_LEAD_MS))
                    else -> out.add(Rearm(s.id, RearmKind.ARM, ps))
                }
                ScheduleStatus.RECORDING -> {
                    if (s.recordingId != null && s.recordingId in busyIds) continue
                    if (pe - now > RESTART_MIN_LEFT_MS) out.add(Rearm(s.id, RearmKind.RESTART, now + NOW_LEAD_MS))
                    else out.add(Rearm(s.id, RearmKind.MARK_DONE, now))
                }
                else -> {
                    val finished = if (s.finishedAtMs > 0) s.finishedAtMs else pe
                    if (now - finished > KEEP_MS) out.add(Rearm(s.id, RearmKind.PURGE, now))
                }
            }
        }
        return out
    }
}

/** The plain-words reasons a schedule can end without a recording (also shown in the Recordings screen). */
internal object ScheduleReasons {
    const val NO_LOGIN = "Sign in to Live TV to record."
    const val OTHER_LINE = "Live TV is signed in to a different line."
    const val NO_SPACE = "Not enough free space."
    const val USB_GONE = "The USB drive wasn't connected."
    const val BLOCKED = "The box blocked a timed start. Allow Alarms & reminders for SMC."
    const val MISSED = "The box was off or SMC was force-stopped."
    const val START_FAILED = "The recording could not start."
    fun tooMany(running: Int): String =
        if (running == 1) "1 recording was already running." else "$running recordings were already running."
}
