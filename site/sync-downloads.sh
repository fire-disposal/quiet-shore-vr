#!/usr/bin/env bash
# Mirror the latest GitHub release APKs onto the site origin.
# Intended to run from a systemd timer on yecaoyun, not from the workstation.
set -euo pipefail
ROOT="${1:-/var/www/qs.205716.xyz/downloads}"
REPO="fire-disposal/quiet-shore-vr"
mkdir -p "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
curl -fsSL --retry 3 --retry-delay 2 \
  -H 'Accept: application/vnd.github+json' "${AUTH[@]}" \
  "https://api.github.com/repos/$REPO/releases/latest" > "$TMP/release.json" || exit 0

python3 - "$TMP/release.json" "$TMP" <<'PY'
import json, sys, pathlib
release = json.load(open(sys.argv[1]))
assets = release.get("assets") or []
tag = release.get("tag_name") or "latest"
def find(prefix):
    return next((a for a in assets if (a.get("name") or "").startswith(prefix)), None)
headset = find("quiet-shore-headset-")
control = find("quiet-shore-control-")
if not headset or not control:
    raise SystemExit(1)
pathlib.Path(sys.argv[2], "tag").write_text(tag + "\n")
pathlib.Path(sys.argv[2], "headset.url").write_text(headset["browser_download_url"] + "\n")
pathlib.Path(sys.argv[2], "control.url").write_text(control["browser_download_url"] + "\n")
PY

curl -fsSL --retry 3 --retry-delay 2 "$(cat "$TMP/headset.url")" -o "$TMP/quiet-shore-headset.apk"
curl -fsSL --retry 3 --retry-delay 2 "$(cat "$TMP/control.url")" -o "$TMP/quiet-shore-control.apk"
( cd "$TMP" && sha256sum quiet-shore-headset.apk quiet-shore-control.apk > SHA256SUMS.txt )
VERSION="$(cat "$TMP/tag")"
python3 - "$TMP" "$ROOT" "$VERSION" <<'PY'
import json, pathlib, sys
src, dst, version = map(pathlib.Path, sys.argv[1:]) if False else (pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3])
data = {
    "version": version,
    "headset": "quiet-shore-headset.apk",
    "control": "quiet-shore-control.apk",
    "sha256": "SHA256SUMS.txt",
}
(dst / "manifest.json.tmp").write_text(json.dumps(data, ensure_ascii=False) + "\n")
PY
mv "$TMP/quiet-shore-headset.apk" "$ROOT/quiet-shore-headset.apk.tmp"
mv "$TMP/quiet-shore-control.apk" "$ROOT/quiet-shore-control.apk.tmp"
mv "$TMP/SHA256SUMS.txt" "$ROOT/SHA256SUMS.txt.tmp"
mv "$ROOT/quiet-shore-headset.apk.tmp" "$ROOT/quiet-shore-headset.apk"
mv "$ROOT/quiet-shore-control.apk.tmp" "$ROOT/quiet-shore-control.apk"
mv "$ROOT/SHA256SUMS.txt.tmp" "$ROOT/SHA256SUMS.txt"
mv "$ROOT/manifest.json.tmp" "$ROOT/manifest.json"
echo "mirrored $VERSION to $ROOT"
