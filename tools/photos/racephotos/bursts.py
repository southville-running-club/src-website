"""Bursts: consecutive photos from one camera, each within two seconds of the one before.

A confirmed bib can then be offered to the rest of its burst, which is how a person checks
ten frames of one runner crossing the line in one decision rather than ten. The rule is a
chain, not a window, so a long burst at ten frames a second stays one burst however long
it runs. Times are the camera's own wall clock, because within one camera an offset makes
no difference and the clock fix may not have happened yet.

A photo on its own has no burst, and nor does one with no recorded time.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

GAP = timedelta(seconds=2)


@dataclass(frozen=True)
class Timed:
    fingerprint: str
    camera_key: str
    recorded: datetime | None
    short_id: str


def assign_bursts(photos: list[Timed]) -> dict[str, str | None]:
    """Every photo's burst ID: the short ID of the burst's first photo, or None."""
    bursts: dict[str, str | None] = {photo.fingerprint: None for photo in photos}

    by_camera: dict[str, list[Timed]] = defaultdict(list)
    for photo in photos:
        if photo.recorded is not None:
            by_camera[photo.camera_key].append(photo)

    for camera_photos in by_camera.values():
        camera_photos.sort(key=lambda photo: (photo.recorded, photo.short_id))
        group = [camera_photos[0]]
        for photo in camera_photos[1:]:
            if photo.recorded - group[-1].recorded <= GAP:
                group.append(photo)
                continue
            _name(group, bursts)
            group = [photo]
        _name(group, bursts)

    return bursts


def _name(group: list[Timed], bursts: dict[str, str | None]) -> None:
    if len(group) < 2:
        return
    for photo in group:
        bursts[photo.fingerprint] = group[0].short_id
