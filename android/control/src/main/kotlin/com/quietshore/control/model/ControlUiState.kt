package com.quietshore.control.model

import com.quietshore.control.ble.BlePhase
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose

/**
 * Session mode. Chosen by the operator before a session and never switched in
 * flight; the patient's confirm key only starts and stops.
 */
/** Which camera the mirror uses: the patient's own, or a pulled-back view. */
/**
 * What the headset's motion plan says the operator may ask for. The tablet
 * enables controls from this and nothing else: deriving enablement locally is
 * how 躺下 stayed dead after a rise in float mode.
 */
data class MotionCaps(
    val rise: Boolean = false,
    val lie: Boolean = false,
    val stop: Boolean = false,
    val float: Boolean = false,
    val view: Boolean = false,
    val blocked: String = ""
)

enum class MirrorMode(val label: String) {
    PATIENT("VR视角"),
    OVERVIEW("全局视角")
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
    /** Buoyancy intensity 0..3, mirrored from the operator's choice. */
    val floatLevel: Int = 1,
    /** Sit-up ramp length in milliseconds. */
    val animDurationMs: Int = 6000,
    /** Operator switch for gaze dwell; on by default. */
    val gazeDwell: Boolean = true,
    /** Operator switch for reading the SUS statement aloud; on by default. */
    val susVoice: Boolean = true,
    /** Operator switch for the headset subtitle card; on by default. */
    val subtitles: Boolean = true,
    /** Mirror camera: the patient's view (default) or the room overview. */
    val mirrorMode: MirrorMode = MirrorMode.PATIENT,
    /** True while the SUS scale is open in the headset. */
    val susOpen: Boolean = false,
    /** Milliseconds since the headset reported a running session. */
    val sessionElapsedMs: Long = 0L,
    /** Voice set the operator picked: "male" or "female". */
    val voiceSet: String = "female",
    /** Cue volume 0–100, independent of the scene bed. */
    val voiceVolume: Int = 90,
    /** Scene ducking depth while a cue speaks, 0–18 dB. */
    val duckDb: Int = 12,
    /** Index of the cue the headset reports as speaking, or -1. */
    val voiceId: Int = -1,
    /** 1-based question currently shown on the headset, 0 = none. */
    val susIndex: Int = 0,
    /** Answers recorded from the tablet, 1..5, 0 = unanswered. */
    val susAnswers: List<Int> = List(10) { 0 },
    /** Every sheet the headset has filed, newest last. Persisted on the tablet. */
    val susHistory: List<com.quietshore.control.protocol.SusResult> = emptyList(),
    val scanAttempted: Boolean = false,
    /** Launch requested, waiting for the patient's confirm key. */
    val startPending: Boolean = false,
    /**
     * Scene the operator just picked, until a headset frame confirms it.
     * Confirmation is up to one state frame away (~1 s); without this the card
     * snaps back to the old scene right after the tap.
     */
    val scenePending: String? = null,
    /** No state frame from the headset for a while: the link is not live. */
    val stateStale: Boolean = false,
    /** Capabilities reported by the headset's motion plan. */
    val caps: MotionCaps = MotionCaps()
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
