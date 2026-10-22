"""Where things stand: counts per step and per photographer, and the next thing to do.

The terminal summary after ``photos tag`` and the review page's Start screen both read
this, so the two can never disagree about how many photos need checking or how many files
were skipped.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from . import clocks
from .config import Config
from .copies import SIZE_NAMES
from .files import uncovered
from .inputs import Photographer
from .manifest import Manifest, State
from .words import plural, verb


@dataclass(frozen=True)
class FolderRow:
    folder: str
    credit: str
    spot: str
    listed: bool
    present: bool
    photos: int
    states: Counter
    skipped: Counter


@dataclass(frozen=True)
class Overview:
    folders: tuple[FolderRow, ...]
    uncovered: Counter
    photos: int
    states: Counter
    skipped: Counter
    cameras: int
    cameras_decided: int
    cameras_flagged: int
    timeless: int
    average_bytes: dict[str, int]
    dry_run_uploaded: int

    @property
    def cameras_left(self) -> int:
        return self.cameras - self.cameras_decided

    @property
    def next_step(self) -> str:
        if not self.photos:
            return "Tag the photos: ./photos tag"
        if self.cameras_left:
            return (
                f"Fix the camera clocks: {self.cameras_left} of {plural(self.cameras, 'camera')} still "
                f"{verb(self.cameras_left, 'needs', 'need')} a phone time or a decision to keep the time as recorded."
            )
        unsure = self.states[State.NEEDS_CHECK]
        then = (
            f" {plural(unsure, 'photo')} still {verb(unsure, 'needs', 'need')} checking, here or on the website."
            if unsure else ""
        )
        return f"Ready for ./photos upload --dry-run.{then}"


def build_overview(config: Config, manifest: Manifest, photographers: tuple[Photographer, ...]) -> Overview:
    photos = manifest.photos()
    states = manifest.states()
    by_folder_photos: dict[str, Counter] = {}
    by_folder_count: Counter = Counter()
    for photo in photos:
        by_folder_count[photo["folder"]] += 1
        by_folder_photos.setdefault(photo["folder"], Counter())[states[photo["fingerprint"]]] += 1

    skipped_rows = manifest.skipped()
    by_folder_skipped: dict[str, Counter] = {}
    for row in skipped_rows:
        by_folder_skipped.setdefault(row["folder"], Counter())[row["kind"]] += 1

    rows = [
        FolderRow(
            folder=photographer.folder,
            credit=photographer.credit,
            spot=photographer.spot,
            listed=True,
            present=(config.originals / photographer.folder).is_dir(),
            photos=by_folder_count[photographer.folder],
            states=by_folder_photos.get(photographer.folder, Counter()),
            skipped=by_folder_skipped.get(photographer.folder, Counter()),
        )
        for photographer in photographers
    ]
    listed = {photographer.folder for photographer in photographers}
    for folder in sorted((set(by_folder_count) | set(by_folder_skipped)) - listed):
        rows.append(
            FolderRow(folder, "", "", False, True, by_folder_count[folder],
                      by_folder_photos.get(folder, Counter()), by_folder_skipped.get(folder, Counter()))
        )

    cameras = clocks.summaries(manifest)
    uploaded = Counter(row["fingerprint"] for row in manifest.uploads(dry_run=True))

    return Overview(
        folders=tuple(rows),
        uncovered=uncovered(config.originals, photographers),
        photos=len(photos),
        states=Counter(states.values()),
        skipped=Counter(row["kind"] for row in skipped_rows),
        cameras=len(cameras),
        cameras_decided=sum(1 for camera in cameras if camera.decided),
        cameras_flagged=sum(1 for camera in cameras if camera.flagged),
        timeless=sum(camera.timeless for camera in cameras),
        average_bytes={
            name: round(sum(photo[f"bytes_{name}"] for photo in photos) / len(photos)) if photos else 0
            for name in SIZE_NAMES
        },
        dry_run_uploaded=sum(1 for count in uploaded.values() if count == len(SIZE_NAMES)),
    )


def human_bytes(count: int) -> str:
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f} MB"
    return f"{round(count / 1000)} KB"
