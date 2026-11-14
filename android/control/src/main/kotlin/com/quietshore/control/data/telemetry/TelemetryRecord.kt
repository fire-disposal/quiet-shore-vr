package com.quietshore.control.data.telemetry

import org.json.JSONObject

/**
 * One record on its way to the aggregation endpoint.
 *
 * The tablet is a controller for a clinical trial; the records it already keeps
 * locally — questionnaire sheets, training sessions, 体验 observations, and the
 * behaviour log — are the only data that answers "did this work". This class is
 * their one wire form, so the uploader never has to know which store a record
 * came out of.
 *
 * [id] is the whole idempotency story. It is derived from facts both ends
 * already agree on (a record's own stable key, family prefix included, hashed
 * with SHA-256), never from the outbox's position, so the same record enqueued
 * twice, or uploaded again after a lost response, is collapsed by the server
 * instead of duplicated in the dataset. It carries no free text — [data] does —
 * and it matches the contract's `[A-Za-z0-9._:-]{1,128}`.
 *
 * [occurredAt] is the instant as ISO-8601 UTC (`2026-11-14T08:31:05.123Z`). The
 * local stores keep epoch millis; the conversion happens once, in
 * [TelemetryTime], so no time zone of the tablet ever reaches the wire.
 */
data class TelemetryRecord(
    /** Stable, server-deduplicating identity. Never empty, never free text. */
    val id: String,
    /** One of [TelemetryKind]; the server files the record by it. */
    val kind: String,
    /** When it happened, ISO-8601 UTC. */
    val occurredAt: String,
    /** The record itself, complete and unmodified. */
    val data: JSONObject
) {
    /** The wire form: `{id, kind, occurredAt, data}`. */
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("kind", kind)
        .put("occurredAt", occurredAt)
        .put("data", data)

    /** Ordering key for the local queue; a record with no stamp sorts first. */
    val occurredAtMillis: Long
        get() = TelemetryTime.parseIsoUtc(occurredAt) ?: 0L

    companion object {
        /**
         * Builds one record, normalising the contract's two shape rules.
         *
         * [epochMs] is what the local store stamped; it is converted here so no
         * caller has to format a date.
         */
        fun of(id: String, kind: String, epochMs: Long, data: JSONObject): TelemetryRecord =
            TelemetryRecord(
                id = id,
                kind = TelemetryKind.normalize(kind),
                occurredAt = TelemetryTime.isoUtc(epochMs),
                data = data
            )

        /**
         * Reads one record back off the outbox file.
         *
         * Null for anything that cannot identify itself: a record with no id
         * cannot be acknowledged, and one with an unreadable kind is filed as
         * [TelemetryKind.EVENT] rather than thrown away. A corrupt element costs
         * that element only, exactly as the other local stores behave.
         */
        fun fromJson(json: JSONObject): TelemetryRecord? {
            val id = json.optString("id").trim()
            if (id.isEmpty()) {
                return null
            }
            return TelemetryRecord(
                id = id,
                kind = TelemetryKind.normalize(json.optString("kind")),
                occurredAt = json.optString("occurredAt").takeIf { it.isNotEmpty() }
                    ?: TelemetryTime.isoUtc(0L),
                data = json.optJSONObject("data") ?: JSONObject()
            )
        }
    }
}

/**
 * The four record kinds the endpoint accepts.
 *
 * These strings are the contract: the server filters and stores by them, so they
 * are compared exactly rather than by case. [normalize] exists only because
 * decoding must never drop a record over a mangled field — an unknown kind is
 * filed as the catch-all rather than thrown away.
 */
object TelemetryKind {
    const val QUESTIONNAIRE: String = "questionnaire"
    const val TRAINING: String = "training"
    const val EXPERIENCE: String = "experience"
    const val EVENT: String = "event"

    /** The contract's four kinds, in wire order. */
    val all: List<String> = listOf(QUESTIONNAIRE, TRAINING, EXPERIENCE, EVENT)

    /** An unknown or missing kind becomes [EVENT]; a record is never dropped. */
    fun normalize(kind: String?): String =
        if (kind != null && kind in all) kind else EVENT
}
