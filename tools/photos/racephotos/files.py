"""Fingerprints, and what kind of file something in a photographer's folder is."""

from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path
from typing import Iterator

from .inputs import Photographer

JPEG = {".jpg", ".jpeg"}
RAW = {
    ".3fr", ".arw", ".cr2", ".cr3", ".crw", ".dng", ".iiq", ".nef", ".nrw", ".orf", ".pef",
    ".raf", ".rw2", ".rwl", ".sr2", ".srf", ".srw", ".x3f",
}
HEIC = {".heic", ".heif", ".hif"}
VIDEO = {".avi", ".m4v", ".mov", ".mp4", ".mts"}

# What a person sees on the Start screen and in the terminal. HEIC is called out by name
# because somebody shooting on an iPhone may send nothing else, and that needs seeing on the
# night rather than discovering afterwards that a whole spot is missing.
SKIP_LABELS = {
    "heic": "HEIC (iPhone)",
    "raw": "RAW",
    "video": "video",
    "macos_sidecar": "macOS ._ file",
    "not_a_photo": "not a photo",
    "unreadable": "unreadable",
    "duplicate": "duplicate",
}


def fingerprint(path: Path) -> str:
    """SHA-256 of the file's bytes. The manifest's key: a file it has seen is never read
    twice, whatever it is called or wherever it has been moved."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def kind_of(path: Path) -> str | None:
    """``jpeg``, a skip kind from SKIP_LABELS, or None for a file to ignore without
    mentioning it (``.DS_Store`` and other hidden files)."""
    name = path.name
    if name.startswith("._"):
        # The resource-fork sidecar macOS writes when a file is copied to a disk that
        # cannot hold one. "._IMG_0001.JPG" ends in .JPG and is not a photo.
        return "macos_sidecar"
    if name.startswith("."):
        return None
    suffix = path.suffix.lower()
    if suffix in JPEG:
        return "jpeg"
    if suffix in HEIC:
        return "heic"
    if suffix in RAW:
        return "raw"
    if suffix in VIDEO:
        return "video"
    return "not_a_photo"


def files_under(root: Path) -> Iterator[Path]:
    """Every file under ``root``, in a stable order, skipping hidden folders."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part.startswith(".") for part in relative.parts[:-1]):
            continue
        if path.is_file():
            yield path


def covered(relative: str, photographers: tuple[Photographer, ...]) -> Photographer | None:
    """The photographer whose folder holds this path under the originals folder."""
    key = relative.casefold()
    for photographer in photographers:
        folder = photographer.folder.casefold()
        if key.startswith(folder + "/"):
            return photographer
    return None


def uncovered(originals: Path, photographers: tuple[Photographer, ...]) -> Counter:
    """Photos under the originals folder that no listed folder holds, counted by the
    top-level folder they are in, so a photographer missing from photographers.csv is
    reported rather than silently left out."""
    counts: Counter = Counter()
    for path in files_under(originals):
        if kind_of(path) is None:
            continue
        relative = path.relative_to(originals).as_posix()
        if covered(relative, photographers) is None:
            parts = relative.split("/")
            counts[parts[0] if len(parts) > 1 else "(the originals folder itself)"] += 1
    return counts
