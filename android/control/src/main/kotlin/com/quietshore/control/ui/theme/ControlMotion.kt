package com.quietshore.control.ui.theme

import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing

/**
 * Every decorative transition in the tablet console draws its timing from
 * here, so the whole UI can be made still in one place.
 *
 * Only presentation chrome animates: tab tint and the rail's own appearance.
 * Motion that the patient can perceive (view pitch, sit-up, the scene) is
 * driven by the wire contract and the page, never by these tokens.
 */
object ControlMotion {
    /**
     * Global kill switch. When false every [duration] becomes 0, so all
     * transitions complete instantly without touching the call sites.
     */
    @Volatile
    var enabled: Boolean = true

    /** Rail tab tint crossfade; short enough to feel like a press, not a slideshow. */
    const val TAB_SWITCH_MS: Int = 180

    /** Slack for the low-contrast palette: ease in and out, never bounce. */
    val standard: Easing = FastOutSlowInEasing

    fun duration(milliseconds: Int): Int = if (enabled) milliseconds else 0
}
