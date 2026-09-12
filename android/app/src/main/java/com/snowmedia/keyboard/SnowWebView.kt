package com.snowmedia.keyboard

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
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
 * Measured on the device: Amazon's Fire TV keyboard IGNORES both flags above.
 * It overrides onEvaluateFullscreenMode() and goes full screen regardless, so
 * its window keeps the input focus and NOTHING in this app is on the key path:
 *
 *  • The page never sees Back. On Fire TV it is not delivered to the WebView as
 *    a DOM keydown at all — useNavigation and LiveTV both say so.
 *  • App.backButton never fires. It runs off the Activity's back dispatcher,
 *    and the Activity does not have the focus.
 *  • onKeyPreIme never fires either, for the same reason. It is the documented
 *    answer to this problem and it is useless against an IME that will not
 *    give up the focus.
 *
 * What IS still ours is the InputConnection. The IME is editing OUR text field
 * through it, so it is the one channel that has to be live, and two things
 * happen here because of that:
 *
 *  a. IME_FLAG_NAVIGATE_NEXT / _PREVIOUS are cleared. Chromium sets these
 *     whenever the focused field has siblings in the form, and they are what
 *     put PREVIOUS / NEXT in the full-screen editor — the buttons Back was
 *     being spent on ("it moves the cursor to previous and then back to next").
 *     With nothing to navigate, Back falls through to InputMethodService's own
 *     handling, which is to hide. The action key is untouched: enterkeyhint
 *     still drives IME_ACTION_NEXT, so username -> password still works.
 *
 *  b. sendKeyEvent is intercepted. It is how an IME hands a key it did not use
 *     back to the app, and it arrives through the connection rather than the
 *     window — so it reaches us even while the IME holds the focus. If Back
 *     comes through there, dismiss.
 *
 * Both are in one place, on one channel, deliberately: stacking another
 * half-measure into the page's 56 Back handlers is what made this unfixable.
 */
class SnowWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        // super first: Chromium (or Capacitor's captured-input path) fills in
        // outAttrs for the focused field. The framework reads outAttrs AFTER
        // this returns, so adding flags now is what reaches the IME.
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions = (
            outAttrs.imeOptions
                or EditorInfo.IME_FLAG_NO_FULLSCREEN
                or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            ) and (
            // Take the PREVIOUS / NEXT buttons away. Nothing to navigate means
            // nothing for Back to be absorbed by.
            EditorInfo.IME_FLAG_NAVIGATE_NEXT or EditorInfo.IME_FLAG_NAVIGATE_PREVIOUS
            ).inv()
        return connection?.let { BackAwareInputConnection(it, this) }
    }

    /** Ask the IME to go away, from wherever we managed to catch the key. */
    fun dismissKeyboard() {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(windowToken, 0)
    }

    /**
     * Catches the Back an IME hands back rather than using itself. This arrives
     * over the input connection, not the window, so it is the only route that
     * still works while a full-screen IME owns the focus.
     */
    private class BackAwareInputConnection(
        target: InputConnection,
        private val view: SnowWebView,
    ) : InputConnectionWrapper(target, false) {
        override fun sendKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                if (event.action == KeyEvent.ACTION_UP) view.dismissKeyboard()
                // Swallow it. Passed on, Chromium turns it into a page-level key
                // and the app's Back handlers navigate while the keyboard stays.
                return true
            }
            return super.sendKeyEvent(event)
        }
    }

    /**
     * The documented answer to this problem, kept for the boxes where it works.
     *
     * It does NOT fire on a Fire TV with Amazon's keyboard up, because that IME
     * takes the window focus and pre-IME dispatch never reaches us — which is
     * why (a) and (b) above exist. On an Android TV box whose IME docks
     * properly this is the clean path, so it stays: it costs one comparison and
     * it is the only handler that can close the keyboard without the IME's
     * cooperation at all.
     */
    override fun onKeyPreIme(keyCode: Int, event: KeyEvent): Boolean {
        // Only when a keyboard is genuinely on screen — SnowKeyboardState
        // measures the window rather than trusting the requests we made, so it
        // also knows about dismissals we did not cause. Consuming Back on a
        // stale flag would leave the viewer unable to leave the screen, which
        // is a worse bug than the one being fixed.
        if (keyCode == KeyEvent.KEYCODE_BACK && SnowKeyboardState.isVisible) {
            if (event.action == KeyEvent.ACTION_UP) dismissKeyboard()
            // Both halves of the press: releasing an unconsumed ACTION_UP on its
            // own would still reach the Activity and navigate.
            return true
        }
        return super.onKeyPreIme(keyCode, event)
    }
}
