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
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock

/**
 * 前台服务：把 APK 内置的 standalone 页面以只读静态 HTTP 暴露在
 * 127.0.0.1:8130（仅 loopback，不监听局域网）。
 *
 * 静态读取只做 GET/HEAD；控制面是 JSON：
 *   GET  /control    {seq,command,control}（轮询保留，向后兼容）
 *   GET  /events     text/event-stream，推送两类事件：
 *                    event: control  data={seq,command,control,controller}（命令，同 /control）
 *                    event: state     data={control,controller}（控制权，无 seq/command）
 *   GET  /status     {bluetooth,control}
 *   POST /telemetry  {x,y,z,yaw,pitch} -> BLE telemetry characteristic
 *   POST /state      {scene,session,calibrating,audio} -> BLE state characteristic
 *
 * /events 连接建立时先发一帧 control（当前快照），紧随一帧 state，页面无需先轮询。
 * 之后命令只会出现在 control 帧里；控制权变化（CLAIM/RELEASE/断开/停 BLE）
 * 只发 state 帧，绝不重放上一条命令。
 *
 * 内容为空或读取失败时返回占位页，保证浏览器永远拿到 HTML 而不是连接错误。
 * 没有目录遍历、没有任意路径写操作。
 *
 * 并发不变量（/events 必须不能饿死静态页或轮询）：
 * - 每个连接一个受限线程；同时最多 [MAX_CLIENTS] 个连接，超出的直接 503 关闭。
 * - 每个 SSE 订阅占用一个线程，数量另受 [MAX_EVENT_CLIENTS] 限制，
 *   保证永远有空闲线程服务 /control、/status 与静态资源。
 * - [eventLock] 只保护订阅者注册表与每订阅者的有界队列；绝不在持锁时做 socket I/O。
 *   因此 BLE 线程调用 [publishFrame] 不会被慢客户端阻塞。
 * - 每个被接受的命令只构造一次 JSON 与一次 SSE 帧（共享给所有订阅者）；
 *   没有订阅者时连 JSON 都不构造。
 * - 停服务时关闭订阅 socket、唤醒等待者并 shutdown 线程池，不留驻留线程。
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

        /** SSE 订阅上限，必须明显小于 [MAX_CLIENTS]，轮询/静态页才有线程可用。 */
        const val MAX_EVENT_CLIENTS = 3

        /** 每订阅者待发帧上限；满了丢最旧的（movement 只关心最新样本）。 */
        const val EVENT_QUEUE_DEPTH = 32
        const val EVENT_HEARTBEAT_MS = 15_000L

        /** 停服时等订阅者把最后一帧发出去的排空上限；超时就直接关连接。 */
        const val EVENT_DRAIN_MS = 100L

        /** 空闲工作线程回收时间；核心线程同样超时，停服务后不会残留。 */
        const val CLIENT_KEEPALIVE_S = 10L

        val FALLBACK_PAGE: ByteArray =
            "<h1>Quiet Shore VR is starting</h1>".toByteArray(StandardCharsets.UTF_8)
        val NOT_FOUND: ByteArray = "not found".toByteArray(StandardCharsets.UTF_8)

        /** 握手 + retry 一次写出；之后每个心跳都复用同一个常量字节数组。 */
        val EVENT_HANDSHAKE: ByteArray = (
            "HTTP/1.1 200 OK\r\n" +
                "Content-Type: text/event-stream\r\n" +
                "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
                "Connection: keep-alive\r\n" +
                "\r\n" +
                "retry: 1000\n\n"
            ).toByteArray(StandardCharsets.US_ASCII)

        val EVENT_HEARTBEAT: ByteArray = ": ping\n\n".toByteArray(StandardCharsets.US_ASCII)

        const val CONTENT_TYPE_HTML = "text/html; charset=utf-8"
        const val CONTENT_TYPE_JSON = "application/json; charset=utf-8"
        const val CONTENT_TYPE_TEXT = "text/plain; charset=utf-8"

        const val ROUTE_CONTROL = "/control"
        const val ROUTE_COMMAND = "/command"
        const val ROUTE_CAPABILITIES = "/capabilities"
        const val ROUTE_STATUS = "/status"
        const val ROUTE_BOOTSTRAP = "/bootstrap"
        const val ROUTE_TELEMETRY = "/telemetry"
        const val ROUTE_STATE = "/state"
        const val ROUTE_EVENTS = "/events"
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

    private val pendingControl = AtomicReference<String?>(null)
    private val controlSeq = AtomicInteger(0)

    /** 串行化 HeadsetSettings 的读-改-写，避免并发命令互相覆盖。 */
    private val settingsLock = Any()

    /** 保护 [eventSinks] 与每个订阅者的有界队列；绝不在此锁内做 socket I/O。 */
    private val eventLock = ReentrantLock()
    private val eventSignal = eventLock.newCondition()
    private val eventSinks = ArrayList<EventSink>(MAX_EVENT_CLIENTS)

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
                    // CLAIM/RELEASE/断开/停 BLE 都从这里进来：用独立的 state 帧
                    // 通知订阅者，页面无需轮询也不会重放命令。
                    if (changed) {
                        publishStateEvent()
                        if (active) {
                            // Ask the page for a fresh /state snapshot; the
                            // service just restarted or the tablet may have
                            // missed the last 1 Hz notification.
                            pendingControl.set("status")
                            controlSeq.incrementAndGet()
                            publishControlEvent()
                        }
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
            // 让 EventSource 页面立刻停止虚拟视角移动。
            controlMode = false
            publishStateEvent()
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
        // 先关闭所有 SSE 连接并唤醒等待者，worker 的 finally 才会把线程还回去。
        closeEventSinks()
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
     * 只做 accept 与限额判定，具体请求交给有界线程池；SSE 长连接因此不会
     * 阻塞静态页或 /control。
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
            if (target == ROUTE_EVENTS) {
                if (method == "GET") {
                    streamEvents(client)
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
                writeResponse(client, errorResponse(error.status, error.message ?: "error"), head = false)
            } catch (ignored: IOException) {
                // 客户端已断开。
            }
        } finally {
            clientSlots.decrementAndGet()
            closeQuietly(client)
        }
    }

    /**
     * SSE 订阅循环。每个订阅独占一个 worker 线程，写 socket 时绝不持有
     * [eventLock]，所以慢客户端只会拖慢它自己，不会阻塞 dispatchControl。
     */
    private fun streamEvents(client: Socket) {
        val output: OutputStream = try {
            client.getOutputStream()
        } catch (error: IOException) {
            return
        }
        val sink = EventSink(client, output)
        if (!registerEventSink(sink)) {
            try {
                writeResponse(client, errorResponse(503, "too many event streams"), head = false)
            } catch (ignored: IOException) {
                // 客户端已断开。
            }
            return
        }
        try {
            output.write(EVENT_HANDSHAKE)
            // 首帧与 GET /control 完全同形：客户端一连上就对齐序号与当前命令。
            // 随后补一帧 state，控制权单独成帧，命令消费方不会被重复触发。
            offerFrame(sink, controlFrame(controlJson()))
            offerFrame(sink, stateFrame(stateJson()))
            output.flush()
            while (true) {
                val frame = nextFrame(sink) ?: break
                output.write(frame)
                output.flush()
            }
        } catch (error: IOException) {
            // 客户端断开或服务停止；由 finally 注销。
        } finally {
            unregisterEventSink(sink)
        }
    }

    private fun registerEventSink(sink: EventSink): Boolean {
        eventLock.lock()
        try {
            if (!running || eventSinks.size >= MAX_EVENT_CLIENTS) {
                return false
            }
            eventSinks.add(sink)
            return true
        } finally {
            eventLock.unlock()
        }
    }

    private fun unregisterEventSink(sink: EventSink) {
        eventLock.lock()
        try {
            sink.closed = true
            sink.frames.clear()
            eventSinks.remove(sink)
            eventSignal.signalAll()
        } finally {
            eventLock.unlock()
        }
    }

    /**
     * 停服务：先给订阅者极小的排空窗口，把已入队的最后一帧（控制权失效）
     * 写出去，然后标记关闭、关 socket、唤醒所有等待心跳的 worker。
     */
    private fun closeEventSinks() {
        val closing = ArrayList<EventSink>(MAX_EVENT_CLIENTS)
        val deadline = System.currentTimeMillis() + EVENT_DRAIN_MS
        eventLock.lock()
        try {
            // await 会释放锁，writer 才能取到帧；队列清空即视为已交给写端。
            while (System.currentTimeMillis() < deadline &&
                eventSinks.any { it.frames.isNotEmpty() }
            ) {
                try {
                    eventSignal.await(10, TimeUnit.MILLISECONDS)
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
            for (sink in eventSinks) {
                sink.closed = true
                sink.frames.clear()
                closing.add(sink)
            }
            eventSinks.clear()
            eventSignal.signalAll()
        } finally {
            eventLock.unlock()
        }
        for (sink in closing) {
            closeQuietly(sink.socket)
        }
    }

    /** 取下一帧：有帧立即返回，空闲到点返回共享心跳，关闭/停服返回 null。 */
    private fun nextFrame(sink: EventSink): ByteArray? {
        eventLock.lock()
        try {
            val deadline = System.currentTimeMillis() + EVENT_HEARTBEAT_MS
            while (true) {
                if (sink.closed) {
                    return null
                }
                // 先排空已入队的帧：停服时那最后一帧（控制权失效）才有机会送达。
                sink.frames.pollFirst()?.let { return it }
                if (!running) {
                    return null
                }
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0L) {
                    return EVENT_HEARTBEAT
                }
                try {
                    eventSignal.await(remaining, TimeUnit.MILLISECONDS)
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return null
                }
            }
        } finally {
            eventLock.unlock()
        }
    }

    private fun offerFrame(sink: EventSink, frame: ByteArray) {
        eventLock.lock()
        try {
            if (sink.closed) {
                return
            }
            enqueueLocked(sink, frame)
            eventSignal.signalAll()
        } finally {
            eventLock.unlock()
        }
    }

    /**
     * 广播一次已接受的命令。没有订阅者时不构造 JSON；有订阅者时整个命令只
     * 构造一份 JSON 与一份帧字节，所有订阅者共享。
     */
    private fun publishControlEvent() {
        if (!hasEventSinks()) {
            return
        }
        publishFrame(controlFrame(controlJson()))
    }

    /**
     * 控制权变更（claim/release/断开/停 BLE）。帧里没有 command，也不推进
     * seq：订阅者据此独立更新 control，绝不会重放上一条命令。
     */
    private fun publishStateEvent() {
        if (!hasEventSinks()) {
            return
        }
        publishFrame(stateFrame(stateJson()))
    }

    private fun publishFrame(frame: ByteArray) {
        eventLock.lock()
        try {
            for (sink in eventSinks) {
                if (!sink.closed) {
                    enqueueLocked(sink, frame)
                }
            }
            eventSignal.signalAll()
        } finally {
            eventLock.unlock()
        }
    }

    private fun hasEventSinks(): Boolean {
        eventLock.lock()
        try {
            return eventSinks.isNotEmpty()
        } finally {
            eventLock.unlock()
        }
    }

    /** 有界队列：满了丢最旧帧（movement 只关心最新样本），绝不阻塞生产者。 */
    private fun enqueueLocked(sink: EventSink, frame: ByteArray) {
        if (sink.frames.size >= EVENT_QUEUE_DEPTH) {
            sink.frames.pollFirst()
        }
        sink.frames.addLast(frame)
    }

    /** 一帧 SSE；data 行是 /control 的同一份 JSON。 */
    private fun controlFrame(json: JSONObject): ByteArray =
        ("event: control\ndata: " + json.toString() + "\n\n")
            .toByteArray(StandardCharsets.UTF_8)

    /** 只描述控制权，没有 seq/command：可安全重复投递，不会触发命令重放。 */
    private fun stateJson(): JSONObject = JSONObject().apply {
        put("control", controlMode)
        put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
    }

    private fun stateFrame(json: JSONObject): ByteArray =
        ("event: state\ndata: " + json.toString() + "\n\n")
            .toByteArray(StandardCharsets.UTF_8)

    private fun route(
        method: String,
        target: String,
        headers: Map<String, String>,
        input: InputStream
    ): Response = when (target) {
        ROUTE_CONTROL ->
            if (method == "GET" || method == "HEAD") controlResponse()
            else methodNotAllowed("GET, HEAD")

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

        ROUTE_TELEMETRY ->
            if (method == "POST") handleTelemetry(headers, input)
            else methodNotAllowed("POST")

        ROUTE_STATE ->
            if (method == "POST") handleState(headers, input)
            else methodNotAllowed("POST")

        else -> Response(404, CONTENT_TYPE_TEXT, NOT_FOUND)
    }

    /** Allowlisted command router shared by BLE, loopback HTTP and future intents. */
    private fun dispatchControl(raw: String): Boolean {
        val command = ControlProtocol.normalize(raw) ?: return false
        if (!ControlProtocol.isAllowedCommand(command)) {
            Log.w(TAG, "rejected command: $raw")
            return false
        }
        controlSeq.incrementAndGet()
        // 只有真正写入页面槽位的命令才推送事件：home/allapps/status 不改变页面
        // 状态，推一份旧命令会让事件消费方重复执行同一条命令。
        var queued = false
        var broadcastStatus = true
        when {
            command == "home" -> PortalActions.home(this)
            command == "allapps" -> PortalActions.allApps(this)
            command == "sus:open" -> PortalActions.openSus(this)
            command == "sus:close" -> PortalActions.closeSus(this)
            command == "sus:next" -> PortalActions.susPage(this, 1)
            command == "sus:prev" -> PortalActions.susPage(this, -1)
            command.startsWith(ControlProtocol.SUS_ANSWER) -> {
                val value = ControlProtocol.parseSusAnswer(command) ?: return false
                PortalActions.susAnswer(this, value)
            }
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
                pendingControl.set(command)
                queued = true
            }
            command.startsWith(ControlProtocol.VIEW_MOVE) -> {
                // Joystick stream: the newest sample owns the single page slot,
                // and the page expires it 300 ms after the last repeat. Movement
                // never changes BLE/status state, so it skips the per-sample
                // activity broadcast (the SSE push carries it instead).
                if (ControlProtocol.parseViewMove(command) == null) {
                    Log.w(TAG, "rejected view move: $command")
                    return false
                }
                pendingControl.set(command)
                queued = true
                broadcastStatus = false
            }
            command.startsWith("cue:") -> {
                if (HeadsetSettings.read(this).sceneId != "landscape") {
                    Log.w(TAG, "rejected cue outside landscape: $command")
                    return false
                }
                if (command.startsWith("cue:intensity:")) {
                    val intensity = command.substringAfter("cue:intensity:").toFloatOrNull()
                    if (intensity == null || !intensity.isFinite() || intensity < 0f || intensity > 1f) {
                        Log.w(TAG, "rejected cue intensity: $command")
                        return false
                    }
                }
                pendingControl.set(command)
                queued = true
            }
            command.startsWith("scene:") -> {
                val scene = command.substringAfter("scene:").trim()
                if (scene in HeadsetSettings.SCENE_IDS) {
                    synchronized(settingsLock) {
                        HeadsetSettings.save(
                            this,
                            HeadsetSettings.read(this).copy(sceneId = scene)
                        )
                    }
                    pendingControl.set(command)
                    queued = true
                } else {
                    Log.w(TAG, "rejected scene: $scene")
                    return false
                }
            }
            command == "status" -> Unit
            else -> {
                pendingControl.set(command)
                queued = true
            }
        }
        if (queued) {
            // 事件里的 seq 就是这次写入的序号；帧在锁外构造，慢客户端不阻塞 BLE。
            publishControlEvent()
        }
        if (broadcastStatus) {
            try {
                sendBroadcast(Intent(PortalStatus.ACTION_STATUS).setPackage(packageName))
            } catch (ignored: RuntimeException) {
                // No visible activity; the holder is still updated by the page poll.
            }
        }
        return true
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

    private fun controlResponse(): Response = jsonResponse(controlJson())

    /** /control 与 SSE 事件共用的快照；字段顺序和取值完全一致。 */
    private fun controlJson(): JSONObject = JSONObject().apply {
        put("seq", controlSeq.get())
        val command = pendingControl.get()
        if (command == null) {
            put("command", JSONObject.NULL)
        } else {
            put("command", command)
        }
        put("control", controlMode)
        put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
    }

    private fun bootstrapResponse(): Response = jsonResponse(PortalSession.toJson())

    private fun statusResponse(): Response {
        val bluetooth = bluetooth
        val body = JSONObject()
        body.put("bluetooth", bluetooth?.state ?: "unavailable")
        body.put("control", controlMode)
        body.put("controller", bluetooth?.controllerAddress() ?: JSONObject.NULL)
        val state = lastState
        body.put("scene", HeadsetSettings.read(this).sceneId)
        body.put("session", state.session)
        body.put("calibrating", state.calibrating)
        body.put("postureProgress", state.postureProgress)
        body.put("posturePitch", state.posturePitch)
        body.put("postureRise", state.postureRise)
        body.put("calibrationConfidence", state.calibrationConfidence)
        body.put("pendingSeq", controlSeq.get())
        return jsonResponse(body)
    }

    private fun handleTelemetry(headers: Map<String, String>, input: InputStream): Response {
        val json = readJson(headers, input)
        val pose = TelemetryPose(
            x = requireNumber(json, "x"),
            y = requireNumber(json, "y"),
            z = requireNumber(json, "z"),
            yaw = requireNumber(json, "yaw"),
            pitch = requireNumber(json, "pitch")
        )
        if (!pose.x.isFinite() || !pose.y.isFinite() || !pose.z.isFinite() ||
            !pose.yaw.isFinite() || !pose.pitch.isFinite()
        ) {
            throw HttpError(400, "invalid telemetry")
        }
        bluetooth?.publishTelemetry(pose)
        return okResponse()
    }

    private fun handleState(headers: Map<String, String>, input: InputStream): Response {
        val json = readJson(headers, input)
        val scene = json.optString("scene", ControlState().scene).trim()
        fun finite(name: String, fallback: Float): Float =
            json.optDouble(name, fallback.toDouble()).toFloat().takeIf { it.isFinite() } ?: fallback
        val state = ControlState(
            scene = if (scene.isEmpty()) ControlState().scene else scene,
            session = json.optBoolean("session", false),
            calibrating = json.optBoolean("calibrating", false),
            audioMuted = json.optBoolean("audio", false),
            cueEnabled = json.optBoolean("cueEnabled", true),
            eyeHeight = finite("eyeHeight", ControlProtocol.EYE_HEIGHT_DEFAULT)
                .takeIf { it >= ControlProtocol.EYE_HEIGHT_MIN && it <= ControlProtocol.EYE_HEIGHT_MAX }
                ?: ControlProtocol.EYE_HEIGHT_DEFAULT,
            posturePitch = finite("posturePitch", 0f),
            postureRoll = finite("postureRoll", 0f),
            postureRise = finite("postureRise", 0f),
            postureProgress = finite("postureProgress", 0f),
            viewX = finite("viewX", 0f),
            viewZ = finite("viewZ", 0f),
            cueIntensity = finite("cueIntensity", 1f),
            calibrationConfidence = finite("calibrationConfidence", 0f)
        )
        lastState = state
        bluetooth?.publishState(state)
        return okResponse()
    }

    private fun readJson(headers: Map<String, String>, input: InputStream): JSONObject {
        val raw = String(readBody(headers, input), StandardCharsets.UTF_8)
        return try {
            JSONObject(raw)
        } catch (error: JSONException) {
            throw HttpError(400, "invalid json")
        }
    }

    private fun requireNumber(json: JSONObject, name: String): Float {
        val value = json.opt(name)
        if (value == null || value == JSONObject.NULL) {
            return 0f
        }
        if (value !is Number) {
            throw HttpError(400, "invalid $name")
        }
        return value.toFloat()
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

    private fun okResponse(): Response =
        jsonResponse(JSONObject().put("ok", true))

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
     * 一个 SSE 订阅者。[frames] 只在持有 eventLock 时访问；写入 socket 一律
     * 在锁外，所以队列深度只影响该订阅者自己的滞后，不会反压命令线程。
     */
    private class EventSink(val socket: Socket, val output: OutputStream) {
        val frames = ArrayDeque<ByteArray>(PortalService.EVENT_QUEUE_DEPTH)
        var closed = false
    }

    private class HttpError(val status: Int, override val message: String) : RuntimeException(message)
}
