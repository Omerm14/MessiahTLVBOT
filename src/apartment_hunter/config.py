from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    token: str
    db_path: Path
    allowed_chat_ids: frozenset[int]
    poll_timeout: int = 25

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "TELEGRAM_BOT_TOKEN is missing. Set it in your shell or in GitHub Actions Secrets."
            )
        raw_ids = os.environ.get("TELEGRAM_ALLOWED_CHAT_IDS", "")
        try:
            allowed = frozenset(int(value.strip()) for value in raw_ids.split(",") if value.strip())
        except ValueError as exc:
            raise RuntimeError("TELEGRAM_ALLOWED_CHAT_IDS must contain numeric IDs") from exc
        return cls(
            token=token,
            db_path=Path(os.environ.get("APARTMENT_DB_PATH", "data/apartments.db")),
            allowed_chat_ids=allowed,
        )

