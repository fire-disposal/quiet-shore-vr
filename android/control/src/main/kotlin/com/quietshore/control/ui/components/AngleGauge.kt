package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Read-only heading dial for the patient pose.
 *
 * The ring is a compass with a needle for yaw, the crosshair is the level
 * reference, and the bubble slides up or down with pitch. Nothing here is
 * interactive: it is a corner overlay and must never eat viewport gestures.
 */
@Composable
fun AngleGauge(
    pose: TelemetryPose?,
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    val current = pose
    val fresh = current != null && !stale
    val accent = if (fresh) QuietPalette.Accent else QuietPalette.Warning
    val description = if (current != null && fresh) {
        String.format(
            Locale.US,
            "患者朝向，偏航 %d 度，俯仰 %d 度",
            degrees(current.yaw).roundToInt(),
            degrees(current.pitch).roundToInt()
        )
    } else {
        "患者姿态未更新"
    }

    Surface(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description },
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface,
        contentColor = QuietPalette.TextPrimary
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AngleDial(pose = pose, fresh = fresh, accent = accent)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = if (fresh) "患者朝向" else "无数据",
                    style = MaterialTheme.typography.labelLarge,
                    color = accent
                )
                Text(
                    text = angleLine("偏航", pose?.let { degrees(it.yaw) }, fresh),
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextPrimary
                )
                Text(
                    text = angleLine("俯仰", pose?.let { degrees(it.pitch) }, fresh),
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextPrimary
                )
            }
        }
    }
}

@Composable
private fun AngleDial(
    pose: TelemetryPose?,
    fresh: Boolean,
    accent: Color
) {
    Canvas(modifier = Modifier.size(74.dp)) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val radius = size.minDimension / 2f - 2.dp.toPx()
        val inner = radius * 0.72f
        val ringColor = if (fresh) QuietPalette.Outline else QuietPalette.Outline.copy(alpha = 0.55f)

        // Fixed frame: outer compass ring plus the level reference cross.
        drawCircle(
            color = ringColor,
            radius = radius,
            center = center,
            style = Stroke(width = 1.5.dp.toPx())
        )
        drawCircle(
            color = ringColor,
            radius = radius * 0.18f,
            center = center,
            style = Stroke(width = 1.dp.toPx())
        )
        val pitchDegrees = pose?.let { degrees(it.pitch) } ?: 0f
        val levelColor = if (fresh && pose != null && abs(pitchDegrees) <= LEVEL_DEGREES) {
            QuietPalette.Success
        } else {
            QuietPalette.TextSecondary.copy(alpha = 0.55f)
        }
        drawLine(
            color = levelColor,
            start = Offset(center.x - inner, center.y),
            end = Offset(center.x + inner, center.y),
            strokeWidth = 1.5.dp.toPx(),
            cap = StrokeCap.Round
        )
        drawLine(
            color = QuietPalette.TextSecondary.copy(alpha = 0.35f),
            start = Offset(center.x, center.y - inner),
            end = Offset(center.x, center.y + inner),
            strokeWidth = 1.dp.toPx()
        )

        if (!fresh || pose == null) {
            // Stale: no needle, no bubble. An old heading is worse than none.
            drawCircle(color = accent.copy(alpha = 0.35f), radius = 3.dp.toPx(), center = center)
            return@Canvas
        }

        // Three.js Y rotation is counter-clockwise seen from above; Canvas
        // rotate() is clockwise, so negate to match the 3D patient marker.
        rotate(degrees = -degrees(pose.yaw), pivot = center) {
            val tip = Offset(center.x, center.y - radius * 0.8f)
            drawLine(
                color = accent,
                start = center,
                end = tip,
                strokeWidth = 2.dp.toPx(),
                cap = StrokeCap.Round
            )
            drawCircle(color = accent, radius = 2.5.dp.toPx(), center = tip)
        }

        val pitchOffset = (degrees(pose.pitch) / PITCH_FULL_SCALE_DEGREES).coerceIn(-1f, 1f)
        drawCircle(
            color = QuietPalette.Primary,
            radius = 3.5.dp.toPx(),
            center = Offset(center.x, center.y - pitchOffset * inner)
        )
    }
}

/** Wire pose is radians; every visible angle is degrees. */
private fun degrees(radians: Float): Float =
    Math.toDegrees(radians.toDouble()).toFloat()

private fun angleLine(label: String, value: Float?, fresh: Boolean): String =
    if (!fresh || value == null) {
        "$label —"
    } else {
        String.format(Locale.US, "%s %d°", label, value.roundToInt())
    }

/** Pitch treated as level while the patient holds this band. */
private const val LEVEL_DEGREES = 3f

/** Pitch is clamped to the dial edge at this angle. */
private const val PITCH_FULL_SCALE_DEGREES = 60f
