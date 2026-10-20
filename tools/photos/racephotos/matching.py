"""Checking each read against the race's bib list.

Three outcomes, and a read is in exactly one:

- **tagged**: a confident read of a whole bib that is on the list. It is in that runner's
  set without a person looking.
- **part read**: a confident read with ``?`` in it that fits at least one bib. It is
  "Could be you" for every bib it fits, and nobody's own until a person confirms it
  (ADR-058).
- **review**: everything else, with the reason. Below the confidence threshold, a whole
  number that is not on the list, a pattern that fits nothing, or no digits at all.

The threshold is a flag on ``photos tag``, provisional until the first real run.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from .reader import BibRead

DEFAULT_THRESHOLD = 0.9


class Outcome(StrEnum):
    TAGGED = "tagged"
    PART_READ = "part_read"
    REVIEW = "review"


class Reason(StrEnum):
    LOW_CONFIDENCE = "low_confidence"
    NOT_A_BIB = "not_a_bib"
    FITS_NOTHING = "fits_nothing"
    UNREADABLE = "unreadable"


@dataclass(frozen=True)
class Classified:
    outcome: Outcome
    reason: Reason | None
    fits: tuple[str, ...]
    """The bibs this read could be: the bib itself for a whole read on the list, every
    fitting bib for a part read, nothing otherwise."""


def fits(pattern: str, bibs: frozenset[str]) -> tuple[str, ...]:
    """The bibs a part-read pattern such as ``12?`` could be, in order.

    ``?`` stands for exactly one unread digit, so a pattern only fits bibs of its own
    length, and leading zeros are digits like any other.
    """
    regex = re.compile("".join("[0-9]" if char == "?" else re.escape(char) for char in pattern))
    return tuple(sorted(bib for bib in bibs if regex.fullmatch(bib)))


def check_threshold(threshold: float) -> float:
    if not 0 < threshold <= 1:
        raise ValueError("the confidence threshold must be above 0 and at most 1")
    return threshold


def classify(read: BibRead, bibs: frozenset[str], threshold: float) -> Classified:
    if not any(char.isdigit() for char in read.text):
        return Classified(Outcome.REVIEW, Reason.UNREADABLE, ())

    if "?" in read.text:
        candidates = fits(read.text, bibs)
        if read.confidence < threshold:
            return Classified(Outcome.REVIEW, Reason.LOW_CONFIDENCE, candidates)
        if not candidates:
            return Classified(Outcome.REVIEW, Reason.FITS_NOTHING, ())
        return Classified(Outcome.PART_READ, None, candidates)

    if read.text not in bibs:
        return Classified(Outcome.REVIEW, Reason.NOT_A_BIB, ())
    if read.confidence < threshold:
        return Classified(Outcome.REVIEW, Reason.LOW_CONFIDENCE, (read.text,))
    return Classified(Outcome.TAGGED, None, (read.text,))
