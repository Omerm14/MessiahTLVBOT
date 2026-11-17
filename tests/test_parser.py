import unittest

from apartment_hunter.parser import canonicalize_url, parse_listing


class ParserTests(unittest.TestCase):
    def test_matching_hebrew_listing(self):
        listing = parse_listing(
            "דירה בלב העיר, מחיר 11,800 ש״ח, 3.5 חדרים, 2 שירותים, "
            "מרפסת, חניה וממ״ד https://example.com/ad/17?utm_source=facebook"
        )
        self.assertEqual(listing.status, "match")
        self.assertEqual(listing.price, 11800)
        self.assertEqual(listing.rooms, 3.5)
        self.assertEqual(listing.bathrooms, 2)
        self.assertEqual(listing.neighborhood, "לב העיר")
        self.assertEqual(set(listing.bonuses), {"חניה", "מרפסת", "ממ״ד"})
        self.assertEqual(listing.url, "https://example.com/ad/17")

    def test_rejects_multiple_failed_requirements(self):
        listing = parse_listing("נווה צדק, 13,500 ₪, 2.5 חדרים, שירותים: 1")
        self.assertEqual(listing.status, "rejected")
        self.assertEqual(len(listing.reasons), 3)

    def test_missing_data_goes_to_review(self):
        listing = parse_listing("דירה יפה ברוטשילד עם מעלית")
        self.assertEqual(listing.status, "review")
        self.assertIn("מעלית", listing.bonuses)
        self.assertTrue(any("מחיר" in reason for reason in listing.reasons))

    def test_negative_bonus_is_not_counted(self):
        listing = parse_listing("כרם התימנים 11000 ש״ח, 3 חדרים, 2 שירותים, ללא חניה ובלי מעלית")
        self.assertEqual(listing.status, "match")
        self.assertNotIn("חניה", listing.bonuses)
        self.assertNotIn("מעלית", listing.bonuses)

    def test_tracking_parameters_do_not_change_url(self):
        a = canonicalize_url("https://Facebook.com/groups/x/posts/1/?fbclid=abc&utm_medium=social")
        b = canonicalize_url("https://facebook.com/groups/x/posts/1")
        self.assertEqual(a, b)

    def test_same_url_has_same_fingerprint(self):
        first = parse_listing("פרטים א https://example.com/a?fbclid=1")
        second = parse_listing("פרטים אחרים https://example.com/a?utm_source=x")
        self.assertEqual(first.fingerprint, second.fingerprint)


if __name__ == "__main__":
    unittest.main()

