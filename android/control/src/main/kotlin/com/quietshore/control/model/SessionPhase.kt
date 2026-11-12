package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlState

/**
 * The one session state the console draws, derived from the wire, per
 * `docs/ux-tree.md` §1.
 *
 * ```text
 *   idle ──技术员开始──> entry ──患者按压──> calibrating ──> running
 *     ▲                                                        │
 *     └── ended <── stopping <── 停 / 急停 / 链路断 / 摘下 ─────┘
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
}

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
