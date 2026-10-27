package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The operator's whole session surface, built on the one kinematics the page
 * actually runs:
 *
 * ```text
 *   posture  mix 0..1  →  rotation + eye height (the same scalar)
 *   buoyancy on/off    →  vertical envelope on top of the frame
 *   view     presets   →  a screen-space offset, never a second posture
 * ```
 *
 * Three sections, one per perceivable channel (`docs/control-perception.md`),
 * plus the stop. Everything shown here is read from the headset's state frame —
 * no number is re-derived on this side, so the bar, the angle and the button
 * availability cannot disagree.
 */
@Composable
fun SessionPanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    val control = state.control
    val caps = state.caps
    val running = control.session
    val mix = control.mix.coerceIn(0f, 1f)
    val percent = (mix * 100f).roundToInt()

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface,
        contentColor = QuietPalette.TextPrimary
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Section("会话") {
                LabeledValue(
                    "状态",
                    when {
                        !connected -> "未连接"
                        control.calibrating -> "校准中"
                        running -> "进行中 · ${clock(state.sessionElapsedMs)}"
                        else -> "待机"
                    }
                )
                LabeledValue("场景", SceneCatalog.scene(control.scene)?.name ?: control.scene)
                if (caps.blocked.isNotEmpty()) {
                    Text(
                        text = "头显当前：${caps.blocked}",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            Section("体位") {
                // The two numbers that describe the same scalar: how far the
                // body has risen, and where the eye ended up.
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom
                ) {
                    Column {
                        Text(
                            text = "站立",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary
                        )
                        Text(
                            text = "$percent%",
                            style = MaterialTheme.typography.headlineMedium
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = "眼高",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary
                        )
                        Text(
                            text = String.format(Locale.US, "%.2f m", control.eyeHeight),
                            style = MaterialTheme.typography.headlineSmall
                        )
                    }
                }
                LinearProgressIndicator(
                    progress = { mix },
                    modifier = Modifier.fillMaxWidth(),
                    color = QuietPalette.Accent,
                    trackColor = QuietPalette.Outline.copy(alpha = 0.35f)
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilledTonalButton(
                        onClick = actions.onPostureRise,
                        enabled = connected && caps.rise,
                        modifier = Modifier.weight(1f)
                    ) { Text("起身") }
                    OutlinedButton(
                        onClick = actions.onPostureLower,
                        enabled = connected && caps.lie,
                        modifier = Modifier.weight(1f)
                    ) { Text("躺下") }
                    OutlinedButton(
                        onClick = actions.onPostureStop,
                        enabled = connected && caps.stop,
                        modifier = Modifier.weight(1f)
                    ) { Text("停止") }
                }
                // Angle and rise are the mix and the eye height above; the
                // panel shows the two sources, not copies of them.
                LabeledValue(
                    "修正角度",
                    String.format(Locale.US, "%.0f°", mix * 90f)
                )
                DurationRow(
                    selected = state.animDurationMs,
                    enabled = connected && running,
                    onSelect = actions.onAnimDuration
                )
                Text(
                    text = "起身同时抬起视线与转动世界，两者共用一条曲线；停止冻结在当前高度",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            // One switch, not four levels: the only thing an operator can check
            // in the headset is "moving / not moving".
            Section("起伏") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "竖直起伏", style = MaterialTheme.typography.bodyMedium)
                    Switch(
                        checked = control.floatLevel > 0,
                        onCheckedChange = { on -> actions.onFloatLevel(if (on) 3 else 0) },
                        enabled = connected && caps.float
                    )
                }
                LabeledValue(
                    "已应用",
                    String.format(Locale.US, "±%.0f mm", abs(control.floatMm))
                )
                Text(
                    text = "开 = 湖面飘浮（约 150 mm，13 s 一个来回）；其他场景 = 轻缓呼吸；关 = 世界静止",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("视线") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for ((label, preset) in listOf("上仰" to "up", "下俯" to "down", "回正" to "recenter")) {
                        OutlinedButton(
                            onClick = { actions.onViewAnim(preset) },
                            enabled = connected && caps.view,
                            modifier = Modifier.weight(1f)
                        ) { Text(label) }
                    }
                }
                OutlinedButton(
                    onClick = actions.onViewStop,
                    enabled = connected && caps.view,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("保持当前视角") }
                LabeledValue(
                    "相对俯仰",
                    String.format(Locale.US, "%+.0f°", control.viewPitch)
                )
                Text(
                    text = "视线是叠加在体位上的微调，不改变起身高度",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Spacer(Modifier.height(4.dp))
            // Pinned: never nested behind a scroll, a tab or a menu.
            Button(
                onClick = actions.onEmergencyStop,
                enabled = connected && running,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = QuietPalette.Danger,
                    disabledContainerColor = QuietPalette.Danger.copy(alpha = 0.35f)
                )
            ) {
                Icon(
                    imageVector = Icons.Rounded.Stop,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.size(8.dp))
                Text("急停", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

/** Four ramp lengths; the page accepts any 4–14 s, these are the useful ones. */
private val DURATIONS_S = listOf(6, 8, 10, 12)

@Composable
private fun DurationRow(selected: Int, enabled: Boolean, onSelect: (Int) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "起身时长",
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextSecondary
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (seconds in DURATIONS_S) {
                val active = selected == seconds * 1000
                TextButton(
                    onClick = { onSelect(seconds * 1000) },
                    enabled = enabled
                ) {
                    Text(
                        text = "${seconds}s",
                        color = if (active) QuietPalette.Primary else QuietPalette.TextSecondary
                    )
                }
            }
        }
    }
}

@Composable
private fun LabeledValue(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextSecondary
        )
        Text(text = value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(width = 3.dp, height = 14.dp)
                    .background(QuietPalette.Accent, RoundedCornerShape(2.dp))
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = QuietPalette.TextPrimary
            )
        }
        content()
    }
}

private fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}
