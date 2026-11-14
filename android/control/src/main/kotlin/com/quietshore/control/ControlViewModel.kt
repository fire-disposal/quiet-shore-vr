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
import com.quietshore.control.model.OutcomeReceipt
import com.quietshore.control.model.OutcomeState
import com.quietshore.control.model.PREPARATION_SCENE
import com.quietshore.control.model.ScannedHeadset
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.SceneCatalogDocument
import com.quietshore.control.data.SusStore
import com.quietshore.control.data.ExperienceCsv
import com.quietshore.control.data.ExperienceStore
import com.quietshore.control.model.ExperienceDraft
import com.quietshore.control.ui.ExperienceField
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
    private val experienceStore = ExperienceStore(application)
    private val trainingStore = com.quietshore.control.data.TrainingStore(application)
    private val eventLog = com.quietshore.control.data.EventLog(application)

    private val _uiState = MutableStateFlow(
        ControlUiState(
            lastDeviceAddress = preferences.getString(LAST_DEVICE_KEY, null),
            susHistory = susStore.load(),
            experienceHistory = experienceStore.load()
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
            it.copy(
                startPending = true,
                // A new launch asks a new question: the previous session's
                // confirmed answer belongs to that session's row in the ledger
                // and must not be drawn beside the pending launch.
                lastSessionElapsedMs = 0L,
                outcome = outcomeForNewSession(it)
            ).also { notice("已请求启动，等待患者进入画面") }
        }
        sendCommand(ControlProtocol.ENTER)
        enterPendingJob?.cancel()
        enterPendingJob = viewModelScope.launch {
            delay(ENTER_PENDING_MS)
            _uiState.update { it.copy(startPending = false) }
        }
    }

    /**
     * Back out of a launch the patient has not opened yet.
     *
     * [SessionPhase.Entry] is the only window in which nothing has been entered:
     * the page is sitting on its entry screen and the patient has pressed
     * nothing. So the cancel is the page's own `exit` (which returns it to that
     * screen) plus dropping the tablet's pending flag — never a session stop,
     * and never a link drop. The previous session's closing panel comes back
     * with its length, since nothing new has run.
     */
    fun cancelLaunch() {
        if (!_uiState.value.startPending) {
            return
        }
        enterPendingJob?.cancel()
        _uiState.update { it.copy(startPending = false) }
        sendCommand("exit")
        notice("已取消启动")
    }

    /** End the session. There is one stop: the page freezes motion and fades out
     * inside a second. The tablet flips to [SessionPhase.Stopping] on the press,
     * not on a reply, because the next frame that drops the session flag clears it.
     */
    fun endSession() {
        requestStop()
    }

    private fun requestStop() {
        if (!_uiState.value.control.session) {
            return
        }
        _uiState.update { it.copy(stopRequested = true) }
        sendCommand("stop")
    }

    /**
     * Buoyancy as a whole percent of the envelope. The page scales the
     * amplitude linearly and caps it to the loaded scene's own ceiling; no
     * optimistic write here, the bar's fill is the page's readback.
     */
    fun setFloatAmount(percent: Int) {
        sendCommand(ControlProtocol.FLOAT_LEVEL + percent.coerceIn(0, 100))
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
     * The one key that switches immediately: the neutral preparation room.
     *
     * Every other scene is a two-step (mark, then 切换场景) because entering a
     * performance is deliberate. Leaving one is not: the room that stops the
     * bed, the voice and the heave is the way *out*, and it has no calibrating
     * requirement of its own. Routing it through `selectScene` was what made the
     * key dead — `selectScene` refuses ids outside the *selectable* list, and the
     * preparation room is excluded from that list by construction, so the press
     * was dropped before anything was sent.
     *
     * Mid-session it is a live scene switch like any other; outside a session it
     * is simply refused, since there is nothing to leave.
     */
    fun enterPreparationRoom() {
        val state = _uiState.value
        if (!state.control.session || state.control.calibrating || state.stopRequested) {
            return
        }
        if (state.control.scene == PREPARATION_SCENE && !state.prepRequested) {
            return
        }
        _uiState.update {
            it.copy(sceneIntent = PREPARATION_SCENE, prepRequested = true)
        }
        sendCommand(ControlProtocol.SCENE_PREFIX + PREPARATION_SCENE)
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
        val target = current.sceneIntent
        if (target.isEmpty() || target == current.control.scene) {
            return
        }
        // The preparation room is a valid destination but not a selectable
        // card, so the allowlist is "the catalogue, plus the way out".
        if (target != PREPARATION_SCENE && target !in selectableSceneIds(current)) {
            return
        }
        if (target == PREPARATION_SCENE) {
            enterPreparationRoom()
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

    /**
     * Gaze dwell switch. It is on by default because a supine patient has no
     * pointer; turning it off leaves only the tablet able to answer.
     */
    fun setGazeDwell(enabled: Boolean) {
        _uiState.update { it.copy(gazeDwell = enabled) }
        sendCommand(ControlProtocol.GAZE_DWELL + if (enabled) "on" else "off")
    }

    /** The heave's breathing switch: off is a plain sine, not a stop. */
    fun setBreath(on: Boolean) {
        // Readback, not optimism: the toggle follows the page's own `breath`.
        sendCommand(if (on) "float:breath:on" else "float:breath:off")
    }

    /** Sit-up ramp length; slower reads as gentler for a frail patient. */
    fun setAnimDuration(millis: Int) {
        // No optimistic write: the page echoes the length it now holds, and the
        // row follows the echo. A click the page refused must not look applied.
        sendCommand(
            ControlProtocol.ANIM_DURATION +
                millis.coerceIn(ControlProtocol.RAMP_MS_MIN, ControlProtocol.RAMP_MS_MAX)
        )
    }

    /**
     * Correction slider target, whole percent. Absolute, not a delta: the page
     * owns the speed and the queue keeps only the newest sample of a drag.
     */
    fun setPostureMix(percent: Int) {
        // Again no optimistic write: the bar's fill is the page's readback, and
        // only the handle follows the finger.
        sendCommand(ControlProtocol.POSTURE_MIX + percent.coerceIn(0, 100))
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

    /** The bedside decides when the patient has had enough of the empty room. */
    fun skipAdaptation() {
        sendCommand("adapt:skip")
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
     * place that saw the whole session, link or no link). What is *not* here is
     * any local success: the panel only shows "已记录" when the page answers
     * with its own `log kind=outcome.recorded` receipt (see [handlePageEvent]),
     * because a command acknowledgement says the write was received, not that
     * it was filed.
     */
    fun recordOutcome(kind: String, yes: Boolean) {
        if (!OutcomeReceipt.isSlot(kind)) {
            return
        }
        val state = _uiState.value
        if (state.outcome.pending) {
            // One write in flight per question: a second tap before the receipt
            // would make the two answers indistinguishable in the log.
            notice("上一次记录还在等待页面回执")
            return
        }
        if (kind == OutcomeReceipt.SLOT_SUCCESS && !state.outcome.canReportSuccess) {
            notice("先确认是否尝试过")
            return
        }
        if (state.phase != BlePhase.READY) {
            error("头显未连接，无法记录")
            return
        }
        _uiState.update {
            it.copy(outcome = it.outcome.copy(pending = true))
        }
        sendCommand(OutcomeReceipt.command(kind, yes))
    }

    /**
     * One outcome receipt from the page: the only event that may turn a tap
     * into "已记录". A late or duplicated frame is applied whole — the fold is
     * idempotent and ordered by the page's own `at`.
     */
    private fun applyOutcomeReceipt(detail: JSONObject) {
        val record = OutcomeReceipt.parse(detail) ?: return
        _uiState.update { state ->
            val next = OutcomeReceipt.fold(record, state.outcome)
            state.copy(
                outcome = next.copy(
                    recordedAt = maxOf(record.at, state.outcome.recordedAt),
                    pending = false
                )
            )
        }
    }

    /**
     * The question for the session about to start is a clean one.
     *
     * A write still in flight belongs to the ledger row of the session that just
     * ended; its receipt is folded into that row on the page. Carrying the
     * `pending` flag across a launch would lock the *next* panel behind a
     * receipt that will never be attributed to it.
     */
    private fun outcomeForNewSession(state: ControlUiState): OutcomeState =
        if (state.outcome.isEmpty) state.outcome else OutcomeState()


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

    /**
     * The page's own event: a calibration capture, a scene change, a stop the
     * patient pressed. Only the headset knows these fired, and they are the
     * half of the timeline that the tablet's command log cannot infer.
     */
    private fun handlePageEvent(data: String) {
        val json = try {
            JSONObject(data)
        } catch (error: JSONException) {
            return
        }
        val app = json.optString("app").ifEmpty { "training" }
        val kind = json.optString("kind")
        if (kind.isEmpty()) {
            return
        }
        val detail = json.optJSONObject("d") ?: JSONObject()
        val recordId = json.optString("id")
        if (recordId.isNotEmpty()) {
            detail.put("id", recordId)
        }
        eventLog.append(app, "page.$kind", detail)
        // The one behaviour event that changes tablet state instead of merely
        // being logged: the page confirming it filed the bedside answer.
        if (kind == OutcomeReceipt.LOG_KIND) {
            applyOutcomeReceipt(detail)
        }
    }

    /**
     * Everything this tablet has recorded, in one document.
     *
     * Three record kinds, one export: behaviour events, finished sessions, and
     * questionnaire sheets. They are useless apart — a sheet without the
     * session it followed, or a session without the presses that ended it,
     * cannot be read. Exported through the system chooser so nothing leaves
     * the device without the operator choosing a destination.
     */
    fun exportRecords(filterDays: Int = 0, questionnaireId: String? = null) {
        val state = _uiState.value
        val days = if (filterDays <= 0) state.susFilterDays else filterDays
        val instrument = questionnaireId ?: state.susFilterQuestionnaire
        val cutoff = if (days <= 0) {
            Long.MIN_VALUE
        } else {
            System.currentTimeMillis() - days * 24L * 3600L * 1000L
        }
        val sheets = state.susHistory.filter { record ->
            (instrument == null || record.questionnaireId == instrument) &&
                record.completedAt >= cutoff
        }
        val sessions = trainingStore.load().filter { it.optLong("at", 0L) >= cutoff }
        val events = eventLog.load().filter { it.optLong("at", 0L) >= cutoff }
        if (sheets.isEmpty() && sessions.isEmpty() && events.isEmpty()) {
            error("当前筛选没有已归档的记录")
            return
        }
        val sheetArray = org.json.JSONArray()
        for (record in sheets) {
            sheetArray.put(
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
        val sessionArray = org.json.JSONArray()
        for (record in sessions) {
            sessionArray.put(record)
        }
        val eventArray = org.json.JSONArray()
        for (record in events) {
            eventArray.put(record)
        }
        val payload = org.json.JSONObject()
            .put("version", 2)
            .put("exportedAt", System.currentTimeMillis())
            .put("filterDays", days)
            .put("count", sheets.size + sessions.size + events.size)
            .put("sheets", sheetArray)
            .put("sessions", sessionArray)
            .put("events", eventArray)
            .toString()
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(
                android.content.Intent.EXTRA_SUBJECT,
                "记录 ${sheets.size + sessions.size + events.size} 条"
                    + "（问卷 ${sheets.size} / 会话 ${sessions.size} / 行为 ${events.size}）"
            )
            putExtra(android.content.Intent.EXTRA_TEXT, payload)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            getApplication<Application>().startActivity(
                android.content.Intent.createChooser(intent, "导出本机记录")
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            notice("已打开导出分享")
        } catch (error: RuntimeException) {
            error("没有可接收导出的应用")
        }
    }

    // -----------------------------------------------------------------------
    // 体验 (experience observation)
    // -----------------------------------------------------------------------

    /**
     * Opens a 体验 form, stamped with the session that just ran.
     *
     * The two captured facts are read once, here: the scene the patient was
     * actually inside (`control.scene`, the headset's own report, not the
     * bench's intent) and the length of the session that just ended
     * ([ControlUiState.lastSessionElapsedMs], which survives the flag drop). The
     * form then holds them, so a scene switch mid-typing cannot rewrite the row.
     *
     * An already-open form is replaced rather than stacked: one sheet, one save.
     */
    fun openExperience() {
        val state = _uiState.value
        _uiState.update {
            it.copy(
                experienceDraft = ExperienceDraft(
                    openedAt = System.currentTimeMillis(),
                    scene = state.control.scene,
                    sessionSec = (state.lastSessionElapsedMs / 1000L).toInt()
                )
            )
        }
    }

    fun cancelExperience() {
        _uiState.update { it.copy(experienceDraft = null) }
    }

    fun setExperienceParticipant(text: String) {
        _uiState.update { state ->
            val draft = state.experienceDraft ?: return@update state
            // Eight characters is a subject code, not a name: the record is
            // filed on a ward tablet and carries no patient identifier.
            state.copy(experienceDraft = draft.copy(participant = text.take(8)))
        }
    }

    /** One 0–10 rating. The field is addressed by name, never by position. */
    fun setExperienceRating(field: ExperienceField, value: Int) {
        val v = value.coerceIn(0, com.quietshore.control.model.EXPERIENCE_MAX_RATING)
        _uiState.update { state ->
            val draft = state.experienceDraft ?: return@update state
            state.copy(
                experienceDraft = when (field) {
                    ExperienceField.FloatStrength -> draft.copy(floatStrength = v)
                    ExperienceField.Disorientation -> draft.copy(disorientation = v)
                    ExperienceField.SceneRealism -> draft.copy(sceneRealism = v)
                    ExperienceField.BodyAlignment -> draft.copy(bodyAlignment = v)
                    ExperienceField.Comfort -> draft.copy(comfort = v)
                    ExperienceField.Dizziness -> draft.copy(dizziness = v)
                    ExperienceField.Nausea -> draft.copy(nausea = v)
                    ExperienceField.RepeatWish -> draft.copy(repeatWish = v)
                }
            )
        }
    }

    fun setExperienceDirection(direction: String) {
        val sanitized = com.quietshore.control.model.FloatDirection.sanitize(direction)
        _uiState.update { state ->
            val draft = state.experienceDraft ?: return@update state
            state.copy(experienceDraft = draft.copy(direction = sanitized))
        }
    }

    fun setExperienceNotes(text: String) {
        _uiState.update { state ->
            val draft = state.experienceDraft ?: return@update state
            state.copy(experienceDraft = draft.copy(notes = text))
        }
    }

    /**
     * Files the open form.
     *
     * The record is written and the draft cleared in one state update, so the
     * list under the form gains its row in the same frame the form empties —
     * there is no window in which the sheet looks lost. A save with no draft is
     * a no-op rather than an empty record: an all-zero sheet is not an
     * observation.
     */
    fun saveExperience() {
        val draft = _uiState.value.experienceDraft ?: return
        val record = draft.toRecord()
        val next = experienceStore.append(record)
        _uiState.update { it.copy(experienceDraft = null, experienceHistory = next) }
        notice("已记录 ${record.participantLabel} 的体验")
    }

    /**
     * Shares every filed 体验 record as a CSV file.
     *
     * A real file with a Chinese header and a BOM, handed over as
     * `application/csv` through the app's own `FileProvider`: the operator opens
     * it in Excel on the spot, or sends it on with whatever messenger the ward
     * already uses. Nothing here depends on the headset or on the other product
     * face being installed.
     */
    fun exportExperienceCsv() {
        val state = _uiState.value
        val records = state.experienceHistory
        if (records.isEmpty()) {
            error("还没有体验记录，先填一张表再导出")
            return
        }
        val scenes = state.scenes
        val name = ExperienceCsv.fileName()
        val uri = try {
            shareExperienceFile(name, ExperienceCsv.bytes(records, scenes))
        } catch (failure: Exception) {
            error("无法写入导出文件")
            return
        }
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "application/csv"
            putExtra(android.content.Intent.EXTRA_STREAM, uri)
            putExtra(
                android.content.Intent.EXTRA_SUBJECT,
                "体验记录 ${records.size} 条"
            )
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            getApplication<Application>().startActivity(
                android.content.Intent.createChooser(intent, "导出体验记录")
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            notice("已生成 ${records.size} 条体验记录")
        } catch (failure: RuntimeException) {
            error("没有可接收导出的应用")
        }
    }

    /**
     * Writes the sheet into the share cache and returns its content URI.
     *
     * The file is rewritten per export: a cache that accumulated one CSV per
     * export would grow with the trial, and the operator only ever wants the
     * latest. The `experience/` subdirectory is the one `res/xml/file_paths.xml`
     * declares, so the authority below is the only thing that has to match.
     */
    private fun shareExperienceFile(name: String, bytes: ByteArray): android.net.Uri {
        val context = getApplication<Application>()
        val dir = java.io.File(context.cacheDir, EXPERIENCE_EXPORT_DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            throw java.io.IOException("cannot create $dir")
        }
        dir.listFiles()?.forEach { stale -> stale.delete() }
        val file = java.io.File(dir, name)
        file.writeBytes(bytes)
        return androidx.core.content.FileProvider.getUriForFile(
            context,
            EXPERIENCE_AUTHORITY,
            file
        )
    }

    fun stopVoice() {
        sendCommand(ControlProtocol.VOICE_PREFIX + "stop")
    }

    fun setVoiceVolume(percent: Int) {
        val value = percent.coerceIn(0, 100)
        _uiState.update { it.copy(voiceVolume = value) }
        sendCommand(ControlProtocol.VOICE_PREFIX + "volume:" + value)
    }

    /** Ambience level; independent of the cue volume on the same page. */
    fun setAudioVolume(percent: Int) {
        val value = percent.coerceIn(0, 100)
        _uiState.update { it.copy(waterVolume = value) }
        sendCommand(ControlProtocol.AUDIO_VOLUME + value)
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
        // One event per accepted command, in the face it was pressed in: this
        // is the seam the split record stores cannot see on their own.
        eventLog.append(
            _uiState.value.app,
            "command",
            org.json.JSONObject().put("c", normalized)
        )
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
                reconnectMax = if (settled) 0 else state.reconnectMax,
                battery = if (settled) state.battery else null
            )
        }
    }

    override fun onReconnecting(attempt: Int, max: Int) {
        eventLog.append("system", "link.reconnecting", org.json.JSONObject().put("attempt", attempt))
        _uiState.update {
            it.copy(
                reconnectAttempt = attempt,
                reconnectMax = max
            ).also { notice("连接中断，正在重连（$attempt/$max）") }
        }
    }

    override fun onControlGranted() {
        eventLog.append("system", "link.ready")
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
                poseStale = true,
                battery = null
            ).also { error(reason) }
        }
    }

    override fun onControlLost(reason: String) {
        eventLog.append("system", "link.lost", org.json.JSONObject().put("reason", reason))
        _uiState.update {
            it.copy(
                controlGranted = false,
                poseStale = true,
                battery = null
            ).also { error(reason) }
        }
    }

    override fun onDisconnected() {
        eventLog.append("system", "link.disconnected")
        lastPoseAt = 0L
        _uiState.update {
            it.copy(
                controlGranted = false,
                poseStale = true,
                rssi = null,
                battery = null
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
            "session" -> {
                if (trainingStore.append(data)) {
                    eventLog.append("training", "session.recorded", org.json.JSONObject(data))
                }
            }
            "log" -> handlePageEvent(data)
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
                // 0 is a real ceiling: a room that does not move at all.
                // Both arrive as fractions of the envelope; the console speaks
                // whole percents.
                floatCap = Math.round(obj.optDouble("floatCap", 1.0).toFloat() * 100f)
                    .coerceIn(0, 100)
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
                adaptationDone = json.optBoolean("adaptationDone", true),
                rampMs = json.optInt("rampMs", current.rampMs).coerceIn(0, 60_000),
                mix = json.optDouble("mix", current.mix.toDouble()).toFloat().coerceIn(0f, 1f),
                breath = json.optBoolean("breath", current.breath),
                floatPercent = Math.round(
                    json.optDouble("floatAmount", current.floatPercent / 100.0).toFloat() * 100f
                ).coerceIn(0, 100),
                caps = caps ?: current.caps,
                battery = battery ?: current.battery,
                control = current.control.copy(
                    // The headset owns the scene: this flag is what it will
                    // boot, and a live switch re-publishes it immediately.
                    scene = json.optString("scene", current.control.scene),
                    session = json.optBoolean("session", current.control.session),
                    calibrating = json.optBoolean("calibrating", current.control.calibrating),
                    moving = json.optBoolean("moving", current.control.moving)
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
        // The headset re-sends its last sheet on every subscribe, so most calls
        // here are replays. Only a genuinely new record may write the ledger
        // event, show the recorded notice, or replace the local answers.
        val history = when (val appended = susStore.append(result)) {
            is SusStore.Appended.Duplicate -> {
                Log.i(TAG, "SUS replay ignored: ${result.key}")
                appended.history
            }
            is SusStore.Appended.Recorded -> {
                eventLog.append(
                    "questionnaire",
                    "sheet.recorded",
                    org.json.JSONObject()
                        .put("questionnaireId", result.questionnaireId)
                        .put("complete", result.complete)
                        .put("filled", result.filled)
                        .put("score", result.score ?: org.json.JSONObject.NULL)
                )
                notice(
                    result.score?.let { "SUS 已记录：$it 分" } ?: "SUS 已记录 ${result.filled}/10"
                )
                appended.history
            }
        }
        _uiState.update { current ->
            current.copy(
                susHistory = history,
                susAnswers = if (result.answers.size == 10) result.answers else current.susAnswers
            )
        }
    }

    private fun decodeSus(json: String): SusResult =
        com.quietshore.control.protocol.SusResultCodec.decode(JSONObject(json))
            ?: throw IllegalArgumentException("answers missing")

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
        if (raw == ControlProtocol.STATUS_CONTROL_RELEASED) {
            notice("已释放控制")
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

        /** Must equal the `authorities` in AndroidManifest's provider. */
        const val EXPERIENCE_AUTHORITY = "com.quietshore.control.fileprovider"

        /** The one cache subdirectory `res/xml/file_paths.xml` exposes. */
        const val EXPERIENCE_EXPORT_DIR = "experience"
    }
}
