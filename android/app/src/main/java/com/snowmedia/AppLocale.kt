package com.snowmedia

import android.content.Context
import android.content.res.Configuration
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The language of the app's own native text (notifications, the news widget,
 * player and billing error messages, the speech prompt).
 *
 * It is the language the viewer picked in SMC (Settings), NOT the box's system
 * language: the web side saves it through SnowNotify.setLanguage. It is kept
 * here, in SharedPreferences, because the notifications and the alert poller
 * run while the WebView is dead (a scheduled recording after a reboot, the
 * five-minute alert poll), so the text cannot be passed down from the app.
 *
 * Until the app has said anything the language is English, the app's default.
 * Text comes from res/values/strings.xml (English) and values-es, -fr, -de, -ar.
 * Always read a string through [string] / [plural] with the Context at hand,
 * never through Context.getString directly, or the box's language leaks in.
 */
object AppLocale {
    const val DEFAULT = "en"
    val SUPPORTED: List<String> = listOf("en", "es", "fr", "de", "ar")

    private const val PREFS = "smc_locale"
    private const val KEY_LANG = "lang"

    /** For code with no Context of its own (BillingError). Set by every call that is given one. */
    @Volatile private var appContext: Context? = null

    fun attach(ctx: Context) {
        if (appContext == null) appContext = ctx.applicationContext ?: ctx
    }

    /** The saved language: one of [SUPPORTED], English when nothing valid is saved. */
    fun language(ctx: Context): String {
        attach(ctx)
        val saved = try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LANG, null)
        } catch (_: Throwable) {
            null
        }
        return if (saved != null && saved in SUPPORTED) saved else DEFAULT
    }

    /** Saves the language. False when [lang] is not one of the five (nothing is changed). */
    fun setLanguage(ctx: Context, lang: String): Boolean {
        attach(ctx)
        if (lang !in SUPPORTED) return false
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LANG, lang).apply()
        return true
    }

    /**
     * Arabic keeps the digits 0-9 (owner decision): "-u-nu-latn" asks for Latin
     * digits, so a number formatted into an Arabic string does not turn into
     * Arabic-Indic ones.
     */
    fun locale(ctx: Context): Locale = when (val lang = language(ctx)) {
        "ar" -> Locale.forLanguageTag("ar-u-nu-latn")
        else -> Locale.forLanguageTag(lang)
    }

    /** [ctx] with the app's language instead of the box's, for resources. */
    fun wrap(ctx: Context): Context {
        val config = Configuration(ctx.resources.configuration)
        config.setLocale(locale(ctx))
        return ctx.createConfigurationContext(config)
    }

    fun string(ctx: Context, @StringRes id: Int, vararg args: Any): String =
        wrap(ctx).getString(id, *args)

    /** A count-dependent string; Arabic uses all six plural forms. The count is the first argument unless [args] say otherwise. */
    fun plural(ctx: Context, @PluralsRes id: Int, count: Int, vararg args: Any): String =
        wrap(ctx).resources.getQuantityString(id, count, *(if (args.isEmpty()) arrayOf<Any>(count) else args))

    /** [string] for code that has no Context: null before the app has given any to [attach]. */
    fun stringOrNull(@StringRes id: Int, vararg args: Any): String? =
        appContext?.let { string(it, id, *args) }

    /** A clock time in the app's language, always 12-hour (owner decision): "2:30 PM". */
    fun clock(ctx: Context, ms: Long): String =
        SimpleDateFormat("h:mm a", locale(ctx)).format(Date(ms))

    /** The language tag for the speech recogniser (RecognizerIntent.EXTRA_LANGUAGE). */
    fun speechTag(ctx: Context): String = when (language(ctx)) {
        "es" -> "es-US"
        "fr" -> "fr-FR"
        "de" -> "de-DE"
        "ar" -> "ar-SA"
        else -> "en-US"
    }
}
