package com.quietshore.control.protocol

import org.json.JSONArray
import org.json.JSONObject

/**
 * The stored form of one questionnaire sheet.
 *
 * Storage and the BLE decoder share this codec so a record written by one build
 * is readable by the next, and a corrupted file is dropped one entry at a time
 * instead of taking the history down. A missing [QuestionnaireResult.score] is
 * encoded as JSON null and decoded back to null — "no score" is a value, not an
 * absent field.
 */
object QuestionnaireResultCodec {

    fun encode(result: QuestionnaireResult): JSONObject = JSONObject()
        .put("answers", JSONArray(result.answers))
        .put("filled", result.filled)
        .put("complete", result.complete)
        .put("score", result.score ?: JSONObject.NULL)
        .put("scene", result.scene)
        .put("sessionSec", result.sessionSec)
        .put("completedAt", result.completedAt)
        .put("app", result.app)
        .put("questionnaireId", result.questionnaireId)
        .put("questionnaireName", result.questionnaireName)

    /** A non-array body is "no history"; one bad entry is skipped. */
    fun decodeList(raw: String?): List<QuestionnaireResult> {
        if (raw.isNullOrBlank()) {
            return emptyList()
        }
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let(::decode)?.let(::add)
                }
            }
        } catch (error: Exception) {
            emptyList()
        }
    }

    fun encodeList(list: List<QuestionnaireResult>): String {
        val array = JSONArray()
        for (result in list) {
            array.put(encode(result))
        }
        return array.toString()
    }

    /** Null when the object has no usable answer array. */
    fun decode(json: JSONObject): QuestionnaireResult? {
        val answersArray = json.optJSONArray("answers") ?: return null
        val answers = buildList {
            for (index in 0 until answersArray.length()) {
                add(answersArray.optInt(index, 0))
            }
        }
        if (answers.isEmpty()) {
            return null
        }
        return QuestionnaireResult(
            answers = answers,
            filled = json.optInt("filled", answers.count { it > 0 }),
            complete = json.optBoolean("complete", false),
            scene = json.optString("scene", ""),
            sessionSec = json.optInt("sessionSec", 0),
            completedAt = json.optLong("completedAt", 0L),
            app = json.optString("app", "questionnaire"),
            questionnaireId = json.optString("questionnaireId", ""),
            questionnaireName = json.optString("questionnaireName", ""),
            // optInt returns 0 for null, so the field is read by type: only a
            // real number is a score.
            score = json.opt("score") as? Int
        )
    }
}
