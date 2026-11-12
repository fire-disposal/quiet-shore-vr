package com.quietshore.control.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.voice.VoiceCatalog

/**
 * Voice cue drawer.
 *
 * Everything the operator does here is a name: play this line, play this
 * sequence, stop. Audio never crosses the link, so every action lands in a few
 * hundred milliseconds and the panel stays usable while a session runs.
 *
 * Order is by frequency of use: transport, what is speaking now, the two
 * switches, sequences, tone, mixing, then the full catalog.
 */
@Composable
fun VoicePanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    // Enabled whenever the link is up: a voice command is a play request, not
    // a claim on the world, so it does not need the control grant.
    val connected = state.phase == BlePhase.READY
    // Every guidance group starts open: a sentence the operator has to expand
    // first is a sentence they will not use mid-session. SUS is excluded — its
    // statements are read by the panel as they appear, so tapping one here
    // would talk over the schedule.
    val guidance = VoiceCatalog.LINES.filter { it.group != "SUS" }
    var expanded by remember { mutableStateOf(guidance.map { it.group }.toSet()) }

    val cursor = guidance.indexOfFirst { it.id == state.voiceLine?.id }
    val previousLine = if (cursor > 0) guidance[cursor - 1] else null
    val nextLine = when {
        cursor < 0 -> guidance.firstOrNull()
        cursor < guidance.lastIndex -> guidance[cursor + 1]
        else -> null
    }

    Column(modifier.fillMaxWidth()) {
        Band(
            title = "正在播放",
            trailing = {
                Text(
                    text = if (connected) "可播放" else "未连接",
                    style = MaterialTheme.typography.labelLarge,
                    color = QuietPalette.TextSecondary
                )
            }
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                val line = state.voiceLine
                Text(
                    text = line?.text ?: "未播放",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (line != null) QuietPalette.TextPrimary else QuietPalette.TextSecondary
                )
                if (line != null) {
                    Text(
                        text = line.group,
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.TextSecondary,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Key(
                        label = "停止",
                        onClick = actions.onVoiceStop,
                        modifier = Modifier.weight(1f),
                        enabled = connected
                    )
                    Key(
                        label = "上一句",
                        onClick = { previousLine?.let { actions.onVoicePlay(it.id) } },
                        modifier = Modifier.weight(1f),
                        enabled = connected && previousLine != null
                    )
                    Key(
                        label = "下一句",
                        onClick = { nextLine?.let { actions.onVoicePlay(it.id) } },
                        modifier = Modifier.weight(1f),
                        kind = KeyKind.Fill,
                        enabled = connected && nextLine != null
                    )
                }
                Text(
                    text = nextLine?.let { "下一句：${it.group}" } ?: "已是最后一句",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }

        Band(title = "播放设置") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                SwitchRow(
                    title = "字幕",
                    checked = state.subtitles,
                    onCheckedChange = actions.onSubtitlesChange,
                    enabled = connected,
                    note = "在患者画面下方显示，播完消失。"
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

        // Four scripted sequences. The page owns the pacing and keeps the bed
        // ducked until the last line, so one tap runs the whole arc.
        Band(title = "连续播放") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                for ((label, name) in listOf(
                    "开始" to "start",
                    "想象" to "imagine",
                    "放松" to "relax",
                    "收束" to "close"
                )) {
                    Key(
                        label = label,
                        onClick = { actions.onVoiceSequence(name) },
                        modifier = Modifier.weight(1f),
                        enabled = connected
                    )
                }
            }
        }

        Band(title = "音色") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "切换音色会短暂停顿。",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.weight(1f)
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, id) in listOf("女声" to "female", "男声" to "male")) {
                        Key(
                            label = label,
                            onClick = { actions.onVoiceSet(id) },
                            kind = if (state.voiceSet == id) KeyKind.Fill else KeyKind.Outline,
                            enabled = connected,
                            minWidth = TouchTarget + 32.dp
                        )
                    }
                }
            }
        }

        Band(title = "声音") {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = TouchTarget)
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "水声",
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.TextPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    Key(
                        label = if (state.control.audioMuted) "开始水声" else "暂停水声",
                        onClick = actions.onToggleAudio,
                        enabled = connected,
                        minWidth = TouchTarget + 32.dp
                    )
                }
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

        // Guidance lines are played by hand; SUS is not in this list.
        Band(
            title = "语音提示",
            trailing = {
                Text(
                    text = "${guidance.size} 句",
                    style = MaterialTheme.typography.labelLarge.tabularFigures(),
                    color = QuietPalette.TextSecondary
                )
            }
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                for ((group, lines) in guidance.groupBy { it.group }) {
                    val open = group in expanded
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = TouchTarget)
                            .clickable(
                                role = Role.Button,
                                indication = null,
                                interactionSource = remember { MutableInteractionSource() }
                            ) {
                                expanded = if (open) expanded - group else expanded + group
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = group,
                            style = MaterialTheme.typography.labelLarge,
                            color = QuietPalette.TextPrimary,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = "${lines.size} 句，${if (open) "收起" else "展开"}",
                            style = MaterialTheme.typography.bodySmall.tabularFigures(),
                            color = QuietPalette.TextSecondary
                        )
                    }
                    Rule()
                    if (open) {
                        for (line in lines) {
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color = QuietPalette.TextPrimary,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(
                                        enabled = connected,
                                        role = Role.Button,
                                        indication = null,
                                        interactionSource = remember { MutableInteractionSource() }
                                    ) { actions.onVoicePlay(line.id) }
                                    .padding(vertical = 12.dp),
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }
        }
    }
}

/** One labelled slider with its value at the right, tabular. */
@Composable
private fun ValueSlider(
    label: String,
    value: Int,
    range: IntRange,
    text: String,
    enabled: Boolean,
    onChange: (Int) -> Unit
) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.TextPrimary,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                color = QuietPalette.TextSecondary
            )
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { onChange(it.toInt()) },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            enabled = enabled,
            colors = SliderDefaults.colors(
                thumbColor = QuietPalette.TextPrimary,
                activeTrackColor = QuietPalette.Ice,
                inactiveTrackColor = QuietPalette.Hairline,
                disabledThumbColor = QuietPalette.Disabled,
                disabledActiveTrackColor = QuietPalette.IceMuted,
                disabledInactiveTrackColor = QuietPalette.Hairline
            )
        )
    }
}
