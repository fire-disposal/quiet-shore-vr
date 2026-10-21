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
import com.quietshore.control.model.ViewPresets
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.protocol.ViewPreset
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

    /** Debounces slider samples; the newest one wins. */
    private var viewPitchJob: Job? = null
    /** Last pitch actually written to the link; NaN means nothing sent yet. */
    private var lastViewPitchSent = Float.NaN
    /** Monotonic time of that write, used to keep the stream at ≤10 Hz. */
    private var lastViewPitchSentAt = 0L

    private var eyeHeightJob: Job? = null
    /** First state after a connection seeds the stepper from the headset. */
    private var eyeHeightSynced = false

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
        lastViewPitchSent = Float.NaN
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
        cancelViewPitchRequest()
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
        cancelViewPitchRequest()
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

    /**
     * Absolute pitch target in degrees, rounded to whole degrees and clamped to
     * ±[ControlProtocol.VIEW_PITCH_MAX_DEG]. The slider moves instantly; the
     * newest sample is written after [VIEW_PITCH_DEBOUNCE_MS] and never more
     * often than [VIEW_PITCH_MIN_INTERVAL_MS], so a drag emits at most 10
     * writes per second and never leaves a repeat loop running.
     */
    fun setViewPitch(degrees: Float) {
        val value = degrees.roundToInt()
            .coerceIn(-VIEW_PITCH_MAX_DEG, VIEW_PITCH_MAX_DEG)
            .toFloat()
        val blocked = _uiState.value.viewPitchBlockedReason
        if (blocked != null) {
            _uiState.update { it.copy(error = blocked) }
            return
        }
        _uiState.update { it.copy(viewPitchRequested = value, error = null) }
        viewPitchJob?.cancel()
        viewPitchJob = viewModelScope.launch {
            delay(VIEW_PITCH_DEBOUNCE_MS)
            // Hard cap on the send rate: the debounce alone can still fire
            // faster than the ~10 Hz the wire contract allows.
            val early = VIEW_PITCH_MIN_INTERVAL_MS -
                (SystemClock.elapsedRealtime() - lastViewPitchSentAt)
            if (early > 0) {
                delay(early)
            }
            if (_uiState.value.viewPitchBlockedReason != null) {
                return@launch
            }
            if (value == lastViewPitchSent) {
                return@launch
            }
            lastViewPitchSent = value
            lastViewPitchSentAt = SystemClock.elapsedRealtime()
            ble.sendCommand(pitchCommand(value))
        }
    }

    /**
     * Plays one of the page's fixed-duration animations. Nothing is repeated
     * and no timing crosses the wire: the page owns the curve and the tablet
     * only reads the phase back through `state.viewAnim`.
     */
    fun playViewAnim(preset: ViewPreset) {
        if (preset == ViewPreset.NONE) {
            return
        }
        val blocked = _uiState.value.viewPitchBlockedReason
        if (blocked != null) {
            _uiState.update { it.copy(error = blocked) }
            return
        }
        viewPitchJob?.cancel()
        viewPitchJob = null
        // The animation owns the motion now; drop the manual request so the
        // slider follows the page's 1 Hz readback instead of fighting it.
        lastViewPitchSent = Float.NaN
        _uiState.update {
            it.copy(
                viewPitchRequested = null,
                error = null,
                notice = ViewPresets.label(preset) + "已发送"
            )
        }
        ble.sendCommand(ControlProtocol.VIEW_ANIM + preset.wire)
    }

    /** `停止`: freezes the current pitch in place. It never recenters. */
    fun stopViewPitch() {
        val blocked = _uiState.value.viewPitchBlockedReason
        if (blocked != null) {
            _uiState.update { it.copy(error = blocked) }
            return
        }
        viewPitchJob?.cancel()
        viewPitchJob = null
        lastViewPitchSent = Float.NaN
        _uiState.update {
            it.copy(viewPitchRequested = null, error = null, notice = "视角已停止")
        }
        ble.sendCommand(ControlProtocol.VIEW_STOP)
    }

    /**
     * Drops any pending sample and lets the slider follow the headset readback
     * again. Deliberately does not send `view:stop`: a lost lease or a dropped
     * link holds the last pitch target by contract, it never recenters.
     */
    fun cancelViewPitchRequest() {
        viewPitchJob?.cancel()
        viewPitchJob = null
        // Forget the last write too: after a reconnect the page may sit at a
        // different angle, so the next identical drag must still reach it.
        lastViewPitchSent = Float.NaN
        _uiState.update { it.copy(viewPitchRequested = null) }
    }

    fun selectScene(sceneId: String) {
        sendCommand("scene:$sceneId")
    }

    /** Launches the headset page; the Firefox door gesture stays with the patient. */
    fun enterTraining() {
        sendCommand(ControlProtocol.ENTER)
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

    fun openSus() {
        sendCommand("sus:open")
    }

    fun closeSus() {
        sendCommand("sus:close")
    }

    fun susPrev() {
        sendCommand("sus:prev")
    }

    fun susNext() {
        sendCommand("sus:next")
    }

    /** Operator answers the headset's current SUS item when the patient cannot. */
    fun susAnswer(value: Int) {
        if (value in 1..5) {
            sendCommand(ControlProtocol.SUS_ANSWER + value)
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
        cancelViewPitchRequest()
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
        // 租约丢失：只取消本地采样，俯仰目标按契约保持在头显侧，不回正。
        cancelViewPitchRequest()
        _uiState.update {
            it.copy(
                controlGranted = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onDisconnected() {
        cancelViewPitchRequest()
        lastViewPitchSent = Float.NaN
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
        // now owns the pose. The page resets its pitch target to 0 on both
        // transitions, so only the local request is dropped here.
        val resetView = !state.session || state.calibrating
        if (resetView) {
            cancelViewPitchRequest()
            lastViewPitchSent = Float.NaN
        }
        val syncEyeHeight = !eyeHeightSynced && lastEyeHeightSent.isNaN()
        if (syncEyeHeight) {
            eyeHeightSynced = true
        }
        _uiState.update { current ->
            // Once the headset readback reaches the requested degree the local
            // request is settled and the slider follows the headset again.
            val pending = if (resetView) {
                null
            } else {
                current.viewPitchRequested?.takeIf {
                    abs(state.viewPitch - it) > VIEW_PITCH_READBACK_EPSILON
                }
            }
            val next = current.copy(control = state, viewPitchRequested = pending)
            if (syncEyeHeight) {
                next.copy(
                    eyeHeightRequested = state.eyeHeight,
                    eyeHeightConfirmed = true
                )
            } else {
                next
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
        cancelViewPitchRequest()
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

    /**
     * `view:move:0,<z>`: x must stay zero (pitch-only), z is the absolute
     * target normalized by ±20°. Lowercase decimals, never comma decimals.
     */
    private fun pitchCommand(degrees: Float): String =
        ControlProtocol.VIEW_MOVE +
            String.format(Locale.US, "0,%.2f", degrees / ControlProtocol.VIEW_PITCH_MAX_DEG)

    private companion object {
        const val TICK_MS = 500L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L

        /** Collapse slider samples: only the newest value survives a burst. */
        const val VIEW_PITCH_DEBOUNCE_MS = 70L

        /** Contract: at most ~10 Hz while dragging, nothing while idle. */
        const val VIEW_PITCH_MIN_INTERVAL_MS = 100L

        /** The wire carries whole degrees, so a half-degree readback is settled. */
        const val VIEW_PITCH_READBACK_EPSILON = 0.51f

        val VIEW_PITCH_MAX_DEG: Int = ControlProtocol.VIEW_PITCH_MAX_DEG.toInt()

        /** Collapse fast stepper taps into a single eye height write. */
        const val EYE_HEIGHT_DEBOUNCE_MS = 300L

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
