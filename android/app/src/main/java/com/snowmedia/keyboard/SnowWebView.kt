package com.snowmedia.keyboard

import android.content.Context
import android.text.InputType
import android.util.AttributeSet
import android.util.Log
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import com.getcapacitor.CapacitorWebView

/**
 * The app's WebView: Capacitor's own, plus one thing for the Fire TV
 * keyboard's voice dictation (hold the remote's mic while the keyboard is
 * open and speak). Amazon's keyboard offers it only on fields it reads as
 * plain text; a WebView field arrives as "web text" (and a textarea as
 * multi-line), which may be why SMC lost it. Fire TV apps where dictation
 * works (SmartTube's search box) describe their field as plain text with a
 * Search action and no extract UI, so with the remote switch on
 * (feature flag keyboard_voice_attrs, mirrored by the page into
 * Preferences as smc-kb-voice-attrs = "1"), plain text fields are described
 * the same way. Password, email, URL, number and phone fields are never
 * touched. Off (the default): nothing changes.
 *
 * Either way one line per field reaches logcat with the numbers the keyboard
 * was given (tag SMC-IME, no text, no field names), so a test on the Fire TV
 * shows whether this is on the keyboard's path at all.
 */
class SnowWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs)
        val before = outAttrs.inputType
        val on = voiceAttrsOn()
        if (on && isPlainText(before)) {
            outAttrs.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_AUTO_COMPLETE
            outAttrs.imeOptions = (outAttrs.imeOptions and EditorInfo.IME_MASK_ACTION.inv()) or
                EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        }
        try {
            Log.i(
                "SMC-IME",
                "field inputType=0x${Integer.toHexString(before)} -> 0x${Integer.toHexString(outAttrs.inputType)} " +
                    "imeOptions=0x${Integer.toHexString(outAttrs.imeOptions)} voiceAttrs=${if (on) "on" else "off"}",
            )
        } catch (_: Throwable) { /* logging only */ }
        return connection
    }

    private fun voiceAttrsOn(): Boolean = try {
        context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            .getString("smc-kb-voice-attrs", null) == "1"
    } catch (_: Throwable) { false }

    /** A text field that is not a password, email, URL, number or phone field. */
    private fun isPlainText(type: Int): Boolean {
        if ((type and InputType.TYPE_MASK_CLASS) != InputType.TYPE_CLASS_TEXT) return false
        return when (type and InputType.TYPE_MASK_VARIATION) {
            InputType.TYPE_TEXT_VARIATION_NORMAL,
            InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT,
            InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE,
            InputType.TYPE_TEXT_VARIATION_LONG_MESSAGE,
            InputType.TYPE_TEXT_VARIATION_FILTER,
            -> true
            else -> false
        }
    }
}
