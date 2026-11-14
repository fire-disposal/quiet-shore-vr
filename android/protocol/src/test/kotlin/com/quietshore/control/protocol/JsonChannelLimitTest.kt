package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The size contract of the JSON channel.
 *
 * A document larger than the channel can carry used to surface only as an
 * `IllegalArgumentException` from `encodeJsonChunks`, thrown *after* the
 * producer had already written local state (the scene catalogue was saved to
 * prefs first). The boundary has to be callable before any side effect, and it
 * has to agree with what the encoder will actually do.
 */
class JsonChannelLimitTest {

    @Test
    fun `the default mtu limit is the 4335 bytes the encoder can frame`() {
        val perChunk = ControlProtocol.jsonChunkPayload(ControlProtocol.ATT_MTU_MIN)
        assertEquals(17, perChunk)
        val limit = ControlProtocol.jsonDocumentLimitBytes()
        assertEquals(17 * ControlProtocol.maxChunks, limit)
        assertEquals(4335, limit)

        // Exactly at the limit: every notification fits the ATT payload.
        val full = ControlProtocol.encodeJsonChunks(ByteArray(limit), perChunk, id = 1)
        assertEquals(ControlProtocol.maxChunks, full.size)
        assertTrue(full.all {
            it.size <= ControlProtocol.ATT_MTU_MIN - ControlProtocol.ATT_NOTIFICATION_OVERHEAD
        })

        // One byte over: the encoder still refuses, which is why callers check.
        assertThrows<IllegalArgumentException> {
            ControlProtocol.encodeJsonChunks(ByteArray(limit + 1), perChunk, id = 2)
        }
    }

    @Test
    fun `fitsJsonChannel agrees with the encoder at the boundary`() {
        val limit = ControlProtocol.jsonDocumentLimitBytes()
        assertTrue(ControlProtocol.fitsJsonChannel(limit))
        assertFalse(ControlProtocol.fitsJsonChannel(limit + 1))
        assertTrue(ControlProtocol.fitsJsonChannel(0))
    }

    @Test
    fun `a widened mtu raises the limit and a degraded one lowers it`() {
        val narrow = ControlProtocol.jsonDocumentLimitBytes(ControlProtocol.ATT_MTU_MIN)
        val wide = ControlProtocol.jsonDocumentLimitBytes(128)
        assertTrue(wide > narrow)
        assertEquals(ControlProtocol.jsonChunkPayload(128) * ControlProtocol.maxChunks, wide)
        // An MTU below the ATT minimum is clamped: no chunk ever loses its header.
        assertEquals(narrow, ControlProtocol.jsonDocumentLimitBytes(5))
        assertTrue(ControlProtocol.jsonChunkPayload(5) > 0)
    }

    @Test
    fun `the json channel limit is the one number both directions use`() {
        // The headset refuses to accept a document it could not relay at the
        // default MTU, so "the page sent it" implies "the tablet can receive
        // it": the accept check and the limits agree at the boundary.
        assertTrue(ControlProtocol.fitsJsonChannel(ControlProtocol.jsonDocumentLimitBytes()))
        assertFalse(ControlProtocol.fitsJsonChannel(ControlProtocol.jsonDocumentLimitBytes() + 1))
        assertEquals(
            ControlProtocol.jsonDocumentLimitBytes(96),
            ControlProtocol.jsonChunkPayload(96) * ControlProtocol.maxChunks
        )
    }
}
