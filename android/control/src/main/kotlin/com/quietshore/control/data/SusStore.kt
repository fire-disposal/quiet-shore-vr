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

    /** Outcome of [append]: the sheet either extended the history or was a replay. */
    sealed interface Appended {
        /** The stored history after this attempt. */
        val history: List<SusResult>

        /** A new sheet; [history] is the list including it. */
        data class Recorded(override val history: List<SusResult>) : Appended

        /**
         * The same sheet arrived again (the headset re-sends its last frame on
         * every subscribe). Nothing was written; [history] already holds it.
         */
        data class Duplicate(override val history: List<SusResult>) : Appended
    }

    /**
     * Appends one sheet, newest last, unless the same sheet is already stored.
     *
     * Replays are the normal case, not the exception: the protocol re-sends the
     * last record whenever a controller subscribes. Identity is [SusResult.key],
     * so a replay never doubles a record, never doubles its ledger event, and
     * never pushes a real record out of the [keep] window.
     */
    fun append(result: SusResult, keep: Int = SUS_RECORDS): Appended {
        val outcome = mergeSusHistory(load(), result, keep)
        if (outcome is Appended.Recorded) {
            write(outcome.history)
        }
        return outcome
    }

    private fun write(list: List<SusResult>) {
        preferences.edit()
            .putString(KEY, SusResultCodec.encodeList(list))
            .apply()
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "sus_history"
    }
}

/** How many sheets the tablet keeps; older ones fall off the front. */
const val SUS_RECORDS: Int = 50

/**
 * Storage-free half of [SusStore]: what appending [result] to [history] means.
 *
 * Kept as a pure function so the replay contract (one sheet, one record, one
 * ledger event) is testable without an Android context or a preferences file.
 */
internal fun mergeSusHistory(
    history: List<SusResult>,
    result: SusResult,
    keep: Int = SUS_RECORDS
): SusStore.Appended {
    if (history.any { it.key == result.key }) {
        return SusStore.Appended.Duplicate(history)
    }
    return SusStore.Appended.Recorded((history + result).takeLast(keep))
}
