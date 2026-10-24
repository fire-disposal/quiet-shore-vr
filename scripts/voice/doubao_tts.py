#!/bin/sh
# 双语法首行：sh 读作 exec（''''exec ⇒ exec）并转到项目根 .venv 的 python；python 读作一个无副作用的字符串表达式。
''''exec "$(dirname "$(readlink -f "$0")")/../.venv/bin/python" "$0" "$@" #'''  # noqa: B018
"""豆包（火山引擎 SeedTTS 2.0）语音合成封装 —— v3 双向流式二进制协议。

协议层移植自 `~/dev/nursing-vp-sim/backend/infra/tts/client.py`（生产在用实现），
新增：PCM 精确时长、`enable_subtitle` 字级时间戳、批量旁白与清单。
密钥从环境变量或 `.env` 读取，不写入代码。

用法::

    export DOUBAO_TTS_API_KEY=<火山引擎控制台 X-Api-Key>
    ./doubao_tts.py --check                        # 探活
    ./doubao_tts.py --list-speakers
    ./doubao_tts.py --text "推演开始" --out /tmp/a.wav
    ./doubao_tts.py --file 旁白.txt --out 02-旁白   # 每行一段，含字级时间戳清单

带时间轴的成片流程见 `./narration.py`。
"""

import argparse
import asyncio
import io
import json
import logging
import os
import struct
import subprocess
import sys
import time
import uuid
import wave
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field, replace
from enum import IntEnum
from pathlib import Path
from typing import TYPE_CHECKING

import websockets

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

log = logging.getLogger("doubao_tts")

TTS_WS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"
DEFAULT_RESOURCE_ID = "seed-tts-2.0"
DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts"

# 音色库（同 nursing-vp-sim backend/infra/tts/mapper.py 的内置默认值）
SPEAKER_LIBRARY: dict[str, str] = {
    "child_male": "zh_male_qingse_bigtts",
    "child_female": "zh_female_qingxin_bigtts",
    "male_young": "zh_male_qingse_bigtts",
    "male_middle": "zh_male_wennuan_bigtts",
    "male_elder": "zh_male_wennuan_bigtts",
    "female_young": "zh_female_qingxin_bigtts",
    "female_middle": "zh_female_wenrou_bigtts",
    "female_elder": "zh_female_wenrou_bigtts",
    "fallback": DEFAULT_SPEAKER,
}

_HERE = Path(__file__).resolve().parent
_ENV_CANDIDATES = (_HERE / ".env", _HERE.parent / ".env")


# ── 二进制协议常量 ──


class MsgType(IntEnum):
    FullClientRequest = 0b0001
    FullServerResponse = 0b1001
    AudioOnlyServer = 0b1011
    Error = 0b1111


class MsgFlag(IntEnum):
    NoSeq = 0
    WithEvent = 0b100


class EventType(IntEnum):
    StartConnection = 1
    FinishConnection = 2
    ConnectionStarted = 50
    ConnectionFailed = 51
    ConnectionFinished = 52
    StartSession = 100
    CancelSession = 101
    FinishSession = 102
    SessionStarted = 150
    SessionCanceled = 151
    SessionFinished = 152
    SessionFailed = 153
    TaskRequest = 200
    TTSSentenceStart = 350
    TTSSentenceEnd = 351
    TTSResponse = 352
    TTSSubtitle = 353  # 官方文档未给编号；解析以 payload 内是否含 words 为准


_SERIALIZATION_JSON = 0b0001
_COMPRESSION_NONE = 0
_VERSION = 1
_HEADER_NIBBLE = 1  # header_size (4x) = 1 × 4 = 4 字节头

_HEADER_BASE = bytes(
    [
        (_VERSION << 4) | _HEADER_NIBBLE,
        0,
        (_SERIALIZATION_JSON << 4) | _COMPRESSION_NONE,
    ]
).ljust(_HEADER_NIBBLE * 4, b"\x00")  # 4 bytes


def _marshal(msg_type: MsgType, flag: MsgFlag, body: bytes, /) -> bytes:
    hdr = bytearray(_HEADER_BASE)
    hdr[1] = (msg_type << 4) | flag
    return bytes(hdr) + body


def _write_event(e: EventType) -> bytes:
    return struct.pack(">i", e)


def _write_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack(">I", len(b)) + b


def _write_payload(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def _read_event(buf: io.BytesIO) -> int | None:
    raw = buf.read(4)
    if len(raw) < 4:
        return None
    val = struct.unpack(">i", raw)[0]
    try:
        return EventType(val)
    except ValueError:
        return val  # 未知事件 —— 由调用方按 payload 形状决定


def _read_str(buf: io.BytesIO) -> str:
    raw = buf.read(4)
    if len(raw) < 4:
        return ""
    size = struct.unpack(">I", raw)[0]
    if size == 0:
        return ""
    return buf.read(size).decode("utf-8")


def _read_payload(buf: io.BytesIO) -> bytes:
    raw = buf.read(4)
    if len(raw) < 4:
        return b""
    size = struct.unpack(">I", raw)[0]
    if size == 0:
        return b""
    return buf.read(size)


# ── 帧的构造与解析 ──


@dataclass
class ServerMessage:
    type: MsgType
    event: int | None = None
    payload: bytes | dict | None = None


def _parse_server_response(data: bytes) -> ServerMessage:
    """解析 v3 二进制服务端帧（4 字节头 + 变长体）。"""
    if len(data) < _HEADER_NIBBLE * 4:
        raise RuntimeError(f"TTS: 帧过短（{len(data)} 字节）")

    msg_type = MsgType((data[1] >> 4) & 0xF)
    flag = MsgFlag(data[1] & 0xF)
    buf = io.BytesIO(data[_HEADER_NIBBLE * 4 :])

    event: int | None = None
    if flag == MsgFlag.WithEvent:
        event = _read_event(buf)
        is_connection_event = event in (
            EventType.ConnectionStarted,
            EventType.ConnectionFailed,
            EventType.ConnectionFinished,
        )
        if not is_connection_event:
            _read_str(buf)  # session_id
        if is_connection_event:
            _read_str(buf)  # connect_id

    if msg_type == MsgType.AudioOnlyServer:
        return ServerMessage(type=msg_type, event=event, payload=_read_payload(buf) or b"")

    payload_raw = _read_payload(buf)
    payload: bytes | dict = payload_raw
    if payload_raw and _SERIALIZATION_JSON:
        try:
            payload = json.loads(payload_raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    return ServerMessage(type=msg_type, event=event, payload=payload)


async def _read_server_message(ws: ClientConnection) -> ServerMessage:
    raw = await ws.recv()
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"message": raw}
        raise RuntimeError(f"TTS 服务端错误：{str(data.get('message', raw))[:300]}")
    if isinstance(raw, bytes):
        return _parse_server_response(raw)
    raise TypeError(f"TTS: 意外的帧类型 {type(raw)}")


# ── 请求构造 ──


@dataclass
class TTSRequest:
    text: str
    speaker: str = DEFAULT_SPEAKER
    speech_rate: int = 0
    loudness_rate: int = 0
    fmt: str = "wav"  # wav | mp3 | ogg_opus | pcm（wav/pcm 走同一 PCM 线上格式）
    sample_rate: int = 24000
    enable_subtitle: bool = True  # 返回字级时间戳（仅 2.0 系列支持）

    @property
    def wire_format(self) -> str:
        """线上音频格式：wav 由本地加头，避免流式 wav 头不可靠（见官方文档）。"""
        return "pcm" if self.fmt in ("wav", "pcm") else self.fmt

    @property
    def exact_timing(self) -> bool:
        """PCM 16bit 单声道下可由字节数推出精确时长。"""
        return self.wire_format == "pcm"


def _build_start_connection() -> bytes:
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.StartConnection) + _write_payload(b"{}"),
    )


def _build_finish_connection() -> bytes:
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.FinishConnection) + _write_payload(b"{}"),
    )


def _build_start_session(req: TTSRequest, session_id: str) -> bytes:
    body_json = json.dumps(
        {
            "event": EventType.StartSession,
            "user": {"uid": str(uuid.uuid4())},
            "namespace": "BidirectionalTTS",
            "req_params": {
                "speaker": req.speaker,
                "audio_params": {
                    "format": req.wire_format,
                    "sample_rate": req.sample_rate,
                    "speech_rate": req.speech_rate,
                    "loudness_rate": req.loudness_rate,
                    # 位置敏感：放在 req_params 顶层时服务端静默返回空 words（实测）。
                    "enable_subtitle": req.enable_subtitle,
                },
                "additions": json.dumps({"disable_markdown_filter": False}),
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")

    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.StartSession) + _write_str(session_id) + _write_payload(body_json),
    )


def _build_task_request(text: str, session_id: str) -> bytes:
    body_json = json.dumps(
        {
            "event": EventType.TaskRequest,
            "user": {"uid": str(uuid.uuid4())},
            "namespace": "BidirectionalTTS",
            "req_params": {"text": text},
        },
        ensure_ascii=False,
    ).encode("utf-8")

    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.TaskRequest) + _write_str(session_id) + _write_payload(body_json),
    )


def _build_finish_session(session_id: str) -> bytes:
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.FinishSession) + _write_str(session_id) + _write_payload(b"{}"),
    )


# ── 合成结果 ──


@dataclass
class Word:
    """字级时间戳（秒，相对本次合成起点）。"""

    word: str
    start: float
    end: float
    confidence: float | None = None


@dataclass
class Synthesized:
    """一次合成的完整结果：音频 + 时长 + 字级时间戳。"""

    audio: bytes  # 线上格式字节（wav 时为已加头的完整 wav）
    fmt: str  # 期望格式（wav/mp3/…）
    sample_rate: int
    pcm_bytes: int = 0  # 纯 PCM 字节数（fmt=wav/pcm 时有效）
    words: list[Word] = field(default_factory=list)
    sentences: list[tuple[int, int]] = field(default_factory=list)  # PCM 字节区间（句）
    usage: dict | None = None
    elapsed: float = 0.0

    @property
    def duration(self) -> float | None:
        """精确时长（仅 PCM 路径可用）。"""
        if self.fmt not in ("wav", "pcm"):
            return None
        return round(self.pcm_bytes / (2 * self.sample_rate), 3)

    def write(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.audio)
        return path


def _extract_words(payload: object) -> list[Word]:
    """在 payload 中递归找出字级时间戳列表（官方字段：word/startTime/endTime/confidence）。"""
    found: list[Word] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            item = node.get("word")
            if isinstance(item, str) and ("startTime" in node or "start_time" in node):
                start = node.get("startTime", node.get("start_time"))
                end = node.get("endTime", node.get("end_time"))
                if isinstance(start, (int, float)) and isinstance(end, (int, float)):
                    conf = node.get("confidence")
                    found.append(
                        Word(
                            word=item,
                            start=float(start),
                            end=float(end),
                            confidence=float(conf) if isinstance(conf, (int, float)) else None,
                        )
                    )
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(payload)
    return found


def write_wav(path: Path, pcm: bytes, sample_rate: int, channels: int = 1, width: int = 2) -> Path:
    """把裸 PCM 包成 wav（标准库，无需 ffmpeg）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return path


# ── 连接与合成 ──


class VolcTTSConnection:
    """一条长连接，承载串行的多个合成会话。"""

    def __init__(self, api_key: str, resource_id: str = DEFAULT_RESOURCE_ID, dump_frames: bool = False):
        self._api_key = api_key
        self._resource_id = resource_id
        self._ws: ClientConnection | None = None
        self._dump = dump_frames

    @property
    def is_alive(self) -> bool:
        ws = self._ws
        if ws is None:
            return False
        try:
            from websockets.protocol import State

            return ws.state is State.OPEN
        except Exception:
            return False

    def _require_ws(self) -> ClientConnection:
        if self._ws is None or not self.is_alive:
            raise RuntimeError("TTS 连接未建立")
        return self._ws

    async def connect(self) -> None:
        headers = {
            "X-Api-Key": self._api_key,
            "X-Api-Resource-Id": self._resource_id,
            "X-Api-Connect-Id": uuid.uuid4().hex,
            "X-Control-Require-Usage-Tokens-Return": "*",
        }
        try:
            ws = await websockets.connect(
                TTS_WS_URL,
                additional_headers=headers,
                max_size=10 * 1024 * 1024,
                open_timeout=10,
            )
        except Exception as e:
            raise RuntimeError(f"TTS WebSocket 连接失败: {e}") from e
        self._ws = ws
        try:
            await ws.send(_build_start_connection())
            await self._read_and_expect(EventType.ConnectionStarted)
        except Exception:
            await self._force_close()
            raise

    async def synthesize_detailed(self, req: TTSRequest, timeout: float = 120.0) -> Synthesized:
        """合成一段文本，返回音频、精确时长与字级时间戳。"""
        self._require_ws()
        session_id = uuid.uuid4().hex
        t0 = time.monotonic()
        await self._send(_build_start_session(req, session_id))
        await self._read_and_expect(EventType.SessionStarted)
        await self._send(_build_task_request(req.text, session_id))
        await self._send(_build_finish_session(session_id))

        try:
            result = await asyncio.wait_for(self._collect(req), timeout=timeout)
        except TimeoutError:
            await self._force_close()
            raise RuntimeError(f"TTS 合成超时（{timeout:g}s）") from None
        if not result.pcm_bytes and not result.audio:
            raise RuntimeError("TTS 返回空音频")
        result.elapsed = round(time.monotonic() - t0, 3)
        return result

    async def synthesize(self, req: TTSRequest, timeout: float = 120.0) -> bytes:
        return (await self.synthesize_detailed(req, timeout=timeout)).audio

    async def _collect(self, req: TTSRequest) -> Synthesized:
        """读取一整个会话的帧，累积音频、句边界与字级时间戳。"""
        ws = self._require_ws()
        pcm = bytearray()
        words: list[Word] = []
        sentences: list[tuple[int, int]] = []
        usage: dict | None = None
        sent_start: int | None = None

        while True:
            msg = await _read_server_message(ws)
            if self._dump:
                size = len(msg.payload) if isinstance(msg.payload, (bytes, str)) else "-"
                keys = list(msg.payload) if isinstance(msg.payload, dict) else "-"
                body = repr(msg.payload)[:400] if isinstance(msg.payload, dict) else f"{size} 字节"
                log.info("帧 type=%s event=%s keys=%s payload=%s", msg.type.name, msg.event, keys, body)
            if msg.type == MsgType.FullServerResponse:
                if msg.event == EventType.TTSSentenceStart and sent_start is None:
                    sent_start = len(pcm)
                elif msg.event == EventType.TTSSentenceEnd:
                    sentences.append((sent_start or 0, len(pcm)))
                    sent_start = None
                if msg.event == EventType.SessionFinished:
                    if isinstance(msg.payload, dict):
                        u = msg.payload.get("usage")
                        usage = u if isinstance(u, dict) else usage
                    break
                if msg.event in (EventType.ConnectionFailed, EventType.SessionFailed):
                    err = msg.payload or {}
                    raise RuntimeError(f"TTS 失败：{json.dumps(err, ensure_ascii=False)[:300]}")
                if isinstance(msg.payload, dict):
                    words.extend(_extract_words(msg.payload))
                    u = msg.payload.get("usage")
                    if isinstance(u, dict):
                        usage = u
                elif isinstance(msg.payload, bytes) and msg.payload:
                    pcm.extend(msg.payload)  # 少数部署把音频放在 FullServerResponse 里
            elif msg.type == MsgType.AudioOnlyServer:
                chunk = msg.payload
                if isinstance(chunk, bytes) and chunk:
                    pcm.extend(chunk)
            elif msg.type == MsgType.Error:
                raise RuntimeError(f"TTS 错误帧：{str(msg.payload)[:300]}")

        return Synthesized(
            audio=bytes(pcm),
            fmt=req.fmt,
            sample_rate=req.sample_rate,
            pcm_bytes=len(pcm),
            words=words,
            sentences=sentences,
            usage=usage,
        )

    async def ping(self) -> None:
        await self._require_ws().ping()

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.send(_build_finish_connection())
            await _read_server_message(ws)
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass

    async def _send(self, frame: bytes) -> None:
        await self._require_ws().send(frame)

    async def _read_and_expect(self, event: EventType) -> ServerMessage:
        msg = await _read_server_message(self._require_ws())
        if msg.type == MsgType.FullServerResponse and msg.event in (
            EventType.ConnectionFailed,
            EventType.SessionFailed,
        ):
            err = msg.payload or {}
            raise RuntimeError(f"TTS 失败：{json.dumps(err, ensure_ascii=False)[:300]}")
        return msg

    async def _force_close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass


class DoubaoTTS:
    """面向批处理的封装：复用一条连接，逐段合成，失败自动重连一次。"""

    def __init__(
        self,
        api_key: str,
        resource_id: str = DEFAULT_RESOURCE_ID,
        timeout: float = 120.0,
        dump_frames: bool = False,
    ):
        if not api_key:
            raise ValueError(
                "缺少 TTS 密钥：设置 DOUBAO_TTS_API_KEY 环境变量，"
                "或在 06-仿真大赛材料/.env 内填写（见 .env.example）"
            )
        self._api_key = api_key
        self._resource_id = resource_id
        self._timeout = timeout
        self._dump = dump_frames
        self._conn: VolcTTSConnection | None = None
        self._last_usage: dict | None = None

    async def __aenter__(self) -> DoubaoTTS:
        await self._ensure_conn()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    @property
    def last_usage(self) -> dict | None:
        """最近一段合成的计费用量（字数字段为 text_words）。"""
        return self._last_usage

    async def _ensure_conn(self) -> VolcTTSConnection:
        if self._conn is None or not self._conn.is_alive:
            self._conn = VolcTTSConnection(self._api_key, self._resource_id, self._dump)
            await self._conn.connect()
        return self._conn

    async def synthesize(self, req: TTSRequest) -> Synthesized:
        """合成一段文本；连接异常时重建连接重试一次。"""
        for attempt in (1, 2):
            conn = await self._ensure_conn()
            try:
                result = await conn.synthesize_detailed(req, timeout=self._timeout)
                if req.fmt == "wav":
                    result.audio = _pcm_to_wav_bytes(result.audio, req.sample_rate)
                self._last_usage = result.usage
                return result
            except Exception:
                await conn._force_close()
                if attempt == 2:
                    raise
        raise AssertionError("unreachable")

    async def check(self, speaker: str | None = None) -> bool:
        """探活：合成“测试”两字，返回是否成功；失败原因写入日志。"""
        try:
            result = await self.synthesize(
                TTSRequest(text="测试", speaker=speaker or DEFAULT_SPEAKER, fmt="pcm")
            )
        except Exception as e:
            log.warning("TTS 探活失败：%s", e)
            return False
        log.info("TTS 探活通过（%d 字节，%ss）", result.pcm_bytes, result.duration)
        return True

    async def close(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            await conn.close()


def _pcm_to_wav_bytes(pcm: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


# ── 密钥、时长与旁白文件 ──


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


def load_api_key() -> tuple[str, str]:
    """返回 (api_key, 来源说明)。环境变量优先，其次本目录/项目根的 .env。"""
    key = os.getenv("DOUBAO_TTS_API_KEY", "").strip()
    if key:
        return key, "环境变量 DOUBAO_TTS_API_KEY"
    for path in _ENV_CANDIDATES:
        if not path.is_file():
            continue
        val = _parse_env_file(path).get("DOUBAO_TTS_API_KEY", "").strip()
        if val:
            return val, str(path)
    return "", ""


def resource_id() -> str:
    return os.getenv("DOUBAO_TTS_RESOURCE_ID", "").strip() or DEFAULT_RESOURCE_ID


def read_segments(path: Path) -> list[str]:
    """旁白脚本：每行一段；空行与 `#` 开头的行跳过。"""
    segs = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not segs:
        raise SystemExit(f"旁白脚本为空：{path}")
    return segs


def probe_duration(path: Path) -> float | None:
    """ffprobe 读取时长（秒）；无 ffprobe 或失败返回 None。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    try:
        return round(float(out.stdout.strip()), 3)
    except ValueError:
        return None


@dataclass
class SegmentResult:
    index: int
    text: str
    file: str
    bytes: int
    duration: float | None
    words: list[dict] = field(default_factory=list)
    usage: dict | None = None


async def synthesize_segments(
    tts: DoubaoTTS,
    segments: Iterable[str],
    outdir: Path,
    req_cfg: TTSRequest,
) -> list[SegmentResult]:
    """逐段合成并写盘，返回清单（含时长与字级时间戳，供字幕对齐使用）。"""
    segs = list(segments)
    outdir.mkdir(parents=True, exist_ok=True)
    results: list[SegmentResult] = []
    for i, text in enumerate(segs, 1):
        result = await tts.synthesize(replace(req_cfg, text=text))
        path = result.write(outdir / f"{i:02d}.{req_cfg.fmt}")
        results.append(
            SegmentResult(
                index=i,
                text=text,
                file=path.name,
                bytes=len(result.audio),
                duration=result.duration or probe_duration(path),
                words=[w.__dict__ for w in result.words],
                usage=result.usage,
            )
        )
        log.info("第 %d/%d 段完成：%s（%ss）", i, len(segs), path.name, results[-1].duration)
    return results


def write_manifest(results: list[SegmentResult], outdir: Path) -> Path:
    path = outdir / "manifest.json"
    path.write_text(
        json.dumps(
            {
                "segments": [r.__dict__ for r in results],
                "count": len(results),
                "total_duration": round(sum(r.duration or 0.0 for r in results), 3),
                "total_bytes": sum(r.bytes for r in results),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


# ── 命令行 ──


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="doubao_tts.py",
        description="豆包 SeedTTS 2.0 语音合成（v3 双向流式协议）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument("--text", help="直接合成一段文本")
    src.add_argument("--file", type=Path, help="旁白脚本：每行一段，批量合成")
    p.add_argument("--out", type=Path, help="单段=输出文件；批量=输出目录")
    p.add_argument("--speaker", default=DEFAULT_SPEAKER, help=f"音色，默认 {DEFAULT_SPEAKER}")
    p.add_argument("--format", choices=("wav", "mp3", "ogg_opus", "pcm"), default="wav")
    p.add_argument("--sample-rate", type=int, default=24000)
    p.add_argument("--speech-rate", type=int, default=0, help="语速 -50~100，默认 0")
    p.add_argument("--loudness-rate", type=int, default=0, help="音量 -50~100，默认 0")
    p.add_argument("--no-subtitle", action="store_true", help="不请求字级时间戳（默认请求）")
    p.add_argument("--timeout", type=float, default=120.0, help="单段合成超时秒数")
    p.add_argument("--check", action="store_true", help="探活：仅合成“测试”两字")
    p.add_argument("--list-speakers", action="store_true", help="列出内置音色库")
    p.add_argument("--dump-frames", action="store_true", help="打印服务端每个协议帧（排障用）")
    p.add_argument("-v", "--verbose", action="store_true", help="输出调试日志")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    if args.list_speakers:
        for name, voice in SPEAKER_LIBRARY.items():
            print(f"{name:14s} {voice}")
        return 0

    if sum((bool(args.check), bool(args.file), bool(args.text))) != 1:
        log.error("必须且只能给出 --text / --file / --check 之一")
        return 2

    key, origin = load_api_key()
    if not key:
        log.error(
            "未找到 TTS 密钥：设置 DOUBAO_TTS_API_KEY 环境变量，或在 %s 写入（模板见 .env.example）",
            _HERE / ".env",
        )
        return 2
    log.info("使用密钥：%s（尾 4 位 %s）", origin, key[-4:])

    req_cfg = TTSRequest(
        text="",
        speaker=args.speaker,
        speech_rate=args.speech_rate,
        loudness_rate=args.loudness_rate,
        fmt=args.format,
        sample_rate=args.sample_rate,
        enable_subtitle=not args.no_subtitle,
    )
    segments = read_segments(args.file) if args.file else []

    async def _run() -> int:
        async with DoubaoTTS(
            key, resource_id(), timeout=args.timeout, dump_frames=args.dump_frames
        ) as tts:
            if args.check:
                return 0 if await tts.check(args.speaker) else 1
            if args.file:
                outdir = args.out or args.file.with_suffix("")
                results = await synthesize_segments(tts, segments, outdir, req_cfg)
                manifest = write_manifest(results, outdir)
                log.info(
                    "完成 %d 段，总时长 %.2fs，清单：%s",
                    len(results),
                    sum(r.duration or 0.0 for r in results),
                    manifest,
                )
                return 0
            result = await tts.synthesize(replace(req_cfg, text=args.text))
            if not args.out:
                sys.stdout.buffer.write(result.audio)
                return 0
            result.write(args.out)
            log.info(
                "已写入 %s（%d 字节，%ss，字级时间戳 %d 个）",
                args.out,
                len(result.audio),
                result.duration or probe_duration(args.out),
                len(result.words),
            )
            return 0

    try:
        return asyncio.run(_run())
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        log.error("%s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
