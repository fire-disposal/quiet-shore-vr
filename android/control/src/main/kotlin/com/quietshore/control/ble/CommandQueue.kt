package com.quietshore.control.ble

import com.quietshore.control.protocol.ControlProtocol

/**
 * Tablet-side outbound ordering, pure and single-threaded by contract.
 *
 * Four lanes so a 10 Hz slider stream can never starve an operator action:
 * - stop lane: `stop`, `view:stop`, `posture:stop`, `voice:stop` jump every
 *   other lane and discard the queued samples, so a stop is never delayed by a
 *   slider; a stop also drops the motion still waiting in the discrete lane
 *   ([SUPERSEDED_BY_STOP]) — anything enqueued after it is kept;
 * - discrete lane: FIFO, every command is delivered (bounded only to keep a
 *   wedged link from growing without limit; refusal is explicit, never silent);
 * - channel lane: one sample per absolute operator slider
 *   ([CHANNELS]), always the newest value of that channel. Dragging posture
 *   does not drop a half-finished volume drag and vice versa;
 * - movement lane: the newest `posture:mix` sample, ahead of the channel lane
 *   because posture is the command a hand rides at 10 Hz.
 *
 * Not thread safe: [com.quietshore.control.ble.BleController] serialises access.
 */
internal class CommandQueue(private val discreteCapacity: Int = DEFAULT_CAPACITY) {

    private val stops = ArrayDeque<String>()
    private val discrete = ArrayDeque<String>()
    private var move: String? = null

    /** Keyed by channel key, in the fixed [CHANNELS] order, never by prefix. */
    private val channels = LinkedHashMap<String, String>(CHANNELS.size)

    val isEmpty: Boolean
        get() = stops.isEmpty() && discrete.isEmpty() && move == null && channels.isEmpty()

    /**
     * @return false when the discrete lane is full and the command was refused.
     */
    fun enqueue(command: String): Boolean {
        if (command in STOP_COMMANDS) {
            // Stop preempts everything still queued — including a slider sample
            // still waiting: a target sent before the freeze must not arrive
            // after it.
            stops.addLast(command)
            // The posture stop and the global stop own the bed; a view or voice
            // stop says nothing about a posture sample the operator is riding.
            if (command != VOICE_STOP && command != ControlProtocol.VIEW_STOP) {
                move = null
            }
            // Voice stop is the one stop that owns its channel: a volume or
            // duck value picked before it would restart the cue the operator
            // just silenced. The posture and global stops leave the sliders
            // alone — the page clamps them to the frozen envelope and the
            // operator's volume choice is not motion.
            if (command == VOICE_STOP) {
                channels.keys.removeAll(VOICE_STOPPED_CHANNELS)
            }
            // Motion already queued belongs to the operator's earlier intent.
            // Left in the discrete lane it would be written right after the
            // freeze and the headset would start moving again, so the stop
            // supersedes it. Commands enqueued after this point are kept: they
            // are the operator's newest intent and must still be delivered.
            discrete.removeAll(SUPERSEDED_BY_STOP)
            return true
        }
        val channel = channelOf(command)
        if (channel != null) {
            // A drag is a stream, not a list: the operator only ever means the
            // newest sample of each slider, and a queue of them would arrive
            // minutes late. Each channel keeps its own newest value, so
            // dragging posture does not erase a volume drag that started
            // earlier, and replacing a value keeps its arrival position so two
            // channels never reorder each other.
            if (channel == ControlProtocol.POSTURE_MIX) {
                move = command
            } else {
                channels[channel] = command
            }
            return true
        }
        if (discrete.size + stops.size >= discreteCapacity) {
            return false
        }
        discrete.addLast(command)
        return true
    }

    /**
     * Next command to write: stops first, then discrete FIFO, then the newest
     * movement sample, then each channel's newest sample in [CHANNELS] order.
     */
    fun poll(): String? {
        stops.removeFirstOrNull()?.let { return it }
        discrete.removeFirstOrNull()?.let { return it }
        move?.let { move = null; return it }
        if (channels.isNotEmpty()) {
            val first = channels.entries.iterator().next()
            channels.remove(first.key)
            return first.value
        }
        return null
    }

    /** Lease loss / disconnect: nothing queued may outlive the session. */
    fun clear() {
        stops.clear()
        discrete.clear()
        move = null
        channels.clear()
    }

    /** The slider channel key [command] belongs to, or null for a discrete one. */
    private fun channelOf(command: String): String? {
        for (key in CHANNELS) {
            if (command.startsWith(key)) return key
        }
        return null
    }

    companion object {
        const val DEFAULT_CAPACITY = 64

        /** Commands that must never wait behind queued motion or scene work. */
        val STOP_COMMANDS: Set<String> = setOf(
            "stop",
            ControlProtocol.VIEW_STOP,
            ControlProtocol.POSTURE_STOP,
            VOICE_STOP
        )

        /** `voice:stop`: silences the cue channel, and only that channel. */
        const val VOICE_STOP: String = ControlProtocol.VOICE_PREFIX + "stop"

        /** The two voice slider channels a `voice:stop` makes obsolete. */
        val VOICE_STOPPED_CHANNELS: Set<String> = setOf(
            ControlProtocol.VOICE_PREFIX + "volume:",
            ControlProtocol.VOICE_PREFIX + "mix:duck:"
        )

        /**
         * Absolute slider channels, one queued sample each, in poll order.
         *
         * Posture first: it is the 10 Hz drag; audio and voice levels change at
         * hand speed and may wait one write for it.
         */
        val CHANNELS: List<String> = listOf(
            ControlProtocol.POSTURE_MIX,
            ControlProtocol.FLOAT_LEVEL,
            ControlProtocol.AUDIO_VOLUME,
            ControlProtocol.VOICE_PREFIX + "volume:",
            ControlProtocol.VOICE_PREFIX + "mix:duck:"
        )

        /**
         * Commands a stop makes obsolete when they are still queued behind it.
         *
         * These are motion: posture travel and view animations, which would
         * move the patient again right after the freeze. Anything else (audio,
         * scene state, SUS, ping) is not motion and is left alone, so a stop
         * never silently swallows an unrelated operator action.
         */
        val SUPERSEDED_BY_STOP: Set<String> =
            setOf(ControlProtocol.POSTURE_RISE, ControlProtocol.POSTURE_LOWER) +
                ControlProtocol.VIEW_ANIM_NAMES.map { ControlProtocol.VIEW_ANIM + it }
    }
}
