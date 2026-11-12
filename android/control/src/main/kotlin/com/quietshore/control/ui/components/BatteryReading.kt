package com.quietshore.control.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
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
 * | charging | green + a static hatch, and the word 「充电」; no bolt icon |
 *
 * Charging is a *state*, not an event, so it is drawn as one: a fixed 45°
 * hatch over the green fill, not a loop. The only motion is the two the skill
 * allows — a 280 ms mech retune when the number changes, and one 280 ms wipe
 * when a cable goes in — and both stop when the system asks for less motion.
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

/** Fixed track width so two readings never shift as percentages change. */
private val BarWidth = 96.dp
private val BarHeight = 6.dp

/** The one motion curve on this file: mech, short, no overshoot. */
private val Mech = CubicBezierEasing(0.7f, 0f, 0.2f, 1f)
private const val CHARGE_MS = 280

/**
 * The bar: grey track, coloured fill, and — while charging — the static hatch
 * that says "energy is coming in" without a single frame of animation.
 */
@Composable
private fun ChargeBar(level: Int, color: Color, charging: Boolean) {
    val enabled = rememberMotionEnabled()
    val target = level.coerceIn(0, 100) / 100f
    // A change of value retunes; it does not jump. Same curve in both states.
    val fill by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(if (enabled) CHARGE_MS else 0, easing = Mech),
        label = "charge-fill"
    )

    // One wipe when the cable goes in, then still. A keyed Animatable restarts
    // on the false→true edge and is left at rest afterwards.
    val wipe = remember { Animatable(1f) }
    var wasCharging by remember { mutableStateOf(charging) }
    LaunchedEffect(charging) {
        if (charging && !wasCharging && enabled) {
            wipe.snapTo(0f)
            wipe.animateTo(1f, tween(CHARGE_MS, easing = Mech))
        } else {
            wipe.snapTo(1f)
        }
        wasCharging = charging
    }

    Box(
        Modifier
            .width(BarWidth)
            .height(BarHeight)
            .background(QuietPalette.Hairline)
            .clipToBounds()
    ) {
        Box(
            Modifier
                .height(BarHeight)
                .width(BarWidth * fill)
                .background(color)
                .drawWithContent {
                    drawContent()
                    // Static 45° hatch: 1.5 dp lines every 9.2 dp. The skill's
                    // "in progress" mark — and it costs nothing per frame,
                    // because it never changes between frames.
                    if (charging) {
                        val step = 9.2.dp.toPx()
                        val stroke = 1.5.dp.toPx()
                        val light = Color.White.copy(alpha = 0.55f)
                        var x = -size.height
                        while (x < size.width + size.height) {
                            drawLine(
                                color = light,
                                start = Offset(x, size.height),
                                end = Offset(x + size.height, 0f),
                                strokeWidth = stroke
                            )
                            x += step
                        }
                    }
                }
                // The wipe: one bright pass across the fill, then still.
                .drawWithContent {
                    drawContent()
                    val edge = size.width * wipe.value
                    if (edge > 0f && wipe.value < 1f) {
                        drawRect(
                            color = Color.White.copy(alpha = 0.35f),
                            topLeft = Offset.Zero,
                            size = Size(edge, size.height)
                        )
                    }
                }
        )
    }
}

/**
 * One device's charge: name and percentage at the two ends of a fixed bar,
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
    Column(modifier.defaultMinSize(minHeight = 44.dp)) {
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
        Spacer(Modifier.height(5.dp))
        ChargeBar(
            level = if (known) level else 0,
            color = ink,
            charging = charging && known
        )
    }
}
