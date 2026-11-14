package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SusResultCodecTest {

    private val result = SusResult(
        answers = listOf(4, 2, 5, 1, 4, 2, 5, 2, 4, 1),
        filled = 10,
        complete = true,
        scene = "shore",
        sessionSec = 312,
        completedAt = 1_761_300_000_000,
        app = "questionnaire",
        questionnaireId = "sus",
        questionnaireName = "系统可用性量表"
    )

    @Test
    fun `round-trips one record and the list`() {
        assertEquals(result, SusResultCodec.decode(SusResultCodec.encode(result)))
        val list = listOf(result, result.copy(completedAt = 1))
        assertEquals(list, SusResultCodec.decodeList(SusResultCodec.encodeList(list)))
    }

    @Test
    fun `a corrupt file drops entries, not the whole history`() {
        assertTrue(SusResultCodec.decodeList(null).isEmpty())
        assertTrue(SusResultCodec.decodeList("not json").isEmpty())
        assertTrue(SusResultCodec.decodeList("{}").isEmpty())
        val mixed = """[
            {"answers":[1,2,3]},
            {"noAnswers":true},
            {"answers":[]}
        ]"""
        assertEquals(1, SusResultCodec.decodeList(mixed).size)
    }

    @Test
    fun `older records get the documented defaults`() {
        val decoded = SusResultCodec.decode(
            org.json.JSONObject("""{"answers":[1,2,3],"scene":"ward"}""")
        )
        requireNotNull(decoded)
        assertEquals("questionnaire", decoded.app)
        assertEquals("sus", decoded.questionnaireId)
        assertEquals(0L, decoded.completedAt)
    }
}
