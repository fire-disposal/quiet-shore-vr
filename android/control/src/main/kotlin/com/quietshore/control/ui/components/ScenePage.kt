package com.quietshore.control.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.ui.theme.QuietPalette

private fun clock(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    return "%02d:%02d".format(total / 60, total % 60)
}

/**
 * Scene page.
 *
 * The operator picks the scene here, before a session; the headset stores it as
 * the launch parameter and forwards it to the page, so the patient never
 * chooses anything. The list comes from the protocol's shipped scenes, not from
 * a copy kept in the UI — `SCENE_LABELS` and `SCENE_IDS` are the single source
 * for both ends.
 */
@Composable
fun ScenePage(
    state: com.quietshore.control.model.ControlUiState,
    actions: com.quietshore.control.ui.ControlActions,
    modifier: Modifier = Modifier
) {
    val selectedScene = state.control.scene
    val sessionRunning = state.control.session
    val enabled = state.phase == com.quietshore.control.ble.BlePhase.READY
    val onSelect = actions.onSceneSelect
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
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Session lifecycle belongs here, with the scene it belongs to:
            // the control tab is about motion only.
            Text("会话", style = MaterialTheme.typography.titleMedium)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = when {
                        sessionRunning -> "训练中"
                        state.control.calibrating -> "校准中"
                        state.startPending -> "等待患者确认"
                        else -> "待机"
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    text = clock(state.sessionElapsedMs),
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = if (sessionRunning) actions.onEnd else actions.onEnterTraining,
                    enabled = enabled && (sessionRunning || !state.startPending),
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (sessionRunning) QuietPalette.Danger else QuietPalette.Primary
                    )
                ) {
                    Text(
                        when {
                            sessionRunning -> "结束"
                            state.startPending -> "等待确认…"
                            else -> "启动训练"
                        }
                    )
                }
                OutlinedButton(
                    onClick = actions.onRecalibrate,
                    enabled = enabled && (sessionRunning || state.control.calibrating),
                    modifier = Modifier.weight(1f)
                ) { Text("朝向") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = actions.onExitScene,
                    enabled = enabled,
                    modifier = Modifier.weight(1f)
                ) { Text("退出场景") }
                // Irreversible: a real dialog, not a second tap on the same
                // button, so the operator reads what will happen.
                var confirming by remember { mutableStateOf(false) }
                OutlinedButton(
                    onClick = { confirming = true },
                    enabled = enabled,
                    modifier = Modifier.weight(1f)
                ) { Text("退出系统") }
                if (confirming) {
                    AlertDialog(
                        onDismissRequest = { confirming = false },
                        title = { Text("退出系统？") },
                        text = {
                            Text(
                                if (sessionRunning) {
                                    "会先结束当前会话，再让头显回到桌面。患者仍在佩戴时不要这样做。"
                                } else {
                                    "头显会回到桌面，训练页面关闭。"
                                }
                            )
                        },
                        confirmButton = {
                            TextButton(onClick = {
                                confirming = false
                                actions.onExitSystem()
                            }) { Text("退出", color = QuietPalette.Danger) }
                        },
                        dismissButton = {
                            TextButton(onClick = { confirming = false }) { Text("取消") }
                        }
                    )
                }
            }

            Text("场景", style = MaterialTheme.typography.titleMedium)
            Text(
                text = if (sessionRunning) {
                    "训练中不可切换场景"
                } else {
                    "选好场景后再启动训练"
                },
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
            for (scene in com.quietshore.control.model.SceneCatalog.ALL) {
                val id = scene.id
                val label = scene.name
                val selected = id == selectedScene
                val selectable = enabled && !sessionRunning
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            enabled = selectable,
                            onClick = { onSelect(id) }
                        ),
                    shape = RoundedCornerShape(10.dp),
                    color = if (selected) {
                        QuietPalette.Primary.copy(alpha = 0.12f)
                    } else {
                        QuietPalette.SurfaceRaised
                    },
                    border = BorderStroke(
                        if (selected) 2.dp else 1.dp,
                        if (selected) QuietPalette.Primary else QuietPalette.Outline
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(label, style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = scene.blurb,
                                style = MaterialTheme.typography.bodySmall,
                                color = QuietPalette.TextSecondary
                            )
                        }
                        Text(
                            text = if (selected) "已选" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.Primary
                        )
                    }
                }
            }
        }
    }
}
