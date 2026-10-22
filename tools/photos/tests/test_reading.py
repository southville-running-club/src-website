import json
import tempfile
import unittest
from pathlib import Path

from racephotos.files import fingerprint
from racephotos.matching import Outcome, Reason, check_threshold, classify, fits
from racephotos.reader import BibRead, FakeReader, parse_reads

BIBS = frozenset({"120", "121", "125", "129", "12", "1200", "130", "012", "001", "011", "1", "0011", "101"})


class ParseReadsTest(unittest.TestCase):
    def test_reads_the_agreed_shape(self):
        parsed = parse_reads('{"bibs": [{"text": "123", "confidence": 0.97}, {"text": "12?", "confidence": 1}]}')
        self.assertTrue(parsed.ok)
        self.assertEqual(parsed.reads, (BibRead("123", 0.97), BibRead("12?", 1.0)))

    def test_an_empty_list_is_a_valid_answer(self):
        parsed = parse_reads('{"bibs": []}')
        self.assertTrue(parsed.ok)
        self.assertEqual(parsed.reads, ())

    def test_keeps_the_best_confidence_for_a_repeated_bib(self):
        parsed = parse_reads('{"bibs": [{"text": "7", "confidence": 0.4}, {"text": "7", "confidence": 0.8}]}')
        self.assertEqual(parsed.reads, (BibRead("7", 0.8),))

    def test_malformed_answers_are_problems_never_bibs_and_never_exceptions(self):
        malformed = {
            "prose": "I can see bib 123 on the runner in front.",
            "markdown fence": '```json\n{"bibs": []}\n```',
            "truncated": '{"bibs": [{"text": "123", "confi',
            "empty": "",
            "a list": '[{"text": "123", "confidence": 0.9}]',
            "extra key": '{"bibs": [], "people": 2}',
            "bibs not a list": '{"bibs": "123"}',
            "item extra key": '{"bibs": [{"text": "123", "confidence": 0.9, "shirt": "red"}]}',
            "item missing key": '{"bibs": [{"text": "123"}]}',
            "letters": '{"bibs": [{"text": "12a", "confidence": 0.9}]}',
            "too long a bib": '{"bibs": [{"text": "123456789", "confidence": 0.9}]}',
            "number not text": '{"bibs": [{"text": 123, "confidence": 0.9}]}',
            "confidence true": '{"bibs": [{"text": "123", "confidence": true}]}',
            "confidence text": '{"bibs": [{"text": "123", "confidence": "high"}]}',
            "confidence over 1": '{"bibs": [{"text": "123", "confidence": 1.5}]}',
            "confidence negative": '{"bibs": [{"text": "123", "confidence": -0.1}]}',
            "NaN": '{"bibs": [{"text": "123", "confidence": NaN}]}',
            "Infinity": '{"bibs": [{"text": "123", "confidence": Infinity}]}',
            "duplicate key": '{"bibs": [], "bibs": [{"text": "123", "confidence": 0.9}]}',
            "too many bibs": json.dumps({"bibs": [{"text": str(n), "confidence": 0.9} for n in range(21)]}),
            "enormous": '{"bibs": []}' + " " * 30_000,
            "deeply nested": "[" * 9_000 + "]" * 9_000,
            "not text at all": None,
            "bytes": b'{"bibs": []}',
        }
        for name, raw in malformed.items():
            with self.subTest(answer=name):
                parsed = parse_reads(raw)
                self.assertFalse(parsed.ok)
                self.assertEqual(parsed.reads, ())
                self.assertIsInstance(parsed.problem, str)


class FitsTest(unittest.TestCase):
    def test_a_part_read_fits_exactly_the_bibs_of_its_length(self):
        self.assertEqual(fits("12?", BIBS), ("120", "121", "125", "129"))

    def test_the_unread_digit_can_be_anywhere(self):
        self.assertEqual(fits("?2?", BIBS), ("120", "121", "125", "129"))
        self.assertEqual(fits("?1?", BIBS), ("011", "012"))

    def test_leading_zeros_are_digits(self):
        self.assertEqual(fits("0?1", BIBS), ("001", "011"))

    def test_fits_nothing(self):
        self.assertEqual(fits("9?9", BIBS), ())


class ClassifyTest(unittest.TestCase):
    def check(self, text, confidence, threshold=0.9):
        return classify(BibRead(text, confidence), BIBS, threshold)

    def test_a_confident_whole_bib_on_the_list_is_tagged(self):
        result = self.check("125", 0.95)
        self.assertEqual((result.outcome, result.fits), (Outcome.TAGGED, ("125",)))

    def test_a_whole_number_not_on_the_list_goes_to_review(self):
        result = self.check("999", 0.99)
        self.assertEqual((result.outcome, result.reason), (Outcome.REVIEW, Reason.NOT_A_BIB))

    def test_below_the_threshold_goes_to_review_with_its_candidates(self):
        result = self.check("125", 0.5)
        self.assertEqual((result.outcome, result.reason, result.fits), (Outcome.REVIEW, Reason.LOW_CONFIDENCE, ("125",)))
        self.assertEqual(self.check("12?", 0.5).fits, ("120", "121", "125", "129"))

    def test_a_confident_part_read_is_part_read_with_every_fit(self):
        result = self.check("12?", 0.95)
        self.assertEqual((result.outcome, result.fits), (Outcome.PART_READ, ("120", "121", "125", "129")))

    def test_a_part_read_that_fits_nothing_goes_to_review(self):
        self.assertEqual(self.check("9?9", 0.95).reason, Reason.FITS_NOTHING)

    def test_no_digits_at_all_goes_to_review(self):
        self.assertEqual(self.check("???", 0.99).reason, Reason.UNREADABLE)

    def test_the_threshold_is_inclusive_and_bounded(self):
        self.assertEqual(self.check("125", 0.9).outcome, Outcome.TAGGED)
        for bad in (0, -1, 1.01):
            with self.subTest(threshold=bad), self.assertRaises(ValueError):
                check_threshold(bad)


class FakeReaderTest(unittest.TestCase):
    def test_answers_by_the_original_s_fingerprint_from_a_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            originals = Path(tmp) / "originals"
            (originals / "Ross").mkdir(parents=True)
            one = originals / "Ross" / "a.jpg"
            two = originals / "Ross" / "b.jpg"
            one.write_bytes(b"one")
            two.write_bytes(b"two")
            table = Path(tmp) / "fake-reads.json"
            table.write_text(json.dumps({"Ross/a.jpg": {"bibs": [{"text": "120", "confidence": 1}]}, "Ross/b.jpg": "garbled"}))

            reader = FakeReader.from_file(table, originals)
            self.assertEqual(parse_reads(reader.read(b"", fingerprint(one))).reads, (BibRead("120", 1.0),))
            self.assertEqual(reader.read(b"", fingerprint(two)), "garbled")
            self.assertEqual(parse_reads(reader.read(b"", "unknown")).reads, ())

    def test_refuses_a_table_naming_a_missing_photo(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = Path(tmp) / "fake-reads.json"
            table.write_text('{"Ross/missing.jpg": "x"}')
            with self.assertRaises(ValueError):
                FakeReader.from_file(table, Path(tmp))


if __name__ == "__main__":
    unittest.main()
