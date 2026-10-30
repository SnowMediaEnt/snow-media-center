package com.snowmedia.notify

import com.snowmedia.notify.AlertPollScheduler.Plan
import com.snowmedia.notify.AlertPollScheduler.Rearm
import org.junit.Assert.assertEquals
import org.junit.Test

class AlertPollPlanTest {
    private val min = 60_000L

    @Test fun interval_is_fifteen_minutes() {
        assertEquals(15L, AlertPollScheduler.INTERVAL_MINUTES)
    }

    @Test fun chain_link_on_screen_skips_the_fetch_but_keeps_the_chain() {
        assertEquals(Plan(fetch = false, rearm = Rearm.NEXT_LINK),
            AlertPollScheduler.plan(chainLink = true, askedNow = false, onScreen = true, sinceLastLinkMs = 15 * min))
    }

    @Test fun chain_link_off_screen_fetches() {
        assertEquals(Plan(fetch = true, rearm = Rearm.NEXT_LINK),
            AlertPollScheduler.plan(chainLink = true, askedNow = false, onScreen = false, sinceLastLinkMs = 15 * min))
    }

    @Test fun asked_now_fetches_even_on_screen() {
        assertEquals(Plan(fetch = true, rearm = Rearm.NEXT_LINK),
            AlertPollScheduler.plan(chainLink = true, askedNow = true, onScreen = true, sinceLastLinkMs = 0))
    }

    @Test fun safety_net_does_nothing_while_the_chain_is_alive() {
        assertEquals(Plan(fetch = false, rearm = Rearm.NONE),
            AlertPollScheduler.plan(chainLink = false, askedNow = false, onScreen = false, sinceLastLinkMs = 19 * min))
    }

    @Test fun safety_net_restarts_a_dead_chain_and_fetches_off_screen_only() {
        assertEquals(Plan(fetch = true, rearm = Rearm.RESTART_LATER),
            AlertPollScheduler.plan(chainLink = false, askedNow = false, onScreen = false, sinceLastLinkMs = 21 * min))
        assertEquals(Plan(fetch = false, rearm = Rearm.RESTART_LATER),
            AlertPollScheduler.plan(chainLink = false, askedNow = false, onScreen = true, sinceLastLinkMs = Long.MAX_VALUE))
    }
}
