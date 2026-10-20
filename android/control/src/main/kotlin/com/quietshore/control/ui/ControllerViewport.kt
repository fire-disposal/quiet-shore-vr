package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.quietshore.control.ControlViewModel
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.web.ControllerWebViewHost

/**
 * 3D viewport fed by the controller page. All view state reaches the page
 * through the five `window.qsControl` calls, and the page sends commands back
 * through the `QuietShoreBridge` JavaScript interface.
 */
@Composable
fun ControllerViewport(
    viewModel: ControlViewModel,
    onFullscreen: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val controller = remember {
        ControllerWebViewHost(context, viewModel::sendCommand) {
            onFullscreen(true)
        }
    }
    var loadError by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }

    DisposableEffect(controller) {
        controller.onPageLoading = { loaded = false }
        controller.onPageReady = {
            loaded = true
            loadError = null
        }
        controller.onLoadError = { message ->
            loaded = false
            loadError = message
        }
        onDispose { controller.destroy() }
    }

    LaunchedEffect(controller) {
        viewModel.phaseUpdates.collect { controller.onBleState(it) }
    }
    LaunchedEffect(controller) {
        viewModel.grantedUpdates.collect { controller.onAuth(it) }
    }
    LaunchedEffect(controller) {
        viewModel.controlUpdates.collect { controller.onState(it) }
    }
    LaunchedEffect(controller) {
        viewModel.viewModeUpdates.collect { controller.onViewMode(it) }
    }
    LaunchedEffect(controller) {
        viewModel.poseUpdates.collect { pose ->
            if (pose != null) {
                controller.onTelemetry(pose)
            }
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            factory = { controller.webView },
            modifier = Modifier.fillMaxSize()
        )
        if (!loaded && loadError == null) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(QuietPalette.SurfaceSunken),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                LoadingDots()
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "正在加载三维视图",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
            }
        }
        loadError?.let { error ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(QuietPalette.SurfaceSunken)
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "3D 视图暂不可用",
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.TextPrimary
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = { controller.reload() }) {
                    Text("重新加载")
                }
            }
        }
    }
}
