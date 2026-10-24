"""The SQL file of every read.

The text is pinned to a golden file that the database layer also runs, twice, against a
real Postgres (``platform/packages/db/tests/photos.test.ts``). So the two halves meet in one
file: this test says the writer still produces exactly that SQL, and the database test says
that SQL is idempotent and never overwrites the website. After a deliberate change to the
writer, regenerate it with::

    UPDATE_GOLDEN=1 .venv/bin/python -m unittest tests.test_sqlfile
"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from racephotos import sqlfile
from racephotos.inputs import Photographer
from racephotos.manifest import Manifest, NewPhoto, NewRead
from racephotos.matching import Classified, Outcome, Reason
from racephotos.reader import BibRead
from racephotos.sqlfile import SqlRefused, bib_rows, build_parts, literal, sendable, text

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "platform" / "packages" / "db" / "tests" / "fixtures" / "photos-golden.sql"
)
NOW = "2026-11-01T20:00:00.000Z"
PHOTOGRAPHERS = (
    Photographer("Adrian/Finish", "Adrian", "Finish"),
    Photographer("Ross", "Ross O'Neill", "On the course"),
)


def read(text_, confidence, outcome, reason=None, fits=()):
    return NewRead(BibRead(text_, confidence), Classified(outcome, reason, tuple(fits)), 0.9)


def build_manifest(path: Path) -> Manifest:
    """Six invented photos covering every case the file has to get right. Fixed IDs and
    times, so the text is the same on every machine."""
    manifest = Manifest.open(path, "nn-2026")
    photos = [
        # A confident whole bib, with its leading zero.
        ("0001", "Adrian/Finish", "2026-11-01T11:00:05.000Z", (read("0311", 0.97, Outcome.TAGGED, fits=("0311",)),)),
        # A part read nobody has decided.
        ("0002", "Adrian/Finish", "2026-11-01T11:00:06.000Z", (read("12?", 0.95, Outcome.PART_READ, fits=("120", "121")),)),
        # Unsure, then confirmed by a person on the laptop. A credit with an apostrophe, and
        # a photo with no recorded time.
        ("0003", "Ross", None, (read("125", 0.5, Outcome.REVIEW, Reason.LOW_CONFIDENCE, ("125",)),)),
        # No bib seen.
        ("0004", "Ross", "2026-11-01T11:20:00.000Z", ()),
        # Hidden on the laptop: never in the file.
        ("0005", "Ross", "2026-11-01T11:21:00.000Z", ()),
        # A number that is not a bib, and a read with no digit at all.
        ("0006", "Ross", "2026-11-01T11:22:00.000Z", (
            read("999", 0.99, Outcome.REVIEW, Reason.NOT_A_BIB),
            read("???", 0.4, Outcome.REVIEW, Reason.UNREADABLE),
        )),
    ]
    for number, folder, taken_at, reads in photos:
        fingerprint = number * 16
        manifest.add_photo(
            NewPhoto(
                fingerprint=fingerprint,
                photo_id=f"00000000-0000-4000-8000-00000000{number}",
                short_id=f"NN26-{number}",
                sequence=int(number),
                source=f"{folder}/{number}.jpg",
                folder=folder,
                camera_key="0" * 16,
                camera_label="FakeCam",
                recorded=None,
                reads=reads,
                reader_problem=None,
                raw_answer=None,
                width=2400,
                height=1600,
                sizes={"full": 1, "medium": 1, "thumb": 1},
            ),
            NOW,
        )
        manifest.set_times([(fingerprint, taken_at, None)])
        for size in ("full", "medium", "thumb"):
            manifest.record_upload(fingerprint, size, dry_run=False, key=f"k/{number}/{size}",
                                   sha256="x", length=1, now=NOW)
    manifest.set_bursts({"0001" * 16: "NN26-0001", "0002" * 16: "NN26-0001"})
    (unsure,) = manifest.reads("0003" * 16)
    manifest.decide_read(unsure["id"], "confirmed", "125", "2026-11-01T19:30:00.000Z")
    manifest.hide("0005" * 16, NOW)
    return manifest


class SqlFileCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.manifest = build_manifest(Path(self._tmp.name) / "manifest.sqlite")
        self.addCleanup(self.manifest.close)

    def parts(self):
        return build_parts(
            "nn-2026", sendable(self.manifest, dry_run=False), self.manifest.reads_by_photo(),
            PHOTOGRAPHERS, NOW,
        )


class GoldenTest(SqlFileCase):
    def test_the_writer_still_produces_the_golden_file(self):
        (sql,) = self.parts()
        if os.environ.get("UPDATE_GOLDEN"):
            GOLDEN.parent.mkdir(parents=True, exist_ok=True)
            GOLDEN.write_text(sql, encoding="utf-8")
        self.assertEqual(sql, GOLDEN.read_text(encoding="utf-8"))

    def test_what_the_file_holds_and_leaves_out(self):
        (sql,) = self.parts()
        self.assertIn("'Ross O''Neill'", sql)
        self.assertIn("'0311'", sql)
        self.assertNotIn("NN26-0005", sql, "a hidden photo is never in the file")
        self.assertNotIn("'???'", sql, "a read with no digit is left out")
        self.assertIn("'999'", sql, "a number that is not a bib still goes to the checkers")
        self.assertNotIn("hidden_at", sql.split("-- Bib rows")[0].split("values")[0])
        self.assertTrue(sql.rstrip().endswith("commit;"))


class BibRowsTest(SqlFileCase):
    def rows(self, number):
        return {row.bib_text: row for row in bib_rows(self.manifest.reads(number * 16))}

    def test_a_confident_read_is_confirmed_by_the_model(self):
        row = self.rows("0001")["0311"]
        self.assertEqual((row.confirmed, row.source, row.confidence), (True, "model", 0.97))

    def test_a_part_read_is_never_confirmed(self):
        self.assertFalse(self.rows("0002")["12?"].confirmed)

    def test_a_laptop_decision_is_a_person_s_with_its_time(self):
        row = self.rows("0003")["125"]
        self.assertEqual((row.confirmed, row.source, row.decided_at), (True, "person", "2026-11-01T19:30:00.000Z"))

    def test_a_read_a_person_said_was_no_bib_is_left_out(self):
        self.manifest.no_bib_visible("0001" * 16, NOW)
        self.assertEqual(self.rows("0001"), {})

    def test_two_reads_of_one_bib_become_one_row(self):
        self.manifest.add_person_read("0001" * 16, "0311", "burst", NOW)
        rows = bib_rows(self.manifest.reads("0001" * 16))
        self.assertEqual([row.bib_text for row in rows], ["0311"])
        self.assertEqual((rows[0].confirmed, rows[0].source, rows[0].confidence), (True, "person", 0.97))


class WritingTest(SqlFileCase):
    def test_splits_into_parts_and_numbers_them(self):
        with mock.patch.object(sqlfile, "PART_SIZE", 2):
            parts = self.parts()
        self.assertEqual(len(parts), 3)
        self.assertIn("part 1 of 3: NN26-0001 to NN26-0002", parts[0])
        self.assertIn("part 3 of 3: NN26-0006 to NN26-0006", parts[2])

    def test_refuses_a_photo_whose_folder_is_no_longer_listed(self):
        with self.assertRaises(SqlRefused) as caught:
            build_parts("nn-2026", sendable(self.manifest, dry_run=False), self.manifest.reads_by_photo(),
                        PHOTOGRAPHERS[:1], NOW)
        self.assertIn("Ross", str(caught.exception))

    def test_only_photos_sent_in_this_mode_are_included(self):
        self.assertEqual(sendable(self.manifest, dry_run=True), [])

    def test_literals(self):
        self.assertEqual(text("it's"), "'it''s'")
        self.assertEqual(literal(None), "null")
        self.assertEqual(literal(True), "true")
        self.assertEqual(literal(0.5), "0.500")
        self.assertEqual(literal(2400), "2400")
        with self.assertRaises(SqlRefused):
            text("nul\x00")


if __name__ == "__main__":
    unittest.main()
