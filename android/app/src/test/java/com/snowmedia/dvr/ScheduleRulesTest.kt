package com.snowmedia.dvr

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shared test vectors (src/lib/recordSchedule.vectors.json), read by this
 * test and by recordSchedule.test.ts. Gradle runs unit tests from android/app.
 */
internal object Vectors {
    val root: JSONObject by lazy {
        val candidates = listOf(
            "../../src/lib/recordSchedule.vectors.json",
            "../src/lib/recordSchedule.vectors.json",
            "src/lib/recordSchedule.vectors.json",
        )
        val f = candidates.map { File(it) }.firstOrNull { it.exists() }
            ?: error("recordSchedule.vectors.json not found from ${File(".").absolutePath}")
        JSONObject(f.readText())
    }

    fun sched(o: JSONObject): Sched = Sched(
        id = o.getString("id"),
        streamId = o.getLong("streamId"),
        host = o.getString("host"),
        userTag = o.getString("userTag"),
        startUtcMs = o.getLong("startUtcMs"),
        endUtcMs = o.getLong("endUtcMs"),
        padBeforeMin = o.getInt("padBeforeMin"),
        padAfterMin = o.getInt("padAfterMin"),
        status = o.optString("status", ScheduleStatus.SCHEDULED),
        recordingId = if (o.has("recordingId")) o.getString("recordingId") else null,
        finishedAtMs = o.optLong("finishedAtMs", 0L),
    )

    fun scheds(a: JSONArray): List<Sched> = (0 until a.length()).map { sched(a.getJSONObject(it)) }

    fun cases(name: String): List<JSONObject> {
        val a = root.getJSONArray(name)
        return (0 until a.length()).map { a.getJSONObject(it) }
    }
}

class ScheduleRulesTest {

    @Test fun `padding and the 12 hour cap`() {
        for (c in Vectors.cases("padding")) {
            val s = Sched("x", 1, "h", "t", c.getLong("startUtcMs"), c.getLong("endUtcMs"), c.getInt("padBeforeMin"), c.getInt("padAfterMin"))
            val want = c.getJSONObject("expect")
            assertEquals(c.getString("name"), want.getLong("startMs"), ScheduleRules.paddedStart(s))
            assertEquals(c.getString("name"), want.getLong("endMs"), ScheduleRules.paddedEnd(s))
        }
    }

    @Test fun `back to back recordings of one channel and line are one job`() {
        for (c in Vectors.cases("merge")) {
            val got = ScheduleRules.mergeAdjacent(Vectors.scheds(c.getJSONArray("schedules")))
            val want = c.getJSONArray("expect")
            assertEquals(c.getString("name"), want.length(), got.size)
            for (i in 0 until want.length()) {
                val w = want.getJSONObject(i)
                assertEquals(c.getString("name"), w.getLong("streamId"), got[i].streamId)
                assertEquals(c.getString("name"), w.getLong("startMs"), got[i].startMs)
                assertEquals(c.getString("name"), w.getLong("endMs"), got[i].endMs)
                val ids = w.getJSONArray("ids")
                assertEquals(c.getString("name"), (0 until ids.length()).map { ids.getString(it) }, got[i].ids)
            }
        }
    }

    @Test fun `more recordings than the plan allows is a conflict at the first moment it happens`() {
        for (c in Vectors.cases("conflicts")) {
            val got = ScheduleRules.conflicts(
                Vectors.scheds(c.getJSONArray("existing")), Vectors.sched(c.getJSONObject("candidate")), c.getInt("cap"),
            )
            if (c.isNull("expect")) {
                assertNull(c.getString("name"), got)
            } else {
                val w = c.getJSONObject("expect")
                assertEquals(c.getString("name"), Conflict(w.getLong("atMs"), w.getInt("count")), got)
            }
        }
    }

    @Test fun `an alarm goes off early, on time, late or too late`() {
        for (c in Vectors.cases("fire")) {
            val got = ScheduleRules.planAtFire(Vectors.sched(c.getJSONObject("schedule")), c.getLong("now"))
            assertEquals(c.getString("name"), Fire.valueOf(c.getString("expect")), got)
        }
    }

    @Test fun `after a reboot each schedule is armed, started, marked or purged`() {
        for (c in Vectors.cases("rearm")) {
            val busy = c.getJSONArray("busy").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
            val got = ScheduleRules.rearmPlan(Vectors.scheds(c.getJSONArray("schedules")), c.getLong("now"), busy)
            val want = c.getJSONArray("expect")
            val wantList = (0 until want.length()).map {
                val w = want.getJSONObject(it)
                Rearm(w.getString("id"), RearmKind.valueOf(w.getString("kind")), w.getLong("atMs"))
            }
            assertEquals(c.getString("name"), wantList, got)
        }
    }

    @Test fun `only scheduled and recording ones count as active`() {
        val base = Sched("a", 1, "h", "t", 0, 1, 0, 0)
        assertTrue(ScheduleRules.isActive(base))
        assertTrue(ScheduleRules.isActive(base.copy(status = ScheduleStatus.RECORDING)))
        for (s in listOf(ScheduleStatus.DONE, ScheduleStatus.MISSED, ScheduleStatus.FAILED)) {
            assertEquals(false, ScheduleRules.isActive(base.copy(status = s)))
        }
    }
}
