package com.quietshore.control.protocol

import java.nio.ByteBuffer
import kotlin.math.roundToInt
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Wire contract shared by the headset peripheral and the tablet central.
 *
 * The GATT payloads are deliberately tiny: telemetry is exactly 24 bytes and
 * the QS2 state schema is 28 bytes. A 31-byte ATT payload carries the frame
 * without chunking.
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
    /** QS2 protocol generation. No QS1 peer is supported or shipped. */
    const val PROTOCOL_GENERATION: String = "QS2"
    /** State-frame schema inside generation QS2. */
    const val STATE_SCHEMA_VERSION: Int = 1
    /** QS2 schema 1 is 28 bytes; fits a 31-byte ATT payload without chunking. */
    const val stateMaxBytes: Int = 28
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

    /** Operator answers the current SUS item when the patient cannot. */
    const val SUS_SHOW: String = "sus:show:"
    const val SUS_ANSWER: String = "sus:answer:"

    /** Ambience level: `audio:volume:<0-100>` (0 = the bed is silent, not off). */
    const val AUDIO_VOLUME: String = "audio:volume:"

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

    /** Buoyancy intensity: `float:level:<0-100>` percent of the envelope. */
    const val FLOAT_LEVEL: String = "float:level:"

    /**
     * Scene switch: `scene:<id>`, accepted before or during a session.
     *
     * Mid-session the page swaps content only (`App.switchSceneLive`): the
     * calibration frame, view offset and buoyancy keep running, the intensity
     * ceiling is clamped to the new scene, and a posture change rides the
     * operator's usual ramp. Refused while the posture card is capturing and
     * while a stop fade owns the world.
     */
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

    /**
     * Operator slider: `posture:mix:<0-100>`, whole percent.
     *
     * Absolute target, not a delta: the tablet may send it as fast as the hand
     * moves (the queue keeps only the newest), and the page owns the speed. The
     * first sample of a drag is the manual override.
     */
    const val POSTURE_MIX: String = "posture:mix:"

    /**
     * Ramp length band, seconds. One value drives both directions — a slower
     * rise is also a slower lie-back, which is what the bedside asks for.
     */
    const val RAMP_S_MIN: Int = 4
    const val RAMP_S_MAX: Int = 20
    const val RAMP_S_DEFAULT: Int = 10
    const val RAMP_MS_MIN: Int = RAMP_S_MIN * 1000
    const val RAMP_MS_MAX: Int = RAMP_S_MAX * 1000

    /**
     * The whole command surface, for the manual and the console. Anything not
     * listed here is rejected by [isAllowedCommand]; there is no second list.
     */
    val CAPABILITIES: List<String> = listOf(
        "enter", "exit", "stop",
        "calibrate", "adapt:skip",
        "audio:on", "audio:off", "audio:toggle", "audio:volume:0-100",
        "float:level:0-100", "float:breath:on|off",
        "scene:<id>",
        "app:training|questionnaire",
        "gaze:dwell:on|off",
        "anim:duration:$RAMP_MS_MIN-$RAMP_MS_MAX", "posture:rise", "posture:lower", "posture:stop",
        "posture:mix:0-100",
        "sus:open", "sus:close",
        "sus:show:1-10", "sus:answer:1-5", "sus:voice:on|off",
        "view:anim:up|down|recenter", "view:stop",
        "voice:play:<id>", "voice:seq:start|imagine|relax|close", "voice:stop",
        "voice:volume:0-100", "voice:mix:duck:0-18",
        "voice:set:male|female", "voice:subtitle:on|off",
        // The bedside answer to "did this session help", recorded on the page's
        // ledger after the headset is off. Two facts, each yes or no.
        "record:outcome:attempt|success:yes|no"
    )

    const val STATUS_CONNECTED: String = "CONNECTED"
    const val STATUS_CONTROL_OK: String = "CONTROL_OK"
    const val STATUS_CONTROL_BUSY: String = "CONTROL_BUSY"
    const val STATUS_CONTROL_RELEASED: String = "CONTROL_RELEASED"
    const val STATUS_CONTROL_REQUIRED: String = "CONTROL_REQUIRED"
    const val STATUS_COMMAND_REJECTED: String = "COMMAND_REJECTED"

    /** Capability bits advertised in `WELCOME <generation> <schema> <mask>`. */
    const val CAP_VIEW_ANIM: Int = 1 shl 0
    const val CAP_SCENE: Int = 1 shl 1
    const val CAP_POSTURE: Int = 1 shl 2
    /** Continuous buoyancy: amount and breath. */
    const val CAP_MOTION: Int = 1 shl 3
    const val CAP_SUS: Int = 1 shl 4
    const val CAP_GAZE_DWELL: Int = 1 shl 5
    const val CAPABILITIES_MASK: Int =
        CAP_VIEW_ANIM or CAP_SCENE or CAP_POSTURE or CAP_MOTION or CAP_SUS or CAP_GAZE_DWELL

    /**
     * QS2 protocol identity. The tablet sends `HELLO QS2 1` after CONTROL_OK
     * and drives the console only after a matching `WELCOME`. The symbolic
     * generation prevents a retired numeric prototype from being mistaken for
     * a supported peer.
     */
    const val HELLO: String = "HELLO"
    const val WELCOME: String = "WELCOME"

    /** Command acknowledgement: `ACK <seq> <OK|REJECTED|BUSY>`. */
    const val ACK: String = "ACK"
    const val RESULT_OK: String = "OK"
    const val RESULT_REJECTED: String = "REJECTED"
    const val RESULT_BUSY: String = "BUSY"
    /** The command never reached a page: nothing is listening on the socket. */
    const val RESULT_OFFLINE: String = "OFFLINE"

    /** `PROTOCOL_MISMATCH <generation> <schema>`: the peer cannot interoperate. */
    const val STATUS_PROTOCOL_MISMATCH: String = "PROTOCOL_MISMATCH"

    private val SEQUENCED_COMMAND = Regex("""#(\d{1,9}) (\S.*)""")

    /** A discrete command carrying its monotonic sequence number. */
    data class SequencedCommand(val seq: Int, val command: String)

    /** Parsed `HELLO <generation> <schema>`. */
    data class Hello(val generation: String, val schema: Int)

    /** Parsed `WELCOME <generation> <schema> <capabilityMask>`. */
    data class Welcome(val generation: String, val schema: Int, val capabilities: Int)

    /** Parsed `ACK <seq> <result>`. */
    data class Ack(val seq: Int, val result: String)

    fun helloCommand(): String = "$HELLO $PROTOCOL_GENERATION $STATE_SCHEMA_VERSION"

    fun welcomeCommand(): String =
        "$WELCOME $PROTOCOL_GENERATION $STATE_SCHEMA_VERSION $CAPABILITIES_MASK"

    fun statusProtocolMismatch(): String =
        "$STATUS_PROTOCOL_MISMATCH $PROTOCOL_GENERATION $STATE_SCHEMA_VERSION"

    /** Returns the peer's generation and schema, or null for a malformed HELLO. */
    fun parseHello(raw: String): Hello? {
        val parts = raw.trim().split(' ')
        if (parts.size != 3 || parts[0] != HELLO || parts[1].isEmpty()) {
            return null
        }
        val schema = parts[2].toIntOrNull()?.takeIf { it > 0 } ?: return null
        return Hello(parts[1], schema)
    }

    fun parseWelcome(raw: String): Welcome? {
        val parts = raw.trim().split(' ')
        if (parts.size != 4 || parts[0] != WELCOME || parts[1].isEmpty()) {
            return null
        }
        val schema = parts[2].toIntOrNull()?.takeIf { it > 0 } ?: return null
        val capabilities = parts[3].toIntOrNull()?.takeIf { it >= 0 } ?: return null
        return Welcome(parts[1], schema, capabilities)
    }

    /**
     * Wire form of the only command frame: `#<seq> <command>`. Every command
     * that carries state is acked and deduped by the headset.
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
        // Every verb is a short line; the page still parses and bounds it.
        return normalized.takeIf { it.isNotEmpty() && it.length <= 200 && !it.contains('\n') }
    }

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

    /** `record:outcome:attempt|success:yes|no` — the post-session question. */
    private fun isOutcomeCommand(command: String): Boolean =
        command.startsWith("record:outcome:") &&
            command.removePrefix("record:outcome:") in setOf(
                "attempt:yes", "attempt:no", "success:yes", "success:no"
            )

    /**
     * [sceneIds] is the live catalogue the page announced. The built-in table
     * is only the fallback for a link that has not carried a catalogue yet; it
     * is not the source of truth, and a new scene needs no change here.
     */
    fun isAllowedCommand(
        command: String,
        sceneIds: Set<String> = SCENE_LABELS.keys
    ): Boolean {
        val normalized = normalize(command) ?: return false
        return isOutcomeCommand(normalized) ||
            normalized == "enter" ||
            normalized == "exit" ||
            normalized == "stop" ||
            normalized == "calibrate" ||
            normalized == "adapt:skip" ||
            normalized == "audio:on" ||
            normalized == "audio:off" ||
            normalized == "audio:toggle" ||
            (normalized.startsWith(AUDIO_VOLUME) &&
                normalized.removePrefix(AUDIO_VOLUME).toIntOrNull() in 0..100) ||
            (normalized.startsWith(FLOAT_LEVEL) &&
                normalized.removePrefix(FLOAT_LEVEL).toIntOrNull() in 0..100) ||
            normalized == "float:breath:on" ||
            normalized == "float:breath:off" ||
            (normalized.startsWith(SCENE_PREFIX) &&
                normalized.removePrefix(SCENE_PREFIX) in sceneIds) ||
            (normalized.startsWith(APP_PREFIX) &&
                normalized.removePrefix(APP_PREFIX) in APP_IDS) ||
            (normalized.startsWith(GAZE_DWELL) && normalized in GAZE_DWELL_VALUES) ||
            (normalized.startsWith(ANIM_DURATION) &&
                normalized.removePrefix(ANIM_DURATION).toIntOrNull() in RAMP_MS_MIN..RAMP_MS_MAX) ||
            (normalized.startsWith(POSTURE_MIX) &&
                normalized.removePrefix(POSTURE_MIX).toIntOrNull() in 0..100) ||
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
     * 28-byte QS2 state schema 1, little endian:
     *
     * | byte | field |
     * | --- | --- |
     * | 0 | schema (1) |
     * | 1 | flags: session, calibrating, audio muted, moving; bits 4-7 unused |
     * | 2 | scene index 4b | bits 4-5 reserved | view anim 2b |
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
     * Everything derivable is absent: posture angle and progress are
     * `90° · mix` and `mix`, and the rise is folded into eye height.
     */
    fun encodeState(
        state: ControlState,
        nowMs: Int = 0,
        seq: Int = 0,
        target: ByteArray = ByteArray(stateMaxBytes),
        /** Live catalogue order; the built-in table is only the fallback. */
        sceneIds: List<String> = SCENE_IDS
    ): ByteArray {
        var flags = 0
        if (state.session) flags = flags or 1
        if (state.calibrating) flags = flags or 2
        if (state.audioMuted) flags = flags or 4
        if (state.moving) flags = flags or 8

        val packed = (sceneIndex(state.scene, sceneIds) and 0xF) or
            // Bits 4–5 are retired: the heave is a percentage and it rides the
            // JSON document (`floatAmount`), not a two-bit step in a frame that
            // is already full. Written as 0, read as "not in this frame".
            (0 shl 4) or
            ((state.viewAnim.code and 0x3) shl 6)

        val buffer = ByteBuffer.wrap(target).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(STATE_SCHEMA_VERSION.toByte())
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
     * [perChunk] is what the link can carry per notification *after* the
     * header; the caller derives it from the negotiated MTU. A document that
     * does not fit [maxChunks] is refused rather than truncated, so callers
     * that cannot afford the exception check [fitsJsonChannel] first.
     */
    fun encodeJsonChunks(
        payload: ByteArray,
        perChunk: Int,
        id: Int
    ): List<ByteArray> {
        require(perChunk > 0) { "perChunk must be positive" }
        val size = payload.size.coerceAtLeast(1)
        val total = (size + perChunk - 1) / perChunk
        require(total <= maxChunks) { "document needs $total chunks" }
        val chunks = ArrayList<ByteArray>(total)
        for (index in 0 until total) {
            val from = index * perChunk
            val to = minOf(payload.size, from + perChunk)
            val chunk = ByteArray(chunkHeaderBytes + (to - from))
            chunk[0] = (id and 0xFF).toByte()
            chunk[1] = index.toByte()
            chunk[2] = total.toByte()
            System.arraycopy(payload, from, chunk, chunkHeaderBytes, to - from)
            chunks.add(chunk)
        }
        return chunks
    }

    // ---------------------------------------------------------------------
    // Size contract of the JSON channel
    // ---------------------------------------------------------------------

    /**
     * The default ATT MTU. A link that has not negotiated anything carries
     * this, so every chunk size and document limit starts here.
     */
    const val ATT_MTU_MIN: Int = 23

    /** ATT notification overhead: one opcode byte plus the two-byte handle. */
    const val ATT_NOTIFICATION_OVERHEAD: Int = 3

    /** Close code the control channel uses when a document breaks the limit. */
    const val WS_CLOSE_TOO_BIG: Int = 1009

    /** Document payload that fits one notification of a link with [mtu]. */
    fun jsonChunkPayload(mtu: Int): Int =
        (mtu.coerceAtLeast(ATT_MTU_MIN) - ATT_NOTIFICATION_OVERHEAD - chunkHeaderBytes)
            .coerceAtLeast(1)

    /**
     * Largest document the JSON channel can carry on a link with [mtu]:
     * [maxChunks] notifications of [jsonChunkPayload] bytes each. At the
     * default 23 that is 4335 bytes, and this is the one number every producer
     * must stay inside — a larger document used to escape as an exception from
     * [encodeJsonChunks] and take the whole control link down with it.
     */
    fun jsonDocumentLimitBytes(mtu: Int = ATT_MTU_MIN): Int =
        jsonChunkPayload(mtu) * maxChunks

    /** True when a document of [bytes] fits the JSON channel at [mtu]. */
    fun fitsJsonChannel(bytes: Int, mtu: Int = ATT_MTU_MIN): Boolean =
        bytes <= jsonDocumentLimitBytes(mtu)

    /**
     * Largest frame the page may send on the control channel, in UTF-8 bytes.
     *
     * One number for both directions: the headset refuses to accept a document
     * it could not relay at the default MTU, so "the page sent it" implies "the
     * tablet can receive it".
     */
    fun wsMessageLimitBytes(mtu: Int = ATT_MTU_MIN): Int = jsonDocumentLimitBytes(mtu)

    /**
     * Only QS2 schema 1 exists. A different schema or length is rejected whole.
     *
     * [sceneIds] is the catalogue in the order the page announced it. An index
     * outside it resolves to [fallbackScene], which the tablet sets to the last
     * scene the JSON channel named. The default only covers a fresh link before
     * the catalogue arrives.
     */
    fun decodeState(
        bytes: ByteArray,
        sceneIds: List<String> = SCENE_IDS,
        fallbackScene: String = DEFAULT_SCENE
    ): ControlState? {
        if (bytes.size != stateMaxBytes) return null
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if ((buffer.get().toInt() and 0xFF) != STATE_SCHEMA_VERSION) return null
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
            scene = sceneIds.getOrElse(packed and 0xF) { fallbackScene },

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
     * Fallback scene order before the page announces a catalogue. The live
     * catalogue is authoritative, but this order remains append-only because
     * it is the initial wire index for the frame.
     */
    val SCENE_IDS: List<String> = listOf("washroom", "shore", "ward", "prep")

    /** Default when the operator has not chosen: the neutral preparation room. */
    const val DEFAULT_SCENE: String = "prep"

    const val APP_PREFIX: String = "app:"
    const val DEFAULT_APP: String = "training"
    /** The product faces the shell can switch between. */
    val APP_IDS: Set<String> = setOf(DEFAULT_APP, "questionnaire")

    /**
     * The product face's name, as both screens print it.
     *
     * One table, because the headset shows this name on its home page and the
     * tablet shows it in its top bar: two copies is how the same face ends up
     * with two names in one shift.
     */
    val APP_LABELS: Map<String, String> = mapOf(
        "training" to "场景化排尿引导器",
        "questionnaire" to "场景化问卷作答器"
    )

    fun appLabel(id: String): String = APP_LABELS[id] ?: id

    /**
     * Built-in surfaces that are never offered as a scene choice. The live
     * catalogue carries the same flag; this is the pre-catalogue fallback.
     */
    val SPECIAL_SCENES: Set<String> = setOf(DEFAULT_SCENE)

    /** Operator-facing labels. The tablet renders this list; keep ids in sync. */
    val SCENE_LABELS: Map<String, String> = linkedMapOf(
        "washroom" to "洁净立便间",
        "shore" to "仰望湖面",
        "ward" to "病房",
        "prep" to "准备间"
    )

    /**
     * One operator-facing line per scene: what the room is and how it moves.
     * Kept here, next to the ids, because the choice card on the tablet is the
     * only place an operator sees all four at once — and a blurb that drifts
     * from the art is worse than none.
     */
    // No blurbs here on purpose. The page's registry is the only place a
    // scene's copy exists; a second table in Kotlin is how the washroom once
    // described rails the room does not have. Before the catalogue arrives a
    // card shows its name and nothing else, which is honest about what the
    // tablet actually knows.

    private fun sceneIndex(name: String, sceneIds: List<String>): Int {
        val index = sceneIds.indexOf(name)
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
    /** Scene currently loaded on the page; the tablet shows this as its choice. */
    val scene: String = ControlProtocol.DEFAULT_SCENE,

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
