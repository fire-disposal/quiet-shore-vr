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
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.mergeRemoteFrame
import com.quietshore.control.model.MirrorMode
import com.quietshore.control.model.SessionMode
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.data.SusStore
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.SusResult
import org.json.JSONObject
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.voice.VoiceCatalog
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

private const val TAG = "QuietShoreControl"

class ControlViewModel(application: Application) :
    AndroidViewModel(application),
    BleController.Listener {

    private val preferences =
        application.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private val susStore = SusStore(application)

    private val _uiState = MutableStateFlow(
        ControlUiState(
            lastDeviceAddress = preferences.getString(LAST_DEVICE_KEY, null),
            susHistory = susStore.load()
        )
    )
    val uiState: StateFlow<ControlUiState> = _uiState.asStateFlow()

    /**
     * One-shot operator messages. Kept out of [ControlUiState] on purpose: an
     * event must re-render even when it repeats, and it must never survive a
     * reconnect as stale "state".
     */
    private val _events = MutableSharedFlow<UiEvent>(
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val uiEvents = _events.asSharedFlow()

    private fun notice(text: String) {
        _events.tryEmit(UiEvent.Notice(text))
    }

    private fun error(text: String) {
        _events.tryEmit(UiEvent.Error(text))
    }

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
    /** Last time any state frame arrived; the tablet's only liveness signal. */
    private var lastStateAt = 0L
    /** Monotonic start of the running session; 0 when no session is running. */
    private var sessionStartedAt = 0L
    private var enterPendingJob: Job? = null

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
                reconnectAttempt = 0,
                reconnectMax = 0
            )
        }
        ble.connect(address)
    }

    fun cancelConnect() {
        ble.cancelConnect()
        _uiState.update {
            it.copy(controlGranted = false)
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
                rssi = null
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
                poseStale = true
            )
        }
    }

    /**
     * Launches the headset page; the Firefox door gesture stays with the
     * patient. Until that gesture lands the tablet shows "waiting", so a second
     * tap cannot queue a second launch.
     */
    fun enterTraining() {
        if (_uiState.value.startPending) {
            return
        }
        if (_uiState.value.phase != BlePhase.READY) {
            sendCommand(ControlProtocol.ENTER)
            return
        }
        _uiState.update {
            it.copy(startPending = true).also { notice("已请求启动，等待患者按确认键") }
        }
        sendCommand(ControlProtocol.ENTER)
        enterPendingJob?.cancel()
        enterPendingJob = viewModelScope.launch {
            delay(ENTER_PENDING_MS)
            _uiState.update { it.copy(startPending = false) }
        }
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
    /**
     * Extra view pitch. Yaw is echoed from the last reported state so a pitch
     * correction never also turns the patient's view.
     */
    private var pitchJob: Job? = null

    /**
     * Extra view pitch. The slider fires per pixel; only the last value in a
     * 120 ms window reaches the link, so a drag cannot flood the BLE queue.
     */
    fun setViewPitch(degrees: Int) {
        val pitch = degrees.coerceIn(-30, 30)
        _uiState.update { it.copy(viewPitchTarget = pitch) }
        pitchJob?.cancel()
        pitchJob = viewModelScope.launch {
            delay(120)
            val yaw = Math.round(_uiState.value.control.viewYaw).coerceIn(-180, 180)
            sendCommand("view:orient:$yaw,$pitch")
        }
    }

    /**
     * One discrete view preset. The page owns the curve and the amplitude
     * (up/down are relative ±10°, recenter is absolute, breathe round-trips),
     * so the tablet only names it and keeps its own slider in step.
     */
    fun playViewAnim(name: String) {
        if (name !in ControlProtocol.VIEW_ANIM_NAMES) {
            return
        }
        sendCommand(ControlProtocol.VIEW_ANIM + name)
        val delta = when (name) {
            "up" -> 10
            "down" -> -10
            "recenter" -> null
            else -> return
        }
        _uiState.update { current ->
            val target = if (delta == null) 0 else (current.viewPitchTarget + delta)
            current.copy(viewPitchTarget = target.coerceIn(-30, 30))
        }
    }

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
        val scene = id.lowercase(java.util.Locale.US)
        if (scene !in ControlProtocol.SCENE_LABELS) {
            return
        }
        // The page is often closed when the choice is made (it is a launch
        // parameter), so echo the choice locally; the next state frame from a
        // running page supersedes it.
        _uiState.update { it.copy(control = it.control.copy(scene = scene)) }
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

    /** Hold the current view angles; only `view:anim:recenter` returns to 0. */
    fun stopView() {
        sendCommand(ControlProtocol.VIEW_STOP)
    }

    // ── Voice cues ─────────────────────────────────────────────────────────
    // The tablet only interrupts and mixes: reading is scheduled by the flow
    // itself. Microphone never opens: this is playback only.


    // ── SUS ────────────────────────────────────────────────────────────────
    /**
     * Mirror camera mode. Purely local: the mirror is a WebView on this tablet,
     * so no link traffic is involved.
     */
    fun setMirrorMode(mode: MirrorMode) {
        _uiState.update { it.copy(mirrorMode = mode) }
    }

    /**
     * Subtitle card in the headset: the spoken line, below the centre of the
     * view, while the audio runs. Off hides it without stopping the audio.
     */
    fun setSubtitles(enabled: Boolean) {
        _uiState.update { it.copy(subtitles = enabled) }
        sendCommand(
            ControlProtocol.VOICE_PREFIX + if (enabled) "subtitle:on" else "subtitle:off"
        )
    }

    /**
     * The headset reads each statement as it appears; this is the operator's
     * switch for that. The default on both sides is on.
     */
    fun setSusVoice(enabled: Boolean) {
        _uiState.update { it.copy(susVoice = enabled) }
        sendCommand(if (enabled) "sus:voice:on" else "sus:voice:off")
    }

    fun susShow(index: Int) {
        val n = index.coerceIn(1, 10)
        _uiState.update { it.copy(susIndex = n) }
        sendCommand("sus:show:$n")
    }

    fun susAnswer(value: Int) {
        val v = value.coerceIn(1, 5)
        val index = _uiState.value.susIndex
        if (index < 1) {
            return
        }
        _uiState.update { state ->
            val answers = state.susAnswers.toMutableList()
            answers[index - 1] = v
            state.copy(susAnswers = answers)
        }
        sendCommand("sus:answer:$v")
        // The page advances after each answer; mirror that here.
        if (index < 10) {
            _uiState.update { it.copy(susIndex = index + 1) }
        }
    }

    /** Share the archived sheets as JSON through the system chooser. */
    fun exportSus() {
        val history = _uiState.value.susHistory
        if (history.isEmpty()) {
            error("暂无已归档的 SUS 结果")
            return
        }
        val array = org.json.JSONArray()
        for (record in history) {
            array.put(
                org.json.JSONObject().apply {
                    put("answers", org.json.JSONArray(record.answers))
                    put("filled", record.filled)
                    put("complete", record.complete)
                    put("score", record.score ?: org.json.JSONObject.NULL)
                    put("scene", record.scene)
                    put("sessionSec", record.sessionSec)
                    put("completedAt", record.completedAt)
                }
            )
        }
        val payload = org.json.JSONObject()
            .put("version", 1)
            .put("count", history.size)
            .put("sheets", array)
            .toString()
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(android.content.Intent.EXTRA_SUBJECT, "SUS 结果 ${history.size} 份")
            putExtra(android.content.Intent.EXTRA_TEXT, payload)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            getApplication<Application>().startActivity(
                android.content.Intent.createChooser(intent, "导出 SUS 结果")
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            notice("已打开导出分享")
        } catch (error: RuntimeException) {
            error("没有可接收导出的应用")
        }
    }

    /** Brings the headset console forward on the explanation page. */
    fun showAbout() {
        sendCommand("console:about")
    }

    fun stopVoice() {
        sendCommand(ControlProtocol.VOICE_PREFIX + "stop")
    }

    fun setVoiceVolume(percent: Int) {
        val value = percent.coerceIn(0, 100)
        _uiState.update { it.copy(voiceVolume = value) }
        sendCommand(ControlProtocol.VOICE_PREFIX + "volume:" + value)
    }

    fun setVoiceDuck(db: Int) {
        val value = db.coerceIn(0, 18)
        _uiState.update { it.copy(duckDb = value) }
        sendCommand(ControlProtocol.VOICE_PREFIX + "mix:duck:" + value)
    }

    fun setVoiceSet(set: String) {
        val value = if (set == "female") "female" else "male"
        _uiState.update { it.copy(voiceSet = value) }
        sendCommand(ControlProtocol.VOICE_PREFIX + "set:" + value)
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
            error("不支持的命令")
            return
        }
        if (_uiState.value.phase != BlePhase.READY) {
            error("头显未连接")
            return
        }
        ble.sendCommand(normalized)
        // The view channel streams at ≤10 Hz; announcing every sample would
        // flood the banner, so only discrete commands report.
        if (!normalized.startsWith(ControlProtocol.VIEW_ORIENT)) {
            notice("命令已发送")
        }
    }

    fun reportError(message: String) {
        error(message)
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
                reconnectMax = max
            ).also { notice("连接中断，正在重连（$attempt/$max）") }
        }
    }

    override fun onControlGranted() {
        _uiState.update {
            it.copy(
                controlGranted = true,
                sessionActive = true,
                poseStale = true
            )
        }
    }

    override fun onControlBusy(reason: String) {
        _uiState.update {
            it.copy(
                controlGranted = false,
                sessionActive = false,
                poseStale = true
            ).also { error(reason) }
        }
    }

    override fun onControlLost(reason: String) {
        _uiState.update {
            it.copy(
                controlGranted = false,
                poseStale = true
            ).also { error(reason) }
        }
    }

    override fun onDisconnected() {
        lastPoseAt = 0L
        _uiState.update {
            it.copy(
                controlGranted = false,
                poseStale = true,
                rssi = null
            )
        }
    }

    override fun onTelemetry(pose: TelemetryPose) {
        lastPoseAt = SystemClock.elapsedRealtime()
        _uiState.update { it.copy(pose = pose, poseStale = false) }
    }

    /**
     * One SUS sheet from the headset. The tablet is where it survives: append
     * to the persisted history and mirror the answers into the live sheet so
     * the operator sees what the patient just filed.
     */
    override fun onSus(json: String) {
        val result = try {
            decodeSus(json)
        } catch (error: Exception) {
            Log.w(TAG, "SUS payload rejected: ${error.message}")
            null
        } ?: return
        val history = susStore.append(result)
        notice(
            result.score?.let { "SUS 已记录：$it 分" } ?: "SUS 已记录 ${result.filled}/10"
        )
        _uiState.update { current ->
            current.copy(
                susHistory = history,
                susAnswers = if (result.answers.size == 10) result.answers else current.susAnswers
            )
        }
    }

    private fun decodeSus(json: String): SusResult {
        val root = JSONObject(json)
        val answersArray = root.optJSONArray("answers")
        val answers = buildList {
            for (index in 0 until (answersArray?.length() ?: 0)) {
                add(answersArray?.optInt(index, 0) ?: 0)
            }
        }
        return SusResult(
            answers = answers,
            filled = root.optInt("filled", answers.count { it in 1..5 }),
            complete = root.optBoolean("complete", false),
            scene = root.optString("scene", ""),
            sessionSec = root.optInt("sessionSec", 0),
            completedAt = root.optLong("completedAt", System.currentTimeMillis())
        )
    }

    override fun onControlState(state: ControlState) {
        lastStateAt = SystemClock.elapsedRealtime()
        // The session clock: starts on the rising edge, clears on the falling
        // edge, so the readout never carries time across sessions.
        if (state.session && sessionStartedAt == 0L) {
            sessionStartedAt = SystemClock.elapsedRealtime()
        } else if (!state.session) {
            sessionStartedAt = 0L
        }
        _uiState.update { current ->
            mergeRemoteFrame(current, state, sessionStartedAt, SystemClock.elapsedRealtime())
        }
    }

    override fun onSignal(rssi: Int) {
        _uiState.update { it.copy(rssi = rssi) }
    }

    override fun onStatus(raw: String) {
        when {
            raw.startsWith(OK_PREFIX) -> notice("头显已接收指令")
            raw == ControlProtocol.STATUS_CONTROL_RELEASED ->
                notice("已释放控制")
            else -> Unit
        }
    }

    override fun onError(message: String) {
        error(message)
    }

    override fun onCleared() {
        ble.close()
        super.onCleared()
    }

    private fun refreshStaleness() {
        val now = SystemClock.elapsedRealtime()
        val stale = lastPoseAt == 0L || now - lastPoseAt > POSE_STALE_MS
        val stateStale = lastStateAt == 0L || now - lastStateAt > STATE_STALE_MS
        _uiState.update { state ->
            val elapsed = when {
                state.control.session && state.control.elapsedSec > 0 -> state.control.elapsedSec * 1000L
                sessionStartedAt == 0L -> 0L
                else -> now - sessionStartedAt
            }
            if (state.poseStale == stale &&
                state.stateStale == stateStale &&
                state.sessionElapsedMs == elapsed
            ) {
                state
            } else {
                state.copy(poseStale = stale, stateStale = stateStale, sessionElapsedMs = elapsed)
            }
        }
    }

    private companion object {
        const val TICK_MS = 500L
        /** How long "waiting for the patient" survives without a session. */
        const val ENTER_PENDING_MS = 20_000L
        const val RSSI_INTERVAL_MS = 3000L
        const val POSE_STALE_MS = 1500L
        /** Two missed 1 Hz frames: the link is no longer trustworthy. */
        const val STATE_STALE_MS = 2500L

        const val PREFERENCES = "quiet-shore-control"
        const val LAST_DEVICE_KEY = "lastDeviceAddress"

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
