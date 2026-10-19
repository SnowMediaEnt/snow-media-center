package com.snowmedia.dvr

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The network folder recordings can go to: a shared folder on a computer or
 * NAS at home (SMB). One at most. [host] is a name or an IPv4/IPv6 address,
 * [port] 445 unless typed as host:port (other ports are for testing against a
 * Samba server in a container). [folder] is a path inside the share,
 * "/"-separated, "" for the share itself. [label] is what the Record dialog
 * shows: the computer's name and the share, "DESKTOP-ABC (Recordings)".
 *
 * Deliberately no password here and no toString with one: the password stays
 * encrypted in [NetFolderStore] and is only decrypted for a sign-in.
 */
internal data class NetFolder(
    val host: String,
    val port: Int,
    val share: String,
    val folder: String,
    val domain: String,
    val user: String,
    val label: String,
) {
    /** Identifies the place and the account (not the password): what caches and the "keep the saved password" rule compare. */
    val key: String get() = NetFolderRules.key(host, port, share, folder, domain, user)
}

/** Parsing and checking what the TV screen sends. Pure, so the JVM tests cover it (NetworkFolderTest). */
internal object NetFolderRules {
    const val DEFAULT_PORT = 445
    const val DEFAULT_FOLDER = "Snow Media Recordings"

    /** A parsed host: name or address (IPv6 without brackets) and port. */
    data class HostPort(val host: String, val port: Int)

    private val HOST_NAME = Regex("^[A-Za-z0-9]([A-Za-z0-9_.-]{0,252})$")
    private val IPV6 = Regex("^[0-9A-Fa-f:.]+(%[A-Za-z0-9_.-]+)?$")

    /**
     * "DESKTOP-ABC", "192.168.1.20", "nas.local:4445", "[fe80::1]:445",
     * "\\DESKTOP-ABC" or "smb://nas" (anything after the host, like a share,
     * is ignored). Null when it isn't a usable host.
     */
    fun parseHost(raw: String?): HostPort? {
        var s = raw?.trim().orEmpty()
        if (s.startsWith("smb://", ignoreCase = true)) s = s.substring(6)
        s = s.trimStart('\\', '/')
        val cut = s.indexOfFirst { it == '/' || it == '\\' }
        if (cut >= 0) s = s.substring(0, cut)
        if (s.isEmpty()) return null
        var port = DEFAULT_PORT
        val host: String
        if (s.startsWith("[")) {
            val end = s.indexOf(']')
            if (end < 0) return null
            host = s.substring(1, end)
            val rest = s.substring(end + 1)
            if (rest.isNotEmpty()) {
                if (!rest.startsWith(":")) return null
                port = rest.substring(1).toIntOrNull() ?: return null
            }
            if (!IPV6.matches(host) || !host.contains(':')) return null
        } else if (s.count { it == ':' } > 1) {
            // A bare IPv6 address: no port possible without brackets.
            if (!IPV6.matches(s)) return null
            host = s
        } else {
            val colon = s.indexOf(':')
            host = if (colon >= 0) s.substring(0, colon) else s
            if (colon >= 0) port = s.substring(colon + 1).toIntOrNull() ?: return null
            if (!HOST_NAME.matches(host) || host.contains("..")) return null
        }
        if (port !in 1..65535) return null
        return HostPort(host, port)
    }

    /** Host as the TV screen shows and sends it back: "nas" or "nas:4445" or "[fe80::1]:4445". */
    fun displayHost(host: String, port: Int): String {
        val h = if (host.contains(':')) "[$host]" else host
        return if (port == DEFAULT_PORT) host else "$h:$port"
    }

    private val BAD_SHARE_CHARS = "\"/\\[]:|<>+=;,?*"

    /** A share name: "Recordings", "\\Recordings\\" trimmed; null when empty or holding characters Windows refuses. */
    fun cleanShare(raw: String?): String? {
        val s = raw?.trim()?.trim('\\', '/')?.trim().orEmpty()
        if (s.isEmpty() || s.length > 80) return null
        if (s.any { it < ' ' || BAD_SHARE_CHARS.indexOf(it) >= 0 }) return null
        return s
    }

    private val BAD_NAME_CHARS = "\"<>|?*:"

    /**
     * The folder inside the share, "/"-separated. Null (not sent) gives
     * [DEFAULT_FOLDER]; "" is the share itself. Back- and forward slashes
     * both separate; "." and ".." and Windows-invalid characters are refused
     * (null). Trailing dots and spaces are dropped, as Windows does.
     */
    fun cleanFolder(raw: String?): String? {
        if (raw == null) return DEFAULT_FOLDER
        val parts = ArrayList<String>()
        for (p in raw.split('/', '\\')) {
            val seg = p.trim().trimEnd('.', ' ')
            if (seg.isEmpty()) {
                if (p.trim() == "." || p.trim() == "..") return null
                continue
            }
            if (seg == "." || seg == ".." || seg.length > 200) return null
            if (seg.any { it < ' ' || BAD_NAME_CHARS.indexOf(it) >= 0 }) return null
            parts.add(seg)
        }
        if (parts.size > 16) return null
        return parts.joinToString("/")
    }

    /** "DOMAIN\user" → ("DOMAIN", "user"); "user" or "user@domain" stays whole with no domain. */
    fun splitUser(raw: String?): Pair<String, String> {
        val s = raw?.trim().orEmpty()
        val i = s.indexOf('\\')
        if (i < 0) return "" to s
        return s.substring(0, i).trim() to s.substring(i + 1).trim()
    }

    fun joinUser(domain: String, user: String): String = if (domain.isEmpty()) user else "$domain\\$user"

    fun key(host: String, port: Int, share: String, folder: String, domain: String, user: String): String =
        "${host.lowercase()}:$port/${share.lowercase()}/${folder.lowercase()}|${domain.lowercase()}\\${user.lowercase()}"

    /** The same computer and the same account: a re-test may then reuse the saved password. */
    fun sameLogin(a: NetFolder, host: String, port: Int, domain: String, user: String): Boolean =
        a.host.equals(host, ignoreCase = true) && a.port == port &&
            a.domain.equals(domain, ignoreCase = true) && a.user.equals(user, ignoreCase = true)

    /** The SMB path (inside the share) of [name] in [folder]: backslashes, no leading one. */
    fun smbPath(folder: String, name: String = ""): String {
        val dir = folder.split('/').filter { it.isNotEmpty() }.joinToString("\\")
        return when {
            name.isEmpty() -> dir
            dir.isEmpty() -> name
            else -> "$dir\\$name"
        }
    }

    /** "smb://host/share/folder/" (with a ":port" only when it isn't 445): the root every network recording's path starts with. */
    fun smbRoot(f: NetFolder): String {
        val h = if (f.host.contains(':')) "[${f.host}]" else f.host
        val hp = if (f.port == DEFAULT_PORT) h else "$h:${f.port}"
        val dir = f.folder.split('/').filter { it.isNotEmpty() }.joinToString("") { "$it/" }
        return "smb://$hp/${f.share}/$dir"
    }

    fun smbUrl(f: NetFolder, name: String): String = smbRoot(f) + name

    /** The file name in a path [smbUrl] made for this folder; null when the path is anywhere else or not a recording name. */
    fun nameFromSmbUrl(f: NetFolder, path: String): String? {
        val root = smbRoot(f)
        if (!path.regionMatches(0, root, 0, root.length, ignoreCase = true)) return null
        val name = path.substring(root.length)
        return if (NetPathGuard.isRecordingName(name)) name else null
    }

    /** "DESKTOP-ABC (Recordings)". A DNS name is cut at its first dot ("nas.lan" → "nas"); an address stays whole. */
    fun label(computer: String, share: String): String {
        val c = computer.trim()
        val shown = if (isAddress(c) || c.isEmpty()) c else c.substringBefore('.')
        return "$shown ($share)"
    }

    private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    fun isAddress(host: String): Boolean = IPV4.matches(host) || host.contains(':')
}

/**
 * Which file names the network folder code touches: recordings only, one
 * name, no path. Shared by rename, delete and the playback server (whose URL
 * carries a name from outside the app).
 */
internal object NetPathGuard {
    fun isRecordingName(name: String?): Boolean {
        if (name.isNullOrEmpty() || name.length > 255) return false
        if (!name.endsWith(".ts", ignoreCase = true) || name.length < 4) return false
        if (name == "." || name == ".." || name.startsWith(".")) return false
        // No path, no drive or stream (":" is an NTFS alternate stream), nothing Windows refuses, no control characters.
        return name.none { it == '/' || it == '\\' || it == ':' || it == '*' || it == '?' || it == '"' || it == '<' || it == '>' || it == '|' || it < ' ' }
    }
}

/**
 * Where the network folder is kept: SharedPreferences "smc-netfolder"
 * (private to the app; backups are off app-wide), the password encrypted
 * with an AES-GCM key that lives in the Android Keystore and never leaves
 * it. The password is never returned to the web side and never logged; if
 * the key is lost (a reset Keystore) the folder stays but asks for the
 * password again (a sign-in then fails as 'auth').
 */
internal object NetFolderStore {
    private const val PREFS = "smc-netfolder"
    private const val ALIAS = "smc-netfolder-v1"
    private const val KEYSTORE = "AndroidKeyStore"
    private val lock = Any()

    fun read(ctx: Context): NetFolder? = synchronized(lock) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val host = p.getString("host", null) ?: return null
        val share = p.getString("share", null) ?: return null
        NetFolder(
            host = host,
            port = p.getInt("port", NetFolderRules.DEFAULT_PORT),
            share = share,
            folder = p.getString("folder", "") ?: "",
            domain = p.getString("domain", "") ?: "",
            user = p.getString("user", "") ?: "",
            label = p.getString("label", null) ?: NetFolderRules.label(host, share),
        )
    }

    /** The saved password, decrypted; null when there is none or it can't be decrypted any more. */
    fun password(ctx: Context): String? = synchronized(lock) {
        val blob = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("pw", null) ?: return null
        try {
            val dot = blob.indexOf(':')
            if (dot <= 0) return null
            val iv = Base64.decode(blob.substring(0, dot), Base64.NO_WRAP)
            val ct = Base64.decode(blob.substring(dot + 1), Base64.NO_WRAP)
            val key = existingKey() ?: return null
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            String(c.doFinal(ct), Charsets.UTF_8)
        } catch (_: Throwable) {
            null
        }
    }

    /** Saves the folder and its password (encrypted). False when the Keystore refused, nothing saved then. */
    fun save(ctx: Context, f: NetFolder, password: String): Boolean = synchronized(lock) {
        val blob = try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
            val ct = c.doFinal(password.toByteArray(Charsets.UTF_8))
            Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
        } catch (_: Throwable) {
            // A Keystore that lost its key (or never worked): start again with a new one, once.
            try {
                deleteKey()
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.ENCRYPT_MODE, newKey())
                val ct = c.doFinal(password.toByteArray(Charsets.UTF_8))
                Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
            } catch (_: Throwable) {
                return false
            }
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("host", f.host)
            .putInt("port", f.port)
            .putString("share", f.share)
            .putString("folder", f.folder)
            .putString("domain", f.domain)
            .putString("user", f.user)
            .putString("label", f.label)
            .putString("pw", blob)
            .commit()
    }

    fun clear(ctx: Context) = synchronized(lock) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        deleteKey()
    }

    private fun existingKey(): SecretKey? = try {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
    } catch (_: Throwable) {
        null
    }

    private fun newKey(): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun deleteKey() {
        try { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS) } catch (_: Throwable) { /* none */ }
    }
}
