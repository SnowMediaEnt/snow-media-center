package com.snowmedia.dvr

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/**
 * The one place native code reads the Player login (for scheduled
 * recordings: a schedule stores no address, user name or password, so at fire
 * time the address is rebuilt from what the Player saved).
 *
 * The web side keeps the login with Capacitor Preferences, which on Android
 * is the SharedPreferences file [CAP_STORE]; the key names below are the ones
 * in src/lib/xtream.ts (dvrNative.test checks they still match). The address
 * built here goes straight to RecordingService in this process. It is never
 * stored, logged, or put in a PendingIntent, and nothing here prints a
 * password. If the login is ever moved to encrypted storage, only [read]
 * changes.
 */
internal object LineCreds {
    const val CAP_STORE = "CapacitorStorage"
    /** xtream.ts CREDS_KEY: { host, username, password, output, serverLabel }. */
    const val KEY_CREDS = "snow-livetv-creds-v1"
    /** xtream.ts PLAYER_ACCOUNT_KEY: the same three fields (and more); the fallback, like loadCreds(). */
    const val KEY_ACCOUNT = "snow-player-account-v1"

    /** A saved login. Deliberately no toString: it must never reach a log line. */
    class Login(val host: String, val username: String, val password: String)

    sealed class Resolved {
        /** [url] is the stream address: hand it to the service and forget it. */
        class Ok(val url: String) : Resolved()
        object NoLogin : Resolved()
        object OtherLine : Resolved()
    }

    private val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    private const val HEX = "0123456789ABCDEF"

    /**
     * JavaScript's encodeURIComponent, byte for byte: the letters, digits and
     * - _ . ! ~ * ' ( ) stay, everything else is UTF-8 percent-encoded in
     * capitals. (Java's URLEncoder is not the same: it turns a space into +
     * and escapes ! ~ * ' ( ).) The web side builds the address this way, and
     * a password with such a character must give the same one.
     */
    fun encodeUriComponent(s: String): String {
        val sb = StringBuilder(s.length + 8)
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF)
            if (c < 0x80 && UNRESERVED.indexOf(c.toChar()) >= 0) {
                sb.append(c.toChar())
            } else {
                sb.append('%').append(HEX[c shr 4]).append(HEX[c and 0x0F])
            }
        }
        return sb.toString()
    }

    /** {host}/live/{user}/{pass}/{streamId}.ts: buildNativeLiveUrl in xtream.ts (the native player always takes .ts). */
    fun buildLiveTsUrl(host: String, username: String, password: String, streamId: Long): String =
        "${host.trimEnd('/')}/live/${encodeUriComponent(username)}/${encodeUriComponent(password)}/$streamId.ts"

    /** First 16 hex characters of SHA-256("host|username"): tells a switched account apart without keeping the user name. */
    fun userTag(host: String, username: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest("${host.trimEnd('/')}|$username".toByteArray(Charsets.UTF_8))
        val sb = StringBuilder()
        for (i in 0 until 8) {
            val v = d[i].toInt() and 0xFF
            sb.append(HEX[v shr 4]).append(HEX[v and 0x0F])
        }
        return sb.toString().lowercase()
    }

    /** The saved login: the creds key first, then the account key (as loadCreds does); null when signed out. */
    fun read(ctx: Context): Login? {
        val prefs = try { ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE) } catch (_: Throwable) { return null }
        return parse(prefs.getString(KEY_CREDS, null)) ?: parse(prefs.getString(KEY_ACCOUNT, null))
    }

    internal fun parse(json: String?): Login? {
        if (json.isNullOrBlank()) return null
        return try {
            val o = JSONObject(json)
            val host = o.optString("host").trim()
            val user = o.optString("username").trim()
            val pass = o.optString("password").trim()
            if (host.isEmpty() || user.isEmpty() || pass.isEmpty()) null else Login(host, user, pass)
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * The address for [streamId] on the line a schedule was made on: the
     * saved login must be for the same host and the same account.
     */
    fun resolve(ctx: Context, host: String, userTag: String, streamId: Long): Resolved {
        val l = read(ctx) ?: return Resolved.NoLogin
        if (l.host.trimEnd('/') != host.trimEnd('/') || userTag(l.host, l.username) != userTag) return Resolved.OtherLine
        return Resolved.Ok(buildLiveTsUrl(l.host, l.username, l.password, streamId))
    }
}
