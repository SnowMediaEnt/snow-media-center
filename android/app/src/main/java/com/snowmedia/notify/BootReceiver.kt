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
        if (!AlertStore(context).enabled) return
        AlertNotifier.ensureChannel(context)
        AlertPollScheduler.start(context)
    }
}
