package com.quietshore.control.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.content.Context
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import no.nordicsemi.android.ble.BleManager
import java.nio.charset.StandardCharsets

/**
 * Central side of the headset GATT profile.
 *
 * The peripheral exposes one writable command characteristic and three
 * notifying characteristics. Telemetry is a fixed 20 byte little endian
 * payload, so no MTU negotiation is required.
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

    override fun getGattCallback(): BleManager.BleManagerGattCallback =
        object : BleManager.BleManagerGattCallback() {

        override fun isRequiredServiceSupported(gatt: BluetoothGatt): Boolean {
            val service = gatt.getService(ControlProtocol.serviceUuid) ?: return false
            commandCharacteristic = service.getCharacteristic(ControlProtocol.commandUuid)
            statusCharacteristic = service.getCharacteristic(ControlProtocol.statusUuid)
            telemetryCharacteristic = service.getCharacteristic(ControlProtocol.telemetryUuid)
            stateCharacteristic = service.getCharacteristic(ControlProtocol.stateUuid)
            commandCharacteristic?.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
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
                    ControlProtocol.decodeState(String(bytes, StandardCharsets.UTF_8))
                        ?.let(events::onControlState)
                }
            }

            beginAtomicRequestQueue()
                .add(enableNotifications(status))
                .add(enableNotifications(telemetry))
                .add(enableNotifications(state))
                .done { events.onNotificationsEnabled() }
                .fail { _, code -> events.onFailure("启用头显通知失败，错误码 $code") }
                .enqueue()
        }

        override fun onServicesInvalidated() {
            commandCharacteristic = null
            statusCharacteristic = null
            telemetryCharacteristic = null
            stateCharacteristic = null
        }
    }

    fun claim() {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            events.onFailure("头显尚未就绪")
            return
        }
        writeCharacteristic(characteristic, ControlProtocol.claimPayload())
            .timeout(WRITE_TIMEOUT_MS)
            .fail { _, code -> events.onFailure("发送接管请求失败，错误码 $code") }
            .enqueue()
    }

    fun writeCommand(command: String) {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            events.onFailure("头显尚未就绪")
            return
        }
        writeCharacteristic(characteristic, ControlProtocol.commandPayload(command))
            .timeout(WRITE_TIMEOUT_MS)
            .fail { _, code -> events.onFailure("发送命令失败，错误码 $code") }
            .enqueue()
    }

    /** Tells the headset to drop this tablet, then closes the link. */
    fun releaseThenDisconnect() {
        val characteristic = commandCharacteristic
        if (characteristic == null) {
            disconnectQuietly()
            return
        }
        writeCharacteristic(characteristic, ControlProtocol.releasePayload())
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
