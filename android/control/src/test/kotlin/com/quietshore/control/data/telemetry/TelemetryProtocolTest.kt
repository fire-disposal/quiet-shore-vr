package com.quietshore.control.data.telemetry

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The wire contract: what goes out, and which replies are allowed to remove
 * anything.
 *
 * The response parser is the place a "200 but wrong body" is caught, so most of
 * these cases are malformed or mis-versioned bodies that must come back as
 * [TelemetryProtocol.TelemetryResponse.Failure] rather than as an empty success.
 */
class TelemetryProtocolTest {

    private fun record(id: String) = TelemetryRecord.of(
        id = id,
        kind = TelemetryKind.TRAINING,
        epochMs = 1_700_000_000_123L,
        data = JSONObject().put("at", 1_700_000_000_123L).put("app", "training")
    )

    // ---- request ------------------------------------------------------------

    @Test
    fun `the request carries the contract's four fields and a version`() {
        val body = TelemetryProtocol.encodeBatch("dev-1", listOf(record("training:aa")))

        val parsed = MiniJson.parse(body) as Map<*, *>
        assertEquals(1, (parsed["version"] as Double).toInt())
        assertEquals("dev-1", parsed["deviceId"])
        val records = parsed["records"] as List<*>
        val first = records.single() as Map<*, *>
        assertEquals("training:aa", first["id"])
        assertEquals("training", first["kind"])
        assertEquals("2023-11-14T22:13:20.123Z", first["occurredAt"])
        // `data` must stay an object, not a stringified object.
        assertTrue(first["data"] is Map<*, *>)
        assertEquals("training", (first["data"] as Map<*, *>)["app"])
    }

    @Test
    fun `a data field that needs escaping is emitted as valid json`() {
        val tricky = TelemetryRecord.of(
            id = "event:x",
            kind = TelemetryKind.EVENT,
            epochMs = 1_700_000_000_000L,
            data = JSONObject().put("reason", "say \"hi\"\n\t\\ end")
        )

        val body = TelemetryProtocol.encodeBatch("dev", listOf(tricky))

        // Re-parsing proves the escaper produced valid JSON.
        val parsed = MiniJson.parse(body) as Map<*, *>
        val data = ((parsed["records"] as List<*>).single() as Map<*, *>)["data"] as Map<*, *>
        assertEquals("say \"hi\"\n\t\\ end", data["reason"])
    }

    @Test
    fun `an empty batch still encodes as a valid body`() {
        val body = TelemetryProtocol.encodeBatch("dev", emptyList())
        assertTrue(body.contains("\"records\":[]"))
        assertTrue(MiniJson.parse(body) is Map<*, *>)
    }

    // ---- response -----------------------------------------------------------

    @Test
    fun `a well-formed response is accepted with its counters`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":1,"acknowledged":["a","b"],"accepted":2,"duplicates":0,"nextBatchSize":50}"""
        )

        val success = parsed as TelemetryProtocol.TelemetryResponse.Success
        assertEquals(listOf("a", "b"), success.acknowledged)
        assertEquals(2, success.accepted)
        assertEquals(0, success.duplicates)
        assertEquals(50, success.nextBatchSize)
    }

    @Test
    fun `a wrong version is a failure`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":2,"acknowledged":["a"],"accepted":1,"duplicates":0,"nextBatchSize":100}"""
        )
        assertTrue(parsed is TelemetryProtocol.TelemetryResponse.Failure)
    }

    @Test
    fun `a missing version is a failure`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"acknowledged":["a"],"accepted":1,"duplicates":0,"nextBatchSize":100}"""
        )
        assertTrue(parsed is TelemetryProtocol.TelemetryResponse.Failure)
    }

    @Test
    fun `a response with no acknowledged array is a failure`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":1,"accepted":1,"duplicates":0,"nextBatchSize":100}"""
        )
        assertTrue(parsed is TelemetryProtocol.TelemetryResponse.Failure)
    }

    @Test
    fun `an acknowledged that is not an array is a failure`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":1,"acknowledged":"a","accepted":1,"duplicates":0}"""
        )
        assertTrue(parsed is TelemetryProtocol.TelemetryResponse.Failure)
    }

    @Test
    fun `garbage or an error page is a failure`() {
        assertTrue(TelemetryProtocol.parseResponse("") is TelemetryProtocol.TelemetryResponse.Failure)
        assertTrue(TelemetryProtocol.parseResponse(null) is TelemetryProtocol.TelemetryResponse.Failure)
        assertTrue(
            TelemetryProtocol.parseResponse("<html>502</html>") is
                TelemetryProtocol.TelemetryResponse.Failure
        )
        assertTrue(
            TelemetryProtocol.parseResponse("[]") is TelemetryProtocol.TelemetryResponse.Failure
        )
    }

    @Test
    fun `a missing nextBatchSize falls back to the contract maximum`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":1,"acknowledged":["a"],"accepted":1,"duplicates":0}"""
        )
        val success = parsed as TelemetryProtocol.TelemetryResponse.Success
        assertEquals(TelemetryProtocol.MAX_BATCH, success.nextBatchSize)
    }

    @Test
    fun `an oversized nextBatchSize is clamped to the contract`() {
        val parsed = TelemetryProtocol.parseResponse(
            """{"version":1,"acknowledged":[],"accepted":0,"duplicates":0,"nextBatchSize":100000}"""
        )
        val success = parsed as TelemetryProtocol.TelemetryResponse.Success
        assertEquals(TelemetryProtocol.MAX_BATCH, success.nextBatchSize)
    }

    @Test
    fun `the endpoint is the fixed address in the contract`() {
        assertEquals("https://205716.xyz/vrdata/", TelemetryProtocol.ENDPOINT)
    }
}
