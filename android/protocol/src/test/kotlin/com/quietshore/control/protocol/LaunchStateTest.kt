package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The scene's ownership rule. These are the cases that used to fail in the
 * field as "it always goes back to the previous scene": an unknown id must
 * never replace a valid one, a repeat must not bump the revision (so the
 * persistence layer can skip a redundant write), and every accepted change
 * must be visible as a new revision.
 */
class LaunchStateTest {

    @Test
    fun `an unknown scene never replaces the current one`() {
        val state = LaunchState("ward")
        assertFalse(state.choose("not-a-scene"))
        assertFalse(state.choose(""))
        assertFalse(state.choose("   "))
        assertEquals("ward", state.scene)
        assertEquals(0L, state.revision)
    }

    @Test
    fun `choosing the current scene changes nothing`() {
        val state = LaunchState("shore")
        assertFalse(state.choose("shore"))
        assertEquals(0L, state.revision)
    }

    @Test
    fun `an accepted change bumps the revision once`() {
        val state = LaunchState()
        assertTrue(state.choose("shore"))
        assertEquals("shore", state.scene)
        assertEquals("prep", ControlProtocol.DEFAULT_SCENE)
        assertEquals(1L, state.revision)

        assertTrue(state.choose("ward"))
        assertEquals(2L, state.revision)
    }

    @Test
    fun `whitespace and case do not smuggle an id in`() {
        val state = LaunchState()
        // The wire channel normalises case before this point; only the exact
        // table entry counts, so a stray " Ward " cannot half-apply.
        assertFalse(state.choose(" Ward "))
        assertEquals(ControlProtocol.DEFAULT_SCENE, state.scene)
    }

    @Test
    fun `the initial value is sanitised`() {
        assertEquals(ControlProtocol.DEFAULT_SCENE, LaunchState("nope").scene)
        assertEquals("ward", LaunchState("ward").scene)
    }

    @Test
    fun `a scene announced by the page is accepted without a table change`() {
        val announced = setOf("washroom", "shore", "garden")
        val state = LaunchState("washroom", announced)
        assertTrue(state.choose("garden", announced))
        assertEquals("garden", state.scene)
        // The built-in table still rejects it when no catalogue says otherwise.
        assertFalse(state.choose("garden"))
    }
}
