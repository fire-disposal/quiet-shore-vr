package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.voice.VoiceCatalog

/**
 * Voice cue drawer.
 *
 * Everything the operator does here is a name: play this clip, play this
 * sequence, stop. Audio never crosses the link, so every action lands in a few
 * hundred milliseconds and the panel stays usable while a session runs.
 *
 * Order is by frequency of use: transport, sequences, the last three clips, the
 * full catalog, then mixing. Nothing is hidden behind a gesture.
 */
@Composable
fun VoicePanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val connected = state.sessionActive || state.controlGranted
    var expanded by remember { mutableStateOf(emptySet<String>()) }

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
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            NowPlaying(state = state, actions = actions)

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { actions.onVoiceSequence("start") },
                    enabled = connected,
                    modifier = Modifier.weight(1f)
                ) { Text("开始提示") }
                Button(
                    onClick = { actions.onVoiceSequence("relax") },
                    enabled = connected,
                    modifier = Modifier.weight(1f)
                ) { Text("放松指导") }
                OutlinedButton(
                    onClick = actions.onVoiceStop,
                    enabled = connected,
                    modifier = Modifier.weight(1f)
                ) { Text("停止") }
            }

            Seed("序列") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (name in VoiceCatalog.SEQUENCES) {
                        OutlinedButton(
                            onClick = { actions.onVoiceSequence(name) },
                            enabled = connected,
                            modifier = Modifier.weight(1f)
                        ) { Text(sequenceLabel(name)) }
                    }
                }
            }

            Seed("音色") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ToneChoice(
                        label = "男声",
                        selected = state.voiceSet == "male",
                        enabled = connected,
                        modifier = Modifier.weight(1f)
                    ) { actions.onVoiceSet("male") }
                    ToneChoice(
                        label = "女声",
                        selected = state.voiceSet == "female",
                        enabled = connected,
                        modifier = Modifier.weight(1f)
                    ) { actions.onVoiceSet("female") }
                }
            }

            if (state.voiceRecent.isNotEmpty()) {
                Seed("最近") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (id in state.voiceRecent) {
                            val line = VoiceCatalog.line(id)
                            OutlinedButton(
                                onClick = { actions.onVoicePlay(id) },
                                enabled = connected,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = line?.label ?: id,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }
            }

            Seed("全部 ${VoiceCatalog.LINES.size} 句") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((group, lines) in VoiceCatalog.LINES.groupBy { it.group }) {
                        val open = group in expanded
                        TextButton(
                            onClick = {
                                expanded = if (open) expanded - group else expanded + group
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "$group · ${lines.size} 句",
                                modifier = Modifier.weight(1f),
                                color = QuietPalette.TextPrimary
                            )
                            Text(if (open) "▾" else "▸", color = QuietPalette.TextSecondary)
                        }
                        if (open) {
                            for (line in lines) {
                                OutlinedButton(
                                    onClick = { actions.onVoicePlay(line.id) },
                                    enabled = connected,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        text = line.label,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Text(
                                        text = line.id,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = QuietPalette.TextSecondary
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Seed("混音") {
                ValueSlider(
                    label = "语音音量",
                    value = state.voiceVolume,
                    range = 0..100,
                    text = "${state.voiceVolume}",
                    enabled = connected
                ) { actions.onVoiceVolume(it) }
                ValueSlider(
                    label = "水声压低",
                    value = state.duckDb,
                    range = 0..18,
                    text = "${state.duckDb} dB",
                    enabled = connected
                ) { actions.onVoiceDuck(it) }
            }
        }
    }
}

@Composable
private fun NowPlaying(state: ControlUiState, actions: ControlActions) {
    val line = state.voiceLine
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("语音", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(2.dp))
            Text(
                text = when {
                    line != null -> "${line.group} · ${line.label}"
                    state.voiceAuto -> "自动模式待命"
                    else -> "待机"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.TextSecondary
            )
        }
        if (state.voiceAuto) {
            Surface(
                shape = RoundedCornerShape(50),
                color = QuietPalette.Success.copy(alpha = 0.16f),
                contentColor = QuietPalette.Success
            ) {
                Text(
                    text = "自动",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("自动播放", style = MaterialTheme.typography.bodyMedium)
        Switch(
            checked = state.voiceAuto,
            onCheckedChange = actions.onVoiceAuto,
            enabled = state.sessionActive || state.controlGranted
        )
    }
}

@Composable
private fun ToneChoice(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    if (selected) {
        Button(onClick = onClick, enabled = enabled, modifier = modifier) { Text(label) }
    } else {
        OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier) { Text(label) }
    }
}

@Composable
private fun ValueSlider(
    label: String,
    value: Int,
    range: IntRange,
    text: String,
    enabled: Boolean,
    onChange: (Int) -> Unit
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = QuietPalette.TextSecondary)
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { onChange(it.toInt()) },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            enabled = enabled
        )
    }
}

@Composable
private fun Seed(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = QuietPalette.TextSecondary)
        content()
    }
}

private fun sequenceLabel(name: String): String = when (name) {
    "start" -> "开始"
    "imagine" -> "想象"
    "relax" -> "放松"
    "close" -> "收束"
    else -> name
}
