package com.snowmedia.keyboard

import android.content.Context
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Raise and dismiss the system keyboard on Android TV.
 *
 * A TV remote puts the system in NON-TOUCH mode, where Android does not open
 * the IME by itself when a view gains focus. Something has to ask, and on a
 * phone nothing ever needs to — hence this plugin.
 *
 * Deliberately NOT SHOW_FORCED. Android's own documentation for that flag:
 * "the user has forced the input method open ... so it should not be closed
 * until they explicitly do so." It pins the keyboard open — Back stops
 * dismissing it, and on Fire TV the keyboard swallows Back for its own
 * Previous/Next buttons, so there is no way left to close it at all. It is
 * also deprecated in API 33 for exactly this reason.
 *
 * Not needed either, now that the web side fires a genuine focus event before
 * calling this (an already-focused element fires none, which is what used to
 * make the polite request fail). restartInput() then has the IME re-read the
 * focused field so the layout is that field's own — text vs password.
 */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {
    private fun imm(): InputMethodManager =
        activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

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
            input.restartInput(target)
            input.showSoftInput(target, 0)
            call.resolve()
        }
    }

    /**
     * Dismiss it. The web side cannot always do this itself: while the Fire TV
     * keyboard is full-screen it consumes every key, including Back, so the
     * WebView never sees the press that was meant to close it.
     */
    @PluginMethod
    fun hide(call: PluginCall) {
        activity.runOnUiThread {
            imm().hideSoftInputFromWindow(bridge.webView.windowToken, 0)
            call.resolve()
        }
    }
}
