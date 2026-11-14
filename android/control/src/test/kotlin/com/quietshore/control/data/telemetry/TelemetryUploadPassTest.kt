package com.quietshore.control.data.telemetry

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The upload pass, end to end, against a fake endpoint.
 *
 * [TelemetryClient] is the only class allowed to touch the network, and it is
 * final by design; the pass is therefore exercised here through the same
 * [Outbox] transitions the worker performs, with the network step replaced by a
 * function. No test in this file reaches the internet.
 */
class TelemetryUploadPassTest {

    private fun record(id: String) =
        TelemetryRecord.of(id = id, kind = TelemetryKind.EVENT, epochMs = 1_000L, data = JSONObject())

    /** One simulated pass, mirroring [TelemetryUploader.send]. */
    private fun pass(
        outbox: Outbox,
        now: Long,
        reply: (List<TelemetryRecord>) -> TelemetryClient.Result
    ): Pair<Outbox, String> {
        if (outbox.isEmpty) {
            return outbox to "skipped"
        }
        if (outbox.isCoolingDown(now)) {
            return outbox to "cooling"
        }
        val batch = outbox.batch()
        return when (val result = reply(batch)) {
            is TelemetryClient.Result.Acknowledged -> {
                val sentIds = batch.mapTo(HashSet()) { it.id }
                if (result.response.acknowledged.none { it in sentIds }) {
                    outbox.recordFailure(now) to "failed"
                } else {
                    outbox.applyAck(
                        sent = batch,
                        acknowledged = result.response.acknowledged,
                        nextBatchSize = result.response.nextBatchSize,
                        now = now
                    ) to "sent"
                }
            }
            is TelemetryClient.Result.Failed -> outbox.recordFailure(now) to "failed"
        }
    }

    private fun ok(vararg acknowledged: String) = TelemetryClient.Result.Acknowledged(
        TelemetryProtocol.TelemetryResponse.Success(
            acknowledged = acknowledged.toList(),
            accepted = acknowledged.size,
            duplicates = 0,
            nextBatchSize = 100
        )
    )

    private val offline = TelemetryClient.Result.Failed("no route to host")

    @Test
    fun `offline records are kept and upload only after the link returns`() {
        var outbox = Outbox().enqueueAll(listOf(record("a"), record("b"))).record

        val (afterFirst, state) = pass(outbox, now = 0L) { offline }
        assertEquals("failed", state)
        assertEquals(2, afterFirst.size)

        // Still cooling down a second later: nothing is attempted.
        val (afterRetryWindow, cooled) = pass(afterFirst, now = 30_000L) { offline }
        assertEquals("cooling", cooled)
        assertEquals(2, afterRetryWindow.size)

        // Past the minute: the same two records go, and only they leave.
        val (drained, recovered) = pass(afterFirst, now = 61_000L) { ok("a", "b") }
        assertEquals("sent", recovered)
        assertTrue(drained.isEmpty)
    }

    @Test
    fun `a partial acknowledgement leaves the rest queued`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"), record("c"))).record

        val (next, state) = pass(outbox, now = 0L) { ok("a", "c") }

        assertEquals("sent", state)
        assertEquals(listOf("b"), next.records().map { it.id })
    }

    @Test
    fun `a 200 naming nothing in the batch does not clear the queue`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"))).record

        val (next, state) = pass(outbox, now = 0L) { ok("z") }

        assertEquals("failed", state)
        assertEquals(listOf("a", "b"), next.records().map { it.id })
        assertEquals(1, next.stats.attempts)
    }

    @Test
    fun `records filed during a run are not lost when the batch is acknowledged`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"))).record
        val batch = outbox.batch()

        // "b" arrives while the request is in flight, after the batch was taken.
        val withNewRecord = outbox.enqueue(record("b")).record
        val next = withNewRecord.applyAck(
            sent = batch,
            acknowledged = listOf("a"),
            now = 0L
        )

        assertEquals(listOf("b"), next.records().map { it.id })
    }

    @Test
    fun `an acknowledged record is never sent again on a later pass`() {
        var outbox = Outbox().enqueueAll(listOf(record("a"))).record
        outbox = pass(outbox, now = 0L) { ok("a") }.first
        assertTrue(outbox.isEmpty)

        var sent = 0
        val (_, state) = pass(outbox, now = 1L) { batch ->
            sent += batch.size
            ok("a")
        }

        assertEquals(0, sent)
        assertEquals("skipped", state)
    }

    @Test
    fun `more than one batch drains over several passes`() {
        var outbox = Outbox(keep = 1_000)
            .enqueueAll((1..250).map { record("r$it") })
            .record
        var passes = 0

        while (!outbox.isEmpty && passes < 10) {
            val (next, state) = pass(outbox, now = passes * 1_000L) { batch ->
                ok(*batch.map { it.id }.toTypedArray())
            }
            assertEquals("sent", state)
            outbox = next
            passes++
        }

        assertEquals(3, passes, "250 records at 100 per batch is three passes")
        assertTrue(outbox.isEmpty)
    }

    @Test
    fun `a drained queue forgets the backoff`() {
        var outbox = Outbox().enqueueAll(listOf(record("a"))).record
        outbox = outbox.recordFailure(now = 0L)
        outbox = outbox.recordFailure(now = 0L)
        assertEquals(2, outbox.stats.attempts)

        outbox = pass(outbox, now = 600_000L) { ok("a") }.first
        assertTrue(outbox.isEmpty)
        assertEquals(0, outbox.stats.attempts)
        assertFalse(outbox.isCoolingDown(600_000L))
    }
}
