"""A JPEG's segments, and the allowlist every copy has to pass before it can leave (ADR-060).

Deleting the metadata fields known to be sensitive fails the first time a camera writes one
nobody listed, so this goes the other way: it walks the file and names every segment, and
a copy may hold a JFIF header, one ICC colour profile, the tables and the picture, and
nothing else. No Exif, no XMP, no IPTC, no comment, no JFXX thumbnail, no bytes after the
end-of-image marker. A copy that fails stops the tool rather than being uploaded.

Standard library only, so the check does not depend on the library that wrote the file.
"""

from __future__ import annotations

from dataclasses import dataclass

SOI, EOI, SOS = 0xD8, 0xD9, 0xDA
# Markers that stand alone, with no length after them.
STANDALONE = {0x01, *range(0xD0, 0xD8)}

NAMES = {
    0xC0: "SOF0", 0xC1: "SOF1", 0xC2: "SOF2", 0xC4: "DHT", 0xDA: "SOS", 0xDB: "DQT",
    0xDD: "DRI", 0xE0: "APP0", 0xE1: "APP1", 0xE2: "APP2", 0xED: "APP13", 0xEE: "APP14",
    0xFE: "COM",
}

# The picture itself: frame headers, Huffman and quantisation tables, restart interval, scans.
PICTURE = {0xC0, 0xC1, 0xC2, 0xC4, 0xDB, 0xDD, SOS}


class NotAJpeg(ValueError):
    pass


class MetadataLeft(ValueError):
    """A copy holds something beyond the picture and a colour profile."""


@dataclass(frozen=True)
class Segment:
    marker: int
    payload: bytes

    @property
    def name(self) -> str:
        return NAMES.get(self.marker, f"0xFF{self.marker:02X}")


@dataclass(frozen=True)
class Walk:
    segments: tuple[Segment, ...]
    trailing: int
    """Bytes after the end-of-image marker."""


def walk(data: bytes) -> Walk:
    if data[:2] != b"\xff\xd8":
        raise NotAJpeg("does not start with a JPEG start-of-image marker")

    segments: list[Segment] = []
    position = 2
    length = len(data)
    while position < length:
        if data[position] != 0xFF:
            raise NotAJpeg(f"expected a marker at byte {position}")
        while position < length and data[position] == 0xFF:  # fill bytes are allowed
            position += 1
        if position >= length:
            break
        marker = data[position]
        position += 1

        if marker == EOI:
            return Walk(tuple(segments), trailing=length - position)
        if marker in STANDALONE:
            segments.append(Segment(marker, b""))
            continue
        if position + 2 > length:
            raise NotAJpeg("a segment runs past the end of the file")
        size = int.from_bytes(data[position : position + 2], "big")
        if size < 2 or position + size > length:
            raise NotAJpeg("a segment's length runs past the end of the file")
        segments.append(Segment(marker, data[position + 2 : position + size]))
        position += size

        if marker == SOS:
            # Entropy-coded data runs until a marker that is neither a stuffed zero nor a
            # restart marker. A progressive file has several scans, so the walk carries on.
            while position < length:
                if data[position] == 0xFF and position + 1 < length:
                    following = data[position + 1]
                    if following == 0x00 or 0xD0 <= following <= 0xD7:
                        position += 2
                        continue
                    if following == 0xFF:
                        position += 1
                        continue
                    break
                position += 1

    raise NotAJpeg("has no end-of-image marker")


def check_copy(data: bytes) -> None:
    """Raise unless ``data`` holds nothing but the picture, a JFIF header and one ICC
    profile."""
    result = walk(data)
    if result.trailing:
        raise MetadataLeft(f"{result.trailing} bytes after the end of the image")
    for segment in result.segments:
        if segment.marker in PICTURE:
            continue
        if segment.marker == 0xE0 and segment.payload.startswith(b"JFIF\x00"):
            continue
        if segment.marker == 0xE2 and segment.payload.startswith(b"ICC_PROFILE\x00"):
            continue
        raise MetadataLeft(f"a {segment.name} segment, which is not allowed in a copy")
