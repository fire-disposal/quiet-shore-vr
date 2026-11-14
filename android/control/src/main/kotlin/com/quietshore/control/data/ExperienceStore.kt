package com.quietshore.control.data

import android.content.Context
import com.quietshore.control.model.EXPERIENCE_MAX_RATING
import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.model.FloatDirection
import org.json.JSONArray
import org.json.JSONObject

/**
 * 体验 records, kept on the tablet.
 *
 * The headset cannot hold a database and the protocol has no slot for this
 * sheet — it is answered by the operator *after* the headset is off, so there is
 * nothing on the wire to carry it. The tablet is therefore the only place these
 * records exist, and they must survive a power cycle: one JSON list in the same
 * preferences file the other local stores use.
 *
 * Two rules shape the storage, and both are tested without an Android context:
 *
 *  - **One bad entry never takes the list down.** A record is decoded field by
 *    field with documented defaults; only a body that is not a JSON object, or
 *    one with no usable identity, is dropped. The alternative — dropping the
 *    whole list on one syntax error — loses every observation to a truncated
 *    write.
 *  - **The window is bounded.** [EXPERIENCE_RECORDS] is about a month of a busy
 *    trial; older records fall off the front, newest last.
 */
class ExperienceStore(context: Context) {
    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun load(): List<ExperienceRecord> =
        ExperienceCodec.decodeList(preferences.getString(KEY, null))

    /**
     * Appends one record, newest last.
     *
     * The same [ExperienceRecord.id] arriving twice (a double tap on 保存 before
     * the list recomposed) replaces the earlier row instead of doubling it, so
     * one observation is one line in the CSV.
     */
    fun append(record: ExperienceRecord): List<ExperienceRecord> {
        val next = mergeExperience(load(), record)
        write(next)
        return next
    }

    /** Removes one row by id; an unknown id changes nothing. */
    fun remove(id: Long): List<ExperienceRecord> {
        val next = removeExperience(load(), id)
        write(next)
        return next
    }

    /** Clears every filed observation. */
    fun clear(): List<ExperienceRecord> {
        write(emptyList())
        return emptyList()
    }

    private fun write(list: List<ExperienceRecord>) {
        preferences.edit()
            .putString(KEY, ExperienceCodec.encodeList(list))
            .apply()
    }

    private companion object {
        const val PREFERENCES = "quiet_shore_control"
        const val KEY = "experience_history"
    }
}

/** How many observations the tablet keeps; older ones fall off the front. */
const val EXPERIENCE_RECORDS: Int = 200

/**
 * Storage-free half of [ExperienceStore]: what appending [record] to [history]
 * means. Kept pure so the ordering and the identity rule are testable.
 */
internal fun mergeExperience(
    history: List<ExperienceRecord>,
    record: ExperienceRecord,
    keep: Int = EXPERIENCE_RECORDS
): List<ExperienceRecord> {
    val others = history.filterNot { it.id == record.id }
    return (others + record).takeLast(keep)
}

/** Removes one observation; the order of the survivors is unchanged. */
internal fun removeExperience(
    history: List<ExperienceRecord>,
    id: Long
): List<ExperienceRecord> = history.filterNot { it.id == id }

/**
 * The stored form of an [ExperienceRecord].
 *
 * Field names are the JSON in the preferences file, so they are stable and
 * documented rather than derived: a record written by this build must be
 * readable by the next one. Every field is optional on read; the defaults are
 * the same ones the form starts from.
 */
object ExperienceCodec {

    fun encode(record: ExperienceRecord): JSONObject = JSONObject()
        .put("id", record.id)
        .put("at", record.at)
        .put("participant", record.participant)
        .put("scene", record.scene)
        .put("sessionSec", record.sessionSec)
        .put("floatStrength", record.floatStrength)
        .put("disorientation", record.disorientation)
        .put("sceneRealism", record.sceneRealism)
        .put("bodyAlignment", record.bodyAlignment)
        .put("comfort", record.comfort)
        .put("dizziness", record.dizziness)
        .put("nausea", record.nausea)
        .put("repeatWish", record.repeatWish)
        .put("direction", record.direction)
        .put("notes", record.notes)

    fun encodeList(list: List<ExperienceRecord>): String {
        val array = JSONArray()
        for (record in list) {
            array.put(encode(record))
        }
        return array.toString()
    }

    /**
     * A non-array body is "no history"; one bad entry is skipped, not fatal.
     *
     * The `optJSONObject` walk is what makes that true: a truncated write leaves
     * the array parseable but one element short of an object, and only that
     * element is lost.
     */
    fun decodeList(raw: String?): List<ExperienceRecord> {
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

    /**
     * One record, or null when the object cannot name itself.
     *
     * An id is required: without it the row cannot be replaced on a re-save and
     * two observations with the same timestamp would collapse. Older builds had
     * no `id`, so a stored `at` is accepted in its place — the form has always
     * stamped the two from the same millisecond.
     */
    fun decode(json: JSONObject): ExperienceRecord? {
        val at = json.optLong("at", 0L)
        val id = json.optLong("id", at)
        if (id <= 0L) {
            return null
        }
        return ExperienceRecord(
            id = id,
            at = if (at > 0L) at else id,
            participant = json.optString("participant", ""),
            scene = json.optString("scene", ""),
            sessionSec = json.optInt("sessionSec", 0).coerceAtLeast(0),
            floatStrength = json.optInt("floatStrength", 0).clamp(),
            disorientation = json.optInt("disorientation", 0).clamp(),
            sceneRealism = json.optInt("sceneRealism", 0).clamp(),
            bodyAlignment = json.optInt("bodyAlignment", 0).clamp(),
            comfort = json.optInt("comfort", 0).clamp(),
            dizziness = json.optInt("dizziness", 0).clamp(),
            nausea = json.optInt("nausea", 0).clamp(),
            repeatWish = json.optInt("repeatWish", 0).clamp(),
            direction = FloatDirection.sanitize(json.optString("direction", "")),
            notes = json.optString("notes", "")
        )
    }

    private fun Int.clamp(): Int = coerceIn(0, EXPERIENCE_MAX_RATING)
}
