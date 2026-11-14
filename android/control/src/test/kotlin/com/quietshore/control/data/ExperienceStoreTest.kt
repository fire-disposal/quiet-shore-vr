package com.quietshore.control.data

import com.quietshore.control.model.ExperienceDraft
import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.model.FloatDirection
import com.quietshore.control.model.SceneCatalog
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.json.JSONArray
import org.json.JSONObject

/**
 * The 体验 store: one bad entry never takes the list down, one identity never
 * doubles a row, and the window is bounded.
 *
 * Nothing here needs an Android context: [ExperienceCodec] and
 * [mergeExperience] are the storage-free halves of [ExperienceStore], which is
 * why they exist as separate callables.
 */
class ExperienceStoreTest {

    private fun record(
        id: Long = 1_700_000_000_000L,
        comfort: Int = 7,
        notes: String = "",
        direction: String = FloatDirection.UP
    ) = ExperienceRecord(
        id = id,
        at = id,
        participant = "P07",
        scene = "shore",
        sessionSec = 600,
        floatStrength = 6,
        disorientation = 2,
        sceneRealism = 8,
        bodyAlignment = 7,
        comfort = comfort,
        dizziness = 3,
        nausea = 1,
        repeatWish = 9,
        direction = direction,
        notes = notes
    )

    @Test
    fun `a record round-trips through the stored form`() {
        val original = record(notes = "患者说像在水里")
        val restored = ExperienceCodec.decode(ExperienceCodec.encode(original))

        assertEquals(original, restored)
    }

    @Test
    fun `an empty body is no history, not an error`() {
        assertEquals(emptyList<ExperienceRecord>(), ExperienceCodec.decodeList(null))
        assertEquals(emptyList<ExperienceRecord>(), ExperienceCodec.decodeList(""))
        assertEquals(emptyList<ExperienceRecord>(), ExperienceCodec.decodeList("not json"))
        assertEquals(emptyList<ExperienceRecord>(), ExperienceCodec.decodeList("{}"))
    }

    @Test
    fun `one corrupt entry is skipped and the rest survive`() {
        // Element 1 is not an object at all — the shape a truncated write leaves.
        val raw = JSONArray()
            .put(ExperienceCodec.encode(record(id = 10L)))
            .put("half-written")
            .put(JSONObject().put("notes", "no id, no at"))
            .put(ExperienceCodec.encode(record(id = 20L)))
            .toString()

        val restored = ExperienceCodec.decodeList(raw)

        assertEquals(listOf(10L, 20L), restored.map { it.id })
    }

    @Test
    fun `a record with no identity is dropped, one with only at keeps it`() {
        assertNull(ExperienceCodec.decode(JSONObject().put("notes", "x")))

        // An older build stored no `id`; the form always stamped both from the
        // same millisecond, so `at` stands in.
        val legacy = ExperienceCodec.decode(JSONObject().put("at", 1_650_000_000_000L))
        assertNotNull(legacy)
        assertEquals(1_650_000_000_000L, legacy!!.id)
        assertEquals(1_650_000_000_000L, legacy.at)
    }

    @Test
    fun `ratings and the direction are clamped on read`() {
        val hostile = ExperienceCodec.encode(record())
            .put("comfort", 99)
            .put("nausea", -4)
            .put("direction", "sideways")

        val restored = ExperienceCodec.decode(hostile)!!

        assertEquals(10, restored.comfort)
        assertEquals(0, restored.nausea)
        assertEquals("", restored.direction)
    }

    @Test
    fun `the same record twice is one row, newest last`() {
        val first = mergeExperience(emptyList(), record(id = 1L, comfort = 3))
        val second = mergeExperience(first, record(id = 2L, comfort = 4))
        // A double tap on 保存 before the list recomposed: same id, new value.
        val replaced = mergeExperience(second, record(id = 2L, comfort = 5))

        assertEquals(listOf(1L, 2L), replaced.map { it.id })
        assertEquals(5, replaced.last().comfort)
    }

    @Test
    fun `the window keeps the newest records`() {
        var history = emptyList<ExperienceRecord>()
        for (index in 1..5) {
            history = mergeExperience(history, record(id = index.toLong()), keep = 3)
        }

        assertEquals(listOf(3L, 4L, 5L), history.map { it.id })
        assertEquals(EXPERIENCE_RECORDS, 200)
    }

    @Test
    fun `a draft saves with the captured scene and length, blank participant allowed`() {
        val draft = ExperienceDraft(
            openedAt = 1_700_000_000_000L,
            scene = "ward",
            sessionSec = 301,
            participant = "  ",
            floatStrength = 4,
            disorientation = 1,
            sceneRealism = 6,
            bodyAlignment = 5,
            comfort = 8,
            dizziness = 2,
            nausea = 0,
            repeatWish = 7,
            direction = FloatDirection.FLOAT,
            notes = "  想再来  "
        )

        val saved = draft.toRecord()

        assertEquals(draft.openedAt, saved.id)
        assertEquals(draft.openedAt, saved.at)
        assertEquals("", saved.participant)
        assertEquals("—", saved.participantLabel)
        assertEquals("ward", saved.scene)
        assertEquals(301, saved.sessionSec)
        assertEquals(4, saved.floatStrength)
        assertEquals(7, saved.repeatWish)
        assertEquals(FloatDirection.FLOAT, saved.direction)
        assertEquals("想再来", saved.notes)
    }

    @Test
    fun `a draft clamps ratings and refuses an unknown direction`() {
        val saved = ExperienceDraft(
            openedAt = 5L,
            scene = "shore",
            sessionSec = -10,
            comfort = 42,
            repeatWish = -3,
            direction = "sideways"
        ).toRecord()

        assertEquals(10, saved.comfort)
        assertEquals(0, saved.repeatWish)
        assertEquals(0, saved.sessionSec)
        assertEquals("", saved.direction)
        assertEquals("—", saved.directionLabel)
    }

    @Test
    fun `the four scene labels resolve against the live catalogue`() {
        val catalogue = listOf(
            SceneCatalog.Scene("shore", "海岸", ""),
            SceneCatalog.Scene("ward", "病房", "")
        )

        val known = record().copy(scene = "ward").sceneLabel(catalogue)
        val unknown = record().copy(scene = "lab-42").sceneLabel(catalogue)

        assertEquals("病房", known)
        // An id the tablet does not know prints as itself: a lost name is not a
        // reason to drop the observation.
        assertEquals("lab-42", unknown)
    }

    @Test
    fun `an encoded list survives a decode of itself`() {
        val list = listOf(record(id = 1L), record(id = 2L, direction = FloatDirection.NONE))

        val restored = ExperienceCodec.decodeList(ExperienceCodec.encodeList(list))

        assertEquals(list, restored)
        assertFalse(restored.any { it.id <= 0L })
        assertTrue(restored[1].directionLabel.isNotEmpty())
        assertArrayEquals(
            byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()),
            ExperienceCsv.BOM
        )
    }
}
