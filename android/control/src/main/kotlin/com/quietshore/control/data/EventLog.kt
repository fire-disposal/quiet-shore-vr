package com.quietshore.control.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The one behaviour log both product faces write to.
 *
 * Training sessions and questionnaire sheets already record *what happened*;
 * this records *what was done* — who pressed which control, when the link came
 * and went, which scene was entered, why a session stopped. Those two kinds
 * answer different questions, and a session that ended early is only
 * explainable if the press that ended it is on the same timeline.
 *
 * The log holds no patient identifier and no free text: an event is an app
 * name, a kind, a millisecond stamp, and a small object of machine facts. It
 * lives in one file shared by both apps, because the point of it is the seam
 * between them: switching face, opening a scale, or leaving a session mid-way
 * only shows up in a log that is not partitioned by app.
 *
 * The log is the only thing the tablet writes on every operator press, so an
 * append rewrites the bounded list in place. Four thousand events is about two
 * full shifts; older ones fall off the front.
 */
class EventLog(context: Context) {
    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    /** App names this log understands; anything else is filed as `system`. */
    private val knownApps = setOf("training", "questionnaire", "system")

    fun load(): List<JSONObject> {
        val raw = preferences.getString(KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let(::add)
                }
            }
        } catch (error: Exception) {
            emptyList()
        }
    }

    fun append(app: String, kind: String, detail: JSONObject? = null): List<JSONObject> {
        val record = JSONObject().apply {
            put("at", System.currentTimeMillis())
            put("app", if (app in knownApps) app else "system")
            put("kind", kind)
            if (detail != null && detail.length() > 0) {
                put("d", detail)
            }
        }
        val next = (load() + record).takeLast(MAX_EVENTS)
        write(next)
        return next
    }

    fun clear(): List<JSONObject> {
        preferences.edit().remove(KEY).apply()
        return emptyList()
    }

    /** Every event as one JSON array, newest last: the export's own section. */
    fun toJsonArray(): JSONArray {
        val array = JSONArray()
        for (event in load()) {
            array.put(event)
        }
        return array
    }

    private fun write(list: List<JSONObject>) {
        val array = JSONArray()
        for (item in list) {
            array.put(item)
        }
        preferences.edit().putString(KEY, array.toString()).apply()
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "event_log"
        const val MAX_EVENTS = 4000
    }
}
