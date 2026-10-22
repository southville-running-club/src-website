"""Counts in words: "1 photo", "2 photos", never "1 photos".

The website has ``packages/shared/src/plural.ts`` for the same rule; this is the tool's copy
of it, for the terminal and the review page, so neither spells a count its own way.
"""

from __future__ import annotations


def plural(count: int, noun: str, nouns: str | None = None) -> str:
    return f"{count} {noun if count == 1 else (nouns or noun + 's')}"


def verb(count: int, one: str, many: str) -> str:
    return one if count == 1 else many
