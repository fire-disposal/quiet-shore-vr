package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The catalogue is a build input compiled into both APKs, so this parser reads
 * a whole registry and every instrument is simply an entry in it.
 */
class QuestionnaireCatalogTest {

    private fun instrument(
        id: String = "sus",
        questions: Int = 10,
        options: Int = 5,
        scoring: String? = "sus"
    ): String {
        val body = StringBuilder()
        body.append("{\"id\":\"").append(id).append("\",")
        body.append("\"name\":{\"zh\":\"").append(id).append(" 名称\"},")
        body.append("\"short\":{\"zh\":\"短名\"},")
        body.append("\"questions\":[")
        for (index in 1..questions) {
            if (index > 1) body.append(',')
            body.append("{\"id\":\"").append(id).append('-').append(index)
            body.append("\",\"text\":{\"zh\":\"第").append(index)
            body.append("题\"},\"voiceId\":\"v-").append(id).append('-').append(index).append("\"}")
        }
        body.append("],\"options\":[")
        for (value in 1..options) {
            if (value > 1) body.append(',')
            body.append("{\"value\":").append(value)
            body.append(",\"label\":{\"zh\":\"选项").append(value).append("\"}}")
        }
        body.append("]")
        if (scoring != null) {
            body.append(",\"scoring\":{\"type\":\"").append(scoring).append("\"}")
        }
        body.append('}')
        return body.toString()
    }

    private fun catalog(vararg instruments: String): String =
        "{\"questionnaires\":[" + instruments.joinToString(",") + "]}"

    @Test
    fun `parses instruments in order, with their options and scoring`() {
        val list = QuestionnaireCatalogDocument.parse(catalog(instrument()))
        requireNotNull(list)
        val sus = list.single()
        assertEquals("sus", sus.id)
        assertEquals("sus 名称", sus.nameZh)
        assertEquals("短名", sus.shortZh)
        assertEquals(List(10) { "sus-${it + 1}" }, sus.questions.map { it.id })
        assertEquals("第1题", sus.questions.first().textZh)
        assertEquals("v-sus-1", sus.questions.first().voiceId)
        assertEquals(listOf(1, 2, 3, 4, 5), sus.optionValues)
        assertEquals("选项3", sus.options[2].labelZh)
        assertEquals(QuestionnaireCatalogDocument.Scoring("sus"), sus.scoring)
    }

    @Test
    fun `two instruments of different shapes live in one registry`() {
        val list = QuestionnaireCatalogDocument.parse(
            catalog(
                instrument(id = "sus", questions = 10, options = 5),
                // Deliberately unlike SUS: three questions, two options, and no
                // scoring at all. Nothing in the reader may assume ten or five.
                instrument(id = "pain-3", questions = 3, options = 2, scoring = null)
            )
        )
        requireNotNull(list)
        assertEquals(listOf("sus", "pain-3"), list.map { it.id })
        val pain = list[1]
        assertEquals(3, pain.questions.size)
        assertEquals(listOf(1, 2), pain.optionValues)
        assertNull(pain.scoring)
        assertTrue(pain.accepts(2))
        assertTrue(!pain.accepts(3))
    }

    @Test
    fun `a questionnaire without scoring files no score`() {
        val list = QuestionnaireCatalogDocument.parse(catalog(instrument(scoring = null)))
        requireNotNull(list)
        assertNull(list.single().scoring)
    }

    @Test
    fun `the grammar bounds questions at 100 and options at 2 to 7`() {
        assertNotNull(QuestionnaireCatalogDocument.parse(catalog(instrument(questions = 100))))
        assertNull(QuestionnaireCatalogDocument.parse(catalog(instrument(questions = 101))))
        assertNull(QuestionnaireCatalogDocument.parse(catalog(instrument(questions = 0))))
        assertNull(QuestionnaireCatalogDocument.parse(catalog(instrument(options = 1))))
        assertNull(QuestionnaireCatalogDocument.parse(catalog(instrument(options = 8))))
    }

    @Test
    fun `a damaged registry is refused whole`() {
        for (raw in listOf(
            "{}",
            "{\"questionnaires\":[]}",
            "{\"questionnaires\":[{\"id\":\"sus\"}]}",
            "{\"questionnaires\":[{\"id\":\"Bad Id\",\"questions\":[],\"options\":[]}]}",
            // Duplicate ids: two instruments would claim the same sheet.
            catalog(instrument(id = "sus"), instrument(id = "sus")),
            // Duplicate option values.
            "{\"questionnaires\":[{\"id\":\"sus\",\"questions\":[{\"id\":\"a\",\"text\":{\"zh\":\"x\"}}]," +
                "\"options\":[{\"value\":1,\"label\":{\"zh\":\"x\"}},{\"value\":1,\"label\":{\"zh\":\"y\"}}]}]}",
            // An option value outside the wire's answer range.
            "{\"questionnaires\":[{\"id\":\"sus\",\"questions\":[{\"id\":\"a\",\"text\":{\"zh\":\"x\"}}]," +
                "\"options\":[{\"value\":0,\"label\":{\"zh\":\"x\"}},{\"value\":2,\"label\":{\"zh\":\"y\"}}]}]}",
            // A question with no wording.
            "{\"questionnaires\":[{\"id\":\"sus\",\"questions\":[{\"id\":\"a\",\"text\":{\"zh\":\"\"}}]," +
                "\"options\":[{\"value\":1,\"label\":{\"zh\":\"x\"}},{\"value\":2,\"label\":{\"zh\":\"y\"}}]}]}"
        )) {
            assertNull(QuestionnaireCatalogDocument.parse(raw), raw)
        }
    }

    @Test
    fun `the asset reader yields an empty catalogue when the file is missing`() {
        // No fallback list: an absent asset means "nothing announced", and the
        // sheet draws its empty state instead of inventing questions.
        assertTrue(QuestionnaireCatalogAsset.load { null }.isEmpty())
        assertTrue(QuestionnaireCatalogAsset.load { throw java.io.IOException("absent") }.isEmpty())
        assertTrue(QuestionnaireCatalogAsset.load { "not json" }.isEmpty())
        assertEquals(
            listOf("sus"),
            QuestionnaireCatalogAsset.load { catalog(instrument()) }.map { it.id }
        )
    }
}
