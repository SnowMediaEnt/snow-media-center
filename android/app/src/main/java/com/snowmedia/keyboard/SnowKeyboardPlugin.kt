package com.snowmedia.keyboard

import android.content.Context
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Strong keyboard fallback for Android TV devices that ignore a normal IME request. */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {
    @PluginMethod
    fun show(call: PluginCall) {
        activity.runOnUiThread {
            val target = activity.currentFocus ?: bridge.webView
            target.isFocusableInTouchMode = true
            target.requestFocus()
            val input = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            input.showSoftInput(target, InputMethodManager.SHOW_FORCED)
            call.resolve()
        }
    }
}