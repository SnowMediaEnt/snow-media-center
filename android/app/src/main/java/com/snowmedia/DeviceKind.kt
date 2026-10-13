package com.snowmedia

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

/**
 * Whether this is a TV box (driven by a remote, on a TV) rather than a phone
 * or a tablet in someone's hands. One answer for the app's native side
 * (MainActivity's touch-screen fit) and its page (the "SMC-TV" mark
 * SnowWebView adds to the user agent: the page's low-memory mode and its TV
 * layout, src/main.tsx and src/lib/phoneMode.ts).
 *
 * The Fire TVs say so. Cheap Android boxes (X96 and the like) often don't:
 * no TV mode, no leanback, and a touch screen in their feature list. What
 * none of them has is an accelerometer: a screen that is never held. Owner,
 * 2026-10-13: those boxes drew the page as phones and with the effects a Fire
 * TV is spared, and parts of the screen went to a solid block over the sound.
 */
object DeviceKind {
    fun isTvBox(ctx: Context): Boolean = try {
        val ui = ctx.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        val pm = ctx.packageManager
        ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            pm.hasSystemFeature("amazon.hardware.fire_tv") ||
            !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN) ||
            !pm.hasSystemFeature(PackageManager.FEATURE_SENSOR_ACCELEROMETER)
    } catch (_: Throwable) { false }

    /** Added to the WebView's user agent on a TV box. */
    const val UA_MARK = "SMC-TV"
}
