#!/usr/bin/env bash
# Install an archived release pair onto whatever is plugged in.
#
#   ./scripts/install-release.sh                 # newest artifacts/releases/*, auto-detect device role
#   ./scripts/install-release.sh v1.0.0          # a specific archived release
#   ./scripts/install-release.sh v1.0.0 <serial> # force a device
#   ./scripts/install-release.sh v1.0.0 --both   # install both APKs on one device (rarely useful)
#
# Why a script: the two APKs are a pair and the wrong one on the wrong device is
# the usual mistake. Headset = Pico/VR hardware; control = the tablet.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REL=${1:-}
if [ -z "$REL" ]; then
  REL=$(ls -1 "$ROOT/artifacts/releases" | sort -V | tail -1)
fi
REL=${REL#v}
DIR="$ROOT/artifacts/releases/v$REL"
[ -d "$DIR" ] || { echo "no such release: $DIR" >&2; exit 1; }

SERIAL=${2:-}
BOTH=${3:-}
if [ -z "$SERIAL" ]; then
  SERIAL=$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator/ {print $1; exit}')
  [ -n "$SERIAL" ] || { echo "no physical device on adb (emulator excluded); plug in and enable USB debugging" >&2; exit 2; }
fi

model=$(adb -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
vrmode=$(adb -s "$SERIAL" shell settings get global vr_mode 2>/dev/null | tr -d '\r')

case "$model" in
  *Pico*|*PICO*|*A7910*) role=headset ;;
  *) role=control ;;
esac

install_one() {
  local apk=$1
  echo "installing $(basename "$apk") → $SERIAL ($model)"
  adb -s "$SERIAL" install -r -d "$apk" | tail -1
}

if [ "$BOTH" = "--both" ]; then
  install_one "$DIR/quiet-shore-headset-$REL.apk"
  install_one "$DIR/quiet-shore-control-$REL.apk"
else
  install_one "$DIR/quiet-shore-$role-$REL.apk"
fi

echo '--- installed version'
adb -s "$SERIAL" shell "dumpsys package com.quietshore.$role | grep -E 'versionName|versionCode' | head -2"
