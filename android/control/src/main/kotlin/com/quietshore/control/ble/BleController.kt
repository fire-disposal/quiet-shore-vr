package com.quietshore.control.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.SystemClock
import android.os.Looper
import android.os.ParcelUuid
import com.quietshore.control.model.DiscoveredDevice
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import no.nordicsemi.android.ble.ConnectRequest
import no.nordicsemi.android.ble.observer.ConnectionObserver

/**
 * Central for the headset control service.
 *
 * Control is first-claim: after notifications are enabled the tablet sends
 * CLAIM and waits for CONTROL_OK. The headset grants exactly one controller,
 * so a second tablet receives CONTROL_BUSY and stays in pairing.
 */
class BleController(
    context: Context,
    private val listener: Listener
) {

    interface Listener {
        fun onPhase(phase: BlePhase)
        fun onDevices(devices: List<DiscoveredDevice>)
        fun onControlGranted()
        fun onControlBusy(reason: String)
        fun onControlLost(reason: String)
        fun onDisconnected()
        fun onTelemetry(pose: TelemetryPose)
        fun onControlState(state: ControlState)
        fun onSignal(rssi: Int)
        fun onStatus(raw: String)
        fun onError(message: String)
    }

    private val appContext: Context = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val bluetoothManager =
        appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = bluetoothManager?.adapter

    private val found = LinkedHashMap<String, DiscoveredDevice>()
    private var scanCallback: ScanCallback? = null
    private var phase = BlePhase.IDLE

    private var manager: QuietShoreBleManager? = null
    private var pendingConnect: ConnectRequest? = null
    private var awaitingControl = false

    private var heartbeatRunning = false
    private var lastPongAt = 0L
    private val heartbeat = object : Runnable {
        override fun run() {
            if (phase != BlePhase.READY) {
                heartbeatRunning = false
                return
            }
            if (SystemClock.elapsedRealtime() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
                heartbeatRunning = false
                listener.onControlLost("蓝牙心跳超时，请重新连接")
                closeConnection()
                return
            }
            manager?.writeCommand(ControlProtocol.PING)
            mainHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    private val scanWindow = Runnable { stopScan() }
    private val claimTimeout = Runnable {
        if (!awaitingControl) {
            return@Runnable
        }
        awaitingControl = false
        listener.onControlLost("未获得控制权，请重新连接")
        closeConnection()
    }

    fun startScan() {
        if (scanCallback != null) {
            return
        }
        val adapter = adapter
        if (adapter == null) {
            listener.onError("此设备不支持蓝牙")
            return
        }
        if (!adapter.isEnabled) {
            listener.onError("蓝牙未开启")
            setPhase(BlePhase.IDLE)
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            listener.onError("蓝牙搜索不可用")
            return
        }

        found.clear()
        listener.onDevices(emptyList())

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device ?: return
                val address = device.address ?: return
                val record = result.scanRecord
                val serviceMatch = record?.serviceUuids?.any {
                    it.uuid == ControlProtocol.serviceUuid
                } == true
                val deviceName = try {
                    device.name
                } catch (ignored: SecurityException) {
                    null
                }
                val nameMatch = record?.deviceName == ControlProtocol.deviceName ||
                    deviceName == ControlProtocol.deviceName
                if (!serviceMatch && !nameMatch) {
                    return
                }
                val discovered = DiscoveredDevice(address, result.rssi)
                mainHandler.post {
                    val previous = found[address]
                    if (previous == null || previous.rssi != discovered.rssi) {
                        found[address] = discovered
                        listener.onDevices(found.values.sortedByDescending { it.rssi })
                    }
                }
            }

            override fun onScanFailed(errorCode: Int) {
                mainHandler.post {
                    scanCallback = null
                    mainHandler.removeCallbacks(scanWindow)
                    setPhase(BlePhase.IDLE)
                    listener.onError("搜索失败，错误码 $errorCode")
                }
            }
        }

        // Do not rely on ScanFilter for the 128-bit service UUID: several
        // Android stacks only expose it in the scan record after the callback,
        // while the system Bluetooth UI still sees the device. Scan broadly
        // and match UUID/name inside onScanResult.
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        try {
            scanner.startScan(emptyList(), settings, callback)
        } catch (error: SecurityException) {
            listener.onError("缺少蓝牙搜索权限")
            return
        }
        scanCallback = callback
        setPhase(BlePhase.SCANNING)
        mainHandler.postDelayed(scanWindow, SCAN_WINDOW_MS)
    }

    fun stopScan() {
        val callback = scanCallback ?: return
        scanCallback = null
        mainHandler.removeCallbacks(scanWindow)
        try {
            adapter?.bluetoothLeScanner?.stopScan(callback)
        } catch (error: SecurityException) {
            // Permission was revoked mid scan; nothing left to stop.
        }
        if (phase == BlePhase.SCANNING) {
            setPhase(BlePhase.IDLE)
        }
    }

    fun connect(address: String) {
        stopScan()
        val adapter = adapter
        if (adapter == null) {
            listener.onError("此设备不支持蓝牙")
            return
        }
        if (!adapter.isEnabled) {
            listener.onError("蓝牙未开启")
            return
        }
        val device = try {
            adapter.getRemoteDevice(address)
        } catch (error: IllegalArgumentException) {
            listener.onError("找不到该设备")
            return
        }

        awaitingControl = false
        cancelClaimTimeout()
        closeManager()
        cancelPendingConnect()

        val events = ManagerEvents()
        val next = QuietShoreBleManager(appContext, events)
        events.owner = next
        next.setConnectionObserver(connectionObserverFor(next))
        manager = next

        setPhase(BlePhase.CONNECTING)
        try {
            val request = next.connect(device)
                .timeout(CONNECT_TIMEOUT_MS)
                .retry(2, RETRY_DELAY_MS)
                .useAutoConnect(false)
                .fail { _, code ->
                    mainHandler.post {
                        if (manager === next) {
                            onConnectFailed(code)
                        }
                    }
                }
            pendingConnect = request
            request.enqueue()
        } catch (error: SecurityException) {
            setPhase(BlePhase.ERROR)
            listener.onError("缺少蓝牙连接权限")
            closeManager()
        }
    }

    fun cancelConnect() {
        cancelPendingConnect()
        closeManager()
        awaitingControl = false
        cancelClaimTimeout()
        setPhase(BlePhase.DISCONNECTED)
    }

    /** Releases control on the headset, then closes the link. */
    fun disconnect() {
        stopScan()
        cancelClaimTimeout()
        awaitingControl = false
        val current = manager
        if (current == null) {
            setPhase(BlePhase.DISCONNECTED)
            listener.onDisconnected()
            return
        }
        current.releaseThenDisconnect()
    }

    fun sendCommand(command: String) {
        val current = manager
        if (current == null || !current.isReady) {
            listener.onError("头显未连接")
            return
        }
        current.writeCommand(command)
    }

    fun readSignal() {
        manager?.readSignal()
    }

    fun close() {
        stopHeartbeat()
        stopScan()
        cancelClaimTimeout()
        awaitingControl = false
        cancelPendingConnect()
        closeManager()
        phase = BlePhase.IDLE
    }

    private fun cancelPendingConnect() {
        val pending = pendingConnect
        pendingConnect = null
        try {
            pending?.cancelPendingConnection()
        } catch (error: RuntimeException) {
            // Already completed or cancelled.
        }
    }

    private fun closeManager() {
        val current = manager
        manager = null
        try {
            current?.close()
        } catch (error: RuntimeException) {
            // Already closed.
        }
    }

    /** Drops the link without claiming or releasing control. */
    private fun closeConnection() {
        stopHeartbeat()
        val current = manager
        if (current == null) {
            setPhase(BlePhase.DISCONNECTED)
            listener.onDisconnected()
            return
        }
        try {
            current.disconnect().enqueue()
        } catch (error: RuntimeException) {
            closeManager()
            setPhase(BlePhase.DISCONNECTED)
            listener.onDisconnected()
        }
    }

    private fun setPhase(next: BlePhase) {
        if (phase == next) {
            return
        }
        phase = next
        if (next == BlePhase.READY) {
            startHeartbeat()
        } else {
            stopHeartbeat()
        }
        listener.onPhase(next)
    }

    private fun startHeartbeat() {
        stopHeartbeat()
        heartbeatRunning = true
        lastPongAt = SystemClock.elapsedRealtime()
        mainHandler.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS)
    }

    private fun stopHeartbeat() {
        if (heartbeatRunning) {
            heartbeatRunning = false
            mainHandler.removeCallbacks(heartbeat)
        }
    }

    private fun onConnectFailed(code: Int) {
        if (phase == BlePhase.READY || phase == BlePhase.AUTHENTICATING) {
            return
        }
        if (manager == null) {
            return
        }
        pendingConnect = null
        closeManager()
        setPhase(BlePhase.ERROR)
        listener.onError("连接失败，错误码 $code")
    }

    private fun scheduleClaimTimeout() {
        mainHandler.removeCallbacks(claimTimeout)
        mainHandler.postDelayed(claimTimeout, CLAIM_TIMEOUT_MS)
    }

    private fun cancelClaimTimeout() {
        mainHandler.removeCallbacks(claimTimeout)
    }

    private fun handleStatus(raw: String) {
        if (raw == ControlProtocol.PONG) {
            lastPongAt = SystemClock.elapsedRealtime()
            return
        }
        when (raw) {
            ControlProtocol.STATUS_CONTROL_OK -> {
                cancelClaimTimeout()
                awaitingControl = false
                setPhase(BlePhase.READY)
                listener.onControlGranted()
            }

            ControlProtocol.STATUS_CONTROL_BUSY -> {
                cancelClaimTimeout()
                awaitingControl = false
                listener.onControlBusy("头显正被另一台平板控制")
                closeConnection()
            }

            ControlProtocol.STATUS_CONTROL_REQUIRED -> {
                cancelClaimTimeout()
                awaitingControl = false
                listener.onControlLost("控制连接已失效，请重新连接")
                closeConnection()
            }

            ControlProtocol.STATUS_CONTROL_RELEASED -> {
                listener.onControlLost("头显已释放控制权")
                closeConnection()
            }
            ControlProtocol.STATUS_CONNECTED -> listener.onStatus(raw)
            else -> listener.onStatus(raw)
        }
    }

    private fun handleDisconnected() {
        cancelClaimTimeout()
        awaitingControl = false
        closeManager()
        setPhase(BlePhase.DISCONNECTED)
        listener.onDisconnected()
    }

    private inner class ManagerEvents : QuietShoreBleManager.Events {
        var owner: QuietShoreBleManager? = null

        private fun isCurrent(): Boolean = owner != null && manager === owner

        override fun onNotificationsEnabled() {
            mainHandler.post {
                if (!isCurrent()) {
                    return@post
                }
                awaitingControl = true
                setPhase(BlePhase.AUTHENTICATING)
                manager?.claim()
                scheduleClaimTimeout()
            }
        }

        override fun onStatus(raw: String) {
            mainHandler.post {
                if (isCurrent()) {
                    handleStatus(raw)
                }
            }
        }

        override fun onTelemetry(pose: TelemetryPose) {
            if (isCurrent()) {
                listener.onTelemetry(pose)
            }
        }

        override fun onControlState(state: ControlState) {
            if (isCurrent()) {
                listener.onControlState(state)
            }
        }

        override fun onSignal(rssi: Int) {
            mainHandler.post {
                if (isCurrent()) {
                    listener.onSignal(rssi)
                }
            }
        }

        override fun onFailure(message: String) {
            mainHandler.post {
                if (!isCurrent()) {
                    return@post
                }
                if (phase.isBusy) {
                    setPhase(BlePhase.ERROR)
                }
                listener.onError(message)
            }
        }
    }

    private fun connectionObserverFor(owner: QuietShoreBleManager): ConnectionObserver =
        object : ConnectionObserver {
            private fun isCurrent(): Boolean = manager === owner

            override fun onDeviceConnecting(device: BluetoothDevice) {
                mainHandler.post {
                    if (isCurrent()) {
                        setPhase(BlePhase.CONNECTING)
                    }
                }
            }

            override fun onDeviceConnected(device: BluetoothDevice) {
                // Wait for service discovery before claiming control.
            }

            override fun onDeviceFailedToConnect(device: BluetoothDevice, reason: Int) {
                mainHandler.post {
                    if (isCurrent()) {
                        onConnectFailed(reason)
                    }
                }
            }

            override fun onDeviceReady(device: BluetoothDevice) {
                mainHandler.post {
                    if (isCurrent()) {
                        pendingConnect = null
                    }
                }
            }

            override fun onDeviceDisconnecting(device: BluetoothDevice) {
                // Nothing to report; the disconnected callback follows.
            }

            override fun onDeviceDisconnected(device: BluetoothDevice, reason: Int) {
                mainHandler.post {
                    if (isCurrent()) {
                        handleDisconnected()
                    }
                }
            }
        }

    private companion object {
        const val HEARTBEAT_INTERVAL_MS = 5_000L
        const val HEARTBEAT_TIMEOUT_MS = 15_000L
        const val SCAN_WINDOW_MS = 12_000L
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val CLAIM_TIMEOUT_MS = 6_000L
        const val RETRY_DELAY_MS = 250
    }
}
