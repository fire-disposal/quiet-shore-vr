package com.quietshore.control.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** The tablet's own battery: percent, and whether a cable is in. */
data class PadBattery(val level: Int, val charging: Boolean)

/**
 * The pad's battery, read from the sticky [Intent.ACTION_BATTERY_CHANGED].
 *
 * Sticky means no polling and no wake-ups: registering the receiver hands back
 * the current value immediately and then only on change. Null until the first
 * value arrives (a second at most), and the bar simply shows nothing until
 * then rather than a zero.
 */
@Composable
fun rememberPadBattery(): PadBattery? {
    val context = LocalContext.current
    var battery by remember { mutableStateOf<PadBattery?>(null) }
    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                read(intent)?.let { battery = it }
            }
        }
        val sticky = context.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        sticky?.let { battery = read(it) }
        onDispose { context.unregisterReceiver(receiver) }
    }
    return battery
}

private fun read(intent: Intent): PadBattery? {
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level < 0 || scale <= 0) {
        return null
    }
    val percent = (level * 100 / scale).coerceIn(0, 100)
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
    return PadBattery(percent, charging)
}
