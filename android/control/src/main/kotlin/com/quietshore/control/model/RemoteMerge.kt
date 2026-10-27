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
 * - the mirror fields (`control`, `floatLevel`, `voiceId`, elapsed time) always
 *   follow the headset;
 * - `startPending` stays on the tablet until the headset reports a session.
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
        // No running session, no clock: the caller clears `sessionStartedAt` on
        // the falling edge, but the merge must not depend on that ordering.
        !running -> 0L
        frame.elapsedSec > 0 -> frame.elapsedSec * 1000L
        sessionStartedAt == 0L -> 0L
        else -> (nowMs - sessionStartedAt).coerceAtLeast(0L)
    }
    return current.copy(
        control = frame,
        // While a session runs the headset is authoritative for the mode too,
        // so a rejected command cannot leave the panel showing something that
        // is not happening. Before a session the operator's choice stands.
        floatLevel = frame.floatLevel,
        // Voice is authoritative on the headset: the tablet only echoes.
        voiceId = frame.voiceId,
        startPending = if (running) false else current.startPending,
        sessionElapsedMs = elapsedMs
    )
}
