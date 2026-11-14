package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlState

/**
 * The one session state the console draws, derived from the wire, per
 * `docs/ux-tree.md` §1.
 *
 * ```text
 *   idle ──技术员开始──> entry ──患者进入──> calibrating ──> running
 *     ▲                                                        │
 *     └── ended <── stopping <── 结束 / 断链超时 / 摘下 ───────┘
 * ```
 *
 * The page reports a session flag and a calibration flag; `stopping` is the one
 * phase it does not send, because the fade is over in under a second and adding
 * a byte to a fixed frame costs a version bump. It is therefore modelled here
 * as *what the tablet just asked for*: pressing 结束/急停 opens [stopping] and it
 * stays open until the session flag drops. That is the same interval the page
 * spends fading, and it is the interval in which a scene key must refuse — so
 * the refusal appears exactly when the page would ignore the command.
 */
enum class SessionPhase {
    /** No session, nothing pending: pick a scene, set it up, start. */
    Idle,

    /** Launch asked for; waiting for the patient's own press. */
    Entry,

    /** Recording posture. Motion is frozen for everyone but 急停. */
    Calibrating,

    /** Training. Everything in the quick row is live. */
    Running,

    /** The fade is running: scene and strength are refused, the stop is not. */
    Stopping,

    /** Session over, waiting for the operator to start the next one. */
    Ended;

    /** The page is showing a world of its own (not the entry screen). */
    val inSession: Boolean
        get() = this == Calibrating || this == Running || this == Stopping

    /** Scene and strength may be changed now; see the trigger table. */
    val acceptsChanges: Boolean
        get() = this == Idle || this == Entry || this == Running

    /**
     * A launch is on the wire and the patient has not pressed yet.
     *
     * It is the only phase the operator can still back out of without touching
     * the patient: nothing has been entered, so the cancel is a local decision
     * plus the page's own `exit`, and no fade is involved.
     */
    val awaitingPress: Boolean
        get() = this == Entry

    /**
     * A page is drawn in the main area that the session verbs must stay
     * reachable from, whichever destination the operator is on.
     */
    val showsSessionVerbs: Boolean
        get() = inSession || awaitingPress
}

/**
 * Whether the end-of-session panel belongs on the screen.
 *
 * It belongs *after* a session that actually ran, and it stops belonging the
 * moment the next launch is requested — a panel offering 试了/没试 beside a
 * pending launch is an answer to the wrong question. [lastSessionElapsedMs] is
 * kept past the ending on purpose: the running clock resets with the session
 * flag, so re-deriving "did one run" from `sessionElapsedMs` lost the panel the
 * instant the page dropped the flag.
 */
fun outcomePanelVisible(
    lastSessionElapsedMs: Long,
    sessionRunning: Boolean,
    phase: SessionPhase
): Boolean =
    !sessionRunning && phase != SessionPhase.Entry && lastSessionElapsedMs > 0L

/**
 * Folds the wire into [SessionPhase]. [stopRequested] is the tablet's own
 * memory of having sent 结束/急停, cleared as soon as the session flag drops.
 */
fun sessionPhaseOf(
    control: ControlState,
    phase: BlePhase,
    startPending: Boolean,
    stopRequested: Boolean
): SessionPhase = when {
    control.session && stopRequested -> SessionPhase.Stopping
    control.session && control.calibrating -> SessionPhase.Calibrating
    control.session -> SessionPhase.Running
    // A launch without a session, on a live link: the press has not happened.
    startPending && phase == BlePhase.READY -> SessionPhase.Entry
    else -> SessionPhase.Idle
}
