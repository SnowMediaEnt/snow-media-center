package com.snowmedia.dvr

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Finds computers and NAS boxes that share folders, for the network folder
 * set-up: every address of the box's own subnet (192.168.1.1-254 for a box
 * at 192.168.1.37/24) is tried on TCP 445, briefly and many at once. Never
 * more than a /24 (a /16 home network is scanned in the box's own /24 only),
 * and never beyond the subnet itself (a /26 is 62 addresses, not a /24
 * through the gateway). Each one found is named by its
 * NetBIOS name (what Windows and Samba answer to on UDP 137) or else its
 * reverse DNS name. The whole scan takes about 5 s at most.
 */
internal object LanScan {
    data class Computer(val host: String, val name: String?)

    private const val CONNECT_MS = 600
    private const val SCAN_BUDGET_MS = 3_200L
    private const val NAME_BUDGET_MS = 1_500L
    private const val PARALLEL = 64

    /** The box's own private IPv4 address (Wi-Fi or Ethernet) and its prefix length, or null when it has none. */
    fun ownAddress(): Pair<Inet4Address, Int>? {
        val found = ArrayList<Triple<String, Inet4Address, Int>>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()) {
                if (!ni.isUp || ni.isLoopback || ni.isVirtual || ni.isPointToPoint) continue
                for (ia in ni.interfaceAddresses.orEmpty()) {
                    val a = ia.address
                    if (a is Inet4Address && a.isSiteLocalAddress) found.add(Triple(ni.name, a, ia.networkPrefixLength.toInt()))
                }
            }
        } catch (_: Throwable) {
            return null
        }
        // Ethernet or Wi-Fi first; a VPN or a hotspot interface last.
        return found.sortedBy { (n, _, _) -> if (n.startsWith("eth") || n.startsWith("wlan")) 0 else 1 }.firstOrNull()?.let { it.second to it.third }
    }

    /**
     * The other host addresses of [own]'s subnet, in order: the subnet of
     * [prefix], never wider than /24 (a shorter or unknown prefix is taken
     * as /24), without the network and broadcast addresses (a /31 has two
     * hosts and no broadcast; a /32 has no neighbours). Pure: LanScanTest.
     */
    fun neighbours(own: ByteArray, prefix: Int = 24): List<String> {
        require(own.size == 4)
        val p = if (prefix in 24..32) prefix else 24
        val ip = own.fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) }
        val size = 1L shl (32 - p)
        val net = ip and (0xFFFFFFFFL xor (size - 1))
        val hosts = when {
            p == 32 -> emptyList()
            p == 31 -> listOf(net, net + 1)
            else -> (net + 1 until net + size - 1).toList()
        }
        return hosts.filter { it != ip }.map { "${(it shr 24) and 0xFF}.${(it shr 16) and 0xFF}.${(it shr 8) and 0xFF}.${it and 0xFF}" }
    }

    fun find(): List<Computer> {
        val (own, prefix) = ownAddress() ?: return emptyList()
        val exec = Executors.newFixedThreadPool(PARALLEL) { r -> Thread(r, "smc-lan-scan").apply { isDaemon = true } }
        try {
            val tasks = neighbours(own.address, prefix).map { ip ->
                Callable {
                    try {
                        Socket().use { s -> s.connect(InetSocketAddress(ip, 445), CONNECT_MS) }
                        ip
                    } catch (_: Throwable) {
                        null
                    }
                }
            }
            val open = exec.invokeAll(tasks, SCAN_BUDGET_MS, TimeUnit.MILLISECONDS)
                .mapNotNull { f -> try { if (f.isCancelled) null else f.get() } catch (_: Throwable) { null } }
            if (open.isEmpty()) return emptyList()
            val names = HashMap(netbiosNames(open))
            val missing = open.filter { names[it] == null }
            if (missing.isNotEmpty()) {
                val rdns = missing.map { ip ->
                    Callable {
                        val n = try { InetAddress.getByName(ip).canonicalHostName } catch (_: Throwable) { null }
                        ip to n?.takeIf { it != ip && it.isNotBlank() }?.trimEnd('.')?.substringBefore('.')
                    }
                }
                for (f in exec.invokeAll(rdns, NAME_BUDGET_MS, TimeUnit.MILLISECONDS)) {
                    val r = try { if (f.isCancelled) null else f.get() } catch (_: Throwable) { null } ?: continue
                    r.second?.let { names[r.first] = it }
                }
            }
            return open.sortedBy { it.substringAfterLast('.').toInt() }.map { Computer(it, names[it]) }
        } finally {
            exec.shutdownNow()
        }
    }

    /** One name for [host], for the folder's label (NetBIOS, then reverse DNS); null when neither answers in time. */
    fun nameOf(host: String): String? {
        if (!NetFolderRules.isAddress(host)) return host
        netbiosNames(listOf(host))[host]?.let { return it }
        val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "smc-lan-name").apply { isDaemon = true } }
        return try {
            exec.submit(Callable {
                val n = InetAddress.getByName(host).canonicalHostName
                n.takeIf { it != host && it.isNotBlank() }?.trimEnd('.')?.substringBefore('.')
            }).get(NAME_BUDGET_MS, TimeUnit.MILLISECONDS)
        } catch (_: Throwable) {
            null
        } finally {
            exec.shutdownNow()
        }
    }

    // ---- NetBIOS node status (RFC 1002 §4.2.17/18) ----

    /** A node status request for "*" (50 bytes). Pure: LanScanTest. */
    fun nbstatRequest(id: Int): ByteArray {
        val b = ByteArray(50)
        b[0] = (id shr 8).toByte(); b[1] = id.toByte()
        b[5] = 1 // one question
        b[12] = 0x20
        // "*" padded with zeros to 16 bytes, each half-byte as 'A' + nibble.
        b[13] = 'C'.code.toByte(); b[14] = 'K'.code.toByte()
        for (i in 15 until 45) b[i] = 'A'.code.toByte()
        b[45] = 0
        b[47] = 0x21 // NBSTAT
        b[49] = 0x01 // IN
        return b
    }

    /** The computer's name in a node status response: its first unique name of type 0x00 (the workstation). Pure: LanScanTest. */
    fun nbstatName(resp: ByteArray, len: Int = resp.size): String? {
        try {
            var p = 12
            if (len < p + 1) return null
            // The answer's name: a compression pointer, or labels up to a zero.
            if ((resp[p].toInt() and 0xC0) == 0xC0) p += 2 else {
                while (p < len && resp[p].toInt() != 0) p += (resp[p].toInt() and 0xFF) + 1
                p += 1
            }
            if (p + 10 > len) return null
            val type = ((resp[p].toInt() and 0xFF) shl 8) or (resp[p + 1].toInt() and 0xFF)
            if (type != 0x21) return null
            p += 10 // type, class, TTL, data length
            val count = resp[p].toInt() and 0xFF
            p += 1
            for (i in 0 until count) {
                if (p + 18 > len) return null
                val suffix = resp[p + 15].toInt() and 0xFF
                val group = (resp[p + 16].toInt() and 0x80) != 0
                if (suffix == 0x00 && !group) {
                    val name = String(resp, p, 15, Charsets.ISO_8859_1).trim().trimEnd('\u0000')
                    if (name.isNotEmpty() && name.all { it in ' '..'~' }) return name
                }
                p += 18
            }
        } catch (_: Throwable) { /* malformed */ }
        return null
    }

    /** Asks every host in [hosts] for its NetBIOS name at once, answers collected for under a second. */
    private fun netbiosNames(hosts: List<String>): Map<String, String> {
        val out = HashMap<String, String>()
        try {
            DatagramSocket().use { sock ->
                sock.soTimeout = 200
                hosts.forEachIndexed { i, h ->
                    try {
                        val req = nbstatRequest(0x5300 + i)
                        sock.send(DatagramPacket(req, req.size, InetAddress.getByName(h), 137))
                    } catch (_: Throwable) { /* that one won't answer */ }
                }
                val until = System.currentTimeMillis() + 800L
                val buf = ByteArray(1024)
                while (System.currentTimeMillis() < until && out.size < hosts.size) {
                    val pkt = DatagramPacket(buf, buf.size)
                    try { sock.receive(pkt) } catch (_: SocketTimeoutException) { continue }
                    val from = pkt.address?.hostAddress ?: continue
                    if (from !in hosts) continue
                    nbstatName(pkt.data, pkt.length)?.let { out[from] = it }
                }
            }
        } catch (_: Throwable) { /* names are a nicety */ }
        return out
    }
}
