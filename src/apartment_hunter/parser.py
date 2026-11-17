from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


TARGET_NEIGHBORHOODS = {
    "לב העיר": ("לב העיר", "lev hair", "lev ha'ir", "lev ha’ir"),
    "נווה צדק": ("נווה צדק", "נוה צדק", "neve tzedek", "neve tsedek"),
    "כרם התימנים": ("כרם התימנים", "kerem hateimanim", "kerem hateymanim"),
    "רוטשילד": ("רוטשילד", "rothschild"),
}

BONUS_KEYWORDS = {
    "חניה": ("חניה", "חנייה", "parking"),
    "מרפסת": ("מרפסת", "balcony"),
    "ממ״ד": ("ממ״ד", 'ממ"ד', "ממד", "safe room", "shelter room"),
    "מעלית": ("מעלית", "elevator", "lift"),
}

URL_RE = re.compile(r"https?://[^\s<>\]\[()]+", re.IGNORECASE)
PRICE_PATTERNS = (
    re.compile(r"(?:₪|ש[\"״']?ח|מחיר|שכ[\"״']?ד)\s*[:\-]?\s*(\d{1,2}(?:[,.]\d{3})+|\d{4,5})", re.I),
    re.compile(r"(\d{1,2}(?:[,.]\d{3})+|\d{4,5})\s*(?:₪|ש[\"״']?ח)", re.I),
)
ROOMS_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:חדרים?|חד[׳']|rooms?)", re.I)
BATHROOM_PATTERNS = (
    re.compile(r"(\d+)\s*(?:חדרי?\s*)?(?:שירותים|שרותים|אסלות|חדרי?\s*רחצה|bathrooms?|toilets?|wc)", re.I),
    re.compile(r"(?:שירותים|שרותים|bathrooms?|toilets?|wc)\s*[:\-]?\s*(\d+)", re.I),
)
TRACKING_QUERY_KEYS = {"fbclid", "gclid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}


@dataclass(frozen=True)
class ParsedListing:
    raw_text: str
    price: int | None
    rooms: float | None
    bathrooms: int | None
    neighborhood: str | None
    bonuses: tuple[str, ...]
    url: str | None
    fingerprint: str
    status: str
    reasons: tuple[str, ...]

    @property
    def bonus_score(self) -> int:
        return len(self.bonuses)


def _first_number(patterns: tuple[re.Pattern[str], ...], text: str) -> int | None:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            return int(match.group(1).replace(",", "").replace(".", ""))
    return None


def canonicalize_url(url: str) -> str:
    cleaned = url.rstrip(".,;:!?\"'")
    split = urlsplit(cleaned)
    query = [
        (key, value)
        for key, value in parse_qsl(split.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS and not key.lower().startswith("utm_")
    ]
    return urlunsplit((split.scheme.lower(), split.netloc.lower(), split.path.rstrip("/"), urlencode(query), ""))


def _fingerprint(text: str, url: str | None) -> str:
    if url:
        source = f"url:{url}"
    else:
        normalized = re.sub(r"\W+", "", text.lower(), flags=re.UNICODE)
        source = f"text:{normalized}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def parse_listing(text: str) -> ParsedListing:
    normalized = " ".join(text.split())
    lowered = normalized.lower()
    price = _first_number(PRICE_PATTERNS, normalized)
    rooms_match = ROOMS_RE.search(normalized)
    rooms = float(rooms_match.group(1).replace(",", ".")) if rooms_match else None
    bathrooms = _first_number(BATHROOM_PATTERNS, normalized)
    neighborhood = next(
        (name for name, aliases in TARGET_NEIGHBORHOODS.items() if any(alias in lowered for alias in aliases)),
        None,
    )
    bonuses = tuple(name for name, aliases in BONUS_KEYWORDS.items() if _has_positive_bonus(lowered, aliases))
    url_match = URL_RE.search(normalized)
    url = canonicalize_url(url_match.group(0)) if url_match else None

    missing = []
    if price is None:
        missing.append("מחיר")
    if rooms is None:
        missing.append("מספר חדרים")
    if bathrooms is None:
        missing.append("מספר שירותים")
    if neighborhood is None:
        missing.append("אזור")

    rejected = []
    if price is not None and price > 12_000:
        rejected.append("מחיר מעל 12,000 ₪")
    if rooms is not None and rooms < 3:
        rejected.append("פחות מ־3 חדרים")
    if bathrooms is not None and bathrooms < 2:
        rejected.append("פחות מ־2 שירותים")

    if rejected:
        status, reasons = "rejected", tuple(rejected)
    elif missing:
        status, reasons = "review", tuple(f"חסר: {field}" for field in missing)
    else:
        status, reasons = "match", ("עומדת בכל תנאי החובה",)

    return ParsedListing(
        raw_text=text,
        price=price,
        rooms=rooms,
        bathrooms=bathrooms,
        neighborhood=neighborhood,
        bonuses=bonuses,
        url=url,
        fingerprint=_fingerprint(normalized, url),
        status=status,
        reasons=reasons,
    )


def _has_positive_bonus(text: str, aliases: tuple[str, ...]) -> bool:
    for alias in aliases:
        value = re.escape(alias.lower())
        if not re.search(value, text):
            continue
        negative = rf"(?:ללא|בלי|אין)\s+(?:\w+\s+){{0,2}}{value}"
        if not re.search(negative, text):
            return True
    return False

