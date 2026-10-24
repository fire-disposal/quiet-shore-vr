package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose

/**
 * Session mode. Chosen by the operator before a session and never switched in
 * flight; the patient's confirm key only starts and stops.
 */
enum class SessionMode(val wire: String, val label: String) {
    FLOAT("float", "漂浮"),
    POSTURE("posture", "起身")
}

/**
 * Everything the screens render. High frequency telemetry lands here too, but
 * only the small pose readouts watch it, so recomposition stays cheap.
 */
data class ControlUiState(
    val phase: BlePhase = BlePhase.IDLE,
    val selectedAddress: String? = null,
    val controlGranted: Boolean = false,
    val sessionActive: Boolean = false,
    val pose: TelemetryPose? = null,
    val poseStale: Boolean = true,
    val control: ControlState = ControlState(),
    /** Last headset the operator connected to; null until one is stored. */
    val lastDeviceAddress: String? = null,
    /** 1-based attempt while the link is being re-established. */
    val reconnectAttempt: Int = 0,
    val reconnectMax: Int = 0,
    val rssi: Int? = null,
    /** Session mode the next session starts in; fixed once the session begins. */
    val sessionMode: SessionMode = SessionMode.FLOAT,
    /** Buoyancy intensity 0..3, mirrored from the operator's choice. */
    val floatLevel: Int = 1,
    /** Buoyancy profile the headset reports: "a" gentle, "b" standard, "c" immersive. */
    val floatProfile: String = "b",
    /** Breathing layer on the buoyancy; on by default. */
    val breathEnabled: Boolean = true,
    /** Sit-up ramp length in milliseconds. */
    val animDurationMs: Int = 6000,
    /** Operator switch for gaze dwell; on by default. */
    val gazeDwell: Boolean = true,
    /** True while the SUS scale is open in the headset. */
    val susOpen: Boolean = false,
    /** Milliseconds since the headset reported a running session. */
    val sessionElapsedMs: Long = 0L,
    /** Voice set the operator picked: "male" or "female". */
    val voiceSet: String = "male",
    /** Cue volume 0–100, independent of the scene bed. */
    val voiceVolume: Int = 90,
    /** Scene ducking depth while a cue speaks, 0–18 dB. */
    val duckDb: Int = 12,
    /** Auto mode is driving the cue schedule. */
    val voiceAuto: Boolean = false,
    /** Index of the cue the headset reports as speaking, or -1. */
    val voiceId: Int = -1,
    /** Last few cues the operator played, newest first. */
    val voiceRecent: List<String> = emptyList(),
    val notice: String? = null,
    val error: String? = null,
    val scanAttempted: Boolean = false,
    /** Launch requested, waiting for the patient's confirm key. */
    val startPending: Boolean = false
) {
    val showControls: Boolean get() = controlGranted || sessionActive

    /** The cue the headset reports, resolved against the shipped catalog. */
    val voiceLine: com.quietshore.control.voice.VoiceCatalog.Line?
        get() = com.quietshore.control.voice.VoiceCatalog.lineAt(voiceId)

    /** Last two MAC octets, without separators ("A1B2"). */
    val deviceSuffix: String
        get() {
            val address = selectedAddress ?: return ""
            val octets = address.split(':')
            return if (octets.size >= 2) {
                octets.takeLast(2).joinToString("").uppercase()
            } else {
                address.takeLast(4).uppercase()
            }
        }
}
