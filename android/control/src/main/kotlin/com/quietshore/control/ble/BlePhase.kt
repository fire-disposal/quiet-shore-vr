package com.quietshore.control.ble

/**
 * Connection phases shared by the UI and the Web viewport.
 *
 * [wire] is the exact string the controller page expects in
 * `window.qsControl.onBleState(state)`; [IDLE] is local-only and never sent.
 */
enum class BlePhase(val wire: String?) {
    IDLE(null),
    SCANNING("scanning"),
    CONNECTING("connecting"),
    AUTHENTICATING("authenticating"),
    READY("ready"),
    ERROR("error"),
    DISCONNECTED("disconnected");

    val isBusy: Boolean get() = this == CONNECTING || this == AUTHENTICATING

    val isConnected: Boolean get() = this == READY
}
