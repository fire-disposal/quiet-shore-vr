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
    fun `state frame is 15 bytes with signed degree angles`() {
        val state = ControlState(
            scene = "ward",
            session = true,
            audioMuted = false,
            cueEnabled = true,
            eyeHeight = 1.7f,
            posturePitch = -90f,
            postureRoll = -10f,
            postureRise = 1.2f,
            postureProgress = 1f,
            viewPitch = -20f,
            viewYaw = -90f,
            viewAnim = ViewAnim.PLAYING,
            viewPreset = ViewPreset.BREATHE,
            cueIntensity = 0.5f,
            calibrationConfidence = 0.62f
        )
        val bytes = ControlProtocol.encodeState(state)

        assertEquals(15, bytes.size)
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
        assertEquals(1.2f, decoded.postureRise)
        assertEquals("ward", decoded.scene)
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
