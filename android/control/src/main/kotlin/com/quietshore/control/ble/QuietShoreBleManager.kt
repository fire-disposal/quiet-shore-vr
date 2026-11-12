package com.quietshore.control.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.content.Context
import android.util.Log
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.protocol.JsonAssembler
import no.nordicsemi.android.ble.BleManager
import no.nordicsemi.android.ble.ConnectionPriorityRequest
import java.nio.charset.StandardCharsets

/**
 * Central side of the headset GATT profile.
 *
 * The peripheral exposes one writable command characteristic and four
 * notifying characteristics. Telemetry is a fixed 24 byte little endian
 * payload (x, y, z, yaw, pitch, roll) and the v13 state frame is 28 bytes, so
 * bring-up requests a widened ATT MTU before notifications start: at the
 * default MTU 23 a notification carries 20 bytes and every state frame would
 * be truncated.
 *
 * Every write is `WRITE_TYPE_DEFAULT` (write with response): a discrete command
 * is acked by the headset over the status characteristic, and the ATT response
 * proves the controller accepted the frame.
 */
class QuietShoreBleManager(
    context: Context,
    private val events: Events
) : BleManager(context) {

    interface Events {
        /** Negotiated ATT MTU, or [code] non-zero when the request failed. */
        fun onMtu(mtu: Int, code: Int)
        fun onNotificationsEnabled()
        fun onStatus(raw: String)
        fun onTelemetry(pose: TelemetryPose)
        fun onControlState(state: ControlState)
        /** One JSON-channel document: `topic` + its JSON payload. */
        fun onJson(topic: String, data: String)
        fun onSignal(rssi: Int)
        fun onFailure(message: String)
    }

    private var commandCharacteristic: BluetoothGattCharacteristic? = null
    private var statusCharacteristic: BluetoothGattCharacteristic? = null
    private var telemetryCharacteristic: BluetoothGattCharacteristic? = null
    private var stateCharacteristic: BluetoothGattCharacteristic? = null
    private var jsonCharacteristic: BluetoothGattCharacteristic? = null
    /** Partials of the chunked JSON channel; cleared on every new connection. */
    private val jsonAssembler = JsonAssembler()

    /** Set once per connection so `CONNECTION_PRIORITY_HIGH` is not re-sent. */
    private var highPriorityRequested = false
    /** Refused requests; the stack sometimes needs a second or third ask. */
    private var highPriorityAttempts = 0
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun getGattCallback(): BleManager.BleManagerGattCallback =
        object : BleManager.BleManagerGattCallback() {

        override fun isRequiredServiceSupported(gatt: BluetoothGatt): Boolean {
            val service = gatt.getService(ControlProtocol.serviceUuid) ?: return false
            commandCharacteristic = service.getCharacteristic(ControlProtocol.commandUuid)
            statusCharacteristic = service.getCharacteristic(ControlProtocol.statusUuid)
            telemetryCharacteristic = service.getCharacteristic(ControlProtocol.telemetryUuid)
            stateCharacteristic = service.getCharacteristic(ControlProtocol.stateUuid)
            jsonCharacteristic = service.getCharacteristic(ControlProtocol.susUuid)
            // SUS is optional: a headset that predates the characteristic keeps
            // working, it simply never reports a sheet.
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
            jsonCharacteristic?.let { characteristic ->
                setNotificationCallback(characteristic).with { _, data ->
                    data.value?.let { bytes ->
                        // Chunk first, parse second: a document may span several
                        // notifications, and a damaged one is dropped whole.
                        jsonAssembler.add(bytes)?.let { document ->
                            val json = String(document, StandardCharsets.UTF_8)
                            try {
                                val root = org.json.JSONObject(json)
                                events.onJson(root.optString("t"), root.optJSONObject("d")?.toString() ?: json)
                            } catch (error: org.json.JSONException) {
                                // A malformed document is ignored; the next one supersedes it.
                            }
                        }
                    }
                }
            }

            // v12 state frames are 40 bytes, which needs an ATT MTU of 43+.
            // Negotiate it *first* and only then enable notifications: a
            // request enqueued alongside an atomic queue can be dropped, and a
            // dropped MTU silently truncated every state frame afterwards.
            val startNotifications = {
                val queue = beginAtomicRequestQueue()
                    .add(enableNotifications(status))
                    .add(enableNotifications(telemetry))
                    .add(enableNotifications(state))
                jsonCharacteristic?.let { queue.add(enableNotifications(it)) }
                queue
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
            // Both outcomes must continue into the notification queue: on the
            // success path the old code never did, so the link sat in
            // AUTHENTICATING until the watchdog gave up.
            var notificationsStarted = false
            fun continueAfterMtu() {
                if (notificationsStarted) {
                    return
                }
                notificationsStarted = true
                startNotifications()
            }
            requestMtu(REQUEST_MTU)
                .with { _, negotiated ->
                    events.onMtu(negotiated, 0)
                    continueAfterMtu()
                }
                .fail { _, code ->
                    // A narrow MTU does not stop the link, but the state frame
                    // will not fit: say so instead of failing silently.
                    events.onMtu(0, code)
                    continueAfterMtu()
                }
                .enqueue()
        }

        override fun onServicesInvalidated() {
            commandCharacteristic = null
            statusCharacteristic = null
            telemetryCharacteristic = null
            stateCharacteristic = null
            jsonCharacteristic = null
            jsonAssembler.reset()
            highPriorityRequested = false
            highPriorityAttempts = 0
        }
    }

    /** Asks for a high connection priority, retrying a refused request. */
    private fun requestHighPriority() {
        if (highPriorityRequested || highPriorityAttempts >= HIGH_PRIORITY_ATTEMPTS) {
            return
        }
        highPriorityRequested = true
        requestConnectionPriority(ConnectionPriorityRequest.CONNECTION_PRIORITY_HIGH)
            .fail { _, code ->
                highPriorityRequested = false
                highPriorityAttempts++
                // Several stacks (Huawei/EMUI among them) refuse the first
                // request right after service discovery. Left at the default
                // 40-50 ms interval, every tap, every ACK and every 24-byte
                // telemetry frame waits a full connection event — which is
                // exactly the sluggishness an operator reports. Retry with a
                // growing delay instead of giving up after one refusal.
                Log.w(TAG, "connection priority refused ($code), attempt $highPriorityAttempts")
                if (highPriorityAttempts < HIGH_PRIORITY_ATTEMPTS) {
                    mainHandler.postDelayed(
                        { if (isReady) requestHighPriority() },
                        1000L shl (highPriorityAttempts - 1)
                    )
                }
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
        // Every command is discrete now, so every write keeps its ATT response
        // and cannot be silently lost.
        val request = writeCharacteristic(
            characteristic,
            ControlProtocol.commandPayload(command),
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        ).timeout(WRITE_TIMEOUT_MS)
        request.done { onComplete(true) }
        request.fail { _, code ->
            events.onFailure("发送命令失败，错误码 $code")
            onComplete(false)
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
        const val TAG = "QuietShoreBle"
        const val WRITE_TIMEOUT_MS = 6000L
        /** Covers the 28-byte v13 state frame with room for the SUS JSON split. */
        const val REQUEST_MTU = 128
        /** Huawei/EMUI and a few other stacks refuse the first ask or two. */
        const val HIGH_PRIORITY_ATTEMPTS = 3
    }
}
