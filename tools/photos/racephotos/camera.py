"""What an original says about when it was taken and which camera took it.

Two facts are read and nothing else. ``DateTimeOriginal`` with its sub-seconds, as a bare
wall-clock reading (london_time.py turns it into UTC once the camera's clock is fixed), and
enough about the camera to group its photos for that fix.

**The body serial number is read only to make the camera key**, a hash of the serial with
the make and model, and is not returned, stored or logged (ADR-060). Two folders shot on
one body then share a clock fix, which is right: it is one clock. A camera that records no
serial is keyed by the photographer's credit, make and model instead, so two photographers
with the same model stay apart.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime

from PIL import ExifTags, Image

EXIF_TIME = re.compile(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})")


@dataclass(frozen=True)
class CameraFacts:
    recorded: datetime | None
    """The camera's own wall clock when the photo was taken, with no zone. None when the
    file does not say."""
    camera_key: str
    camera_label: str
    """Make and model, for a person to recognise on the clock screen. Never the serial."""


def _text(value: object) -> str:
    if isinstance(value, bytes):
        value = value.decode("ascii", "replace")
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "").strip()


def parse_exif_time(original: object, subseconds: object = None) -> datetime | None:
    match = EXIF_TIME.fullmatch(_text(original))
    if not match:
        return None
    try:
        wall = datetime(*(int(part) for part in match.groups()))
    except ValueError:  # 0000:00:00 00:00:00 and other placeholders cameras write
        return None
    digits = re.sub(r"\D", "", _text(subseconds))[:6]
    if digits:
        wall = wall.replace(microsecond=int(digits.ljust(6, "0")))
    return wall


def read_camera(image: Image.Image, credit: str) -> CameraFacts:
    exif = image.getexif()
    detail = exif.get_ifd(ExifTags.IFD.Exif)

    make = _text(exif.get(ExifTags.Base.Make))
    model = _text(exif.get(ExifTags.Base.Model))
    serial = _text(detail.get(ExifTags.Base.BodySerialNumber))

    if serial:
        identity = ("serial", make, model, serial)
    else:
        identity = ("credit", credit, make, model)
    camera_key = hashlib.sha256("\x00".join(identity).encode()).hexdigest()[:16]

    if model and make and model.lower().startswith(make.lower()):
        label = model
    else:
        label = " ".join(part for part in (make, model) if part) or "Unknown camera"

    recorded = parse_exif_time(
        detail.get(ExifTags.Base.DateTimeOriginal),
        detail.get(ExifTags.Base.SubsecTimeOriginal),
    )
    return CameraFacts(recorded=recorded, camera_key=camera_key, camera_label=label)
