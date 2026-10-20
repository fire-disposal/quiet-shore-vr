package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose

enum class ViewMode(val wire: String, val label: String) {
    PATIENT("patient", "患者视角"),
    GLOBAL("global", "全局视角")
}

data class DiscoveredDevice(
    val address: String,
    val rssi: Int
) {
    val shortAddress: String get() = address.takeLast(4).uppercase()
}

data class SceneOption(
    val id: String,
    val label: String
)

/**
 * Eye height range shared by the stepper and the ViewModel. Values come from
 * the wire contract; the headset owns persistence, the tablet only mirrors the
 * value it last sent.
 */
object EyeHeight {
    const val MIN: Float = ControlProtocol.EYE_HEIGHT_MIN
    const val MAX: Float = ControlProtocol.EYE_HEIGHT_MAX
    const val DEFAULT: Float = ControlProtocol.EYE_HEIGHT_DEFAULT
    const val STEP: Float = 0.05f
}

object Scenes {
    val all: List<SceneOption> = listOf(
        SceneOption("landscape", "湖畔"),
        SceneOption("ward", "训练病区"),
        SceneOption("bathroom", "浴室"),
        SceneOption("lab", "实验")
    )

    fun label(id: String): String =
        all.firstOrNull { it.id == id }?.label ?: id
}

/**
 * Everything the screens render. High frequency telemetry lands here too, but
 * only the small pose readouts watch it, so recomposition stays cheap.
 */
data class ControlUiState(
    val phase: BlePhase = BlePhase.IDLE,
    val devices: List<DiscoveredDevice> = emptyList(),
    val selectedAddress: String? = null,
    val controlGranted: Boolean = false,
    val sessionActive: Boolean = false,
    val pose: TelemetryPose? = null,
    val poseStale: Boolean = true,
    val control: ControlState = ControlState(),
    val viewMode: ViewMode = ViewMode.GLOBAL,
    val fullscreen: Boolean = false,
    /**
     * Eye height the tablet requests. The headset is the source of truth for
     * the stored value and never echoes it back over BLE.
     */
    val eyeHeightRequested: Float = EyeHeight.DEFAULT,
    /** True once the headset confirmed the last requested eye height. */
    val eyeHeightConfirmed: Boolean = false,
    /** Explicit therapist gate: reveals the virtual view joystick. Never persisted. */
    val advancedUnlocked: Boolean = false,
    val rssi: Int? = null,
    val notice: String? = null,
    val error: String? = null,
    val scanAttempted: Boolean = false
) {
    val showControls: Boolean get() = controlGranted || sessionActive

    val deviceSuffix: String
        get() = selectedAddress?.takeLast(4)?.uppercase() ?: ""

    val canConnect: Boolean
        get() = !phase.isBusy && phase != BlePhase.SCANNING

    /**
     * Virtual view translation is only valid while this tablet owns control of
     * a running, calibrated, not-recalibrating session with live telemetry.
     * A stopped session means the patient owns the view again.
     */
    val canSteerView: Boolean
        get() = phase == BlePhase.READY &&
            controlGranted &&
            control.session &&
            !control.calibrating &&
            !poseStale
}
