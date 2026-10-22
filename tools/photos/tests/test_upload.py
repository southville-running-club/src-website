import base64
import contextlib
import hashlib
import io
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from racephotos import clocks
from racephotos.cli import main
from racephotos.manifest import Manifest
from racephotos.tag import run_tag
from racephotos.upload import UploadRefused, run_upload

from . import fixtures
from .fixtures import SpyReader, make_jpeg

NOW = "2026-11-01T20:00:00.000Z"


class UploadTest(unittest.TestCase):
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

    def tearDown(self):
        self.manifest.close()
        self._tmp.cleanup()

    def decide_every_camera(self):
        for camera in clocks.undecided(self.manifest):
            clocks.keep_as_recorded(self.manifest, camera.camera_key, NOW)

    def photo(self, name):
        return next(p for p in self.manifest.photos() if p["source"] == f"Ross/{name}")

    def test_refuses_without_dry_run(self):
        self.decide_every_camera()
        with self.assertRaises(UploadRefused) as caught:
            run_upload(self.config, dry_run=False)
        self.assertIn("slice 2", str(caught.exception))
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


if __name__ == "__main__":
    unittest.main()
