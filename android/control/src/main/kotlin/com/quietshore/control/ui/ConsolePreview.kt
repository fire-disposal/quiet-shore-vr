package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.Battery
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.MotionCaps
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.SceneCatalogDocument
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The console's session view over fixture state, for design review and for the
 * emulator self-check. It composes the shipping [ControlScreen] and nothing
 * else, so what it shows is what the operator sees; only the state is invented.
 *
 * `说明` opens the real guide over the same fixture, so the two screens can be
 * compared in one run.
 */
enum class ConsoleFixture { Idle, Entry, Calibrating, Running, Stopping }

@Composable
fun ConsolePreview(
    fixture: ConsoleFixture,
    batteryLevel: Int? = null,
    /** `--ez mirror true` opens the mirror cover on launch, for design review. */
    withMirror: Boolean = false,
    /** `--ez pose true` gives the fixture a live state frame. */
    withPose: Boolean = false,
    /** `--ez drift true` makes the local choice disagree with the frame. */
    withDrift: Boolean = false,
    /** `--ez elapsed true`: a session just ended, so its question is up. */
    withElapsed: Boolean = false,
    /** `--es tapped washroom` pretends that card was just pressed. */
    tapped: String? = null,
    /** `--es catalog '<json>'` replaces the local scene table with the wire one. */
    catalog: String? = null,
    /** `--es current prep` marks the built-in room as the loaded scene. */
    current: String? = null,
    /** `--es app questionnaire` renders the other product face. */
    app: String? = null,
    /** `--ez records true` seeds two archived questionnaire sheets. */
    seedRecords: Boolean = false,
    /** `--ei filterDays 7` seeds the archive's time filter. */
    filterDays: Int? = null,
    /** `--ei sessionAgeSec 0` overrides the fixture's running clock. */
    sessionAgeSec: Int? = null,
    /** `--ei mix 45` puts the applied correction at 45 % for design review. */
    mixPercent: Int? = null,
    /** `--ei level 60` sets the buoyancy percentage the page reports. */
    percent: Int? = null,
    /** `--ez breath off` draws the breathing switch in its off state. */
    breath: Boolean? = null,
    modifier: Modifier = Modifier
) {
    val state = fixtureState(fixture, batteryLevel, withPose, withDrift, tapped, withElapsed)
        .let { base ->
            if (current.isNullOrBlank()) {
                base
            } else {
                base.copy(
                    sceneIntent = "",
                    control = base.control.copy(scene = current),
                    // The preparation room declares no motion: the page sends a
                    // zero ceiling, so the fixture does too.
                    caps = if (current == "prep") {
                        base.caps.copy(float = false, floatCap = 0)
                    } else {
                        base.caps
                    }
                )
            }
        }
        .let { base ->
            val scenes = catalog?.let(SceneCatalogDocument::parse)?.map {
                SceneCatalog.Scene(it.id, it.nameZh, it.taglineZh, it.special)
            }
            if (scenes.isNullOrEmpty()) base else base.copy(scenes = scenes)
        }
        .let { base -> if (app.isNullOrBlank()) base else base.copy(app = app) }
        .let { base ->
            if (!seedRecords) {
                return@let base
            }
            val now = System.currentTimeMillis()
            val answers = listOf(4, 2, 5, 1, 4, 2, 5, 2, 4, 1)
            base.copy(
                susHistory = listOf(
                    com.quietshore.control.protocol.SusResult(
                        answers = answers,
                        filled = 10,
                        complete = true,
                        scene = "shore",
                        sessionSec = 312,
                        completedAt = now - 2L * 24 * 3600 * 1000,
                        questionnaireId = "sus",
                        questionnaireName = "系统可用性量表"
                    ),
                    com.quietshore.control.protocol.SusResult(
                        answers = answers.map { 5 },
                        filled = 10,
                        complete = true,
                        scene = "ward",
                        sessionSec = 240,
                        completedAt = now - 40L * 24 * 3600 * 1000,
                        questionnaireId = "sus",
                        questionnaireName = "系统可用性量表"
                    )
                )
            )
        }
        .let { base -> if (filterDays == null) base else base.copy(susFilterDays = filterDays) }
        .let { base ->
            if (sessionAgeSec == null) base
            else base.copy(sessionElapsedMs = sessionAgeSec.toLong() * 1000L)
        }
        // The three numbers the review actually looks at: the correction, the
        // heave and its character.
        .let { base ->
            base.copy(
                mix = mixPercent?.let { (it / 100f).coerceIn(0f, 1f) } ?: base.mix,
                breath = breath ?: base.breath,
                floatPercent = percent ?: base.floatPercent
            )
        }
    val noop: () -> Unit = {}
    val actions = ControlActions(
        onStartTraining = noop,
        onAppSelect = {},
        onSceneSelect = {},
        onSceneApply = noop,
        onAnimDuration = {},
        onPostureMix = {},
        onGazeDwellChange = {},
        onSusVoiceChange = {},
        onSubtitlesChange = {},
        onMirrorModeChange = {},
        onSusOpen = noop,
        onSusClose = noop,
        onEnterTraining = noop,
        onEnd = noop,
        onRecalibrate = noop,
        onAdaptationSkip = noop,
        onToggleAudio = noop,
        onFloatAmount = {},
        onBreathChange = {},
        onViewAnim = {},
        onViewStop = noop,
        onPostureLower = noop,
        onPostureRise = noop,
        onPostureStop = noop,
        onDisconnect = noop,
        onReconnect = noop,
        onLeave = noop,
        onVoiceOpen = noop,
        onVoicePlay = {},
        onVoiceSequence = {},
        onVoiceStop = noop,
        onVoiceVolume = {},
        onAudioVolume = {},
        onVoiceDuck = {},
        onVoiceSet = {},
        onSusShow = {},
        onSusAnswer = {},
        onExportRecords = noop,
        onSusFilterQuestionnaire = noop,
        onSusFilterDays = noop,
        onOutcome = { _, _ -> }
    )
    ControlScreen(
        state = state,
        actions = actions,
        startWithMirrorOpen = withMirror,
        modifier = modifier
    )
}

/** One state per row of the tree; every field is one the wire really carries. */
fun fixtureState(
    fixture: ConsoleFixture,
    batteryLevel: Int?,
    withPose: Boolean = false,
    withDrift: Boolean = false,
    tapped: String? = null,
    withElapsed: Boolean = false
): ControlUiState {
    val base = ControlUiState(
        phase = BlePhase.READY,
        selectedAddress = "AA:BB:CC:DD:EE:FF",
        controlGranted = true,
        battery = batteryLevel?.let { Battery(level = it, charging = false) },
        caps = MotionCaps(
            rise = true,
            lie = true,
            stop = true,
            float = true,
            view = true,
            floatCap = 100
        )
    )
    val pose = if (withPose) {
        TelemetryPose(x = 0f, y = 1.2f, z = 0f, yaw = 0.12f, pitch = -0.06f)
    } else {
        null
    }
    val running = ControlState(
        session = true,
        scene = "shore",
        floatMm = 18f,
        eyeHeight = 0.68f,
        mix = 0.12f
    )
    // The spread the mirror exists to expose: the bench asked for one scene,
    // the headset is still playing the other.
    val drift = tapped ?: if (withDrift) "washroom" else ""
    return when (fixture) {
        ConsoleFixture.Running -> base.copy(
            sceneIntent = drift,
            control = running,
            sessionElapsedMs = 252_000L,
            pose = pose,
            poseStale = pose == null
        )
        ConsoleFixture.Stopping -> base.copy(
            sceneIntent = drift,
            control = running,
            stopRequested = true,
            sessionElapsedMs = 252_000L,
            pose = pose,
            poseStale = pose == null
        )
        // A calibrating session still streams pose: the headset is measuring
        // where the head is, so the mirror has a picture and the readout has
        // numbers. The fixture owes the screen the same frame the wire does.
        ConsoleFixture.Calibrating -> base.copy(
            control = running.copy(calibrating = true),
            sessionElapsedMs = 8_000L,
            pose = pose,
            poseStale = pose == null,
            // The page blocks posture changes while it is measuring; say so.
            caps = base.caps.copy(rise = false, lie = false, stop = false, blocked = "校准中")
        )
        ConsoleFixture.Entry -> base.copy(startPending = true)
        ConsoleFixture.Idle -> base.copy(
            sceneIntent = drift,
            control = ControlState(scene = "shore"),
            // `--ez elapsed true`: the state just after a session, which is the
            // only time the bedside question is on screen.
            sessionElapsedMs = if (withElapsed) 252_000L else 0L
        )
    }
}
