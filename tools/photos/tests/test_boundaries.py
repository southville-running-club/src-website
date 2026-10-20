"""Rules about which module may do what, checked by reading the source.

The TypeScript side has ESLint for this; Python here has nothing, so these tests are the
guard. Each one names the file and line that broke the rule.
"""

import ast
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "racephotos"

# Converting between zones, or reading the system clock, happens in london_time.py and
# nowhere else. ``now``/``today``/``fromtimestamp`` read the machine's own zone or clock;
# ``astimezone`` converts. ``localtime``/``mktime``/``gmtime`` are the ``time`` module's
# versions of the same thing.
CLOCK_OWNER = "london_time.py"
BANNED_ATTRIBUTES = {
    "astimezone",
    "now",
    "utcnow",
    "today",
    "fromtimestamp",
    "utcfromtimestamp",
    "localtime",
    "gmtime",
    "mktime",
}

# ADR-058: nothing that finds faces, ever, even "just to crop".
BANNED_MODULES = {"cv2", "face_recognition", "dlib", "mediapipe", "insightface", "deepface"}


def modules():
    for path in sorted(PACKAGE.rglob("*.py")):
        yield path, ast.parse(path.read_text(), filename=str(path))


def imported(node):
    if isinstance(node, ast.Import):
        return [alias.name.split(".")[0] for alias in node.names]
    if isinstance(node, ast.ImportFrom) and node.module:
        return [node.module.split(".")[0]]
    return []


class BoundariesTest(unittest.TestCase):
    def test_the_package_is_where_this_test_thinks_it_is(self):
        self.assertTrue((PACKAGE / CLOCK_OWNER).is_file())

    def test_only_london_time_imports_zoneinfo(self):
        offenders = [
            f"{path.relative_to(PACKAGE)}:{node.lineno}"
            for path, tree in modules()
            if path.name != CLOCK_OWNER
            for node in ast.walk(tree)
            if "zoneinfo" in imported(node)
        ]
        self.assertEqual(offenders, [], "zoneinfo belongs to london_time.py alone")

    def test_only_london_time_converts_zones_or_reads_the_clock(self):
        offenders = [
            f"{path.relative_to(PACKAGE)}:{node.lineno} .{node.attr}"
            for path, tree in modules()
            if path.name != CLOCK_OWNER
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr in BANNED_ATTRIBUTES
        ]
        self.assertEqual(offenders, [], "use racephotos.london_time instead")

    def test_nothing_imports_a_face_library(self):
        offenders = [
            f"{path.relative_to(PACKAGE)}:{node.lineno}"
            for path, tree in modules()
            for node in ast.walk(tree)
            if BANNED_MODULES.intersection(imported(node))
        ]
        self.assertEqual(offenders, [], "ADR-058: bib numbers are the only link")


if __name__ == "__main__":
    unittest.main()
