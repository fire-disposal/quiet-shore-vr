package com.quietshore.control.ui.components

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.rememberMotionEnabled

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
 * | charge   | colour   | meaning    |
 * | -------- | -------- | ---------- |
 * | > 40 %   | green    | enough     |
 * | 20–40 %  | amber    | watch it   |
 * | ≤ 20 %   | red      | charge now |
 * | charging | green + a travelling band; no bolt icon |
 *
 * **One loop, on purpose.** The skill forbids looping decoration; this is not
 * decoration. "Energy is arriving" is a continuous state with no discrete
 * event to fire on, and the only static marks available either mean "done"
 * (a full fill) or read as debris (a hatch). So the pad — and only the pad,
 * which is a normal phone-class device — gets one 24 dp highlight sweeping its
 * fill every 2.4 s. The headset never gets it: it is a PICO-class device
 * rendering a WebGL page, and the last thing it needs is our composition
 * clock. Nothing is loaded, nothing is allocated per frame: one `drawRect` in
 * a `drawBehind`, driven by one interpolated float.
 */
object BatteryInk {
    /** Enough. */
    val Enough = Color(0xFF43A047)

    /** Watch it: 20–40 %. */
    val Watch = Color(0xFFF9A825)

    /** Charge now: 20 % or below. */
    val ChargeNow = Color(0xFFD32F2F)

    /**
     * The one the reading takes, by charge.
     *
     * Charging does not turn a low battery green: a 12 % pad on a cable that is
     * not seated is still a 12 % pad, and the operator would read green and
     * walk away. Green arrives when the charge does.
     */
    fun of(level: Int, charging: Boolean): Color = when {
        level > 40 -> Enough
        level > 20 -> Watch
        else -> ChargeNow
    }
}

/**
 * One bracketed word at the right end: `[低电量]`, `[充电中]`.
 *
 * Square, monospaced figures, never pressable — it is a state printed on the
 * line, not a control, so it takes no shape and no cut corner.
 */
@Composable
private fun ChargeTag(label: String, ink: Color) {
    Text(
        text = "[$label]",
        style = MaterialTheme.typography.bodyMedium.tabularFigures(),
        color = ink,
        maxLines = 1
    )
}

/** Colours, and nothing else: the bars are gone. */

/** One line: `//头显电量:48.9%` or `//头显未连接`. */
private const val PREFIX = "//"

/**
 * The charge as a field, not a bar.
 *
 * ```text
 *   //头显电量:48.9%
 *   //平板电量:23.0% 充电
 * ```
 *
 * The `//` is the console's field prefix: it says "this is telemetry", the
 * same way a route reads `//STATE`. The figure is the only coloured part —
 * green above 40 %, amber 20–40 %, red at or below 20 % — in the device
 * convention rather than the interface palette. Charging adds a word and
 * changes no colour, because a 12 % pad on a loose cable is still a 12 % pad.
 * No data is written out in words (`//头显未连接`) instead of drawing an empty
 * bar or a dash that could be read as zero.
 */
@Composable
fun BatteryField(
    label: String,
    level: Int?,
    charging: Boolean,
    modifier: Modifier = Modifier
) {
    val known = level != null && level in 0..100
    val ink = if (known) BatteryInk.of(level!!, charging) else QuietPalette.InkSecondary
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = PREFIX,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
        Text(
            text = "${label}电量:",
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
        if (known) {
            Text(
                text = String.format(java.util.Locale.US, "%.1f%%", level!!.toFloat()),
                style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                color = ink,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            // The state tags sit at the right end, so the reading stays a
            // reading and the state is one word in brackets. Order is fixed:
            // low charge first, then charging.
            if (level <= 20) {
                ChargeTag(label = "低电量", ink = BatteryInk.ChargeNow)
            }
            if (charging && level < 100) {
                if (level <= 20) Spacer(Modifier.width(8.dp))
                ChargeTag(label = "充电中", ink = BatteryInk.Enough)
            }
        } else {
            // No number at all: "未连接" is a state, a dash is an empty gauge.
            Spacer(Modifier.weight(1f))
            Text(
                text = "未连接",
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
        }
    }
}
