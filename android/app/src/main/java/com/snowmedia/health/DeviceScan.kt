package com.snowmedia.health

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Log
import android.view.Display
import org.json.JSONArray
import org.json.JSONObject

/**
 * Support › Device check, the quick scan's native half (ported from Tronix
 * compat/DeviceCheck.kt, 2026-10-29). Only what Device Health's vitals
 * (DeviceHealthPlugin.vitals: memory, free storage, Wi-Fi signal / link /
 * frequency, wired, model, sdk) do not already read; the web app reads both
 * and makes them one scan (src/lib/deviceScan.ts).
 *
 *   storage  total of the data volume (the free figure is the vitals')
 *   cpu      ABIs (64-bit or not)
 *   display  the current and the largest mode (physical pixels), refresh, HDR types
 *   codecs   per video type: a decoder at all, a hardware one, 4K, 10-bit
 *   network  wired / Wi-Fi / mobile, validated, VPN, the downstream estimate
 *   wifi     the Wi-Fi standard and the receive link (Android 10+), where given
 *
 * Nothing personal: no network name (that needs location, which SMC never
 * asks for here), no address, no account, no other app. Every part is read
 * on its own: one that throws (an old box, a vendor build) is left out.
 * Exposed as AppManager.getDeviceScan (appmanager/AppManagerPlugin.kt).
 */
object DeviceScan {
    private const val TAG = "SMC-DeviceScan"

    /** The video types the scan asks about, by the web app's short names. */
    val VIDEO_TYPES: List<Pair<String, String>> = listOf(
        "avc" to "video/avc",
        "hevc" to "video/hevc",
        "vp9" to "video/x-vnd.on2.vp9",
        "av1" to "video/av01",
        "dolbyVision" to "video/dolby-vision",
    )

    // MediaCodecInfo.CodecProfileLevel values (fixed by Android; spelled out so
    // older compile SDKs need not have the newer constants).
    private const val HEVC_MAIN10 = 0x2
    private const val HEVC_MAIN10_HDR10 = 0x1000
    private const val HEVC_MAIN10_HDR10_PLUS = 0x2000
    private const val VP9_PROFILE2 = 0x4
    private const val VP9_PROFILE2_HDR = 0x1000
    private const val AV1_MAIN10 = 0x2
    private const val AV1_MAIN10_HDR10 = 0x1000

    /** A link speed worth showing (Android says -1 or 0 for unknown). */
    fun linkOf(mbps: Int?): Int? = if (mbps == null || mbps <= 0 || mbps > 100_000) null else mbps

    /**
     * Before Android 10 there is no "hardware accelerated" flag: Android's own
     * software decoders are named OMX.google.* / c2.android.*, and a few
     * vendors mark theirs .sw. / -sw.
     */
    fun looksSoftware(name: String): Boolean {
        val n = name.lowercase()
        return n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.startsWith("omx.ffmpeg.")
            || n.contains(".sw.") || n.endsWith(".sw") || n.contains("-sw.") || n.contains("software")
    }

    /** The 10-bit profiles of a video type (HDR10 rides on them). */
    fun tenBitProfile(type: String, profile: Int): Boolean = when (type) {
        "video/hevc" -> profile == HEVC_MAIN10 || profile == HEVC_MAIN10_HDR10 || profile == HEVC_MAIN10_HDR10_PLUS
        "video/x-vnd.on2.vp9" -> profile == VP9_PROFILE2 || profile == VP9_PROFILE2_HDR
        "video/av01" -> profile == AV1_MAIN10 || profile == AV1_MAIN10_HDR10
        "video/dolby-vision" -> true
        else -> false
    }

    /** HDR types as the web app names them (Display.HdrCapabilities 1-4). */
    fun hdrName(type: Int): String? = when (type) {
        1 -> "dolbyVision"
        2 -> "hdr10"
        3 -> "hlg"
        4 -> "hdr10plus"
        else -> null
    }

    fun read(context: Context): JSONObject {
        val out = JSONObject()
        part(out, "storage") { storage() }
        part(out, "cpu") { cpu() }
        part(out, "display") { display(context) }
        part(out, "codecs") { codecs() }
        part(out, "network") { network(context) }
        part(out, "wifi") { wifi(context) }
        return out
    }

    private inline fun part(out: JSONObject, name: String, read: () -> JSONObject?) {
        try {
            val v = read()
            if (v != null) out.put(name, v)
        } catch (t: Throwable) {
            Log.w(TAG, "$name unknown (${t.javaClass.simpleName})")
        }
    }

    // The same volume as the vitals' storageFreeMb, so free and total agree.
    private fun storage(): JSONObject {
        val fs = StatFs(Environment.getDataDirectory().path)
        return JSONObject().put("totalBytes", fs.totalBytes)
    }

    private fun cpu(): JSONObject {
        val abis = JSONArray()
        Build.SUPPORTED_ABIS.forEach { abis.put(it) }
        return JSONObject()
            .put("cores", Runtime.getRuntime().availableProcessors())
            .put("abis", abis)
            .put("is64bit", Build.SUPPORTED_64_BIT_ABIS.isNotEmpty())
    }

    @Suppress("DEPRECATION")
    private fun display(context: Context): JSONObject? {
        val dm = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return null
        val d = dm.getDisplay(Display.DEFAULT_DISPLAY) ?: return null
        val out = JSONObject()
        val mode = d.mode
        out.put("widthPx", mode.physicalWidth).put("heightPx", mode.physicalHeight)
        out.put("refreshHz", Math.round(mode.refreshRate * 100) / 100.0)
        var maxW = mode.physicalWidth
        var maxH = mode.physicalHeight
        for (m in d.supportedModes) {
            if (m.physicalWidth.toLong() * m.physicalHeight > maxW.toLong() * maxH) {
                maxW = m.physicalWidth
                maxH = m.physicalHeight
            }
        }
        out.put("maxWidthPx", maxW).put("maxHeightPx", maxH)
        val hdr = JSONArray()
        try {
            d.hdrCapabilities?.supportedHdrTypes?.forEach { t -> hdrName(t)?.let { hdr.put(it) } }
        } catch (_: Throwable) { /* none known */ }
        out.put("hdr", hdr)
        return out
    }

    private fun codecs(): JSONObject {
        val out = JSONObject()
        val infos = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        for ((short, mime) in VIDEO_TYPES) {
            var any = false
            var hw = false
            var uhd = false
            var tenBit = false
            for (info in infos) {
                if (info.isEncoder) continue
                val types = try { info.supportedTypes } catch (_: Throwable) { continue }
                if (types.none { it.equals(mime, ignoreCase = true) }) continue
                any = true
                val hardware = if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated else !looksSoftware(info.name)
                if (hardware) hw = true
                // 4K and 10-bit only count from a hardware decoder (a software
                // one stutters at 4K on a TV box).
                if (!hardware) continue
                try {
                    val caps: MediaCodecInfo.CodecCapabilities = info.getCapabilitiesForType(mime)
                    val video = caps.videoCapabilities
                    if (video != null && (video.isSizeSupported(3840, 2160) || video.isSizeSupported(4096, 2160))) uhd = true
                    if (caps.profileLevels.any { tenBitProfile(mime, it.profile) }) tenBit = true
                } catch (_: Throwable) { /* its capabilities unknown */ }
            }
            out.put(short, JSONObject().put("decoder", any).put("hardware", hw).put("uhd", uhd).put("tenBit", tenBit))
        }
        return out
    }

    private fun network(context: Context): JSONObject? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val net = cm.activeNetwork ?: return JSONObject().put("type", "none")
        val caps = cm.getNetworkCapabilities(net) ?: return JSONObject().put("type", "unknown")
        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        val out = JSONObject()
            .put("type", type)
            .put("vpn", caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN))
            .put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
        val down = caps.linkDownstreamBandwidthKbps
        if (down > 0) out.put("downKbps", down)
        return out
    }

    /** Android 10+: the Wi-Fi's receive link and standard (the rest is the vitals'). */
    private fun wifi(context: Context): JSONObject? {
        if (Build.VERSION.SDK_INT < 29) return null
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return null
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return null
        val info = caps.transportInfo as? WifiInfo ?: return null
        val out = JSONObject()
        linkOf(info.rxLinkSpeedMbps)?.let { out.put("rxLinkMbps", it) }
        if (Build.VERSION.SDK_INT >= 30) {
            val std = info.wifiStandard
            if (std > 0) out.put("standard", std)
        }
        return if (out.length() == 0) null else out
    }
}
