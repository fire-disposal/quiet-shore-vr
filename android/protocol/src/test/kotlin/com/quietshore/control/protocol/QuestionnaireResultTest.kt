package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * SUS scoring is part of the wire contract: the headset ships raw answers and
 * the tablet files the score, so both ends must agree on the transform.
 */
class SusResultTest {

    @Test
    fun `a flat answer sheet lands at fifty`() {
        // Alternating polarity means a patient who circles the same box ten
        // times is neutral, not maximal: the even items are reverse-scored.
        assertEquals(50, susScore(List(10) { 1 }))
        assertEquals(50, susScore(List(10) { 5 }))
    }

    @Test
    fun `the extremes are odd-max even-min, and its mirror`() {
        assertEquals(100, susScore(listOf(5, 1, 5, 1, 5, 1, 5, 1, 5, 1)))
        assertEquals(0, susScore(listOf(1, 5, 1, 5, 1, 5, 1, 5, 1, 5)))
    }

    @Test
    fun `alternating polarity uses the standard transform`() {
        // Odd items (1st, 3rd, ...) contribute a-1; even items contribute 5-a.
        // Answers 4,2,4,2,... -> (3+3+3+3+3) + (3+3+3+3+3) = 30 -> 75.
        val answers = listOf(4, 2, 4, 2, 4, 2, 4, 2, 4, 2)
        assertEquals(75, susScore(answers))
    }

    @Test
    fun `a partial or out of range sheet has no score`() {
        assertNull(susScore(listOf(3, 3, 3)))
        assertNull(susScore(listOf(0, 3, 3, 3, 3, 3, 3, 3, 3, 3)))
        assertNull(susScore(listOf(6, 3, 3, 3, 3, 3, 3, 3, 3, 3)))
    }

    @Test
    fun `a record only exposes a score once it is complete`() {
        val partial = SusResult(
            answers = listOf(3, 3, 0, 3, 3, 3, 3, 3, 3, 3),
            filled = 9,
            complete = false,
            scene = "shore",
            sessionSec = 240,
            completedAt = 1_761_300_000_000L
        )
        assertNull(partial.score)

        val complete = partial.copy(answers = List(10) { 3 }, filled = 10, complete = true)
        assertEquals(50, complete.score)
    }

    @Test
    fun `the characteristic is append-only and distinct`() {
        val uuids = listOf(
            ControlProtocol.serviceUuid,
            ControlProtocol.commandUuid,
            ControlProtocol.statusUuid,
            ControlProtocol.telemetryUuid,
            ControlProtocol.stateUuid,
            ControlProtocol.susUuid
        )
        assertEquals(uuids.size, uuids.toSet().size)
    }
}
