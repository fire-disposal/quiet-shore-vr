# Voice pipeline

`questionnaires/*.json` 提供问卷题干，`voice/lines.json` 同时保存训练引导与生成后的问卷语音文本。`scripts/questionnaire/build.mjs` 负责同步后者，禁止再手工维护两份题干。

剧本与用词规则见 `docs/voice-script.md`，APP2 数据结构见 `docs/questionnaire.md`。

## 密钥

只放本机，复制根目录 `.env.example` 为 `.env.local` 后填写 `DOUBAO_TTS_API_KEY`。`.env*` 已在 `.gitignore` 里，脚本不会打印密钥。

## 生成

```bash
# 推荐：生成问卷代码与目录，只补齐缺失或文本变化的男女语音
npm run questionnaire:voice

# 只更新代码、目录和语音文本，不访问 TTS
npm run questionnaire:generate

# 检查生成物、题干、manifest、MP3 文件大小和 SHA-256
npm run questionnaire:check

# 底层语音工具仍可单独使用
uv run --with websockets python scripts/voice/build.py --voice male
uv run --with websockets python scripts/voice/build.py --only v-safe-1,v-relax-2 --update
```

- 已有同名文件且文本哈希一致时跳过，节省额度。
- `--update` 合并现有 manifest，改一句不必重跑全套。
- 普通 `npm run build` 不访问 TTS，但缺文件或哈希不一致会失败。

## 音色

| 集 | speaker | 来源 |
| --- | --- | --- |
| male | `zh_male_taocheng_uranus_bigtts` | 仿真大赛最终片 `film.toml` 同款 |
| female | `zh_female_vv_uranus_bigtts` | 豆包默认音色 |

改音色只改 `voice/lines.json` 的 `voices.*.speaker`，然后 `--force` 重生成。两套必须使用同一批参数。

## 打包

1. `npm run build` 校验并复制 `voice/` 到 `dist/voice/`，同时生成 `dist/questionnaires.json`。
2. Gradle 把语音注入头显 APK，把问卷目录注入控制 APK。
3. 回环服务以 `/voice/<voice>/<id>.mp3` 提供音频，页面按需 fetch。

蓝牙只传问卷 ID、题号、答案和开关，不传题干全文或音频：题干在构建时编进两端的 `questionnaires.json` 与 `generated.ts`。平板包不带音频。

## 规格

- 服务端出 wav PCM，本地只编码一次：`loudnorm=I=-18:TP=-3:LRA=11`，mono 24 kHz MP3 48 kbps。
- `speech_rate -5`，`loudness_rate 0`。改参数属于全局变更，两套一起重生成。
- 一条连接跑完一整套，避免逐句握手。
- 当前内容包含 SUS 十题、GAD-7 七题及训练引导，共 32 条语音线索、64 个 MP3。
