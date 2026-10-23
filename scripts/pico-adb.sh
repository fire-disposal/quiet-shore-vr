#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${QUIET_SHORE_REPO:-fire-disposal/quiet-shore-vr}"
PKG="com.quietshore.portal"
ACTIVITY="$PKG/.MainActivity"
FIREFOX_PKG="org.mozilla.vrbrowser"
FIREFOX_ACTIVITY=".VRBrowserActivity"
PORT="8130"
DEV_PORT="8125"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/artifacts}"
APK="${APK:-$ARTIFACT_DIR/quiet-shore.apk}"
SERIAL="${PICO_SERIAL:-}"

HOME_OURS="com.quietshore.portal/.MainActivity"
HOME_SYSTEM="com.pvr.launcher/.MainActivity"
HOME_VENDOR="vr.xinjing.com.vrmc/.ui.SplashActivity"

find_adb() {
  if [ -n "${ADB:-}" ] && [ -x "${ADB}" ]; then
    printf '%s\n' "$ADB"
    return 0
  fi
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return 0
  fi
  local candidate
  for candidate in \
    "${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}/platform-tools/adb" \
    /opt/android-sdk/platform-tools/adb \
    "$HOME/Android/Sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb.exe"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf 'adb not found. Install android-tools or set ADB=/path/to/adb\n' >&2
  return 1
}

ADB_BIN="$(find_adb)"

adb_cmd() {
  if [ -n "$SERIAL" ]; then
    "$ADB_BIN" -s "$SERIAL" "$@"
  else
    "$ADB_BIN" "$@"
  fi
}

require_device() {
  adb_cmd wait-for-device
  local state
  state="$(adb_cmd get-state 2>/dev/null || true)"
  if [ "$state" != "device" ]; then
    printf 'No authorized device. Current state: %s\n' "${state:-unknown}" >&2
    adb_cmd devices -l >&2 || true
    exit 1
  fi
}

fetch_apk() {
  local run_id="${1:-}"
  mkdir -p "$ARTIFACT_DIR"
  if [ -z "$run_id" ]; then
    run_id="$(gh run list --repo "$REPO" --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
  fi
  if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
    printf 'No successful GitHub Actions run found for %s\n' "$REPO" >&2
    exit 1
  fi

  local tmp
  tmp="$(mktemp -d "$ARTIFACT_DIR/download.XXXXXX")"
  printf 'Downloading artifacts from run %s...\n' "$run_id"
  if ! gh run download "$run_id" --repo "$REPO" -D "$tmp"; then
    rm -rf "$tmp"
    printf 'Artifact download failed. Check gh auth/network.\n' >&2
    exit 1
  fi

  local found
  found="$(find "$tmp" -type f -name 'quiet-shore.apk' | head -n 1)"
  if [ -z "$found" ]; then
    rm -rf "$tmp"
    printf 'quiet-shore.apk not found in run %s artifacts\n' "$run_id" >&2
    exit 1
  fi
  cp "$found" "$APK"
  rm -rf "$tmp"
  printf 'APK: %s\n' "$APK"
}

install_apk() {
  require_device
  if [ ! -f "$APK" ]; then
    fetch_apk
  fi
  adb_cmd install -r -d "$APK"
  printf 'Installed %s\n' "$PKG"
}

launch_app() {
  require_device
  adb_cmd shell am start -n "$ACTIVITY"
}

open_url() {
  local url="$1"
  require_device
  adb_cmd shell am start -a android.intent.action.VIEW -d "$url" -n "$FIREFOX_PKG/$FIREFOX_ACTIVITY"
}

status_app() {
  require_device
  adb_cmd shell pm path "$PKG" || true
  adb_cmd shell dumpsys package "$PKG" | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime' || true
}

show_logs() {
  require_device
  printf 'Streaming logcat; Ctrl-C to stop.\n'
  adb_cmd logcat -v time | grep -E 'quietshore|vrbrowser|Gecko|WebXR|chromium|AndroidRuntime' || true
}

home_status() {
  require_device
  adb_cmd shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN \
    -c android.intent.category.HOME | tail -n 1
}

home_set() {
  local component="$1"
  require_device
  adb_cmd shell cmd package set-home-activity "$component"
  adb_cmd shell input keyevent 3
  sleep 1
  home_status
}

screenshot() {
  require_device
  mkdir -p "$ARTIFACT_DIR"
  local out="$ARTIFACT_DIR/pico-$(date +%Y%m%d-%H%M%S).png"
  adb_cmd exec-out screencap -p > "$out"
  printf 'Screenshot: %s\n' "$out"
}

usage() {
  cat <<'EOF'
Usage: scripts/pico-adb.sh <command> [args]

Commands:
  devices                 List adb devices
  status                  Show installed package path/version
  fetch [run-id]          Download quiet-shore.apk from a successful CI run
  install [apk]           Install APK (default: artifacts/quiet-shore.apk)
  launch                  Start MainActivity (Portal UI + local service)
  open                    Open http://127.0.0.1:8130/ in Firefox Reality
  open-dev                Open http://127.0.0.1:8125/ (after `adb reverse`)
  reverse                 adb reverse tcp:8125 for the local dev server
  unreverse               Remove the 8125 reverse
  deploy                  fetch + install + launch
  logs                    Stream filtered logcat
  screenshot              Save a device screenshot to artifacts/
  home [ours|system|vendor|status]
                          Switch the default HOME via shell (demo only); status prints current
  uninstall               Uninstall com.quietshore.portal
  clean-draft             Uninstall the old com.stillwater.portal package, if present

Environment:
  ADB=/path/to/adb
  PICO_SERIAL=PA7910RGG1020100B
  ARTIFACT_DIR=...        default: <repo>/artifacts
  APK=...                 default: <artifact-dir>/quiet-shore.apk
  QUIET_SHORE_REPO=owner/repo
EOF
}

main() {
  local command="${1:-help}"
  shift || true

  case "$command" in
    devices) require_device; adb_cmd devices -l ;;
    status) status_app ;;
    fetch) fetch_apk "${1:-}" ;;
    install) if [ -n "${1:-}" ]; then APK="$1"; fi; install_apk ;;
    launch) launch_app ;;
    open) open_url "http://127.0.0.1:$PORT/" ;;
    open-dev) open_url "http://127.0.0.1:$DEV_PORT/" ;;
    reverse) require_device; adb_cmd reverse "tcp:$DEV_PORT" "tcp:$DEV_PORT"; printf 'reverse tcp:%s -> tcp:%s\n' "$DEV_PORT" "$DEV_PORT" ;;
    unreverse) require_device; adb_cmd reverse --remove "tcp:$DEV_PORT" || true ;;
    deploy) fetch_apk; install_apk; launch_app ;;
    logs) show_logs ;;
    screenshot) screenshot ;;
    home)
      case "${1:-status}" in
        ours) home_set "$HOME_OURS" ;;
        system) home_set "$HOME_SYSTEM" ;;
        vendor|restore) home_set "$HOME_VENDOR" ;;
        status) home_status ;;
        *) usage; exit 2 ;;
      esac
      ;;
    uninstall) require_device; adb_cmd uninstall "$PKG" || true ;;
    clean-draft) require_device; adb_cmd uninstall "com.stillwater.portal" || true ;;
    help|-h|--help) usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
