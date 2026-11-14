#!/usr/bin/env python3
"""Receive quiet-shore VR records over HTTP and file them into SQLite.

Two surfaces live here:

* the **upload contract**, unchanged and always on: devices POST batches and
  read `/vrdata/health`. Neither needs credentials of any kind.
* a **read surface** behind a single operator password, off by default: the
  `/vrdata/admin/` JSON API and the one-page console at `/vrdata/admin/`.

The read surface only exists when `VRDATA_PASSWORD` is set in the environment.
Unset or empty means every read route answers 404 — the service is the old
write-only collector again, byte for byte. The password itself is never stored,
never logged and never echoed: only a salted hash is kept in memory long enough
to compare logins against, and the comparison is constant-time.

Wire contract, exactly:

    POST /vrdata/
      {"version":1,"deviceId":"...","records":[
         {"id":"...","kind":"questionnaire|training|experience|event",
          "occurredAt":"...","data":{...}}]}
    -> {"version":1,"acknowledged":["<id>",...],"accepted":n,
        "duplicates":n,"nextBatchSize":100}

    GET /vrdata/health
    -> {"status":"ok","version":1}

`acknowledged` always lists every id in the batch, whether a record was filed
now or is a duplicate: the sender deletes its local copy from the ACK alone, so
a partial ACK would strand records on the headset forever. The receiver is
therefore idempotent on `(device_id, record_id)` — a replayed batch files
nothing new and answers with the same ACK.

A batch is all-or-nothing during validation: one bad record rejects the whole
batch with 400 and nothing is written. Validation happens before the transaction
opens, so `accepted` and `duplicates` stay trustworthy.

Standard library only. Run it as:

    VRDATA_PASSWORD=... python3 server/vrdata_receiver.py \
        --database /var/lib/vrdata/vrdata.sqlite3

Nothing here prints record contents; logs carry only counts, route names and
error codes. Ids, payloads and query strings are never logged, and neither is
anything derived from the password.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import signal
import socketserver
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlsplit

# --------------------------------------------------------------------------
# Contract constants

VERSION = 1
MAX_BODY_BYTES = 1024 * 1024
MAX_RECORDS = 100
KINDS = frozenset({"questionnaire", "training", "experience", "event"})

SUBMIT_PATH = "/vrdata/"
HEALTH_PATH = "/vrdata/health"

# Ids are opaque to this service, but they must be storable, sortable and safe
# in a shell: printable ASCII without spaces or quotes, at most 128 chars.
ID_MAX = 128
ID_PATTERN = re.compile(r"\A[A-Za-z0-9._:\-]{1,%d}\Z" % ID_MAX)

# Timestamps are ISO 8601 instants. A value without an offset is read as UTC so
# a client that drops the `Z` still files correctly; what is kept raw is the
# original string (see `occurred_at_raw`).
TIMESTAMP_MAX = 64

# -- read surface ----------------------------------------------------------

ADMIN_ROOT = "/vrdata/admin/"
PAGE_PATH = ADMIN_ROOT
API_SESSION = ADMIN_ROOT + "api/session"
API_LOGIN = ADMIN_ROOT + "api/login"
API_LOGOUT = ADMIN_ROOT + "api/logout"
API_RECORDS = ADMIN_ROOT + "api/records"
API_FACETS = ADMIN_ROOT + "api/facets"
API_EXPORT = ADMIN_ROOT + "api/export.csv"

SESSION_COOKIE = "vrdata_session"
SESSION_TTL = 12 * 3600
PASSWORD_ENV = "VRDATA_PASSWORD"
KEY_FILE = "session.key"

# Read responses are bounded so a stray request cannot pull the table down.
PAGE_DEFAULT = 25
PAGE_MAX = 100
DETAIL_ID_MAX = 128
PAYLOAD_MAX_BYTES = 64 * 1024

# CSV export streams: one row in memory, a hard row cap so a single request
# cannot pin the worker or fill a phone's storage without consent.
EXPORT_MAX_ROWS = 50_000
EXPORT_BATCH = 500
EXPORT_COLUMNS = (
    "device_id",
    "record_id",
    "kind",
    "occurred_at",
    "occurred_at_raw",
    "received_at",
    "data_json",
)

# Login throttling: per client address, a sliding window of failures. Neither
# list grows without bound — the oldest entries are dropped first.
LOGIN_WINDOW = 300.0
LOGIN_MAX_FAILURES = 5
LOGIN_TRACKED_CLIENTS = 4096

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    device_id       TEXT    NOT NULL,
    record_id       TEXT    NOT NULL,
    kind            TEXT    NOT NULL
                    CHECK (kind IN ('questionnaire','training','experience','event')),
    occurred_at     TEXT    NOT NULL,
    occurred_at_raw TEXT    NOT NULL,
    received_at     TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    PRIMARY KEY (device_id, record_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS records_by_occurred_at
    ON records (kind, occurred_at);
"""


class BadBatch(Exception):
    """The request is malformed; the batch must not be filed."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class BadQuery(Exception):
    """A read request asks for something the API cannot answer."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class IncomingRecord:
    """One validated record, ready to insert."""

    __slots__ = ("record_id", "kind", "occurred_at", "occurred_at_raw", "payload")

    def __init__(
        self,
        record_id: str,
        kind: str,
        occurred_at: str,
        occurred_at_raw: str,
        payload: str,
    ) -> None:
        self.record_id = record_id
        self.kind = kind
        self.occurred_at = occurred_at
        self.occurred_at_raw = occurred_at_raw
        self.payload = payload


# --------------------------------------------------------------------------
# Validation


def _reject_constant(name: str) -> Any:
    raise ValueError("non-finite number %s" % name)


def parse_json(raw: bytes) -> Any:
    """Strict JSON: no NaN/Infinity, UTF-8 only, one top-level value."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise BadBatch("invalid_encoding", "body must be UTF-8") from None
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except ValueError:
        raise BadBatch("invalid_json", "body is not valid JSON") from None


def _require_str(obj: dict[str, Any], field: str) -> str:
    value = obj.get(field)
    if not isinstance(value, str):
        raise BadBatch("invalid_field", "%s must be a string" % field)
    return value


def parse_timestamp(value: str, field: str) -> tuple[str, str]:
    """Return (canonical UTC 'YYYY-MM-DDTHH:MM:SS.mmmZ', original string)."""
    if len(value) > TIMESTAMP_MAX:
        raise BadBatch("invalid_timestamp", "%s is too long" % field)
    text = value[:-1] + "+00:00" if value.endswith(("Z", "z")) else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise BadBatch("invalid_timestamp", "%s is not ISO 8601" % field) from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (utc.microsecond // 1000), value


def validate_batch(body: Any) -> tuple[str, list[IncomingRecord]]:
    """Validate every field of the batch, or raise [BadBatch].

    The whole batch is checked before the caller touches the database, so a
    single bad record leaves the table untouched.
    """
    if not isinstance(body, dict):
        raise BadBatch("invalid_body", "body must be a JSON object")

    version = body.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise BadBatch("invalid_field", "version must be an integer")
    if version != VERSION:
        raise BadBatch("unsupported_version", "version must be %d" % VERSION)

    device_id = _require_str(body, "deviceId")
    if not ID_PATTERN.match(device_id):
        raise BadBatch("invalid_field", "deviceId must match %s" % ID_PATTERN.pattern)

    raw_records = body.get("records")
    if not isinstance(raw_records, list):
        raise BadBatch("invalid_field", "records must be an array")
    if len(raw_records) > MAX_RECORDS:
        raise BadBatch("batch_too_large", "records must hold at most %d entries" % MAX_RECORDS)

    records: list[IncomingRecord] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_records):
        if not isinstance(raw, dict):
            raise BadBatch("invalid_record", "records[%d] must be an object" % index)

        record_id = _require_str(raw, "id")
        if not ID_PATTERN.match(record_id):
            raise BadBatch("invalid_record", "records[%d].id is not a valid id" % index)
        # A repeated id inside one batch is a sender bug, not a duplicate: the
        # two payloads may differ and the ACK could not say which one landed.
        if record_id in seen:
            raise BadBatch("duplicate_in_batch", "records[%d].id repeats earlier in batch" % index)
        seen.add(record_id)

        kind = _require_str(raw, "kind")
        if kind not in KINDS:
            raise BadBatch(
                "invalid_record",
                "records[%d].kind must be one of %s" % (index, ",".join(sorted(KINDS))),
            )

        occurred_at, occurred_at_raw = parse_timestamp(
            _require_str(raw, "occurredAt"), "records[%d].occurredAt" % index
        )

        if "data" not in raw:
            raise BadBatch("invalid_record", "records[%d] has no data" % index)
        # `data` is the sender's own document: stored as the JSON text it
        # arrived as, so a later schema change needs no migration here.
        payload = json.dumps(
            raw["data"], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )

        records.append(IncomingRecord(record_id, kind, occurred_at, occurred_at_raw, payload))

    return device_id, records


# --------------------------------------------------------------------------
# Read query parsing


def _utc_bound(value: str, field: str) -> str:
    """Parse a client-supplied instant into the canonical column form."""
    if len(value) > TIMESTAMP_MAX:
        raise BadQuery("invalid_timestamp", "%s is too long" % field)
    text = value[:-1] + "+00:00" if value.endswith(("Z", "z")) else value
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise BadQuery("invalid_timestamp", "%s is not ISO 8601" % field) from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (utc.microsecond // 1000)


class ReadQuery:
    """One validated read request: filters, ordering and a page window."""

    __slots__ = ("kind", "device_id", "since", "until", "limit", "offset", "order")

    def __init__(
        self,
        kind: str | None,
        device_id: str | None,
        since: str | None,
        until: str | None,
        limit: int,
        offset: int,
        order: str,
    ) -> None:
        self.kind = kind
        self.device_id = device_id
        self.since = since
        self.until = until
        self.limit = limit
        self.offset = offset
        self.order = order

    def where(self) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if self.kind is not None:
            clauses.append("kind = ?")
            params.append(self.kind)
        if self.device_id is not None:
            clauses.append("device_id = ?")
            params.append(self.device_id)
        if self.since is not None:
            clauses.append("occurred_at >= ?")
            params.append(self.since)
        if self.until is not None:
            # Inclusive upper bound: the label says "until", so a record exactly
            # on the boundary belongs to the range the operator asked for.
            clauses.append("occurred_at <= ?")
            params.append(self.until)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _single(query: dict[str, list[str]], name: str) -> str | None:
    values = query.get(name)
    if not values:
        return None
    if len(values) > 1:
        raise BadQuery("invalid_query", "%s must appear once" % name)
    value = values[0].strip()
    return value or None


def _bounded_int(query: dict[str, list[str]], name: str, default: int, low: int, high: int) -> int:
    raw = _single(query, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise BadQuery("invalid_query", "%s must be an integer" % name) from None
    if value < low or value > high:
        raise BadQuery("invalid_query", "%s must be between %d and %d" % (name, low, high))
    return value


def parse_read_query(raw_query: str) -> ReadQuery:
    """Turn a query string into a bounded, validated read request."""
    query = parse_qs(raw_query, keep_blank_values=True, max_num_fields=16)

    kind = _single(query, "kind")
    if kind is not None and kind not in KINDS:
        raise BadQuery("invalid_query", "kind must be one of %s" % ",".join(sorted(KINDS)))

    device_id = _single(query, "device")
    if device_id is not None and not ID_PATTERN.match(device_id):
        raise BadQuery("invalid_query", "device must match %s" % ID_PATTERN.pattern)

    since = _single(query, "since")
    until = _single(query, "until")
    since_bound = _utc_bound(since, "since") if since is not None else None
    until_bound = _utc_bound(until, "until") if until is not None else None
    if since_bound is not None and until_bound is not None and since_bound > until_bound:
        raise BadQuery("invalid_query", "since must not be after until")

    order = (_single(query, "order") or "desc").lower()
    if order not in ("asc", "desc"):
        raise BadQuery("invalid_query", "order must be asc or desc")

    return ReadQuery(
        kind=kind,
        device_id=device_id,
        since=since_bound,
        until=until_bound,
        limit=_bounded_int(query, "limit", PAGE_DEFAULT, 1, PAGE_MAX),
        # Offset is capped so a deep page cannot make SQLite walk the table.
        offset=_bounded_int(query, "offset", 0, 0, 1_000_000),
        order=order,
    )


def _csv_field(value: Any) -> str:
    """One CSV field, quoted per RFC 4180 and guarded against formula injection.

    A spreadsheet treats a cell starting with `= + - @`, a tab or a carriage
    return as a formula. Record ids allow `-` and payloads are sender-chosen
    text, so a record could otherwise run `=HYPERLINK(...)` on the operator's
    machine when they open the export. Prefixing with a single quote keeps the
    text visible and inert. Numeric columns are written by us and never routed
    through here, so the guard cannot corrupt them.
    """
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    # RFC 4180 quoting: separator, quote and any line break (CR or LF) force
    # quotes. The guard prefix is written before this, so a prefixed tab or CR
    # no longer starts the field and needs no extra quoting of its own.
    if any(ch in text for ch in ('"', ",", "\n", "\r")):
        return '"' + text.replace('"', '""') + '"'
    return text


def csv_header() -> str:
    return ",".join(EXPORT_COLUMNS) + "\r\n"


def csv_row(
    device_id: str,
    record_id: str,
    kind: str,
    occurred_at: str,
    occurred_at_raw: str,
    received_at: str,
    payload: str,
) -> str:
    return ",".join(
        _csv_field(value)
        for value in (device_id, record_id, kind, occurred_at, occurred_at_raw, received_at, payload)
    ) + "\r\n"


# --------------------------------------------------------------------------
# Storage


def now_utc() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (moment.microsecond // 1000)


class Store:
    """One SQLite file, WAL mode, one short transaction per batch."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    def open(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        try:
            connection.executescript(SCHEMA)
        finally:
            connection.close()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._path, timeout=15.0, isolation_level=None
        )
        connection.execute("PRAGMA journal_mode=WAL")
        # NORMAL is the right durability for a batch receiver: a crash can lose
        # the tail of the WAL but never a committed-and-ACKed batch that the
        # sender has already deleted.
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    def file_batch(
        self, device_id: str, records: Iterable[IncomingRecord]
    ) -> tuple[int, int]:
        """Insert a batch; return (accepted, duplicates).

        Both counts come from one transaction, so a batch that races its own
        retry cannot report an id as both new and duplicate.
        """
        accepted = 0
        duplicates = 0
        received_at = now_utc()
        with self._lock:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    for record in records:
                        cursor = connection.execute(
                            "INSERT INTO records ("
                            " device_id, record_id, kind, occurred_at,"
                            " occurred_at_raw, received_at, payload"
                            ") VALUES (?, ?, ?, ?, ?, ?, ?)"
                            " ON CONFLICT (device_id, record_id) DO NOTHING",
                            (
                                device_id,
                                record.record_id,
                                record.kind,
                                record.occurred_at,
                                record.occurred_at_raw,
                                received_at,
                                record.payload,
                            ),
                        )
                        if cursor.rowcount == 1:
                            accepted += 1
                        else:
                            duplicates += 1
                    connection.execute("COMMIT")
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
            finally:
                connection.close()
        return accepted, duplicates

    # -- read side -----------------------------------------------------
    #
    # Read-only connections: the console must not be able to write, and
    # `mode=ro` makes that a SQLite-level guarantee rather than a convention.

    def _connect_read_only(self) -> sqlite3.Connection:
        uri = "file:%s?mode=ro" % self._path.resolve().as_posix()
        connection = sqlite3.connect(uri, uri=True, timeout=10.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def page(self, query: ReadQuery) -> dict[str, Any]:
        """One bounded page of metadata plus the total matching the filter.

        `payload` is deliberately not selected here: the list stays small no
        matter how large an individual record is.
        """
        where, params = query.where()
        direction = "DESC" if query.order == "desc" else "ASC"
        with self._lock:
            connection = self._connect_read_only()
            try:
                total = connection.execute(
                    "SELECT count(*) FROM records" + where, params
                ).fetchone()[0]
                rows = connection.execute(
                    "SELECT device_id, record_id, kind, occurred_at, occurred_at_raw,"
                    " received_at, length(payload) AS payload_bytes"
                    " FROM records" + where +
                    # rowid does not exist on a WITHOUT ROWID table, so the
                    # primary key breaks ties and pages stay stable.
                    " ORDER BY occurred_at %s, device_id %s, record_id %s"
                    " LIMIT ? OFFSET ?" % (direction, direction, direction),
                    params + [query.limit, query.offset],
                ).fetchall()
            finally:
                connection.close()
        return {
            "total": total,
            "limit": query.limit,
            "offset": query.offset,
            "order": query.order,
            "records": [
                {
                    "deviceId": row["device_id"],
                    "recordId": row["record_id"],
                    "kind": row["kind"],
                    "occurredAt": row["occurred_at"],
                    "occurredAtRaw": row["occurred_at_raw"],
                    "receivedAt": row["received_at"],
                    "payloadBytes": row["payload_bytes"],
                }
                for row in rows
            ],
        }

    def export_rows(self, query: ReadQuery, max_rows: int = EXPORT_MAX_ROWS):
        """Yield CSV lines for the filtered set, one SQLite batch at a time.

        Memory stays flat: the cursor is refetched in `EXPORT_BATCH` windows and
        each line is yielded before the next is built. Capping at `max_rows`
        keeps one request from streaming the whole table to an untrusted
        client; the caller reports the truncation in a trailer comment.
        """
        where, params = query.where()
        direction = "DESC" if query.order == "desc" else "ASC"
        emitted = 0
        cursor_offset = query.offset
        # The export always walks from this offset, ignoring `limit`: a paged
        # table export means "everything matching what I am looking at".
        with self._lock:
            connection = self._connect_read_only()
            try:
                while emitted < max_rows:
                    rows = connection.execute(
                        "SELECT device_id, record_id, kind, occurred_at, occurred_at_raw,"
                        " received_at, payload FROM records" + where +
                        " ORDER BY occurred_at %s, device_id %s, record_id %s"
                        " LIMIT ? OFFSET ?" % (direction, direction, direction),
                        params + [min(EXPORT_BATCH, max_rows - emitted), cursor_offset],
                    ).fetchall()
                    if not rows:
                        break
                    for row in rows:
                        yield csv_row(
                            row["device_id"],
                            row["record_id"],
                            row["kind"],
                            row["occurred_at"],
                            row["occurred_at_raw"],
                            row["received_at"],
                            row["payload"],
                        )
                    emitted += len(rows)
                    cursor_offset += len(rows)
            finally:
                connection.close()

    def count_matching(self, query: ReadQuery) -> int:
        where, params = query.where()
        with self._lock:
            connection = self._connect_read_only()
            try:
                return connection.execute(
                    "SELECT count(*) FROM records" + where, params
                ).fetchone()[0]
            finally:
                connection.close()

    def detail(self, device_id: str, record_id: str) -> dict[str, Any] | None:
        """One record with its payload parsed, or None.

        The payload is returned as JSON rather than as text so the console can
        render it without a second parse, and an oversized payload is truncated
        to a label instead of filling the response.
        """
        with self._lock:
            connection = self._connect_read_only()
            try:
                row = connection.execute(
                    "SELECT device_id, record_id, kind, occurred_at, occurred_at_raw,"
                    " received_at, length(payload) AS payload_bytes, payload"
                    " FROM records WHERE device_id = ? AND record_id = ?",
                    (device_id, record_id),
                ).fetchone()
            finally:
                connection.close()
        if row is None:
            return None
        body: dict[str, Any] = {
            "deviceId": row["device_id"],
            "recordId": row["record_id"],
            "kind": row["kind"],
            "occurredAt": row["occurred_at"],
            "occurredAtRaw": row["occurred_at_raw"],
            "receivedAt": row["received_at"],
            "payloadBytes": row["payload_bytes"],
        }
        if row["payload_bytes"] > PAYLOAD_MAX_BYTES:
            body["truncated"] = True
            body["data"] = None
            return body
        try:
            body["data"] = json.loads(row["payload"])
        except ValueError:
            # Stored text that no longer parses is still evidence: show it raw
            # rather than pretending the record is empty.
            body["truncated"] = False
            body["data"] = row["payload"]
            body["undecodable"] = True
        return body

    def facets(self) -> dict[str, Any]:
        """Counts per kind, per device and in total, for the console header."""
        with self._lock:
            connection = self._connect_read_only()
            try:
                by_kind = {
                    row["kind"]: row["n"]
                    for row in connection.execute(
                        "SELECT kind, count(*) AS n FROM records GROUP BY kind"
                    )
                }
                by_device = [
                    {"deviceId": row["device_id"], "count": row["n"], "lastSeen": row["last"]}
                    for row in connection.execute(
                        "SELECT device_id, count(*) AS n, max(received_at) AS last"
                        " FROM records GROUP BY device_id ORDER BY n DESC, device_id LIMIT 100"
                    )
                ]
                span = connection.execute(
                    "SELECT count(*) AS n, min(occurred_at) AS first, max(occurred_at) AS last"
                    " FROM records"
                ).fetchone()
            finally:
                connection.close()
        return {
            # Every kind is present, zero when unused: the console renders a
            # fixed four-column summary instead of a shape that changes.
            "byKind": {kind: by_kind.get(kind, 0) for kind in sorted(KINDS)},
            "byDevice": by_device,
            "total": span["n"],
            "firstOccurredAt": span["first"],
            "lastOccurredAt": span["last"],
        }


# --------------------------------------------------------------------------
# Sessions


class Auth:
    """Password check, session signing and login throttling.

    The password arrives once, from the environment, and is reduced to a salted
    digest immediately. Nothing here can print it, store it or return it.
    """

    def __init__(self, password: str, key_path: Path | None) -> None:
        self._salt = secrets.token_bytes(16)
        self._digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), self._salt, 60_000)
        self._issued = time.time()
        # Persisting the key means a restart does not sign every operator out;
        # an ephemeral process (tests, a laptop run) passes key_path=None.
        self._key = self._load_or_create_key(key_path) if key_path is not None else secrets.token_bytes(32)
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        # Tokens signed out during their lifetime. A stateless token cannot be
        # withdrawn any other way, and "logout" that leaves the cookie valid is
        # a lie: the browser copy is not the only copy (bfcache, a second tab,
        # a token copied from devtools all outlive the clearing response).
        self._revoked: dict[str, float] = {}

    @staticmethod
    def _load_or_create_key(path: Path) -> bytes:
        try:
            existing = path.read_bytes()
            if len(existing) >= 32:
                return existing
        except FileNotFoundError:
            pass
        key = secrets.token_bytes(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 0600 from the first byte: the key is never a moment world-readable.
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(descriptor, key)
        finally:
            os.close(descriptor)
        os.chmod(path, 0o600)
        return key

    # -- password -------------------------------------------------------

    def check_password(self, candidate: str) -> bool:
        """Constant-time comparison against the stored digest."""
        digest = hashlib.pbkdf2_hmac(
            "sha256", candidate.encode("utf-8"), self._salt, 60_000
        )
        return hmac.compare_digest(digest, self._digest)

    # -- throttling -----------------------------------------------------

    def throttled(self, client: str) -> bool:
        """True when this client has failed too often inside the window."""
        cutoff = time.time() - LOGIN_WINDOW
        with self._lock:
            seen = [stamp for stamp in self._failures.get(client, ()) if stamp > cutoff]
            if seen:
                self._failures[client] = seen
            else:
                self._failures.pop(client, None)
            return len(seen) >= LOGIN_MAX_FAILURES

    def record_failure(self, client: str) -> None:
        cutoff = time.time() - LOGIN_WINDOW
        with self._lock:
            seen = [stamp for stamp in self._failures.get(client, ()) if stamp > cutoff]
            seen.append(time.time())
            self._failures[client] = seen
            # Bound the map itself: an attacker rotating source addresses must
            # not be able to grow it into a memory leak.
            if len(self._failures) > LOGIN_TRACKED_CLIENTS:
                for stale in sorted(self._failures, key=lambda key: self._failures[key][-1])[
                    : len(self._failures) - LOGIN_TRACKED_CLIENTS
                ]:
                    del self._failures[stale]

    def clear_failures(self, client: str) -> None:
        with self._lock:
            self._failures.pop(client, None)

    # -- session tokens -------------------------------------------------

    def issue(self) -> str:
        """`<nonce>.<expiry>.<mac>`: opaque, tamper-evident, no state on disk."""
        nonce = secrets.token_urlsafe(18)
        expires = str(int(time.time()) + SESSION_TTL)
        return "%s.%s.%s" % (nonce, expires, self._sign(nonce, expires))

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        parts = token.split(".")
        if len(parts) != 3:
            return False
        nonce, expires, mac = parts
        if not hmac.compare_digest(mac, self._sign(nonce, expires)):
            return False
        try:
            deadline = int(expires)
        except ValueError:
            return False
        if deadline <= time.time():
            return False
        with self._lock:
            if nonce in self._revoked:
                return False
        return True

    def revoke(self, token: str | None) -> None:
        """Sign one token out for the rest of its life."""
        if not token:
            return
        nonce = token.split(".", 1)[0]
        if not nonce:
            return
        now = time.time()
        with self._lock:
            # Prune first: a revoked entry is only needed until its own expiry,
            # so the map cannot grow past one session window of logouts.
            for stale in [key for key, until in self._revoked.items() if until <= now]:
                del self._revoked[stale]
            self._revoked[nonce] = now + SESSION_TTL

    def _sign(self, nonce: str, expires: str) -> str:
        message = ("%s.%s.%d" % (nonce, expires, int(self._issued))).encode("utf-8")
        # The vintage is part of the message, so rotating the process key also
        # invalidates tokens signed before the rotation.
        return hmac.new(self._key, message, hashlib.sha256).hexdigest()[:32]


# --------------------------------------------------------------------------
# The console page
#
# A separate file next to this module rather than a string literal: it is HTML
# with its own CSS and JS, and burying it in Python makes it neither readable
# nor reviewable. `write` it once at startup so a request never touches disk.

PAGE_FILE = Path(__file__).resolve().parent / "vrdata_admin.html"


def load_page(path: Path = PAGE_FILE) -> bytes:
    try:
        return path.read_bytes()
    except OSError as failure:
        # Without the page the read surface would answer 200 with an empty
        # document; refusing to start is honest and obvious instead.
        raise SystemExit("vrdata: cannot read %s (%s)" % (path, type(failure).__name__))


PAGE_HTML = load_page() if PAGE_FILE.exists() else b""


# --------------------------------------------------------------------------
# HTTP


def _error(code: str, message: str) -> dict[str, Any]:
    return {"version": VERSION, "error": {"code": code, "message": message}}


def _dump(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class VrdataHandler(http.server.BaseHTTPRequestHandler):
    """Upload routes always; read routes only when a password is configured."""

    protocol_version = "HTTP/1.1"
    server_version = "vrdata"
    sys_version = ""
    timeout = 20

    store: Store  # injected by make_server
    auth: Auth | None  # injected by make_server; None disables the read surface
    page: bytes  # injected by make_server; the console HTML

    # -- helpers --------------------------------------------------------

    def _common_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")

    def _send(self, status: int, payload: Any) -> None:
        body = _dump(payload)
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._common_headers()
            self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The sender hung up before reading the answer. The write committed;
            # its retry will be answered as duplicates.
            self.close_connection = True

    def _send_raw(
        self,
        status: int,
        body: bytes,
        content_type: str,
        extra_headers: Iterable[tuple[str, str]] = (),
    ) -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self._common_headers()
            for name, value in extra_headers:
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD" and status != 204 and status != 304:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _send_empty(self, status: int, allow: str | None = None) -> None:
        """404/405 carry no body: nothing about the service leaks through them."""
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if allow is not None:
            self.send_header("Allow", allow)
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()

    def _route(self) -> str:
        """Path only, query dropped: `/vrdata/?x` is still the submit endpoint."""
        return urlsplit(self.path).path

    def _query(self) -> str:
        return urlsplit(self.path).query

    def _read_body(self) -> bytes:
        declared = self.headers.get("Content-Length")
        if declared is None:
            self.close_connection = True
            raise BadBatch("length_required", "Content-Length is required")
        try:
            length = int(declared)
        except ValueError:
            self.close_connection = True
            raise BadBatch("invalid_length", "Content-Length is not a number") from None
        if length < 0:
            self.close_connection = True
            raise BadBatch("invalid_length", "Content-Length is negative")
        if length > MAX_BODY_BYTES:
            # Do not drain an oversized body: close instead of buffering it.
            self.close_connection = True
            raise BadBatch("body_too_large", "body exceeds %d bytes" % MAX_BODY_BYTES)
        body = self.rfile.read(length)
        if len(body) != length:
            self.close_connection = True
            raise BadBatch("incomplete_body", "body ended early")
        return body

    # -- sessions -------------------------------------------------------

    def _session_token(self) -> str | None:
        for header in self.headers.get_all("Cookie") or ():
            for part in header.split(";"):
                name, _, value = part.strip().partition("=")
                if name == SESSION_COOKIE:
                    return value.strip() or None
        return None

    def _authorised(self) -> bool:
        auth = self.auth
        return auth is not None and auth.valid(self._session_token())

    def _requires_login(self, code: str = "unauthenticated") -> None:
        self._send(401, _error(code, "sign in to read records"))

    def _cookie_header(self, token: str, max_age: int, secure: bool) -> tuple[str, str]:
        parts = [
            "%s=%s" % (SESSION_COOKIE, token) if token else "%s=" % SESSION_COOKIE,
            "Path=%s" % ADMIN_ROOT,
            "HttpOnly",
            "SameSite=Strict",
            "Max-Age=%d" % max_age,
        ]
        if secure:
            parts.append("Secure")
        return ("Set-Cookie", "; ".join(parts))

    def _is_secure(self) -> bool:
        """Behind the nginx TLS terminator, the cookie still gets Secure.

        `X-Forwarded-Proto` is set by the bundled nginx config; when the proxy
        is absent the direct loopback connection counts as plain.
        """
        forwarded = (self.headers.get("X-Forwarded-Proto") or "").split(",", 1)[0].strip().lower()
        return forwarded == "https"

    # -- routes: upload (always) ---------------------------------------

    def do_POST(self) -> None:  # noqa: N802 (http.server naming)
        route = self._route()
        if route == API_LOGIN:
            self._post_login()
            return
        if route == API_LOGOUT:
            self._post_logout()
            return
        if route != SUBMIT_PATH:
            self._reject_other_paths()
            return

        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.close_connection = True
            self._send(415, _error("unsupported_media_type", "Content-Type must be application/json"))
            return

        try:
            body = self._read_body()
            device_id, records = validate_batch(parse_json(body))
        except BadBatch as rejection:
            self._send(400, _error(rejection.code, rejection.message))
            return

        try:
            accepted, duplicates = self.store.file_batch(device_id, records)
        except sqlite3.Error as failure:
            log("write failed: %s" % type(failure).__name__)
            self._send(503, _error("storage_unavailable", "record store is unavailable"))
            return

        self._send(
            200,
            {
                "version": VERSION,
                # Every id, new or duplicate: the sender clears local state on
                # this list alone.
                "acknowledged": [record.record_id for record in records],
                "accepted": accepted,
                "duplicates": duplicates,
                "nextBatchSize": MAX_RECORDS,
            },
        )

    def _post_login(self) -> None:
        auth = self.auth
        if auth is None:
            # No password configured: the read surface does not exist, and
            # neither does its login. Drain the body first so a kept-alive
            # connection is not left with unread bytes.
            try:
                self._read_body()
            except BadBatch:
                pass
            self._send_empty(404)
            return

        client = self.client_address[0]
        if auth.throttled(client):
            # Drain first: answering 429 with the body unread leaves bytes that
            # the next request on this connection would parse as its own.
            try:
                self._read_body()
            except BadBatch:
                pass
            log("login throttled")
            self._send(
                429,
                _error("too_many_attempts", "too many failed attempts, wait a few minutes"),
            )
            return

        try:
            body = self._read_body()
        except BadBatch as rejection:
            self._send(400, _error(rejection.code, rejection.message))
            return

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._send(400, _error("invalid_json", "body is not valid JSON"))
            return
        candidate = payload.get("password") if isinstance(payload, dict) else None
        if not isinstance(candidate, str) or not candidate:
            self._send(400, _error("invalid_field", "password must be a non-empty string"))
            return

        if not auth.check_password(candidate):
            auth.record_failure(client)
            # Deliberately the same shape and status as an unauthenticated
            # read: a stranger learns nothing about which guess was close.
            log("login rejected")
            self._send(401, _error("invalid_credentials", "password is not correct"))
            return

        auth.clear_failures(client)
        token = auth.issue()
        log("login accepted")
        self._send_raw(
            200,
            _dump({"authenticated": True, "expiresIn": SESSION_TTL}),
            "application/json; charset=utf-8",
            [self._cookie_header(token, SESSION_TTL, self._is_secure())],
        )

    def _post_logout(self) -> None:
        auth = self.auth
        if auth is None:
            self._send_empty(404)
            return
        # Consume the body even though logout ignores it: an unread body on a
        # kept-alive connection is parsed as the next request line.
        try:
            self._read_body()
        except BadBatch:
            pass
        auth.revoke(self._session_token())
        log("logout")
        # Expire the cookie in the browser as well as revoking it server-side:
        # a token is stateless, so both copies have to be retired.
        self._send_raw(
            200,
            _dump({"authenticated": False}),
            "application/json; charset=utf-8",
            [self._cookie_header("", 0, self._is_secure())],
        )

    def do_GET(self) -> None:  # noqa: N802
        route = self._route()
        if route == HEALTH_PATH:
            # Status only: no record counts, no data, no device list.
            self._send(200, {"status": "ok", "version": VERSION})
            return
        if route == SUBMIT_PATH:
            self._send_empty(405, allow="POST")
            return
        if route == PAGE_PATH or route == API_SESSION or route.startswith(ADMIN_ROOT):
            self._get_admin(route)
            return
        self._send_empty(404)

    def _get_admin(self, route: str) -> None:
        if self.auth is None:
            self._send_empty(404)
            return

        if route == PAGE_PATH:
            # The shell is public: it is the login form. It contains no data
            # and reveals nothing beyond "this service has a console".
            self._send_raw(
                200,
                self.page,
                "text/html; charset=utf-8",
                [
                    (
                        "Content-Security-Policy",
                        "default-src 'none'; script-src 'unsafe-inline'; "
                        "style-src 'unsafe-inline'; img-src data:; "
                        "connect-src 'self'; form-action 'none'; "
                        "base-uri 'none'; frame-ancestors 'none'",
                    ),
                    # The console is authenticated content; never let a proxy
                    # or the bfcache hand it to the next person on the machine.
                    ("Cache-Control", "no-store, must-revalidate"),
                ],
            )
            return

        if not self._authorised():
            self._requires_login()
            return

        if route == API_SESSION:
            self._send(200, {"authenticated": True, "expiresIn": SESSION_TTL})
            return

        if route == API_FACETS:
            self._send(200, self.store.facets())
            return

        if route == API_RECORDS:
            try:
                query = parse_read_query(self._query())
            except BadQuery as rejection:
                self._send(400, _error(rejection.code, rejection.message))
                return
            try:
                self._send(200, self.store.page(query))
            except sqlite3.Error as failure:
                log("read failed: %s" % type(failure).__name__)
                self._send(503, _error("storage_unavailable", "record store is unavailable"))
            return

        if route == API_EXPORT:
            self._get_export()
            return

        if route.startswith(API_RECORDS + "/"):
            self._get_detail(route[len(API_RECORDS) + 1:])
            return

        self._send_empty(404)

    def _get_export(self) -> None:
        """Stream the filtered set as CSV, same filters as the table.

        `limit` is ignored on purpose: the operator is exporting what the
        filter selects, not the page they happen to be on. `offset` is honoured
        so a resumed export can skip what was already delivered.
        """
        try:
            query = parse_read_query(self._query())
        except BadQuery as rejection:
            self._send(400, _error(rejection.code, rejection.message))
            return

        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        filename = "vrdata-%s.csv" % stamp
        try:
            total = self.store.count_matching(query)
        except sqlite3.Error as failure:
            log("export failed: %s" % type(failure).__name__)
            self._send(503, _error("storage_unavailable", "record store is unavailable"))
            return
        if total > EXPORT_MAX_ROWS:
            # Refusing beats silently truncating: a partial file that looks
            # complete is worse than an error that says "narrow the filter".
            self._send(
                413,
                _error(
                    "export_too_large",
                    "export matches %d rows, limit is %d: narrow the filter"
                    % (total, EXPORT_MAX_ROWS),
                ),
            )
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        # Chunked, because the size is not known until the walk finishes; the
        # browser and curl both accept it, and it keeps memory flat.
        self.send_header("Transfer-Encoding", "chunked")
        self._common_headers()
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.send_header(
            "Content-Disposition",
            'attachment; filename="%s"' % filename,
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()

        chunks = 0
        try:
            # UTF-8 BOM so Excel opens the Chinese text without mojibake. No
            # filter comment line: an empty export must still be a valid file
            # with just a header, and comments are not part of RFC 4180.
            self._write_chunk("\ufeff" + csv_header())
            chunks = 1
            for line in self.store.export_rows(query):
                self._write_chunk(line)
                chunks += 1
            self._write_chunk("")  # terminating zero-length chunk
        except (BrokenPipeError, ConnectionResetError):
            # The client navigated away mid-download; nothing to recover.
            self.close_connection = True
            log("export interrupted after %d rows" % (chunks - 1))
            return
        except sqlite3.Error as failure:
            # Headers are already sent, so the only honest signal left is to
            # cut the connection: a truncated file must not look complete.
            self.close_connection = True
            log("export failed mid-stream: %s" % type(failure).__name__)
            return
        log("export served %d rows" % (chunks - 1))

    def _write_chunk(self, text: str) -> None:
        body = text.encode("utf-8")
        self.wfile.write(b"%x\r\n" % len(body) + body + b"\r\n")
        self.wfile.flush()


    def _get_detail(self, path: str) -> None:
        """`/vrdata/admin/api/records/<device>/<record>` — one record."""
        parts = path.split("/")
        if len(parts) != 2 or not all(ID_PATTERN.match(part) for part in parts):
            self._send_empty(404)
            return
        device_id, record_id = parts
        try:
            record = self.store.detail(device_id, record_id)
        except sqlite3.Error as failure:
            log("read failed: %s" % type(failure).__name__)
            self._send(503, _error("storage_unavailable", "record store is unavailable"))
            return
        if record is None:
            self._send(404, _error("not_found", "no such record"))
            return
        self._send(200, record)

    def do_HEAD(self) -> None:  # noqa: N802
        route = self._route()
        if route == HEALTH_PATH:
            self._send(200, {"status": "ok", "version": VERSION})
            return
        self._send_empty(404)

    def _drain_body(self) -> None:
        """Consume a body we are not going to use.

        http.server keeps the connection alive after a 404/405. Any unread
        bytes of the request body would then be parsed as the next request
        line, corrupting the connection for the next legitimate call.
        """
        try:
            self._read_body()
        except BadBatch:
            # A refused or oversized body cannot be consumed; `_read_body`
            # already marked the connection for closing in that case.
            pass

    def _reject_other_paths(self) -> None:
        route = self._route()
        if route == HEALTH_PATH:
            self._drain_body()
            self._send_empty(405, allow="GET, HEAD")
        elif route == PAGE_PATH:
            self._drain_body()
            self._send_empty(405, allow="GET")
        elif route in (API_SESSION, API_FACETS, API_RECORDS, API_EXPORT) or route.startswith(API_RECORDS + "/"):
            self._drain_body()
            self._send_empty(405, allow="GET, HEAD" if route == API_SESSION else "GET")
        else:
            # Also drain for 404s: telling an unknown path apart by whether the
            # connection survived would leak which paths exist.
            self._drain_body()
            self._send_empty(404)

    def do_PUT(self) -> None:  # noqa: N802
        self._reject_other_paths()

    def do_PATCH(self) -> None:  # noqa: N802
        self._reject_other_paths()

    def do_DELETE(self) -> None:  # noqa: N802
        self._reject_other_paths()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._reject_other_paths()

    # -- logging --------------------------------------------------------

    def log_request(self, code: Any = "-", size: Any = "-") -> None:
        """Method and path only — never the body, never a query string."""
        log("%s %s %s %s" % (self.command or "-", self._route() or "-", code, size))

    def log_error(self, format: str, *args: Any) -> None:  # noqa: A002
        log("bad request from %s: %s" % (self.client_address[0], format % args))


class VrdataServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32


def log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sys.stderr.write("%s vrdata %s\n" % (stamp, message))
    sys.stderr.flush()


def make_server(
    host: str,
    port: int,
    database: Path,
    password: str | None = None,
    key_path: Path | None = None,
) -> VrdataServer:
    store = Store(database)
    store.open()
    auth: Auth | None = None
    if password:
        if key_path is None:
            key_path = database.parent / KEY_FILE
        if not PAGE_HTML:
            raise SystemExit("vrdata: %s is required for the read console" % PAGE_FILE)
        auth = Auth(password, key_path)
    handler = type(
        "BoundVrdataHandler",
        (VrdataHandler,),
        {"store": store, "auth": auth, "page": PAGE_HTML},
    )
    log(
        "listening on %s:%d, database %s, read console %s"
        % (host, port, database, "enabled" if auth is not None else "disabled")
    )
    return VrdataServer((host, port), handler)


# --------------------------------------------------------------------------
# CLI


def main(argv: list[str] | None = None) -> int:
    default_database = os.environ.get("VRDATA_DATABASE") or "vrdata.sqlite3"
    parser = argparse.ArgumentParser(
        description="Receiver for quiet-shore VR records, with a password-gated read console.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8197, help="bind port (default 8197)")
    parser.add_argument(
        "--database",
        default=default_database,
        help="SQLite file (default $VRDATA_DATABASE or ./vrdata.sqlite3)",
    )
    parser.add_argument(
        "--key-file",
        default=None,
        help="session signing key (default $VRDATA_SESSION_KEY_FILE or <database dir>/session.key)",
    )
    args = parser.parse_args(argv)

    # The password exists only as a process environment value: no flag, no
    # file, no default. Without it the read surface stays off entirely.
    password = os.environ.get(PASSWORD_ENV) or None
    key_path = Path(
        args.key_file
        or os.environ.get("VRDATA_SESSION_KEY_FILE")
        or (Path(args.database).parent / KEY_FILE)
    )

    server = make_server(args.host, args.port, Path(args.database), password, key_path)

    def stop(signum: int, _frame: Any) -> None:
        log("signal %d, stopping" % signum)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
