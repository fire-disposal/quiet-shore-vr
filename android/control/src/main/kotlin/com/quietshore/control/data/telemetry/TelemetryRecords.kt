package com.quietshore.control.data.telemetry

import com.quietshore.control.data.ExperienceCodec
import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.protocol.QuestionnaireResult
import com.quietshore.control.protocol.QuestionnaireResultCodec
import org.json.JSONObject
import java.security.MessageDigest

/**
 * The four local record kinds, translated into the one wire form.
 *
 * Each builder is pure: a store hands over what it already keeps, and the result
 * either names a stable id or is dropped. The ids are the whole reason this file
 * exists, so they are spelled out once here rather than at four call sites.
 *
 * **Every id is `<family>:<sha256 of the record's own stable key>`.** Hashing is
 * not decoration: the contract allows `[A-Za-z0-9._:-]{1,128}`, and the sources
 * are not all safe — a questionnaire key contains a unit separator, a training
 * stamp is fine but a page-supplied event id is arbitrary text. Hashing makes
 * every family match the shape by construction and caps the length, while the
 * prefix keeps the four families disjoint on the server.
 *
 * The *input* to the hash is the record's natural key, which is what makes
 * re-sending the same record collapse:
 *
 *  - **questionnaire** — [QuestionnaireResult.key], the tablet's own identity for
 *    "one filed sheet", so a replayed BLE frame is one record.
 *  - **training** — the page's session stamp (`at`), which the store itself uses
 *    to collapse a re-sent summary.
 *  - **experience** — the record's `id`, the millisecond the form was opened, the
 *    same key the store uses to replace on a re-save.
 *  - **event** — the event's own `id` when the page gave one, otherwise the whole
 *    stored record. Note this is the *only* family that hashes its payload: an
 *    event with no id has no other stable identity, and every store-written
 *    event field is machine facts, not free text.
 */
object TelemetryRecords {

    /** Keeps the four id spaces disjoint; the colon is inside the allowed set. */
    private const val QUESTIONNAIRE_PREFIX = "questionnaire:"
    private const val TRAINING_PREFIX = "training:"
    private const val EXPERIENCE_PREFIX = "experience:"
    private const val EVENT_PREFIX = "event:"

    /** One filed questionnaire sheet. */
    fun questionnaire(result: QuestionnaireResult): TelemetryRecord = TelemetryRecord.of(
        id = QUESTIONNAIRE_PREFIX + sha256Of(result.key),
        kind = TelemetryKind.QUESTIONNAIRE,
        epochMs = result.completedAt,
        data = QuestionnaireResultCodec.encode(result)
    )

    /** One finished training session, exactly as the page summarised it. */
    fun training(raw: JSONObject): TelemetryRecord? {
        val stamp = raw.optLong("at", 0L)
        if (stamp <= 0L) {
            return null
        }
        return TelemetryRecord.of(
            id = TRAINING_PREFIX + sha256Of(stamp.toString()),
            kind = TelemetryKind.TRAINING,
            epochMs = stamp,
            data = JSONObject(raw.toString()).put("app", "training")
        )
    }

    /** One 体验 observation. */
    fun experience(record: ExperienceRecord): TelemetryRecord? {
        if (record.id <= 0L) {
            return null
        }
        return TelemetryRecord.of(
            id = EXPERIENCE_PREFIX + sha256Of(record.id.toString()),
            kind = TelemetryKind.EXPERIENCE,
            epochMs = record.at.coerceAtLeast(record.id),
            data = ExperienceCodec.encode(record)
        )
    }

    /**
     * One behaviour event.
     *
     * The event log is the noisy kind, so it is the one that needs a guaranteed
     * stable id: the page's `d.id` when it supplied one, else a digest of the
     * whole stored record. Hashing the stored record rather than regenerating it
     * from live state means the id survives being read back off disk.
     */
    fun event(raw: JSONObject, fallbackId: String? = null): TelemetryRecord {
        val supplied = raw.optJSONObject("d")?.optString("id")?.takeIf { it.isNotEmpty() }
            ?: fallbackId?.takeIf { it.isNotEmpty() }
        return TelemetryRecord.of(
            id = EVENT_PREFIX + sha256Of(supplied ?: raw.toString()),
            kind = TelemetryKind.EVENT,
            epochMs = raw.optLong("at", 0L),
            data = JSONObject(raw.toString())
        )
    }

    /**
     * Everything a store already holds that the server has not seen.
     *
     * Used for the backfill of records written before this uploader existed.
     * [Outbox.enqueueAll] drops ids that are queued or already acknowledged, so
     * running the backfill on every cold start re-adds nothing — the local
     * stores are the durable copy and the outbox is only the window of what is
     * still unsent. Oldest first, so a first upload reads as a timeline instead
     * of four interleaved blocks.
     */
    fun backfill(
        questionnaires: List<QuestionnaireResult> = emptyList(),
        training: List<JSONObject> = emptyList(),
        experiences: List<ExperienceRecord> = emptyList(),
        events: List<JSONObject> = emptyList()
    ): List<TelemetryRecord> = buildList {
        questionnaires.mapTo(this) { questionnaire(it) }
        training.mapNotNullTo(this) { training(it) }
        experiences.mapNotNullTo(this) { experience(it) }
        events.mapTo(this) { event(it) }
    }.sortedBy { it.occurredAtMillis }

    /** Lowercase hex SHA-256; the only hashing this app does. */
    fun sha256Of(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        val builder = StringBuilder(digest.size * 2)
        for (byte in digest) {
            builder.append(HEX[(byte.toInt() shr 4) and 0x0F])
            builder.append(HEX[byte.toInt() and 0x0F])
        }
        return builder.toString()
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
