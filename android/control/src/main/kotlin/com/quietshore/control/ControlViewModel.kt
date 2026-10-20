package com.quietshore.control

import android.app.Application
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.quietshore.control.ble.BleController
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.DiscoveredDevice
import com.quietshore.control.model.EyeHeight
import com.quietshore.control.model.ViewMode
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import kotlinx.coroutines.Job
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
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.roundToInt

class ControlViewModel(application: Application) :
    AndroidViewModel(application),
    BleController.Listener {

    private val _uiState = MutableStateFlow(ControlUiState())
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
    val viewModeUpdates: Flow<ViewMode> =
        _uiState.map { it.viewMode }.distinctUntilChanged()

    private val ble = BleController(application, this)

    private var lastPoseAt = 0L

    /** Last eye height actually written to the headset; NaN means nothing sent yet. */
    private var lastEyeHeightSent = Float.NaN

    private var viewJob: Job? = null
    private var viewX = 0f
    private var viewZ = 0f
    private var viewSending = false

    private var eyeHeightJob: Job? = null
    /** First state after a connection seeds the stepper from the headset. */
    private var eyeHeightSynced = false

    /** One-shot commands win over movement for a moment; the pad must re-engage. */
    private var viewSuppressedUntil = 0L

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
        if (state.phase.isBusy || state.phase == BlePhase.READY) {
            return
        }
        _uiState.update {
            it.copy(
                devices = emptyList(),
                scanAttempted = true,
                error = null,
                notice = null
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
        eyeHeightSynced = false
        _uiState.update {
            it.copy(
                selectedAddress = address,
                controlGranted = false,
                poseStale = true,
                error = null,
                notice = null
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
        stopView()
        ble.disconnect()
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
        stopView()
        ble.disconnect()
        _uiState.update {
            it.copy(
                sessionActive = false,
                controlGranted = false,
                advancedUnlocked = false,
                poseStale = true,
                notice = null
            )
        }
    }

    fun setViewMode(mode: ViewMode) {
        _uiState.update { it.copy(viewMode = mode) }
    }

    fun setFullscreen(active: Boolean) {
        _uiState.update {
            it.copy(
                fullscreen = active,
                viewMode = if (active) ViewMode.PATIENT else it.viewMode
            )
        }
    }

    /**
     * Eye height is a headset preference: the tablet only mirrors the value it
     * requested, and the page receives it through the headset bootstrap. Sending
     * the same height twice is skipped so repeated taps cannot flood the link.
     */
    fun setEyeHeight(meters: Float) {
        val value = (meters * 100f).roundToInt().coerceIn(
            (EyeHeight.MIN * 100f).roundToInt(),
            (EyeHeight.MAX * 100f).roundToInt()
        ) / 100f
        val state = _uiState.value
        if (state.control.calibrating) {
            // Calibration owns the head pose; changing eye height mid-collection
            // would move the floor under the patient.
            _uiState.update { it.copy(error = "校准中不可调整视点高度") }
            return
        }
        _uiState.update { it.copy(eyeHeightRequested = value) }
        if (state.phase != BlePhase.READY) {
            // Offline: keep the value local and forget what was sent, so the
            // next connected tap writes the headset again.
            lastEyeHeightSent = Float.NaN
            return
        }
        // Rapid taps collapse into one command; the stepper stays responsive.
        eyeHeightJob?.cancel()
        eyeHeightJob = viewModelScope.launch {
            delay(EYE_HEIGHT_DEBOUNCE_MS)
            val current = _uiState.value
            if (current.phase != BlePhase.READY ||
                current.control.calibrating ||
                value == lastEyeHeightSent
            ) {
                return@launch
            }
            lastEyeHeightSent = value
            _uiState.update { it.copy(eyeHeightConfirmed = false) }
            sendCommand(
                ControlProtocol.SETTINGS_EYE_HEIGHT + String.format(Locale.US, "%.2f", value)
            )
        }
    }

    /** Explicit therapist gate. Turning it off always stops any running nudge. */
    fun setAdvancedUnlocked(unlocked: Boolean) {
        if (!unlocked) {
            stopView()
        }
        _uiState.update { it.copy(advancedUnlocked = unlocked) }
    }

    /**
     * Latest stick vector from the therapist pad, normalized to [-1, 1] where
     * +x is view right and +z is view forward. One coroutine owns the ~10 Hz
     * repeat so a lost pointer can never leave the page moving.
     */
    fun moveView(x: Float, z: Float) {
        val state = _uiState.value
        if (!state.advancedUnlocked || !state.canSteerView) {
            return
        }
        if (SystemClock.elapsedRealtime() < viewSuppressedUntil) {
            return
        }
        val clampedX = x.coerceIn(-1f, 1f)
        val clampedZ = z.coerceIn(-1f, 1f)
        // Inside the dead zone the loop keeps ticking with zeros: the view
        // stands still without a stop/start write pair on every sample.
        if (hypot(clampedX, clampedZ) < VIEW_DEAD_ZONE) {
            viewX = 0f
            viewZ = 0f
        } else {
            viewX = clampedX
            viewZ = clampedZ
        }
        if (viewJob?.isActive == true) {
            return
        }
        viewJob = viewModelScope.launch {
            while (isActive) {
                val current = _uiState.value
                if (!current.advancedUnlocked || !current.canSteerView) {
                    // Permission vanished mid-stream: the page must not coast.
                    haltViewMovement()
                    break
                }
                if (SystemClock.elapsedRealtime() < viewSuppressedUntil) {
                    break
                }
                viewSending = true
                ble.sendCommand(moveCommand(viewX, viewZ))
                delay(VIEW_REPEAT_MS)
            }
        }
    }

    /** Stops the repeat and tells the page to hold still. Safe to call anytime. */
    fun stopView() {
        viewJob?.cancel()
        viewJob = null
        viewX = 0f
        viewZ = 0f
        haltViewMovement()
    }

    private fun haltViewMovement() {
        if (viewSending && _uiState.value.phase == BlePhase.READY) {
            ble.sendCommand(ControlProtocol.VIEW_STOP)
        }
        viewSending = false
    }

    fun selectScene(sceneId: String) {
        sendCommand("scene:$sceneId")
    }

    fun startSession() {
        sendCommand("start")
    }

    fun endSession() {
        sendCommand("stop")
    }

    fun recalibrate() {
        sendCommand("calibrate")
    }

    fun preview() {
        sendCommand("preview")
    }

    /**
     * Bedside aid preset: lakeside scene with sound on and the patient view.
     * Never starts a session from the tablet, so the stop key stays with the
     * patient and the headset keeps its own start flow.
     */
    fun prepareBedsideVoiding() {
        val state = _uiState.value
        if (state.phase != BlePhase.READY) {
            _uiState.update { it.copy(error = "头显未连接") }
            return
        }
        // A running session owns its scene, so only preselect it when idle.
        val sceneHeld = state.control.session && state.control.scene != CARE_SCENE
        val sceneChanged = !state.control.session && state.control.scene != CARE_SCENE
        stopView()
        viewSuppressedUntil = SystemClock.elapsedRealtime() + VIEW_SUPPRESS_MS
        if (sceneChanged) {
            ble.sendCommand("scene:$CARE_SCENE")
        }
        if (state.control.audioMuted) {
            ble.sendCommand("audio:on")
        }
        _uiState.update { current ->
            current.copy(
                viewMode = ViewMode.PATIENT,
                control = current.control.copy(
                    scene = if (sceneHeld) current.control.scene else CARE_SCENE,
                    audioMuted = false
                ),
                error = null,
                notice = if (sceneHeld) {
                    "护理辅助已准备，场景将在训练结束后切换"
                } else {
                    "护理辅助已准备"
                }
            )
        }
    }

    fun toggleAudio() {
        sendCommand("audio:toggle")
    }

    fun postureRise() {
        sendCommand("posture:rise")
    }

    fun postureLower() {
        sendCommand("posture:lower")
    }

    fun postureStop() {
        sendCommand("posture:stop")
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
        // The page keeps only the newest command, so a held joystick would
        // otherwise swallow this one. Stop moving and unlatch the pad briefly.
        stopView()
        viewSuppressedUntil = SystemClock.elapsedRealtime() + VIEW_SUPPRESS_MS
        ble.sendCommand(normalized)
        _uiState.update { state ->
            val control = if (normalized.startsWith("scene:")) {
                state.control.copy(scene = normalized.removePrefix("scene:"))
            } else {
                state.control
            }
            state.copy(control = control, error = null, notice = "命令已发送")
        }
    }

    fun reportError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    override fun onPhase(phase: BlePhase) {
        _uiState.update { state ->
            state.copy(
                phase = phase,
                poseStale = if (phase == BlePhase.READY) state.poseStale else true
            )
        }
    }

    override fun onDevices(devices: List<DiscoveredDevice>) {
        _uiState.update { it.copy(devices = devices) }
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
        stopView()
        _uiState.update {
            it.copy(
                controlGranted = false,
                sessionActive = false,
                advancedUnlocked = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onControlLost(reason: String) {
        stopView()
        _uiState.update {
            it.copy(
                controlGranted = false,
                advancedUnlocked = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onDisconnected() {
        stopView()
        eyeHeightJob?.cancel()
        eyeHeightJob = null
        lastPoseAt = 0L
        // A reconnected headset may have restarted; let the next tap write the
        // height again instead of trusting our last sent value.
        lastEyeHeightSent = Float.NaN
        eyeHeightSynced = false
        _uiState.update {
            it.copy(
                controlGranted = false,
                advancedUnlocked = false,
                eyeHeightConfirmed = false,
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
        // now owns the pose: the tablet must not keep nudging the view.
        if (!state.session || state.calibrating) {
            stopView()
        }
        val syncEyeHeight = !eyeHeightSynced && lastEyeHeightSent.isNaN()
        if (syncEyeHeight) {
            eyeHeightSynced = true
        }
        _uiState.update {
            if (syncEyeHeight) {
                it.copy(
                    control = state,
                    eyeHeightRequested = state.eyeHeight,
                    eyeHeightConfirmed = true
                )
            } else {
                it.copy(control = state)
            }
        }
    }

    override fun onSignal(rssi: Int) {
        _uiState.update { it.copy(rssi = rssi) }
    }

    override fun onStatus(raw: String) {
        if (raw.startsWith(OK_PREFIX + ControlProtocol.SETTINGS_EYE_HEIGHT)) {
            val confirmedValue = ControlProtocol.parseEyeHeight(raw.removePrefix(OK_PREFIX))
            _uiState.update { state ->
                val matches = confirmedValue != null &&
                    abs(confirmedValue - state.eyeHeightRequested) < 0.005f
                state.copy(
                    notice = "命令已生效",
                    eyeHeightConfirmed = matches || state.eyeHeightConfirmed
                )
            }
            return
        }
        when {
            raw.startsWith(OK_PREFIX) -> _uiState.update { it.copy(notice = "命令已生效") }
            raw == ControlProtocol.STATUS_CONTROL_RELEASED ->
                _uiState.update { it.copy(notice = "已释放控制") }
            else -> Unit
        }
    }

    override fun onError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    override fun onCleared() {
        stopView()
        eyeHeightJob?.cancel()
        eyeHeightJob = null
        ble.close()
        super.onCleared()
    }

    private fun refreshStaleness() {
        val now = SystemClock.elapsedRealtime()
        val stale = lastPoseAt == 0L || now - lastPoseAt > POSE_STALE_MS
        _uiState.update { state ->
            if (state.poseStale == stale) state else state.copy(poseStale = stale)
        }
    }

    /** Wire format is fixed by the page: lowercase decimals, never comma decimals. */
    private fun moveCommand(x: Float, z: Float): String =
        ControlProtocol.VIEW_MOVE + String.format(Locale.US, "%.2f,%.2f", x, z)

    private companion object {
        const val TICK_MS = 500L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L
        const val CARE_SCENE = "landscape"

        /** ~10 Hz; the page expires movement 300 ms after the last update. */
        const val VIEW_REPEAT_MS = 100L
        const val VIEW_DEAD_ZONE = 0.08f

        /** One-shot commands win over the page's single command slot for a moment. */
        const val VIEW_SUPPRESS_MS = 600L

        /** Collapse fast stepper taps into a single eye height write. */
        const val EYE_HEIGHT_DEBOUNCE_MS = 300L

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
