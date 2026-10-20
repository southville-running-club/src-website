"""What the vision model may answer, and the fake reader that stands in for it.

The model is sent **the medium copy only**, with no metadata (ADR-059), and asked for the
digits on any race bibs, with ``?`` for a digit it cannot read and a confidence for each.
It is asked nothing about the people (ADR-058). Its answer must be exactly this, and
nothing else::

    {"bibs": [{"text": "123", "confidence": 0.97}, {"text": "12?", "confidence": 0.6}]}

``parse_reads()`` is strict. Anything that is not that shape — prose, a markdown fence,
an extra key, ``NaN``, a duplicated key, a confidence outside 0 to 1, a letter in a bib —
comes back as a *problem* with no reads, and the photo goes to a person. It never raises,
never crashes a run, and never guesses a bib out of a malformed answer. An empty list is a
valid answer: the model saw no bib.

Which provider reads for real is not chosen yet (brief §15), so the only reader is
``FakeReader``. A real one will implement ``BibReader.read()`` and must send the provider
``medium_jpeg`` and nothing else; ``fingerprint`` exists so the fake can answer per photo,
and is an opaque hash in any case.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol

from .files import fingerprint as fingerprint_of

MAX_ANSWER = 20_000
MAX_BIBS = 20
BIB_TEXT = re.compile(r"[0-9?]{1,8}")
NO_BIBS = '{"bibs": []}'


class BibReader(Protocol):
    def read(self, medium_jpeg: bytes, fingerprint: str) -> str:
        """The model's raw answer for one photo."""


@dataclass(frozen=True)
class BibRead:
    text: str
    confidence: float


@dataclass(frozen=True)
class ParsedReads:
    reads: tuple[BibRead, ...]
    problem: str | None = None

    @property
    def ok(self) -> bool:
        return self.problem is None


def _problem(why: str) -> ParsedReads:
    return ParsedReads(reads=(), problem=why)


class _Refused(ValueError):
    pass


def _no_duplicates(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise _Refused("an object has the same key twice")
    return dict(pairs)


def _no_constants(name):
    raise _Refused(f"{name} is not a number")


def parse_reads(raw: object) -> ParsedReads:
    if not isinstance(raw, str):
        return _problem("the answer was not text")
    if len(raw) > MAX_ANSWER:
        return _problem("the answer was too long")
    try:
        answer = json.loads(raw, object_pairs_hook=_no_duplicates, parse_constant=_no_constants)
    except _Refused as refused:
        return _problem(f"the answer was not usable: {refused}")
    except (json.JSONDecodeError, RecursionError):
        return _problem("the answer was not JSON")

    if not isinstance(answer, dict) or set(answer) != {"bibs"}:
        return _problem('the answer was not an object holding only "bibs"')
    items = answer["bibs"]
    if not isinstance(items, list):
        return _problem('"bibs" was not a list')
    if len(items) > MAX_BIBS:
        return _problem(f"the answer listed more than {MAX_BIBS} bibs")

    best: dict[str, float] = {}
    for item in items:
        if not isinstance(item, dict) or set(item) != {"text", "confidence"}:
            return _problem('a bib was not an object holding only "text" and "confidence"')
        text, confidence = item["text"], item["confidence"]
        if not isinstance(text, str) or not BIB_TEXT.fullmatch(text):
            return _problem("a bib's text was not digits and ? only")
        # bool is a subclass of int in Python, and true is not a confidence.
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            return _problem("a confidence was not a number")
        if not 0 <= confidence <= 1:
            return _problem("a confidence was outside 0 to 1")
        best[text] = max(float(confidence), best.get(text, 0.0))

    return ParsedReads(reads=tuple(BibRead(text, confidence) for text, confidence in best.items()))


class FakeReader:
    """Answers from a table keyed by the original's fingerprint. A photo with no entry
    reads as no bib seen."""

    def __init__(self, answers: Mapping[str, str] | None = None):
        self.answers = dict(answers or {})

    def read(self, medium_jpeg: bytes, fingerprint: str) -> str:
        return self.answers.get(fingerprint, NO_BIBS)

    @classmethod
    def from_file(cls, path: Path | None, originals: Path) -> "FakeReader":
        """Load ``fake_reads`` from the config: a JSON object mapping a photo's path under
        the originals folder to the model's answer. A string answer is passed on exactly as
        written, so a malformed answer can be rehearsed; anything else is encoded as JSON."""
        if path is None:
            return cls()
        table = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(table, dict):
            raise ValueError(f"{path.name} must be a JSON object of photo path to answer")
        answers = {}
        for relative, answer in table.items():
            photo = originals / relative
            if not photo.is_file():
                raise ValueError(f"{path.name} names {relative}, which is not in the originals folder")
            answers[fingerprint_of(photo)] = answer if isinstance(answer, str) else json.dumps(answer)
        return cls(answers)
