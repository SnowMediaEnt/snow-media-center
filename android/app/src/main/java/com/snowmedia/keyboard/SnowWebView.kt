package com.snowmedia.keyboard

import android.content.Context
import android.util.AttributeSet
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import com.getcapacitor.CapacitorWebView

/**
 * The app's WebView. Identical to Capacitor's own in every respect but one:
 * it tells the IME not to go full screen.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * Android decides on its own whether an IME takes over the whole screen. The
 * rule is roughly "landscape and not much height", which is every TV, always.
 * In that mode the IME stops being a keyboard docked at the bottom of our page
 * and becomes a full-screen editor of its own: it draws its own copy of the
 * text field, its own PREVIOUS / NEXT action bar, and — the part that broke
 * us — its window takes the focus.
 *
 * Two symptoms, one cause:
 *
 *  • "Back doesn't close the keyboard, it just moves between Previous and
 *    Next." Those buttons belong to the IME's extract UI. While that window
 *    has focus it receives every key first, so Back was being spent walking
 *    its own action bar. It never reached the WebView, so no amount of
 *    JavaScript could have caught it, and it never reached the Activity
 *    either, so no amount of Kotlin could have caught it there.
 *
 *  • "The keyboard is off centre." It was never our layout. The IME was
 *    drawing its own full-screen one over the top of us.
 *
 * THE FIX
 * -------
 * IME_FLAG_NO_FULLSCREEN asks the IME to stay docked, which leaves the focus —
 * and therefore the keys — with our window. IME_FLAG_NO_EXTRACT_UI removes the
 * Previous / Next bar the viewer was getting stuck in.
 *
 * Docked, Back is covered twice over and needs no native handling of its own:
 *
 *  • A well-behaved IME handles KEYCODE_BACK itself — InputMethodService hides
 *    the window and swallows the key, so one press closes the keyboard without
 *    also navigating the app.
 *  • One that does not handle it lets the key through to the WebView as the
 *    ordinary keyCode 4, where useTVFocus's Back branch already closes the
 *    keyboard first and leaves the screen on the press after. That path has
 *    been there all along; a full-screen IME was simply never letting a key
 *    reach it.
 *
 * Which is why there is deliberately no "if the keyboard is up, eat Back" check
 * in MainActivity. Native code can only know about the hides it asked for — an
 * IME that closes itself never reports back — so such a flag goes stale true
 * and starts eating the viewer's next Back. It would cost a press in the normal
 * case to guard a case the web layer already has.
 *
 * These flags live on EditorInfo, which is filled in when the IME attaches to
 * the focused field, so the only place to set them is here. Capacitor's WebView
 * does not touch imeOptions, and there is no HTML attribute or Capacitor config
 * that reaches this — hence a subclass, swapped in by the app's own copy of
 * res/layout/capacitor_bridge_layout_main.xml.
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
}
