package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.protocol.ViewPreset

enum class ViewMode(val wire: String, val label: String) {
    PATIENT("patient", "患者视角"),
    GLOBAL("global", "全局视角")
}

/** State of the tablet-side patient-view recording. */
enum class RecordingPhase {
    IDLE,
    STARTING,
    RECORDING,
    SAVING,
    SAVED,
    FAILED;

    val isBusy: Boolean get() = this == STARTING || this == RECORDING || this == SAVING
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

/**
 * System-level view animation presets exposed by the 视角 tab. The wire enum
 * lives in the protocol; only the operator-facing labels belong here.
 */
object ViewPresets {
    val all: List<ViewPreset> = listOf(
        ViewPreset.UP,
        ViewPreset.DOWN,
        ViewPreset.RECENTER,
        ViewPreset.BREATHE
    )

    fun label(preset: ViewPreset): String = when (preset) {
        ViewPreset.UP -> "上仰"
        ViewPreset.DOWN -> "下俯"
        ViewPreset.RECENTER -> "回正"
        ViewPreset.BREATHE -> "呼吸"
        ViewPreset.NONE -> "未选择"
    }
}

object Scenes {
    val all: List<SceneOption> = listOf(
        SceneOption("landscape", "湖畔"),
        SceneOption("ward", "训练病区"),
        SceneOption("bathroom", "病房卫生间"),
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
    /** Last headset the operator connected to; null until one is stored. */
    val lastDeviceAddress: String? = null,
    /** 1-based attempt while the link is being re-established. */
    val reconnectAttempt: Int = 0,
    val reconnectMax: Int = 0,
    /** Patient-view recording, independent of the BLE lease. */
    val recording: RecordingPhase = RecordingPhase.IDLE,
    val recordingElapsedMs: Long = 0L,
    val recordingBytes: Long = 0L,
    val recordingPath: String? = null,
    val recordingError: String? = null,
    /**
     * Eye height the tablet requests. The headset is the source of truth for
     * the stored value and never echoes it back over BLE.
     */
    val eyeHeightRequested: Float = EyeHeight.DEFAULT,
    /** True once the headset confirmed the last requested eye height. */
    val eyeHeightConfirmed: Boolean = false,
    /**
     * In-flight absolute pitch target in degrees. Non-null only while the
     * slider is ahead of the headset readback, so the thumb never jumps back
     * between a local change and the next state notification.
     */
    val viewPitchRequested: Float? = null,
    /**
     * In-flight absolute yaw in degrees (+ = view turns left). Non-null only
     * while the yaw slider is ahead of the headset readback.
     */
    val viewYawRequested: Float? = null,
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
     * Why the pitch slider and sit-up controls are unavailable, or null when
     * they may be used. The page holds the pitch target itself, so this gate is
     * about authority and safety, not about telemetry liveness.
     */
    val viewPitchBlockedReason: String?
        get() = when {
            phase != BlePhase.READY -> "头显未连接"
            !controlGranted -> "尚未取得控制权"
            !control.session -> "训练开始后可用"
            control.calibrating -> "校准中视角已冻结"
            else -> null
        }

    val canAdjustView: Boolean get() = viewPitchBlockedReason == null

    /** Slider positions: the in-flight request wins over the headset readback. */
    val viewPitchDegrees: Float get() = viewPitchRequested ?: control.viewPitch
    val viewYawDegrees: Float get() = viewYawRequested ?: control.viewYaw
}
