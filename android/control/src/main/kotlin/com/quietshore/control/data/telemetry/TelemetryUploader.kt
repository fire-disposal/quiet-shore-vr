package com.quietshore.control.data.telemetry

import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One upload pass: take the pending window, post it, apply exactly what came
 * back.
 *
 * This is the only place the outbox, the client and the wire contract meet, and
 * it is deliberately synchronous so it can run identically inside the
 * WorkManager job and on the ViewModel's IO dispatcher. There is no retry queue
 * here: a pass either puts the batch on the way and removes the acknowledged
 * ids, or it records one failure and leaves the batch alone.
 *
 * **[send] is single-flight per process.** A 15-minute cycle, a launch trigger
 * and a new-record trigger can all fire at once; without the guard they would
 * post the same pending window twice, doubling traffic on a ward link and —
 * worse — each writing an outbox state derived from a snapshot the other one
 * had already changed. A loser of the race is a no-op: its records are already
 * in the outbox and the winning pass will carry them.
 */
class TelemetryUploader(
    context: Context,
    private val store: TelemetryStore = TelemetryStore(context),
    private val client: TelemetryClient = TelemetryClient()
) {
    /** What one pass did; callers log it, nothing else depends on it. */
    sealed interface Outcome {
        /** A pass is already running in this process. */
        data object Busy : Outcome

        /** Nothing queued, or a back-off still running. Records stay queued. */
        data class Skipped(val pending: Int, val retryInMs: Long) : Outcome

        /** The batch was acknowledged; only the named ids left the outbox. */
        data class Sent(
            val acknowledged: Int,
            val remaining: Int,
            val accepted: Int,
            val duplicates: Int
        ) : Outcome

        /** The attempt failed; every record of the batch is still queued. */
        data class Failed(val kept: Int, val reason: String) : Outcome
    }

    /**
     * One attempt; [now] is injectable so the back-off rule is testable without
     * waiting a minute.
     */
    fun send(now: Long = System.currentTimeMillis()): Outcome {
        if (!IN_FLIGHT.compareAndSet(false, true)) {
            return Outcome.Busy
        }
        return try {
            val outbox = store.read()
            if (outbox.isEmpty) {
                return Outcome.Skipped(pending = 0, retryInMs = 0L)
            }
            if (outbox.isCoolingDown(now)) {
                return Outcome.Skipped(
                    pending = outbox.size,
                    retryInMs = (outbox.nextAttemptAt - now).coerceAtLeast(0L)
                )
            }
            val batch = outbox.batch()
            if (batch.isEmpty()) {
                return Outcome.Skipped(pending = 0, retryInMs = 0L)
            }
            when (val result = client.post(store.deviceId, batch)) {
                is TelemetryClient.Result.Acknowledged -> applyAck(batch, result.response, now)
                is TelemetryClient.Result.Failed -> fail(batch, result.reason, now)
            }
        } finally {
            IN_FLIGHT.set(false)
        }
    }

    private fun applyAck(
        batch: List<TelemetryRecord>,
        response: TelemetryProtocol.TelemetryResponse.Success,
        now: Long
    ): Outcome {
        // The response is only allowed to speak for records it was sent. An
        // id that is not in this batch is ignored by `applyAck`; here it also
        // means the server answered something we did not ask, which is a failed
        // send, not a reason to clear the queue.
        val sentIds = batch.mapTo(HashSet()) { it.id }
        val ackedInBatch = response.acknowledged.count { it in sentIds }
        if (ackedInBatch == 0) {
            return fail(batch, "no record of the batch acknowledged", now)
        }
        val next = store.update {
            it.applyAck(
                sent = batch,
                acknowledged = response.acknowledged,
                nextBatchSize = response.nextBatchSize,
                now = now
            )
        }
        return Outcome.Sent(
            acknowledged = ackedInBatch,
            remaining = next.size,
            accepted = response.accepted,
            duplicates = response.duplicates
        )
    }

    private fun fail(batch: List<TelemetryRecord>, reason: String, now: Long): Outcome {
        val next = store.update { it.recordFailure(now) }
        Log.w(TAG, "telemetry upload failed (${batch.size} kept): $reason")
        return Outcome.Failed(kept = next.size.coerceAtLeast(batch.size), reason = reason)
    }

    /** Queues one already-built record and returns the outbox after the write. */
    fun enqueue(record: TelemetryRecord): Outbox = store.enqueue(record)

    /** Queues a batch of records in one write. */
    fun enqueueAll(records: Collection<TelemetryRecord>): Outbox = store.enqueueAll(records)

    /** How many records are waiting; used only to decide whether to schedule. */
    fun pending(): Int = store.read().size

    private companion object {
        const val TAG = "QuietShoreTelemetry"

        /** Set while a pass is running; the losers of the race are no-ops. */
        val IN_FLIGHT = AtomicBoolean(false)
    }
}
