package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.RecordingPhase
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale

/**
 * Compact recording entry for the top bar and the fullscreen overlay.
 * It never needs the BLE lease: the mirror can be recorded on its own.
 */
@Composable
fun RecordingChip(
    state: ControlUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    when (state.recording) {
        RecordingPhase.STARTING -> StatusPill(
            label = "准备录制…",
            accent = QuietPalette.Warning,
            modifier = modifier
        )

        RecordingPhase.RECORDING -> Surface(
            modifier = modifier,
            shape = RoundedCornerShape(50),
            color = QuietPalette.Danger.copy(alpha = 0.16f),
            contentColor = QuietPalette.Danger
        ) {
            Row(
                modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(QuietPalette.Danger)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = formatDuration(state.recordingElapsedMs),
                    style = MaterialTheme.typography.labelLarge
                )
                TextButton(onClick = onStop) {
                    Text("停止", color = QuietPalette.Danger)
                }
            }
        }

        RecordingPhase.SAVING -> StatusPill(
            label = "保存中…",
            accent = QuietPalette.Warning,
            modifier = modifier
        )

        RecordingPhase.IDLE, RecordingPhase.SAVED, RecordingPhase.FAILED ->
            TextButton(onClick = onStart, modifier = modifier) {
                Text("录制", color = QuietPalette.TextPrimary)
            }
    }
}

/** Saved / failed result card; the only place a clip can be shared from. */
@Composable
fun RecordingNotice(
    state: ControlUiState,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    when (state.recording) {
        RecordingPhase.SAVED -> Surface(
            modifier = modifier,
            shape = RoundedCornerShape(14.dp),
            color = QuietPalette.Background.copy(alpha = 0.96f),
            contentColor = QuietPalette.TextPrimary
        ) {
            Row(
                modifier = Modifier.padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(QuietPalette.Success)
                )
                Spacer(Modifier.width(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        "患者视角录像已保存",
                        style = MaterialTheme.typography.titleSmall,
                        color = QuietPalette.TextPrimary
                    )
                    Text(
                        text = "${formatDuration(state.recordingElapsedMs)} · " +
                            formatSize(state.recordingBytes),
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
                Spacer(Modifier.width(14.dp))
                TextButton(onClick = onShare) {
                    Text("分享", color = QuietPalette.Success)
                }
                TextButton(onClick = onDismiss) {
                    Text("关闭", color = QuietPalette.TextSecondary)
                }
            }
        }

        RecordingPhase.FAILED -> Surface(
            modifier = modifier,
            shape = RoundedCornerShape(14.dp),
            color = QuietPalette.Background.copy(alpha = 0.96f),
            contentColor = QuietPalette.TextPrimary
        ) {
            Row(
                modifier = Modifier.padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(QuietPalette.Danger)
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    text = state.recordingError ?: "录像失败",
                    style = MaterialTheme.typography.titleSmall,
                    color = QuietPalette.Danger,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(14.dp))
                TextButton(onClick = onDismiss) {
                    Text("关闭", color = QuietPalette.TextSecondary)
                }
            }
        }

        else -> Unit
    }
}

@Composable
private fun StatusPill(
    label: String,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = accent.copy(alpha = 0.14f),
        contentColor = accent
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
        )
    }
}

private fun formatDuration(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format(Locale.US, "%02d:%02d", minutes, seconds)
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> String.format(Locale.US, "%.0f KB", bytes / 1024.0)
    else -> "$bytes B"
}
