package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.json.JSONObject

/**
 * The one envelope shape both directions of the JSON channel agree on:
 * `{t, d, id?}`.
 *
 * The failure this pins: the headset used to hand-build each envelope inline,
 * so the questionnaire relay spliced an already-serialised sheet while the
 * other types re-serialised a parsed object. Both must produce the same
 * document, and the splice must not touch the page's bytes or key order.
 */
class JsonEnvelopeTest {

    @Test
    fun `an already-serialised body is spliced verbatim`() {
        // Key order is the page's, not ours: only the three envelope bytes are added.
        val sheet = "{\"b\":2,\"a\":1}"
        assertEquals(
            "{\"t\":\"questionnaire-result\",\"d\":{\"b\":2,\"a\":1}}",
            JsonEnvelope.document("questionnaire-result", sheet)
        )
    }

    @Test
    fun `the id comes after the body and only when present`() {
        assertEquals(
            "{\"t\":\"log\",\"d\":{\"a\":1},\"id\":\"r-7\"}",
            JsonEnvelope.document("log", "{\"a\":1}", "r-7")
        )
        // An empty id means "not a durable record", not an empty envelope field.
        assertEquals("{\"t\":\"log\",\"d\":{\"a\":1}}", JsonEnvelope.document("log", "{\"a\":1}", ""))
    }

    @Test
    fun `a typed body and a spliced body give the same envelope`() {
        val body = JSONObject().put("a", 1)
        assertEquals(
            JsonEnvelope.document("session", body.toString()),
            JsonEnvelope.document("session", body)
        )
    }

    @Test
    fun `an envelope round-trips through parse`() {
        val envelope = JsonEnvelope.parse(
            JsonEnvelope.document("questionnaire", JSONObject().put("n", 2), "r-1")
        )
        assertEquals("questionnaire", envelope.type)
        assertEquals(2, envelope.data?.optInt("n"))
        assertEquals("r-1", envelope.id)
    }

    @Test
    fun `a document without a type is not an envelope`() {
        assertThrows(IllegalArgumentException::class.java) { JsonEnvelope.parse("{\"d\":{}}") }
        assertThrows(IllegalArgumentException::class.java) { JsonEnvelope.parse("[]") }
        // A type with no nested body is a flat page message. Its fields are
        // the body: swallowing them turned every real `ack` and `notice` into
        // a no-op downstream.
        val bare = JsonEnvelope.parse("{\"t\":\"ack\",\"seq\":3}")
        assertEquals(3, bare.data?.optInt("seq"))
        assertEquals("", bare.id)
    }

    @Test
    fun `the page's own field names parse into the same envelope`() {
        // The page authors documents as `{type, data, id}` on its WebSocket;
        // the headset re-emits them as `{t, d, id}` for the tablet. One reader.
        val pageSide = JsonEnvelope.parse("{\"type\":\"log\",\"data\":{\"kind\":\"x\"},\"id\":\"r-1\"}")
        assertEquals("log", pageSide.type)
        assertEquals("x", pageSide.data?.optString("kind"))
        assertEquals("r-1", pageSide.id)

        // The relayed shape is read by the same call.
        val wireSide = JsonEnvelope.parse("{\"t\":\"log\",\"d\":{\"kind\":\"x\"},\"id\":\"r-1\"}")
        // JSONObject has identity equality, so the body is compared as text.
        assertEquals(pageSide.type, wireSide.type)
        assertEquals(pageSide.id, wireSide.id)
        assertEquals(pageSide.data.toString(), wireSide.data.toString())
    }

    @Test
    fun `an empty type or body is refused at construction`() {
        assertThrows(IllegalArgumentException::class.java) { JsonEnvelope.document("", "{}") }
        assertThrows(IllegalArgumentException::class.java) { JsonEnvelope.document("questionnaire-result", " ") }
    }

    @Test
    fun `the envelope stays inside the json channel limit`() {
        // The relay refuses what it cannot chunk; the wrapper must not be the
        // reason a sheet that fit on the page no longer fits on the tablet.
        val sheet = "{\"answers\":[" + (1..100).joinToString(",") { "\"q$it\":${it % 5 + 1}" } + "]}"
        val document = JsonEnvelope.document("questionnaire-result", sheet)
        assertTrue(
            ControlProtocol.fitsJsonChannel(document.toByteArray(Charsets.UTF_8).size),
            "a ${document.length} B envelope must fit the json channel"
        )
    }

    @Test
    fun `the quoted type cannot break out of the envelope`() {
        val document = JsonEnvelope.document("a\"b", "{}")
        assertEquals("a\"b", JSONObject(document).optString("t"))
    }
}
