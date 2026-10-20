#!/usr/bin/env bash
# Upload the static site and the locally built APKs to yecaoyun.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p 'require("./package.json").version')"
REMOTE=yecaoyun
WEB=/var/www/qs.205716.xyz

ssh -o BatchMode=yes "$REMOTE" "mkdir -p $WEB/downloads"
scp -q site/index.html site/styles.css site/main.js "$REMOTE:$WEB/"
scp -q android/headset/build/outputs/apk/debug/headset-debug.apk "$REMOTE:$WEB/downloads/quiet-shore-headset.apk"
scp -q android/control/build/outputs/apk/debug/control-debug.apk "$REMOTE:$WEB/downloads/quiet-shore-control.apk"
ssh -o BatchMode=yes "$REMOTE" "cd $WEB/downloads && sha256sum quiet-shore-headset.apk quiet-shore-control.apk > SHA256SUMS.txt"
node -e 'const fs=require("fs"); const v=process.argv[1]; fs.writeFileSync("/tmp/qs-manifest.json", JSON.stringify({version:"v"+v,headset:"quiet-shore-headset.apk",control:"quiet-shore-control.apk",sha256:"SHA256SUMS.txt"})+"\n")' "$VERSION"
scp -q /tmp/qs-manifest.json "$REMOTE:$WEB/downloads/manifest.json"
ssh -o BatchMode=yes "$REMOTE" 'nginx -t && systemctl reload nginx'
echo "deployed v$VERSION to https://qs.205716.xyz"
