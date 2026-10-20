"""Fingerprints, and what kind of file something in a photographer's folder is."""

from __future__ import annotations

import hashlib
from pathlib import Path


def fingerprint(path: Path) -> str:
    """SHA-256 of the file's bytes. The manifest's key: a file it has seen is never read
    twice, whatever it is called or wherever it has been moved."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
