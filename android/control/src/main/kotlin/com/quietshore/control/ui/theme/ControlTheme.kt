package com.quietshore.control.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Calm, low-contrast palette for a dim therapy room. The tablet sits next to
 * the patient, so the screen must never compete with the headset view.
 */
object QuietPalette {
    val Background = Color(0xFF0B1416)
    val Surface = Color(0xFF12201F)
    val SurfaceRaised = Color(0xFF182B29)
    val SurfaceSunken = Color(0xFF0E1B1C)
    val Viewport = Color(0xFF061110)
    val Primary = Color(0xFF7FC9BC)
    val OnPrimary = Color(0xFF04211D)
    val Accent = Color(0xFFE7D6B6)
    val TextPrimary = Color(0xFFEAF3F0)
    val TextSecondary = Color(0xFF9EB5B0)
    val Outline = Color(0xFF2E4442)
    val Success = Color(0xFF8FD3A8)
    val Warning = Color(0xFFE5C07B)
    val Danger = Color(0xFFF0A8A2)
}

private val QuietColorScheme = darkColorScheme(
    primary = QuietPalette.Primary,
    onPrimary = QuietPalette.OnPrimary,
    primaryContainer = Color(0xFF1C3A36),
    onPrimaryContainer = QuietPalette.TextPrimary,
    secondary = QuietPalette.Accent,
    onSecondary = Color(0xFF2A2114),
    secondaryContainer = Color(0xFF2C2A22),
    onSecondaryContainer = QuietPalette.TextPrimary,
    background = QuietPalette.Background,
    onBackground = QuietPalette.TextPrimary,
    surface = QuietPalette.Surface,
    onSurface = QuietPalette.TextPrimary,
    surfaceVariant = QuietPalette.SurfaceRaised,
    onSurfaceVariant = QuietPalette.TextSecondary,
    outline = QuietPalette.Outline,
    error = QuietPalette.Danger,
    onError = Color(0xFF3A0D0A),
    errorContainer = Color(0xFF3C1E1C),
    onErrorContainer = QuietPalette.TextPrimary
)

@Composable
fun QuietShoreTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = QuietColorScheme,
        typography = Typography(),
        content = content
    )
}
