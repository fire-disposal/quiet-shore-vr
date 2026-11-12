package com.quietshore.control.ui

import androidx.compose.foundation.background
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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.components.Band
import com.quietshore.control.ui.components.EmptyNote
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Full-screen operating guide.
 *
 * Read once by a new operator, not glanced at during a session: back on the
 * top-left, everything else is the procedure. Each band is one topic and each
 * line one fact, so a technician can find "what do I do when the voice is
 * silent" without reading the whole page.
 */
@Composable
fun InfoScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .background(QuietPalette.Bar)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Key(label = "返回", onClick = onBack, kind = KeyKind.Quiet, onBar = true)
            Spacer(Modifier.width(8.dp))
            Text(
                text = "流程与操作说明",
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.OnBar
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 32.dp, vertical = 24.dp)
        ) {
            Band(title = "这是什么") {
                EmptyNote(
                    "帮助卧床患者放松的沉浸式体验。头显里是一片缓慢移动的景物，身体随世界轻轻起伏，配合水声与语音提示。平板负责设置、引导与随时停止。",
                    Modifier.padding(horizontal = 4.dp)
                )
            }
            Band(title = "上机流程") {
                Column(Modifier.padding(vertical = 8.dp)) {
                    for (line in listOf(
                        "打开头显应用。平板点“搜索头显”，等“已连接”。",
                        "「场景」页选场景，点“启动训练”。",
                        "帮患者戴好头显，让患者按一次头显右侧按钮进入。",
                        "保持不动约 1.8 秒，再等 3 秒倒计时，画面出现即完成校准。",
                        "「控制」页调体位与起伏，「语音」页念提示语。",
                        "需要结束：患者说停，或平板点“结束会话”。异常时按常驻“急停”。",
                        "收尾后在「SUS」页逐题播放并记录答案。"
                    )) {
                        Text(
                            text = line,
                            style = MaterialTheme.typography.bodyMedium,
                            color = QuietPalette.TextPrimary,
                            modifier = Modifier.padding(vertical = 6.dp)
                        )
                    }
                }
            }
            Band(title = "四个页签") {
                Column(Modifier.padding(vertical = 8.dp)) {
                    for ((name, body) in listOf(
                        "控制" to "只动运动：起身比例、眼高、起身/躺下/停止、时长、起伏开关、视线偏移。",
                        "场景" to "会话启停、退出、校准、选场景。",
                        "语音" to "停止/上一句/下一句、四条序列、音色、水声与水声压低。",
                        "SUS" to "打开/关闭量表、目视选择、逐题播放、替患者作答、导出归档。"
                    )) {
                        Row(Modifier.padding(vertical = 6.dp)) {
                            Text(
                                text = name,
                                style = MaterialTheme.typography.titleSmall,
                                color = QuietPalette.TextPrimary,
                                modifier = Modifier.width(72.dp)
                            )
                            Text(
                                text = body,
                                style = MaterialTheme.typography.bodyMedium,
                                color = QuietPalette.TextSecondary
                            )
                        }
                    }
                }
            }
            Band(title = "校准") {
                EmptyNote(
                    "进入后卡片出现，患者保持不动。连续 1.8 秒稳定后进入 3 秒倒计时，系统取窗口均值作为“正前方”。一直晃动时会直接用当前朝向入场，不会卡住。",
                    Modifier.padding(horizontal = 4.dp)
                )
            }
            Band(title = "语音与混音") {
                EmptyNote(
                    "提示语由您按下才播放。SUS 题干默认随卡片自动朗读，可在「语音」页关闭。语音播放时水声自动压低 12 dB，结束后恢复。",
                    Modifier.padding(horizontal = 4.dp)
                )
            }
            Band(title = "安全") {
                EmptyNote(
                    "急停在顶栏，任何页签、任何滚动位置都能按，立即停止所有运动。患者随时可以说停。若患者自述头晕、恶心或不适：先停，再摘头显。",
                    Modifier.padding(horizontal = 4.dp)
                )
            }
            Band(title = "常见情况") {
                Column(Modifier.padding(vertical = 8.dp)) {
                    for ((symptom, next) in listOf(
                        "顶栏显示“连接受限”" to "头显超过 2.5 秒没有上报。检查头显是否停在前台。",
                        "点按键提示“页面未连接”" to "头显里的训练页面没开。再点一次“启动训练”，系统会重开页面。",
                        "语音没声音" to "看头显入口页那行状态，会写明是清单未加载还是播放被拒绝。"
                    )) {
                        Row(Modifier.padding(vertical = 6.dp)) {
                            Text(
                                text = symptom,
                                style = MaterialTheme.typography.titleSmall,
                                color = QuietPalette.TextPrimary,
                                modifier = Modifier.width(240.dp)
                            )
                            Text(
                                text = next,
                                style = MaterialTheme.typography.bodyMedium,
                                color = QuietPalette.TextSecondary
                            )
                        }
                    }
                }
            }
        }
    }
}
