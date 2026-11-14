package com.quietshore.control.model

import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.ViewAnim
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The tablet's ownership contract, one test per clause of [mergeRemoteFrame]:
 * the mirror follows the headset, the operator's pending launch is theirs, and
 * a frame without seconds falls back to the local stopwatch.
 */
class RemoteMergeTest {

    private fun frame(
        session: Boolean = false,
        voiceId: Int = -1,
        scene: String = "shore",
        viewAnim: ViewAnim = ViewAnim.IDLE,
        elapsedSec: Int = 0
    ) = ControlState(
        session = session,
        voiceId = voiceId,
        scene = scene,
        viewAnim = viewAnim,
        elapsedSec = elapsedSec
    )

    @Test
    fun `the panel follows the headset's scene, voice and player`() {
        val merged = mergeRemoteFrame(
            ControlUiState(),
            frame(voiceId = 7, scene = "ward", viewAnim = ViewAnim.PLAYING),
            sessionStartedAt = 0L,
            nowMs = 1_000L
        )

        assertEquals("ward", merged.control.scene)
        assertEquals(7, merged.voiceId)
        assertEquals(ViewAnim.PLAYING, merged.control.viewAnim)
    }

    @Test
    fun `a mid-session scene switch is reported, never echoed ahead of the headset`() {
        // The scene may be switched while the session runs, so the tablet has
        // no pick of its own to defend: whatever the headset last reported is
        // what every mark draws. An echo would flash a mark for a scene the
        // patient is not looking at, and stay there if the switch was refused.
        val running = ControlUiState(control = ControlState(scene = "shore", session = true))

        val switched = mergeRemoteFrame(running, frame(session = true, scene = "ward"), 0L, 1_000L)
        assertEquals("ward", switched.control.scene)

        val unchanged = mergeRemoteFrame(switched, frame(session = true, scene = "ward"), 0L, 2_000L)
        assertEquals("ward", unchanged.control.scene)
    }

    @Test
    fun `a pending launch survives a frame until the session starts`() {
        val pending = ControlUiState(startPending = true)

        val before = mergeRemoteFrame(pending, frame(session = false), 0L, 1_000L)
        assertTrue(before.startPending)

        val running = mergeRemoteFrame(pending, frame(session = true), 0L, 2_000L)
        assertFalse(running.startPending)
    }

    @Test
    fun `elapsed time prefers the headset's own clock`() {
        val merged = mergeRemoteFrame(
            ControlUiState(),
            frame(session = true, elapsedSec = 42),
            sessionStartedAt = 1_000L,
            nowMs = 60_000L
        )
        assertEquals(42_000L, merged.sessionElapsedMs)
    }

    @Test
    fun `the local stopwatch only covers a frame with no seconds yet`() {
        val merged = mergeRemoteFrame(
            ControlUiState(),
            frame(session = true, elapsedSec = 0),
            sessionStartedAt = 1_000L,
            nowMs = 4_500L
        )
        assertEquals(3_500L, merged.sessionElapsedMs)
    }

    @Test
    fun `no running session means no elapsed time`() {
        val merged = mergeRemoteFrame(ControlUiState(), frame(session = false), 1_000L, 90_000L)
        assertEquals(0L, merged.sessionElapsedMs)
    }

    @Test
    fun `the length of the session that just ended outlives the falling edge`() {
        // The running clock is 0 the moment the page drops the flag. The closing
        // panel asks the bedside question about *that* session, so its length
        // must survive the frame that ends it.
        val running = mergeRemoteFrame(
            ControlUiState(),
            frame(session = true, elapsedSec = 182),
            sessionStartedAt = 0L,
            nowMs = 182_000L
        )
        assertEquals(182_000L, running.lastSessionElapsedMs)

        val ended = mergeRemoteFrame(running, frame(session = false), 0L, 183_000L)
        assertEquals(0L, ended.sessionElapsedMs)
        assertEquals(182_000L, ended.lastSessionElapsedMs)
        assertTrue(
            outcomePanelVisible(
                lastSessionElapsedMs = ended.lastSessionElapsedMs,
                sessionRunning = ended.control.session,
                phase = SessionPhase.Idle
            )
        )
    }

    @Test
    fun `a stale frame without seconds cannot shrink the recorded length`() {
        // A frame whose `elapsedSec` has not ticked yet falls back to the local
        // stopwatch; the kept length still takes the larger of the two.
        val early = ControlUiState(
            control = ControlState(session = true, elapsedSec = 12),
            sessionElapsedMs = 12_500L
        )
        val merged = mergeRemoteFrame(early, frame(session = true, elapsedSec = 0), 1_000L, 1_200L)

        assertEquals(12_500L, merged.lastSessionElapsedMs)
    }

    @Test
    fun `no session ever ran means no kept length`() {
        val merged = mergeRemoteFrame(ControlUiState(), frame(session = false), 0L, 5_000L)
        assertEquals(0L, merged.lastSessionElapsedMs)
    }

    @Test
    fun `the preparation-room request clears on the frame that reports it`() {
        val pending = ControlUiState(control = ControlState(scene = "shore"), prepRequested = true)
        assertTrue(pending.prepScenePending)

        val confirmed = mergeRemoteFrame(
            pending,
            frame(scene = PREPARATION_SCENE),
            sessionStartedAt = 0L,
            nowMs = 1_000L
        )
        assertFalse(confirmed.prepRequested)
        assertFalse(confirmed.prepScenePending)

        // A frame that still shows the formal scene keeps the request on the
        // wire: the confirmation is the page's, not a timer's.
        val unconfirmed = mergeRemoteFrame(pending, frame(scene = "shore"), 0L, 1_000L)
        assertTrue(unconfirmed.prepRequested)
    }

    @Test
    fun `the preparation key stays available while a formal scene plays`() {
        // The dead key: it was hidden exactly when it was needed — a session in
        // a real scene, with the neutral room as the only way out.
        val running = ControlUiState(control = ControlState(scene = "shore", session = true))
        assertTrue(running.canReturnToPrep)

        val inside = ControlUiState(control = ControlState(scene = PREPARATION_SCENE, session = true))
        assertFalse(inside.canReturnToPrep)
    }
}
