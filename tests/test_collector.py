from pathlib import Path
import tempfile
import unittest

from apartment_hunter.collector import process_posts
from apartment_hunter.storage import Storage


class FakeTelegram:
    def __init__(self):
        self.messages = []

    def send_message(self, chat_id, text):
        self.messages.append((chat_id, text))


class CollectorTests(unittest.TestCase):
    def test_matching_facebook_post_is_saved_alerted_and_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(Path(directory) / "test.db")
            telegram = FakeTelegram()
            posts = [{
                "text": "דירה בלב העיר 3.5 חדרים 2 שירותים 11,800 ש״ח מרפסת ומעלית",
                "url": "https://www.facebook.com/groups/example/posts/123",
                "source": "https://www.facebook.com/groups/example",
            }]
            first = process_posts(posts, storage, telegram, 123)
            second = process_posts(posts, storage, telegram, 123)
            self.assertEqual(first["matches"], 1)
            self.assertEqual(second["duplicates"], 1)
            self.assertEqual(len(telegram.messages), 1)
            self.assertIn("נמצאה התאמה בפייסבוק", telegram.messages[0][1])
            storage.close()

    def test_review_post_is_saved_without_alert_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(Path(directory) / "test.db")
            telegram = FakeTelegram()
            result = process_posts([{"text": "דירה מקסימה בנווה צדק עם מרפסת"}], storage, telegram, 123)
            self.assertEqual(result["review"], 1)
            self.assertEqual(telegram.messages, [])
            storage.close()


if __name__ == "__main__":
    unittest.main()
