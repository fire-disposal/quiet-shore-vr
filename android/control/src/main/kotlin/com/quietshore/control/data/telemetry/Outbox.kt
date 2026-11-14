package com.quietshore.control.data.telemetry

import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the uploader decides, with no Android and no network in it.
 *
 * The three rules that matter are all here so they can be proven without a
 * device:
 *
 *  - **A record is enqueued once.** [enqueue] detects the same
 *    [TelemetryRecord.id] arriving again — a re-sent BLE frame, a backfill that
 *    runs on every launch — and reports [Enqueued] instead of doubling the queue.
 *  - **Only what the server acknowledged leaves.** [applyAck] removes the
 *    intersection of the batch just sent and the ids the response named *and*
 *    that belong to that batch. A 200 with an empty or foreign `acknowledged`
 *    list therefore keeps every record: the failure mode that silently drops an
 *    observation set is a bug this type exists to make impossible.
 *  - **A failed send changes nothing but the retry bookkeeping.** [recordFailure]
 *    keeps every id and only pushes the next attempt out, so a night offline
 *    costs latency, not observations.
 *
 * The queue is bounded ([MAX_RECORDS], oldest first out): a device that never
 * reaches the network must not fill its preferences file. Eviction is counted so
 * the loss shows up in [Stats.dropped] instead of being silent.
 */
class Outbox(
    records: List<TelemetryRecord> = emptyList(),
    private val acknowledgedIds: Set<String> = emptySet(),
    private val attempts: Int = 0,
    private val retryAt: Long = 0L,
    private val dropped: Int = 0,
    /** The server's own `nextBatchSize`, honoured on the next batch. */
    private val serverBatchSize: Int = BATCH_SIZE,
    private val keep: Int = MAX_RECORDS
) {
    /** Pending records, oldest first. */
    private val pending: LinkedHashMap<String, TelemetryRecord> =
        LinkedHashMap<String, TelemetryRecord>().apply {
            for (record in records) {
                putIfAbsent(record.id, record)
            }
        }

    val size: Int get() = pending.size

    val isEmpty: Boolean get() = pending.isEmpty()

    /** Pending records in enqueue order; the batch window is a slice of this. */
    fun records(): List<TelemetryRecord> = pending.values.toList()

    /** What the uploader reports and what a test asserts against. */
    data class Stats(
        val pending: Int,
        val attempts: Int,
        val retryAt: Long,
        val dropped: Int
    )

    val stats: Stats get() = Stats(pending.size, attempts, retryAt, dropped)

    /** Outcome of [enqueue]; [record] is the state after the call. */
    sealed interface Outcome {
        val record: Outbox
    }

    /** A new id; the queue grew by one unless the window evicted its head. */
    data class Added(override val record: Outbox) : Outcome

    /** The id is already queued or already acknowledged; nothing changed. */
    data class Enqueued(override val record: Outbox) : Outcome

    /**
     * Queues [record] unless it is already waiting or already acknowledged.
     *
     * "Already acknowledged" matters as much as "already queued": a backfill of
     * pre-existing local records must not resurrect a record the server already
     * has, or every launch would re-upload the same window once the queue empties.
     */
    fun enqueue(record: TelemetryRecord): Outcome {
        if (record.id in acknowledgedIds || record.id in pending) {
            return Enqueued(this)
        }
        val next = LinkedHashMap(pending)
        next[record.id] = record
        var evicted = 0
        while (next.size > keep) {
            next.remove(next.keys.first())
            evicted++
        }
        return Added(
            Outbox(
                records = next.values.toList(),
                acknowledgedIds = acknowledgedIds,
                attempts = attempts,
                retryAt = retryAt,
                dropped = dropped + evicted,
                serverBatchSize = serverBatchSize,
                keep = keep
            )
        )
    }

    /** Queues every record that is not already waiting or acknowledged. */
    fun enqueueAll(records: Collection<TelemetryRecord>): Outcome {
        var current: Outbox = this
        var added = false
        for (record in records) {
            when (val outcome = current.enqueue(record)) {
                is Added -> {
                    current = outcome.record
                    added = true
                }
                is Enqueued -> Unit
            }
        }
        return if (added) Added(current) else Enqueued(this)
    }

    /**
     * The next batch: at most [size] pending records, oldest first.
     *
     * The limit is the caller's wish clamped by the server's last hint and by
     * the contract ceiling, so a server that asks for smaller batches gets them.
     */
    fun batch(size: Int = BATCH_SIZE): List<TelemetryRecord> =
        pending.values.take(effectiveBatchSize(size, serverBatchSize))

    /** True when the retry window has not elapsed yet. */
    fun isCoolingDown(now: Long): Boolean = attempts > 0 && now < retryAt

    /** When the next attempt may run; 0 when there is nothing to wait for. */
    val nextAttemptAt: Long get() = retryAt

    /**
     * Applies one successful response to the batch that produced it.
     *
     * [sent] is the batch exactly as posted; `acknowledged` is the response's
     * list. Only ids that are in both are removed. A response that acknowledges
     * nothing in this batch is treated as a failed send rather than a success,
     * so a hung or lying server costs a retry, never the data.
     */
    fun applyAck(
        sent: List<TelemetryRecord>,
        acknowledged: Collection<String>,
        nextBatchSize: Int = BATCH_SIZE,
        now: Long = System.currentTimeMillis()
    ): Outbox {
        val sentIds = sent.mapTo(HashSet()) { it.id }
        val acked = acknowledged.filterTo(LinkedHashSet()) { it in sentIds }
        if (acked.isEmpty()) {
            return recordFailure(now)
        }
        val next = LinkedHashMap(pending)
        for (id in acked) {
            next.remove(id)
        }
        val drained = next.isEmpty()
        return Outbox(
            records = next.values.toList(),
            acknowledgedIds = trimAcknowledged(acknowledgedIds + acked),
            // A drained queue forgets its backoff: the next record is a fresh
            // start, not the tail of an old back-off.
            attempts = if (drained) 0 else attempts,
            retryAt = if (drained) 0L else retryAt,
            dropped = dropped,
            serverBatchSize = nextBatchSize.coerceIn(1, BATCH_SIZE),
            keep = keep
        )
    }

    /**
     * Records one failed attempt.
     *
     * Every pending record is kept. [attempts] drives the backoff, which is
     * deliberately simple and monotonic: 1 min, 2, 4, 8, … capped at
     * [MAX_BACKOFF_MS]. A drain resets it, so one offline night does not slow
     * every later upload forever.
     */
    fun recordFailure(now: Long): Outbox = Outbox(
        records = pending.values.toList(),
        acknowledgedIds = acknowledgedIds,
        attempts = attempts + 1,
        retryAt = now + backoffFor(attempts + 1),
        dropped = dropped,
        serverBatchSize = serverBatchSize,
        keep = keep
    )

    /** The stored form: pending records plus the retry bookkeeping. */
    fun toJson(): JSONObject {
        val array = JSONArray()
        for (record in pending.values) {
            array.put(record.toJson())
        }
        return JSONObject()
            .put("version", OUTBOX_VERSION)
            .put("records", array)
            .put("acknowledged", JSONArray(acknowledgedIds.toList()))
            .put("attempts", attempts)
            .put("retryAt", retryAt)
            .put("dropped", dropped)
            .put("nextBatchSize", serverBatchSize)
    }

    companion object {
        /** Wire contract: the client never sends more than this per request. */
        const val BATCH_SIZE: Int = 100

        /** How many records the outbox holds before the oldest falls off. */
        const val MAX_RECORDS: Int = 2_000

        /** How many acknowledged ids are remembered, so a backfill cannot resurrect one. */
        const val ACKNOWLEDGED_MEMORY: Int = 4_000

        const val OUTBOX_VERSION: Int = 1

        const val MAX_BACKOFF_MS: Long = 30L * 60L * 1000L

        /** 1, 2, 4, 8, 16, 32 minutes — capped at [MAX_BACKOFF_MS]. */
        fun backoffFor(attempts: Int): Long {
            val minutes = 1L shl (attempts.coerceIn(1, 6) - 1)
            return (minutes * 60_000L).coerceAtMost(MAX_BACKOFF_MS)
        }

        /** The batch size to actually use, given the caller's wish and the server's hint. */
        fun effectiveBatchSize(size: Int, nextBatchSize: Int): Int =
            minOf(size.coerceAtLeast(1), nextBatchSize.coerceAtLeast(1), BATCH_SIZE)

        /** Keeps the acknowledged memory bounded; the oldest ids fall off first. */
        private fun trimAcknowledged(ids: Set<String>): Set<String> {
            if (ids.size <= ACKNOWLEDGED_MEMORY) {
                return ids
            }
            return ids.toList().takeLast(ACKNOWLEDGED_MEMORY).toCollection(LinkedHashSet())
        }

        /** Reads the stored form; anything unreadable is an empty outbox. */
        fun fromJson(raw: String?): Outbox {
            if (raw.isNullOrBlank()) {
                return Outbox()
            }
            return try {
                val json = JSONObject(raw)
                val array = json.optJSONArray("records") ?: JSONArray()
                val records = buildList {
                    for (index in 0 until array.length()) {
                        array.optJSONObject(index)?.let(TelemetryRecord::fromJson)?.let(::add)
                    }
                }
                val ackArray = json.optJSONArray("acknowledged") ?: JSONArray()
                val acknowledged = buildSet {
                    for (index in 0 until ackArray.length()) {
                        ackArray.optString(index).takeIf { it.isNotEmpty() }?.let(::add)
                    }
                }
                Outbox(
                    records = records,
                    acknowledgedIds = acknowledged,
                    attempts = json.optInt("attempts", 0).coerceAtLeast(0),
                    retryAt = json.optLong("retryAt", 0L).coerceAtLeast(0L),
                    dropped = json.optInt("dropped", 0).coerceAtLeast(0),
                    serverBatchSize = json.optInt("nextBatchSize", BATCH_SIZE)
                        .coerceIn(1, BATCH_SIZE)
                )
            } catch (error: Exception) {
                Outbox()
            }
        }
    }
}
