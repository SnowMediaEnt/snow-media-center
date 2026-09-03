package com.snowmedia.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The poll is a chain of one-shot jobs (see AlertPollWorker), and a reboot
 * breaks the chain. Without this, alerts would go quiet on a box until someone
 * next opened SMC — which is exactly the case this feature exists for.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") return
        val store = AlertStore(context)
        // `enabled` defaults to true, so also require that the app has actually
        // run once and handed down the Supabase URL and key — otherwise this
        // would arm a poll on a fresh install that has nothing to poll.
        if (!store.enabled || !store.configured) return
        AlertNotifier.ensureChannel(context)
        AlertPollScheduler.start(context)
    }
}
