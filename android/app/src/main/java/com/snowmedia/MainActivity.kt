package com.snowmedia

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.widget.TextView
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import com.snowmedia.appmanager.AppManagerPlugin
import com.snowmedia.billing.SmcBillingPlugin
import com.snowmedia.capture.SnowCapturePlugin
import com.snowmedia.notify.SnowNotifyPlugin
import com.snowmedia.player.SnowPlayerPlugin
import com.snowmedia.security.TamperGuard

class MainActivity : BridgeActivity() {
    /** This copy failed TamperGuard: the app is not loaded. */
    private var blocked = false

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
        // A changed or re-signed copy of the app does not run. The page was
        // only asked for a moment ago on this same thread, so none of its
        // code has run yet: stop it and show why instead.
        TamperGuard.problem(this)?.let { why ->
            Log.w("SMC-Integrity", "This copy failed its integrity check ($why)")
            blocked = true
            bridge?.webView?.let { wv ->
                wv.stopLoading()
                wv.loadUrl("about:blank")
            }
            setContentView(TextView(this).apply {
                text = "This copy of Snow Media Center has been changed and cannot run.\n\n" +
                    "Please install the official app from snowmediaapps.com."
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.BLACK)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                gravity = Gravity.CENTER
                val pad = (48 * resources.displayMetrics.density).toInt()
                setPadding(pad, pad, pad, pad)
            })
            return
        }
        // The page goes see-through wherever a video plays behind it (the
        // Live TV preview, full screen). Under a see-through page the WebView
        // paints its own white until the first player is made
        // (SnowPlayerPlugin.ensureSurface): a white flash the first time Live
        // TV opened. Clear from the start, over the black window, as it is
        // anyway once a player has been used.
        bridge?.webView?.setBackgroundColor(Color.TRANSPARENT)
        window.decorView.setBackgroundColor(Color.BLACK)
    }

    // The remote's media buttons never reach the page: Android's WebView keeps
    // KEYCODE_MEDIA_* (and Search) for the app. Hand them to JS as an 'smc:mediakey' event
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
            // The remote's Search / voice key opens voice commands
            // (VoiceCommandHost). Boxes whose Assistant key is kept by the
            // system never send it; the home screen's mic button covers them.
            KeyEvent.KEYCODE_SEARCH -> "search"
            else -> null
        }
        val webView = if (blocked) null else bridge?.webView
        if (name == null || webView == null) return super.dispatchKeyEvent(event)
        // Act on the way down. Held Fast-forward / Rewind repeat like arrows
        // do; a held Play/Pause must not toggle back and forth.
        val toggles = name == "playpause" || name == "play" || name == "pause" || name == "search"
        if (event.action == KeyEvent.ACTION_DOWN && !(toggles && event.repeatCount > 0)) {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('smc:mediakey',{detail:'$name'}))",
                null,
            )
        }
        return true
    }
}