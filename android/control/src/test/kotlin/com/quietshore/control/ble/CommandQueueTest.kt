package com.quietshore.control.ble

import com.quietshore.control.protocol.ControlProtocol
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Outbound ordering, in one place.
 *
 * H2: a stop freezes the patient for good. The headset executes whatever
 * reaches it in order, so a `posture:rise` queued before the stop and written
 * after it starts the bed moving again — the operator's last action was a stop
 * and that is what the patient must get.
 *
 * H3: sliders are streams, not lists. Each absolute channel keeps only its
 * newest sample, and dragging one channel must not lose another's.
 */
class CommandQueueTest {

    /** Drains the queue in wire order; a null means the queue went empty. */
    private fun drain(queue: CommandQueue): List<String> =
        generateSequence { queue.poll() }.toList()

    // ---- stop semantics -------------------------------------------------

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
        assertFalse(queue.enqueue("voice:play:v-start"))
        // The refusal must not have disturbed what was already accepted.
        assertEquals(listOf("audio:on", "audio:off"), drain(queue))
    }

    // ---- per-channel coalescing ----------------------------------------

    @Test
    fun `every slider channel keeps exactly one sample`() {
        for (channel in CommandQueue.CHANNELS) {
            val queue = CommandQueue()
            for (value in 0..100 step 5) {
                assertTrue(queue.enqueue(channel + value), "enqueue $channel$value")
            }
            // One write for the whole drag, carrying the value the hand ended on.
            assertEquals(listOf(channel + "100"), drain(queue), "channel $channel")
        }
    }

    @Test
    fun `an older sample cannot replace a newer one`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "30")
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "70")
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "55")

        assertEquals(listOf(ControlProtocol.AUDIO_VOLUME + "55"), drain(queue))
    }

    @Test
    fun `dragging one channel keeps the other channels`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.FLOAT_LEVEL + "40")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:60")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:9")
        // The operator's whole posture drag arrives after the others started.
        for (value in 10..90 step 10) {
            queue.enqueue(ControlProtocol.POSTURE_MIX + value)
        }

        assertEquals(
            listOf(
                ControlProtocol.POSTURE_MIX + "90",
                ControlProtocol.FLOAT_LEVEL + "40",
                ControlProtocol.VOICE_PREFIX + "volume:60",
                ControlProtocol.VOICE_PREFIX + "mix:duck:9"
            ),
            drain(queue)
        )
    }

    @Test
    fun `each channel keeps its own arrival slot and the newest value`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:4")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:11")
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "22")
        queue.enqueue(ControlProtocol.FLOAT_LEVEL + "33")
        queue.enqueue(ControlProtocol.POSTURE_MIX + "44")
        // A second drag on the first channel does not move it behind the rest.
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:7")

        // Posture is the movement lane and comes first; the channel lane then
        // follows the operator's own order of touch, each with its newest value.
        assertEquals(
            listOf(
                ControlProtocol.POSTURE_MIX + "44",
                ControlProtocol.VOICE_PREFIX + "mix:duck:7",
                ControlProtocol.VOICE_PREFIX + "volume:11",
                ControlProtocol.AUDIO_VOLUME + "22",
                ControlProtocol.FLOAT_LEVEL + "33"
            ),
            drain(queue)
        )
    }

    @Test
    fun `slider order against discrete and stops is deterministic`() {
        val queue = CommandQueue()
        queue.enqueue("audio:on")
        queue.enqueue(ControlProtocol.FLOAT_LEVEL + "33")
        queue.enqueue("stop")
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "22")

        // Stop, then the discrete FIFO, then the slider channels.
        assertEquals(
            listOf("stop", "audio:on", ControlProtocol.FLOAT_LEVEL + "33", ControlProtocol.AUDIO_VOLUME + "22"),
            drain(queue)
        )
    }

    @Test
    fun `slider samples are not bounded by the discrete capacity`() {
        val queue = CommandQueue(discreteCapacity = 1)
        queue.enqueue("audio:on")
        // Capacity 1 is already reached by the discrete lane; a slider is a
        // channel value, not a list entry, and must still be accepted.
        assertTrue(queue.enqueue(ControlProtocol.POSTURE_MIX + "50"))
        assertTrue(queue.enqueue(ControlProtocol.AUDIO_VOLUME + "50"))
        assertEquals(
            listOf("audio:on", ControlProtocol.POSTURE_MIX + "50", ControlProtocol.AUDIO_VOLUME + "50"),
            drain(queue)
        )
    }

    // ---- voice stop cleanup --------------------------------------------

    @Test
    fun `voice stop drops the queued voice volume and duck samples`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:80")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:15")
        queue.enqueue(CommandQueue.VOICE_STOP)

        // A level picked before the silence must not restart the cue after it.
        assertEquals(listOf(CommandQueue.VOICE_STOP), drain(queue))
    }

    @Test
    fun `voice stop leaves the other channels' newest values alone`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.POSTURE_MIX + "70")
        queue.enqueue(ControlProtocol.FLOAT_LEVEL + "30")
        queue.enqueue(ControlProtocol.AUDIO_VOLUME + "60")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:80")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:15")
        queue.enqueue(CommandQueue.VOICE_STOP)

        assertEquals(
            listOf(
                CommandQueue.VOICE_STOP,
                ControlProtocol.POSTURE_MIX + "70",
                ControlProtocol.FLOAT_LEVEL + "30",
                ControlProtocol.AUDIO_VOLUME + "60"
            ),
            drain(queue)
        )
    }

    @Test
    fun `voice stop does not touch the movement lane`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.POSTURE_MIX + "70")
        queue.enqueue(CommandQueue.VOICE_STOP)

        // The posture stop owns the bed; a voice stop only silences a cue.
        assertEquals(listOf(CommandQueue.VOICE_STOP, ControlProtocol.POSTURE_MIX + "70"), drain(queue))
    }

    @Test
    fun `posture and global stops keep the voice level the operator set`() {
        for (stop in listOf("stop", ControlProtocol.POSTURE_STOP, ControlProtocol.VIEW_STOP)) {
            val queue = CommandQueue()
            queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:80")
            queue.enqueue(stop)
            assertTrue(queue.enqueue(ControlProtocol.VOICE_PREFIX + "mix:duck:9"), "enqueue $stop")

            assertEquals(
                listOf(stop, ControlProtocol.VOICE_PREFIX + "volume:80", ControlProtocol.VOICE_PREFIX + "mix:duck:9"),
                drain(queue),
                "stop spelling $stop"
            )
        }
    }

    @Test
    fun `a voice level queued after the voice stop still reaches the headset`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:80")
        queue.enqueue(CommandQueue.VOICE_STOP)
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:20")

        // Silence first, then the operator's next choice — not the old one.
        assertEquals(
            listOf(CommandQueue.VOICE_STOP, ControlProtocol.VOICE_PREFIX + "volume:20"),
            drain(queue)
        )
    }

    @Test
    fun `voice stop does not swallow the cue queued after it`() {
        val queue = CommandQueue()
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "play:v-start")
        queue.enqueue(CommandQueue.VOICE_STOP)
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "play:v-relax")

        // Both frames are kept and written in the order asked for; only the
        // sliders were obsolete.
        assertEquals(
            listOf(
                CommandQueue.VOICE_STOP,
                ControlProtocol.VOICE_PREFIX + "play:v-start",
                ControlProtocol.VOICE_PREFIX + "play:v-relax"
            ),
            drain(queue)
        )
    }

    // ---- lanes and lifetime --------------------------------------------

    @Test
    fun `discrete commands keep FIFO order inside their lane`() {
        val queue = CommandQueue()
        queue.enqueue("audio:on")
        queue.enqueue(ControlProtocol.SCENE_PREFIX + "ward")
        queue.enqueue("sus:open")
        assertEquals(
            listOf("audio:on", "scene:ward", "sus:open"),
            drain(queue)
        )
    }

    @Test
    fun `clear drops every lane`() {
        val queue = CommandQueue()
        queue.enqueue("audio:on")
        queue.enqueue(ControlProtocol.POSTURE_MIX + "50")
        queue.enqueue(ControlProtocol.VOICE_PREFIX + "volume:80")
        queue.enqueue("stop")

        queue.clear()

        assertNull(queue.poll())
        assertTrue(queue.isEmpty)
    }
}
