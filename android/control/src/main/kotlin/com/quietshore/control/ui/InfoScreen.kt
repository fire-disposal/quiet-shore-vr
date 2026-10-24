package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Full-screen operating guide.
 *
 * Reached from the connect screen, it takes the whole viewport because it is
 * read once by a new operator, not glanced at during a session: back on the
 * top-left, everything else is the procedure.
 */
@Composable
fun InfoScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp, vertical = 20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← 返回") }
            Spacer(Modifier.width(12.dp))
            Text("流程与操作说明", style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(8.dp))

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            Section(
                "这是什么",
                "一套帮助卧床患者放松的沉浸式体验：头显里是一片缓慢移动的景物，身体随世界轻轻起伏，" +
                    "配合水声与语音提示。平板用于设置、引导与随时停止。"
            )
            Section(
                "上机流程",
                "1. 打开头显应用，平板点“搜索头显”并等待“已连接”。\n" +
                    "2. 在「场景」页选场景，点“启动训练”。\n" +
                    "3. 帮患者戴好头显，让其看向画面中间的圆，按下头显右侧按钮进入。\n" +
                    "4. 校准自动进行：保持不动约 1.8 秒，再等 3 秒倒计时，画面出现即完成。\n" +
                    "5. 会话中在「控制」页调模式与强度，在「语音」页念提示语。\n" +
                    "6. 需要结束：患者在头显里说停，或平板点“结束”；异常时按常驻“急停”。\n" +
                    "7. 收尾后在「SUS」页逐题播放并记录量表答案。"
            )
            Section(
                "四个页签",
                "控制：只管运动——模式、强度、呼吸层、档位、起身、俯仰修正、急停。\n" +
                    "场景：会话启停与退出、朝向校准、场景选择。\n" +
                    "语音：四条序列与 27 句提示语，含停播、水声开关与混音。\n" +
                    "SUS：量表全流程——打开/关闭、目视选择、逐题播放、替患者作答。"
            )
            Section(
                "校准",
                "进入后卡片出现，患者保持不动：连续 1.8 秒稳定后进入 3 秒倒计时，" +
                    "系统取窗口均值作为“正前方”。若一直晃动，会直接用当前朝向入场，不会卡住。"
            )
            Section(
                "语音与混音",
                "每条语音都由你按下才播放，没有自动连播。语音播放时水声自动压低 12 dB，结束后恢复；" +
                    "水声开关与音量都在「语音」页混音区。"
            )
            Section(
                "安全",
                "急停常驻在「控制」页底部，按下立即停止所有运动。患者在头显里随时可以说停；" +
                    "若患者自述头晕、恶心或不适，先停，再摘头显。"
            )
            Section(
                "常见情况",
                "顶栏显示“连接受限”：头显超过 2.5 秒没有上报，检查头显是否在前台。\n" +
                    "点按钮提示“页面未连接”：头显里的训练页面没打开，重新点“启动训练”即可，系统会自动重开页面。\n" +
                    "语音没声音：看头显入口页那行状态，会写明是清单未加载还是播放被拒绝。"
            )
        }
    }
}

@Composable
private fun Section(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(
            text = body,
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.TextPrimary
        )
    }
}
