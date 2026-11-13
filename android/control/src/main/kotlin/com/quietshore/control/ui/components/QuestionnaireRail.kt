package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The questionnaire app's two jobs: answer the loaded instrument, or work the
 * archive. Same rail geometry as the guidance app, so the operator does not
 * learn a second navigation.
 */
enum class QuestionnaireSection(val latin: String, val label: String) {
    Answer("ANSWER", "作答"),
    Archive("ARCHIVE", "归档"),
    /** The manual, as a page, in the same place the guidance app keeps it. */
    Guide("GUIDE", "说明")
}

@Composable
fun QuestionnaireRail(
    current: QuestionnaireSection,
    onSelect: (QuestionnaireSection) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .width(RailWidth)
            .fillMaxHeight()
            .background(QuietPalette.Board)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp, horizontal = 8.dp)
    ) {
        for (section in QuestionnaireSection.entries) {
            RailTab(
                label = section.label,
                selected = section == current,
                onClick = { onSelect(section) }
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}
