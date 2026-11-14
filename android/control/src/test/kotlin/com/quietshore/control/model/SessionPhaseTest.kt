package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The trigger table in `docs/ux-tree.md` §2, expressed as the one function the
 * screens actually call.
 */
class SessionPhaseTest {

    private fun phaseOf(
        control: ControlState,
        ble: BlePhase = BlePhase.READY,
        startPending: Boolean = false,
        stopRequested: Boolean = false
    ) = sessionPhaseOf(control, ble, startPending, stopRequested)

    @Test
    fun `idle accepts a scene and refuses strength after a stop`() {
        val idle = phaseOf(ControlState())
        assertEquals(SessionPhase.Idle, idle)
        assertTrue(idle.acceptsChanges)
        assertFalse(idle.inSession)
    }

    @Test
    fun `entry accepts a scene because the switch re-launches`() {
        val entry = phaseOf(ControlState(), startPending = true)
        assertEquals(SessionPhase.Entry, entry)
        assertTrue(entry.acceptsChanges)
    }

    @Test
    fun `calibration refuses everything`() {
        val calibrating = phaseOf(ControlState(session = true, calibrating = true))
        assertEquals(SessionPhase.Calibrating, calibrating)
        // The patient is being asked to hold still: a world swap would undo it.
        assertFalse(calibrating.acceptsChanges)
    }

    @Test
    fun `a running session accepts a live switch`() {
        val running = phaseOf(ControlState(session = true))
        assertEquals(SessionPhase.Running, running)
        assertTrue(running.acceptsChanges)
        assertTrue(running.inSession)
    }

    @Test
    fun `stopping refuses and says so`() {
        val stopping = phaseOf(ControlState(session = true), stopRequested = true)
        assertEquals(SessionPhase.Stopping, stopping)
        assertFalse(stopping.acceptsChanges)
        // Still in a session, so the stop stays enabled and idempotent.
        assertTrue(stopping.inSession)
    }

    @Test
    fun `an ended stop request does not outlive the session it stopped`() {
        val afterFade = phaseOf(ControlState(session = false), stopRequested = true)
        assertEquals(SessionPhase.Idle, afterFade)
    }

    @Test
    fun `a launch requested before the link is up is still idle`() {
        // Without a link the tablet cannot know the press is pending; claiming
        // 等待确认 would be the console inventing a fact.
        val pending = phaseOf(ControlState(), ble = BlePhase.CONNECTING, startPending = true)
        assertEquals(SessionPhase.Idle, pending)
    }

    @Test
    fun `only the pre-press window counts as awaiting the press`() {
        // The cancel is offered exactly here and nowhere else: once the patient
        // has pressed, backing out is a session stop, not a withdrawn launch.
        val entry = phaseOf(ControlState(), startPending = true)
        assertTrue(entry.awaitingPress)
        assertTrue(entry.showsSessionVerbs)

        for (control in listOf(
            ControlState(),
            ControlState(session = true, calibrating = true),
            ControlState(session = true)
        )) {
            assertFalse(phaseOf(control).awaitingPress, "$control must not await a press")
        }
        assertFalse(phaseOf(ControlState(session = true), stopRequested = true).awaitingPress)
    }

    @Test
    fun `the session verbs are reachable on every page a session occupies`() {
        // 结束会话 and the emergency disconnect must be present on whichever
        // destination the operator happens to be on, so every in-session phase
        // asks for the strip.
        assertTrue(phaseOf(ControlState(session = true, calibrating = true)).showsSessionVerbs)
        assertTrue(phaseOf(ControlState(session = true)).showsSessionVerbs)
        assertTrue(phaseOf(ControlState(session = true), stopRequested = true).showsSessionVerbs)
        // Outside a session there is nothing to end, and the initial page owns
        // its own layout.
        assertFalse(phaseOf(ControlState()).showsSessionVerbs)
    }
}
