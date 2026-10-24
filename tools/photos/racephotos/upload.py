"""``photos upload``: send the stripped copies to R2, or rehearse it with ``--dry-run``.

Each visible photo's three copies go to ``<event slug>/<photo id>/{full,medium,thumb}.jpg``,
the bucket's key layout. A dry run writes that layout under the work folder's ``dry-run/``
with a ``keys.tsv`` listing every key, its size, its SHA-256 and its content type, and
nothing leaves the laptop. A real upload sends the same files to the R2 bucket named in the
config's ``[r2]`` section (ADR-062).

Both then write the SQL file of every read for the photos they sent (``sqlfile.py``), for a
volunteer to run in the Supabase SQL editor (ADR-063).

**A dry run never marks a photo as uploaded for real**: the manifest keeps the two apart,
so the real upload cannot skip a photo because it was rehearsed.

Upload waits until every camera's clock is decided, and never sends a hidden photo. Each
copy is checked against the allowlist again on the way out, so nothing reaches the bucket
that the check would refuse.

**How R2 knows a file arrived whole.** Each PUT carries ``Content-MD5``, which R2 lists as
supported on PutObject and which an S3 service refuses with ``BadDigest`` when the body
does not match; the ETag it answers is then compared with the same digest. The newer
checksums boto3 adds by default (CRC32 and friends) are switched off: R2 does not list them
for a single PutObject, and services that did not support them have refused uploads
outright. **No key is ever printed**: a refusal from R2 is reported by its error code alone.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from . import clocks
from .config import Config, R2Settings
from .copies import SIZE_NAMES
from .inputs import load_photographers
from .jpeg import MetadataLeft, check_copy
from .london_time import to_utc_iso, utc_now
from .manifest import Manifest
from .sqlfile import write_sql
from .words import verb

CONTENT_TYPE = "image/jpeg"


class UploadRefused(ValueError):
    pass


@dataclass
class UploadRun:
    dry_run: bool = True
    written: int = 0
    already: int = 0
    photos: int = 0
    hidden: int = 0
    hidden_after_upload: int = 0
    without_time: int = 0
    destination: str | None = None
    keys_file: Path | None = None
    sql_files: list[Path] = field(default_factory=list)


def object_key(event_slug: str, photo_id: str, size: str) -> str:
    return f"{event_slug}/{photo_id}/{size}.jpg"


def checksum(data: bytes) -> str:
    """SHA-256, base64: the manifest's record of exactly which bytes were sent."""
    return base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def content_md5(data: bytes) -> tuple[str, str]:
    """(the Content-MD5 header value, the hex digest an S3 ETag carries)."""
    digest = hashlib.md5(data, usedforsecurity=False)
    return base64.b64encode(digest.digest()).decode("ascii"), digest.hexdigest()


class DryRunSink:
    def __init__(self, folder: Path):
        self.folder = folder

    @property
    def where(self) -> str:
        return str(self.folder)

    def put(self, key: str, data: bytes) -> None:
        target = self.folder / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def r2_client(settings: R2Settings):
    """A boto3 S3 client aimed at the bucket's EU-jurisdiction endpoint."""
    import boto3
    from botocore.config import Config as BotoConfig

    return boto3.client(
        "s3",
        endpoint_url=settings.endpoint,
        region_name="auto",
        aws_access_key_id=settings.access_key_id,
        aws_secret_access_key=settings.secret_access_key,
        config=BotoConfig(
            signature_version="s3v4",
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            retries={"mode": "standard", "max_attempts": 5},
            connect_timeout=10,
            read_timeout=60,
        ),
    )


class R2Sink:
    def __init__(self, settings: R2Settings, client=None):
        self.bucket = settings.bucket
        self.client = client if client is not None else r2_client(settings)

    @property
    def where(self) -> str:
        return f"the R2 bucket {self.bucket}"

    def put(self, key: str, data: bytes) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        header, expected = content_md5(data)
        try:
            answer = self.client.put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=CONTENT_TYPE, ContentMD5=header
            )
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "an error")
            raise UploadRefused(
                f"R2 refused {key} with {code}. Nothing after it was sent; once the cause is "
                "fixed, run the same command again and it carries on from there."
            ) from None
        except BotoCoreError as error:
            raise UploadRefused(
                f"R2 could not be reached while sending {key} ({type(error).__name__}). Nothing "
                "after it was sent; run the same command again to carry on."
            ) from None
        if answer.get("ETag", "").strip('"') != expected:
            raise UploadRefused(
                f"R2 stored {key} with a different checksum from the one sent. Nothing after it was "
                "sent; ask before going further."
            )


def run_upload(config: Config, *, dry_run: bool, client=None) -> UploadRun:
    if not dry_run and config.r2 is None:
        raise UploadRefused(
            "There is no [r2] section in config.toml, so there is nowhere to upload to. Add one "
            "(see config.example.toml and docs/delivery/runbooks/race-photos.md), or use "
            "--dry-run to write the same layout to this laptop."
        )
    photographers = load_photographers(config.photographers_csv)
    manifest = Manifest.open(config.manifest_path, config.event_slug)
    try:
        sink = DryRunSink(config.dry_run_dir) if dry_run else R2Sink(config.r2, client)
        run = _send(config, manifest, sink, dry_run)
        if dry_run:
            run.keys_file = _keys_file(config, manifest)
        run.sql_files = write_sql(
            config, manifest, photographers, dry_run=dry_run, now=to_utc_iso(utc_now())
        )
        return run
    finally:
        manifest.close()


def _send(config: Config, manifest: Manifest, sink, dry_run: bool) -> UploadRun:
    waiting = clocks.undecided(manifest)
    if waiting:
        names = "; ".join(f"{camera.label} in {', '.join(camera.folders)}" for camera in waiting)
        raise UploadRefused(
            f"Upload waits until every camera's clock is decided. {len(waiting)} still "
            f"{verb(len(waiting), 'needs', 'need')} a "
            f"phone time or a decision to keep their time as recorded: {names}. "
            "Use ./photos review, Camera clocks."
        )

    run = UploadRun(dry_run=dry_run, destination=sink.where)
    for photo in manifest.photos():
        if photo["hidden_at"]:
            run.hidden += 1
            if manifest.uploaded(photo["fingerprint"], "full", dry_run=dry_run):
                run.hidden_after_upload += 1
            continue
        run.photos += 1
        if photo["recorded"] and not photo["taken_at"]:
            run.without_time += 1
        for size in SIZE_NAMES:
            if manifest.uploaded(photo["fingerprint"], size, dry_run=dry_run):
                run.already += 1
                continue
            source = config.copies_dir / photo["photo_id"] / f"{size}.jpg"
            if not source.is_file():
                raise UploadRefused(
                    f"The {size} copy of {photo['short_id']} is missing from {config.copies_dir}. "
                    "Copies are only written by ./photos tag, so something removed it afterwards. "
                    "Nothing after it was sent; ask before going further."
                )
            data = source.read_bytes()
            try:
                check_copy(data)
            except MetadataLeft as problem:
                raise UploadRefused(
                    f"The {size} copy of {photo['short_id']} holds {problem}, so it was not sent. "
                    "Copies are checked when ./photos tag writes them, so this one was changed "
                    "afterwards. Nothing after it was sent; ask before going further."
                ) from None
            key = object_key(config.event_slug, photo["photo_id"], size)
            sink.put(key, data)
            manifest.record_upload(
                photo["fingerprint"], size, dry_run=dry_run, key=key, sha256=checksum(data),
                length=len(data), now=to_utc_iso(utc_now()),
            )
            run.written += 1
    return run


def _keys_file(config: Config, manifest: Manifest) -> Path:
    keys_file = config.dry_run_dir / "keys.tsv"
    keys_file.parent.mkdir(parents=True, exist_ok=True)
    lines = ["key\tbytes\tsha256_base64\tcontent_type"] + [
        f"{row['key']}\t{row['bytes']}\t{row['sha256']}\t{CONTENT_TYPE}" for row in manifest.uploads(dry_run=True)
    ]
    keys_file.write_text("\n".join(lines) + "\n")
    return keys_file
