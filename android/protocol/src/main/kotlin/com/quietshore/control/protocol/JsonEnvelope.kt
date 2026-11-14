package com.quietshore.control.protocol

import org.json.JSONException
import org.json.JSONObject

/**
 * The JSON-channel envelope every relayed document rides in: `{t, d, id?}`.
 *
 * The headset sits between the page and the tablet and forwards records
 * verbatim, so the wrapper is the only place a document's identity is
 * expressed. Field order is part of the wire format — the tablet's record
 * stores and the tablet-side dedupe read `t` first — so a document is always
 * emitted as `t`, then `d`, then `id`.
 *
 * Two producers exist and both go through here:
 * - the page's own records, already serialised (questionnaire sheets), where
 *   re-serialising would rewrite every answer just to add three bytes;
 * - documents the headset itself synthesises from an already-typed payload
 *   (`catalog`, `session`, `questionnaire-result`, `questionnaire-state`, `log`).
 */
object JsonEnvelope {
    /** Envelope key holding the document type, e.g. `questionnaire-result`. */
    const val TYPE: String = "t"

    /** Envelope key holding the document body. */
    const val DATA: String = "d"

    /** Envelope key holding a durable record's id; absent on stateless types. */
    const val ID: String = "id"

    /**
     * The page's own spelling of [TYPE] on the WebSocket it owns.
     *
     * The page is the document's author and names its fields for itself; the
     * headset re-emits the same document in the compact envelope the tablet
     * reads. [parse] accepts both, so the reader has one entry point.
     */
    private const val PAGE_TYPE: String = "type"

    /** The page's own spelling of [DATA]; see [PAGE_TYPE]. */
    private const val PAGE_DATA: String = "data"

    /**
     * Wraps an already-serialised [body] without parsing it.
     *
     * [body] MUST be a complete JSON value (the page's own `JSON.stringify`
     * output). It is spliced into the envelope as-is: key order, number
     * formatting and any field the headset does not understand all survive,
     * which is the whole point of the seam.
     */
    fun document(type: String, body: String, id: String? = null): String {
        require(type.isNotBlank()) { "envelope type must not be blank" }
        require(body.isNotBlank()) { "envelope body must not be blank" }
        // Body last, so the concatenation cannot be confused about where the
        // envelope stops and the document starts.
        val head = "{\"$TYPE\":${quoted(type)},\"$DATA\":"
        return if (id.isNullOrEmpty()) {
            "$head$body}"
        } else {
            "$head$body,\"$ID\":${quoted(id)}}"
        }
    }

    /**
     * JSON string literal for [value], including the quotes.
     *
     * Only the envelope's own two strings go through here, and neither may
     * contain a control character: the type is a wire constant and the id is
     * the page's record key. `JSONObject.quote` is deliberately not used — it
     * is a static, and Android's unit-test stub throws from every one of those.
     */
    private fun quoted(value: String): String {
        if (value.none { it == '"' || it == '\\' || it < ' ' }) {
            return "\"$value\""
        }
        val out = StringBuilder(value.length + 8)
        out.append('"')
        for (character in value) {
            when (character) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else ->
                    if (character < ' ') {
                        out.append("\\u%04x".format(character.code))
                    } else {
                        out.append(character)
                    }
            }
        }
        out.append('"')
        return out.toString()
    }

    /** Wraps a typed [body]; the JSON encoder fixes the envelope's field order. */
    fun document(type: String, body: JSONObject, id: String? = null): String =
        JSONObject().apply {
            put(TYPE, type)
            put(DATA, body)
            if (!id.isNullOrEmpty()) {
                put(ID, id)
            }
        }.toString()

    /**
     * Parses a document produced by [document] or sent by the page.
     *
     * @throws IllegalArgumentException when [raw] is not JSON or carries no
     *   envelope type — one failure class for the channel reader to answer.
     */
    fun parse(raw: String): Envelope {
        val json = try {
            JSONObject(raw)
        } catch (error: JSONException) {
            throw IllegalArgumentException("not a json envelope: ${error.message}", error)
        }
        val type = json.optString(TYPE).ifEmpty { json.optString(PAGE_TYPE) }
        if (type.isEmpty()) {
            throw IllegalArgumentException("envelope has no $TYPE")
        }
        return Envelope(
            type = type,
            // The page's flat messages (`ack`, `notice`) carry their fields at
            // the top level. Falling back to the root object is what lets
            // `seq`, `text` and `tone` reach their handlers instead of being
            // swallowed as a null body.
            data = json.optJSONObject(DATA) ?: json.optJSONObject(PAGE_DATA) ?: json,
            id = json.optString(ID)
        )
    }

    /** One decoded envelope; [id] is empty when the message carried none. */
    data class Envelope(
        val type: String,
        val data: JSONObject?,
        val id: String
    )
}
