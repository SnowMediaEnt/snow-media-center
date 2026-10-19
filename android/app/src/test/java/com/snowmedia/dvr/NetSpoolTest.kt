package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The box-side spool of a network recording: chunk names and order, what may go, and the resume manifest. */
class NetSpoolTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun chunkNames() {
        assertEquals("c00000.ts", NetSpool.chunkName(0))
        assertEquals("c00042.ts", NetSpool.chunkName(42))
        assertEquals("c123456.ts", NetSpool.chunkName(123456))
        assertEquals(42, NetSpool.chunkIndex("c00042.ts"))
        assertEquals(123456, NetSpool.chunkIndex("c123456.ts"))
        for (bad in listOf("upload.json", "c1.ts", "c00001.ts.tmp", "x00001.ts", "c0000a.ts", "C00001.ts")) assertNull(bad, NetSpool.chunkIndex(bad))
    }

    @Test fun chunksInRecordingOrderNotNameOrder() {
        val d = tmp.newFolder("rec")
        for (i in listOf(100000, 2, 0, 99999, 1)) File(d, NetSpool.chunkName(i)).writeText("$i")
        File(d, "upload.json").writeText("{}")
        File(d, "upload.json.tmp").writeText("{}")
        assertEquals(listOf(0, 1, 2, 99999, 100000), NetSpool.chunks(d).map { NetSpool.chunkIndex(it.name) })
    }

    @Test fun theChunkBeingWrittenNeverGoes() {
        val d = tmp.newFolder("rec")
        val all = (0..3).map { File(d, NetSpool.chunkName(it)).apply { writeText("x") } }
        assertEquals(all, NetSpool.uploadable(all, null))
        assertEquals(all.take(3), NetSpool.uploadable(all, 3))
        assertEquals(emptyList<File>(), NetSpool.uploadable(all.take(1), 0))
    }

    @Test fun nextChunk() {
        val d = tmp.newFolder("rec")
        assertEquals(File(d, "c00001.ts"), NetSpool.next(File(d, "c00000.ts")))
        assertEquals(File(d, "c100000.ts"), NetSpool.next(File(d, "c99999.ts")))
    }

    @Test fun pendingBytesCountsChunksOnly() {
        val d = tmp.newFolder("rec")
        File(d, NetSpool.chunkName(0)).writeBytes(ByteArray(10))
        File(d, NetSpool.chunkName(1)).writeBytes(ByteArray(5))
        File(d, "upload.json").writeBytes(ByteArray(100))
        assertEquals(15L, NetSpool.pendingBytes(d))
    }

    private val m = NetSpool.Manifest(
        id = "abc-123", name = "CNN.ts", remoteName = "CNN (2).ts", remoteBytes = 64L * 1024 * 1024, lastChunk = 1,
        finished = true, channel = "CNN", startedAt = 1_760_000_000_000L,
        root = "smb://DESKTOP-ABC/Media/Snow Media Recordings/", label = "DESKTOP-ABC (Media)",
    )

    @Test fun manifestRoundTrip() {
        assertEquals(m, NetSpool.fromJson(NetSpool.toJson(m)))
        val fresh = NetSpool.Manifest(id = "x", name = "News.ts")
        assertEquals(fresh, NetSpool.fromJson(NetSpool.toJson(fresh)))
        assertNull(NetSpool.fromJson(NetSpool.toJson(fresh))!!.remoteName)
        assertEquals("News.ts", fresh.shownName)
        assertEquals("CNN (2).ts", m.shownName)
    }

    @Test fun manifestRefusesWhatCouldPointElsewhere() {
        assertNull(NetSpool.fromJson(null))
        assertNull(NetSpool.fromJson("not json"))
        assertNull(NetSpool.fromJson("""{"id":"","name":"a.ts"}"""))
        assertNull(NetSpool.fromJson("""{"id":"x","name":"../a.ts"}"""))
        assertNull(NetSpool.fromJson("""{"id":"x","name":"a.exe"}"""))
        // A bad remote name is dropped (the file is created again under a good one), not followed.
        assertNull(NetSpool.fromJson("""{"id":"x","name":"a.ts","remoteName":"..\\b.ts"}""")!!.remoteName)
        assertEquals(0L, NetSpool.fromJson("""{"id":"x","name":"a.ts","remoteBytes":-5}""")!!.remoteBytes)
    }

    @Test fun manifestOnDiskReplacesWhole() {
        val d = File(tmp.root, "spool/abc-123")
        NetSpool.write(d, m)
        assertEquals(m, NetSpool.read(d))
        NetSpool.write(d, m.copy(remoteBytes = 1L))
        assertEquals(1L, NetSpool.read(d)!!.remoteBytes)
        assertFalse(File(d, "upload.json.tmp").exists())
        File(d, NetSpool.chunkName(0)).writeText("x")
        NetSpool.deleteAll(d)
        assertFalse(d.exists())
        assertNull(NetSpool.read(d))
    }

    @Test fun chunkSizeIsAbout32Mb() {
        assertEquals(32L * 1024 * 1024, NetSpool.CHUNK_BYTES)
        assertTrue(NetSpool.CHUNK_BYTES < RecordingStore.PART_LIMIT_BYTES)
    }
}
