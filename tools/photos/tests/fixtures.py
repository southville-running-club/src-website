"""Synthetic photos for the tests. No real race photo ever enters this repository.

Every JPEG here is generated when a test runs, in a temporary folder, and carries invented
metadata of exactly the kinds ADR-060 says must not survive: GPS coordinates, a camera
serial, an artist's name, a comment and XMP. The marker strings are distinctive so a test
can search a copy's bytes for them.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import ExifTags, Image, ImageCms
from PIL.TiffImagePlugin import IFDRational

SERIAL = "SERIAL-987654321"
ARTIST = "Artist-Marker-Ada"
COMMENT = b"Comment-Marker-Do-Not-Keep"
XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/">Xmp-Marker-Do-Not-Keep</x:xmpmeta>'
SECRETS = (SERIAL.encode(), ARTIST.encode(), COMMENT, b"Xmp-Marker-Do-Not-Keep")

RED = (220, 20, 20)
BLUE = (20, 40, 220)


def exif_bytes(
    *,
    orientation: int | None = None,
    recorded: str | None = "2026:11:01 11:00:05",
    subseconds: str | None = None,
    make: str | None = "FakeCam",
    model: str | None = "Model X",
    serial: str | None = SERIAL,
    gps: bool = True,
) -> bytes:
    exif = Image.Exif()
    if orientation is not None:
        exif[ExifTags.Base.Orientation] = orientation
    if make:
        exif[ExifTags.Base.Make] = make
    if model:
        exif[ExifTags.Base.Model] = model
    exif[ExifTags.Base.Artist] = ARTIST
    detail = exif.get_ifd(ExifTags.IFD.Exif)
    if recorded:
        detail[ExifTags.Base.DateTimeOriginal] = recorded
    if subseconds:
        detail[ExifTags.Base.SubsecTimeOriginal] = subseconds
    if serial:
        detail[ExifTags.Base.BodySerialNumber] = serial
    if gps:
        position = exif.get_ifd(ExifTags.IFD.GPSInfo)
        position[ExifTags.GPS.GPSLatitudeRef] = "N"
        position[ExifTags.GPS.GPSLatitude] = (IFDRational(51), IFDRational(26), IFDRational(5012, 100))
        position[ExifTags.GPS.GPSLongitudeRef] = "W"
        position[ExifTags.GPS.GPSLongitude] = (IFDRational(2), IFDRational(37), IFDRational(1234, 100))
    return exif.tobytes()


def picture(size=(600, 400), corner=True, mode="RGB") -> Image.Image:
    """Blue, with a red square in the top-left corner of the stored pixels, so a test can
    tell which way up a copy came out."""
    image = Image.new("RGB", size, BLUE)
    if corner:
        side = min(size) // 4
        image.paste(RED, (0, 0, side, side))
    return image.convert(mode) if mode != "RGB" else image


def make_jpeg(
    path: Path,
    *,
    size=(600, 400),
    mode="RGB",
    icc_profile: bytes | None = None,
    metadata: bool = True,
    **exif,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    options = {"quality": 90}
    if metadata:
        options.update(exif=exif_bytes(**exif), comment=COMMENT, xmp=XMP)
    if icc_profile:
        options["icc_profile"] = icc_profile
    picture(size, mode=mode).save(path, "JPEG", **options)
    return path


def jpeg_bytes(**kwargs) -> bytes:
    buffer = io.BytesIO()
    options = {"quality": 90, **kwargs}
    picture().save(buffer, "JPEG", **options)
    return buffer.getvalue()


def marked_srgb_profile() -> bytes:
    """A working sRGB profile with the header's device manufacturer and model fields set to
    a marker, standing in for a camera maker's own profile."""
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    profile[48:56] = b"CAMXMODL"
    profile[84:100] = bytes(16)  # the profile ID is a checksum; zero means "not computed"
    return bytes(profile)
