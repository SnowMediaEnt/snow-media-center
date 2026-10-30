package com.snowmedia.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Owns the background poll (every fifteen minutes; see INTERVAL_MINUTES). Every enqueue goes through here so there is one
 * place that knows the interval and the uniqueness rules.
 *
 * WHY TWO ALTERNATING NAMES. Each run books the next one, and unique work
 * enqueued with REPLACE cancels whatever already holds that name — which, when
 * a running job books its own successor, is the running job itself. Alternating
 * between two names means a link only ever replaces the *previous*, already
 * finished link. Nothing cancels itself, and there are never more than two
 * records, which an APPEND chain would not give us.
 */
internal object AlertPollScheduler {
    const val WORK_A = "smc-alert-poll-a"
    const val WORK_B = "smc-alert-poll-b"
    /** Tag of a run someone asked for now (start(): enable, pollNow, Plex request, boot). */
    const val NOW_TAG = "smc-alert-poll-now"
    private const val SAFETY_WORK_NAME = "smc-alert-poll-safety"

    /**
     * Fifteen minutes, not five. While SMC is on screen the web app already
     * polls and has realtime, so a link only books the next one; the poll is
     * for alerts while SMC is closed, where a quarter of an hour is fine and
     * three HTTPS calls every five minutes, 24/7, on a 1 GB stick is not.
     */
    const val INTERVAL_MINUTES = 15L

    /**
     * A chain link this recent means the chain is alive and the safety net has
     * nothing to do. A link is booked INTERVAL_MINUTES after the last one ran;
     * five minutes of slack covers WorkManager running it a little late.
     */
    const val CHAIN_ALIVE_MS = (INTERVAL_MINUTES + 5L) * 60_000L

    /** What a run does: fetch or not, and how it keeps the chain going. */
    enum class Rearm { NEXT_LINK, RESTART_LATER, NONE }
    data class Plan(val fetch: Boolean, val rearm: Rearm)

    /**
     * The decision, pure so it can be unit-tested.
     *
     * - asked for now (NOW_TAG): always fetch — pollNow runs on the way back to
     *   the foreground so the shade never shows what the app knows is gone.
     * - a chain link: fetch only off screen; either way book the next link.
     * - the safety net: nothing at all while the chain is alive; otherwise
     *   fetch (off screen) and restart the chain one interval out (this run
     *   just fetched, so an immediate link would only repeat it).
     */
    fun plan(chainLink: Boolean, askedNow: Boolean, onScreen: Boolean, sinceLastLinkMs: Long): Plan = when {
        askedNow -> Plan(fetch = true, rearm = Rearm.NEXT_LINK)
        chainLink -> Plan(fetch = !onScreen, rearm = Rearm.NEXT_LINK)
        sinceLastLinkMs in 0 until CHAIN_ALIVE_MS -> Plan(fetch = false, rearm = Rearm.NONE)
        else -> Plan(fetch = !onScreen, rearm = Rearm.RESTART_LATER)
    }

    /** Start (or restart) the poll, running once now. Safe to call repeatedly. */
    fun start(context: Context) {
        enqueue(context, WORK_A, delayMinutes = 0)
        startSafetyNet(context)
    }

    /** The safety net found the chain dead: restart it, its first link one interval out. */
    fun restartLater(context: Context) {
        enqueue(context, WORK_A, INTERVAL_MINUTES)
        startSafetyNet(context)
    }

    /** Called by a finishing run to book the next one, one interval out. */
    fun scheduleNext(context: Context, ranAs: String?) {
        enqueue(context, if (ranAs == WORK_A) WORK_B else WORK_A, INTERVAL_MINUTES)
    }

    fun stop(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(WORK_A)
        wm.cancelUniqueWork(WORK_B)
        wm.cancelUniqueWork(SAFETY_WORK_NAME)
    }

    /**
     * The floor. A chain of one-shot jobs has one weakness: lose a link and it
     * never recovers — a force-stop, an aggressive OEM task killer, a run
     * cancelled mid-flight. WorkManager will not schedule a periodic job more
     * often than every fifteen minutes, which is exactly why the chain exists,
     * but as a backstop it turns "silent until someone opens the app" into "at
     * most a quarter of an hour late".
     *
     * KEEP, so re-running start() does not reset its interval on every launch.
     * It can overlap a chain run; the poll only diffs server state against what
     * is already on screen, so running it twice changes nothing.
     */
    private fun startSafetyNet(context: Context) {
        val request = PeriodicWorkRequestBuilder<AlertPollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(networkOnly())
            .addTag(SAFETY_WORK_NAME)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(SAFETY_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    private fun enqueue(context: Context, name: String, delayMinutes: Long) {
        val request = OneTimeWorkRequestBuilder<AlertPollWorker>()
            .setConstraints(networkOnly())
            .apply { if (delayMinutes > 0) setInitialDelay(delayMinutes, TimeUnit.MINUTES) }
            // The tag is how the run knows which name it holds, and therefore
            // which of the two to book next.
            .addTag(name)
            .apply { if (delayMinutes == 0L) addTag(NOW_TAG) }
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
    }

    private fun networkOnly(): Constraints =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
}
