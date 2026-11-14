package com.quietshore.control.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette

/**
 * One compact centimetre field.
 *
 * The value is committed on Done or when focus leaves; an intermediate "17"
 * never leaves the field, so the headset only sees a usable height. The parent
 * owns clamping: this control keeps the text local while editing.
 */
@Composable
fun EyeHeightField(
    valueCm: Int,
    onCommit: (Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    var text by remember { mutableStateOf(valueCm.toString()) }
    var focused by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current

    LaunchedEffect(valueCm, focused) {
        if (!focused) {
            text = valueCm.toString()
        }
    }

    fun commit() {
        val parsed = text.toIntOrNull()
        if (parsed == null) {
            text = valueCm.toString()
        } else if (parsed != valueCm) {
            onCommit(parsed)
        }
    }

    BasicTextField(
        value = text,
        onValueChange = { raw -> text = raw.filter(Char::isDigit).take(3) },
        enabled = enabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.titleMedium.copy(
            color = QuietPalette.Ink,
            textAlign = TextAlign.Center
        ),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Number,
            imeAction = ImeAction.Done
        ),
        keyboardActions = KeyboardActions(
            onDone = {
                commit()
                focused = false
                focus.clearFocus(force = true)
            }
        ),
        cursorBrush = SolidColor(QuietPalette.Ink),
        modifier = modifier
            .width(68.dp)
            .height(40.dp)
            .border(
                1.dp,
                if (focused) QuietPalette.Ink else QuietPalette.Hairline
            )
            .onPreviewKeyEvent { event ->
                val enter = event.key == Key.Enter || event.key == Key.NumPadEnter
                if (enter && event.type == KeyEventType.KeyDown) {
                    commit()
                    focused = false
                    focus.clearFocus(force = true)
                    true
                } else {
                    false
                }
            }
            .onFocusChanged {
                if (focused && !it.isFocused) {
                    commit()
                }
                focused = it.isFocused
            }
            .padding(horizontal = 6.dp, vertical = 8.dp)
            .semantics { contentDescription = "站立眼高，厘米" }
    ) { inner ->
        Box(contentAlignment = Alignment.Center) { inner() }
    }
}
