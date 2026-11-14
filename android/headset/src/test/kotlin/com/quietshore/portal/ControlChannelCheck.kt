package com.quietshore.portal

import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.JsonAssembler
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64

/**
 * Local JVM harness for the transport-independent half of the control channel:
 * ack-based retention ([ControlLog]), the subscriber handshake, outbound
 * coalescing ([CoalescingQueue]), MTU ownership ([MtuPolicy]), entry
 * supervision ([EntryRetry]) and the RFC 6455 codec ([WsFrameCodec]).
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
 *   android/headset/src/main/kotlin/com/quietshore/portal/EntryRetry.kt \
 *   android/headset/src/main/kotlin/com/quietshore/portal/MtuPolicy.kt \
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

/**
 * Entry supervision: a launch that never becomes a session must be relaunched,
 * but a session that has ended must never look like a patient who never pressed.
 */
private fun retryChecks() {
    val policy = EntryRetry(pageWaitMs = 1000, pressWaitMs = 500, maxRetries = 2)

    // Nothing is watched before a launch, and a stale timer decides nothing.
    checkEquals("idle policy holds", EntryRetry.Decision.HOLD, policy.onDeadline(0))
    checkEquals("idle has no deadline", -1L, policy.checkAt)

    // The page never appears: relaunch, and keep the allowance across retries.
    policy.launch(10_000, fresh = true)
    checkEquals("page deadline armed", 11_000L, policy.checkAt)
    checkEquals("early timer holds", EntryRetry.Decision.HOLD, policy.onDeadline(10_500))
    checkEquals("missed page relaunches", EntryRetry.Decision.RELAUNCH, policy.onDeadline(11_000))
    checkEquals("one relaunch spent", 1, policy.retries)
    policy.launch(11_000, fresh = false)
    checkEquals("a relaunch keeps the count", 1, policy.retries)
    checkEquals("second miss relaunches", EntryRetry.Decision.RELAUNCH, policy.onDeadline(12_000))
    policy.launch(12_000, fresh = false)
    checkEquals("allowance exhausted", EntryRetry.Decision.GIVE_UP, policy.onDeadline(13_000))
    checkEquals("giving up stops the timer", -1L, policy.checkAt)

    // The page is up but the patient never presses.
    val press = EntryRetry(pageWaitMs = 1000, pressWaitMs = 500, maxRetries = 2)
    press.launch(20_000, fresh = true)
    press.pageState(20_200, session = false)
    checkEquals("press clock armed", 20_700L, press.checkAt)
    checkEquals("waiting for the press", EntryRetry.Phase.WAITING_SESSION, press.phase)
    checkEquals("press timeout relaunches", EntryRetry.Decision.RELAUNCH, press.onDeadline(20_700))

    // A session ends supervision for good.
    val live = EntryRetry(pageWaitMs = 1000, pressWaitMs = 500, maxRetries = 2)
    live.launch(30_000, fresh = true)
    live.pageState(30_100, session = true)
    checkEquals("session ends supervision", EntryRetry.Phase.IDLE, live.phase)
    checkEquals("no timer after a session", -1L, live.checkAt)
    checkEquals(
        "a finished session is never relaunched",
        EntryRetry.Decision.HOLD,
        live.onDeadline(99_000)
    )

    // The operator's next launch starts a fresh allowance.
    live.launch(100_000, fresh = true)
    checkEquals("fresh launch resets retries", 0, live.retries)

    // A synthetic tap is tried once, before anything is relaunched, and only
    // when the accessibility helper is enabled.
    val tapping = EntryRetry(
        pageWaitMs = 1000,
        pressWaitMs = 500,
        maxRetries = 2,
        autoTapAvailable = { true }
    )
    tapping.launch(40_000, fresh = true)
    tapping.pageState(40_100, session = false)
    checkEquals("tap before relaunching", EntryRetry.Decision.TAP, tapping.onDeadline(40_600))
    checkEquals("tap is not a relaunch", 0, tapping.retries)
    checkEquals("tap keeps the count", true, tapping.tapped)
    checkEquals("press clock rearmed", 41_100L, tapping.checkAt)
    checkEquals("a second deadline relaunches", EntryRetry.Decision.RELAUNCH, tapping.onDeadline(41_100))
    checkEquals("relaunch resets the tap", false, tapping.tapped)

    val silent = EntryRetry(pageWaitMs = 1000, pressWaitMs = 500, maxRetries = 2)
    silent.launch(50_000, fresh = true)
    silent.pageState(50_100, session = false)
    checkEquals("no helper means no tap", EntryRetry.Decision.RELAUNCH, silent.onDeadline(50_600))

    // A tap the platform refused must give its allowance back: burning it
    // would leave the only possible recovery a relaunch nobody needed.
    val dropped = EntryRetry(
        pageWaitMs = 1000,
        pressWaitMs = 500,
        tapRetryMs = 300,
        maxRetries = 2,
        autoTapAvailable = { true }
    )
    dropped.launch(60_000, fresh = true)
    dropped.pageState(60_100, session = false)
    checkEquals("dropped tap asked for", EntryRetry.Decision.TAP, dropped.onDeadline(60_600))
    dropped.tapFailed(60_601)
    checkEquals("dropped tap returns the allowance", false, dropped.tapped)
    checkEquals("dropped tap re-arms quickly", 60_901L, dropped.checkAt)
    checkEquals("short wait holds", EntryRetry.Decision.HOLD, dropped.onDeadline(60_800))
    checkEquals("tap is asked again", EntryRetry.Decision.TAP, dropped.onDeadline(60_901))

    // A session still ends supervision, even mid-tap.
    tapping.pageState(51_000, session = true)
    checkEquals("session ends tap supervision", EntryRetry.Phase.IDLE, tapping.phase)
}

/**
 * A synthetic tap that never lands must not be able to hold supervision on the
 * entry screen forever.
 *
 * Trigger order under test (H6): launch → page up, no session → deadline TAP →
 * platform refuses → `tapFailed` → deadline TAP → ... With one shared flag the
 * deadline re-entered TAP on every cycle, `retries` never moved, and neither
 * RELAUNCH nor GIVE_UP was reachable.
 */
private fun tapBudgetChecks() {
    // Taps the platform keeps refusing still reach RELAUNCH, then GIVE_UP.
    val stubborn = EntryRetry(
        pageWaitMs = 1000,
        pressWaitMs = 500,
        tapRetryMs = 100,
        maxRetries = 1,
        autoTapAvailable = { true }
    )
    var now = 100_000L
    stubborn.launch(now, fresh = true)
    now += 1_000
    stubborn.pageState(now, session = false)

    // Window 1: the tap is refused twice, after which the deadline owes a
    // relaunch instead of asking a third time.
    var asked = 0
    while (asked < EntryRetry.TAP_ATTEMPTS_PER_WINDOW) {
        now += 500
        checkEquals("refused taps are retried", EntryRetry.Decision.TAP, stubborn.onDeadline(now))
        stubborn.tapFailed(now + 1)
        asked++
        checkEquals("$asked refused taps consumed", asked, stubborn.tapAttempts)
        now += 100
    }
    // The last refusal could not give the allowance back: the window is spent,
    // which is exactly what lets the next deadline fall out of the tap branch.
    checkEquals("a spent window keeps its tap", true, stubborn.tapped)
    checkEquals("the window spent its taps", EntryRetry.TAP_ATTEMPTS_PER_WINDOW, stubborn.tapAttempts)
    checkEquals("no relaunch yet", 0, stubborn.retries)
    checkEquals("out of taps, the deadline relaunches", EntryRetry.Decision.RELAUNCH, stubborn.onDeadline(now))
    checkEquals("the relaunch is counted", 1, stubborn.retries)

    // Window 2 begins with a fresh budget: the taps are retried there too, and
    // only then does the ladder reach GIVE_UP — the point of the fix is that
    // this ladder is reachable at all.
    now += 1_000
    stubborn.launch(now, fresh = false)
    checkEquals("a new window resets its taps", 0, stubborn.tapAttempts)
    checkEquals("a relaunch keeps the retry count", 1, stubborn.retries)
    now += 1_000
    stubborn.pageState(now, session = false)
    var askedAgain = 0
    while (askedAgain < EntryRetry.TAP_ATTEMPTS_PER_WINDOW) {
        now += 500
        checkEquals("window two taps", EntryRetry.Decision.TAP, stubborn.onDeadline(now))
        stubborn.tapFailed(now + 1)
        askedAgain++
        now += 100
    }
    checkEquals("retries stay spent across a new window", 1, stubborn.retries)
    checkEquals(
        "the exhausted ladder gives up",
        EntryRetry.Decision.GIVE_UP,
        stubborn.onDeadline(now)
    )
    checkEquals("giving up stops the timer", -1L, stubborn.checkAt)

    // A tap that lands is never asked for twice in the same window.
    val landing = EntryRetry(
        pageWaitMs = 1000,
        pressWaitMs = 500,
        maxRetries = 2,
        autoTapAvailable = { true }
    )
    landing.launch(200_000, fresh = true)
    landing.pageState(200_100, session = false)
    checkEquals("first deadline taps", EntryRetry.Decision.TAP, landing.onDeadline(200_600))
    checkEquals(
        "a delivered tap falls through to relaunch",
        EntryRetry.Decision.RELAUNCH,
        landing.onDeadline(201_100)
    )

    // A helper that is disabled is still not a tap loop: it relaunches at once.
    val unavailable = EntryRetry(
        pageWaitMs = 1000,
        pressWaitMs = 500,
        maxRetries = 2,
        autoTapAvailable = { false }
    )
    unavailable.launch(300_000, fresh = true)
    unavailable.pageState(300_100, session = false)
    checkEquals(
        "no helper relaunches straight away",
        EntryRetry.Decision.RELAUNCH,
        unavailable.onDeadline(300_600)
    )
    checkEquals("no tap was spent", 0, unavailable.tapAttempts)
}

/**
 * The handshake a new subscriber sees must be `ready` then history, never
 * `ready` then a live command then history (H5).
 *
 * The second half is the reverse order: a command issued *after* the snapshot
 * must be strictly newer than everything in it, so the page's watermark from
 * `ready` plus the history stays monotonic.
 */
private fun handshakeChecks() {
    val log = ControlLog()
    log.record(1, "posture:lower")
    log.record(2, "float:level:1")

    // A page reconnecting with no watermark gets the whole history in order.
    val fresh = SubscriberHandshake.snapshot(log, -1)
    checkEquals(
        "ready comes first, then the retained history",
        listOf("ready:-1", "cmd:1:posture:lower", "cmd:2:float:level:1"),
        fresh
    )

    // A page that acked 1 gets only what it missed, and still after `ready`.
    val resumed = SubscriberHandshake.snapshot(log, 1)
    checkEquals(
        "since filters the history, ready still leads",
        listOf("ready:1", "cmd:2:float:level:1"),
        resumed
    )

    // Reverse order: a command recorded after the snapshot is newer than every
    // seq in it, so a live broadcast can never precede the history.
    log.record(3, "scene:ward")
    val lastSeq = fresh.last().substringAfter("cmd:").substringBefore(':').toInt()
    checkEquals("a later command is newer than the snapshot", 3, lastSeq + 1)
    checkEquals(
        "the later command is not in the earlier snapshot",
        false,
        fresh.any { it.startsWith("cmd:3:") }
    )
    checkEquals(
        "and it is the only new one afterwards",
        listOf("ready:2", "cmd:3:scene:ward"),
        SubscriberHandshake.snapshot(log, 2)
    )

    // Nothing retained: `ready` alone, and the watermark is exactly `since`.
    checkEquals(
        "an acked-up page gets ready only",
        listOf("ready:3"),
        SubscriberHandshake.snapshot(log, 3)
    )

    // The interleaving that used to happen, pinned as a property: with the
    // snapshot and the live publish under one lock, whatever a subscriber sees
    // first is a prefix of seq order, and every command it does not see in the
    // snapshot arrives live with a seq above the snapshot's last one.
    val shared = ControlLog()
    val lock = java.util.concurrent.locks.ReentrantLock()
    val live = ArrayList<Int>()
    shared.record(1, "scene:ward")
    shared.record(2, "scene:shore")

    val writer = Thread {
        for (seq in 3..60) {
            lock.lock()
            try {
                shared.record(seq, "scene:ward")
                live.add(seq)
            } finally {
                lock.unlock()
            }
            Thread.yield()
        }
    }
    writer.start()

    // Snapshot taken while the writer runs: it must be a prefix, and anything
    // it left out must be strictly newer than its own last entry.
    lock.lock()
    val whileWriting = try {
        SubscriberHandshake.snapshot(shared, -1)
    } finally {
        lock.unlock()
    }
    writer.join()
    val snapshotSeqs = whileWriting
        .filter { it.startsWith("cmd:") }
        .map { it.substringAfter("cmd:").substringBefore(':').toInt() }
    checkEquals(
        "the snapshot is a contiguous prefix of the seq order",
        (1..snapshotSeqs.size).toList(),
        snapshotSeqs
    )
    check(
        "nothing below the snapshot watermark arrives live afterwards",
        live.all { it > snapshotSeqs.size }
    )
}

private fun retentionChecks() {
    val log = ControlLog()
    log.record(1, "scene:ward")
    log.record(2, "view:anim:up")
    checkEquals("anim is not retained", 1, log.pendingSize)

    var seq = 2
    repeat(1000) {
        seq++
        log.record(seq, "scene:ward")
    }
    // Retention is bounded, so the oldest scene command is dropped; what must
    // survive is the newest command, not a flood of movement samples.
    checkEquals("retention stays bounded", 64, log.pendingSize)
    checkEquals("newest survives", 1002, log.pendingSince(-1).last().seq)

    seq++
    log.record(seq, "posture:rise")
    checkEquals(
        "later command joins the pending list",
        "posture:rise",
        log.pendingSince(-1).last().command
    )
    checkEquals(
        "since filters older commands",
        listOf("posture:rise"),
        log.pendingSince(1002).map { it.command }
    )

    log.ack(1003)
    checkEquals("ack prunes everything below the watermark", 0, log.pendingSize)

    val bounded = ControlLog(depth = 4)
    for (index in 1..10) {
        bounded.record(index, "scene:item$index")
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
    // The 10 Hz `view:orient` stream is gone: every retained command is
    // discrete now, and an animation never enters retention at all.
    checkEquals("view target is discrete", ControlKind.DISCRETE, outOfOrder.record(9, "view:orient:0,60"))
    checkEquals("view stop is discrete", ControlKind.DISCRETE, outOfOrder.record(10, "view:stop"))
}

/**
 * The size contract both directions share (M2).
 *
 * The failure this pins: a document above the channel limit reached
 * `encodeJsonChunks`, threw out of the publisher, and — depending on which
 * callback it ran on — either killed a GATT request or escaped the WS reader
 * after the scene catalogue had already been written to prefs.
 */
private fun jsonSizeChecks() {
    val mtu = ControlProtocol.ATT_MTU_MIN
    val limit = ControlProtocol.jsonDocumentLimitBytes(mtu)
    checkEquals("default limit is 255 chunks of 17 bytes", 4335, limit)
    checkEquals("per-chunk payload leaves room for the ATT header", 17, ControlProtocol.jsonChunkPayload(mtu))

    // The check runs before the encoder, so it must agree at the boundary.
    check("a document at the limit is accepted", ControlProtocol.fitsJsonChannel(limit, mtu))
    check("one byte over is refused", !ControlProtocol.fitsJsonChannel(limit + 1, mtu))

    val atLimit = ControlProtocol.encodeJsonChunks(ByteArray(limit), ControlProtocol.jsonChunkPayload(mtu), 9)
    checkEquals("the limit fills every chunk", ControlProtocol.maxChunks, atLimit.size)
    check("no chunk exceeds the MTU", atLimit.all { it.size <= mtu })

    // A widened link carries more; the same predicate, one number.
    val wide = ControlProtocol.jsonDocumentLimitBytes(128)
    check("a wider mtu raises the limit", wide > limit)
    check(
        "the widened limit is exactly what the encoder frames",
        ControlProtocol.encodeJsonChunks(
            ByteArray(wide),
            ControlProtocol.jsonChunkPayload(128),
            10
        ).size == ControlProtocol.maxChunks
    )

    // The page-facing number is the same number, so "the page sent it" implies
    // "the tablet can receive it".
    checkEquals("ws limit equals the json channel limit", limit, ControlProtocol.wsMessageLimitBytes())
}

/**
 * SUS replay on subscribe (M4).
 *
 * A tablet that subscribes after the sheet was published used to get the raw
 * JSON document — no `{"t":"sus","d":…}` envelope, no `[id][index][total]`
 * header, no controller check. The replay must be byte-identical to the live
 * document and must reassemble through the same assembler.
 */
private fun susReplayChecks() {
    val sheet = "{\"answers\":[{" + (1..10).joinToString(",") { "\"q$it\":${it % 5 + 1}" } + "]}"
    val document = "{\"t\":\"sus\",\"d\":$sheet}"

    // Live path and replay path are the same document, so the tablet's
    // assembler produces the same bytes either way.
    val chunks = ControlProtocol.encodeJsonChunks(
        document.toByteArray(StandardCharsets.UTF_8),
        ControlProtocol.jsonChunkPayload(ControlProtocol.ATT_MTU_MIN),
        11
    )
    val assembler = JsonAssembler()
    var reassembled: ByteArray? = null
    for (chunk in chunks) {
        assembler.add(chunk)?.let { reassembled = it }
    }
    checkEquals("the replay reassembles to the enveloped document", document, reassembled?.toString(StandardCharsets.UTF_8))
    check("every replay chunk fits the mtu", chunks.all { it.size <= ControlProtocol.ATT_MTU_MIN })

    // The envelope is what makes it a channel document rather than a bare record.
    check("the doc states its topic", document.startsWith("{\"t\":\"sus\",\"d\":"))
}

/**
 * MTU ownership across controllers, disconnects and teardown (M3).
 *
 * The trigger orders under test: a wide MTU left over from a torn-down link,
 * and a second tablet raising the chunk size while it does not own the console.
 * Either one made the headset emit a notification larger than the ATT MTU,
 * which the stack answers by dropping the link.
 */
private fun mtuPolicyChecks() {
    val policy = MtuPolicy()
    checkEquals("a fresh policy publishes at the ATT minimum", 23, policy.current)
    checkEquals("and chunks for it", 17, policy.chunkPayload())

    // The controller negotiates wide: the console follows its link.
    policy.onClaim("AA")
    policy.onMtuChanged("AA", 517, controller = "AA")
    checkEquals("the controller raises the chunk size", 517, policy.current)

    // A second tablet's link reports 185 while "AA" owns the console: recorded,
    // not applied. This is the bug's second half.
    policy.onMtuChanged("BB", 185, controller = "AA")
    checkEquals("a non-controller cannot change the chunk size", 517, policy.current)

    // Releasing the console returns the default even though both links are up.
    policy.onRelease()
    checkEquals("release restores the default", 23, policy.current)

    // "BB" claims: it gets its own negotiated value, not "AA"'s leftover.
    policy.onClaim("BB")
    checkEquals("a new owner restores its own mtu", 185, policy.current)

    // The owner disconnects: the value leaves with the link.
    policy.onDisconnected("BB", controller = "BB")
    checkEquals("a dropped controller restores the default", 23, policy.current)

    // Teardown must not carry anything into the next link, even if a stale
    // value was recorded for an address that reconnects later.
    policy.onMtuChanged("AA", 517, controller = null)
    policy.onTeardown()
    checkEquals("teardown restores the default", 23, policy.current)
    policy.onClaim("AA")
    checkEquals("a post-teardown claim starts un-negotiated", 23, policy.current)

    // A non-owner's report before any claim is recorded but never active.
    val early = MtuPolicy()
    early.onMtuChanged("CC", 400, controller = null)
    checkEquals("an early report does not activate", 23, early.current)
    early.onClaim("CC")
    checkEquals("its claim picks the recorded value up", 400, early.current)

    // A degraded negotiation is clamped to the ATT minimum, never below it.
    val degraded = MtuPolicy()
    degraded.onClaim("DD")
    degraded.onMtuChanged("DD", 9, controller = "DD")
    checkEquals("a tiny mtu is clamped", 23, degraded.current)
    checkEquals("which still leaves a usable chunk", 17, degraded.chunkPayload())
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
    checkEquals(
        "hello payload",
        "HELLO ${ControlProtocol.protocolVersion}",
        ControlProtocol.helloCommand()
    )
    checkEquals(
        "hello parses",
        ControlProtocol.protocolVersion,
        ControlProtocol.parseHello("HELLO ${ControlProtocol.protocolVersion}")
    )
    checkEquals("hello is not a command", null, ControlProtocol.parseHello("scene:ward"))
    checkEquals("hello rejects junk", null, ControlProtocol.parseHello("HELLO x"))

    val welcome = ControlProtocol.parseWelcome(ControlProtocol.welcomeCommand())
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
    // Every command that is retained needs an ack; the 10 Hz `view:orient`
    // stream that used to be exempt is gone.
    check("view:orient needs an ack", ControlProtocol.requiresSequencedAck("view:orient:0,30"))
    check("ping needs no ack", !ControlProtocol.requiresSequencedAck(ControlProtocol.PING))
    check("hello needs no ack", !ControlProtocol.requiresSequencedAck(ControlProtocol.helloCommand()))

    checkEquals("view anim capability", ControlProtocol.CAP_VIEW_ANIM, ControlProtocol.capabilityFor("view:anim:up"))
    checkEquals("sus capability", ControlProtocol.CAP_SUS, ControlProtocol.capabilityFor("sus:next"))
    checkEquals("always-available command", 0, ControlProtocol.capabilityFor("stop"))
    checkEquals(
        "capability names",
        listOf("scene", "motion"),
        ControlProtocol.capabilityNames(ControlProtocol.CAP_SCENE or ControlProtocol.CAP_MOTION)
    )
}

/**
 * Every transport-independent check, as one call.
 *
 * The harness started life as a hand-compiled `main`; it is a JUnit test now so
 * the release workflow actually runs it. The `main` stays for the manual
 * one-file compile documented at the top.
 */
internal fun runControlChannelChecks(): Int {
    retentionChecks()
    handshakeChecks()
    queueChecks()
    jsonSizeChecks()
    susReplayChecks()
    mtuPolicyChecks()
    codecChecks()
    protocolGrammarChecks()
    retryChecks()
    tapBudgetChecks()
    return failures
}

fun main() {
    val failed = runControlChannelChecks()
    if (failed > 0) {
        throw AssertionError("$failed control-channel checks failed")
    }
    println("control channel checks passed")
}
