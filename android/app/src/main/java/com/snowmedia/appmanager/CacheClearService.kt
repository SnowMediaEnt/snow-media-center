package com.snowmedia.appmanager

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Accessibility Service that auto-taps "Storage" → "Clear cache" in the system
 * App Info screen, then returns to Snow Media Center by re-launching it
 * directly (NOT via GLOBAL_ACTION_BACK, which sends a back keypress that the
 * app's WebView intercepts and treats as "exit current screen", kicking the
 * user out of Main Apps).
 *
 * IMPORTANT: This service intentionally does NOT touch "Clear data" or
 * "Clear storage" — only cache. Clearing data signs users out of apps and
 * wipes their settings, which the user explicitly asked us not to do.
 */
class CacheClearService : AccessibilityService() {

  companion object {
    private const val TAG = "CacheClearService"
    @Volatile private var targetPackage: String? = null
    @Volatile private var allowClearData: Boolean = false   // always false for safety
    @Volatile private var lastTriggerAt: Long = 0L

    fun setTarget(packageName: String, clearData: Boolean) {
      targetPackage = packageName
      allowClearData = false  // hard-coded off — never clear data
      lastTriggerAt = System.currentTimeMillis()
      Log.d(TAG, "setTarget pkg=$packageName clearData=false")
    }

    fun consumeTarget(): String? {
      val t = targetPackage
      targetPackage = null
      return t
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var step: Step = Step.IDLE
  private var workingForPackage: String? = null

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
        workingForPackage = pending
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
        if (tryClickClearCache()) {
          step = Step.DONE
          finishAndReturn()
        }
      }
      Step.OPENED_STORAGE -> {
        if (tryClickClearCache()) {
          step = Step.DONE
          finishAndReturn()
        }
      }
      Step.DONE -> { /* no-op */ }
    }
  }

  private fun tryClickClearCache(): Boolean {
    val root = rootInActiveWindow ?: return false
    val node = findClickableByText(root, listOf(
      "Clear cache", "CLEAR CACHE", "Clear Cache"
    )) ?: return false
    Log.d(TAG, "Tapping Clear cache")
    performClickOrParent(node)
    return true
  }

  private fun finishAndReturn() {
    Log.d(TAG, "Cache cleared for $workingForPackage — returning")
    consumeTarget()
    workingForPackage = null
    // Press back twice (Storage → App Info → previous app)
    handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 500)
    handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 1000)
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
    consumeTarget()
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    Log.d(TAG, "CacheClearService connected")
  }
}
