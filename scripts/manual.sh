#!/usr/bin/env bash
# Render the operator manual with the 2.1 visual standard:
# Markdown -> standalone HTML + manual.css -> Chromium A4 PDF.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DIR="$ROOT/docs/manual-v2"
HTML="$DIR/manual.html"
PDF="$DIR/manual.pdf"

cleanup() {
  rm -f "$HTML"
}
trap cleanup EXIT

cd "$DIR"
quarto render manual.md --to html --output manual.html --css manual.css --embed-resources
chromium \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --no-pdf-header-footer \
  --virtual-time-budget=2500 \
  --print-to-pdf="$PDF" \
  "file://$HTML" >/tmp/quiet-shore-manual-chromium.log 2>&1

pdfinfo "$PDF" | grep -E 'Pages|Page size'
