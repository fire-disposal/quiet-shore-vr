package com.quietshore.control.ble

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * H10: a write completion belongs to the link that started it.
 *
 * A dropped link resets `writing` and `nextSeq`, so the *same* seq number can
 * be live again on the next connection. The stale completion of the old write
 * used to clear `writing` unconditionally and delete `inFlight[seq]` by number,
 * which on the new link means a concurrent GATT write and an ACK that is then
 * reported as unknown. [WriteTokens] is the guard that decision is made on.
 */
class WriteTokensTest {

    @Test
    fun `a completion from a retired connection changes nothing`() {
        val tokens = WriteTokens()
        val oldLink = tokens.connection
        tokens.beginWrite()
        val oldWrite = tokens.write

        // Disconnect, then a new link writes its own command.
        tokens.retireLink()
        tokens.beginWrite()
        val newWrite = tokens.write

        assertFalse(tokens.owns(oldLink, oldWrite), "old link must not own the new writer")
        assertTrue(tokens.owns(tokens.connection, newWrite))
        assertEquals(newWrite, tokens.write)
    }

    @Test
    fun `retiring a link bumps both generations`() {
        val tokens = WriteTokens()
        val connection = tokens.connection
        tokens.beginWrite()
        val write = tokens.write

        tokens.retireLink()

        assertEquals(connection + 1, tokens.connection)
        assertTrue(tokens.write > write)
    }

    @Test
    fun `a stale completion does not release a newer write on the same link`() {
        val tokens = WriteTokens()
        tokens.beginWrite()
        val timedOut = tokens.write

        // The ACK timeout gave the slot back and the pump started the next one.
        tokens.abandonWrite()
        tokens.beginWrite()
        val current = tokens.write

        assertFalse(tokens.owns(tokens.connection, timedOut))
        assertTrue(tokens.owns(tokens.connection, current))
    }

    @Test
    fun `a completion arriving after its write was abandoned is stale`() {
        val tokens = WriteTokens()
        tokens.beginWrite()
        val abandoned = tokens.write
        tokens.abandonWrite()

        assertFalse(tokens.owns(tokens.connection, abandoned))
        // Nothing is writing: a late completion must not start a second pump
        // either, because the timeout already scheduled one.
        assertFalse(tokens.writing)
    }

    @Test
    fun `seq numbers restart per link so the token is the only identity`() {
        val tokens = WriteTokens()
        val firstLink = tokens.connection
        val firstSeq = tokens.nextSeq()
        tokens.beginWrite()
        val firstWrite = tokens.write

        tokens.retireLink()
        val secondSeq = tokens.nextSeq()
        tokens.beginWrite()
        val secondWrite = tokens.write

        // Same command, same seq, different link: only the token separates them.
        assertEquals(firstSeq, secondSeq)
        assertFalse(tokens.owns(firstLink, firstWrite))
        assertTrue(tokens.owns(tokens.connection, secondWrite))
    }

    @Test
    fun `a stale completion never asks for a seq to be dropped`() {
        val tokens = WriteTokens()
        val oldLink = tokens.connection
        val oldSeq = tokens.nextSeq()
        tokens.beginWrite()
        val oldWrite = tokens.write

        tokens.retireLink()
        // The new link's command reuses seq 1; its entry must survive.
        val newSeq = tokens.nextSeq()
        tokens.beginWrite()
        val newWrite = tokens.write
        val dropped = ArrayList<Int>()

        val accepted = tokens.settle(oldLink, oldWrite, oldSeq) { dropped.add(it) }

        assertFalse(accepted)
        assertTrue(dropped.isEmpty(), "stale completion must not release any seq")
        assertTrue(tokens.writing, "new link must still own the writer")
        assertTrue(tokens.settle(tokens.connection, newWrite, newSeq) { dropped.add(it) })
        assertEquals(listOf(newSeq), dropped)
        assertFalse(tokens.writing)
    }
}
