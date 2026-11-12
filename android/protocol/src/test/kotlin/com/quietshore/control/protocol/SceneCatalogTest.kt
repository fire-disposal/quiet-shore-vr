package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The catalogue is the live source of ids, copy and caps. These tests pin the
 * one property that lets a new scene ship without a Kotlin change: the order
 * the page announces is the order the state frame's 4-bit index resolves
 * against, on both ends.
 */
class SceneCatalogTest {

    private val five = """
        {"scenes":[
          {"id":"washroom","name":{"zh":"洁净立便间","en":"Washroom"},"tagline":{"zh":"稳。","en":"Steady."},"comfortLevel":null},
          {"id":"shore","name":{"zh":"仰望湖面","en":"Lake"},"tagline":{"zh":"云。","en":"Clouds."},"comfortLevel":null},
          {"id":"ward","name":{"zh":"病房","en":"Ward"},"tagline":{"zh":"窗。","en":"Window."},"comfortLevel":null},
          {"id":"garden","name":{"zh":"花园","en":"Garden"},"tagline":{"zh":"树影。","en":"Shade."},"comfortLevel":2},
          {"id":"grove","name":{"zh":"树林","en":"Grove"},"tagline":{"zh":"落叶。","en":"Leaves."},"comfortLevel":1}
        ]}
    """.trimIndent()

    @Test
    fun `parses the announced order, copy and cap`() {
        val scenes = SceneCatalogDocument.parse(five)
        requireNotNull(scenes)
        assertEquals(
            listOf("washroom", "shore", "ward", "garden", "grove"),
            scenes.map { it.id }
        )
        assertEquals("洁净立便间", scenes[0].nameZh)
        assertEquals("树影。", scenes[3].taglineZh)
        assertEquals(2, scenes[3].comfortLevel)
        assertEquals(1, scenes[4].comfortLevel)
        assertNull(scenes[0].comfortLevel)
        assertTrue(scenes.none { it.special })

        val builtIn = requireNotNull(
            SceneCatalogDocument.parse("""{"scenes":[{"id":"prep","special":true}]}""")
        )
        assertTrue(builtIn.single().special)
    }

    @Test
    fun `a damaged or ambiguous catalogue is refused whole`() {
        assertNull(SceneCatalogDocument.parse("{\"scenes\":[]}"))
        assertNull(SceneCatalogDocument.parse("{}"))
        assertNull(SceneCatalogDocument.parse("not json"))
        // Two entries with one id would make the index ambiguous.
        assertNull(
            SceneCatalogDocument.parse(
                """{"scenes":[{"id":"shore"},{"id":"shore"}]}"""
            )
        )
        // An id the command grammar and the state nibble cannot carry.
        assertNull(SceneCatalogDocument.parse("""{"scenes":[{"id":"Two Words"}]}"""))
        // More entries than the state frame's nibble can address.
        val tooMany = (0..SceneCatalogDocument.MAX_SCENES).joinToString(",") {
            """{"id":"scene$it"}"""
        }
        assertNull(SceneCatalogDocument.parse("{\"scenes\":[$tooMany]}"))
    }

    @Test
    fun `a fifth scene rides the frame without a Kotlin table`() {
        val scenes = requireNotNull(SceneCatalogDocument.parse(five))
        val ids = scenes.map { it.id }
        val state = ControlState(scene = "grove", floatLevel = 1, eyeHeight = 1.7f)
        val bytes = ControlProtocol.encodeState(state, sceneIds = ids)

        val decoded = requireNotNull(ControlProtocol.decodeState(bytes, ids))
        assertEquals("grove", decoded.scene)
        // The same frame read by a client that has not received the catalogue
        // falls back to the last scene the JSON channel named, not to a wrong id.
        val stale = requireNotNull(
            ControlProtocol.decodeState(bytes, ids.take(4), fallbackScene = "shore")
        )
        assertEquals("shore", stale.scene)
    }

    @Test
    fun `the command allowlist follows the catalogue`() {
        assertTrue(ControlProtocol.isAllowedCommand("scene:garden", setOf("garden")))
        assertFalse(ControlProtocol.isAllowedCommand("scene:garden"))
        // Case folding stays: the wire is lower-case.
        assertTrue(ControlProtocol.isAllowedCommand("SCENE:GARDEN", setOf("garden")))
    }
}
