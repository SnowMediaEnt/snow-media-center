package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NetShareIdleTest {
    private val idle = NetShare.IDLE_MS

    @Test fun in_use_is_never_closed() {
        assertNull(NetShare.idleCloseIn(users = 1, lastUsed = 0L, now = idle * 10))
    }

    @Test fun unused_for_idle_ms_closes_now() {
        assertEquals(0L, NetShare.idleCloseIn(users = 0, lastUsed = 1_000L, now = 1_000L + idle))
    }

    @Test fun used_since_the_booking_looks_again_for_the_rest() {
        assertEquals(idle - 30_000L, NetShare.idleCloseIn(users = 0, lastUsed = 10_000L, now = 40_000L))
    }
}
