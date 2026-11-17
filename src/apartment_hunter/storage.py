from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sqlite3

from .parser import ParsedListing


SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    telegram_chat_id INTEGER NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    url TEXT,
    price INTEGER,
    rooms REAL,
    bathrooms INTEGER,
    neighborhood TEXT,
    bonuses TEXT NOT NULL,
    status TEXT NOT NULL,
    reasons TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC);
CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class SaveResult:
    listing_id: int
    duplicate: bool


class Storage:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, timeout=30)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript(SCHEMA)

    def close(self) -> None:
        self.connection.close()

    def save(self, listing: ParsedListing, chat_id: int, message_id: int) -> SaveResult:
        existing = self.connection.execute(
            "SELECT id FROM listings WHERE fingerprint = ?", (listing.fingerprint,)
        ).fetchone()
        if existing:
            return SaveResult(int(existing["id"]), True)
        cursor = self.connection.execute(
            """
            INSERT INTO listings (
                fingerprint, telegram_chat_id, telegram_message_id, raw_text, url,
                price, rooms, bathrooms, neighborhood, bonuses, status, reasons
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                listing.fingerprint, chat_id, message_id, listing.raw_text, listing.url,
                listing.price, listing.rooms, listing.bathrooms, listing.neighborhood,
                json.dumps(listing.bonuses, ensure_ascii=False), listing.status,
                json.dumps(listing.reasons, ensure_ascii=False),
            ),
        )
        self.connection.commit()
        return SaveResult(int(cursor.lastrowid), False)

    def get_offset(self) -> int | None:
        row = self.connection.execute("SELECT value FROM bot_state WHERE key = 'offset'").fetchone()
        return int(row["value"]) if row else None

    def set_offset(self, offset: int) -> None:
        self.connection.execute(
            "INSERT INTO bot_state(key, value) VALUES ('offset', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(offset),),
        )
        self.connection.commit()

    def stats(self) -> dict[str, int]:
        result = {"match": 0, "review": 0, "rejected": 0}
        for row in self.connection.execute("SELECT status, COUNT(*) AS count FROM listings GROUP BY status"):
            result[str(row["status"])] = int(row["count"])
        return result

    def recent(self, status: str, limit: int = 5) -> list[sqlite3.Row]:
        return list(
            self.connection.execute(
                "SELECT * FROM listings WHERE status = ? ORDER BY id DESC LIMIT ?", (status, limit)
            )
        )

