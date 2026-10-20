"""The review page's HTML, built as strings with every value escaped.

Plain HTML forms that work with scripting off; review.js only adds keyboard shortcuts on
top. Every shortcut has a visible, labelled button, so a key is never the only way to do
anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from urllib.parse import urlencode

from ..clocks import AS_RECORDED, PHONE, CameraSummary, describe_offset
from ..files import SKIP_LABELS
from ..london_time import format_london, format_wall, from_utc_iso
from ..manifest import State, wall_value
from ..matching import Outcome
from ..overview import Overview, human_bytes
from ..words import plural, verb

STATE_LABELS = {
    State.TAGGED: "Tagged",
    State.CHECKED: "Checked",
    State.PART_READ: "Part read",
    State.NEEDS_CHECK: "To check",
    State.NO_BIB_SEEN: "No bib seen",
    State.HIDDEN: "Hidden",
}
REASONS = {
    "low_confidence": "not sure enough",
    "not_a_bib": "not on the bib list",
    "fits_nothing": "fits no bib on the list",
    "unreadable": "no digits read",
}
FILTERS = (
    ("needs", "To check", State.NEEDS_CHECK),
    ("part", "Part read", State.PART_READ),
    ("nobib", "No bib seen", State.NO_BIB_SEEN),
    ("hidden", "Hidden", State.HIDDEN),
    ("all", "All", None),
)


def e(value: object) -> str:
    return escape("" if value is None else str(value), quote=True)


def layout(title: str, body: str, *, event_slug: str, current: str) -> str:
    links = (("/", "Start"), ("/clocks/", "Camera clocks"), ("/check/", "Check tags"))
    here = ' aria-current="page"'
    nav = "".join(
        f'<li><a href="{href}"{here if href == current else ""}>{label}</a></li>'
        for href, label in links
    )
    return f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Race photos</title>
<link rel="stylesheet" href="/static/review.css">
<script src="/static/review.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="masthead">
<p class="eyebrow">Race photos · {e(event_slug)} · this laptop only</p>
<nav aria-label="Review"><ul>{nav}</ul></nav>
</header>
<main id="main">
{body}
</main>
</body>
</html>
"""


def error_summary(errors: list[str]) -> str:
    if not errors:
        return ""
    items = "".join(f"<li>{e(error)}</li>" for error in errors)
    return f'<div class="problem" role="alert"><h2>That was not saved</h2><ul>{items}</ul></div>'


def skipped_words(counter) -> str:
    return ", ".join(f"{count} {SKIP_LABELS.get(kind, kind)}" for kind, count in counter.most_common())


# Start


def start_page(overview: Overview, event_slug: str) -> str:
    states = overview.states
    # (label, value, the check-screen filter it opens when there is anything in it)
    steps = [
        ("Photos tagged", overview.photos, None),
        ("Files skipped", sum(overview.skipped.values()), None),
        ("Cameras with their clock decided", f"{overview.cameras_decided} of {overview.cameras}", None),
        ("To check", states[State.NEEDS_CHECK], "needs"),
        ("Part read", states[State.PART_READ], "part"),
        ("No bib seen", states[State.NO_BIB_SEEN], "nobib"),
        ("Hidden", states[State.HIDDEN], "hidden"),
        ("Copied by the last dry-run upload", overview.dry_run_uploaded, None),
    ]
    counts = "".join(
        f'<div><dt>{e(label)}</dt><dd><a href="/check/?filter={key}">{e(value)}</a></dd></div>'
        if key and value
        else f"<div><dt>{e(label)}</dt><dd>{e(value)}</dd></div>"
        for label, value, key in steps
    )

    warnings = []
    if overview.skipped.get("heic"):
        warnings.append(
            f"{plural(overview.skipped['heic'], 'HEIC file')} {verb(overview.skipped['heic'], 'was', 'were')} skipped. HEIC files usually come from an "
            "iPhone; ask the photographer to send JPEGs (Settings, Camera, Formats, Most "
            "Compatible), or export them as JPEG, and run ./photos tag again."
        )
    for row in overview.folders:
        if row.listed and not row.present:
            warnings.append(f"{row.folder} is in photographers.csv but not in the originals folder yet.")
        if not row.listed:
            warnings.append(f"{row.folder} has photos in the manifest but is no longer in photographers.csv.")
    for folder, count in sorted(overview.uncovered.items()):
        warnings.append(f"{folder} holds {plural(count, 'file')} that no row of photographers.csv covers, so not tagged.")
    if overview.cameras_flagged:
        warnings.append(
            f"{plural(overview.cameras_flagged, 'camera')} {verb(overview.cameras_flagged, 'has', 'have')} photos whose corrected time is in the hour the "
            "clocks repeated or skipped. Those photos have no time. See Camera clocks."
        )
    warning_html = (
        '<section class="notice" aria-labelledby="attention"><h2 id="attention">Needs attention</h2><ul>'
        + "".join(f"<li>{e(warning)}</li>" for warning in warnings)
        + "</ul></section>"
        if warnings
        else ""
    )

    rows = []
    for row in overview.folders:
        no_bib = row.states[State.NO_BIB_SEEN]
        no_bib_cell = (
            f'<a href="/check/?{e(urlencode({"filter": "nobib", "folder": row.folder}))}">{no_bib}</a>' if no_bib else "0"
        )
        to_check = row.states[State.NEEDS_CHECK]
        to_check_cell = (
            f'<a href="/check/?{e(urlencode({"filter": "needs", "folder": row.folder}))}">{to_check}</a>' if to_check else "0"
        )
        rows.append(
            f"<tr><th scope=\"row\">{e(row.folder)}</th><td>{e(row.credit)}</td><td>{e(row.spot)}</td>"
            f"<td>{row.photos}</td><td>{no_bib_cell}</td><td>{to_check_cell}</td>"
            f"<td>{e(skipped_words(row.skipped)) or 'None'}</td></tr>"
        )

    sizes = ", ".join(f"{name} {human_bytes(size)}" for name, size in overview.average_bytes.items())
    sizes_html = (
        f"<p>Average copy sizes: {e(sizes)}. The targets are about 1 MB, 300 KB and 50 KB.</p>"
        if overview.photos else ""
    )

    body = f"""<h1>Start</h1>
<p class="next"><strong>Next:</strong> {e(overview.next_step)}</p>
{warning_html}
<h2>Where things stand</h2>
<dl class="counts">{counts}</dl>
{sizes_html}
<h2>Photographers</h2>
<div class="scroll">
<table>
<thead><tr><th scope="col">Folder</th><th scope="col">Credit</th><th scope="col">Spot</th>
<th scope="col">Photos</th><th scope="col">No bib seen</th><th scope="col">To check</th>
<th scope="col">Skipped files</th></tr></thead>
<tbody>{"".join(rows)}</tbody>
</table>
</div>"""
    return layout("Start", body, event_slug=event_slug, current="/")


# Camera clocks


def decision_words(camera: CameraSummary) -> str:
    if camera.decision == PHONE:
        return f"Phone time: {describe_offset(camera.offset)}"
    if camera.decision == AS_RECORDED:
        return "Kept as recorded"
    return "Not decided yet"


def clocks_page(cameras: list[CameraSummary], event_slug: str) -> str:
    rows = []
    for camera in cameras:
        span = (
            f"{format_wall(camera.first)} to {format_wall(camera.last)}" if camera.first else "No recorded times"
        )
        flags = []
        if camera.flagged:
            flags.append(f"{camera.flagged} in the hour the clocks repeated or skipped, so with no time")
        if camera.timeless:
            flags.append(f"{camera.timeless} with no recorded time")
        action = "Change" if camera.decided else "Fix this clock"
        row_class = "" if camera.decided else ' class="undecided"'
        rows.append(
            f"<tr{row_class}>"
            f'<th scope="row">{e(camera.label)}</th><td>{e(", ".join(camera.folders))}</td>'
            f"<td>{camera.photos}</td><td>{e(span)}</td><td>{e(decision_words(camera))}</td>"
            f'<td>{e("; ".join(flags)) or "None"}</td>'
            f'<td><a href="/clocks/{e(camera.camera_key)}/">{action}<span class="visually-hidden"> for {e(camera.label)}</span></a></td></tr>'
        )
    left = sum(1 for camera in cameras if not camera.decided)
    status = (
        f"<p class=\"next\"><strong>{left} of {plural(len(cameras), 'camera')}</strong> still {verb(left, 'needs', 'need')} a phone time or a "
        "decision to keep their time as recorded. Upload waits until none do.</p>"
        if left else "<p class=\"next\">Every camera's clock is decided.</p>"
    )
    body = f"""<h1>Camera clocks</h1>
<p>Photographers are asked to photograph a phone clock first. For each camera, read the
phone's time off that photo and type it in; every photo from that camera moves by the
difference. A camera with no phone photo can keep its time as recorded instead.</p>
{status}
<div class="scroll">
<table>
<thead><tr><th scope="col">Camera</th><th scope="col">Folders</th><th scope="col">Photos</th>
<th scope="col">Recorded</th><th scope="col">Decision</th><th scope="col">Flags</th>
<th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
<tbody>{"".join(rows) or '<tr><td colspan="7">No photos tagged yet.</td></tr>'}</tbody>
</table>
</div>"""
    return layout("Camera clocks", body, event_slug=event_slug, current="/clocks/")


@dataclass(frozen=True)
class CameraView:
    camera: CameraSummary
    reference: object | None  # the photo row on screen
    position: int
    first_taken_at: str | None


def camera_page(view: CameraView, token: str, event_slug: str, errors: list[str] | None = None,
                typed: dict[str, str] | None = None) -> str:
    camera = view.camera
    typed = typed or {}
    current = ""
    if camera.decided:
        then = f" Its first photo is now {format_london(from_utc_iso(view.first_taken_at))}." if view.first_taken_at else ""
        current = f'<p class="next"><strong>Decided:</strong> {e(decision_words(camera))}.{e(then)}</p>'

    if view.reference is None:
        picture = "<p>No photo from this camera has a recorded time, so there is nothing to compare a phone with.</p>"
        phone_form = ""
    else:
        photo = view.reference
        recorded = wall_value(photo["recorded"])
        total = len(camera.timed)
        steps = []
        if view.position > 0:
            steps.append(f'<a href="?photo={view.position - 1}">Earlier photo</a>')
        if view.position < total - 1:
            steps.append(f'<a href="?photo={view.position + 1}">Later photo</a>')
        picture = f"""<figure class="photo">
<img src="/img/{e(photo["photo_id"])}/medium.jpg" alt="Photo {e(photo["short_id"])} from this camera">
<figcaption>Photo {e(photo["short_id"])}, {view.position + 1} of {total} with a time. The camera
recorded <strong>{e(format_wall(recorded))}</strong>.</figcaption>
</figure>
<p class="steps">{" · ".join(steps)}</p>"""
        date_value = typed.get("phone_date", f"{recorded:%Y-%m-%d}")
        time_value = typed.get("phone_time", f"{recorded:%H:%M:%S}")
        phone_form = f"""<form method="post" class="panel">
<input type="hidden" name="token" value="{e(token)}">
<input type="hidden" name="reference" value="{e(photo["short_id"])}">
<fieldset>
<legend>What time does the phone in this photo show?</legend>
<p class="hint">As London time on the day. Seconds are optional.</p>
<div class="field"><label for="phone_date">Date</label>
<input id="phone_date" name="phone_date" type="date" required value="{e(date_value)}"></div>
<div class="field"><label for="phone_time">Time</label>
<input id="phone_time" name="phone_time" type="time" step="1" required value="{e(time_value)}"></div>
</fieldset>
<button type="submit" name="action" value="phone">Use the phone's time</button>
</form>"""

    body = f"""<h1>{e(camera.label)}</h1>
<p>{plural(camera.photos, "photo")}, in {e(", ".join(camera.folders))}.</p>
{error_summary(errors or [])}
{current}
{picture}
{phone_form}
<form method="post" class="panel">
<input type="hidden" name="token" value="{e(token)}">
<h2>No phone photo from this camera?</h2>
<p>Keep its photos at the times the camera recorded. Choose this only if there is no phone
photo to read; the times may then be off by however wrong the camera's clock was.</p>
<button type="submit" name="action" value="keep" class="secondary">Keep this camera's time as recorded</button>
</form>
<p><a href="/clocks/">Back to all cameras</a></p>"""
    return layout(camera.label, body, event_slug=event_slug, current="/clocks/")


# Check tags


@dataclass(frozen=True)
class CheckView:
    photo: object
    reads: list
    state: State
    credit: str
    spot: str
    current_read: object | None
    guess: str | None
    """A whole bib on the list that Enter confirms, or None."""
    choices: tuple[str, ...]
    filter: str
    folder: str | None
    counts: dict[str, int]
    offer: tuple[str, int] | None
    """(bib, how many other photos in the burst) when a confirmed bib can be offered on."""


def filter_nav(counts: dict[str, int], current: str, folder: str | None) -> str:
    items = []
    for key, label, _ in FILTERS:
        query = {"filter": key, **({"folder": folder} if folder else {})}
        marker = ' aria-current="page"' if key == current else ""
        items.append(f'<li><a href="/check/?{e(urlencode(query))}"{marker}>{label} ({counts.get(key, 0)})</a></li>')
    scope = f" in {e(folder)}" if folder else ""
    clear = f' <a href="/check/?{e(urlencode({"filter": current}))}">Show every folder</a>' if folder else ""
    return f'<nav aria-label="Which photos{scope}"><ul class="filters">{"".join(items)}</ul>{clear}</nav>'


def nothing_to_check_page(counts, current, folder, event_slug) -> str:
    body = f"""<h1>Check tags</h1>
{filter_nav(counts, current, folder)}
<p class="next">Nothing in this list. The team's main checking happens on the website; this
screen is for working offline.</p>"""
    return layout("Check tags", body, event_slug=event_slug, current="/check/")


def read_line(read) -> str:
    if read["source"] == "person":
        what = f"Bib {e(read['bib'])}, added by a person"
    else:
        confidence = f"{round(read['confidence'] * 100)}%" if read["confidence"] is not None else ""
        outcome = {
            Outcome.TAGGED: "tagged",
            Outcome.PART_READ: "part read",
            Outcome.REVIEW: f"to check: {REASONS.get(read['reason'], read['reason'])}",
        }.get(read["outcome"], read["outcome"])
        what = f"Read <strong>{e(read['text'])}</strong> ({confidence}), {e(outcome)}"
    decided = {
        "confirmed": f"confirmed as {read['bib']}",
        "corrected": f"corrected to {read['bib']}",
        "kept_part_read": "kept part read",
        "rejected": "no bib visible",
        "burst": f"set to {read['bib']} from its burst",
    }.get(read["decision"])
    return f"<li>{what}{f'. Decided: {e(decided)}' if decided else ''}</li>"


def check_page(view: CheckView, token: str, event_slug: str, errors: list[str] | None = None) -> str:
    photo = view.photo
    keep = {"filter": view.filter, **({"folder": view.folder} if view.folder else {})}
    hidden_fields = (
        f'<input type="hidden" name="token" value="{e(token)}">'
        + "".join(f'<input type="hidden" name="{e(k)}" value="{e(v)}">' for k, v in keep.items())
    )
    taken = format_london(from_utc_iso(photo["taken_at"])) if photo["taken_at"] else "time not fixed yet"

    problem = ""
    if photo["reader_problem"]:
        raw = (
            f"<details><summary>What came back</summary><pre>{e(photo['raw_answer'])}</pre></details>"
            if photo["raw_answer"] else ""
        )
        problem = f'<p class="problem-inline">The reader\'s answer could not be used: {e(photo["reader_problem"])}.</p>{raw}'

    reads = "".join(read_line(read) for read in view.reads) or "<li>No bibs read.</li>"

    if view.state == State.HIDDEN:
        return hidden_page(view, hidden_fields, taken, event_slug)

    buttons = []
    if view.guess:
        buttons.append(f'<button type="submit" name="action" value="confirm" data-key="Enter">Confirm {e(view.guess)} <kbd>Enter</kbd></button>')
    numbered = len(view.choices) <= 9
    for number, bib in enumerate(view.choices, start=1):
        key = f' data-key="{number}"' if numbered else ""
        hint = f" <kbd>{number}</kbd>" if numbered else ""
        buttons.append(f'<button type="submit" name="pick" value="{e(bib)}" class="choice"{key}>It is {e(bib)}{hint}</button>')
    if view.current_read is not None and view.current_read["outcome"] == Outcome.PART_READ:
        buttons.append('<button type="submit" name="action" value="keep_part" class="secondary" data-key="U">Keep it part read <kbd>U</kbd></button>')
    buttons.append('<button type="submit" name="action" value="no_bib" class="secondary" data-key="N">No bib visible <kbd>N</kbd></button>')
    buttons.append('<button type="submit" name="action" value="skip" class="secondary" data-key="S">Skip <kbd>S</kbd></button>')
    buttons.append('<button type="submit" name="action" value="hide" class="danger" data-key="H">Hide this photo <kbd>H</kbd></button>')

    question = (
        f"Which bib is <strong>{e(view.current_read['text'])}</strong>?"
        if view.current_read is not None
        else "Type any bib you can see, or say there is none."
    )

    offer = ""
    if view.offer:
        bib, others = view.offer
        offer = f"""<section class="panel offer" aria-labelledby="offer-heading">
<h2 id="offer-heading">Apply {e(bib)} to the rest of this burst?</h2>
<p>{plural(others, "other photo")} from the same camera {verb(others, "was", "were")} taken within two seconds of this one or of each other.</p>
<form method="post">{hidden_fields}<input type="hidden" name="bib" value="{e(bib)}">
<button type="submit" name="action" value="apply_burst" autofocus>Apply {e(bib)} to {plural(others, "photo")}</button>
<button type="submit" name="action" value="skip" class="secondary">No, next photo</button>
</form></section>"""

    keys = (
        "Keys: Enter confirms the guess. 1 to 9 pick a bib that fits. Typing digits goes "
        "into the box below. U keeps it part read, N says no bib is visible, S skips, H hides "
        "the photo, or shows a hidden one again."
    )
    body = f"""<h1>Check tags</h1>
{filter_nav(view.counts, view.filter, view.folder)}
{error_summary(errors or [])}
<div class="check">
<figure class="photo large">
<img src="/img/{e(photo["photo_id"])}/full.jpg" alt="Photo {e(photo["short_id"])}">
</figure>
<div class="decide">
<h2>{e(photo["short_id"])}</h2>
<p class="meta">{e(view.credit)} · {e(view.spot)} · {e(taken)} · {e(STATE_LABELS[view.state])}</p>
{offer}
{problem}
<ul class="reads">{reads}</ul>
<form method="post" class="actions" aria-labelledby="question">
{hidden_fields}
<p id="question">{question}</p>
<div class="buttons">{"".join(buttons)}</div>
</form>
<form method="post" class="correct">
{hidden_fields}
<label for="bib">Type the bib</label>
<input id="bib" name="bib" inputmode="numeric" pattern="[0-9]{{1,8}}" autocomplete="off" data-correction required>
<button type="submit" name="action" value="correct">Use this bib</button>
</form>
<p class="hint">{e(keys)}</p>
</div>
</div>"""
    return layout(f"Check {photo['short_id']}", body, event_slug=event_slug, current="/check/")


HIDDEN_BECAUSE = {
    "person": "Hidden by a person on this laptop. It will not be uploaded.",
    "clock_reference": (
        "Hidden automatically, because this camera's clock was set from the phone in this "
        "photo and a phone screen is never uploaded. If this is not the phone photo, show it "
        "again, then fix the camera's clock from the right one."
    ),
}


def hidden_page(view: CheckView, hidden_fields: str, taken: str, event_slug: str) -> str:
    photo = view.photo
    body = f"""<h1>Check tags</h1>
{filter_nav(view.counts, view.filter, view.folder)}
<div class="check">
<figure class="photo large">
<img src="/img/{e(photo["photo_id"])}/full.jpg" alt="Photo {e(photo["short_id"])}">
</figure>
<div class="decide">
<h2>{e(photo["short_id"])}</h2>
<p class="meta">{e(view.credit)} · {e(view.spot)} · {e(taken)} · Hidden</p>
<p>{e(HIDDEN_BECAUSE.get(photo["hidden_reason"], HIDDEN_BECAUSE["person"]))}</p>
<form method="post" class="actions">
{hidden_fields}
<div class="buttons">
<button type="submit" name="action" value="show" data-key="H">Show this photo again <kbd>H</kbd></button>
<button type="submit" name="action" value="skip" class="secondary" data-key="S">Skip <kbd>S</kbd></button>
</div>
</form>
</div>
</div>"""
    return layout(f"Check {photo['short_id']}", body, event_slug=event_slug, current="/check/")
