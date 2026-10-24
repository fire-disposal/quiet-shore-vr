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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionMode
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale

/**
 * The operator's whole surface: connection, session clock, mode, start/stop,
 * buoyancy intensity and character, scene sound, and a stop that is always on
 * screen.
 *
 * Everything here is one screen with no tabs. Buoyancy controls respond while a
 * session runs — that is the point: the operator tunes it while the patient is
 * wearing the headset.
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
            Text(
                text = "会话在「场景」页。",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )


            Section("模式") {
                SegmentedChoice(
                    options = SessionMode.entries.map { it.wire to it.label },
                    selected = state.sessionMode.wire,
                    enabled = connected,
                    onSelect = { wire -> actions.onSessionMode(SessionMode.entries.first { it.wire == wire }) }
                )
                Text(
                    text = if (state.sessionMode == SessionMode.POSTURE) {
                        "起身：切进来时从当前视角开始，由「回躺」缓慢下降"
                    } else {
                        "漂浮：竖向缓慢漂移；模式只在会话开始前选"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("漂浮强度") {
                SegmentedChoice(
                    options = (0..3).map { it.toString() to if (it == 0) "关" else it.toString() },
                    selected = state.floatLevel.toString(),
                    enabled = connected,
                    onSelect = { wire -> actions.onFloatLevel(wire.toIntOrNull() ?: 0) }
                )
                Text(
                    text = "0 = 不漂；1–3 在档位内线性放大。会话中可直接改",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("呼吸层") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (state.breathEnabled) {
                        Button(onClick = { actions.onBreathToggle(true) }, enabled = connected,
                            modifier = Modifier.weight(1f)) { Text("开启") }
                    } else {
                        OutlinedButton(onClick = { actions.onBreathToggle(true) }, enabled = connected,
                            modifier = Modifier.weight(1f)) { Text("开启") }
                    }
                    if (!state.breathEnabled) {
                        Button(onClick = { actions.onBreathToggle(false) }, enabled = connected,
                            modifier = Modifier.weight(1f)) { Text("关闭") }
                    } else {
                        OutlinedButton(onClick = { actions.onBreathToggle(false) }, enabled = connected,
                            modifier = Modifier.weight(1f)) { Text("关闭") }
                    }
                }
                Text(
                    text = "与呼吸同频的缓慢起伏，是漂浮感最强的一条线索",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("漂浮档位") {
                SegmentedChoice(
                    options = listOf(
                        "a" to "温和",
                        "b" to "标准",
                        "c" to "沉浸"
                    ),
                    selected = state.floatProfile,
                    enabled = connected,
                    onSelect = actions.onFloatProfile
                )
                Text(
                    text = profileHint(state.floatProfile),
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("起身") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilledTonalButton(
                        onClick = actions.onPostureRise,
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("起身") }
                    FilledTonalButton(
                        onClick = actions.onPostureLower,
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("回躺") }
                    OutlinedButton(
                        onClick = actions.onPostureStop,
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("保持") }
                }
                SegmentedChoice(
                    options = listOf("4000" to "4 秒", "6000" to "6 秒", "10000" to "10 秒", "14000" to "14 秒"),
                    selected = state.animDurationMs.toString(),
                    enabled = connected && running,
                    onSelect = { wire -> actions.onAnimDuration(wire.toIntOrNull() ?: 6000) }
                )
                Text(
                    text = "起身到站立视角（面向立便器）；轨迹越长越温和",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }

            Section("视角") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "俯仰修正",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "目标 ${state.viewPitchTarget}° · 已应用 ${state.control.viewPitch.roundToInt()}°",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
                // The page owns the easing (τ 0.25 s, ≤15°/s); the slider only
                // names an absolute up-gaze and is debounced to one sample per
                // 120 ms, so a drag cannot flood the link.
                Slider(
                    value = state.viewPitchTarget.toFloat(),
                    onValueChange = { actions.onViewPitch(it.roundToInt()) },
                    valueRange = -30f..30f,
                    steps = 59,
                    enabled = connected && running
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(
                        onClick = { actions.onViewAnim("up") },
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("上仰") }
                    FilledTonalButton(
                        onClick = { actions.onViewAnim("down") },
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("下俯") }
                    OutlinedButton(
                        onClick = { actions.onViewAnim("recenter") },
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("回正") }
                    OutlinedButton(
                        onClick = { actions.onViewAnim("breathe") },
                        enabled = connected && running,
                        modifier = Modifier.weight(1f)
                    ) { Text("呼吸") }
                }
                Text(
                    text = "只改患者看向世界的角度，不动相机与校准；回正把偏航一并归零",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }


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

/** One row of mutually exclusive choices; the selected one is filled. */
@Composable
private fun SegmentedChoice(
    options: List<Pair<String, String>>,
    selected: String,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        for ((wire, label) in options) {
            if (wire == selected) {
                Button(
                    onClick = { onSelect(wire) },
                    enabled = enabled,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(label)
                }
            } else {
                OutlinedButton(
                    onClick = { onSelect(wire) },
                    enabled = enabled,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(label)
                }
            }
        }
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

private fun profileHint(id: String): String = when (id) {
    "a" -> "温和：55 mm / 16 秒，只有平移"
    "c" -> "沉浸：100 mm / 9 秒（本档最高 1 级），只有平移"
    else -> "标准：75 mm / 13 秒，只有平移"
}

/** mm:ss, capped at an hour so a stuck session cannot grow the string forever. */
private fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}
