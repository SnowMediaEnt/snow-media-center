package com.snowmedia.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import com.snowmedia.BuildConfig
import java.security.MessageDigest

/**
 * Is this still our signed copy of the app? Checked as the app starts
 * (MainActivity), in release builds only.
 *
 * Changing anything inside the APK (the web app in assets/public included)
 * and putting it back together means signing it again with a key other than
 * ours, so a changed copy fails the signature check. A copy moved to another
 * application id, or rebuilt as debuggable to attach a debugger, fails too.
 *
 * The expected value is the release certificate's SHA-256 fingerprint
 * (BuildConfig.SMC_SIGNING_SHA256, read from the keystore at build time; see
 * android/app/build.gradle). A fingerprint is public — it is printed from any
 * APK — so nothing secret is kept here. This raises the cost of a modified
 * copy; it cannot make one impossible (someone patient can patch this check
 * out too), which is why everything of value is decided on the server.
 */
object TamperGuard {
    /** Why this copy fails, or null when it is fine (or the check is off). */
    fun problem(context: Context): String? {
        if (BuildConfig.DEBUG) return null
        if (context.packageName != BuildConfig.APPLICATION_ID) return "application id"
        if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) return "debuggable"
        val want = BuildConfig.SMC_SIGNING_SHA256.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        if (want.isEmpty()) return null
        val have = signerFingerprints(context)
        if (have.isEmpty() || have.none { it in want }) return "signature"
        return null
    }

    @Suppress("DEPRECATION")
    private fun signerFingerprints(context: Context): Set<String> {
        val pm = context.packageManager
        val signatures: Array<Signature> = try {
            if (Build.VERSION.SDK_INT >= 28) {
                val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
                    ?: return emptySet()
                (if (info.hasMultipleSigners()) info.apkContentsSigners else info.signingCertificateHistory)
                    ?: return emptySet()
            } else {
                pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures ?: return emptySet()
            }
        } catch (e: Exception) {
            return emptySet()
        }
        return signatures.map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { b -> "%02x".format(b) }
        }.toSet()
    }
}
