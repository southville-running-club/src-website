"""The review page's server: the standard library's, on 127.0.0.1 and nothing else.

**The address is a constant, not an option.** The page shows photos of runners and changes
the manifest, so it must never be reachable from the network the laptop happens to be on;
there is deliberately no flag to change it.

Two more guards, because a page on 127.0.0.1 is still reachable from any other website open
in the same browser:

- **The Host header must be this server's own address.** A site that points a hostname of
  its own at 127.0.0.1 (DNS rebinding) sends its own name, and is refused.
- **Every POST carries this run's token**, printed nowhere and embedded in the forms. A form
  on another site cannot know it, so it cannot change anything here. A POST from another
  origin is refused as well, when the browser says where it came from.

Plain forms, POST then redirect then GET. Nothing here needs JavaScript.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from urllib.parse import parse_qs, urlencode, urlsplit

from .. import clocks
from ..config import Config
from ..copies import SIZE_NAMES
from ..inputs import load_bibs, load_photographers
from ..london_time import to_utc_iso, utc_now
from ..manifest import Manifest, State
from ..matching import Outcome
from ..overview import build_overview
from . import pages

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_FORM = 16 * 1024

PHOTO_ID = re.compile(r"[0-9a-f-]{36}")
SHORT_ID = re.compile(r"[A-Z0-9]{2,8}-\d{4,}")
CAMERA_KEY = re.compile(r"[0-9a-f]{16}")
BIB = re.compile(r"[0-9]{1,8}")
STATIC = {"review.css": "text/css; charset=utf-8", "review.js": "text/javascript; charset=utf-8"}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; "
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    # same-origin, not no-referrer: under no-referrer Chromium sends "Origin: null" with this
    # page's own form posts, and the origin check below then refuses every one of them. Found
    # by submitting the clock form in a browser; nothing in a unit test sends a real Origin.
    # The page links nowhere else, so same-origin discloses nothing either.
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
}

FILTER_STATES = {key: state for key, _, state in pages.FILTERS}


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config: Config, port: int):
        super().__init__((HOST, port), Handler)
        self.config = config
        self.token = secrets.token_urlsafe(32)
        self.say = print

    @property
    def origin(self) -> str:
        return f"http://{HOST}:{self.server_address[1]}"


def make_server(config: Config, port: int = DEFAULT_PORT) -> ReviewServer:
    """The server, bound and not yet serving. Port 0 picks a free one."""
    return ReviewServer(config, port)


class Refused(Exception):
    pass


def now() -> str:
    return to_utc_iso(utc_now())


class Handler(BaseHTTPRequestHandler):
    server: ReviewServer
    server_version = "racephotos"
    sys_version = ""

    # Requests

    def log_message(self, format, *args):  # noqa: A002 — the base class's name
        # Method and path only: a query string can hold a folder name, and nothing here
        # needs a log of who looked at what.
        path = urlsplit(self.path).path if hasattr(self, "path") else ""
        self.server.say(f"{getattr(self, 'command', '')} {path} {args[1] if len(args) > 1 else ''}".strip())

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method: str) -> None:
        expected = f"{HOST}:{self.server.server_address[1]}"
        if self.headers.get("Host") != expected:
            self.plain(HTTPStatus.FORBIDDEN, "This page only answers at " + self.server.origin)
            return
        split = urlsplit(self.path)
        query = {key: values[-1] for key, values in parse_qs(split.query).items()}
        try:
            form = self.read_form() if method == "POST" else {}
            self.route(method, split.path, query, form)
        except Refused as refusal:
            self.plain(HTTPStatus.FORBIDDEN, str(refusal))

    def read_form(self) -> dict[str, str]:
        origin = self.headers.get("Origin")
        if origin is not None and origin != self.server.origin:
            raise Refused("A form from another website cannot change anything here.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise Refused("The form could not be read.") from None
        if length > MAX_FORM:
            raise Refused("The form was too large.")
        body = self.rfile.read(length).decode("utf-8", "replace")
        form = {key: values[-1] for key, values in parse_qs(body, keep_blank_values=True).items()}
        if not secrets.compare_digest(form.get("token", ""), self.server.token):
            raise Refused("This form is out of date or did not come from this page. Reload the page and try again.")
        return form

    def route(self, method, path, query, form) -> None:
        parts = [part for part in path.split("/") if part]
        if method == "GET" and path == "/":
            return self.start()
        if parts[:1] == ["static"] and len(parts) == 2 and method == "GET":
            return self.static(parts[1])
        if parts[:1] == ["img"] and len(parts) == 3 and method == "GET":
            return self.image(parts[1], parts[2])
        if parts == ["clocks"] and method == "GET":
            return self.clocks()
        if parts[:1] == ["clocks"] and len(parts) == 2 and CAMERA_KEY.fullmatch(parts[1]):
            return self.camera(parts[1], query) if method == "GET" else self.decide_camera(parts[1], form)
        if parts == ["check"] and method == "GET":
            return self.next_photo(query)
        if parts[:1] == ["check"] and len(parts) == 2 and SHORT_ID.fullmatch(parts[1]):
            return self.check(parts[1], query) if method == "GET" else self.decide_photo(parts[1], form)
        self.plain(HTTPStatus.NOT_FOUND, "Not found.")

    # Responses

    def send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def html(self, body: str, status: int = HTTPStatus.OK) -> None:
        self.send(status, "text/html; charset=utf-8", body.encode("utf-8"))

    def plain(self, status: int, text: str) -> None:
        self.send(status, "text/plain; charset=utf-8", (text + "\n").encode("utf-8"))

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        self.end_headers()

    def manifest(self) -> Manifest:
        config = self.server.config
        return Manifest.open(config.manifest_path, config.event_slug)

    @property
    def slug(self) -> str:
        return self.server.config.event_slug

    # Files

    def static(self, name: str) -> None:
        if name not in STATIC:
            return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
        body = resources.files(__package__).joinpath("static", name).read_bytes()
        self.send(HTTPStatus.OK, STATIC[name], body)

    def image(self, photo_id: str, filename: str) -> None:
        size = filename.removesuffix(".jpg")
        if not PHOTO_ID.fullmatch(photo_id) or size not in SIZE_NAMES or not filename.endswith(".jpg"):
            return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
        manifest = self.manifest()
        try:
            known = manifest.photo(photo_id=photo_id) is not None
        finally:
            manifest.close()
        path = self.server.config.copies_dir / photo_id / f"{size}.jpg"
        if not known or not path.is_file():
            return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
        self.send(HTTPStatus.OK, "image/jpeg", path.read_bytes())

    # Start

    def start(self) -> None:
        config = self.server.config
        manifest = self.manifest()
        try:
            overview = build_overview(config, manifest, load_photographers(config.photographers_csv))
        finally:
            manifest.close()
        self.html(pages.start_page(overview, self.slug))

    # Camera clocks

    def clocks(self) -> None:
        manifest = self.manifest()
        try:
            cameras = clocks.summaries(manifest)
        finally:
            manifest.close()
        self.html(pages.clocks_page(cameras, self.slug))

    def camera_view(self, manifest: Manifest, camera_key: str, position: int) -> pages.CameraView | None:
        camera = next((c for c in clocks.summaries(manifest) if c.camera_key == camera_key), None)
        if camera is None:
            return None
        reference = None
        if camera.timed:
            if position < 0 or position >= len(camera.timed):
                position = 0
            reference = manifest.photo(fingerprint=camera.timed[position])
        first = manifest.photo(fingerprint=camera.timed[0]) if camera.timed else None
        return pages.CameraView(camera, reference, position, first["taken_at"] if first else None)

    def camera(self, camera_key: str, query: dict) -> None:
        try:
            position = int(query.get("photo", "0"))
        except ValueError:
            position = 0
        manifest = self.manifest()
        try:
            view = self.camera_view(manifest, camera_key, position)
        finally:
            manifest.close()
        if view is None:
            return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
        self.html(pages.camera_page(view, self.server.token, self.slug))

    def decide_camera(self, camera_key: str, form: dict) -> None:
        manifest = self.manifest()
        try:
            if manifest.camera(camera_key) is None:
                return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
            action = form.get("action")
            if action == "keep":
                clocks.keep_as_recorded(manifest, camera_key, now())
                return self.redirect("/clocks/")
            if action == "phone":
                errors, phone = parse_phone(form.get("phone_date", ""), form.get("phone_time", ""))
                reference = manifest.photo(short_id=form.get("reference", ""))
                if reference is None or reference["camera_key"] != camera_key:
                    errors.append("Choose a photo from this camera to compare with.")
                if not errors:
                    try:
                        clocks.decide_by_phone(manifest, camera_key, reference["fingerprint"], phone, now())
                    except clocks.ClockError as error:
                        errors.append(f"That could not be used: {error}.")
                if not errors:
                    return self.redirect("/clocks/")
                position = 0
                camera = next(c for c in clocks.summaries(manifest) if c.camera_key == camera_key)
                if reference is not None and reference["fingerprint"] in camera.timed:
                    position = camera.timed.index(reference["fingerprint"])
                view = self.camera_view(manifest, camera_key, position)
                typed = {"phone_date": form.get("phone_date", ""), "phone_time": form.get("phone_time", "")}
                return self.html(
                    pages.camera_page(view, self.server.token, self.slug, errors, typed),
                    HTTPStatus.BAD_REQUEST,
                )
            return self.plain(HTTPStatus.BAD_REQUEST, "Unknown action.")
        finally:
            manifest.close()

    # Check tags

    def queue(self, manifest: Manifest, filter_key: str, folder: str | None) -> tuple[list, dict[str, int]]:
        states = manifest.states()
        photos = [p for p in manifest.photos() if folder is None or p["folder"] == folder]
        counts = {}
        for key, _, state in pages.FILTERS:
            counts[key] = sum(
                1 for p in photos
                if (states[p["fingerprint"]] == state if state else states[p["fingerprint"]] != State.HIDDEN)
            )
        wanted = FILTER_STATES.get(filter_key)
        queue = [
            p for p in photos
            if (states[p["fingerprint"]] == wanted if wanted else states[p["fingerprint"]] != State.HIDDEN)
        ]
        return queue, counts

    @staticmethod
    def filter_of(values: dict) -> tuple[str, str | None]:
        filter_key = values.get("filter", "needs")
        if filter_key not in FILTER_STATES:
            filter_key = "needs"
        return filter_key, values.get("folder") or None

    def next_photo(self, query: dict) -> None:
        filter_key, folder = self.filter_of(query)
        after = query.get("after")
        manifest = self.manifest()
        try:
            queue, counts = self.queue(manifest, filter_key, folder)
            after_row = manifest.photo(short_id=after) if after else None
        finally:
            manifest.close()
        if not queue:
            return self.html(pages.nothing_to_check_page(counts, filter_key, folder, self.slug))
        chosen = queue[0]
        if after_row is not None:
            later = [p for p in queue if p["sequence"] > after_row["sequence"]]
            others = [p for p in queue if p["short_id"] != after_row["short_id"]]
            chosen = (later or others or queue)[0]
        self.redirect(check_url(chosen["short_id"], filter_key, folder))

    def check_view(self, manifest: Manifest, short_id: str, filter_key: str, folder: str | None,
                   offer: str | None = None) -> pages.CheckView | None:
        photo = manifest.photo(short_id=short_id)
        if photo is None:
            return None
        config = self.server.config
        bibs = load_bibs(config.bibs_csv).bibs
        photographer = next(
            (p for p in load_photographers(config.photographers_csv) if p.folder == photo["folder"]), None
        )
        reads = manifest.reads(photo["fingerprint"])
        current = current_read(reads)
        guess = None
        choices: tuple[str, ...] = ()
        if current is not None:
            fits = tuple(json.loads(current["fits"]))
            if current["outcome"] != Outcome.PART_READ and current["text"] in bibs:
                guess = current["text"]
            choices = tuple(bib for bib in fits if bib != guess)
        _, counts = self.queue(manifest, filter_key, folder)
        offered = None
        if offer and BIB.fullmatch(offer):
            others = burst_others(manifest, photo, offer)
            if others:
                offered = (offer, len(others))
        return pages.CheckView(
            photo=photo,
            reads=reads,
            state=manifest.state(photo["fingerprint"]),
            credit=photographer.credit if photographer else "",
            spot=photographer.spot if photographer else "",
            current_read=current,
            guess=guess,
            choices=choices,
            filter=filter_key,
            folder=folder,
            counts=counts,
            offer=offered,
        )

    def check(self, short_id: str, query: dict, errors: list[str] | None = None) -> None:
        filter_key, folder = self.filter_of(query)
        manifest = self.manifest()
        try:
            view = self.check_view(manifest, short_id, filter_key, folder, query.get("offer"))
        finally:
            manifest.close()
        if view is None:
            return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
        status = HTTPStatus.BAD_REQUEST if errors else HTTPStatus.OK
        self.html(pages.check_page(view, self.server.token, self.slug, errors), status)

    def decide_photo(self, short_id: str, form: dict) -> None:
        filter_key, folder = self.filter_of(form)
        manifest = self.manifest()
        try:
            photo = manifest.photo(short_id=short_id)
            if photo is None:
                return self.plain(HTTPStatus.NOT_FOUND, "Not found.")
            bibs = load_bibs(self.server.config.bibs_csv).bibs
            reads = manifest.reads(photo["fingerprint"])
            current = current_read(reads)
            action = form.get("action")
            pick = form.get("pick")
            confirmed: str | None = None
            when = now()

            if pick is not None:
                action, typed = "pick", pick
            else:
                typed = form.get("bib", "").strip()

            if action in ("confirm", "pick", "correct"):
                bib = current["text"] if action == "confirm" and current is not None else typed
                if action == "confirm" and (current is None or current["outcome"] == Outcome.PART_READ):
                    return self.error(short_id, filter_key, folder, "There is no whole bib to confirm. Pick one or type it.")
                if not BIB.fullmatch(bib or "") or bib not in bibs:
                    return self.error(short_id, filter_key, folder, f"{bib or 'That'} is not on the bib list.")
                decision = {"confirm": "confirmed", "pick": "confirmed", "correct": "corrected"}[action]
                if current is not None:
                    manifest.decide_read(current["id"], decision, bib, when)
                else:
                    manifest.add_person_read(photo["fingerprint"], bib, decision, when)
                confirmed = bib
            elif action == "keep_part":
                if current is None or current["outcome"] != Outcome.PART_READ:
                    return self.error(short_id, filter_key, folder, "This photo has no part read to keep.")
                manifest.decide_read(current["id"], "kept_part_read", None, when)
            elif action == "no_bib":
                manifest.no_bib_visible(photo["fingerprint"], when)
            elif action == "hide":
                if not photo["hidden_at"]:
                    manifest.hide(photo["fingerprint"], when)
            elif action == "show":
                manifest.show(photo["fingerprint"])
            elif action == "apply_burst":
                bib = form.get("bib", "")
                if not BIB.fullmatch(bib) or bib not in bibs:
                    return self.error(short_id, filter_key, folder, f"{bib or 'That'} is not on the bib list.")
                for other in burst_others(manifest, photo, bib):
                    apply_bib(manifest, other, bib, when)
            elif action != "skip":
                return self.plain(HTTPStatus.BAD_REQUEST, "Unknown action.")

            still_open = current_read(manifest.reads(photo["fingerprint"])) is not None
            offer = confirmed if confirmed and burst_others(manifest, photo, confirmed) else None
        finally:
            manifest.close()

        if action in ("confirm", "pick", "correct", "keep_part") and (still_open or offer):
            return self.redirect(check_url(short_id, filter_key, folder, offer=offer))
        self.redirect(f"/check/?{urlencode({'filter': filter_key, **({'folder': folder} if folder else {}), 'after': short_id})}")

    def error(self, short_id: str, filter_key: str, folder: str | None, message: str) -> None:
        self.check(short_id, {"filter": filter_key, **({"folder": folder} if folder else {})}, [message])


def check_url(short_id: str, filter_key: str, folder: str | None, offer: str | None = None) -> str:
    query = {"filter": filter_key, **({"folder": folder} if folder else {}), **({"offer": offer} if offer else {})}
    return f"/check/{short_id}/?{urlencode(query)}"


def current_read(reads: list):
    """The first read a person still has to decide: one to check, or a part read."""
    return next(
        (r for r in reads if r["decision"] is None and r["outcome"] in (Outcome.REVIEW, Outcome.PART_READ)),
        None,
    )


def burst_others(manifest: Manifest, photo, bib: str) -> list:
    """The other visible photos in this photo's burst that do not have ``bib`` yet."""
    if not photo["burst_id"]:
        return []
    others = []
    for other in manifest.photos():
        if other["burst_id"] != photo["burst_id"] or other["fingerprint"] == photo["fingerprint"] or other["hidden_at"]:
            continue
        if any(read["bib"] == bib for read in manifest.reads(other["fingerprint"])):
            continue
        others.append(other)
    return others


def apply_bib(manifest: Manifest, photo, bib: str, when: str) -> None:
    """Give a burst-mate the bib: settle a read of its own that could be that bib, or add one."""
    for read in manifest.reads(photo["fingerprint"]):
        if read["decision"] is None and bib in json.loads(read["fits"]):
            manifest.decide_read(read["id"], "burst", bib, when)
            return
    manifest.add_person_read(photo["fingerprint"], bib, "burst", when)


def parse_phone(date_text: str, time_text: str) -> tuple[list[str], datetime | None]:
    errors = []
    try:
        day = datetime.strptime(date_text.strip(), "%Y-%m-%d")
    except ValueError:
        errors.append("Enter the date the phone shows, as a date.")
        day = None
    clock = None
    for pattern in ("%H:%M:%S", "%H:%M"):
        try:
            clock = datetime.strptime(time_text.strip(), pattern)
            break
        except ValueError:
            continue
    if clock is None:
        errors.append("Enter the time the phone shows, as hours, minutes and seconds.")
    if errors:
        return errors, None
    return [], day.replace(hour=clock.hour, minute=clock.minute, second=clock.second)


def serve(config: Config, port: int = DEFAULT_PORT, say=print) -> None:
    try:
        server = make_server(config, port)
    except OSError as error:
        raise RuntimeError(f"Port {port} on {HOST} could not be used ({error.strerror}). Try --port with another number.") from None
    say(f"Open {server.origin}/ in a browser on this laptop. Press Ctrl-C to stop.")
    try:
        server.serve_forever()
    finally:
        server.server_close()
