package com.quietshore.control.model

import com.quietshore.control.protocol.ControlState

/**
 * How one state frame from the headset folds into the tablet's UI state.
 *
 * The rules used to live inline in `onControlState`, as one `copy(...)` with a
 * nested `if` for the mode and a couple of separate resets around it. They are
 * here because they are the tablet's **ownership contract**, and contracts
 * deserve a name and a test:
 *
 * - the mirror fields (`control`, `floatLevel`, `floatProfile`, `voiceId`,
 *   elapsed time) always follow the headset;
 * - intent fields (`sessionMode` before a session, `viewPitchTarget`,
 *   `startPending`) stay on the tablet until the headset has something to say;
 * - leaving a session drops the local view correction, because the page
 *   recentres and a stale slider would lie about what the patient sees.
 */
fun mergeRemoteFrame(
    current: ControlUiState,
    frame: ControlState,
    /** Monotonic start of the running session, 0 when none is running. */
    sessionStartedAt: Long,
    /** Monotonic clock reading for this frame. */
    nowMs: Long
): ControlUiState {
    val running = frame.session
    val elapsedMs = when {
        running && frame.elapsedSec > 0 -> frame.elapsedSec * 1000L
        sessionStartedAt == 0L -> 0L
        else -> (nowMs - sessionStartedAt).coerceAtLeast(0L)
    }
    return current.copy(
        control = frame,
        // While a session runs the headset is authoritative for the mode too,
        // so a rejected command cannot leave the panel showing something that
        // is not happening. Before a session the operator's choice stands.
        sessionMode = when {
            running && frame.postureMode -> SessionMode.POSTURE
            running -> SessionMode.FLOAT
            else -> current.sessionMode
        },
        floatLevel = frame.floatLevel,
        floatProfile = frame.floatProfile,
        // Voice is authoritative on the headset: the tablet only echoes.
        voiceId = frame.voiceId,
        startPending = if (running) false else current.startPending,
        // The page recentres on session end; a slider left at a correction the
        // patient is no longer looking through would be a lie.
        viewPitchTarget = if (running) current.viewPitchTarget else 0,
        sessionElapsedMs = elapsedMs
    )
}
