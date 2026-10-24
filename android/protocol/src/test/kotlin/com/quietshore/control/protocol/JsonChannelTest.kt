package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The JSON channel's framing: any document fits any MTU as long as both sides
 * agree on the chunk size, and a damaged document is dropped, never spliced.
 */
class JsonChannelTest {
    private fun document(size: Int): ByteArray =
        ByteArray(size) { (it % 97 + 32).toByte() }

    @Test
    fun `a document split at 20 bytes per chunk reassembles exactly`() {
        val payload = document(700)
        val chunks = ControlProtocol.encodeJsonChunks(payload, 20, id = 7)
        assertEquals(35, chunks.size)
        assertTrue(chunks.all { it.size <= 20 + ControlProtocol.chunkHeaderBytes })

        val assembler = JsonAssembler()
        var assembled: ByteArray? = null
        for (chunk in chunks) {
            assembled = assembler.add(chunk) ?: assembled
        }
        assertNotNull(assembled)
        assertEquals(payload.toList(), assembled!!.toList())
    }

    @Test
    fun `documents interleave by chunk id`() {
        val first = "{\"t\":\"flags\",\"session\":true}".toByteArray()
        val second = "{\"t\":\"sus\",\"filled\":10}".toByteArray()
        val a = ControlProtocol.encodeJsonChunks(first, 8, id = 1)
        val b = ControlProtocol.encodeJsonChunks(second, 8, id = 2)
        val assembler = JsonAssembler()
        val done = ArrayList<String>()
        for (i in 0 until maxOf(a.size, b.size)) {
            a.getOrNull(i)?.let { assembler.add(it)?.let { bytes -> done.add(String(bytes)) } }
            b.getOrNull(i)?.let { assembler.add(it)?.let { bytes -> done.add(String(bytes)) } }
        }
        assertEquals(listOf(String(first), String(second)).sorted(), done.sorted())
    }

    @Test
    fun `a gap drops the document instead of splicing it`() {
        val payload = document(64)
        val chunks = ControlProtocol.encodeJsonChunks(payload, 16, id = 3)
        val assembler = JsonAssembler()
        assertNull(assembler.add(chunks[0]))
        // chunks[1] is lost on the air.
        assertNull(assembler.add(chunks[2]))
        // The rest of that document can never complete.
        assertNull(assembler.add(chunks[3]))
        assertNull(assembler.add(chunks[1]))
    }

    @Test
    fun `a stale partial is forgotten after the timeout`() {
        var now = 1_000L
        val assembler = JsonAssembler(timeoutMs = 500L, clock = { now })
        val chunks = ControlProtocol.encodeJsonChunks("hello world".toByteArray(), 8, id = 4)
        assertNull(assembler.add(chunks[0]))
        now += 900
        // The late second chunk starts a fresh document that will never finish.
        assertNull(assembler.add(chunks[1]))
        assertNull(assembler.add(chunks[0]))
    }

    @Test
    fun `an oversized document is refused, not truncated`() {
        val huge = ByteArray(ControlProtocol.maxChunks * 8 + 1)
        assertThrows<IllegalArgumentException> {
            ControlProtocol.encodeJsonChunks(huge, 8, id = 5)
        }
    }

    @Test
    fun `malformed chunks are ignored`() {
        val assembler = JsonAssembler()
        assertNull(assembler.add(ByteArray(0)))
        assertNull(assembler.add(byteArrayOf(1, 0, 0)))
        // index outside the declared total
        assertNull(assembler.add(byteArrayOf(9, 5, 3, 65)))
    }
}
