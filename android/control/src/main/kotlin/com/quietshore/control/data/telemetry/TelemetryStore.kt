package com.quietshore.control.data.telemetry

import android.content.Context
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The outbox on disk, and the device identity the server deduplicates against.
 *
 * Two files, both in the app's own preferences directory:
 *
 *  - **the outbox** — pending records plus retry bookkeeping, re-read on every
 *    operation so a WorkManager job and an in-process upload can never fight
 *    over a cached copy.
 *  - **the device id** — one random UUID, written once, never derived from the
 *    hardware. The endpoint has no account, so this is the only thing that ties
 *    a device's records together, and it must survive every reinstall-free
 *    upgrade.
 *
 * Every read-modify-write runs under one process-wide lock ([LOCK]). The writes
 * are `commit()` rather than `apply()`: a record that was handed to the uploader
 * is not allowed to die with the process before it reaches the disk, which is
 * exactly what makes "offline loses nothing" true.
 *
 * This class is Android-only only because of `Context` and `SharedPreferences`;
 * every rule inside it lives in [Outbox], which is tested on a plain JVM.
 */
class TelemetryStore(context: Context) {

    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    /** The persistent random device id; created on first use. */
    val deviceId: String
        get() = LOCK.withLock {
            preferences.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }
                ?: UUID.randomUUID().toString().also { generated ->
                    preferences.edit().putString(KEY_DEVICE_ID, generated).commit()
                }
        }

    /** The outbox as it is on disk right now. */
    fun read(): Outbox = LOCK.withLock {
        Outbox.fromJson(preferences.getString(KEY_OUTBOX, null))
    }

    /**
     * Applies [transform] to the stored outbox and writes the result back, all
     * under the lock.
     *
     * The transform receives what is on disk, not a snapshot the caller read a
     * moment ago, so two uploads racing each other cannot each write a version
     * that erases the other's enqueued records.
     */
    fun update(transform: (Outbox) -> Outbox): Outbox = LOCK.withLock {
        val current = Outbox.fromJson(preferences.getString(KEY_OUTBOX, null))
        val next = transform(current)
        if (next !== current) {
            preferences.edit().putString(KEY_OUTBOX, next.toJson().toString()).commit()
        }
        next
    }

    /** Queues one record; returns the outbox after the call. */
    fun enqueue(record: TelemetryRecord): Outbox = update { it.enqueue(record).record }

    /** Queues every record that is not already queued or acknowledged. */
    fun enqueueAll(records: Collection<TelemetryRecord>): Outbox =
        update { it.enqueueAll(records).record }

    private companion object {
        /**
         * One lock for the whole process: the ViewModel and the worker share
         * this file, and `SharedPreferences` gives no atomic
         * read-modify-write across its own editors.
         */
        val LOCK = ReentrantLock()

        const val PREFERENCES = "quiet_shore_telemetry"
        const val KEY_OUTBOX = "outbox"
        const val KEY_DEVICE_ID = "device_id"
    }
}
