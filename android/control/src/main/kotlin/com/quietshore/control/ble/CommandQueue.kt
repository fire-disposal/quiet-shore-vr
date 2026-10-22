package com.quietshore.control.ble

import com.quietshore.control.protocol.ControlProtocol

/**
 * Tablet-side outbound ordering, pure and single-threaded by contract.
 *
 * Three lanes so a 10 Hz pitch stream can never starve an operator action:
 * - stop lane: `view:stop`, `stop`, `posture:stop` jump every other lane and
 *   discard the queued pitch sample, so a stop is never delayed by movement;
 * - discrete lane: FIFO, every command is delivered (bounded only to keep a
 *   wedged link from growing without limit; refusal is explicit, never silent);
 * - movement lane: exactly one `view:orient` sample, always the newest.
 *
 * Not thread safe: [com.quietshore.control.ble.BleController] serialises access.
 */
internal class CommandQueue(private val discreteCapacity: Int = DEFAULT_CAPACITY) {

    private val stops = ArrayDeque<String>()
    private val discrete = ArrayDeque<String>()
    private var move: String? = null

    val isEmpty: Boolean get() = stops.isEmpty() && discrete.isEmpty() && move == null

    val pendingMoves: Int get() = if (move == null) 0 else 1

    val pendingDiscrete: Int get() = discrete.size + stops.size

    val newestMove: String? get() = move

    /**
     * @return false when the discrete lane is full and the command was refused.
     */
    fun enqueue(command: String): Boolean {
        if (command.startsWith(ControlProtocol.VIEW_ORIENT)) {
            // Latest sample wins; never queues behind anything.
            move = command
            return true
        }
        if (command in STOP_COMMANDS) {
            // Stop preempts: drop the queued pitch sample before it can lag.
            move = null
            stops.addLast(command)
            return true
        }
        if (discrete.size + stops.size >= discreteCapacity) {
            return false
        }
        discrete.addLast(command)
        return true
    }

    /** Next command to write: stops first, then discrete FIFO, then movement. */
    fun poll(): String? {
        stops.removeFirstOrNull()?.let { return it }
        discrete.removeFirstOrNull()?.let { return it }
        return move.also { move = null }
    }

    /** Lease loss / disconnect: nothing queued may outlive the session. */
    fun clear() {
        stops.clear()
        discrete.clear()
        move = null
    }

    companion object {
        const val DEFAULT_CAPACITY = 64

        /** Commands that must never wait behind queued motion or scene work. */
        val STOP_COMMANDS: Set<String> = setOf("stop", "view:stop", "posture:stop")
    }
}
