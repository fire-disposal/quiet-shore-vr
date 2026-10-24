# 语音提示（Voice Cues）

状态：设计稿，尚未实现（协议没有 voice 命令）。展示侧见 `docs/ux-plan.md` §8.2。

## 1 语气

男性患者在床上解手，阻力是羞耻与失控感，不是体位。语音不做陪伴，做**说明书**：把比喻、鼓励、安慰换成描述与指导，患者才能复述“接下来会发生什么、怎么停”。

只做四件事：说明正在发生什么、说明下一步、给出一个动作、说明怎么停。不做评估。

| 规则 | 反例 | 改为 |
| --- | --- | --- |
| 陈述句、一句一个信息 | “感受湖水托着您” | “世界会缓慢上下移动” |
| 第二人称用“您” | “你可以随时停” | “您可以随时停止” |
| 不评价 | “很好，就保持这样” | “已记录。” |
| 不催促、不许诺 | “再坚持五分钟” / “放松就会排出来” | “没有时间要求” / “排不出来也没关系” |
| 不播精确参数 | “幅度四厘米、周期十八秒” | “起伏幅度：小” |
| 每句 ≤24 字 | 长复合句 | 拆成两句 |
| 想象只描述物理感受，不评价、不许诺 | “您一定会放松下来” | “想象水是温的，从脚开始” |

## 2 脚本（39 句）

| id | 分组 | 文本 | 估时 | 触发 |
| --- | --- | --- | --- | --- |
| `v-arrive-2` | 到场 | 现在戴上头显，保持仰卧，看向正前方。 | 4.5 s | 自动 |
| `v-wear-1` | 佩戴 | 头显已戴好。画面在正前方，保持仰卧。 | 4.5 s | 自动 · 预载 |
| `v-gate-1` | 进入 | 画面中间有一个圆。看向它，按下头显右侧中间的按钮，就能进入。 | 7.0 s | 自动 |
| `v-cal-1` | 校准 | 现在记录起始方向，保持当前姿势，看向正前方。 | 5.5 s | 自动 · 预载 |
| `v-cal-2` | 校准 | 已记录，场景即将出现。 | 3.0 s | 自动 |
| `v-enter-1` | 渐入 | 画面正在淡入。世界会缓慢上下移动，幅度很小。 | 5.5 s | 自动 · 预载 |
| `v-float-low` | 漂浮 | 起伏幅度：小。 | 1.5 s | 参数变化 |
| `v-float-mid` | 漂浮 | 起伏幅度：中。 | 1.5 s | 参数变化 |
| `v-float-high` | 漂浮 | 起伏幅度：大。 | 1.5 s | 参数变化 |
| `v-imagine-1` | 想象 | 想象水面在您身体下面，很平，没有浪。 | 4.5 s | 序列 · 预载 |
| `v-imagine-2` | 想象 | 想象水是温的，从脚开始，慢慢到肩。 | 4.5 s | 序列 |
| `v-imagine-3` | 想象 | 想象身体比水重一点，往下沉，被水接住。 | 4.5 s | 序列 |
| `v-imagine-4` | 想象 | 想象呼气比吸气长一点，不用刻意。 | 4.0 s | 序列 |
| `v-imagine-6` | 想象 | 想象身体和水之间没有清楚的界线。 | 4.5 s | 序列 |
| `v-relax-1` | 放松 | 进入放松阶段。不需要用力，正常呼吸。 | 4.5 s | 序列 · 预载 |
| `v-relax-2` | 放松 | 有便意时直接排出，不需要忍。 | 3.5 s | 序列 |
| `v-relax-3` | 放松 | 床上有防护垫，弄湿也没关系，结束后会更换。 | 5.0 s | 序列 |
| `v-relax-4` | 放松 | 没有时间要求；排不出来也没关系。 | 4.0 s | 序列 |
| `v-close-1` | 收束 | 训练即将结束，画面会慢慢淡出。 | 3.5 s | 常驻 · 预载 |
| `v-close-2` | 收束 | 已结束。保持姿势，暂时不要起身。 | 4.0 s | 序列 |
| `v-after-1` | 结束 | 可以摘下头显，需要时工作人员会帮您。 | 4.5 s | 结束态 · 预载 |
| `v-safe-1` | 安全 | 如头晕、恶心或不适，按头显右侧中间的按钮，画面立即停止。 | 6.5 s | 开场必播 · 预载 |
| `v-safe-2` | 安全 | 已停止。保持仰卧，正常呼吸。 | 3.5 s | 停止后 · 预载 |
| `v-rise-1` | 起身 | 现在切换到起身视角，世界会缓慢旋转。 | 4.5 s | 模式=起身 |
| `v-rise-2` | 起身 | 觉得快就说停。 | 2.0 s | 模式=起身 |
| `v-direct-1` | 明确 | 现在可以解手，弄湿了也没关系，之后会更换。 | 5.0 s | 仅患者询问时 |
| `v-sus-intro` | SUS 量表 | 接下来有十个问题，每题选一个最接近的答案。 | 5.0 s | 面板/逐题 |
| `v-sus-1` | SUS 量表 | 我愿意经常使用这个系统。 | 3.0 s | 面板/逐题 |
| `v-sus-2` | SUS 量表 | 这个系统没有必要这么复杂。 | 3.0 s | 面板/逐题 |
| `v-sus-3` | SUS 量表 | 我觉得这个系统容易使用。 | 3.0 s | 面板/逐题 |
| `v-sus-4` | SUS 量表 | 我需要技术人员的帮助才能用这个系统。 | 4.5 s | 面板/逐题 |
| `v-sus-5` | SUS 量表 | 这个系统的各项功能整合得很好。 | 3.5 s | 面板/逐题 |
| `v-sus-6` | SUS 量表 | 这个系统有太多不一致的地方。 | 3.5 s | 面板/逐题 |
| `v-sus-7` | SUS 量表 | 我认为大多数人能很快学会使用这个系统。 | 4.5 s | 面板/逐题 |
| `v-sus-8` | SUS 量表 | 这个系统用起来很麻烦。 | 3.0 s | 面板/逐题 |
| `v-sus-9` | SUS 量表 | 使用这个系统时我很有信心。 | 3.0 s | 面板/逐题 |
| `v-sus-10` | SUS 量表 | 我需要先学习很多内容才能开始使用这个系统。 | 5.0 s | 面板/逐题 |
| `v-about-1` | 说明 | 戴好头显后，会看到一片缓慢移动的景物；身体会跟着轻轻上下浮动，配合水声，帮助您放松。过程中您可以随时按头显右侧中间的按钮停止；如果感到不适，请立即告诉工作人员。 | 18.5 s | 开场前 |
| `v-thanks-1` | 说明 | 这次体验结束。感谢您参加测试，您的反馈会用来改进它。 | 6.0 s | 结束后 |

## 3 序列

| 序列 | 内容 | 间隔 | 规则 |
| --- | --- | --- | --- |
| `seq-start` | 到场 → 佩戴 → 校准 → 渐入 | 4–6 s，校准段由状态推进 | 只在开始前播 |
| `seq-imagine` | 想象 6 句 | 15 s | 渐入结束后一次，约 90 s |
| `seq-relax` | 放松 4 句 | 12 s | 一次会话最多一次 |
| `seq-close` | 收束 2 句 | 6 s | 结束前播 |

- 任何 `stop` 立即切断语音（200 ms 淡出）；序列被打断不自动续播；同句 60 s 内不重复。
- 序列在页面内展开，平板只发一条命令。

## 4 控制端语音面板（已实现：`ui/components/VoicePanel.kt`）

### 4.1 形体与入口

- 顶栏“语音”打开右侧抽屉（420 dp）；关闭后保留一条 40 dp 语音条：当前句、停止、自动开关。
- 抽屉自上而下四块：播放条 / 自动 / 单句 / 混音。主控件 ≥48 dp，全部落在右手拇指弧内。
- 不用滑动手势（床旁戴手套、手可能湿）；所有操作都是点按。

```svg
<svg viewBox="0 0 420 890" width="100%" role="img" aria-label="控制端语音抽屉">
  <rect x="0.5" y="0.5" width="419" height="889" rx="16" fill="var(--surface)" stroke="var(--border)"/>
  <text x="20" y="40" font-size="19" fill="var(--fg)">语音</text>
  <text x="400" y="40" font-size="14" text-anchor="end" fill="var(--muted)">关闭</text>

  <rect x="16" y="58" width="388" height="128" rx="12" fill="var(--bg)" opacity="0.35" stroke="var(--border)"/>
  <rect x="28" y="72" width="112" height="56" rx="10" fill="var(--accent)" opacity="0.16" stroke="var(--accent)"/>
  <text x="84" y="106" font-size="16" text-anchor="middle" fill="var(--fg)">播放序列</text>
  <rect x="152" y="72" width="112" height="56" rx="10" fill="none" stroke="var(--border)"/>
  <text x="208" y="106" font-size="16" text-anchor="middle" fill="var(--fg)">停止</text>
  <rect x="276" y="72" width="112" height="56" rx="10" fill="none" stroke="var(--border)"/>
  <text x="332" y="106" font-size="16" text-anchor="middle" fill="var(--fg)">静音</text>
  <text x="28" y="152" font-size="13" fill="var(--fg)">v-relax-2 · 放松 · 剩余 3 s</text>
  <text x="28" y="172" font-size="12" fill="var(--muted)">来源：自动 · 队列：v-safe-2</text>

  <rect x="16" y="198" width="388" height="128" rx="12" fill="none" stroke="var(--border)"/>
  <text x="28" y="226" font-size="14" fill="var(--fg)">自动模式</text>
  <rect x="330" y="212" width="62" height="26" rx="13" fill="var(--success)" opacity="0.18" stroke="var(--success)"/>
  <circle cx="378" cy="225" r="9" fill="var(--success)"/>
  <text x="28" y="254" font-size="12" fill="var(--muted)">下一句 v-imagine-3 · 00:12</text>
  <rect x="28" y="268" width="104" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="80" y="295" font-size="13" text-anchor="middle" fill="var(--fg)">跳过</text>
  <rect x="142" y="268" width="124" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="204" y="295" font-size="13" text-anchor="middle" fill="var(--fg)">延后 30 s</text>
  <rect x="276" y="268" width="116" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="334" y="295" font-size="13" text-anchor="middle" fill="var(--fg)">现在播</text>

  <text x="20" y="356" font-size="12" letter-spacing="1" fill="var(--muted)">最近</text>
  <rect x="16" y="366" width="122" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="77" y="393" font-size="12" text-anchor="middle" fill="var(--fg)">v-safe-2</text>
  <rect x="148" y="366" width="122" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="209" y="393" font-size="12" text-anchor="middle" fill="var(--fg)">v-close-1</text>
  <rect x="280" y="366" width="124" height="44" rx="9" fill="none" stroke="var(--border)"/>
  <text x="342" y="393" font-size="12" text-anchor="middle" fill="var(--fg)">v-imagine-4</text>

  <text x="20" y="440" font-size="12" letter-spacing="1" fill="var(--muted)">全部 32 句</text>
  <text x="28" y="476" font-size="15" fill="var(--fg)">到场</text>
  <text x="400" y="476" font-size="12" text-anchor="end" fill="var(--muted)">2 句 · 4.5 s</text>
  <line x1="20" y1="492" x2="400" y2="492" stroke="var(--border)"/>
  <text x="28" y="522" font-size="15" fill="var(--fg)">佩戴</text>
  <text x="400" y="522" font-size="12" text-anchor="end" fill="var(--muted)">2 句</text>
  <line x1="20" y1="538" x2="400" y2="538" stroke="var(--border)"/>
  <text x="28" y="568" font-size="15" fill="var(--fg)">校准</text>
  <text x="400" y="568" font-size="12" text-anchor="end" fill="var(--muted)">2 句</text>
  <line x1="20" y1="584" x2="400" y2="584" stroke="var(--border)"/>
  <text x="28" y="614" font-size="15" fill="var(--fg)">放松指导</text>
  <text x="400" y="614" font-size="12" text-anchor="end" fill="var(--muted)">4 句</text>
  <line x1="20" y1="630" x2="400" y2="630" stroke="var(--border)"/>
  <text x="28" y="660" font-size="15" fill="var(--fg)">想象</text>
  <text x="400" y="660" font-size="12" text-anchor="end" fill="var(--muted)">6 句</text>
  <line x1="20" y1="676" x2="400" y2="676" stroke="var(--border)"/>
  <text x="28" y="706" font-size="15" fill="var(--fg)">安全</text>
  <text x="400" y="706" font-size="12" text-anchor="end" fill="var(--muted)">3 句</text>
  <line x1="20" y1="722" x2="400" y2="722" stroke="var(--border)"/>

  <text x="20" y="756" font-size="12" letter-spacing="1" fill="var(--muted)">混音</text>
  <text x="28" y="788" font-size="13" fill="var(--fg)">语音音量</text>
  <text x="400" y="788" font-size="13" text-anchor="end" fill="var(--fg)">70</text>
  <line x1="28" y1="802" x2="400" y2="802" stroke="var(--border)" stroke-width="8" stroke-linecap="round"/>
  <line x1="28" y1="802" x2="288" y2="802" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="288" cy="802" r="11" fill="var(--accent)"/>
  <text x="28" y="840" font-size="13" fill="var(--fg)">水声压低</text>
  <text x="400" y="840" font-size="13" text-anchor="end" fill="var(--fg)">12 dB</text>
  <line x1="28" y1="854" x2="400" y2="854" stroke="var(--border)" stroke-width="8" stroke-linecap="round"/>
  <line x1="28" y1="854" x2="128" y2="854" stroke="var(--success)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="128" cy="854" r="11" fill="var(--success)"/>
</svg>
```

### 4.2 播放条

- 三个大按钮：**播放**（最近一条序列）、**停止**（只停语音，200 ms 淡出）、**静音**。
- 当前句：`v-relax-2 · 放松 · 剩余 3 s · 自动`。
- 队列最多一条插播，显示“下一条 `v-safe-2` · 自动 00:12”。

### 4.3 自动模式

| 相对时刻 | 动作 |
| --- | --- |
| T+0 | `seq-start`（到场 → 佩戴 → 校准 → 渐入） |
| T+90 s | `seq-imagine`（想象 6 句） |
| 会话过半 | `seq-relax`（放松 4 句，一次会话最多一次） |
| 结束前 60 s | `seq-close` |

- 面板显示倒计时，并给“跳过本条 / 延后 30 s / 立即播放”。
- 校准、保持、停止期间计时暂停，恢复后接着走，不追帧。
- 关闭自动不打断当前句；手动插播时自动让位，10 s 后恢复。

### 4.4 单句

- 按组折叠（到场/佩戴/校准/渐入/漂浮/想象/放松/收束/结束/安全/起身）；最近三句置顶。
- 点击 = 插播（打断当前句）；长按 = 入队（最多 1 条）。
- 男/女切换只影响下一句，不重启场景、不打断当前句。

### 4.5 混音

- 语音音量 0–100（默认 70）；水声压低：开关 + 深度 −6…−18 dB（默认 −12）。
- “试听”在平板本地播放当前句，不外放；耳机里的播放不受影响。
- 总开关 `audio:on/off` 静音全部；急停同时停止序列并静音语音。

### 4.6 命令

| 命令 | 语义 |
| --- | --- |
| `voice:play:<id>` | 插播一句 |
| `voice:seq:<name>` | 播放整条序列（start/imagine/relax/close） |
| `voice:stop` | 停止当前语音与序列 |
| `voice:auto:on\|off` | 自动模式 |
| `voice:volume:<0..100>` | 语音音量 |
| `voice:mix:duck:<0..18>` | 水声压低深度 |
| `voice:set:male\|female` | 切换音色集（下一句生效） |

状态回读（v11）：`voiceId` 1 字节 + flags 两位（playing、auto）。

## 5 打包与播放

- `npm run build` 把 `voice/` 复制到 `dist/voice/`；Gradle 再复制进头显 APK 的 `assets/voice/`。
- 回环服务新增 `/voice/<set>/<id>.mp3`（`audio/mpeg`，长缓存）；页面按需 fetch 并解码。
- 只有头显包带音频；平板包不带，镜像页可播放但默认静音。
- 体积：两套共 78 个文件，约 1.60 MB（男 769 KB / 女 865 KB，48 kbps）。页面启动后在空闲时预解码 6 句。

## 6 TTS 生成（管线）

- 单一来源 `voice/lines.json`（id / group / text / trigger），改一句用 `--only` 增量重算。
- 音色：男声 `zh_male_taocheng_uranus_bigtts`（仿真大赛最终片同款），女声 `zh_female_vv_uranus_bigtts`（豆包默认）。
- 规格：服务端 PCM → 本地一次编码 mono 24 kHz / MP3 48 kbps；`loudnorm I=-18 TP=-3 LRA=11`（实测 −18 dBFS 均值，两套差 ≤1.5 dB）；`speech_rate -5`（≈0.95×）。
- 命令：

```bash
uv run --with websockets python scripts/voice/build.py            # 两套全量
uv run --with websockets python scripts/voice/build.py --voice male
uv run --with websockets python scripts/voice/build.py --only v-safe-1 --update
```

- 密钥只在 `.env.local`（模板 `.env.example`）；已生成文件默认跳过，避免重复计费。
- 产物：`voice/<set>/<id>.mp3` + `voice/manifest.json`（id、file、ms、bytes、sha256、textHash）。

## 7 验收

- 3 名护士 + 2 名志愿者听完 `seq-start` 能复述“下一步做什么”和“怎么停”，≥4/5 正确。
- ≥2/3 护士认为“不像哄人、也不像命令”。
- 点击到出声 ≤300 ms；`stop` 在 200 ms 内静音；ducking 后水声仍可闻。
- 与 `core.md` §6.1 一致：语音由技术员触发，不新增患者端控件。
