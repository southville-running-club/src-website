#!/usr/bin/env python3
"""Say where the acceptance suite spent its time.

The suite is the longest thing in the pipeline by a wide margin and until now nothing
reported how that time was distributed — so every conversation about shortening it had to
start by guessing, and a guess about which tests are expensive is usually wrong. This reads
Playwright's JSON report and writes Markdown for `$GITHUB_STEP_SUMMARY`.

**The per-project table is the point.** Every test runs in all three projects, and for a
great many of them that is real coverage — WebKit on Linux is the only thing that has ever
caught the radio-focus defect, and the no-javascript project is the only thing that sees a
form broken with scripting off. But a test asserting that a static page contains a sentence
cannot fail in one engine and pass in another, and it is charged three times regardless.
Knowing which files those are, and what they cost, is what makes trimming a decision rather
than a hunch.

Reads the report named on the command line. Never fails the build: a missing or malformed
report means the interesting information is elsewhere, and a timing summary is not worth
turning a red suite into a differently-red one — still less a green one into a red one.
"""

import collections
import json
import sys


def walk(suite, path=()):
    """Yield (file, project, title, ms, status) from Playwright's nested suites."""
    here = path + (suite.get("title", ""),) if path else (suite.get("title", ""),)
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            # `results` holds one entry per attempt; the last is the one that stood.
            results = test.get("results") or []
            if not results:
                continue
            ms = sum(r.get("duration", 0) for r in results)
            yield (
                spec.get("file", "?"),
                test.get("projectName", "?"),
                spec.get("title", "?"),
                ms,
                results[-1].get("status", "?"),
            )
    for child in suite.get("suites", []):
        yield from walk(child, here)


def human(ms):
    seconds = ms / 1000
    # A tenth of a second below ten, because the whole point of the slowest-tests table is
    # comparing the quick ones against each other, and `0s` next to `0s` says nothing.
    if seconds < 10:
        return f"{seconds:.1f}s"
    if seconds < 90:
        return f"{seconds:.0f}s"
    return f"{seconds / 60:.1f}m"


def main():
    if len(sys.argv) < 2:
        return 0
    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            report = json.load(handle)
    except (OSError, ValueError) as exc:
        print(f"_No timing summary: {exc}_")
        return 0

    rows = []
    for suite in report.get("suites", []):
        rows.extend(walk(suite))
    if not rows:
        print("_No timing summary: the report held no tests._")
        return 0

    total = sum(r[3] for r in rows)
    print("## Where the acceptance suite spent its time\n")
    print(f"{len(rows)} test runs, {human(total)} of test time.\n")

    by_file = collections.Counter()
    by_project = collections.Counter()
    matrix = collections.Counter()
    for file, project, _title, ms, _status in rows:
        short = file.split("/")[-1]
        by_file[short] += ms
        by_project[project] += ms
        matrix[(short, project)] += ms

    projects = [p for p, _ in by_project.most_common()]

    print("### By file, split by project\n")
    print("| File | " + " | ".join(projects) + " | Total | Share |")
    print("| --- |" + " --- |" * (len(projects) + 2))
    for short, ms in by_file.most_common():
        cells = " | ".join(human(matrix[(short, p)]) for p in projects)
        print(f"| `{short}` | {cells} | **{human(ms)}** | {100 * ms / total:.0f}% |")

    print("\n### Slowest individual tests\n")
    print("| Test | File | Project | Time |")
    print("| --- | --- | --- | --- |")
    for file, project, title, ms, _status in sorted(rows, key=lambda r: -r[3])[:20]:
        clean = title.replace("|", "\\|")[:90]
        print(f"| {clean} | `{file.split('/')[-1]}` | {project} | {human(ms)} |")

    return 0


if __name__ == "__main__":
    sys.exit(main())
