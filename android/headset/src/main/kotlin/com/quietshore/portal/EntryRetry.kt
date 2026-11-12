package com.quietshore.portal

/**
 * Supervision of one entry: did the launch actually become a session?
 *
 * Firefox Reality cannot enter immersive mode without a press inside its own
 * 2D window (WebXR requires a transient user activation the shell cannot
 * forge), and that window is placed in front of the head at launch — so a
 * patient who is looking elsewhere, or a launch whose intent was dropped during
 * a cold start, leaves the page sitting on its entry screen forever. The
 * tablet already shows "等待患者确认"; nothing in the system noticed when that
 * wait never ended.
 *
 * This policy watches a launch and answers one question at a time. It knows
 * nothing about Android: the service owns the timer and the relaunch, so the
 * deadlines below are testable without a device.
 *
 * ```text
 * launch   --page state frame-->  waiting for the press
 *   |  no page within PAGE_WAIT_MS           | no session within PRESS_WAIT_MS
 *   |                                        +--> one synthetic tap (if enabled)
 *   |                                        |      | still nothing
 *   +----------------------> relaunch <-------+------+
 *                              (at most MAX_RETRIES times)
 * ```
 *
 * The tap is the cheapest remedy and the only one that does not disturb the
 * patient: a supine patient who never found the window gets a press delivered
 * for them. It is attempted at most once per launch and only when the shell's
 * accessibility helper is enabled, so a device without it behaves exactly as
 * before.
 *
 * A page that reports a session ends supervision for good: a finished session
 * must never be mistaken for a patient who never pressed.
 */
internal class EntryRetry(
    private val pageWaitMs: Long = PAGE_WAIT_MS,
    private val pressWaitMs: Long = PRESS_WAIT_MS,
    private val maxRetries: Int = MAX_RETRIES,
    /** Whether a synthetic tap is possible right now (accessibility enabled). */
    private val autoTapAvailable: () -> Boolean = { false }
) {
    enum class Phase { IDLE, WAITING_PAGE, WAITING_SESSION }

    enum class Decision { HOLD, TAP, RELAUNCH, GIVE_UP }

    var phase: Phase = Phase.IDLE
        private set

    /** Relaunches already issued for this operator launch. */
    var retries: Int = 0
        private set

    /** When [onDeadline] is due, or -1 while nothing is supervised. */
    var checkAt: Long = -1L
        private set

    /** A synthetic tap was already tried for this launch. */
    var tapped: Boolean = false
        private set

    /**
     * A launch was handed to the browser. `fresh` is the operator's own press:
     * it resets the allowance, while our own relaunch must not.
     */
    fun launch(now: Long, fresh: Boolean) {
        if (fresh) {
            retries = 0
        }
        // A new attempt may try the tap again: the previous window is gone.
        tapped = false
        phase = Phase.WAITING_PAGE
        checkAt = now + pageWaitMs
    }

    /**
     * The page reported its state. `session` true ends supervision; a page that
     * is up but not in a session starts the press clock, once.
     */
    fun pageState(now: Long, session: Boolean) {
        if (session) {
            phase = Phase.IDLE
            checkAt = -1L
            return
        }
        if (phase == Phase.WAITING_PAGE) {
            phase = Phase.WAITING_SESSION
            checkAt = now + pressWaitMs
        }
    }

    /**
     * The timer fired. Anything before the deadline is a HOLD so a caller that
     * re-arms optimistically cannot relaunch early.
     */
    fun onDeadline(now: Long): Decision {
        if (phase == Phase.IDLE) {
            checkAt = -1L
            return Decision.HOLD
        }
        if (now < checkAt) {
            return Decision.HOLD
        }
        if (phase == Phase.WAITING_SESSION && !tapped && autoTapAvailable()) {
            tapped = true
            // The patient gets the same window again before we disturb anything.
            checkAt = now + pressWaitMs
            return Decision.TAP
        }
        if (retries >= maxRetries) {
            phase = Phase.IDLE
            checkAt = -1L
            return Decision.GIVE_UP
        }
        retries++
        // The relaunch puts a fresh window in front of the head, so the new
        // window may try one tap of its own.
        tapped = false
        phase = Phase.WAITING_PAGE
        checkAt = now + pageWaitMs
        return Decision.RELAUNCH
    }

    companion object {
        /** Firefox Reality's cold start plus the page's first state frame. */
        const val PAGE_WAIT_MS = 25_000L

        /**
         * How long the entry screen may sit unconfirmed before we hand the
         * patient a fresh window. Long enough for a slow press, short enough
         * that an operator notices the scene arrive.
         */
        const val PRESS_WAIT_MS = 20_000L

        /** Two relaunches; a third would only fight the patient's own press. */
        const val MAX_RETRIES = 2
    }
}
