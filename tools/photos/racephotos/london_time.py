"""The one place this tool converts between a London wall clock and UTC.

The website's rule is that timestamps are stored UTC and displayed ``Europe/London``,
through ``packages/shared/src/london-time.ts`` and nothing else. Python cannot import that
module, and it has no wall-clock-to-UTC direction anyway, so this is its counterpart for the
laptop tool. **It is the only module here allowed to import zoneinfo, call astimezone or ask
the system clock**; ``tests/test_boundaries.py`` fails the suite if another one does, which is
the nearest Python gets to the ESLint rule that guards the TypeScript side.

A camera's ``DateTimeOriginal`` is a bare wall-clock reading with no zone. It is corrected
first, by the camera's offset from a phone clock it photographed, then read as
``Europe/London``, then converted to UTC. Nightingale Nightmare 2026 is the Sunday after the
clocks go back on 25 October, so a camera left on summer time reads an hour ahead on the
day, and only the correction knows that.

A wall-clock reading in the hour that happens twice (01:00 to 02:00 on the night the clocks
go back) names two instants, and one in the hour that never happens (01:00 to 02:00 on the
night they go forward) names none. Both are refused rather than guessed; the caller flags
the camera and carries on.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")


class LondonTimeError(ValueError):
    """A wall-clock reading that does not name exactly one instant in London."""


class RepeatedHour(LondonTimeError):
    pass


class SkippedHour(LondonTimeError):
    pass


def london_to_utc(wall: datetime) -> datetime:
    """A London wall-clock reading, with no zone, as an aware UTC instant."""
    if wall.tzinfo is not None:
        raise TypeError("london_to_utc() takes a wall-clock reading with no zone attached")

    first = wall.replace(tzinfo=LONDON, fold=0).astimezone(timezone.utc)
    second = wall.replace(tzinfo=LONDON, fold=1).astimezone(timezone.utc)
    if first == second:
        return first

    # The two readings disagree either because the time happened twice or because it never
    # happened. A real time survives the round trip; a skipped one comes back an hour out.
    if first.astimezone(LONDON).replace(tzinfo=None) == wall:
        raise RepeatedHour(f"{wall:%Y-%m-%d %H:%M:%S} happened twice in London, when the clocks went back")
    raise SkippedHour(f"{wall:%Y-%m-%d %H:%M:%S} never happened in London: the clocks went forward")


def utc_to_london(instant: datetime) -> datetime:
    """An aware instant as a London wall-clock reading, with no zone."""
    if instant.tzinfo is None:
        raise TypeError("utc_to_london() takes an aware instant")
    return instant.astimezone(LONDON).replace(tzinfo=None)


def format_london(instant: datetime) -> str:
    """``Sun 1 Nov 2026, 11:00:05 GMT``, for a person to read."""
    if instant.tzinfo is None:
        raise TypeError("format_london() takes an aware instant")
    local = instant.astimezone(LONDON)
    return f"{local:%a} {local.day} {local:%b %Y, %H:%M:%S} {local.tzname()}"


def format_wall(wall: datetime) -> str:
    """A wall-clock reading as a camera recorded it, with no zone and no conversion."""
    return f"{wall:%a} {wall.day} {wall:%b %Y, %H:%M:%S}"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_utc_iso(instant: datetime) -> str:
    """The storage form: always UTC, always ISO 8601 with milliseconds and a ``Z``."""
    if instant.tzinfo is None:
        raise TypeError("to_utc_iso() takes an aware instant")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def from_utc_iso(text: str) -> datetime:
    instant = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError(f"not a UTC timestamp: {text}")
    return instant.astimezone(timezone.utc)
