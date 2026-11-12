package com.quietshore.control.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ProgramCodecTest {

    @Test
    fun `round-trips the wire form the page parses`() {
        val program = ProgramState(
            auto = true,
            segments = listOf(
                ProgramSegment("shore", 360, "start", 3),
                ProgramSegment("ward", 240, "imagine", 2),
                ProgramSegment("shore", 180, "close", 1)
            )
        )
        val wire = ProgramCodec.format(program)
        assertEquals(
            "program:1:shore,360,start,3;ward,240,imagine,2;shore,180,close,1",
            wire
        )
        assertEquals(program, ProgramCodec.parse(wire))
    }

    @Test
    fun `refuses a plan the page would refuse`() {
        for (raw in listOf(
            "program:1:",
            "program:2:shore,360,none,3",
            "program:1:shore,360,none",
            "program:1:shore,-1,none,3",
            "program:1:shore,360,shout,3",
            "program:1:shore,360,none,4",
            "program:1:Shore,360,none,3",
            "program:1:shore,360,none,3;"
        )) {
            assertNull(ProgramCodec.parse(raw), raw)
        }
    }
}
