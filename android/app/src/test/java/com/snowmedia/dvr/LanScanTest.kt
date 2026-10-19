package com.snowmedia.dvr

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

/** The LAN scan never leaves the box's /24, and NetBIOS names are asked and read correctly. */
class LanScanTest {
    @Test fun onlyTheOwnSlash24() {
        val n = LanScan.neighbours(byteArrayOf(192.toByte(), 168.toByte(), 1, 37))
        assertEquals(253, n.size)
        assertEquals("192.168.1.1", n.first())
        assertEquals("192.168.1.254", n.last())
        assertFalse("192.168.1.37" in n)
        assertFalse(n.any { it.endsWith(".0") || it.endsWith(".255") })
        assertEquals(setOf("192.168.1."), n.map { it.substringBeforeLast('.') + "." }.toSet())
    }

    @Test fun nodeStatusRequestIsTheStandardOne() {
        val expected = ByteArrayOutputStream().apply {
            write(byteArrayOf(0x12, 0x34, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x20))
            write("CK".toByteArray()); write("A".repeat(30).toByteArray())
            write(byteArrayOf(0, 0, 0x21, 0, 1))
        }.toByteArray()
        assertArrayEquals(expected, LanScan.nbstatRequest(0x1234))
        assertEquals(50, expected.size)
    }

    private fun entry(name: String, suffix: Int, group: Boolean): ByteArray =
        name.padEnd(15, ' ').toByteArray(Charsets.ISO_8859_1) + byteArrayOf(suffix.toByte(), if (group) 0x84.toByte() else 0x04, 0)

    private fun response(entries: List<ByteArray>, pointer: Boolean = false): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x12, 0x34, 0x84.toByte(), 0, 0, 0, 0, 1, 0, 0, 0, 0))
        if (pointer) out.write(byteArrayOf(0xC0.toByte(), 0x0C)) else {
            out.write(0x20); out.write("CK".toByteArray()); out.write("A".repeat(30).toByteArray()); out.write(0)
        }
        val data = ByteArrayOutputStream().apply { write(entries.size); entries.forEach { write(it) }; write(ByteArray(46)) }.toByteArray()
        out.write(byteArrayOf(0, 0x21, 0, 1, 0, 0, 0, 0, (data.size shr 8).toByte(), data.size.toByte()))
        out.write(data)
        return out.toByteArray()
    }

    @Test fun theWorkstationNameIsPicked() {
        val r = response(listOf(entry("WORKGROUP", 0x00, true), entry("DESKTOP-ABC", 0x20, false), entry("DESKTOP-ABC", 0x00, false)))
        assertEquals("DESKTOP-ABC", LanScan.nbstatName(r))
        assertEquals("NAS", LanScan.nbstatName(response(listOf(entry("NAS", 0x00, false)), pointer = true)))
    }

    @Test fun noUsableName() {
        assertNull(LanScan.nbstatName(response(listOf(entry("WORKGROUP", 0x00, true)))))
        assertNull(LanScan.nbstatName(ByteArray(5)))
        val r = response(listOf(entry("DESKTOP-ABC", 0x00, false)))
        assertNull(LanScan.nbstatName(r, 60)) // cut short
    }
}
