"""``photos tag``: read every photo once, make its copies, ask for its bibs, save it.

For each JPEG under a listed photographer's folder, in a stable order:

1. Fingerprint it. One already in the manifest is skipped, so a rerun adds nothing.
2. Read its time and camera (camera.py), make the three stripped copies (copies.py) and
   write them to the work folder.
3. Send the **medium copy only** to the reader, and parse its answer strictly. A reader
   that fails or answers nonsense sends the photo to review; it never stops the run.
4. Check each read against the bib list (matching.py) and save the photo, its reads and its
   camera in one transaction.

Anything that is not a JPEG is listed as skipped, per photographer, and never silently
dropped. Afterwards, bursts and corrected times are worked out again for every photo.

**A photo already in the manifest that turns up at a new path, with its old path gone, has
been moved**, most likely because a photographer's folder was split into one folder per
spot after a first run. It is filed under its new path and folder, so its credit and spot
follow, and keeps its short ID, its camera's clock decision and its reads. If the old path
is still there too, the new one is a duplicate. A photo whose path is unchanged but which a
different row of photographers.csv now covers is filed under that row in the same way.

A photo the model saw no bib in is still copied and still uploaded: a runner whose bib was
hidden may find it another way, which is slice 4's decision.
"""

from __future__ import annotations

import re
import shutil
import uuid
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import clocks
from .bursts import Timed, assign_bursts
from .camera import read_camera
from .config import Config
from .copies import UnreadablePhoto, make_copies, open_original
from .files import files_under, fingerprint, kind_of, uncovered
from .inputs import Photographer, load_bibs, load_photographers
from .london_time import to_utc_iso, utc_now
from .manifest import Manifest, NewPhoto, NewRead, wall_value
from .matching import check_threshold, classify
from .reader import BibReader, parse_reads

PHOTO_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
PROGRESS_EVERY = 25
LOCK_NAME = "tag.lock"
BUSY = "Another tag run is using this work folder. Wait for it to finish."

try:
    import fcntl
except ImportError:  # Windows has no flock; see only_one_tag_run()
    fcntl = None


class TagBusy(ValueError):
    pass


@contextmanager
def only_one_tag_run(work: Path):
    """Refuse a second ``photos tag`` on the same work folder while one is running.

    Two runs at once would both take the next short ID and the second would fail on the
    manifest's unique constraint, with a database error in the middle of somebody's evening.
    This takes an exclusive lock on ``tag.lock`` in the work folder instead, and says so in
    words. The operating system drops the lock when the process ends, however it ends, so a
    run that was stopped or crashed never leaves the folder locked. The review page and the
    dry-run upload do not take it.

    On Windows there is no flock and no lock is taken; the unique constraint still refuses
    the clash, less politely. Both volunteers are on macOS.
    """
    if fcntl is None:
        yield
        return
    work.mkdir(parents=True, exist_ok=True)
    with (work / LOCK_NAME).open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise TagBusy(BUSY) from None
        yield


@dataclass
class TagRun:
    tagged: int = 0
    already: int = 0
    skipped: Counter = field(default_factory=Counter)
    missing_folders: list[str] = field(default_factory=list)
    uncovered: Counter = field(default_factory=Counter)
    moved: list[tuple[str, str]] = field(default_factory=list)
    """(old folder, new folder) for each photo filed somewhere new this run."""


def short_id(prefix: str, sequence: int) -> str:
    return f"{prefix}-{sequence:04d}"


def sweep_partial_copies(copies_dir: Path, known: set[str]) -> None:
    """Remove copies a run wrote but never saved, because it was stopped in between. Only
    folders named the way this tool names them are touched."""
    if not copies_dir.is_dir():
        return
    for entry in copies_dir.iterdir():
        partial = entry.name.startswith(".") and entry.name.endswith(".partial")
        orphan = PHOTO_ID.fullmatch(entry.name) and entry.name not in known
        if entry.is_dir() and (partial or orphan):
            shutil.rmtree(entry)


def write_copies(copies_dir: Path, photo_id: str, images: dict[str, bytes]) -> None:
    partial = copies_dir / f".{photo_id}.partial"
    partial.mkdir(parents=True)
    for name, data in images.items():
        (partial / f"{name}.jpg").write_bytes(data)
    partial.replace(copies_dir / photo_id)


def ask(reader: BibReader, medium: bytes, photo_fingerprint: str) -> tuple[str | None, str | None]:
    """(raw answer, problem). A reader that raises is a problem, never a crash; only the
    exception's type is kept, because a provider's error text can carry a request or a key."""
    try:
        return reader.read(medium, photo_fingerprint), None
    except Exception as error:  # noqa: BLE001 — any reader failure sends the photo to a person
        return None, f"the reader failed ({type(error).__name__})"


def run_tag(config: Config, reader: BibReader, threshold: float,
            say: Callable[[str], None] = print) -> TagRun:
    check_threshold(threshold)
    with only_one_tag_run(config.work):
        say(f"Tagging the photos in {config.originals}")
        bibs = load_bibs(config.bibs_csv).bibs
        photographers = load_photographers(config.photographers_csv)
        manifest = Manifest.open(config.manifest_path, config.event_slug)
        try:
            return _tag(config, manifest, photographers, bibs, reader, threshold, say)
        finally:
            manifest.close()


def _candidates(config: Config, photographers: tuple[Photographer, ...], run: TagRun):
    for photographer in photographers:
        folder = config.originals / photographer.folder
        if not folder.is_dir():
            run.missing_folders.append(photographer.folder)
            continue
        for path in files_under(folder):
            yield path, path.relative_to(config.originals).as_posix(), photographer


def _tag(config, manifest, photographers, bibs, reader, threshold, say) -> TagRun:
    run = TagRun()
    sweep_partial_copies(config.copies_dir, {photo["photo_id"] for photo in manifest.photos()})

    candidates = list(_candidates(config, photographers, run))
    total = len(candidates)
    for number, (path, relative, photographer) in enumerate(candidates, start=1):
        if number % PROGRESS_EVERY == 0:
            say(f"  {number} of {total} files looked at")
        now = to_utc_iso(utc_now())

        kind = kind_of(path)
        if kind is None:
            continue
        if kind != "jpeg":
            manifest.record_skip(relative, photographer.folder, kind, now)
            run.skipped[kind] += 1
            continue

        photo_fingerprint = fingerprint(path)
        filed = manifest.photo(fingerprint=photo_fingerprint)
        if filed is not None:
            elsewhere = filed["source"] != relative
            if elsewhere and (config.originals / filed["source"]).exists():
                manifest.record_skip(relative, photographer.folder, "duplicate", now)
                run.skipped["duplicate"] += 1
            elif elsewhere or filed["folder"] != photographer.folder:
                manifest.move_photo(photo_fingerprint, relative, photographer.folder)
                run.moved.append((filed["folder"], photographer.folder))
            else:
                run.already += 1
            continue

        try:
            with open_original(path) as image:
                facts = read_camera(image, photographer.credit)
                copies = make_copies(image)
        except UnreadablePhoto:
            manifest.record_skip(relative, photographer.folder, "unreadable", now)
            run.skipped["unreadable"] += 1
            continue

        photo_id = str(uuid.uuid4())
        write_copies(config.copies_dir, photo_id, copies.images)

        raw, problem = ask(reader, copies.images["medium"], photo_fingerprint)
        parsed = parse_reads(raw) if problem is None else None
        if parsed is not None and not parsed.ok:
            problem = parsed.problem
        reads = () if parsed is None else tuple(
            NewRead(read, classify(read, bibs, threshold), threshold) for read in parsed.reads
        )

        sequence = manifest.next_sequence()
        manifest.add_photo(
            NewPhoto(
                fingerprint=photo_fingerprint,
                photo_id=photo_id,
                short_id=short_id(config.short_id_prefix, sequence),
                sequence=sequence,
                source=relative,
                folder=photographer.folder,
                camera_key=facts.camera_key,
                camera_label=facts.camera_label,
                recorded=facts.recorded,
                reads=reads,
                reader_problem=problem,
                raw_answer=raw if problem else None,
                width=copies.dimensions["full"][0],
                height=copies.dimensions["full"][1],
                sizes={name: len(data) for name, data in copies.images.items()},
            ),
            now,
        )
        run.tagged += 1

    photos = manifest.photos()
    manifest.set_bursts(
        assign_bursts([
            Timed(photo["fingerprint"], photo["camera_key"], wall_value(photo["recorded"]), photo["short_id"])
            for photo in photos
        ])
    )
    clocks.refresh_times(manifest)
    run.uncovered = uncovered(config.originals, photographers)
    return run
