package com.snowmedia.dvr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The stream address is rebuilt in native code at start time, so its encoding
 * must be JavaScript's encodeURIComponent exactly (a password with a space,
 * + ~ ! * ' ( ) # % & / or non-ASCII letters would otherwise be refused by
 * the provider). The expected strings in the vectors come from the real
 * encodeURIComponent; recordSchedule.test.ts checks them against it too.
 */
class LineCredsTest {

    @Test fun `encodeUriComponent matches encodeURIComponent for every vector`() {
        for (c in Vectors.cases("urlEncode")) {
            assertEquals("input ${c.getString("input")}", c.getString("expect"), LineCreds.encodeUriComponent(c.getString("input")))
        }
    }

    @Test fun `the characters URLEncoder gets wrong stay as they are`() {
        assertEquals("~!*'()", LineCreds.encodeUriComponent("~!*'()"))
        assertEquals("a%20b", LineCreds.encodeUriComponent("a b"))
        assertEquals("p%2Bq", LineCreds.encodeUriComponent("p+q"))
    }

    @Test fun `the live address is host slash live slash user slash pass slash id dot ts`() {
        for (c in Vectors.cases("liveUrl")) {
            assertEquals(
                c.getString("host"),
                c.getString("expect"),
                LineCreds.buildLiveTsUrl(c.getString("host"), c.getString("user"), c.getString("pass"), c.getLong("streamId")),
            )
        }
    }

    @Test fun `the user tag is 16 hex characters of a hash, and tells accounts apart`() {
        for (c in Vectors.cases("userTag")) {
            assertEquals(c.getString("expect"), LineCreds.userTag(c.getString("host"), c.getString("user")))
        }
        assertEquals(LineCreds.userTag("http://h:1", "a"), LineCreds.userTag("http://h:1/", "a"))
        assertTrue(LineCreds.userTag("http://h:1", "a") != LineCreds.userTag("http://h:1", "b"))
    }

    @Test fun `a saved login is read from either key's JSON, and a blank one is no login`() {
        val l = LineCreds.parse("""{"host":"http://h:1","username":" u ","password":"p","output":"m3u8"}""")
        assertNotNull(l)
        assertEquals("u", l!!.username)
        assertNull(LineCreds.parse(null))
        assertNull(LineCreds.parse(""))
        assertNull(LineCreds.parse("not json"))
        assertNull(LineCreds.parse("""{"host":"http://h:1","username":"","password":"p"}"""))
    }
}
