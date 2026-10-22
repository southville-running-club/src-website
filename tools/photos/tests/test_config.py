import shutil
import tempfile
import unittest
from pathlib import Path

from racephotos.config import ConfigError, enclosing_git_repository, load_config

EXAMPLE = Path(__file__).resolve().parent.parent / "config.example.toml"

GOOD = """
event_slug = "nn-2026"
short_id_prefix = "NN26"
[reader]
kind = "fake"
"""


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.work = self.root / "nn-photos"
        self.work.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, text):
        (self.work / "config.toml").write_text(text)

    def test_the_temporary_folder_is_not_inside_a_repository(self):
        # Every other test here depends on this; if it fails, the rest prove nothing.
        self.assertIsNone(enclosing_git_repository(self.root))

    def test_reads_the_example_and_resolves_paths_against_the_work_folder(self):
        shutil.copy(EXAMPLE, self.work / "config.toml")
        config = load_config(self.work)
        self.assertEqual(config.event_slug, "nn-2026")
        self.assertEqual(config.short_id_prefix, "NN26")
        self.assertEqual(config.originals, self.work / "originals")
        self.assertEqual(config.bibs_csv, self.work / "bibs.csv")
        self.assertEqual(config.manifest_path, self.work / "manifest.sqlite")
        self.assertIsNone(config.fake_reads)

    def test_refuses_a_work_folder_inside_a_repository(self):
        (self.root / ".git").mkdir()
        self.write(GOOD)
        with self.assertRaises(ConfigError) as caught:
            load_config(self.work)
        self.assertIn("inside the git repository", str(caught.exception))

    def test_a_git_file_counts_as_a_repository_too(self):
        (self.root / ".git").write_text("gitdir: /elsewhere\n")
        self.write(GOOD)
        with self.assertRaises(ConfigError):
            load_config(self.work)

    def test_refuses_originals_inside_a_repository(self):
        repository = self.root / "some-repo"
        (repository / ".git").mkdir(parents=True)
        self.write(
            f'event_slug = "nn-2026"\nshort_id_prefix = "NN26"\noriginals = "{repository / "photos"}"\n'
            '[reader]\nkind = "fake"\n'
        )
        with self.assertRaises(ConfigError) as caught:
            load_config(self.work)
        self.assertIn("originals folder", str(caught.exception))

    def test_finds_this_repository(self):
        here = Path(__file__).resolve()
        self.assertIsNotNone(enclosing_git_repository(here))

    def test_refuses_a_missing_config(self):
        with self.assertRaises(ConfigError) as caught:
            load_config(self.work)
        self.assertIn("config.example.toml", str(caught.exception))

    def test_refuses_any_reader_but_the_fake(self):
        self.write(GOOD.replace('kind = "fake"', 'kind = "openai"'))
        with self.assertRaises(ConfigError) as caught:
            load_config(self.work)
        self.assertIn("waits on the choice of provider", str(caught.exception))

    def test_refuses_a_misspelt_setting(self):
        self.write('orginals = "x"\n' + GOOD)
        with self.assertRaises(ConfigError) as caught:
            load_config(self.work)
        self.assertIn("orginals", str(caught.exception))

    def test_refuses_a_malformed_slug_or_prefix(self):
        for bad in (GOOD.replace("nn-2026", "NN 2026"), GOOD.replace("NN26", "nn26")):
            with self.subTest(config=bad):
                self.write(bad)
                with self.assertRaises(ConfigError):
                    load_config(self.work)


if __name__ == "__main__":
    unittest.main()
