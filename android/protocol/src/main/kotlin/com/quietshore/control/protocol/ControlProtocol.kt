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

    /**
     * The JSON channel, headset → tablet: every event-driven document (SUS
     * sheets, session/flag changes, settings echo) rides here, split into
     * `[id][index][total]` chunks so nothing depends on the ATT MTU or on a
     * fixed-width frame.
     */
    val susUuid: UUID = UUID.fromString("7a1e0001-6f3c-4f9a-9d2b-2f6a1c000006")

    /** Chunk header of the JSON channel: id, index, total — one byte each. */
    const val chunkHeaderBytes: Int = 3
    /** Chunks allowed per document; 255 is the envelope's own limit. */
    const val maxChunks: Int = 255

    const val deviceName: String = "QuietShore"
    /** Six floats: x, y, z, yaw, pitch, roll. The mirror needs the roll too. */
    const val telemetryBytes: Int = 24
    /** v13 frame size; fits a 30-byte MTU, so no chunking on the state path. */
    const val stateMaxBytes: Int = 28
    const val stateVersion: Int = 13
    /** i16 quaternion scale: components live in [-1, 1]. */
    const val QUAT_SCALE: Int = 32767

    /** The body's standing eye height, metres; the operator may change it. */
    const val EYE_HEIGHT_DEFAULT: Float = 1.7f

    /** First-claim control. The VR grants control to exactly one connected pad. */
    const val CLAIM: String = "CLAIM"
    const val RELEASE: String = "RELEASE"

    /** Internal application-level liveness probe; never routed to the page. */
    const val PING: String = "ping"
    const val PONG: String = "PONG"

    /** Host-level commands are executed by the headset service, not the page. */
    const val ENTER: String = "enter"
    const val HOME: String = "home"

    /** Operator answers the current SUS item when the patient cannot. */
    const val SUS_SHOW: String = "sus:show:"
    const val SUS_ANSWER: String = "sus:answer:"

    /** Voice cue channel: `voice:play:<id>`, `voice:stop`, `voice:volume:<0-100>`, … */
    const val VOICE_PREFIX: String = "voice:"

    /** Holds whatever the view player is doing; recentring is `view:anim:recenter`. */
    const val VIEW_STOP: String = "view:stop"

    /**
     * Discrete, parameterless view animations played by the page:
     * `view:anim:<name>` with name in [VIEW_ANIM_NAMES]. The page owns the
     * curves and amplitudes; the tablet never sends timing or amplitude.
     */
    const val VIEW_ANIM: String = "view:anim:"
    val VIEW_ANIM_NAMES: Set<String> = setOf("up", "down", "recenter")

    /** Buoyancy intensity: `float:level:<0-3>` (0 = off). */
    const val FLOAT_LEVEL: String = "float:level:"

    /** Scene switch: `scene:<id>`, only accepted before a session starts. */
    const val SCENE_PREFIX: String = "scene:"

    /** Posture ramp length: `anim:duration:<4000-20000>` milliseconds. */
    const val ANIM_DURATION: String = "anim:duration:"

    /** Operator switch for gaze dwell: `gaze:dwell:on|off`. */
    const val GAZE_DWELL: String = "gaze:dwell:"
    val GAZE_DWELL_VALUES: Set<String> = setOf("gaze:dwell:on", "gaze:dwell:off")

    /** Posture ramp: rise (mix → 1), lower (mix → 0), or freeze. */
    const val POSTURE_RISE: String = "posture:rise"
    const val POSTURE_LOWER: String = "posture:lower"
    const val POSTURE_STOP: String = "posture:stop"

    /** Absolute up-gaze envelope, in degrees. */
    const val VIEW_PITCH_MAX_DEG: Float = 90f
    /** Absolute yaw envelope, in degrees. */
    const val VIEW_YAW_MAX_DEG: Float = 180f

    /**
     * The whole command surface, for the manual and the console. Anything not
     * listed here is rejected by [isAllowedCommand]; there is no second list.
     */
    val CAPABILITIES: List<String> = listOf(
        "enter", "exit", "stop",
        "calibrate",
        "audio:on", "audio:off", "audio:toggle",
        "float:level:0-3",
        "scene:<id>",
        "anim:duration:4000-20000", "posture:rise", "posture:lower", "posture:stop",
        "home", "sus:open", "sus:close",
        "sus:show:1-10", "sus:answer:1-5", "sus:voice:on|off",
        "view:anim:up|down|recenter", "view:stop",
        "voice:play:<id>", "voice:seq:start|imagine|relax|close", "voice:stop",
        "voice:volume:0-100", "voice:mix:duck:0-18",
        "voice:set:male|female", "voice:subtitle:on|off"
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
    /** Float/motion envelope: level, profile, breath. (Was CAP_CUE before the
     * near-field particle cue was removed; the bit is unchanged on the wire.) */
    const val CAP_MOTION: Int = 1 shl 3
    const val CAP_SUS: Int = 1 shl 4
    /** Gaze dwell selection exists and can be switched by the operator. */
    const val CAP_GAZE_DWELL: Int = 1 shl 5
    const val CAPABILITIES_MASK: Int =
        CAP_VIEW_ANIM or CAP_SCENE or CAP_POSTURE or CAP_MOTION or CAP_SUS or CAP_GAZE_DWELL

    const val HELLO: String = "HELLO"
    const val WELCOME: String = "WELCOME"

    /** Command acknowledgement: `ACK <seq> <OK|REJECTED|BUSY>`. */
    const val ACK: String = "ACK"
    const val RESULT_OK: String = "OK"
    const val RESULT_REJECTED: String = "REJECTED"
    const val RESULT_BUSY: String = "BUSY"
    /** The command never reached a page: nothing is listening on the socket. */
    const val RESULT_OFFLINE: String = "OFFLINE"

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
        if (result != RESULT_OK && result != RESULT_REJECTED &&
            result != RESULT_BUSY && result != RESULT_OFFLINE
        ) {
            return null
        }
        return Ack(seq, result)
    }

    /**
     * Whether [payload] (the exact string about to be written) expects an ACK:
     * only the liveness probe is fire-and-forget, HELLO is answered by WELCOME.
     * (The 10 Hz `view:orient` stream is gone: every command is discrete.)
     */
    fun requiresSequencedAck(payload: String): Boolean =
        payload != PING && parseHello(payload) == null

    /** Capability a discrete command depends on; 0 means "always available". */
    fun capabilityFor(command: String): Int {
        val normalized = normalize(command) ?: return 0
        return when {
            normalized.startsWith(VIEW_ANIM) -> CAP_VIEW_ANIM
            normalized.startsWith(FLOAT_LEVEL) -> CAP_MOTION
            normalized.startsWith(SCENE_PREFIX) -> CAP_SCENE
            normalized.startsWith(GAZE_DWELL) -> CAP_GAZE_DWELL
            normalized.startsWith(ANIM_DURATION) -> CAP_POSTURE
            normalized.startsWith("posture:") -> CAP_POSTURE
            normalized.startsWith("sus:") -> CAP_SUS
            else -> 0
        }
    }

    /** Stable English tokens for UI messages built by the tablet. */
    fun capabilityNames(mask: Int): List<String> {
        val names = ArrayList<String>(7)
        if (mask and CAP_VIEW_ANIM != 0) names.add("viewAnim")
        if (mask and CAP_SCENE != 0) names.add("scene")
        if (mask and CAP_POSTURE != 0) names.add("posture")
        if (mask and CAP_MOTION != 0) names.add("motion")
        if (mask and CAP_SUS != 0) names.add("sus")
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
    /**
     * The page's parser is `^1\.\d{1,3}$` (see `src/app/commands.ts`); the two
     * must accept exactly one grammar, so a value the page would reject can
     * never be persisted here.
     */

    /**
     * Plain decimal axis, identical to the page's `^-?\d+(?:\.\d+)?$`:
     * "NaN", "Infinity", exponents, a leading dot (`.5`), a leading plus and a
     * trailing dot never match. Two parsers must accept exactly one grammar.
     */
    private val NORMALIZED_AXIS = Regex("""-?\d+(?:\.\d+)?""")

    /** Parses `sus:show:<1..10>`; the page clamps to the item list afterwards. */
    fun parseSusShow(command: String): Int? {
        if (!command.startsWith(SUS_SHOW)) {
            return null
        }
        val raw = command.substring(SUS_SHOW.length)
        val value = raw.toIntOrNull() ?: return null
        return value.takeIf { it in 1..SUS_ITEMS }
    }

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
        return normalized == "enter" ||
            normalized == "exit" ||
            normalized == "stop" ||
            normalized == "calibrate" ||
            normalized == "home" ||
            normalized == "audio:on" ||
            normalized == "audio:off" ||
            normalized == "audio:toggle" ||
            (normalized.startsWith(FLOAT_LEVEL) &&
                normalized.removePrefix(FLOAT_LEVEL).toIntOrNull() in 0..3) ||
            (normalized.startsWith(SCENE_PREFIX) &&
                normalized.removePrefix(SCENE_PREFIX) in SCENE_LABELS) ||
            (normalized.startsWith(GAZE_DWELL) && normalized in GAZE_DWELL_VALUES) ||
            (normalized.startsWith(ANIM_DURATION) &&
                normalized.removePrefix(ANIM_DURATION).toIntOrNull() in 4000..20000) ||
            normalized == POSTURE_RISE ||
            normalized == POSTURE_LOWER ||
            normalized == POSTURE_STOP ||
            normalized == "sus:open" ||
            parseSusShow(normalized) != null ||
            normalized == "sus:close" ||
            parseSusAnswer(normalized) != null ||
            normalized == "sus:voice:on" ||
            normalized == "sus:voice:off" ||
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
            body == "subtitle:on" || body == "subtitle:off" -> body
            body.startsWith("play:") ->
                body.removePrefix("play:").takeIf { VOICE_ID.matches(it) }
            body.startsWith("seq:") ->
                body.removePrefix("seq:").takeIf { it in VOICE_SEQUENCES }
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
            putFloat(pose.roll)
        }.array()

    fun decodeTelemetry(bytes: ByteArray): TelemetryPose? {
        if (bytes.size < telemetryBytes) return null
        val buffer = ByteBuffer.wrap(bytes, 0, telemetryBytes).order(ByteOrder.LITTLE_ENDIAN)
        return TelemetryPose(
            x = buffer.float,
            y = buffer.float,
            z = buffer.float,
            yaw = buffer.float,
            pitch = buffer.float,
            roll = buffer.float
        )
    }

    /**
     * 28-byte state frame (v13), little endian:
     *
     * | byte | field |
     * | --- | --- |
     * | 0 | version (13) |
     * | 1 | flags: session, calibrating, audio muted, moving, hold, voice auto, 2 spare |
     * | 2 | scene index 4b | float level 2b | view anim 2b |
     * | 3 | applied eye height (cm) |
     * | 4 | posture mix (0..250 = 0..100 %) |
     * | 5 | buoyancy offset (mm, signed) |
     * | 6 | view pitch (deg, signed) |
     * | 7 | view yaw (deg, ×2, signed) |
     * | 8 | voice id (0xFF = none) |
     * | 9 | calibration confidence (%) |
     * | 10–11 | elapsed seconds (u16) |
     * | 12–13 | tMs (u16) |
     * | 14–15 | seq (u16) |
     * | 16–21 | world quaternion x, y, z (i16 ÷ 32767; w derived) |
     * | 22–27 | world translation x, y, z (i16, cm) |
     *
     * Everything that can be derived is gone: the posture angle and progress
     * are `90° · mix` and `mix`, the rise is part of the eye height, and the
     * session has no mode. This layer only guarantees the bit width; envelopes
     * are enforced once, in the page.
     */
    fun encodeState(
        state: ControlState,
        nowMs: Int = 0,
        seq: Int = 0,
        target: ByteArray = ByteArray(stateMaxBytes)
    ): ByteArray {
        var flags = 0
        if (state.session) flags = flags or 1
        if (state.calibrating) flags = flags or 2
        if (state.audioMuted) flags = flags or 4
        if (state.moving) flags = flags or 8
        if (state.hold) flags = flags or 16
        if (state.voiceAuto) flags = flags or 32

        val packed = (sceneIndex(state.scene) and 0xF) or
            ((state.floatLevel.coerceIn(0, 3) and 0x3) shl 4) or
            ((state.viewAnim.code and 0x3) shl 6)

        val buffer = ByteBuffer.wrap(target).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(stateVersion.toByte())
        buffer.put(flags.toByte())
        buffer.put(packed.toByte())
        buffer.put((state.eyeHeight * 100f).roundToInt().coerceIn(0, 250).toByte())
        buffer.put((state.mix * 250f).roundToInt().coerceIn(0, 250).toByte())
        buffer.put(state.floatMm.roundToInt().coerceIn(-127, 127).toByte())
        buffer.put(state.viewPitch.roundToInt().coerceIn(-127, 127).toByte())
        buffer.put((state.viewYaw / 2f).roundToInt().coerceIn(-127, 127).toByte())
        buffer.put(if (state.voiceId < 0) 0xFF.toByte() else (state.voiceId and 0x3F).toByte())
        buffer.put(state.calibrationConfidence.roundToInt().coerceIn(0, 100).toByte())
        buffer.putShort(state.elapsedSec.coerceIn(0, 65535).toShort())
        buffer.putShort((nowMs and 0xFFFF).toShort())
        buffer.putShort((seq and 0xFFFF).toShort())
        buffer.putShort(quantize(state.worldQX).toShort())
        buffer.putShort(quantize(state.worldQY).toShort())
        buffer.putShort(quantize(state.worldQZ).toShort())
        buffer.putShort(centimetres(state.worldX).toShort())
        buffer.putShort(centimetres(state.worldY).toShort())
        buffer.putShort(centimetres(state.worldZ).toShort())
        return target
    }

    /** Quaternion component to i16; the decoder divides by the same number. */
    private fun quantize(value: Float): Int =
        (value.coerceIn(-1f, 1f) * QUAT_SCALE).roundToInt().coerceIn(-32767, 32767)

    /** Metres to signed centimetres, which is all the mirror needs. */
    private fun centimetres(value: Float): Int =
        (value.coerceIn(-327f, 327f) * 100f).roundToInt().coerceIn(-32767, 32767)

    /**
     * Splits one UTF-8 document into `[id][index][total][payload]` chunks.
     *
     * [chunkPayload] is what the link can carry per notification *after* the
     * header; the caller derives it from the negotiated MTU. Documents that do
     * not fit in [maxChunks] are refused rather than truncated.
     */
    fun encodeJsonChunks(
        payload: ByteArray,
        chunkPayload: Int,
        id: Int
    ): List<ByteArray> {
        require(chunkPayload > 0) { "chunkPayload must be positive" }
        val size = payload.size.coerceAtLeast(1)
        val total = (size + chunkPayload - 1) / chunkPayload
        require(total <= maxChunks) { "document needs $total chunks" }
        val chunks = ArrayList<ByteArray>(total)
        for (index in 0 until total) {
            val from = index * chunkPayload
            val to = minOf(payload.size, from + chunkPayload)
            val chunk = ByteArray(chunkHeaderBytes + (to - from))
            chunk[0] = (id and 0xFF).toByte()
            chunk[1] = index.toByte()
            chunk[2] = total.toByte()
            System.arraycopy(payload, from, chunk, chunkHeaderBytes, to - from)
            chunks.add(chunk)
        }
        return chunks
    }

    /** Only the v13 shape exists: the frame is not backward compatible. */
    fun decodeState(bytes: ByteArray): ControlState? {
        if (bytes.size != stateMaxBytes) return null
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if ((buffer.get().toInt() and 0xFF) != stateVersion) return null
        val flags = buffer.get().toInt() and 0xFF
        val packed = buffer.get().toInt() and 0xFF
        val eyeHeight = (buffer.get().toInt() and 0xFF) / 100f
        val mix = ((buffer.get().toInt() and 0xFF) / 250f).coerceIn(0f, 1f)
        val floatMm = buffer.get().toFloat()
        val viewPitch = buffer.get().toFloat()
        val viewYaw = buffer.get().toFloat() * 2f
        val voiceRaw = buffer.get().toInt() and 0xFF
        val confidence = (buffer.get().toInt() and 0xFF).toFloat()
        val elapsedSec = buffer.short.toInt() and 0xFFFF
        val tMs = buffer.short.toInt() and 0xFFFF
        val seq = buffer.short.toInt() and 0xFFFF
        val qx = buffer.short.toFloat() / QUAT_SCALE
        val qy = buffer.short.toFloat() / QUAT_SCALE
        val qz = buffer.short.toFloat() / QUAT_SCALE
        val worldX = buffer.short.toFloat() / 100f
        val worldY = buffer.short.toFloat() / 100f
        val worldZ = buffer.short.toFloat() / 100f
        return ControlState(
            session = flags and 1 != 0,
            calibrating = flags and 2 != 0,
            audioMuted = flags and 4 != 0,
            moving = flags and 8 != 0,
            hold = flags and 16 != 0,
            voiceAuto = flags and 32 != 0,
            scene = SCENE_IDS.getOrElse(packed and 0xF) { DEFAULT_SCENE },
            floatLevel = (packed shr 4) and 0x3,
            viewAnim = ViewAnim.fromCode((packed shr 6) and 0x3),
            eyeHeight = eyeHeight,
            mix = mix,
            floatMm = floatMm,
            viewPitch = viewPitch,
            viewYaw = viewYaw,
            voiceId = if (voiceRaw == 0xFF) -1 else voiceRaw and 0x3F,
            calibrationConfidence = confidence,
            elapsedSec = elapsedSec,
            worldQX = qx,
            worldQY = qy,
            worldQZ = qz,
            worldX = worldX,
            worldY = worldY,
            worldZ = worldZ,
            tMs = tMs,
            seq = seq
        )
    }

    /**
     * Shipped scenes. Index order is the wire contract for state byte 11:
     * append only, never reorder, or an old tablet reads the wrong scene.
     */
    val SCENE_IDS: List<String> = listOf("washroom", "shore", "lightwell", "ward")

    /** Default when the operator has not chosen: the standing washroom. */
    const val DEFAULT_SCENE: String = "washroom"

    /** Operator-facing labels. The tablet renders this list; keep ids in sync. */
    val SCENE_LABELS: Map<String, String> = linkedMapOf(
        "washroom" to "洁净立便间",
        "shore" to "仰望湖面",
        "lightwell" to "光井",
        "ward" to "病房"
    )

    /**
     * One operator-facing line per scene: what the room is and how it moves.
     * Kept here, next to the ids, because the choice card on the tablet is the
     * only place an operator sees all four at once — and a blurb that drifts
     * from the art is worse than none.
     */
    val SCENE_BLURBS: Map<String, String> = linkedMapOf(
        "washroom" to "起身视角：0.85 米外的立便器与木隔屏；躺下只见天花板的一盏筒灯。",
        "shore" to "躺卧视角：水面在身下缓缓起伏，云在头顶漂移，地平线稳定。",
        "lightwell" to "躺卧视角：6 米见方的竖井，壁上灯架缓缓上行（约 33 秒一组），幅度随起伏走。",
        "ward" to "仰卧视角：被面轻褶、窗上百叶、监护仪滚动的波形，头顶两盏嵌灯。"
    )

    private fun sceneIndex(name: String): Int {
        val index = SCENE_IDS.indexOf(name)
        return if (index < 0) 255 else index
    }

}

data class TelemetryPose(
    val x: Float,
    val y: Float,
    val z: Float,
    val yaw: Float,
    val pitch: Float,
    /** Head roll about the gaze; the mirror cannot show a tilt without it. */
    val roll: Float = 0f
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
    /** The posture ramp (or a view animation) is running right now. */
    val moving: Boolean = false,
    /** Motion frozen without ending the session. */
    val hold: Boolean = false,
    /** Voice auto mode is driving the cue schedule. */
    val voiceAuto: Boolean = false,
    /** Scene currently loaded on the page; the tablet shows this as its choice. */
    val scene: String = ControlProtocol.DEFAULT_SCENE,
    /** Buoyancy intensity the page is actually applying, 0–3. */
    val floatLevel: Int = 1,
    /** Coarse view-animation phase reported by the page; see [ViewAnim]. */
    val viewAnim: ViewAnim = ViewAnim.IDLE,
    /**
     * Applied eye height, metres. The lying eye is ~0.66 (0.71 with a pillow,
     * 0.08 on water) and the standing eye is the operator's setting, so this
     * moves through the whole rise.
     */
    val eyeHeight: Float = ControlProtocol.EYE_HEIGHT_DEFAULT,
    /**
     * The one posture scalar, 0..1: 0 is lying with the real ceiling overhead,
     * 1 is standing with the art's eye line. It both rotates the world and
     * lifts the eye — the tablet derives its angle/percentage from this.
     */
    val mix: Float = 0f,
    /** Buoyancy offset the page has **already applied**, in millimetres. */
    val floatMm: Float = 0f,
    /**
     * **Currently applied** view pitch in degrees; positive looks up. It is not
     * the requested target: an animation reports intermediate values here.
     */
    val viewPitch: Float = 0f,
    /** **Currently applied** view yaw in degrees; positive turns the view left. */
    val viewYaw: Float = 0f,
    /** Voice cue id currently speaking, or -1 for none. */
    val voiceId: Int = -1,
    /** Calibration confidence reported by the page, 0–100. */
    val calibrationConfidence: Float = 0f,
    /** Seconds since the session started, 0 while idle. */
    val elapsedSec: Int = 0,
    /**
     * Applied world rotation (shell × base) as a quaternion; `w` is derived from
     * the unit length and never sent. The mirror inverts this to reproduce the
     * patient's view exactly.
     */
    val worldQX: Float = 0f,
    val worldQY: Float = 0f,
    val worldQZ: Float = 0f,
    /** Applied world translation (shell × base), metres, device frame. */
    val worldX: Float = 0f,
    val worldY: Float = 0f,
    val worldZ: Float = 0f,
    /** Sender clock and counter; assigned at encode time. */
    val tMs: Int = 0,
    val seq: Int = 0
)
