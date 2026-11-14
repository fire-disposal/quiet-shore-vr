package com.quietshore.control.data.telemetry

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The wire form of a timestamp: ISO-8601 in UTC.
 *
 * The contract says ISO-8601 *strings*, and allows a time-zone offset on input.
 * The client sends one shape regardless: epoch millis from whatever local store
 * produced the record become `2026-11-14T08:31:05.123Z`. A tablet left on
 * Asia/Shanghai and one left on UTC must produce the same instant for the same
 * event, so the offset is resolved here and never travels.
 *
 * Millisecond precision and a literal `Z` — `Instant`'s own `toString()` drops
 * the fraction when it is zero, which makes the payload depend on the wall
 * clock. A fixed pattern does not.
 */
object TelemetryTime {

    private val FORMATTER: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** Epoch millis to the wire string; anything not positive is the epoch itself. */
    fun isoUtc(epochMs: Long): String =
        FORMATTER.format(Instant.ofEpochMilli(if (epochMs > 0L) epochMs else 0L))

    /**
     * A wire string back to epoch millis, or null when it is not ISO-8601.
     *
     * Accepts `Z`, a numeric offset (`+08:00`, `-0530`), or no offset at all
     * (read as UTC) — the value is normalised to the instant it names. A record
     * whose stamp cannot be read gets no made-up one.
     */
    fun parseIsoUtc(text: String?): Long? {
        if (text.isNullOrBlank()) {
            return null
        }
        runCatching { return Instant.parse(text).toEpochMilli() }
        runCatching {
            return OffsetDateTime.parse(text).toInstant().toEpochMilli()
        }
        // No offset: `java.time` refuses it, and the contract reads it as UTC.
        runCatching {
            return java.time.LocalDateTime.parse(text)
                .toInstant(ZoneOffset.UTC)
                .toEpochMilli()
        }
        return null
    }
}
