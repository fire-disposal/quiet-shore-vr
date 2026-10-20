package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.Scenes
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale

@Composable
fun ControlRail(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    Surface(modifier = modifier, shape = RoundedCornerShape(24.dp), color = QuietPalette.Surface) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp)
        ) {
            RailSection("护理辅助") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    RailAction(
                        label = "准备湖岸与水声",
                        icon = Icons.Rounded.Waves,
                        onClick = actions.onPrepareCare,
                        enabled = connected,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        text = "患者侧无需选场景，右侧确认键保留停止",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            RailSection("场景") {
                SceneCards(
                    selectedId = state.control.scene,
                    enabled = connected,
                    onSelect = actions.onSceneSelect
                )
            }

            RailSection("视点高度") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EyeHeightStepper(
                        meters = state.eyeHeightRequested,
                        enabled = connected && !state.control.calibrating,
                        onChange = actions.onEyeHeightChange
                    )
                    Text(
                        text = when {
                            !connected -> "头显未连接"
                            state.control.calibrating -> "校准中不可调整"
                            state.eyeHeightConfirmed -> "头显已生效"
                            else -> "按 5 厘米步进；平板只记录请求值"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (connected && state.eyeHeightConfirmed) {
                            QuietPalette.Success
                        } else {
                            QuietPalette.TextSecondary
                        }
                    )
                }
            }

            RailSection("控制") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        RailAction(
                            label = "校准",
                            icon = Icons.Rounded.MyLocation,
                            onClick = actions.onRecalibrate,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                        RailAction(
                            label = if (state.control.audioMuted) "打开声音" else "关闭声音",
                            icon = if (state.control.audioMuted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                            onClick = actions.onToggleAudio,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        RailAction(
                            label = "预览",
                            icon = Icons.Rounded.Visibility,
                            onClick = actions.onPreview,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                        SessionAction(
                            session = state.control.session,
                            onStart = actions.onStart,
                            onEnd = actions.onEnd,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            RailSection("虚拟起身") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        RailAction(
                            label = "缓慢起身",
                            icon = Icons.Rounded.ArrowUpward,
                            onClick = actions.onPostureRise,
                            enabled = connected && state.control.session,
                            modifier = Modifier.weight(1f)
                        )
                        RailAction(
                            label = "回躺",
                            icon = Icons.Rounded.ArrowDownward,
                            onClick = actions.onPostureLower,
                            enabled = connected && state.control.session,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    TextButton(
                        onClick = actions.onPostureStop,
                        enabled = connected && state.control.session
                    ) {
                        Text("停止并保持", color = QuietPalette.TextPrimary)
                    }
                    Text(
                        text = "仅训练中可用。患者确认键仍可立即停止。",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            RailSection("治疗师模式") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(
                                text = "高级视图控制",
                                style = MaterialTheme.typography.bodyMedium,
                                color = QuietPalette.TextPrimary
                            )
                            Text(
                                text = "仅治疗师使用，默认关闭",
                                style = MaterialTheme.typography.bodySmall,
                                color = QuietPalette.TextSecondary
                            )
                        }
                        Switch(
                            checked = state.advancedUnlocked,
                            onCheckedChange = actions.onAdvancedUnlockChange
                        )
                    }
                    if (state.advancedUnlocked) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            JoystickPad(
                                enabled = state.canSteerView,
                                onVector = actions.onViewMove,
                                onRelease = actions.onViewStop
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = when {
                                        !connected -> "头显未连接"
                                        !state.controlGranted -> "尚未取得控制"
                                        !state.control.session -> "训练开始后可用"
                                        state.control.calibrating -> "校准中视角已冻结"
                                        state.poseStale -> "姿态数据过期，暂停平移"
                                        else -> "按住拖动，松手即停"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = QuietPalette.TextSecondary
                                )
                                Text(
                                    text = "只平移虚拟视点，不改变患者头部姿态",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = QuietPalette.TextSecondary
                                )
                            }
                        }
                    }
                }
            }

            RailSection("状态") {
                StatusSummary(state)
                state.error?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.Danger
                    )
                }
            }

            RailSection("提示") {
                Text(
                    text = "请在头显内启动一次，之后由平板控制",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
                Text(
                    text = "患者无需操作",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
            }

            state.notice?.let { notice ->
                Text(
                    text = notice,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
        }
    }
}

@Composable
private fun RailSection(
    title: String,
    content: @Composable () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.TextSecondary
        )
        content()
    }
}

@Composable
private fun RailAction(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    FilledTonalButton(
        onClick = onClick,
        modifier = modifier.height(56.dp),
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = QuietPalette.SurfaceRaised,
            contentColor = QuietPalette.TextPrimary,
            disabledContainerColor = QuietPalette.SurfaceRaised.copy(alpha = 0.4f),
            disabledContentColor = QuietPalette.TextSecondary.copy(alpha = 0.5f)
        )
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.titleSmall, maxLines = 1)
    }
}

@Composable
private fun SessionAction(
    session: Boolean,
    onStart: () -> Unit,
    onEnd: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    if (session) {
        Button(
            onClick = onEnd,
            modifier = modifier.height(56.dp),
            enabled = enabled,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = QuietPalette.Danger,
                contentColor = Color(0xFF2A0B09)
            )
        ) {
            Icon(Icons.Rounded.Stop, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("结束训练", style = MaterialTheme.typography.titleSmall, maxLines = 1)
        }
    } else {
        Button(
            onClick = onStart,
            modifier = modifier.height(56.dp),
            enabled = false,
            shape = RoundedCornerShape(14.dp)
        ) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("请在头显内启动", style = MaterialTheme.typography.titleSmall, maxLines = 1)
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
