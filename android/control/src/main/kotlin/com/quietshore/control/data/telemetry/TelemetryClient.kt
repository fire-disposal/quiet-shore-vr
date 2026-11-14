package com.quietshore.control.data.telemetry

import android.util.Log
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * One POST to the fixed aggregation endpoint, and what came back.
 *
 * `HttpURLConnection` rather than a networking library: the app has to talk to
 * exactly one fixed address with one fixed body and needs redirects off, timeouts
 * bounded, and no retry inside the library competing with the outbox's own
 * backoff. The uploader owns retry; this class owns one attempt.
 */
class TelemetryClient(
    private val endpoint: String = TelemetryProtocol.ENDPOINT,
    private val connectTimeoutMs: Int = CONNECT_TIMEOUT_MS,
    private val readTimeoutMs: Int = READ_TIMEOUT_MS
) {
    /** The result of one attempt; only [Acknowledged] may clear the outbox. */
    sealed interface Result {
        /** A 2xx body that parsed and named a version we understand. */
        data class Acknowledged(val response: TelemetryProtocol.TelemetryResponse.Success) : Result

        /**
         * Anything that is not an acknowledged batch: no link, a timeout, a
         * non-2xx status, a body that is not the contracted JSON, or a version
         * we do not speak. The batch is kept and retried later.
         */
        data class Failed(val reason: String) : Result
    }

    /**
     * Posts one batch.
     *
     * Never throws: every failure mode — including a malformed URL, which is a
     * build-time mistake rather than a runtime one — comes back as
     * [Result.Failed] so the caller has exactly one path to handle.
     */
    fun post(deviceId: String, records: List<TelemetryRecord>): Result {
        if (records.isEmpty()) {
            return Result.Failed("empty batch")
        }
        if (records.size > TelemetryProtocol.MAX_BATCH) {
            return Result.Failed("batch of ${records.size} exceeds the contract")
        }
        val body = TelemetryProtocol.encodeBatch(deviceId, records)
        var opened: HttpURLConnection? = null
        return try {
            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                instanceFollowRedirects = false
                doInput = true
                doOutput = true
                useCaches = false
                connectTimeout = connectTimeoutMs
                readTimeout = readTimeoutMs
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                setFixedLengthStreamingMode(body.toByteArray(Charsets.UTF_8).size)
            }
            opened = connection
            connection.outputStream.use { stream ->
                stream.write(body.toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                // The error body is drained but not interpreted: an error page
                // is never an acknowledgement.
                connection.errorStream?.use { it.readBytes() }
                Result.Failed("http $status")
            } else {
                val text = connection.inputStream
                    .bufferedReader(Charsets.UTF_8)
                    .use { it.readText() }
                when (val parsed = TelemetryProtocol.parseResponse(text)) {
                    is TelemetryProtocol.TelemetryResponse.Success -> Result.Acknowledged(parsed)
                    is TelemetryProtocol.TelemetryResponse.Failure -> Result.Failed(parsed.reason)
                }
            }
        } catch (error: IOException) {
            Result.Failed(error.message ?: "network error")
        } catch (error: Exception) {
            // A SecurityException (no INTERNET permission), a bad URL, or a
            // runtime the platform throws out of `openConnection`: still one
            // failed attempt, still retried.
            Log.w(TAG, "telemetry post failed: ${error.message}")
            Result.Failed(error.message ?: error.javaClass.simpleName)
        } finally {
            opened?.disconnect()
        }
    }

    private companion object {
        const val TAG = "QuietShoreTelemetry"

        /** Long enough for a ward's mobile link, short enough not to hold a wakelock. */
        const val CONNECT_TIMEOUT_MS = 10_000

        /** The server has one small body to write; ten seconds is generous. */
        const val READ_TIMEOUT_MS = 20_000
    }
}
