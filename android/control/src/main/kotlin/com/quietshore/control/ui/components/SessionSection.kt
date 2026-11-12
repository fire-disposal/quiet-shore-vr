package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.abs

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
 * Four bands, one per perceivable channel, plus the stop — which lives in the
 * bar, not here. Everything shown is read from the headset's state frame; no
 * number is re-derived on this side, so the board and the buttons cannot
 * disagree.
 */
@Composable
fun SessionSection(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    val control = state.control
    val caps = state.caps
    val running = control.session
    val phase = sessionPhaseOf(control, state.phase, state.startPending, state.stopRequested)

    Column(modifier.fillMaxWidth()) {
        Band(title = "会话", trailing = {
            Text(
                text = when (phase) {
                    SessionPhase.Running -> "进行中"
                    SessionPhase.Stopping -> "正在结束"
                    SessionPhase.Calibrating -> "记录体位中"
                    SessionPhase.Entry -> "等待患者确认"
                    else -> "未开始"
                },
                style = MaterialTheme.typography.labelLarge,
                color = if (phase.inSession) {
                    QuietPalette.TextPrimary
                } else {
                    QuietPalette.TextSecondary
                }
            )
        }) {
            Column(
                modifier = Modifier.padding(
                    horizontal = 20.dp,
                    vertical = 12.dp
                )
            ) {
                FactText("场景", com.quietshore.control.model.SceneCatalog
                    .scene(control.scene)?.name ?: control.scene, numeric = false)
                FactText(
                    label = if (connected) "控制权" else "链路",
                    value = when {
                        !connected -> "头显未连接"
                        control.calibrating -> "校准中"
                        else -> "平板接管"
                    },
                    numeric = false
                )
                if (caps.blocked.isNotEmpty()) {
                    Text(
                        text = "头显限制：${caps.blocked}",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }

        Band(title = "体位") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key("起身", actions.onPostureRise, Modifier.weight(1f),
                        kind = KeyKind.Fill, enabled = connected && caps.rise)
                    Key("躺下", actions.onPostureLower, Modifier.weight(1f),
                        enabled = connected && caps.lie)
                    Key("停止", actions.onPostureStop, Modifier.weight(1f),
                        enabled = connected && caps.stop)
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "起身时长",
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.TextSecondary
                    )
                    Spacer(Modifier.weight(1f))
                    DurationRow(
                        selected = state.animDurationMs,
                        enabled = connected && running,
                        onSelect = actions.onAnimDuration
                    )
                }
            }
        }

        // One switch, not four levels: the only thing an operator can check in
        // the headset is "moving / not moving".
        Band(title = "起伏") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                SwitchRow(
                    title = "竖直起伏",
                    checked = control.floatLevel > 0,
                    onCheckedChange = { on -> actions.onFloatLevel(if (on) 3 else 0) },
                    enabled = connected && caps.float,
                    note = if (running) {
                        String.format(
                            Locale.US,
                            "±%.0f mm · %d 级",
                            abs(control.floatMm),
                            control.floatLevel
                        )
                    } else {
                        "未进入训练"
                    }
                )
                Text(
                    text = if (control.floatLevel > 0) {
                        "世界随呼吸缓慢升降，头部跟着轻微浮动。"
                    } else {
                        "世界静止。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
            }
        }

        Band(title = "视线") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key("上仰", { actions.onViewAnim("up") }, Modifier.weight(1f),
                        enabled = connected && caps.view)
                    Key("下俯", { actions.onViewAnim("down") }, Modifier.weight(1f),
                        enabled = connected && caps.view)
                    Key("回正", { actions.onViewAnim("recenter") }, Modifier.weight(1f),
                        enabled = connected && caps.view)
                    Key("保持", actions.onViewStop, Modifier.weight(1f),
                        enabled = connected && caps.view)
                }
                FactText(
                    "相对俯仰",
                    String.format(Locale.US, "%+.0f°", control.viewPitch)
                )
                FactText(
                    "播放",
                    when (control.viewAnim) {
                        com.quietshore.control.protocol.ViewAnim.PLAYING -> "播放中"
                        com.quietshore.control.protocol.ViewAnim.HELD -> "已保持"
                        else -> "待机"
                    },
                    numeric = false
                )
                Text(
                    text = "视线偏移叠加在体位之上，不改变起身高度。",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

/** Four ramp lengths; the page accepts any 4–14 s, these are the useful ones. */
private val DURATIONS_S = listOf(6, 8, 10, 12)

@Composable
private fun DurationRow(selected: Int, enabled: Boolean, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (seconds in DURATIONS_S) {
            val active = selected == seconds * 1000
            Key(
                label = "${seconds}s",
                onClick = { onSelect(seconds * 1000) },
                kind = if (active) KeyKind.Fill else KeyKind.Outline,
                enabled = enabled,
                minWidth = TouchTarget
            )
        }
    }
}

/** Label and value on one line; the value keeps the tabular figures. */
@Composable
private fun FactText(label: String, value: String, numeric: Boolean = true) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextSecondary
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = value,
            style = if (numeric) {
                MaterialTheme.typography.bodyMedium.tabularFigures()
            } else {
                MaterialTheme.typography.bodyMedium
            },
            color = QuietPalette.TextPrimary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}
