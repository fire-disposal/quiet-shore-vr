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
 * - the mirror fields (`control`, `voiceId`, elapsed time) always
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
        // The one posture scalar is in the state frame, not the flags document:
        // the bar's fill and its percent label both read this copy.
        mix = frame.mix.coerceIn(0f, 1f),
        // While a session runs the headset is authoritative for the mode too,
        // so a rejected command cannot leave the panel showing something that
        // is not happening. Before a session the operator's choice stands.
        // Voice is authoritative on the headset: the tablet only echoes.
        voiceId = frame.voiceId,
        startPending = if (running) false else current.startPending,
        // The fade is over when the page says the session is gone; until then
        // the tablet keeps refusing scene and strength, which is what the page
        // is doing too.
        stopRequested = running && current.stopRequested,
        sessionElapsedMs = elapsedMs,
        // The closing panel reads this, so the length must outlive the falling
        // edge: the running clock is 0 the moment the page drops the flag, and a
        // panel keyed on it would vanish in that same frame.
        lastSessionElapsedMs = when {
            !running && current.control.session ->
                maxOf(current.lastSessionElapsedMs, current.sessionElapsedMs)
            running && !current.control.session -> elapsedMs
            running -> maxOf(current.lastSessionElapsedMs, current.sessionElapsedMs, elapsedMs)
            else -> current.lastSessionElapsedMs
        },
        // A preparation-room switch stops being pending when the page reports
        // the neutral room — the confirmation, not a timer, clears it.
        prepRequested = current.prepRequested && frame.scene != PREPARATION_SCENE
    )
}
