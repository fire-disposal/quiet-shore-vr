package com.quietshore.control.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Calm, low-contrast palette for a dim therapy room. The tablet sits next to
 * the patient, so the screen must never compete with the headset view.
 */
object QuietPalette {
    val Background = Color(0xFFF3EFE6)
    val Surface = Color(0xFFECE6DA)
    val SurfaceRaised = Color(0xFFE4DCCD)
    val SurfaceSunken = Color(0xFFE8E1D4)
    val Viewport = Color(0xFF1E2421)
    val Primary = Color(0xFF8F4634)
    val OnPrimary = Color(0xFFF8F3E9)
    val Accent = Color(0xFF486B58)
    val TextPrimary = Color(0xFF20251F)
    val TextSecondary = Color(0xFF5E655A)
    val Outline = Color(0xFFD5CCBB)
    val Success = Color(0xFF486B58)
    // 4.74:1 on Surface; the previous 0xFF96652C measured 4.03:1 and failed AA
    val Warning = Color(0xFF8A5A24)
    val Danger = Color(0xFFA34D3D)
}

private val QuietColorScheme = lightColorScheme(
    primary = QuietPalette.Primary,
    onPrimary = QuietPalette.OnPrimary,
    primaryContainer = Color(0xFFEADBD2),
    onPrimaryContainer = QuietPalette.TextPrimary,
    secondary = QuietPalette.Accent,
    onSecondary = Color(0xFFF8F3E9),
    secondaryContainer = Color(0xFFE0E7DE),
    onSecondaryContainer = QuietPalette.TextPrimary,
    background = QuietPalette.Background,
    onBackground = QuietPalette.TextPrimary,
    surface = QuietPalette.Surface,
    onSurface = QuietPalette.TextPrimary,
    surfaceVariant = QuietPalette.SurfaceRaised,
    onSurfaceVariant = QuietPalette.TextSecondary,
    outline = QuietPalette.Outline,
    error = QuietPalette.Danger,
    onError = QuietPalette.OnPrimary,
    errorContainer = Color(0xFFEADBD2),
    onErrorContainer = QuietPalette.TextPrimary
)

private val QuietTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 36.sp,
        lineHeight = 44.sp,
        letterSpacing = 0.04.sp
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 28.sp,
        lineHeight = 36.sp
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Medium,
        fontSize = 22.sp,
        lineHeight = 30.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        lineHeight = 24.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 26.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 22.sp
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        // Section labels and chips are read at arm's length on a 10" tablet;
        // 12 sp was below the floor the design doc sets (14 sp).
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.06.sp
    )
)

private val QuietShapes = Shapes(
    extraSmall = RoundedCornerShape(2.dp),
    small = RoundedCornerShape(2.dp),
    medium = RoundedCornerShape(4.dp),
    large = RoundedCornerShape(6.dp),
    extraLarge = RoundedCornerShape(8.dp)
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
