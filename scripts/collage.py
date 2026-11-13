#!/usr/bin/env python3
"""Compose the console's screens into one sheet.

Reads a manifest (JSON) written by `scripts/tablet-collage.sh` and renders a
paper-and-ink contact sheet: numbered cards, hairline frames, one cut corner
per card — the same language the console itself uses, so the sheet reads as a
page of the product rather than a folder of screenshots.

    python3 scripts/collage.py manifest.json out.png

Manifest shape:

    {
      "title": "静岸 v3 应用界面拼图",
      "subtitle": "场景化排尿引导器与场景化问卷作答器　平板 2560×1800",
      "footer": "静岸 quiet-shore-vr",
      "columns": 3,
      "shots": [
        {"file": "01-home.png", "index": "01", "title": "首页　连接", "note": "真实初始态"}
      ]
    }
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# The console's own palette, so the sheet and the app never disagree.
PAPER = (244, 244, 242)
BOARD = (255, 255, 255)
INK = (22, 22, 22)
INK2 = (94, 101, 90)
HAIRLINE = (217, 217, 214)
ICE = (125, 230, 255)

FONT_DIR = Path("/usr/share/fonts/adobe-source-han-sans")
FONT_FILES = {
    400: FONT_DIR / "SourceHanSansCN-Regular.otf",
    500: FONT_DIR / "SourceHanSansCN-Medium.otf",
    700: FONT_DIR / "SourceHanSansCN-Bold.otf",
}

CARD_W = 760
CARD_PAD = 18
GAP = 28
MARGIN = 64
HEADER_H = 150
FOOTER_H = 70
CUT = 22


@dataclass
class Shot:
    image: Image.Image
    index: str
    title: str
    note: str


def font(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    path = FONT_FILES.get(weight, FONT_FILES[400])
    if not path.exists():  # other machines: fall back to the CJK collection
        path = Path("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc")
    return ImageFont.truetype(str(path), size)


def cut_corner(size: tuple[int, int], cut: int) -> Image.Image:
    """A mask that removes the bottom-right corner, like every pressable key."""
    mask = Image.new("L", size, 255)
    draw = ImageDraw.Draw(mask)
    w, h = size
    draw.polygon([(w - cut, h), (w, h - cut), (w, h)], fill=0)
    return mask


def fit(image: Image.Image, width: int) -> Image.Image:
    if image.width == width:
        return image
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def card_height(shot: Shot, width: int) -> int:
    scaled = fit(shot.image, width)
    return CARD_PAD + 64 + scaled.height + CARD_PAD


def draw_card(sheet: Image.Image, shot: Shot, x: int, y: int, width: int) -> int:
    scaled = fit(shot.image, width)
    inner = width - CARD_PAD * 2
    scaled = fit(shot.image, inner)
    height = CARD_PAD * 2 + 64 + scaled.height

    panel = Image.new("RGB", (width, height), BOARD)
    mask = cut_corner((width, height), CUT)
    sheet.paste(panel, (x, y), mask)

    draw = ImageDraw.Draw(sheet)
    draw.rectangle([x, y, x + width - 1, y + height - 1], outline=HAIRLINE)

    # `01` in ice, the name in ink, the note right-aligned and quiet.
    draw.text((x + CARD_PAD, y + CARD_PAD - 2), shot.index, font=font(20, 700), fill=ICE)
    draw.text((x + CARD_PAD + 42, y + CARD_PAD), shot.title, font=font(24, 500), fill=INK)
    if shot.note:
        note_font = font(18)
        note_w = draw.textlength(shot.note, font=note_font)
        draw.text(
            (x + width - CARD_PAD - note_w, y + CARD_PAD + 6),
            shot.note,
            font=note_font,
            fill=INK2,
        )

    shot_top = y + CARD_PAD + 64
    shot_mask = cut_corner(scaled.size, CUT)
    sheet.paste(scaled.convert("RGB"), (x + CARD_PAD, shot_top), shot_mask)
    draw.rectangle(
        [x + CARD_PAD, shot_top, x + CARD_PAD + scaled.width - 1, shot_top + scaled.height - 1],
        outline=HAIRLINE,
    )
    return height


def compose(manifest: dict, out: Path) -> None:
    base = Path(manifest["_dir"])
    shots = [
        Shot(
            image=Image.open(base / item["file"]),
            index=str(item["index"]),
            title=item["title"],
            note=item.get("note", ""),
        )
        for item in manifest["shots"]
    ]
    columns = int(manifest.get("columns", 3))
    rows = (len(shots) + columns - 1) // columns

    row_heights = []
    for row in range(rows):
        band = shots[row * columns : (row + 1) * columns]
        row_heights.append(max(card_height(shot, CARD_W) for shot in band))

    width = MARGIN * 2 + CARD_W * columns + GAP * (columns - 1)
    height = (
        MARGIN
        + HEADER_H
        + sum(row_heights)
        + GAP * (rows - 1)
        + FOOTER_H
        + MARGIN // 2
    )
    sheet = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, MARGIN - 8), manifest.get("title", ""), font=font(46, 700), fill=INK)
    draw.text(
        (MARGIN, MARGIN + 62),
        manifest.get("subtitle", ""),
        font=font(22),
        fill=INK2,
    )
    draw.line(
        [(MARGIN, MARGIN + HEADER_H - 26), (width - MARGIN, MARGIN + HEADER_H - 26)],
        fill=HAIRLINE,
    )

    y = MARGIN + HEADER_H
    for row in range(rows):
        band = shots[row * columns : (row + 1) * columns]
        for column, shot in enumerate(band):
            x = MARGIN + column * (CARD_W + GAP)
            draw_card(sheet, shot, x, y, CARD_W)
        y += row_heights[row] + GAP

    footer = manifest.get("footer", "")
    if footer:
        draw.text(
            (MARGIN, height - FOOTER_H - MARGIN // 4),
            footer,
            font=font(20),
            fill=INK2,
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, optimize=True)
    print(f"{out}  {sheet.width}×{sheet.height}")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text())
    manifest["_dir"] = str(manifest_path.parent)
    compose(manifest, Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
