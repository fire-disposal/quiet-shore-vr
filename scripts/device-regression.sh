#!/usr/bin/env bash
# The three checks that need real hardware, in one command.
#
#   ./scripts/device-regression.sh              # both devices plugged in
#   ./scripts/device-regression.sh --tablet-only
#
# It never installs anything and never changes a setting: it reads versions,
# measures how much of the tablet's screen the console actually occupies, and
# prints the exact steps for the two things a script cannot press for you
# (a live scene switch, and the injected tap into Firefox Reality).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ADB="${ADB:-adb}"
TABLET_ONLY=0
[ "${1:-}" = "--tablet-only" ] && TABLET_ONLY=1

devices() { "$ADB" devices | awk 'NR>1 && $2=="device" {print $1}'; }
model() { "$ADB" -s "$1" shell getprop ro.product.model 2>/dev/null | tr -d '\r'; }

tab=""; head=""
for s in $(devices); do
  case "$s" in emulator-*) continue ;; esac
  m=$(model "$s")
  case "$m" in
    *Pico*|*PICO*|*A7910*) head=$s ;;
    *) tab=$s ;;
  esac
done

say() { printf '%s\n' "$*"; }
rule() { printf '%s\n' "------------------------------------------------------------"; }

rule
say "版本（必须成对：头显 2.0.0/201，平板 2.0.0/200）"
if [ -n "$tab" ]; then
  say "平板 ${tab}  $(model "$tab")"
  "$ADB" -s "$tab" shell "dumpsys package com.quietshore.control | grep -E 'versionName=|versionCode=' | head -2" | sed 's/^/  /'
else
  say "平板：未连接"
fi
if [ -n "$head" ] && [ "$TABLET_ONLY" -eq 0 ]; then
  say "头显 ${head}  $(model "$head")"
  "$ADB" -s "$head" shell "dumpsys package com.quietshore.portal | grep -E 'versionName=|versionCode=' | head -2" | sed 's/^/  /'
else
  say "头显：未连接（或用 --tablet-only 跳过）"
fi

rule
say "C6 控制台占高：把应用拉到前台，量内容区 vs 屏幕"
if [ -n "$tab" ]; then
  "$ADB" -s "$tab" shell am force-stop com.quietshore.control
  "$ADB" -s "$tab" shell am start -W -n com.quietshore.control/.MainActivity >/dev/null 2>&1
  sleep 3
  size=$("$ADB" -s "$tab" shell wm size | tr -d '\r' | awk -F': ' '/Override|Physical/ {print $2; exit}')
  say "  屏幕：${size:-unknown}"
  "$ADB" -s "$tab" shell uiautomator dump /sdcard/qs.xml >/dev/null 2>&1
  "$ADB" -s "$tab" shell cat /sdcard/qs.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | sed -E 's/[^0-9]+/ /g' \
    | awk '{ if ($4 > max) max=$4; if (min=="" || $2 < min) min=$2 } END { if (max) printf "  内容纵向范围：%d … %d（占屏 %.0f%%）\n", min, max, 100*(max-min)/'"$(echo ${size:-0x0} | cut -dx -f2)"' }' \
    || say "  量不到（应用可能没起来）"
  mkdir -p /tmp/device-check
  "$ADB" -s "$tab" exec-out screencap -p > /tmp/device-check/tablet-console.png 2>/dev/null &&
    say "  截图：/tmp/device-check/tablet-console.png"
else
  say "  跳过：平板未连接"
fi

rule
say "A7 场景切换（需要两台设备 + 一次真实会话）"
say "  1. 平板起会话：启动训练 → 患者按一次头显右侧按钮 → 进入训练中"
say "  2. 在平板点另一张场景卡（会话中应显示“会话中不可切换”并置灰）"
say "  3. 结束会话，重新选场景 → 启动，确认换场景后强度上限跟着变、姿态走斜坡"
say "  记录：两次切换的平板截图 + 头显画面（可让患者描述，或拍液晶）"

if [ "$TABLET_ONLY" -eq 0 ]; then
  rule
  say "dispatchGesture 手势门（需要头显 + Firefox Reality）"
  say "  1. adb shell settings get secure enabled_accessibility_services   # 确认 TapService 已开"
  say "  2. 头显前台是 Firefox Reality 的训练页时，让平板发“启动训练”"
  say "  3. 观察：EntryRetry 是否在 20 秒内自己点进沉浸模式（患者没有按）"
  say "  4. 失败则记录 logcat：adb -s <headset> logcat -d | grep -i 'tap\\|gesture\\|inject'"
fi
rule
