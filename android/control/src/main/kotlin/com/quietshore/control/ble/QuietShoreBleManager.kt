package com.quietshore.control.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.content.Context
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import no.nordicsemi.android.ble.BleManager
import no.nordicsemi.android.ble.ConnectionPriorityRequest
import java.nio.charset.StandardCharsets

/**
 * Central side of the headset GATT profile.
 *
 * The peripheral exposes one writable command characteristic and three
 * notifying characteristics. Telemetry is a fixed 20 byte little endian
 * payload, so no MTU negotiation is required.
 *
 * The 10 Hz `view:move` stream is written with `WRITE_TYPE_NO_RESPONSE`; every
 * discrete command keeps `WRITE_TYPE_DEFAULT` so its ATT response still proves
 * the headset accepted it. The write type travels with each request instead of
 * being stored on the shared characteristic, so a move sample can never make a
 * discrete write fire-and-forget.
 */
class QuietShoreBleManager(
    context: Context,
    private val events: Events
) : BleManager(context) {

    interface Events {
        fun onNotificationsEnabled()
        fun onStatus(raw: String)
        fun onTelemetry(pose: TelemetryPose)
        fun onControlState(state: ControlState)
        fun onSignal(rssi: Int)
        fun onFailure(message: String)
    }

    private var commandCharacteristic: BluetoothGattCharacteristic? = null
    private var statusCharacteristic: BluetoothGattCharacteristic? = null
    private var telemetryCharacteristic: BluetoothGattCharacteristic? = null
    private var stateCharacteristic: BluetoothGattCharacteristic? = null

    /** Set once per connection so `CONNECTION_PRIORITY_HIGH` is not re-sent. */
    private var highPriorityRequested = false

    override fun getGattCallback(): BleManager.BleManagerGattCallback =
        object : BleManager.BleManagerGattCallback() {

        override fun isRequiredServiceSupported(gatt: BluetoothGatt): Boolean {
            val service = gatt.getService(ControlProtocol.serviceUuid) ?: return false
            commandCharacteristic = service.getCharacteristic(ControlProtocol.commandUuid)
            statusCharacteristic = service.getCharacteristic(ControlProtocol.statusUuid)
            telemetryCharacteristic = service.getCharacteristic(ControlProtocol.telemetryUuid)
            stateCharacteristic = service.getCharacteristic(ControlProtocol.stateUuid)
            return commandCharacteristic != null &&
                statusCharacteristic != null &&
                telemetryCharacteristic != null &&
                stateCharacteristic != null
        }

        override fun initialize() {
            val status = statusCharacteristic
            val telemetry = telemetryCharacteristic
            val state = stateCharacteristic
            if (status == null || telemetry == null || state == null) {
                events.onFailure("头显服务不完整")
                return
            }

            setNotificationCallback(status).with { _, data ->
                data.value?.let { bytes ->
                    if (bytes.isNotEmpty()) {
                        events.onStatus(String(bytes, StandardCharsets.UTF_8).trim())
                    }
                }
            }
            setNotificationCallback(telemetry).with { _, data ->
                data.value?.let { bytes ->
                    ControlProtocol.decodeTelemetry(bytes)?.let(events::onTelemetry)
                }
            }
            setNotificationCallback(state).with { _, data ->
                data.value?.let { bytes ->
                    ControlProtocol.decodeState(bytes)?.let(events::onControlState)
                }
            }

            beginAtomicRequestQueue()
                .add(enableNotifications(status))
                .add(enableNotifications(telemetry))
                .add(enableNotifications(state))
                .done {
                    // Once per connection, after notifications are live: the
                    // shortest connection interval the headset accepts keeps
                    // the 10 Hz movement stream and state readback responsive.
                    requestHighPriority()
                    events.onNotificationsEnabled()
                }
                .fail { _, code -> events.onFailure("启用头显通知失败，错误码 $code") }
                .enqueue()
        }

        override fun onServicesInvalidated() {
            commandCharacteristic = null
            statusCharacteristic = null
            telemetryCharacteristic = null
            stateCharacteristic = null
            highPriorityRequested = false
        }
    }

    /** Asks for a high connection priority exactly once per connection. */
    private fun requestHighPriority() {
        if (highPriorityRequested) {
            return
        }
        highPriorityRequested = true
        requestConnectionPriority(ConnectionPriorityRequest.CONNECTION_PRIORITY_HIGH)
            .fail { _, _ ->
                // Some stacks refuse the request; the link stays usable.
                highPriorityRequested = false
            }
            .enqueue()
    }

    fun claim() {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            events.onFailure("头显尚未就绪")
            return
        }
        writeCharacteristic(
            characteristic,
            ControlProtocol.claimPayload(),
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        )
            .timeout(WRITE_TIMEOUT_MS)
            .fail { _, code -> events.onFailure("发送接管请求失败，错误码 $code") }
            .enqueue()
    }

    /**
     * Writes one command payload and reports completion exactly once.
     *
     * The caller ([com.quietshore.control.ble.BleController]) is the single
     * writer: it keeps one write in flight so a queued pitch sample can never
     * delay a stop.
     */
    fun writeCommand(command: String, onComplete: (Boolean) -> Unit = {}) {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            events.onFailure("头显尚未就绪")
            onComplete(false)
            return
        }
        // Continuous pitch targets are fire-and-forget: waiting for an ATT
        // response at 10 Hz would queue samples behind the link interval. Every
        // discrete command keeps the response so it cannot be silently lost.
        val continuous = command.startsWith(ControlProtocol.VIEW_MOVE)
        val request = writeCharacteristic(
            characteristic,
            ControlProtocol.commandPayload(command),
            if (continuous) {
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            } else {
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            }
        ).timeout(WRITE_TIMEOUT_MS)
        request.done { onComplete(true) }
        if (continuous) {
            // A dropped movement sample is harmless (the next one supersedes
            // it), so it never raises an operator-visible error.
            request.fail { _, _ -> onComplete(false) }
        } else {
            request.fail { _, code ->
                events.onFailure("发送命令失败，错误码 $code")
                onComplete(false)
            }
        }
        request.enqueue()
    }

    /** Tells the headset to drop this tablet, then closes the link. */
    fun releaseThenDisconnect() {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            disconnectQuietly()
            return
        }
        writeCharacteristic(
            characteristic,
            ControlProtocol.releasePayload(),
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        )
            .timeout(WRITE_TIMEOUT_MS)
            .done { disconnectQuietly() }
            .fail { _, _ -> disconnectQuietly() }
            .enqueue()
    }

    fun readSignal() {
        if (!isReady) {
            return
        }
        readRssi()
            .with { _, rssi -> events.onSignal(rssi) }
            .fail { _, _ -> }
            .enqueue()
    }

    private fun disconnectQuietly() {
        try {
            disconnect().enqueue()
        } catch (error: RuntimeException) {
            // The link was already gone.
        }
    }

    private companion object {
        const val WRITE_TIMEOUT_MS = 6000L
    }
}
