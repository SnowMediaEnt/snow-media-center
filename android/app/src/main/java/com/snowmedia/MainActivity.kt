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
import com.snowmedia.notify.SnowNotifyPlugin
import com.snowmedia.player.SnowPlayerPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before BridgeActivity initializes the Capacitor bridge.
        registerPlugin(AppManagerPlugin::class.java)
        registerPlugin(SnowPlayerPlugin::class.java)
        registerPlugin(SnowNotifyPlugin::class.java)
        registerPlugin(SnowCapturePlugin::class.java)
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

    // The remote's media buttons never reach the page: Android's WebView keeps
    // KEYCODE_MEDIA_* for the app. Hand them to JS as an 'smc:mediakey' event
    // (src/lib/mediaKeys.ts), which the players listen for.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playpause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "ff"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "rw"
            KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "prev"
            else -> null
        }
        val webView = bridge?.webView
        if (name == null || webView == null) return super.dispatchKeyEvent(event)
        // Act on the way down. Held Fast-forward / Rewind repeat like arrows
        // do; a held Play/Pause must not toggle back and forth.
        val toggles = name == "playpause" || name == "play" || name == "pause"
        if (event.action == KeyEvent.ACTION_DOWN && !(toggles && event.repeatCount > 0)) {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('smc:mediakey',{detail:'$name'}))",
                null,
            )
        }
        return true
    }
}