package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * The Recordings folder does not exist until the first recording, and StatFs
 * throws on a missing path: free space must be measured on the nearest parent
 * that exists (the Record dialog showed "0 MB free" on a box that never recorded).
 */
class StorageBudgetTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun existingFolderIsItself() {
        val d = tmp.newFolder("Recordings")
        assertEquals(d, StorageBudget.nearestExisting(d))
    }

    @Test fun missingFolderUsesItsNearestExistingParent() {
        val parent = tmp.newFolder("files", "Download")
        val missing = File(parent, "Recordings")
        assertEquals(parent, StorageBudget.nearestExisting(missing))
    }

    @Test fun severalMissingLevelsWalkUpToTheFirstThatExists() {
        val parent = tmp.newFolder("usb")
        val missing = File(parent, "Android/data/pkg/files/Download/Recordings")
        assertEquals(parent, StorageBudget.nearestExisting(missing))
    }

    @Test fun neverMissingEverythingOnARealPath() {
        // Any absolute path ends at the file system root, which exists.
        assertNotNull(StorageBudget.nearestExisting(File(tmp.root, "a/b/c").absoluteFile))
    }
}
