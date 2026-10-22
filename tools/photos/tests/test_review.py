import http.client
import inspect
import re
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from racephotos.cli import build_parser
from racephotos.files import fingerprint
from racephotos.manifest import Manifest, State
from racephotos.review.server import HOST, make_server
from racephotos.tag import run_tag

from . import fixtures
from .fixtures import SpyReader, answer, make_jpeg


class Page(HTMLParser):
    """Just enough of a page to assert on: buttons with their text, forms, inputs."""

    def __init__(self, html):
        super().__init__()
        self.buttons, self.forms, self.inputs, self.images = [], [], [], []
        self._button = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "button":
            self._button = {**attrs, "text": ""}
        elif tag == "form":
            self.forms.append(attrs)
        elif tag == "input":
            self.inputs.append(attrs)
        elif tag == "img":
            self.images.append(attrs)

    def handle_data(self, data):
        if self._button is not None:
            self._button["text"] += data

    def handle_endtag(self, tag):
        if tag == "button" and self._button is not None:
            self._button["text"] = " ".join(self._button["text"].split())
            self.buttons.append(self._button)
            self._button = None


class ReviewCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name).resolve()
        self.config = fixtures.make_work(
            root,
            photographers="folder,credit,spot\nAdrian/Finish,<script>Adrian</script>,Finish\nRoss,Ross,On the course\n",
        )
        originals = self.config.originals
        low = make_jpeg(originals / "Adrian/Finish/a.jpg", recorded="2026:11:01 12:00:05", serial="A")
        part = make_jpeg(originals / "Adrian/Finish/b.jpg", recorded="2026:11:01 12:10:00", serial="A")
        make_jpeg(originals / "Ross/c.jpg", recorded="2026:11:01 11:20:00", serial="B")
        make_jpeg(originals / "Ross/d.jpg", recorded="2026:11:01 11:20:01", serial="B")
        make_jpeg(originals / "Ross/e.jpg", recorded="2026:11:01 11:20:02", serial="B")
        (originals / "Ross/f.HEIC").write_bytes(b"heic")
        reader = SpyReader({
            fingerprint(low): answer(("125", 0.5)),
            fingerprint(part): answer(("12?", 0.95)),
        })
        run_tag(self.config, reader, 0.9, say=lambda line: None)

        self.server = make_server(self.config, port=0)
        self.server.say = lambda line: None
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self._tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(HOST, self.port, timeout=5)
        try:
            all_headers = {"Host": f"{HOST}:{self.port}", **(headers or {})}
            if body is not None:
                body = urlencode(body)
                all_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
            connection.request(method, path, body=body, headers=all_headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def get(self, path):
        status, headers, body = self.request("GET", path)
        return status, headers, body.decode("utf-8", "replace") if headers.get("Content-Type", "").startswith("text") else body

    def post(self, path, form, token=True, headers=None):
        body = {**form, **({"token": self.server.token} if token else {})}
        return self.request("POST", path, body, headers)

    def manifest(self):
        manifest = Manifest.open(self.config.manifest_path, self.config.event_slug)
        self.addCleanup(manifest.close)
        return manifest

    def row(self, source):
        return next(p for p in self.manifest().photos() if p["source"] == source)


class ServerBoundaryTest(ReviewCase):
    def test_listens_on_127_0_0_1_and_nothing_else(self):
        self.assertEqual(self.server.socket.getsockname()[0], "127.0.0.1")
        self.assertEqual(list(inspect.signature(make_server).parameters), ["config", "port"])
        review = build_parser()._subparsers._group_actions[0].choices["review"]
        options = {option for action in review._actions for option in action.option_strings}
        self.assertEqual(options, {"-h", "--help", "--port"})

    def test_refuses_another_host_name(self):
        status, _, _ = self.request("GET", "/", headers={"Host": f"rebound.example:{self.port}"})
        self.assertEqual(status, 403)

    def test_refuses_a_post_without_this_run_s_token(self):
        camera = self.row("Ross/c.jpg")["camera_key"]
        status, _, _ = self.post(f"/clocks/{camera}/", {"action": "keep"}, token=False)
        self.assertEqual(status, 403)
        self.assertIsNone(self.manifest().camera(camera)["decision"])

    def test_refuses_a_post_from_another_origin(self):
        camera = self.row("Ross/c.jpg")["camera_key"]
        status, _, _ = self.post(f"/clocks/{camera}/", {"action": "keep"}, headers={"Origin": "https://elsewhere.example"})
        self.assertEqual(status, 403)

    def test_accepts_a_post_from_its_own_origin_and_refuses_a_null_one(self):
        # A browser sends the page's own origin with its own forms, as long as the referrer
        # policy lets it; under no-referrer it sends "null", and every real post was refused.
        camera = self.row("Ross/c.jpg")["camera_key"]
        status, _, _ = self.post(f"/clocks/{camera}/", {"action": "keep"}, headers={"Origin": "null"})
        self.assertEqual(status, 403)
        status, _, _ = self.post(f"/clocks/{camera}/", {"action": "keep"}, headers={"Origin": self.server.origin})
        self.assertEqual(status, 303)

    def test_every_response_carries_the_protective_headers(self):
        _, headers, _ = self.request("GET", "/")
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Referrer-Policy"], "same-origin")

    def test_serves_images_by_known_id_only(self):
        photo = self.row("Ross/c.jpg")
        status, headers, body = self.request("GET", f"/img/{photo['photo_id']}/thumb.jpg")
        self.assertEqual((status, headers["Content-Type"]), (200, "image/jpeg"))
        self.assertTrue(body.startswith(b"\xff\xd8"))
        for path in (
            "/img/00000000-0000-4000-8000-000000000000/thumb.jpg",
            f"/img/{photo['photo_id']}/original.jpg",
            "/img/../config.toml",
            "/img/%2e%2e/%2e%2e/config.toml",
            "/static/../../config.py",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_nothing_loads_from_the_internet_and_the_look_is_the_brand_s(self):
        photo = self.row("Adrian/Finish/b.jpg")
        for path in ("/", "/clocks/", f"/clocks/{photo['camera_key']}/", f"/check/{photo['short_id']}/?filter=all"):
            with self.subTest(page=path):
                _, _, html = self.get(path)
                for value in re.findall(r'(?:src|href|action)="([^"]*)"', html):
                    self.assertRegex(value, r"^(/|\?|#)", "every address on the page is this server's")
        _, _, css = self.get("/static/review.css")
        _, _, script = self.get("/static/review.js")
        rules = re.sub(r"/\*.*?\*/", "", css, flags=re.S)  # the comments may name what is banned
        for banned in ("url(", "@import", "@font-face", "http:", "https:", "box-shadow", "-gradient("):
            self.assertNotIn(banned, rules)
        for banned in ("http:", "https:", "fetch(", "XMLHttpRequest", "import "):
            self.assertNotIn(banned, script)
        # The brand's six (packages/shared/styles/tokens.css), and its two corner radii.
        for value in ("#2c2c2c", "#4a5568", "#ffffff", "#f4f6f2", "#00c85a", "#ffb020", "8px", "12px"):
            self.assertIn(value, css)

    def test_escapes_what_it_shows(self):
        _, _, html = self.get("/")
        self.assertNotIn("<script>Adrian", html)
        self.assertIn("&lt;script&gt;Adrian", html)


class StartTest(ReviewCase):
    def test_shows_skipped_files_and_no_bib_photos_per_photographer(self):
        _, _, html = self.get("/")
        ross = re.search(r"<tr><th scope=\"row\">Ross</th>.*?</tr>", html, re.S).group(0)
        self.assertIn("1 HEIC (iPhone)", ross)
        self.assertIn('filter=nobib&amp;folder=Ross">3</a>', ross)
        self.assertIn("1 HEIC file was skipped", html)
        self.assertIn("Fix the camera clocks", html)


class ClocksTest(ReviewCase):
    def test_typing_the_phone_s_time_fixes_that_camera(self):
        photo = self.row("Adrian/Finish/a.jpg")
        status, _, html = self.get(f"/clocks/{photo['camera_key']}/")
        self.assertEqual(status, 200)
        self.assertIn("12:00:05", html)

        status, headers, _ = self.post(
            f"/clocks/{photo['camera_key']}/",
            {"action": "phone", "reference": photo["short_id"], "phone_date": "2026-11-01", "phone_time": "11:00:05"},
        )
        self.assertEqual((status, headers["Location"]), (303, "/clocks/"))
        self.assertEqual(self.row("Adrian/Finish/a.jpg")["taken_at"], "2026-11-01T11:00:05.000Z")
        self.assertEqual(self.row("Adrian/Finish/b.jpg")["taken_at"], "2026-11-01T11:10:00.000Z")
        self.assertIsNone(self.row("Ross/c.jpg")["taken_at"])

    def test_steps_past_a_test_shot_and_hides_the_photo_that_shows_the_phone(self):
        first = self.row("Adrian/Finish/a.jpg")
        second = self.row("Adrian/Finish/b.jpg")
        url = f"/clocks/{first['camera_key']}/"

        _, _, html = self.get(url)
        self.assertIn(f"Photo {first['short_id']}, 1 of 2", html)
        self.assertIn('Not the phone? <a href="?photo=1">Later photo</a>', html)
        _, _, html = self.get(url + "?photo=1")
        self.assertIn(f"Photo {second['short_id']}, 2 of 2", html)
        self.assertIn(f'name="reference" value="{second["short_id"]}"', html)

        self.post(url, {"action": "phone", "reference": second["short_id"], "phone_date": "2026-11-01", "phone_time": "11:10:00"})
        self.assertEqual(self.row("Adrian/Finish/b.jpg")["hidden_reason"], "clock_reference")
        self.assertIsNone(self.row("Adrian/Finish/a.jpg")["hidden_at"])

        # Coming back opens on the photo that was used, and says how to undo it.
        _, _, html = self.get(url)
        self.assertIn(f"Photo {second['short_id']}, 2 of 2", html)
        self.assertIn(f"show {second['short_id']} again", html)

    def test_a_camera_can_keep_its_time_as_recorded(self):
        camera = self.row("Ross/c.jpg")["camera_key"]
        status, _, _ = self.post(f"/clocks/{camera}/", {"action": "keep"})
        self.assertEqual(status, 303)
        self.assertEqual(self.manifest().camera(camera)["decision"], "as_recorded")
        _, _, html = self.get("/clocks/")
        self.assertIn("Kept as recorded", html)

    def test_a_time_that_is_not_a_time_is_shown_back_with_the_problem(self):
        photo = self.row("Adrian/Finish/a.jpg")
        status, _, html = self.post(
            f"/clocks/{photo['camera_key']}/",
            {"action": "phone", "reference": photo["short_id"], "phone_date": "2026-11-01", "phone_time": "eleven"},
        )
        self.assertEqual(status, 400)
        self.assertIn(b"Enter the time the phone shows", html)
        self.assertIsNone(self.manifest().camera(photo["camera_key"])["decision"])


class CheckTest(ReviewCase):
    def page(self, source, query="filter=all"):
        photo = self.row(source)
        status, _, html = self.get(f"/check/{photo['short_id']}/?{query}")
        self.assertEqual(status, 200)
        return photo, Page(html), html

    def test_every_key_has_a_visible_labelled_button(self):
        _, page, html = self.page("Adrian/Finish/b.jpg")  # a part read: 12? fits four bibs
        keyed = {button.get("data-key"): button["text"] for button in page.buttons if button.get("data-key")}
        self.assertEqual(set(keyed), {"1", "2", "3", "4", "U", "N", "S", "H"})
        for key, text in keyed.items():
            with self.subTest(key=key):
                self.assertIn(key, text, "the key is printed on its button")
                self.assertGreater(len(text), len(key) + 2, "and the button says what it does")
        self.assertTrue(all(form.get("method") == "post" for form in page.forms))
        self.assertIn('for="bib"', html)
        self.assertIn("data-correction", html)

    def test_enter_confirms_a_whole_bib_and_offers_nothing_without_a_burst(self):
        photo, page, _ = self.page("Adrian/Finish/a.jpg")  # 125 at 50%: to check
        self.assertIn("Enter", [b.get("data-key") for b in page.buttons])
        status, headers, _ = self.post(f"/check/{photo['short_id']}/", {"action": "confirm", "filter": "all"})
        self.assertEqual(status, 303)
        self.assertIn("after=" + photo["short_id"], headers["Location"])
        (read,) = self.manifest().reads(photo["fingerprint"])
        self.assertEqual((read["decision"], read["bib"]), ("confirmed", "125"))
        self.assertEqual(self.manifest().state(photo["fingerprint"]), State.CHECKED)

    def test_a_number_picks_one_of_the_bibs_that_fit(self):
        photo, _, _ = self.page("Adrian/Finish/b.jpg")
        self.post(f"/check/{photo['short_id']}/", {"pick": "121", "filter": "part"})
        (read,) = self.manifest().reads(photo["fingerprint"])
        self.assertEqual((read["decision"], read["bib"]), ("confirmed", "121"))

    def test_u_keeps_a_part_read(self):
        photo, _, _ = self.page("Adrian/Finish/b.jpg")
        self.post(f"/check/{photo['short_id']}/", {"action": "keep_part", "filter": "part"})
        (read,) = self.manifest().reads(photo["fingerprint"])
        self.assertEqual(read["decision"], "kept_part_read")

    def test_typing_a_bib_corrects_and_refuses_one_not_on_the_list(self):
        photo, _, _ = self.page("Adrian/Finish/a.jpg")
        status, _, html = self.post(f"/check/{photo['short_id']}/", {"action": "correct", "bib": "999", "filter": "all"})
        self.assertEqual(status, 400)
        self.assertIn(b"999 is not on the bib list", html)

        self.post(f"/check/{photo['short_id']}/", {"action": "correct", "bib": "130", "filter": "all"})
        (read,) = self.manifest().reads(photo["fingerprint"])
        self.assertEqual((read["decision"], read["bib"]), ("corrected", "130"))

    def test_n_says_no_bib_and_h_hides(self):
        nobib = self.row("Ross/c.jpg")
        self.post(f"/check/{nobib['short_id']}/", {"action": "no_bib", "filter": "nobib"})
        self.assertEqual(self.manifest().state(nobib["fingerprint"]), State.CHECKED)

        hidden = self.row("Ross/d.jpg")
        self.post(f"/check/{hidden['short_id']}/", {"action": "hide", "filter": "nobib"})
        self.assertEqual(self.manifest().state(hidden["fingerprint"]), State.HIDDEN)
        self.assertEqual(self.row("Ross/d.jpg")["hidden_reason"], "person")

    def test_h_shows_a_hidden_photo_again(self):
        photo = self.row("Ross/d.jpg")
        self.post(f"/check/{photo['short_id']}/", {"action": "hide", "filter": "nobib"})

        status, headers, _ = self.request("GET", "/check/?filter=hidden")
        self.assertEqual(status, 303)
        self.assertIn(photo["short_id"], headers["Location"])
        _, page, html = self.page("Ross/d.jpg", "filter=hidden")
        keyed = {button.get("data-key"): button["text"] for button in page.buttons if button.get("data-key")}
        self.assertEqual(set(keyed), {"H", "S"})
        self.assertIn("Show this photo again", keyed["H"])
        self.assertIn("Hidden by a person", html)

        self.post(f"/check/{photo['short_id']}/", {"action": "show", "filter": "hidden"})
        row = self.row("Ross/d.jpg")
        self.assertEqual((row["hidden_at"], row["hidden_reason"]), (None, None))
        self.assertEqual(self.manifest().state(photo["fingerprint"]), State.NO_BIB_SEEN)

    def test_s_skips_to_the_next_photo_without_deciding_anything(self):
        photo = self.row("Adrian/Finish/a.jpg")
        status, headers, _ = self.post(f"/check/{photo['short_id']}/", {"action": "skip", "filter": "all"})
        self.assertEqual(status, 303)
        status, headers, _ = self.request("GET", headers["Location"])
        self.assertEqual(status, 303)
        self.assertIn(self.row("Adrian/Finish/b.jpg")["short_id"], headers["Location"])
        self.assertIsNone(self.manifest().reads(photo["fingerprint"])[0]["decision"])

    def test_the_no_bib_filter_can_be_narrowed_to_one_photographer(self):
        status, headers, _ = self.request("GET", "/check/?filter=nobib&folder=Ross")
        self.assertEqual(status, 303)
        self.assertIn(self.row("Ross/c.jpg")["short_id"], headers["Location"])
        _, _, html = self.get(urlsplit(headers["Location"]).path + "?" + urlsplit(headers["Location"]).query)
        self.assertIn("No bib seen (3)", html)

    def test_a_typed_bib_is_offered_to_the_rest_of_its_burst(self):
        first = self.row("Ross/c.jpg")  # c, d and e are one burst from camera B
        status, headers, _ = self.post(f"/check/{first['short_id']}/", {"action": "correct", "bib": "311", "filter": "nobib"})
        self.assertEqual(status, 303)
        self.assertIn("offer=311", headers["Location"])

        _, _, html = self.get(headers["Location"])
        self.assertIn("Apply 311 to 2 photos", html)
        self.post(f"/check/{first['short_id']}/", {"action": "apply_burst", "bib": "311", "filter": "nobib"})
        for source in ("Ross/d.jpg", "Ross/e.jpg"):
            (read,) = self.manifest().reads(self.row(source)["fingerprint"])
            self.assertEqual((read["decision"], read["bib"]), ("burst", "311"))


if __name__ == "__main__":
    unittest.main()
