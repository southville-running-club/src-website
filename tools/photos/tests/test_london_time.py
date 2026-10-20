import unittest
from datetime import datetime, timezone

from racephotos.london_time import (
    RepeatedHour,
    SkippedHour,
    format_london,
    from_utc_iso,
    london_to_utc,
    to_utc_iso,
    utc_to_london,
)


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


class LondonToUtcTest(unittest.TestCase):
    def test_race_day_is_greenwich_mean_time(self):
        self.assertEqual(london_to_utc(datetime(2026, 11, 1, 11, 0, 5)), utc(2026, 11, 1, 11, 0, 5))

    def test_summer_is_an_hour_ahead(self):
        self.assertEqual(london_to_utc(datetime(2026, 8, 1, 12, 0)), utc(2026, 8, 1, 11, 0))

    def test_keeps_fractions_of_a_second(self):
        self.assertEqual(
            london_to_utc(datetime(2026, 11, 1, 11, 0, 5, 250000)),
            utc(2026, 11, 1, 11, 0, 5, 250000),
        )

    def test_either_side_of_the_clocks_going_back(self):
        self.assertEqual(london_to_utc(datetime(2026, 10, 25, 0, 59, 59)), utc(2026, 10, 24, 23, 59, 59))
        self.assertEqual(london_to_utc(datetime(2026, 10, 25, 2, 0)), utc(2026, 10, 25, 2, 0))

    def test_refuses_the_hour_that_happens_twice(self):
        with self.assertRaises(RepeatedHour):
            london_to_utc(datetime(2026, 10, 25, 1, 30))

    def test_refuses_the_hour_that_never_happens(self):
        with self.assertRaises(SkippedHour):
            london_to_utc(datetime(2026, 3, 29, 1, 30))

    def test_refuses_a_reading_that_already_has_a_zone(self):
        with self.assertRaises(TypeError):
            london_to_utc(utc(2026, 11, 1, 11, 0))


class OtherDirectionTest(unittest.TestCase):
    def test_round_trips_outside_the_changes(self):
        for wall in (datetime(2026, 11, 1, 11, 0, 5), datetime(2026, 7, 4, 9, 30)):
            with self.subTest(wall=wall):
                self.assertEqual(utc_to_london(london_to_utc(wall)), wall)

    def test_formats_with_the_zone_a_person_would_see(self):
        self.assertEqual(format_london(utc(2026, 11, 1, 11, 0, 5)), "Sun 1 Nov 2026, 11:00:05 GMT")
        self.assertEqual(format_london(utc(2026, 8, 1, 11, 0)), "Sat 1 Aug 2026, 12:00:00 BST")

    def test_storage_form_round_trips(self):
        instant = utc(2026, 11, 1, 11, 0, 5, 250000)
        self.assertEqual(to_utc_iso(instant), "2026-11-01T11:00:05.250Z")
        self.assertEqual(from_utc_iso(to_utc_iso(instant)), instant)


if __name__ == "__main__":
    unittest.main()
