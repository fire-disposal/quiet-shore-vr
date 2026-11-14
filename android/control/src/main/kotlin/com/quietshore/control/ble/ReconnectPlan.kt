package com.quietshore.control.ble

/**
 * What an automatic reconnect attempt does.
 *
 * The recovery loop has one shape for every attempt: go back to the headset the
 * operator already chose. There is deliberately no "scan instead" outcome — a
 * scan cannot restore a link, it only redraws the pairing list.
 */
internal sealed interface ReconnectPlan {
    /** The headset address every recovery attempt must dial. */
    val address: String

    /** Connect to [address]; already the headset this tablet controls. */
    data class Connect(override val address: String) : ReconnectPlan
}

/**
 * @return the attempt's plan, or null when there is no address to return to
 *   (the caller then hands the screen back to the operator).
 */
internal fun reconnectPlan(lastAddress: String?, attempt: Int): ReconnectPlan? {
    if (lastAddress == null) {
        return null
    }
    // [attempt] is accepted for the retry bridge and diagnostics only: the plan
    // must not depend on it, which is exactly the bug this replaced.
    require(attempt >= 1) { "attempt is 1-based" }
    return ReconnectPlan.Connect(lastAddress)
}
