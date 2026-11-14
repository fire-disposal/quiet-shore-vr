package com.quietshore.control.data.telemetry

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The outbox rules: enqueue once, remove only what was acknowledged, keep
 * everything on failure.
 *
 * These are the acceptance criteria in unit form. Nothing here touches Android,
 * a network, or a clock: `now` is passed in, so the back-off rule is proven
 * without waiting a minute.
 */
class OutboxTest {

    private fun record(
        id: String,
        kind: String = TelemetryKind.EVENT,
        at: Long = 1_700_000_000_000L
    ) = TelemetryRecord.of(id = id, kind = kind, epochMs = at, data = JSONObject().put("n", id))

    @Test
    fun `a record is queued once and a replay is a no-op`() {
        val first = Outbox().enqueue(record("a"))
        assertTrue(first is Outbox.Added)

        val replay = first.record.enqueue(record("a"))

        assertTrue(replay is Outbox.Enqueued, "the same id must not queue twice")
        assertEquals(1, replay.record.size)
    }

    @Test
    fun `only acknowledged ids of the batch leave`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"), record("c"))).record
        val batch = outbox.batch()

        val next = outbox.applyAck(sent = batch, acknowledged = listOf("a", "c"), now = 0L)

        assertEquals(listOf("b"), next.records().map { it.id })
        assertEquals(0, next.stats.attempts, "a drain resets the back-off")
    }

    @Test
    fun `an acknowledgement for a record outside the batch is ignored`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"))).record
        val batch = listOf(outbox.records().first())

        val next = outbox.applyAck(sent = batch, acknowledged = listOf("a", "b"), now = 0L)

        // "b" was never sent in this batch, so the server cannot have stored it
        // on our behalf; only "a" leaves.
        assertEquals(listOf("b"), next.records().map { it.id })
    }

    @Test
    fun `a 200 that acknowledges nothing keeps every record`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"))).record
        val batch = outbox.batch()

        val next = outbox.applyAck(sent = batch, acknowledged = emptyList(), now = 1_000L)

        assertEquals(listOf("a", "b"), next.records().map { it.id })
        assertEquals(1, next.stats.attempts, "an empty ack is a failed attempt")
        assertEquals(1_000L + Outbox.backoffFor(1), next.stats.retryAt)
    }

    @Test
    fun `a failure keeps the batch and pushes the retry out`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"))).record

        val failed = outbox.recordFailure(now = 5_000L)

        assertEquals(1, failed.size)
        assertEquals(1, failed.stats.attempts)
        assertEquals(5_000L + 60_000L, failed.stats.retryAt)
        assertTrue(failed.isCoolingDown(5_001L))
        assertFalse(failed.isCoolingDown(65_000L))
    }

    @Test
    fun `backoff grows and is capped`() {
        assertEquals(60_000L, Outbox.backoffFor(1))
        assertEquals(120_000L, Outbox.backoffFor(2))
        assertEquals(240_000L, Outbox.backoffFor(3))
        assertEquals(Outbox.MAX_BACKOFF_MS, Outbox.backoffFor(12))
    }

    @Test
    fun `an acknowledged id never re-enters from a backfill`() {
        val outbox = Outbox().enqueueAll(listOf(record("a"), record("b"))).record
        val drained = outbox.applyAck(sent = outbox.batch(), acknowledged = listOf("a", "b"), now = 0L)
        assertTrue(drained.isEmpty)

        // A later cold-start backfill sees the same local records again.
        val refilled = drained.enqueue(record("a"))

        assertTrue(refilled is Outbox.Enqueued, "an already-acknowledged id must stay gone")
        assertTrue(refilled.record.isEmpty)
    }

    @Test
    fun `a batch never exceeds the contract`() {
        val many = (1..250).map { record("r$it") }
        val outbox = Outbox(keep = 1_000).enqueueAll(many).record

        assertEquals(Outbox.BATCH_SIZE, outbox.batch().size)
        assertEquals(Outbox.BATCH_SIZE, outbox.batch(size = 5_000).size)
        assertEquals(10, outbox.applyAck(
            sent = outbox.batch(),
            acknowledged = outbox.batch().map { it.id },
            nextBatchSize = 10,
            now = 0L
        ).let { it.batch().size })
    }

    @Test
    fun `the window is bounded and an eviction is counted`() {
        val outbox = Outbox(keep = 3).enqueueAll((1..5).map { record("r$it") }).record

        assertEquals(listOf("r3", "r4", "r5"), outbox.records().map { it.id })
        assertEquals(2, outbox.stats.dropped)
    }

    @Test
    fun `the stored form round-trips including the retry state`() {
        val outbox = Outbox()
            .enqueueAll(listOf(record("a"), record("b")))
            .record
            .recordFailure(now = 10_000L)

        val restored = Outbox.fromJson(outbox.toJson().toString())

        assertEquals(listOf("a", "b"), restored.records().map { it.id })
        assertEquals(1, restored.stats.attempts)
        assertEquals(10_000L + 60_000L, restored.stats.retryAt)
    }

    @Test
    fun `a corrupted store is an empty outbox, not a crash`() {
        assertTrue(Outbox.fromJson("{not json").isEmpty)
        // A body that parses to something other than an object is still empty,
        // not a crash on the way to an upload.
        assertTrue(Outbox.fromJson("[1,2,3]").isEmpty)
        assertTrue(Outbox.fromJson("").isEmpty)
    }

    @Test
    fun `an element without an id is skipped and the rest survive`() {
        val raw = """
            {"version":1,"records":[
              {"id":"a","kind":"event","occurredAt":"2026-11-14T08:31:05.123Z","data":{}},
              {"kind":"event","occurredAt":"2026-11-14T08:31:05.123Z","data":{}},
              {"id":"b","kind":"training","occurredAt":"2026-11-14T09:00:00.000Z","data":{}}
            ]}
        """.trimIndent()

        val outbox = Outbox.fromJson(raw)

        assertEquals(listOf("a", "b"), outbox.records().map { it.id })
    }

    @Test
    fun `an unknown kind is filed as an event, never dropped`() {
        val raw = """
            {"version":1,"records":[
              {"id":"a","kind":"mystery","occurredAt":"2026-11-14T08:31:05.123Z","data":{}}
            ]}
        """.trimIndent()

        assertEquals(TelemetryKind.EVENT, Outbox.fromJson(raw).records().single().kind)
    }
}
