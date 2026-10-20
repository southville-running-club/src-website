"""The manifest: one SQLite file in the work folder that remembers everything the tool did.

A photo is saved **after every photo**, in one transaction with its reads, so a run that
is interrupted carries on where it stopped, and a run over a folder already tagged adds
nothing (the key is the original's SHA-256, not its name). Slice 2 reads this to write the
SQL file; the website never sees it.

What it holds: paths under the originals folder, the photographers' folder names, camera
keys and labels, camera wall-clock times, the reads, and what a person decided on the
laptop. What it never holds: a camera serial (camera.py hashes it), a bib list beyond the
bibs that were read, or anything about a runner but a bib.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path

from .matching import Classified, Outcome
from .reader import BibRead

SCHEMA_VERSION = "2"

# Why a photo is hidden. A person pressed H, or the tool hid the photo a camera's clock was
# set from, because it shows the photographer's phone (clocks.py). Either kind can be shown
# again with H, so the second is never a decision a person cannot undo.
HIDDEN_BY_PERSON = "person"
HIDDEN_AS_CLOCK_REFERENCE = "clock_reference"
RAW_ANSWER_KEPT = 2000

SCHEMA = """
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists cameras (
  camera_key text primary key,
  label text not null,
  decision text check (decision in ('phone', 'as_recorded')),
  offset_us integer,
  reference_fingerprint text,
  decided_at text,
  check ((decision is null) = (offset_us is null))
);

create table if not exists photos (
  fingerprint text primary key,
  photo_id text not null unique,
  short_id text not null unique,
  sequence integer not null unique,
  source text not null,
  folder text not null,
  camera_key text not null references cameras (camera_key),
  recorded text,
  taken_at text,
  time_problem text check (time_problem in ('repeated_hour', 'skipped_hour')),
  burst_id text,
  reader_problem text,
  raw_answer text,
  no_bib_decided_at text,
  hidden_at text,
  hidden_reason text check (hidden_reason in ('person', 'clock_reference')),
  tagged_at text not null,
  width integer not null,
  height integer not null,
  bytes_full integer not null,
  bytes_medium integer not null,
  bytes_thumb integer not null,
  check ((hidden_at is null) = (hidden_reason is null))
);

create table if not exists reads (
  id integer primary key,
  fingerprint text not null references photos (fingerprint),
  source text not null check (source in ('model', 'person')),
  text text not null,
  confidence real,
  outcome text not null check (outcome in ('tagged', 'part_read', 'review', 'person')),
  reason text,
  fits text not null,
  threshold real,
  decision text check (decision in ('confirmed', 'corrected', 'kept_part_read', 'rejected', 'burst')),
  bib text,
  decided_at text
);
create index if not exists reads_by_photo on reads (fingerprint);

create table if not exists skipped (
  source text primary key,
  folder text not null,
  kind text not null,
  seen_at text not null
);

create table if not exists uploads (
  fingerprint text not null references photos (fingerprint),
  size text not null,
  dry_run integer not null check (dry_run in (0, 1)),
  key text not null,
  sha256 text not null,
  bytes integer not null,
  done_at text not null,
  primary key (fingerprint, size, dry_run)
);
"""


class ManifestError(ValueError):
    pass


class State(StrEnum):
    TAGGED = "tagged"
    CHECKED = "checked"
    PART_READ = "part_read"
    NEEDS_CHECK = "needs_check"
    NO_BIB_SEEN = "no_bib_seen"
    HIDDEN = "hidden"


@dataclass(frozen=True)
class NewRead:
    read: BibRead
    classified: Classified
    threshold: float


@dataclass(frozen=True)
class NewPhoto:
    fingerprint: str
    photo_id: str
    short_id: str
    sequence: int
    source: str
    folder: str
    camera_key: str
    camera_label: str
    recorded: datetime | None
    reads: tuple[NewRead, ...]
    reader_problem: str | None
    raw_answer: str | None
    width: int
    height: int
    sizes: dict[str, int] = field(default_factory=dict)


def wall_text(wall: datetime | None) -> str | None:
    return None if wall is None else wall.isoformat(timespec="microseconds")


def wall_value(text: str | None) -> datetime | None:
    return None if text is None else datetime.fromisoformat(text)


def photo_state(photo: sqlite3.Row, reads: list[sqlite3.Row]) -> State:
    if photo["hidden_at"]:
        return State.HIDDEN
    if photo["no_bib_decided_at"]:
        return State.CHECKED
    undecided = [read for read in reads if read["decision"] is None]
    if any(read["outcome"] == Outcome.REVIEW for read in undecided):
        return State.NEEDS_CHECK
    if photo["reader_problem"] and not any(read["source"] == "person" for read in reads):
        return State.NEEDS_CHECK
    if any(read["outcome"] == Outcome.PART_READ for read in undecided):
        return State.PART_READ
    if not reads:
        return State.NO_BIB_SEEN
    if any(read["decision"] for read in reads):
        return State.CHECKED
    return State.TAGGED


class Manifest:
    def __init__(self, db: sqlite3.Connection):
        self.db = db

    @classmethod
    def open(cls, path: Path, event_slug: str) -> "Manifest":
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("pragma foreign_keys = on")
        # WAL lets the review page read while a tag run is writing, which is the normal
        # case on the night: one photographer's folder arriving late.
        db.execute("pragma journal_mode = wal")
        with db:
            db.executescript(SCHEMA)
            db.execute("insert or ignore into meta values ('schema_version', ?)", (SCHEMA_VERSION,))
            db.execute("insert or ignore into meta values ('event_slug', ?)", (event_slug,))
        stored = dict(db.execute("select key, value from meta").fetchall())
        if stored["schema_version"] != SCHEMA_VERSION:
            raise ManifestError(f"{path} was written by a different version of this tool.")
        if stored["event_slug"] != event_slug:
            db.close()
            raise ManifestError(
                f"{path} belongs to {stored['event_slug']}, not {event_slug}. Use a separate "
                "work folder for each running of the race."
            )
        return cls(db)

    def close(self) -> None:
        self.db.close()

    # Tagging

    def source_of(self, fingerprint: str) -> str | None:
        row = self.db.execute("select source from photos where fingerprint = ?", (fingerprint,)).fetchone()
        return row["source"] if row else None

    def next_sequence(self) -> int:
        return self.db.execute("select coalesce(max(sequence), 0) + 1 from photos").fetchone()[0]

    def record_skip(self, source: str, folder: str, kind: str, now: str) -> None:
        with self.db:
            self.db.execute(
                "insert into skipped values (?, ?, ?, ?) on conflict (source) do update "
                "set folder = excluded.folder, kind = excluded.kind, seen_at = excluded.seen_at",
                (source, folder, kind, now),
            )

    def add_photo(self, photo: NewPhoto, now: str) -> None:
        with self.db:
            self.db.execute(
                "insert into cameras (camera_key, label) values (?, ?) on conflict do nothing",
                (photo.camera_key, photo.camera_label),
            )
            self.db.execute(
                "insert into photos (fingerprint, photo_id, short_id, sequence, source, folder, "
                "camera_key, recorded, reader_problem, raw_answer, tagged_at, width, height, "
                "bytes_full, bytes_medium, bytes_thumb) values "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    photo.fingerprint,
                    photo.photo_id,
                    photo.short_id,
                    photo.sequence,
                    photo.source,
                    photo.folder,
                    photo.camera_key,
                    wall_text(photo.recorded),
                    photo.reader_problem,
                    photo.raw_answer[:RAW_ANSWER_KEPT] if photo.raw_answer else None,
                    now,
                    photo.width,
                    photo.height,
                    photo.sizes["full"],
                    photo.sizes["medium"],
                    photo.sizes["thumb"],
                ),
            )
            for new in photo.reads:
                self.db.execute(
                    "insert into reads (fingerprint, source, text, confidence, outcome, reason, "
                    "fits, threshold, bib) values (?, 'model', ?, ?, ?, ?, ?, ?, ?)",
                    (
                        photo.fingerprint,
                        new.read.text,
                        new.read.confidence,
                        new.classified.outcome.value,
                        new.classified.reason.value if new.classified.reason else None,
                        json.dumps(list(new.classified.fits)),
                        new.threshold,
                        new.read.text if new.classified.outcome == Outcome.TAGGED else None,
                    ),
                )
            self.db.execute("delete from skipped where source = ?", (photo.source,))

    def set_bursts(self, bursts: dict[str, str | None]) -> None:
        with self.db:
            self.db.executemany(
                "update photos set burst_id = ? where fingerprint = ?",
                [(burst, fingerprint) for fingerprint, burst in bursts.items()],
            )

    # Reading

    def photos(self) -> list[sqlite3.Row]:
        return self.db.execute("select * from photos order by sequence").fetchall()

    def photo(self, *, short_id: str | None = None, photo_id: str | None = None,
              fingerprint: str | None = None) -> sqlite3.Row | None:
        column, value = next(
            (column, value)
            for column, value in (("short_id", short_id), ("photo_id", photo_id), ("fingerprint", fingerprint))
            if value is not None
        )
        return self.db.execute(f"select * from photos where {column} = ?", (value,)).fetchone()

    def reads(self, fingerprint: str) -> list[sqlite3.Row]:
        return self.db.execute("select * from reads where fingerprint = ? order by id", (fingerprint,)).fetchall()

    def reads_by_photo(self) -> dict[str, list[sqlite3.Row]]:
        grouped: dict[str, list[sqlite3.Row]] = {}
        for read in self.db.execute("select * from reads order by id"):
            grouped.setdefault(read["fingerprint"], []).append(read)
        return grouped

    def states(self) -> dict[str, State]:
        reads = self.reads_by_photo()
        return {photo["fingerprint"]: photo_state(photo, reads.get(photo["fingerprint"], [])) for photo in self.photos()}

    def state(self, fingerprint: str) -> State:
        photo = self.photo(fingerprint=fingerprint)
        return photo_state(photo, self.reads(fingerprint))

    def cameras(self) -> list[sqlite3.Row]:
        return self.db.execute("select * from cameras order by label, camera_key").fetchall()

    def camera(self, camera_key: str) -> sqlite3.Row | None:
        return self.db.execute("select * from cameras where camera_key = ?", (camera_key,)).fetchone()

    def skipped(self) -> list[sqlite3.Row]:
        return self.db.execute("select * from skipped order by source").fetchall()

    # Clocks

    def set_camera_decision(self, camera_key: str, decision: str, offset_us: int,
                            reference: str | None, now: str) -> None:
        with self.db:
            self.db.execute(
                "update cameras set decision = ?, offset_us = ?, reference_fingerprint = ?, "
                "decided_at = ? where camera_key = ?",
                (decision, offset_us, reference, now, camera_key),
            )

    def set_times(self, times: list[tuple[str, str | None, str | None]]) -> None:
        """(fingerprint, taken_at, time_problem) for each photo."""
        with self.db:
            self.db.executemany(
                "update photos set taken_at = ?, time_problem = ? where fingerprint = ?",
                [(taken_at, problem, fingerprint) for fingerprint, taken_at, problem in times],
            )

    # Decisions on the laptop

    def decide_read(self, read_id: int, decision: str, bib: str | None, now: str) -> None:
        with self.db:
            self.db.execute(
                "update reads set decision = ?, bib = ?, decided_at = ? where id = ?",
                (decision, bib, now, read_id),
            )

    def add_person_read(self, fingerprint: str, bib: str, decision: str, now: str) -> None:
        with self.db:
            self.db.execute(
                "insert into reads (fingerprint, source, text, outcome, fits, decision, bib, decided_at) "
                "values (?, 'person', ?, 'person', ?, ?, ?, ?)",
                (fingerprint, bib, json.dumps([bib]), decision, bib, now),
            )

    def no_bib_visible(self, fingerprint: str, now: str) -> None:
        with self.db:
            self.db.execute(
                "update reads set decision = 'rejected', bib = null, decided_at = ? "
                "where fingerprint = ? and decision is null",
                (now, fingerprint),
            )
            self.db.execute("update photos set no_bib_decided_at = ? where fingerprint = ?", (now, fingerprint))

    def hide(self, fingerprint: str, now: str, reason: str = HIDDEN_BY_PERSON) -> None:
        with self.db:
            self.db.execute(
                "update photos set hidden_at = ?, hidden_reason = ? where fingerprint = ?",
                (now, reason, fingerprint),
            )

    def show(self, fingerprint: str) -> None:
        with self.db:
            self.db.execute(
                "update photos set hidden_at = null, hidden_reason = null where fingerprint = ?",
                (fingerprint,),
            )

    # Uploads

    def uploaded(self, fingerprint: str, size: str, *, dry_run: bool) -> bool:
        return self.db.execute(
            "select 1 from uploads where fingerprint = ? and size = ? and dry_run = ?",
            (fingerprint, size, int(dry_run)),
        ).fetchone() is not None

    def record_upload(self, fingerprint: str, size: str, *, dry_run: bool, key: str,
                      sha256: str, length: int, now: str) -> None:
        with self.db:
            self.db.execute(
                "insert into uploads values (?, ?, ?, ?, ?, ?, ?)",
                (fingerprint, size, int(dry_run), key, sha256, length, now),
            )

    def uploads(self, *, dry_run: bool) -> list[sqlite3.Row]:
        return self.db.execute(
            "select * from uploads where dry_run = ? order by key", (int(dry_run),)
        ).fetchall()
