package com.quietshore.portal

import com.quietshore.control.ble.CommandQueue
import com.quietshore.control.protocol.ControlProtocol
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64

/**
 * Local JVM harness for the transport-independent half of the control channel:
 * ack-based retention ([ControlLog]), outbound coalescing ([CoalescingQueue])
 * and the RFC 6455 codec ([WsFrameCodec]).
 *
 * It is not wired into Gradle on purpose: the Android module has no test
 * framework dependency and adding one is out of scope. Run it with the JDK and
 * the Kotlin compiler that ships in the Gradle cache:
 *
 * ```
 * KOTLINC_JARS=$(find ~/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin \
 *   ~/.gradle/caches/modules-2/files-2.1/org.jetbrains.intellij.deps -name '*.jar' | tr '\n' ':')
 * java -cp "$KOTLINC_JARS" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
 *   android/headset/src/main/kotlin/com/quietshore/portal/ControlLog.kt \
 *   android/headset/src/main/kotlin/com/quietshore/portal/WsFrameCodec.kt \
 *   android/control/src/main/kotlin/com/quietshore/control/ble/CommandQueue.kt \
 *   android/protocol/src/main/kotlin/com/quietshore/control/protocol/ControlProtocol.kt \
 *   android/headset/src/test/kotlin/com/quietshore/portal/ControlChannelCheck.kt \
 *   -d /tmp/control-check
 * java -cp "/tmp/control-check:$KOTLINC_JARS" com.quietshore.portal.ControlChannelCheckKt
 * ```
 */
private var failures = 0

private fun check(name: String, condition: Boolean) {
    if (!condition) {
        failures++
        println("FAIL $name")
    }
}

private fun checkEquals(name: String, expected: Any?, actual: Any?) {
    if (expected != actual) {
        failures++
        println("FAIL $name: expected <$expected> got <$actual>")
    }
}

private fun retentionChecks() {
    val log = ControlLog()
    log.record(1, "scene:ward")
    log.record(2, "view:anim:up")
    checkEquals("anim is not retained", 1, log.pendingSize)
    checkEquals("anim is not continuous", null, log.latestContinuous())

    var seq = 2
    repeat(1000) {
        seq++
        log.record(seq, "view:orient:0,30")
    }
    checkEquals(
        "a move flood cannot evict a discrete command",
        listOf("scene:ward"),
        log.pendingSince(-1).map { it.command }
    )
    checkEquals("only the latest sample is kept", 1002, log.latestContinuous()?.seq)

    seq++
    log.record(seq, "posture:sit")
    checkEquals(
        "later discrete command joins the pending list",
        listOf("scene:ward", "posture:sit"),
        log.pendingSince(-1).map { it.command }
    )
    checkEquals(
        "since filters older commands",
        listOf("posture:sit"),
        log.pendingSince(1002).map { it.command }
    )

    log.ack(1003)
    checkEquals("ack prunes everything below the watermark", 0, log.pendingSize)
    checkEquals("continuous is ack-free", 1002, log.latestContinuous()?.seq)

    val bounded = ControlLog(depth = 4)
    for (index in 1..10) {
        bounded.record(index, "cue:intensity:0.$index")
    }
    checkEquals("retention is bounded", 4, bounded.pendingSize)
    checkEquals("bound drops the oldest", listOf(7, 8, 9, 10), bounded.pendingSince(-1).map { it.seq })

    val outOfOrder = ControlLog()
    outOfOrder.record(5, "scene:ward")
    outOfOrder.record(3, "scene:garden")
    checkEquals(
        "gap fill is ordered by seq",
        listOf(3, 5),
        outOfOrder.pendingSince(-1).map { it.seq }
    )
    check(outOfOrder.record(9, "view:orient:0,60") == ControlKind.CONTINUOUS)
    check(outOfOrder.record(10, "view:stop") == ControlKind.DISCRETE)
}

private fun queueChecks() {
    val queue = CoalescingQueue<String>(4)
    repeat(50) {
        queue.offer(FrameKind.CONTINUOUS, "move$it")
    }
    checkEquals("continuous frames coalesce to one", 1, queue.size)
    checkEquals("coalescing keeps the newest sample", "move49", queue.pollFirst())
    checkEquals("queue is empty", true, queue.isEmpty)

    val ordered = CoalescingQueue<String>(4)
    ordered.offer(FrameKind.DISCRETE, "scene")
    ordered.offer(FrameKind.CONTINUOUS, "move1")
    ordered.offer(FrameKind.CONTINUOUS, "move2")
    checkEquals(
        "discrete frames keep their position",
        listOf(FrameKind.DISCRETE, FrameKind.CONTINUOUS),
        ordered.kinds()
    )
    checkEquals("discrete frame is delivered first", "scene", ordered.pollFirst())
    checkEquals("latest sample follows", "move2", ordered.pollFirst())

    val full = CoalescingQueue<String>(3)
    full.offer(FrameKind.DISCRETE, "d1")
    full.offer(FrameKind.CONTINUOUS, "c1")
    full.offer(FrameKind.STATE, "s1")
    full.offer(FrameKind.DISCRETE, "d2")
    checkEquals(
        "a full queue evicts continuous before discrete",
        listOf(FrameKind.DISCRETE, FrameKind.STATE, FrameKind.DISCRETE),
        full.kinds()
    )
    full.offer(FrameKind.DISCRETE, "d3")
    checkEquals(
        "state goes next, discrete stays",
        listOf(FrameKind.DISCRETE, FrameKind.DISCRETE, FrameKind.DISCRETE),
        full.kinds()
    )
    val delivered = ArrayList<String>()
    while (full.isNotEmpty) {
        full.pollFirst()?.let { delivered.add(it) }
    }
    checkEquals("every discrete frame survives", listOf("d1", "d2", "d3"), delivered)
}

private fun clientFrame(
    opcode: Int,
    payload: ByteArray,
    fin: Boolean = true,
    masked: Boolean = true
): ByteArray {
    val out = ByteArrayOutputStream()
    out.write((if (fin) 0x80 else 0x00) or (opcode and 0x0F))
    val length = payload.size
    val maskBit = if (masked) 0x80 else 0x00
    when {
        length < 126 -> out.write(maskBit or length)
        length <= 0xFFFF -> {
            out.write(maskBit or 126)
            out.write(length shr 8)
            out.write(length and 0xFF)
        }
        else -> {
            out.write(maskBit or 127)
            for (shift in 7 downTo 0) {
                out.write(((length.toLong() shr (8 * shift)) and 0xFF).toInt())
            }
        }
    }
    if (masked) {
        val mask = byteArrayOf(0x37, 0xFA.toByte(), 0x21, 0x3D)
        out.write(mask)
        for (index in payload.indices) {
            out.write(payload[index].toInt() xor mask[index and 3].toInt())
        }
    } else {
        out.write(payload)
    }
    return out.toByteArray()
}

private fun expectClose(name: String, bytes: ByteArray, code: Int) {
    try {
        WsFrameCodec.read(ByteArrayInputStream(bytes), 8192)
        failures++
        println("FAIL $name: frame was accepted")
    } catch (error: WsFrameCodec.WsProtocolException) {
        checkEquals(name, code, error.code)
    }
}

private fun codecChecks() {
    checkEquals(
        "RFC 6455 accept key",
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
        WsFrameCodec.acceptKey("dGhlIHNhbXBsZSBub25jZQ==")
    )

    val handshake = String(
        WsFrameCodec.handshakeResponse("dGhlIHNhbXBsZSBub25jZQ=="),
        StandardCharsets.US_ASCII
    )
    check("101 status line", handshake.startsWith("HTTP/1.1 101 Switching Protocols\r\n"))
    check("upgrade header", handshake.contains("Upgrade: websocket\r\n"))
    check("connection header", handshake.contains("Connection: Upgrade\r\n"))
    check(
        "accept header",
        handshake.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n")
    )
    check("header terminator", handshake.endsWith("\r\n\r\n"))

    val text = WsFrameCodec.encode(WsFrameCodec.OP_TEXT, "hello".toByteArray(StandardCharsets.UTF_8))
    checkEquals("small frame opcode/fin", 0x81, text[0].toInt() and 0xFF)
    checkEquals("small frame length", 5, text[1].toInt() and 0xFF)
    checkEquals("small frame payload", "hello", String(text, 2, 5, StandardCharsets.UTF_8))

    val medium = WsFrameCodec.encode(WsFrameCodec.OP_TEXT, ByteArray(200) { 0x61 })
    checkEquals("16-bit length marker", 126, medium[1].toInt() and 0xFF)
    checkEquals(
        "16-bit length value",
        200,
        ((medium[2].toInt() and 0xFF) shl 8) or (medium[3].toInt() and 0xFF)
    )

    val large = WsFrameCodec.encode(WsFrameCodec.OP_TEXT, ByteArray(70000))
    checkEquals("64-bit length marker", 127, large[1].toInt() and 0xFF)
    var length = 0L
    for (index in 0 until 8) {
        length = (length shl 8) or (large[2 + index].toLong() and 0xFF)
    }
    checkEquals("64-bit length value", 70000L, length)

    val ack = "{\"type\":\"ack\",\"seq\":7}"
    val decoded = WsFrameCodec.read(
        ByteArrayInputStream(clientFrame(WsFrameCodec.OP_TEXT, ack.toByteArray(StandardCharsets.UTF_8))),
        8192
    )
    checkEquals("text opcode", WsFrameCodec.OP_TEXT, decoded!!.opcode)
    checkEquals("masked payload decoded", ack, String(decoded.payload, StandardCharsets.UTF_8))

    val mediumClient = ByteArray(300) { 0x62 }
    val decodedMedium = WsFrameCodec.read(
        ByteArrayInputStream(clientFrame(WsFrameCodec.OP_TEXT, mediumClient)),
        8192
    )
    checkEquals("masked 16-bit frame decoded", 300, decodedMedium?.payload?.size)

    val ping = WsFrameCodec.read(
        ByteArrayInputStream(clientFrame(WsFrameCodec.OP_PING, byteArrayOf(1, 2, 3))),
        8192
    )
    checkEquals("ping opcode", WsFrameCodec.OP_PING, ping?.opcode)
    checkEquals("ping payload", "AQID", ping?.payload?.let { Base64.getEncoder().encodeToString(it) })

    expectClose(
        "fragmented frame rejected",
        clientFrame(WsFrameCodec.OP_TEXT, "x".toByteArray(), fin = false),
        WsFrameCodec.CLOSE_UNSUPPORTED
    )
    expectClose(
        "unmasked client frame rejected",
        clientFrame(WsFrameCodec.OP_TEXT, "x".toByteArray(), masked = false),
        WsFrameCodec.CLOSE_PROTOCOL
    )
    expectClose(
        "oversized frame rejected",
        clientFrame(WsFrameCodec.OP_TEXT, ByteArray(9000)),
        WsFrameCodec.CLOSE_TOO_BIG
    )
    checkEquals(
        "clean EOF returns null",
        null,
        WsFrameCodec.read(ByteArrayInputStream(ByteArray(0)), 8192)
    )
}

private fun protocolGrammarChecks() {
    checkEquals("hello payload", "HELLO 1", ControlProtocol.helloCommand())
    checkEquals("hello parses", 1, ControlProtocol.parseHello("HELLO 1"))
    checkEquals("hello is not a command", null, ControlProtocol.parseHello("scene:ward"))
    checkEquals("hello rejects junk", null, ControlProtocol.parseHello("HELLO x"))

    val welcome = ControlProtocol.parseWelcome("WELCOME 1 63")
    check(welcome != null)
    checkEquals("welcome version", ControlProtocol.protocolVersion, welcome.version)
    checkEquals("welcome capabilities", ControlProtocol.CAPABILITIES_MASK, welcome.capabilities)
    checkEquals("welcome rejects missing caps", null, ControlProtocol.parseWelcome("WELCOME 1"))

    val wire = ControlProtocol.sequencedCommandPayload(7, "scene:ward")
    checkEquals("sequenced payload", "#7 scene:ward", wire)
    checkEquals(
        "sequenced parse",
        ControlProtocol.SequencedCommand(7, "scene:ward"),
        ControlProtocol.parseSequencedCommand(wire)
    )
    checkEquals(
        "unsequenced is not accepted",
        null,
        ControlProtocol.parseSequencedCommand("scene:ward")
    )
    checkEquals(
        "seq must be positive",
        null,
        ControlProtocol.parseSequencedCommand("#0 scene:ward")
    )

    val ack = ControlProtocol.ackPayload(7, ControlProtocol.RESULT_OK)
    checkEquals("ack payload", "ACK 7 OK", ack)
    checkEquals("ack parse", ControlProtocol.Ack(7, "OK"), ControlProtocol.parseAck(ack))
    checkEquals("ack rejects unknown result", null, ControlProtocol.parseAck("ACK 7 MAYBE"))
    check(ControlProtocol.parseAck("ACK 7 REJECTED")?.result == ControlProtocol.RESULT_REJECTED)
    check(ControlProtocol.parseAck("ACK 7 BUSY")?.result == ControlProtocol.RESULT_BUSY)

    check("discrete needs an ack", ControlProtocol.requiresSequencedAck("scene:ward"))
    check("view:orient needs no ack", !ControlProtocol.requiresSequencedAck("view:orient:0,30"))
    check("ping needs no ack", !ControlProtocol.requiresSequencedAck(ControlProtocol.PING))
    check("hello needs no ack", !ControlProtocol.requiresSequencedAck(ControlProtocol.helloCommand()))

    checkEquals("view anim capability", ControlProtocol.CAP_VIEW_ANIM, ControlProtocol.capabilityFor("view:anim:up"))
    checkEquals(
        "eye height capability",
        ControlProtocol.CAP_EYE_HEIGHT,
        ControlProtocol.capabilityFor("settings:eyeheight:1.70")
    )
    checkEquals("sus capability", ControlProtocol.CAP_SUS, ControlProtocol.capabilityFor("sus:next"))
    checkEquals("always-available command", 0, ControlProtocol.capabilityFor("stop"))
    checkEquals(
        "capability names",
        listOf("scene", "cue"),
        ControlProtocol.capabilityNames(ControlProtocol.CAP_SCENE or ControlProtocol.CAP_CUE)
    )
}

private fun tabletQueueChecks() {
    val queue = CommandQueue()
    for (index in 0 until 100) {
        queue.enqueue("view:orient:0,${index / 100f}")
    }
    checkEquals("pitch flood keeps one sample", 1, queue.pendingMoves)
    checkEquals("newest orientation wins", "view:orient:0,0.99", queue.newestMove)
    queue.enqueue("scene:ward")
    queue.enqueue("view:stop")
    checkEquals("stop drops queued pitch", null, queue.newestMove)
    checkEquals("stop is written first", "view:stop", queue.poll())
    checkEquals("discrete follows", "scene:ward", queue.poll())
    checkEquals("stop discarded the queued pitch", null, queue.poll())
    check(queue.isEmpty)

    val preempt = CommandQueue()
    preempt.enqueue("scene:ward")
    preempt.enqueue("cue:on")
    preempt.enqueue("posture:stop")
    checkEquals("stop jumps the discrete FIFO", "posture:stop", preempt.poll())
    checkEquals("FIFO order preserved", "scene:ward", preempt.poll())
    checkEquals("FIFO order preserved", "cue:on", preempt.poll())

    val bounded = CommandQueue(4)
    for (index in 0 until 4) {
        check("capacity accepts within bound", bounded.enqueue("scene:$index"))
    }
    checkEquals("capacity refuses overflow", false, bounded.enqueue("scene:x"))
    checkEquals("overflow keeps every queued command", 4, bounded.pendingDiscrete)

    val cleared = CommandQueue()
    cleared.enqueue("view:orient:0,60")
    cleared.enqueue("scene:ward")
    cleared.clear()
    check(cleared.isEmpty)
    checkEquals("cleared queue writes nothing", null, cleared.poll())
}

fun main() {
    retentionChecks()
    queueChecks()
    codecChecks()
    protocolGrammarChecks()
    tabletQueueChecks()
    if (failures > 0) {
        throw AssertionError("$failures control-channel checks failed")
    }
    println("control channel checks passed")
}
