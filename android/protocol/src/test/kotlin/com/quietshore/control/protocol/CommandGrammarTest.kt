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
    fun `view orient is two decimal degrees inside the envelope`() {
        val sample = ControlProtocol.parseViewOrient("view:orient:0,12")!!
        assertEquals(0f, sample.lookYawDeg)
        assertEquals(12f, sample.upGazeDeg)
        assertNotNull(ControlProtocol.parseViewOrient("view:orient:-180,90"))
        for (raw in listOf(
            "view:orient:0,91",
            "view:orient:181,0",
            "view:orient:0",
            "view:orient:1,2,3",
            "view:orient:+1,0",
            "view:orient:.5,0",
            "view:orient:5e1,0"
        )) {
            assertNull(ControlProtocol.parseViewOrient(raw), raw)
        }
    }

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
    fun `cue intensity is plain decimals inside zero and one`() {
        assertEquals(0.5f, ControlProtocol.parseCueIntensity("cue:intensity:0.5")!!)
        assertEquals(1f, ControlProtocol.parseCueIntensity("cue:intensity:1")!!)
        for (raw in listOf("cue:intensity:1.5", "cue:intensity:-0.1", "cue:intensity:5e-1", "cue:intensity:")) {
            assertNull(ControlProtocol.parseCueIntensity(raw), raw)
        }
    }

    @Test
    fun `eye height matches the page regex and the comfort range`() {
        assertEquals(1.7f, ControlProtocol.parseEyeHeight("settings:eyeheight:1.70")!!)
        for (raw in listOf(
            "settings:eyeheight:01.7",
            "settings:eyeheight:1.",
            "settings:eyeheight:2.0",
            "settings:eyeheight:1.7m",
            "settings:eyeheight:1,7",
            "settings:eyeheight:1.7000"
        )) {
            assertNull(ControlProtocol.parseEyeHeight(raw), raw)
        }
    }

    @Test
    fun `the allowlist accepts what the tablet sends and rejects the rest`() {
        for (raw in listOf(
            "enter", "home", "allapps", "exit", "stop", "calibrate", "recalibrate", "preview", "status",
            "mode:float", "mode:posture",
            "scene:washroom", "scene:shore", "scene:lightwell",
            "float:level:0", "float:level:3", "float:profile:a", "float:profile:c",
            "float:breath:on", "float:breath:off",
            "anim:duration:4000", "anim:duration:20000",
            "posture:rise", "posture:lower", "posture:stop",
            "cue:on", "cue:off", "cue:intensity:0.5",
            "gaze:dwell:on", "gaze:dwell:off",
            "sus:open", "sus:close", "sus:next", "sus:prev", "sus:show:4", "sus:answer:2",
            "view:orient:0,12", "view:anim:recenter", "view:stop",
            "audio:on", "audio:off", "audio:toggle",
            "voice:play:v-enter-1", "voice:stop",
            "settings:skipcalibration:on", "settings:hud:off",
            "settings:eyeheight:1.55", "console:about"
        )) {
            assertTrue(ControlProtocol.isAllowedCommand(raw), raw)
        }
        for (raw in listOf(
            "launch:the:missiles",
            "mode:swim",
            "scene:moon",
            "float:level:4",
            "float:profile:z",
            "anim:duration:3999",
            "cue:intensity:2",
            "sus:show:11",
            "sus:answer:01",
            "view:orient:0,91",
            "view:anim:loop",
            "settings:eyeheight:1.7000"
        )) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
        }
    }
}
