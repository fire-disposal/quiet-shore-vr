package com.quietshore.control.protocol

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * The headset's allowlist and the page's parser (`src/app/commands.ts`) must
 * accept exactly the same grammar. These cases mirror `tests/commands.test.ts`
 * one for one; when one side gains a rule, the other gains the same case.
 */
class CommandGrammarTest {

    private fun sharedFixture(): JSONObject {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        repeat(6) {
            val current = dir ?: error("repository root not found")
            val candidate = File(current, "tests/fixtures/command-grammar.json")
            if (candidate.isFile) {
                return JSONObject(candidate.readText())
            }
            dir = current.parentFile
        }
        error("tests/fixtures/command-grammar.json not found above ${System.getProperty("user.dir")}")
    }

    private fun JSONObject.commands(name: String): List<String> {
        val array = getJSONArray(name)
        return buildList {
            for (index in 0 until array.length()) {
                add(array.getString(index))
            }
        }
    }

    @Test
    fun `matches the shared page-headset contract fixture`() {
        val fixture = sharedFixture()
        for (raw in fixture.commands("sharedAccepted") + fixture.commands("headsetOnlyAccepted")) {
            assertTrue(ControlProtocol.isAllowedCommand(raw), raw)
        }
        for (raw in fixture.commands("sharedRejected") + fixture.commands("headsetRejectedOnly")) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
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

    @Test
    fun `the published capability list names commands the allowlist accepts`() {
        val concrete = mapOf(
            "scene:<id>" to "scene:ward",
            "app:training|questionnaire" to "app:questionnaire",
            "gaze:dwell:on|off" to "gaze:dwell:on",
            "float:level:0-100" to "float:level:60"
        )
        for (entry in ControlProtocol.CAPABILITIES) {
            val sample = concrete[entry] ?: entry
            if (sample.contains('<') || sample.contains('|') || sample.contains('-') ||
                sample.endsWith(":0-100")
            ) {
                continue
            }
            assertTrue(ControlProtocol.isAllowedCommand(sample), entry)
        }
    }

    @Test
    fun `the allowlist accepts what the tablet sends and rejects the rest`() {
        for (raw in listOf(
            "enter", "exit", "stop", "calibrate",
            "audio:on", "audio:off", "audio:toggle",
            "float:level:0", "float:level:4", "float:level:60", "float:level:100",
            "float:breath:on", "float:breath:off",
            "scene:washroom", "scene:shore", "scene:ward", "scene:prep",
            "anim:duration:4000", "anim:duration:10000", "anim:duration:20000",
            "posture:rise", "posture:lower", "posture:stop",
            "posture:mix:0", "posture:mix:37", "posture:mix:100",
            "gaze:dwell:on", "gaze:dwell:off",
            "sus:open", "sus:close", "sus:show:4", "sus:answer:2", "sus:voice:off",
            "view:anim:up", "view:anim:recenter", "view:stop",
            "voice:play:v-enter-1", "voice:stop", "voice:volume:80", "voice:subtitle:on",
            "voice:set:female",
            "record:outcome:attempt:yes", "record:outcome:attempt:no",
            "record:outcome:success:yes", "record:outcome:success:no",
            "audio:volume:0", "audio:volume:100",
            "app:training", "app:questionnaire"
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
            "float:level:101",
            "float:level:-1",
            "float:breath:1",
            "float:profile:b",
            "mode:float",
            "view:orient:0,12",
            "view:anim:loop",
            "view:anim:breathe",
            "anim:duration:3999",
            "anim:duration:20001",
            "posture:mix:101",
            "posture:mix:-1",
            "posture:mix:1.5",
            "posture:mix:",
            "settings:eyeheight:1.70",
            "settings:hud:on",
            "sus:next",
            "sus:answer:01",
            "record:outcome:attempt:maybe",
            "record:outcome:mood:yes",
            "record:outcome:",
            "program:1:shore,360,start,3",
            "program:next",
            "audio:volume:101",
            "audio:volume:-1",
            "audio:volume:",
            "app:moon",
            "app:",
        )) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
        }
    }
}
