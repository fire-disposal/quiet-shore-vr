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
import com.quietshore.control.model.AppCatalog
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.mergeRemoteFrame
import com.quietshore.control.model.MirrorMode
import com.quietshore.control.model.ScannedHeadset
import com.quietshore.control.model.ProgramCodec
import com.quietshore.control.model.ProgramSegment
import com.quietshore.control.model.ProgramState
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.model.SegmentProgress
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.SceneCatalogDocument
import com.quietshore.control.data.SusStore
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.SusResult
import org.json.JSONException
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
    private val trainingStore = com.quietshore.control.data.TrainingStore(application)

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
        // Only a live link rules out a search. A phase stuck in CONNECTING or
        // RECONNECTING must not swallow the operator's press: BleController
        // supersedes the earlier attempt (cancel pending connect, close the
        // manager), which is exactly what the 搜索 button should do.
        if (state.phase == BlePhase.READY) {
            return
        }
        _uiState.update {
            it.copy(
                scanAttempted = true,
                scanResults = emptyList(),
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
        // Whatever is on screen must be what boots: the operator's visible
        // choice is re-sent right before the launch, because a selection made
        // before the link existed was never transmitted. The headset treats a
        // repeat as a no-op (same value → no write, no revision bump).
        val state = _uiState.value
        if (!state.control.session) {
            // Resend the operator's choice, not the last frame's echo: after a
            // refused switch the two disagree, and the bench is what boots.
            val wanted = state.sceneIntent.ifEmpty { state.control.scene }
            sendCommand(ControlProtocol.SCENE_PREFIX + wanted)
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
        requestStop()
    }

    /**
     * Emergency stop: ends the session immediately. The page freezes motion and
     * fades the buoyancy out inside a second; this is the same `stop` the
     * patient's confirm key sends, so both converge on one path.
     */
    fun emergencyStop() {
        // Idempotent on purpose: a second press while the fade runs must not
        // be a dialog, a debounce, or a different code path.
        requestStop()
    }

    /**
     * One stop path for both keys. The tablet flips to [SessionPhase.Stopping]
     * on the press, not on a reply — the page has already frozen by the time
     * the command lands — and the next frame that drops the session flag clears
     * it. Nothing here waits for an acknowledgement the wire does not carry.
     */
    private fun requestStop() {
        if (!_uiState.value.control.session) {
            return
        }
        _uiState.update { it.copy(stopRequested = true) }
        sendCommand("stop")
    }

    /** Buoyancy intensity 0..3; the page scales amplitude linearly. */
    fun setFloatLevel(level: Int) {
        val clamped = level.coerceIn(0, 3)
        _uiState.update { it.copy(floatLevel = clamped) }
        sendCommand(ControlProtocol.FLOAT_LEVEL + clamped)
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
    }

    /**
     * Selectable scene ids: the page's catalogue minus the built-in
     * preparation room. Before the first catalogue the fallback table is all
     * we have; once the page has spoken, only its list is real.
     */
    private fun selectableSceneIds(current: ControlUiState): Set<String> {
        val announced = current.scenes
            .filterNot { it.special }
            .mapTo(HashSet()) { it.id }
        return if (announced.isEmpty()) {
            ControlProtocol.SCENE_LABELS.keys - ControlProtocol.SPECIAL_SCENES
        } else {
            announced
        }
    }

    /**
     * Marks a scene as the operator's next choice. Nothing is sent: a single
     * card press must not be the switch, because entering a real scene is the
     * deliberate second step of the session.
     */
    fun selectScene(id: String) {
        val scene = id.lowercase(java.util.Locale.US)
        if (scene !in selectableSceneIds(_uiState.value)) {
            return
        }
        // The intent is recorded here and nowhere else: `control.scene` keeps
        // the headset's report, so the two can be compared. A mark drawn ahead
        // of that frame would claim a scene the patient may never see.
        _uiState.update { it.copy(sceneIntent = scene) }
    }

    /**
     * Applies the marked scene. The page switches content under the recorded
     * calibration, which is the whole point of the preparation room; before
     * that calibration there is nothing to preserve, so the command waits for
     * the patient to be inside XR and past the posture capture.
     */
    fun applyScene() {
        val current = _uiState.value
        if (!current.control.session || current.control.calibrating || current.stopRequested) {
            return
        }
        val program = current.program
        if (program.segments.isNotEmpty()) {
            if (!programIsValid(current, program)) {
                notice("流程里有不可用的场景或参数")
                return
            }
            sendCommand("program:auto:${if (program.auto) "on" else "off"}")
            sendCommand(ProgramCodec.format(program))
            // The page reports the actual segment; highlight the first now so
            // the card row does not contradict the band.
            _uiState.update { it.copy(sceneIntent = program.segments.first().scene) }
            return
        }
        val target = current.sceneIntent
        if (target.isEmpty() ||
            target == current.control.scene ||
            target !in selectableSceneIds(current)
        ) {
            return
        }
        sendCommand(ControlProtocol.SCENE_PREFIX + target)
    }

    /**
     * Ask the headset to switch product face. The local app is not changed
     * here: the top bar shows what the headset reports, not what was clicked.
     */
    fun selectApp(id: String) {
        if (id !in AppCatalog.IDS) {
            return
        }
        if (_uiState.value.control.session) {
            notice("先结束会话，再切换应用")
            return
        }
        sendCommand(ControlProtocol.APP_PREFIX + id)
    }

    /** Opens the next program segment; at the last one the page ends. */
    fun nextSegment() {
        if (_uiState.value.segmentProgress == null) {
            return
        }
        sendCommand("program:next")
    }

    fun setProgramAuto(auto: Boolean) {
        _uiState.update { it.copy(program = it.program.copy(auto = auto)) }
        sendCommand("program:auto:${if (auto) "on" else "off"}")
    }

    /**
     * Explicit plans. An empty list is not "no plan": it is the single
     * open-ended segment the page already runs, so the editor only materialises
     * when the operator adds a second one.
     */
    fun addProgramSegment() {
        val current = _uiState.value
        val seedScene = current.sceneIntent
            .ifEmpty { current.control.scene }
            .takeIf { it in selectableSceneIds(current) }
            ?: current.selectableScenes.firstOrNull()?.id
            ?: return
        val existing = current.program.segments
        val next = if (existing.isEmpty()) {
            listOf(
                ProgramSegment(scene = seedScene, seconds = 0, voice = "none", cap = 0),
                ProgramSegment(scene = seedScene, seconds = 300, voice = "none", cap = 0)
            )
        } else {
            val last = existing.last()
            existing + ProgramSegment(scene = last.scene, seconds = 300, voice = "none", cap = last.cap)
        }
        _uiState.update { it.copy(program = it.program.copy(segments = next)) }
    }

    fun removeProgramSegment(index: Int) {
        val current = _uiState.value.program
        val next = current.segments.filterIndexed { at, _ -> at != index }
        _uiState.update { it.copy(program = current.copy(segments = next)) }
    }

    fun cycleProgramScene(index: Int) {
        val current = _uiState.value
        val ids = current.selectableScenes.map { it.id }
        if (ids.isEmpty()) {
            return
        }
        val segments = current.program.segments
        val segment = segments.getOrNull(index) ?: return
        val next = ids[(ids.indexOf(segment.scene) + 1).mod(ids.size)]
        _uiState.update {
            it.copy(
                program = it.program.copy(
                    segments = segments.mapIndexed { at, value ->
                        if (at == index) value.copy(scene = next) else value
                    }
                )
            )
        }
    }

    fun cycleProgramDuration(index: Int) {
        val lengths = listOf(0, 180, 300, 480, 600)
        val segments = _uiState.value.program.segments
        val segment = segments.getOrNull(index) ?: return
        val next = lengths[(lengths.indexOf(segment.seconds).coerceAtLeast(0) + 1) % lengths.size]
        _uiState.update {
            it.copy(
                program = it.program.copy(
                    segments = segments.mapIndexed { at, value ->
                        if (at == index) value.copy(seconds = next) else value
                    }
                )
            )
        }
    }

    fun cycleProgramVoice(index: Int) {
        val voices = listOf("none", "start", "imagine", "relax", "close")
        val segments = _uiState.value.program.segments
        val segment = segments.getOrNull(index) ?: return
        val next = voices[(voices.indexOf(segment.voice).coerceAtLeast(0) + 1) % voices.size]
        _uiState.update {
            it.copy(
                program = it.program.copy(
                    segments = segments.mapIndexed { at, value ->
                        if (at == index) value.copy(voice = next) else value
                    }
                )
            )
        }
    }

    fun cycleProgramCap(index: Int) {
        val segments = _uiState.value.program.segments
        val segment = segments.getOrNull(index) ?: return
        val next = (segment.cap + 1) % 4
        _uiState.update {
            it.copy(
                program = it.program.copy(
                    segments = segments.mapIndexed { at, value ->
                        if (at == index) value.copy(cap = next) else value
                    }
                )
            )
        }
    }

    private fun programIsValid(current: ControlUiState, program: ProgramState): Boolean {
        val scenes = selectableSceneIds(current)
        val voices = setOf("none", "start", "imagine", "relax", "close")
        return program.segments.size in 1..8 && program.segments.all { segment ->
            segment.scene in scenes &&
                segment.seconds in 0..3600 &&
                segment.cap in 0..3 &&
                segment.voice in voices
        }
    }

    private fun handleSegment(data: String) {
        val json = try {
            JSONObject(data)
        } catch (error: JSONException) {
            return
        }
        val total = json.optInt("total", 0)
        if (total <= 0) {
            return
        }
        val remaining = if (json.isNull("remainingSec")) {
            null
        } else {
            json.optInt("remainingSec", 0).coerceAtLeast(0)
        }
        val progress = SegmentProgress(
            index = json.optInt("index", 1).coerceIn(1, total),
            total = total,
            scene = json.optString("scene", ""),
            remainingSec = remaining,
            durationSec = json.optInt("durationSec", 0).coerceAtLeast(0),
            auto = json.optBoolean("auto", false)
        )
        _uiState.update { it.copy(segmentProgress = progress) }
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
    // Guidance lines are played by hand; SUS statements are scheduled by the
    // panel itself. Microphone never opens: this is playback only.

    fun playVoice(id: String) {
        val line = VoiceCatalog.line(id) ?: return
        // The panel reads its own statements as they appear; a manual tap there
        // would talk over the automatic schedule.
        if (line.group == "SUS") {
            return
        }
        sendCommand(ControlProtocol.VOICE_PREFIX + "play:" + id)
    }

    /**
     * Play one of the four scripted sequences. The page walks the steps itself
     * (gaps measured from each clip's end) and holds the bed down until the
     * last line — the tablet only starts it.
     */
    fun playVoiceSequence(name: String) {
        if (name !in VOICE_SEQUENCE_NAMES) {
            return
        }
        sendCommand(ControlProtocol.VOICE_PREFIX + "seq:" + name)
    }


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

    /**
     * The two facts the operator records after the headset is off.
     *
     * They travel to the page because the ledger lives there (it is the only
     * place that saw the whole session, link or no link).
     */
    fun recordOutcome(kind: String, yes: Boolean) {
        if (kind != "attempt" && kind != "success") {
            return
        }
        sendCommand("record:outcome:$kind:${if (yes) "yes" else "no"}")
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

    fun cycleSusFilterQuestionnaire() {
        val state = _uiState.value
        val ids = listOfNotNull(null) + state.susHistory.map { it.questionnaireId }.distinct()
        val current = state.susFilterQuestionnaire
        val next = ids[(ids.indexOf(current).coerceAtLeast(0) + 1) % ids.size]
        _uiState.update { it.copy(susFilterQuestionnaire = next) }
    }

    fun cycleSusFilterDays() {
        val days = listOf(0, 7, 30)
        val current = _uiState.value.susFilterDays
        val next = days[(days.indexOf(current).coerceAtLeast(0) + 1) % days.size]
        _uiState.update { it.copy(susFilterDays = next) }
    }

    private fun filteredSus(state: ControlUiState): List<SusResult> {
        val cutoff = if (state.susFilterDays <= 0) {
            Long.MIN_VALUE
        } else {
            System.currentTimeMillis() - state.susFilterDays * 24L * 3600L * 1000L
        }
        return state.susHistory.filter { record ->
            (state.susFilterQuestionnaire == null ||
                record.questionnaireId == state.susFilterQuestionnaire) &&
                record.completedAt >= cutoff
        }
    }

    /** Share the archived sheets as JSON through the system chooser. */
    fun exportSus() {
        val state = _uiState.value
        val history = filteredSus(state)
        val cutoff = if (state.susFilterDays <= 0) {
            Long.MIN_VALUE
        } else {
            System.currentTimeMillis() - state.susFilterDays * 24L * 3600L * 1000L
        }
        val training = trainingStore.load().filter { it.optLong("at", 0L) >= cutoff }
        if (history.isEmpty() && training.isEmpty()) {
            error("当前筛选没有已归档的结果")
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
                    put("app", record.app)
                    put("questionnaireId", record.questionnaireId)
                    put("questionnaireName", record.questionnaireName)
                }
            )
        }
        val trainingArray = org.json.JSONArray()
        for (record in training) {
            trainingArray.put(record)
        }
        val payload = org.json.JSONObject()
            .put("version", 1)
            .put("count", history.size + training.size)
            .put("sheets", array)
            .put("training", trainingArray)
            .toString()
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(
                android.content.Intent.EXTRA_SUBJECT,
                "记录 ${history.size + training.size} 条（问卷 ${history.size} / 训练 ${training.size}）"
            )
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
        // Female is the default; anything that is not an explicit male request
        // keeps it.
        val value = if (set == "male") "male" else "female"
        _uiState.update { it.copy(voiceSet = value) }
        sendCommand(ControlProtocol.VOICE_PREFIX + "set:" + value)
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
        // No "已发送" banner here: it used to replace the acknowledgement or
        // the rejection in the one-slot notice bar, so a refused command looked
        // like a command that simply did nothing. The panels already show the
        // applied state.
        ble.sendCommand(normalized)
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
    override fun onJson(topic: String, data: String) {
        when (topic) {
            "sus" -> handleSus(data)
            "catalog" -> handleCatalog(data)
            "questionnaire" -> handleQuestionnaires(data)
            "session" -> trainingStore.append(data)
            "segment" -> handleSegment(data)
            "flags" -> applyFlags(data)
            // Unknown topics are ignored: a newer headset may publish more.
            else -> Unit
        }
    }

    /**
     * The scene list, as the page announced it. The parser refuses a damaged
     * document whole: a partly read list would reorder the indices the state
     * frame's scene nibble resolves against.
     */
    private fun handleCatalog(data: String) {
        val document = SceneCatalogDocument.parse(data) ?: return
        val scenes = document.map { scene ->
            SceneCatalog.Scene(
                id = scene.id,
                name = scene.nameZh,
                blurb = scene.taglineZh,
                special = scene.special
            )
        }
        _uiState.update { it.copy(scenes = scenes) }
    }

    private fun handleQuestionnaires(data: String) {
        val list = com.quietshore.control.protocol.QuestionnaireCatalogDocument.parse(data) ?: return
        _uiState.update { current ->
            val id = current.questionnaireId.takeIf { currentId ->
                list.any { it.id == currentId }
            } ?: list.first().id
            current.copy(questionnaires = list, questionnaireId = id)
        }
    }

    /**
     * Session/flag readback from the JSON channel. These used to be packed into
     * the state frame, where every addition cost a version bump.
     */
    private fun applyFlags(data: String) {
        val json = try {
            JSONObject(data)
        } catch (error: JSONException) {
            Log.w(TAG, "flags payload rejected: ${error.message}")
            return
        }
        val caps = json.optJSONObject("caps")?.let { obj ->
            com.quietshore.control.model.MotionCaps(
                rise = obj.optBoolean("rise", false),
                lie = obj.optBoolean("lie", false),
                stop = obj.optBoolean("stop", false),
                float = obj.optBoolean("float", false),
                view = obj.optBoolean("view", false),
                blocked = obj.optString("blocked", ""),
                floatMax = obj.optInt("floatMax", 3).coerceIn(1, 3)
            )
        }
        // Absent and null both mean "not read": keep the last reading rather
        // than flashing the block away between heartbeats.
        val battery = json.optJSONObject("battery")?.let {
            com.quietshore.control.model.Battery(
                level = it.optInt("level", -1),
                charging = it.optBoolean("charging", false)
            )
        }?.takeIf { it.level in 0..100 }
        val currentApp = _uiState.value.app
        val reportedApp = json.optString("app", currentApp)
            .takeIf { it in AppCatalog.IDS }
            ?: currentApp
        _uiState.update { current ->
            current.copy(
                app = reportedApp,
                caps = caps ?: current.caps,
                battery = battery ?: current.battery,
                control = current.control.copy(
                    // The headset owns the scene: this flag is what it will
                    // boot, and a live switch re-publishes it immediately.
                    scene = json.optString("scene", current.control.scene),
                    session = json.optBoolean("session", current.control.session),
                    calibrating = json.optBoolean("calibrating", current.control.calibrating),
                    moving = json.optBoolean("moving", current.control.moving),
                    hold = json.optBoolean("hold", current.control.hold),
                    voiceAuto = json.optBoolean("voiceAuto", current.control.voiceAuto)
                )
            )
        }
    }

    private fun handleSus(json: String) {
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
            completedAt = root.optLong("completedAt", System.currentTimeMillis()),
            app = root.optString("app", "questionnaire"),
            questionnaireId = root.optString("questionnaireId", "sus"),
            questionnaireName = root.optString("questionnaireName", "")
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

    override fun onMtu(mtu: Int, code: Int) {
        // The state frame is 28 bytes and needs MTU 31 (payload = MTU - 3);
        // anything narrower truncates the notification and the tablet then
        // shows a panel of disabled controls with no explanation.
        if (code != 0 || mtu < MIN_STATE_MTU) {
            error("蓝牙包长不足（MTU $mtu），头显状态可能收不到")
        }
    }

    override fun onScanResult(name: String, address: String, rssi: Int) {
        _uiState.update { current ->
            // One row per address, refreshed in place; strongest first, so the
            // headset on this bed stays at the top of the list.
            val others = current.scanResults.filterNot { heard -> heard.address == address }
            current.copy(
                scanResults = (others + ScannedHeadset(name, address, rssi))
                    .sortedByDescending { heard -> heard.rssi }
            )
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

    private val MIN_STATE_MTU = com.quietshore.control.protocol.ControlProtocol.stateMaxBytes + 3

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
        /** The four scripted sequences the page knows by name. */
        val VOICE_SEQUENCE_NAMES = setOf("start", "imagine", "relax", "close")
        /** Two missed 1 Hz frames: the link is no longer trustworthy. */
        const val STATE_STALE_MS = 2500L

        const val PREFERENCES = "quiet-shore-control"
        const val LAST_DEVICE_KEY = "lastDeviceAddress"

        /** Headset acknowledgement prefix for accepted commands. */
        const val OK_PREFIX = "OK:"
    }
}
