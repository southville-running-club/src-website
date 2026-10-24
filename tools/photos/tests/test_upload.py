import base64
import contextlib
import dataclasses
import hashlib
import io
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from botocore.exceptions import ClientError
from moto import mock_aws

from racephotos import clocks
from racephotos.cli import main
from racephotos.config import R2Settings
from racephotos.manifest import Manifest
from racephotos.tag import run_tag
from racephotos.upload import R2Sink, UploadRefused, r2_client, run_upload

from . import fixtures
from .fixtures import SpyReader, make_jpeg

NOW = "2026-11-01T20:00:00.000Z"


class UploadCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.config = fixtures.make_work(Path(self._tmp.name).resolve())
        for name, serial, recorded in (
            ("a.jpg", "A", "2026:11:01 11:05:00"),
            ("b.jpg", "A", "2026:11:01 11:06:00"),
            ("c.jpg", "B", "2026:11:01 11:07:00"),
        ):
            make_jpeg(self.config.originals / "Ross" / name, serial=serial, recorded=recorded)
        run_tag(self.config, SpyReader(), 0.9, say=lambda line: None)
        self.manifest = Manifest.open(self.config.manifest_path, self.config.event_slug)
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(self.manifest.close)

    def decide_every_camera(self):
        for camera in clocks.undecided(self.manifest):
            clocks.keep_as_recorded(self.manifest, camera.camera_key, NOW)

    def photo(self, name):
        return next(p for p in self.manifest.photos() if p["source"] == f"Ross/{name}")


class UploadTest(UploadCase):
    def test_a_real_upload_needs_an_r2_section(self):
        self.decide_every_camera()
        with self.assertRaises(UploadRefused) as caught:
            run_upload(self.config, dry_run=False)
        self.assertIn("no [r2] section", str(caught.exception))
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["--work", str(self.config.work), "upload"], say=lambda line: None), 2)

    def test_refuses_while_a_camera_has_neither_decision_and_names_it(self):
        clocks.keep_as_recorded(self.manifest, self.photo("a.jpg")["camera_key"], NOW)
        with self.assertRaises(UploadRefused) as caught:
            run_upload(self.config, dry_run=True)
        self.assertIn("1 still needs a phone time", str(caught.exception))
        self.assertIn("FakeCam Model X in Ross", str(caught.exception))
        self.assertFalse(self.config.dry_run_dir.exists())

    def test_a_phone_time_or_keeping_the_recorded_time_both_unblock_it(self):
        a = self.photo("a.jpg")
        clocks.decide_by_phone(self.manifest, a["camera_key"], a["fingerprint"], datetime(2026, 11, 1, 11, 0), NOW)
        clocks.keep_as_recorded(self.manifest, self.photo("c.jpg")["camera_key"], NOW)
        run = run_upload(self.config, dry_run=True)
        # a.jpg shows the phone the time was read from, so it is hidden and not uploaded.
        self.assertEqual((run.photos, run.hidden), (2, 1))
        self.assertFalse((self.config.dry_run_dir / "nn-2026" / a["photo_id"]).exists())

    def test_writes_the_bucket_s_key_layout_with_the_copies_unchanged(self):
        self.decide_every_camera()
        run = run_upload(self.config, dry_run=True)

        expected = {
            f"nn-2026/{photo['photo_id']}/{size}.jpg"
            for photo in self.manifest.photos()
            for size in ("full", "medium", "thumb")
        }
        written = {
            path.relative_to(self.config.dry_run_dir).as_posix()
            for path in self.config.dry_run_dir.rglob("*.jpg")
        }
        self.assertEqual(written, expected)
        self.assertEqual(run.written, 9)

        photo = self.photo("a.jpg")
        copy = (self.config.copies_dir / photo["photo_id"] / "medium.jpg").read_bytes()
        uploaded = (self.config.dry_run_dir / "nn-2026" / photo["photo_id"] / "medium.jpg").read_bytes()
        self.assertEqual(uploaded, copy)

        keys = run.keys_file.read_text().splitlines()
        self.assertEqual(keys[0], "key\tbytes\tsha256_base64\tcontent_type")
        line = next(row for row in keys if row.startswith(f"nn-2026/{photo['photo_id']}/medium.jpg"))
        digest = base64.b64encode(hashlib.sha256(copy).digest()).decode()
        self.assertEqual(line.split("\t")[1:], [str(len(copy)), digest, "image/jpeg"])

    def test_never_writes_a_hidden_photo(self):
        self.decide_every_camera()
        hidden = self.photo("b.jpg")
        self.manifest.hide(hidden["fingerprint"], NOW)
        run = run_upload(self.config, dry_run=True)
        self.assertEqual((run.photos, run.hidden), (2, 1))
        self.assertFalse((self.config.dry_run_dir / "nn-2026" / hidden["photo_id"]).exists())
        self.assertNotIn(hidden["photo_id"], run.keys_file.read_text())

    def test_a_second_run_writes_nothing_and_a_dry_run_is_never_a_real_upload(self):
        self.decide_every_camera()
        run_upload(self.config, dry_run=True)
        times = {path: path.stat().st_mtime_ns for path in self.config.dry_run_dir.rglob("*.jpg")}

        again = run_upload(self.config, dry_run=True)
        self.assertEqual((again.written, again.already), (0, 9))
        self.assertEqual({path: path.stat().st_mtime_ns for path in self.config.dry_run_dir.rglob("*.jpg")}, times)
        self.assertEqual(self.manifest.uploads(dry_run=False), [])
        for photo in self.manifest.photos():
            self.assertFalse(self.manifest.uploaded(photo["fingerprint"], "full", dry_run=False))

    def test_refuses_a_copy_that_carries_metadata(self):
        self.decide_every_camera()
        photo = self.photo("a.jpg")
        thumb = self.config.copies_dir / photo["photo_id"] / "thumb.jpg"
        thumb.write_bytes(fixtures.jpeg_bytes(exif=fixtures.exif_bytes()))
        with self.assertRaises(UploadRefused) as caught:
            run_upload(self.config, dry_run=True)
        self.assertIn("APP1", str(caught.exception))
        self.assertFalse((self.config.dry_run_dir / "nn-2026" / photo["photo_id"] / "thumb.jpg").exists())

    def test_the_command_says_where_it_wrote_and_what_comes_next(self):
        self.decide_every_camera()
        lines = []
        self.assertEqual(main(["--work", str(self.config.work), "upload", "--dry-run"], say=lines.append), 0)
        output = "\n".join(lines)
        self.assertIn("Wrote 9 files for 3 photos", output)
        self.assertIn("Nothing has left this laptop", output)


R2 = R2Settings(
    account_id="0123456789abcdef0123456789abcdef",
    bucket="src-race-photos",
    access_key_id="AKID-NOT-A-REAL-KEY",
    secret_access_key="SECRET-NOT-A-REAL-KEY",
)


class R2UploadTest(UploadCase):
    """The real upload, against moto standing in for R2. No test touches the real bucket."""

    def setUp(self):
        super().setUp()
        self.config = dataclasses.replace(self.config, r2=R2)
        # moto intercepts only the endpoints it is told about, and R2's is not Amazon's.
        environment = mock.patch.dict(os.environ, {"MOTO_S3_CUSTOM_ENDPOINTS": R2.endpoint})
        environment.start()
        self.addCleanup(environment.stop)
        self.aws = mock_aws()
        self.aws.start()
        self.addCleanup(self.aws.stop)
        self.client = r2_client(R2)
        # R2's region is `auto`, which moto accepts only as an explicit location.
        self.client.create_bucket(Bucket=R2.bucket, CreateBucketConfiguration={"LocationConstraint": "auto"})
        self.sent_headers = []
        self.client.meta.events.register(
            "before-send.s3.PutObject",
            lambda request, **_: self.sent_headers.append(
                {name.lower(): value.decode() if isinstance(value, bytes) else value for name, value in request.headers.items()}
            ),
        )
        self.decide_every_camera()

    def stored(self):
        listing = self.client.list_objects_v2(Bucket=R2.bucket)
        return {item["Key"] for item in listing.get("Contents", [])}

    def test_the_client_aims_at_the_eu_endpoint_with_crc_checksums_off(self):
        self.assertEqual(self.client.meta.endpoint_url, R2.endpoint)
        self.assertEqual(self.client.meta.region_name, "auto")
        self.assertEqual(self.client.meta.config.request_checksum_calculation, "when_required")

    def test_sends_every_copy_in_the_bucket_s_layout_unchanged(self):
        run = run_upload(self.config, dry_run=False, client=self.client)
        self.assertEqual((run.written, run.photos), (9, 3))
        expected = {
            f"nn-2026/{photo['photo_id']}/{size}.jpg"
            for photo in self.manifest.photos()
            for size in ("full", "medium", "thumb")
        }
        self.assertEqual(self.stored(), expected)
        photo = self.manifest.photos()[0]
        body = self.client.get_object(Bucket=R2.bucket, Key=f"nn-2026/{photo['photo_id']}/thumb.jpg")["Body"].read()
        self.assertEqual(body, (self.config.copies_dir / photo["photo_id"] / "thumb.jpg").read_bytes())

    def test_each_put_carries_content_md5_and_no_crc_checksum(self):
        run_upload(self.config, dry_run=False, client=self.client)
        self.assertEqual(len(self.sent_headers), 9)
        for headers in self.sent_headers:
            self.assertRegex(headers["content-md5"], r"^[A-Za-z0-9+/]{22}==$")
            self.assertEqual(headers["content-type"], "image/jpeg")
            self.assertEqual([name for name in headers if name.startswith("x-amz-checksum")], [])
            self.assertNotIn("x-amz-sdk-checksum-algorithm", headers)

    def test_a_dry_run_does_not_count_as_sent(self):
        run_upload(self.config, dry_run=True)
        run = run_upload(self.config, dry_run=False, client=self.client)
        self.assertEqual((run.written, run.already), (9, 0))
        again = run_upload(self.config, dry_run=False, client=self.client)
        self.assertEqual((again.written, again.already), (0, 9))

    def test_a_refusal_names_r2_s_code_and_never_the_key(self):
        failure = ClientError(
            {"Error": {"Code": "AccessDenied", "Message": "denied for SECRET-NOT-A-REAL-KEY"}}, "PutObject"
        )
        with mock.patch.object(self.client, "put_object", side_effect=failure):
            with self.assertRaises(UploadRefused) as caught:
                run_upload(self.config, dry_run=False, client=self.client)
        self.assertIn("AccessDenied", str(caught.exception))
        self.assertNotIn("SECRET-NOT-A-REAL-KEY", str(caught.exception))
        self.assertNotIn("AKID-NOT-A-REAL-KEY", str(caught.exception))
        self.assertEqual(self.manifest.uploads(dry_run=False), [])
        self.assertEqual(run_upload(self.config, dry_run=False, client=self.client).written, 9)

    def test_refuses_when_r2_stores_different_bytes(self):
        sink = R2Sink(R2, client=self.client)
        with mock.patch.object(self.client, "put_object", return_value={"ETag": '"0000"'}):
            with self.assertRaises(UploadRefused) as caught:
                sink.put("nn-2026/x/full.jpg", b"bytes")
        self.assertIn("different checksum", str(caught.exception))

    def test_writes_the_sql_for_what_was_sent(self):
        run = run_upload(self.config, dry_run=False, client=self.client)
        (part,) = run.sql_files
        self.assertEqual(part, self.config.work / "sql" / "nn-2026-photos-part-01-of-01.sql")
        sql = part.read_text()
        for photo in self.manifest.photos():
            self.assertIn(photo["photo_id"], sql)
        self.assertNotIn("SECRET-NOT-A-REAL-KEY", sql)

    def test_the_command_says_to_run_the_sql_and_revoke_the_token(self):
        lines = []
        with mock.patch("racephotos.upload.r2_client", return_value=self.client), \
             mock.patch("racephotos.cli.load_config", return_value=self.config):
            self.assertEqual(main(["--work", str(self.config.work), "upload"], say=lines.append), 0)
        output = "\n".join(lines)
        self.assertIn("Uploaded 9 files for 3 photos to the R2 bucket src-race-photos", output)
        self.assertIn("revoke the R2 token", output)
        self.assertNotIn("SECRET-NOT-A-REAL-KEY", output)


if __name__ == "__main__":
    unittest.main()
