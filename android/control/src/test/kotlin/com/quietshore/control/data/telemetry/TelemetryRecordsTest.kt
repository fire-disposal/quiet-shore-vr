package com.quietshore.control.data.telemetry

import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.protocol.QuestionnaireResult
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Record identity and the timestamp shape.
 *
 * The server deduplicates on `id`, so "the same record produces the same id
 * every time it is built" is not a nicety — it is the whole protection against
 * a re-sent BLE frame or a second backfill doubling the dataset.
 */
class TelemetryRecordsTest {

    private val idPattern = Regex("[A-Za-z0-9._:-]{1,128}")

    private fun sheet(completedAt: Long = 1_700_000_000_000L, id: String = "sus") =
        QuestionnaireResult(
            answers = List(10) { 4 },
            filled = 10,
            complete = true,
            scene = "shore",
            sessionSec = 900,
            completedAt = completedAt,
            questionnaireId = id
        )

    private fun experience(id: Long = 1_700_000_000_000L) =
        ExperienceRecord(id = id, at = id, participant = "P07", scene = "shore", comfort = 7)

    private fun event(at: Long = 1_700_000_000_000L, detail: JSONObject? = null) =
        JSONObject().apply {
            put("at", at)
            put("app", "training")
            put("kind", "command")
            if (detail != null) put("d", detail)
        }

    // ---- idempotency --------------------------------------------------------

    @Test
    fun `the same questionnaire sheet always hashes to the same id`() {
        val first = TelemetryRecords.questionnaire(sheet())
        val replay = TelemetryRecords.questionnaire(sheet())

        assertEquals(first.id, replay.id)
        assertEquals(TelemetryKind.QUESTIONNAIRE, first.kind)
    }

    @Test
    fun `two different sheets do not collide`() {
        val a = TelemetryRecords.questionnaire(sheet(completedAt = 1_700_000_000_000L))
        val b = TelemetryRecords.questionnaire(sheet(completedAt = 1_700_000_001_000L))
        assertNotEquals(a.id, b.id)
    }

    @Test
    fun `a questionnaire id survives the unit separator in the sheet key`() {
        val id = TelemetryRecords.questionnaire(sheet()).id
        assertTrue(idPattern.matches(id), "contract shape violated: $id")
    }

    @Test
    fun `a re-sent training summary keeps its id`() {
        val raw = JSONObject().put("at", 1_700_000_000_000L).put("scene", "shore")
        val again = JSONObject().put("at", 1_700_000_000_000L).put("outcome", "stopped")

        assertEquals(TelemetryRecords.training(raw)!!.id, TelemetryRecords.training(again)!!.id)
    }

    @Test
    fun `a training record without a stamp is refused`() {
        assertNull(TelemetryRecords.training(JSONObject().put("scene", "shore")))
    }

    @Test
    fun `the same experience row keeps its id across rebuilds`() {
        assertEquals(
            TelemetryRecords.experience(experience())!!.id,
            TelemetryRecords.experience(experience())!!.id
        )
    }

    @Test
    fun `an event with the page's own id is stable and ignores the stamp`() {
        val a = TelemetryRecords.event(event(at = 1L, detail = JSONObject().put("id", "cap-7")))
        val b = TelemetryRecords.event(event(at = 2L, detail = JSONObject().put("id", "cap-7")))

        assertEquals(a.id, b.id, "a page-supplied id is the event's identity")
    }

    @Test
    fun `an event without an id hashes its stored record, so a resend collides`() {
        val stored = event(detail = JSONObject().put("c", "start"))
        val sameRecordReadBack = JSONObject(stored.toString())

        assertEquals(
            TelemetryRecords.event(stored).id,
            TelemetryRecords.event(sameRecordReadBack).id
        )
    }

    @Test
    fun `two different events without ids are distinct`() {
        val a = TelemetryRecords.event(event(at = 1_700_000_000_000L, detail = JSONObject().put("c", "start")))
        val b = TelemetryRecords.event(event(at = 1_700_000_000_000L, detail = JSONObject().put("c", "stop")))
        assertNotEquals(a.id, b.id)
    }

    @Test
    fun `every family id matches the contract shape and stays in its own space`() {
        val ids = listOf(
            TelemetryRecords.questionnaire(sheet()).id,
            TelemetryRecords.training(JSONObject().put("at", 1L))!!.id,
            TelemetryRecords.experience(experience())!!.id,
            TelemetryRecords.event(event()).id
        )

        for (id in ids) {
            assertTrue(idPattern.matches(id), "contract shape violated: $id")
        }
        assertEquals(4, ids.map { it.substringBefore(':') }.toSet().size)
    }

    @Test
    fun `an event id built from free text still matches the shape`() {
        val id = TelemetryRecords.event(event(detail = JSONObject().put("id", "任意 文本/../\u0000")))
        assertTrue(idPattern.matches(id.id), "free text leaked into the id: ${id.id}")
    }

    // ---- timestamps ---------------------------------------------------------

    @Test
    fun `the wire stamp is ISO-8601 in UTC`() {
        val record = TelemetryRecords.questionnaire(sheet(completedAt = 1_700_000_000_123L))
        assertEquals("2023-11-14T22:13:20.123Z", record.occurredAt)
    }

    @Test
    fun `a stamp with an offset is normalised to the same UTC instant`() {
        val utc = TelemetryTime.parseIsoUtc("2023-11-14T22:13:20.123Z")
        val shanghai = TelemetryTime.parseIsoUtc("2023-11-15T06:13:20.123+08:00")
        val newYork = TelemetryTime.parseIsoUtc("2023-11-14T17:13:20.123-05:00")

        assertEquals(utc, shanghai)
        assertEquals(utc, newYork)
        assertEquals("2023-11-14T22:13:20.123Z", TelemetryTime.isoUtc(shanghai!!))
    }

    @Test
    fun `a stamp with no offset is read as UTC`() {
        assertEquals(
            TelemetryTime.parseIsoUtc("2023-11-14T22:13:20.123Z"),
            TelemetryTime.parseIsoUtc("2023-11-14T22:13:20.123")
        )
    }

    @Test
    fun `an unreadable stamp is null, never a made-up instant`() {
        assertNull(TelemetryTime.parseIsoUtc("yesterday"))
        assertNull(TelemetryTime.parseIsoUtc(""))
        assertNull(TelemetryTime.parseIsoUtc(null))
    }

    @Test
    fun `a missing local stamp still produces a valid wire stamp`() {
        val record = TelemetryRecords.training(JSONObject().put("at", 0L))
        assertNull(record)
        assertEquals("1970-01-01T00:00:00.000Z", TelemetryTime.isoUtc(0L))
    }

    // ---- backfill -----------------------------------------------------------

    @Test
    fun `the backfill covers all four kinds, oldest first`() {
        val records = TelemetryRecords.backfill(
            questionnaires = listOf(sheet(completedAt = 2_000L)),
            training = listOf(JSONObject().put("at", 3_000L)),
            experiences = listOf(experience(id = 4_000L)),
            events = listOf(JSONObject().put("at", 1_000L).put("app", "system").put("kind", "boot"))
        )

        assertEquals(4, records.size)
        assertEquals(
            listOf(
                TelemetryKind.EVENT,
                TelemetryKind.QUESTIONNAIRE,
                TelemetryKind.TRAINING,
                TelemetryKind.EXPERIENCE
            ),
            records.map { it.kind }
        )
    }

    @Test
    fun `a backfill of nothing is empty`() {
        assertTrue(TelemetryRecords.backfill().isEmpty())
    }

    @Test
    fun `the sha256 helper is the documented hex digest`() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            TelemetryRecords.sha256Of("")
        )
    }
}
