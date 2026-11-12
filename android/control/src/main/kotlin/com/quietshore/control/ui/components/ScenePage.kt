package com.quietshore.control.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Scene and session lifecycle.
 *
 * The operator picks the scene here, before a session; the headset stores it as
 * the launch parameter and hands it to the page, so the patient never chooses
 * anything. The list is the protocol's shipped scenes, not a copy kept in the
 * UI — `SCENE_IDS` and `SCENE_LABELS` are the single source for both ends.
 */
@Composable
fun ScenePage(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val selectedScene = state.scenePending ?: state.control.scene
    val running = state.control.session
    val ready = state.phase == BlePhase.READY
    // A scene switch rebuilds the world, and the page refuses one while an
    // immersive session is up — calibration included. The rows follow the
    // page's rule, not just the training flag, so the operator never gets a
    // rejection for a row they were allowed to tap.
    val switchable = !running && !state.control.calibrating

    Column(modifier.fillMaxWidth()) {
        Band(
            title = "会话",
            trailing = {
                Text(
                    text = when {
                        running -> "训练中"
                        state.control.calibrating -> "校准中"
                        state.startPending -> "等待患者确认"
                        else -> "待机"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = if (running || state.startPending) {
                        QuietPalette.TextPrimary
                    } else {
                        QuietPalette.TextSecondary
                    }
                )
            }
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key(
                        label = when {
                            running -> "结束会话"
                            state.startPending -> "等待确认"
                            else -> "启动训练"
                        },
                        onClick = if (running) actions.onEnd else actions.onEnterTraining,
                        modifier = Modifier.weight(1f),
                        kind = if (running) KeyKind.Danger else KeyKind.Fill,
                        enabled = ready && (running || !state.startPending)
                    )
                    Key(
                        label = "校准",
                        onClick = actions.onRecalibrate,
                        modifier = Modifier.weight(1f),
                        enabled = ready && (running || state.control.calibrating)
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key(
                        label = "退出场景",
                        onClick = actions.onExitScene,
                        modifier = Modifier.weight(1f),
                        kind = KeyKind.Quiet,
                        enabled = ready
                    )
                    // Irreversible: a real dialog, not a second tap on the same
                    // key, so the operator reads what will happen.
                    var confirming by remember { mutableStateOf(false) }
                    Key(
                        label = "退出系统",
                        onClick = { confirming = true },
                        modifier = Modifier.weight(1f),
                        kind = KeyKind.Quiet,
                        enabled = ready
                    )
                    if (confirming) {
                        AlertDialog(
                            onDismissRequest = { confirming = false },
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
                            containerColor = QuietPalette.Surface,
                            title = { Text("退出系统？", style = MaterialTheme.typography.titleLarge) },
                            text = {
                                Text(
                                    style = MaterialTheme.typography.bodyMedium,
                                    text = if (running) {
                                        "先结束当前会话，再让头显回到桌面。患者仍在佩戴时不要这样做。"
                                    } else {
                                        "头显回到桌面，训练页面关闭。"
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
                                TextButton(onClick = { confirming = false }) {
                                    Text("取消", color = QuietPalette.TextSecondary)
                                }
                            }
                        )
                    }
                }
            }
        }

        Band(
            title = "场景",
            trailing = {
                Text(
                    text = SceneCatalog.scene(selectedScene)?.name ?: selectedScene,
                    style = MaterialTheme.typography.labelLarge,
                    color = QuietPalette.TextSecondary
                )
            }
        ) {
            if (!switchable) {
                Text(
                    text = if (running) {
                        "训练中。结束会话后可切换。"
                    } else {
                        "校准中。结束后可切换。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
                )
            }
            for (scene in SceneCatalog.ALL) {
                val selected = scene.id == selectedScene
                val selectable = ready && switchable
                SceneRow(
                    name = scene.name,
                    blurb = scene.blurb,
                    selected = selected,
                    enabled = selectable,
                    onClick = { actions.onSceneSelect(scene.id) }
                )
                Rule()
            }
        }
    }
}

/**
 * One scene as a row, not a card: the selection is an ice block on the leading
 * edge, so a list of nine reads as a column of names.
 */
@Composable
private fun SceneRow(
    name: String,
    blurb: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = TouchTarget + 16.dp)
            .clickable(
                enabled = enabled,
                role = Role.RadioButton,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .background(if (selected) QuietPalette.Surface else QuietPalette.Background),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(6.dp)
                .height(TouchTarget + 16.dp)
                .background(if (selected) QuietPalette.Ice else QuietPalette.Hairline)
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Text(
                text = name,
                style = MaterialTheme.typography.titleMedium,
                color = if (enabled) QuietPalette.TextPrimary else QuietPalette.Disabled
            )
            if (blurb.isNotEmpty()) {
                Text(
                    text = blurb,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
        }
        Text(
            text = if (selected) "当前" else "",
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.TextPrimary,
            modifier = Modifier.padding(end = 16.dp)
        )
    }
}
