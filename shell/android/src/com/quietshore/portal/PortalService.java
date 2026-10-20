package com.quietshore.portal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * 前台服务：把 APK 内置的 standalone 页面以只读静态 HTTP 暴露在
 * 127.0.0.1:8130（仅 loopback，不监听局域网）。
 *
 * 内容为空或读取失败时返回占位页，保证浏览器永远拿到 HTML 而不是连接错误。
 * 服务只做 GET/HEAD 两个方法、两个路径，没有目录遍历、没有写操作。
 */
public class PortalService extends Service {
    static final int PORT = 8130;

    private static final String TAG = "QuietShorePortal";
    private static final String CHANNEL_ID = "quietshore.entry";
    private static final String CHANNEL_NAME = "静岸";
    private static final String THREAD_NAME = "quietshore-http";
    private static final String HOST = "127.0.0.1";
    private static final String ASSET_NAME = "index.html";
    private static final int NOTIFICATION_ID = 1;
    private static final int REQUEST_TIMEOUT_MS = 5000;
    private static final int BACKLOG = 8;
    private static final int COPY_BUFFER = 8192;

    private static final byte[] FALLBACK_PAGE =
            "<h1>Quiet Shore VR is starting</h1>".getBytes(StandardCharsets.UTF_8);
    private static final byte[] NOT_FOUND =
            "not found".getBytes(StandardCharsets.UTF_8);
    private static final byte[] OK_HEAD =
            ("HTTP/1.1 200 OK\r\n"
                    + "Content-Type: text/html; charset=utf-8\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n"
                    + "Content-Length: ").getBytes(StandardCharsets.US_ASCII);
    private static final byte[] MISSING_HEAD =
            ("HTTP/1.1 404 Not Found\r\n"
                    + "Content-Type: text/plain; charset=utf-8\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n"
                    + "Content-Length: ").getBytes(StandardCharsets.US_ASCII);
    private static final byte[] CRLF_CRLF = "\r\n\r\n".getBytes(StandardCharsets.US_ASCII);

    private volatile boolean running;
    private volatile byte[] page;
    private volatile ServerSocket serverSocket;
    private volatile Thread serverThread;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        startServer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 被系统回收后再拉起：onCreate 已建过通知，这里只需保证 socket 在跑。
        startServer();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        closeQuietly(serverSocket);
        serverSocket = null;
        Thread thread = serverThread;
        serverThread = null;
        if (thread != null) {
            thread.interrupt();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onDestroy();
    }

    private void startServer() {
        if (serverThread != null) {
            return;
        }
        running = true;
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                serveLoop();
            }
        }, THREAD_NAME);
        thread.setDaemon(true);
        serverThread = thread;
        thread.start();
    }

    /** 单线程串行处理：页面自包含，浏览器只会发个位数请求。 */
    private void serveLoop() {
        page = readPage();
        ServerSocket socket = null;
        try {
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(HOST, PORT), BACKLOG);
            serverSocket = socket;
            while (running) {
                Socket client = socket.accept();
                serve(client);
            }
        } catch (IOException error) {
            // 端口被占用或服务正在关闭；通知仍然可用，用户可稍后重试。
            if (running) {
                Log.e(TAG, "loopback server stopped: " + error.getMessage());
            }
        } finally {
            closeQuietly(socket);
            if (serverSocket == socket) {
                serverSocket = null;
            }
            // 端口被占等失败后允许下一次 onStartCommand 重新尝试绑定。
            if (serverThread == Thread.currentThread()) {
                serverThread = null;
            }
        }
    }

    private void serve(Socket client) {
        try {
            client.setSoTimeout(REQUEST_TIMEOUT_MS);
            InputStream in = client.getInputStream();
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(in, StandardCharsets.US_ASCII));

            String requestLine = reader.readLine();
            String line;
            while ((line = reader.readLine()) != null && line.length() > 0) {
                // 丢弃请求头；静态服务不需要任何请求头。
            }

            boolean head = startsWithMethod(requestLine, "HEAD");
            boolean allowed = isServedTarget(requestLine);
            byte[] body = allowed ? currentPage() : NOT_FOUND;

            OutputStream out = client.getOutputStream();
            out.write(allowed ? OK_HEAD : MISSING_HEAD);
            out.write(Integer.toString(body.length).getBytes(StandardCharsets.US_ASCII));
            out.write(CRLF_CRLF);
            if (!head) {
                out.write(body);
            }
            out.flush();
        } catch (IOException error) {
            // 客户端提前断开：忽略。
        } finally {
            closeQuietly(client);
        }
    }

    private byte[] currentPage() {
        byte[] current = page;
        return current != null ? current : FALLBACK_PAGE;
    }

    private static boolean startsWithMethod(String requestLine, String method) {
        return requestLine != null
                && requestLine.length() > method.length()
                && requestLine.startsWith(method);
    }

    /** 只允许 GET/HEAD 访问 / 与 /index.html（忽略查询串）。 */
    private static boolean isServedTarget(String requestLine) {
        if (requestLine == null) {
            return false;
        }
        int firstSpace = requestLine.indexOf(' ');
        if (firstSpace <= 0) {
            return false;
        }
        String method = requestLine.substring(0, firstSpace);
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return false;
        }
        int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
        String target = secondSpace < 0
                ? requestLine.substring(firstSpace + 1)
                : requestLine.substring(firstSpace + 1, secondSpace);
        int queryStart = target.indexOf('?');
        if (queryStart >= 0) {
            target = target.substring(0, queryStart);
        }
        return "/".equals(target) || "/index.html".equals(target);
    }

    private byte[] readPage() {
        InputStream in = null;
        try {
            in = getAssets().open(ASSET_NAME);
            ByteArrayOutputStream out = new ByteArrayOutputStream(COPY_BUFFER * 8);
            byte[] buffer = new byte[COPY_BUFFER];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            byte[] bytes = out.toByteArray();
            return bytes.length > 0 ? bytes : null;
        } catch (IOException error) {
            Log.w(TAG, "asset " + ASSET_NAME + " unavailable: " + error.getMessage());
            return null;
        } finally {
            closeQuietly(in);
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // 已经关闭。
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("本地训练服务入口");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        int immutable = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            immutable |= PendingIntent.FLAG_IMMUTABLE;
        }

        Intent enterIntent = new Intent(this, PortalReceiver.class)
                .setAction(PortalActions.ACTION_ENTER)
                .putExtra(PortalActions.EXTRA_MINIMAL, true);
        PendingIntent enter = PendingIntent.getBroadcast(
                this, 1, enterIntent, immutable);
        PendingIntent allApps = PendingIntent.getBroadcast(
                this, 2,
                new Intent(this, PortalReceiver.class).setAction(PortalActions.ACTION_ALLAPPS),
                immutable);
        PendingIntent home = PendingIntent.getBroadcast(
                this, 3,
                new Intent(this, PortalReceiver.class).setAction(PortalActions.ACTION_HOME),
                immutable);
        PendingIntent content = PendingIntent.getActivity(
                this, 4,
                new Intent(this, MainActivity.class),
                immutable);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setColor(BrandAssets.ACCENT)
                .setContentTitle("静岸")
                .setContentText("本地训练服务运行中 · " + HOST + ":" + PORT)
                .setContentIntent(content)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPriority(Notification.PRIORITY_DEFAULT)
                .setDefaults(0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_play, "进入训练", enter).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_menu_sort_by_size, "全部应用", allApps).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_menu_revert, "返回桌面", home).build());
        return builder.build();
    }
}
