package com.quietshore.control.protocol

import org.json.JSONObject

/**
 * The questionnaire catalogue, as the page publishes it on the JSON channel.
 *
 * The page's registry owns the wording; the tablet renders this list and the
 * headset relays it. A new instrument is one entry there, not a second set of
 * strings in Kotlin.
 */
object QuestionnaireCatalogDocument {
    data class Option(val value: Int, val labelZh: String)
    data class Question(val id: String, val textZh: String, val voiceId: String)
    data class Questionnaire(
        val id: String,
        val nameZh: String,
        val shortZh: String,
        val questions: List<Question>,
        val options: List<Option>
    )

    private val ID = Regex("^[a-z][a-z0-9-]{0,31}$")

    /** Returns null for a damaged list; the last good one must survive. */
    fun parse(json: String): List<Questionnaire>? {
        val array = try {
            JSONObject(json).optJSONArray("questionnaires") ?: return null
        } catch (error: Exception) {
            return null
        }
        if (array.length() !in 1..16) {
            return null
        }
        val seen = HashSet<String>()
        val result = ArrayList<Questionnaire>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: return null
            val id = item.optString("id").trim()
            val questions = item.optJSONArray("questions") ?: return null
            val options = item.optJSONArray("options") ?: return null
            if (!ID.matches(id) || !seen.add(id) || questions.length() !in 1..100 || options.length() !in 2..7) {
                return null
            }
            val parsedQuestions = ArrayList<Question>(questions.length())
            for (q in 0 until questions.length()) {
                val question = questions.optJSONObject(q) ?: return null
                val qid = question.optString("id").trim()
                val text = question.optJSONObject("text")?.optString("zh").orEmpty().trim()
                if (!ID.matches(qid) || text.isEmpty() || !parsedQuestions.none { it.id == qid }) {
                    return null
                }
                parsedQuestions.add(
                    Question(
                        id = qid,
                        textZh = text,
                        voiceId = question.optString("voiceId").trim()
                    )
                )
            }
            val parsedOptions = ArrayList<Option>(options.length())
            for (o in 0 until options.length()) {
                val option = options.optJSONObject(o) ?: return null
                val value = option.optInt("value", 0)
                val label = option.optJSONObject("label")?.optString("zh").orEmpty().trim()
                if (value !in 1..9 || label.isEmpty() || parsedOptions.any { it.value == value }) {
                    return null
                }
                parsedOptions.add(Option(value, label))
            }
            result.add(
                Questionnaire(
                    id = id,
                    nameZh = item.optJSONObject("name")?.optString("zh").orEmpty().trim().ifEmpty { id },
                    shortZh = item.optJSONObject("short")?.optString("zh").orEmpty().trim(),
                    questions = parsedQuestions,
                    options = parsedOptions.sortedBy { it.value }
                )
            )
        }
        return result
    }
}
