package com.quietshore.control.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Finished training sessions, kept in the same file as questionnaire sheets.
 *
 * The page owns the training ledger; this is the tablet's copy so the two
 * record kinds can be filtered and exported together. `app` is the field that
 * tells them apart, exactly as the questionnaire sheets carry it.
 */
class TrainingStore(context: Context) {
    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun load(): List<JSONObject> {
        val raw = preferences.getString(KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let { add(it) }
                }
            }
        } catch (error: Exception) {
            emptyList()
        }
    }

    /** Appends one page summary; a duplicate timestamp is ignored. */
    fun append(json: String) {
        val record = try {
            JSONObject(json).put("app", "training")
        } catch (error: Exception) {
            return
        }
        val existing = load().filterNot { it.optLong("at", -1) == record.optLong("at", 0) }
        val next = (existing + record).takeLast(MAX_RECORDS)
        val array = JSONArray()
        for (item in next) {
            array.put(item)
        }
        preferences.edit().putString(KEY, array.toString()).apply()
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "training_history"
        const val MAX_RECORDS = 100
    }
}
