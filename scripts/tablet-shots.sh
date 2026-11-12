#!/usr/bin/env bash
# Tablet console screenshots for design review, from the Android emulator.
#
#   ./scripts/tablet-shots.sh                 # all five states + battery stub
#   OUT=/tmp/shots ./scripts/tablet-shots.sh  # somewhere else
#   SERIAL=emulator-5554 ./scripts/tablet-shots.sh
#
# The console proper sits behind a BLE claim, and no headset is present during a
# design pass, so the app renders the same screen over fixture state
# (`--es preview idle|entry|calibrating|running|stopping`). This script only
# reads the emulator: it installs nothing and changes no system setting.
set -u

SERIAL=${SERIAL:-emulator-5554}
OUT=${OUT:-/tmp/tablet-shots}
APP=com.quietshore.control/.MainActivity

if ! adb -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "no device at $SERIAL; start the emulator with:" >&2
  echo "  \$ANDROID_HOME/emulator/emulator -avd qs_tablet -no-window -no-audio \\" >&2
  echo "    -no-boot-anim -gpu swiftshader_indirect -no-snapshot" >&2
  exit 1
fi

mkdir -p "$OUT"

shot() { # name fixture [battery]
  local name=$1 fixture=$2 battery=${3:-}
  local args=(--es preview "$fixture")
  [ -n "$battery" ] && args+=(--ei battery "$battery")
  adb -s "$SERIAL" shell am start -W -n "$APP" "${args[@]}" >/dev/null 2>&1
  sleep 2.2
  adb -s "$SERIAL" exec-out screencap -p > "$OUT/console-$name.png"
  echo "  $OUT/console-$name.png"
}

echo "capturing console states from $SERIAL"
shot idle        idle
shot entry       entry
shot calibrating calibrating
shot running     running
shot stopping    stopping
shot lowbattery  running 15
echo "done"
