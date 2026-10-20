package com.quietshore.portal

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.os.Handler
import android.os.Looper
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

/**
 * BLE peripheral for the tablet console.
 *
 * command   write       CLAIM / RELEASE / <command>
 * status    read/notify "CONNECTED", "CONTROL_OK", "CONTROL_BUSY",
 *                       "CONTROL_RELEASED", "CONTROL_REQUIRED", "OK:<cmd>"
 * telemetry read/notify 20 bytes LE float32: x, y, z, yaw, pitch
 * state     read/notify "scene|session|calib|audio"
 *
 * First-claim control: exactly one connected pad owns the console. The first
 * CLAIM wins; later pads get CONTROL_BUSY until the owner sends RELEASE or
 * disconnects. Only the controller may send commands, and only the controller
 * receives telemetry and state notifications.
 *
 * All payload encodings come from the shared [ControlProtocol], so the
 * tablet module cannot drift from this peripheral.
 */
internal class BluetoothControl(
    context: Context,
    private val listener: Listener
) {
    interface Listener {
        /** Returns true only when the command passed semantic routing. */
        fun onCommand(command: String): Boolean

        fun onControlMode(active: Boolean)

        /** Advertising/GATT lifecycle state, mirroring [state]. */
        fun onStateChanged(state: String) {}
    }

    private companion object {
        const val TAG = "QuietShoreBle"
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val STATE_ADVERTISING = "advertising"
        const val WATCHDOG_INTERVAL_MS = 5_000L
        const val CONTROLLER_TIMEOUT_MS = 20_000L
    }

    private val appContext: Context = context.applicationContext ?: context
    private val connected = CopyOnWriteArraySet<String>()
    private val controlLock = Any()

    @Volatile
    private var controller: String? = null

    private val watchdogHandler = Handler(Looper.getMainLooper())
    @Volatile
    private var lastControllerActivity = 0L
    private val controllerWatchdog = object : Runnable {
        override fun run() {
            val active = synchronized(controlLock) { controller }
            if (active == null) {
                return
            }
            if (android.os.SystemClock.elapsedRealtime() - lastControllerActivity > CONTROLLER_TIMEOUT_MS) {
                synchronized(controlLock) {
                    if (controller == active) {
                        controller = null
                    }
                }
                listener.onControlMode(false)
                // Tell the timed-out controller, not every connected tablet.
                remoteDevice(active)?.let { device ->
                    notifyValueTo(
                        device,
                        statusCharacteristic,
                        ControlProtocol.STATUS_CONTROL_RELEASED.toByteArray(StandardCharsets.UTF_8)
                    )
                }
                return
            }
            watchdogHandler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    private var adapter: BluetoothAdapter? = null
    private var server: BluetoothGattServer? = null
    private var commandCharacteristic: BluetoothGattCharacteristic? = null
    private var statusCharacteristic: BluetoothGattCharacteristic? = null
    private var telemetryCharacteristic: BluetoothGattCharacteristic? = null
    private var stateCharacteristic: BluetoothGattCharacteristic? = null
    private var advertiser: BluetoothLeAdvertiser? = null

    @Volatile
    private var lifecycleState: String = "starting"

    @Volatile
    private var lastState: ControlState = ControlState()

    private var started = false

    val state: String
        get() = lifecycleState

    @Synchronized
    fun start() {
        if (started) {
            return
        }
        started = true
        try {
            val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = manager?.adapter
            this.adapter = adapter
            if (manager == null || adapter == null || !adapter.isEnabled) {
                setState("bluetooth-off")
                return
            }
            if (!adapter.isMultipleAdvertisementSupported) {
                setState("ble-peripheral-unsupported")
                return
            }
            try {
                adapter.setName(ControlProtocol.deviceName)
            } catch (ignored: RuntimeException) {
                // Vendor builds may restrict renaming; advertising still works.
            }

            val server = manager.openGattServer(appContext, callback)
            if (server == null) {
                setState("gatt-open-failed")
                return
            }
            this.server = server

            val service = BluetoothGattService(
                ControlProtocol.serviceUuid,
                BluetoothGattService.SERVICE_TYPE_PRIMARY
            )

            val command = BluetoothGattCharacteristic(
                ControlProtocol.commandUuid,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                    BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            val status = notifyCharacteristic(
                ControlProtocol.statusUuid,
                "ready".toByteArray(StandardCharsets.UTF_8)
            )
            val telemetry = notifyCharacteristic(
                ControlProtocol.telemetryUuid,
                ByteArray(ControlProtocol.telemetryBytes)
            )
            val state = notifyCharacteristic(
                ControlProtocol.stateUuid,
                ControlProtocol.encodeState(lastState)
            )

            commandCharacteristic = command
            statusCharacteristic = status
            telemetryCharacteristic = telemetry
            stateCharacteristic = state

            service.addCharacteristic(command)
            service.addCharacteristic(status)
            service.addCharacteristic(telemetry)
            service.addCharacteristic(state)
            if (!server.addService(service)) {
                setState("gatt-add-service-failed")
                return
            }

            val advertiser = adapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                setState("ble-advertiser-unavailable")
                return
            }
            this.advertiser = advertiser
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .setConnectable(true)
                .setTimeout(0)
                .build()
            val data = AdvertiseData.Builder()
                .addServiceUuid(ParcelUuid(ControlProtocol.serviceUuid))
                .build()
            val scanResponse = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .build()
            advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback)
            setState(STATE_ADVERTISING)
        } catch (error: RuntimeException) {
            setState("error")
            Log.w(TAG, "BLE start failed: ${error.message}")
        }
    }

    private fun notifyCharacteristic(uuid: UUID, initialValue: ByteArray): BluetoothGattCharacteristic {
        val characteristic = BluetoothGattCharacteristic(
            uuid,
            BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        characteristic.addDescriptor(
            BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or
                    BluetoothGattDescriptor.PERMISSION_WRITE
            )
        )
        characteristic.value = initialValue
        return characteristic
    }

    @Synchronized
    fun stop() {
        watchdogHandler.removeCallbacks(controllerWatchdog)
        if (!started) {
            return
        }
        started = false
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (ignored: RuntimeException) {
            // already stopped
        }
        try {
            server?.clearServices()
            server?.close()
        } catch (ignored: RuntimeException) {
            // already closed
        }
        connected.clear()
        synchronized(controlLock) { controller = null }
        advertiser = null
        server = null
        setState("stopped")
        listener.onControlMode(false)
    }

    fun publishTelemetry(pose: TelemetryPose) {
        notifyValue(telemetryCharacteristic, ControlProtocol.encodeTelemetry(pose))
    }

    fun publishState(state: ControlState) {
        lastState = state
        notifyValue(stateCharacteristic, ControlProtocol.encodeState(state))
    }

    private fun setState(value: String) {
        lifecycleState = value
        listener.onStateChanged(value)
    }

    /** Telemetry and state go only to the current controller. */
    private fun notifyValue(
        characteristic: BluetoothGattCharacteristic?,
        value: ByteArray
    ) {
        val target = characteristic ?: return
        val address = synchronized(controlLock) { controller } ?: return
        val device = remoteDevice(address) ?: return
        notifyValueTo(device, target, value)
    }

    /** Notify exactly one client; command replies must never reach siblings. */
    private fun notifyValueTo(
        device: BluetoothDevice,
        characteristic: BluetoothGattCharacteristic?,
        value: ByteArray
    ) {
        val target = characteristic ?: return
        val gatt = server ?: return
        target.value = value
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.notifyCharacteristicChanged(device, target, false, value)
            } else {
                @Suppress("DEPRECATION")
                gatt.notifyCharacteristicChanged(device, target, false)
            }
        } catch (ignored: RuntimeException) {
            // client went away
        }
    }

    /** BLE address of the pad that currently owns the console, if any. */
    fun controllerAddress(): String? = synchronized(controlLock) { controller }

    private fun touchController() {
        lastControllerActivity = android.os.SystemClock.elapsedRealtime()
    }

    private fun isController(device: BluetoothDevice): Boolean {
        val address = addressOf(device) ?: return false
        return synchronized(controlLock) { controller == address }
    }

    /** Grants control when free; idempotent for the current controller. */
    private fun handleClaim(device: BluetoothDevice): String {
        val address = addressOf(device) ?: return ControlProtocol.STATUS_CONTROL_REQUIRED
        val changed = synchronized(controlLock) {
            val current = controller
            if (current == null || current == address) {
                controller = address
                current == null
            } else if (current !in connected) {
                // The old controller is no longer on any live GATT link
                // (BLE random address rotated or the pad process restarted).
                controller = address
                true
            } else {
                return ControlProtocol.STATUS_CONTROL_BUSY
            }
        }
        if (changed) {
            touchController()
            watchdogHandler.removeCallbacks(controllerWatchdog)
            watchdogHandler.postDelayed(controllerWatchdog, WATCHDOG_INTERVAL_MS)
            listener.onControlMode(true)
        }
        // Always replay the snapshot: a reconnecting tablet may have missed
        // the 1 Hz state while notifications were being enabled.
        notifyValue(stateCharacteristic, ControlProtocol.encodeState(lastState))
        return ControlProtocol.STATUS_CONTROL_OK
    }

    private fun handleRelease(device: BluetoothDevice): String {
        val address = addressOf(device) ?: return ControlProtocol.STATUS_CONTROL_REQUIRED
        val released = synchronized(controlLock) {
            if (controller == address) {
                controller = null
                true
            } else {
                false
            }
        }
        if (!released) {
            return ControlProtocol.STATUS_CONTROL_REQUIRED
        }
        watchdogHandler.removeCallbacks(controllerWatchdog)
        listener.onControlMode(false)
        return ControlProtocol.STATUS_CONTROL_RELEASED
    }

    private fun handleWrite(device: BluetoothDevice, requestId: Int, value: ByteArray) {
        val raw = String(value, StandardCharsets.UTF_8).trim()
        val reply = when (raw) {
            ControlProtocol.CLAIM -> handleClaim(device)
            ControlProtocol.RELEASE -> handleRelease(device)
            ControlProtocol.PING -> {
                if (!isController(device)) {
                    ControlProtocol.STATUS_CONTROL_REQUIRED
                } else {
                    touchController()
                    ControlProtocol.PONG
                }
            }
            else -> {
                val command = ControlProtocol.parseCommand(raw)
                when {
                    command == null || !isController(device) -> ControlProtocol.STATUS_CONTROL_REQUIRED
                    !ControlProtocol.isAllowedCommand(command) -> ControlProtocol.STATUS_COMMAND_REJECTED
                    else -> {
                        touchController()
                        if (!listener.onCommand(command)) {
                            ControlProtocol.STATUS_COMMAND_REJECTED
                        } else if (command.startsWith(ControlProtocol.VIEW_MOVE)) {
                            // 10 Hz stream: keep the GATT write response but
                            // spend no status notification per sample.
                            if (requestId != 0) {
                                sendResponse(
                                    device,
                                    requestId,
                                    BluetoothGatt.GATT_SUCCESS,
                                    0,
                                    ByteArray(0)
                                )
                            }
                            return
                        } else {
                            "OK:$command"
                        }
                    }
                }
            }
        }
        replyWrite(device, requestId, reply)
    }

    private fun replyWrite(device: BluetoothDevice, requestId: Int, reply: String) {
        // Replies are per-request. Broadcasting CONTROL_BUSY / CONTROL_REQUIRED
        // made the current controller tear down its own link when a second
        // tablet tried to claim or wrote while unprivileged.
        notifyValueTo(
            device,
            statusCharacteristic,
            reply.toByteArray(StandardCharsets.UTF_8)
        )
        if (requestId != 0) {
            sendResponse(
                device,
                requestId,
                BluetoothGatt.GATT_SUCCESS,
                0,
                reply.toByteArray(StandardCharsets.UTF_8)
            )
        }
    }

    private fun sendResponse(
        device: BluetoothDevice,
        requestId: Int,
        status: Int,
        offset: Int,
        value: ByteArray
    ) {
        val gatt = server ?: return
        try {
            gatt.sendResponse(device, requestId, status, offset, value)
        } catch (ignored: RuntimeException) {
            // client went away
        }
    }

    private fun addressOf(device: BluetoothDevice): String? = try {
        device.address
    } catch (ignored: RuntimeException) {
        null
    }

    private fun remoteDevice(address: String): BluetoothDevice? = try {
        adapter?.getRemoteDevice(address)
    } catch (ignored: RuntimeException) {
        null
    }

    private val callback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val address = addressOf(device) ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connected.add(address)
                notifyValueTo(
                    device,
                    statusCharacteristic,
                    ControlProtocol.STATUS_CONNECTED.toByteArray(StandardCharsets.UTF_8)
                )
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connected.remove(address)
                val released = synchronized(controlLock) {
                    if (controller == address) {
                        controller = null
                        true
                    } else {
                        false
                    }
                }
                if (released) {
                    watchdogHandler.removeCallbacks(controllerWatchdog)
                    // A dropped controller frees the console for the next pad.
                    listener.onControlMode(false)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (characteristic.uuid == ControlProtocol.commandUuid) {
                handleWrite(device, if (responseNeeded) requestId else 0, value)
            } else if (responseNeeded) {
                sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            sendResponse(
                device,
                requestId,
                BluetoothGatt.GATT_SUCCESS,
                offset,
                characteristic.value ?: ByteArray(0)
            )
        }

        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor
        ) {
            sendResponse(
                device,
                requestId,
                BluetoothGatt.GATT_SUCCESS,
                offset,
                descriptor.value ?: BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            )
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            descriptor.value = value
            if (responseNeeded) {
                sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            setState(STATE_ADVERTISING)
            Log.i(TAG, "BLE advertising as ${ControlProtocol.deviceName}")
        }

        override fun onStartFailure(errorCode: Int) {
            setState("advertise-failed:$errorCode")
            Log.w(TAG, "BLE advertise failed: $errorCode")
        }
    }
}
