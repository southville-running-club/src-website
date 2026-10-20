"""``photos``: the command line. README.md beside this package says how to run it."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import DEFAULT_WORK, ConfigError, load_config
from .files import SKIP_LABELS
from .inputs import InputError, load_photographers
from .manifest import Manifest, ManifestError, State
from .matching import DEFAULT_THRESHOLD
from .overview import build_overview, human_bytes
from .reader import FakeReader

REFUSALS = (ConfigError, InputError, ManifestError)


def counted(counter, labels=SKIP_LABELS) -> str:
    return ", ".join(f"{count} {labels.get(kind, kind)}" for kind, count in counter.most_common())


def tag(args, say) -> int:
    from .tag import run_tag

    config = load_config(args.work)
    try:
        reader = FakeReader.from_file(config.fake_reads, config.originals)
    except (OSError, ValueError) as error:
        raise ConfigError(f"The fake reads file could not be used: {error}") from None

    say(f"Tagging the photos in {config.originals}")
    run = run_tag(config, reader, args.confidence_threshold, say)

    say("")
    say(f"Tagged {run.tagged} new photos. {run.already} were already in the manifest.")
    if run.skipped:
        say(f"Skipped {sum(run.skipped.values())} files this run: {counted(run.skipped)}.")
    for folder in run.missing_folders:
        say(f"Listed in photographers.csv but not in the originals folder yet: {folder}")
    for folder, count in sorted(run.uncovered.items()):
        say(f"Not tagged, because no row of photographers.csv covers it: {folder} ({count} files)")

    manifest = Manifest.open(config.manifest_path, config.event_slug)
    try:
        overview = build_overview(config, manifest, load_photographers(config.photographers_csv))
    finally:
        manifest.close()
    say_overview(overview, say)
    return 0


def review(args, say) -> int:
    from .review.server import serve

    config = load_config(args.work)
    load_photographers(config.photographers_csv)  # refuse a broken file now, not on first page load
    try:
        serve(config, args.port, say)
    except RuntimeError as error:
        raise ConfigError(str(error)) from None
    return 0


def say_overview(overview, say) -> None:
    states = overview.states
    say("")
    say(
        f"All {overview.photos} photos: {states[State.TAGGED]} tagged, {states[State.CHECKED]} checked, "
        f"{states[State.PART_READ]} part read, {states[State.NEEDS_CHECK]} to check, "
        f"{states[State.NO_BIB_SEEN]} with no bib seen, {states[State.HIDDEN]} hidden."
    )
    for row in overview.folders:
        notes = []
        if row.states[State.NO_BIB_SEEN]:
            notes.append(f"{row.states[State.NO_BIB_SEEN]} no bib seen")
        if row.skipped:
            notes.append(f"skipped {counted(row.skipped)}")
        detail = f" ({'; '.join(notes)})" if notes else ""
        say(f"  {row.folder}: {row.photos} photos{detail}")
    if overview.photos:
        sizes = ", ".join(f"{name} {human_bytes(size)}" for name, size in overview.average_bytes.items())
        say(f"Average copy sizes: {sizes}. The targets are about 1 MB, 300 KB and 50 KB.")
    say(f"Cameras: {overview.cameras}, {overview.cameras_decided} with their clock decided.")
    say(f"Next: {overview.next_step}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="photos",
        description="Tag Nightingale Nightmare race photos on this laptop (ADR-059).",
    )
    parser.add_argument(
        "--work", type=Path, default=DEFAULT_WORK,
        help="the work folder, outside any git repository (default: ~/nn-photos)",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    tag_command = commands.add_parser("tag", help="copy, read and check every new photo")
    tag_command.add_argument(
        "--confidence-threshold", type=float, default=DEFAULT_THRESHOLD,
        help=f"reads below this go to a person (default {DEFAULT_THRESHOLD}, provisional)",
    )
    tag_command.set_defaults(handler=tag)

    # No --host, deliberately: the page binds to 127.0.0.1 and only there (review/server.py).
    review_command = commands.add_parser("review", help="the local page for camera clocks and checking")
    review_command.add_argument("--port", type=int, default=8765, help="default 8765")
    review_command.set_defaults(handler=review)
    return parser


def main(argv: list[str] | None = None, say=print) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.handler(args, say)
    except REFUSALS as refusal:
        print(f"Stopped: {refusal}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped. Everything saved so far is kept; run the same command again to carry on.", file=sys.stderr)
        return 130
