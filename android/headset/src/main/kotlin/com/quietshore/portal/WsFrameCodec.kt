package com.quietshore.portal

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64

/**
 * Minimal RFC 6455 server-side codec for the loopback control channel.
 *
 * Only what the page needs: text frames, ping/pong/close, no extensions, no
 * fragmentation, no continuation frames and no binary payloads. Client frames
 * must be masked (RFC 6455 §5.1); server frames are never masked.
 *
 * Pure JVM (no Android types) so it is covered by the local harness.
 */
internal object WsFrameCodec {

    const val OP_CONTINUATION = 0x0
    const val OP_TEXT = 0x1
    const val OP_BINARY = 0x2
    const val OP_CLOSE = 0x8
    const val OP_PING = 0x9
    const val OP_PONG = 0xA

    const val CLOSE_NORMAL = 1000
    const val CLOSE_GOING_AWAY = 1001
    const val CLOSE_PROTOCOL = 1002
    const val CLOSE_UNSUPPORTED = 1003
    const val CLOSE_TOO_BIG = 1009

    private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    /** `Sec-WebSocket-Accept` for the client's `Sec-WebSocket-Key`. */
    fun acceptKey(clientKey: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
            .digest((clientKey.trim() + GUID).toByteArray(StandardCharsets.US_ASCII))
        return Base64.getEncoder().encodeToString(digest)
    }

    /** Complete `101 Switching Protocols` response for [clientKey]. */
    fun handshakeResponse(clientKey: String): ByteArray =
        ("HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " + acceptKey(clientKey) + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "\r\n").toByteArray(StandardCharsets.US_ASCII)

    /** Builds an unmasked server frame. */
    fun encode(opcode: Int, payload: ByteArray): ByteArray {
        val length = payload.size
        val header = when {
            length < 126 -> 2
            length <= 0xFFFF -> 4
            else -> 10
        }
        val frame = ByteArray(header + length)
        frame[0] = (0x80 or (opcode and 0x0F)).toByte()
        when (header) {
            2 -> frame[1] = length.toByte()
            4 -> {
                frame[1] = 126.toByte()
                frame[2] = (length shr 8).toByte()
                frame[3] = length.toByte()
            }
            else -> {
                frame[1] = 127.toByte()
                val value = length.toLong()
                for (index in 0 until 8) {
                    frame[2 + index] = (value shr (8 * (7 - index))).toByte()
                }
            }
        }
        System.arraycopy(payload, 0, frame, header, length)
        return frame
    }

    fun closePayload(code: Int): ByteArray =
        byteArrayOf((code shr 8).toByte(), code.toByte())

    /**
     * Reads exactly one frame from [input]; returns null on a clean EOF before
     * a frame starts. Fragmented, unmasked, binary or oversized input raises
     * [WsProtocolException], which carries the close code to send back.
     */
    fun read(input: InputStream, maxPayload: Int): Frame? {
        val first = input.read()
        if (first < 0) {
            return null
        }
        val second = input.read()
        if (second < 0) {
            throw EOFException("truncated websocket frame")
        }
        if (first and 0x70 != 0) {
            throw WsProtocolException(CLOSE_PROTOCOL, "reserved bits set")
        }
        val fin = first and 0x80 != 0
        val opcode = first and 0x0F
        val masked = second and 0x80 != 0
        var length = (second and 0x7F).toLong()
        when (length) {
            126L -> length = readLength(input, 2)
            127L -> length = readLength(input, 8)
        }
        val control = opcode >= 0x8
        if (!fin) {
            throw WsProtocolException(CLOSE_UNSUPPORTED, "fragmentation unsupported")
        }
        if (control && length > 125L) {
            throw WsProtocolException(CLOSE_PROTOCOL, "control frame too large")
        }
        if (length > maxPayload) {
            throw WsProtocolException(CLOSE_TOO_BIG, "frame too large")
        }
        if (!masked) {
            throw WsProtocolException(CLOSE_PROTOCOL, "client frames must be masked")
        }
        val mask = readExactly(input, 4)
        val payload = readExactly(input, length.toInt())
        for (index in payload.indices) {
            payload[index] = (payload[index].toInt() xor mask[index and 3].toInt()).toByte()
        }
        return Frame(opcode, payload)
    }

    private fun readLength(input: InputStream, bytes: Int): Long {
        val raw = readExactly(input, bytes)
        var value = 0L
        for (byte in raw) {
            value = (value shl 8) or (byte.toLong() and 0xFF)
        }
        if (value < 0) {
            throw WsProtocolException(CLOSE_TOO_BIG, "invalid frame length")
        }
        return value
    }

    private fun readExactly(input: InputStream, count: Int): ByteArray {
        val buffer = ByteArray(count)
        var offset = 0
        while (offset < count) {
            val read = input.read(buffer, offset, count - offset)
            if (read < 0) {
                throw IOException("truncated websocket frame")
            }
            offset += read
        }
        return buffer
    }

    class Frame(val opcode: Int, val payload: ByteArray)

    class WsProtocolException(val code: Int, message: String) : RuntimeException(message)
}
