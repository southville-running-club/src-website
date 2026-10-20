import io
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from PIL import Image

from racephotos.camera import parse_exif_time, read_camera
from racephotos.copies import SRGB_BYTES, UnreadablePhoto, make_copies, open_original
from racephotos.jpeg import MetadataLeft, NotAJpeg, check_copy, walk

from . import fixtures


def pixel(data: bytes, xy):
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGB").getpixel(xy)


def close(colour, expected, tolerance=40):
    return all(abs(a - b) <= tolerance for a, b in zip(colour, expected))


class CopiesCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def copies_of(self, **kwargs):
        path = fixtures.make_jpeg(self.dir / "original.jpg", **kwargs)
        with open_original(path) as image:
            return make_copies(image)


class StrippedCopiesTest(CopiesCase):
    def test_a_rotated_photo_with_gps_and_a_serial_comes_out_upright_with_nothing_else(self):
        copies = self.copies_of(size=(600, 400), orientation=6)

        for name, data in copies.images.items():
            with self.subTest(copy=name):
                with Image.open(io.BytesIO(data)) as image:
                    width, height = image.size
                    self.assertGreater(height, width, "orientation 6 is a portrait photo")
                    self.assertEqual(dict(image.getexif()), {})
                    self.assertNotIn("exif", image.info)
                    self.assertNotIn("xmp", image.info)
                    self.assertNotIn("comment", image.info)

                # Orientation 6 turns the picture a quarter clockwise, so the red square
                # stored at the top left is shown at the top right.
                self.assertTrue(close(pixel(data, (width - 5, 5)), fixtures.RED))
                self.assertTrue(close(pixel(data, (5, 5)), fixtures.BLUE))

                for secret in fixtures.SECRETS:
                    self.assertNotIn(secret, data)
                check_copy(data)

    def test_segments_are_only_the_picture_and_a_jfif_header(self):
        copies = self.copies_of()
        names = {segment.name for segment in walk(copies.images["full"]).segments}
        self.assertLessEqual(names, {"APP0", "DQT", "SOF0", "DHT", "SOS"})

    def test_sizes_by_long_edge_without_enlarging(self):
        big = self.copies_of(size=(3000, 2000), metadata=False)
        self.assertEqual(
            big.dimensions, {"full": (2400, 1600), "medium": (1200, 800), "thumb": (480, 320)}
        )
        small = self.copies_of(size=(800, 600), metadata=False)
        self.assertEqual(
            small.dimensions, {"full": (800, 600), "medium": (800, 600), "thumb": (480, 360)}
        )

    def test_a_camera_profile_is_replaced_by_the_generic_srgb_one(self):
        camera_profile = fixtures.marked_srgb_profile()
        copies = self.copies_of(icc_profile=camera_profile)
        for data in copies.images.values():
            with Image.open(io.BytesIO(data)) as image:
                self.assertEqual(image.info.get("icc_profile"), SRGB_BYTES)
            self.assertNotIn(b"CAMXMODL", data)

    def test_a_broken_profile_is_treated_as_absent(self):
        copies = self.copies_of(icc_profile=b"not a colour profile")
        for data in copies.images.values():
            with Image.open(io.BytesIO(data)) as image:
                self.assertIsNone(image.info.get("icc_profile"))

    def test_cmyk_and_greyscale_come_out_as_rgb(self):
        for mode in ("CMYK", "L"):
            with self.subTest(mode=mode):
                copies = self.copies_of(mode=mode)
                with Image.open(io.BytesIO(copies.images["thumb"])) as image:
                    self.assertEqual(image.mode, "RGB")

    def test_refuses_a_file_that_is_not_a_jpeg(self):
        path = self.dir / "really-a.png.jpg"
        fixtures.picture().save(path, "PNG")
        with self.assertRaises(UnreadablePhoto):
            open_original(path)
        (self.dir / "empty.jpg").write_bytes(b"")
        with self.assertRaises(UnreadablePhoto):
            open_original(self.dir / "empty.jpg")


class AllowlistTest(unittest.TestCase):
    def test_refuses_exif_xmp_and_comments(self):
        for options in ({"exif": fixtures.exif_bytes()}, {"xmp": fixtures.XMP}, {"comment": b"hi"}):
            with self.subTest(options=list(options)), self.assertRaises(MetadataLeft):
                check_copy(fixtures.jpeg_bytes(**options))

    def test_refuses_bytes_after_the_end_of_the_image(self):
        with self.assertRaises(MetadataLeft):
            check_copy(fixtures.jpeg_bytes() + b"appended")

    def test_refuses_a_jfxx_thumbnail_header(self):
        data = fixtures.jpeg_bytes()
        jfxx = b"\xff\xe0\x00\x08JFXX\x00\x10"
        with self.assertRaises(MetadataLeft):
            check_copy(data[:2] + jfxx + data[2:])

    def test_accepts_a_plain_jpeg_and_a_progressive_one(self):
        check_copy(fixtures.jpeg_bytes())
        check_copy(fixtures.jpeg_bytes(progressive=True))

    def test_refuses_what_is_not_a_jpeg(self):
        with self.assertRaises(NotAJpeg):
            walk(b"\x89PNG\r\n")
        with self.assertRaises(NotAJpeg):
            walk(fixtures.jpeg_bytes()[:-2])


class CameraTest(CopiesCase):
    def read(self, credit="Adrian", **kwargs):
        path = fixtures.make_jpeg(self.dir / "original.jpg", **kwargs)
        with open_original(path) as image:
            return read_camera(image, credit)

    def test_reads_the_time_with_its_subseconds(self):
        facts = self.read(recorded="2026:11:01 12:00:05", subseconds="25")
        self.assertEqual(facts.recorded, datetime(2026, 11, 1, 12, 0, 5, 250000))

    def test_a_missing_or_placeholder_time_is_none(self):
        self.assertIsNone(self.read(recorded=None).recorded)
        self.assertIsNone(self.read(recorded="0000:00:00 00:00:00").recorded)
        self.assertIsNone(parse_exif_time("2026-11-01 12:00:05"))

    def test_one_body_is_one_camera_whoever_holds_it(self):
        self.assertEqual(self.read(credit="Adrian").camera_key, self.read(credit="Ross").camera_key)
        self.assertNotEqual(
            self.read(serial="SERIAL-A").camera_key, self.read(serial="SERIAL-B").camera_key
        )

    def test_without_a_serial_the_photographer_tells_cameras_apart(self):
        self.assertNotEqual(
            self.read(credit="Adrian", serial=None).camera_key,
            self.read(credit="Ross", serial=None).camera_key,
        )

    def test_the_serial_is_not_in_anything_returned(self):
        facts = self.read()
        self.assertNotIn(fixtures.SERIAL, repr(facts))
        self.assertEqual(facts.camera_label, "FakeCam Model X")


if __name__ == "__main__":
    unittest.main()
