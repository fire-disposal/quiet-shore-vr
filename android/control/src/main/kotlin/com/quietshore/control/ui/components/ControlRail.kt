package com.quietshore.control.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette

private enum class RailTab(val label: String) {
    TRAIN("训练"),
    SCENE("场景"),
    TOOLS("工具")
}

@Composable
fun ControlRail(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    var tab by rememberSaveable { mutableStateOf(RailTab.TRAIN) }
    Surface(modifier = modifier, shape = RoundedCornerShape(24.dp), color = QuietPalette.Surface) {
        Column(Modifier.fillMaxSize()) {
            RailTabs(
                selected = tab,
                onSelect = { tab = it },
                modifier = Modifier.padding(start = 22.dp, top = 18.dp, end = 22.dp, bottom = 8.dp)
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp)
            ) {


            RailSection("SUS 量表", visible = tab == RailTab.TOOLS) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        RailAction(
                            label = "打开",
                            icon = Icons.Rounded.PlayArrow,
                            onClick = actions.onSusOpen,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                        RailAction(
                            label = "关闭",
                            icon = Icons.Rounded.Stop,
                            onClick = actions.onSusClose,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(
                            onClick = actions.onSusPrev,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        ) { Text("上一题") }
                        TextButton(
                            onClick = actions.onSusNext,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        ) { Text("下一题") }
                    }
                    Text(
                        text = "患者不便时，操作员为当前题代答",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (value in 1..5) {
                            FilledTonalButton(
                                onClick = { actions.onSusAnswer(value) },
                                enabled = connected,
                                modifier = Modifier.weight(1f).height(48.dp),
                                contentPadding = PaddingValues(0.dp),
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = QuietPalette.SurfaceRaised,
                                    contentColor = QuietPalette.TextPrimary
                                )
                            ) {
                                Text(
                                    text = value.toString(),
                                    style = MaterialTheme.typography.titleMedium
                                )
                            }
                        }
                    }
                    Text(
                        text = "头显端 10 题 SUS；也可用顶栏页码翻页",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            RailSection("场景", visible = tab == RailTab.SCENE) {
                SceneCards(
                    selectedId = state.control.scene,
                    enabled = connected,
                    onSelect = actions.onSceneSelect
                )
            }

            RailSection("视点高度", visible = tab == RailTab.SCENE) {
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

            RailSection("控制", visible = tab == RailTab.TRAIN) {
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
                            label = "预览",
                            icon = Icons.Rounded.Visibility,
                            onClick = actions.onPreview,
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    SessionAction(
                        session = state.control.session,
                        onEnter = actions.onEnterTraining,
                        onEnd = actions.onEnd,
                        enabled = connected,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        text = "进入练习会打开 Firefox；门扉页仍需患者确认一次",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            RailSection("水声", visible = tab == RailTab.TRAIN) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    RailAction(
                        label = if (state.control.audioMuted) "开始水声" else "暂停水声",
                        icon = if (state.control.audioMuted) {
                            Icons.Rounded.VolumeUp
                        } else {
                            Icons.Rounded.VolumeOff
                        },
                        onClick = actions.onToggleAudio,
                        enabled = connected,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        text = if (state.control.audioMuted) "水声已暂停" else "水声播放中",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }

            RailSection("虚拟起身", visible = tab == RailTab.TRAIN) {
                val postureReady = connected &&
                    state.control.session &&
                    !state.control.calibrating &&
                    state.control.calibrationConfidence > 0f
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        RailAction(
                            label = "缓慢起身",
                            icon = Icons.Rounded.ArrowUpward,
                            onClick = actions.onPostureRise,
                            enabled = postureReady,
                            modifier = Modifier.weight(1f)
                        )
                        RailAction(
                            label = "回躺",
                            icon = Icons.Rounded.ArrowDownward,
                            onClick = actions.onPostureLower,
                            enabled = postureReady,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    TextButton(
                        onClick = actions.onPostureStop,
                        enabled = postureReady
                    ) {
                        Text("停止并保持", color = QuietPalette.TextPrimary)
                    }
                    Text(
                        text = when {
                            !connected -> "头显未连接"
                            !state.control.session -> "训练开始后可用"
                            state.control.calibrating -> "校准中暂停"
                            state.control.calibrationConfidence <= 0f ->
                                "请先在头显完成方向校准"
                            else -> "仅训练中可用。患者确认键仍可立即停止。"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (postureReady) {
                            QuietPalette.TextSecondary
                        } else {
                            QuietPalette.Warning
                        }
                    )
                }
            }

            RailSection("治疗师模式", visible = tab == RailTab.TOOLS) {
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

            RailSection("提示", visible = tab == RailTab.TOOLS) {
                Text(
                    text = "平板可代为发起进入练习",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
                Text(
                    text = "只有 Firefox 门扉页需要患者确认一次",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
            }

            }
        }
    }
}

@Composable
private fun RailTabs(
    selected: RailTab,
    onSelect: (RailTab) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RailTab.values().forEach { tab ->
            val active = tab == selected
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .height(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onSelect(tab) },
                color = if (active) QuietPalette.Primary else QuietPalette.SurfaceRaised,
                contentColor = if (active) QuietPalette.OnPrimary else QuietPalette.TextSecondary
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(tab.label, style = MaterialTheme.typography.titleSmall)
                }
            }
        }
    }
}

@Composable
private fun RailSection(
    title: String,
    visible: Boolean = true,
    content: @Composable () -> Unit
) {
    if (!visible) {
        return
    }
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
    onEnter: () -> Unit,
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
            onClick = onEnter,
            modifier = modifier.height(56.dp),
            enabled = enabled,
            shape = RoundedCornerShape(14.dp)
        ) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("进入练习", style = MaterialTheme.typography.titleSmall, maxLines = 1)
        }
    }
}


