"""Fixing each camera's clock, and turning its photos' times into UTC.

Photographers are briefed to photograph a phone clock. On the clock screen a person reads
the phone's time off that photo and types it in; the difference from what the camera
recorded is the camera's offset, and **every photo from that camera, and only that camera,
shifts by it**. The shifted wall clock is then read as ``Europe/London`` and converted to
UTC, in that order, through london_time.py.

A camera with no phone-clock photo must not block upload for ever, so the other decision is
**"keep this camera's time as recorded"**, an offset of zero that a person chose. Upload
refuses only while a camera has neither.

A corrected time that lands in the hour that happens twice, or the one that never happens,
**flags the camera** and leaves those photos without a time. It never stops a tag run and it
does not block upload; the flag is there for a person to look at.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from .london_time import RepeatedHour, SkippedHour, london_to_utc, to_utc_iso
from .manifest import Manifest, wall_value

PHONE = "phone"
AS_RECORDED = "as_recorded"


class ClockError(ValueError):
    pass


@dataclass(frozen=True)
class CameraSummary:
    camera_key: str
    label: str
    folders: tuple[str, ...]
    photos: int
    timed: tuple[str, ...]
    """Fingerprints of this camera's photos that have a recorded time, earliest first."""
    first: datetime | None
    last: datetime | None
    decision: str | None
    offset: timedelta | None
    flagged: int
    """Photos whose corrected time is in the repeated or skipped hour."""
    timeless: int

    @property
    def decided(self) -> bool:
        return self.decision is not None


def offset_of(camera) -> timedelta | None:
    return None if camera["offset_us"] is None else timedelta(microseconds=camera["offset_us"])


def corrected_time(recorded: datetime, offset: timedelta) -> tuple[str | None, str | None]:
    """(taken_at as UTC ISO, problem) for one photo."""
    try:
        return to_utc_iso(london_to_utc(recorded + offset)), None
    except RepeatedHour:
        return None, "repeated_hour"
    except SkippedHour:
        return None, "skipped_hour"


def refresh_times(manifest: Manifest) -> None:
    """Recompute every photo's UTC time from its camera's decision. Cheap, and simpler to
    get right than working out which photos a change touched."""
    offsets = {camera["camera_key"]: offset_of(camera) for camera in manifest.cameras()}
    times = []
    for photo in manifest.photos():
        recorded = wall_value(photo["recorded"])
        offset = offsets.get(photo["camera_key"])
        if recorded is None or offset is None:
            times.append((photo["fingerprint"], None, None))
        else:
            taken_at, problem = corrected_time(recorded, offset)
            times.append((photo["fingerprint"], taken_at, problem))
    manifest.set_times(times)


def summaries(manifest: Manifest) -> list[CameraSummary]:
    photos = defaultdict(list)
    for photo in manifest.photos():
        photos[photo["camera_key"]].append(photo)

    result = []
    for camera in manifest.cameras():
        own = photos.get(camera["camera_key"], [])
        timed = sorted(
            (photo for photo in own if photo["recorded"]),
            key=lambda photo: (photo["recorded"], photo["sequence"]),
        )
        result.append(
            CameraSummary(
                camera_key=camera["camera_key"],
                label=camera["label"],
                folders=tuple(sorted({photo["folder"] for photo in own})),
                photos=len(own),
                timed=tuple(photo["fingerprint"] for photo in timed),
                first=wall_value(timed[0]["recorded"]) if timed else None,
                last=wall_value(timed[-1]["recorded"]) if timed else None,
                decision=camera["decision"],
                offset=offset_of(camera),
                flagged=sum(1 for photo in own if photo["time_problem"]),
                timeless=len(own) - len(timed),
            )
        )
    return result


def undecided(manifest: Manifest) -> list[CameraSummary]:
    return [summary for summary in summaries(manifest) if not summary.decided]


def decide_by_phone(manifest: Manifest, camera_key: str, reference: str, phone: datetime, now: str) -> None:
    """The phone showed ``phone`` (a London wall clock) in the photo ``reference``."""
    if phone.tzinfo is not None:
        raise ClockError("the phone's time is a wall-clock reading with no zone")
    photo = manifest.photo(fingerprint=reference)
    if photo is None or photo["camera_key"] != camera_key:
        raise ClockError("that photo is not from this camera")
    recorded = wall_value(photo["recorded"])
    if recorded is None:
        raise ClockError("that photo has no recorded time to compare with")
    offset = phone - recorded
    manifest.set_camera_decision(camera_key, PHONE, offset // timedelta(microseconds=1), reference, now)
    refresh_times(manifest)


def keep_as_recorded(manifest: Manifest, camera_key: str, now: str) -> None:
    if manifest.camera(camera_key) is None:
        raise ClockError("there is no such camera")
    manifest.set_camera_decision(camera_key, AS_RECORDED, 0, None, now)
    refresh_times(manifest)


def describe_offset(offset: timedelta) -> str:
    """``1 h 0 min 3 s behind``, as a person would say how far to move the camera's clock."""
    total = offset.total_seconds()
    if abs(total) < 0.5:
        return "no change"
    direction = "later" if total > 0 else "earlier"
    seconds = round(abs(total))
    days, seconds = divmod(seconds, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = [f"{days} d"] if days else []
    if hours or days:
        parts.append(f"{hours} h")
    if minutes or hours or days:
        parts.append(f"{minutes} min")
    parts.append(f"{seconds} s")
    return f"{' '.join(parts)} {direction}"
