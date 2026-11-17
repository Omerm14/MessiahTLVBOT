import tempfile
import unittest
from pathlib import Path

from apartment_hunter.parser import parse_listing
from apartment_hunter.storage import Storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage = Storage(Path(self.temp_dir.name) / "test.db")

    def tearDown(self):
        self.storage.close()
        self.temp_dir.cleanup()

    def test_deduplicates_listing(self):
        listing = parse_listing("רוטשילד 12000 ₪ 3 חדרים 2 שירותים https://example.com/1")
        first = self.storage.save(listing, 1, 10)
        second = self.storage.save(listing, 1, 11)
        self.assertFalse(first.duplicate)
        self.assertTrue(second.duplicate)
        self.assertEqual(first.listing_id, second.listing_id)

    def test_offset_round_trip(self):
        self.assertIsNone(self.storage.get_offset())
        self.storage.set_offset(123)
        self.assertEqual(self.storage.get_offset(), 123)

    def test_stats(self):
        listing = parse_listing("לב העיר 10000 ₪ 3 חדרים 2 שירותים")
        self.storage.save(listing, 1, 1)
        self.assertEqual(self.storage.stats()["match"], 1)


if __name__ == "__main__":
    unittest.main()

