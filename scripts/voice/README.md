# Voice pipeline

`voice/lines.json` → `voice/<男/女>/<id>.mp3` + `voice/manifest.json`。

剧本与用词规则见 `docs/voice-script.md`；这里只管把文本变成可打包的音频。

## 密钥

只放本机，复制根目录 `.env.example` 为 `.env.local` 后填写 `DOUBAO_TTS_API_KEY`。`.env*` 已在 `.gitignore` 里，`build.py` 不会打印密钥。

## 生成

```bash
# 不需要装依赖：uv 临时带 websockets
uv run --with websockets python scripts/voice/build.py            # 男声 + 女声，全部 32 句
uv run --with websockets python scripts/voice/build.py --voice male
uv run --with websockets python scripts/voice/build.py --only v-safe-1,v-relax-2 --update
```

- 已有同名文件默认跳过（省额度）；要重算加 `--force`。
- `--update` 合并进现有 manifest，改一句不必重跑全套。
- `--dry-run` 只打印计划。

## 音色

| 集 | speaker | 来源 |
| --- | --- | --- |
| male | `zh_male_taocheng_uranus_bigtts` | 仿真大赛最终片 `film.toml` 同款 |
| female | `zh_female_vv_uranus_bigtts` | 豆包默认音色 |

改音色只改 `voice/lines.json` 的 `voices.*.speaker`，然后 `--force` 重生成；两套必须用同一批参数，否则节奏会不一致。

## 打包

1. `npm run build` 把 `voice/` 复制到 `dist/voice/`；
2. Gradle 把 `dist/voice/` 复制进头显 APK 的 `assets/voice/`；
3. 回环服务以 `/voice/<voice>/<id>.mp3` 提供，页面按需 fetch。

平板包不带音频；镜像页可播放但默认静音。

## 规格

mono 24 kHz，MP3 48 kbps，`speech_rate -5`（约 0.95×），`loudness_rate 0`。改这些值属于全局变更，两套一起重生成。
