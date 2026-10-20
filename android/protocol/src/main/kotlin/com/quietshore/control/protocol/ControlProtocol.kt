package com.quietshore.control.protocol

import java.nio.ByteBuffer
import kotlin.math.roundToInt
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Wire contract shared by the headset peripheral and the tablet central.
 *
 * The GATT payloads are deliberately tiny: telemetry is exactly 20 bytes so
 * it fits the default ATT MTU without chunking.
 */
object ControlProtocol {
    val serviceUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000001")
    val commandUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000002")
    val statusUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000003")
    val telemetryUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000004")
    val stateUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000005")

    const val deviceName: String = "QuietShore"
    const val telemetryBytes: Int = 20
    const val stateMaxBytes: Int = 12
    const val stateVersion: Int = 3

    /** First-claim control. The VR grants control to exactly one connected pad. */
    const val CLAIM: String = "CLAIM"
    const val RELEASE: String = "RELEASE"

    /** Internal application-level liveness probe; never routed to the page. */
    const val PING: String = "ping"
    const val PONG: String = "PONG"

    /** Host-level commands are executed by the headset service, not the page. */
    const val ENTER: String = "enter"
    const val HOME: String = "home"
    const val ALL_APPS: String = "allapps"
    const val SETTINGS_SKIP_CALIBRATION: String = "settings:skipcalibration:"
    const val SETTINGS_HUD: String = "settings:hud:"

    /**
     * Comfort eye height in meters. The headset persists it and replays it to
     * the page through the launch bootstrap; it is never part of [ControlState].
     */
    const val SETTINGS_EYE_HEIGHT: String = "settings:eyeheight:"
    const val EYE_HEIGHT_MIN: Float = 1.2f
    const val EYE_HEIGHT_MAX: Float = 1.9f
    const val EYE_HEIGHT_DEFAULT: Float = 1.6f

    /**
     * Virtual viewpoint movement. [VIEW_MOVE] carries normalized x/z in
     * [-1,1]; the pad repeats it at ~10 Hz while held and sends [VIEW_STOP] on
     * release. The page expires movement 300 ms after the last sample.
     */
    const val VIEW_MOVE: String = "view:move:"
    const val VIEW_STOP: String = "view:stop"

    val CAPABILITIES: List<String> = listOf(
        "start", "enter", "preview", "exit", "stop",
        "calibrate", "recalibrate", "status",
        "audio:on", "audio:off", "audio:toggle",
        "scene:<id>", "posture:rise", "posture:lower", "posture:stop",
        "cue:on", "cue:off", "cue:intensity:0-1",
        "home", "allapps", "sus:open", "sus:close", "sus:next", "sus:prev",
        "settings:skipcalibration:on|off", "settings:hud:on|off",
        "settings:eyeheight:1.2-1.9",
        "view:move:<x>,<z>", "view:stop"
    )

    const val STATUS_CONNECTED: String = "CONNECTED"
    const val STATUS_CONTROL_OK: String = "CONTROL_OK"
    const val STATUS_CONTROL_BUSY: String = "CONTROL_BUSY"
    const val STATUS_CONTROL_RELEASED: String = "CONTROL_RELEASED"
    const val STATUS_CONTROL_REQUIRED: String = "CONTROL_REQUIRED"
    const val STATUS_COMMAND_REJECTED: String = "COMMAND_REJECTED"

    fun claimPayload(): ByteArray = CLAIM.toByteArray(StandardCharsets.UTF_8)

    fun releasePayload(): ByteArray = RELEASE.toByteArray(StandardCharsets.UTF_8)

    fun commandPayload(command: String): ByteArray =
        command.trim().toByteArray(StandardCharsets.UTF_8)

    /** Returns a non-empty command, or null for malformed input. */
    fun parseCommand(raw: String): String? = raw.trim().ifEmpty { null }

    fun normalize(command: String): String? {
        val normalized = command.trim().lowercase()
        return normalized.takeIf { it.isNotEmpty() && it.length <= 64 && !it.contains('\n') }
    }

    /** Plain decimal meters only: no sign, exponent or locale-specific comma. */
    private val EYE_HEIGHT_VALUE = Regex("""\d{1,3}(?:\.\d{1,3})?""")

    /** Plain decimal axis; "NaN", "Infinity" and exponents never match. */
    private val NORMALIZED_AXIS = Regex("""-?(?:\d+(?:\.\d*)?|\.\d+)""")

    /**
     * Parses `settings:eyeheight:<meters>` and returns the value only when it
     * lies inside [EYE_HEIGHT_MIN], [EYE_HEIGHT_MAX]; null rejects the command
     * before it is persisted or queued for the page.
     */
    fun parseEyeHeight(command: String): Float? {
        if (!command.startsWith(SETTINGS_EYE_HEIGHT)) {
            return null
        }
        val raw = command.substring(SETTINGS_EYE_HEIGHT.length)
        if (!EYE_HEIGHT_VALUE.matches(raw)) {
            return null
        }
        val meters = raw.toFloatOrNull() ?: return null
        return meters.takeIf { it.isFinite() && it >= EYE_HEIGHT_MIN && it <= EYE_HEIGHT_MAX }
    }

    /** Parses `view:move:<x>,<z>`; both axes must be finite and in [-1, 1]. */
    fun parseViewMove(command: String): ViewMove? {
        if (!command.startsWith(VIEW_MOVE)) {
            return null
        }
        val parts = command.substring(VIEW_MOVE.length).split(',')
        if (parts.size != 2) {
            return null
        }
        val x = parseAxis(parts[0]) ?: return null
        val z = parseAxis(parts[1]) ?: return null
        return ViewMove(x, z)
    }

    private fun parseAxis(raw: String): Float? {
        if (!NORMALIZED_AXIS.matches(raw)) {
            return null
        }
        val value = raw.toFloatOrNull() ?: return null
        return value.takeIf { it.isFinite() && it >= -1f && it <= 1f }
    }

    fun isAllowedCommand(command: String): Boolean {
        val normalized = normalize(command) ?: return false
        return normalized == "start" ||
            normalized == "enter" ||
            normalized == "preview" ||
            normalized == "exit" ||
            normalized == "stop" ||
            normalized == "calibrate" ||
            normalized == "recalibrate" ||
            normalized == "status" ||
            normalized == "audio:on" ||
            normalized == "audio:off" ||
            normalized == "audio:toggle" ||
            (normalized.startsWith("scene:") && normalized.length > "scene:".length) ||
            normalized == "posture:rise" ||
            normalized == "posture:lower" ||
            normalized == "posture:stop" ||
            normalized == "cue:on" ||
            normalized == "cue:off" ||
            (normalized.startsWith("cue:intensity:") && normalized.length > "cue:intensity:".length) ||
            normalized == "home" ||
            normalized == "allapps" ||
            normalized == "sus:open" ||
            normalized == "sus:close" ||
            normalized == "sus:next" ||
            normalized == "sus:prev" ||
            normalized == "settings:skipcalibration:on" ||
            normalized == "settings:skipcalibration:off" ||
            normalized == "settings:hud:on" ||
            normalized == "settings:hud:off" ||
            parseEyeHeight(normalized) != null ||
            parseViewMove(normalized) != null ||
            normalized == VIEW_STOP
    }

    fun encodeTelemetry(pose: TelemetryPose): ByteArray =
        ByteBuffer.allocate(telemetryBytes).order(ByteOrder.LITTLE_ENDIAN).apply {
            putFloat(pose.x)
            putFloat(pose.y)
            putFloat(pose.z)
            putFloat(pose.yaw)
            putFloat(pose.pitch)
        }.array()

    fun decodeTelemetry(bytes: ByteArray): TelemetryPose? {
        if (bytes.size < telemetryBytes) return null
        val buffer = ByteBuffer.wrap(bytes, 0, telemetryBytes).order(ByteOrder.LITTLE_ENDIAN)
        return TelemetryPose(
            x = buffer.float,
            y = buffer.float,
            z = buffer.float,
            yaw = buffer.float,
            pitch = buffer.float
        )
    }

    private val SCENE_IDS = listOf("landscape", "ward", "bathroom", "lab")

    fun encodeState(state: ControlState): ByteArray {
        val sceneIndex = SCENE_IDS.indexOf(state.scene).let { if (it < 0) 255 else it }
        var flags = 0
        if (state.session) flags = flags or 1
        if (state.calibrating) flags = flags or 2
        if (state.audioMuted) flags = flags or 4
        if (state.cueEnabled) flags = flags or 8
        val buffer = ByteBuffer.allocate(stateMaxBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(stateVersion.toByte())
        buffer.put(sceneIndex.toByte())
        buffer.put(flags.toByte())
        buffer.put((state.eyeHeight * 100f).roundToInt().coerceIn(120, 190).toByte())
        buffer.put(((state.posturePitch + 20f).roundToInt()).coerceIn(0, 40).toByte())
        buffer.put(((state.postureRoll + 10f).roundToInt()).coerceIn(0, 20).toByte())
        buffer.put((state.postureRise * 100f).roundToInt().coerceIn(0, 120).toByte())
        buffer.put((state.postureProgress * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put(((state.viewX * 100f).roundToInt() + 45).coerceIn(0, 90).toByte())
        buffer.put(((state.viewZ * 100f).roundToInt() + 45).coerceIn(0, 90).toByte())
        buffer.put((state.cueIntensity * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put((state.calibrationConfidence * 100f).roundToInt().coerceIn(0, 100).toByte())
        return buffer.array()
    }

    fun decodeState(bytes: ByteArray): ControlState? {
        if (bytes.size != stateMaxBytes) return null
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if ((buffer.get().toInt() and 0xFF) != stateVersion) return null
        val sceneIndex = buffer.get().toInt() and 0xFF
        val flags = buffer.get().toInt() and 0xFF
        val eyeHeight = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val posturePitch = (buffer.get().toInt() and 0xFF).toFloat() - 20f
        val postureRoll = (buffer.get().toInt() and 0xFF).toFloat() - 10f
        val postureRise = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val postureProgress = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val viewX = ((buffer.get().toInt() and 0xFF) - 45).toFloat() / 100f
        val viewZ = ((buffer.get().toInt() and 0xFF) - 45).toFloat() / 100f
        val cueIntensity = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val confidence = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        if (eyeHeight < EYE_HEIGHT_MIN || eyeHeight > EYE_HEIGHT_MAX) return null
        return ControlState(
            scene = if (sceneIndex < SCENE_IDS.size) SCENE_IDS[sceneIndex] else SCENE_IDS[0],
            session = flags and 1 != 0,
            calibrating = flags and 2 != 0,
            audioMuted = flags and 4 != 0,
            cueEnabled = flags and 8 != 0,
            eyeHeight = eyeHeight,
            posturePitch = posturePitch,
            postureRoll = postureRoll,
            postureRise = postureRise,
            postureProgress = postureProgress,
            viewX = viewX,
            viewZ = viewZ,
            cueIntensity = cueIntensity,
            calibrationConfidence = confidence
        )
    }
}

data class TelemetryPose(
    val x: Float,
    val y: Float,
    val z: Float,
    val yaw: Float,
    val pitch: Float
)

/** Normalized joystick translation parsed from `view:move:<x>,<z>`. */
data class ViewMove(
    val x: Float,
    val z: Float
)

data class ControlState(
    val scene: String = "landscape",
    val session: Boolean = false,
    val calibrating: Boolean = false,
    val audioMuted: Boolean = false,
    val cueEnabled: Boolean = true,
    val eyeHeight: Float = ControlProtocol.EYE_HEIGHT_DEFAULT,
    val posturePitch: Float = 0f,
    val postureRoll: Float = 0f,
    val postureRise: Float = 0f,
    val postureProgress: Float = 0f,
    val viewX: Float = 0f,
    val viewZ: Float = 0f,
    val cueIntensity: Float = 1f,
    val calibrationConfidence: Float = 0f
)
