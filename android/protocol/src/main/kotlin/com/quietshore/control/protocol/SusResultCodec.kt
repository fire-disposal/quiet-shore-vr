package com.quietshore.control.protocol

import org.json.JSONArray
import org.json.JSONObject

/**
 * The stored form of one questionnaire sheet.
 *
 * Storage and the BLE decoder share this codec so a record written by one build
 * is readable by the next, and a corrupted file is dropped one entry at a time
 * instead of taking the history down. Missing fields from older builds get the
 * documented defaults.
 */
object SusResultCodec {

    fun encode(result: SusResult): JSONObject = JSONObject()
        .put("answers", JSONArray(result.answers))
        .put("filled", result.filled)
        .put("complete", result.complete)
        .put("scene", result.scene)
        .put("sessionSec", result.sessionSec)
        .put("completedAt", result.completedAt)
        .put("app", result.app)
        .put("questionnaireId", result.questionnaireId)
        .put("questionnaireName", result.questionnaireName)

    /** A non-array body is "no history"; one bad entry is skipped. */
    fun decodeList(raw: String?): List<SusResult> {
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

    fun encodeList(list: List<SusResult>): String {
        val array = JSONArray()
        for (result in list) {
            array.put(encode(result))
        }
        return array.toString()
    }

    /** Null when the object has no usable answer array. */
    fun decode(json: JSONObject): SusResult? {
        val answersArray = json.optJSONArray("answers") ?: return null
        val answers = buildList {
            for (index in 0 until answersArray.length()) {
                add(answersArray.optInt(index, 0))
            }
        }
        if (answers.isEmpty()) {
            return null
        }
        return SusResult(
            answers = answers,
            filled = json.optInt("filled", answers.count { it in 1..5 }),
            complete = json.optBoolean("complete", false),
            scene = json.optString("scene", ""),
            sessionSec = json.optInt("sessionSec", 0),
            completedAt = json.optLong("completedAt", 0L),
            app = json.optString("app", "questionnaire"),
            questionnaireId = json.optString("questionnaireId", "sus"),
            questionnaireName = json.optString("questionnaireName", "")
        )
    }
}
