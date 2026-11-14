package com.quietshore.control.protocol

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class QuestionnaireResultCodecTest {

    private val scored = QuestionnaireResult(
        answers = listOf(4, 2, 5, 1, 4, 2, 5, 2, 4, 1),
        filled = 10,
        complete = true,
        scene = "shore",
        sessionSec = 312,
        completedAt = 1_761_300_000_000,
        app = "questionnaire",
        questionnaireId = "sus",
        questionnaireName = "系统可用性量表",
        score = 72
    )

    private val unscored = QuestionnaireResult(
        answers = listOf(3, 6, 0),
        filled = 2,
        complete = false,
        scene = "ward",
        sessionSec = 90,
        completedAt = 1_761_400_000_000,
        questionnaireId = "pain-3",
        questionnaireName = "疼痛三点",
        score = null
    )

    @Test
    fun `round-trips one record and the list`() {
        assertEquals(scored, QuestionnaireResultCodec.decode(QuestionnaireResultCodec.encode(scored)))
        val list = listOf(scored, unscored)
        assertEquals(list, QuestionnaireResultCodec.decodeList(QuestionnaireResultCodec.encodeList(list)))
    }

    @Test
    fun `a null score survives storage as null, not as zero`() {
        val encoded = QuestionnaireResultCodec.encode(unscored)
        assertTrue(encoded.isNull("score"), "score must be encoded as JSON null")
        assertEquals(unscored, QuestionnaireResultCodec.decode(encoded))
        // 0 is a real score; it must not collapse into "no score".
        assertEquals(0, QuestionnaireResultCodec.decode(
            QuestionnaireResultCodec.encode(scored.copy(score = 0))
        )?.score)
    }

    @Test
    fun `dynamic answer arrays of any length round-trip`() {
        val short = unscored.copy(answers = listOf(2, 5), filled = 2, complete = true)
        val long = unscored.copy(answers = List(100) { it % 9 + 1 }, filled = 100, complete = true)
        for (sheet in listOf(short, long)) {
            assertEquals(sheet, QuestionnaireResultCodec.decode(QuestionnaireResultCodec.encode(sheet)))
        }
    }

    @Test
    fun `a corrupt file drops entries, not the whole history`() {
        assertTrue(QuestionnaireResultCodec.decodeList(null).isEmpty())
        assertTrue(QuestionnaireResultCodec.decodeList("not json").isEmpty())
        assertTrue(QuestionnaireResultCodec.decodeList("{}").isEmpty())
        val mixed = """[
            {"answers":[1,2,3]},
            {"noAnswers":true},
            {"answers":[]}
        ]"""
        assertEquals(1, QuestionnaireResultCodec.decodeList(mixed).size)
    }

    @Test
    fun `a record without a score field decodes to no score`() {
        val decoded = QuestionnaireResultCodec.decode(
            JSONObject("""{"answers":[1,2,3],"scene":"ward"}""")
        )
        requireNotNull(decoded)
        assertEquals("questionnaire", decoded.app)
        assertNull(decoded.score)
        assertEquals(0L, decoded.completedAt)
        // The instrument is unknown only when the record never named one.
        assertEquals("", decoded.questionnaireId)
    }
}
