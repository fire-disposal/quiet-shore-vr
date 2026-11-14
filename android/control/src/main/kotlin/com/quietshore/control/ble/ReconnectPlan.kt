package com.quietshore.control.ble

/**
 * The headset address an automatic reconnect attempt must dial.
 *
 * The recovery loop has one shape for every attempt: go back to the headset the
 * operator already chose. There is deliberately no "scan instead" outcome — a
 * scan cannot restore a link, it only redraws the pairing list.
 *
 * @return the address to connect to, or null when there is none to return to
 *   (the caller then hands the screen back to the operator).
 */
internal fun reconnectAddress(lastAddress: String?, attempt: Int): String? {
    if (lastAddress == null) {
        return null
    }
    // [attempt] is accepted for the retry bridge and diagnostics only: the
    // address must not depend on it, which is exactly the bug this replaced.
    require(attempt >= 1) { "attempt is 1-based" }
    return lastAddress
}
