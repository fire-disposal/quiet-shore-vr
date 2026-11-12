package com.quietshore.control.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.ControlMotion
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console's whole vocabulary, in one file: rule, panel, band, key, chip,
 * meter, notice. Every screen composes out of these, so the palette, the type
 * ladder, the touch sizes and the "no radius / no shadow" rule are decided
 * once.
 *
 * Rules encoded here, not at call sites:
 *  - ice is a *fill* with ink on top. It marks the current one and the stop.
 *  - a pressable thing gets one cut corner; a static thing gets no shape.
 *  - a division is a 1 dp hairline, never a border wrapped around a card.
 *  - nothing that is pressed is smaller than 56 dp, because this is a 10"
 *    tablet held in one hand at the bedside, not a phone in two.
 */

/** Minimum touch target: 56 dp. The spec floor is 48; the arm at a bed is longer. */
val TouchTarget: Dp = 56.dp

/** The one pressable shape: bottom-right corner cut, so the cut never touches a label. */
val KeyShape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)

private val TABULAR = "\"tnum\""

/** Real figures: a clock that ticks must not move the layout. */
fun TextStyle.tabularFigures(): TextStyle = copy(fontFeatureSettings = TABULAR)

/** Numbers: clock, percent, metres, degrees, scores. */
@Composable
fun NumberText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = QuietPalette.Ink
) {
    Text(
        text = text,
        modifier = modifier,
        style = style.tabularFigures(),
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Clip
    )
}

// ---------------------------------------------------------------------------
// Division
// ---------------------------------------------------------------------------

/** The only divider: a 1 dp hairline of ink at 14 %. */
@Composable
fun Rule(modifier: Modifier = Modifier) {
    Box(modifier.height(1.dp).background(QuietPalette.Hairline))
}

/**
 * A raised surface. The console's content lives on white boards over the opal
 * sheet, which is what separates "the session's numbers" from "the page" in a
 * bright room without a single shadow or radius.
 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(modifier.background(QuietPalette.Board), content = content)
}

/**
 * A named block inside a panel: the title carries the weight, a hairline
 * closes it, the content follows. `trailing` sits on the title's baseline for
 * the one fact the block is about ("进行中", "2/10").
 *
 * Three tiers, one page: 24 sp title (this), 18 sp row title, 16 sp note.
 */
@Composable
fun Band(
    title: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink,
                maxLines = 1
            )
            if (trailing != null) {
                Spacer(Modifier.weight(1f))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    content = trailing
                )
            }
        }
        Rule()
        Column(content = content)
    }
}

/**
 * The band's own body padding: 24 dp on the four sides the spec asks for, so
 * every block in the app has the same internal air.
 */
val BandBody: Modifier = Modifier.padding(QuietSpace.Panel)

// ---------------------------------------------------------------------------
// Pressable things
// ---------------------------------------------------------------------------

/**
 * The two meanings the system is allowed to draw with a shape:
 *
 *  - **Fill means "pressing this does something now."** At most one fill per
 *    screen, and it is always the page's primary action (启动训练 / 起身).
 *    The stop is the exception that proves it: it is a fill because it is
 *    pressable, and red because it is the one dangerous press.
 *  - **Outline means "this is the current state", or a secondary press.**
 *    A selected scene, a selected rise length, a selected intensity: ice
 *    hairline, ink text at medium weight. Selection is never a fill, so a
 *    filled block always reads as an action and never as a status.
 *
 * `Quiet` is a word with no shape at all, for rows a hairline already divides.
 */
enum class KeyKind { Fill, Selected, Outline, Quiet, Danger }

/**
 * One pressable key. [kind] is the whole hierarchy:
 *  - Fill: ice field, ink label — the one action the block is about.
 *  - Outline: hairline box on paper.
 *  - Quiet: no box, for a word that sits in a row already divided by lines.
 *  - Danger: red ink in a hairline box. Never a red fill: the one solid block
 *    on a screen is the stop, and a second one would compete with it.
 */
@Composable
fun Key(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: KeyKind = KeyKind.Outline,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    height: Dp = TouchTarget,
    minWidth: Dp = 0.dp,
    textStyle: TextStyle? = null
) {
    val fill by animateColorAsState(
        targetValue = when {
            !enabled -> Color.Transparent
            kind == KeyKind.Fill -> QuietPalette.Ice
            else -> Color.Transparent
        },
        animationSpec = tween(ControlMotion.duration(ControlMotion.TINT_MS)),
        label = "key-fill"
    )
    val labelColor = when {
        !enabled -> QuietPalette.Disabled
        kind == KeyKind.Danger -> QuietPalette.Danger
        else -> QuietPalette.Ink
    }
    val border: BorderStroke? = when {
        // Disabled keeps its silhouette: outlined in second ink, so the key is
        // visibly there and visibly off, not faded to nothing.
        !enabled -> BorderStroke(1.dp, QuietPalette.Hairline)
        kind == KeyKind.Fill || kind == KeyKind.Quiet -> null
        kind == KeyKind.Selected -> BorderStroke(2.dp, QuietPalette.Ice)
        kind == KeyKind.Danger -> BorderStroke(1.dp, QuietPalette.Danger)
        else -> BorderStroke(1.dp, QuietPalette.Hairline)
    }

    Box(
        modifier = modifier
            .defaultMinSize(minWidth = maxOf(minWidth, TouchTarget), minHeight = TouchTarget)
            .height(height)
            .clip(KeyShape)
            .background(fill)
            .then(if (border != null) Modifier.border(border, KeyShape) else Modifier)
            .clickable(
                enabled = enabled,
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = labelColor,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(10.dp))
            }
            Text(
                text = label,
                style = textStyle ?: MaterialTheme.typography.labelLarge,
                fontWeight = if (kind == KeyKind.Selected) FontWeight.Medium else null,
                color = labelColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/** The switch row: the label is the row, the mark is a square-edge switch. */
@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    note: String? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = TouchTarget + 8.dp)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) QuietPalette.Ink else QuietPalette.Disabled
            )
            if (note != null) {
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary
                )
            }
        }
        Spacer(Modifier.width(16.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = QuietPalette.Ink,
                checkedTrackColor = QuietPalette.Ice,
                checkedBorderColor = QuietPalette.Ice,
                uncheckedThumbColor = QuietPalette.InkSecondary,
                uncheckedTrackColor = Color.Transparent,
                uncheckedBorderColor = QuietPalette.Disabled,
                disabledCheckedThumbColor = QuietPalette.InkSecondary,
                disabledCheckedTrackColor = QuietPalette.IceMuted,
                disabledCheckedBorderColor = QuietPalette.IceMuted,
                disabledUncheckedThumbColor = QuietPalette.Disabled,
                disabledUncheckedTrackColor = Color.Transparent,
                disabledUncheckedBorderColor = QuietPalette.Hairline
            )
        )
    }
}

/** Label on the left, its value on the right, one baseline, one row. */
@Composable
fun FactRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    numeric: Boolean = true,
    emphasis: Boolean = false
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = TouchTarget)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.width(16.dp))
        val style = MaterialTheme.typography.bodyMedium
        Text(
            text = value,
            style = if (numeric) style.tabularFigures() else style,
            fontWeight = if (emphasis) FontWeight.Medium else null,
            color = QuietPalette.Ink
        )
    }
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** A status chip: a tone bar on the leading edge, then ink text. */
@Composable
fun Chip(
    label: String,
    modifier: Modifier = Modifier,
    tone: StatusTone = StatusTone.Neutral
) {
    val bar = when (tone) {
        StatusTone.Neutral -> QuietPalette.Disabled
        StatusTone.Attention -> QuietPalette.Ice
        StatusTone.Stopped -> QuietPalette.Danger
    }
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 36.dp)
            .height(36.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(10.dp).fillMaxHeight().background(bar))
        Spacer(Modifier.width(10.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.Ink,
            maxLines = 1
        )
    }
}

enum class StatusTone { Neutral, Attention, Stopped }

enum class Presence(val tier: Int, val description: String) {
    Live(2, "连接正常"),
    Waiting(1, "正在连接"),
    Offline(0, "未连接")
}

/**
 * A three-block presence mark: filled for how far the link got. No dot, no
 * pulse — a state, not an activity.
 */
@Composable
fun PresenceMark(
    state: Presence,
    modifier: Modifier = Modifier
) {
    val active = when (state) {
        Presence.Live -> QuietPalette.Ice
        Presence.Waiting -> QuietPalette.Ink
        Presence.Offline -> QuietPalette.Danger
    }
    Canvas(
        modifier
            .size(width = 22.dp, height = 18.dp)
            .semantics { stateDescription = state.description }
    ) {
        val gap = 3.dp.toPx()
        val blockWidth = (size.width - gap * 2f) / 3f
        for (index in 0..2) {
            drawRect(
                color = if (index <= state.tier) active else QuietPalette.Hairline,
                topLeft = Offset(index * (blockWidth + gap), 0f),
                size = Size(blockWidth, size.height)
            )
        }
    }
}

/** A meter drawn on the band's own rule: hairline below, ice above. */
@Composable
fun Meter(
    fraction: Float,
    modifier: Modifier = Modifier,
    active: Boolean = true
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(6.dp)
            .background(QuietPalette.Hairline)
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .background(if (active) QuietPalette.Ice else QuietPalette.Disabled)
        )
    }
}

/** Empty state inside a band: one fact, second ink, no illustration. */
@Composable
fun EmptyNote(
    text: String,
    modifier: Modifier = Modifier
) {
    Text(
        text = text,
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp),
        style = MaterialTheme.typography.bodyMedium,
        color = QuietPalette.InkSecondary
    )
}

/**
 * A refusal that the operator must read before retrying: ice field, ink text,
 * one sentence and the next step. On paper ice is a fill, never text.
 */
@Composable
fun RefusalNote(
    text: String,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .fillMaxWidth()
            .background(QuietPalette.Ice)
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.OnIce
        )
    }
}

/** One-line operator feedback: ice bar, then the sentence. */
@Composable
fun NoticeRow(
    text: String,
    modifier: Modifier = Modifier,
    danger: Boolean = false
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Board)
            .defaultMinSize(minHeight = TouchTarget),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(8.dp)
                .height(TouchTarget)
                .background(if (danger) QuietPalette.Danger else QuietPalette.Ice)
        )
        Spacer(Modifier.width(16.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 14.dp, horizontal = 4.dp)
        )
    }
}

// ---------------------------------------------------------------------------
// Named roles
// ---------------------------------------------------------------------------

/**
 * The spec's `ActionKey`, in the vocabulary this file already owns.
 *
 * A key is a key: [Key] carries the four kinds and every screen uses it. This
 * alias exists so screens can say "primary action", "secondary action",
 * "dangerous action" without repeating the fill rule — which is the one thing
 * that must never be re-decided per screen.
 */
enum class ActionTone { Primary, Selected, Secondary, Quiet, Danger }

@Composable
fun ActionKey(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: ActionTone = ActionTone.Secondary,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    height: Dp = TouchTarget,
    minWidth: Dp = 0.dp,
    textStyle: TextStyle? = null
) {
    Key(
        label = label,
        onClick = onClick,
        modifier = modifier,
        kind = when (tone) {
            ActionTone.Primary -> KeyKind.Fill
            ActionTone.Selected -> KeyKind.Selected
            ActionTone.Secondary -> KeyKind.Outline
            ActionTone.Quiet -> KeyKind.Quiet
            ActionTone.Danger -> KeyKind.Danger
        },
        enabled = enabled,
        icon = icon,
        height = height,
        minWidth = minWidth,
        textStyle = textStyle
    )
}
