package com.quietshore.control.model

import com.quietshore.control.protocol.ControlState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The tablet's ownership contract: mirror fields follow the headset, intent
 * fields stay on the tablet, and a finished session drops the local view
 * correction.
 */
class RemoteMergeTest {

    private fun frame(
        session: Boolean = false,
        postureMode: Boolean = false,
        floatLevel: Int = 2,
        elapsedSec: Int = 0
    ) = ControlState(
        session = session,
        postureMode = postureMode,
        floatLevel = floatLevel,
        elapsedSec = elapsedSec
    )

    @Test
    fun `before a session the operator's choices survive a frame`() {
        val intent = ControlUiState(
            sessionMode = SessionMode.POSTURE,
            viewPitchTarget = 12,
            startPending = true
        )
        val merged = mergeRemoteFrame(intent, frame(session = false), sessionStartedAt = 0L, nowMs = 1_000L)

        // Mode and the pending launch are the operator's; the view correction
        // is session-only, so it falls back to zero with no session running.
        assertEquals(SessionMode.POSTURE, merged.sessionMode)
        assertEquals(0, merged.viewPitchTarget)
        assertTrue(merged.startPending)
    }

    @Test
    fun `during a session the headset owns the mode and buoyancy`() {
        val intent = ControlUiState(
            sessionMode = SessionMode.FLOAT,
            viewPitchTarget = 12,
            startPending = true
        )
        val merged = mergeRemoteFrame(
            intent,
            frame(session = true, postureMode = true, floatLevel = 3),
            sessionStartedAt = 0L,
            nowMs = 5_000L
        )

        assertEquals(SessionMode.POSTURE, merged.sessionMode)
        assertEquals(3, merged.floatLevel)
        // A running session keeps the correction: it is what the patient sees.
        assertEquals(12, merged.viewPitchTarget)
        assertFalse(merged.startPending)
    }

    @Test
    fun `leaving a session drops the local correction`() {
        val running = ControlUiState(viewPitchTarget = 20)
        val merged = mergeRemoteFrame(running, frame(session = false), 0L, 9_000L)
        assertEquals(0, merged.viewPitchTarget)
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
    fun `the local stopwatch only covers a frame that has no seconds yet`() {
        val merged = mergeRemoteFrame(
            ControlUiState(),
            frame(session = true, elapsedSec = 0),
            sessionStartedAt = 1_000L,
            nowMs = 4_500L
        )
        assertEquals(3_500L, merged.sessionElapsedMs)
    }

    @Test
    fun `no session means no elapsed time`() {
        val merged = mergeRemoteFrame(ControlUiState(), frame(session = false), 0L, 90_000L)
        assertEquals(0L, merged.sessionElapsedMs)
    }
}
