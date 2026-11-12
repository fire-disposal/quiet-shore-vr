package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.voice.VoiceCatalog

/**
 * SUS, question by question.
 *
 * The instrument is read out loud one item at a time, so every item carries its
 * own play key: the operator advances at the patient's pace and never has to
 * hunt through a flat list. Wording is the instrument's, verbatim.
 */

/** Wall-clock stamp for an archived sheet; the tablet is the record keeper. */
private fun stamp(epochMs: Long): String {
    if (epochMs <= 0L) return "—"
    return java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(epochMs))
}

@Composable
fun SusSheet(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.sessionActive || state.controlGranted
    val questions = VoiceCatalog.LINES.filter { it.group == "SUS" && it.id != "v-sus-intro" }
    val answered = state.susAnswers.count { it != 0 }
    val current = state.susIndex

    Column(modifier.fillMaxWidth()) {
        Band(
            title = "量表",
            trailing = {
                Text(
                    text = "${answered}/${questions.size}",
                    style = MaterialTheme.typography.labelLarge.tabularFigures(),
                    color = QuietPalette.TextPrimary
                )
            }
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key(
                        label = "在头显中打开",
                        onClick = actions.onSusOpen,
                        modifier = Modifier.weight(1f),
                        kind = KeyKind.Fill,
                        enabled = connected
                    )
                    Key(
                        label = "关闭",
                        onClick = actions.onSusClose,
                        modifier = Modifier.weight(1f),
                        enabled = connected
                    )
                }
                Text(
                    text = if (current in 1..questions.size) {
                        "当前第 $current 题。作答后自动到下一题。"
                    } else {
                        "未开始。打开后逐题出现。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }

        Band(title = "作答方式") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                SwitchRow(
                    title = "目视选择",
                    checked = state.gazeDwell,
                    onCheckedChange = actions.onGazeDwellChange,
                    enabled = connected,
                    note = "患者注视选项 3 秒即作答。"
                )
                Rule()
                SwitchRow(
                    title = "朗读题干",
                    checked = state.susVoice,
                    onCheckedChange = actions.onSusVoiceChange,
                    enabled = connected,
                    note = "题目出现时同步播放这一题语音。"
                )
            }
        }

        Band(title = "题目") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                for ((index, line) in questions.withIndex()) {
                    val number = index + 1
                    val answer = state.susAnswers.getOrNull(index) ?: 0
                    val isCurrent = state.susIndex == number
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 10.dp)
                    ) {
                        Row(verticalAlignment = Alignment.Top) {
                            Text(
                                text = "$number",
                                style = MaterialTheme.typography.titleMedium.tabularFigures(),
                                color = if (isCurrent) QuietPalette.TextPrimary else QuietPalette.TextSecondary,
                                modifier = Modifier
                                    .width(28.dp)
                                    .padding(top = 8.dp)
                            )
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color = QuietPalette.TextPrimary,
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(top = 8.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Key(
                                label = if (isCurrent) "当前" else "显示",
                                onClick = { actions.onSusShow(number) },
                                kind = if (isCurrent) KeyKind.Fill else KeyKind.Quiet,
                                enabled = connected,
                                minWidth = TouchTarget
                            )
                        }
                        if (isCurrent) {
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                for (value in 1..5) {
                                    Key(
                                        label = "$value",
                                        onClick = { actions.onSusAnswer(value) },
                                        kind = if (answer == value) KeyKind.Fill else KeyKind.Outline,
                                        enabled = connected,
                                        minWidth = TouchTarget
                                    )
                                }
                            }
                        } else if (answer != 0) {
                            Text(
                                text = "已记 $answer",
                                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                                color = QuietPalette.TextSecondary,
                                modifier = Modifier.padding(start = 28.dp, top = 4.dp)
                            )
                        }
                    }
                    Rule()
                }
            }
        }

        // Filed sheets: the headset sends one per completion and the tablet
        // keeps them, so a session's usability record survives the session.
        Band(
            title = "归档",
            trailing = {
                Key(
                    label = "导出",
                    onClick = actions.onSusExport,
                    kind = KeyKind.Quiet,
                    enabled = state.susHistory.isNotEmpty()
                )
            }
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                if (state.susHistory.isEmpty()) {
                    EmptyNote("暂无归档。完成一份量表后出现在这里。")
                } else {
                    for (record in state.susHistory.asReversed()) {
                        val score = record.score?.let { "$it 分" } ?: "${record.filled}/10"
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = score,
                                style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                                color = QuietPalette.TextPrimary,
                                modifier = Modifier.width(72.dp)
                            )
                            Text(
                                text = record.scene,
                                style = MaterialTheme.typography.bodySmall,
                                color = QuietPalette.TextSecondary,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = stamp(record.completedAt),
                                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                                color = QuietPalette.TextSecondary
                            )
                        }
                        Rule()
                    }
                }
            }
        }
    }
}
