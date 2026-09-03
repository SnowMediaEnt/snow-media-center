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

        val alerts = try {
            fetchActive(url, key)
        } catch (e: Exception) {
            Log.w(TAG, "Alert poll failed: ${e.message}")
            // A failed poll must not clear the shade: no answer is not the same
            // as "there are no alerts". Leave what is showing and try again.
            continueChain()
            return Result.success()
        }

        reconcile(store, alerts)
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

    private fun reconcile(store: AlertStore, alerts: List<Alert>) {
        val live = alerts.map { it.id }.toSet()

        // Gone from the server -> pull the notification, and forget that it was
        // dismissed so re-activating it in the hub shows it again.
        for (id in store.shown - live) AlertNotifier.cancel(applicationContext, id)
        store.shown = store.shown intersect live
        store.dismissed = store.dismissed intersect live

        // New since the last poll, and not already swiped away.
        val dismissed = store.dismissed
        val posted = store.shown.toMutableSet()
        for (alert in alerts) {
            if (alert.id in posted || alert.id in dismissed) continue
            AlertNotifier.post(applicationContext, alert)
            posted += alert.id
        }
        store.shown = posted
    }

    private fun fetchActive(baseUrl: String, apiKey: String): List<Alert> {
        // Only alerts RAISED recently, not every standing one. Without this,
        // switching the toggle on would dump the whole backlog of per-app
        // notices onto the screen at once, and an alert that has sat active for
        // a month would keep counting as news. A notification is for something
        // that just happened; the in-app banner still covers the rest.
        val since = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date(System.currentTimeMillis() - FRESH_WINDOW_MS))
        val q = "select=" + URLEncoder.encode("id,title,message,severity", "UTF-8") +
            "&active=eq.true" +
            "&created_at=gte." + URLEncoder.encode(since, "UTF-8") +
            "&order=created_at.desc&limit=20"
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
    }
}
