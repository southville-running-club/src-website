"""The three stripped copies of a photo, which are all that ever leave the laptop (ADR-060).

The order is the point. **Orientation is applied first**, because stripping the metadata
first throws away the one tag that says which way up the picture is, and portrait photos
come out on their side. Then colour is converted to sRGB. Then the picture is copied into
a **fresh image that carries nothing over**: Pillow's JPEG writer falls back to the source
image's comment when it is not given one, so trusting save arguments alone would keep it.
Then each copy is written and checked against jpeg.py's allowlist, and one that fails
stops the run.

A photo is never enlarged to reach a size.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from .jpeg import check_copy

# Long edge in pixels, and JPEG quality. The targets are about 1 MB, 300 KB and 50 KB for a
# real photo; the tool reports the actual sizes so the qualities can be tuned after the
# first real run.
SIZES = (("full", 2400, 85), ("medium", 1200, 82), ("thumb", 480, 78))
SIZE_NAMES = tuple(name for name, _, _ in SIZES)

ACCEPTED_FORMATS = {"JPEG", "MPO"}  # MPO is a JPEG with a second picture some cameras add

# A generic sRGB profile made here, so no byte of a camera's own profile survives.
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
SRGB_BYTES = SRGB.tobytes()


class UnreadablePhoto(ValueError):
    pass


@dataclass(frozen=True)
class Copies:
    images: dict[str, bytes]
    dimensions: dict[str, tuple[int, int]]


def open_original(path: Path) -> Image.Image:
    """The original, loaded. The caller closes it, ideally with ``with``."""
    try:
        image = Image.open(path)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise UnreadablePhoto("could not be read as a photo") from None
    try:
        if image.format not in ACCEPTED_FORMATS:
            raise UnreadablePhoto(f"is a {image.format} file named as a JPEG")
        image.load()
    except (OSError, Image.DecompressionBombError):
        image.close()
        raise UnreadablePhoto("could not be read as a photo") from None
    except UnreadablePhoto:
        image.close()
        raise
    return image


def _srgb(image: Image.Image) -> tuple[Image.Image, bool]:
    """The image in sRGB, and whether it carried a profile that was converted."""
    profile = image.info.get("icc_profile")
    if profile:
        try:
            source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
            converted = ImageCms.profileToProfile(image, source, SRGB, outputMode="RGB")
            if converted is not None:
                return converted, True
        except (ImageCms.PyCMSError, OSError, ValueError):
            # A broken or mismatched profile is treated as absent: the picture is assumed
            # to be sRGB already, which is what an untagged JPEG means.
            pass
    return image.convert("RGB"), False


def make_copies(original: Image.Image) -> Copies:
    upright = ImageOps.exif_transpose(original)
    coloured, had_profile = _srgb(upright)

    # The fresh image: pixels only, an empty info dictionary.
    clean = Image.frombytes("RGB", coloured.size, coloured.tobytes())

    images: dict[str, bytes] = {}
    dimensions: dict[str, tuple[int, int]] = {}
    current = clean
    for name, long_edge, quality in SIZES:
        width, height = current.size
        if max(width, height) > long_edge:
            scale = long_edge / max(width, height)
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            current = current.resize(target, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        current.save(
            buffer,
            "JPEG",
            quality=quality,
            optimize=True,
            icc_profile=SRGB_BYTES if had_profile else None,
        )
        data = buffer.getvalue()
        check_copy(data)
        images[name] = data
        dimensions[name] = current.size

    return Copies(images=images, dimensions=dimensions)
