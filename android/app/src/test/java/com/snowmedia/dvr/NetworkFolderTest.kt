package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the TV screen sends for a network folder, parsed and checked (NetFolderRules, NetPathGuard). */
class NetworkFolderTest {
    private fun hp(s: String?) = NetFolderRules.parseHost(s)

    @Test fun hostsAsPeopleTypeThem() {
        assertEquals(NetFolderRules.HostPort("DESKTOP-ABC", 445), hp("DESKTOP-ABC"))
        assertEquals(NetFolderRules.HostPort("192.168.1.20", 445), hp(" 192.168.1.20 "))
        assertEquals(NetFolderRules.HostPort("nas.local", 4445), hp("nas.local:4445"))
        assertEquals(NetFolderRules.HostPort("DESKTOP-ABC", 445), hp("\\\\DESKTOP-ABC\\Recordings"))
        assertEquals(NetFolderRules.HostPort("nas", 445), hp("smb://nas/share/folder"))
        assertEquals(NetFolderRules.HostPort("fe80::1", 445), hp("fe80::1"))
        assertEquals(NetFolderRules.HostPort("fe80::1", 4445), hp("[fe80::1]:4445"))
        assertEquals(NetFolderRules.HostPort("10.0.2.2", 1445), hp("10.0.2.2:1445"))
    }

    @Test fun unusableHosts() {
        for (bad in listOf(null, "", "   ", "\\\\", "host:0", "host:70000", "host:abc", "-lead", "a b", "[fe80::1", "[zz]:445", "a..b", "host:")) {
            assertNull(bad, hp(bad))
        }
    }

    @Test fun displayHostRoundTrips() {
        assertEquals("nas", NetFolderRules.displayHost("nas", 445))
        assertEquals("nas:4445", NetFolderRules.displayHost("nas", 4445))
        assertEquals("[fe80::1]:4445", NetFolderRules.displayHost("fe80::1", 4445))
        for (s in listOf("nas", "nas:4445", "[fe80::1]:4445", "192.168.1.2")) {
            val p = hp(s)!!
            assertEquals(p, hp(NetFolderRules.displayHost(p.host, p.port)))
        }
    }

    @Test fun shares() {
        assertEquals("Recordings", NetFolderRules.cleanShare(" \\Recordings\\ "))
        assertEquals("TV Shows", NetFolderRules.cleanShare("TV Shows"))
        assertEquals("public$", NetFolderRules.cleanShare("public$"))
        for (bad in listOf(null, "", "/", "a/b", "a\\b", "a:b", "a*b", "a?", "x".repeat(81))) assertNull(bad, NetFolderRules.cleanShare(bad))
    }

    @Test fun folders() {
        assertEquals(NetFolderRules.DEFAULT_FOLDER, NetFolderRules.cleanFolder(null))
        assertEquals("", NetFolderRules.cleanFolder(""))
        assertEquals("", NetFolderRules.cleanFolder("/"))
        assertEquals("TV/Recordings", NetFolderRules.cleanFolder("\\TV\\Recordings\\"))
        assertEquals("TV/Recordings", NetFolderRules.cleanFolder("TV//Recordings"))
        assertEquals("My Shows", NetFolderRules.cleanFolder(" My Shows. "))
        for (bad in listOf("..", "a/../b", "./a", "a:b", "a*", "a?b", "a|b", "a<b", "a\"b", "a\u0001")) assertNull(bad, NetFolderRules.cleanFolder(bad))
    }

    @Test fun users() {
        assertEquals("WORKGROUP" to "josh", NetFolderRules.splitUser("WORKGROUP\\josh"))
        assertEquals("" to "josh", NetFolderRules.splitUser(" josh "))
        assertEquals("" to "josh@example.com", NetFolderRules.splitUser("josh@example.com"))
        assertEquals("" to "", NetFolderRules.splitUser(null))
        assertEquals("WORKGROUP\\josh", NetFolderRules.joinUser("WORKGROUP", "josh"))
        assertEquals("josh", NetFolderRules.joinUser("", "josh"))
    }

    private val f = NetFolder("DESKTOP-ABC", 445, "Media", "Snow Media Recordings", "", "josh", "DESKTOP-ABC (Media)")

    @Test fun smbPathsInsideTheShare() {
        assertEquals("Snow Media Recordings\\CNN.ts", NetFolderRules.smbPath(f.folder, "CNN.ts"))
        assertEquals("TV\\Rec", NetFolderRules.smbPath("TV/Rec"))
        assertEquals("CNN.ts", NetFolderRules.smbPath("", "CNN.ts"))
        assertEquals("", NetFolderRules.smbPath(""))
    }

    @Test fun smbUrlsAndBack() {
        assertEquals("smb://DESKTOP-ABC/Media/Snow Media Recordings/", NetFolderRules.smbRoot(f))
        assertEquals("smb://DESKTOP-ABC/Media/Snow Media Recordings/CNN.ts", NetFolderRules.smbUrl(f, "CNN.ts"))
        assertEquals("smb://nas:4445/Media/", NetFolderRules.smbRoot(f.copy(host = "nas", port = 4445, folder = "")))
        assertEquals("smb://[fe80::1]/Media/a/b/", NetFolderRules.smbRoot(f.copy(host = "fe80::1", folder = "a/b")))
        assertEquals("CNN (2).ts", NetFolderRules.nameFromSmbUrl(f, "smb://desktop-abc/media/snow media recordings/CNN (2).ts"))
        // Anywhere else, or not a recording name: refused.
        assertNull(NetFolderRules.nameFromSmbUrl(f, "smb://OTHER/Media/Snow Media Recordings/CNN.ts"))
        assertNull(NetFolderRules.nameFromSmbUrl(f, "smb://DESKTOP-ABC/Media/Snow Media Recordings/sub/CNN.ts"))
        assertNull(NetFolderRules.nameFromSmbUrl(f, "smb://DESKTOP-ABC/Media/Snow Media Recordings/../CNN.ts"))
        assertNull(NetFolderRules.nameFromSmbUrl(f, "smb://DESKTOP-ABC/Media/Snow Media Recordings/notes.txt"))
    }

    @Test fun labels() {
        assertEquals("DESKTOP-ABC (Recordings)", NetFolderRules.label("DESKTOP-ABC", "Recordings"))
        assertEquals("nas (Media)", NetFolderRules.label("nas.lan", "Media"))
        assertEquals("192.168.1.20 (Media)", NetFolderRules.label("192.168.1.20", "Media"))
    }

    @Test fun sameLoginIsTheSameComputerPortAndAccount() {
        assertTrue(NetFolderRules.sameLogin(f, "desktop-abc", 445, "", "JOSH"))
        assertFalse(NetFolderRules.sameLogin(f, "desktop-abc", 4445, "", "josh"))
        assertFalse(NetFolderRules.sameLogin(f, "other", 445, "", "josh"))
        assertFalse(NetFolderRules.sameLogin(f, "desktop-abc", 445, "", "amy"))
        assertFalse(NetFolderRules.sameLogin(f, "desktop-abc", 445, "WORK", "josh"))
    }

    @Test fun theKeyHasNoPasswordAndChangesWithThePlace() {
        assertEquals(f.key, f.copy(label = "x").key)
        assertTrue(f.key != f.copy(folder = "other").key)
        assertTrue(f.key != f.copy(user = "amy").key)
    }

    @Test fun recordingNames() {
        for (ok in listOf("CNN.ts", "News (CNN) – 2026-10-19 20.00.ts", "a.TS", "Ünïcødé.ts")) assertTrue(ok, NetPathGuard.isRecordingName(ok))
        for (bad in listOf(null, "", ".ts", "..", "../a.ts", "a/b.ts", "a\\b.ts", "C:a.ts", "a.ts:stream", "a.ts:x.ts", ".hidden.ts", "a.mp4", "a?.ts", "a\u0000.ts", "x".repeat(254) + ".ts")) {
            assertFalse(bad.toString(), NetPathGuard.isRecordingName(bad))
        }
    }
}
