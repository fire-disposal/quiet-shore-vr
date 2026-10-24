package com.quietshore.control.protocol

/**
 * Reassembles the JSON channel's `[id][index][total][payload]` chunks.
 *
 * Several documents may interleave on the one characteristic (a SUS sheet
 * arriving while a flags update streams), so partials are keyed by chunk id.
 * A missing or reordered chunk drops that document instead of splicing a
 * corrupt payload; the sender always re-publishes state on change, so nothing
 * is lost for good.
 */
class JsonAssembler(
    private val timeoutMs: Long = 5000L,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {
    private val partials = HashMap<Int, Partial>()

    private class Partial(val total: Int, val startedAt: Long) {
        val payload = java.io.ByteArrayOutputStream()
        var next = 0
    }

    /** Returns the document's bytes once its last chunk lands, else null. */
    fun add(chunk: ByteArray): ByteArray? {
        if (chunk.size <= ControlProtocol.chunkHeaderBytes) {
            return null
        }
        val id = chunk[0].toInt() and 0xFF
        val index = chunk[1].toInt() and 0xFF
        val total = chunk[2].toInt() and 0xFF
        if (total == 0 || index >= total) {
            return null
        }
        val now = clock()
        purge(now)

        val partial = partials[id]
        if (partial != null && (partial.total != total || index != partial.next)) {
            partials.remove(id)
            return null
        }
        val current = partial ?: Partial(total, now).also { partials[id] = it }
        current.payload.write(
            chunk,
            ControlProtocol.chunkHeaderBytes,
            chunk.size - ControlProtocol.chunkHeaderBytes
        )
        current.next += 1
        if (current.next < current.total) {
            return null
        }
        partials.remove(id)
        return current.payload.toByteArray()
    }

    fun reset(): Unit = partials.clear()

    private fun purge(now: Long) {
        val iterator = partials.entries.iterator()
        while (iterator.hasNext()) {
            if (now - iterator.next().value.startedAt > timeoutMs) {
                iterator.remove()
            }
        }
    }
}
