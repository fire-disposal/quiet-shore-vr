package com.quietshore.control.ui.theme

import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Paper and ink, one accent, no dark theme.
 *
 * The tablet lives in a ward at nine in the morning: daylight on the screen,
 * a technician holding it with one hand at the bedside. That decides three
 * things this file encodes once —
 *
 *  - **The page is paper.** Opal `#F4F4F2` sheet, white board for the panels,
 *    ink `#161616`. A dark bar would be a black rectangle in a bright room and
 *    would fight the one thing that must be found without looking: the stop.
 *    There is no dark theme; this app has one appearance.
 *  - **One accent, `#7DE6FF`, and only as a fill.** On paper it marks "this is
 *    the current one" (the scene that is loaded, the answer just given) and it
 *    is what the stop key is painted in. Body text on paper is ink and second
 *    ink — a medical device that colours its sentences cannot be read at
 *    arm's length.
 *  - **Red is the stop.** Red ink in a hairline box for 急停; nothing else in
 *    the app is red except the confirmation on an irreversible exit.
 *
 * No shadows, no radius, no gradients: division is a 1 dp hairline, and a cut
 * corner is the only shape in the system.
 */
object QuietPalette {
    /** The sheet: page background, and the fill of the top app bar. */
    val Paper = Color(0xFFF4F4F2)

    /** Raised board: panels, the bar, anything the eye should treat as a card. */
    val Board = Color(0xFFFFFFFF)

    val Ink = Color(0xFF161616)
    val InkSecondary = Color(0xFF5E655A)

    /** Hairline at 14 % ink; the only divider on the paper. */
    val Hairline = Color(0x24161616)

    /** Disabled text and inert marks: ink at 34 %, legible but clearly off. */
    val Disabled = Color(0x57161616)

    /** The accent. A fill with ink on top, never text on paper. */
    val Ice = Color(0xFF7DE6FF)

    /** Disabled ice: still reads as "the current one", without glowing. */
    val IceMuted = Color(0x387DE6FF)

    /** Body text sitting on an ice fill. */
    val OnIce = Color(0xFF161616)

    /** The stop, and the confirm on an irreversible exit. */
    /**
     * The stop's red: bright, not dark. A stop here is not a red-alert action —
     * the patient can say stop at any time and the operator's hand is on the
     * tablet — so the key earns attention by being the only red on the page,
     * not by being a slab of maroon. White type on #E53935 clears the 3:1 bar
     * for bold ≥16 sp, which is why the label stays white and semibold.
     */
    val Danger = Color(0xFFE53935)

    // Names the earlier bar used; kept as aliases so call sites read the same
    // way they did when the bar was dark.
    val Background: Color get() = Paper
    val Surface: Color get() = Board
    val TextPrimary: Color get() = Ink
    val TextSecondary: Color get() = InkSecondary
}

private val QuietColorScheme = lightColorScheme(
    primary = QuietPalette.Ice,
    onPrimary = QuietPalette.OnIce,
    primaryContainer = QuietPalette.Ice,
    onPrimaryContainer = QuietPalette.OnIce,
    secondary = QuietPalette.Ink,
    onSecondary = QuietPalette.Board,
    secondaryContainer = QuietPalette.IceMuted,
    onSecondaryContainer = QuietPalette.Ink,
    background = QuietPalette.Paper,
    onBackground = QuietPalette.Ink,
    surface = QuietPalette.Board,
    onSurface = QuietPalette.Ink,
    surfaceVariant = QuietPalette.Paper,
    onSurfaceVariant = QuietPalette.InkSecondary,
    outline = QuietPalette.Hairline,
    outlineVariant = QuietPalette.Hairline,
    error = QuietPalette.Danger,
    onError = QuietPalette.Board,
    errorContainer = QuietPalette.Danger,
    onErrorContainer = QuietPalette.Board
)

/** Latin caps only ever get this tracking; Chinese never does. */
private val CAPS_TRACKING: TextUnit = 0.14.em

/** Real figures: a clock that ticks must not move the layout. */
private val TABULAR: String = "\"tnum\""

private fun face(
    size: Int,
    line: Int,
    weight: FontWeight = FontWeight.Normal,
    tracking: TextUnit = 0.sp,
    tabular: Boolean = false
): TextStyle = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = tracking,
    fontFeatureSettings = if (tabular) TABULAR else null,
    platformStyle = PlatformTextStyle(includeFontPadding = false)
)

/**
 * The ladder, sized for a 1280×900 dp tablet read from 50–70 cm while the
 * reader also keeps an eye on the patient.
 *
 * The previous build ran 16–17 sp body text and a 12 sp label tier; at arm's
 * length in daylight that was the whole complaint ("字号小、拘束"). The floor
 * is now 16 sp and it is reserved for one thing only — the Latin caps label
 * over a figure. Anything that is a sentence is 18 sp or larger, and the three
 * bands are 24 / 18 / 16 in a 1.33 step so the eye sorts them without reading.
 */
private val QuietTypography = Typography(
    // The in-session figures: elapsed time, buoyancy rise, posture mix.
    displayLarge = face(76, 80, FontWeight.Medium, tabular = true),
    displayMedium = face(56, 62, FontWeight.Medium, tabular = true),
    displaySmall = face(44, 50, FontWeight.Medium, tabular = true),
    // Screen titles: the session headline, a screen name.
    headlineLarge = face(34, 42, FontWeight.Medium),
    headlineMedium = face(30, 38, FontWeight.Medium),
    headlineSmall = face(26, 34, FontWeight.Medium),
    // Section titles — the band that starts a block of the page.
    titleLarge = face(24, 32, FontWeight.Medium),
    // Row titles: a scene name, a control's own name.
    titleMedium = face(20, 28, FontWeight.Medium),
    titleSmall = face(18, 26, FontWeight.Medium),
    // Everything the operator reads in a sentence.
    bodyLarge = face(20, 30),
    bodyMedium = face(18, 27),
    bodySmall = face(16, 24),
    // Keys and chips: the label inside a pressable shape.
    labelLarge = face(18, 24, FontWeight.Medium),
    labelMedium = face(16, 22, FontWeight.Medium),
    // Latin caps only: the small label over a figure.
    labelSmall = face(16, 22, FontWeight.Medium, tracking = CAPS_TRACKING)
)

/**
 * Zero radius everywhere. `small` carries the single cut corner that marks a
 * pressable key; nothing else in the app uses a shape at all.
 */
private val QuietShapes = Shapes(
    extraSmall = RoundedCornerShape(0.dp),
    small = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp),
    medium = RoundedCornerShape(0.dp),
    large = RoundedCornerShape(0.dp),
    extraLarge = RoundedCornerShape(0.dp)
)

@Composable
fun QuietShoreTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = QuietColorScheme,
        typography = QuietTypography,
        shapes = QuietShapes,
        content = content
    )
}

/**
 * The page's own spacing, in one place so five screens cannot drift: outer
 * margin, gutter between the major columns, the air a band keeps around its
 * title, and the padding inside a panel.
 */
object QuietSpace {
    /** Outer margin: 32 dp. Wide screens do not get more, the content fills. */
    val Page: androidx.compose.ui.unit.Dp = 32.dp

    /** Between two zones of a page. */
    val Section: androidx.compose.ui.unit.Dp = 28.dp

    /** Between two rows inside a zone. */
    val Row: androidx.compose.ui.unit.Dp = 16.dp

    /** Inside a panel, between its edge and its content. */
    val Panel: androidx.compose.ui.unit.Dp = 24.dp
}
