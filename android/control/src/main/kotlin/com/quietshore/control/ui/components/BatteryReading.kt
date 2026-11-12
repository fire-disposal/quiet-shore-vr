package com.quietshore.control.ui.components

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.Battery
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Device charge, in the convention every battery indicator already uses.
 *
 * **These three colours are deliberately outside the palette.** The console's
 * rule is "red belongs to the stop"; a battery at 8 % is not that rule's
 * business — it is the oldest colour convention there is, and repainting it in
 * the interface's own colours would make the operator read a legend. The user
 * named this exception explicitly, so when a later pass "tightens the palette",
 * this file is the one that must be left alone.
 *
 * | charge   | colour   | meaning   |
 * | -------- | -------- | --------- |
 * | > 40 %   | green    | enough    |
 * | 20–40 %  | amber    | watch it  |
 * | ≤ 20 %   | red      | charge now|
 * | charging | green + 「充电」, no bolt icon |
 */
object BatteryInk {
    /** Enough. */
    val Enough = Color(0xFF43A047)

    /** Watch it: 20–40 %. */
    val Watch = Color(0xFFF9A825)

    /** Charge now: 20 % or below. */
    val ChargeNow = Color(0xFFD32F2F)

    /** The one the reading takes, by charge. */
    fun of(level: Int, charging: Boolean): Color = when {
        charging -> Enough
        level > 40 -> Enough
        level > 20 -> Watch
        else -> ChargeNow
    }
}

/** The bar's width is fixed so two readings never shift as percentages change. */
private val BarWidth = 96.dp
private val BarHeight = 6.dp

/** A 6 dp rule under the reading: grey track, charge-coloured fill. */
@Composable
private fun ChargeBar(level: Int, color: Color) {
    Box(
        Modifier
            .width(BarWidth)
            .height(BarHeight)
            .background(QuietPalette.Hairline)
    ) {
        Box(
            Modifier
                .height(BarHeight)
                .width(BarWidth * level.coerceIn(0, 100) / 100f)
                .background(color)
        )
    }
}

/**
 * One device's charge: name and percentage on the two ends of a fixed bar,
 * charging written as a word after the figure rather than as an icon.
 */
@Composable
fun BatteryReading(
    label: String,
    level: Int,
    charging: Boolean,
    modifier: Modifier = Modifier
) {
    val known = level in 0..100
    val ink = if (known) BatteryInk.of(level, charging) else QuietPalette.InkSecondary
    Column(modifier.defaultMinSize(minHeight = 48.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (known) "${level.coerceIn(0, 100)}%" else "—",
                style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                color = ink,
                maxLines = 1
            )
            if (charging && known) {
                Text(
                    text = " 充电",
                    style = MaterialTheme.typography.bodySmall,
                    color = ink,
                    maxLines = 1
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        ChargeBar(level = if (known) level else 0, color = ink)
    }
}

/** The tablet's own charge, read from the sticky battery broadcast. */
@Composable
fun rememberTabletBattery(): Battery? {
    val context = LocalContext.current
    var reading by remember { mutableStateOf(readBattery(context)) }
    DisposableEffect(context) {
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                readBattery(context)?.let { reading = it }
            }
        }
        context.registerReceiver(
            receiver,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        )
        onDispose { runCatching { context.unregisterReceiver(receiver) } }
    }
    return reading
}

private fun readBattery(context: Context): Battery? {
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        ?: return null
    val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    if (level !in 0..100) return null
    val status = context.registerReceiver(
        null,
        IntentFilter(Intent.ACTION_BATTERY_CHANGED)
    )?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
    return Battery(level = level, charging = charging)
}
