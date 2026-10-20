package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Test

/** A new network recording's name, chosen against what is already in the folder (and on its way there). */
class NetRecordingsTest {
    @Test fun freeNames() {
        assertEquals("CNN.ts", NetRecordings.uniqueAgainst("CNN.ts", emptySet()))
        assertEquals("CNN (2).ts", NetRecordings.uniqueAgainst("CNN.ts", setOf("cnn.ts")))
        assertEquals("CNN (4).ts", NetRecordings.uniqueAgainst("CNN.ts", setOf("cnn.ts", "cnn (2).ts", "cnn (3).ts")))
        assertEquals("News.ts", NetRecordings.uniqueAgainst("News.ts", setOf("cnn.ts")))
    }

    @Test fun pathsThatAreNetwork() {
        assertEquals(true, NetRecordings.isNetPath("smb://nas/Media/a.ts"))
        assertEquals(true, NetRecordings.isNetPath("SMB://nas/Media/a.ts"))
        assertEquals(false, NetRecordings.isNetPath("/storage/emulated/0/Android/data/x/files/Download/Recordings/a.ts"))
        assertEquals(false, NetRecordings.isNetPath(null))
    }
}
