package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
 * own play button: the operator advances at the patient's pace and never has to
 * hunt through a flat list. Wording is the instrument's, verbatim.
 */
@Composable
fun SusPanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.sessionActive || state.controlGranted
    val items = VoiceCatalog.LINES.filter { it.group == "SUS" }
    val intro = items.firstOrNull { it.id == "v-sus-intro" }
    val questions = items.filter { it.id != "v-sus-intro" }

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
            Text("SUS 量表", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "逐题播放，患者作答后再进入下一题；不需要连播。",
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.TextSecondary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = actions.onSusOpen,
                    enabled = connected,
                    modifier = Modifier.weight(1f)
                ) { Text("在头显中打开") }
                OutlinedButton(
                    onClick = actions.onSusClose,
                    enabled = connected,
                    modifier = Modifier.weight(1f)
                ) { Text("关闭") }
            }
            if (intro != null) {
                OutlinedButton(
                    onClick = { actions.onVoicePlay(intro.id) },
                    enabled = connected,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("播放说明") }
            }

            for ((index, line) in questions.withIndex()) {
                val number = index + 1
                val answer = state.susAnswers.getOrNull(index) ?: 0
                val current = state.susIndex == number
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "$number.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (current) QuietPalette.Primary else QuietPalette.TextSecondary,
                            modifier = Modifier.padding(end = 8.dp)
                        )
                        Text(
                            text = line.text,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedButton(
                            onClick = { actions.onVoicePlay(line.id) },
                            enabled = connected
                        ) { Text("播放") }
                        Spacer(Modifier.height(4.dp))
                        OutlinedButton(
                            onClick = { actions.onSusShow(number) },
                            enabled = connected
                        ) { Text("显示") }
                    }
                    if (current) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (value in 1..5) {
                                val chosen = answer == value
                                if (chosen) {
                                    Button(
                                        onClick = { actions.onSusAnswer(value) },
                                        enabled = connected
                                    ) { Text("$value") }
                                } else {
                                    OutlinedButton(
                                        onClick = { actions.onSusAnswer(value) },
                                        enabled = connected
                                    ) { Text("$value") }
                                }
                            }
                        }
                    } else if (answer != 0) {
                        Text(
                            text = "已记录：$answer",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary
                        )
                    }
                }
            }

            if (state.voiceLine != null) {
                Text(
                    text = "正在播放：${state.voiceLine!!.text}",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
        }
    }
}
