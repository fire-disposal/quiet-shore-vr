package com.quietshore.portal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.protocol.ViewAnim
import com.quietshore.control.protocol.ViewPreset
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

/**
 * 前台服务：把 APK 内置的 standalone 页面以只读静态 HTTP 暴露在
 * 127.0.0.1:8130（仅 loopback，不监听局域网）。
 *
 * 页面与控制台的唯一实时通道是 WebSocket：
 *   GET /ws?since=<seq>   RFC 6455，仅文本帧，JSON，单帧上限 8 KiB。
 *     服务端 -> 页面
 *       {"type":"ready","seq":N,"control":bool,"controller":string|null}
 *       {"type":"cmd","seq":N,"command":"...","continuous":bool}
 *       {"type":"control","control":bool,"controller":string|null}
 *     页面 -> 服务端
 *       {"type":"state","data":{scene,session,...,calibrating,audio,...}}
 *       {"type":"telemetry","data":{"x":n,"y":n,"z":n,"yaw":n,"pitch":n}}
 *       {"type":"ack","seq":N}
 *   连接建立先发 ready（`seq` 回显客户端的 since，可安全当作去重水位），
 *   再补 `seq > since` 的未确认命令（离散按序，连续只发最新一个样本）。
 *   离散命令在被 ack 之前一直保留；`view:orient` 不参与 ack，只保留最新样本；
 *   `view:anim:*` 是一次性事件，不入保留区，重连不重放。
 *   控制权变化（CLAIM/RELEASE/断开/停 BLE）立即推一条 control 消息。
 *   每 15 s ping 一次，30 s 没收到 pong 即关闭通道。
 *
 * 其余 HTTP 路由只用于诊断/静态资源：
 *   GET  /status       {bluetooth,control,controller,...,pendingSeq}
 *   GET  /bootstrap    页面启动数据
 *   GET  /capabilities 允许的命令列表
 *   POST /command      本地调试：投递一条白名单命令
 *   GET  /             静态页面
 *
 * 并发不变量：
 * - 每个连接一个受限线程；同时最多 [MAX_CLIENTS] 个连接，超出的直接 503 关闭。
 *   WebSocket 另受 [MAX_WS_CLIENTS] 限制，每个连接只有一个写线程。
 * - [wsLock] 只保护订阅者注册表与每人队列；[controlLock] 只保护命令保留区。
 *   锁序固定 wsLock -> controlLock（从不在持锁时反向获取），且绝不在持锁时做
 *   任何 socket I/O，所以 BLE 线程写命令不会被慢页面阻塞。
 * - 每页订阅者的出站队列有界：连续帧互相覆盖，离散帧不会被丢；队列满时先
 *   丢最旧的连续帧，再丢 ready/control 帧。
 * - 停服务时先推最后一帧控制权失效，再关闭订阅 socket、唤醒写线程并
 *   shutdown 线程池，不留驻留线程。
 */
class PortalService : Service() {
    internal companion object {
        /** 本地服务端口；PortalActions 在拉起浏览器前用它探测就绪。 */
        const val PORT = 8130
        const val TAG = "QuietShorePortal"
        const val CHANNEL_ID = "quietshore.entry"
        const val CHANNEL_NAME = "静岸"
        const val THREAD_NAME = "quietshore-http"
        const val HOST = "127.0.0.1"
        const val ASSET_NAME = "index.html"
        const val NOTIFICATION_ID = 1
        const val REQUEST_TIMEOUT_MS = 5000
        const val BACKLOG = 8
        const val COPY_BUFFER = 8192
        const val MAX_HEADER_BYTES = 8192
        const val MAX_LINE_BYTES = 4096
        const val MAX_BODY_BYTES = 64 * 1024

        /** 同时处理的连接上限；多出的连接直接 503 关闭，避免无界线程。 */
        const val MAX_CLIENTS = 8

        /** 同时存在的控制通道上限；每个通道占用一个读线程和一个写线程。 */
        const val MAX_WS_CLIENTS = 3

        /** 页面只能来自本机静态服务；别的 Origin 一律拒绝。 */
        const val ORIGIN_PREFIX = "http://127.0.0.1:8130"

        /** 单帧上限（文本 JSON）；更大的输入视为坏客户端。 */
        const val WS_MAX_MESSAGE_BYTES = 8 * 1024

        /**
         * 每人出站队列上限。离散帧绝不丢，连续帧先互相覆盖再谈淘汰；
         * 深度大于 [ControlLog.PENDING_DEPTH]，整段保留区总能装下。
         */
        const val WS_QUEUE_DEPTH = 96

        const val WS_PING_MS = 15_000L

        /** 超过这个时间没收到 pong 就关闭连接（两次 ping 的宽限）。 */
        const val WS_PONG_TIMEOUT_MS = 30_000L

        /** 没有 `since` 参数时的水位：补发全部未确认命令。 */
        const val SINCE_DEFAULT = -1

        /** 空闲工作线程回收时间；核心线程同样超时，停服务后不会残留。 */
        const val CLIENT_KEEPALIVE_S = 10L

        val EMPTY_PAYLOAD = ByteArray(0)

        val FALLBACK_PAGE: ByteArray =
            "<h1>Quiet Shore VR is starting</h1>".toByteArray(StandardCharsets.UTF_8)
        val NOT_FOUND: ByteArray = "not found".toByteArray(StandardCharsets.UTF_8)

        const val CONTENT_TYPE_HTML = "text/html; charset=utf-8"
        const val CONTENT_TYPE_JSON = "application/json; charset=utf-8"
        const val CONTENT_TYPE_TEXT = "text/plain; charset=utf-8"

        /** Page command replayed once whenever the console loses its lease. */
        const val POSTURE_STOP = "posture:stop"

        const val ROUTE_WS = "/ws"
        const val ROUTE_COMMAND = "/command"
        const val ROUTE_CAPABILITIES = "/capabilities"
        const val ROUTE_STATUS = "/status"
        const val ROUTE_BOOTSTRAP = "/bootstrap"
        const val ROUTE_INDEX = "/"
        const val ROUTE_INDEX_FILE = "/index.html"
    }

    @Volatile
    private var running = false

    @Volatile
    private var page: ByteArray? = null

    @Volatile
    private var lastState: ControlState = ControlState()

    @Volatile
    private var serverSocket: ServerSocket? = null

    @Volatile
    private var serverThread: Thread? = null

    /** 有界并发执行器：线程数上限 = [MAX_CLIENTS]，空闲超时回收。 */
    @Volatile
    private var clients: ThreadPoolExecutor? = null

    private val clientSlots = AtomicInteger(0)
    private val workerSeq = AtomicInteger(0)

    /**
     * 页面命令保留区：[ControlLog] 自己不是线程安全的，所有读写都在此锁内。
     * 绝不在持锁时进入 [wsLock]（锁序永远是 wsLock -> controlLock）。
     */
    private val controlLock = Any()
    private val controlLog = ControlLog()
    private val controlSeq = AtomicInteger(0)

    /** 串行化 HeadsetSettings 的读-改-写，避免并发命令互相覆盖。 */
    private val settingsLock = Any()

    /** 保护 [wsSinks] 与每人的出站队列；绝不在此锁内做 socket I/O。 */
    private val wsLock = ReentrantLock()
    private val wsSinks = ArrayList<WsSink>(MAX_WS_CLIENTS)

    @Volatile
    private var controlMode = false

    @Volatile
    private var bluetooth: BluetoothControl? = null

    @Volatile
    private var notificationManager: NotificationManager? = null

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(NotificationManager::class.java)
        createChannel()
        bluetooth = BluetoothControl(
            this,
            object : BluetoothControl.Listener {
                override fun onCommand(command: String): Boolean = dispatchControl(command)

                override fun onControlMode(active: Boolean) {
                    val changed = controlMode != active
                    controlMode = active
                    // CLAIM/RELEASE/断开/停 BLE 都从这里进来：立即推一条
                    // control 消息，页面无需轮询就能停下虚拟视角移动。
                    if (changed) {
                        if (!active) {
                            // 租约丢失 = 一次停止事件：只入队一条 posture:stop
                            // （页面端幂等），不重复投递；视角俯仰目标按契约保持
                            // 最后值，不回正。
                            dispatchControl(POSTURE_STOP)
                        }
                        publishControlMessage()
                    }
                    publishStatus()
                }

                override fun onStateChanged(state: String) {
                    // Advertising and GATT changes arrive after start; keep the
                    // notification and any visible status row in sync.
                    publishStatus()
                }
            }
        )
        bluetooth?.start()
        startForeground(NOTIFICATION_ID, buildNotification())
        startServer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Re-read the APK asset on every start so a side-loaded update cannot
        // be served from the previous process's page buffer.
        page = readPage()
        // 被系统回收后再拉起：onCreate 已建过通知，这里只需保证 socket 在跑。
        startServer()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        val bluetooth = bluetooth
        bluetooth?.stop()
        this.bluetooth = null
        if (controlMode) {
            // stop() 已经回调过一次；但若 BLE 早先已停，这里补发租约失效，
            // 让页面立刻停止虚拟视角移动。
            controlMode = false
            publishControlMessage()
        }
        PortalStatus.update("stopped", false)
        try {
            sendBroadcast(Intent(PortalStatus.ACTION_STATUS).setPackage(packageName))
        } catch (ignored: RuntimeException) {
            // No receiver registered.
        }
        closeQuietly(serverSocket)
        serverSocket = null
        val thread = serverThread
        serverThread = null
        thread?.interrupt()
        // 先关闭所有控制通道并唤醒写线程，worker 的 finally 才会把线程还回去。
        closeWsSinks()
        val workers = clients
        clients = null
        workers?.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    @Synchronized
    private fun startServer() {
        if (serverThread != null) {
            return
        }
        running = true
        if (clients == null) {
            // core = max = MAX_CLIENTS：线程按需创建到上限，空闲 10 s 回收。
            // 队列仅吸收“槽位刚释放、线程尚未归位”的瞬时请求，因此不会排队放大延迟。
            clients = ThreadPoolExecutor(
                MAX_CLIENTS,
                MAX_CLIENTS,
                CLIENT_KEEPALIVE_S,
                TimeUnit.SECONDS,
                ArrayBlockingQueue<Runnable>(MAX_CLIENTS),
                { task ->
                    Thread(task, "$THREAD_NAME-${workerSeq.incrementAndGet()}").apply {
                        isDaemon = true
                    }
                }
            ).apply {
                allowCoreThreadTimeOut(true)
            }
        }
        val thread = Thread({ serveLoop() }, THREAD_NAME)
        thread.isDaemon = true
        serverThread = thread
        thread.start()
    }

    /**
     * 只做 accept 与限额判定，具体请求交给有界线程池；WebSocket 长连接因此
     * 不会阻塞静态页或 /status。
     */
    private fun serveLoop() {
        page = readPage()
        var socket: ServerSocket? = null
        try {
            socket = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(HOST, PORT), BACKLOG)
            }
            serverSocket = socket
            while (running) {
                val client = socket.accept()
                if (clientSlots.incrementAndGet() > MAX_CLIENTS) {
                    clientSlots.decrementAndGet()
                    rejectBusy(client)
                    continue
                }
                val executor = clients
                val accepted = if (executor == null) {
                    false
                } else {
                    try {
                        executor.execute { serve(client) }
                        true
                    } catch (error: RejectedExecutionException) {
                        false
                    }
                }
                if (!accepted) {
                    // 执行器已停或线程全忙：关闭该连接，绝不无界排队。
                    clientSlots.decrementAndGet()
                    rejectBusy(client)
                }
            }
        } catch (error: IOException) {
            // 端口被占用或服务正在关闭；通知仍然可用，用户可稍后重试。
            if (running) {
                Log.e(TAG, "loopback server stopped: ${error.message}")
            }
        } finally {
            closeQuietly(socket)
            if (serverSocket === socket) {
                serverSocket = null
            }
            // 端口被占等失败后允许下一次 onStartCommand 重新尝试绑定。
            if (serverThread === Thread.currentThread()) {
                serverThread = null
            }
        }
    }

    /** 超出并发上限：给出可读的 503 再断开，避免浏览器干等超时。 */
    private fun rejectBusy(client: Socket) {
        try {
            writeResponse(client, errorResponse(503, "server busy"), head = false)
        } catch (ignored: IOException) {
            // 客户端已断开。
        } finally {
            closeQuietly(client)
        }
    }

    private fun serve(client: Socket) {
        try {
            client.soTimeout = REQUEST_TIMEOUT_MS
            val input = BufferedInputStream(client.inputStream, COPY_BUFFER)
            val requestLine = readLine(input)
            if (requestLine == null) {
                writeResponse(client, errorResponse(400, "bad request"), head = false)
                return
            }
            val headers = readHeaders(input)
            val parts = requestLine.trim().split(' ', limit = 3)
            if (parts.size < 2) {
                writeResponse(client, errorResponse(400, "bad request line"), head = false)
                return
            }
            val method = parts[0].uppercase(Locale.US)
            val target = parts[1].substringBefore('?')
            // `since` is the page's ack watermark: only commands above it are
            // gap-filled on connect. Missing/invalid means "everything still
            // pending" (-1), so a fresh page repaints all retained commands.
            val since = parseSince(parts[1].substringAfter('?', ""))
            if (target == ROUTE_WS) {
                if (method == "GET") {
                    streamWebSocket(client, input, headers, since)
                } else {
                    writeResponse(
                        client,
                        methodNotAllowed("GET"),
                        head = method == "HEAD"
                    )
                }
                return
            }
            val head = method == "HEAD"
            writeResponse(client, route(method, target, headers, input), head)
        } catch (error: IOException) {
            // 客户端提前断开：忽略。
        } catch (error: HttpError) {
            try {
                writeResponse(client, errorResponse(error.status, error.message), head = false)
            } catch (ignored: IOException) {
                // 客户端已断开。
            }
        } finally {
            clientSlots.decrementAndGet()
            closeQuietly(client)
        }
    }

    // ---------------------------------------------------------------------
    // WebSocket control channel
    // ---------------------------------------------------------------------

    /**
     * RFC 6455 upgrade, then one reader (this worker thread) and one writer
     * thread per connection. The reader never writes anything but pong/close
     * replies; every command goes out through the writer's bounded queue.
     */
    private fun streamWebSocket(
        client: Socket,
        input: InputStream,
        headers: Map<String, String>,
        since: Int
    ) {
        val key = headers["sec-websocket-key"]?.trim()
        val upgrade = headers["upgrade"]?.lowercase(Locale.US)
        val version = headers["sec-websocket-version"]?.trim()
        if (key.isNullOrEmpty() || upgrade != "websocket" || version != "13") {
            writeResponse(client, errorResponse(400, "websocket upgrade required"), head = false)
            return
        }
        val origin = headers["origin"]
        if (origin != null && !origin.startsWith(ORIGIN_PREFIX)) {
            writeResponse(client, errorResponse(403, "origin not allowed"), head = false)
            return
        }
        val sink = WsSink(client, since)
        if (!registerWsSink(sink)) {
            writeResponse(client, errorResponse(503, "too many control channels"), head = false)
            return
        }
        val output: OutputStream = try {
            client.getOutputStream()
        } catch (error: IOException) {
            closeSink(sink)
            return
        }
        try {
            output.write(handshakeResponse(key))
            output.flush()
            // The request deadline must be gone or an idle stream dies in 5 s.
            client.soTimeout = 0
            Thread({ writerLoop(sink, output) }, "$THREAD_NAME-ws-${workerSeq.incrementAndGet()}").apply {
                isDaemon = true
                start()
            }
            sendGapFill(sink, since)
            readLoop(sink, input, output)
        } catch (error: IOException) {
            // Page closed or the service is stopping.
        } finally {
            closeSink(sink)
        }
    }

    private fun handshakeResponse(key: String): ByteArray = WsFrameCodec.handshakeResponse(key)

    /**
     * Registers the sink and queues `ready` as its very first frame, so no
     * broadcast can slip in front of the handshake message.
     */
    private fun registerWsSink(sink: WsSink): Boolean {
        wsLock.lock()
        try {
            if (!running || wsSinks.size >= MAX_WS_CLIENTS) {
                return false
            }
            sink.queue.offer(FrameKind.SNAPSHOT, textFrame(readyJson(sink.since)))
            wsSinks.add(sink)
            return true
        } finally {
            wsLock.unlock()
        }
    }

    private fun unregisterWsSink(sink: WsSink) {
        wsLock.lock()
        try {
            wsSinks.remove(sink)
        } finally {
            wsLock.unlock()
        }
    }

    /** Stops one subscriber: marks it closed, wakes the writer and drops the socket. */
    private fun closeSink(sink: WsSink) {
        unregisterWsSink(sink)
        markClosed(sink)
        closeQuietly(sink.socket)
    }

    private fun markClosed(sink: WsSink) {
        sink.lock.lock()
        try {
            sink.closed = true
            sink.queue.clear()
            sink.signal.signalAll()
        } finally {
            sink.lock.unlock()
        }
    }

    /** 停服务：关闭所有控制通道并唤醒写线程。 */
    private fun closeWsSinks() {
        val closing = ArrayList<WsSink>(MAX_WS_CLIENTS)
        wsLock.lock()
        try {
            closing.addAll(wsSinks)
            wsSinks.clear()
        } finally {
            wsLock.unlock()
        }
        for (sink in closing) {
            markClosed(sink)
            closeQuietly(sink.socket)
        }
    }

    private fun writerLoop(sink: WsSink, output: OutputStream) {
        var lastPingAt = System.currentTimeMillis()
        try {
            while (true) {
                val frame = nextFrame(sink, WS_PING_MS)
                if (sink.closed || !running) {
                    return
                }
                if (frame != null) {
                    writeFrame(sink, output, frame)
                }
                val now = System.currentTimeMillis()
                if (now - sink.lastPongAt > WS_PONG_TIMEOUT_MS) {
                    // Page stopped answering pings: the channel is dead, close
                    // it so the client stops trusting it for control.
                    closeWith(sink, output, WsFrameCodec.CLOSE_GOING_AWAY)
                    return
                }
                if (now - lastPingAt >= WS_PING_MS) {
                    writeFrame(sink, output, WsFrameCodec.encode(WsFrameCodec.OP_PING, EMPTY_PAYLOAD))
                    lastPingAt = now
                }
            }
        } catch (error: IOException) {
            // Page vanished.
        } finally {
            closeSink(sink)
        }
    }

    /** 取下一帧：有帧立即返回，空闲到点返回 null，关闭返回 null。 */
    private fun nextFrame(sink: WsSink, timeoutMs: Long): ByteArray? {
        sink.lock.lock()
        try {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (true) {
                if (sink.closed) {
                    return null
                }
                sink.queue.pollFirst()?.let { return it }
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0L) {
                    return null
                }
                try {
                    sink.signal.await(remaining, TimeUnit.MILLISECONDS)
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return null
                }
            }
        } finally {
            sink.lock.unlock()
        }
    }

    private fun readLoop(sink: WsSink, input: InputStream, output: OutputStream) {
        while (true) {
            val frame = try {
                WsFrameCodec.read(input, WS_MAX_MESSAGE_BYTES) ?: return
            } catch (error: WsFrameCodec.WsProtocolException) {
                closeWith(sink, output, error.code)
                return
            }
            when (frame.opcode) {
                WsFrameCodec.OP_TEXT ->
                    if (!handleClientText(sink, output, frame.payload)) {
                        return
                    }
                WsFrameCodec.OP_BINARY -> {
                    closeWith(sink, output, WsFrameCodec.CLOSE_UNSUPPORTED)
                    return
                }
                WsFrameCodec.OP_CLOSE -> {
                    closeWith(sink, output, WsFrameCodec.CLOSE_NORMAL)
                    return
                }
                WsFrameCodec.OP_PING ->
                    writeFrame(sink, output, WsFrameCodec.encode(WsFrameCodec.OP_PONG, frame.payload))
                WsFrameCodec.OP_PONG -> sink.lastPongAt = System.currentTimeMillis()
                else -> {
                    closeWith(sink, output, WsFrameCodec.CLOSE_PROTOCOL)
                    return
                }
            }
        }
    }

    /** Returns false when the connection must close. */
    private fun handleClientText(sink: WsSink, output: OutputStream, payload: ByteArray): Boolean {
        val json = try {
            JSONObject(String(payload, StandardCharsets.UTF_8))
        } catch (error: JSONException) {
            closeWith(sink, output, WsFrameCodec.CLOSE_UNSUPPORTED)
            return false
        }
        when (json.optString("type")) {
            "state" -> json.optJSONObject("data")?.let(::applyState)
            "telemetry" -> json.optJSONObject("data")?.let(::applyTelemetry)
            "ack" -> json.optInt("seq", -1).takeIf { it >= 0 }?.let(::ackCommands)
            // Unknown message types are ignored: forward compatibility beats a
            // disconnect when a newer page talks to an older service.
            else -> Unit
        }
        return true
    }

    private fun closeWith(sink: WsSink, output: OutputStream, code: Int) {
        markClosed(sink)
        try {
            writeFrame(sink, output, WsFrameCodec.encode(WsFrameCodec.OP_CLOSE, WsFrameCodec.closePayload(code)))
        } catch (ignored: IOException) {
            // Already gone.
        } finally {
            closeQuietly(sink.socket)
        }
    }

    private fun writeFrame(sink: WsSink, output: OutputStream, frame: ByteArray) {
        // The writer thread and the reader's pong/close replies share the socket.
        synchronized(sink.writeLock) {
            output.write(frame)
            output.flush()
        }
    }

    /** Sends retained commands the page has not consumed (`seq > since`). */
    private fun sendGapFill(sink: WsSink, since: Int) {
        val (pending, continuous) = synchronized(controlLock) {
            controlLog.pendingSince(since) to controlLog.latestContinuous()
        }
        for (entry in pending) {
            offer(sink, FrameKind.DISCRETE, textFrame(commandJson(entry, isContinuous = false)))
        }
        if (continuous != null && continuous.seq > since) {
            offer(sink, FrameKind.CONTINUOUS, textFrame(commandJson(continuous, isContinuous = true)))
        }
    }

    private fun offer(sink: WsSink, kind: FrameKind, frame: ByteArray) {
        sink.lock.lock()
        try {
            if (sink.closed) {
                return
            }
            sink.queue.offer(kind, frame)
            sink.signal.signalAll()
        } finally {
            sink.lock.unlock()
        }
    }

    private fun broadcastCommand(entry: ControlEntry, isContinuous: Boolean) {
        if (!hasWsSinks()) {
            return
        }
        publishFrame(
            if (isContinuous) FrameKind.CONTINUOUS else FrameKind.DISCRETE,
            textFrame(commandJson(entry, isContinuous))
        )
    }

    /**
     * 控制权变更（claim/release/断开/停 BLE）。帧里没有命令，也不推进 seq：
     * 订阅者据此独立更新 control，绝不会重放上一条命令。
     */
    private fun publishControlMessage() {
        if (!hasWsSinks()) {
            return
        }
        val json = JSONObject().apply {
            put("type", "control")
            put("control", controlMode)
            put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
        }
        publishFrame(FrameKind.STATE, textFrame(json))
    }

    private fun publishFrame(kind: FrameKind, frame: ByteArray) {
        wsLock.lock()
        try {
            for (sink in wsSinks) {
                offer(sink, kind, frame)
            }
        } finally {
            wsLock.unlock()
        }
    }

    private fun hasWsSinks(): Boolean {
        wsLock.lock()
        try {
            return wsSinks.isNotEmpty()
        } finally {
            wsLock.unlock()
        }
    }

    /**
     * `seq` echoes the client's watermark, not the newest issued seq: every
     * command that follows has a greater seq, so a page may safely adopt it as
     * its dedupe baseline before the gap-fill arrives.
     */
    private fun readyJson(since: Int): JSONObject = JSONObject().apply {
        put("type", "ready")
        put("seq", since)
        put("control", controlMode)
        put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
    }

    private fun commandJson(entry: ControlEntry, isContinuous: Boolean): JSONObject = JSONObject().apply {
        put("type", "cmd")
        put("seq", entry.seq)
        put("command", entry.command)
        put("continuous", isContinuous)
    }

    private fun textFrame(json: JSONObject): ByteArray =
        WsFrameCodec.encode(WsFrameCodec.OP_TEXT, json.toString().toByteArray(StandardCharsets.UTF_8))

    /** Parses the `since` query parameter; anything unusable means [SINCE_DEFAULT]. */
    private fun parseSince(query: String): Int {
        if (query.isEmpty()) {
            return SINCE_DEFAULT
        }
        for (pair in query.split('&')) {
            if (!pair.startsWith("since=")) {
                continue
            }
            return pair.substring("since=".length).toIntOrNull() ?: SINCE_DEFAULT
        }
        return SINCE_DEFAULT
    }

    // ---------------------------------------------------------------------
    // HTTP routes and command dispatch
    // ---------------------------------------------------------------------

    private fun route(
        method: String,
        target: String,
        headers: Map<String, String>,
        input: InputStream
    ): Response = when (target) {
        ROUTE_COMMAND ->
            if (method == "POST") handleCommand(headers, input)
            else methodNotAllowed("POST")

        ROUTE_CAPABILITIES ->
            if (method == "GET" || method == "HEAD") capabilitiesResponse()
            else methodNotAllowed("GET, HEAD")

        ROUTE_STATUS ->
            if (method == "GET" || method == "HEAD") statusResponse()
            else methodNotAllowed("GET, HEAD")

        ROUTE_BOOTSTRAP ->
            if (method == "GET" || method == "HEAD") bootstrapResponse()
            else methodNotAllowed("GET, HEAD")

        ROUTE_INDEX, ROUTE_INDEX_FILE ->
            if (method == "GET" || method == "HEAD") {
                Response(200, CONTENT_TYPE_HTML, currentPage())
            } else {
                methodNotAllowed("GET, HEAD")
            }

        else -> Response(404, CONTENT_TYPE_TEXT, NOT_FOUND)
    }

    /** Allowlisted command router shared by BLE, loopback HTTP and future intents. */
    private fun dispatchControl(raw: String): Boolean {
        val command = ControlProtocol.normalize(raw) ?: return false
        if (!ControlProtocol.isAllowedCommand(command)) {
            Log.w(TAG, "rejected command: $raw")
            return false
        }
        val seq = controlSeq.incrementAndGet()
        // 只有真正写入页面保留区的命令才推送事件：home/allapps/status 不改变
        // 页面状态，推一份旧命令会让事件消费方重复执行同一条命令。
        var queued = false
        var broadcastStatus = true
        when {
            command == "home" -> PortalActions.home(this)
            command == "allapps" -> PortalActions.allApps(this)
            // SUS lives in the page now: only the WebXR surface can offer gaze
            // selection, so these commands are forwarded instead of handled here.
            command == "enter" -> {
                if (!PortalActions.enter(this, HeadsetSettings.read(this).toLaunchOptions())) {
                    return false
                }
            }
            command.startsWith(ControlProtocol.SETTINGS_SKIP_CALIBRATION) -> {
                val enabled = command.endsWith(":on")
                synchronized(settingsLock) {
                    HeadsetSettings.save(
                        this,
                        HeadsetSettings.read(this).copy(skipCalibration = enabled)
                    )
                }
            }
            command.startsWith(ControlProtocol.SETTINGS_HUD) -> {
                val enabled = command.endsWith(":on")
                synchronized(settingsLock) {
                    HeadsetSettings.save(this, HeadsetSettings.read(this).copy(showHud = enabled))
                }
            }
            command.startsWith(ControlProtocol.SETTINGS_EYE_HEIGHT) -> {
                // The allowlist already range-checks the value; keep the second
                // gate so an out-of-range height can never reach prefs or the page.
                val meters = ControlProtocol.parseEyeHeight(command)
                if (meters == null) {
                    Log.w(TAG, "rejected eye height: $command")
                    return false
                }
                synchronized(settingsLock) {
                    HeadsetSettings.save(
                        this,
                        HeadsetSettings.read(this).copy(eyeHeight = meters)
                    )
                }
                queued = true
            }
            command.startsWith(ControlProtocol.SCENE_PREFIX) -> {
                val id = command.removePrefix(ControlProtocol.SCENE_PREFIX).trim()
                if (id !in ControlProtocol.SCENE_IDS) {
                    Log.w(TAG, "rejected scene: $command")
                    return false
                }
                // The scene is stored here, not only forwarded: it is the launch
                // parameter for the next `enter`, so the operator can pick a
                // different scene and go back in without touching the headset.
                synchronized(settingsLock) {
                    HeadsetSettings.save(this, HeadsetSettings.read(this).copy(sceneId = id))
                }
                queued = true
            }
            command == "exit" -> {
                // Leave the browser scene and come back to the console app.
                PortalActions.showConsole(this)
            }
            command.startsWith(ControlProtocol.VIEW_ORIENT) -> {
                // Slider stream: the newest absolute orientation owns the
                // continuous slot and persists there with no TTL. It never
                // changes BLE/status state, so it skips the per-sample activity
                // broadcast (the WS push carries it instead).
                if (ControlProtocol.parseViewOrient(command) == null) {
                    Log.w(TAG, "rejected view orient: $command")
                    return false
                }
                queued = true
                broadcastStatus = false
            }
            command.startsWith("cue:") -> {
                if (command.startsWith("cue:intensity:")) {
                    val intensity = command.substringAfter("cue:intensity:").toFloatOrNull()
                    if (intensity == null || !intensity.isFinite() || intensity < 0f || intensity > 1f) {
                        Log.w(TAG, "rejected cue intensity: $command")
                        return false
                    }
                }
                queued = true
            }
            command == "status" -> Unit
            else -> queued = true
        }
        if (queued) {
            // 保留区先记录再广播：重连补发永远看得到这条命令。
            val kind = synchronized(controlLock) { controlLog.record(seq, command) }
            broadcastCommand(ControlEntry(seq, command), kind == ControlKind.CONTINUOUS)
        }
        if (broadcastStatus) {
            try {
                sendBroadcast(Intent(PortalStatus.ACTION_STATUS).setPackage(packageName))
            } catch (ignored: RuntimeException) {
                // No visible activity; the holder is still updated by the page.
            }
        }
        return true
    }

    private fun ackCommands(seq: Int) {
        synchronized(controlLock) { controlLog.ack(seq) }
    }

    private fun handleCommand(headers: Map<String, String>, input: InputStream): Response {
        val json = readJson(headers, input)
        val raw = json.optString("command", "")
        if (!dispatchControl(raw)) {
            throw HttpError(400, "command not allowed")
        }
        val body = JSONObject()
        body.put("accepted", true)
        body.put("seq", controlSeq.get())
        return jsonResponse(body)
    }

    private fun capabilitiesResponse(): Response {
        val commands = JSONArray()
        for (command in ControlProtocol.CAPABILITIES) {
            commands.put(command)
        }
        val body = JSONObject()
        body.put("version", 1)
        body.put("commands", commands)
        body.put("control", controlMode)
        return jsonResponse(body)
    }

    private fun bootstrapResponse(): Response = jsonResponse(PortalSession.toJson())

    private fun statusResponse(): Response {
        val bluetooth = bluetooth
        val body = JSONObject()
        body.put("bluetooth", bluetooth?.state ?: "unavailable")
        body.put("control", controlMode)
        body.put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
        val state = lastState
        body.put("session", state.session)
        body.put("calibrating", state.calibrating)
        body.put("postureProgress", state.postureProgress)
        body.put("posturePitch", state.posturePitch)
        body.put("postureRise", state.postureRise)
        body.put("viewPitch", state.viewPitch)
        body.put("viewYaw", state.viewYaw)
        body.put("viewAnim", state.viewAnim.wire)
        body.put("viewPreset", state.viewPreset.wire)
        body.put("scene", state.scene)
        body.put("pendingSeq", controlSeq.get())
        return jsonResponse(body)
    }

    /** Same decode path the removed `POST /telemetry` used, now fed by `ws.telemetry`. */
    private fun applyTelemetry(json: JSONObject) {
        val pose = TelemetryPose(
            x = json.optNumber("x"),
            y = json.optNumber("y"),
            z = json.optNumber("z"),
            yaw = json.optNumber("yaw"),
            pitch = json.optNumber("pitch")
        )
        if (!pose.x.isFinite() || !pose.y.isFinite() || !pose.z.isFinite() ||
            !pose.yaw.isFinite() || !pose.pitch.isFinite()
        ) {
            return
        }
        bluetooth?.publishTelemetry(pose)
    }

    /** Same decode path the removed `POST /state` used, now fed by `ws.state`. */
    private fun applyState(json: JSONObject) {
        fun finite(name: String, fallback: Float): Float =
            json.optDouble(name, fallback.toDouble()).toFloat().takeIf { it.isFinite() } ?: fallback
        val state = ControlState(
            scene = json.optString("scene", ControlState().scene)
                .takeIf { it in ControlProtocol.SCENE_IDS } ?: ControlState().scene,
            session = json.optBoolean("session", false),
            calibrating = json.optBoolean("calibrating", false),
            sitUpActive = json.optBoolean("sitUpActive", false),
            postureMode = json.optBoolean("postureMode", false),
            // Buoyancy the page is actually applying; the tablet mirrors this so
            // its controls can never drift from the headset.
            floatLevel = json.optInt("floatLevel", 1).coerceIn(0, 3),
            floatProfile = json.optString("floatProfile", "b")
                .takeIf { it == "a" || it == "b" || it == "c" } ?: "b",
            audioMuted = json.optBoolean("audio", false),
            cueEnabled = json.optBoolean("cueEnabled", true),
            eyeHeight = finite("eyeHeight", ControlProtocol.EYE_HEIGHT_DEFAULT)
                .takeIf { it >= ControlProtocol.EYE_HEIGHT_MIN && it <= ControlProtocol.EYE_HEIGHT_MAX }
                ?: ControlProtocol.EYE_HEIGHT_DEFAULT,
            posturePitch = finite("posturePitch", 0f),
            postureRoll = finite("postureRoll", 0f),
            postureRise = finite("postureRise", 0f),
            postureProgress = finite("postureProgress", 0f),
            // 视角俯仰是**当前已应用**的角度（度），不是目标。v3 的
            // viewX/viewZ 平移字段已删除，页面若仍发送也会被忽略。
            // ±20° 的夹紧只在页面做一次（见 docs/rotation-contract.md），
            // 这里不重复，否则坏值会被静默改写成"合法"的错值。
            viewPitch = finite("viewPitch", 0f),
            // 视角偏航：+ = 患者视线向左（与世界层符号相反，页面已换算）。
            viewYaw = finite("viewYaw", 0f),
            // 实际写入场景内容的世界旋转（外壳 × 基座），供镜像复现患者视角。
            worldYaw = finite("worldYaw", 0f),
            worldPitch = finite("worldPitch", 0f),
            worldRoll = finite("worldRoll", 0f),
            // 未知的动画相位/预设按空闲/未选择处理，坏值不会让整帧 state 失效。
            viewAnim = ViewAnim.fromWire(json.optString("viewAnim", ViewAnim.IDLE.wire)),
            viewPreset = ViewPreset.fromWire(json.optString("viewPreset", ViewPreset.NONE.wire)),
            cueIntensity = finite("cueIntensity", 1f)
        )
        lastState = state
        bluetooth?.publishState(state)
    }

    private fun readJson(headers: Map<String, String>, input: InputStream): JSONObject {
        val raw = String(readBody(headers, input), StandardCharsets.UTF_8)
        return try {
            JSONObject(raw)
        } catch (error: JSONException) {
            throw HttpError(400, "invalid json")
        }
    }

    /** Missing or malformed values fall back to 0 instead of breaking the frame. */
    private fun JSONObject.optNumber(name: String): Float {
        val value = opt(name) ?: return 0f
        if (value == JSONObject.NULL) {
            return 0f
        }
        return if (value is Number) value.toFloat() else 0f
    }

    private fun readBody(headers: Map<String, String>, input: InputStream): ByteArray {
        if (headers["transfer-encoding"] != null) {
            throw HttpError(400, "transfer-encoding unsupported")
        }
        val raw = headers["content-length"] ?: throw HttpError(411, "content-length required")
        val length = raw.toIntOrNull() ?: throw HttpError(400, "invalid content-length")
        if (length < 0) {
            throw HttpError(400, "invalid content-length")
        }
        if (length > MAX_BODY_BYTES) {
            throw HttpError(413, "body too large")
        }
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(body, offset, length - offset)
            if (read < 0) {
                throw HttpError(400, "truncated body")
            }
            offset += read
        }
        return body
    }

    private fun readHeaders(input: InputStream): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        var headerBytes = 0
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) {
                break
            }
            headerBytes += line.length + 2
            if (headerBytes > MAX_HEADER_BYTES) {
                throw HttpError(431, "request headers too large")
            }
            val colon = line.indexOf(':')
            if (colon > 0) {
                headers[line.substring(0, colon).trim().lowercase(Locale.US)] =
                    line.substring(colon + 1).trim()
            }
        }
        return headers
    }

    /** Reads one CRLF-terminated header line without swallowing body bytes. */
    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream(128)
        var byte = input.read()
        if (byte == -1) {
            return null
        }
        while (byte != -1 && byte != '\n'.code) {
            if (byte != '\r'.code) {
                if (out.size() >= MAX_LINE_BYTES) {
                    throw HttpError(431, "header line too long")
                }
                out.write(byte)
            }
            byte = input.read()
        }
        return String(out.toByteArray(), StandardCharsets.US_ASCII)
    }

    private fun writeResponse(client: Socket, response: Response, head: Boolean) {
        val out: OutputStream = client.getOutputStream()
        val builder = StringBuilder(128)
        builder.append("HTTP/1.1 ").append(response.status).append(' ')
            .append(statusText(response.status)).append("\r\n")
            .append("Content-Type: ").append(response.contentType).append("\r\n")
            .append("Cache-Control: no-store, no-cache, must-revalidate\r\n")
            .append("Pragma: no-cache\r\n")
            .append("Expires: 0\r\n")
            .append("Connection: close\r\n")
        response.allow?.let { builder.append("Allow: ").append(it).append("\r\n") }
        builder.append("Content-Length: ").append(response.body.size).append("\r\n\r\n")
        out.write(builder.toString().toByteArray(StandardCharsets.US_ASCII))
        if (!head) {
            out.write(response.body)
        }
        out.flush()
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        400 -> "Bad Request"
        403 -> "Forbidden"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        411 -> "Length Required"
        413 -> "Payload Too Large"
        431 -> "Request Header Fields Too Large"
        503 -> "Service Unavailable"
        else -> "Internal Server Error"
    }

    private fun jsonResponse(body: JSONObject): Response =
        Response(200, CONTENT_TYPE_JSON, body.toString().toByteArray(StandardCharsets.UTF_8))

    private fun errorResponse(status: Int, message: String): Response {
        val contentType = if (status == 404) CONTENT_TYPE_TEXT else CONTENT_TYPE_JSON
        val body = if (status == 404) {
            NOT_FOUND
        } else {
            JSONObject().put("error", message).toString().toByteArray(StandardCharsets.UTF_8)
        }
        return Response(status, contentType, body)
    }

    private fun methodNotAllowed(allow: String): Response =
        Response(
            405,
            CONTENT_TYPE_JSON,
            JSONObject().put("error", "method not allowed").toString().toByteArray(StandardCharsets.UTF_8),
            allow
        )

    private fun currentPage(): ByteArray {
        val base = page ?: return FALLBACK_PAGE
        val marker = "<!-- QS_BOOTSTRAP -->"
        val html = String(base, StandardCharsets.UTF_8)
        if (!html.contains(marker)) {
            return base
        }
        val script = "<script>window.__QS_BOOTSTRAP__ = ${PortalSession.toJson()};</script>"
        return html.replace(marker, script).toByteArray(StandardCharsets.UTF_8)
    }

    private fun readPage(): ByteArray? {
        var input: InputStream? = null
        return try {
            val stream = assets.open(ASSET_NAME)
            input = stream
            val out = ByteArrayOutputStream(COPY_BUFFER * 8)
            val buffer = ByteArray(COPY_BUFFER)
            var read = stream.read(buffer)
            while (read > 0) {
                out.write(buffer, 0, read)
                read = stream.read(buffer)
            }
            val bytes = out.toByteArray()
            if (bytes.isEmpty()) null else bytes
        } catch (error: IOException) {
            Log.w(TAG, "asset $ASSET_NAME unavailable: ${error.message}")
            null
        } finally {
            closeQuietly(input)
        }
    }

    private fun createChannel() {
        val manager = notificationManager ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "本地训练服务入口"
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannel(channel)
    }

    private fun refreshNotification() {
        val manager = notificationManager ?: return
        try {
            manager.notify(NOTIFICATION_ID, buildNotification())
        } catch (error: RuntimeException) {
            Log.w(TAG, "notification refresh failed: ${error.message}")
        }
    }

    /** Mirrors BLE state into the shared holder, then updates UI surfaces. */
    private fun publishStatus() {
        PortalStatus.update(bluetooth?.state ?: "stopped", controlMode, bluetooth?.controllerAddress())
        try {
            sendBroadcast(Intent(PortalStatus.ACTION_STATUS).setPackage(packageName))
        } catch (ignored: RuntimeException) {
            // No receiver registered; the activity reads the holder on resume.
        }
        refreshNotification()
    }

    private fun buildNotification(): Notification {
        val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val content = PendingIntent.getActivity(
            this,
            4,
            Intent(this, PortalActivity::class.java),
            immutable
        )
        val message = "点击进入，选择场景开始训练"

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setColor(BrandAssets.ACCENT)
            .setContentTitle("静岸 · 训练控制台")
            .setContentText(message)
            .setContentIntent(content)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPriority(Notification.PRIORITY_DEFAULT)
            .setDefaults(0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_info_details,
                    "打开控制台",
                    content
                ).build()
            )
            .build()
    }

    private fun closeQuietly(closeable: Closeable?) {
        try {
            closeable?.close()
        } catch (ignored: IOException) {
            // 已经关闭。
        }
    }

    private class Response(
        val status: Int,
        val contentType: String,
        val body: ByteArray,
        val allow: String? = null
    )

    /**
     * 一个 WebSocket 订阅者。[queue] 只在持有 [lock] 时访问；写入 socket 一律
     * 在锁外（[writeLock] 只串行化真正的写调用），所以队列深度只影响该订阅者
     * 自己的滞后，不会反压命令线程。
     */
    private class WsSink(val socket: Socket, val since: Int) {
        val queue = CoalescingQueue<ByteArray>(WS_QUEUE_DEPTH)
        val lock = ReentrantLock()
        val signal = lock.newCondition()
        val writeLock = Any()

        @Volatile
        var closed = false

        @Volatile
        var lastPongAt = System.currentTimeMillis()
    }

    private class HttpError(val status: Int, override val message: String) : RuntimeException(message)
}
