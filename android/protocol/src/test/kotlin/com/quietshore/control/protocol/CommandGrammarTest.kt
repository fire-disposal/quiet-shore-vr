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
    fun `question numbers span the grammar, not an instrument`() {
        assertEquals(1, ControlProtocol.parseQuestionnaireShow("questionnaire:show:1"))
        assertEquals(100, ControlProtocol.parseQuestionnaireShow("questionnaire:show:100"))
        assertNull(ControlProtocol.parseQuestionnaireShow("questionnaire:show:0"))
        assertNull(ControlProtocol.parseQuestionnaireShow("questionnaire:show:101"))
        assertNull(ControlProtocol.parseQuestionnaireShow("questionnaire:show:x"))
        assertNull(ControlProtocol.parseQuestionnaireShow("questionnaire:show:"))
    }

    @Test
    fun `answer values are one digit in 1 to 9`() {
        // Which of the nine the loaded instrument accepts is the page's rule,
        // so the grammar must carry all of them.
        for (value in 1..9) {
            assertEquals(value, ControlProtocol.parseQuestionnaireAnswer("questionnaire:answer:$value"))
        }
        assertNull(ControlProtocol.parseQuestionnaireAnswer("questionnaire:answer:0"))
        assertNull(ControlProtocol.parseQuestionnaireAnswer("questionnaire:answer:01"))
        assertNull(ControlProtocol.parseQuestionnaireAnswer("questionnaire:answer:10"))
        assertNull(ControlProtocol.parseQuestionnaireAnswer("questionnaire:answer:x"))
    }

    @Test
    fun `an instrument id is named, never free text`() {
        assertEquals("sus", ControlProtocol.parseQuestionnaireSelect("questionnaire:select:sus"))
        assertEquals(
            "nasa-tlx",
            ControlProtocol.parseQuestionnaireSelect("questionnaire:select:nasa-tlx")
        )
        assertNull(ControlProtocol.parseQuestionnaireSelect("questionnaire:select:"))
        assertNull(ControlProtocol.parseQuestionnaireSelect("questionnaire:select:SUS"))
        assertNull(ControlProtocol.parseQuestionnaireSelect("questionnaire:select:two words"))
        assertNull(ControlProtocol.parseQuestionnaireSelect("questionnaire:select:" + "a".repeat(33)))
    }

    @Test
    fun `the allowlist covers the switches the tablet actually sends`() {
        // Both of these were wired on the tablet but missing here, so the
        // headset rejected them and the switch did nothing at all.
        for (raw in listOf(
            "questionnaire:voice:on", "questionnaire:voice:off",
            "voice:subtitle:on", "voice:subtitle:off"
        )) {
            assertTrue(ControlProtocol.isAllowedCommand(raw), raw)
        }
        for (raw in listOf(
            "questionnaire:voice:maybe", "voice:subtitle:2",
            "questionnaire:voice:", "voice:subtitle"
        )) {
            assertFalse(ControlProtocol.isAllowedCommand(raw), raw)
        }
    }

    @Test
    fun `the published capability list names commands the allowlist accepts`() {
        val concrete = mapOf(
            "scene:<id>" to "scene:ward",
            "app:training|questionnaire" to "app:questionnaire",
            "questionnaire:select:<id>" to "questionnaire:select:sus",
            "gaze:dwell:on|off" to "gaze:dwell:on",
            "float:level:0-100" to "float:level:60"
        )
        for (entry in ControlProtocol.CAPABILITIES) {
            val sample = concrete[entry] ?: entry
            // Range shorthands ("1-100", "on|off") are not frames of their
            // own; every concrete entry must be something the allowlist takes.
            if (sample.contains('<') || sample.contains('|') || sample.endsWith(":0-100") ||
                Regex("""\d-\d""").containsMatchIn(sample)
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
            "questionnaire:select:sus", "questionnaire:select:pain-3",
            "questionnaire:open", "questionnaire:close", "questionnaire:replay",
            "questionnaire:show:1", "questionnaire:show:4", "questionnaire:show:100",
            "questionnaire:answer:1", "questionnaire:answer:2", "questionnaire:answer:9",
            "questionnaire:voice:off", "questionnaire:voice:on",
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
            "adapt:skip",
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
            "questionnaire:next",
            "questionnaire:answer:0",
            "questionnaire:answer:01",
            "questionnaire:answer:10",
            "questionnaire:show:0",
            "questionnaire:show:101",
            "questionnaire:select:",
            "questionnaire:select:SUS",
            "sus:open",
            "sus:show:3",
            "sus:answer:2",
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
