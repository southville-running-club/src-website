"""The tool's configuration, and the rule that keeps its work out of any repository.

Everything the tool reads or writes lives in one **work folder** outside this repository,
``~/nn-photos/`` unless told otherwise: the config, the bib list, the photographers' folders
of originals, the manifest and the copies. The tool refuses to run when the work folder or
the originals folder is inside *any* git repository, not only this one, because a photo or
a token that reaches a repository is one commit from being published (ADR-059). The
``.gitignore`` patterns for ``tools/photos/`` are a second line, not this one.

Slice 1's config holds no secrets. From slice 2 it will hold an R2 token and a vision model
key; nothing in this module prints a value it was given.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

DEFAULT_WORK = Path("~/nn-photos")
CONFIG_NAME = "config.toml"

EVENT_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
SHORT_ID_PREFIX = re.compile(r"[A-Z0-9]{2,8}")

TOP_LEVEL_KEYS = {"event_slug", "short_id_prefix", "originals", "photographers", "bibs", "reader"}
READER_KEYS = {"kind", "fake_reads"}


class ConfigError(ValueError):
    """A refusal, worded for the person running the tool."""


@dataclass(frozen=True)
class Config:
    work: Path
    event_slug: str
    short_id_prefix: str
    originals: Path
    photographers_csv: Path
    bibs_csv: Path
    reader_kind: str
    fake_reads: Path | None

    @property
    def manifest_path(self) -> Path:
        return self.work / "manifest.sqlite"

    @property
    def copies_dir(self) -> Path:
        return self.work / "copies"

    @property
    def dry_run_dir(self) -> Path:
        return self.work / "dry-run"


def enclosing_git_repository(path: Path) -> Path | None:
    """The repository ``path`` is inside, if any. ``.git`` may be a folder or, in a
    worktree or submodule, a file, so either counts."""
    resolved = path.expanduser().resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def refuse_inside_repository(path: Path, what: str) -> None:
    repository = enclosing_git_repository(path)
    if repository is not None:
        raise ConfigError(
            f"The {what} {path} is inside the git repository at {repository}. Photos, bib "
            "lists and keys must never be one commit from being published, so the tool will "
            "not run there. Use a folder outside any repository, such as ~/nn-photos."
        )


def _path(work: Path, value: object, key: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{CONFIG_NAME}: {key} must be a path, in quotes.")
    path = Path(value).expanduser()
    return (path if path.is_absolute() else work / path).resolve()


def load_config(work: Path = DEFAULT_WORK) -> Config:
    work = work.expanduser().resolve()
    refuse_inside_repository(work, "work folder")

    config_path = work / CONFIG_NAME
    try:
        with config_path.open("rb") as handle:
            raw = tomllib.load(handle)
    except FileNotFoundError:
        raise ConfigError(
            f"There is no {CONFIG_NAME} in {work}. Copy tools/photos/config.example.toml "
            "there and fill it in."
        ) from None
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{config_path} is not valid TOML: {error}") from None

    unknown = set(raw) - TOP_LEVEL_KEYS
    if unknown:
        raise ConfigError(f"{CONFIG_NAME} has settings this tool does not know: {', '.join(sorted(unknown))}.")

    event_slug = raw.get("event_slug")
    if not isinstance(event_slug, str) or not EVENT_SLUG.fullmatch(event_slug):
        raise ConfigError(f"{CONFIG_NAME}: event_slug must look like nn-2026.")
    prefix = raw.get("short_id_prefix")
    if not isinstance(prefix, str) or not SHORT_ID_PREFIX.fullmatch(prefix):
        raise ConfigError(f"{CONFIG_NAME}: short_id_prefix must be capitals and digits, like NN26.")

    reader = raw.get("reader")
    if not isinstance(reader, dict):
        raise ConfigError(f"{CONFIG_NAME} needs a [reader] section.")
    unknown = set(reader) - READER_KEYS
    if unknown:
        raise ConfigError(f"{CONFIG_NAME} [reader] has settings this tool does not know: {', '.join(sorted(unknown))}.")
    if reader.get("kind") != "fake":
        raise ConfigError(
            f"{CONFIG_NAME}: [reader] kind must be \"fake\". The real vision reader is not "
            "built yet; it waits on the choice of provider."
        )
    fake_reads = _path(work, reader["fake_reads"], "fake_reads") if "fake_reads" in reader else None

    originals = _path(work, raw.get("originals", "originals"), "originals")
    refuse_inside_repository(originals, "originals folder")

    return Config(
        work=work,
        event_slug=event_slug,
        short_id_prefix=prefix,
        originals=originals,
        photographers_csv=_path(work, raw.get("photographers", "photographers.csv"), "photographers"),
        bibs_csv=_path(work, raw.get("bibs", "bibs.csv"), "bibs"),
        reader_kind="fake",
        fake_reads=fake_reads,
    )
