package com.snowmedia.keyboard

/**
 * Whether the system keyboard is on screen, as reported by Android itself.
 *
 * There is no "is the IME showing" getter that is trustworthy across the Fire
 * OS versions we ship to, so this is fed from the ResultReceiver that
 * InputMethodManager hands back for every show and hide request — the same
 * answer the framework acted on, not a guess.
 *
 * It is a singleton rather than plugin state because MainActivity needs to read
 * it from dispatchKeyEvent, before any bridge lookup would be worth doing on a
 * key press.
 */
object SnowKeyboardState {
    @Volatile
    private var shown = false

    /** Notified on every genuine change so the web layer can stay in step. */
    @Volatile
    var onChange: ((Boolean) -> Unit)? = null

    val isVisible: Boolean get() = shown

    fun set(visible: Boolean) {
        if (shown == visible) return
        shown = visible
        onChange?.invoke(visible)
    }
}
