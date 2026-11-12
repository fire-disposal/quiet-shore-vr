package com.quietshore.control

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.quietshore.control.ui.ControlApp
import com.quietshore.control.ui.ConsoleFixture
import com.quietshore.control.ui.ConsolePreview
import com.quietshore.control.ui.theme.QuietShoreTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light chrome: the bars are drawn over the app's own paper, so their
        // icons must be dark. Nothing in this app is ever dark.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT
            ),
            navigationBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT
            )
        )
        setContent {
            QuietShoreTheme {
                // `--es preview running` renders the console over fixture state:
                // the console proper sits behind a BLE claim, and design review
                // on an emulator has no headset to claim it with.
                val fixture = intent.getStringExtra("preview")?.let { name ->
                    ConsoleFixture.entries.firstOrNull {
                        it.name.equals(name, ignoreCase = true)
                    }
                }
                if (fixture != null) {
                    ConsolePreview(
                        fixture = fixture,
                        batteryLevel = intent.getIntExtra("battery", -1)
                            .takeIf { it in 0..100 },                        withPose = intent.getBooleanExtra("pose", false),
                        withDrift = intent.getBooleanExtra("drift", false)
                    )
                } else {
                    val controlViewModel: ControlViewModel = viewModel()
                    ControlApp(controlViewModel)
                }
            }
        }
    }
}
