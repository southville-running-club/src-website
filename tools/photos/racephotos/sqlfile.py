"""The SQL file of every read, for a volunteer to run in the Supabase SQL editor (ADR-064).

There is no import endpoint and no service-role key (brief §2 decision 6): the laptop writes
plain SQL and a person pastes it into the editor, the way the race's own SQL is run. So the
file has to be safe to run by somebody who is not sure whether they already ran it.

**Running a file twice leaves exactly the same rows.** Every write is an upsert whose update
is skipped when nothing differs, so a rerun does not even move ``updated_at``.

**It never overwrites the website.** Once the team has checked a photo on the website
(``photo.checked_by``), the file leaves its ``check_state`` alone; a bib row a checker
decided (``photo_bib.decided_by``) is neither updated nor deleted; and ``hidden_at``, a
takedown, is never written at all. What the file does own it keeps current: the credit, the
spot, the corrected time and the burst, which the laptop works out again on every run.

It covers every photo whose three copies were sent in this mode (a dry run or a real
upload), in parts of ``PART_SIZE`` photos. The Supabase SQL editor documents a one-minute
timeout and no size limit, so a part is kept far smaller than a minute's work. Each part is
one transaction, and the parts can be run in any order.

The file holds no runner's name or email address (there are none in the manifest), no token
and no key. Bibs are text and keep their leading zeros, so ``001`` stays ``001``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .copies import SIZE_NAMES
from .inputs import Photographer
from .manifest import Manifest, State, photo_state

PART_SIZE = 250
PART_NAME = re.compile(r"[a-z0-9-]+-photos-part-\d{2}-of-\d{2}\.sql")
CHECK_STATES = {State.TAGGED, State.CHECKED, State.PART_READ, State.NEEDS_CHECK, State.NO_BIB_SEEN}


class SqlRefused(ValueError):
    pass


@dataclass(frozen=True)
class BibRow:
    bib_text: str
    confidence: float | None
    confirmed: bool
    source: str
    decided_at: str | None


def text(value: str) -> str:
    """A SQL string literal. Standard-conforming strings are on in Postgres, so doubling the
    single quote is the whole of the escaping; a NUL cannot be stored, so it is refused."""
    if "\x00" in value:
        raise SqlRefused("a value holds a NUL character, which Postgres cannot store")
    return "'" + value.replace("'", "''") + "'"


def literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.3f}"
    return text(str(value))


def bib_rows(reads) -> list[BibRow]:
    """What the laptop knows about a photo's bibs, one row per bib text.

    A whole bib confirmed by the model or by a person is confirmed. A part read, or a read
    still to check, is stored unconfirmed with its text, so the website can show it as
    "Could be you" or put it in front of a checker. A read a person said was no bib, and a
    read with no digit in it at all, is left out.
    """
    merged: dict[str, BibRow] = {}
    for read in reads:
        decision = read["decision"]
        if decision == "rejected":
            continue
        if decision in ("confirmed", "corrected", "burst"):
            bib = read["bib"]
            same_as_read = read["source"] == "model" and bib == read["text"]
            row = BibRow(bib, read["confidence"] if same_as_read else None, True, "person", read["decided_at"])
        elif decision == "kept_part_read":
            row = BibRow(read["text"], read["confidence"], False, "model", read["decided_at"])
        elif read["outcome"] == "tagged":
            row = BibRow(read["bib"] or read["text"], read["confidence"], True, "model", None)
        elif any(char.isdigit() for char in read["text"]):
            row = BibRow(read["text"], read["confidence"], False, "model", None)
        else:
            continue

        earlier = merged.get(row.bib_text)
        if earlier is not None:
            row = BibRow(
                row.bib_text,
                max((c for c in (earlier.confidence, row.confidence) if c is not None), default=None),
                earlier.confirmed or row.confirmed,
                "person" if "person" in (earlier.source, row.source) else "model",
                max((t for t in (earlier.decided_at, row.decided_at) if t), default=None),
            )
        merged[row.bib_text] = row
    return [merged[key] for key in sorted(merged)]


def sendable(manifest: Manifest, *, dry_run: bool) -> list:
    """Visible photos whose three copies were all sent in this mode, in short-ID order."""
    return [
        photo
        for photo in manifest.photos()
        if not photo["hidden_at"]
        and all(manifest.uploaded(photo["fingerprint"], size, dry_run=dry_run) for size in SIZE_NAMES)
    ]


def build_parts(
    event_slug: str,
    photos: list,
    reads_by_photo: dict,
    photographers: tuple[Photographer, ...],
    now: str,
) -> list[str]:
    by_folder = {photographer.folder: photographer for photographer in photographers}
    unlisted = sorted({photo["folder"] for photo in photos} - set(by_folder))
    if unlisted:
        raise SqlRefused(
            "Some uploaded photos are in folders photographers.csv no longer lists, so they have "
            f"no credit or spot: {', '.join(unlisted)}. Put the rows back, then run upload again."
        )

    chunks = [photos[start : start + PART_SIZE] for start in range(0, len(photos), PART_SIZE)]
    return [
        _part(event_slug, chunk, reads_by_photo, by_folder, now, number, len(chunks))
        for number, chunk in enumerate(chunks, start=1)
    ]


def _part(event_slug, photos, reads_by_photo, by_folder, now, number, total) -> str:
    photo_values = []
    bib_values = []
    keep_values = []
    for photo in photos:
        reads = reads_by_photo.get(photo["fingerprint"], [])
        state = photo_state(photo, reads)
        if state not in CHECK_STATES:
            raise SqlRefused(f"{photo['short_id']} is in a state the website does not know: {state}")
        photographer = by_folder[photo["folder"]]
        photo_values.append(
            "  ("
            + ", ".join(
                literal(value)
                for value in (
                    photo["photo_id"], event_slug, photo["short_id"], photographer.credit,
                    photographer.spot, photo["taken_at"], photo["burst_id"], photo["width"],
                    photo["height"], state.value,
                )
            )
            + ")"
        )
        for row in bib_rows(reads):
            bib_values.append(
                f"  ({literal(photo['photo_id'])}::uuid, {literal(row.bib_text)}, {literal(row.confidence)}, "
                f"{literal(row.confirmed)}, {literal(row.source)}, {literal(row.decided_at)}::timestamptz)"
            )
            keep_values.append(f"    ({literal(photo['photo_id'])}::uuid, {literal(row.bib_text)})")

    ids = ", ".join(f"{literal(photo['photo_id'])}::uuid" for photo in photos)
    first, last = photos[0]["short_id"], photos[-1]["short_id"]
    keep = (
        "\n   and (b.photo_id, b.bib_text) not in (\n" + ",\n".join(keep_values) + "\n   )"
        if keep_values
        else ""
    )

    lines = [
        f"-- Race photos for {event_slug}, part {number} of {total}: {first} to {last}.",
        f"-- Written by photos upload at {now}.",
        "--",
        "-- Run the whole of this file in the Supabase SQL editor. Running it again changes",
        "-- nothing, and it never overwrites a decision made on the website or a photo taken",
        "-- down there. The parts can be run in any order.",
        "",
        "begin;",
        "",
        f"insert into photos.event (slug) values ({literal(event_slug)}) on conflict (slug) do nothing;",
        "",
        "insert into photos.photo",
        "  (id, event_slug, short_id, photographer, spot, taken_at, burst_id, width, height, check_state)",
        "values",
        ",\n".join(photo_values),
        "on conflict (id) do update set",
        "  photographer = excluded.photographer,",
        "  spot = excluded.spot,",
        "  taken_at = excluded.taken_at,",
        "  burst_id = excluded.burst_id,",
        "  width = excluded.width,",
        "  height = excluded.height,",
        "  check_state = case when photos.photo.checked_by is null",
        "                     then excluded.check_state else photos.photo.check_state end,",
        "  updated_at = now()",
        "where (photos.photo.photographer, photos.photo.spot, photos.photo.taken_at,",
        "       photos.photo.burst_id, photos.photo.width, photos.photo.height,",
        "       photos.photo.check_state)",
        "      is distinct from",
        "      (excluded.photographer, excluded.spot, excluded.taken_at,",
        "       excluded.burst_id, excluded.width, excluded.height,",
        "       case when photos.photo.checked_by is null",
        "            then excluded.check_state else photos.photo.check_state end);",
        "",
        "-- Bib rows the laptop no longer has, unless a checker decided them on the website.",
        "delete from photos.photo_bib b",
        f" where b.photo_id in ({ids})",
        f"   and b.decided_by is null{keep};",
        "",
    ]
    if bib_values:
        lines += [
            "insert into photos.photo_bib",
            "  (photo_id, bib_text, confidence, confirmed, source, decided_at)",
            "values",
            ",\n".join(bib_values),
            "on conflict (photo_id, bib_text) do update set",
            "  confidence = excluded.confidence,",
            "  confirmed = excluded.confirmed,",
            "  source = excluded.source,",
            "  decided_at = excluded.decided_at",
            "where photos.photo_bib.decided_by is null",
            "  and (photos.photo_bib.confidence, photos.photo_bib.confirmed,",
            "       photos.photo_bib.source, photos.photo_bib.decided_at)",
            "      is distinct from",
            "      (excluded.confidence, excluded.confirmed, excluded.source, excluded.decided_at);",
            "",
        ]
    lines += ["commit;", ""]
    return "\n".join(lines)


def write_sql(config: Config, manifest: Manifest, photographers, *, dry_run: bool, now: str) -> list[Path]:
    """Write the parts for every photo sent in this mode, replacing any written before."""
    folder = (config.dry_run_dir if dry_run else config.work) / "sql"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.iterdir():
        if PART_NAME.fullmatch(old.name):
            old.unlink()

    photos = sendable(manifest, dry_run=dry_run)
    if not photos:
        return []
    parts = build_parts(config.event_slug, photos, manifest.reads_by_photo(), photographers, now)
    paths = []
    for number, sql in enumerate(parts, start=1):
        path = folder / f"{config.event_slug}-photos-part-{number:02d}-of-{len(parts):02d}.sql"
        path.write_text(sql, encoding="utf-8")
        paths.append(path)
    return paths
