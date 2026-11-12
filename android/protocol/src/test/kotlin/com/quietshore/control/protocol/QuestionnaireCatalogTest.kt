package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class QuestionnaireCatalogTest {

    private val document = """
        {"questionnaires":[{
          "id":"sus",
          "name":{"zh":"系统可用性量表","en":"SUS"},
          "short":{"zh":"十题","en":"Ten"},
          "questions":[
            {"id":"sus-1","text":{"zh":"第一题"},"voiceId":"v-sus-1"},
            {"id":"sus-2","text":{"zh":"第二题"},"voiceId":"v-sus-2"}
          ],
          "options":[
            {"value":5,"label":{"zh":"非常同意"}},
            {"value":1,"label":{"zh":"非常不同意"}},
            {"value":3,"label":{"zh":"一般"}}
          ]
        }]}
    """.trimIndent()

    @Test
    fun `parses the page registry in order and sorts options`() {
        val list = QuestionnaireCatalogDocument.parse(document)
        requireNotNull(list)
        val sus = list.single()
        assertEquals("sus", sus.id)
        assertEquals("系统可用性量表", sus.nameZh)
        assertEquals(listOf("sus-1", "sus-2"), sus.questions.map { it.id })
        assertEquals(listOf(1, 3, 5), sus.options.map { it.value })
    }

    @Test
    fun `a damaged catalogue is refused whole`() {
        for (raw in listOf(
            "{}",
            "{\"questionnaires\":[]}",
            "{\"questionnaires\":[{\"id\":\"sus\"}]}",
            "{\"questionnaires\":[{\"id\":\"Bad Id\",\"questions\":[],\"options\":[]}]}",
            "{\"questionnaires\":[{\"id\":\"sus\",\"questions\":[{\"id\":\"a\",\"text\":{\"zh\":\"\"}}],\"options\":[{\"value\":1,\"label\":{\"zh\":\"x\"}},{\"value\":2,\"label\":{\"zh\":\"y\"}}]}]}"
        )) {
            assertNull(QuestionnaireCatalogDocument.parse(raw), raw)
        }
    }
}
