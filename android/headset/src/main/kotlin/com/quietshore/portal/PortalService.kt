package com.quietshore.portal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
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
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * 前台服务：把 APK 内置的 standalone 页面以只读静态 HTTP 暴露在
 * 127.0.0.1:8130（仅 loopback，不监听局域网）。
 *
 * 静态读取只做 GET/HEAD；控制面是 JSON：
 *   GET  /control    {seq,command,control}
 *   GET  /status     {bluetooth,control}
 *   POST /telemetry  {x,y,z,yaw,pitch} -> BLE telemetry characteristic
 *   POST /state      {scene,session,calibrating,audio} -> BLE state characteristic
 *
 * 内容为空或读取失败时返回占位页，保证浏览器永远拿到 HTML 而不是连接错误。
 * 没有目录遍历、没有任意路径写操作。
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

        val FALLBACK_PAGE: ByteArray =
            "<h1>Quiet Shore VR is starting</h1>".toByteArray(StandardCharsets.UTF_8)
        val NOT_FOUND: ByteArray = "not found".toByteArray(StandardCharsets.UTF_8)

        const val CONTENT_TYPE_HTML = "text/html; charset=utf-8"
        const val CONTENT_TYPE_JSON = "application/json; charset=utf-8"
        const val CONTENT_TYPE_TEXT = "text/plain; charset=utf-8"

        const val ROUTE_CONTROL = "/control"
        const val ROUTE_STATUS = "/status"
        const val ROUTE_BOOTSTRAP = "/bootstrap"
        const val ROUTE_TELEMETRY = "/telemetry"
        const val ROUTE_STATE = "/state"
        const val ROUTE_INDEX = "/"
        const val ROUTE_INDEX_FILE = "/index.html"
    }

    @Volatile
    private var running = false

    @Volatile
    private var page: ByteArray? = null

    @Volatile
    private var serverSocket: ServerSocket? = null

    @Volatile
    private var serverThread: Thread? = null

    private val pendingControl = AtomicReference<String?>(null)
    private val controlSeq = AtomicInteger(0)

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
                override fun onCommand(command: String) {
                    pendingControl.set(command)
                    controlSeq.incrementAndGet()
                }

                override fun onControlMode(active: Boolean) {
                    controlMode = active
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
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    @Synchronized
    private fun startServer() {
        if (serverThread != null) {
            return
        }
        running = true
        val thread = Thread({ serveLoop() }, THREAD_NAME)
        thread.isDaemon = true
        serverThread = thread
        thread.start()
    }

    /** 单线程串行处理：页面自包含，浏览器只会发个位数请求。 */
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
                serve(socket.accept())
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
            closeQuietly(client)
        }
    }

    private fun route(
        method: String,
        target: String,
        headers: Map<String, String>,
        input: InputStream
    ): Response = when (target) {
        ROUTE_CONTROL ->
            if (method == "GET" || method == "HEAD") controlResponse()
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

    private fun controlResponse(): Response {
        val body = JSONObject()
        body.put("seq", controlSeq.get())
        val command = pendingControl.get()
        if (command == null) {
            body.put("command", JSONObject.NULL)
        } else {
            body.put("command", command)
        }
        body.put("control", controlMode)
        return jsonResponse(body)
    }

    private fun bootstrapResponse(): Response = jsonResponse(PortalSession.toJson())

    private fun statusResponse(): Response {
        val bluetooth = bluetooth
        val body = JSONObject()
        body.put("bluetooth", bluetooth?.state ?: "unavailable")
        body.put("control", controlMode)
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
        val state = ControlState(
            scene = if (scene.isEmpty()) ControlState().scene else scene,
            session = json.optBoolean("session", false),
            calibrating = json.optBoolean("calibrating", false),
            audioMuted = json.optBoolean("audio", false)
        )
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
        PortalStatus.update(bluetooth?.state ?: "stopped", controlMode)
        try {
            sendBroadcast(Intent(PortalStatus.ACTION_STATUS).setPackage(packageName))
        } catch (ignored: RuntimeException) {
            // No receiver registered; the activity reads the holder on resume.
        }
        refreshNotification()
    }

    private fun buildNotification(): Notification {
        val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        val allApps = PendingIntent.getBroadcast(
            this,
            2,
            Intent(this, PortalReceiver::class.java).setAction(PortalActions.ACTION_ALLAPPS),
            immutable
        )
        val home = PendingIntent.getBroadcast(
            this,
            3,
            Intent(this, PortalReceiver::class.java).setAction(PortalActions.ACTION_HOME),
            immutable
        )
        val content = PendingIntent.getActivity(
            this,
            4,
            Intent(this, PortalActivity::class.java),
            immutable
        )

        val bluetooth = bluetooth
        val state = bluetooth?.state ?: "stopped"
        val headline = when {
            controlMode -> "平板控制中，按一次确认键开始"
            state == "advertising" -> "等待平板连接"
            state == "bluetooth-off" -> "蓝牙未开启"
            else -> "蓝牙不可用"
        }
        val serviceText = "$headline $HOST:$PORT"

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setColor(BrandAssets.ACCENT)
            .setContentTitle("静岸")
            .setContentText(serviceText)
            .setContentIntent(content)
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
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_sort_by_size,
                    "全部应用",
                    allApps
                ).build()
            )
            .addAction(
                Notification.Action.Builder(android.R.drawable.ic_menu_revert, "返回桌面", home).build()
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

    private class HttpError(val status: Int, override val message: String) : RuntimeException(message)
}
