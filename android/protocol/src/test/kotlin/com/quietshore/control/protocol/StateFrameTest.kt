package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/**
 * Golden vectors for the wire contract (layout documented on
 * `ControlProtocol.encodeState`; history in `docs/state-v11.md`).
 *
 * v12 is 40 bytes: the v11 layout through byte 27, plus the applied world
 * translation (float32 x/y/z, metres, device frame) the mirror needs to undo
 * the correction about its pivot. Older shapes are rejected outright — both
 * sides ship together.
 */
class StateFrameTest {
    @Test
    fun `v12 frame is 40 bytes with the documented offsets`() {
        val state = ControlState(
            session = true,
            cueEnabled = true,
            hold = true,
            voiceAuto = true,
            eyeHeight = 1.7f,
            floatLevel = 2,
            floatProfile = "c",
            scene = ControlProtocol.SCENE_IDS.getOrElse(1) { ControlProtocol.DEFAULT_SCENE },
            floatMm = 32f,
            swayDeg = 1.5f,
            voiceId = 7,
            posturePitch = -90f,
            postureRoll = -10f,
            postureRise = 1.2f,
            postureProgress = 1f,
            viewPitch = -20f,
            viewYaw = -90f,
            worldYaw = -35f,
            worldPitch = 12f,
            worldRoll = -7f,
            worldXM = 0.125f,
            worldYM = -1.625f,
            worldZM = 0.5f,
            viewAnim = ViewAnim.PLAYING,
            viewPreset = ViewPreset.BREATHE,
            envelope = Envelope.HOLD,
            cueIntensity = 0.5f,
            calibrationConfidence = 92f,
            elapsedSec = 312
        )
        val bytes = ControlProtocol.encodeState(state, nowMs = 0x1234, seq = 0x0042)

        assertEquals(40, bytes.size)
        assertEquals(12, bytes[0].toInt())
        // flags: session | cue | hold | auto
        assertEquals(1 or 8 or 64 or 128, bytes[1].toInt() and 0xFF)
        // level 2 bits, profile 2 bits, scene index 4 bits
        val sceneIndex = ControlProtocol.SCENE_IDS.indexOf(
            expectedScene()
        ).coerceAtLeast(0)
        assertEquals(2 or (2 shl 2) or (sceneIndex shl 4), bytes[2].toInt() and 0xFF)
        assertEquals(170, bytes[3].toInt() and 0xFF)
        assertEquals(32, bytes[4].toInt())
        assertEquals(15, bytes[5].toInt())
        assertEquals(7, bytes[6].toInt() and 0xFF)
        assertEquals(-90, bytes[7].toInt())
        assertEquals(-10, bytes[8].toInt())
        assertEquals(120, bytes[9].toInt() and 0xFF)
        assertEquals(100, bytes[10].toInt() and 0xFF)
        assertEquals(-20, bytes[11].toInt())
        // anim 1 | preset 4 << 2 | envelope HOLD 2 << 5
        assertEquals((1 or (4 shl 2) or (2 shl 5)), bytes[12].toInt() and 0xFF)
        assertEquals(-90, shortAt(bytes, 13))
        assertEquals(-35, shortAt(bytes, 15))
        assertEquals(12, shortAt(bytes, 17))
        assertEquals(-7, bytes[19].toInt())
        assertEquals(0x1234, shortAt(bytes, 20) and 0xFFFF)
        assertEquals(0x0042, shortAt(bytes, 22) and 0xFFFF)
        assertEquals(50, bytes[24].toInt() and 0xFF)
        assertEquals(92, bytes[25].toInt() and 0xFF)
        assertEquals(312, shortAt(bytes, 26) and 0xFFFF)
        assertEquals(0.125f, floatAt(bytes, 28))
        assertEquals(-1.625f, floatAt(bytes, 32))
        assertEquals(0.5f, floatAt(bytes, 36))

        val decoded = requireNotNull(ControlProtocol.decodeState(bytes))
        assertEquals(32f, decoded.floatMm)
        assertEquals(1.5f, decoded.swayDeg)
        assertEquals(7, decoded.voiceId)
        assertEquals(1.2f, decoded.postureRise)
        assertEquals(-90f, decoded.viewYaw)
        assertEquals(12f, decoded.worldPitch)
        assertEquals(0.125f, decoded.worldXM)
        assertEquals(-1.625f, decoded.worldYM)
        assertEquals(0.5f, decoded.worldZM)
        assertEquals(expectedScene(), decoded.scene)
        assertEquals(Envelope.HOLD, decoded.envelope)
        assertEquals(ViewAnim.PLAYING, decoded.viewAnim)
        assertEquals(ViewPreset.BREATHE, decoded.viewPreset)
        assertEquals(312, decoded.elapsedSec)
        assertTrue(decoded.hold)
        assertTrue(decoded.voiceAuto)
    }

    @Test
    fun `voice id none round-trips as -1`() {
        val idle = requireNotNull(ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState())))
        assertEquals(-1, idle.voiceId)
        val speaking = requireNotNull(
            ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState(voiceId = 31)))
        )
        assertEquals(31, speaking.voiceId)
    }

    @Test
    fun `signed buoyancy and sway survive both directions`() {
        for (mm in listOf(-127f, -32f, 0f, 32f, 127f)) {
            val decoded = requireNotNull(ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState(floatMm = mm))))
            assertEquals(mm, decoded.floatMm)
        }
        for (deg in listOf(-12f, -1.5f, 0f, 1.5f, 12f)) {
            val decoded = requireNotNull(ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState(swayDeg = deg))))
            assertTrue(abs(decoded.swayDeg - deg) < 0.11f)
        }
    }

    @Test
    fun `an unknown version or shape is rejected`() {
        val bytes = ControlProtocol.encodeState(ControlState())
        bytes[0] = 13
        assertNull(ControlProtocol.decodeState(bytes))
        assertNull(ControlProtocol.decodeState(ByteArray(19)))
        assertNull(ControlProtocol.decodeState(ByteArray(28)))
    }

    @Test
    fun `buoyancy level and profile round-trip`() {
        for (profile in listOf("a", "b", "c")) {
            for (level in 0..3) {
                val bytes = ControlProtocol.encodeState(ControlState(floatLevel = level, floatProfile = profile))
                val decoded = requireNotNull(ControlProtocol.decodeState(bytes))
                assertEquals(level, decoded.floatLevel)
                assertEquals(profile, decoded.floatProfile)
            }
        }
    }

    @Test
    fun `an unknown profile decodes as the default instead of failing`() {
        val decoded = requireNotNull(
            ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState(floatProfile = "zzz")))
        )
        assertEquals("b", decoded.floatProfile)
    }

    @Test
    fun `view orient parses exactly one grammar`() {
        val move = ControlProtocol.parseViewOrient("view:orient:-90,45")
        requireNotNull(move)
        assertEquals(-90f, move.lookYawDeg)
        assertEquals(45f, move.upGazeDeg)

        val full = ControlProtocol.parseViewOrient("view:orient:180,-90")
        requireNotNull(full)
        assertTrue(abs(full.lookYawDeg - 180f) < 1e-3f)
        assertTrue(abs(full.upGazeDeg + 90f) < 1e-3f)

        for (raw in listOf(
            "view:orient:0,.5",
            "view:orient:0,5.",
            "view:orient:+0.5,0",
            "view:orient:181,0",
            "view:orient:0,91",
            "view:orient:0,0.5,0",
            "view:orient:-90",
            "view:move:0,0.6"
        )) {
            assertNull(ControlProtocol.parseViewOrient(raw), raw)
        }
    }

    /** A non-default scene that the shipped registry actually knows about. */
    private fun expectedScene(): String =
        ControlProtocol.SCENE_IDS.getOrElse(1) { ControlProtocol.DEFAULT_SCENE }

    private fun shortAt(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)).toShort().toInt()

    private fun floatAt(bytes: ByteArray, offset: Int): Float =
        ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.LITTLE_ENDIAN).float
}
