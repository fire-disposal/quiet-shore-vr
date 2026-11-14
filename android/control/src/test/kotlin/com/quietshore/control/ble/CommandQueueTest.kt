package com.quietshore.control.ble

import com.quietshore.control.protocol.ControlProtocol
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * H2: a stop freezes the patient for good.
 *
 * The headset executes whatever reaches it in order, so a `posture:rise` that
 * was queued before the stop and written after it starts the bed moving again —
 * the operator's last action was a stop and that is what the patient must get.
 */
class CommandQueueTest {

    /** Drains the queue in wire order; a null means the queue went empty. */
    private fun drain(queue: CommandQueue): List<String> =
        generateSequence { queue.poll() }.toList()

    @Test
    fun `a stop drops motion queued before it and keeps the stop`() {
        val queue = CommandQueue()
        queue.enqueue("audio:on")
        queue.enqueue(ControlProtocol.POSTURE_RISE)
        queue.enqueue(ControlProtocol.VIEW_ANIM + "up")
        queue.enqueue("stop")

        assertEquals(listOf("stop", "audio:on"), drain(queue))
    }

    @Test
    fun `motion queued after the stop is still delivered`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.POSTURE_RISE)
        queue.enqueue("stop")
        queue.enqueue(ControlProtocol.POSTURE_LOWER)

        // The stop goes first — it owns the wire — but the operator's next
        // instruction is not swallowed by it.
        assertEquals(listOf("stop", ControlProtocol.POSTURE_LOWER), drain(queue))
    }

    @Test
    fun `a stop never drops unmoving commands from the discrete lane`() {
        val queue = CommandQueue()
        queue.enqueue("audio:on")
        queue.enqueue(ControlProtocol.SCENE_PREFIX + "ward")
        queue.enqueue(ControlProtocol.POSTURE_RISE)
        queue.enqueue("view:stop")

        // Audio and scene are not motion: they were asked for on purpose and
        // the freeze says nothing about them.
        assertEquals(
            listOf("view:stop", "audio:on", "scene:ward"),
            drain(queue)
        )
    }

    @Test
    fun `every stop spelling supersedes earlier motion`() {
        for (stop in CommandQueue.STOP_COMMANDS) {
            val queue = CommandQueue()
            queue.enqueue(ControlProtocol.POSTURE_LOWER)
            queue.enqueue(stop)
            assertEquals(listOf(stop), drain(queue), "stop spelling $stop")
        }
    }

    @Test
    fun `the queued movement sample dies with the stop`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.POSTURE_MIX + "80")
        queue.enqueue("stop")

        assertEquals(0, queue.pendingMoves)
        assertEquals(listOf("stop"), drain(queue))
    }

    @Test
    fun `a stop leaves no stale motion for the next poll`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.POSTURE_RISE)
        queue.enqueue("stop")
        assertEquals("stop", queue.poll())
        // This is the exact audit symptom: the poll right after the stop used
        // to hand out the pre-stop posture command.
        assertNull(queue.poll())
        assertTrue(queue.isEmpty)
    }

    @Test
    fun `a full discrete lane still refuses rather than silently dropping`() {
        val queue = CommandQueue(discreteCapacity = 2)
        queue.enqueue("audio:on")
        queue.enqueue("audio:off")
        assertFalse(queue.enqueue("voice:stop"))
        // The refusal must not have disturbed what was already accepted.
        assertEquals(listOf("audio:on", "audio:off"), drain(queue))
    }
}
