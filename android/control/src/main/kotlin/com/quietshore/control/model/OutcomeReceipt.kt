package com.quietshore.control.model

import org.json.JSONObject

/**
 * The bedside question, as the tablet is allowed to draw it.
 *
 * A tap on 试了 is a *sent* command. It is not a fact. The page owns the ledger
 * (it is the only process that saw the whole session, link or no link), so the
 * only thing that may turn a button into "已记录" is the page's own receipt:
 *
 * ```text
 *  page → tablet   log { kind: "outcome.recorded",
 *                        d: { slot: "attempt"|"success", value: bool, at: ms } }
 * ```
 *
 * The command acknowledgement (`ACK`) is deliberately *not* enough: an ack says
 * the write reached the page's inbox, not that `annotateOutcome` ran. Modelling
 * the two answers as a [Slot] each — rather than one "answered" boolean — also
 * keeps "tried and failed" distinguishable from "did not try".
 */
object OutcomeReceipt {

    /** The `log` kind the page answers a `record:outcome:*` command with. */
    const val LOG_KIND: String = "outcome.recorded"

    const val SLOT_ATTEMPT: String = "attempt"
    const val SLOT_SUCCESS: String = "success"

    /** Command wire prefix; the page matches this whole regular expression. */
    private const val COMMAND = "record:outcome:"

    /** The protocol's own instruction for one half of the question. */
    fun command(slot: String, value: Boolean): String =
        COMMAND + slot + if (value) ":yes" else ":no"

    fun isSlot(slot: String): Boolean =
        slot == SLOT_ATTEMPT || slot == SLOT_SUCCESS

    /** True when [kind] is the receipt kind and [slot] names a half of it. */
    fun matches(kind: String, slot: String): Boolean =
        kind == LOG_KIND && isSlot(slot)

    /**
     * One receipt from a page `log` detail, or null when the document is not an
     * outcome receipt. A malformed slot is refused whole rather than coerced:
     * a wrong `slot` must not light up the other button.
     */
    fun parse(detail: JSONObject): OutcomeRecord? {
        val slot = detail.optString("slot")
        if (!isSlot(slot)) {
            return null
        }
        return OutcomeRecord(
            slot = slot,
            value = detail.optBoolean("value", false),
            at = detail.optLong("at", 0L)
        )
    }

    /**
     * Fold the receipt into the two answers, newest receipt per half wins.
     *
     * The page derives "succeeded implies attempted"; the fold does the same so
     * the tablet cannot draw 未尝试 beside 成功 during the frame between the two
     * receipts.
     */
    fun fold(record: OutcomeRecord, into: OutcomeState): OutcomeState {
        val next = when (record.slot) {
            SLOT_ATTEMPT -> into.copy(attempted = record.value)
            SLOT_SUCCESS -> into.copy(succeeded = record.value)
            else -> return into
        }.copy(pending = false)
        return if (next.succeeded == true) next.copy(attempted = true) else next
    }
}

/**
 * What the page has confirmed about one session's bedside question.
 *
 * Both halves are `null` until the page says otherwise; a `null` is "the page
 * has not spoken", which is exactly the state in which no key may look pressed.
 */
data class OutcomeState(
    val attempted: Boolean? = null,
    val succeeded: Boolean? = null,
    /** Epoch ms of the receipt the tablet applied last, for ordering. */
    val recordedAt: Long = 0L,
    /** A write is on the wire and no receipt has come back for it yet. */
    val pending: Boolean = false
) {
    /** Nothing confirmed, nothing outstanding. */
    val isEmpty: Boolean get() = attempted == null && succeeded == null && !pending

    /** The one sentence the block prints, derived from what the page said. */
    val summary: String
        get() = when {
            pending -> "已发送，等待页面回执"
            succeeded == true -> "已记录：尝试并成功"
            succeeded == false -> "已记录：尝试但未成功"
            attempted == true -> "已记录：尝试了"
            attempted == false -> "已记录：没有尝试"
            else -> "取下头显后，按实际回答"
        }

    /** The success half may only be asked once the attempt half is confirmed. */
    val canReportSuccess: Boolean get() = attempted == true
}

/** One receipt, as the parser read it off the wire. */
data class OutcomeRecord(
    val slot: String,
    val value: Boolean,
    val at: Long
)
