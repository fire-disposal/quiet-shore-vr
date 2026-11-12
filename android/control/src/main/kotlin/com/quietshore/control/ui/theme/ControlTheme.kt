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
 * 冷库（ice / cool / tight / plain / standard / calm）on the tablet.
 *
 * Paper and ink: a cool white sheet, one ink for text, one grey for the second
 * voice, hairlines at 14 % ink for every division. There is exactly one accent,
 * ice #7DE6FF, and it means "this is current / you can press this / look here".
 * On paper it is only ever a *fill* with ink text on top (12.6:1); on the dark
 * command bar it may also be the text colour. Red is reserved for the stop.
 *
 * No shadows, no borders stacked under fills, no radius: division is a line.
 */
object QuietPalette {
    val Background = Color(0xFFF4F4F2)
    val Surface = Color(0xFFFFFFFF)
    val TextPrimary = Color(0xFF161616)
    val TextSecondary = Color(0xFF5E655A)

    /** Hairline at 14 % ink; the only divider on the paper. */
    val Hairline = Color(0x24161616)

    /** Disabled text and inert marks: ink at 32 %, legible but clearly off. */
    val Disabled = Color(0x52161616)

    /** The one accent. A fill on paper, ink text on the bar. */
    val Ice = Color(0xFF7DE6FF)

    /** Disabled ice: still reads as "the selected one", without glowing. */
    val IceMuted = Color(0x387DE6FF)

    /** The dark command bar and everything printed on it. */
    val Bar = Color(0xFF161616)
    val OnBar = Color(0xFFF4F4F2)
    val OnBarSecondary = Color(0xFFA6ADA6)
    val OnBarHairline = Color(0x24F4F4F2)
    val OnBarDisabled = Color(0x8AA6ADA6)

    /** Stop only: the emergency stop and irreversible destructive actions. */
    val Danger = Color(0xFFA2261C)
}

private val QuietColorScheme = lightColorScheme(
    primary = QuietPalette.Ice,
    onPrimary = QuietPalette.TextPrimary,
    primaryContainer = QuietPalette.Ice,
    onPrimaryContainer = QuietPalette.TextPrimary,
    secondary = QuietPalette.TextPrimary,
    onSecondary = QuietPalette.Surface,
    secondaryContainer = QuietPalette.IceMuted,
    onSecondaryContainer = QuietPalette.TextPrimary,
    background = QuietPalette.Background,
    onBackground = QuietPalette.TextPrimary,
    surface = QuietPalette.Surface,
    onSurface = QuietPalette.TextPrimary,
    surfaceVariant = QuietPalette.Background,
    onSurfaceVariant = QuietPalette.TextSecondary,
    outline = QuietPalette.Hairline,
    outlineVariant = QuietPalette.Hairline,
    error = QuietPalette.Danger,
    onError = QuietPalette.Surface,
    errorContainer = QuietPalette.Danger,
    onErrorContainer = QuietPalette.Surface
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

private val QuietTypography = Typography(
    // The three numbers on the readout board.
    displayLarge = face(52, 58, FontWeight.Medium, tabular = true),
    displayMedium = face(44, 50, FontWeight.Medium, tabular = true),
    displaySmall = face(36, 42, FontWeight.Medium, tabular = true),
    // Screen titles and step headings.
    headlineLarge = face(32, 40, FontWeight.Medium),
    headlineMedium = face(26, 34, FontWeight.Medium),
    headlineSmall = face(22, 30, FontWeight.Medium, tabular = true),
    // Band and row headings.
    titleLarge = face(24, 32, FontWeight.Medium),
    titleMedium = face(18, 26, FontWeight.Medium),
    titleSmall = face(16, 24, FontWeight.Medium),
    // Everything the operator reads in a sentence.
    bodyLarge = face(17, 26),
    bodyMedium = face(16, 24),
    bodySmall = face(15, 22),
    // Keys and chips: short, hard, never tracked in Chinese.
    labelLarge = face(16, 22, FontWeight.Medium),
    labelMedium = face(14, 20, FontWeight.Medium),
    // Small Latin caps only.
    labelSmall = face(12, 16, FontWeight.Medium, tracking = CAPS_TRACKING)
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
