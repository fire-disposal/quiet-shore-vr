package com.quietshore.control

import android.app.Application
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.quietshore.control.ble.BleController
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionMode
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

class ControlViewModel(application: Application) :
    AndroidViewModel(application),
    BleController.Listener {

    private val preferences =
        application.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private val _uiState = MutableStateFlow(
        ControlUiState(
            lastDeviceAddress = preferences.getString(LAST_DEVICE_KEY, null)
        )
    )
    val uiState: StateFlow<ControlUiState> = _uiState.asStateFlow()

    private val _bluetoothEnabled = MutableStateFlow(false)
    val bluetoothEnabled: StateFlow<Boolean> = _bluetoothEnabled.asStateFlow()

    val poseUpdates: Flow<TelemetryPose?> =
        _uiState.map { it.pose }.distinctUntilChanged()
    val controlUpdates: Flow<ControlState> =
        _uiState.map { it.control }.distinctUntilChanged()
    val phaseUpdates: Flow<BlePhase> =
        _uiState.map { it.phase }.distinctUntilChanged()
    val grantedUpdates: Flow<Boolean> =
        _uiState.map { it.controlGranted }.distinctUntilChanged()

    private val ble = BleController(application, this)

    private var lastPoseAt = 0L
    /** Monotonic start of the running session; 0 when no session is running. */
    private var sessionStartedAt = 0L

    init {
        refreshBluetoothState()
        viewModelScope.launch {
            while (isActive) {
                delay(TICK_MS)
                refreshStaleness()
            }
        }
        viewModelScope.launch {
            while (isActive) {
                delay(RSSI_INTERVAL_MS)
                if (_uiState.value.phase == BlePhase.READY) {
                    ble.readSignal()
                }
            }
        }
    }

    fun refreshBluetoothState() {
        val manager = getApplication<Application>()
            .getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        _bluetoothEnabled.value = try {
            manager?.adapter?.isEnabled == true
        } catch (error: SecurityException) {
            false
        }
    }

    fun startScan() {
        val state = _uiState.value
        Log.i("QuietShoreBle", "viewModel.startScan phase=${state.phase.name}")
        if (state.phase.isBusy || state.phase == BlePhase.READY) {
            return
        }
        _uiState.update {
            it.copy(
                scanAttempted = true,
                error = null,
                notice = null,
                reconnectAttempt = 0,
                reconnectMax = 0
            )
        }
        ble.startScan()
    }

    fun stopScan() {
        ble.stopScan()
    }

    fun connect(address: String) {
        if (_uiState.value.phase.isBusy) {
            return
        }
        preferences.edit().putString(LAST_DEVICE_KEY, address).apply()
        _uiState.update {
            it.copy(
                selectedAddress = address,
                lastDeviceAddress = address,
                controlGranted = false,
                poseStale = true,
                error = null,
                notice = null,
                reconnectAttempt = 0,
                reconnectMax = 0
            )
        }
        ble.connect(address)
    }

    fun cancelConnect() {
        ble.cancelConnect()
        _uiState.update {
            it.copy(controlGranted = false, error = null, notice = null)
        }
    }

    fun disconnect() {
        // A manual disconnect is an operator decision to leave this headset, so
        // the screen goes straight back to pairing instead of waiting for the
        // link-loss callbacks to arrive.
        ble.disconnect()
        _uiState.update {
            it.copy(
                sessionActive = false,
                controlGranted = false,
                poseStale = true,
                rssi = null,
                notice = null,
                error = null
            )
        }
    }

    fun reconnect() {
        val address = _uiState.value.selectedAddress
        if (address == null) {
            leaveControl()
            return
        }
        connect(address)
    }

    fun leaveControl() {
        ble.disconnect()
        _uiState.update {
            it.copy(
                sessionActive = false,
                controlGranted = false,
                poseStale = true,
                notice = null
            )
        }
    }

    /** Launches the headset page; the Firefox door gesture stays with the patient. */
    fun enterTraining() {
        sendCommand(ControlProtocol.ENTER)
    }

    fun endSession() {
        sendCommand("stop")
    }

    /**
     * Emergency stop: ends the session immediately. The page freezes motion and
     * fades the buoyancy out inside a second; this is the same `stop` the
     * patient's confirm key sends, so both converge on one path.
     */
    fun emergencyStop() {
        sendCommand("stop")
    }

    /** Chosen before a session; the headset refuses it while one is running. */
    fun setSessionMode(mode: SessionMode) {
        _uiState.update { it.copy(sessionMode = mode) }
        sendCommand(ControlProtocol.MODE + mode.wire)
    }

    /** Buoyancy intensity 0..3; the page scales amplitude linearly. */
    fun setFloatLevel(level: Int) {
        val clamped = level.coerceIn(0, 3)
        _uiState.update { it.copy(floatLevel = clamped) }
        sendCommand(ControlProtocol.FLOAT_LEVEL + clamped)
    }

    /** Buoyancy character: a gentle, b standard, c immersive. */
    fun setFloatProfile(id: String) {
        val profile = id.lowercase(Locale.US)
        if (profile !in ControlProtocol.FLOAT_PROFILE_NAMES) {
            return
        }
        _uiState.update { it.copy(floatProfile = profile) }
        sendCommand(ControlProtocol.FLOAT_PROFILE + profile)
    }

    /**
     * Scene choice, sent before a session. The headset stores it as the launch
     * parameter, so picking a scene and pressing 启动 is the whole loop.
     */
    fun selectScene(id: String) {
        val scene = id.lowercase(Locale.US)
        if (scene !in ControlProtocol.SCENE_LABELS) {
            return
        }
        sendCommand(ControlProtocol.SCENE_PREFIX + scene)
    }

    /** Leaves the browser scene and returns the headset to its console app. */
    fun exitScene() {
        sendCommand("exit")
    }

    /** Full exit: leave the scene, end any session, then go to the system home. */
    fun exitSystem() {
        if (_uiState.value.control.session) {
            sendCommand("stop")
        }
        sendCommand("exit")
        sendCommand("home")
    }

    /**
     * Gaze dwell switch. It is on by default because a supine patient has no
     * pointer; turning it off leaves only the tablet able to answer.
     */
    fun setGazeDwell(enabled: Boolean) {
        _uiState.update { it.copy(gazeDwell = enabled) }
        sendCommand(ControlProtocol.GAZE_DWELL + if (enabled) "on" else "off")
    }

    /** Breathing layer on the heave: the cheapest strong buoyancy cue. */
    fun setBreathEnabled(enabled: Boolean) {
        _uiState.update { it.copy(breathEnabled = enabled) }
        sendCommand(ControlProtocol.FLOAT_BREATH + if (enabled) "on" else "off")
    }

    /** Sit-up ramp length; slower reads as gentler for a frail patient. */
    fun setAnimDuration(millis: Int) {
        val clamped = millis.coerceIn(4000, 20000)
        _uiState.update { it.copy(animDurationMs = clamped) }
        sendCommand(ControlProtocol.ANIM_DURATION + clamped)
    }

    fun openSus() {
        _uiState.update { it.copy(susOpen = true) }
        sendCommand("sus:open")
    }

    fun closeSus() {
        _uiState.update { it.copy(susOpen = false) }
        sendCommand("sus:close")
    }

    fun recalibrate() {
        sendCommand("calibrate")
    }

    /** Posture branch: only meaningful while the session runs in posture mode. */
    fun postureLower() {
        sendCommand(ControlProtocol.POSTURE_LOWER)
    }

    fun postureRise() {
        sendCommand(ControlProtocol.POSTURE_RISE)
    }

    fun postureStop() {
        sendCommand(ControlProtocol.POSTURE_STOP)
    }

    fun preview() {
        sendCommand("preview")
    }

    fun toggleAudio() {
        sendCommand("audio:toggle")
    }

    fun sendCommand(command: String) {
        val normalized = command.trim().lowercase(Locale.US)
        if (normalized.isEmpty() || !ControlProtocol.isAllowedCommand(normalized)) {
            _uiState.update { it.copy(error = "不支持的命令") }
            return
        }
        if (_uiState.value.phase != BlePhase.READY) {
            _uiState.update { it.copy(error = "头显未连接") }
            return
        }
        ble.sendCommand(normalized)
        _uiState.update { state ->
            state.copy(error = null, notice = "命令已发送")
        }
    }

    fun reportError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    override fun onPhase(phase: BlePhase) {
        _uiState.update { state ->
            val settled = phase == BlePhase.READY
            state.copy(
                phase = phase,
                poseStale = if (settled) state.poseStale else true,
                reconnectAttempt = if (settled) 0 else state.reconnectAttempt,
                reconnectMax = if (settled) 0 else state.reconnectMax
            )
        }
    }

    override fun onReconnecting(attempt: Int, max: Int) {
        _uiState.update {
            it.copy(
                reconnectAttempt = attempt,
                reconnectMax = max,
                error = null,
                notice = "连接中断，正在重连（$attempt/$max）"
            )
        }
    }

    override fun onControlGranted() {
        _uiState.update {
            it.copy(
                controlGranted = true,
                sessionActive = true,
                poseStale = true,
                error = null,
                notice = null
            )
        }
    }

    override fun onControlBusy(reason: String) {
        _uiState.update {
            it.copy(
                controlGranted = false,
                sessionActive = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onControlLost(reason: String) {
        _uiState.update {
            it.copy(
                controlGranted = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onDisconnected() {
        lastPoseAt = 0L
        _uiState.update {
            it.copy(
                controlGranted = false,
                poseStale = true,
                rssi = null,
                notice = null
            )
        }
    }

    override fun onTelemetry(pose: TelemetryPose) {
        lastPoseAt = SystemClock.elapsedRealtime()
        _uiState.update { it.copy(pose = pose, poseStale = false) }
    }

    override fun onControlState(state: ControlState) {
        // The patient stopped, the headset left the session, or a calibration
        // now owns the pose. The page resets its pitch target to 0 on both
        // transitions, so only the local request is dropped here.
        // Session clock: starts on the rising edge, stops and clears on the
        // falling edge, so the readout never carries time across sessions.
        if (state.session && sessionStartedAt == 0L) {
            sessionStartedAt = SystemClock.elapsedRealtime()
        } else if (!state.session) {
            sessionStartedAt = 0L
        }
        _uiState.update { current ->
            current.copy(
                control = state,
                // While a session runs the headset is authoritative for both
                // buoyancy and mode, so a rejected command cannot leave the
                // panel showing something that is not happening.
                sessionMode = if (state.session && state.postureMode) {
                    SessionMode.POSTURE
                } else if (state.session) {
                    SessionMode.FLOAT
                } else {
                    current.sessionMode
                },
                floatLevel = state.floatLevel,
                floatProfile = state.floatProfile,
                sessionElapsedMs = if (sessionStartedAt == 0L) {
                    0L
                } else {
                    SystemClock.elapsedRealtime() - sessionStartedAt
                }
            )
        }
    }

    override fun onSignal(rssi: Int) {
        _uiState.update { it.copy(rssi = rssi) }
    }

    override fun onStatus(raw: String) {
        when {
            raw.startsWith(OK_PREFIX) -> _uiState.update { it.copy(notice = "头显已接收指令") }
            raw == ControlProtocol.STATUS_CONTROL_RELEASED ->
                _uiState.update { it.copy(notice = "已释放控制") }
            else -> Unit
        }
    }

    override fun onError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    override fun onCleared() {
        ble.close()
        super.onCleared()
    }

    private fun refreshStaleness() {
        val now = SystemClock.elapsedRealtime()
        val stale = lastPoseAt == 0L || now - lastPoseAt > POSE_STALE_MS
        _uiState.update { state ->
            val elapsed = if (sessionStartedAt == 0L) 0L else now - sessionStartedAt
            if (state.poseStale == stale && state.sessionElapsedMs == elapsed) {
                state
            } else {
                state.copy(poseStale = stale, sessionElapsedMs = elapsed)
            }
        }
    }

    private companion object {
        const val TICK_MS = 500L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L

        const val PREFERENCES = "quiet-shore-control"
        const val LAST_DEVICE_KEY = "lastDeviceAddress"

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
