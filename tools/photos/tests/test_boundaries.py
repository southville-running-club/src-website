"""Rules about which module may do what, checked by reading the source.

The TypeScript side has ESLint for this; Python here has nothing, so these tests are the
guard. Each one names the file and line that broke the rule.
"""

import ast
import io
import tokenize
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

    @unittest.skipUnless(hasattr(tokenize, "FSTRING_START"), "on 3.11 the import is the test")
    def test_f_strings_still_parse_on_python_3_11(self):
        # The README promises Python 3.11 and newer, for Andrew's machine, and this Mac has
        # no 3.11 to run the suite on. Python 3.12 relaxed f-strings (PEP 701), so code that
        # passes here can still be a SyntaxError there. 3.11 refuses a backslash or a comment
        # inside an f-string's braces, and the outer quote reused inside a one-quote f-string.
        offenders = []
        for path in sorted(PACKAGE.rglob("*.py")):
            open_quotes = []
            for token in tokenize.generate_tokens(io.StringIO(path.read_text()).readline):
                where = f"{path.relative_to(PACKAGE)}:{token.start[0]}"
                if token.type == tokenize.FSTRING_START:
                    quote = token.string.lstrip("fFrRbBuU")
                    if open_quotes and len(open_quotes[-1]) == 1 and quote[0] == open_quotes[-1]:
                        offenders.append(f"{where} reuses its quote")
                    open_quotes.append(quote)
                elif token.type == tokenize.FSTRING_END:
                    open_quotes.pop()
                elif open_quotes and token.type != tokenize.FSTRING_MIDDLE:
                    if token.type == tokenize.COMMENT or "\\" in token.string:
                        offenders.append(f"{where} has a backslash or comment in braces")
                    if token.type == tokenize.STRING and len(open_quotes[-1]) == 1:
                        if token.string.lstrip("rRbBuU")[:1] == open_quotes[-1]:
                            offenders.append(f"{where} reuses its quote")
        self.assertEqual(offenders, [])

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
