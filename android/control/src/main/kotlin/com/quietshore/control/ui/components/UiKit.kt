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

/**
 * The console's whole vocabulary, in one file: rule, band, key, chip, meter,
 * notice. Every screen composes out of these, so the palette, the touch sizes
 * and the "no radius / no shadow" rule are decided once.
 *
 * 冷库 rules encoded here, not at call sites:
 *  - ice is a fill with ink on top, or ink on the dark bar. Never body text on paper.
 *  - a pressable thing gets one cut corner; a static thing gets no shape at all.
 *  - a division is a 1 dp hairline, never a border wrapped around a filled card.
 *  - nothing is smaller than 48 dp on a side.
 */

/** Minimum touch target on a 10" tablet held at arm's length. */
val TouchTarget: Dp = 48.dp

private val TABULAR = "\"tnum\""

/** Real figures: a clock that ticks must not move the layout. */
fun TextStyle.tabularFigures(): TextStyle = copy(fontFeatureSettings = TABULAR)

/** Numbers: clock, percent, metres, degrees, scores. */
@Composable
fun NumberText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = QuietPalette.TextPrimary
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

/** The only divider. [onBar] flips it to light ink for the dark bar. */
@Composable
fun Rule(
    modifier: Modifier = Modifier,
    onBar: Boolean = false
) {
    Box(
        modifier
            .height(1.dp)
            .background(if (onBar) QuietPalette.OnBarHairline else QuietPalette.Hairline)
    )
}

/**
 * A section: a small caps title in the margin, then a hairline, then the
 * content, then a hairline. No container, no fill, no border on three sides.
 */
@Composable
fun Band(
    title: String,
    modifier: Modifier = Modifier,
    onBar: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val secondary = if (onBar) QuietPalette.OnBarSecondary else QuietPalette.TextSecondary
    Column(modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = secondary,
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
        Rule(onBar = onBar)
        Column(content = content)
        Rule(onBar = onBar)
    }
}

// ---------------------------------------------------------------------------
// Pressable things
// ---------------------------------------------------------------------------

enum class KeyKind { Fill, Outline, Quiet, Danger }

/**
 * One pressable key. [kind] is the whole hierarchy:
 *  - Fill: ice fill, ink label — the one thing its band is about.
 *  - Outline: hairline box on paper.
 *  - Quiet: no box, for a row that is already divided by hairlines.
 *  - Danger: red ink in a hairline box, never a red fill, so the ice fill
 *    stays the loudest thing on the screen and red means stop.
 */
@Composable
fun Key(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: KeyKind = KeyKind.Outline,
    enabled: Boolean = true,
    onBar: Boolean = false,
    icon: ImageVector? = null,
    height: Dp = TouchTarget,
    minWidth: Dp = 0.dp
) {
    val shape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
    val fill by animateColorAsState(
        targetValue = if (enabled && kind == KeyKind.Fill) QuietPalette.Ice else Color.Transparent,
        animationSpec = tween(ControlMotion.duration(ControlMotion.TINT_MS)),
        label = "key-fill"
    )
    val labelColor = when {
        !enabled && onBar -> QuietPalette.OnBarDisabled
        !enabled -> QuietPalette.Disabled
        kind == KeyKind.Danger -> QuietPalette.Danger
        onBar -> QuietPalette.OnBar
        else -> QuietPalette.TextPrimary
    }
    val hairlines = if (onBar) QuietPalette.OnBarHairline else QuietPalette.Hairline
    val border: BorderStroke? = when {
        !enabled -> BorderStroke(1.dp, if (onBar) QuietPalette.OnBarHairline else QuietPalette.Hairline.copy(alpha = 0.6f))
        kind == KeyKind.Fill || kind == KeyKind.Quiet -> null
        kind == KeyKind.Danger -> BorderStroke(1.dp, QuietPalette.Danger)
        else -> BorderStroke(1.dp, hairlines)
    }

    Box(
        modifier = modifier
            .defaultMinSize(minWidth = maxOf(minWidth, TouchTarget), minHeight = TouchTarget)
            .height(height)
            .clip(shape)
            .background(fill)
            .then(if (border != null) Modifier.border(border, shape) else Modifier)
            .clickable(
                enabled = enabled,
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .padding(horizontal = 14.dp),
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
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
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
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) QuietPalette.TextPrimary else QuietPalette.Disabled
            )
            if (note != null) {
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
        }
        Spacer(Modifier.width(16.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = QuietPalette.TextPrimary,
                checkedTrackColor = QuietPalette.Ice,
                checkedBorderColor = QuietPalette.Ice,
                uncheckedThumbColor = QuietPalette.TextSecondary,
                uncheckedTrackColor = Color.Transparent,
                uncheckedBorderColor = QuietPalette.Disabled,
                disabledCheckedThumbColor = QuietPalette.TextSecondary,
                disabledCheckedTrackColor = QuietPalette.IceMuted,
                disabledCheckedBorderColor = QuietPalette.IceMuted,
                disabledUncheckedThumbColor = QuietPalette.Disabled,
                disabledUncheckedTrackColor = Color.Transparent,
                disabledUncheckedBorderColor = QuietPalette.Hairline
            )
        )
    }
}

/** Label on the left, its value on the right, one baseline, one hairline row. */
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
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextSecondary
        )
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        val label = MaterialTheme.typography.bodyMedium
        Text(
            text = value,
            style = if (numeric) label.tabularFigures() else label,
            fontWeight = if (emphasis) FontWeight.Medium else null,
            color = QuietPalette.TextPrimary
        )
    }
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** Paper status chip: a 2 dp tone bar on the leading edge, then ink text. */
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
            .defaultMinSize(minHeight = 32.dp)
            .height(32.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(10.dp)
                .fillMaxHeight()
                .background(bar)
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.TextPrimary,
            maxLines = 1
        )
    }
}

enum class StatusTone { Neutral, Attention, Stopped }

/** Chip for the dark bar: light ink, ice only when the operator must look. */
@Composable
fun BarChip(
    label: String,
    modifier: Modifier = Modifier,
    attention: Boolean = false
) {
    Row(
        modifier = modifier.height(28.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(if (attention) QuietPalette.Ice else QuietPalette.OnBarDisabled)
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (attention) QuietPalette.Ice else QuietPalette.OnBar,
            maxLines = 1
        )
    }
}

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
    modifier: Modifier = Modifier,
    onBar: Boolean = false
) {
    val active = when (state) {
        Presence.Live -> QuietPalette.Ice
        Presence.Waiting -> if (onBar) QuietPalette.OnBar else QuietPalette.TextPrimary
        Presence.Offline -> QuietPalette.Danger
    }
    val idle = if (onBar) QuietPalette.OnBarHairline else QuietPalette.Hairline
    Canvas(
        modifier
            .size(width = 16.dp, height = 16.dp)
            .semantics { stateDescription = state.description }
    ) {
        val gap = 2.dp.toPx()
        val blockWidth = (size.width - gap * 2f) / 3f
        for (index in 0..2) {
            drawRect(
                color = if (index <= state.tier) active else idle,
                topLeft = Offset(index * (blockWidth + gap), 0f),
                size = Size(blockWidth, size.height)
            )
        }
    }
}

/** A meter drawn on the band's own rule: hairlines below, ice above. */
@Composable
fun Meter(
    fraction: Float,
    modifier: Modifier = Modifier,
    active: Boolean = true
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(4.dp)
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

/** Empty state inside a band: one fact, secondary ink, no illustration. */
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
        style = MaterialTheme.typography.bodySmall,
        color = QuietPalette.TextSecondary
    )
}

/**
 * A refusal that the operator must read before retrying: ice field, ink text,
 * one sentence and the next step. Ice on paper is a fill, never text.
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
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.TextPrimary
        )
    }
}

/** Stop/irreversible warning: the only red fill in the app. */
@Composable
fun DangerNote(
    text: String,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .fillMaxWidth()
            .background(QuietPalette.Danger)
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Surface
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
            .background(if (danger) QuietPalette.Danger else QuietPalette.Surface)
            .defaultMinSize(minHeight = TouchTarget),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(6.dp)
                .height(TouchTarget)
                .background(if (danger) QuietPalette.Danger else QuietPalette.Ice)
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (danger) QuietPalette.Surface else QuietPalette.TextPrimary,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 12.dp, horizontal = 4.dp)
        )
    }
}
