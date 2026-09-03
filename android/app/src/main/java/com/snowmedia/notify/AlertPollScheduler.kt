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
 * Owns the five-minute poll. Every enqueue goes through here so there is one
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
    private const val SAFETY_WORK_NAME = "smc-alert-poll-safety"
    private const val INTERVAL_MINUTES = 5L

    /** Start (or restart) the poll. Safe to call repeatedly. */
    fun start(context: Context) {
        enqueue(context, WORK_A, delayMinutes = 0)
        startSafetyNet(context)
    }

    /** Called by a finishing run to book the next one, five minutes out. */
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
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
    }

    private fun networkOnly(): Constraints =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
}
