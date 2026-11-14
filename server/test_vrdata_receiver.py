#!/usr/bin/env python3
"""Tests for the vrdata receiver: real SQLite file, real loopback HTTP.

    python3 -m unittest discover -s server -p 'test_*.py' -v

Each test builds a throwaway database in a temporary directory, starts the
receiver on an ephemeral loopback port in a background thread, and talks to it
with `http.client` — the same path the tablet's sender takes. Assertions read the
database directly (that is the operator's view, over SSH), never over HTTP.
"""

from __future__ import annotations

import csv
import http.client
import io
import json
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import vrdata_receiver as receiver  # noqa: E402

# The operator password is never a real secret in a test: it lives here as a
# fixture value, and the receiver only ever reads it from the environment in
# production (`main()`), never from this constant.
TEST_PASSWORD = "fixture-password"


def record(record_id: str, kind: str = "questionnaire", **data: Any) -> dict[str, Any]:
    return {
        "id": record_id,
        "kind": kind,
        "occurredAt": "2026-11-14T09:30:00.000Z",
        "data": data or {"answers": [1, 0, 3]},
    }


def batch(*records: dict[str, Any], device_id: str = "tablet-01", version: int = 1) -> dict[str, Any]:
    return {"version": version, "deviceId": device_id, "records": list(records)}


class ReceiverCase(unittest.TestCase):
    """Starts one receiver per test against a fresh database.

    The read console is off unless a subclass sets [password], which is the
    production default: no `VRDATA_PASSWORD`, no read surface.
    """

    password: str | None = None

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.database = Path(self._tmp.name) / "nested" / "vrdata.sqlite3"
        self.key_path = Path(self._tmp.name) / "nested" / "session.key"
        self.server = receiver.make_server(
            "127.0.0.1", 0, self.database, self.password, self.key_path
        )
        self.port = self.server.server_address[1]
        self._thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05})
        self._thread.daemon = True
        self._thread.start()
        self.addCleanup(self._stop)

    def _stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self._thread.join(timeout=5)

    # -- transport ------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post_json(
        self, payload: Any, *, path: str = "/vrdata/", raw: bytes | None = None
    ) -> tuple[int, dict[str, Any]]:
        body = raw if raw is not None else json.dumps(payload).encode("utf-8")
        status, _, data = self.request(
            "POST", path, body, {"Content-Type": "application/json"}
        )
        return status, (json.loads(data) if data else {})

    # -- database -------------------------------------------------------

    def rows(self) -> list[sqlite3.Row]:
        connection = sqlite3.connect(self.database)
        connection.row_factory = sqlite3.Row
        try:
            return list(connection.execute("SELECT * FROM records ORDER BY record_id"))
        finally:
            connection.close()

    def count(self) -> int:
        return len(self.rows())

    # -- read console ---------------------------------------------------

    def session_cookie(self, password: str = TEST_PASSWORD) -> str:
        """Log in and return the cookie to send back, or fail the test."""
        status, headers, body = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": password}).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200, body)
        cookie = headers.get("Set-Cookie", "")
        self.assertTrue(cookie, "login must set a session cookie")
        return cookie.split(";", 1)[0]

    def get_json(
        self, path: str, cookie: str | None = None
    ) -> tuple[int, dict[str, Any], dict[str, str]]:
        headers = {"Cookie": cookie} if cookie else {}
        status, response_headers, body = self.request("GET", path, None, headers)
        return status, (json.loads(body) if body else {}), response_headers


class FirstBatchTest(ReceiverCase):
    def test_files_every_record_and_acks_all_ids(self) -> None:
        payload = batch(
            record("r-1", "questionnaire", answers=[1, 2]),
            record("r-2", "training", sessionSec=120),
            record("r-3", "experience", note="ok"),
            record("r-4", "event", name="scene:shore"),
        )

        status, body = self.post_json(payload)

        self.assertEqual(status, 200)
        self.assertEqual(body["version"], 1)
        self.assertEqual(body["acknowledged"], ["r-1", "r-2", "r-3", "r-4"])
        self.assertEqual(body["accepted"], 4)
        self.assertEqual(body["duplicates"], 0)
        self.assertEqual(body["nextBatchSize"], 100)

        rows = self.rows()
        self.assertEqual([row["record_id"] for row in rows], ["r-1", "r-2", "r-3", "r-4"])
        self.assertEqual({row["device_id"] for row in rows}, {"tablet-01"})
        self.assertEqual(rows[0]["kind"], "questionnaire")
        # `data` is kept as JSON text, verbatim in content.
        self.assertEqual(json.loads(rows[0]["payload"]), {"answers": [1, 2]})
        self.assertEqual(json.loads(rows[1]["payload"]), {"sessionSec": 120})
        self.assertEqual(rows[0]["occurred_at"], "2026-11-14T09:30:00.000Z")
        self.assertEqual(rows[0]["occurred_at_raw"], "2026-11-14T09:30:00.000Z")
        self.assertTrue(rows[0]["received_at"])

    def test_occurred_at_is_normalised_but_original_kept(self) -> None:
        payload = batch(
            {
                "id": "r-tz",
                "kind": "event",
                "occurredAt": "2026-11-14T17:30:00+08:00",
                "data": {},
            }
        )

        status, body = self.post_json(payload)

        self.assertEqual(status, 200)
        row = self.rows()[0]
        self.assertEqual(row["occurred_at"], "2026-11-14T09:30:00.000Z")
        self.assertEqual(row["occurred_at_raw"], "2026-11-14T17:30:00+08:00")

    def test_empty_records_array_is_accepted_as_a_no_op(self) -> None:
        status, body = self.post_json(batch())

        self.assertEqual(status, 200)
        self.assertEqual(body["acknowledged"], [])
        self.assertEqual((body["accepted"], body["duplicates"]), (0, 0))
        self.assertEqual(self.count(), 0)

    def test_data_is_stored_untouched_including_nested_types(self) -> None:
        nested = {
            "answers": [0, 4, 0],
            "score": None,
            "complete": False,
            "meta": {"scene": "shore", "tags": ["a", "b"], "deep": {"n": 1.5}},
        }

        status, _ = self.post_json(batch(record("r-nested", **nested)))

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(self.rows()[0]["payload"]), nested)


class DuplicateBatchTest(ReceiverCase):
    def test_replayed_batch_files_nothing_and_acks_everything(self) -> None:
        payload = batch(record("r-1"), record("r-2"))

        first_status, first = self.post_json(payload)
        second_status, second = self.post_json(payload)

        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(first["acknowledged"], ["r-1", "r-2"])
        # The ACK is identical, so the sender clears the same local ids twice.
        self.assertEqual(second["acknowledged"], ["r-1", "r-2"])
        self.assertEqual(second["duplicates"], 2)
        self.assertEqual(second["accepted"], 0)
        self.assertEqual(self.count(), 2)

    def test_partial_overlap_counts_each_id_once(self) -> None:
        self.post_json(batch(record("r-1"), record("r-2")))
        payload = batch(record("r-2"), record("r-3"), record("r-4"))

        status, body = self.post_json(payload)

        self.assertEqual(status, 200)
        self.assertEqual(body["acknowledged"], ["r-2", "r-3", "r-4"])
        self.assertEqual(body["accepted"], 2)
        self.assertEqual(body["duplicates"], 1)
        self.assertEqual([row["record_id"] for row in self.rows()], ["r-1", "r-2", "r-3", "r-4"])

    def test_a_duplicate_does_not_overwrite_the_filed_record(self) -> None:
        self.post_json(batch(record("r-1", answers=[1])))
        original = self.rows()[0]["payload"]

        self.post_json(batch(record("r-1", answers=[9])))

        self.assertEqual(self.count(), 1)
        self.assertEqual(self.rows()[0]["payload"], original)

    def test_same_record_id_from_two_devices_is_two_records(self) -> None:
        self.post_json(batch(record("r-1"), device_id="tablet-01"))
        status, body = self.post_json(batch(record("r-1"), device_id="tablet-02"))

        self.assertEqual(status, 200)
        self.assertEqual((body["accepted"], body["duplicates"]), (1, 0))
        self.assertEqual(self.count(), 2)

    def test_batch_limit_allows_exactly_one_hundred(self) -> None:
        payload = batch(*[record("r-%03d" % index) for index in range(100)])

        status, body = self.post_json(payload)

        self.assertEqual(status, 200)
        self.assertEqual(body["accepted"], 100)
        self.assertEqual(len(body["acknowledged"]), 100)
        self.assertEqual(self.count(), 100)


class InvalidBatchTest(ReceiverCase):
    def assertRejected(self, payload: Any, code: str | None = None) -> dict[str, Any]:
        status, body = self.post_json(payload)
        self.assertEqual(status, 400, body)
        self.assertEqual(body["version"], 1)
        self.assertEqual(set(body["error"]), {"code", "message"})
        if code is not None:
            self.assertEqual(body["error"]["code"], code)
        # Nothing from that batch may have landed.
        self.assertEqual(self.count(), 0)
        return body

    def test_wrong_version(self) -> None:
        self.assertRejected(batch(record("r-1"), version=2), "unsupported_version")

    def test_boolean_version_is_not_an_integer(self) -> None:
        payload = batch(record("r-1"))
        payload["version"] = True
        self.assertRejected(payload)

    def test_missing_device_id(self) -> None:
        self.assertRejected({"version": 1, "records": [record("r-1")]})

    def test_device_id_with_forbidden_characters(self) -> None:
        self.assertRejected(batch(record("r-1"), device_id="tablet 01'"))

    def test_records_must_be_an_array(self) -> None:
        self.assertRejected({"version": 1, "deviceId": "tablet-01", "records": {"id": "r-1"}})

    def test_more_than_one_hundred_records(self) -> None:
        payload = batch(*[record("r-%03d" % index) for index in range(101)])
        self.assertRejected(payload, "batch_too_large")

    def test_one_bad_kind_rejects_the_whole_batch(self) -> None:
        self.assertRejected(
            batch(record("r-ok"), record("r-bad", "survey")),
            "invalid_record",
        )

    def test_one_bad_id_rejects_the_whole_batch(self) -> None:
        self.assertRejected(
            batch(record("r-ok"), record("r bad/../x")),
            "invalid_record",
        )

    def test_repeated_id_inside_one_batch_is_rejected(self) -> None:
        self.assertRejected(
            batch(record("r-1", answers=[1]), record("r-1", answers=[2])),
            "duplicate_in_batch",
        )

    def test_missing_data_field(self) -> None:
        bad = record("r-1")
        del bad["data"]
        self.assertRejected(batch(bad), "invalid_record")

    def test_bad_timestamp(self) -> None:
        bad = record("r-1")
        bad["occurredAt"] = "14/11/2026 09:30"
        self.assertRejected(batch(bad), "invalid_timestamp")

    def test_timestamp_must_be_a_string(self) -> None:
        bad = record("r-1")
        bad["occurredAt"] = 1763112600000
        self.assertRejected(batch(bad))

    def test_kind_must_be_a_string(self) -> None:
        bad = record("r-1")
        bad["kind"] = None
        self.assertRejected(batch(bad))

    def test_record_must_be_an_object(self) -> None:
        payload = batch(record("r-1"))
        payload["records"].append("r-2")
        self.assertRejected(payload, "invalid_record")

    def test_non_object_body(self) -> None:
        self.assertRejected([batch(record("r-1"))])

    def test_nan_is_not_json(self) -> None:
        raw = b'{"version":1,"deviceId":"tablet-01","records":[{"id":"r-1","kind":"event","occurredAt":"2026-11-14T09:30:00Z","data":{"x":NaN}}]}'
        status, body = self.post_json(None, raw=raw)
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_json")
        self.assertEqual(self.count(), 0)

    def test_malformed_json(self) -> None:
        status, body = self.post_json(None, raw=b'{"version":1,')
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_json")
        self.assertEqual(self.count(), 0)

    def test_invalid_utf8(self) -> None:
        status, body = self.post_json(None, raw=b'{"version":1,"deviceId":"\xff\xfe"}')
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_encoding")
        self.assertEqual(self.count(), 0)

    def test_body_over_one_mebibyte_is_refused(self) -> None:
        oversized = b"{" + b"x" * receiver.MAX_BODY_BYTES + b"}"
        try:
            status, body = self.post_json(None, raw=oversized)
        except BrokenPipeError:
            # The documented early close may race the client writing its body.
            status, body = 400, {"error": {"code": "body_too_large"}}
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "body_too_large")
        self.assertEqual(self.count(), 0)
        # The connection was closed rather than drained; a second request on a
        # fresh connection still works.
        self.assertEqual(self.request("GET", "/vrdata/health")[0], 200)

    def test_body_exactly_at_one_mebibyte_is_read(self) -> None:
        payload = batch(record("r-pad", blob=""))
        blob = payload["records"][0]["data"]["blob"]
        # Size the blob from the encoded body itself: re-encoding after each
        # change keeps this correct however the helper shapes `data`.
        for _ in range(4):
            blob += "x" * (receiver.MAX_BODY_BYTES - len(json.dumps(payload).encode("utf-8")))
            if len(json.dumps(payload).encode("utf-8")) == receiver.MAX_BODY_BYTES:
                break
        raw = json.dumps(payload).encode("utf-8")
        if len(raw) < receiver.MAX_BODY_BYTES:
            # Trailing whitespace is legal JSON and pads to the exact limit.
            raw += b" " * (receiver.MAX_BODY_BYTES - len(raw))
        self.assertEqual(len(raw), receiver.MAX_BODY_BYTES)

        status, body = self.post_json(None, raw=raw)

        self.assertEqual(status, 200, body)
        self.assertEqual(body["accepted"], 1)

    def test_body_one_byte_over_one_mebibyte_is_refused(self) -> None:
        payload = batch(record("r-pad", blob=""))
        blob = payload["records"][0]["data"]["blob"]
        for _ in range(4):
            blob += "x" * (receiver.MAX_BODY_BYTES - len(json.dumps(payload).encode("utf-8")) + 1)
            if len(json.dumps(payload).encode("utf-8")) >= receiver.MAX_BODY_BYTES + 1:
                break
        raw = json.dumps(payload).encode("utf-8")
        raw += b" " * (receiver.MAX_BODY_BYTES + 1 - len(raw))
        self.assertEqual(len(raw), receiver.MAX_BODY_BYTES + 1)

        status, body = self.post_json(None, raw=raw)

        self.assertEqual(status, 400, body)
        self.assertEqual(body["error"]["code"], "body_too_large")
        self.assertEqual(self.count(), 0)

    def test_wrong_content_type_is_refused(self) -> None:
        status, _, data = self.request(
            "POST",
            "/vrdata/",
            json.dumps(batch(record("r-1"))).encode("utf-8"),
            {"Content-Type": "text/plain"},
        )
        self.assertEqual(status, 415)
        self.assertEqual(json.loads(data)["error"]["code"], "unsupported_media_type")
        self.assertEqual(self.count(), 0)

    def test_missing_content_length_is_refused(self) -> None:
        # A chunked upload has no Content-Length; the receiver will not guess.
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        self.addCleanup(connection.close)
        connection.putrequest("POST", "/vrdata/")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Transfer-Encoding", "chunked")
        connection.endheaders()
        chunk = b'{"version":1,"records":[]}'
        connection.send(b"%x\r\n" % len(chunk) + chunk + b"\r\n0\r\n\r\n")
        response = connection.getresponse()
        data = response.read()

        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(data)["error"]["code"], "length_required")
        self.assertEqual(self.count(), 0)

    def test_failure_leaves_earlier_good_batches_intact(self) -> None:
        self.post_json(batch(record("r-good")))
        status, _ = self.post_json(batch(record("r-1"), record("r bad id")))
        self.assertEqual(status, 400)
        self.assertEqual([row["record_id"] for row in self.rows()], ["r-good"])


class NoReadPathTest(ReceiverCase):
    def setUp(self) -> None:
        super().setUp()
        self.post_json(batch(record("r-1", answers=[1, 2]), record("r-2")))

    def test_health_reports_status_only(self) -> None:
        status, headers, data = self.request("GET", "/vrdata/health")

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"status": "ok", "version": 1})
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_no_route_returns_a_record(self) -> None:
        for path in (
            "/",
            "/vrdata",
            "/vrdata/records",
            "/vrdata/records/r-1",
            "/vrdata/export",
            "/vrdata/db",
            "/vrdata/sqlite3",
            "/vrdata/health/",
            "/../vrdata.sqlite3",
            "/vrdata.sqlite3",
        ):
            with self.subTest(path=path):
                status, _, data = self.request("GET", path)
                # http.client normalises "../" before sending; whatever the
                # server sees, it must answer 404 with no body.
                self.assertEqual(status, 404)
                self.assertEqual(data, b"")

    def test_submit_path_with_query_string_is_still_the_submit_endpoint(self) -> None:
        # The query string is dropped, so `?id=r-1` does not select a record;
        # the path is still POST-only, which is 405 rather than 404.
        for path in ("/vrdata/?id=r-1", "/vrdata/?records=1"):
            with self.subTest(path=path):
                status, headers, data = self.request("GET", path)
                self.assertEqual(status, 405)
                self.assertEqual(headers["Allow"], "POST")
                self.assertEqual(data, b"")

    def test_query_string_does_not_reach_the_file_store(self) -> None:
        status, _, data = self.request("GET", "/vrdata/health?records=1")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"status": "ok", "version": 1})

    def test_submit_path_rejects_get(self) -> None:
        status, headers, data = self.request("GET", "/vrdata/")
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "POST")
        self.assertEqual(data, b"")

    def test_health_rejects_post(self) -> None:
        status, headers, data = self.request("POST", "/vrdata/health", b"{}", {"Content-Type": "application/json"})
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "GET, HEAD")
        self.assertEqual(data, b"")

    def test_other_methods_are_refused_everywhere(self) -> None:
        for method in ("PUT", "PATCH", "DELETE", "OPTIONS"):
            for path in ("/vrdata/", "/vrdata/health", "/"):
                with self.subTest(method=method, path=path):
                    status, _, data = self.request(method, path, b"")
                    self.assertIn(status, (404, 405))
                    self.assertEqual(data, b"")

    def test_head_is_empty(self) -> None:
        status, headers, data = self.request("HEAD", "/vrdata/health")
        self.assertEqual(status, 200)
        self.assertEqual(data, b"")
        # Same body the GET would send, just not written.
        _, _, get_body = self.request("GET", "/vrdata/health")
        self.assertEqual(int(headers["Content-Length"]), len(get_body))


class ConsoleClosedTest(ReceiverCase):
    """No `VRDATA_PASSWORD`: the read surface does not exist at all."""

    def setUp(self) -> None:
        super().setUp()
        # A record exists, so "404" below cannot be explained by an empty file.
        self.post_json(batch(record("r-1", answers=[1])))

    def test_every_read_route_is_404_with_no_body(self) -> None:
        for path in (
            receiver.PAGE_PATH,
            receiver.API_SESSION,
            receiver.API_FACETS,
            receiver.API_RECORDS,
            receiver.API_RECORDS + "/tablet-01/r-1",
            "/vrdata/admin/api/records/tablet-01",
            "/vrdata/admin/api/",
            "/vrdata/admin/anything",
        ):
            with self.subTest(path=path):
                status, _, data = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertEqual(data, b"")

    def test_login_route_is_unguessable_and_404(self) -> None:
        status, headers, data = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": ""}).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 404)
        self.assertEqual(data, b"")
        self.assertNotIn("Set-Cookie", headers)

    def test_logout_is_404_and_sets_no_cookie(self) -> None:
        status, headers, data = self.request("POST", receiver.API_LOGOUT)
        self.assertEqual(status, 404)
        self.assertEqual(data, b"")
        self.assertNotIn("Set-Cookie", headers)

    def test_upload_and_health_still_work(self) -> None:
        # The whole point: the device path never depends on the console.
        status, body = self.post_json(batch(record("r-2")))
        self.assertEqual(status, 200)
        self.assertEqual(body["acknowledged"], ["r-2"])
        self.assertEqual(self.request("GET", "/vrdata/health")[0], 200)
        self.assertEqual(self.count(), 2)

    def test_no_session_key_is_written_when_the_console_is_off(self) -> None:
        self.assertFalse(self.key_path.exists())


class ConsoleAuthTest(ReceiverCase):
    """A configured password gates the whole read surface."""

    password = TEST_PASSWORD

    def test_page_is_served_and_contains_no_data(self) -> None:
        self.post_json(batch(record("r-secret", answers=[7])))
        status, headers, body = self.request("GET", receiver.PAGE_PATH)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertIn("Content-Security-Policy", headers)
        self.assertIn("<form", body.decode("utf-8"))
        # The shell is the login form: it must not carry record content.
        self.assertNotIn("r-secret", body.decode("utf-8"))
        self.assertNotIn("tablet-01", body.decode("utf-8"))

    def test_read_routes_require_a_session(self) -> None:
        for path in (
            receiver.API_SESSION,
            receiver.API_RECORDS,
            receiver.API_FACETS,
            receiver.API_RECORDS + "/tablet-01/r-1",
        ):
            with self.subTest(path=path):
                status, body, _ = self.get_json(path)
                self.assertEqual(status, 401)
                self.assertEqual(body["error"]["code"], "unauthenticated")

    def test_wrong_password_is_rejected_without_a_cookie(self) -> None:
        status, headers, body = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": TEST_PASSWORD + "x"}).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 401)
        self.assertNotIn("Set-Cookie", headers)
        self.assertEqual(json.loads(body)["error"]["code"], "invalid_credentials")
        # The message must not hint at how close the guess was.
        self.assertNotIn(TEST_PASSWORD, body.decode("utf-8"))

    def test_missing_password_field_is_a_client_error(self) -> None:
        status, headers, _ = self.request(
            "POST",
            receiver.API_LOGIN,
            b'{"nope":1}',
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 400)
        self.assertNotIn("Set-Cookie", headers)

    def test_correct_password_sets_a_hardened_session_cookie(self) -> None:
        status, headers, _ = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": TEST_PASSWORD}).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("Path=%s" % receiver.ADMIN_ROOT, cookie)
        self.assertIn("Max-Age=%d" % receiver.SESSION_TTL, cookie)
        # No TLS terminator in the test, so no Secure flag yet.
        self.assertNotIn("Secure", cookie)

    def test_secure_flag_follows_the_tls_terminator(self) -> None:
        status, headers, _ = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": TEST_PASSWORD}).encode("utf-8"),
            {"Content-Type": "application/json", "X-Forwarded-Proto": "https"},
        )
        self.assertEqual(status, 200)
        self.assertIn("Secure", headers["Set-Cookie"])

    def test_forged_and_expired_tokens_are_refused(self) -> None:
        for token in (
            "%s=abc" % receiver.SESSION_COOKIE,
            "%s=abc.def.ghi" % receiver.SESSION_COOKIE,
            "%s=" % receiver.SESSION_COOKIE,
        ):
            with self.subTest(token=token):
                status, _, _ = self.get_json(receiver.API_RECORDS, token)
                self.assertEqual(status, 401)

    def test_expired_token_is_refused(self) -> None:
        cookie = self.session_cookie()
        # Re-sign the same nonce with a deadline in the past: the Mac is valid
        # for this process, so only the expiry can reject it.
        auth = self.server.RequestHandlerClass.auth
        nonce = cookie.split("=", 1)[1].split(".", 1)[0]
        expired = "%s.%s.%s" % (nonce, int(time.time()) - 5, auth._sign(nonce, str(int(time.time()) - 5)))

        status, _, _ = self.get_json(receiver.API_RECORDS, "%s=%s" % (receiver.SESSION_COOKIE, expired))
        self.assertEqual(status, 401)

    def test_login_is_throttled_after_repeated_failures(self) -> None:
        for _ in range(receiver.LOGIN_MAX_FAILURES):
            status, _, _ = self.request(
                "POST",
                receiver.API_LOGIN,
                b'{"password":"wrong"}',
                {"Content-Type": "application/json"},
            )
            self.assertEqual(status, 401)

        status, _, body = self.request(
            "POST",
            receiver.API_LOGIN,
            json.dumps({"password": TEST_PASSWORD}).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
        # Throttling runs before the password is even looked at, so the right
        # password does not get through either.
        self.assertEqual(status, 429)
        self.assertEqual(json.loads(body)["error"]["code"], "too_many_attempts")

    def test_a_successful_login_clears_the_failure_count(self) -> None:
        for _ in range(receiver.LOGIN_MAX_FAILURES - 1):
            self.request("POST", receiver.API_LOGIN, b'{"password":"wrong"}',
                         {"Content-Type": "application/json"})
        self.session_cookie()
        for _ in range(receiver.LOGIN_MAX_FAILURES - 1):
            status, _, _ = self.request("POST", receiver.API_LOGIN, b'{"password":"wrong"}',
                                        {"Content-Type": "application/json"})
            self.assertEqual(status, 401)

    def test_session_key_is_persisted_with_owner_only_permissions(self) -> None:
        self.session_cookie()
        self.assertTrue(self.key_path.is_file())
        self.assertEqual(self.key_path.stat().st_mode & 0o777, 0o600)
        self.assertGreaterEqual(self.key_path.stat().st_size, 32)

    def test_restart_with_the_same_key_keeps_sessions_valid(self) -> None:
        cookie = self.session_cookie()
        key = self.key_path.read_bytes()

        # A second server over the same database and key file is what a
        # `systemctl restart` looks like to a signed-in operator.
        second = receiver.make_server("127.0.0.1", 0, self.database, TEST_PASSWORD, self.key_path)
        thread = threading.Thread(target=second.serve_forever, kwargs={"poll_interval": 0.05})
        thread.daemon = True
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(second.server_close)
        self.addCleanup(second.shutdown)
        self.assertEqual(self.key_path.read_bytes(), key)

        connection = http.client.HTTPConnection("127.0.0.1", second.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.request("GET", receiver.API_SESSION, headers={"Cookie": cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(response.read())["authenticated"])

    def test_secrets_never_appear_in_the_log(self) -> None:
        # Logs go to stderr; swap in a sink for the duration of a login cycle.
        original = sys.stderr
        sink = io.StringIO()
        sys.stderr = sink
        try:
            cookie = self.session_cookie()
            self.request("POST", receiver.API_LOGIN, b'{"password":"guess"}',
                         {"Content-Type": "application/json"})
            self.request("POST", receiver.API_LOGOUT, None, {"Cookie": cookie})
        finally:
            sys.stderr = original
        logged = sink.getvalue()
        self.assertNotIn(TEST_PASSWORD, logged)
        self.assertNotIn("guess", logged)
        # The cookie name and value are never logged either: the value is a
        # bearer credential.
        self.assertNotIn("vrdata_session=", logged)
        self.assertIn("login accepted", logged)
        self.assertIn("logout", logged)

    def test_logout_revokes_the_token_server_side(self) -> None:
        cookie = self.session_cookie()
        self.assertEqual(self.get_json(receiver.API_RECORDS, cookie)[0], 200)

        status, headers, _ = self.request("POST", receiver.API_LOGOUT, None, {"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])

        # Replaying the old cookie is the real test: clearing the browser copy
        # is not enough, because a copied token outlives it.
        self.assertEqual(self.get_json(receiver.API_RECORDS, cookie)[0], 401)

    def test_unknown_admin_paths_404_behind_a_valid_session(self) -> None:
        cookie = self.session_cookie()
        for path in ("/vrdata/admin/nope", receiver.API_RECORDS + "/only-a-device",
                     receiver.API_RECORDS + "/a/b/c"):
            with self.subTest(path=path):
                status, _, _ = self.request("GET", path, None, {"Cookie": cookie})
                self.assertEqual(status, 404)


class ConsoleReadTest(ReceiverCase):
    """The read API against real rows, with a signed-in session."""

    password = TEST_PASSWORD

    def setUp(self) -> None:
        super().setUp()
        self.post_json(batch(
            {"id": "q-1", "kind": "questionnaire", "occurredAt": "2026-11-10T08:00:00Z",
             "data": {"score": 21, "complete": True}},
            {"id": "t-1", "kind": "training", "occurredAt": "2026-11-11T08:00:00Z",
             "data": {"sessionSec": 900}},
            device_id="tablet-01",
        ))
        self.post_json(batch(
            {"id": "e-1", "kind": "experience", "occurredAt": "2026-11-12T08:00:00Z",
             "data": {"note": "ok"}},
            {"id": "v-1", "kind": "event", "occurredAt": "2026-11-13T08:00:00Z",
             "data": {"name": "scene:shore"}},
            device_id="tablet-02",
        ))
        self.cookie = self.session_cookie()

    def test_facets_report_every_kind_and_device(self) -> None:
        status, body, _ = self.get_json(receiver.API_FACETS, self.cookie)

        self.assertEqual(status, 200)
        self.assertEqual(body["byKind"], {
            "event": 1, "experience": 1, "questionnaire": 1, "training": 1,
        })
        self.assertEqual(body["total"], 4)
        self.assertEqual(
            sorted(entry["deviceId"] for entry in body["byDevice"]),
            ["tablet-01", "tablet-02"],
        )

    def test_page_returns_metadata_newest_first(self) -> None:
        status, body, _ = self.get_json(receiver.API_RECORDS, self.cookie)

        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 4)
        self.assertEqual(
            [entry["recordId"] for entry in body["records"]],
            ["v-1", "e-1", "t-1", "q-1"],
        )
        # The list stays small: only the payload length, never the payload.
        self.assertNotIn("payload", body["records"][0])
        self.assertEqual(body["records"][0]["payloadBytes"], len('{"name":"scene:shore"}'))

    def test_kind_filter_narrows_both_page_and_total(self) -> None:
        status, body, _ = self.get_json(receiver.API_RECORDS + "?kind=training", self.cookie)

        self.assertEqual(status, 200)
        self.assertEqual([entry["recordId"] for entry in body["records"]], ["t-1"])
        self.assertEqual(body["total"], 1)

    def test_device_filter(self) -> None:
        status, body, _ = self.get_json(receiver.API_RECORDS + "?device=tablet-02", self.cookie)

        self.assertEqual(status, 200)
        self.assertEqual([entry["recordId"] for entry in body["records"]], ["v-1", "e-1"])

    def test_time_range_is_inclusive_and_filters_both_ends(self) -> None:
        status, body, _ = self.get_json(
            receiver.API_RECORDS
            + "?since=2026-11-11T08:00:00Z&until=2026-11-12T08:00:00Z",
            self.cookie,
        )

        self.assertEqual(status, 200)
        self.assertEqual([entry["recordId"] for entry in body["records"]], ["e-1", "t-1"])

    def test_pagination_walks_without_repeating_or_dropping(self) -> None:
        seen: list[str] = []
        for offset in (0, 2, 4):
            status, body, _ = self.get_json(
                receiver.API_RECORDS + "?limit=2&offset=%d" % offset, self.cookie
            )
            self.assertEqual(status, 200)
            self.assertEqual(body["offset"], offset)
            seen.extend(entry["recordId"] for entry in body["records"])

        self.assertEqual(seen, ["v-1", "e-1", "t-1", "q-1"])

    def test_order_ascending_reverses_the_walk(self) -> None:
        status, body, _ = self.get_json(receiver.API_RECORDS + "?order=asc", self.cookie)

        self.assertEqual(status, 200)
        self.assertEqual(
            [entry["recordId"] for entry in body["records"]], ["q-1", "t-1", "e-1", "v-1"]
        )

    def test_detail_returns_the_decoded_payload(self) -> None:
        status, body, _ = self.get_json(
            receiver.API_RECORDS + "/tablet-01/q-1", self.cookie
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["data"], {"score": 21, "complete": True})
        self.assertEqual(body["kind"], "questionnaire")
        self.assertEqual(body["occurredAt"], "2026-11-10T08:00:00.000Z")

    def test_detail_of_a_missing_record_is_404(self) -> None:
        status, body, _ = self.get_json(
            receiver.API_RECORDS + "/tablet-01/never", self.cookie
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "not_found")

    def test_empty_result_is_a_total_of_zero_not_an_error(self) -> None:
        status, body, _ = self.get_json(
            receiver.API_RECORDS + "?kind=training&device=tablet-02", self.cookie
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 0)
        self.assertEqual(body["records"], [])

    def test_invalid_filters_are_rejected_not_ignored(self) -> None:
        cases = {
            "?kind=mystery": "invalid_query",
            "?device=bad%20id": "invalid_query",
            "?since=yesterday": "invalid_timestamp",
            "?limit=0": "invalid_query",
            "?limit=101": "invalid_query",
            "?offset=-1": "invalid_query",
            "?order=sideways": "invalid_query",
            "?since=2026-11-12T00:00:00Z&until=2026-11-11T00:00:00Z": "invalid_query",
            "?kind=event&kind=training": "invalid_query",
        }
        for query, code in cases.items():
            with self.subTest(query=query):
                status, body, _ = self.get_json(receiver.API_RECORDS + query, self.cookie)
                self.assertEqual(status, 400)
                self.assertEqual(body["error"]["code"], code)

    def test_limit_ceiling_is_enforced_by_the_server(self) -> None:
        status, body, _ = self.get_json(receiver.API_RECORDS + "?limit=100", self.cookie)
        self.assertEqual(status, 200)
        self.assertEqual(body["limit"], 100)

    def test_read_side_never_writes(self) -> None:
        before = self.rows()
        self.get_json(receiver.API_RECORDS, self.cookie)
        self.get_json(receiver.API_FACETS, self.cookie)
        self.get_json(receiver.API_RECORDS + "/tablet-01/q-1", self.cookie)
        self.assertEqual(self.rows(), before)
        self.assertEqual(len(before), 4)

    def test_upload_does_not_need_a_session(self) -> None:
        # The device contract is untouched: no cookie, no credentials.
        status, body = self.post_json(batch(self._fresh("no-session"), device_id="tablet-03"))
        self.assertEqual(status, 200)
        self.assertEqual(body["accepted"], 1)

    def _fresh(self, record_id: str) -> dict[str, Any]:
        return {
            "id": record_id,
            "kind": "event",
            "occurredAt": "2026-11-14T00:00:00Z",
            "data": {"probe": True},
        }


class ConsoleExportTest(ReceiverCase):
    """CSV export: same gate, same filters, bounded, spreadsheet-safe."""

    password = TEST_PASSWORD

    def setUp(self) -> None:
        super().setUp()
        self.post_json(batch(
            {
                "id": "q-1",
                "kind": "questionnaire",
                "occurredAt": "2026-11-10T08:00:00Z",
                # A payload that begins with a formula character, plus Chinese
                # text: the two cases the export must handle carefully.
                "data": {"note": "=HYPERLINK(\"http://evil\")", "label": "中文答卷"},
            },
            {
                "id": "t-1",
                "kind": "training",
                "occurredAt": "2026-11-11T08:00:00Z",
                "data": {"note": "第一行\n第二行, 带逗号", "quote": "含\"引号\""},
            },
            device_id="tablet-01",
        ))
        self.post_json(batch(
            {
                "id": "-minus",
                "kind": "experience",
                "occurredAt": "2026-11-12T08:00:00Z",
                "data": {"rating": 5},
            },
            device_id="tablet-02",
        ))
        self.cookie = self.session_cookie()

    def export(self, query: str = "", cookie: str | None = None) -> tuple[int, dict[str, str], bytes]:
        """Fetch the export.

        `cookie=None` means "the signed-in session"; pass `cookie=""` to make
        an anonymous request. A truthiness default would silently turn the
        anonymous case into the authenticated one.
        """
        path = receiver.API_EXPORT + query
        session = self.cookie if cookie is None else cookie
        headers = {"Cookie": session} if session else {}
        return self.request("GET", path, None, headers)

    def test_export_requires_a_session(self) -> None:
        status, headers, body = self.export(cookie="")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"]["code"], "unauthenticated")
        self.assertNotIn("Content-Disposition", headers)

    def test_export_is_closed_when_no_password_is_configured(self) -> None:
        # A second server with the same database but no password: the export
        # route must behave like every other read route.
        closed = receiver.make_server("127.0.0.1", 0, self.database, None, self.key_path)
        thread = threading.Thread(target=closed.serve_forever, kwargs={"poll_interval": 0.05})
        thread.daemon = True
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(closed.server_close)
        self.addCleanup(closed.shutdown)

        connection = http.client.HTTPConnection("127.0.0.1", closed.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.request("GET", receiver.API_EXPORT, headers={"Cookie": self.cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 404)
        self.assertEqual(response.read(), b"")

    def test_export_is_bom_headed_utf8_csv_with_an_attachment_name(self) -> None:
        status, headers, body = self.export()

        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/csv; charset=utf-8")
        disposition = headers["Content-Disposition"]
        self.assertTrue(disposition.startswith("attachment;"), disposition)
        self.assertIn(".csv", disposition)
        # Excel needs the BOM to read Chinese without mojibake.
        self.assertTrue(body.startswith("\ufeff".encode("utf-8")))
        text = body.decode("utf-8-sig")
        self.assertTrue(
            text.startswith("device_id,record_id,kind,occurred_at,occurred_at_raw,received_at,data_json")
        )

    def parse(self, body: bytes) -> list[list[str]]:
        """Parse an export body exactly as a spreadsheet would.

        Assertions go through this, never through hand-written raw quoting:
        the quoting rules are what the test is meant to verify, so re-deriving
        the expected string by hand would just restate the implementation.
        """
        return list(csv.reader(io.StringIO(body.decode("utf-8-sig"), newline="")))

    def by_record_id(self, body: bytes) -> dict[str, list[str]]:
        """Rows keyed by id *without* the formula guard, for readable lookups."""
        rows = self.parse(body)
        return {row[1].lstrip("'"): row for row in rows[1:]}

    def test_export_contains_every_row_with_real_columns(self) -> None:
        status, _, body = self.export()

        self.assertEqual(status, 200)
        rows = self.parse(body)
        self.assertEqual(rows[0][:3], ["device_id", "record_id", "kind"])
        self.assertEqual(len(rows), 4)  # header + 3 records
        # "-minus" begins with a formula character, so the guard prefixes it.
        self.assertEqual([row[1] for row in rows[1:]], ["'-minus", "t-1", "q-1"])
        by_id = self.by_record_id(body)
        # The payload column is the record's JSON, and json.loads accepts it.
        self.assertEqual(json.loads(by_id["q-1"][6])["label"], "中文答卷")
        self.assertEqual(by_id["q-1"][0], "tablet-01")

    def test_chinese_survives_the_round_trip(self) -> None:
        _, _, body = self.export()

        text = body.decode("utf-8-sig")
        self.assertIn("中文答卷", text)
        self.assertIn("第一行", text)
        by_id = self.by_record_id(body)
        payload = json.loads(by_id["t-1"][6])
        # `data` is stored as JSON text, so the newline is escaped inside the
        # payload: one physical CSV row, one JSON string with \n in it.
        self.assertEqual(payload["note"], "第一行\n第二行, 带逗号")
        self.assertEqual(payload["quote"], '含"引号"')
        self.assertNotIn("\n", by_id["t-1"][6])

    def test_a_real_newline_field_stays_one_row(self) -> None:
        # The stored payload has no raw newline (JSON escapes it), so a genuine
        # multi-line cell is checked at the CSV layer, where the risk lives.
        line = receiver.csv_row(
            "tablet-01", "r-ml", "training",
            "2026-11-11T08:00:00.000Z", "2026-11-11T08:00:00Z", "2026-11-11T08:00:01.000Z",
            "第一行\n第二行, 带逗号",
        )
        rows = list(csv.reader(io.StringIO(line, newline="")))
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]), 7)
        self.assertEqual(rows[0][6], "第一行\n第二行, 带逗号")

    def test_formula_prefixes_are_neutralised(self) -> None:
        status, _, body = self.export()

        self.assertEqual(status, 200)
        rows = self.parse(body)
        by_id = self.by_record_id(body)
        # Record id starting with "-" would otherwise be a subtraction formula.
        self.assertEqual(by_id["-minus"][1], "'-minus")
        # No cell may *begin* with a formula trigger; the payload column starts
        # with "{" and is therefore not one, but a guarded prefix would show.
        for row in rows[1:]:
            for cell in row:
                self.assertNotIn(cell[:1], ("=", "+", "@", "\t", "\r"))

    def test_formula_guard_covers_every_prefix(self) -> None:
        for raw, expected in (
            ("=cmd|calc", "'=cmd|calc"),
            ("+1+1", "'+1+1"),
            ("-minus", "'-minus"),
            ("@SUM(A1)", "'@SUM(A1)"),
            ("\tTAB", "'\tTAB"),
            ("\rCR", "'\rCR"),
        ):
            with self.subTest(raw=raw):
                parsed = list(csv.reader(io.StringIO(receiver._csv_field(raw) + "\n", newline="")))
                self.assertEqual(parsed, [[expected]])

    def test_formula_guard_does_not_quote_ordinary_text(self) -> None:
        for raw in ("r-1", "中文", "scene:shore", "2026-11-14T08:00:00.000Z"):
            with self.subTest(raw=raw):
                self.assertEqual(receiver._csv_field(raw), raw)

    def test_quoting_survives_commas_quotes_and_newlines(self) -> None:
        # Assert on what a parser reads back, not on raw quoting: the escaped
        # form is the implementation's business.
        for raw in ('a,b', 'say "hi"', "l1\nl2", "中文, 含逗号", 'mix "q", nl\n'):
            with self.subTest(raw=raw):
                line = receiver.csv_row("d", "r", "event", "a", "b", "c", raw)
                rows = list(csv.reader(io.StringIO(line, newline="")))
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0][6], raw)
                # A guarded cell keeps its text; only the prefix is added.
                if raw[:1] in ("=", "+", "-", "@", "\t", "\r"):
                    self.assertEqual(rows[0][6], "'" + raw)

    def test_filters_are_reused_by_the_export(self) -> None:
        _, _, everything = self.export()
        _, _, training = self.export("?kind=training")
        _, _, device = self.export("?device=tablet-02")
        _, _, ranged = self.export("?since=2026-11-11T00:00:00Z&until=2026-11-12T00:00:00Z")

        self.assertEqual(len(self.parse(everything)) - 1, 3)
        self.assertEqual([row[1] for row in self.parse(training)[1:]], ["t-1"])
        # The id starts with "-", so the export carries the guarded form.
        self.assertEqual([row[1] for row in self.parse(device)[1:]], ["'-minus"])
        # Both ends inclusive: t-1 is at 11-11T08:00, inside; -minus is at
        # 11-12T08:00, past the 11-12T00:00 upper bound.
        self.assertEqual([row[1] for row in self.parse(ranged)[1:]], ["t-1"])

    def test_range_bounds_are_inclusive_at_both_ends(self) -> None:
        # Exact boundary instants, so "inclusive" is proven rather than implied.
        _, _, body = self.export(
            "?since=2026-11-11T08:00:00Z&until=2026-11-12T08:00:00Z&order=asc"
        )
        self.assertEqual([row[1] for row in self.parse(body)[1:]], ["t-1", "'-minus"])

    def test_empty_result_still_produces_a_header_only_file(self) -> None:
        status, _, body = self.export("?kind=training&device=tablet-02")

        self.assertEqual(status, 200)
        rows = self.parse(body)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "device_id")

    def test_invalid_filter_is_rejected_before_any_file_is_sent(self) -> None:
        for query, code in (
            ("?kind=mystery", "invalid_query"),
            ("?since=yesterday", "invalid_timestamp"),
            ("?limit=0", "invalid_query"),
        ):
            with self.subTest(query=query):
                status, headers, body = self.export(query)
                self.assertEqual(status, 400)
                self.assertNotIn("Content-Disposition", headers)
                self.assertEqual(json.loads(body)["error"]["code"], code)

    def test_export_over_the_row_cap_is_refused_not_truncated(self) -> None:
        original = receiver.EXPORT_MAX_ROWS
        receiver.EXPORT_MAX_ROWS = 2
        self.addCleanup(setattr, receiver, "EXPORT_MAX_ROWS", original)

        status, headers, body = self.export()

        self.assertEqual(status, 413)
        self.assertNotIn("Content-Disposition", headers)
        error = json.loads(body)["error"]
        self.assertEqual(error["code"], "export_too_large")
        self.assertIn("3", error["message"])

    def test_limit_is_ignored_but_offset_shifts_the_export(self) -> None:
        # "limit" means a page of the table, not a page of the export.
        _, _, limited = self.export("?limit=1")
        # Counted with the parser, not splitlines(): a payload could contain a
        # newline and splitlines would then disagree with the CSV structure.
        self.assertEqual(len(self.parse(limited)) - 1, 3)

        _, _, shifted = self.export("?offset=2")
        self.assertEqual([row[1] for row in self.parse(shifted)[1:]], ["q-1"])

    def test_export_post_is_refused(self) -> None:
        status, headers, body = self.request("POST", receiver.API_EXPORT, b"", {"Cookie": self.cookie})
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "GET")
        self.assertEqual(body, b"")

    def test_export_streams_one_row_at_a_time(self) -> None:
        # The iterator must yield per record and stop at the cap, instead of
        # materialising the table: exhausting a cap of 2 yields exactly 2.
        query = receiver.parse_read_query("order=asc")
        lines = list(self.server.RequestHandlerClass.store.export_rows(query, max_rows=2))
        self.assertEqual(len(lines), 2)
        # One yielded line per record, parsed back to exactly one row.
        for line in lines:
            rows = list(csv.reader(io.StringIO(line, newline="")))
            self.assertEqual(len(rows), 1)
            self.assertEqual(len(rows[0]), 7)
        self.assertEqual(list(csv.reader(io.StringIO(lines[0], newline="")))[0][0], "tablet-01")

    def test_export_ignores_a_page_limit_but_respects_nothing_else(self) -> None:
        # A page of 1 in the table must not become a 1-row export.
        query = receiver.parse_read_query("?limit=1")
        lines = list(self.server.RequestHandlerClass.store.export_rows(query))
        self.assertEqual(len(lines), 3)


class StorageTest(unittest.TestCase):
    def test_database_is_wal_and_unique_on_device_and_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "vrdata.sqlite3"
            store = receiver.Store(database)
            store.open()

            connection = sqlite3.connect(database)
            try:
                mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
                self.assertEqual(mode.lower(), "wal")
                columns = [row[1] for row in connection.execute("PRAGMA table_info(records)")]
                self.assertEqual(
                    columns,
                    [
                        "device_id",
                        "record_id",
                        "kind",
                        "occurred_at",
                        "occurred_at_raw",
                        "received_at",
                        "payload",
                    ],
                )
                # Written by the operator over SSH: the payload column must be
                # plain JSON text that sqlite3 and jq can both read.
                connection.execute(
                    "INSERT INTO records VALUES "
                    "('d','r','event','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00Z',"
                    "'2026-11-14T00:00:01.000Z','{\"a\":1}')"
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO records VALUES "
                        "('d','r','event','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00Z',"
                        "'2026-11-14T00:00:01.000Z','{\"a\":2}')"
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO records VALUES "
                        "('d','r-bad','mystery','2026-11-14T00:00:00.000Z','2026-11-14T00:00:00Z',"
                        "'2026-11-14T00:00:01.000Z','{}')"
                    )
                connection.rollback()
            finally:
                connection.close()

    def test_open_creates_missing_parent_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "a" / "b" / "vrdata.sqlite3"
            receiver.Store(database).open()
            self.assertTrue(database.is_file())


if __name__ == "__main__":
    unittest.main()
