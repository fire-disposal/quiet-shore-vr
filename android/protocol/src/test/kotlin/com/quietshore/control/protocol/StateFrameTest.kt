package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * v13 state frame: 28 bytes, one posture scalar, no derivable duplicates.
 *
 * Every offset is pinned here because this array is the only thing the two
 * ends share; a test that merely round-trips would pass with the fields in any
 * order.
 */
class StateFrameTest {

    private fun shortAt(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)).toShort().toInt()

    @Test
    fun `v13 frame is 28 bytes with the documented offsets`() {
        val state = ControlState(
            session = true,
            calibrating = true,
            audioMuted = true,
            moving = true,
            hold = true,
            voiceAuto = true,
            scene = ControlProtocol.SCENE_IDS[3],
            floatLevel = 2,
            viewAnim = ViewAnim.PLAYING,
            eyeHeight = 0.71f,
            mix = 0.5f,
            floatMm = -32f,
            viewPitch = -12f,
            viewYaw = 90f,
            voiceId = 7,
            calibrationConfidence = 92f,
            elapsedSec = 312,
            worldQX = 0.5f,
            worldQY = 0f,
            worldQZ = 0f,
            worldX = 0.12f,
            worldY = -1.25f,
            worldZ = 0.5f
        )
        val bytes = ControlProtocol.encodeState(state, nowMs = 0x1234, seq = 0x0042)

        assertEquals(28, bytes.size)
        assertEquals(13, bytes[0].toInt())
        // session | calibrating | audio | moving | hold | voiceAuto
        assertEquals(1 or 2 or 4 or 8 or 16 or 32, bytes[1].toInt() and 0xFF)
        // scene index 3 | level 2 << 4 | anim playing 1 << 6
        assertEquals(3 or (2 shl 4) or (1 shl 6), bytes[2].toInt() and 0xFF)
        assertEquals(71, bytes[3].toInt() and 0xFF)
        assertEquals(125, bytes[4].toInt() and 0xFF)
        assertEquals(-32, bytes[5].toInt())
        assertEquals(-12, bytes[6].toInt())
        assertEquals(45, bytes[7].toInt())
        assertEquals(7, bytes[8].toInt() and 0xFF)
        assertEquals(92, bytes[9].toInt() and 0xFF)
        assertEquals(312, shortAt(bytes, 10))
        assertEquals(0x1234, shortAt(bytes, 12))
        assertEquals(0x0042, shortAt(bytes, 14))
        assertEquals((0.5f * ControlProtocol.QUAT_SCALE).roundToInt(), shortAt(bytes, 16))
        assertEquals(0, shortAt(bytes, 18))
        assertEquals(0, shortAt(bytes, 20))
        assertEquals(12, shortAt(bytes, 22))
        assertEquals(-125, shortAt(bytes, 24))
        assertEquals(50, shortAt(bytes, 26))
    }

    @Test
    fun `decoding restores every field inside its quantum`() {
        val state = ControlState(
            session = true,
            calibrating = false,
            audioMuted = false,
            moving = true,
            hold = false,
            voiceAuto = true,
            scene = "shore",
            floatLevel = 3,
            viewAnim = ViewAnim.HELD,
            eyeHeight = 1.13f,
            mix = 0.532f,
            floatMm = 41f,
            viewPitch = 7f,
            viewYaw = -96f,
            voiceId = 12,
            calibrationConfidence = 100f,
            elapsedSec = 7,
            worldQX = -0.2079f,
            worldQY = 0.0f,
            worldQZ = 0.0f,
            worldX = -0.01f,
            worldY = -1.13f,
            worldZ = 0.02f
        )
        val decoded = requireNotNull(
            ControlProtocol.decodeState(ControlProtocol.encodeState(state, nowMs = 5, seq = 9))
        )

        assertEquals(state.session, decoded.session)
        assertEquals(state.moving, decoded.moving)
        assertEquals(state.voiceAuto, decoded.voiceAuto)
        assertEquals(state.scene, decoded.scene)
        assertEquals(state.floatLevel, decoded.floatLevel)
        assertEquals(state.viewAnim, decoded.viewAnim)
        assertEquals(state.eyeHeight, decoded.eyeHeight, 0.005f)
        assertEquals(state.mix, decoded.mix, 1f / 250f)
        assertEquals(state.floatMm, decoded.floatMm, 0.5f)
        assertEquals(state.viewPitch, decoded.viewPitch, 0.5f)
        assertEquals(state.viewYaw, decoded.viewYaw, 1f)
        assertEquals(state.voiceId, decoded.voiceId)
        assertEquals(state.calibrationConfidence, decoded.calibrationConfidence, 0.5f)
        assertEquals(state.elapsedSec, decoded.elapsedSec)
        assertEquals(state.worldQX, decoded.worldQX, 1f / ControlProtocol.QUAT_SCALE)
        assertEquals(state.worldQY, decoded.worldQY, 1f / ControlProtocol.QUAT_SCALE)
        assertEquals(state.worldQZ, decoded.worldQZ, 1f / ControlProtocol.QUAT_SCALE)
        assertEquals(state.worldX, decoded.worldX, 0.005f)
        assertEquals(state.worldY, decoded.worldY, 0.005f)
        assertEquals(state.worldZ, decoded.worldZ, 0.005f)
        assertEquals(0x0005, decoded.tMs)
        assertEquals(9, decoded.seq)
    }

    @Test
    fun `clamps what the byte cannot carry`() {
        val state = ControlState(
            eyeHeight = 3f,
            mix = 4f,
            floatMm = 900f,
            viewPitch = -900f,
            viewYaw = 900f,
            calibrationConfidence = 250f
        )
        val decoded = requireNotNull(ControlProtocol.decodeState(ControlProtocol.encodeState(state)))
        assertEquals(2.5f, decoded.eyeHeight, 0.005f)
        assertEquals(1f, decoded.mix, 1f / 250f)
        assertEquals(127f, decoded.floatMm, 0.5f)
        assertEquals(-127f, decoded.viewPitch, 0.5f)
        assertEquals(254f, decoded.viewYaw, 1f)
        assertEquals(100f, decoded.calibrationConfidence, 0.5f)
    }

    @Test
    fun `rejects any other shape`() {
        val frame = ControlProtocol.encodeState(ControlState())
        assertNull(ControlProtocol.decodeState(ByteArray(40)))
        assertNull(ControlProtocol.decodeState(frame.copyOf(27)))
        // A v12 frame is not upgraded: both ends ship together.
        val wrongVersion = frame.copyOf()
        wrongVersion[0] = 12
        assertNull(ControlProtocol.decodeState(wrongVersion))
    }

    @Test
    fun `a lying eye survives the wire`() {
        // 0.08 m on water is the lowest eye the model produces; the byte range
        // must not clip it the way v12's 120..190 cm clamp did.
        for (height in listOf(0.08f, 0.66f, 0.71f, 1.13f, 2.4f)) {
            val decoded = requireNotNull(
                ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState(eyeHeight = height)))
            )
            assertTrue(abs(decoded.eyeHeight - height) < 0.006f, "$height -> ${decoded.eyeHeight}")
        }
    }
}
