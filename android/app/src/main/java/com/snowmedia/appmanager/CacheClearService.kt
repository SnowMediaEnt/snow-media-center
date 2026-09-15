package com.snowmedia.appmanager

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.ArrayDeque

/**
 * Accessibility Service that auto-taps "Storage" → "Clear cache" in the system
 * App Info screen, then returns to Snow Media Center by re-launching it
 * directly (NOT via GLOBAL_ACTION_BACK, which sends a back keypress that the
 * app's WebView intercepts and treats as "exit current screen", kicking the
 * user out of Main Apps).
 *
 * One app (setTarget) or a whole queue (startQueue): with a queue the service
 * opens the next app's App Info itself as soon as one is done or given up on,
 * and only returns to Snow Media Center after the last one. An App Info
 * screen that never offers "Clear cache" (some system apps, some OEM layouts)
 * is skipped after [PER_APP_TIMEOUT_MS] instead of stalling the run.
 * Progress goes to [progressListener]; the AppManager plugin forwards it to
 * the web layer as events.
 *
 * IMPORTANT: This service intentionally does NOT touch "Clear data" or
 * "Clear storage" — only cache. Clearing data signs users out of apps and
 * wipes their settings, which the user explicitly asked us not to do.
 */
class CacheClearService : AccessibilityService() {

  companion object {
    private const val TAG = "CacheClearService"
    private const val PER_APP_TIMEOUT_MS = 9_000L
    @Volatile private var targetPackage: String? = null
    @Volatile private var allowClearData: Boolean = false   // always false for safety
    @Volatile private var lastTriggerAt: Long = 0L
    private val queue = ArrayDeque<String>()
    @Volatile private var queueTotal = 0
    @Volatile private var queueDone = 0
    /** (packageName, status "cleared" | "skipped", done, total) */
    @Volatile var progressListener: ((String, String, Int, Int) -> Unit)? = null
    /** (done, total) once the whole queue has been walked. */
    @Volatile var doneListener: ((Int, Int) -> Unit)? = null

    fun setTarget(packageName: String, clearData: Boolean) {
      synchronized(queue) { queue.clear(); queueTotal = 1; queueDone = 0 }
      targetPackage = packageName
      allowClearData = false  // hard-coded off — never clear data
      lastTriggerAt = System.currentTimeMillis()
      Log.d(TAG, "setTarget pkg=$packageName clearData=false")
    }

    /** Queue several apps. The caller opens the first App Info; the service opens the rest. */
    fun startQueue(packages: List<String>) {
      synchronized(queue) {
        queue.clear()
        packages.drop(1).forEach { queue.add(it) }
        queueTotal = packages.size
        queueDone = 0
      }
      targetPackage = packages.firstOrNull()
      allowClearData = false
      lastTriggerAt = System.currentTimeMillis()
      Log.d(TAG, "startQueue ${packages.size} apps")
    }

    fun cancelQueue() {
      synchronized(queue) { queue.clear() }
      targetPackage = null
    }

    fun consumeTarget(): String? {
      val t = targetPackage
      targetPackage = null
      return t
    }

    private fun nextInQueue(): String? = synchronized(queue) { queue.pollFirst() }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var step: Step = Step.IDLE
  private var workingForPackage: String? = null
  private val watchdog = Runnable { giveUpOnCurrent() }

  private enum class Step { IDLE, OPENED_APP_INFO, OPENED_STORAGE, DONE }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
        event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return

    val pending = targetPackage ?: return
    // Only act if a target was set within the last 30s
    if (System.currentTimeMillis() - lastTriggerAt > 30_000) {
      consumeTarget(); step = Step.IDLE; return
    }

    val pkgName = event.packageName?.toString() ?: ""
    // Settings UI runs in com.android.settings (or OEM variant)
    if (!pkgName.contains("settings", ignoreCase = true)) return

    val root = rootInActiveWindow ?: return

    when (step) {
      Step.IDLE, Step.OPENED_APP_INFO -> {
        if (workingForPackage != pending) {
          workingForPackage = pending
          handler.removeCallbacks(watchdog)
          handler.postDelayed(watchdog, PER_APP_TIMEOUT_MS)
        }
        // 1) Try to find and click "Storage" / "Storage & cache" / "Storage usage"
        val storageNode = findClickableByText(root, listOf(
          "Storage & cache", "Storage and cache", "Storage usage", "Storage"
        ))
        if (storageNode != null) {
          Log.d(TAG, "Tapping Storage")
          performClickOrParent(storageNode)
          step = Step.OPENED_STORAGE
          // Schedule the cache-clear tap shortly after the next screen draws
          handler.postDelayed({ tryClickClearCache() }, 600)
          handler.postDelayed({ tryClickClearCache() }, 1400)
          return
        }
        // Some Android TV / older OEM screens show "Clear cache" directly on App Info
        tryClickClearCache()
      }
      Step.OPENED_STORAGE -> tryClickClearCache()
      Step.DONE -> { /* no-op */ }
    }
  }

  private fun tryClickClearCache(): Boolean {
    if (step == Step.DONE) return false
    val root = rootInActiveWindow ?: return false
    val node = findClickableByText(root, listOf(
      "Clear cache", "CLEAR CACHE", "Clear Cache"
    )) ?: return false
    Log.d(TAG, "Tapping Clear cache")
    performClickOrParent(node)
    // The tap is the job; finishing here covers the delayed taps too, which
    // used to rely on a later window event to notice they had worked.
    step = Step.DONE
    finishAndReturn("cleared")
    return true
  }

  /** The current app's screen never offered "Clear cache": move on. */
  private fun giveUpOnCurrent() {
    if (step == Step.DONE || workingForPackage == null) return
    Log.w(TAG, "No Clear cache for $workingForPackage — skipping")
    step = Step.DONE
    finishAndReturn("skipped")
  }

  private fun finishAndReturn(status: String) {
    val finished = workingForPackage ?: targetPackage ?: ""
    handler.removeCallbacks(watchdog)
    Log.d(TAG, "Cache $status for $finished")
    consumeTarget()
    workingForPackage = null
    queueDone += 1
    val done = queueDone
    val total = queueTotal
    try { progressListener?.invoke(finished, status, done, total) } catch (e: Exception) { Log.w(TAG, "progress: ${e.message}") }

    val next = nextInQueue()
    if (next != null) {
      // Straight on to the next app's App Info. The viewer sees Settings
      // change from one app to the next until the last one is done.
      handler.postDelayed({
        targetPackage = next
        lastTriggerAt = System.currentTimeMillis()
        step = Step.IDLE
        try {
          val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:$next"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
          startActivity(intent)
          // If Settings never draws the new screen, the watchdog still fires.
          workingForPackage = next
          handler.postDelayed(watchdog, PER_APP_TIMEOUT_MS)
        } catch (e: Exception) {
          Log.w(TAG, "Could not open App Info for $next: ${e.message}")
          workingForPackage = next
          step = Step.DONE
          finishAndReturn("skipped")
        }
      }, 500)
      return
    }

    // Bring Snow Media Center back to the foreground by launching its own
    // launch intent. This does NOT send a back keypress, so the in-app
    // WebView won't pop us out of Main Apps.
    handler.postDelayed({
      try {
        val pm = packageManager
        val launch = pm.getLaunchIntentForPackage(packageName)
        if (launch != null) {
          launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
          )
          startActivity(launch)
        } else {
          // Fallback: use back if our launch intent isn't available
          performGlobalAction(GLOBAL_ACTION_BACK)
          handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 500)
        }
      } catch (e: Exception) {
        Log.w(TAG, "Could not relaunch SMC: ${e.message}")
        performGlobalAction(GLOBAL_ACTION_BACK)
      }
      try { doneListener?.invoke(done, total) } catch (e: Exception) { Log.w(TAG, "done: ${e.message}") }
    }, 700)
    handler.postDelayed({ step = Step.IDLE }, 1500)
  }

  /** Walks the node tree looking for a node whose text equals (case-insensitive) any candidate. */
  private fun findClickableByText(
    root: AccessibilityNodeInfo,
    candidates: List<String>
  ): AccessibilityNodeInfo? {
    for (text in candidates) {
      val matches = root.findAccessibilityNodeInfosByText(text) ?: continue
      for (n in matches) {
        val nodeText = n.text?.toString()?.trim() ?: continue
        if (candidates.any { it.equals(nodeText, ignoreCase = true) }) {
          // Skip "Clear data" / "Clear storage" defensively
          if (nodeText.contains("data", ignoreCase = true) ||
              nodeText.contains("storage", ignoreCase = true) &&
              !nodeText.contains("cache", ignoreCase = true) &&
              text.contains("Clear", ignoreCase = true)) continue
          return n
        }
      }
    }
    return null
  }

  private fun performClickOrParent(node: AccessibilityNodeInfo) {
    var n: AccessibilityNodeInfo? = node
    while (n != null) {
      if (n.isClickable) {
        n.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return
      }
      n = n.parent
    }
    // Last resort: click the original even if not flagged clickable
    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
  }

  override fun onInterrupt() {
    step = Step.IDLE
    handler.removeCallbacks(watchdog)
    cancelQueue()
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    Log.d(TAG, "CacheClearService connected")
  }
}
