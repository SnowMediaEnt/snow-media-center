package com.snowmedia.keyboard

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.CapacitorWebView

/**
 * The app's WebView. Identical to Capacitor's own but for two things, both
 * about the on-screen keyboard on a TV.
 *
 * 1. KEEP THE KEYBOARD DOCKED
 * ---------------------------
 * Android decides on its own whether an IME takes over the whole screen. The
 * rule is roughly "landscape and not much height", which is every TV, always.
 * In that mode the IME stops being a keyboard docked at the bottom of our page
 * and becomes a full-screen editor of its own: it draws its own copy of the
 * text field, its own PREVIOUS / NEXT action bar, and its window takes the
 * focus. Holding the focus it receives every key first — which is why Back was
 * being spent walking that action bar, and why the keyboard looked "off
 * centre" (it was the IME's own layout, not ours).
 *
 * IME_FLAG_NO_FULLSCREEN asks it to stay docked so our window keeps the focus.
 * IME_FLAG_NO_EXTRACT_UI removes the Previous / Next bar. These live on
 * EditorInfo, which is filled in when the IME attaches to the focused field, so
 * onCreateInputConnection is the only place they can be set: Capacitor's
 * WebView does not touch imeOptions and no HTML attribute reaches it.
 *
 * 2. BACK CLOSES THE KEYBOARD
 * ---------------------------
 * onKeyPreIme is the one hook that sees a key BEFORE the input method does.
 * That is the whole reason it exists on View, and it is the only place this can
 * be handled correctly, because every other candidate is too late or never
 * fires at all:
 *
 *  • The page cannot. On Fire TV, Back is not delivered to the WebView as a
 *    DOM keydown — the app's own useNavigation and LiveTV both say so — it
 *    arrives as a Capacitor App.backButton event instead.
 *  • App.backButton cannot. It is driven by the Activity's back dispatcher, and
 *    while an IME is showing the IME window gets the key first. If it keeps it,
 *    the Activity never hears the press at all.
 *  • The IME's own handling cannot be relied on. InputMethodService hides
 *    itself on Back by default, but a TV IME that has repurposed Back for its
 *    own navigation simply does not.
 *
 * Consuming it here gives exactly the behaviour a viewer expects, with no
 * coordination anywhere else: the first Back closes the keyboard and goes no
 * further, and because the key never reaches the Activity there is no
 * backButton event for the rest of the app to double-handle. The second Back
 * finds no keyboard, is not consumed, and leaves the screen normally.
 */
class SnowWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        // super first: Chromium (or Capacitor's captured-input path) fills in
        // outAttrs for the focused field. The framework reads outAttrs AFTER
        // this returns, so adding flags now is what reaches the IME.
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions = outAttrs.imeOptions or
            EditorInfo.IME_FLAG_NO_FULLSCREEN or
            EditorInfo.IME_FLAG_NO_EXTRACT_UI
        return connection
    }

    override fun onKeyPreIme(keyCode: Int, event: KeyEvent): Boolean {
        // Only when a keyboard is genuinely on screen — SnowKeyboardState
        // measures the window rather than trusting the requests we made, so it
        // also knows about dismissals we did not cause. Consuming Back on a
        // stale flag would leave the viewer unable to leave the screen, which
        // is a worse bug than the one being fixed.
        if (keyCode == KeyEvent.KEYCODE_BACK && SnowKeyboardState.isVisible) {
            if (event.action == KeyEvent.ACTION_UP) {
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                imm?.hideSoftInputFromWindow(windowToken, 0)
            }
            // Both halves of the press: releasing an unconsumed ACTION_UP on its
            // own would still reach the Activity and navigate.
            return true
        }
        return super.onKeyPreIme(keyCode, event)
    }
}
