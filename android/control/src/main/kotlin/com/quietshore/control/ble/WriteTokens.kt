package com.quietshore.control.ble

/**
 * Identity of the current link and of the write in flight on it.
 *
 * Two generations, because one is not enough to tell the cases apart:
 * - [connection] changes on every teardown, so a completion from a link that is
 *   already gone can be ignored outright — it must not clear the new link's
 *   writer, delete a seq that now belongs to someone else, or pump a queue the
 *   new link owns;
 * - [write] changes on every write, so a completion that lost a race with the
 *   ACK timeout (or with an abandoned request) is recognised as stale even
 *   though the link is still the same one.
 *
 * Seq numbers are reset per link, so `inFlight[seq]` alone cannot identify a
 * write: link A's seq 1 and link B's seq 1 are the same number.
 *
 * Not thread safe: [BleController] drives it under its send lock.
 */
internal class WriteTokens {
    var connection: Long = 0L
        private set

    var write: Long = 0L
        private set

    /** Wire sequence counter for the current link; see [nextSeq]. */
    private var written: Int = 0

    /** True while one command occupies the writer. */
    var writing: Boolean = false
        private set

    /** A new command takes the writer; returns its token. */
    fun beginWrite(): Long {
        write++
        writing = true
        return write
    }

    /** Hands the writer back without claiming a completion (ACK timeout). */
    fun abandonWrite() {
        write++
        writing = false
    }

    /** Teardown: every outstanding completion becomes stale. */
    fun retireLink() {
        connection++
        write++
        writing = false
        written = 0
    }

    /** Next wire sequence number for the current link. */
    fun nextSeq(): Int {
        written++
        return written
    }

    /** Whether [token] — seen on [connection] — is still the write in flight. */
    fun owns(connection: Long, token: Long): Boolean =
        connection == this.connection && token == write

    /**
     * Settles a completion for the write it was started by.
     *
     * @param seq wire sequence number that write used, or 0 when it needed no
     *   ACK. Passed back to [onRelease] only when this completion really owns
     *   the writer, so a stale completion can never ask for a seq to be dropped.
     * @return true when the caller may report a failure and pump the next
     *   command; false when the completion is stale and must change nothing.
     */
    fun settle(connection: Long, token: Long, seq: Int, onRelease: (Int) -> Unit): Boolean {
        if (!owns(connection, token)) {
            return false
        }
        writing = false
        onRelease(seq)
        return true
    }
}
