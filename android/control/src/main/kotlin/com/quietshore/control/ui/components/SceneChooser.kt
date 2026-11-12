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
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.ui.theme.QuietPalette

/** The pressable shape for a scene: cut bottom-right, so the cut never hits a label. */
private val SceneShape = CutCornerShape(0.dp, 0.dp, 14.dp, 0.dp)

/**
 * The four shipped scenes as a row of cards: name over the one phrase that
 * says what the patient will be inside, the loaded one filled with ice.
 *
 * This is the only place on the console where a scene can be chosen. The bar's
 * session row shows the scene's name; it is not a second entry point.
 */
@Composable
fun SceneChooser(
    current: String,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** The headset's own report, drawn as the small "playing" mark. */
    playing: String? = null
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        for (scene in SceneCatalog.ALL) {
            Box(Modifier.weight(1f)) {
                SceneCardView(
                    scene = scene,
                    current = scene.id == current,
                    enabled = enabled,
                    onSelect = onSelect,
                    showBlurb = true,
                    playing = playing != null && scene.id == playing
                )
            }
        }
    }
}

/**
 * One scene card. A loaded scene is *state*, so it is drawn as state: a 4 dp
 * ice bar on its leading edge, an ice hairline, ink at medium weight — never a
 * fill. A filled block on this screen always means "pressing it does something
 * now", and a scene that is already loaded is not that. A cut corner says
 * "pressable"; nothing else on paper has a shape.
 */
@Composable
fun SceneCardView(
    scene: SceneCatalog.Scene,
    current: Boolean,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    showBlurb: Boolean = false,
    /** The headset reports this scene as the one it is playing. */
    playing: Boolean = false
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = if (showBlurb) 116.dp else TouchTarget)
            .clip(SceneShape)
            .background(QuietPalette.Board)
            .then(
                if (current) {
                    Modifier.border(2.dp, QuietPalette.Ice, SceneShape)
                } else {
                    Modifier.border(1.dp, QuietPalette.Hairline, SceneShape)
                }
            )
            .semantics { selected = current }
            .clickable(
                enabled = enabled,
                role = Role.RadioButton,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = { onSelect(scene.id) }
            )
            .padding(
                horizontal = if (showBlurb) 16.dp else 10.dp,
                vertical = if (showBlurb) 18.dp else 16.dp
            ),
        verticalArrangement = Arrangement.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (current) {
                // The leading ice bar: the selection mark that does not need a
                // fill, and survives being printed in one colour.
                Box(
                    Modifier
                        .width(4.dp)
                        .height(if (showBlurb) 44.dp else 24.dp)
                        .background(QuietPalette.Ice)
                )
                Spacer(Modifier.width(12.dp))
            }
            Text(
                text = scene.name,
                style = if (showBlurb) {
                    MaterialTheme.typography.titleMedium
                } else {
                    MaterialTheme.typography.titleSmall
                },
                fontWeight = if (current) FontWeight.Medium else null,
                color = if (enabled || current) QuietPalette.Ink else QuietPalette.Disabled,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (showBlurb || playing) {
            Spacer(Modifier.height(6.dp))
            // One line of supporting text, never two blocks: when the headset
            // is playing this scene, that fact replaces the blurb — the chosen
            // scene's description is the least useful thing on the card then.
            Text(
                text = when {
                    playing -> "头显正在播放"
                    showBlurb -> scene.blurb.ifEmpty { " " }
                    else -> " "
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (playing) QuietPalette.Ink else QuietPalette.InkSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * Width the console's action column takes on a wide screen: 460 dp of the
 * 1216 dp content width, so the reading half keeps ~1.4× the room of the
 * pressing half — the figures and the mirror need the width, a column of keys
 * does not.
 */
val ActionColumnWidth = 460.dp

/** A section's title over the page, with the one fact it is about on the right. */
@Composable
fun SectionHead(
    title: String,
    note: String? = null,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 16.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            color = QuietPalette.Ink
        )
        if (note != null) {
            Spacer(Modifier.width(16.dp))
            Text(
                text = note,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
        }
    }
}

/** A full-width key row: two or three keys of equal weight. */
@Composable
fun KeyRow(
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        content = content
    )
}
