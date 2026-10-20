package com.quietshore.control.protocol

import java.nio.ByteBuffer
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

    /** First-claim control. The VR grants control to exactly one connected pad. */
    const val CLAIM: String = "CLAIM"
    const val RELEASE: String = "RELEASE"

    /** Host-level commands are executed by the headset service, not the page. */
    const val ENTER: String = "enter"
    const val HOME: String = "home"
    const val ALL_APPS: String = "allapps"
    const val SETTINGS_SKIP_CALIBRATION: String = "settings:skipcalibration:"
    const val SETTINGS_HUD: String = "settings:hud:"

    val CAPABILITIES: List<String> = listOf(
        "start", "enter", "preview", "exit", "stop", "pause", "resume",
        "calibrate", "recalibrate", "status", "menu",
        "audio:on", "audio:off", "audio:toggle",
        "scene:<id>", "posture:rise", "posture:lower", "posture:stop",
        "home", "allapps",
        "settings:skipcalibration:on|off", "settings:hud:on|off"
    )

    const val STATUS_CONNECTED: String = "CONNECTED"
    const val STATUS_CONTROL_OK: String = "CONTROL_OK"
    const val STATUS_CONTROL_BUSY: String = "CONTROL_BUSY"
    const val STATUS_CONTROL_RELEASED: String = "CONTROL_RELEASED"
    const val STATUS_CONTROL_REQUIRED: String = "CONTROL_REQUIRED"

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

    fun isAllowedCommand(command: String): Boolean {
        val normalized = normalize(command) ?: return false
        return normalized == "start" ||
            normalized == "enter" ||
            normalized == "launch" ||
            normalized == "preview" ||
            normalized == "exit" ||
            normalized == "stop" ||
            normalized == "pause" ||
            normalized == "resume" ||
            normalized == "calibrate" ||
            normalized == "recalibrate" ||
            normalized == "status" ||
            normalized == "menu" ||
            normalized == "audio:on" ||
            normalized == "audio:off" ||
            normalized == "audio:toggle" ||
            (normalized.startsWith("scene:") && normalized.length > "scene:".length) ||
            normalized == "posture:rise" ||
            normalized == "posture:lower" ||
            normalized == "posture:stop" ||
            normalized == "home" ||
            normalized == "allapps" ||
            normalized == "settings:skipcalibration:on" ||
            normalized == "settings:skipcalibration:off" ||
            normalized == "settings:hud:on" ||
            normalized == "settings:hud:off"
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

    fun encodeState(state: ControlState): ByteArray {
        val scene = state.scene.replace('|', '_').take(16)
        val raw = buildString {
            append(scene)
            append('|')
            append(if (state.session) '1' else '0')
            append('|')
            append(if (state.calibrating) '1' else '0')
            append('|')
            append(if (state.audioMuted) '1' else '0')
        }
        return raw.toByteArray(StandardCharsets.UTF_8)
    }

    fun decodeState(raw: String): ControlState? {
        val parts = raw.trim().split('|')
        if (parts.size != 4 || parts[0].isEmpty()) return null
        return ControlState(
            scene = parts[0],
            session = parts[1] == "1",
            calibrating = parts[2] == "1",
            audioMuted = parts[3] == "1"
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

data class ControlState(
    val scene: String = "landscape",
    val session: Boolean = false,
    val calibrating: Boolean = false,
    val audioMuted: Boolean = false
)
