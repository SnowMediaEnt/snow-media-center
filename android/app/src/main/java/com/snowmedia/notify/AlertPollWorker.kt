package com.snowmedia.notify

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Checks Supabase for active alerts and reconciles the notification shade with
 * what it finds: anything new is posted, anything that has gone away is
 * cleared. Then it books itself in again five minutes later.
 *
 * WHY A SELF-CHAINING ONE-SHOT AND NOT A PERIODIC WORKER: WorkManager refuses
 * any periodic interval under fifteen minutes — it silently clamps it — and
 * five minutes is what this needs to feel live. One-time work has no such
 * floor, so each run enqueues the next. The cost is that the chain must be
 * restarted explicitly after a reboot, which BootReceiver does.
 *
 * Everything here is read-only and unauthenticated: the anon key already ships
 * in the web bundle, and the row-level policy on app_alerts is what decides
 * what an anonymous reader can see. Nothing about a device is sent anywhere.
 */
class AlertPollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    /**
     * Which of the two alternating chain names this run holds, or null when it
     * is the fifteen-minute safety-net worker (which re-arms the chain from
     * scratch rather than booking the next link).
     */
    private val ranAs: String?
        get() = when {
            tags.contains(AlertPollScheduler.WORK_A) -> AlertPollScheduler.WORK_A
            tags.contains(AlertPollScheduler.WORK_B) -> AlertPollScheduler.WORK_B
            else -> null
        }

    override fun doWork(): Result {
        val store = AlertStore(applicationContext)
        if (!store.enabled) return Result.success()   // switched off; let the chain die

        val url = store.supabaseUrl
        val key = store.supabaseKey
        if (url.isNullOrBlank() || key.isNullOrBlank()) {
            continueChain()
            return Result.success()
        }

        // TWO questions, TWO queries, and they are not the same question.
        //   "what should I announce?"  -> only alerts RAISED recently
        //   "what is still active?"    -> every active alert, no time bound
        // Answering the second with the first's result cancelled a still-active
        // alert 24 hours after it was raised — including a severity=critical one
        // that AlertNotifier deliberately builds to survive a tap.
        val fresh = try {
            fetchAlerts(url, key, freshOnly = true)
        } catch (e: Exception) {
            Log.w(TAG, "Alert poll failed: ${e.message}")
            // A failed poll must not clear the shade: no answer is not the same
            // as "there are no alerts". Leave what is showing and try again.
            continueChain()
            return Result.success()
        }
        val liveIds = try {
            fetchAlerts(url, key, freshOnly = false).map { it.id }.toSet()
        } catch (e: Exception) {
            // Same rule: without a trustworthy answer we post but never cancel.
            Log.w(TAG, "Active-set poll failed, posting only: ${e.message}")
            null
        }

        reconcile(store, fresh, liveIds)
        continueChain()
        return Result.success()
    }

    private fun continueChain() {
        val name = ranAs
        if (name == null) {
            // Safety-net run. The chain is what gives five-minute latency; if
            // it has stopped, this is the run that notices and restarts it.
            AlertPollScheduler.start(applicationContext)
        } else {
            AlertPollScheduler.scheduleNext(applicationContext, name)
        }
    }

    /**
     * @param fresh   alerts new enough to announce.
     * @param liveIds every currently-active alert id, or null when that query
     *                failed — in which case nothing is cancelled, because an
     *                unanswered request is not evidence an alert went away.
     */
    private fun reconcile(store: AlertStore, fresh: List<Alert>, liveIds: Set<String>?) {
        if (liveIds != null) {
            // Gone from the server -> pull the notification, and forget that it
            // was dismissed so re-activating it in the hub shows it again.
            for (id in store.shown - liveIds) AlertNotifier.cancel(applicationContext, id)
            store.shown = store.shown intersect liveIds
            store.dismissed = store.dismissed intersect liveIds
        }

        // New since the last poll, and not already swiped away.
        val dismissed = store.dismissed
        val posted = store.shown.toMutableSet()
        for (alert in fresh) {
            if (alert.id in posted || alert.id in dismissed) continue
            // ONLY record it if it actually went up. post() returns false when
            // notifications are switched off for the app or for this channel —
            // cases where the framework drops notify() silently. Recording those
            // anyway meant that every alert raised while notifications were off
            // was burnt into `shown`, and turning notifications back on never
            // showed them, because `shown` is the "already handled" set.
            if (AlertNotifier.post(applicationContext, alert)) posted += alert.id
        }
        store.shown = posted
    }

    /**
     * @param freshOnly true  -> only alerts raised inside FRESH_WINDOW_MS, the
     *                           set worth ANNOUNCING. Without it, switching the
     *                           toggle on would dump the whole standing backlog
     *                           on screen at once and a month-old alert would
     *                           keep counting as news.
     *                  false -> every active alert, which is the only honest
     *                           answer to "what should still be on screen".
     */
    private fun fetchAlerts(baseUrl: String, apiKey: String, freshOnly: Boolean): List<Alert> {
        val since = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date(System.currentTimeMillis() - FRESH_WINDOW_MS))
        // app_alerts is a MULTIPLEXED table: alongside real broadcasts it holds
        // the '__pre_event__' control singleton that drives the pre-event banner
        // (see src/hooks/usePreEventAlert.ts). That row is plumbing, not a
        // message, and pushing it to every TV as a heads-up is exactly the kind
        // of thing a customer screenshots. Everything else still notifies.
        val q = "select=" + URLEncoder.encode("id,title,message,severity", "UTF-8") +
            "&active=eq.true" +
            "&app_match=neq." + URLEncoder.encode(PRE_EVENT_MATCH, "UTF-8") +
            (if (freshOnly) "&created_at=gte." + URLEncoder.encode(since, "UTF-8") else "") +
            "&order=created_at.desc&limit=" + (if (freshOnly) FRESH_LIMIT else ACTIVE_LIMIT)
        val conn = (URL("${baseUrl.trimEnd('/')}/rest/v1/app_alerts?$q").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("apikey", apiKey)
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Accept", "application/json")
            connectTimeout = 15_000
            readTimeout = 15_000
        }
        try {
            if (conn.responseCode !in 200..299) error("HTTP ${conn.responseCode}")
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val arr = JSONArray(body)
            val out = ArrayList<Alert>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val id = o.optString("id")
                val message = o.optString("message")
                if (id.isBlank() || message.isBlank()) continue
                out.add(
                    Alert(
                        id = id,
                        title = o.optString("title", "Snow Media"),
                        message = message,
                        severity = o.optString("severity", "info"),
                    ),
                )
            }
            return out
        } finally {
            conn.disconnect()
        }
    }

    private companion object {
        const val TAG = "SMC-Alerts"
        /** How recently an alert must have been raised to notify. */
        const val FRESH_WINDOW_MS = 24L * 60 * 60 * 1000
        /** Sentinel app_match of the pre-event banner's control row. */
        const val PRE_EVENT_MATCH = "__pre_event__"
        /** Most notifications to raise from one poll. */
        const val FRESH_LIMIT = 20
        /**
         * Ceiling on the active-set query. It only drives cancellation, and a
         * truncated answer would cancel a live notification, so it is set far
         * above any plausible number of simultaneously active alerts.
         */
        const val ACTIVE_LIMIT = 500
    }
}
