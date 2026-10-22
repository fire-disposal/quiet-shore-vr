package com.quietshore.control.recording

import android.content.Context
import android.os.Environment
import android.util.Base64
import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/** The control screen's narrow handle on the WebView recorder. */
interface ControllerRecorder {
    fun startRecording()

    fun stopRecording()
}

/** What the page reports back about the clip it is writing. */
sealed interface RecordingEvent {
    data class Started(val mimeType: String) : RecordingEvent

    data class Saved(
        val path: String,
        val bytes: Long,
        val durationMs: Long
    ) : RecordingEvent

    data class Failed(val message: String) : RecordingEvent
}

/**
 * Receives the base64 slices of the controller page's canvas recording.
 *
 * The page cannot hand a file to the APK, so it walks the finished Blob in
 * 256 KiB slices and calls [android.webkit.JavascriptInterface] once per
 * slice. Every slice is decoded and written on one background thread, which
 * keeps the WebView thread free and preserves byte order without any lock on
 * the bridge call itself.
 */
class ViewportRecorder(
    context: Context,
    private val events: (RecordingEvent) -> Unit
) {

    private val appContext = context.applicationContext
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "viewport-recorder").apply { isDaemon = true }
    }

    @Volatile
    private var active = false
    private var target: File? = null
    private var output: BufferedOutputStream? = null
    private var bytes = 0L
    private var startedAt = 0L

    /** The page started the encoder; create the file eagerly so failures surface. */
    fun begin(mimeType: String) {
        if (active) {
            return
        }
        active = true
        startedAt = System.currentTimeMillis()
        val extension = if (mimeType.startsWith("video/mp4", ignoreCase = true)) "mp4" else "webm"
        val name = "QS-" + STAMP.format(Date()) + "." + extension
        executor.execute {
            try {
                val directory = recordingDirectory()
                if (!directory.exists() && !directory.mkdirs()) {
                    throw IllegalStateException("无法创建录像目录")
                }
                val file = File(directory, name)
                target = file
                output = BufferedOutputStream(FileOutputStream(file), BUFFER_BYTES)
                bytes = 0L
                events(RecordingEvent.Started(mimeType))
            } catch (error: Exception) {
                Log.w(TAG, "cannot start recording: ${error.message}")
                active = false
                events(RecordingEvent.Failed("无法创建录像文件"))
            }
        }
    }

    /** Appends one base64 slice; called directly from the JS bridge. */
    fun append(base64: String) {
        if (!active) {
            return
        }
        executor.execute {
            val sink = output ?: return@execute
            try {
                val chunk = Base64.decode(base64, Base64.DEFAULT)
                bytes += chunk.size
                if (bytes > MAX_BYTES) {
                    failLocked("录像超过 ${MAX_BYTES / (1024 * 1024)} MB 上限")
                    return@execute
                }
                sink.write(chunk)
            } catch (error: Exception) {
                Log.w(TAG, "recording write failed: ${error.message}")
                failLocked("写入录像失败")
            }
        }
    }

    /** The page delivered the last slice; close and publish the file. */
    fun finish() {
        if (!active) {
            return
        }
        active = false
        executor.execute {
            val file = target
            try {
                output?.flush()
                output?.close()
            } catch (error: Exception) {
                Log.w(TAG, "recording close failed: ${error.message}")
            }
            output = null
            target = null
            if (file == null || bytes == 0L) {
                file?.delete()
                events(RecordingEvent.Failed("录像为空"))
                return@execute
            }
            events(
                RecordingEvent.Saved(
                    path = file.absolutePath,
                    bytes = bytes,
                    durationMs = System.currentTimeMillis() - startedAt
                )
            )
        }
    }

    /**
     * Abandon the clip (page reload, activity teardown, renderer crash).
     * Returns true only when a recording was actually in progress.
     */
    fun cancel(): Boolean {
        if (!active) {
            return false
        }
        active = false
        executor.execute { discardLocked() }
        return true
    }

    fun shutdown() {
        active = false
        executor.execute { discardLocked() }
        executor.shutdown()
    }

    private fun failLocked(message: String) {
        active = false
        discardLocked()
        events(RecordingEvent.Failed(message))
    }

    private fun discardLocked() {
        try {
            output?.flush()
            output?.close()
        } catch (ignored: Exception) {
            // The stream is already broken; deleting the partial file is enough.
        }
        output = null
        target?.delete()
        target = null
        bytes = 0L
    }

    /**
     * App-specific external storage needs no runtime permission and stays
     * shareable through the FileProvider declared in the manifest.
     */
    private fun recordingDirectory(): File {
        val base = appContext.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
            ?: File(appContext.filesDir, "recordings")
        return File(base, "recordings")
    }

    private companion object {
        const val TAG = "QuietShoreRecorder"
        const val BUFFER_BYTES = 64 * 1024
        const val MAX_BYTES = 512L * 1024 * 1024
        val STAMP: SimpleDateFormat = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US)
    }
}
