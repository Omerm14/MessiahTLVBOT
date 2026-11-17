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



class UnauthorizedChatTests(unittest.TestCase):
    def test_stranger_gets_only_their_chat_id(self):
        import tempfile
        from pathlib import Path
        from apartment_hunter.bot import handle_update
        from apartment_hunter.config import Settings

        class FakeTelegram:
            def __init__(self):
                self.sent = []

            def send_message(self, chat_id, text):
                self.sent.append((chat_id, text))

        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(token="x", db_path=Path(directory) / "t.db", allowed_chat_ids=frozenset({1}))
            storage = Storage(settings.db_path)
            telegram = FakeTelegram()
            handle_update({"message": {"message_id": 1, "chat": {"id": 55}, "text": "/start"}}, settings, storage, telegram)
            handle_update({"message": {"message_id": 2, "chat": {"id": 55}, "text": "/stats"}}, settings, storage, telegram)
            handle_update({"message": {"message_id": 3, "chat": {"id": 55}, "text": "דירה 3 חדרים"}}, settings, storage, telegram)
            self.assertEqual(len(telegram.sent), 1)
            self.assertIn("55", telegram.sent[0][1])
            storage.close()
