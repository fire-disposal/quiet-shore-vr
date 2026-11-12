package com.quietshore.control.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The headset's allowlist and the page's parser (`src/app/commands.ts`) must
 * accept exactly the same grammar. These cases mirror `tests/commands.test.ts`
 * one for one; when one side gains a rule, the other gains the same case.
 */
class CommandGrammarTest {

    @Test
    fun `view presets are named, never parameterised`() {
        for (name in ControlProtocol.VIEW_ANIM_NAMES) {
            assertEquals(name, ControlProtocol.parseViewAnim("view:anim:$name"))
        }
        assertNull(ControlProtocol.parseViewAnim("view:anim:loop"))
        assertNull(ControlProtocol.parseViewAnim("view:anim:up,3"))
    }

    @Test
    fun `sus show and answer carry one value in range`() {
        assertEquals(3, ControlProtocol.parseSusShow("sus:show:3"))
        assertNull(ControlProtocol.parseSusShow("sus:show:0"))
        assertNull(ControlProtocol.parseSusShow("sus:show:11"))
        assertNull(ControlProtocol.parseSusShow("sus:show:x"))
        assertEquals(5, ControlProtocol.parseSusAnswer("sus:answer:5"))
        assertNull(ControlProtocol.parseSusAnswer("sus:answer:01"))
        assertNull(ControlProtocol.parseSusAnswer("sus:answer:0"))
    }

    @Test
    fun `the allowlist covers the switches the tablet actually sends`() {
        // Both of these were wired on the tablet but missing here, so the
        // headset rejected them and the switch did nothing at all.
        for (raw in listOf("sus:voice:on", "sus:voice:off", "voice:subtitle:on", "voice:subtitle:off")) {
            assertTrue(ControlProtocol.isAllowedCommand(raw), raw)
        }
        for (raw in listOf("sus:voice:maybe", "voice:subtitle:2", "sus:voice:", "voice:subtitle")) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
        }
    }

    fun `the allowlist accepts what the tablet sends and rejects the rest`() {
        for (raw in listOf(
            "enter", "home", "exit", "stop", "calibrate",
            "audio:on", "audio:off", "audio:toggle",
            "float:level:0", "float:level:3",
            "scene:washroom", "scene:shore", "scene:ward", "scene:prep",
            "anim:duration:4000", "anim:duration:20000",
            "posture:rise", "posture:lower", "posture:stop",
            "gaze:dwell:on", "gaze:dwell:off",
            "sus:open", "sus:close", "sus:show:4", "sus:answer:2", "sus:voice:off",
            "view:anim:up", "view:anim:recenter", "view:stop",
            "voice:play:v-enter-1", "voice:stop", "voice:volume:80", "voice:subtitle:on",
            "voice:set:female",
            "record:outcome:attempt:yes", "record:outcome:attempt:no",
            "record:outcome:success:yes", "record:outcome:success:no"
        )) {
            assertTrue(ControlProtocol.isAllowedCommand(raw), raw)
        }
        for (raw in listOf(
            "start",
            "preview",
            "allapps",
            "status",
            "recalibrate",
            "launch:the:missiles",
            "scene:moon",
            "float:level:4",
            "float:profile:b",
            "float:breath:on",
            "mode:float",
            "view:orient:0,12",
            "view:anim:loop",
            "view:anim:breathe",
            "settings:eyeheight:1.70",
            "settings:hud:on",
            "sus:next",
            "sus:answer:01",
            "record:outcome:attempt:maybe",
            "record:outcome:mood:yes",
            "record:outcome:",
        )) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
        }
    }
}
