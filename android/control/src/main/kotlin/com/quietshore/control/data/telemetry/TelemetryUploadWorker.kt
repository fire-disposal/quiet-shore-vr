package com.quietshore.control.data.telemetry

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * The upload pass, run by WorkManager.
 *
 * Three triggers, one worker, and only one request of each kind in the system
 * queue: a 15-minute periodic drain, a one-shot for an app launch, and a
 * one-shot for a record that just arrived. The uniqueness is what keeps them
 * from overlapping — with `KEEP`/`APPEND_OR_REPLACE` there is never a second
 * copy of the same work name waiting, so a burst of new records produces one
 * pending upload rather than a queue of identical ones.
 *
 * The worker itself is deliberately thin: it runs [TelemetryUploader.send], which
 * is single-flight per process as well, and reports a retry when the batch could
 * not leave. `Result.failure` is never returned: a record that cannot be
 * uploaded is not a reason to stop trying.
 */
class TelemetryUploadWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): ListenableWorker.Result {
        val uploader = TelemetryUploader(applicationContext)
        return when (val outcome = uploader.send()) {
            is TelemetryUploader.Outcome.Sent -> {
                Log.i(
                    TELEMETRY_TAG,
                    "uploaded ${outcome.acknowledged} (accepted ${outcome.accepted}, " +
                        "duplicates ${outcome.duplicates}), ${outcome.remaining} left"
                )
                ListenableWorker.Result.success()
            }
            is TelemetryUploader.Outcome.Busy -> ListenableWorker.Result.success()
            is TelemetryUploader.Outcome.Skipped -> ListenableWorker.Result.success()
            is TelemetryUploader.Outcome.Failed -> {
                Log.w(TELEMETRY_TAG, "upload failed, ${outcome.kept} kept: ${outcome.reason}")
                ListenableWorker.Result.retry()
            }
        }
    }

    companion object {
        const val TELEMETRY_TAG = "QuietShoreTelemetry"

        /** The periodic drain's name; uniqueness is what bounds it to one. */
        const val PERIODIC_WORK: String = "quiet-shore-telemetry-periodic"

        /** The launch/drain-now one-shot's name. */
        const val ONESHOT_WORK: String = "quiet-shore-telemetry-oneshot"

        /** The contract's cycle. */
        val PERIOD_MS: Long = TimeUnit.MINUTES.toMillis(15)
    }
}

/**
 * Registration of the three triggers.
 *
 * Every entry point is safe to call repeatedly — on every launch, on every new
 * record — because each one either keeps the existing request or replaces it in
 * place. Nothing here is a setting: the endpoint is fixed, the interval is the
 * contract's, and there is no UI for any of it.
 */
object TelemetryScheduler {

    /** Network connectivity only: the endpoint is HTTPS, there is no metered choice. */
    private val CONSTRAINTS: Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /**
     * Installs the periodic drain.
     *
     * `KEEP` rather than `UPDATE`: the interval never changes, so replacing the
     * enqueued request would only move the next run further out every launch.
     */
    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<TelemetryUploadWorker>(
            TelemetryUploadWorker.PERIOD_MS,
            TimeUnit.MILLISECONDS
        )
            .setConstraints(CONSTRAINTS)
            .addTag(TelemetryUploadWorker.TELEMETRY_TAG)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            TelemetryUploadWorker.PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    /**
     * Asks for a pass now.
     *
     * `APPEND_OR_REPLACE` against the one-shot name: while one drain-now is
     * waiting, another record only needs the one already queued — it will read
     * the outbox when it runs and see every record enqueued before it. A chain
     * that somehow failed is replaced instead of blocking every later trigger.
     */
    fun requestUpload(context: Context) {
        val request = OneTimeWorkRequestBuilder<TelemetryUploadWorker>()
            .setConstraints(CONSTRAINTS)
            .addTag(TelemetryUploadWorker.TELEMETRY_TAG)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            TelemetryUploadWorker.ONESHOT_WORK,
            // One worker reads the current outbox when it runs. Appending a new
            // copy per event turned a busy session into hundreds of no-op jobs
            // ahead of the next real upload.
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    /** Both halves, as an app or a new record needs them. */
    fun ensureScheduled(context: Context) {
        ensurePeriodic(context)
        requestUpload(context)
    }

    /** Cancels every upload; used only by tests and by a manual reset. */
    fun cancelAll(context: Context) {
        WorkManager.getInstance(context.applicationContext).apply {
            cancelUniqueWork(TelemetryUploadWorker.PERIODIC_WORK)
            cancelUniqueWork(TelemetryUploadWorker.ONESHOT_WORK)
        }
    }
}
