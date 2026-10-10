package com.snowmedia

import android.app.UiModeManager
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import com.snowmedia.appmanager.AppManagerPlugin
import com.snowmedia.billing.SmcBillingPlugin
import com.snowmedia.capture.SnowCapturePlugin
import com.snowmedia.dvr.RecorderPlugin
import com.snowmedia.notify.SnowNotifyPlugin
import com.snowmedia.player.SnowPlayerPlugin
import com.snowmedia.security.TamperGuard

class MainActivity : BridgeActivity() {
    /** This copy failed TamperGuard: the app is not loaded. */
    private var blocked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // One line per real start of the activity, no data: a display mode
        // switch (frame-rate matching) must never produce one.
        Log.i("SMC-Activity", "SMC-Activity created")
        // Register custom plugins before BridgeActivity initializes the Capacitor bridge.
        registerPlugin(AppManagerPlugin::class.java)
        registerPlugin(SnowPlayerPlugin::class.java)
        registerPlugin(SnowNotifyPlugin::class.java)
        registerPlugin(SnowCapturePlugin::class.java)
        registerPlugin(SmcBillingPlugin::class.java)
        registerPlugin(RecorderPlugin::class.java)
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
        fitTvLayoutOnTouchScreen()
        // Back never closes Snow Media Center on Android's say-so. The page
        // decides every Back (Capacitor's App plugin hands it the press), and
        // the app leaves only through Home's own "press Back again to exit"
        // (useNavigation), which calls App.exitApp. Capacitor's callback is
        // tied to the activity's started state and is re-added on each start;
        // in any moment it is not there, Android's default for Back was to
        // finish this activity: SMC gone, the app behind it on screen, a
        // recording carrying on with nobody watching. This one sits under
        // Capacitor's (added first, so asked last) and only keeps the app.
        onBackPressedDispatcher.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                Log.i("SMC-Back", "Back with no page handler: SMC stays open")
            }
        })
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
            // CH+ / CH- on remotes that have them: change channel in Live TV.
            KeyEvent.KEYCODE_CHANNEL_UP -> "chup"
            KeyEvent.KEYCODE_CHANNEL_DOWN -> "chdown"
            // The remote's Search / voice key opens voice commands
            // (VoiceCommandHost). Boxes whose Assistant key is kept by the
            // system never send it; the home screen's mic button covers them.
            // While a text field is being typed in, the key is the system's:
            // the keyboard's own dictation (speak instead of typing) needs it,
            // and SMC taking it there is what made that disappear.
            KeyEvent.KEYCODE_SEARCH -> if (typingInField()) null else "search"
            else -> null
        }
        val webView = if (blocked) null else bridge?.webView
        if (name == null || webView == null) return super.dispatchKeyEvent(event)
        // Act on the way down. Held Fast-forward / Rewind repeat like arrows
        // do (the player adds the steps up); a held Play/Pause must not
        // toggle back and forth, and a held CH+/CH- must not race through
        // the line-up.
        val toggles = name == "playpause" || name == "play" || name == "pause" || name == "search" ||
            name == "chup" || name == "chdown"
        if (event.action == KeyEvent.ACTION_DOWN && !(toggles && event.repeatCount > 0)) {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('smc:mediakey',{detail:'$name'}))",
                null,
            )
        }
        return true
    }

    /** A text field has the keyboard's input connection (the viewer is typing). */
    private fun typingInField(): Boolean = try {
        (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)?.isAcceptingText == true
    } catch (_: Throwable) { false }

    /** A TV: Android TV / Google TV / Fire TV, or no touch screen at all. */
    private fun isTvDevice(): Boolean {
        val ui = getSystemService(UI_MODE_SERVICE) as? UiModeManager
        if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = packageManager
        if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
        if (pm.hasSystemFeature("amazon.hardware.fire_tv")) return true
        return !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
    }

    // Phones and tablets. Sideways: SMC's TV layout, scaled to fit and full
    // screen like a TV (no status or navigation bar; a swipe shows them for a
    // moment), the page drawn so the screen is TV_HEIGHT_CSS points tall, the
    // height every screen is designed for. Only when the screen is shorter
    // than that (phones): a tablet that already has the room keeps its own
    // size. Upright (a phone, or a tablet narrower than UPRIGHT_MAX_DP): the
    // page's own upright phone layout at its natural size (src/lib/phoneMode.ts,
    // html.is-upright), with the status and navigation bars. The screen turns
    // with the phone (the viewer's auto-rotate setting decides); turning it
    // never restarts the activity (configChanges in the manifest), it only
    // comes back through onConfigurationChanged. A wider tablet stays
    // sideways, as before. A TV is never touched.
    private var fitsTouchScreen = false
    /** The orientation and screen size last fitted: only a real turn re-fits
     *  (a uiMode / keyboard / density change, an HDMI or remote reconnect,
     *  must not touch the insets or the scale). */
    private var fittedOrientation = Configuration.ORIENTATION_UNDEFINED
    private var fittedScreen = 0

    private fun fitTvLayoutOnTouchScreen() {
        if (isTvDevice()) return
        fitsTouchScreen = true
        // Upright only on a screen that can be turned in the hand (it has an
        // accelerometer) and is narrow enough for the phone layout. A box that
        // declares a touch screen but no leanback (a 1080p xhdpi box is 540 dp)
        // stays sideways, as before.
        val canTurn = packageManager.hasSystemFeature(PackageManager.FEATURE_SENSOR_ACCELEROMETER)
        requestedOrientation = if (canTurn && resources.configuration.smallestScreenWidthDp < UPRIGHT_MAX_DP) {
            ActivityInfo.SCREEN_ORIENTATION_USER
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        fitOrientation(resources.configuration.orientation)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (!fitsTouchScreen || blocked) return
        val screen = newConfig.screenWidthDp * 10000 + newConfig.screenHeightDp
        if (newConfig.orientation == fittedOrientation && screen == fittedScreen) return
        fitOrientation(newConfig.orientation)
    }

    /** The real screen's shorter side, bars included (they are hidden sideways). */
    private fun screenShortPx(): Int {
        val dm = resources.displayMetrics
        val real = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(real)
        return minOf(real.widthPixels, real.heightPixels).coerceAtLeast(minOf(dm.widthPixels, dm.heightPixels))
    }

    private fun fitOrientation(orientation: Int) {
        fittedOrientation = orientation
        fittedScreen = resources.configuration.screenWidthDp * 10000 + resources.configuration.screenHeightDp
        val upright = orientation == Configuration.ORIENTATION_PORTRAIT
        WindowCompat.setDecorFitsSystemWindows(window, upright)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            if (upright) {
                show(WindowInsetsCompat.Type.systemBars())
            } else {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
        val shortPx = screenShortPx()
        // 0: the WebView's own scale (the page's 1:1).
        val percent = if (upright || shortPx / resources.displayMetrics.density >= TV_HEIGHT_CSS) 0
            else (shortPx * 100 / TV_HEIGHT_CSS).toInt()
        Log.i("SMC-Phone", "Touch screen: ${if (upright) "upright, phone layout" else "sideways, TV layout"} at ${if (percent == 0) "its own size" else "$percent%"} (short side ${shortPx}px)")
        bridge?.webView?.setInitialScale(percent)
    }

    private companion object {
        /** The height every SMC screen is designed for (CSS px), as on a TV. */
        const val TV_HEIGHT_CSS = 540f
        /** Narrower than this (dp), a touch screen may be held upright: phones,
         *  and tablets up to a Fire HD 10 (phoneMode.ts UPRIGHT_TABLET_MAX_WIDTH). */
        const val UPRIGHT_MAX_DP = 820f
    }

}