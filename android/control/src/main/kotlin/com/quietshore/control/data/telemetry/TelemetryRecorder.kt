package com.quietshore.control.data.telemetry

import android.content.Context
import android.util.Log
import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.protocol.QuestionnaireResult
import org.json.JSONObject

/**
 * The seam between the app's record stores and the upload path.
 *
 * Every place that already writes a record — a filed sheet, a finished session,
 * a saved 体验 sheet, a behaviour event — calls one of the `record…` methods. Each
 * call does the same two things in the same order: **write the record to the
 * durable outbox first**, then ask for an upload. If the upload ask fails, is
 * coalesced away, or never runs because the tablet is offline, the record is
 * already on disk and the periodic drain will carry it.
 *
 * Nothing here throws into the caller. The record stores work synchronously on
 * the BLE callback thread and on the UI thread, and a telemetry fault must never
 * turn a satisfied patient's questionnaire into a crash — so every failure is
 * logged and swallowed, and the local record stays authoritative either way.
 */
class TelemetryRecorder(context: Context) {

    private val applicationContext = context.applicationContext
    private val store = TelemetryStore(applicationContext)

    /**
     * Installs the cycles and backfills anything already on the tablet.
     *
     * Call once at process start. The backfill is what makes the pre-existing
     * local history reach the server at all; it is idempotent by construction
     * ([Outbox.enqueueAll] drops queued and acknowledged ids), so running it on
     * every cold start re-adds nothing.
     */
    fun start(
        questionnaires: List<QuestionnaireResult>,
        training: List<JSONObject>,
        experiences: List<ExperienceRecord>,
        events: List<JSONObject>
    ) {
        runCatching {
            TelemetryScheduler.ensurePeriodic(applicationContext)
            backfill(questionnaires, training, experiences, events)
            if (!store.read().isEmpty) {
                TelemetryScheduler.requestUpload(applicationContext)
            }
        }.onFailure { Log.w(TAG, "telemetry start failed: ${it.message}") }
    }

    /** Queues whatever the local stores hold and the server has not seen. */
    fun backfill(
        questionnaires: List<QuestionnaireResult> = emptyList(),
        training: List<JSONObject> = emptyList(),
        experiences: List<ExperienceRecord> = emptyList(),
        events: List<JSONObject> = emptyList()
    ) {
        runCatching {
            val records = TelemetryRecords.backfill(questionnaires, training, experiences, events)
            if (records.isNotEmpty()) {
                store.enqueueAll(records)
                Log.i(TAG, "backfilled ${records.size} local records")
            }
        }.onFailure { Log.w(TAG, "telemetry backfill failed: ${it.message}") }
    }

    /**
     * One filed questionnaire sheet.
     *
     * The caller only reaches this for a genuinely new sheet — the store already
     * collapsed the replay — but the outbox collapses it again by the same id,
     * so a re-send between the two checks still costs one record.
     */
    fun recordQuestionnaire(result: QuestionnaireResult) {
        enqueue(runCatching { TelemetryRecords.questionnaire(result) }.getOrNull())
    }

    /** One finished training session. */
    fun recordTraining(raw: JSONObject) {
        enqueue(TelemetryRecords.training(raw))
    }

    /** One saved 体验 sheet. */
    fun recordExperience(record: ExperienceRecord) {
        enqueue(TelemetryRecords.experience(record))
    }

    /**
     * One behaviour event.
     *
     * [stored] is the record as the event log actually wrote it (its `at` and
     * `d` already normalised), which is what the hash-based id must be computed
     * from — a rebuild from live state would produce a different id for the same
     * event on the next pass.
     */
    fun recordEvent(stored: JSONObject?, fallbackId: String? = null) {
        if (stored == null) {
            return
        }
        enqueue(TelemetryRecords.event(stored, fallbackId))
    }
    private fun enqueue(record: TelemetryRecord?) {
        if (record == null) {
            return
        }
        runCatching {
            store.enqueue(record)
            TelemetryScheduler.requestUpload(applicationContext)
        }.onFailure { Log.w(TAG, "telemetry enqueue failed for ${record.id}: ${it.message}") }
    }

    private companion object {
        const val TAG = "QuietShoreTelemetry"
    }
}
