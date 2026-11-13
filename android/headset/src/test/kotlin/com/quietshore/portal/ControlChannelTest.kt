package com.quietshore.portal

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals

/**
 * Runs the channel harness under Gradle so the headset's transport and entry
 * supervision are part of the build, not a script someone remembers to run.
 */
class ControlChannelTest {

    @Test
    fun `channel harness reports no failures`() {
        assertEquals(0, runControlChannelChecks())
    }
}
