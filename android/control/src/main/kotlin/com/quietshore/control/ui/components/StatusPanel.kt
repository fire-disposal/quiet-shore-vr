package com.quietshore.control.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.Scenes
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Expandable strip below the top-left info bar. Keeps diagnostics out of the
 * control tabs so the rail only carries actions.
 */
@Composable
fun StatusPanel(
    state: ControlUiState,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface.copy(alpha = 0.96f),
        border = BorderStroke(1.dp, QuietPalette.Outline)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "状态与日志",
                style = MaterialTheme.typography.labelLarge,
                color = QuietPalette.TextSecondary
            )
            StatusSummary(state)
            state.notice?.let { message ->
                Text(
                    text = "消息：$message",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            state.error?.let { message ->
                Text(
                    text = "错误：$message",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.Danger
                )
            }
            Text(
                text = "再次点击左上信息条收起",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary.copy(alpha = 0.7f)
            )
        }
    }
}

@Composable
private fun StatusSummary(state: ControlUiState) {
    val pose = state.pose
    val fresh = pose != null && !state.poseStale
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SummaryRow("患者场景", Scenes.label(state.control.scene))
        SummaryRow(
            label = "训练状态",
            value = when {
                state.control.calibrating -> "校准中"
                state.control.session -> "训练中"
                else -> "待机"
            }
        )
        SummaryRow("声音", if (state.control.audioMuted) "关" else "开")
        SummaryRow(
            label = "视点高度",
            value = String.format(Locale.US, "%.2f 米", state.eyeHeightRequested)
        )
        SummaryRow(
            label = "校准置信度",
            value = String.format(Locale.US, "%.2f", state.control.calibrationConfidence)
        )
        SummaryRow(
            label = "姿态进度",
            value = "${(state.control.postureProgress * 100f).roundToInt()}%"
        )
        SummaryRow(
            label = "起身高度",
            value = String.format(Locale.US, "%.2f 米", state.control.postureRise)
        )
        SummaryRow(
            label = "姿态俯仰",
            value = String.format(Locale.US, "%.1f°", state.control.posturePitch)
        )
        SummaryRow("患者姿态", if (fresh) "实时" else "姿态未更新")
        if (fresh) {
            Text(
                text = "位置 ${position(pose)} 米",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
            Text(
                text = "朝向 ${orientation(pose)} 度",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextSecondary,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextPrimary,
            textAlign = TextAlign.End
        )
    }
}

private fun position(pose: TelemetryPose): String =
    String.format(Locale.US, "%.2f %.2f %.2f", pose.x, pose.y, pose.z)

private fun orientation(pose: TelemetryPose): String =
    String.format(Locale.US, "%.0f %.0f", pose.yaw, pose.pitch)
