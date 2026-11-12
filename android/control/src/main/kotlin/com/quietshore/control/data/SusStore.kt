package com.quietshore.control.data

import android.content.Context
import com.quietshore.control.protocol.SusResult
import com.quietshore.control.protocol.SusResultCodec

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

    fun load(): List<SusResult> =
        SusResultCodec.decodeList(preferences.getString(KEY, null))

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
        preferences.edit()
            .putString(KEY, SusResultCodec.encodeList(list))
            .apply()
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "sus_history"
        const val MAX_RECORDS = 50
    }
}
