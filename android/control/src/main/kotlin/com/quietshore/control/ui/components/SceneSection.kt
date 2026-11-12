package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Session lifecycle and scene choice — the screen the console opens on.
 *
 * It is orchestration only: the keys come from [ActionKey], the scenes from
 * [SceneStrip], the divisions from [Band]. The strip is the same component the
 * in-session row uses, so an operator who has learned it in one place has
 * learned it in both.
 *
 * The scene list is the protocol's shipped scenes, not a copy kept in the UI —
 * `SCENE_IDS` and `SCENE_LABELS` are the single source for both ends.
 */
@Composable
fun SceneSection(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val phase = sessionPhaseOf(state.control, state.phase, state.startPending, state.stopRequested)
    val ready = state.phase == BlePhase.READY
    val current = SceneCatalog.scene(state.control.scene)?.name ?: state.control.scene

    Column(modifier.fillMaxWidth()) {
        Band(title = "会话", trailing = {
            Text(
                text = phaseLabel(phase),
                style = MaterialTheme.typography.labelLarge,
                color = if (phase.inSession || phase == SessionPhase.Entry) {
                    QuietPalette.TextPrimary
                } else {
                    QuietPalette.TextSecondary
                }
            )
        }) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    ActionKey(
                        label = when (phase) {
                            SessionPhase.Running, SessionPhase.Stopping -> "结束本次"
                            SessionPhase.Entry -> "等待确认"
                            SessionPhase.Calibrating -> "记录体位中"
                            else -> "启动训练"
                        },
                        onClick = if (phase.inSession) actions.onEnd else actions.onEnterTraining,
                        modifier = Modifier.weight(1f),
                        tone = if (phase.inSession) ActionTone.Danger else ActionTone.Primary,
                        // Calibration is the one phase where the button does
                        // nothing at all, and the label says why.
                        enabled = ready && phase != SessionPhase.Calibrating &&
                            (phase != SessionPhase.Entry)
                    )
                    ActionKey(
                        label = "校准",
                        onClick = actions.onRecalibrate,
                        modifier = Modifier.weight(1f),
                        enabled = ready && (phase == SessionPhase.Running ||
                            state.control.calibrating)
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    ActionKey(
                        label = "退出场景",
                        onClick = actions.onExitScene,
                        modifier = Modifier.weight(1f),
                        tone = ActionTone.Quiet,
                        enabled = ready
                    )
                    var confirming by remember { mutableStateOf(false) }
                    ActionKey(
                        label = "退出系统",
                        onClick = { confirming = true },
                        modifier = Modifier.weight(1f),
                        tone = ActionTone.Quiet,
                        enabled = ready
                    )
                    if (confirming) {
                        // Irreversible, so it is the one action with a dialog.
                        // The emergency stop is never behind this.
                        AlertDialog(
                            onDismissRequest = { confirming = false },
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
                            containerColor = QuietPalette.Surface,
                            title = {
                                Text("退出系统？", style = MaterialTheme.typography.titleLarge)
                            },
                            text = {
                                Text(
                                    style = MaterialTheme.typography.bodyMedium,
                                    text = if (phase.inSession) {
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

        Band(title = "场景", trailing = {
            Text(
                text = current,
                style = MaterialTheme.typography.labelLarge,
                color = QuietPalette.TextSecondary
            )
        }) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                SceneStrip(
                    current = state.control.scene,
                    enabled = ready && phase.acceptsChanges,
                    onSelect = actions.onSceneSelect
                )
                for (scene in SceneCatalog.ALL) {
                    if (scene.id != state.control.scene) {
                        continue
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = scene.blurb,
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
                if (!phase.acceptsChanges) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = if (phase == SessionPhase.Stopping) {
                            "正在结束，稍后再切。"
                        } else {
                            "记录体位中，结束后可切换。"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }
        }
    }
}

/** The session word in the band header: one phrase, never a sentence. */
private fun phaseLabel(phase: SessionPhase): String = when (phase) {
    SessionPhase.Idle -> "待机"
    SessionPhase.Entry -> "等待患者确认"
    SessionPhase.Calibrating -> "记录体位中"
    SessionPhase.Running -> "训练中"
    SessionPhase.Stopping -> "正在结束"
    SessionPhase.Ended -> "已结束"
}
