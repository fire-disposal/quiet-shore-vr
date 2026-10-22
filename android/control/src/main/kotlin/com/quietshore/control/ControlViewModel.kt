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
import com.quietshore.control.model.RecordingPhase
import com.quietshore.control.model.ViewMode
import com.quietshore.control.model.ViewPresets
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.protocol.ViewPreset
import com.quietshore.control.recording.ControllerRecorder
import com.quietshore.control.recording.RecordingEvent
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
    val viewModeUpdates: Flow<ViewMode> =
        _uiState.map { it.viewMode }.distinctUntilChanged()

    private val ble = BleController(application, this)

    private var lastPoseAt = 0L

    /** Last eye height actually written to the headset; NaN means nothing sent yet. */
    private var lastEyeHeightSent = Float.NaN

    /** Debounces slider samples; the newest one wins. */
    private var viewJob: Job? = null
    /** Last orientation written to the link; NaN means nothing sent yet. */
    private var lastViewPitchSent = Float.NaN
    private var lastViewYawSent = Float.NaN
    /** Desired absolute orientation, seeded from the headset readback. */
    private var desiredPitch = 0f
    private var desiredYaw = 0f
    /** Monotonic time of the last write, used to keep the stream at ≤10 Hz. */
    private var lastViewSentAt = 0L

    private var eyeHeightJob: Job? = null
    /** First state after a connection seeds the stepper from the headset. */
    private var eyeHeightSynced = false

    /** Recorder owned by the viewport; null until the WebView page is alive. */
    private var recorder: ControllerRecorder? = null
    private var recordingClock: Job? = null
    private var recordingGuard: Job? = null
    private var recordingStartedAt = 0L

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
        eyeHeightSynced = false
        lastViewPitchSent = Float.NaN
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
        cancelViewRequest()
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
        cancelViewRequest()
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
     * Hooks the viewport's recorder to the UI. The WebView lives in a
     * composable, so the screen attaches it here instead of the ViewModel
     * owning a View.
     */
    fun attachRecorder(next: ControllerRecorder?) {
        if (next !== recorder && _uiState.value.recording.isBusy) {
            recordingClock?.cancel()
            recordingClock = null
            recordingGuard?.cancel()
            recordingGuard = null
            _uiState.update {
                it.copy(
                    recording = RecordingPhase.FAILED,
                    recordingError = "三维视图已重建，录像未保存"
                )
            }
        }
        recorder = next
    }

    /**
     * Records the patient camera. BLE is deliberately not a precondition: a
     * product demo may be captured from the simulated mirror alone.
     */
    fun startRecording() {
        val current = _uiState.value
        if (current.recording.isBusy) {
            return
        }
        val target = recorder ?: run {
            _uiState.update { it.copy(recordingError = "三维视图尚未就绪") }
            return
        }
        _uiState.update {
            it.copy(
                recording = RecordingPhase.STARTING,
                recordingElapsedMs = 0L,
                recordingBytes = 0L,
                recordingPath = null,
                recordingError = null,
                // The clip is the patient's view, so switch the mirror now.
                viewMode = ViewMode.PATIENT
            )
        }
        // The bridge is fire-and-forget: never leave the UI in STARTING when
        // the page silently fails to answer.
        recordingGuard?.cancel()
        recordingGuard = viewModelScope.launch {
            delay(RECORDING_START_TIMEOUT_MS)
            if (_uiState.value.recording == RecordingPhase.STARTING) {
                _uiState.update {
                    it.copy(
                        recording = RecordingPhase.FAILED,
                        recordingError = "录制未启动，请重试"
                    )
                }
            }
        }
        target.startRecording()
    }

    fun stopRecording() {
        if (!_uiState.value.recording.isBusy) {
            return
        }
        _uiState.update { it.copy(recording = RecordingPhase.SAVING) }
        // The clip is in the page until the last slice lands; a missing finish
        // event must still release the UI.
        recordingGuard?.cancel()
        recordingGuard = viewModelScope.launch {
            delay(RECORDING_SAVE_TIMEOUT_MS)
            if (_uiState.value.recording == RecordingPhase.SAVING) {
                _uiState.update {
                    it.copy(
                        recording = RecordingPhase.FAILED,
                        recordingError = "保存录像超时"
                    )
                }
            }
        }
        recorder?.stopRecording()
    }

    fun dismissRecordingNotice() {
        val phase = _uiState.value.recording
        if (phase == RecordingPhase.SAVED || phase == RecordingPhase.FAILED) {
            _uiState.update {
                it.copy(recording = RecordingPhase.IDLE, recordingError = null)
            }
        }
    }

    fun onRecordingEvent(event: RecordingEvent) {
        when (event) {
            is RecordingEvent.Started -> {
                recordingGuard?.cancel()
                recordingGuard = null
                startRecordingClock()
                _uiState.update {
                    it.copy(recording = RecordingPhase.RECORDING, recordingError = null)
                }
            }

            is RecordingEvent.Saved -> {
                recordingGuard?.cancel()
                recordingGuard = null
                recordingClock?.cancel()
                recordingClock = null
                _uiState.update {
                    it.copy(
                        recording = RecordingPhase.SAVED,
                        recordingPath = event.path,
                        recordingBytes = event.bytes,
                        recordingElapsedMs = event.durationMs,
                        recordingError = null,
                        notice = "患者视角录像已保存"
                    )
                }
            }

            is RecordingEvent.Failed -> {
                recordingGuard?.cancel()
                recordingGuard = null
                recordingClock?.cancel()
                recordingClock = null
                _uiState.update {
                    it.copy(
                        recording = RecordingPhase.FAILED,
                        recordingError = event.message
                    )
                }
            }
        }
    }

    private fun startRecordingClock() {
        recordingStartedAt = SystemClock.elapsedRealtime()
        recordingClock?.cancel()
        recordingClock = viewModelScope.launch {
            while (isActive) {
                delay(RECORDING_CLOCK_MS)
                val elapsed = SystemClock.elapsedRealtime() - recordingStartedAt
                _uiState.update { state ->
                    if (state.recording == RecordingPhase.RECORDING) {
                        state.copy(recordingElapsedMs = elapsed)
                    } else {
                        state
                    }
                }
            }
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
     * Absolute up-gaze in whole degrees, clamped to ±[VIEW_PITCH_MAX_DEG].
     *
     * Both axes share one wire command, so samples collapse to the newest
     * pair and leave at ≤10 Hz: the slider moves instantly, the newest state
     * is written after [VIEW_DEBOUNCE_MS] and never sooner than
     * [VIEW_MIN_INTERVAL_MS] after the previous write.
     */
    fun setViewPitch(degrees: Float) {
        submitView(
            viewPitch = degrees.roundToInt()
                .coerceIn(-VIEW_PITCH_MAX_DEG, VIEW_PITCH_MAX_DEG)
                .toFloat()
        )
    }

    /** Absolute yaw in whole degrees; + = the patient's view turns left. */
    fun setViewYaw(degrees: Float) {
        submitView(
            viewYaw = degrees.roundToInt()
                .coerceIn(-VIEW_YAW_MAX_DEG, VIEW_YAW_MAX_DEG)
                .toFloat()
        )
    }

    private fun submitView(viewPitch: Float? = null, viewYaw: Float? = null) {
        val blocked = _uiState.value.viewPitchBlockedReason
        if (blocked != null) {
            _uiState.update { it.copy(error = blocked) }
            return
        }
        if (viewPitch != null) desiredPitch = viewPitch
        if (viewYaw != null) desiredYaw = viewYaw
        _uiState.update {
            it.copy(
                viewPitchRequested = viewPitch ?: it.viewPitchRequested,
                viewYawRequested = viewYaw ?: it.viewYawRequested,
                error = null
            )
        }
        viewJob?.cancel()
        viewJob = viewModelScope.launch {
            delay(VIEW_DEBOUNCE_MS)
            // Hard cap on the send rate: the debounce alone can still fire
            // faster than the ~10 Hz the wire contract allows.
            val early = VIEW_MIN_INTERVAL_MS -
                (SystemClock.elapsedRealtime() - lastViewSentAt)
            if (early > 0) {
                delay(early)
            }
            if (_uiState.value.viewPitchBlockedReason != null) {
                return@launch
            }
            if (desiredPitch == lastViewPitchSent && desiredYaw == lastViewYawSent) {
                return@launch
            }
            lastViewPitchSent = desiredPitch
            lastViewYawSent = desiredYaw
            lastViewSentAt = SystemClock.elapsedRealtime()
            ble.sendCommand(orientationCommand(desiredYaw, desiredPitch))
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
        viewJob?.cancel()
        viewJob = null
        // The animation owns the motion now; drop the manual request so the
        // sliders follow the page's readback instead of fighting it.
        lastViewPitchSent = Float.NaN
        lastViewYawSent = Float.NaN
        _uiState.update {
            it.copy(
                viewPitchRequested = null,
                viewYawRequested = null,
                error = null,
                notice = ViewPresets.label(preset) + "已发送"
            )
        }
        ble.sendCommand(ControlProtocol.VIEW_ANIM + preset.wire)
    }

    /** `停止`: freezes the current orientation in place. It never recenters. */
    fun stopViewPitch() {
        val blocked = _uiState.value.viewPitchBlockedReason
        if (blocked != null) {
            _uiState.update { it.copy(error = blocked) }
            return
        }
        viewJob?.cancel()
        viewJob = null
        lastViewPitchSent = Float.NaN
        lastViewYawSent = Float.NaN
        _uiState.update {
            it.copy(
                viewPitchRequested = null,
                viewYawRequested = null,
                error = null,
                notice = "视角已停止"
            )
        }
        ble.sendCommand(ControlProtocol.VIEW_STOP)
    }

    /**
     * Drops any pending sample and lets the sliders follow the headset readback
     * again. Deliberately does not send `view:stop`: a lost lease or a dropped
     * link holds the last orientation by contract, it never recenters.
     */
    fun cancelViewRequest() {
        viewJob?.cancel()
        viewJob = null
        // Forget the last write too: after a reconnect the page may sit at a
        // different orientation, so the next identical drag must still reach it.
        lastViewPitchSent = Float.NaN
        lastViewYawSent = Float.NaN
        _uiState.update { it.copy(viewPitchRequested = null, viewYawRequested = null) }
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
        cancelViewRequest()
        _uiState.update {
            it.copy(
                reconnectAttempt = attempt,
                reconnectMax = max,
                error = null,
                notice = "连接中断，正在重连（$attempt/$max）"
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
        cancelViewRequest()
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
        cancelViewRequest()
        _uiState.update {
            it.copy(
                controlGranted = false,
                error = reason,
                poseStale = true
            )
        }
    }

    override fun onDisconnected() {
        cancelViewRequest()
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
            cancelViewRequest()
        }
        val syncEyeHeight = !eyeHeightSynced && lastEyeHeightSent.isNaN()
        if (syncEyeHeight) {
            eyeHeightSynced = true
        }
        _uiState.update { current ->
            // Once the headset readback reaches the requested degree the local
            // request is settled and the slider follows the headset again.
            val pendingPitch = if (resetView) {
                null
            } else {
                current.viewPitchRequested?.takeIf {
                    abs(state.viewPitch - it) > VIEW_READBACK_EPSILON
                }
            }
            val pendingYaw = if (resetView) {
                null
            } else {
                current.viewYawRequested?.takeIf {
                    abs(state.viewYaw - it) > VIEW_READBACK_EPSILON
                }
            }
            // A settled axis follows the headset again; an axis with no
            // request never fights the readback.
            if (pendingPitch == null) desiredPitch = state.viewPitch
            if (pendingYaw == null) desiredYaw = state.viewYaw
            val next = current.copy(
                control = state,
                viewPitchRequested = pendingPitch,
                viewYawRequested = pendingYaw
            )
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
        cancelViewRequest()
        recordingClock?.cancel()
        recordingGuard?.cancel()
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
     * `view:orient:<yaw>,<pitch>`: absolute whole degrees, both axes in one
     * command so a drag never leaves one channel behind. No commas as
     * decimal separators, no spaces.
     */
    private fun orientationCommand(yaw: Float, pitch: Float): String =
        ControlProtocol.VIEW_ORIENT +
            String.format(Locale.US, "%d,%d", yaw.roundToInt(), pitch.roundToInt())

    private companion object {
        const val TICK_MS = 500L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L
        const val RECORDING_CLOCK_MS = 500L
        const val RECORDING_START_TIMEOUT_MS = 4_000L
        const val RECORDING_SAVE_TIMEOUT_MS = 30_000L

        const val PREFERENCES = "quiet-shore-control"
        const val LAST_DEVICE_KEY = "lastDeviceAddress"

        /** Collapse slider samples: only the newest pair survives a burst. */
        const val VIEW_DEBOUNCE_MS = 70L

        /** Contract: at most ~10 Hz while dragging, nothing while idle. */
        const val VIEW_MIN_INTERVAL_MS = 100L

        /** The wire carries whole degrees, so a half-degree readback is settled. */
        const val VIEW_READBACK_EPSILON = 0.51f

        val VIEW_PITCH_MAX_DEG: Int = ControlProtocol.VIEW_PITCH_MAX_DEG.toInt()
        val VIEW_YAW_MAX_DEG: Int = ControlProtocol.VIEW_YAW_MAX_DEG.toInt()

        /** Collapse fast stepper taps into a single eye height write. */
        const val EYE_HEIGHT_DEBOUNCE_MS = 300L

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
