package com.quietshore.control.ble

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/**
 * M1: every automatic reconnect attempt retries the chosen headset.
 *
 * The screen offers the operator three attempts. The first one connected; the
 * later ones used to switch to a scan that only redrew the pairing list and
 * never asked the stack to connect, so attempts 2 and 3 could not restore the
 * link even when the headset was beside the tablet.
 */
class ReconnectPlanTest {

    private val address = "AA:BB:CC:DD:EE:FF"

    @Test
    fun `the second attempt still connects instead of scanning`() {
        assertEquals(address, reconnectAddress(address, attempt = 2))
    }

    @Test
    fun `the third attempt still connects`() {
        assertEquals(address, reconnectAddress(address, attempt = 3))
    }

    @Test
    fun `every attempt keeps retrying the same address`() {
        for (attempt in 1..3) {
            assertEquals(address, reconnectAddress(address, attempt))
        }
    }

    @Test
    fun `without a known address the operator gets the screen back`() {
        // A headset that could not be resolved leaves nothing to reconnect to;
        // reporting failure beats scanning silently on the recovery path.
        assertNull(reconnectAddress(null, attempt = 2))
    }

    @Test
    fun `attempts are 1-based`() {
        // The counter is a retry-bridge readback, not something the address
        // may silently reinterpret: 0 means the caller lost track.
        assertThrows(IllegalArgumentException::class.java) { reconnectAddress(address, 0) }
    }
}
