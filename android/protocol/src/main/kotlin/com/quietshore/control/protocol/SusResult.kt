package com.quietshore.control.protocol

import kotlin.math.roundToInt

/**
 * One SUS sheet as carried on [ControlProtocol.susUuid].
 *
 * The page sends raw answers (0 = unanswered) plus the facts needed to file the
 * record. Scoring lives in the wire module so every reader agrees on the
 * transform: `score = SUM(odd: a - 1, even: 5 - a) * 2.5`, 0..100, only for a
 * full sheet.
 */
data class SusResult(
    /** Ten slots in statement order; 0 means the patient never answered it. */
    val answers: List<Int>,
    val filled: Int,
    val complete: Boolean,
    val scene: String,
    val sessionSec: Int,
    /** Epoch millis reported by the headset when the sheet was filed. */
    val completedAt: Long,
    /** Product face that produced the record; the ledger's app field. */
    val app: String = "questionnaire",
    /** Instrument id from the page's registry. */
    val questionnaireId: String = "sus",
    /** Human-readable instrument name at the time it was filed. */
    val questionnaireName: String = ""
) {
    /** Standard SUS score, or null while any item is unanswered. */
    val score: Int? get() = if (complete) susScore(answers) else null
}

/** Standard SUS transform; null unless all ten items hold 1..5. */
fun susScore(answers: List<Int>): Int? {
    if (answers.size != SUS_ITEMS) {
        return null
    }
    var total = 0
    for (index in 0 until SUS_ITEMS) {
        val answer = answers[index]
        if (answer !in 1..5) {
            return null
        }
        total += if (index % 2 == 0) answer - 1 else 5 - answer
    }
    return (total * 2.5f).roundToInt()
}

const val SUS_ITEMS: Int = 10
