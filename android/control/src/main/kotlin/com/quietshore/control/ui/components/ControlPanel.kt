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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import kotlin.math.abs
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale

/**
 * The operator's live surface: connection, the session facts the headset
 * actually applied, the water bed, and a stop that is always on screen.
 *
 * There are no live physics knobs. See `docs/control-perception.md`: every
 * parameter this panel used to expose was either fixed by design or invisible
 * in float mode, so operating it produced no change the patient could feel.
 */
@Composable
fun ControlPanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    val running = state.control.session
    val calibrating = state.control.calibrating
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface,
        contentColor = QuietPalette.TextPrimary
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Everything except the stop button scrolls; the stop button is
            // pinned to the bottom so it is reachable without hunting.
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
            ConnectionRow(state = state, connected = connected)
            // A link can be READY while no state frame ever arrives (narrow
            // MTU, version mismatch). Every control below then looks enabled
            // but reports stale data — say it instead of looking broken.
            if (connected && state.stateStale) {
                Text(
                    text = "未收到头显状态帧：先确认两端版本一致、蓝牙包长 ≥ 43",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.Danger
                )
            }

            // One line of state, not a dashboard: everything else here is a
            // control whose effect the headset shows, or it lives on its tab.
            Section("会话") {
                LabeledValue("状态", when {
                    !connected -> "未连接"
                    calibrating -> "校准中"
                    running -> "进行中 · ${clock(state.sessionElapsedMs)}"
                    else -> "待机"
                })
            }

            // One switch, not four levels: the only thing an operator can
            // verify in the headset is "moving / not moving".
            Section("漂浮") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "竖直起伏", style = MaterialTheme.typography.bodyMedium)
                    Switch(
                        checked = state.floatLevel > 0,
                        onCheckedChange = { on -> actions.onFloatLevel(if (on) 3 else 0) },
                        enabled = connected && !calibrating
                    )
                }
                Text(
                    text = "开 = 湖面飘浮（约 150 mm，13 s 一个来回）；其他场景 = 轻缓呼吸起伏；关 = 世界静止",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("世界修正") {
                // The dial the operator asked for: the patient's calibration
                // angle, and what the system is currently correcting.
                val calib = abs(state.control.worldPitch)
                val rise = state.control.postureRise.coerceIn(0f, 1f)
                LabeledValue(
                    "修正角度",
                    "${state.control.posturePitch.roundToInt()}° · ${(rise * 100).roundToInt()}%（校准仰角 ${calib.roundToInt()}°）"
                )
                LinearProgressIndicator(
                    progress = { rise },
                    modifier = Modifier.fillMaxWidth(),
                    color = QuietPalette.Accent,
                    trackColor = QuietPalette.Outline.copy(alpha = 0.35f)
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilledTonalButton(
                        onClick = actions.onPostureRise,
                        enabled = connected && running && rise < 0.999f,
                        modifier = Modifier.weight(1f)
                    ) { Text("起身") }
                    OutlinedButton(
                        onClick = actions.onPostureLower,
                        enabled = connected && running && rise > 0.001f,
                        modifier = Modifier.weight(1f)
                    ) { Text("躺下") }
                    OutlinedButton(
                        onClick = actions.onPostureStop,
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("停止") }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "斜坡时长", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "${state.animDurationMs / 1000} s",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Slider(
                    value = state.animDurationMs.toFloat(),
                    onValueChange = { actions.onAnimDuration((it / 1000).roundToInt() * 1000) },
                    valueRange = 4000f..20000f,
                    steps = 15,
                    enabled = connected && running
                )
                Text(
                    text = "起身把世界从「天花板」缓缓转到面向前方；停止冻结在当前角度",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            // The view layer's four presets, straight to the page's player.
            Section("视角动画") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (preset in listOf("向上" to "up", "向下" to "down", "回正" to "recenter", "呼吸" to "breathe")) {
                        OutlinedButton(
                            onClick = { actions.onViewAnim(preset.second) },
                            enabled = connected && running,
                            modifier = Modifier.weight(1f)
                        ) { Text(preset.first) }
                    }
                }
                OutlinedButton(
                    onClick = actions.onViewStop,
                    enabled = connected && running,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("保持当前视角") }
            }

            // Still removed on purpose (docs/control-perception.md): 漂浮档位
            // / 呼吸层 / 无级视角滑条 / 提示强度. 视角动画 presets came back —
            // each one has a visible, self-limiting playback in the headset.
            }

            Spacer(Modifier.height(10.dp))
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

@Composable
private fun LabeledValue(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium, color = QuietPalette.TextSecondary)
        Text(text = value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ConnectionRow(state: ControlUiState, connected: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(
                        if (connected) QuietPalette.Success else QuietPalette.Outline,
                        RoundedCornerShape(50)
                    )
            )
            Spacer(Modifier.size(8.dp))
            Text(
                text = if (connected) "头显已连接" else "未连接",
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Text(
            text = if (state.deviceSuffix.isEmpty()) "" else state.deviceSuffix,
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.TextSecondary
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.TextSecondary
        )
        content()
    }
}

private fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}
