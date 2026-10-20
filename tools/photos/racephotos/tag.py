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

A photo the model saw no bib in is still copied and still uploaded: a runner whose bib was
hidden may find it another way, which is slice 4's decision.
"""

from __future__ import annotations

import re
import shutil
import uuid
from collections import Counter
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


@dataclass
class TagRun:
    tagged: int = 0
    already: int = 0
    skipped: Counter = field(default_factory=Counter)
    missing_folders: list[str] = field(default_factory=list)
    uncovered: Counter = field(default_factory=Counter)


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
        seen_as = manifest.source_of(photo_fingerprint)
        if seen_as is not None:
            if seen_as == relative:
                run.already += 1
            else:
                manifest.record_skip(relative, photographer.folder, "duplicate", now)
                run.skipped["duplicate"] += 1
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
