package com.quietshore.control.data.telemetry

/**
 * The wire contract in its smallest possible form: JSON in, JSON out.
 *
 * `org.json` is an Android class; on a plain JVM it only exists as the stub the
 * unit-test runtime ships, which throws. The batch encoder and the response
 * parser are therefore hand-written over `StringBuilder`/`String` here, so the
 * request body and the ACK rule are testable without a device — and so a
 * malformed response is a typed failure ([TelemetryResponse.Failure]) instead of
 * an exception from a library whose behaviour differs between runtimes.
 *
 * The contract these two halves implement:
 *
 * ```
 * POST {version:1, deviceId:<uuid>, records:[{id,kind,occurredAt,data}]}
 *  <=  {version:1, acknowledged:[id...], accepted:n, duplicates:n, nextBatchSize:100}
 * ```
 */
object TelemetryProtocol {
    /** The endpoint. Fixed by contract; there is no setting and no discovery. */
    const val ENDPOINT: String = "https://205716.xyz/vrdata/"

    /** Payload version this client speaks. A response with another is refused. */
    const val VERSION: Int = 1

    /** How many records one request may carry. */
    const val MAX_BATCH: Int = 100

    /**
     * One request body.
     *
     * `data` is appended verbatim: [TelemetryRecord] already holds the record's
     * own JSON, and re-serialising it through a string escaper would turn a
     * worked-out document into a quoted string.
     *
     * An empty [records] is still a valid body and is never sent — the uploader
     * checks for an empty batch first.
     */
    fun encodeBatch(deviceId: String, records: List<TelemetryRecord>): String {
        val builder = StringBuilder(128 + records.size * 256)
        builder.append("{\"version\":").append(VERSION)
        builder.append(",\"deviceId\":")
        appendString(builder, deviceId)
        builder.append(",\"records\":[")
        records.forEachIndexed { index, record ->
            if (index > 0) {
                builder.append(',')
            }
            builder.append("{\"id\":")
            appendString(builder, record.id)
            builder.append(",\"kind\":")
            appendString(builder, record.kind)
            builder.append(",\"occurredAt\":")
            appendString(builder, record.occurredAt)
            builder.append(",\"data\":").append(record.data.toString())
            builder.append('}')
        }
        builder.append("]}")
        return builder.toString()
    }

    /**
     * One response body, already parsed into the facts the uploader needs.
     *
     * Only [Success] may remove anything from the outbox, and only for the ids
     * it names.
     */
    sealed interface TelemetryResponse {
        /** A well-formed, correctly versioned answer. */
        data class Success(
            /** Ids the server says it has stored (or already had). */
            val acknowledged: List<String>,
            /** How many of this batch were new to the server. */
            val accepted: Int,
            /** How many of this batch the server already had. */
            val duplicates: Int,
            /** The server's own batch ceiling for the next request. */
            val nextBatchSize: Int
        ) : TelemetryResponse

        /**
         * Anything else: bad JSON, a missing or foreign `version`, no
         * `acknowledged` array. Treated exactly like a network failure — the
         * batch stays queued.
         */
        data class Failure(val reason: String) : TelemetryResponse
    }

    /**
     * Parses one response body.
     *
     * Deliberately strict on the two fields the contract promises, lenient on
     * the counters: a missing `accepted` is not a reason to throw away a valid
     * acknowledgement, but a missing `acknowledged` is, because the alternative
     * is guessing which records left.
     */
    fun parseResponse(body: String?): TelemetryResponse {
        if (body.isNullOrBlank()) {
            return TelemetryResponse.Failure("empty body")
        }
        val root = try {
            MiniJson.parse(body)
        } catch (error: IllegalArgumentException) {
            return TelemetryResponse.Failure("bad json: ${error.message}")
        }
        val objectBody = root as? Map<*, *>
            ?: return TelemetryResponse.Failure("not an object")
        val version = (objectBody["version"] as? Double)?.toInt()
            ?: (objectBody["version"] as? Long)?.toInt()
        if (version != VERSION) {
            return TelemetryResponse.Failure("version ${version ?: "missing"} != $VERSION")
        }
        val acknowledged = objectBody["acknowledged"]
            ?: return TelemetryResponse.Failure("no acknowledged")
        val list = acknowledged as? List<*>
            ?: return TelemetryResponse.Failure("acknowledged is not an array")
        val ids = list.mapNotNull { (it as? String)?.takeIf(String::isNotEmpty) }
        val nextBatchSize = (objectBody["nextBatchSize"] as? Double)?.toInt()
            ?.coerceIn(1, MAX_BATCH) ?: MAX_BATCH
        return TelemetryResponse.Success(
            acknowledged = ids,
            accepted = (objectBody["accepted"] as? Double)?.toInt() ?: 0,
            duplicates = (objectBody["duplicates"] as? Double)?.toInt() ?: 0,
            nextBatchSize = nextBatchSize
        )
    }

    /** A JSON string literal; the only escaper the request builder needs. */
    private fun appendString(builder: StringBuilder, value: String) {
        builder.append('"')
        for (character in value) {
            when (character) {
                '"' -> builder.append("\\\"")
                '\\' -> builder.append("\\\\")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                '\b' -> builder.append("\\b")
                '\u000C' -> builder.append("\\f")
                else ->
                    if (character < ' ') {
                        builder.append("\\u")
                        builder.append(character.code.toString(16).padStart(4, '0'))
                    } else {
                        builder.append(character)
                    }
            }
        }
        builder.append('"')
    }
}

/**
 * The smallest JSON reader that can answer "what did the server say".
 *
 * Objects become [Map], arrays become [List], numbers become [Double]. It exists
 * because the response has to be parsed on a plain JVM where `org.json` is a
 * throwing stub, and because a parser is the only way to refuse a wrong
 * `version`.
 */
internal object MiniJson {

    fun parse(text: String): Any? {
        val reader = Reader(text)
        reader.skipWhitespace()
        val value = reader.readValue()
        reader.skipWhitespace()
        if (!reader.atEnd()) {
            throw IllegalArgumentException("trailing content at ${reader.position}")
        }
        return value
    }

    private class Reader(private val text: String) {
        private var index = 0

        val position: Int get() = index

        fun atEnd(): Boolean = index >= text.length

        fun skipWhitespace() {
            while (index < text.length && text[index].isWhitespace()) {
                index++
            }
        }

        fun readValue(): Any? {
            skipWhitespace()
            if (atEnd()) {
                throw IllegalArgumentException("unexpected end of input")
            }
            return when (val character = text[index]) {
                '{' -> readObject()
                '[' -> readArray()
                '"' -> readString()
                't' -> readLiteral("true", true)
                'f' -> readLiteral("false", false)
                'n' -> readLiteral("null", null)
                else -> if (character == '-' || character in '0'..'9') {
                    readNumber()
                } else {
                    throw IllegalArgumentException("unexpected '$character' at $index")
                }
            }
        }

        private fun readObject(): Map<String, Any?> {
            expect('{')
            val result = LinkedHashMap<String, Any?>()
            skipWhitespace()
            if (peek() == '}') {
                index++
                return result
            }
            while (true) {
                skipWhitespace()
                val key = readString()
                skipWhitespace()
                expect(':')
                result[key] = readValue()
                skipWhitespace()
                when (peek()) {
                    ',' -> index++
                    '}' -> {
                        index++
                        return result
                    }
                    else -> throw IllegalArgumentException("expected ',' or '}' at $index")
                }
            }
        }

        private fun readArray(): List<Any?> {
            expect('[')
            val result = ArrayList<Any?>()
            skipWhitespace()
            if (peek() == ']') {
                index++
                return result
            }
            while (true) {
                result.add(readValue())
                skipWhitespace()
                when (peek()) {
                    ',' -> index++
                    ']' -> {
                        index++
                        return result
                    }
                    else -> throw IllegalArgumentException("expected ',' or ']' at $index")
                }
            }
        }

        private fun readString(): String {
            expect('"')
            val builder = StringBuilder()
            while (true) {
                if (atEnd()) {
                    throw IllegalArgumentException("unterminated string")
                }
                when (val character = text[index++]) {
                    '"' -> return builder.toString()
                    '\\' -> {
                        if (atEnd()) {
                            throw IllegalArgumentException("unterminated escape")
                        }
                        when (val escape = text[index++]) {
                            '"' -> builder.append('"')
                            '\\' -> builder.append('\\')
                            '/' -> builder.append('/')
                            'b' -> builder.append('\b')
                            'f' -> builder.append('\u000C')
                            'n' -> builder.append('\n')
                            'r' -> builder.append('\r')
                            't' -> builder.append('\t')
                            'u' -> {
                                if (index + 4 > text.length) {
                                    throw IllegalArgumentException("truncated \\u escape")
                                }
                                val code = text.substring(index, index + 4).toIntOrNull(16)
                                    ?: throw IllegalArgumentException("bad \\u escape")
                                index += 4
                                builder.append(code.toChar())
                            }
                            else -> throw IllegalArgumentException("bad escape '\\$escape'")
                        }
                    }
                    else -> builder.append(character)
                }
            }
        }

        private fun readNumber(): Double {
            val start = index
            if (peek() == '-') {
                index++
            }
            while (!atEnd() && (text[index].isDigit() || text[index] in ".eE+-")) {
                index++
            }
            val slice = text.substring(start, index)
            return slice.toDoubleOrNull()
                ?: throw IllegalArgumentException("bad number '$slice'")
        }

        private fun readLiteral(literal: String, value: Any?): Any? {
            if (!text.startsWith(literal, index)) {
                throw IllegalArgumentException("expected '$literal' at $index")
            }
            index += literal.length
            return value
        }

        private fun peek(): Char {
            if (atEnd()) {
                throw IllegalArgumentException("unexpected end of input")
            }
            return text[index]
        }

        private fun expect(character: Char) {
            if (peek() != character) {
                throw IllegalArgumentException("expected '$character' at $index")
            }
            index++
        }
    }
}
