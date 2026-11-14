package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    fun of(level: Int): Color = when {
        level > 40 -> Enough
        level > 20 -> Watch
        else -> ChargeNow
    }
}

/** One line: `//头显电量48%` or `//头显未连接`. */
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
    modifier: Modifier = Modifier,
    compact: Boolean = false
) {
    val known = level != null && level in 0..100
    val fraction = if (known) level!!.coerceIn(0, 100) / 100f else 0f
    val ink = if (known) BatteryInk.of(level!!) else QuietPalette.InkSecondary
    val wordStyle = MaterialTheme.typography.bodyLarge.tabularFigures()
        .copy(lineHeight = 20.sp, fontWeight = FontWeight.SemiBold)
    // One bar, and the reading inside it. Two things were wrong with the old
    // one and both were alignment: the value sat wherever the label ended, so
    // the two rows' numbers never lined up, and a 3 dp marker at the segment's
    // edge floated beside the text it was supposed to measure. The value is now
    // a fixed column at the right and the segment is its own edge.
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
                    .background(ink.copy(alpha = 0.22f))
            )
        }
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 12.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (compact) "$PREFIX$label" else "$PREFIX$label" + "电量",
                style = wordStyle,
                color = if (known) QuietPalette.Ink else QuietPalette.InkSecondary,
                maxLines = 1
            )
            Spacer(Modifier.width(if (compact) 6.dp else 10.dp))
            // One state word, before the value: after it, the value column
            // would move whenever a device started charging. The compact field
            // keeps the number and drops the word; the tinted fill still shows
            // that charge is present.
            if (known && !compact) {
                when {
                    charging && level!! >= 100 -> ChargeTag("已充满")
                    charging -> ChargeTag("充电中")
                    level!! <= 20 -> ChargeTag("低电量")
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                text = if (known) "$level%" else "---",
                style = wordStyle,
                color = ink,
                maxLines = 1
            )
        }
    }
}

/** One charge bar: tall enough to hold its own words with air above and below. */
private val ChargeBarHeight = 32.dp

/** One bracketed word at the right end: `[低电量]`, `[充电中]`. Ink only. */
@Composable
private fun ChargeTag(label: String) {
    // Same face and line height as the rest of the line: a smaller tier inside
    // the same Row sat on a different baseline and read as "not centred".
    Text(
        text = "[$label]",
        style = MaterialTheme.typography.bodyLarge.copy(
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.2.sp
        ),
        color = QuietPalette.InkSecondary,
        maxLines = 1
    )
}
