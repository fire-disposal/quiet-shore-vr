package com.quietshore.control.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.SystemClock
import android.os.Looper
import android.os.ParcelUuid
import android.provider.Settings
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

    private var manualClose = false
    private var autoScan = false
    private var reconnectAttempts = 0
    private var reconnectScheduled = false
    private var lastAddress: String? = null

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

    private val reconnectRunnable = Runnable {
        reconnectScheduled = false
        if (manualClose) {
            return@Runnable
        }
        val address = lastAddress
        if (reconnectAttempts <= 1 && address != null) {
            connectInternal(address)
        } else {
            autoScan = true
            startScanInternal()
        }
    }

    private val scanWindow = Runnable {
        val wasAuto = autoScan
        stopScan()
        if (wasAuto && !manualClose) {
            autoScan = false
            scheduleReconnect("未找到头显")
        }
    }
    private val claimTimeout = Runnable {
        if (!awaitingControl) {
            return@Runnable
        }
        awaitingControl = false
        listener.onControlLost("未获得控制权，请重新连接")
        closeConnection()
    }

    fun startScan() {
        manualClose = false
        reconnectAttempts = 0
        autoScan = false
        cancelReconnect()
        startScanInternal()
    }

    private fun startScanInternal() {
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
        // Some OEM stacks (Huawei/EMUI on Android 12 included) suspend the
        // scan and return zero results while location services are off, even
        // when BLUETOOTH_SCAN is granted. Fail loudly instead of scanning
        // silently in that state.
        if (!locationServicesEnabled()) {
            listener.onError("请先开启定位服务，部分设备的蓝牙搜索依赖它")
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
                if (autoScan) {
                    autoScan = false
                    mainHandler.post { connectInternal(address) }
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
                    if (autoScan && !manualClose) {
                        autoScan = false
                        scheduleReconnect("搜索失败")
                    }
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

    private fun locationServicesEnabled(): Boolean {
        val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.isLocationEnabled
        } else {
            @Suppress("DEPRECATION")
            Settings.Secure.getInt(
                appContext.contentResolver,
                Settings.Secure.LOCATION_MODE,
                Settings.Secure.LOCATION_MODE_OFF
            ) != Settings.Secure.LOCATION_MODE_OFF
        }
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
        manualClose = false
        reconnectAttempts = 0
        autoScan = false
        cancelReconnect()
        connectInternal(address)
    }

    private fun connectInternal(address: String) {
        lastAddress = address
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
        manualClose = true
        autoScan = false
        cancelReconnect()
        cancelPendingConnect()
        closeManager()
        awaitingControl = false
        cancelClaimTimeout()
        setPhase(BlePhase.DISCONNECTED)
    }

    /** Releases control on the headset, then closes the link. */
    fun disconnect() {
        manualClose = true
        autoScan = false
        cancelReconnect()
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
        manualClose = true
        autoScan = false
        cancelReconnect()
        stopHeartbeat()
        stopScan()
        cancelClaimTimeout()
        awaitingControl = false
        cancelPendingConnect()
        closeManager()
        phase = BlePhase.IDLE
    }

    private fun cancelReconnect() {
        reconnectScheduled = false
        mainHandler.removeCallbacks(reconnectRunnable)
    }

    private fun scheduleReconnect(reason: String) {
        if (manualClose || reconnectScheduled) {
            return
        }
        if (reconnectAttempts >= MAX_RECONNECTS) {
            listener.onError("自动重连失败，请重新搜索")
            return
        }
        reconnectAttempts++
        reconnectScheduled = true
        listener.onError("$reason，正在重连（$reconnectAttempts/$MAX_RECONNECTS）")
        mainHandler.postDelayed(reconnectRunnable, RECONNECT_DELAY_MS)
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
        if (!manualClose) {
            scheduleReconnect("连接失败")
        }
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
                cancelReconnect()
                awaitingControl = false
                manualClose = false
                autoScan = false
                reconnectAttempts = 0
                setPhase(BlePhase.READY)
                listener.onControlGranted()
            }

            ControlProtocol.STATUS_CONTROL_BUSY -> {
                cancelClaimTimeout()
                awaitingControl = false
                listener.onControlBusy("头显正被另一台平板控制")
                // Drop this link and retry; the headset frees a stale
                // controller on disconnect or after its watchdog.
                closeManager()
                setPhase(BlePhase.DISCONNECTED)
                scheduleReconnect("头显仍被占用")
            }

            ControlProtocol.STATUS_CONTROL_REQUIRED -> {
                cancelClaimTimeout()
                awaitingControl = false
                manualClose = true
                autoScan = false
                cancelReconnect()
                listener.onControlLost("控制连接已失效，请重新连接")
                closeConnection()
            }

            ControlProtocol.STATUS_CONTROL_RELEASED -> {
                manualClose = true
                autoScan = false
                cancelReconnect()
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
        if (!manualClose) {
            scheduleReconnect("连接中断")
        }
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
        const val MAX_RECONNECTS = 3
        const val RECONNECT_DELAY_MS = 700L
    }
}
