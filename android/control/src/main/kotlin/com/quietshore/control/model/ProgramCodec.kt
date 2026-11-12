package com.quietshore.control.model

/**
 * The exact program wire form. The page's parser in `src/app/program.ts` and
 * this one must accept the same strings; the command is one BLE write.
 */
object ProgramCodec {
    val VOICES: List<String> = listOf("none", "start", "imagine", "relax", "close")
    const val PREFIX = "program:"

    fun format(program: ProgramState): String {
        val body = program.segments.joinToString(";") {
            "${it.scene},${it.seconds},${it.voice},${it.cap}"
        }
        return "$PREFIX${if (program.auto) 1 else 0}:$body"
    }

    /** Parses a plan (not the `next` / `auto:` verbs); null for a bad payload. */
    fun parse(raw: String): ProgramState? {
        if (!raw.startsWith(PREFIX)) {
            return null
        }
        val rest = raw.removePrefix(PREFIX)
        val colon = rest.indexOf(':')
        if (colon <= 0) {
            return null
        }
        val auto = when (rest.substring(0, colon)) {
            "1" -> true
            "0" -> false
            else -> return null
        }
        val parts = rest.substring(colon + 1).split(';')
        if (parts.size !in 1..8) {
            return null
        }
        val segments = parts.map { part ->
            val fields = part.split(',')
            if (fields.size != 4) {
                return null
            }
            val scene = fields[0]
            if (!Regex("^[a-z][a-z0-9-]*$").matches(scene)) {
                return null
            }
            val seconds = fields[1].toIntOrNull()?.takeIf { it in 0..3600 } ?: return null
            val voice = fields[2].takeIf { it in VOICES } ?: return null
            val cap = fields[3].toIntOrNull()?.takeIf { it in 0..3 } ?: return null
            ProgramSegment(scene = scene, seconds = seconds, voice = voice, cap = cap)
        }
        return ProgramState(segments = segments, auto = auto)
    }
}
