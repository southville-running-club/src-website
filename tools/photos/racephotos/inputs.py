"""The two input files, and the refusals that keep them honest.

``bibs.csv`` is one column, ``bib``, and nothing else. It is exported from the entries, and
the entries hold names, email addresses and dates of birth: a file with a second column is
a file that may be carrying them, so it is refused rather than trimmed (ADR-059). Every
message here names a row number or a column count and **never quotes a cell**, because a
refusal that printed the offending value would print the personal data it exists to keep
out — and a file with no heading row has data where the heading should be.

``photographers.csv`` maps a folder of originals to the photographer's credit and the spot
they stood at. Spots and credits are data, never copy. A folder may be a relative path
(``Adrian/Finish``), so somebody who moves spot during the race splits their photos into one
folder per spot.

Bibs are text, never numbers: ``0311`` and ``311`` are different bibs, and a parse to
``int`` would quietly make them one.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class InputError(ValueError):
    """A refusal, worded for the person running the tool."""


BIB = re.compile(r"[0-9]{1,8}")


@dataclass(frozen=True)
class BibList:
    bibs: frozenset[str]
    duplicates: int


@dataclass(frozen=True)
class Photographer:
    folder: str
    """A relative POSIX path under the originals folder, such as ``Adrian/Finish``."""
    credit: str
    spot: str


def _rows(path: Path) -> list[tuple[int, list[str]]]:
    """Non-blank rows with their 1-based line numbers, cells stripped."""
    try:
        # utf-8-sig drops the byte-order mark Excel writes at the start of a CSV export,
        # which would otherwise make the heading read as "﻿bib" and be refused.
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        raise InputError(f"{path.name} was not found at {path}.") from None
    except UnicodeDecodeError:
        raise InputError(f"{path.name} is not UTF-8 text. Save it as CSV UTF-8.") from None

    rows = []
    for number, row in enumerate(csv.reader(io.StringIO(text, newline="")), start=1):
        cells = [cell.strip() for cell in row]
        if any(cells):
            rows.append((number, cells))
    return rows


def load_bibs(path: Path) -> BibList:
    rows = _rows(path)
    if not rows:
        raise InputError(f"{path.name} is empty. It needs a heading row, bib, then one bib per row.")

    why = (
        "Names and email addresses must never reach this tool, so the file is refused rather "
        "than trimmed. Export the bib column on its own."
    )
    number, heading = rows[0]
    if len(heading) != 1:
        raise InputError(
            f"{path.name} must have exactly one column, named bib. Row {number} has "
            f"{len(heading)} columns. {why}"
        )
    if heading[0].lower() != "bib":
        raise InputError(f"{path.name}'s first row must be the heading bib, on its own. {why}")

    bibs: set[str] = set()
    duplicates = 0
    for number, cells in rows[1:]:
        if len(cells) != 1:
            raise InputError(
                f"{path.name} must have exactly one column, named bib. Row {number} has "
                f"{len(cells)} columns. {why}"
            )
        if not BIB.fullmatch(cells[0]):
            raise InputError(
                f"{path.name} row {number} is not a bib number. A bib is digits only, up to "
                "eight of them."
            )
        if cells[0] in bibs:
            duplicates += 1
        bibs.add(cells[0])

    if not bibs:
        raise InputError(f"{path.name} has a heading but no bibs.")
    return BibList(frozenset(bibs), duplicates)


def _folder(value: str, path: Path, number: int) -> str:
    problem = (
        f"{path.name} row {number}: the folder must be a path inside the originals folder, "
        "such as Adrian or Adrian/Finish"
    )
    if not value or "\\" in value:
        raise InputError(f"{problem}. Use / between folders.")
    folder = PurePosixPath(value.rstrip("/"))
    if folder.is_absolute():
        raise InputError(f"{problem}, not an absolute path.")
    if any(part in ("", ".", "..") or part.startswith(".") for part in folder.parts):
        raise InputError(f"{problem}, with no . or .. and no hidden folders.")
    return folder.as_posix()


def load_photographers(path: Path) -> tuple[Photographer, ...]:
    rows = _rows(path)
    if not rows:
        raise InputError(f"{path.name} is empty. It needs the heading row folder,credit,spot.")

    number, heading = rows[0]
    if [cell.lower() for cell in heading] != ["folder", "credit", "spot"]:
        raise InputError(f"{path.name}'s first row must be the headings folder,credit,spot.")

    photographers: list[Photographer] = []
    for number, cells in rows[1:]:
        if len(cells) != 3:
            raise InputError(f"{path.name} row {number} has {len(cells)} columns, not 3.")
        folder, credit, spot = cells
        if not credit or not spot:
            raise InputError(f"{path.name} row {number} needs a credit and a spot.")
        photographers.append(Photographer(_folder(folder, path, number), credit, spot))

    if not photographers:
        raise InputError(f"{path.name} has headings but no photographers.")

    # Compared case-folded because the Mac's disk is case-insensitive: "Adrian" and "adrian"
    # are the same folder there, and its photos would be read twice.
    seen: dict[str, str] = {}
    for photographer in photographers:
        key = photographer.folder.casefold()
        if key in seen:
            raise InputError(f"{path.name} lists the folder {photographer.folder} twice.")
        for other_key, other in seen.items():
            if key.startswith(other_key + "/") or other_key.startswith(key + "/"):
                raise InputError(
                    f"{path.name} lists {other} and {photographer.folder}, and one is inside "
                    "the other, so its photos would be read twice. List the inner folders "
                    "only, or the outer one only."
                )
        seen[key] = photographer.folder

    return tuple(photographers)
