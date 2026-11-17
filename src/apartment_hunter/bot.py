from __future__ import annotations

import argparse
import json
import logging
import signal
import time

from .config import Settings
from .parser import ParsedListing, parse_listing
from .storage import Storage
from .telegram import TelegramClient, TelegramError


LOGGER = logging.getLogger("apartment_hunter")
RUNNING = True

HELP_TEXT = """🏠 Apartment Hunter TLV

שלחו או העבירו אליי פוסט/הודעה עם פרטי דירה וקישור. אני שומר, מזהה כפילויות ומסווג לפי:
• עד 12,000 ₪
• 3 חדרים ומעלה
• 2 שירותים ומעלה
• לב העיר / נווה צדק / כרם התימנים / רוטשילד

בונוסים: חניה, מרפסת, ממ״ד ומעלית.

פקודות: /matches, /inbox, /stats, /criteria, /id, /help

הבוט לא סורק קבוצות פייסבוק פרטיות. יש להעביר אליו תוכן שיש לכם הרשאה לגשת אליו."""


def format_listing(listing: ParsedListing, listing_id: int) -> str:
    values = [
        f"מודעה #{listing_id}",
        f"מחיר: {listing.price:,} ₪" if listing.price is not None else "מחיר: לא זוהה",
        f"חדרים: {listing.rooms:g}" if listing.rooms is not None else "חדרים: לא זוהה",
        f"שירותים: {listing.bathrooms}" if listing.bathrooms is not None else "שירותים: לא זוהה",
        f"אזור: {listing.neighborhood or 'לא זוהה'}",
        f"בונוסים: {', '.join(listing.bonuses) if listing.bonuses else 'אין שזוהו'}",
    ]
    if listing.url:
        values.append(f"קישור: {listing.url}")
    return "\n".join(values)


def format_rows(rows: list, title: str) -> str:
    if not rows:
        return f"{title}\nאין מודעות כרגע."
    chunks = [title]
    for row in rows:
        bonuses = ", ".join(json.loads(row["bonuses"])) or "—"
        chunks.append(
            f"#{row['id']} | {row['price'] or '?'} ₪ | {row['rooms'] or '?'} חד׳ | "
            f"{row['bathrooms'] or '?'} שירותים | {row['neighborhood'] or '?'} | {bonuses}"
            + (f"\n{row['url']}" if row["url"] else "")
        )
    return "\n\n".join(chunks)


def handle_command(command: str, chat_id: int, storage: Storage, telegram: TelegramClient) -> bool:
    command = command.split()[0].split("@")[0].lower()
    if command in {"/start", "/help"}:
        telegram.send_message(chat_id, HELP_TEXT)
    elif command == "/id":
        telegram.send_message(chat_id, f"מזהה הצ׳אט שלך: {chat_id}\nשמרו אותו כ־TELEGRAM_ALLOWED_CHAT_IDS.")
    elif command == "/criteria":
        telegram.send_message(chat_id, "עד 12,000 ₪ | 3+ חדרים | 2+ שירותים | לב העיר, נווה צדק, כרם התימנים או רוטשילד")
    elif command == "/stats":
        stats = storage.stats()
        telegram.send_message(chat_id, f"התאמות: {stats['match']}\nלבדיקה: {stats['review']}\nנפסלו: {stats['rejected']}")
    elif command == "/matches":
        telegram.send_message(chat_id, format_rows(storage.recent("match"), "✅ התאמות אחרונות"))
    elif command == "/inbox":
        telegram.send_message(chat_id, format_rows(storage.recent("review"), "🟡 ממתינות לפרטים"))
    else:
        return False
    return True


def handle_update(update: dict, settings: Settings, storage: Storage, telegram: TelegramClient) -> None:
    message = update.get("message") or update.get("channel_post")
    if not message:
        return
    chat_id = int(message["chat"]["id"])
    if settings.allowed_chat_ids and chat_id not in settings.allowed_chat_ids:
        LOGGER.warning("Ignoring unauthorized chat_id=%s", chat_id)
        return
    text = (message.get("text") or message.get("caption") or "").strip()
    entities = message.get("entities") or message.get("caption_entities") or []
    hidden_urls = [entity["url"] for entity in entities if entity.get("type") == "text_link" and entity.get("url")]
    if hidden_urls:
        text = f"{text}\n{' '.join(hidden_urls)}".strip()
    if not text:
        telegram.send_message(chat_id, "לא מצאתי טקסט. אפשר להעביר פוסט או לשלוח תיאור וקישור.")
        return
    if text.startswith("/") and handle_command(text, chat_id, storage, telegram):
        return

    listing = parse_listing(text)
    saved = storage.save(listing, chat_id, int(message["message_id"]))
    if saved.duplicate:
        telegram.send_message(chat_id, f"♻️ המודעה כבר שמורה אצלי כמספר #{saved.listing_id}.")
        return

    details = format_listing(listing, saved.listing_id)
    if listing.status == "match":
        telegram.send_message(chat_id, f"🚨 נמצאה התאמה!\n\n{details}")
    elif listing.status == "review":
        telegram.send_message(chat_id, f"🟡 שמרתי לבדיקה ידנית.\n{'; '.join(listing.reasons)}\n\n{details}")
    else:
        telegram.send_message(chat_id, f"⛔ שמרתי, אבל המודעה לא מתאימה.\n{'; '.join(listing.reasons)}\n\n{details}")


def run(settings: Settings, once: bool = False) -> None:
    storage = Storage(settings.db_path)
    telegram = TelegramClient(settings.token)
    LOGGER.info("Apartment Hunter started in %s mode", "single-run" if once else "continuous")
    try:
        while RUNNING:
            try:
                updates = telegram.get_updates(storage.get_offset(), settings.poll_timeout)
                for update in updates:
                    handle_update(update, settings, storage, telegram)
                    storage.set_offset(int(update["update_id"]) + 1)
                if once:
                    break
            except TelegramError:
                LOGGER.exception("Telegram API error")
                if once:
                    raise
                time.sleep(5)
    finally:
        storage.close()


def _stop(_signum: int, _frame: object) -> None:
    global RUNNING
    RUNNING = False


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram Apartment Hunter TLV")
    parser.add_argument("--once", action="store_true", help="poll once and exit (for GitHub Actions)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    run(Settings.from_env(), once=args.once)


if __name__ == "__main__":
    main()

