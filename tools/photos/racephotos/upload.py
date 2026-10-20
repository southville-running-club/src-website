"""``photos upload --dry-run``: write exactly what R2 would hold, to a local folder.

Each visible photo's three copies go to ``<event slug>/<photo id>/{full,medium,thumb}.jpg``,
the key layout of the bucket, under the work folder's ``dry-run/``, with a ``keys.tsv``
listing every key, its size, its SHA-256 (base64, the form R2's checksum header takes) and
its content type. Nothing leaves the laptop.

The real upload, and the SQL file of every read, come with slice 2. Until then this
refuses without ``--dry-run``, and **a dry run never marks a photo as uploaded for real**:
the manifest keeps the two apart, so the real upload cannot skip a photo because it was
rehearsed.

Upload waits until every camera's clock is decided, and never sends a hidden photo. Each
copy is checked against the allowlist again on the way out, so nothing reaches the bucket
that the check would refuse.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from pathlib import Path

from . import clocks
from .config import Config
from .copies import SIZE_NAMES
from .jpeg import MetadataLeft, check_copy
from .london_time import to_utc_iso, utc_now
from .manifest import Manifest

CONTENT_TYPE = "image/jpeg"


class UploadRefused(ValueError):
    pass


@dataclass
class UploadRun:
    written: int = 0
    already: int = 0
    photos: int = 0
    hidden: int = 0
    hidden_after_upload: int = 0
    without_time: int = 0
    destination: Path | None = None
    keys_file: Path | None = None


def object_key(event_slug: str, photo_id: str, size: str) -> str:
    return f"{event_slug}/{photo_id}/{size}.jpg"


def checksum(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def run_upload(config: Config, *, dry_run: bool) -> UploadRun:
    if not dry_run:
        raise UploadRefused(
            "The real upload to R2 is not built yet; it comes with slice 2. Use --dry-run to "
            "write the same layout to a folder on this laptop."
        )
    manifest = Manifest.open(config.manifest_path, config.event_slug)
    try:
        return _dry_run(config, manifest)
    finally:
        manifest.close()


def _dry_run(config: Config, manifest: Manifest) -> UploadRun:
    waiting = clocks.undecided(manifest)
    if waiting:
        names = "; ".join(f"{camera.label} in {', '.join(camera.folders)}" for camera in waiting)
        raise UploadRefused(
            f"Upload waits until every camera's clock is decided. {len(waiting)} still need a "
            f"phone time or a decision to keep their time as recorded: {names}. "
            "Use ./photos review, Camera clocks."
        )

    run = UploadRun(destination=config.dry_run_dir)
    for photo in manifest.photos():
        if photo["hidden_at"]:
            run.hidden += 1
            if manifest.uploaded(photo["fingerprint"], "full", dry_run=True):
                run.hidden_after_upload += 1
            continue
        run.photos += 1
        if photo["recorded"] and not photo["taken_at"]:
            run.without_time += 1
        for size in SIZE_NAMES:
            if manifest.uploaded(photo["fingerprint"], size, dry_run=True):
                run.already += 1
                continue
            source = config.copies_dir / photo["photo_id"] / f"{size}.jpg"
            if not source.is_file():
                raise UploadRefused(
                    f"The {size} copy of {photo['short_id']} is missing from {config.copies_dir}. "
                    "Copies are only written by ./photos tag, so something removed it afterwards. "
                    "Nothing after it was written; ask before going further."
                )
            data = source.read_bytes()
            try:
                check_copy(data)
            except MetadataLeft as problem:
                raise UploadRefused(
                    f"The {size} copy of {photo['short_id']} holds {problem}, so it was not written. "
                    "Copies are checked when ./photos tag writes them, so this one was changed "
                    "afterwards. Nothing after it was written; ask before going further."
                ) from None
            key = object_key(config.event_slug, photo["photo_id"], size)
            target = config.dry_run_dir / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            manifest.record_upload(
                photo["fingerprint"], size, dry_run=True, key=key, sha256=checksum(data),
                length=len(data), now=to_utc_iso(utc_now()),
            )
            run.written += 1

    run.keys_file = config.dry_run_dir / "keys.tsv"
    run.keys_file.parent.mkdir(parents=True, exist_ok=True)
    lines = ["key\tbytes\tsha256_base64\tcontent_type"] + [
        f"{row['key']}\t{row['bytes']}\t{row['sha256']}\t{CONTENT_TYPE}" for row in manifest.uploads(dry_run=True)
    ]
    run.keys_file.write_text("\n".join(lines) + "\n")
    return run
