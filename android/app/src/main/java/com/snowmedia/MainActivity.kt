package com.snowmedia

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import com.snowmedia.appmanager.AppManagerPlugin
import com.snowmedia.billing.SmcBillingPlugin
import com.snowmedia.capture.SnowCapturePlugin
import com.snowmedia.keyboard.SnowKeyboardPlugin
import com.snowmedia.keyboard.SnowKeyboardState
import com.snowmedia.notify.SnowNotifyPlugin
import com.snowmedia.player.SnowPlayerPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before BridgeActivity initializes the Capacitor bridge.
        registerPlugin(AppManagerPlugin::class.java)
        registerPlugin(SnowPlayerPlugin::class.java)
        registerPlugin(SnowNotifyPlugin::class.java)
        registerPlugin(SnowCapturePlugin::class.java)
        registerPlugin(SnowKeyboardPlugin::class.java)
        registerPlugin(SmcBillingPlugin::class.java)
        bridgeBuilder.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e("SMC-WebView", "Renderer process gone. didCrash=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}")
                try {
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    webView.destroy()
                } catch (e: Exception) {
                    Log.w("SMC-WebView", "Failed to destroy crashed WebView cleanly", e)
                }
                Handler(Looper.getMainLooper()).postDelayed({ recreate() }, 350)
                return true
            }
        })
        super.onCreate(savedInstanceState)
    }

    /**
     * The remote's Play/Pause while typing. The Fire TV keyboard's legend
     * calls it "Next", and in Amazon's own apps it is — but a device log
     * (2026-09-16) showed the keyboard does nothing with it over a web page:
     * no editor action, no key event, nothing. A key the keyboard declines
     * is delivered here next, so it is reported to the page as the
     * keyboard's action (the log line says whether it arrived); the page
     * moves to the next field only when a text field is being edited, and
     * treats a duplicate arriving as a DOM key as an echo. Never consumed:
     * playback and everything else still see the key.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_NEXT -> {
                    Log.d("SnowKeyboard", "media key ${event.keyCode} reached the activity (imeVisible=${SnowKeyboardState.isVisible}) -> next")
                    SnowKeyboardState.emitAction("next")
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }
}