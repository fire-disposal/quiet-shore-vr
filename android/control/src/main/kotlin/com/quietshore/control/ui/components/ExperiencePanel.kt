package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.quietshore.control.data.EXPERIENCE_RECORDS
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.EXPERIENCE_MAX_RATING
import com.quietshore.control.model.ExperienceDraft
import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.model.FloatDirection
import com.quietshore.control.model.experienceStamp
import com.quietshore.control.model.sceneNameOf
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.ExperienceField
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * 体验 — the operator's observation sheet.
 *
 * One form, one list, one export. The form is filled in after the headset is
 * off, at the bedside, with one hand: so every rating is a tap on a 0–10 row
 * (not a text field, not a slider), the two facts nobody types — scene and
 * session length — are captured when the form opens and printed read-only, and
 * the save is the only fill on the page.
 *
 * The list is the same page rather than a second tab because the point of
 * filing a record is seeing it appear: an operator who saves and is shown a
 * form that merely clears has no proof anything was written.
 */
@Composable
fun ExperiencePanel(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val draft = state.experienceDraft
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)) {
        if (draft == null) {
            Band(
                title = "体验记录",
                trailing = {
                    Key(
                        label = "填写体验表",
                        onClick = actions.onExperienceOpen,
                        kind = KeyKind.Fill,
                        minWidth = 132.dp
                    )
                }
            ) {
                Column(BandBody) {
                    Text(
                        text = "取下头显后填一张表：场景与时长自动记录，评分 0–10。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.InkSecondary
                    )
                }
            }
        } else {
            ExperienceForm(
                draft = draft,
                scenes = state.scenes,
                actions = actions
            )
        }
        ExperienceList(
            records = state.experienceHistory,
            scenes = state.scenes,
            onExport = actions.onExperienceExportCsv,
            onDelete = actions.onExperienceDelete,
            onClear = actions.onExperienceClear
        )
    }
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

@Composable
private fun ExperienceForm(
    draft: ExperienceDraft,
    scenes: List<com.quietshore.control.model.SceneCatalog.Scene>,
    actions: ControlActions
) {
    val sceneName = sceneNameOf(draft.scene, scenes)
    Band(
        title = "体验表",
        trailing = {
            Key(
                label = "取消",
                onClick = actions.onExperienceCancel,
                kind = KeyKind.Quiet
            )
        }
    ) {
        Column(BandBody, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // The two captured facts, read-only: a scene name the operator
            // cannot edit is a scene name the CSV can be trusted with.
            Row(verticalAlignment = Alignment.CenterVertically) {
                FactRow(
                    label = "场景",
                    value = sceneName,
                    numeric = false,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(16.dp))
                FactRow(
                    label = "日期",
                    value = experienceStamp(draft.openedAt),
                    numeric = true,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(16.dp))
                FactRow(
                    label = "时长",
                    value = clock(draft.sessionSec * 1000L),
                    numeric = true,
                    modifier = Modifier.weight(1f)
                )
            }
            Rule()
            ParticipantField(
                value = draft.participant,
                onChange = actions.onExperienceParticipant
            )
            Rule()
            // Eight rows, one scale: the label on the left, the band on the
            // right. The band is the same widget for every row so the operator
            // reads the shape of the sheet, not eight different controls.
            for (field in ExperienceField.entries) {
                RatingRow(
                    label = field.label,
                    value = draft.ratingOf(field),
                    onChange = { actions.onExperienceRating(field, it) }
                )
                if (field != ExperienceField.entries.last()) {
                    Rule()
                }
            }
            Rule()
            DirectionRow(
                current = draft.direction,
                onSelect = actions.onExperienceDirection
            )
            Rule()
            NotesField(value = draft.notes, onChange = actions.onExperienceNotes)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "保存后立即进入下方记录；导出为 CSV 表格。",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary,
                    modifier = Modifier.weight(1f)
                )
                Key(
                    label = "保存记录",
                    onClick = actions.onExperienceSave,
                    kind = KeyKind.Fill,
                    minWidth = 132.dp,
                    height = TouchTarget
                )
            }
        }
    }
}

/** The draft's value for [field]; one mapping, so the form cannot drift. */
private fun ExperienceDraft.ratingOf(field: ExperienceField): Int = when (field) {
    ExperienceField.FloatStrength -> floatStrength
    ExperienceField.Disorientation -> disorientation
    ExperienceField.SceneRealism -> sceneRealism
    ExperienceField.BodyAlignment -> bodyAlignment
    ExperienceField.Comfort -> comfort
    ExperienceField.Dizziness -> dizziness
    ExperienceField.Nausea -> nausea
    ExperienceField.RepeatWish -> repeatWish
}

/**
 * One 0–10 scale: eleven keys.
 *
 * A slider would be faster to *sweep* and slower to *agree on* — two operators
 * reading the same patient should produce the same number, and a stepped row
 * makes that possible while a 460 dp drag does not. The keys are 44 dp wide at
 * the floor so a gloved thumb still hits one.
 */
@Composable
private fun RatingRow(
    label: String,
    value: Int,
    onChange: (Int) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            maxLines = 1,
            modifier = Modifier.width(RATING_LABEL_WIDTH)
        )
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (step in 0..EXPERIENCE_MAX_RATING) {
                RatingKey(
                    value = step,
                    selected = step == value,
                    onClick = { onChange(step) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        NumberText(
            text = value.toString(),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.width(28.dp)
        )
    }
}

/**
 * One number on the scale. Selected is a fill — the console's rule is that a
 * fill means "this does something now", and pressing a number is exactly that.
 */
@Composable
private fun RatingKey(
    value: Int,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .background(if (selected) QuietPalette.Ice else QuietPalette.Paper)
            .then(
                if (selected) {
                    Modifier
                } else {
                    Modifier.border(1.dp, QuietPalette.Hairline)
                }
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = value.toString(),
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            textAlign = TextAlign.Center
        )
    }
}

/** 受试者编号: optional, at most [PARTICIPANT_MAX] characters. */
@Composable
private fun ParticipantField(value: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "受试者编号",
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            modifier = Modifier.width(RATING_LABEL_WIDTH)
        )
        TextField(
            value = value,
            onChange = onChange,
            hint = "可选，如 P07",
            maxLength = PARTICIPANT_MAX,
            keyboardType = KeyboardType.Text,
            modifier = Modifier.width(220.dp)
        )
        Spacer(Modifier.weight(1f))
        if (value.isEmpty()) {
            Text(
                text = "留空则记名 —",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
        }
    }
}

/** 备注: optional free text, deliberately longer than a code. */
@Composable
private fun NotesField(value: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = "备注",
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            modifier = Modifier
                .width(RATING_LABEL_WIDTH)
                .padding(top = 14.dp)
        )
        TextField(
            value = value,
            onChange = onChange,
            hint = "可选：患者原话、体位、设备异常",
            maxLength = NOTES_MAX,
            keyboardType = KeyboardType.Text,
            singleLine = false,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * A hairline box that reads as a field.
 *
 * `BasicTextField` with the console's own box, not Material's outlined field:
 * the app has one border, one ink, one radius (none), and a Material field
 * would arrive with a second of each.
 */
@Composable
private fun TextField(
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    maxLength: Int,
    keyboardType: KeyboardType,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true
) {
    val focus = LocalFocusManager.current
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        // The cap is applied on the way in: a paste is the case this guards.
        onValueChange = { raw ->
            val normalized = if (singleLine) raw.replace("\n", " ") else raw
            onChange(normalized.take(maxLength))
        },
        singleLine = singleLine,
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = QuietPalette.Ink),
        keyboardOptions = KeyboardOptions(
            keyboardType = keyboardType,
            imeAction = if (singleLine) ImeAction.Done else ImeAction.Default
        ),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        cursorBrush = SolidColor(QuietPalette.Ink),
        modifier = modifier
            .height(if (singleLine) 48.dp else 60.dp)
            .border(1.dp, if (focused) QuietPalette.Ink else QuietPalette.Hairline)
            .onFocusChanged { focused = it.isFocused }
            .padding(horizontal = 12.dp, vertical = 12.dp)
    ) { inner ->
        Box {
            if (value.isEmpty()) {
                Text(
                    text = hint,
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.Disabled,
                    maxLines = if (singleLine) 1 else 2
                )
            }
            inner()
        }
    }
}

/**
 * 漂浮方向: four choices, one row.
 *
 * Four, not eleven: "the float was 7 up" is not something an operator can judge,
 * while "it felt like going up" is what the patient said out loud. A fifth
 * answer — no direction at all — is allowed and is the initial state, which is
 * why no key starts filled.
 */
@Composable
private fun DirectionRow(current: String, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "漂浮方向",
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            modifier = Modifier.width(RATING_LABEL_WIDTH)
        )
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            for (id in FloatDirection.ids) {
                Key(
                    label = FloatDirection.label(id),
                    onClick = { onSelect(id) },
                    kind = if (id == current) KeyKind.Selected else KeyKind.Outline,
                    modifier = Modifier.weight(1f),
                    height = 52.dp
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Filed records, newest first, each one expandable.
 *
 * The collapsed row carries the four facts that decide whether the operator
 * needs to look: who, where, comfort, and whether the patient would do it
 * again. Everything else — the six other scales, the direction, the notes — is
 * one tap away, because a wall of fifteen columns is not a list, it is a
 * spreadsheet drawn badly.
 */
@Composable
private fun ExperienceList(
    records: List<ExperienceRecord>,
    scenes: List<com.quietshore.control.model.SceneCatalog.Scene>,
    onExport: () -> Unit,
    onDelete: (Long) -> Unit,
    onClear: () -> Unit
) {
    var expanded by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var confirmClear by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Long?>(null) }
    Band(
        title = "记录",
        trailing = {
            Text(
                text = if (records.isEmpty()) "" else "${records.size} 条",
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.InkSecondary
            )
            if (records.isNotEmpty()) {
                Key(
                    label = if (confirmClear) "确认清空" else "清空",
                    onClick = {
                        if (confirmClear) {
                            onClear()
                            confirmClear = false
                        } else {
                            confirmClear = true
                        }
                    },
                    kind = KeyKind.Danger,
                    minWidth = 76.dp
                )
            }
            Key(
                label = "导出 CSV",
                onClick = onExport,
                kind = if (records.isEmpty()) KeyKind.Outline else KeyKind.Fill,
                // Off while there is nothing to export: the export itself also
                // refuses (an operator who reaches it another way gets a
                // sentence), but a live key over an empty list promises a file
                // it will not produce.
                enabled = records.isNotEmpty(),
                minWidth = 116.dp
            )
        }
    ) {
        Column(BandBody) {
            if (records.isEmpty()) {
                EmptyNote("还没有记录。填一张体验表，保存后出现在这里，再导出为 CSV。")
                return@Column
            }
            Text(
                text = "本机最多保留 $EXPERIENCE_RECORDS 条；超出后最旧记录自动移除。",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary,
                modifier = Modifier.padding(bottom = 4.dp)
            )
            val shown = records.asReversed()
            for (index in shown.indices) {
                val record = shown[index]
                ExperienceRow(
                    record = record,
                    scenes = scenes,
                    open = record.id in expanded,
                    deleteArmed = confirmDelete == record.id,
                    onToggle = {
                        confirmDelete = null
                        expanded = if (record.id in expanded) {
                            expanded - record.id
                        } else {
                            expanded + record.id
                        }
                    },
                    onDelete = {
                        if (confirmDelete == record.id) {
                            onDelete(record.id)
                            confirmDelete = null
                            expanded = expanded - record.id
                        } else {
                            confirmDelete = record.id
                        }
                    }
                )
                // A hairline between rows, never after the last one.
                if (index != shown.lastIndex) {
                    Rule()
                }
            }
        }
    }
}

@Composable
private fun ExperienceRow(
    record: ExperienceRecord,
    scenes: List<com.quietshore.control.model.SceneCatalog.Scene>,
    open: Boolean,
    deleteArmed: Boolean,
    onToggle: () -> Unit,
    onDelete: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onToggle
            )
            .padding(vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = experienceStamp(record.at),
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.InkSecondary,
                modifier = Modifier.width(96.dp)
            )
            Text(
                text = record.participantLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.Ink,
                modifier = Modifier.width(64.dp)
            )
            Text(
                text = record.sceneLabel(scenes),
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.Ink,
                modifier = Modifier.width(96.dp)
            )
            Text(
                text = "舒适 ${record.comfort} · 再体验 ${record.repeatWish}",
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.InkSecondary,
                modifier = Modifier.weight(1f)
            )
            Key(
                label = if (open) "收起" else "展开",
                onClick = onToggle,
                kind = KeyKind.Quiet,
                minWidth = 64.dp
            )
        }
        if (open) {
            Spacer(Modifier.height(10.dp))
            // Four per row, two rows: the full sheet without a horizontal
            // scroller on a tablet held at the bedside.
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val facts = listOf(
                    "失重强度" to record.floatStrength.toString(),
                    "方向感错乱" to record.disorientation.toString(),
                    "场景真实感" to record.sceneRealism.toString(),
                    "身体对齐" to record.bodyAlignment.toString(),
                    "舒适度" to record.comfort.toString(),
                    "头晕" to record.dizziness.toString(),
                    "恶心" to record.nausea.toString(),
                    "再次体验意愿" to record.repeatWish.toString()
                )
                for (chunk in facts.chunked(4)) {
                    Row(Modifier.fillMaxWidth()) {
                        for ((label, value) in chunk) {
                            Row(
                                modifier = Modifier.weight(1f),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = QuietPalette.InkSecondary
                                )
                                Spacer(Modifier.width(8.dp))
                                NumberText(
                                    text = value,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth()) {
                    Text(
                        text = "漂浮方向",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = record.directionLabel,
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.Ink
                    )
                    Spacer(Modifier.width(24.dp))
                    Text(
                        text = "时长",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
                    Spacer(Modifier.width(8.dp))
                    NumberText(
                        text = clock(record.sessionSec * 1000L),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                if (record.notes.isNotEmpty()) {
                    Text(
                        text = "备注：${record.notes}",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.Ink
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Key(
                        label = if (deleteArmed) "确认删除" else "删除",
                        onClick = onDelete,
                        kind = KeyKind.Danger,
                        minWidth = 88.dp
                    )
                }
            }
        }
    }
}

/** Wide enough for the longest scale name ("再次体验意愿") at 1.3× font scale. */
private val RATING_LABEL_WIDTH = 132.dp

/** A subject code, not a participant name: nothing identifying is stored. */
private const val PARTICIPANT_MAX = 8

/** Long enough for a sentence or two of bedside note, short enough to scan. */
private const val NOTES_MAX = 200
