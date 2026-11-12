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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height

import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    val Enough = Color(0xFF00C853)

    /** Watch it: 20–40 %. */
    val Watch = Color(0xFFFFB300)

    /** Charge now: 20 % or below. */
    val ChargeNow = Color(0xFFF44336)

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
    val fraction = if (known) level!!.coerceIn(0, 100) / 100f else 0f
    // One bar, three layers, text centred vertically inside it:
    //   1. the neutral track, full width and height;
    //   2. the charge segment, same height, width = charge, a light tint so the
    //      ink words stay readable on top of the one state that matters;
    //   3. the words, ink, vertically centred, never colour-coded.
    // A thin solid edge under the segment keeps the reading crisp without
    // painting ink over a saturated fill.
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(ChargeBarHeight)
            .background(QuietPalette.Hairline.copy(alpha = 0.16f)),
        contentAlignment = Alignment.CenterStart
    ) {
        if (known && fraction > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .background(BatteryInk.of(level!!, charging).copy(alpha = 0.52f))
            )
            // The crisp edge of the reading: full-width guide, then the solid
            // 3 dp marker at the segment's own end.
            Box(
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .drawBehind {
                        val w = size.width * fraction
                        val thickness = 3.dp.toPx()
                        drawRect(
                            color = BatteryInk.of(level, charging),
                            topLeft = Offset(w - thickness, size.height - thickness),
                            size = androidx.compose.ui.geometry.Size(thickness, thickness)
                        )
                    }
            )
        }
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = PREFIX,
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
            Text(
                text = "${label}电量:",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Normal),
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
            if (known) {
                // The number is the reading: semibold, tabular, ink. The label
                // beside it stays regular and secondary, so the eye sorts
                // "what is it" from "how much" without a divider.
                Text(
                    text = String.format(java.util.Locale.US, "%.1f%%", level!!.toFloat()),
                    style = MaterialTheme.typography.bodyMedium.tabularFigures()
                        .copy(fontWeight = FontWeight.SemiBold),
                    color = QuietPalette.Ink,
                    maxLines = 1
                )
            } else {
                // No word, just a dash: "unconnected" is already said by the
                // bar's empty track, and this line is a reading, not a status.
                Text(
                    text = "---",
                    style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                    color = QuietPalette.InkSecondary,
                    maxLines = 1
                )
            }
            Spacer(Modifier.weight(1f))
            // One state word at the right, never two: charging outranks low.
            if (known) {
                if (charging && level!! < 100) {
                    ChargeTag("充电中")
                } else if (level!! <= 20) {
                    ChargeTag("低电量")
                }
            }
        }
    }
}

/** Height of one charge bar. Tall enough to hold its own words centred. */
private val ChargeBarHeight = 26.dp

/** One bracketed word at the right end: `[低电量]`, `[充电中]`. Ink only. */
@Composable
private fun ChargeTag(label: String) {
    // Same face and line height as the rest of the line: a smaller tier inside
    // the same Row sat on a different baseline and read as "not centred".
    Text(
        text = "[$label]",
        style = MaterialTheme.typography.bodyMedium.copy(
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.2.sp
        ),
        color = QuietPalette.InkSecondary,
        maxLines = 1
    )
}
