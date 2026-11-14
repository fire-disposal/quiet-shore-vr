package com.quietshore.control.data

import com.quietshore.control.protocol.SusResult
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * M7: a re-sent sheet is one record.
 *
 * The protocol requires the headset to replay its last SUS frame whenever a
 * controller subscribes, so after a reconnect the same sheet arrives again.
 * It must not double the history, the ledger event, or push real records out
 * of the 50-sheet window.
 */
class SusStoreMergeTest {

    private fun sheet(
        completedAt: Long = 1_700_000_000_000L,
        answers: List<Int> = List(10) { 4 },
        sessionSec: Int = 900,
        scene: String = "shore",
        questionnaireId: String = "sus"
    ) = SusResult(
        answers = answers,
        filled = answers.count { it in 1..5 },
        complete = answers.all { it in 1..5 },
        scene = scene,
        sessionSec = sessionSec,
        completedAt = completedAt,
        questionnaireId = questionnaireId
    )

    private fun recorded(outcome: SusStore.Appended): List<SusResult> {
        assertTrue(outcome is SusStore.Appended.Recorded, "expected a new record")
        return (outcome as SusStore.Appended.Recorded).history
    }

    @Test
    fun `a replayed sheet is not appended twice`() {
        val first = recorded(mergeSusHistory(emptyList(), sheet()))

        val replay = mergeSusHistory(first, sheet())

        assertTrue(replay is SusStore.Appended.Duplicate)
        assertEquals(1, replay.history.size)
        // The duplicate path must hand back the stored history, not an empty
        // list: the caller republishes it into the UI.
        assertEquals(first, replay.history)
    }

    @Test
    fun `repeated replays stay at one record`() {
        var history = recorded(mergeSusHistory(emptyList(), sheet()))
        repeat(3) {
            history = mergeSusHistory(history, sheet()).history
        }
        assertEquals(1, history.size)
    }

    @Test
    fun `two different sheets both keep their place`() {
        val morning = sheet(completedAt = 1_700_000_000_000L)
        val evening = sheet(completedAt = 1_700_010_000_000L)

        var history = recorded(mergeSusHistory(emptyList(), morning))
        history = recorded(mergeSusHistory(history, evening))

        assertEquals(listOf(morning, evening), history)
    }

    @Test
    fun `the same answers from a new session are a new record`() {
        // Identical answers must not collapse two real sessions: only the
        // filing facts identify a sheet.
        var history = recorded(mergeSusHistory(emptyList(), sheet(sessionSec = 600)))
        history = recorded(mergeSusHistory(history, sheet(sessionSec = 1_200)))

        assertEquals(2, history.size)
    }

    @Test
    fun `a replay does not push a real record out of the window`() {
        val keep = 2
        val first = sheet(completedAt = 1_000L)
        val second = sheet(completedAt = 2_000L)

        var history = recorded(mergeSusHistory(emptyList(), first, keep))
        history = recorded(mergeSusHistory(history, second, keep))
        // The audit symptom: the replay of `second` used to append a third copy
        // and the window then dropped the genuine `first` record.
        val replay = mergeSusHistory(history, second, keep)

        assertEquals(listOf(first, second), replay.history)
    }

    @Test
    fun `keys differ when the sheet is not the same one`() {
        assertNotEquals(sheet().key, sheet(completedAt = 1_700_000_000_001L).key)
        assertNotEquals(sheet().key, sheet(sessionSec = 901).key)
        assertNotEquals(sheet().key, sheet(scene = "ward").key)
        assertNotEquals(sheet().key, sheet(questionnaireId = "nasa-tlx").key)
        assertEquals(sheet().key, sheet().key)
    }

    @Test
    fun `a sheet without a timestamp still dedupes itself and not others`() {
        val untimed = sheet(completedAt = 0L)
        // The same sheet replayed still matches itself ...
        assertEquals(untimed.key, sheet(completedAt = 0L).key)
        // ... but a different sheet with no timestamp must not be swallowed.
        assertNotEquals(
            untimed.key,
            sheet(completedAt = 0L, answers = List(10) { 2 }).key
        )

        val first = recorded(mergeSusHistory(emptyList(), untimed))
        assertTrue(mergeSusHistory(first, sheet(completedAt = 0L)) is SusStore.Appended.Duplicate)
        assertEquals(
            2,
            recorded(
                mergeSusHistory(first, sheet(completedAt = 0L, answers = List(10) { 2 }))
            ).size
        )
    }
}
