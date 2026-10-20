import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from racephotos.cli import main
from racephotos.files import fingerprint
from racephotos.jpeg import check_copy
from racephotos.manifest import Manifest, State
from racephotos.tag import run_tag

from . import fixtures
from .fixtures import SpyReader, answer, make_jpeg


class TagCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.config = fixtures.make_work(self.root)
        self.originals = self.config.originals

    def tearDown(self):
        self._tmp.cleanup()

    def photo(self, relative, **kwargs):
        return make_jpeg(self.originals / relative, **kwargs)

    def junk(self, relative, data=b"not a photo"):
        path = self.originals / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def tag(self, reader, threshold=0.9):
        return run_tag(self.config, reader, threshold, say=lambda line: None)

    def manifest(self):
        manifest = Manifest.open(self.config.manifest_path, self.config.event_slug)
        self.addCleanup(manifest.close)
        return manifest

    def a_folder(self):
        """Four photos and four files that are not, across two photographers."""
        tagged = self.photo("Adrian/Finish/a.jpg", recorded="2026:11:01 11:00:05")
        part = self.photo("Adrian/Finish/b.jpg", recorded="2026:11:01 11:00:20")
        garbled = self.photo("Adrian/Finish/c.jpg", recorded="2026:11:01 11:01:00")
        self.junk("Adrian/Finish/d.HEIC")
        self.junk("Adrian/Finish/._a.jpg")
        self.junk("Ross/e.CR3")
        nobib = self.photo("Ross/f.jpg", serial="SERIAL-ROSS", recorded="2026:11:01 11:05:00")
        self.junk("Ross/g.jpg", tagged.read_bytes())  # the same photo, copied twice
        self.junk("Ross/.DS_Store")
        return SpyReader({
            fingerprint(tagged): answer(("125", 0.97)),
            fingerprint(part): answer(("12?", 0.95)),
            fingerprint(garbled): "Sure! I can see bib 125.",
        }), {"tagged": tagged, "part": part, "garbled": garbled, "nobib": nobib}


class TagTest(TagCase):
    def test_a_folder_goes_through_with_every_file_accounted_for(self):
        reader, photos = self.a_folder()
        run = self.tag(reader)

        self.assertEqual(run.tagged, 4)
        self.assertEqual(dict(run.skipped), {"heic": 1, "macos_sidecar": 1, "raw": 1, "duplicate": 1})

        manifest = self.manifest()
        states = {photo["source"]: manifest.state(photo["fingerprint"]) for photo in manifest.photos()}
        self.assertEqual(states, {
            "Adrian/Finish/a.jpg": State.TAGGED,
            "Adrian/Finish/b.jpg": State.PART_READ,
            "Adrian/Finish/c.jpg": State.NEEDS_CHECK,
            "Ross/f.jpg": State.NO_BIB_SEEN,
        })
        self.assertEqual([photo["short_id"] for photo in manifest.photos()],
                         ["NN26-0001", "NN26-0002", "NN26-0003", "NN26-0004"])

        skipped = {row["source"]: (row["folder"], row["kind"]) for row in manifest.skipped()}
        self.assertEqual(skipped["Adrian/Finish/d.HEIC"], ("Adrian/Finish", "heic"))
        self.assertEqual(skipped["Ross/g.jpg"], ("Ross", "duplicate"))

    def test_a_photo_with_no_bib_seen_is_still_copied(self):
        reader, _ = self.a_folder()
        self.tag(reader)
        for photo in self.manifest().photos():
            for size in ("full", "medium", "thumb"):
                with self.subTest(photo=photo["source"], size=size):
                    self.assertTrue((self.config.copies_dir / photo["photo_id"] / f"{size}.jpg").is_file())

    def test_running_tag_twice_adds_nothing(self):
        reader, _ = self.a_folder()
        self.tag(reader)
        manifest = self.manifest()
        before = [tuple(photo) for photo in manifest.photos()]
        copies = {path: path.stat().st_mtime_ns for path in self.config.copies_dir.rglob("*.jpg")}

        again = SpyReader()
        run = self.tag(again)

        self.assertEqual((run.tagged, run.already), (0, 4))
        self.assertEqual(again.calls, [])
        self.assertEqual([tuple(photo) for photo in manifest.photos()], before)
        self.assertEqual({path: path.stat().st_mtime_ns for path in self.config.copies_dir.rglob("*.jpg")}, copies)

    def test_an_interrupted_run_carries_on_where_it_stopped(self):
        _, photos = self.a_folder()
        with self.assertRaises(KeyboardInterrupt):
            self.tag(SpyReader(interrupt_on=3))
        self.assertEqual(len(self.manifest().photos()), 2)

        reader = SpyReader()
        self.tag(reader)

        manifest = self.manifest()
        self.assertEqual(len(manifest.photos()), 4)
        self.assertEqual(len(reader.calls), 2, "the two saved photos are not read again")
        # The copies of the photo that was interrupted are swept, not left orphaned.
        self.assertEqual(
            {path.name for path in self.config.copies_dir.iterdir()},
            {photo["photo_id"] for photo in manifest.photos()},
        )

    def test_the_reader_is_sent_the_medium_copy_and_nothing_else(self):
        self.photo("Ross/big.jpg", size=(3000, 2000), orientation=6)
        reader = SpyReader()
        self.tag(reader)

        (_, medium), = reader.calls
        check_copy(medium)
        for secret in fixtures.SECRETS:
            self.assertNotIn(secret, medium)
        with Image.open(io.BytesIO(medium)) as image:
            self.assertEqual(image.size, (800, 1200))
            self.assertEqual(dict(image.getexif()), {})

    def test_a_reader_that_fails_sends_the_photo_to_review_and_the_run_goes_on(self):
        self.photo("Ross/a.jpg")
        self.photo("Ross/b.jpg", recorded="2026:11:01 11:09:00")
        reader = SpyReader(fail_with=RuntimeError("401 for key sk-not-a-real-key"))
        run = self.tag(reader)

        self.assertEqual(run.tagged, 2)
        manifest = self.manifest()
        for photo in manifest.photos():
            self.assertEqual(manifest.state(photo["fingerprint"]), State.NEEDS_CHECK)
            self.assertIn("RuntimeError", photo["reader_problem"])
            self.assertNotIn("sk-not-a-real-key", photo["reader_problem"])

    def test_a_malformed_answer_never_tags_a_bib(self):
        photo = self.photo("Ross/a.jpg")
        raw = '{"bibs": [{"text": "125", "confidence": 0.99}], "note": "one runner"}'
        self.tag(SpyReader({fingerprint(photo): raw}))

        manifest = self.manifest()
        (row,) = manifest.photos()
        self.assertEqual(manifest.reads(row["fingerprint"]), [])
        self.assertEqual(manifest.state(row["fingerprint"]), State.NEEDS_CHECK)
        self.assertEqual(row["raw_answer"], raw)

    def test_bursts_chain_within_two_seconds_on_one_camera(self):
        for name, recorded, serial in (
            ("a.jpg", "2026:11:01 11:00:00", "A"),
            ("b.jpg", "2026:11:01 11:00:01", "A"),
            ("c.jpg", "2026:11:01 11:00:03", "A"),
            ("d.jpg", "2026:11:01 11:00:10", "A"),
            ("e.jpg", "2026:11:01 11:00:02", "B"),
        ):
            self.photo(f"Ross/{name}", recorded=recorded, serial=serial)
        self.tag(SpyReader())

        bursts = {photo["source"]: photo["burst_id"] for photo in self.manifest().photos()}
        self.assertEqual(bursts, {
            "Ross/a.jpg": "NN26-0001",
            "Ross/b.jpg": "NN26-0001",
            "Ross/c.jpg": "NN26-0001",
            "Ross/d.jpg": None,
            "Ross/e.jpg": None,
        })

    def test_the_serial_is_never_written_anywhere_in_the_work_folder(self):
        reader, _ = self.a_folder()
        self.tag(reader)
        self.manifest().close()
        for path in self.config.work.rglob("*"):
            if path.is_file() and self.originals not in path.parents:
                with self.subTest(file=path.name):
                    self.assertNotIn(fixtures.SERIAL.encode(), path.read_bytes())

    def test_reports_missing_and_unlisted_folders(self):
        self.config = fixtures.make_work(
            self.root, photographers=fixtures.PHOTOGRAPHERS + "Sam,Sam,Start\n"
        )
        self.photo("Ross/a.jpg")
        self.photo("Extra/b.jpg")
        run = self.tag(SpyReader())
        self.assertEqual(run.missing_folders, ["Adrian/Finish", "Sam"])
        self.assertEqual(dict(run.uncovered), {"Extra": 1})


class TagCommandTest(TagCase):
    def test_prints_a_summary_and_the_next_step(self):
        self.a_folder()
        lines = []
        code = main(["--work", str(self.config.work), "tag"], say=lines.append)
        output = "\n".join(lines)
        self.assertEqual(code, 0)
        self.assertIn("Tagged 4 new photos", output)
        self.assertIn("1 HEIC (iPhone)", output)
        self.assertIn("Next: Fix the camera clocks", output)

    def test_refuses_a_bib_list_with_another_column(self):
        (self.config.work / "bibs.csv").write_text("bib,email\n125,ada@example.com\n")
        with contextlib.redirect_stderr(io.StringIO()):
            code = main(["--work", str(self.config.work), "tag"], say=lambda line: None)
        self.assertEqual(code, 2)
        self.assertFalse(self.config.manifest_path.exists())


if __name__ == "__main__":
    unittest.main()
