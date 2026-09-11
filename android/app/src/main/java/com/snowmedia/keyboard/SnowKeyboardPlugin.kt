package com.snowmedia.keyboard

import android.content.Context
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Raise the on-screen keyboard on Android TV.
 *
 * A TV remote puts the system in NON-TOUCH mode, and in non-touch mode Android
 * does not open the IME by itself when a view gains focus, and routinely
 * ignores a polite showSoftInput request. That is the whole reason this plugin
 * exists: on a phone the keyboard is already up, on a TV nothing asks for it.
 *
 * Three things have to be true at once, and earlier versions each got one of
 * them wrong:
 *
 *  - The WebView must be FOCUSED or InputMethodManager refuses outright. But it
 *    must not be re-focused when it already is: that tears down the input
 *    connection Chromium just built for the focused HTML field, and Android
 *    then serves a keyboard for the WebView in general — the "wrong keyboard".
 *  - The IME must be told to re-read the field, so it opens as text or as
 *    password rather than generically.
 *  - The request must be allowed to force, because on a TV the polite one is
 *    often refused and returns false with no keyboard and no error.
 */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {
    @PluginMethod
    fun show(call: PluginCall) {
        activity.runOnUiThread {
            val target = bridge.webView
            // Only when it is not already focused — see above.
            if (!target.isFocused) {
                target.isFocusableInTouchMode = true
                target.requestFocus()
            }
            val input = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            // Have the IME re-read the focused field before it decides a layout.
            input.restartInput(target)
            // Ask politely first: that is the request that yields the field's
            // own keyboard. Force only when the polite one is refused, which is
            // the normal answer on a TV in non-touch mode.
            val shown = input.showSoftInput(target, 0)
            if (!shown) {
                @Suppress("DEPRECATION")
                input.showSoftInput(target, InputMethodManager.SHOW_FORCED)
            }
            call.resolve()
        }
    }
}
