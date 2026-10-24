#!/usr/bin/env python3
"""Voice cue pipeline: voice/lines.json -> voice/<voice>/<id>.mp3 -> voice/manifest.json.

Reuses the Doubao (火山引擎 SeedTTS 2.0) websocket client vendored next to this
file. Run with `uv run --with websockets python scripts/voice/build.py …` or from
a venv that has `websockets` installed.

Key lookup order: DOUBAO_TTS_API_KEY in the environment, then `.env.local`, then
`.env` at the repository root. Never write the key into a tracked file.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

DEFAULT_RESOURCE_ID = "seed-tts-2.0"

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "voice" / "lines.json"
OUT = ROOT / "voice"
MANIFEST = OUT / "manifest.json"


def load_env() -> None:
    for path in (ROOT / ".env.local", ROOT / ".env"):
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def ffprobe_ms(path: Path) -> int:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return int(round(float(result.stdout.strip()) * 1000))
    except ValueError:
        return 0


def encode_mp3(payload: bytes, suffix: str, dest: Path) -> None:
    """Decode the service payload once, loudness-normalize, encode once.

    TTS output varies a couple of dB between lines and between speakers; a
    bedside patient should never have to adjust the volume mid-session, so every
    clip lands on the same target before it is measured and hashed.
    """
    staged = dest.with_suffix(f".src{suffix}")
    staged.write_bytes(payload)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(staged),
             "-af", "loudnorm=I=-18:TP=-3:LRA=11",
             "-ar", "24000", "-ac", "1", "-b:a", "48k", str(dest)],
            check=True,
        )
    finally:
        staged.unlink(missing_ok=True)


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def synthesize(tts, text: str, voice: dict, defaults: dict) -> bytes:
    """One clip over an already-open connection; a handshake per line is waste."""
    result = await tts.synthesize(
        tts_request(text, voice, defaults)
    )
    return result.audio


def tts_request(text: str, voice: dict, defaults: dict):
    import doubao_tts as dtts  # imported lazily so --dry-run needs no dependencies

    return dtts.TTSRequest(
        text=text,
        speaker=voice["speaker"],
        speech_rate=int(voice.get("speechRate", defaults["speechRate"])),
        loudness_rate=int(voice.get("loudnessRate", defaults["loudnessRate"])),
        fmt=defaults["format"],
        sample_rate=int(defaults["sampleRate"]),
        enable_subtitle=False,
    )


async def run(args: argparse.Namespace) -> int:
    load_env()
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    defaults = data["defaults"]
    voices = data["voices"]
    lines = data["lines"]
    if args.only:
        wanted = {item.strip() for item in args.only.split(",") if item.strip()}
        unknown = wanted - {line["id"] for line in lines}
        if unknown:
            print(f"unknown ids: {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        lines = [line for line in lines if line["id"] in wanted]

    selected = list(voices) if args.voice == "all" else [args.voice]
    out_root = Path(args.out) if args.out else OUT
    key = os.getenv("DOUBAO_TTS_API_KEY", "").strip()
    if not key:
        print(
            "missing TTS key: set DOUBAO_TTS_API_KEY or put it in .env.local "
            "(template: .env.example).",
            file=sys.stderr,
        )
        return 2
    if shutil.which("ffprobe") is None:
        print("ffprobe is required to measure durations", file=sys.stderr)
        return 2

    manifest = {"version": 1, "source": "voice/lines.json", "voices": {}}
    if args.update and MANIFEST.is_file():
        manifest.update(json.loads(MANIFEST.read_text(encoding="utf-8")))

    for name in selected:
        voice = voices[name]
        out_dir = out_root / name
        out_dir.mkdir(parents=True, exist_ok=True)
        entries = []
        total_ms = 0
        client = None
        if not args.dry_run:
            import doubao_tts as dtts
            client = dtts.DoubaoTTS(key, os.getenv("DOUBAO_TTS_RESOURCE_ID") or dtts.DEFAULT_RESOURCE_ID)
            await client.__aenter__()
        for index, line in enumerate(lines, start=1):
            path = out_dir / f"{line['id']}.mp3"
            reused = path.is_file() and not args.force
            if not reused:
                if args.dry_run:
                    print(f"would synthesize {name}/{line['id']}")
                    continue
                payload = await synthesize(client, line["text"], voice, defaults)
                encode_mp3(payload, "." + str(defaults["format"]), path)
            payload = path.read_bytes()
            ms = ffprobe_ms(path)
            total_ms += ms
            entries.append({
                "id": line["id"],
                "group": line["group"],
                "file": f"{name}/{line['id']}.mp3",
                "ms": ms,
                "bytes": len(payload),
                "sha256": sha256_bytes(payload),
                "textHash": text_hash(line["text"]),
            })
            state = "reuse" if reused else "new"
            print(f"[{index:2d}/{len(lines)}] {name:6s} {line['id']:18s} {ms:5d} ms  {state}")
        if client is not None:
            await client.__aexit__(None, None, None)
        manifest["voices"][name] = {
            "speaker": voice["speaker"],
            "label": voice.get("label", name),
            "totalMs": total_ms,
            "files": entries,
        }
        print(f"{name}: {len(entries)} files, {total_ms / 1000:.1f} s, "
              f"{sum(e['bytes'] for e in entries) / 1024:.0f} KB")

    if args.dry_run:
        return 0
    out_root.mkdir(parents=True, exist_ok=True)
    manifest["generatedAt"] = __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds")
    target = (out_root / "manifest.json") if args.out else MANIFEST
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest -> {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="voice-build", description="voice cue build pipeline")
    p.add_argument("--voice", choices=("all", "male", "female"), default="all")
    p.add_argument("--only", help="comma separated ids, e.g. v-safe-1,v-relax-2")
    p.add_argument("--force", action="store_true", help="re-synthesize even when the file exists")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--out", help="output directory (default: voice/)")
    p.add_argument("--update", action="store_true", help="merge into the existing manifest")
    return p


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parser().parse_args())))
