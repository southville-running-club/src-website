"""The Claude reader, against a stand-in client. No test here reaches Anthropic's API: the
client is replaced every time, so nothing is sent and nothing is spent."""

import base64
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx2

from racephotos.claude_reader import (
    ANSWER_SCHEMA,
    DECLINED,
    MAX_RETRIES,
    TIMEOUT_SECONDS,
    ClaudeReader,
    bib_length,
    instructions,
)
from racephotos.cli import main
from racephotos.manifest import Manifest, State
from racephotos.reader import ReaderStopped, parse_reads

from . import fixtures
from .fixtures import answer, jpeg_bytes, make_jpeg

A_KEY = "sk-ant-not-a-real-key-0000"
REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def text(value):
    return SimpleNamespace(type="text", text=value)


def response(*content, stop_reason="end_turn"):
    return SimpleNamespace(content=list(content), stop_reason=stop_reason)


class StubClient:
    """Stands in for ``anthropic.Anthropic``: remembers each request, then answers with the
    next response or raises the next error."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []
        self.messages = self

    def create(self, **request):
        self.calls.append(request)
        outcome = self.outcomes.pop(0) if self.outcomes else response(text('{"bibs": []}'))
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def status_error(cls, status, error_type):
    """A real SDK error, with the key in its message and body as a provider's text might be."""
    body = {"type": "error", "error": {"type": error_type, "message": f"bad key {A_KEY}"}}
    return cls(f"Error code: {status} - {body}", response=httpx2.Response(status, request=REQUEST), body=body)


class RequestTest(unittest.TestCase):
    def test_sends_the_medium_copy_and_a_fixed_instruction_and_nothing_else(self):
        medium = jpeg_bytes()
        client = StubClient()
        ClaudeReader(client=client).read(medium, "fingerprint-marker-do-not-send")

        (request,) = client.calls
        self.assertEqual(set(request), {"model", "max_tokens", "system", "output_config", "messages"})
        self.assertEqual(request["model"], "claude-haiku-5-5")
        self.assertEqual(request["output_config"]["effort"], "low")
        self.assertEqual(request["output_config"]["format"], {"type": "json_schema", "schema": ANSWER_SCHEMA})

        (message,) = request["messages"]
        image, ask = message["content"]
        self.assertEqual(image["source"]["media_type"], "image/jpeg")
        self.assertEqual(base64.standard_b64decode(image["source"]["data"]), medium)
        self.assertEqual(ask["type"], "text")
        self.assertNotIn("fingerprint-marker-do-not-send", json.dumps(request))

    def test_names_the_model_config_asks_for(self):
        client = StubClient()
        ClaudeReader("claude-sonnet-5-5", client=client).read(jpeg_bytes(), "f")
        self.assertEqual(client.calls[0]["model"], "claude-sonnet-5-5")

    def test_the_schema_is_the_only_shape_parse_reads_accepts(self):
        self.assertEqual(ANSWER_SCHEMA["required"], ["bibs"])
        self.assertFalse(ANSWER_SCHEMA["additionalProperties"])
        item = ANSWER_SCHEMA["properties"]["bibs"]["items"]
        self.assertEqual(set(item["properties"]), {"text", "confidence"})
        self.assertEqual(set(item["required"]), {"text", "confidence"})
        self.assertFalse(item["additionalProperties"])

    def test_the_instruction_asks_for_numbers_and_nothing_about_people(self):
        system = instructions(None)
        self.assertIn("race bib", system)
        self.assertIn("write ? for any digit you cannot read", system)
        self.assertIn("Do not describe, identify or mention anyone", system)

    def test_says_how_long_a_number_is_only_when_every_bib_is_the_same_length(self):
        self.assertEqual(bib_length(["001", "120", "250"]), 3)
        self.assertIsNone(bib_length(["311", "0311"]))
        self.assertIn("3 digits long, counting any leading zeros", instructions(3))
        self.assertNotIn("digits long", instructions(None))

    def test_the_real_client_retries_a_busy_minute_rather_than_stopping(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": A_KEY}):
            reader = ClaudeReader()
        self.assertEqual(reader.client.max_retries, MAX_RETRIES)
        self.assertEqual(reader.client.timeout, TIMEOUT_SECONDS)


class AnswerTest(unittest.TestCase):
    def read(self, outcome):
        return ClaudeReader(client=StubClient(outcome)).read(jpeg_bytes(), "f")

    def test_reads_the_answer_from_the_text_whatever_comes_before_it(self):
        raw = self.read(response(SimpleNamespace(type="thinking", thinking=""), text(answer(("125", 0.97)))))
        parsed = parse_reads(raw)
        self.assertTrue(parsed.ok)
        self.assertEqual([(read.text, read.confidence) for read in parsed.reads], [("125", 0.97)])

    def test_a_photo_the_model_declines_goes_to_a_person(self):
        raw = self.read(response(stop_reason="refusal"))
        self.assertEqual(raw, DECLINED)
        self.assertFalse(parse_reads(raw).ok)

    def test_an_answer_cut_short_goes_to_a_person(self):
        raw = self.read(response(text('{"bibs": [{"text": "12'), stop_reason="max_tokens"))
        self.assertFalse(parse_reads(raw).ok)

    def test_an_answer_with_no_text_goes_to_a_person(self):
        self.assertFalse(parse_reads(self.read(response())).ok)


class StopTest(unittest.TestCase):
    """Anything the API refuses stops the run, worded for a person, never quoting it."""

    CASES = [
        (status_error(anthropic.AuthenticationError, 401, "authentication_error"), "refused the API key (401"),
        (status_error(anthropic.PermissionDeniedError, 403, "permission_error"), "may not do that (403"),
        (status_error(anthropic.NotFoundError, 404, "not_found_error"), "does not know the model claude-haiku-5-5"),
        (status_error(anthropic.RateLimitError, 429, "rate_limit_error"), "limiting how fast"),
        (status_error(anthropic.BadRequestError, 400, "invalid_request_error"), "credit has run out"),
        (status_error(anthropic.APIStatusError, 402, "billing_error"), "credit has run out"),
        (status_error(anthropic.InternalServerError, 529, "overloaded_error"), "a problem of its own (529, overloaded_error)"),
        (status_error(anthropic.InternalServerError, 500, "api_error"), "a problem of its own (500"),
        (anthropic.APIConnectionError(request=REQUEST), "could not be reached"),
        (anthropic.APITimeoutError(request=REQUEST), "could not be reached"),
    ]

    def test_each_refusal_stops_the_run_with_its_own_words(self):
        for error, words in self.CASES:
            with self.subTest(error=type(error).__name__, status=getattr(error, "status_code", None)):
                with self.assertRaises(ReaderStopped) as caught:
                    ClaudeReader(client=StubClient(error)).read(jpeg_bytes(), "f")
                message = str(caught.exception)
                self.assertIn(words, message)
                self.assertIn("tag again", message)
                self.assertNotIn(A_KEY, message)
                self.assertNotIn("bad key", message)
                self.assertIsNone(caught.exception.__cause__)
                self.assertTrue(caught.exception.__suppress_context__)


class ClaudeTagTest(unittest.TestCase):
    """The reader inside a real tag run, through the command line."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.config = fixtures.make_work(self.root)
        config_toml = self.config.work / "config.toml"
        config_toml.write_text(config_toml.read_text().replace('kind = "fake"', 'kind = "claude"'))
        for name in ("a", "b", "c"):
            make_jpeg(self.config.originals / f"Ross/{name}.jpg", recorded=f"2026:11:01 11:0{ord(name) - 97}:00")

    def tearDown(self):
        self._tmp.cleanup()

    def tag(self, client, key=A_KEY):
        environment = {"ANTHROPIC_API_KEY": key} if key else {}
        lines, errors = [], io.StringIO()
        with mock.patch.dict(os.environ, environment, clear=False), \
                mock.patch("racephotos.claude_reader.anthropic.Anthropic", return_value=client), \
                contextlib.redirect_stderr(errors):
            if not key:
                os.environ.pop("ANTHROPIC_API_KEY", None)
            code = main(["--work", str(self.config.work), "tag"], say=lines.append)
        return code, "\n".join(lines), errors.getvalue()

    def manifest(self):
        manifest = Manifest.open(self.config.manifest_path, self.config.event_slug)
        self.addCleanup(manifest.close)
        return manifest

    def test_reads_every_photo_and_tags_a_confident_read(self):
        client = StubClient(response(text(answer(("125", 0.97)))), response(text(answer(("12?", 0.95)))))
        code, output, _ = self.tag(client)

        self.assertEqual(code, 0)
        self.assertIn("claude-haiku-5-5 reads the bibs", output)
        self.assertIn("Tagged 3 new photos", output)
        self.assertEqual(len(client.calls), 3)
        manifest = self.manifest()
        states = sorted(manifest.state(photo["fingerprint"]) for photo in manifest.photos())
        self.assertEqual(states, sorted([State.TAGGED, State.PART_READ, State.NO_BIB_SEEN]))

    def test_no_key_refuses_before_anything_is_read(self):
        client = StubClient()
        code, _, errors = self.tag(client, key=None)

        self.assertEqual(code, 2)
        self.assertIn("ANTHROPIC_API_KEY is not set", errors)
        self.assertEqual(client.calls, [])
        self.assertFalse(self.config.manifest_path.exists())

    def test_a_refusal_stops_the_run_and_the_next_run_carries_on(self):
        client = StubClient(
            response(text(answer(("125", 0.97)))),
            status_error(anthropic.BadRequestError, 400, "invalid_request_error"),
        )
        code, _, errors = self.tag(client)

        self.assertEqual(code, 2)
        self.assertIn("Stopped: Anthropic refused the request (400", errors)
        self.assertNotIn(A_KEY, errors)
        manifest = self.manifest()
        self.assertEqual(len(manifest.photos()), 1, "the photo it stopped on is not recorded")
        manifest.close()

        again = StubClient()
        code, output, _ = self.tag(again)
        self.assertEqual(code, 0)
        self.assertEqual(len(again.calls), 2, "only the two unread photos are read")
        manifest = self.manifest()
        self.assertEqual(len(manifest.photos()), 3)
        self.assertEqual(
            {path.name for path in self.config.copies_dir.iterdir()},
            {photo["photo_id"] for photo in manifest.photos()},
            "the copies of the photo it stopped on were swept, not left orphaned",
        )


if __name__ == "__main__":
    unittest.main()
