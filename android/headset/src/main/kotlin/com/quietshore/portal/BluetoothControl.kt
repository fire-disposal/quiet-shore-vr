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
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.JsonEnvelope
import com.quietshore.control.protocol.TelemetryPose
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

/**
 * BLE peripheral for the tablet console.
 *
 * command   write       CLAIM / RELEASE / HELLO QS2 1 / #<seq> <cmd>
 * status    read/notify "CONNECTED", "CONTROL_OK", "CONTROL_BUSY",
 *                       "CONTROL_RELEASED", "CONTROL_REQUIRED",
 *                       "WELCOME QS2 1 <caps>", "ACK <seq> <OK|REJECTED|BUSY>",
 *                       "PROTOCOL_REQUIRED", "PROTOCOL_MISMATCH QS2 1"
 * telemetry read/notify 24 bytes LE float32: x, y, z, yaw, pitch, roll
 * state     read/notify QS2 schema 1, 28 bytes
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

        /** False when no page has reported state recently. */
        fun isPageOnline(): Boolean = true

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

        /** Bluetooth off / GATT open failure: try again without a restart. */
        const val START_RETRY_MS = 4_000L
        /** A failed advertise attempt is retried well before a user gives up. */
        const val ADVERTISE_RETRY_MS = 2_000L
        /** Periodic check for a stack that silently stopped advertising. */
        const val ADVERTISE_CHECK_MS = 8_000L
        /** Give the controller time to leave before advertising again. */
        const val ADVERTISE_RESUME_MS = 400L
        /** Grace before advertising without a service-added confirmation. */
        const val SERVICE_READY_TIMEOUT_MS = 2_000L

        /** Bounded dedupe window: enough for every realistic retry burst. */
        const val SEQ_MEMO_DEPTH = 32

        /** Log tags for the two callers of [publishDocument]. */
        const val SUS = "sus"
        const val TOPIC_OTHER = "json"
    }

    private val appContext: Context = context.applicationContext ?: context
    private val connected = CopyOnWriteArraySet<String>()
    private val controlLock = Any()

    @Volatile
    private var controller: String? = null

    /** Controller address that completed HELLO, and the identity it announced. */
    private var handshakeAddress: String? = null
    private var handshake: ControlProtocol.Hello? = null

    /** `seq -> result` memo so a retried discrete command is not executed twice. */
    private val seqResults = LinkedHashMap<Int, String>(16)

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
                releaseControl(active)
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
    private var susCharacteristic: BluetoothGattCharacteristic? = null

    /**
     * Chunk size for the JSON channel on the **current controller's** link.
     *
     * A property of one link, not of the server: every connection negotiates
     * its own ATT MTU, and a value left behind by an old controller (517) made
     * a new, un-negotiated link emit notifications the stack rejects. The
     * policy lives in [MtuPolicy] so the rule is testable without a device.
     */
    private val mtuPolicy = MtuPolicy()

    /** Rotating chunk id for the JSON channel. */
    private var jsonChunkId = 0
    private var stateSeq = 0
    private var advertiser: BluetoothLeAdvertiser? = null

    @Volatile
    private var lifecycleState: String = "starting"

    @Volatile
    private var lastState: ControlState = ControlState()

    /**
     * Last SUS sheet **document**, in the envelope the normal path sends
     * (`{"t":"sus","d":{…}}`), so a tablet that subscribes late gets the same
     * bytes a live publish would have produced: same envelope, same chunking,
     * same controller-only delivery.
     */
    private var lastSusDocument: String = ""

    private var started = false

    /** True between startAdvertising and the stack stopping it. */
    @Volatile
    private var advertising = false
    /** True once the stack confirms the service table is registered. */
    @Volatile
    private var serviceReady = false
    private var receiverRegistered = false

    val state: String
        get() = lifecycleState

    private val startRetry = Runnable {
        if (started && server == null) {
            startInternal()
        }
    }

    private val advertiseRetry = Runnable {
        if (!started || advertising || connected.isNotEmpty()) {
            return@Runnable
        }
        startAdvertising()
    }

    /**
     * A stack that never reports `onServiceAdded` must not leave the headset
     * invisible: advertise anyway after a short grace period.
     */
    private val serviceReadyFallback = Runnable {
        if (!started || serviceReady) {
            return@Runnable
        }
        Log.w(TAG, "no onServiceAdded after ${SERVICE_READY_TIMEOUT_MS}ms; advertising anyway")
        serviceReady = true
        startAdvertising()
    }

    /** Advertising waits for the stack to register the service table. */
    private fun advertiseWhenReady() {
        if (serviceReady) {
            startAdvertising()
            return
        }
        watchdogHandler.removeCallbacks(serviceReadyFallback)
        watchdogHandler.postDelayed(serviceReadyFallback, SERVICE_READY_TIMEOUT_MS)
    }

    /**
     * Advertising is the only way a new tablet can find this headset. Some
     * stacks stop connectable advertising as soon as a link exists and do not
     * tell the app, so keep probing while no tablet is connected.
     */
    private val advertiseWatchdog = object : Runnable {
        override fun run() {
            if (!started) {
                return
            }
            if (server == null) {
                scheduleStartRetry()
            } else if (serviceReady && connected.isEmpty()) {
                // Re-assert instead of trusting `advertising`: a stack that
                // silently stops connectable advertising leaves the flag true,
                // and the headset then turns undiscoverable with no error.
                // ALREADY_STARTED is handled as success, so this is idempotent.
                startAdvertising(force = true)
            }
            watchdogHandler.postDelayed(this, ADVERTISE_CHECK_MS)
        }
    }

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) {
                return
            }
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                BluetoothAdapter.STATE_ON -> if (started) {
                    watchdogHandler.post {
                        teardownGatt()
                        startInternal()
                    }
                }

                BluetoothAdapter.STATE_OFF -> {
                    teardownGatt()
                    setState("bluetooth-off")
                }
            }
        }
    }

    @Synchronized
    fun start() {
        if (started) {
            return
        }
        started = true
        registerBluetoothReceiver()
        startInternal()
    }

    /**
     * Opens the GATT server and advertising. Safe to re-run after a failure or
     * a Bluetooth toggle: every step is guarded by the field it fills.
     */
    private fun startInternal() {
        if (server != null) {
            advertiseWhenReady()
            return
        }
        try {
            val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = manager?.adapter
            this.adapter = adapter
            if (manager == null || adapter == null || !adapter.isEnabled) {
                setState("bluetooth-off")
                scheduleStartRetry()
                return
            }
            // No `isMultipleAdvertisementSupported` gate: that flag reports the
            // *multi*-advertisement feature, and several headsets advertise one
            // instance while returning false. A truly unsupported stack answers
            // ADVERTISE_FAILED_FEATURE_UNSUPPORTED, which the callback reports.
            try {
                adapter.setName(ControlProtocol.deviceName)
            } catch (ignored: RuntimeException) {
                // Vendor builds may restrict renaming; advertising still works.
            }

            val server = manager.openGattServer(appContext, callback)
            if (server == null) {
                setState("gatt-open-failed")
                scheduleStartRetry()
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
                encodeStateFrame(lastState)
            )
            // Completed SUS sheets: UTF-8 JSON, notify-only, one per sheet. The
            // state frame is fixed by the wire contract, so a record needs its
            // own characteristic rather than a wider state payload.
            val sus = notifyCharacteristic(ControlProtocol.susUuid, ByteArray(0))

            commandCharacteristic = command
            statusCharacteristic = status
            telemetryCharacteristic = telemetry
            stateCharacteristic = state
            susCharacteristic = sus

            service.addCharacteristic(command)
            service.addCharacteristic(status)
            service.addCharacteristic(telemetry)
            service.addCharacteristic(state)
            service.addCharacteristic(sus)
            if (!server.addService(service)) {
                teardownGatt()
                setState("gatt-add-service-failed")
                scheduleStartRetry()
                return
            }

            // The service table is registered asynchronously. Advertising first
            // makes the headset discoverable with an empty table: the tablet
            // connects, finds no required characteristic and drops in the same
            // second, which reads as "the apps cannot connect".
            advertiseWhenReady()
            watchdogHandler.removeCallbacks(advertiseWatchdog)
            watchdogHandler.postDelayed(advertiseWatchdog, ADVERTISE_CHECK_MS)
        } catch (error: RuntimeException) {
            setState("error")
            Log.w(TAG, "BLE start failed: ${error.message}")
            teardownGatt()
            scheduleStartRetry()
        }
    }

    private fun startAdvertising(force: Boolean = false) {
        if (!started || (advertising && !force)) {
            return
        }
        val advertiser = advertiser ?: adapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            setState("ble-advertiser-unavailable")
            scheduleAdvertiseRetry()
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
        advertising = true
        try {
            advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback)
        } catch (error: RuntimeException) {
            advertising = false
            Log.w(TAG, "BLE advertise failed: ${error.message}")
            scheduleAdvertiseRetry()
        }
    }

    private fun scheduleStartRetry() {
        watchdogHandler.removeCallbacks(startRetry)
        watchdogHandler.postDelayed(startRetry, START_RETRY_MS)
    }

    private fun scheduleAdvertiseRetry() {
        watchdogHandler.removeCallbacks(advertiseRetry)
        watchdogHandler.postDelayed(advertiseRetry, ADVERTISE_RETRY_MS)
    }

    private fun registerBluetoothReceiver() {
        if (receiverRegistered) {
            return
        }
        try {
            appContext.registerReceiver(
                bluetoothReceiver,
                IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            )
            receiverRegistered = true
        } catch (error: RuntimeException) {
            Log.w(TAG, "cannot watch Bluetooth state: ${error.message}")
        }
    }

    private fun unregisterBluetoothReceiver() {
        if (!receiverRegistered) {
            return
        }
        receiverRegistered = false
        try {
            appContext.unregisterReceiver(bluetoothReceiver)
        } catch (ignored: RuntimeException) {
            // Already unregistered with the process.
        }
    }

    /** Closes GATT/advertising without stopping the service or the receiver. */
    private fun teardownGatt() {
        watchdogHandler.removeCallbacks(startRetry)
        watchdogHandler.removeCallbacks(advertiseRetry)
        watchdogHandler.removeCallbacks(advertiseWatchdog)
        watchdogHandler.removeCallbacks(controllerWatchdog)
        watchdogHandler.removeCallbacks(serviceReadyFallback)
        serviceReady = false
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (ignored: RuntimeException) {
            // already stopped
        }
        advertiser = null
        advertising = false
        try {
            server?.clearServices()
            server?.close()
        } catch (ignored: RuntimeException) {
            // already closed
        }
        server = null
        commandCharacteristic = null
        statusCharacteristic = null
        telemetryCharacteristic = null
        stateCharacteristic = null
        susCharacteristic = null
        connected.clear()
        // A new link starts un-negotiated: keeping the last controller's MTU
        // would let the first notification after a restart overshoot the ATT
        // limit, which the stack answers by dropping the link.
        synchronized(controlLock) { mtuPolicy.onTeardown() }
        releaseControl(null)
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
        if (!started) {
            return
        }
        started = false
        unregisterBluetoothReceiver()
        watchdogHandler.removeCallbacksAndMessages(null)
        teardownGatt()
        setState("stopped")
        listener.onControlMode(false)
    }

    fun publishTelemetry(pose: TelemetryPose) {
        notifyValue(telemetryCharacteristic, ControlProtocol.encodeTelemetry(pose))
    }

    /**
     * Forwards one SUS sheet as a JSON-channel document.
     *
     * The sheet is wrapped in the channel's envelope *once*, here, and that
     * string is what both the live publish and the late-subscriber replay send.
     */
    fun publishSus(json: String): Boolean {
        // The page's own keys and order, untouched: re-serialising here would
        // rewrite every record just to add three bytes of envelope.
        val document = JsonEnvelope.document("sus", json)
        lastSusDocument = document
        return publishDocument(document, SUS)
    }

    /**
     * Publishes one document on the JSON channel, split into chunks that fit
     * the negotiated MTU. Everything event-driven rides here, so adding a field
     * never costs a state-frame version.
     *
     * A document over [ControlProtocol.jsonDocumentLimitBytes] is refused with
     * a log line instead of throwing: nothing upstream of this call (the WS
     * reader, a GATT callback) can do anything useful with an exception, and
     * the exception used to escape all the way out of the connection.
     */
    fun publishJson(json: String): Boolean = publishDocument(json, TOPIC_OTHER)

    private fun publishDocument(document: String, topic: String): Boolean {
        val payload = document.toByteArray(StandardCharsets.UTF_8)
        val linkMtu = synchronized(controlLock) { mtuPolicy.current }
        val limit = ControlProtocol.jsonDocumentLimitBytes(linkMtu)
        if (!ControlProtocol.fitsJsonChannel(payload.size, linkMtu)) {
            // Refused whole, never truncated: half a document is worse than none.
            Log.w(TAG, "json document refused: ${payload.size} B > $limit B ($topic)")
            return false
        }
        val perChunk = ControlProtocol.jsonChunkPayload(linkMtu)
        val id = jsonChunkId
        jsonChunkId = (jsonChunkId + 1) and 0xFF
        for (chunk in ControlProtocol.encodeJsonChunks(payload, perChunk, id)) {
            notifyValue(susCharacteristic, chunk)
        }
        return true
    }

    /**
     * Replays the last SUS sheet to a tablet that has just subscribed.
     *
     * The CCCD write is the only "ready" signal there is, so this is the one
     * chance to hand over the record the tablet missed. It goes through the
     * normal document path — envelope, chunk headers, current MTU — and only to
     * the controller: a non-controller tablet never sees a patient's answers.
     */
    private fun replaySus(device: BluetoothDevice) {
        val document = lastSusDocument
        if (document.isEmpty() || !isController(device)) {
            return
        }
        publishDocument(document, SUS)
    }

    fun publishState(state: ControlState) {
        lastState = state
        notifyValue(stateCharacteristic, encodeStateFrame(state))
    }

    private fun setState(value: String) {
        if (lifecycleState == value) {
            return
        }
        lifecycleState = value
        listener.onStateChanged(value)
    }

    /** QS2 schema 1 is 28 bytes; the tablet widens MTU during bring-up. */
    private fun encodeStateFrame(state: ControlState): ByteArray {
        val seq = stateSeq++ and 0xFFFF
        val now = (android.os.SystemClock.elapsedRealtime() and 0xFFFFL).toInt()
        return ControlProtocol.encodeState(
            state,
            now,
            seq,
            sceneIds = PageCatalog.ids(appContext)
        )
    }

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

    /**
     * The only place that drops control. A null [address] drops unconditionally
     * (teardown); otherwise only that controller is dropped. Protocol state is
     * reset and the listener notified only when control was actually held.
     */
    private fun releaseControl(address: String?): Boolean {
        val released = synchronized(controlLock) {
            if (controller == null || (address != null && controller != address)) {
                false
            } else {
                controller = null
                resetProtocolStateLocked()
                true
            }
        }
        // Nobody owns the console, so nothing is published at an owner's MTU.
        if (released) {
            synchronized(controlLock) { mtuPolicy.onRelease() }
            watchdogHandler.removeCallbacks(controllerWatchdog)
            listener.onControlMode(false)
        }
        return released
    }

    /** A new owner always starts from a clean handshake and seq window. */
    private fun resetProtocolStateLocked() {
        handshakeAddress = null
        handshake = null
        seqResults.clear()
    }

    private fun rememberSeqLocked(seq: Int, result: String) {
        seqResults[seq] = result
        while (seqResults.size > SEQ_MEMO_DEPTH) {
            seqResults.remove(seqResults.keys.first())
        }
    }

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
        // `null` = refused (another live pad owns it); `true` = the owner changed;
        // `false` = the same pad re-claimed, which only refreshes the lease.
        val changed = synchronized(controlLock) {
            val current = controller
            val grant = when {
                current == null -> {
                    resetProtocolStateLocked()
                    controller = address
                    true
                }
                current == address -> false
                current !in connected -> {
                    // The old controller is no longer on any live GATT link
                    // (BLE random address rotated or the pad process restarted).
                    resetProtocolStateLocked()
                    controller = address
                    true
                }
                else -> null
            }
            if (grant != null) {
                // The console is published at the new owner's MTU from now on,
                // defaulting until this link reports its own negotiation.
                mtuPolicy.onClaim(address)
            }
            grant
        } ?: return ControlProtocol.STATUS_CONTROL_BUSY
        // Re-claiming refreshes the lease even when the address already owns it;
        // a tablet that just reconnected must not inherit an expired watchdog.
        touchController()
        watchdogHandler.removeCallbacks(controllerWatchdog)
        watchdogHandler.postDelayed(controllerWatchdog, WATCHDOG_INTERVAL_MS)
        if (changed) {
            listener.onControlMode(true)
        }
        // Always replay the snapshot: a reconnecting tablet may have missed
        // the 1 Hz state while notifications were being enabled.
        notifyValue(stateCharacteristic, encodeStateFrame(lastState))
        return ControlProtocol.STATUS_CONTROL_OK
    }

    private fun handleRelease(device: BluetoothDevice): String {
        val address = addressOf(device) ?: return ControlProtocol.STATUS_CONTROL_REQUIRED
        val released = releaseControl(address)
        if (!released) {
            return ControlProtocol.STATUS_CONTROL_REQUIRED
        }
        return ControlProtocol.STATUS_CONTROL_RELEASED
    }

    private fun handleWrite(device: BluetoothDevice, requestId: Int, value: ByteArray) {
        val raw = String(value, StandardCharsets.UTF_8).trim()
        when {
            raw.startsWith(ControlProtocol.HELLO) -> {
                handleHello(device, requestId, raw)
                return
            }
            raw == ControlProtocol.CLAIM -> {
                replyWrite(device, requestId, handleClaim(device))
                return
            }
            raw == ControlProtocol.RELEASE -> {
                replyWrite(device, requestId, handleRelease(device))
                return
            }
            raw == ControlProtocol.PING -> {
                if (!isController(device)) {
                    replyWrite(device, requestId, ControlProtocol.STATUS_CONTROL_REQUIRED)
                } else {
                    touchController()
                    replyWrite(device, requestId, ControlProtocol.PONG)
                }
                return
            }
        }
        // One line per operator action: the only reliable way to tell a dead
        // tablet path from a dead page path in the field.
        Log.i(TAG, "ble ${addressOf(device) ?: "?"} $raw")
        handleCommandWrite(device, requestId, raw)
    }

    /**
     * `HELLO QS2 1` -> `WELCOME QS2 1 <capabilities>`.
     *
     * The generation is symbolic and the schema is explicit, so a peer from a
     * retired numbering scheme cannot be accepted by accident.
     */
    private fun handleHello(device: BluetoothDevice, requestId: Int, raw: String) {
        val hello = ControlProtocol.parseHello(raw)
        val address = addressOf(device)
        when {
            hello == null ->
                replyWrite(device, requestId, ControlProtocol.STATUS_COMMAND_REJECTED)
            address == null || !isController(device) ->
                replyWrite(device, requestId, ControlProtocol.STATUS_CONTROL_REQUIRED)
            hello.generation != ControlProtocol.PROTOCOL_GENERATION ||
                hello.schema != ControlProtocol.STATE_SCHEMA_VERSION -> {
                synchronized(controlLock) {
                    handshakeAddress = null
                    handshake = null
                }
                replyWrite(device, requestId, ControlProtocol.statusProtocolMismatch())
            }
            else -> {
                synchronized(controlLock) {
                    // A retried handshake must not erase the dedupe window: the
                    // tablet sends HELLO again when it missed the WELCOME, and
                    // `seqResults` is what stops a repeated `#7 audio:toggle`
                    // from running twice. Only a new owner starts a new window
                    // (`resetProtocolStateLocked` in handleClaim/release).
                    handshakeAddress = address
                    handshake = hello
                }
                replyWrite(device, requestId, ControlProtocol.welcomeCommand())
            }
        }
    }

    /**
     * Discrete command path.
     *
     * Seqs make delivery explicit: the result of every discrete command is
     * reported as `ACK <seq> <OK|REJECTED|BUSY>` and duplicates inside the
     * bounded window re-send the original result without executing twice.
     */
    private fun handleCommandWrite(device: BluetoothDevice, requestId: Int, raw: String) {
        val sequenced = ControlProtocol.parseSequencedCommand(raw)
        if (sequenced == null) {
            replyWrite(device, requestId, ControlProtocol.STATUS_COMMAND_REJECTED)
            return
        }
        val command = ControlProtocol.parseCommand(sequenced.command)
        val address = addressOf(device)
        if (command == null) {
            replyWrite(device, requestId, ControlProtocol.STATUS_CONTROL_REQUIRED)
            return
        }
        if (address == null || !isController(device)) {
            replyAck(device, requestId, sequenced.seq, ControlProtocol.RESULT_BUSY)
            return
        }
        touchController()

        val handshake = synchronized(controlLock) {
            if (handshakeAddress == address) handshake else null
        }
        if (handshake == null) {
            replyAck(device, requestId, sequenced.seq, ControlProtocol.RESULT_REJECTED)
            return
        }
        if (
            handshake.generation != ControlProtocol.PROTOCOL_GENERATION ||
            handshake.schema != ControlProtocol.STATE_SCHEMA_VERSION
        ) {
            replyAck(device, requestId, sequenced.seq, ControlProtocol.RESULT_REJECTED)
            return
        }
        if (!ControlProtocol.isAllowedCommand(command)) {
            replyAck(device, requestId, sequenced.seq, ControlProtocol.RESULT_REJECTED)
            return
        }
        val remembered = synchronized(controlLock) { seqResults[sequenced.seq] }
        if (remembered != null) {
            replyAck(device, requestId, sequenced.seq, remembered)
            return
        }
        val accepted = listener.onCommand(command)
        val result = when {
            accepted -> ControlProtocol.RESULT_OK
            !listener.isPageOnline() -> ControlProtocol.RESULT_OFFLINE
            else -> ControlProtocol.RESULT_REJECTED
        }
        synchronized(controlLock) { rememberSeqLocked(sequenced.seq, result) }
        replyAck(device, requestId, sequenced.seq, result)
    }

    private fun replyAck(device: BluetoothDevice, requestId: Int, seq: Int, result: String) {
        replyWrite(device, requestId, ControlProtocol.ackPayload(seq, result))
    }

    /** GATT-level success for a request that must not produce a status frame. */
    private fun respondOnly(device: BluetoothDevice, requestId: Int) {
        if (requestId == 0) {
            // WRITE_TYPE_NO_RESPONSE: the ATT layer expects no reply at all.
            return
        }
        sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, ByteArray(0))
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

        /**
         * The service table lands asynchronously. Advertising before this point
         * makes the headset discoverable with nothing to discover: the tablet
         * connects, misses a required characteristic and drops at once.
         */
        override fun onServiceAdded(status: Int, service: BluetoothGattService) {
            if (service.uuid != ControlProtocol.serviceUuid) {
                return
            }
            watchdogHandler.post {
                if (!started) {
                    return@post
                }
                watchdogHandler.removeCallbacks(serviceReadyFallback)
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    Log.w(TAG, "GATT service registration failed: $status")
                    setState("gatt-add-service-failed")
                    teardownGatt()
                    scheduleStartRetry()
                    return@post
                }
                serviceReady = true
                startAdvertising()
            }
        }

        /**
         * MTU is a property of one link. Only the current controller's link may
         * change the chunk size the console is published at, and the value is
         * kept per address so a controller that reconnects at a different
         * negotiation restores its own number instead of inheriting a sibling's.
         */
        override fun onMtuChanged(device: BluetoothDevice, negotiatedMtu: Int) {
            val address = addressOf(device) ?: return
            synchronized(controlLock) {
                mtuPolicy.onMtuChanged(address, negotiatedMtu, controller)
            }
        }

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
                // A dropped controller frees the console for the next pad, and
                // its negotiated MTU leaves with the link.
                synchronized(controlLock) {
                    mtuPolicy.onDisconnected(address, controller)
                }
                releaseControl(address)
                // Connectable advertising usually ends with the link; make the
                // headset discoverable again for a reconnect or a new tablet.
                if (started && connected.isEmpty()) {
                    advertising = false
                    watchdogHandler.removeCallbacks(advertiseRetry)
                    watchdogHandler.postDelayed(advertiseRetry, ADVERTISE_RESUME_MS)
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
            // A tablet that just subscribed gets the sheet it missed while it
            // was away; the CCCD write is the only "ready" signal we get.
            val subscribed = value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            if (subscribed && descriptor.characteristic.uuid == ControlProtocol.susUuid) {
                // Same envelope, same chunk headers, same MTU and the same
                // controller check as a live publish: the old path sent the raw
                // JSON document, unframed and to any subscriber.
                replaySus(device)
            }
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            advertising = true
            setState(STATE_ADVERTISING)
            Log.i(TAG, "BLE advertising as ${ControlProtocol.deviceName}")
        }

        override fun onStartFailure(errorCode: Int) {
            if (errorCode == AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED) {
                // The stack kept the previous advertisement alive; that is fine.
                advertising = true
                setState(STATE_ADVERTISING)
                return
            }
            advertising = false
            if (errorCode == AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED) {
                // Nothing to retry: this stack cannot advertise at all.
                setState("ble-peripheral-unsupported")
                Log.w(TAG, "BLE advertising unsupported")
                return
            }
            setState("advertise-failed:$errorCode")
            Log.w(TAG, "BLE advertise failed: $errorCode")
            if (started && connected.isEmpty()) {
                scheduleAdvertiseRetry()
            }
        }
    }
}
