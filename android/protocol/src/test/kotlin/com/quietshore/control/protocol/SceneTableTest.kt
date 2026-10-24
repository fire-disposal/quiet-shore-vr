package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The scene tables are the operator's only view of the shipped rooms. Ids drive
 * state byte 11 (append only), and the copy must cover exactly the same ids:
 * a blurb for a scene that does not exist is the drift that produced the
 * washroom's imaginary handrail.
 */
class SceneTableTest {

    @Test
    fun `backlog order is the wire contract`() {
        assertEquals(listOf("washroom", "shore", "lightwell", "ward"), ControlProtocol.SCENE_IDS)
        assertEquals("washroom", ControlProtocol.DEFAULT_SCENE)
    }

    @Test
    fun `labels and blurbs cover exactly the shipped scenes`() {
        assertEquals(ControlProtocol.SCENE_IDS.toSet(), ControlProtocol.SCENE_LABELS.keys)
        assertEquals(ControlProtocol.SCENE_IDS.toSet(), ControlProtocol.SCENE_BLURBS.keys)
        for (id in ControlProtocol.SCENE_IDS) {
            assertTrue(ControlProtocol.SCENE_LABELS.getValue(id).isNotBlank())
            val blurb = ControlProtocol.SCENE_BLURBS.getValue(id)
            assertTrue(blurb.isNotBlank())
            assertTrue(blurb.length <= 48, "blurb for $id is too long for one card line")
        }
    }

    @Test
    fun `every scene id resolves to a wire index`() {
        for (id in ControlProtocol.SCENE_IDS) {
            val index = ControlProtocol.SCENE_IDS.indexOf(id)
            assertTrue(index in 0..14)
        }
    }
}
