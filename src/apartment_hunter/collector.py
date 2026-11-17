from __future__ import annotations

from dataclasses import dataclass
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
from typing import Any

from .bot import format_listing
from .parser import parse_listing
from .storage import Storage
from .telegram import TelegramClient


LOGGER = logging.getLogger("apartment_hunter.collector")
MAX_BODY_BYTES = 1_000_000
MAX_POSTS_PER_REQUEST = 100


@dataclass(frozen=True)
class CollectorSettings:
    token: str
    alert_chat_id: int
    shared_secret: str
    db_path: Path
    bind_host: str = "127.0.0.1"
    bind_port: int = 8765
    alert_on_review: bool = False

    @classmethod
    def from_env(cls) -> "CollectorSettings":
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        secret = os.environ.get("COLLECTOR_SHARED_SECRET", "").strip()
        raw_chat_id = os.environ.get("TELEGRAM_ALERT_CHAT_ID", "").strip()
        if not token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")
        if not secret or len(secret) < 24:
            raise RuntimeError("COLLECTOR_SHARED_SECRET must contain at least 24 characters")
        if not raw_chat_id:
            raise RuntimeError("TELEGRAM_ALERT_CHAT_ID is missing")
        try:
            alert_chat_id = int(raw_chat_id)
            port = int(os.environ.get("COLLECTOR_PORT", "8765"))
        except ValueError as exc:
            raise RuntimeError("TELEGRAM_ALERT_CHAT_ID and COLLECTOR_PORT must be numeric") from exc
        return cls(
            token=token,
            alert_chat_id=alert_chat_id,
            shared_secret=secret,
            db_path=Path(os.environ.get("APARTMENT_DB_PATH", "data/apartments.db")),
            bind_port=port,
            alert_on_review=os.environ.get("COLLECTOR_ALERT_ON_REVIEW", "0") == "1",
        )


def _synthetic_message_id(post: dict[str, Any]) -> int:
    import hashlib

    stable = str(post.get("url") or post.get("text") or "")
    return int(hashlib.sha256(stable.encode("utf-8")).hexdigest()[:15], 16)


def process_posts(
    posts: list[dict[str, Any]],
    storage: Storage,
    telegram: TelegramClient,
    alert_chat_id: int,
    alert_on_review: bool = False,
) -> dict[str, int]:
    counts = {"received": 0, "saved": 0, "duplicates": 0, "matches": 0, "review": 0}
    for post in posts[:MAX_POSTS_PER_REQUEST]:
        text = str(post.get("text") or "").strip()[:20_000]
        url = str(post.get("url") or "").strip()
        source = str(post.get("source") or "").strip()
        if not text:
            continue
        counts["received"] += 1
        enriched = text
        if url and url not in enriched:
            enriched += f"\n{url}"
        if source:
            enriched += f"\nמקור: {source}"
        listing = parse_listing(enriched)
        saved = storage.save(listing, alert_chat_id, _synthetic_message_id(post))
        if saved.duplicate:
            counts["duplicates"] += 1
            continue
        counts["saved"] += 1
        if listing.status == "match":
            counts["matches"] += 1
            telegram.send_message(
                alert_chat_id,
                f"🚨 נמצאה התאמה בפייסבוק!\n\n{format_listing(listing, saved.listing_id)}",
            )
        elif listing.status == "review":
            counts["review"] += 1
            if alert_on_review:
                telegram.send_message(
                    alert_chat_id,
                    "🟡 פוסט מפייסבוק מחכה לבדיקה.\n"
                    f"{'; '.join(listing.reasons)}\n\n{format_listing(listing, saved.listing_id)}",
                )
    return counts


def make_handler(settings: CollectorSettings):
    class CollectorHandler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "chrome-extension://*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._json(200, {"ok": True})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/ingest":
                self._json(404, {"error": "not found"})
                return
            supplied = self.headers.get("X-Collector-Secret", "")
            if not hmac.compare_digest(supplied, settings.shared_secret):
                self._json(401, {"error": "unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._json(400, {"error": "invalid content length"})
                return
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"error": "request too large or empty"})
                return
            try:
                payload = json.loads(self.rfile.read(length))
                posts = payload.get("posts")
                if not isinstance(posts, list):
                    raise ValueError("posts must be an array")
                storage = Storage(settings.db_path)
                try:
                    result = process_posts(
                        posts,
                        storage,
                        TelegramClient(settings.token),
                        settings.alert_chat_id,
                        settings.alert_on_review,
                    )
                finally:
                    storage.close()
            except (json.JSONDecodeError, ValueError) as exc:
                self._json(400, {"error": str(exc)})
                return
            except Exception:
                LOGGER.exception("Failed to ingest Facebook posts")
                self._json(500, {"error": "ingest failed"})
                return
            self._json(200, {"ok": True, **result})

        def log_message(self, format: str, *args: object) -> None:
            LOGGER.info("%s - %s", self.address_string(), format % args)

    return CollectorHandler


def main() -> None:
    settings = CollectorSettings.from_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = ThreadingHTTPServer(
        (settings.bind_host, settings.bind_port),
        make_handler(settings),
    )
    LOGGER.info("Local collector listening on http://%s:%s", settings.bind_host, settings.bind_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
