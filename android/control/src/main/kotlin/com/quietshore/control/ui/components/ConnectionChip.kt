package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.ui.theme.QuietPalette

/**
 * "已连接" is a claim about *now*, not about a handshake that happened once.
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

/** Map a wire phase onto the console's three-state presence mark. */
fun presenceOf(phase: BlePhase, stale: Boolean = false): Presence = when (phase) {
    BlePhase.READY -> if (stale) Presence.Waiting else Presence.Live
    BlePhase.SCANNING, BlePhase.CONNECTING, BlePhase.AUTHENTICATING,
    BlePhase.RECONNECTING -> Presence.Waiting
    BlePhase.ERROR, BlePhase.DISCONNECTED, BlePhase.IDLE -> Presence.Offline
}

/** True when the link's word is the thing the operator must act on. */
fun phaseNeedsAttention(phase: BlePhase, stale: Boolean = false): Boolean = when (phase) {
    BlePhase.READY -> stale
    BlePhase.SCANNING, BlePhase.CONNECTING, BlePhase.AUTHENTICATING,
    BlePhase.RECONNECTING -> true
    else -> false
}

/** Four steps, RSSI banded; used by the pairing screen. */
fun signalLevel(rssi: Int): Int = when {
    rssi >= -55 -> 4
    rssi >= -67 -> 3
    rssi >= -80 -> 2
    else -> 1
}

/**
 * The link state on paper: presence mark, then words, then the signal meter.
 * No pill, no fill — the board behind it is already the fill.
 */
@Composable
fun ConnectionChip(
    phase: BlePhase,
    modifier: Modifier = Modifier,
    stale: Boolean = false,
    rssi: Int? = null
) {
    Row(
        modifier = modifier
            .height(48.dp)
            .semantics(mergeDescendants = true) { contentDescription = phaseLabel(phase, stale) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        PresenceMark(presenceOf(phase, stale))
        Text(
            text = phaseLabel(phase, stale),
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            maxLines = 1
        )
        SignalBars(rssi = rssi)
    }
}

/** Four bars, ink on paper. */
@Composable
fun SignalBars(
    rssi: Int?,
    modifier: Modifier = Modifier
) {
    val level = rssi?.let(::signalLevel) ?: 0
    val description = if (rssi == null) "信号未知" else "信号强度 $level"
    Row(
        modifier = modifier
            .height(18.dp)
            .semantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        repeat(4) { index ->
            Box(
                Modifier
                    .width(4.dp)
                    .height((7 + index * 4).dp)
                    .background(if (index < level) QuietPalette.Ink else QuietPalette.Hairline)
            )
        }
    }
}

/** A thin vertical rule between two facts on a row. */
@Composable
fun InlineRule() {
    Box(
        Modifier
            .width(1.dp)
            .height(20.dp)
            .background(QuietPalette.Hairline)
    )
}
