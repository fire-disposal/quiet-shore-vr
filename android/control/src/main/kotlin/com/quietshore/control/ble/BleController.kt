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
        fun onControlGranted()
        fun onControlBusy(reason: String)
        fun onControlLost(reason: String)
        /** A dropped link is retrying; [attempt] is 1-based. */
        fun onReconnecting(attempt: Int, max: Int)
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

    private var scanCallback: ScanCallback? = null
    /** First matching advertisement already scheduled a connection. */
    private var scanConnectPending = false
    private var phase = BlePhase.IDLE

    private var manager: QuietShoreBleManager? = null
    private var pendingConnect: ConnectRequest? = null
    private var awaitingControl = false

    /** One serialized writer: [outbound] decides what goes next. */
    private val sendLock = Any()
    private val outbound = CommandQueue()
    private var writing = false
    private var nextSeq = 0

    /** Capability mask from WELCOME; 0 until the handshake completes. */
    private var headsetCapabilities = 0

    /** Non-null when this headset's protocol cannot be driven: block every send. */
    private var incompatibleReason: String? = null

    /** Sequenced commands written but not yet acknowledged. */
    private val inFlight = LinkedHashMap<Int, InFlightCommand>()

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
            expireInFlight()
            enqueueCommand(ControlProtocol.PING)
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

    /** CONTROL_OK arrived but the headset never answered HELLO. */
    private val handshakeTimeout = Runnable {
        if (phase != BlePhase.AUTHENTICATING) {
            return@Runnable
        }
        listener.onError("头显未完成协议握手，请更新头显应用后重试")
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

        scanConnectPending = false

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
                // One headset, one pad: connect the moment the advertised
                // QuietShore device appears instead of making the operator
                // pick it from a list.
                if (scanConnectPending) {
                    return
                }
                scanConnectPending = true
                autoScan = false
                mainHandler.post { connectInternal(address) }
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
        cancelHandshakeTimeout()
        awaitingControl = false
        // Lease release: nothing queued (especially pitch) may reach the link
        // after the operator asked to stop.
        abortCommands()
        val current = manager
        if (current == null) {
            setPhase(BlePhase.DISCONNECTED)
            listener.onDisconnected()
            return
        }
        current.releaseThenDisconnect()
    }

    /**
     * Queues one page command.
     *
     * Pitch samples coalesce to the newest one, stop commands jump the queue,
     * and discrete commands are written one at a time and acked by the headset
     * (`ACK <seq> ...`), so nothing is dropped silently. A headset whose
     * protocol version or capabilities do not match is never driven at all.
     */
    fun sendCommand(command: String) {
        val blocked = incompatibleReason
        if (blocked != null) {
            listener.onError(blocked)
            return
        }
        val current = manager
        val continuous = command.startsWith(ControlProtocol.VIEW_ORIENT)
        if (current == null || !current.isReady || phase != BlePhase.READY) {
            // Movement samples are disposable; only an operator action deserves
            // an error message while the link is still settling.
            if (!continuous) {
                listener.onError(
                    if (current == null) "头显未连接" else "正在与头显握手，请稍候"
                )
            }
            return
        }
        val capability = ControlProtocol.capabilityFor(command)
        if (capability != 0 && headsetCapabilities and capability == 0) {
            listener.onError(
                "头显固件缺少功能：" +
                    ControlProtocol.capabilityNames(capability).joinToString(",") +
                    "，请更新头显应用"
            )
            return
        }
        enqueueCommand(command)
    }

    /** Internal frames (HELLO, heartbeat) share the same single writer. */
    private fun enqueueCommand(command: String) {
        val accepted = synchronized(sendLock) { outbound.enqueue(command) }
        if (!accepted) {
            listener.onError("命令队列已满，请稍后重试")
            return
        }
        mainHandler.post { pump() }
    }

    /**
     * Writes at most one command at a time. The completion callback re-enters
     * the pump, so the queue is the only place that decides ordering.
     */
    private fun pump() {
        var command: String? = null
        var payload: String? = null
        var seq = 0
        synchronized(sendLock) {
            if (writing) {
                return
            }
            val next = outbound.poll() ?: return
            writing = true
            command = next
            if (ControlProtocol.requiresSequencedAck(next)) {
                seq = ++nextSeq
                inFlight[seq] = InFlightCommand(next, SystemClock.elapsedRealtime())
                payload = ControlProtocol.sequencedCommandPayload(seq, next)
            } else {
                payload = next
            }
        }
        val chosen = command ?: return
        val wire = payload ?: chosen
        val current = manager
        if (current == null || !current.isReady) {
            synchronized(sendLock) { writing = false }
            return
        }
        val acked = seq > 0
        current.writeCommand(wire) { ok ->
            synchronized(sendLock) { writing = false }
            if (!ok) {
                if (acked) {
                    synchronized(sendLock) { inFlight.remove(seq) }
                    listener.onError("发送命令失败：$chosen")
                }
            }
            mainHandler.post { pump() }
        }
    }

    /** A dropped pitch sample is disposable; a missing ACK is not. */
    private fun expireInFlight() {
        val cutoff = SystemClock.elapsedRealtime() - ACK_TIMEOUT_MS
        val missing = ArrayList<String>(2)
        synchronized(sendLock) {
            val iterator = inFlight.entries.iterator()
            while (iterator.hasNext()) {
                val entry = iterator.next()
                if (entry.value.sentAt <= cutoff) {
                    missing.add(entry.value.command)
                    iterator.remove()
                }
            }
        }
        for (command in missing) {
            listener.onError("头显未确认命令：$command")
        }
    }

    private fun handleAck(ack: ControlProtocol.Ack) {
        // An ACK for a seq that already expired was reported once; ignore it
        // rather than repeating a stale error.
        val command = synchronized(sendLock) { inFlight.remove(ack.seq)?.command } ?: return
        when (ack.result) {
            ControlProtocol.RESULT_OK -> Unit
            ControlProtocol.RESULT_BUSY -> listener.onError("头显忙，命令未执行：$command")
            else -> listener.onError("头显拒绝命令：$command")
        }
    }

    private fun handleWelcome(raw: String) {
        val welcome = ControlProtocol.parseWelcome(raw)
        if (welcome == null) {
            failProtocol("头显握手响应无效，请更新头显应用")
            return
        }
        if (welcome.version != ControlProtocol.protocolVersion) {
            failProtocol(
                "头显协议版本不兼容（头显 v${welcome.version}，平板 v${ControlProtocol.protocolVersion}），请更新头显应用"
            )
            return
        }
        val missing = ControlProtocol.CAPABILITIES_MASK and welcome.capabilities.inv()
        if (missing != 0) {
            failProtocol(
                "头显固件缺少功能：" +
                    ControlProtocol.capabilityNames(missing).joinToString(",") +
                    "，请更新头显应用"
            )
            return
        }
        headsetCapabilities = welcome.capabilities
        incompatibleReason = null
        cancelClaimTimeout()
        cancelHandshakeTimeout()
        cancelReconnect()
        awaitingControl = false
        manualClose = false
        autoScan = false
        reconnectAttempts = 0
        setPhase(BlePhase.READY)
        listener.onControlGranted()
    }

    /** Keeps the link but refuses to drive it, with a reason the UI can show. */
    private fun failProtocol(reason: String) {
        incompatibleReason = reason
        cancelClaimTimeout()
        cancelHandshakeTimeout()
        cancelReconnect()
        awaitingControl = false
        // Reconnecting cannot fix a protocol mismatch: stop the loop and let
        // the operator update the headset app.
        manualClose = true
        autoScan = false
        listener.onError(reason)
        setPhase(BlePhase.ERROR)
    }

    /** Lease loss / disconnect: nothing queued may outlive the session. */
    private fun abortCommands() {
        synchronized(sendLock) {
            outbound.clear()
            inFlight.clear()
            writing = false
            nextSeq = 0
        }
        headsetCapabilities = 0
        incompatibleReason = null
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
            // Give the screen back to the operator instead of spinning in a
            // phase that never resolves.
            setPhase(BlePhase.DISCONNECTED)
            listener.onError("自动重连失败，请重新搜索")
            return
        }
        reconnectAttempts++
        reconnectScheduled = true
        setPhase(BlePhase.RECONNECTING)
        listener.onReconnecting(reconnectAttempts, MAX_RECONNECTS)
        // 800 ms, 1600 ms, 3200 ms: a stack that just lost a GATT client needs
        // a moment to finish teardown before it will accept a new connection.
        val delay = (RECONNECT_DELAY_MS shl (reconnectAttempts - 1))
            .coerceAtMost(RECONNECT_MAX_DELAY_MS)
        mainHandler.postDelayed(reconnectRunnable, delay)
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
        // Every teardown path funnels through here: pending pitch and unacked
        // commands die with the link so they cannot leak into the next session.
        abortCommands()
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

    private fun scheduleHandshakeTimeout() {
        mainHandler.removeCallbacks(handshakeTimeout)
        mainHandler.postDelayed(handshakeTimeout, HANDSHAKE_TIMEOUT_MS)
    }

    private fun cancelHandshakeTimeout() {
        mainHandler.removeCallbacks(handshakeTimeout)
    }

    private fun handleStatus(raw: String) {
        if (raw == ControlProtocol.PONG) {
            lastPongAt = SystemClock.elapsedRealtime()
            return
        }
        if (raw.startsWith("${ControlProtocol.WELCOME} ")) {
            handleWelcome(raw)
            return
        }
        if (raw.startsWith("${ControlProtocol.ACK} ")) {
            ControlProtocol.parseAck(raw)?.let(::handleAck)
            return
        }
        if (raw.startsWith(ControlProtocol.STATUS_PROTOCOL_MISMATCH)) {
            failProtocol(
                "头显协议版本不兼容（头显 v${raw.substringAfter(' ', "")}，" +
                    "平板 v${ControlProtocol.protocolVersion}），请更新头显应用"
            )
            return
        }
        if (raw == ControlProtocol.STATUS_PROTOCOL_REQUIRED) {
            failProtocol("头显要求先完成协议握手（HELLO），请更新平板应用")
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
                // Control is not usable until the protocol handshake succeeds:
                // READY only flips after a matching WELCOME.
                enqueueCommand(ControlProtocol.helloCommand())
                scheduleHandshakeTimeout()
            }

            ControlProtocol.STATUS_CONTROL_BUSY -> {
                cancelClaimTimeout()
                awaitingControl = false
                listener.onControlBusy("头显正被另一台平板控制")
                // Busy is not a transient link fault: retrying would just
                // fight the current owner, so hand the screen back to pairing.
                closeManager()
                setPhase(BlePhase.DISCONNECTED)
                listener.onDisconnected()
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
        cancelHandshakeTimeout()
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

    /** A discrete command written to the headset and awaiting its ACK. */
    private class InFlightCommand(val command: String, val sentAt: Long)

    private companion object {
        const val HEARTBEAT_INTERVAL_MS = 5_000L
        const val HEARTBEAT_TIMEOUT_MS = 15_000L
        const val SCAN_WINDOW_MS = 12_000L
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val CLAIM_TIMEOUT_MS = 6_000L

        /** HELLO -> WELCOME must finish well inside one watchdog window. */
        const val HANDSHAKE_TIMEOUT_MS = 4_000L

        /** An unacked discrete command is reported after this long. */
        const val ACK_TIMEOUT_MS = 8_000L

        const val RETRY_DELAY_MS = 250
        const val MAX_RECONNECTS = 3
        const val RECONNECT_DELAY_MS = 800L
        const val RECONNECT_MAX_DELAY_MS = 5_000L
    }
}
