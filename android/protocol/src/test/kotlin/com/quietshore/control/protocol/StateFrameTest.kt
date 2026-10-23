package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs

/**
 * Golden vectors for the wire contract (docs/rotation-contract.md §9).
 *
 * These are the values the page and the tablet must agree on byte for byte.
 * Degree fields are signed integers: no offset, no semantic clamp.
 */
class StateFrameTest {
    @Test
    fun `state frame is 20 bytes with signed degree angles`() {
        val state = ControlState(
            session = true,
            audioMuted = false,
            cueEnabled = true,
            eyeHeight = 1.7f,
            posturePitch = -90f,
            postureRoll = -10f,
            postureRise = 1.2f,
            postureProgress = 1f,
            viewPitch = -20f,
            worldYaw = -35f,
            worldPitch = 12f,
            worldRoll = -7f,
            viewYaw = -90f,
            viewAnim = ViewAnim.PLAYING,
            viewPreset = ViewPreset.BREATHE,
            cueIntensity = 0.5f,
            scene = "ward"
        )
        val bytes = ControlProtocol.encodeState(state)

        assertEquals(20, bytes.size)
        assertEquals(ControlProtocol.stateVersion, bytes[0].toInt())
        assertEquals(-90, bytes[4].toInt())
        assertEquals(-10, bytes[5].toInt())
        assertEquals(-20, bytes[8].toInt())
        // viewYaw is a signed int16 at bytes 13..14, little endian.
        assertEquals(-90, ((bytes[14].toInt() shl 8) or (bytes[13].toInt() and 0xFF)).toShort().toInt())

        val decoded = ControlProtocol.decodeState(bytes)
        requireNotNull(decoded)
        assertEquals(-90f, decoded.posturePitch)
        assertEquals(-10f, decoded.postureRoll)
        assertEquals(-20f, decoded.viewPitch)
        assertEquals(-90f, decoded.viewYaw)
        assertEquals(-35f, decoded.worldYaw)
        assertEquals(12f, decoded.worldPitch)
        assertEquals(-7f, decoded.worldRoll)
        assertEquals(1.2f, decoded.postureRise)
        // Byte 1 is the buoyancy level; the fixture leaves it at the default.
        assertEquals(1, bytes[1].toInt())
        // Byte 11 is the scene index into ControlProtocol.SCENE_IDS.
        assertEquals("ward", decoded.scene)
        assertEquals(ControlProtocol.SCENE_IDS.indexOf("ward"), bytes[11].toInt())
        assertEquals(ViewPreset.BREATHE, decoded.viewPreset)
        assertEquals(ViewAnim.PLAYING, decoded.viewAnim)
    }

    @Test
    fun `positive angles are plain signed values`() {
        val bytes = ControlProtocol.encodeState(ControlState(viewPitch = 20f, viewYaw = 180f))
        assertEquals(0x14, bytes[8].toInt() and 0xFF)
        val yaw = ((bytes[14].toInt() shl 8) or (bytes[13].toInt() and 0xFF)).toShort().toInt()
        assertEquals(180, yaw)
    }

    @Test
    fun `an older frame version is rejected`() {
        val bytes = ControlProtocol.encodeState(ControlState())
        bytes[0] = (ControlProtocol.stateVersion - 1).toByte()
        assertNull(ControlProtocol.decodeState(bytes))
    }

    @Test
    fun `posture mode travels in flags bit 5`() {
        val posture = ControlProtocol.encodeState(ControlState(postureMode = true))
        assertEquals(32, posture[2].toInt() and 32)
        val decoded = ControlProtocol.decodeState(posture)
        requireNotNull(decoded)
        assertEquals(true, decoded.postureMode)
        val floating = requireNotNull(ControlProtocol.decodeState(ControlProtocol.encodeState(ControlState())))
        assertEquals(false, floating.postureMode)
    }

    @Test
    fun `buoyancy level and profile round-trip`() {
        for (profile in listOf("a", "b", "c")) {
            for (level in 0..3) {
                val bytes = ControlProtocol.encodeState(
                    ControlState(floatLevel = level, floatProfile = profile)
                )
                assertEquals(level, bytes[1].toInt())
                val decoded = requireNotNull(ControlProtocol.decodeState(bytes))
                assertEquals(level, decoded.floatLevel)
                assertEquals(profile, decoded.floatProfile)
            }
        }
    }

    @Test
    fun `an unknown profile decodes as the default instead of failing`() {
        val bytes = ControlProtocol.encodeState(ControlState(floatProfile = "zzz"))
        assertEquals("b", requireNotNull(ControlProtocol.decodeState(bytes)).floatProfile)
        // Bits 6-7 are the profile; posture mode in bit 5 must stay independent.
        val posture = ControlProtocol.encodeState(
            ControlState(postureMode = true, floatProfile = "c")
        )
        val decoded = requireNotNull(ControlProtocol.decodeState(posture))
        assertTrue(decoded.postureMode)
        assertEquals("c", decoded.floatProfile)
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
}
