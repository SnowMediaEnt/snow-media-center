package com.snowmedia.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Remembers that the viewer swiped an alert away, so the five-minute poll does
 * not put it straight back while the alert is still active in the hub. The id
 * is forgotten once the alert itself goes away, so re-activating an alert in
 * the hub does show it again.
 */
class AlertDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(AlertNotifier.EXTRA_ALERT_ID) ?: return
        val store = AlertStore(context)
        store.dismissed = store.dismissed + id
        store.shown = store.shown - id
    }
}
