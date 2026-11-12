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
        floatLevel: Int = 1,
        voiceId: Int = -1,
        scene: String = "shore",
        viewAnim: ViewAnim = ViewAnim.IDLE,
        elapsedSec: Int = 0
    ) = ControlState(
        session = session,
        floatLevel = floatLevel,
        voiceId = voiceId,
        scene = scene,
        viewAnim = viewAnim,
        elapsedSec = elapsedSec
    )

    @Test
    fun `the panel follows the headset's scene, buoyancy, voice and player`() {
        val merged = mergeRemoteFrame(
            ControlUiState(),
            frame(floatLevel = 3, voiceId = 7, scene = "ward", viewAnim = ViewAnim.PLAYING),
            sessionStartedAt = 0L,
            nowMs = 1_000L
        )

        assertEquals("ward", merged.control.scene)
        assertEquals(3, merged.floatLevel)
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
}
