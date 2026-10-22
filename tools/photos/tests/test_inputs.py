import tempfile
import unittest
from pathlib import Path

from racephotos.inputs import InputError, load_bibs, load_photographers

# Invented, and shaped like what an entries export would carry if somebody exported the
# wrong columns: the refusal must never print any of it back.
NAME = "Ada Example"
EMAIL = "ada@example.com"


class InputFileCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, text, encoding="utf-8"):
        path = self.dir / name
        path.write_text(text, encoding=encoding)
        return path


class BibsTest(InputFileCase):
    def test_reads_one_bib_column_as_text(self):
        bibs = load_bibs(self.write("bibs.csv", "bib\n120\n0311\n311\n\n7\n"))
        self.assertEqual(bibs.bibs, {"120", "0311", "311", "7"})
        self.assertEqual(bibs.duplicates, 0)

    def test_keeps_leading_zeros_apart(self):
        bibs = load_bibs(self.write("bibs.csv", "bib\n0311\n311\n"))
        self.assertIn("0311", bibs.bibs)
        self.assertIn("311", bibs.bibs)

    def test_accepts_the_byte_order_mark_excel_writes(self):
        bibs = load_bibs(self.write("bibs.csv", "bib\r\n101\r\n", encoding="utf-8-sig"))
        self.assertEqual(bibs.bibs, {"101"})

    def test_counts_duplicates_rather_than_refusing_them(self):
        bibs = load_bibs(self.write("bibs.csv", "bib\n101\n101\n102\n"))
        self.assertEqual(bibs.bibs, {"101", "102"})
        self.assertEqual(bibs.duplicates, 1)

    def test_refuses_an_extra_column_in_the_heading(self):
        path = self.write("bibs.csv", f"bib,name,email\n101,{NAME},{EMAIL}\n")
        with self.assertRaises(InputError) as caught:
            load_bibs(path)
        message = str(caught.exception)
        self.assertIn("exactly one column", message)
        self.assertIn("3 columns", message)
        self.assertNotIn(NAME, message)
        self.assertNotIn(EMAIL, message)

    def test_refuses_an_extra_cell_on_a_data_row(self):
        path = self.write("bibs.csv", f"bib\n101\n102,{EMAIL}\n")
        with self.assertRaises(InputError) as caught:
            load_bibs(path)
        self.assertIn("Row 3 has 2 columns", str(caught.exception))
        self.assertNotIn(EMAIL, str(caught.exception))

    def test_refuses_a_trailing_empty_column_too(self):
        with self.assertRaises(InputError):
            load_bibs(self.write("bibs.csv", "bib,\n101,\n"))

    def test_refuses_a_file_with_no_heading_without_quoting_it(self):
        path = self.write("bibs.csv", f"{EMAIL}\n101\n")
        with self.assertRaises(InputError) as caught:
            load_bibs(path)
        self.assertIn("heading bib", str(caught.exception))
        self.assertNotIn(EMAIL, str(caught.exception))

    def test_refuses_a_value_that_is_not_a_bib_without_quoting_it(self):
        path = self.write("bibs.csv", f"bib\n101\n{NAME}\n")
        with self.assertRaises(InputError) as caught:
            load_bibs(path)
        self.assertIn("row 3 is not a bib number", str(caught.exception))
        self.assertNotIn(NAME, str(caught.exception))

    def test_refuses_an_empty_file_and_a_heading_alone(self):
        with self.assertRaises(InputError):
            load_bibs(self.write("bibs.csv", "\n\n"))
        with self.assertRaises(InputError):
            load_bibs(self.write("bibs.csv", "bib\n"))

    def test_refuses_a_missing_file_by_name(self):
        with self.assertRaises(InputError) as caught:
            load_bibs(self.dir / "bibs.csv")
        self.assertIn("was not found", str(caught.exception))


class PhotographersTest(InputFileCase):
    def test_reads_folders_credits_and_spots(self):
        photographers = load_photographers(
            self.write(
                "photographers.csv",
                "folder,credit,spot\nAdrian/Finish,Adrian,Finish\nAdrian/Start/,Adrian,Start\n"
                "Ross,Ross,On the course\n",
            )
        )
        self.assertEqual(
            [(p.folder, p.credit, p.spot) for p in photographers],
            [
                ("Adrian/Finish", "Adrian", "Finish"),
                ("Adrian/Start", "Adrian", "Start"),
                ("Ross", "Ross", "On the course"),
            ],
        )

    def test_refuses_the_wrong_headings(self):
        with self.assertRaises(InputError):
            load_photographers(self.write("photographers.csv", "name,credit,spot\nA,A,Start\n"))

    def test_refuses_paths_that_leave_the_originals_folder(self):
        for folder in ("/Users/someone/photos", "../elsewhere", "Adrian/../Ross", ".hidden", "A\\B"):
            with self.subTest(folder=folder), self.assertRaises(InputError):
                load_photographers(
                    self.write("photographers.csv", f"folder,credit,spot\n{folder},A,Start\n")
                )

    def test_refuses_a_folder_listed_twice_in_any_case(self):
        with self.assertRaises(InputError):
            load_photographers(
                self.write("photographers.csv", "folder,credit,spot\nAdrian,A,Start\nadrian,A,Finish\n")
            )

    def test_refuses_a_folder_inside_another_listed_folder(self):
        with self.assertRaises(InputError) as caught:
            load_photographers(
                self.write(
                    "photographers.csv",
                    "folder,credit,spot\nAdrian,Adrian,Start\nAdrian/Finish,Adrian,Finish\n",
                )
            )
        self.assertIn("read twice", str(caught.exception))

    def test_a_shared_prefix_is_not_nesting(self):
        photographers = load_photographers(
            self.write("photographers.csv", "folder,credit,spot\nAnn,Ann,Start\nAnna,Anna,Finish\n")
        )
        self.assertEqual(len(photographers), 2)

    def test_refuses_a_row_without_a_credit_or_spot(self):
        with self.assertRaises(InputError):
            load_photographers(self.write("photographers.csv", "folder,credit,spot\nAdrian,,Start\n"))


if __name__ == "__main__":
    unittest.main()
