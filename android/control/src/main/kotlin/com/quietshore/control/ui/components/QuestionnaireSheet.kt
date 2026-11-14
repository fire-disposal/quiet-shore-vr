package com.quietshore.control.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.protocol.QuestionnaireCatalogDocument
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The loaded questionnaire, question by question.
 *
 * Nothing here knows what an instrument is: the question count, the wording and
 * the answer options all come from the catalogue the page announced. A
 * three-question instrument with two options draws three rows and two keys; a
 * hundred-question one with nine draws a hundred and nine.
 *
 * Each question carries its own 显示 key, so the operator can bring any item up
 * at the patient's pace; the item on screen also gets 重读, which re-reads it
 * without advancing. Answers are shown against the instrument's own option
 * values — a sheet is never scored here, because a score means whatever the
 * instrument says it means and the page computes it.
 */

private fun questionnaireFilterLabel(state: ControlUiState): String {
    val id = state.questionnaireFilter ?: return "全部"
    return state.questionnaires.firstOrNull { it.id == id }?.nameZh ?: id
}

private fun daysFilterLabel(days: Int): String = when (days) {
    7 -> "7 天"
    30 -> "30 天"
    else -> "全部"
}

/** Wall-clock stamp for an archived sheet; the tablet is the record keeper. */
private fun stamp(epochMs: Long): String {
    if (epochMs <= 0L) return "—"
    return java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(epochMs))
}

/**
 * The archive line for one filed sheet.
 *
 * A scored instrument shows the page's number. An unscored one shows how many
 * of its own questions were answered — against its own count, since "9/10" is
 * only true of a ten-question instrument.
 */
private fun recordProgress(record: com.quietshore.control.protocol.QuestionnaireResult): String {
    val score = record.score
    return score?.let { "$it 分" } ?: "${record.filled}/${record.answers.size}"
}

@Composable
fun QuestionnaireSheet(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier,
    showAnswer: Boolean = true,
    showArchive: Boolean = true
) {
    val connected = state.sessionActive || state.controlGranted

    Column(modifier.fillMaxWidth()) {
        if (showAnswer) {
            val instrument = state.questionnaire
            if (instrument == null) {
                // No catalogue, no sheet. Inventing a question list from a
                // local table used to put one instrument's wording under
                // another's id, which is worse than showing nothing.
                Band(title = "量表") {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        EmptyNote("等待问卷目录")
                        Text(
                            text = "头显页面尚未公布问卷；连接后在「场景化问卷作答器」中等待目录同步。",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                }
            } else {
                AnswerBody(state, instrument, actions, connected)
            }
        }
        // Filed sheets: the headset sends one per completion and the tablet
        // keeps them, so a session's record survives the session.
        if (showArchive) {
            ArchiveBody(state, actions)
        }
    }
}

@Composable
private fun AnswerBody(
    state: ControlUiState,
    instrument: QuestionnaireCatalogDocument.Questionnaire,
    actions: ControlActions,
    connected: Boolean
) {
    val answers = state.questionnaireAnswers
    val answered = answers.count { it != 0 }
    val current = state.questionnaireIndex
    val questions = instrument.questions

    Band(
        title = "量表",
        trailing = {
            Text(
                text = "$answered/${questions.size}",
                style = MaterialTheme.typography.labelLarge.tabularFigures(),
                color = QuietPalette.TextPrimary
            )
        }
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
            Text(
                text = "当前量表：${instrument.nameZh}",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
            if (instrument.shortZh.isNotEmpty()) {
                Text(
                    text = instrument.shortZh,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            Spacer(Modifier.height(8.dp))
            // The instrument selector: one chip per announced questionnaire.
            // A single-instrument registry draws one chip and reads as a label.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                for (option in state.questionnaires) {
                    Key(
                        label = option.nameZh,
                        onClick = { actions.onQuestionnaireSelect(option.id) },
                        kind = if (option.id == instrument.id) KeyKind.Fill else KeyKind.Outline,
                        enabled = connected && option.id != instrument.id
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Key(
                    label = "打开量表",
                    onClick = actions.onQuestionnaireOpen,
                    modifier = Modifier.weight(1f),
                    kind = KeyKind.Fill,
                    enabled = connected
                )
                Key(
                    label = "关闭量表",
                    onClick = actions.onQuestionnaireClose,
                    modifier = Modifier.weight(1f),
                    enabled = connected
                )
            }
            // Launching the face is not the same as opening the sheet: a
            // questionnaire launch deliberately skips the preparation room and
            // the calibration capture, so this is the only door onto it when
            // the page is not already up. It is enabled below READY because the
            // headset can boot the page with no tablet link at all.
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Key(
                    label = "启动问卷",
                    onClick = actions.onEnterQuestionnaire,
                    modifier = Modifier.weight(1f),
                    kind = KeyKind.Outline
                )
                Key(
                    label = "结束问卷",
                    onClick = actions.onEnd,
                    modifier = Modifier.weight(1f),
                    kind = KeyKind.Quiet,
                    enabled = state.sessionActive
                )
            }
            Text(
                text = if (current in 1..questions.size) {
                    "当前第 $current 题。"
                } else {
                    "未开始。打开量表逐题出现。"
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
                note = "患者注视选项停住即作答。"
            )
            Rule()
            SwitchRow(
                title = "朗读题干",
                checked = state.questionnaireVoice,
                onCheckedChange = actions.onQuestionnaireVoiceChange,
                enabled = connected,
                note = "显示题目时朗读题干。"
            )
        }
    }

    Band(title = "题目") {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
            for ((index, question) in questions.withIndex()) {
                val number = index + 1
                val answer = answers.getOrNull(index) ?: 0
                val isCurrent = current == number
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp)
                ) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(
                            text = "$number",
                            style = MaterialTheme.typography.titleMedium.tabularFigures(),
                            color = if (isCurrent) {
                                QuietPalette.TextPrimary
                            } else {
                                QuietPalette.TextSecondary
                            },
                            modifier = Modifier
                                .width(28.dp)
                                .padding(top = 8.dp)
                        )
                        Text(
                            text = question.textZh,
                            style = MaterialTheme.typography.bodyMedium,
                            color = QuietPalette.TextPrimary,
                            modifier = Modifier
                                .weight(1f)
                                .padding(top = 8.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (isCurrent) {
                                // Replay only exists for the item on screen: it
                                // re-reads that question and moves nothing.
                                Key(
                                    label = "重读",
                                    onClick = actions.onQuestionnaireReplay,
                                    kind = KeyKind.Outline,
                                    enabled = connected,
                                    minWidth = TouchTarget
                                )
                            }
                            Key(
                                label = "显示",
                                onClick = { actions.onQuestionnaireShow(number) },
                                kind = if (isCurrent) KeyKind.Fill else KeyKind.Quiet,
                                enabled = connected,
                                minWidth = TouchTarget
                            )
                        }
                    }
                    if (isCurrent) {
                        Spacer(Modifier.height(8.dp))
                        // The instrument's own answer options: their values are
                        // the wire's, their labels are the patient's wording.
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            for (option in instrument.options) {
                                Key(
                                    label = option.labelZh,
                                    onClick = { actions.onQuestionnaireAnswer(option.value) },
                                    kind = if (answer == option.value) {
                                        KeyKind.Fill
                                    } else {
                                        KeyKind.Outline
                                    },
                                    enabled = connected,
                                    minWidth = TouchTarget
                                )
                            }
                        }
                    } else if (answer != 0) {
                        val label = instrument.options
                            .firstOrNull { it.value == answer }
                            ?.labelZh
                            ?: "$answer"
                        Text(
                            text = "已记 $label",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary,
                            modifier = Modifier.padding(start = 28.dp, top = 4.dp)
                        )
                    }
                }
                Rule()
            }
        }
    }
}

@Composable
private fun ArchiveBody(state: ControlUiState, actions: ControlActions) {
    val cutoff = if (state.questionnaireFilterDays <= 0) {
        Long.MIN_VALUE
    } else {
        System.currentTimeMillis() - state.questionnaireFilterDays * 24L * 3600L * 1000L
    }
    val archived = state.questionnaireHistory.filter { record ->
        (state.questionnaireFilter == null ||
            record.questionnaireId == state.questionnaireFilter) &&
            record.completedAt >= cutoff
    }
    Band(
        title = "记录",
        trailing = {
            Key(
                label = "导出",
                onClick = actions.onExportRecords,
                kind = KeyKind.Quiet,
                enabled = archived.isNotEmpty()
            )
        }
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Key(
                    label = "问卷：${questionnaireFilterLabel(state)}",
                    onClick = actions.onQuestionnaireFilter,
                    kind = KeyKind.Outline,
                    enabled = state.questionnaireHistory.isNotEmpty()
                )
                Key(
                    label = "时间：${daysFilterLabel(state.questionnaireFilterDays)}",
                    onClick = actions.onQuestionnaireFilterDays,
                    kind = KeyKind.Outline,
                    enabled = state.questionnaireHistory.isNotEmpty()
                )
            }
            Spacer(Modifier.height(8.dp))
            if (archived.isEmpty()) {
                EmptyNote(
                    if (state.questionnaireHistory.isEmpty()) "暂无归档" else "当前筛选没有记录"
                )
            } else {
                for (record in archived.asReversed()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = recordProgress(record),
                            style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                            color = QuietPalette.TextPrimary,
                            modifier = Modifier.width(72.dp)
                        )
                        Text(
                            text = record.questionnaireName.ifEmpty { record.questionnaireId },
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
