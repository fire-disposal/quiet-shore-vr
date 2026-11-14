package com.quietshore.control.model

import com.quietshore.control.protocol.ControlState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.json.JSONObject

/**
 * The bedside answer is a *receipt* contract, not a command contract.
 *
 * Every test here is a clause of that difference: a tap sends, only the page's
 * `log kind=outcome.recorded` records, the two halves are independent, and a
 * malformed or missing receipt leaves the button in its un-answered state
 * instead of guessing.
 */
class OutcomeReceiptTest {

    private fun receipt(slot: String, value: Boolean, at: Long = 1_000L) =
        JSONObject().put("slot", slot).put("value", value).put("at", at)

    @Test
    fun `a fresh state claims nothing`() {
        val state = OutcomeState()

        assertTrue(state.isEmpty)
        assertFalse(state.pending)
        assertNull(state.attempted)
        assertNull(state.succeeded)
        assertEquals("取下头显后，按实际回答", state.summary)
    }

    @Test
    fun `a sent write is pending, never recorded`() {
        val state = OutcomeState(pending = true)

        assertFalse(state.isEmpty)
        assertEquals("已发送，等待页面回执", state.summary)
        // The whole point of the contract: the button must not claim a record
        // that no receipt has confirmed.
        assertNull(state.attempted)
    }

    @Test
    fun `the attempt receipt is what turns the key into 已记录`() {
        val record = OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_ATTEMPT, true))
        assertTrue(record != null)

        val next = OutcomeReceipt.fold(record!!, OutcomeState(pending = true))

        assertEquals(true, next.attempted)
        assertNull(next.succeeded)
        assertEquals("已记录：尝试了", next.summary)
    }

    @Test
    fun `did not try`() {
        val record = OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_ATTEMPT, false))!!

        val next = OutcomeReceipt.fold(record, OutcomeState())

        assertEquals(false, next.attempted)
        assertEquals("已记录：没有尝试", next.summary)
        // The success half is only askable once the page confirmed an attempt.
        assertFalse(next.canReportSuccess)
    }

    @Test
    fun `tried and failed is its own answer`() {
        val attempted = OutcomeReceipt.fold(
            OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_ATTEMPT, true))!!,
            OutcomeState()
        )
        val failed = OutcomeReceipt.fold(
            OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_SUCCESS, false))!!,
            attempted
        )

        assertEquals(true, failed.attempted)
        assertEquals(false, failed.succeeded)
        assertEquals("已记录：尝试但未成功", failed.summary)
    }

    @Test
    fun `success implies attempted, as the page's own fold does`() {
        // A single success receipt (a page that had already filed the attempt,
        // or a frame the tablet missed) must not draw 成功 beside a blank
        // attempt row for even one recomposition.
        val next = OutcomeReceipt.fold(
            OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_SUCCESS, true))!!,
            OutcomeState()
        )

        assertEquals(true, next.succeeded)
        assertEquals(true, next.attempted)
    }

    @Test
    fun `the newest receipt per half wins`() {
        val first = OutcomeReceipt.fold(
            OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_ATTEMPT, true))!!,
            OutcomeState()
        )
        val corrected = OutcomeReceipt.fold(
            OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_ATTEMPT, false, at = 2_000L))!!,
            first
        )

        assertEquals(false, corrected.attempted)
        // A corrected "did not try" clears the success half's claim: the two
        // facts describe one session, and the page would not hold both.
        assertEquals("已记录：没有尝试", corrected.summary)
    }

    @Test
    fun `a malformed receipt is refused whole`() {
        assertNull(OutcomeReceipt.parse(JSONObject().put("slot", "outcome").put("value", true)))
        assertNull(OutcomeReceipt.parse(JSONObject().put("value", true)))
        // The success half cannot be lit by a receipt with no value at all —
        // absent reads as false, which is a real answer, not a press.
        assertEquals(false, OutcomeReceipt.parse(receipt(OutcomeReceipt.SLOT_SUCCESS, false))!!.value)
    }

    @Test
    fun `only the page's own kind is a receipt`() {
        assertTrue(OutcomeReceipt.matches("outcome.recorded", "attempt"))
        assertTrue(OutcomeReceipt.matches("outcome.recorded", "success"))
        assertFalse(OutcomeReceipt.matches("outcome.recorded", "anything"))
        assertFalse(OutcomeReceipt.matches("scene.switched", "attempt"))
        assertFalse(OutcomeReceipt.matches("calibration.recorded", "attempt"))
    }

    @Test
    fun `the command is the exact wire form the page parses`() {
        assertEquals("record:outcome:attempt:yes", OutcomeReceipt.command("attempt", true))
        assertEquals("record:outcome:attempt:no", OutcomeReceipt.command("attempt", false))
        assertEquals("record:outcome:success:yes", OutcomeReceipt.command("success", true))
        assertEquals("record:outcome:success:no", OutcomeReceipt.command("success", false))
        assertTrue(OutcomeReceipt.isSlot("attempt"))
        assertTrue(OutcomeReceipt.isSlot("success"))
        assertFalse(OutcomeReceipt.isSlot("SUCCESS"))
    }
}
