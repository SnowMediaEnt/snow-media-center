package com.snowmedia.keyboard

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.util.Log
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
            (
                outAttrs.imeOptions
                    or EditorInfo.IME_FLAG_NO_FULLSCREEN
                    or EditorInfo.IME_FLAG_NO_EXTRACT_UI
                ) and (
                // Take the PREVIOUS / NEXT buttons away. Nothing to navigate
                // means nothing for Back to be absorbed by.
                EditorInfo.IME_FLAG_NAVIGATE_NEXT or EditorInfo.IME_FLAG_NAVIGATE_PREVIOUS
                ).inv()
                // And no action either. Chromium sets IME_ACTION_NEXT on any
                // field with a sibling in the form; when the keyboard fires
                // that action as it dismisses, Chromium does NOT hand the page
                // an Enter — it calls advanceFocusForIME, moves focus to the
                // next field natively and raises the keyboard there itself.
                // Nothing in JavaScript ever sees it. That is "press Back and
                // it jumps to Password with the keyboard open". With no action
                // the IME has nothing to fire; an Enter it sends anyway reaches
                // the page as a plain keydown, which useTVFocus handles.
                // Moving between fields is the D-pad's job.
                and EditorInfo.IME_MASK_ACTION.inv()
            ) or EditorInfo.IME_ACTION_NONE
        // A multiline box keeps its Enter: the IME's key inserts a newline
        // there, and only there.
        val multiline = (outAttrs.inputType and EditorInfo.TYPE_TEXT_FLAG_MULTI_LINE) != 0
        return connection?.let { BackAwareInputConnection(it, this, multiline) }
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
        private val multiline: Boolean,
    ) : InputConnectionWrapper(target, false) {
        private val main = Handler(Looper.getMainLooper())
        private var lastBackAt = 0L
        private var pendingAction: Runnable? = null

        /**
         * THE KEYBOARD'S ACTION KEY IS OURS TO INTERPRET.
         *
         * Whatever the IME calls it — Next, Done, its Enter, the remote's Play
         * mapped onto it — the viewer pressed the key that means "done with
         * this box". It arrives here two ways, and both are taken: as an
         * editor action, or as an Enter key event. Neither is passed on to
         * Chromium, which would either move focus natively without telling
         * the page (NEXT) or hand the page a bare Enter it cannot tell apart
         * from the remote's OK (everything else). Instead the page is told
         * "next" through SnowKeyboardState and moves to the next field itself,
         * keyboard and highlight together.
         *
         * The one trap: Amazon's keyboard fires its action AS IT DISMISSES on
         * Back, and Back itself comes through sendKeyEvent right beside it,
         * in either order. So an action is held for a moment and dropped if a
         * Back is seen just before or just after it. That is what makes this
         * safe where the 2026-09-09 version was not: Back closes, Next moves,
         * and neither can be mistaken for the other.
         */
        override fun performEditorAction(actionCode: Int): Boolean {
            if (multiline) return super.performEditorAction(actionCode)
            Log.d(TAG, "performEditorAction($actionCode) -> action")
            queueAction()
            return true
        }

        /**
         * The third spelling of the same key. Some IMEs hand a single-line
         * field a newline through commitText instead of an action or a key
         * event. A lone "\n" (or a commit that ends in one) on a single-line
         * field is that key; the newline itself has nowhere to go.
         */
        override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
            if (!multiline && text != null && text.isNotEmpty() && text.endsWith("\n")) {
                val head = text.subSequence(0, text.length - 1)
                if (head.isNotEmpty()) super.commitText(head, newCursorPosition)
                Log.d(TAG, "commitText newline on single-line field -> action")
                queueAction()
                return true
            }
            return super.commitText(text, newCursorPosition)
        }

        override fun sendKeyEvent(event: KeyEvent): Boolean {
            when (event.keyCode) {
                KeyEvent.KEYCODE_BACK -> {
                    lastBackAt = System.currentTimeMillis()
                    cancelAction()
                    if (event.action == KeyEvent.ACTION_UP) view.dismissKeyboard()
                    // Swallow it. Passed on, Chromium turns it into a page-level
                    // key and the app's Back handlers navigate while the
                    // keyboard stays.
                    return true
                }
                KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    if (multiline) return super.sendKeyEvent(event)
                    if (event.action == KeyEvent.ACTION_DOWN) {
                        Log.d(TAG, "IME enter key event -> action")
                        queueAction()
                    }
                    return true
                }
            }
            return super.sendKeyEvent(event)
        }

        private fun queueAction() {
            val now = System.currentTimeMillis()
            if (now - lastBackAt < BACK_GUARD_MS) return
            cancelAction()
            val r = Runnable {
                pendingAction = null
                if (System.currentTimeMillis() - lastBackAt < BACK_GUARD_MS) return@Runnable
                SnowKeyboardState.emitAction("next")
            }
            pendingAction = r
            main.postDelayed(r, ACTION_SETTLE_MS)
        }

        private fun cancelAction() {
            pendingAction?.let { main.removeCallbacks(it) }
            pendingAction = null
        }

        private companion object {
            const val TAG = "SnowKeyboard"
            /** An action this close to a Back is the dismissal's own, not a press. */
            const val BACK_GUARD_MS = 600L
            /** How long an action waits for a Back that may still be on its way. */
            const val ACTION_SETTLE_MS = 200L
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
