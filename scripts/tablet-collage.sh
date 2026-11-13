#!/usr/bin/env bash
# Capture the console's screens and compose them into one contact sheet.
#
#   scripts/tablet-collage.sh                       # capture + compose
#   scripts/tablet-collage.sh --compose-only        # reuse the last capture
#   OUT=path.png scripts/tablet-collage.sh
#
# The emulator is started headless when nothing is attached, so this never
# steals a window or a physical device. Every shot is a launch of the shipping
# ControlScreen over fixture state (`--es preview …`), which is the only way to
# reach screens that sit behind a BLE claim.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SHOTS=${SHOTS:-/tmp/qs-collage}
OUT=${OUT:-$ROOT/artifacts/collage/quiet-shore-screens.png}
AVD=${AVD:-qs_tablet}
APK=$ROOT/android/control/build/outputs/apk/debug/control-debug.apk
SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/opt/android-sdk}}
EMULATOR=$SDK/emulator/emulator

compose_only=0
for arg in "$@"; do
  case "$arg" in
    --compose-only) compose_only=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$compose_only" -eq 0 ]; then
  if ! command -v adb >/dev/null; then
    echo "adb not found" >&2
    exit 1
  fi
  if ! adb devices | awk 'NR>1 && $2=="device"{found=1} END{exit !found}'; then
    echo "starting $AVD headless…"
    nohup "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim \
      -gpu swiftshader_indirect >/tmp/qs-emulator.log 2>&1 &
  fi
  adb wait-for-device
  for _ in $(seq 1 90); do
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 2
  done
  # A cold emulator raises SystemUI ANR/crash dialogs over the console, and a
  # sheet with "System UI isn't responding" in five cards is worse than no
  # sheet. Suppress the framework dialogs, then let SystemUI finish settling —
  # the first launch after boot is the one that trips them.
  adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
  adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true
  adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  sleep 15

  if [ ! -f "$APK" ]; then
    echo "building the console APK…"
    "$ROOT/android/gradlew" -p "$ROOT/android" --offline :control:assembleDebug
  fi
  adb install -r "$APK" >/dev/null

  rm -rf "$SHOTS"
  mkdir -p "$SHOTS"

  # Tap coordinates follow the panel, not a hard-coded 2560×1800.
  SIZE=$(adb shell wm size | tr -d '\r' | awk -F'[: x]+' '{print $(NF-1), $NF}')
  W=$(echo "$SIZE" | cut -d' ' -f1)
  H=$(echo "$SIZE" | cut -d' ' -f2)
  at() { adb shell input tap "$((W * $1 / 1000))" "$((H * $2 / 1000))" >/dev/null 2>&1; }
  RAIL_X=$((W * 54 / 1000))
  AUDIO_Y=$((H * 290 / 1000))
  ARCHIVE_Y=$((H * 204 / 1000))
  GUIDE_X=$((W * 863 / 1000))
  GUIDE_Y=$((H * 41 / 1000))

  focus() { adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true; }

  # A starved emulator raises "System UI isn't responding" over the console and
  # it eats every tap. BACK does not close it; its own Wait button does.
  dismiss_dialogs() {
    for _ in 1 2 3; do
      focus | grep -q "Application Not Responding" || return 0
      adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 0
      local xy
      xy=$(adb shell cat /sdcard/ui.xml 2>/dev/null | python3 -c '
import re, sys
xml = sys.stdin.read()
m = re.search(r"resource-id=\"android:id/aerr_wait\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", xml)
if not m:
    sys.exit(1)
x1, y1, x2, y2 = map(int, m.groups())
print((x1 + x2) // 2, (y1 + y2) // 2)')
      [ -n "$xy" ] || return 0
      # shellcheck disable=SC2086
      adb shell input tap $xy >/dev/null 2>&1
      sleep 1
    done
  }

  # Tap, then prove the screen changed; a tap that landed on a dialog or before
  # the page was up is retried once rather than silently shipped in the sheet.
  tap_for() {
    local file=$1 x=$2 y=$3
    local before after
    before=$(md5sum "$SHOTS/$file.png" 2>/dev/null | cut -d" " -f1 || true)
    at "$x" "$y"
    sleep 2
    dismiss_dialogs
    adb exec-out screencap -p >"$SHOTS/$file.png"
    after=$(md5sum "$SHOTS/$file.png" | cut -d" " -f1 || true)
    if [ "$before" = "$after" ]; then
      at "$x" "$y"
      sleep 2
      dismiss_dialogs
      adb exec-out screencap -p >"$SHOTS/$file.png"
    fi
  }

  launch() {
    adb shell am force-stop com.quietshore.control >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    adb shell am start -W -n com.quietshore.control/.MainActivity $1 >/dev/null 2>&1
    sleep "${2:-3}"
    # A screenshot of the launcher is not a screenshot of the console.
    for _ in 1 2 3 4 5; do
      focus | grep -q quietshore && break
      sleep 1
    done
  }
  snap() {
    dismiss_dialogs
    adb exec-out screencap -p >"$SHOTS/$1.png"
    printf '  %-18s %s\n' "$1" "$(stat -c %s "$SHOTS/$1.png")"
  }

  # The catalogue the page publishes, so the cards carry the copy a device
  # carries. Without it the fixture only knows ids and names, and the sheet
  # would show an emptiness that no operator ever sees.
  CATALOG=$(cat "$ROOT/dist/catalog.json")
  CATALOG_ARG="--es catalog '$CATALOG'"

  echo "capturing into $SHOTS"
  launch ""                                             ; snap 01-home
  launch "--es preview idle --ez mirror true $CATALOG_ARG" ; snap 02-scene
  # A mirror card is a WebView: it needs a beat to paint, and it needs a pose
  # or the slot deliberately shows "no picture".
  launch "--es preview calibrating --ez mirror true --ez pose true" 11 ; snap 03-calibrating
  launch "--es preview running --ez mirror true --ez pose true $CATALOG_ARG" 11 ; snap 04-session
  launch "--es preview entry $CATALOG_ARG"               ; snap 05-entry

  launch "--es preview running --ez mirror true --ez pose true" 11
  tap_for 06-voice 54 290   # left rail: 音频

  launch "--es preview idle --es app questionnaire --ez records true" ; snap 07-quiz-answer
  tap_for 08-quiz-archive 51 204   # questionnaire rail: 归档

  launch "--es preview idle --ez mirror true"
  tap_for 09-guide 863 41   # top bar: (i) guide
fi

# The real initial page is the only shot with system chrome; crop it so every
# card is the console and nothing else.
python3 - "$SHOTS" <<'PY'
import sys
from pathlib import Path
from PIL import Image

shots = Path(sys.argv[1])
home = shots / "01-home.png"
image = Image.open(home)
# 2560×1800 at density 320: status bar ends at 96 px, taskbar starts at 1679.
image.crop((0, 96, image.width, min(image.height, 1679))).save(home)
PY

cat >"$SHOTS/manifest.json" <<JSON
{
  "title": "静岸 v3 应用界面拼图",
  "subtitle": "场景化排尿引导器与场景化问卷作答器　平板 2560×1800　手动控制，无流程编排",
  "footer": "静岸 quiet-shore-vr　$(date +%Y-%m-%d)",
  "columns": 3,
  "shots": [
    {"file": "01-home.png", "index": "01", "title": "首页　连接", "note": "真实初始态"},
    {"file": "02-scene.png", "index": "02", "title": "场景　准备与选择", "note": "会话前"},
    {"file": "03-calibrating.png", "index": "03", "title": "适应与标定", "note": "准备间"},
    {"file": "04-session.png", "index": "04", "title": "会话　镜像与现场控制", "note": "进行中"},
    {"file": "05-entry.png", "index": "05", "title": "等待患者按压", "note": "已启动"},
    {"file": "06-voice.png", "index": "06", "title": "音频　提示语与水声", "note": "会话中"},
    {"file": "07-quiz-answer.png", "index": "07", "title": "问卷　作答", "note": "独立应用面"},
    {"file": "08-quiz-archive.png", "index": "08", "title": "问卷　归档", "note": "按问卷与时间筛选"},
    {"file": "09-guide.png", "index": "09", "title": "说明书　当前应用", "note": "顶栏 (i)"}
  ]
}
JSON

python3 "$ROOT/scripts/collage.py" "$SHOTS/manifest.json" "$OUT"
