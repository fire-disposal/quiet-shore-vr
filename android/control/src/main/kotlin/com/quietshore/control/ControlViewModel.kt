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
import com.quietshore.control.model.ViewMode
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
            it.copy(controlGranted = false, poseStale = true, rssi = null, notice = null)
        }
    }

    override fun onTelemetry(pose: TelemetryPose) {
        lastPoseAt = SystemClock.elapsedRealtime()
        _uiState.update { it.copy(pose = pose, poseStale = false) }
    }

    override fun onControlState(state: ControlState) {
        _uiState.update { it.copy(control = state) }
    }

    override fun onSignal(rssi: Int) {
        _uiState.update { it.copy(rssi = rssi) }
    }

    override fun onStatus(raw: String) {
        when {
            raw.startsWith("OK:") -> _uiState.update { it.copy(notice = "命令已生效") }
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
            if (state.poseStale == stale) state else state.copy(poseStale = stale)
        }
    }

    private companion object {
        const val TICK_MS = 500L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L
    }
}
