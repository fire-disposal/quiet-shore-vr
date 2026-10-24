package com.quietshore.control.data

import android.content.Context
import com.quietshore.control.protocol.SusResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * SUS sheets, kept on the tablet.
 *
 * The headset cannot hold a database and the state frame has no room for a
 * record, so the tablet is the place a result survives: the headset hands one
 * JSON sheet per completion, this store appends it and rewrites the whole list.
 * A power cycle of either device keeps the history.
 */
class SusStore(context: Context) {
    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun load(): List<SusResult> {
        val raw = preferences.getString(KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let { add(decode(it)) }
                }
            }
        } catch (error: Exception) {
            // A corrupted file must not take the console down with it.
            emptyList()
        }
    }

    /** Appends one sheet and returns the new list, newest last. */
    fun append(result: SusResult, keep: Int = MAX_RECORDS): List<SusResult> {
        val next = (load() + result).takeLast(keep)
        write(next)
        return next
    }

    fun clear(): List<SusResult> {
        preferences.edit().remove(KEY).apply()
        return emptyList()
    }

    private fun write(list: List<SusResult>) {
        val array = JSONArray()
        for (result in list) {
            array.put(encode(result))
        }
        preferences.edit().putString(KEY, array.toString()).apply()
    }

    private fun encode(result: SusResult): JSONObject = JSONObject()
        .put("answers", JSONArray(result.answers))
        .put("filled", result.filled)
        .put("complete", result.complete)
        .put("scene", result.scene)
        .put("sessionSec", result.sessionSec)
        .put("completedAt", result.completedAt)

    private fun decode(json: JSONObject): SusResult {
        val answers = json.optJSONArray("answers")
        val list = buildList {
            for (index in 0 until (answers?.length() ?: 0)) {
                add(answers?.optInt(index, 0) ?: 0)
            }
        }
        return SusResult(
            answers = list,
            filled = json.optInt("filled", list.count { it in 1..5 }),
            complete = json.optBoolean("complete", false),
            scene = json.optString("scene", ""),
            sessionSec = json.optInt("sessionSec", 0),
            completedAt = json.optLong("completedAt", 0L)
        )
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "sus_history"
        const val MAX_RECORDS = 50
    }
}
