package com.quietshore.control.protocol

/**
 * One filed questionnaire sheet, as carried on [ControlProtocol.jsonUuid].
 *
 * The page owns every questionnaire: its questions, its option values and the
 * meaning of an answer. It also owns scoring — a sheet arrives with the score
 * already computed (or with `null` when the instrument publishes none, or the
 * sheet is not complete). Nothing here knows what SUS is, how many questions an
 * instrument has, or what a given answer value means.
 *
 * [answers] is positional and length-agnostic: slot *i* belongs to question
 * *i* of the instrument named by [questionnaireId]. An unanswered slot is 0,
 * because JSON `null` would make a Kotlin decoder branch on a type it cannot
 * see in a BLE notification.
 */
data class QuestionnaireResult(
    /** One slot per question, in instrument order; 0 means unanswered. */
    val answers: List<Int>,
    /** How many slots hold an answer; the page's own count. */
    val filled: Int,
    /** The page says every question was answered. */
    val complete: Boolean,
    val scene: String,
    val sessionSec: Int,
    /** Epoch millis reported by the headset when the sheet was filed. */
    val completedAt: Long,
    /** Product face that produced the record; the ledger's app field. */
    val app: String = "questionnaire",
    /** Instrument id from the page's registry. */
    val questionnaireId: String = "",
    /** Human-readable instrument name at the time it was filed. */
    val questionnaireName: String = "",
    /**
     * The instrument's own score, computed by the page. Null when the
     * instrument publishes no scoring, or when the sheet is incomplete: the
     * tablet files what it is given and never derives one.
     */
    val score: Int? = null
) {
    /**
     * Stable identity of one filed sheet.
     *
     * The headset re-sends its last frame whenever a controller subscribes, so
     * the same sheet arrives more than once per link, and the tablet must
     * collapse the replay instead of filing the same record twice.
     *
     * Identity is built from facts both ends already agree on:
     * - which instrument and product face produced it ([app],
     *   [questionnaireId]) — two instruments never share a record;
     * - when and where it was filed ([completedAt]) plus the session it closed
     *   ([sessionSec], [scene]).
     *
     * A record whose [completedAt] was lost on the wire still needs a distinct
     * identity, or two different sheets would collapse into one; the answers
     * and [complete] only enter the key in that case, so the normal path stays
     * insensitive to a patient re-tapping an answer before the sheet is filed.
     */
    val key: String
        get() {
            val head = listOf(
                app,
                questionnaireId,
                completedAt.toString(),
                sessionSec.toString(),
                scene
            )
            if (completedAt > 0L) {
                return head.joinToString(KEY_SEPARATOR)
            }
            // No trusted timestamp: fall back to the sheet's own content so a
            // replay still matches itself and nothing else is swallowed.
            return (head + answers.joinToString(",") + complete.toString())
                .joinToString(KEY_SEPARATOR)
        }

    /** The unanswered count the archive prints when there is no score. */
    val remaining: Int get() = (answers.size - filled).coerceAtLeast(0)
}

/** Field separator of [QuestionnaireResult.key]; a unit separator cannot occur in an id. */
internal const val KEY_SEPARATOR: String = "\u001F"
