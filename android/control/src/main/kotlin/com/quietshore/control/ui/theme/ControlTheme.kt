package com.quietshore.control.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

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
    val Primary = Color(0xFFA9563E)
    val OnPrimary = Color(0xFFF8F3E9)
    val Accent = Color(0xFF486B58)
    val TextPrimary = Color(0xFF20251F)
    val TextSecondary = Color(0xFF6D7468)
    val Outline = Color(0xFFD5CCBB)
    val Success = Color(0xFF486B58)
    val Warning = Color(0xFF96652C)
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

@Composable
fun QuietShoreTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = QuietColorScheme,
        typography = Typography(),
        content = content
    )
}
