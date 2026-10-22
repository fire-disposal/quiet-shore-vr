package com.quietshore.control.protocol

import java.nio.ByteBuffer
import kotlin.math.abs
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
    const val stateMaxBytes: Int = 20
    const val stateVersion: Int = 8

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

    /** Operator answers the current SUS item when the patient cannot. */
    const val SUS_ANSWER: String = "sus:answer:"
    const val SETTINGS_SKIP_CALIBRATION: String = "settings:skipcalibration:"
    const val SETTINGS_HUD: String = "settings:hud:"

    /**
     * Comfort eye height in meters. The headset persists it and replays it to
     * the page through the launch bootstrap; it is never part of [ControlState].
     */
    const val SETTINGS_EYE_HEIGHT: String = "settings:eyeheight:"
    const val EYE_HEIGHT_MIN: Float = 1.2f
    const val EYE_HEIGHT_MAX: Float = 1.9f
    const val EYE_HEIGHT_DEFAULT: Float = 1.7f

    /**
     * Absolute virtual-view orientation. [VIEW_ORIENT] is
     * `view:orient:<yaw>,<pitch>` in whole degrees:
     * yaw ∈ [−180, 180] (positive = the patient's view turns left) and pitch
     * ∈ [−90, 90] (positive = the patient sees more sky). There is no
     * translation channel. The page retargets smoothly from the current
     * orientation and the target persists with no TTL until another sample
     * arrives; the sliders send at most 10 Hz.
     *
     * [VIEW_STOP] interrupts whatever the page is playing and **holds** the
     * applied orientation. It never recenters; recentering is the discrete
     * [VIEW_ANIM] `recenter` animation.
     *
     * Note that the `up`/`down` presets are relative (±10° from the current
     * pitch) inside the page, while [VIEW_ORIENT] is absolute.
     */
    const val VIEW_ORIENT: String = "view:orient:"
    const val VIEW_STOP: String = "view:stop"

    /**
     * Discrete, parameterless view animations played by the page:
     * `view:anim:<name>` with name in [VIEW_ANIM_NAMES]. The page owns the
     * curves and amplitudes — up/down move ±10° relative to the current pitch,
     * recenter returns pitch and yaw to 0°, breathe is a 6 s return-to-start
     * curve. The tablet never sends timing or amplitude. Accepted commands are
     * acknowledged with `OK:<cmd>` like every other discrete command.
     */
    const val VIEW_ANIM: String = "view:anim:"
    val VIEW_ANIM_NAMES: Set<String> = setOf("up", "down", "recenter", "breathe")

    /** Absolute up-gaze envelope, in degrees. */
    const val VIEW_PITCH_MAX_DEG: Float = 90f

    /** Absolute yaw envelope, in degrees. */
    const val VIEW_YAW_MAX_DEG: Float = 180f

    val CAPABILITIES: List<String> = listOf(
        "start", "enter", "preview", "exit", "stop",
        "calibrate", "recalibrate", "status",
        "audio:on", "audio:off", "audio:toggle",
        "scene:<id>", "posture:rise", "posture:lower", "posture:stop",
        "cue:on", "cue:off", "cue:intensity:0-1",
        "home", "allapps", "sus:open", "sus:close", "sus:next", "sus:prev",
        "sus:answer:1-5",
        "settings:skipcalibration:on|off", "settings:hud:on|off",
        "settings:eyeheight:1.2-1.9",
        "view:orient:<yaw>,<pitch> (absolute degrees, |yaw|<=180, |pitch|<=90)",
        "view:stop",
        "view:anim:up|down|recenter|breathe"
    )

    const val STATUS_CONNECTED: String = "CONNECTED"
    const val STATUS_CONTROL_OK: String = "CONTROL_OK"
    const val STATUS_CONTROL_BUSY: String = "CONTROL_BUSY"
    const val STATUS_CONTROL_RELEASED: String = "CONTROL_RELEASED"
    const val STATUS_CONTROL_REQUIRED: String = "CONTROL_REQUIRED"
    const val STATUS_COMMAND_REJECTED: String = "COMMAND_REJECTED"

    /**
     * GATT grammar revision. The tablet sends `HELLO <version>` right after
     * CONTROL_OK and drives the console only after a matching `WELCOME`.
     * Bump this whenever the command/ack/status grammar changes: an old
     * tablet must refuse to drive a new headset (and say why) instead of
     * silently mis-parsing acknowledgements.
     */
    const val protocolVersion: Int = 2

    /** Capability bits the headset advertises in `WELCOME <version> <mask>`. */
    const val CAP_VIEW_ANIM: Int = 1 shl 0
    const val CAP_SCENE: Int = 1 shl 1
    const val CAP_POSTURE: Int = 1 shl 2
    const val CAP_CUE: Int = 1 shl 3
    const val CAP_SUS: Int = 1 shl 4
    const val CAP_EYE_HEIGHT: Int = 1 shl 5
    /** The view channel carries a yaw axis as well as up-gaze. */
    const val CAP_VIEW_YAW: Int = 1 shl 6
    const val CAPABILITIES_MASK: Int =
        CAP_VIEW_ANIM or CAP_SCENE or CAP_POSTURE or CAP_CUE or CAP_SUS or CAP_EYE_HEIGHT or
            CAP_VIEW_YAW

    const val HELLO: String = "HELLO"
    const val WELCOME: String = "WELCOME"

    /** Command acknowledgement: `ACK <seq> <OK|REJECTED|BUSY>`. */
    const val ACK: String = "ACK"
    const val RESULT_OK: String = "OK"
    const val RESULT_REJECTED: String = "REJECTED"
    const val RESULT_BUSY: String = "BUSY"

    /** The controller wrote a command before completing HELLO. */
    const val STATUS_PROTOCOL_REQUIRED: String = "PROTOCOL_REQUIRED"

    /** `PROTOCOL_MISMATCH <headsetVersion>`: versions cannot interoperate. */
    const val STATUS_PROTOCOL_MISMATCH: String = "PROTOCOL_MISMATCH"

    private val SEQUENCED_COMMAND = Regex("""#(\d{1,9}) (\S.*)""")

    /** A discrete command carrying its monotonic sequence number. */
    data class SequencedCommand(val seq: Int, val command: String)

    /** Parsed `WELCOME <version> <capabilityMask>`. */
    data class Welcome(val version: Int, val capabilities: Int)

    /** Parsed `ACK <seq> <result>`. */
    data class Ack(val seq: Int, val result: String)

    fun helloCommand(): String = "$HELLO $protocolVersion"

    fun welcomeCommand(): String = "$WELCOME $protocolVersion $CAPABILITIES_MASK"

    fun statusProtocolMismatch(): String = "$STATUS_PROTOCOL_MISMATCH $protocolVersion"

    /** Returns the peer's protocol version, or null when [raw] is not a HELLO. */
    fun parseHello(raw: String): Int? {
        val parts = raw.trim().split(' ')
        if (parts.size != 2 || parts[0] != HELLO) {
            return null
        }
        return parts[1].toIntOrNull()?.takeIf { it > 0 }
    }

    fun parseWelcome(raw: String): Welcome? {
        val parts = raw.trim().split(' ')
        if (parts.size != 3 || parts[0] != WELCOME) {
            return null
        }
        val version = parts[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
        val capabilities = parts[2].toIntOrNull()?.takeIf { it >= 0 } ?: return null
        return Welcome(version, capabilities)
    }

    /**
     * Wire form of a discrete command: `#<seq> <command>`. `view:orient` samples
     * stay unsequenced (latest-wins, no ack); every other discrete command is
     * acked and deduped by the headset.
     */
    fun sequencedCommandPayload(seq: Int, command: String): String = "#$seq $command"

    fun parseSequencedCommand(raw: String): SequencedCommand? {
        val match = SEQUENCED_COMMAND.matchEntire(raw.trim()) ?: return null
        val seq = match.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
        val command = match.groupValues[2].trim()
        if (command.isEmpty() || command.length > MAX_COMMAND_LENGTH) {
            return null
        }
        return SequencedCommand(seq, command)
    }

    fun ackPayload(seq: Int, result: String): String = "$ACK $seq $result"

    fun parseAck(raw: String): Ack? {
        val parts = raw.trim().split(' ')
        if (parts.size != 3 || parts[0] != ACK) {
            return null
        }
        val seq = parts[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
        val result = parts[2]
        if (result != RESULT_OK && result != RESULT_REJECTED && result != RESULT_BUSY) {
            return null
        }
        return Ack(seq, result)
    }

    /**
     * Whether [payload] (the exact string about to be written) expects an ACK:
     * view movement and the liveness probe are fire-and-forget, HELLO is
     * answered by WELCOME.
     */
    fun requiresSequencedAck(payload: String): Boolean =
        !payload.startsWith(VIEW_ORIENT) && payload != PING && parseHello(payload) == null

    /** Capability a discrete command depends on; 0 means "always available". */
    fun capabilityFor(command: String): Int {
        val normalized = normalize(command) ?: return 0
        return when {
            normalized.startsWith(VIEW_ORIENT) -> CAP_VIEW_ANIM
            normalized.startsWith(VIEW_ANIM) -> CAP_VIEW_ANIM
            normalized.startsWith("scene:") -> CAP_SCENE
            normalized.startsWith("posture:") -> CAP_POSTURE
            normalized.startsWith("cue:") -> CAP_CUE
            normalized.startsWith("sus:") -> CAP_SUS
            normalized.startsWith(SETTINGS_EYE_HEIGHT) -> CAP_EYE_HEIGHT
            else -> 0
        }
    }

    /** Stable English tokens for UI messages built by the tablet. */
    fun capabilityNames(mask: Int): List<String> {
        val names = ArrayList<String>(7)
        if (mask and CAP_VIEW_ANIM != 0) names.add("viewAnim")
        if (mask and CAP_SCENE != 0) names.add("scene")
        if (mask and CAP_POSTURE != 0) names.add("posture")
        if (mask and CAP_CUE != 0) names.add("cue")
        if (mask and CAP_SUS != 0) names.add("sus")
        if (mask and CAP_EYE_HEIGHT != 0) names.add("eyeheight")
        if (mask and CAP_VIEW_YAW != 0) names.add("viewYaw")
        return names
    }

    private const val MAX_COMMAND_LENGTH = 64

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

    /**
     * Plain decimal axis, identical to the page's `^-?\d+(?:\.\d+)?$`:
     * "NaN", "Infinity", exponents, a leading dot (`.5`), a leading plus and a
     * trailing dot never match. Two parsers must accept exactly one grammar.
     */
    private val NORMALIZED_AXIS = Regex("""-?\d+(?:\.\d+)?""")

    /** Parses `sus:answer:<1-5>`; anything else is rejected whole. */
    fun parseSusAnswer(command: String): Int? {
        if (!command.startsWith(SUS_ANSWER)) {
            return null
        }
        val raw = command.substring(SUS_ANSWER.length)
        if (raw.length != 1) {
            return null
        }
        val value = raw.toIntOrNull() ?: return null
        return value.takeIf { it in 1..5 }
    }

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

    /**
     * Parses `view:orient:<yaw>,<pitch>`: exactly two decimal degrees. Yaw is
     * limited to ±[VIEW_YAW_MAX_DEG] and pitch to ±[VIEW_PITCH_MAX_DEG]; any
     * other shape (extra fields, exponents, leading dot/plus, out of range) is
     * rejected whole, never clamped.
     */
    fun parseViewOrient(command: String): ViewOrientation? {
        if (!command.startsWith(VIEW_ORIENT)) {
            return null
        }
        val parts = command.substring(VIEW_ORIENT.length).split(',')
        if (parts.size != 2) {
            return null
        }
        val yaw = parseAngle(parts[0], VIEW_YAW_MAX_DEG) ?: return null
        val pitch = parseAngle(parts[1], VIEW_PITCH_MAX_DEG) ?: return null
        return ViewOrientation(yaw, pitch)
    }

    /**
     * Parses `view:anim:<name>`; the name must be exactly one of
     * [VIEW_ANIM_NAMES]. Anything else (extra parameters, unknown names,
     * trailing text) is rejected whole.
     */
    fun parseViewAnim(command: String): String? {
        if (!command.startsWith(VIEW_ANIM)) {
            return null
        }
        return command.substring(VIEW_ANIM.length).takeIf { it in VIEW_ANIM_NAMES }
    }

    private fun parseAngle(raw: String, limitDeg: Float): Float? {
        if (!NORMALIZED_AXIS.matches(raw)) {
            return null
        }
        val value = raw.toFloatOrNull() ?: return null
        return value.takeIf { it.isFinite() && abs(it) <= limitDeg }
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
            parseSusAnswer(normalized) != null ||
            normalized == "settings:skipcalibration:on" ||
            normalized == "settings:skipcalibration:off" ||
            normalized == "settings:hud:on" ||
            normalized == "settings:hud:off" ||
            parseEyeHeight(normalized) != null ||
            parseViewOrient(normalized) != null ||
            normalized == VIEW_STOP ||
            parseViewAnim(normalized) != null
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

    /**
     * 20-byte state frame, little endian:
     *
     * | byte | field |
     * | --- | --- |
     * | 0 | version (8) |
     * | 1 | scene index |
     * | 2 | flags |
     * | 3 | eye height (cm) |
     * | 4 | posturePitch — signed integer degrees, measured world tilt |
     * | 5 | postureRoll — signed integer degrees, measured world tilt |
     * | 6 | postureRise (cm) |
     * | 7 | postureProgress (%) |
     * | 8 | viewPitch — signed integer degrees, + = up-gaze |
     * | 9 | viewAnim |
     * | 10 | cueIntensity (%) |
     * | 11 | calibrationConfidence (%) |
     * | 12 | viewPreset |
     * | 13–14 | viewYaw — signed int16 degrees, + = view turned left |
     * | 15–16 | worldYaw — signed int16 degrees, applied shell × base |
     * | 17–18 | worldPitch — signed int16 degrees |
     * | 19 | worldRoll — signed int8 degrees |
     *
     * The degree fields carry whatever the page measured. This layer only
     * guarantees the bit width: the envelope is enforced once, in the page
     * (see `docs/rotation-contract.md`), never re-applied here.
     */
    fun encodeState(state: ControlState): ByteArray {
        val sceneIndex = SCENE_IDS.indexOf(state.scene).let { if (it < 0) 255 else it }
        var flags = 0
        if (state.session) flags = flags or 1
        if (state.calibrating) flags = flags or 2
        if (state.audioMuted) flags = flags or 4
        if (state.cueEnabled) flags = flags or 8
        if (state.sitUpActive) flags = flags or 16
        val buffer = ByteBuffer.allocate(stateMaxBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(stateVersion.toByte())
        buffer.put(sceneIndex.toByte())
        buffer.put(flags.toByte())
        buffer.put((state.eyeHeight * 100f).roundToInt().coerceIn(120, 190).toByte())
        buffer.put(state.posturePitch.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put(state.postureRoll.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put((state.postureRise * 100f).roundToInt().coerceIn(0, 120).toByte())
        buffer.put((state.postureProgress * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put(state.viewPitch.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put(state.viewAnim.code.toByte())
        buffer.put((state.cueIntensity * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put((state.calibrationConfidence * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put(state.viewPreset.code.toByte())
        buffer.putShort(state.viewYaw.roundToInt().coerceIn(-32768, 32767).toShort())
        buffer.putShort(state.worldYaw.roundToInt().coerceIn(-32768, 32767).toShort())
        buffer.putShort(state.worldPitch.roundToInt().coerceIn(-32768, 32767).toShort())
        buffer.put(state.worldRoll.roundToInt().coerceIn(-128, 127).toByte())
        return buffer.array()
    }

    fun decodeState(bytes: ByteArray): ControlState? {
        if (bytes.size != stateMaxBytes) return null
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if ((buffer.get().toInt() and 0xFF) != stateVersion) return null
        val sceneIndex = buffer.get().toInt() and 0xFF
        val flags = buffer.get().toInt() and 0xFF
        val eyeHeight = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val posturePitch = buffer.get().toInt().toFloat()
        val postureRoll = buffer.get().toInt().toFloat()
        val postureRise = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val postureProgress = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        // Signed byte: keep the JVM sign extension. The envelope is the page's.
        val viewPitch = buffer.get().toInt().toFloat()
        val viewAnim = ViewAnim.fromCode(buffer.get().toInt() and 0xFF)
        val cueIntensity = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val confidence = (buffer.get().toInt() and 0xFF).toFloat() / 100f
        val viewPreset = ViewPreset.fromCode(buffer.get().toInt() and 0xFF)
        val viewYaw = buffer.short.toInt().toFloat()
        val worldYaw = buffer.short.toInt().toFloat()
        val worldPitch = buffer.short.toInt().toFloat()
        val worldRoll = buffer.get().toInt().toFloat()
        if (eyeHeight < EYE_HEIGHT_MIN || eyeHeight > EYE_HEIGHT_MAX) return null
        return ControlState(
            scene = if (sceneIndex < SCENE_IDS.size) SCENE_IDS[sceneIndex] else SCENE_IDS[0],
            session = flags and 1 != 0,
            calibrating = flags and 2 != 0,
            audioMuted = flags and 4 != 0,
            cueEnabled = flags and 8 != 0,
            sitUpActive = flags and 16 != 0,
            eyeHeight = eyeHeight,
            posturePitch = posturePitch,
            postureRoll = postureRoll,
            postureRise = postureRise,
            postureProgress = postureProgress,
            viewPitch = viewPitch,
            viewYaw = viewYaw,
            worldYaw = worldYaw,
            worldPitch = worldPitch,
            worldRoll = worldRoll,
            viewAnim = viewAnim,
            cueIntensity = cueIntensity,
            calibrationConfidence = confidence,
            viewPreset = viewPreset
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

/**
 * Parsed `view:orient:<yaw>,<pitch>` in degrees. +[lookYawDeg] turns the
 * patient's view left, +[upGazeDeg] shows more sky. Both are absolute and
 * already range-checked; there is no translation channel.
 */
data class ViewOrientation(
    val lookYawDeg: Float,
    val upGazeDeg: Float
)

/**
 * View-animation presets the page can play. [NONE] is state-only: it is never a
 * valid command name, but it is the default code in the state frame.
 */
enum class ViewPreset(val code: Int, val wire: String) {
    NONE(0, "none"),
    UP(1, "up"),
    DOWN(2, "down"),
    RECENTER(3, "recenter"),
    BREATHE(4, "breathe");

    companion object {
        /** Unknown wire values fall back to [NONE] instead of failing the frame. */
        fun fromCode(code: Int): ViewPreset = entries.firstOrNull { it.code == code } ?: NONE

        /** Parses the `/state` `viewPreset` string; unknown input means none. */
        fun fromWire(raw: String?): ViewPreset =
            entries.firstOrNull { it.wire == raw?.trim()?.lowercase() } ?: NONE
    }
}

/**
 * Coarse phase of the page's view-animation player. The tablet only displays
 * it; the page owns the actual playback and its fixed durations.
 */
enum class ViewAnim(val code: Int, val wire: String) {
    IDLE(0, "idle"),
    PLAYING(1, "playing"),
    HELD(2, "held");

    companion object {
        /** Unknown wire values fall back to [IDLE] instead of failing the frame. */
        fun fromCode(code: Int): ViewAnim = entries.firstOrNull { it.code == code } ?: IDLE

        /** Parses the `/state` `viewAnim` string; unknown input means idle. */
        fun fromWire(raw: String?): ViewAnim =
            entries.firstOrNull { it.wire == raw?.trim()?.lowercase() } ?: IDLE
    }
}

data class ControlState(
    val scene: String = "landscape",
    val session: Boolean = false,
    val calibrating: Boolean = false,
    val audioMuted: Boolean = false,
    val cueEnabled: Boolean = true,
    val sitUpActive: Boolean = false,
    val eyeHeight: Float = ControlProtocol.EYE_HEIGHT_DEFAULT,
    val posturePitch: Float = 0f,
    val postureRoll: Float = 0f,
    val postureRise: Float = 0f,
    val postureProgress: Float = 0f,
    /**
     * **Currently applied** view pitch in degrees, -90..90; positive looks up.
     * It is not the requested target: a smooth retarget or animation reports
     * intermediate values here.
     */
    val viewPitch: Float = 0f,
    /**
     * **Currently applied** yaw in degrees, −180..180; positive turns the
     * patient's view left. Same "applied, not requested" rule as [viewPitch].
     */
    val viewYaw: Float = 0f,
    /** Applied world rotation (shell × base), Euler XYZ degrees. */
    val worldYaw: Float = 0f,
    val worldPitch: Float = 0f,
    val worldRoll: Float = 0f,
    /** Coarse animation phase reported by the page; see [ViewAnim]. */
    val viewAnim: ViewAnim = ViewAnim.IDLE,
    /** Preset the page last played (or is playing); see [ViewPreset]. */
    val viewPreset: ViewPreset = ViewPreset.NONE,
    val cueIntensity: Float = 1f,
    val calibrationConfidence: Float = 0f
)
