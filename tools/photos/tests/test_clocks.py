import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from racephotos import clocks
from racephotos.manifest import Manifest
from racephotos.tag import run_tag

from . import fixtures
from .fixtures import SpyReader, make_jpeg

NOW = "2026-11-01T20:00:00.000Z"


class ClockCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.config = fixtures.make_work(Path(self._tmp.name).resolve())
        self.manifest = None

    def tearDown(self):
        if self.manifest:
            self.manifest.close()
        self._tmp.cleanup()

    def photo(self, name, recorded, serial):
        make_jpeg(self.config.originals / "Ross" / name, recorded=recorded, serial=serial)

    def tag(self):
        if self.manifest:
            self.manifest.close()
        run = run_tag(self.config, SpyReader(), 0.9, say=lambda line: None)
        self.manifest = Manifest.open(self.config.manifest_path, self.config.event_slug)
        return run

    def camera_of(self, name):
        return self.photo_row(name)["camera_key"]

    def photo_row(self, name):
        return next(photo for photo in self.manifest.photos() if photo["source"] == f"Ross/{name}")

    def taken(self, name):
        return self.photo_row(name)["taken_at"]


class ClockMathsTest(ClockCase):
    def setUp(self):
        super().setUp()
        # Camera A was left on summer time: it reads an hour ahead on race day, which is
        # Greenwich Mean Time. Its first photo is of a phone showing 11:00:05.
        self.photo("phone.jpg", "2026:11:01 12:00:05", "A")
        self.photo("runner.jpg", "2026:11:01 12:30:00", "A")
        # Camera B is right.
        self.photo("other.jpg", "2026:11:01 11:15:00", "B")
        self.tag()

    def test_a_camera_on_summer_time_is_an_hour_ahead_and_one_correction_fixes_every_photo(self):
        camera = self.camera_of("phone.jpg")
        clocks.decide_by_phone(
            self.manifest, camera, self.photo_row("phone.jpg")["fingerprint"], datetime(2026, 11, 1, 11, 0, 5), NOW
        )
        self.assertEqual(self.taken("phone.jpg"), "2026-11-01T11:00:05.000Z")
        self.assertEqual(self.taken("runner.jpg"), "2026-11-01T11:30:00.000Z")
        self.assertEqual(clocks.offset_of(self.manifest.camera(camera)), timedelta(hours=-1))

    def test_only_that_camera_moves(self):
        clocks.decide_by_phone(
            self.manifest, self.camera_of("phone.jpg"), self.photo_row("phone.jpg")["fingerprint"],
            datetime(2026, 11, 1, 11, 0, 5), NOW,
        )
        self.assertIsNone(self.taken("other.jpg"), "camera B has no decision yet")

    def test_keeping_a_camera_s_time_as_recorded_is_a_decision(self):
        camera = self.camera_of("other.jpg")
        self.assertIn(camera, {summary.camera_key for summary in clocks.undecided(self.manifest)})
        clocks.keep_as_recorded(self.manifest, camera, NOW)
        self.assertEqual(self.taken("other.jpg"), "2026-11-01T11:15:00.000Z")
        self.assertEqual(self.manifest.camera(camera)["decision"], clocks.AS_RECORDED)
        self.assertNotIn(camera, {summary.camera_key for summary in clocks.undecided(self.manifest)})

    def test_a_later_tag_run_times_new_photos_from_a_decided_camera(self):
        clocks.decide_by_phone(
            self.manifest, self.camera_of("phone.jpg"), self.photo_row("phone.jpg")["fingerprint"],
            datetime(2026, 11, 1, 11, 0, 5), NOW,
        )
        self.photo("late.jpg", "2026:11:01 13:00:00", "A")
        self.tag()
        self.assertEqual(self.taken("late.jpg"), "2026-11-01T12:00:00.000Z")

    def test_refuses_a_reference_photo_from_another_camera(self):
        with self.assertRaises(clocks.ClockError):
            clocks.decide_by_phone(
                self.manifest, self.camera_of("phone.jpg"), self.photo_row("other.jpg")["fingerprint"],
                datetime(2026, 11, 1, 11, 0), NOW,
            )

    def test_describes_an_offset_in_words(self):
        self.assertEqual(clocks.describe_offset(timedelta(hours=-1)), "1 h 0 min 0 s earlier")
        self.assertEqual(clocks.describe_offset(timedelta(seconds=63)), "1 min 3 s later")
        self.assertEqual(clocks.describe_offset(timedelta(0)), "no change")


class ClockPhotoIsHiddenTest(ClockCase):
    """The photo a phone time is typed from shows the photographer's phone."""

    def setUp(self):
        super().setUp()
        # A test shot first, then the phone, then a runner.
        self.photo("test-shot.jpg", "2026:11:01 11:54:30", "A")
        self.photo("phone.jpg", "2026:11:01 11:55:00", "A")
        self.photo("runner.jpg", "2026:11:01 12:30:00", "A")
        self.tag()
        self.camera = self.camera_of("phone.jpg")

    def by_phone(self, name, phone=datetime(2026, 11, 1, 10, 55)):
        clocks.decide_by_phone(self.manifest, self.camera, self.photo_row(name)["fingerprint"], phone, NOW)

    def hidden(self):
        return {
            photo["source"].removeprefix("Ross/"): photo["hidden_reason"]
            for photo in self.manifest.photos()
            if photo["hidden_at"]
        }

    def test_the_photo_a_phone_time_was_typed_from_is_hidden_and_only_that_one(self):
        self.by_phone("phone.jpg")
        self.assertEqual(self.hidden(), {"phone.jpg": "clock_reference"})

    def test_keeping_the_recorded_time_hides_nothing(self):
        clocks.keep_as_recorded(self.manifest, self.camera, NOW)
        self.assertEqual(self.hidden(), {})

    def test_choosing_another_photo_shows_the_first_again_and_hides_the_new_one(self):
        self.by_phone("test-shot.jpg", datetime(2026, 11, 1, 10, 54, 30))
        self.assertEqual(self.hidden(), {"test-shot.jpg": "clock_reference"})
        self.by_phone("phone.jpg")
        self.assertEqual(self.hidden(), {"phone.jpg": "clock_reference"})

    def test_switching_to_keep_as_recorded_shows_the_phone_photo_again(self):
        self.by_phone("phone.jpg")
        clocks.keep_as_recorded(self.manifest, self.camera, NOW)
        self.assertEqual(self.hidden(), {})

    def test_a_photo_a_person_hid_stays_hidden_whatever_the_clock_decision(self):
        self.manifest.hide(self.photo_row("phone.jpg")["fingerprint"], NOW)
        self.by_phone("phone.jpg")
        clocks.keep_as_recorded(self.manifest, self.camera, NOW)
        self.assertEqual(self.hidden(), {"phone.jpg": "person"})

    def test_a_person_can_show_it_again_and_it_stays_shown_when_another_photo_is_chosen(self):
        self.by_phone("test-shot.jpg", datetime(2026, 11, 1, 10, 54, 30))
        self.manifest.show(self.photo_row("test-shot.jpg")["fingerprint"])
        self.by_phone("phone.jpg")
        self.assertEqual(self.hidden(), {"phone.jpg": "clock_reference"})


class ClocksChangeNightTest(ClockCase):
    def test_a_corrected_time_in_the_repeated_hour_flags_the_camera_and_stops_nothing(self):
        # A camera an hour fast photographs the phone at 01:30 on the night the clocks go back,
        # an hour that happened twice. The photo is left without a time, the camera is
        # flagged, and nothing raises.
        self.photo("night.jpg", "2026:10:25 02:30:00", "C")
        self.photo("morning.jpg", "2026:10:25 09:00:00", "C")
        self.tag()
        clocks.decide_by_phone(
            self.manifest, self.camera_of("night.jpg"), self.photo_row("night.jpg")["fingerprint"],
            datetime(2026, 10, 25, 1, 30), NOW,
        )
        night = self.photo_row("night.jpg")
        self.assertIsNone(night["taken_at"])
        self.assertEqual(night["time_problem"], "repeated_hour")
        self.assertEqual(self.taken("morning.jpg"), "2026-10-25T08:00:00.000Z")

        (summary,) = clocks.summaries(self.manifest)
        self.assertTrue(summary.decided, "a flag does not undo the decision or block upload")
        self.assertEqual(summary.flagged, 1)

    def test_a_tag_run_carries_on_past_a_photo_in_the_skipped_hour(self):
        self.photo("a.jpg", "2026:03:29 03:00:00", "D")
        self.tag()
        clocks.decide_by_phone(
            self.manifest, self.camera_of("a.jpg"), self.photo_row("a.jpg")["fingerprint"],
            datetime(2026, 3, 29, 1, 30), NOW,
        )
        self.assertEqual(self.photo_row("a.jpg")["time_problem"], "skipped_hour")

        self.photo("b.jpg", "2026:03:29 03:20:00", "D")
        self.photo("c.jpg", "2026:03:29 05:00:00", "D")
        run = self.tag()
        self.assertEqual(run.tagged, 2)
        self.assertEqual(self.photo_row("b.jpg")["time_problem"], "skipped_hour")
        self.assertEqual(self.taken("c.jpg"), "2026-03-29T02:30:00.000Z")


if __name__ == "__main__":
    unittest.main()
