package com.quietshore.control

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.quietshore.control.ui.ControlApp
import com.quietshore.control.ui.theme.QuietShoreTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            QuietShoreTheme {
                val controlViewModel: ControlViewModel = viewModel()
                ControlApp(controlViewModel)
            }
        }
    }
}
