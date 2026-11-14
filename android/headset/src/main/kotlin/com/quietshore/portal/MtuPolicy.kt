package com.quietshore.portal

import com.quietshore.control.protocol.ControlProtocol

/**
 * Which ATT MTU the JSON channel publishes at.
 *
 * The MTU is a property of one GATT **link**, not of the server, but the
 * publisher is shared: every document is chunked for whatever link happens to
 * own the console. The bug this type exists to prevent had two halves, and both
 * produced notifications the stack rejects:
 *
 * 1. A teardown (Bluetooth off, service restart, GATT failure) left the last
 *    negotiated value in place, so the first notification on a *new*,
 *    un-negotiated link was chunked for 517 bytes.
 * 2. Any connected device could raise the value through `onMtuChanged`, even a
 *    second tablet that never held control.
 *
 * The rule: the active value belongs to the controller. It starts at
 * [ControlProtocol.ATT_MTU_MIN], follows only the controller's own report, and
 * goes back to the default whenever the console is released or the server is
 * torn down. Other links keep their own numbers, so a tablet that claims later
 * gets the value *it* negotiated rather than a sibling's.
 *
 * Not thread safe: `BluetoothControl` calls it under its `controlLock`.
 */
internal class MtuPolicy {
    /** Active chunk size for the current controller's link. */
    var current: Int = ControlProtocol.ATT_MTU_MIN
        private set

    /** Last value each link reported, so a returning owner restores its own. */
    private val byAddress = HashMap<String, Int>()

    /**
     * A link reported a negotiated MTU. Only the controller's link changes the
     * value the console publishes at; everyone else just records it.
     */
    fun onMtuChanged(address: String, negotiatedMtu: Int, controller: String?) {
        val size = negotiatedMtu.coerceAtLeast(ControlProtocol.ATT_MTU_MIN)
        byAddress[address] = size
        if (address == controller) {
            current = size
        }
    }

    /** A new owner: publish at whatever that link last negotiated. */
    fun onClaim(address: String) {
        current = byAddress[address] ?: ControlProtocol.ATT_MTU_MIN
    }

    /** Nobody owns the console: back to the default. */
    fun onRelease() {
        current = ControlProtocol.ATT_MTU_MIN
    }

    /**
     * A link went away. Its negotiated value leaves with it; if it was the
     * controller's, the active value returns to the default (the console is
     * released in the same step).
     */
    fun onDisconnected(address: String, controller: String?) {
        byAddress.remove(address)
        if (address == controller) {
            current = ControlProtocol.ATT_MTU_MIN
        }
    }

    /** Server teardown: nothing survives into the next link. */
    fun onTeardown() {
        byAddress.clear()
        current = ControlProtocol.ATT_MTU_MIN
    }

    /** Bytes of document payload per notification on the active link. */
    fun chunkPayload(): Int = ControlProtocol.jsonChunkPayload(current)
}
