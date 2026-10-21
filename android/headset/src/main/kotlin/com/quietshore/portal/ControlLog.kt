package com.quietshore.portal

import com.quietshore.control.protocol.ControlProtocol

/**
 * One page-bound command and the loopback sequence number it was accepted at.
 * The page acks the seq, so a reconnect can be gap-filled exactly once.
 */
internal class ControlEntry(val seq: Int, val command: String)

/** How a recorded command has to be pushed to the page. */
internal enum class ControlKind {
    /** Scene/posture/cue/view:stop and friends: stays pending until acked. */
    DISCRETE,

    /** `view:move:*` sample: ack-free, newest absolute target wins. */
    CONTINUOUS
}

/** Kinds of frames a subscriber can hold; drives queue coalescing. */
internal enum class FrameKind {
    /** A `cmd` message carrying only a fresh `view:move` sample. */
    CONTINUOUS,

    /** A `cmd` message carrying a discrete command; never dropped by the queue. */
    DISCRETE,

    /** The `ready` handshake message, sent before any command. */
    SNAPSHOT,

    /** A `control` message carrying ownership only. */
    STATE
}

/**
 * Ack-based command retention for the page.
 *
 * Discrete commands stay resident until the page acks them (`ack.seq` prunes
 * everything at or below it), so a reconnect with `since` can be gap-filled.
 * The newest continuous `view:move` lives in its own slot and is never acked:
 * a 10 Hz movement stream can never evict a discrete command.
 *
 * `view:anim:*` is deliberately absent: it is a one-shot event, delivered live
 * and never retained, so a reconnect cannot replay an animation.
 *
 * Retention is bounded to [depth]; beyond that the oldest unacked command is
 * dropped (the page has been gone long enough to have lost its lease).
 *
 * Not thread safe: the caller serialises access (see `PortalService.controlLock`).
 */
internal class ControlLog(private val depth: Int = PENDING_DEPTH) {

    private val pending = LinkedHashMap<Int, ControlEntry>(16)
    private var continuous: ControlEntry? = null

    /** Number of discrete commands still awaiting an ack. */
    val pendingSize: Int get() = pending.size

    fun record(seq: Int, command: String): ControlKind {
        if (command.startsWith(ControlProtocol.VIEW_MOVE)) {
            continuous = ControlEntry(seq, command)
            return ControlKind.CONTINUOUS
        }
        if (command.startsWith(ControlProtocol.VIEW_ANIM)) {
            // One shot: delivered live only, never retained for replay.
            return ControlKind.DISCRETE
        }
        pending[seq] = ControlEntry(seq, command)
        trim()
        return ControlKind.DISCRETE
    }

    /** Drops every pending discrete command at or below [seq]. */
    fun ack(seq: Int) {
        val iterator = pending.entries.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().key <= seq) {
                iterator.remove()
            }
        }
    }

    /** Pending discrete commands newer than [since], ascending by seq. */
    fun pendingSince(since: Int): List<ControlEntry> =
        pending.values.filter { it.seq > since }.sortedBy { it.seq }

    /** Newest continuous sample, ack-free and retained for reconnect gap-fill. */
    fun latestContinuous(): ControlEntry? = continuous

    private fun trim() {
        while (pending.size > depth) {
            val oldest = pending.keys.first()
            pending.remove(oldest)
        }
    }

    companion object {
        /** Unacked discrete commands kept for gap-fill. */
        const val PENDING_DEPTH = 64
    }
}

/**
 * Per-subscriber outbound queue.
 *
 * Continuous frames replace each other in place, discrete frames are never
 * dropped, and a full queue evicts the oldest continuous frame first, then the
 * oldest state/ready frame. Dropping an old *discrete* frame needs
 * [depth] unacked discrete frames queued, i.e. more than [ControlLog.PENDING_DEPTH]
 * can retain: at that point the peer is gone and the socket write will fail.
 */
internal class CoalescingQueue<T>(private val depth: Int) {

    private val frames = ArrayDeque<Frame<T>>(depth)

    val size: Int get() = frames.size
    val isEmpty: Boolean get() = frames.isEmpty()
    val isNotEmpty: Boolean get() = frames.isNotEmpty()

    fun offer(kind: FrameKind, payload: T) {
        if (kind == FrameKind.CONTINUOUS) {
            // A newer sample supersedes every queued sample; discrete frames stay.
            val iterator = frames.iterator()
            while (iterator.hasNext()) {
                if (iterator.next().kind == FrameKind.CONTINUOUS) {
                    iterator.remove()
                }
            }
        }
        if (frames.size >= depth) {
            evictOne()
        }
        frames.addLast(Frame(kind, payload))
    }

    fun pollFirst(): T? = frames.removeFirstOrNull()?.payload

    fun clear() {
        frames.clear()
    }

    /** Kinds in delivery order; used by the JVM harness. */
    fun kinds(): List<FrameKind> = frames.map { it.kind }

    private fun evictOne() {
        if (removeFirstOf(FrameKind.CONTINUOUS)) return
        if (removeFirstOf(FrameKind.SNAPSHOT)) return
        if (removeFirstOf(FrameKind.STATE)) return
        if (frames.isNotEmpty()) {
            frames.removeFirst()
        }
    }

    private fun removeFirstOf(kind: FrameKind): Boolean {
        val iterator = frames.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().kind == kind) {
                iterator.remove()
                return true
            }
        }
        return false
    }

    private class Frame<T>(val kind: FrameKind, val payload: T)
}
