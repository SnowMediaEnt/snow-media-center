package com.snowmedia.keyboard

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.JSObject
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
 * until they explicitly do so." It pins the keyboard open, and it is deprecated
 * in API 33 for exactly that reason. Not needed either, now that the web side
 * fires a genuine focus event before calling this (an already-focused element
 * fires none, which is what used to make the polite request fail).
 * restartInput() then has the IME re-read the focused field so the layout is
 * that field's own — text vs password.
 *
 * Every request carries a ResultReceiver. Whether a keyboard is actually on
 * screen is not something a TV WebView can be asked, and a resolved show() only
 * ever proved the REQUEST was accepted — several Fire TV builds accept it and
 * show nothing. The receiver reports what the framework actually did, which is
 * what feeds SnowKeyboardState and the keyboardVisibility event below.
 */
@CapacitorPlugin(name = "SnowKeyboard")
class SnowKeyboardPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())

    private fun imm(): InputMethodManager =
        activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

    private val notifier: (Boolean) -> Unit = { visible ->
        notifyListeners("keyboardVisibility", JSObject().put("visible", visible))
    }

    override fun load() {
        SnowKeyboardState.onChange = notifier
    }

    override fun handleOnDestroy() {
        // Only if it is still OURS. A renderer crash recreates the Activity, and
        // the incoming instance's load() can land before the outgoing one's
        // teardown — clearing unconditionally would silently unhook the live
        // plugin and the page would stop hearing about the keyboard.
        if (SnowKeyboardState.onChange === notifier) SnowKeyboardState.onChange = null
    }

    /** Translates InputMethodManager's reply into plain visibility. */
    private fun receiver() = object : ResultReceiver(main) {
        override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
            SnowKeyboardState.set(
                resultCode == InputMethodManager.RESULT_SHOWN ||
                    resultCode == InputMethodManager.RESULT_UNCHANGED_SHOWN
            )
        }
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
            input.restartInput(target)
            input.showSoftInput(target, 0, receiver())
            call.resolve()
        }
    }

    /**
     * Dismiss it — for the web side dismissing a field deliberately: moving the
     * highlight away, submitting a form, leaving a screen.
     *
     * Back is not one of those. With SnowWebView asking for a docked IME, Back
     * is handled either by the IME itself or by useTVFocus on the ordinary
     * keyCode 4, and neither needs anything from here.
     */
    @PluginMethod
    fun hide(call: PluginCall) {
        activity.runOnUiThread {
            imm().hideSoftInputFromWindow(bridge.webView.windowToken, 0, receiver())
            call.resolve()
        }
    }

    /** What the framework last told us, for a web layer that has lost track. */
    @PluginMethod
    fun isVisible(call: PluginCall) {
        call.resolve(JSObject().put("visible", SnowKeyboardState.isVisible))
    }
}
