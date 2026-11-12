package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.Battery
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.MotionCaps
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.ui.components.CommandBar
import com.quietshore.control.ui.components.QuickActions
import com.quietshore.control.ui.components.ReadoutBoard
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SceneSection
import com.quietshore.control.ui.components.SessionSection
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The console's session view over fixture state, for design review and for the
 * emulator self-check. It composes the shipping components and nothing else, so
 * what it shows is what the operator sees; only the state is invented.
 */
enum class ConsoleFixture { Idle, Entry, Calibrating, Running, Stopping }

@Composable
fun ConsolePreview(
    fixture: ConsoleFixture,
    batteryLevel: Int? = null,
    modifier: Modifier = Modifier
) {
    val state = fixtureState(fixture, batteryLevel)
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
    Column(
        modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
    ) {
        CommandBar(
            state = state,
            tab = "MOTION",
            onSelect = {},
            onMirrorModeChange = {},
            onOpenInfo = noop,
            onDisconnect = noop,
            onEmergencyStop = noop
        )
        ReadoutBoard(state = state)
        QuickActions(state = state, actions = actions)
        Rule()
        when (fixture) {
            ConsoleFixture.Running, ConsoleFixture.Stopping ->
                SessionSection(state = state, actions = actions)
            else -> SceneSection(state = state, actions = actions)
        }
    }
}

/** One state per row of the tree; every field is one the wire really carries. */
fun fixtureState(fixture: ConsoleFixture, batteryLevel: Int?): ControlUiState {
    val base = ControlUiState(
        phase = BlePhase.READY,
        selectedAddress = "AA:BB:CC:DD:EE:FF",
        controlGranted = true,
        battery = batteryLevel?.let { Battery(level = it, charging = false) },
        caps = MotionCaps(rise = true, lie = true, stop = true, float = true, view = true)
    )
    val running = ControlState(
        session = true,
        scene = "shore",
        floatLevel = 2,
        floatMm = 18f,
        eyeHeight = 0.68f,
        mix = 0.12f
    )
    return when (fixture) {
        ConsoleFixture.Running -> base.copy(control = running, sessionElapsedMs = 252_000L)
        ConsoleFixture.Stopping -> base.copy(
            control = running,
            stopRequested = true,
            sessionElapsedMs = 252_000L
        )
        ConsoleFixture.Calibrating -> base.copy(
            control = running.copy(calibrating = true)
        )
        ConsoleFixture.Entry -> base.copy(startPending = true)
        ConsoleFixture.Idle -> base.copy(control = ControlState(scene = "shore", floatLevel = 1))
    }
}
