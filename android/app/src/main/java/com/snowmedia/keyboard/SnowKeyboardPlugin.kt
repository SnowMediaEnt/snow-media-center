package com.snowmedia.keyboard

import android.content.Context
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Last-resort keyboard request for Android TV devices that ignore the normal one.
 *
 * Deliberately NOT SHOW_FORCED, and deliberately no requestFocus(). The WebView
 * already holds the input connection Chromium built for the focused HTML field,
 * and both of those throw it away: Android then raises a keyboard for the
 * WebView in general rather than for the field, which on a Fire TV is a plain
 * generic keyboard instead of the usual one. restartInput() has the IME re-read
 * the focused field (text vs password) first, so what appears is the keyboard
 * the viewer expects.
 */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {
    @PluginMethod
    fun show(call: PluginCall) {
        activity.runOnUiThread {
            val target = bridge.webView
            val input = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            input.restartInput(target)
            input.showSoftInput(target, 0)
            call.resolve()
        }
    }
}
