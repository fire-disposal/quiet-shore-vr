package com.quietshore.control.model

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * When the closing panel exists at all.
 *
 * The panel used to be keyed on the *running* clock, which the page zeroes in
 * the same frame it drops the session flag — so the operator never saw the
 * question the session was recorded for. The window is now a named function
 * with its own tests instead of a compound condition inside a composable.
 */
class OutcomePanelTest {

    @Test
    fun `a session that ran leaves a panel after it ends`() {
        assertTrue(
            outcomePanelVisible(
                lastSessionElapsedMs = 182_000L,
                sessionRunning = false,
                phase = SessionPhase.Idle
            )
        )
    }

    @Test
    fun `no session has ever run, so there is nothing to ask`() {
        assertFalse(
            outcomePanelVisible(
                lastSessionElapsedMs = 0L,
                sessionRunning = false,
                phase = SessionPhase.Idle
            )
        )
    }

    @Test
    fun `the panel is not drawn while the session still runs`() {
        assertFalse(
            outcomePanelVisible(
                lastSessionElapsedMs = 182_000L,
                sessionRunning = true,
                phase = SessionPhase.Running
            )
        )
    }

    @Test
    fun `a pending launch takes the panel away`() {
        // The answer belongs to the session that ended, not to the one the
        // patient is being asked to open.
        assertFalse(
            outcomePanelVisible(
                lastSessionElapsedMs = 182_000L,
                sessionRunning = false,
                phase = SessionPhase.Entry
            )
        )
    }

    @Test
    fun `the ending fade keeps the panel closed until the flag drops`() {
        assertFalse(
            outcomePanelVisible(
                lastSessionElapsedMs = 182_000L,
                sessionRunning = true,
                phase = SessionPhase.Stopping
            )
        )
    }
}
