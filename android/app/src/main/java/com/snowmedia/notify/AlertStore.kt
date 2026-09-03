package com.snowmedia.notify

import android.content.Context
import android.content.SharedPreferences

/**
 * Everything the background poller needs to survive a reboot, in one place.
 *
 * The Supabase URL and anon key are handed down from the WebView when alerts
 * are switched on, rather than hard-coded here: the web bundle is the single
 * source of truth for them, and a rebuilt APK that points at a different
 * project should not need the Kotlin recompiled to match.
 */
internal class AlertStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("smc_device_alerts", Context.MODE_PRIVATE)

    /**
     * ON by default — a service notice is no use sitting behind a switch
     * nobody found. `configured` is what stops that default from meaning
     * "ask again on every launch": see below.
     */
    var enabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, true)
        set(v) = prefs.edit().putBoolean(KEY_ENABLED, v).apply()

    /**
     * True once enable() has run at least once on this device — the URL and key
     * are stored, the channel exists, the poll is armed.
     *
     * The pairing with the default above is the whole point. `enabled` starts
     * true so alerts work without anyone opting in, and the app auto-enables on
     * first launch to arm the poll. `configured` records that this has happened,
     * so a viewer who then switches alerts OFF is never quietly switched back on
     * next launch — and a viewer who refused the Android 13 permission prompt is
     * never asked again on every single launch.
     */
    var configured: Boolean
        get() = prefs.getBoolean(KEY_CONFIGURED, false)
        set(v) = prefs.edit().putBoolean(KEY_CONFIGURED, v).apply()

    var supabaseUrl: String?
        get() = prefs.getString(KEY_URL, null)
        set(v) = prefs.edit().putString(KEY_URL, v).apply()

    var supabaseKey: String?
        get() = prefs.getString(KEY_KEY, null)
        set(v) = prefs.edit().putString(KEY_KEY, v).apply()

    /**
     * Alert ids currently showing as a notification. The poller diffs this
     * against what the server still says is active, which is what makes an
     * alert disappear from the TV by itself when it is switched off in the hub
     * — no push, no message, just the next poll finding it gone.
     */
    var shown: Set<String>
        get() = prefs.getStringSet(KEY_SHOWN, emptySet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet(KEY_SHOWN, v).apply()

    /** Alerts the viewer swiped away. Never re-posted while still active. */
    var dismissed: Set<String>
        get() = prefs.getStringSet(KEY_DISMISSED, emptySet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet(KEY_DISMISSED, v).apply()

    fun clearPosted() {
        prefs.edit().remove(KEY_SHOWN).remove(KEY_DISMISSED).apply()
    }

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_CONFIGURED = "configured"
        const val KEY_URL = "supabase_url"
        const val KEY_KEY = "supabase_key"
        const val KEY_SHOWN = "shown_ids"
        const val KEY_DISMISSED = "dismissed_ids"
    }
}
