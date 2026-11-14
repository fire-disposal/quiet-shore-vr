package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * A filed sheet is data the tablet keeps, nothing more.
 *
 * The score belongs to the page: it is the only end that knows what an answer
 * value means for a given instrument. These cases pin that the Kotlin side
 * carries whatever number arrives — including none — and never derives one.
 */
class QuestionnaireResultTest {

    private fun sheet(
        answers: List<Int> = listOf(4, 2, 5, 1, 4, 2, 5, 2, 4, 1),
        filled: Int = 10,
        complete: Boolean = true,
        score: Int? = 72,
        completedAt: Long = 1_761_300_000_000L,
        sessionSec: Int = 312,
        scene: String = "shore",
        questionnaireId: String = "sus"
    ) = QuestionnaireResult(
        answers = answers,
        filled = filled,
        complete = complete,
        scene = scene,
        sessionSec = sessionSec,
        completedAt = completedAt,
        questionnaireId = questionnaireId,
        score = score
    )

    @Test
    fun `the score is carried verbatim, in any range the page publishes`() {
        // Not SUS-shaped on purpose: an instrument may score 0..20, 1..7 or
        // 0..100, and none of those is the tablet's business.
        assertEquals(20, sheet(score = 20).score)
        assertEquals(0, sheet(score = 0).score)
        assertEquals(100, sheet(score = 100).score)
    }

    @Test
    fun `an instrument without scoring files a null score`() {
        assertNull(sheet(score = null).score)
        // Completeness does not imply a score: the instrument may publish none.
        assertNull(sheet(complete = true, score = null).score)
    }

    @Test
    fun `an incomplete sheet keeps whatever score it was given`() {
        // The page decides. If it sends a number for a partial sheet, that
        // number is the record; the tablet must not blank it.
        val partial = sheet(
            answers = listOf(3, 0, 3),
            filled = 2,
            complete = false,
            score = null
        )
        assertNull(partial.score)
        assertEquals(1, partial.remaining)
    }

    @Test
    fun `questions and answers are positional and any length`() {
        val three = sheet(answers = listOf(1, 2, 3), filled = 3)
        assertEquals(3, three.answers.size)
        assertEquals(0, three.remaining)

        val hundred = sheet(answers = List(100) { 1 }, filled = 100)
        assertEquals(100, hundred.answers.size)
    }

    @Test
    fun `identity is the filing facts, not the answers`() {
        assertEquals(sheet().key, sheet(answers = List(10) { 5 }).key)
        assertNotEquals(sheet().key, sheet(questionnaireId = "nasa-tlx").key)
        assertNotEquals(sheet().key, sheet(completedAt = 1_761_300_000_001L).key)
        assertNotEquals(sheet().key, sheet(sessionSec = 313).key)
        assertNotEquals(sheet().key, sheet(scene = "ward").key)
    }

    @Test
    fun `the characteristic is append-only and distinct`() {
        val uuids = listOf(
            ControlProtocol.serviceUuid,
            ControlProtocol.commandUuid,
            ControlProtocol.statusUuid,
            ControlProtocol.telemetryUuid,
            ControlProtocol.stateUuid,
            ControlProtocol.jsonUuid
        )
        assertEquals(uuids.size, uuids.toSet().size)
    }
}
