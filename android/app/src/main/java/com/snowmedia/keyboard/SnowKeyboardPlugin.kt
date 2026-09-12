package com.snowmedia.keyboard

import android.content.Context
import android.graphics.Rect
import android.view.View
import android.view.ViewTreeObserver
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Raise and dismiss the system keyboard on Android TV, and — the part the app
 * could not do at all before — actually KNOW whether one is on screen.
 *
 * WHY THIS DETECTS THE KEYBOARD ITSELF
 * ------------------------------------
 * @capacitor/keyboard is the ordinary source of keyboardDidShow/DidHide, and on
 * a phone it is fine. It detects the keyboard exclusively through
 * ViewCompat.setWindowInsetsAnimationCallback and
 * WindowInsetsCompat.Type.ime() — both of which are Android 11 (API 30)
 * features. This app ships to minSdk 24, and most Fire TV sticks in the field
 * are Fire OS 7, which is Android 9. On those devices those callbacks never
 * fire, so keyboardDidShow NEVER arrives, and every piece of app logic that
 * asked "is the keyboard up?" was answered "no" while the viewer was staring
 * at one.
 *
 * The concrete failure: useTVFocus only dismisses on Back when it believes a
 * keyboard is open, so Back navigated away and left the keyboard sitting on
 * screen over the next screen, on every text field in the app.
 *
 * So this uses the detection that works on every version: watch the window's
 * visible frame against the (non-resizing) decor view. If something is covering
 * more than a quarter of the window, that something is the keyboard. It is also
 * strictly better than tracking our own show/hide calls, because it sees the
 * dismissals we did not cause — Back handled inside Android, the viewer
 * switching IME, the system taking it away.
 *
 * Deliberately NOT SHOW_FORCED. Android's own documentation for that flag:
 * "the user has forced the input method open ... so it should not be closed
 * until they explicitly do so." It pins the keyboard open, and it is deprecated
 * in API 33 for that reason. Not needed either, now that the web side fires a
 * genuine focus event before calling show() — an already-focused element fires
 * none, which is what used to make the polite request fail.
 */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {

    /** Anything covering more than this much of the window is the keyboard. */
    private val coverageThreshold = 0.25

    private var decorRoot: View? = null
    private var layoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null

    private val notifier: (Boolean) -> Unit = { visible ->
        notifyListeners("keyboardVisibility", JSObject().put("visible", visible))
    }

    private fun imm(): InputMethodManager =
        activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

    override fun load() {
        SnowKeyboardState.onChange = notifier

        val content: View = activity.window.decorView.findViewById(android.R.id.content) ?: return
        // The DECOR view, which does not shrink when the window is resized for
        // the keyboard. Measuring against the content view instead would have
        // both sides shrink together and the difference would stay zero.
        val root = content.rootView ?: return
        decorRoot = root

        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            val frame = Rect()
            root.getWindowVisibleDisplayFrame(frame)
            val total = root.height
            if (total <= 0) return@OnGlobalLayoutListener
            val covered = total - frame.height()
            SnowKeyboardState.set(covered > total * coverageThreshold)
        }
        layoutListener = listener
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
    }

    override fun handleOnDestroy() {
        layoutListener?.let { decorRoot?.viewTreeObserver?.removeOnGlobalLayoutListener(it) }
        layoutListener = null
        decorRoot = null
        // Only if it is still OURS. A renderer crash recreates the Activity, and
        // the incoming instance's load() can land before the outgoing one's
        // teardown — clearing unconditionally would unhook the live plugin.
        if (SnowKeyboardState.onChange === notifier) SnowKeyboardState.onChange = null
    }

    @PluginMethod
    fun show(call: PluginCall) {
        activity.runOnUiThread {
            val target = bridge.webView
            // Only when it is not already focused: re-focusing tears down the
            // input connection Chromium just built for the focused HTML field,
            // and Android then serves a keyboard for the WebView in general.
            if (!target.isFocused) {
                target.isFocusableInTouchMode = true
                target.requestFocus()
            }
            val input = imm()
            // Have the IME re-read the focused field so the layout is that
            // field's own — text vs password vs email.
            input.restartInput(target)
            input.showSoftInput(target, 0)
            call.resolve()
        }
    }

    /**
     * Dismiss it, for the web side leaving a field deliberately: moving the
     * highlight away, submitting a form, leaving a screen.
     *
     * Back does not come through here — SnowWebView.onKeyPreIme catches it
     * before the IME ever sees it, which is the only place that can be done
     * reliably.
     */
    @PluginMethod
    fun hide(call: PluginCall) {
        activity.runOnUiThread {
            imm().hideSoftInputFromWindow(bridge.webView.windowToken, 0)
            call.resolve()
        }
    }
}
