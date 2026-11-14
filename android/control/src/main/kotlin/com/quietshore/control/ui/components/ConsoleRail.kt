package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console's faces, in a left rail.
 *
 * A bottom bar on a 10" landscape tablet wastes the one dimension that is short
 * (height) and puts the targets where a hand holding the tablet cannot reach
 * without moving it. A left rail uses the width the page already has, keeps the
 * labels in a column that reads top-to-bottom like the procedure itself, and —
 * because it scrolls — it survives a short window without clipping.
 *
 * The order is the shift's order: what the patient is doing, where, what sounds
 * they hear, what they said about it afterwards, then the manual.
 */
enum class ConsoleSection(val label: String, val latin: String) {
    Session("会话", "SESSION"),
    Audio("音频", "AUDIO"),
    /**
     * The operator's observation sheet: filled in once the headset is off.
     *
     * It sits after 音频 and before 说明 because that is when it is used — after
     * the session, when the technician is still at the bedside and before they
     * open the manual again. It is an operator tool, so it lives on this rail
     * and nowhere in the questionnaire app.
     */
    Experience("体验", "EXPERIENCE"),
    /** The manual, as a page: it used to be an overlay reached from the bar. */
    Guide("说明", "GUIDE")
}

/** Width of the rail: one Chinese label plus its trace, no second line. */
val RailWidth = 96.dp

@Composable
fun ConsoleRail(
    current: ConsoleSection,
    onSelect: (ConsoleSection) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(RailWidth)
            .background(QuietPalette.Board)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp, horizontal = 8.dp)
            .semantics { role = Role.Tab }
    ) {
        for (section in ConsoleSection.entries) {
            RailItem(
                section = section,
                selected = section == current,
                onClick = { onSelect(section) }
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun RailItem(
    section: ConsoleSection,
    selected: Boolean,
    onClick: () -> Unit
) {
    RailTab(label = section.label, selected = selected, onClick = onClick)
}

/**
 * One tab, in the one style both rails use.
 *
 * A tab is a location, not an action: it takes a trace on its leading edge and
 * ink, never the ice fill. The fill on this console means "pressing this does
 * something now", and a filled tab competed with the one primary of whichever
 * page was open. Shared by the guidance rail and the questionnaire rail so the
 * operator does not learn a second navigation.
 */
@Composable
internal fun RailTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clickable(
                                                role = Role.Tab,
                onClick = onClick
            )
            .semantics { this.selected = selected }
            .padding(start = 10.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(4.dp)
                .height(24.dp)
                .background(if (selected) QuietPalette.Ice else Color.Transparent)
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) QuietPalette.Ink else QuietPalette.InkSecondary,
            maxLines = 1,
            overflow = TextOverflow.Clip
        )
    }
}

/** Hairline between the rail and the page; the rail is chrome, not content. */
@Composable
fun RailRule() {
    androidx.compose.foundation.layout.Box(
        Modifier
            .fillMaxHeight()
            .width(1.dp)
            .background(QuietPalette.Hairline)
    )
}

/** Spacing used between a rail and the page it belongs to. */
val RailGap = QuietSpace.Row
