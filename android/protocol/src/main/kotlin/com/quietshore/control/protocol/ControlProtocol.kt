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
    const val stateVersion: Int = 10

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
    /** Voice cue channel: `voice:play:<id>`, `voice:seq:<name>`, `voice:stop`, … */
    const val VOICE_PREFIX: String = "voice:"

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

    /**
     * Session mode, chosen before a session starts: `mode:float` (default) or
     * `mode:posture` (the optional sit-up trajectory). Rejected while a session
     * is running; the page never switches mode mid-session.
     */
    const val MODE: String = "mode:"
    val MODE_NAMES: Set<String> = setOf("float", "posture")

    /** Buoyancy intensity the technician picks: `float:level:<0-3>`. */
    const val FLOAT_LEVEL: String = "float:level:"

    /**
     * Buoyancy character: `float:profile:<a|b|c>`. The profile sets amplitude,
     * period and horizon sway; it is chosen in the room, on the headset.
     */
    const val FLOAT_PROFILE: String = "float:profile:"
    val FLOAT_PROFILE_NAMES: Set<String> = setOf("a", "b", "c")

    /** Scene switch: `scene:<id>`, only accepted before a session starts. */
    const val SCENE_PREFIX: String = "scene:"

    /** Breathing layer on the heave: `float:breath:on|off`. */
    const val FLOAT_BREATH: String = "float:breath:"

    /** Sit-up ramp length: `anim:duration:<4000-20000>` milliseconds. */
    const val ANIM_DURATION: String = "anim:duration:"

    /** Operator switch for gaze dwell: `gaze:dwell:on|off`. */
    const val GAZE_DWELL: String = "gaze:dwell:"
    val GAZE_DWELL_VALUES: Set<String> = setOf("gaze:dwell:on", "gaze:dwell:off")

    /** Posture branch: rise, lower or hold, driven by the operator. */
    const val POSTURE_RISE: String = "posture:rise"
    const val POSTURE_LOWER: String = "posture:lower"
    const val POSTURE_STOP: String = "posture:stop"

    /** Absolute up-gaze envelope, in degrees. */
    const val VIEW_PITCH_MAX_DEG: Float = 90f

    /** Absolute yaw envelope, in degrees. */
    const val VIEW_YAW_MAX_DEG: Float = 180f

    val CAPABILITIES: List<String> = listOf(
        "start", "enter", "preview", "exit", "stop",
        "calibrate", "recalibrate", "status",
        "audio:on", "audio:off", "audio:toggle",
        "mode:float|posture", "float:level:0-3", "float:profile:a|b|c", "float:breath:on|off",
        "anim:duration:4000-20000", "posture:rise", "posture:lower", "posture:stop",
        "scene:<id>",
        "cue:on", "cue:off", "cue:intensity:0-1",
        "home", "allapps", "sus:open", "sus:close", "sus:next", "sus:prev",
        "sus:answer:1-5",
        "settings:skipcalibration:on|off", "settings:hud:on|off",
        "settings:eyeheight:1.2-1.9",
        "view:orient:<yaw>,<pitch> (absolute degrees, |yaw|<=180, |pitch|<=90)",
        "view:stop",
        "view:anim:up|down|recenter|breathe",
        "voice:play:<id>", "voice:seq:start|imagine|relax|close", "voice:stop",
        "voice:auto:on|off", "voice:volume:0-100", "voice:mix:duck:0-18",
        "voice:set:male|female"
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
    /** Scene switching from the tablet; absent means a single fixed scene. */
    const val CAP_SCENE: Int = 1 shl 1
    const val CAP_POSTURE: Int = 1 shl 2
    const val CAP_CUE: Int = 1 shl 3
    const val CAP_SUS: Int = 1 shl 4
    const val CAP_EYE_HEIGHT: Int = 1 shl 5
    /** The view channel carries a yaw axis as well as up-gaze. */
    const val CAP_VIEW_YAW: Int = 1 shl 6
    /** Gaze dwell selection exists and can be switched by the operator. */
    const val CAP_GAZE_DWELL: Int = 1 shl 7
    const val CAPABILITIES_MASK: Int =
        CAP_VIEW_ANIM or CAP_SCENE or CAP_POSTURE or CAP_CUE or CAP_SUS or CAP_EYE_HEIGHT or
            CAP_VIEW_YAW or CAP_GAZE_DWELL

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
            normalized.startsWith(MODE) -> CAP_POSTURE
            normalized.startsWith(FLOAT_LEVEL) -> CAP_CUE
            normalized.startsWith(FLOAT_PROFILE) -> CAP_CUE
            normalized.startsWith(SCENE_PREFIX) -> CAP_SCENE
            normalized.startsWith(GAZE_DWELL) -> CAP_GAZE_DWELL
            normalized.startsWith(FLOAT_BREATH) -> CAP_CUE
            normalized.startsWith(ANIM_DURATION) -> CAP_POSTURE
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
        if (mask and CAP_GAZE_DWELL != 0) names.add("gazeDwell")
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
            (normalized.startsWith(MODE) && normalized.removePrefix(MODE) in MODE_NAMES) ||
            (normalized.startsWith(FLOAT_LEVEL) &&
                normalized.removePrefix(FLOAT_LEVEL).toIntOrNull() in 0..3) ||
            (normalized.startsWith(FLOAT_PROFILE) &&
                normalized.removePrefix(FLOAT_PROFILE) in FLOAT_PROFILE_NAMES) ||
            (normalized.startsWith(SCENE_PREFIX) &&
                normalized.removePrefix(SCENE_PREFIX) in SCENE_LABELS) ||
            (normalized.startsWith(GAZE_DWELL) && normalized in GAZE_DWELL_VALUES) ||
            normalized == FLOAT_BREATH + "on" || normalized == FLOAT_BREATH + "off" ||
            (normalized.startsWith(ANIM_DURATION) &&
                normalized.removePrefix(ANIM_DURATION).toIntOrNull() in 4000..20000) ||
            normalized == POSTURE_RISE ||
            normalized == POSTURE_LOWER ||
            normalized == POSTURE_STOP ||
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
            parseViewAnim(normalized) != null ||
            parseVoice(normalized) != null
    }

    /**
     * Voice cues are pre-generated clips shipped in the headset APK. The tablet
     * only names a clip or a sequence; it never sends audio or timing.
     */
    private fun parseVoice(command: String): String? {
        if (!command.startsWith(VOICE_PREFIX)) return null
        val body = command.removePrefix(VOICE_PREFIX)
        return when {
            body == "stop" -> body
            body.startsWith("play:") ->
                body.removePrefix("play:").takeIf { VOICE_ID.matches(it) }
            body.startsWith("seq:") ->
                body.removePrefix("seq:").takeIf { it in VOICE_SEQUENCES }
            body == "auto:on" || body == "auto:off" -> body
            body.startsWith("volume:") ->
                body.removePrefix("volume:").toIntOrNull()?.takeIf { it in 0..100 }?.let { body }
            body.startsWith("mix:duck:") ->
                body.removePrefix("mix:duck:").toIntOrNull()?.takeIf { it in 0..18 }?.let { body }
            body == "set:male" || body == "set:female" -> body
            else -> null
        }
    }

    private val VOICE_ID = Regex("^v-[a-z-]+[0-9]*$")
    private val VOICE_SEQUENCES = setOf("start", "imagine", "relax", "close")

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

    /**
     * 20-byte state frame, little endian:
     *
     * | byte | field |
     * | --- | --- |
     * | 0 | version (10) |
     * | 1 | float level (0–3) |
     * | 2 | flags: bit0 session, bit1 calibrating, bit2 audio muted, bit3 cue enabled, bit4 sit-up active, bit5 posture mode, bit6–7 float profile (0=a, 1=b, 2=c) |
     * | 3 | eye height (cm) |
     * | 4 | posturePitch — signed integer degrees, measured world tilt |
     * | 5 | postureRoll — signed integer degrees, measured world tilt |
     * | 6 | postureRise (cm) |
     * | 7 | postureProgress (%) |
     * | 8 | viewPitch — signed integer degrees, + = up-gaze |
     * | 9 | viewAnim |
     * | 10 | cueIntensity (%) |
     * | 11 | scene index (255 = unknown) |
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
        var flags = 0
        if (state.session) flags = flags or 1
        if (state.calibrating) flags = flags or 2
        if (state.audioMuted) flags = flags or 4
        if (state.cueEnabled) flags = flags or 8
        if (state.sitUpActive) flags = flags or 16
        if (state.postureMode) flags = flags or 32
        flags = flags or ((profileIndex(state.floatProfile) and 0x3) shl 6)
        val buffer = ByteBuffer.allocate(stateMaxBytes).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(stateVersion.toByte())
        buffer.put(state.floatLevel.coerceIn(0, 3).toByte())
        buffer.put(flags.toByte())
        buffer.put((state.eyeHeight * 100f).roundToInt().coerceIn(120, 190).toByte())
        buffer.put(state.posturePitch.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put(state.postureRoll.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put((state.postureRise * 100f).roundToInt().coerceIn(0, 120).toByte())
        buffer.put((state.postureProgress * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put(state.viewPitch.roundToInt().coerceIn(-128, 127).toByte())
        buffer.put(state.viewAnim.code.toByte())
        buffer.put((state.cueIntensity * 100f).roundToInt().coerceIn(0, 100).toByte())
        buffer.put(sceneIndex(state.scene).toByte())
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
        val floatLevel = (buffer.get().toInt() and 0xFF).coerceIn(0, 3)
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
        val sceneIndex = buffer.get().toInt() and 0xFF
        val viewPreset = ViewPreset.fromCode(buffer.get().toInt() and 0xFF)
        val viewYaw = buffer.short.toInt().toFloat()
        val worldYaw = buffer.short.toInt().toFloat()
        val worldPitch = buffer.short.toInt().toFloat()
        val worldRoll = buffer.get().toInt().toFloat()
        if (eyeHeight < EYE_HEIGHT_MIN || eyeHeight > EYE_HEIGHT_MAX) return null
        return ControlState(
            session = flags and 1 != 0,
            calibrating = flags and 2 != 0,
            audioMuted = flags and 4 != 0,
            cueEnabled = flags and 8 != 0,
            sitUpActive = flags and 16 != 0,
            postureMode = flags and 32 != 0,
            floatLevel = floatLevel,
            floatProfile = profileName((flags shr 6) and 0x3),
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
            scene = SCENE_IDS.getOrElse(sceneIndex) { SCENE_IDS[0] },
            viewPreset = viewPreset
        )
    }

    /** Stable scene ids; index order is the wire contract for byte 11. */
    val SCENE_IDS: List<String> = listOf("landscape", "ward", "bathroom", "lab")

    /** Flagship scene: the ward bathroom. Default everywhere a scene is implied. */
    const val DEFAULT_SCENE: String = "bathroom"

    /**
     * Scenes that actually ship, with operator-facing labels. The tablet renders
     * this list, so adding a scene is one entry here plus its content module.
     */
    val SCENE_LABELS: Map<String, String> = linkedMapOf(
        "bathroom" to "病房卫生间",
        "landscape" to "湖畔晨岸",
        "ward" to "病房",
        "lab" to "直立光室"
    )

    private fun sceneIndex(name: String): Int {
        val index = SCENE_IDS.indexOf(name)
        return if (index < 0) 255 else index
    }

    /**
     * Two flag bits carry the profile: a=0, b=1, c=2. An unknown value decodes
     * as the default profile rather than failing the whole frame.
     */
    private fun profileIndex(name: String): Int = when (name) {
        "a" -> 0
        "c" -> 2
        else -> 1
    }

    private fun profileName(index: Int): String = when (index) {
        0 -> "a"
        2 -> "c"
        else -> "b"
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
    val session: Boolean = false,
    val calibrating: Boolean = false,
    val audioMuted: Boolean = false,
    val cueEnabled: Boolean = true,
    val sitUpActive: Boolean = false,
    val postureMode: Boolean = false,
    /** Buoyancy intensity the page is actually applying, 0–3. */
    val floatLevel: Int = 1,
    /** Buoyancy profile the page is actually applying: "a", "b" or "c". */
    val floatProfile: String = "b",
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
    /** Scene currently loaded on the page; the tablet shows this as its choice. */
    val scene: String = ControlProtocol.DEFAULT_SCENE
)
