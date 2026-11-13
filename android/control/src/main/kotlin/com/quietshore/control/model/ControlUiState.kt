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
    val blocked: String = "",
    /**
     * Buoyancy ceiling of the scene the headset has loaded, as a percent
     * (0–100). The bar clamps to it, so a request never has to be reduced
     * downstream.
     *
     * **0 is a real value**: the preparation room declares no motion, and a
     * control that cannot move the patient is not drawn as one that can.
     */
    val floatCap: Int = 100
)

enum class MirrorMode(val label: String) {
    PATIENT("VR视角"),
    OVERVIEW("全局视角")
}

/**
 * The headset's own battery, as its sticky system broadcast reported it.
 *
 * Null means "not read yet", which is a different thing from "empty": the
 * tablet draws nothing rather than a made-up 0 %. The one threshold that
 * matters on a headset strapped to a patient is 20 % — below it the session may
 * not outlast the exercise — so that is the only state that gets a mark, and it
 * gets ice, not red: nothing is broken, something needs charging.
 */
/**
 * One headset heard during a scan. The list is the only place a link can
 * start: the operator picks, the app never guesses.
 */
data class ScannedHeadset(
    val name: String,
    val address: String,
    val rssi: Int
)

data class Battery(val level: Int, val charging: Boolean) {
    val low: Boolean get() = level <= 20
    val full: Boolean get() = charging && level >= 100
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
    /**
     * What the operator asked for, as opposed to what the headset is playing.
     *
     * `control.scene` is the headset's own report (the state frame's byte 11,
     * or the flags document): it is what the patient is inside *now*. This
     * field is the local intent — the card that carries the ice outline on the
     * preparation bench. They differ for the second between a tap and the
     * frame that confirms it, and they differ for good if the headset refuses
     * the switch. Both are shown when they disagree, because a technician
     * whose bench says one scene and whose mirror shows another is looking at
     * a captured-SUS-grade data error, not a cosmetic one.
     */
    val sceneIntent: String = "",
    /** Last headset the operator connected to; null until one is stored. */
    val lastDeviceAddress: String? = null,
    /** 1-based attempt while the link is being re-established. */
    val reconnectAttempt: Int = 0,
    val reconnectMax: Int = 0,
    val rssi: Int? = null,
    /** Buoyancy as a whole percent of the envelope, mirrored from the page. */
    val floatPercent: Int = 100,
    /**
     * The heave's breathing switch, read back from the page. Off keeps the same
     * envelope and period as a plain sine — the patient still floats.
     */
    val breath: Boolean = true,
    /**
     * Sit-up ramp length the headset holds, milliseconds.
     *
     * This is a readback like every other live value: the operator picks a
     * length, the page keeps it, and the row highlights what the page says. A
     * local copy would keep showing 10 s after a page reload reset it to 6.
     */
    val rampMs: Int = 0,
    /**
     * Correction applied, 0–1: the one posture scalar. The headset reports it
     * every state frame; the bar draws it, and the handle follows the hand.
     */
    val mix: Float = 0f,
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
    /**
     * Whether the page's orientation gate has opened.
     *
     * The page owns the timing and publishes only the verdict: the tablet keeps
     * the capture key closed until then and never counts anything down. True by
     * default, so an older page that does not publish it cannot lock the key.
     */
    val adaptationDone: Boolean = true,
    /** Voice set the operator picked: "male" or "female". */
    val voiceSet: String = "female",
    /** Cue volume 0–100, independent of the scene bed. */
    val voiceVolume: Int = 90,
    /** Ambience level 0–100 of the scene bed's authored loudness. */
    val waterVolume: Int = 100,
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
     * The tablet has asked to end the session and the page has not reported the
     * session gone yet: the fade is running. Cleared by the frame that drops
     * the session flag, never by a timer.
     */
    val stopRequested: Boolean = false,
    /** No state frame from the headset for a while: the link is not live. */
    val stateStale: Boolean = false,
    /** Capabilities reported by the headset's motion plan. */
    val caps: MotionCaps = MotionCaps(),
    /** Headset battery from its `flags` document; null until it is read. */
    val battery: Battery? = null,

    /** Headsets advertised since the scan started, newest first. */
    val scanResults: List<ScannedHeadset> = emptyList(),

    /**
     * The scene catalogue, as the page announced it.
     *
     * Empty until the first `catalog` document arrives; the UI then renders this
     * list instead of a local table, so adding a scene is one entry in the
     * page's registry and nothing in Kotlin.
     */
    val scenes: List<SceneCatalog.Scene> = emptyList(),

    /** Product face the headset reports; the top bar displays this value. */
    val app: String = "training",

    /** Questionnaire catalogue announced by the page. */
    val questionnaires: List<
        com.quietshore.control.protocol.QuestionnaireCatalogDocument.Questionnaire
        > = emptyList(),

    /** Instrument the sheet currently shows; defaults to the first announced. */
    val questionnaireId: String = "sus",

    /** Record filters: null = all questionnaires, 0 = all time. */
    val susFilterQuestionnaire: String? = null,
    val susFilterDays: Int = 0
) {
    val showControls: Boolean get() = controlGranted || sessionActive

    /** The announced instrument the sheet is showing, if any. */
    val questionnaire: com.quietshore.control.protocol.QuestionnaireCatalogDocument.Questionnaire?
        get() = questionnaires.firstOrNull { it.id == questionnaireId }
            ?: questionnaires.firstOrNull()

    /** Cards the operator may choose; the built-in preparation room is not one. */
    val selectableScenes: List<SceneCatalog.Scene>
        get() = (scenes.ifEmpty { SceneCatalog.ALL }).filterNot { it.special }

    /** True while the page is still in the built-in preparation space. */
    val inSpecialScene: Boolean
        get() = (scenes.ifEmpty { SceneCatalog.ALL })
            .firstOrNull { it.id == control.scene }
            ?.special == true

    /** True when the operator's choice has not been confirmed by the headset. */
    val sceneIntentDiverges: Boolean
        get() = sceneIntent.isNotEmpty() && sceneIntent != control.scene

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
