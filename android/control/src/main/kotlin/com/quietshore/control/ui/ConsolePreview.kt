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
import com.quietshore.control.protocol.ControlState
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
    openMirror: Boolean = false,
    /** `--ez pose true` gives the fixture a live state frame. */
    withPose: Boolean = false,
    /** `--ez drift true` makes the local choice disagree with the frame. */
    withDrift: Boolean = false,
    modifier: Modifier = Modifier
) {
    val state = fixtureState(fixture, batteryLevel, withPose, withDrift)
    var showGuide by remember { mutableStateOf(false) }
    val noop: () -> Unit = {}
    val actions = ControlActions(
        onStartTraining = noop,
        onExitScene = noop,
        onExitSystem = noop,
        onSceneSelect = {},
        onAnimDuration = {},
        onGazeDwellChange = {},
        onSusVoiceChange = {},
        onSubtitlesChange = {},
        onMirrorModeChange = {},
        onSusOpen = noop,
        onSusClose = noop,
        onEnterTraining = noop,
        onEnd = noop,
        onRecalibrate = noop,
        onToggleAudio = noop,
        onFloatLevel = {},
        onViewAnim = {},
        onViewStop = noop,
        onEmergencyStop = noop,
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
        onVoiceDuck = {},
        onVoiceSet = {},
        onSusShow = {},
        onSusAnswer = {},
        onSusExport = noop
    )
    Box(
        modifier
            .fillMaxSize()
            .background(QuietPalette.Paper)
    ) {
        if (showGuide) {
            GuideScreen(onBack = { showGuide = false })
        } else {
            ControlScreen(
                state = state,
                actions = actions,
                onOpenInfo = { showGuide = true },
                startWithMirrorOpen = openMirror
            )
        }
    }
}

/** One state per row of the tree; every field is one the wire really carries. */
fun fixtureState(
    fixture: ConsoleFixture,
    batteryLevel: Int?,
    withPose: Boolean = false,
    withDrift: Boolean = false
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
            floatMax = 3
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
        floatLevel = 2,
        floatMm = 18f,
        eyeHeight = 0.68f,
        mix = 0.12f
    )
    // The spread the mirror exists to expose: the bench asked for one scene,
    // the headset is still playing the other.
    val drift = if (withDrift) "washroom" else ""
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
        ConsoleFixture.Calibrating -> base.copy(
            control = running.copy(calibrating = true),
            sessionElapsedMs = 8_000L
        )
        ConsoleFixture.Entry -> base.copy(startPending = true)
        ConsoleFixture.Idle -> base.copy(
            sceneIntent = drift,
            control = ControlState(scene = "shore", floatLevel = 1)
        )
    }
}
