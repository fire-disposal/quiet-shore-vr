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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.Color
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

/** The one motion curve outside the sweep: mech, short, no overshoot. */
private val Mech = CubicBezierEasing(0.7f, 0f, 0.2f, 1f)
private const val TUNE_MS = 280

/** Sweep: 1 s of travel, 1.4 s of rest, so one period is about 2.4 s. */
private const val SWEEP_MS = 1000
private const val HOLD_MS = 1400
private const val BAND_DP = 24

/**
 * One battery as a single bar: the label sits inside at the left end, the
 * figure inside at the right end, and the fill underneath *is* the reading —
 * there is no second column of text beside it.
 *
 * [animateCharge] turns on the pad's sweep. It is a parameter rather than a
 * guess from [label], because the reason is about the device: the headset is
 * busy rendering Web3D and must not be asked to run our animation clock.
 */
@Composable
fun BatteryBar(
    label: String,
    level: Int,
    charging: Boolean,
    modifier: Modifier = Modifier,
    animateCharge: Boolean = false
) {
    val known = level in 0..100
    val ink = if (known) BatteryInk.of(level, charging) else QuietPalette.InkSecondary
    val fraction = if (known) level.coerceIn(0, 100) / 100f else 0f
    val motion = rememberMotionEnabled()

    // A change of charge retunes rather than jumping; same curve everywhere.
    val fill by animateFloatAsState(
        targetValue = fraction,
        animationSpec = tween(if (motion) TUNE_MS else 0, easing = Mech),
        label = "charge-fill"
    )

    // The sweep runs only while there is room left to fill: a full battery is
    // not receiving anything, and a bar that keeps moving at 100 % would be
    // the decorative loop the skill rules out.
    val sweeping = animateCharge && charging && known && level < 100 && motion
    val phase = if (sweeping) {
        val transition = rememberInfiniteTransition(label = "charge-sweep")
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(SWEEP_MS + HOLD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            ),
            label = "charge-phase"
        ).value
    } else {
        0f
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(if (animateCharge) 24.dp else 22.dp)
            .background(QuietPalette.Hairline)
            .clipToBounds()
    ) {
        val barWidth = maxWidth
        val filled = barWidth * fill
        // Track, then fill drawn with the sweep inside it. `drawBehind` keeps
        // this to one rect per frame and allocates nothing else.
        Box(
            Modifier
                .fillMaxHeight()
                .width(filled)
                .background(ink)
                .drawBehind {
                    if (!sweeping) return@drawBehind
                    // 0 → 1 covers travel then hold: the band is on screen only
                    // during the first 1000 ms of the 2400 ms period.
                    val travel = (phase * (SWEEP_MS + HOLD_MS) / SWEEP_MS)
                    if (travel > 1f) return@drawBehind
                    val bandPx = BAND_DP.dp.toPx()
                    val x = -bandPx + travel * (size.width + bandPx)
                    val bright = lerp(ink, Color.White, 0.55f)
                    drawRect(
                        color = bright,
                        topLeft = Offset(x, 0f),
                        size = androidx.compose.ui.geometry.Size(bandPx, size.height)
                    )
                }
        )

        // The label sits over the fill and takes reverse ink; the figure sits
        // at the far end, over the empty track, and takes ink. Both are inside
        // the bar: there is no text column beside it.
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = if (fill > 0.10f) QuietPalette.Paper else QuietPalette.Ink,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (known) "${level.coerceIn(0, 100)}%" else "—",
                style = MaterialTheme.typography.labelMedium.tabularFigures(),
                color = QuietPalette.Ink,
                maxLines = 1
            )
            if (charging && known) {
                Text(
                    text = " 充电",
                    style = MaterialTheme.typography.labelMedium,
                    color = QuietPalette.Ink,
                    maxLines = 1
                )
            }
        }
    }
}
