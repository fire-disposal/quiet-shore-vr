package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Side elevation of the patient's head pitch.
 *
 * The corner dial answers "which way is the patient facing"; this one answers
 * "how much is the head tipped", which is the number the operator actually
 * corrects on a bed. Side view, hip as the pivot, head at the far end. The
 * body is ice (a fill, wide enough to read as one), the numbers are ink.
 */
@Composable
fun PitchSideGauge(
    pose: TelemetryPose?,
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    val pitchDeg = if (pose == null) 0.0 else pose.pitch * 180.0 / Math.PI
    val fresh = pose != null && !stale
    val label = if (pose == null) {
        "俯仰 — 未更新"
    } else {
        String.format(Locale.US, "俯仰 %+d°", pitchDeg.roundToInt())
    }

    Column(
        modifier = modifier
            .semantics(mergeDescendants = true) {
                contentDescription = "患者俯仰侧视图，$label"
            }
            .padding(vertical = 4.dp)
    ) {
        Text(
            text = "俯仰",
            style = MaterialTheme.typography.labelSmall,
            color = QuietPalette.TextSecondary
        )
        Canvas(
            modifier = Modifier
                .padding(top = 4.dp)
                .size(width = 132.dp, height = 60.dp)
        ) {
            val w = size.width
            val h = size.height
            val hip = Offset(w * 0.24f, h * 0.8f)
            val length = w * 0.56f

            // Level reference, hairline, no label.
            drawLine(
                color = QuietPalette.InkSecondary.copy(alpha = 0.55f),
                start = Offset(0f, hip.y),
                end = Offset(w, hip.y),
                strokeWidth = 1.dp.toPx()
            )

            // No pose, no body: a flat line on the level reference reads as a
            // slider at one end, which is worse than an empty frame.
            if (pose == null || !fresh) {
                drawCircle(
                    color = QuietPalette.InkSecondary,
                    radius = 3.dp.toPx(),
                    center = hip,
                    style = Stroke(width = 1.dp.toPx())
                )
                return@Canvas
            }

            // Body line + head, rotated by the head pitch (positive = up).
            rotate(degrees = -pitchDeg.toFloat(), pivot = hip) {
                // The body is ink, not the accent: it is a reading, and the
                // accent on this screen belongs to "you can press this".
                drawLine(
                    color = QuietPalette.InkSecondary,
                    start = hip,
                    end = Offset(hip.x + length, hip.y),
                    strokeWidth = 6.dp.toPx(),
                    cap = StrokeCap.Butt
                )
                drawCircle(
                    color = QuietPalette.TextPrimary,
                    radius = 6.dp.toPx(),
                    center = Offset(hip.x + length, hip.y),
                    style = Stroke(width = 1.5.dp.toPx())
                )
            }

            drawCircle(color = QuietPalette.TextPrimary, radius = 2.dp.toPx(), center = hip)
        }
    }
}
