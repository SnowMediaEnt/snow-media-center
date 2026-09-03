package com.snowmedia.capture

import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream

/**
 * Captures what is on screen so a customer can attach it to a support ticket.
 *
 * WHY PixelCopy AND NOT View.draw(canvas): the WebView is hardware accelerated,
 * and drawing an accelerated view into a software Bitmap gives you a blank or
 * half-rendered frame. PixelCopy reads the window's actual rendered surface,
 * which is the only reliable way to get what the customer is really looking at.
 * It needs API 24 and the app's minSdk is 24, so there is no fallback path to
 * maintain.
 *
 * WHAT IT CANNOT CAPTURE: video. The player renders onto its own surface
 * underneath this window, so a capture taken during playback has a black
 * rectangle where the picture is. Menus, error screens, the Plex grid, Settings
 * — everything that is actually worth screenshotting for support — come out
 * fine. No capture API on Android will give you the video frame.
 */
@CapacitorPlugin(name = "SnowCapture")
class SnowCapturePlugin : Plugin() {

    /**
     * Returns a JPEG of the current screen as base64.
     *
     * JPEG, not PNG: a 4K screen is a ~6 MB PNG and a ~400 KB JPEG at quality
     * 80, and this is going over a customer's connection into a 10 MB bucket.
     * Screenshots of UI survive JPEG fine at that quality.
     */
    @PluginMethod
    fun captureScreen(call: PluginCall) {
        val activity = activity
        if (activity == null) {
            call.reject("No activity")
            return
        }
        val quality = (call.getInt("quality") ?: 80).coerceIn(30, 100)
        val maxWidth = (call.getInt("maxWidth") ?: 1920).coerceIn(320, 4096)

        activity.runOnUiThread {
            val window = activity.window
            val view = window.peekDecorView()
            if (view == null || view.width <= 0 || view.height <= 0) {
                call.reject("Nothing on screen to capture")
                return@runOnUiThread
            }
            val bitmap = try {
                Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            } catch (e: OutOfMemoryError) {
                call.reject("Not enough memory to capture the screen")
                return@runOnUiThread
            }
            try {
                PixelCopy.request(window, bitmap, { result ->
                    if (result != PixelCopy.SUCCESS) {
                        bitmap.recycle()
                        call.reject("Screen capture failed (code $result)")
                        return@request
                    }
                    // Encoding off the UI thread: a 4K frame takes long enough
                    // to drop frames if it runs here.
                    Thread {
                        try {
                            val scaled = downscale(bitmap, maxWidth)
                            val out = ByteArrayOutputStream()
                            scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                            if (scaled !== bitmap) scaled.recycle()
                            bitmap.recycle()
                            val bytes = out.toByteArray()
                            call.resolve(
                                JSObject()
                                    .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                                    .put("mime", "image/jpeg")
                                    .put("bytes", bytes.size),
                            )
                        } catch (e: Exception) {
                            call.reject("Could not encode the screenshot: ${e.message}")
                        }
                    }.start()
                }, Handler(Looper.getMainLooper()))
            } catch (e: IllegalArgumentException) {
                // Thrown when the window has no surface yet (mid-transition).
                bitmap.recycle()
                call.reject("The screen is not ready to capture yet")
            }
        }
    }

    /** True where captureScreen can work at all, so the UI can hide the button. */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(
            JSObject().put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity != null),
        )
    }

    private fun downscale(src: Bitmap, maxWidth: Int): Bitmap {
        if (src.width <= maxWidth) return src
        val h = (src.height.toLong() * maxWidth / src.width).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(src, maxWidth, h, true)
    }
}
