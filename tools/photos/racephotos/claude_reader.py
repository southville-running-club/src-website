"""``ClaudeReader``: Claude reads the bibs (ADR-071).

**What it sends** is the medium copy and a fixed instruction, and nothing else. copies.py
has already stripped the medium copy of everything but the picture (ADR-060); the photo's
fingerprint, file name, photographer, camera and time never leave the laptop, because the
model needs none of them to read a number and each says something about somebody.

**What it asks** is ADR-058's rule: the digits on any race bibs, with ``?`` for a digit it
cannot read and a confidence for each, and nothing about the people. The answer is held to
reader.py's one allowed shape by a JSON schema on the request, and ``parse_reads()`` still
checks every answer as though the schema were not there, because a guarantee made at the
other end of a network is not one this tool relies on.

**How it fails** is reader.py's split. A photo the model declines to read, or an answer cut
short, comes back as text ``parse_reads()`` refuses, so that photo goes to a person and the
run goes on. Anything the API itself refuses — the key, the credit, the model's name, the
network once the SDK has retried — raises ``ReaderStopped``, so the run stops with the
photo unrecorded and the next run reads it. No message here quotes the provider's own error
text: it can carry the request, and a key.

The key is the SDK's own ``ANTHROPIC_API_KEY``, from the environment, and never from
config.toml or anywhere on disk; cli.py refuses to start a run without it.
"""

from __future__ import annotations

import base64
import re
from collections.abc import Iterable
from typing import Any

import anthropic

from .config import DEFAULT_CLAUDE_MODEL as DEFAULT_MODEL
from .reader import ReaderStopped

# Room for the model's own brief thinking as well as the answer. Only what is used is
# billed, and a cap that thinking can use up returns no answer at all.
MAX_TOKENS = 4096
# Reading a few digits is not a hard problem, and effort is most of what a request costs.
EFFORT = "low"
# The SDK retries connection errors, 408, 409, 429 and 5xx with backoff, two times by
# default. A run of two thousand photos should ride out a busy minute rather than stop.
MAX_RETRIES = 6
TIMEOUT_SECONDS = 120.0

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "bibs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["text", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["bibs"],
    "additionalProperties": False,
}

ASK = "Read the race numbers on the bibs in this photo."

# What read() returns for a photo the model declined. It is not JSON, so parse_reads()
# refuses it and the photo goes to a person, with this kept as the raw answer.
DECLINED = "The model declined to read this photo."

ERROR_TYPE = re.compile(r"[a-z_]{1,40}")


def bib_length(bibs: Iterable[str]) -> int | None:
    """How many digits every bib on the list has, or None when they differ. Telling the model
    is what makes it write 007 rather than 7, which would fit no bib on a padded list."""
    lengths = {len(bib) for bib in bibs}
    return lengths.pop() if len(lengths) == 1 else None


def instructions(bib_digits: int | None) -> str:
    length = (
        f" Every race number in this race is {bib_digits} digits long, counting any leading "
        f"zeros, so write all {bib_digits}."
        if bib_digits
        else ""
    )
    return (
        "You read race numbers from one photo taken at a running race.\n\n"
        "List the number printed on every race bib you can see. Write digits only, and write ? "
        f"for any digit you cannot read for certain, for example 1?3.{length} A number that is "
        "not on a race bib, such as a sign, a car or the print on a shirt, is not a race number. "
        "Runners may be in costume, and a bib can be creased, folded or partly hidden.\n\n"
        "For each number, give your confidence from 0 to 1 that every digit you wrote is right. "
        "Give a confidence near 1 only when every digit is clearly legible, and well below that "
        "when any digit is a guess.\n\n"
        "If no race bib is visible, give an empty list.\n\n"
        "Read race numbers and nothing else. Do not describe, identify or mention anyone in "
        "the photo."
    )


def stopped_because(error: Exception, model: str) -> str:
    """Why the run stopped, in the club's words. Names a status code and the API's own error
    type, which is a fixed word, and never the error's message."""
    status = getattr(error, "status_code", None)
    kind = getattr(error, "type", None)
    detail = f"{status}, {kind}" if isinstance(kind, str) and ERROR_TYPE.fullmatch(kind) else f"{status}"
    again = "then tag again; it carries on from the photo it stopped at."

    if isinstance(error, anthropic.AuthenticationError):
        return f"Anthropic refused the API key ({detail}). Check it is a current key, {again}"
    if isinstance(error, anthropic.PermissionDeniedError):
        return (
            f"Anthropic says this API key may not do that ({detail}). Check the key's workspace "
            f"can use {model}, {again}"
        )
    if isinstance(error, anthropic.NotFoundError):
        return f"Anthropic does not know the model {model} ({detail}). Check [reader] model in config.toml, {again}"
    if isinstance(error, anthropic.RateLimitError):
        return f"Anthropic is limiting how fast this key can read ({detail}), even after waiting. Wait a minute, {again}"
    if isinstance(error, anthropic.APIStatusError):
        if status == 402:
            return (
                f"Anthropic says the account's credit has run out or its billing needs attention "
                f"({detail}); the Claude Console's billing page says which. Sort that out, {again}"
            )
        if status == 400:
            return (
                f"Anthropic refused the request ({detail}). Either the account's credit has run out, "
                "which the Claude Console's billing page shows, or Anthropic does not accept something "
                f"the tool sent, which needs a change to the tool. Once that is sorted out, {again}"
            )
        if isinstance(status, int) and status >= 500:
            return f"Anthropic had a problem of its own ({detail}), even after retrying. Wait a few minutes, {again}"
        return f"Anthropic refused the request ({detail}). Once that is sorted out, {again}"
    if isinstance(error, anthropic.APIConnectionError):
        return f"Anthropic could not be reached, even after retrying. Check the laptop is online, {again}"
    return f"The Claude reader could not go on ({type(error).__name__}). Once that is sorted out, {again}"


class ClaudeReader:
    def __init__(self, model: str = DEFAULT_MODEL, *, bib_digits: int | None = None, client: Any = None):
        self.model = model
        self.system = instructions(bib_digits)
        self.client = (
            client
            if client is not None
            else anthropic.Anthropic(max_retries=MAX_RETRIES, timeout=TIMEOUT_SECONDS)
        )

    def request(self, medium_jpeg: bytes) -> dict:
        """Everything sent for one photo. No sampling settings: current models refuse them."""
        return {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": self.system,
            "output_config": {
                "effort": EFFORT,
                "format": {"type": "json_schema", "schema": ANSWER_SCHEMA},
            },
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.standard_b64encode(medium_jpeg).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": ASK},
                    ],
                }
            ],
        }

    def read(self, medium_jpeg: bytes, fingerprint: str) -> str:
        # The fingerprint is deliberately not sent: nothing but the picture leaves the laptop.
        try:
            response = self.client.messages.create(**self.request(medium_jpeg))
        except anthropic.AnthropicError as error:
            raise ReaderStopped(stopped_because(error, self.model)) from None
        if response.stop_reason == "refusal":
            return DECLINED
        # By type, never by position: a response can open with thinking blocks.
        return "".join(block.text for block in response.content if block.type == "text")
