package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.ui.theme.QuietPalette

/**
 * "已连接" is a claim about *now*, not about the handshake that happened once.
 * A ready link with no state frames for two seconds is reported as degraded.
 */
fun phaseLabel(phase: BlePhase, stale: Boolean = false): String = when (phase) {
    BlePhase.READY -> if (stale) "连接受限" else "已连接"
    else -> phaseLabelBase(phase)
}

private fun phaseLabelBase(phase: BlePhase): String = when (phase) {
    BlePhase.IDLE -> "未连接"
    BlePhase.SCANNING -> "搜索头显"
    BlePhase.CONNECTING, BlePhase.AUTHENTICATING -> "连接中"
    BlePhase.READY -> "已连接"
    BlePhase.RECONNECTING -> "重连中"
    BlePhase.ERROR -> "连接失败"
    BlePhase.DISCONNECTED -> "已断开"
}

fun phaseColor(phase: BlePhase, stale: Boolean = false): Color = when (phase) {
    BlePhase.READY -> if (stale) QuietPalette.Warning else QuietPalette.Success
    BlePhase.CONNECTING, BlePhase.AUTHENTICATING, BlePhase.SCANNING,
    BlePhase.RECONNECTING -> QuietPalette.Warning
    BlePhase.ERROR -> QuietPalette.Danger
    BlePhase.IDLE, BlePhase.DISCONNECTED -> QuietPalette.TextSecondary
}

fun signalLevel(rssi: Int): Int = when {
    rssi >= -55 -> 4
    rssi >= -67 -> 3
    rssi >= -80 -> 2
    else -> 1
}

@Composable
fun ConnectionChip(
    phase: BlePhase,
    modifier: Modifier = Modifier,
    stale: Boolean = false
) {
    val color = phaseColor(phase, stale)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.14f),
        contentColor = color
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Spacer(Modifier.width(8.dp))
            Text(phaseLabel(phase), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun SignalBars(
    rssi: Int?,
    modifier: Modifier = Modifier
) {
    val level = rssi?.let(::signalLevel) ?: 0
    val description = if (rssi == null) "信号未知" else "信号强度 $level"
    Row(
        modifier = modifier
            .height(16.dp)
            .semantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        repeat(4) { index ->
            Box(
                Modifier
                    .width(3.dp)
                    .height((5 + index * 3).dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (index < level) QuietPalette.Primary else QuietPalette.Outline)
            )
        }
    }
}
