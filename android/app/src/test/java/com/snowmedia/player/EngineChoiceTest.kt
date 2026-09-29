package com.snowmedia.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Which engine a load() uses — see EngineChoice's own doc. mpv is a Live TV
 * thing only: the main slot, live=true, and only when the build, the
 * Android version and this process's own history all say yes.
 */
class EngineChoiceTest {
    private val allOk = EngineChoice.Availability(inBuild = true, androidOk = true, initFailed = false)

    @Test fun `requesting exo is always exo, with no reason`() {
        val c = EngineChoice.choose("exo", "main", live = true, availability = allOk)
        assertEquals(EngineChoice.EXO, c.engine)
        assertNull(c.fallbackReason)
    }

    @Test fun `mpv on the main slot playing live, everything available, is mpv`() {
        val c = EngineChoice.choose("mpv", "main", live = true, availability = allOk)
        assertEquals(EngineChoice.MPV, c.engine)
        assertNull(c.fallbackReason)
    }

    @Test fun `mpv on a tile, or VOD on main, is silently exo — never offered, so no reason`() {
        assertNull(EngineChoice.choose("mpv", "tile-1", live = true, availability = allOk).fallbackReason)
        assertEquals(EngineChoice.EXO, EngineChoice.choose("mpv", "tile-1", live = true, availability = allOk).engine)
        assertEquals(EngineChoice.EXO, EngineChoice.choose("mpv", "main", live = false, availability = allOk).engine)
        assertNull(EngineChoice.choose("mpv", "main", live = false, availability = allOk).fallbackReason)
    }

    @Test fun `mpv not compiled into this build falls back with not-in-build`() {
        val c = EngineChoice.choose("mpv", "main", live = true, availability = allOk.copy(inBuild = false))
        assertEquals(EngineChoice.EXO, c.engine)
        assertEquals(EngineChoice.NOT_IN_BUILD, c.fallbackReason)
    }

    @Test fun `below Android 8 falls back with android-too-old`() {
        val c = EngineChoice.choose("mpv", "main", live = true, availability = allOk.copy(androidOk = false))
        assertEquals(EngineChoice.EXO, c.engine)
        assertEquals(EngineChoice.ANDROID_TOO_OLD, c.fallbackReason)
    }

    @Test fun `mpv having already failed once this process falls back with init-failed`() {
        val c = EngineChoice.choose("mpv", "main", live = true, availability = allOk.copy(initFailed = true))
        assertEquals(EngineChoice.EXO, c.engine)
        assertEquals(EngineChoice.INIT_FAILED, c.fallbackReason)
    }

    @Test fun `build and Android checks come before init-failed, in that order`() {
        val neither = EngineChoice.Availability(inBuild = false, androidOk = false, initFailed = true)
        assertEquals(EngineChoice.NOT_IN_BUILD, EngineChoice.choose("mpv", "main", live = true, availability = neither).fallbackReason)
        val androidOnly = neither.copy(inBuild = true)
        assertEquals(EngineChoice.ANDROID_TOO_OLD, EngineChoice.choose("mpv", "main", live = true, availability = androidOnly).fallbackReason)
    }

    @Test fun `anything other than the literal 'mpv' request is exo`() {
        assertEquals(EngineChoice.EXO, EngineChoice.choose("", "main", live = true, availability = allOk).engine)
        assertEquals(EngineChoice.EXO, EngineChoice.choose("MPV", "main", live = true, availability = allOk).engine)
    }
}
