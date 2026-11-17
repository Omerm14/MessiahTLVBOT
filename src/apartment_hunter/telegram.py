from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request


class TelegramError(RuntimeError):
    pass


class TelegramClient:
    def __init__(self, token: str):
        self.base_url = f"https://api.telegram.org/bot{token}"

    def call(self, method: str, payload: dict | None = None) -> dict:
        data = urllib.parse.urlencode(payload or {}).encode("utf-8")
        request = urllib.request.Request(f"{self.base_url}/{method}", data=data, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                result = json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise TelegramError(f"Telegram request failed: {exc}") from exc
        if not result.get("ok"):
            raise TelegramError(result.get("description", "Unknown Telegram API error"))
        return result["result"]

    def get_updates(self, offset: int | None, timeout: int) -> list[dict]:
        payload: dict[str, int | str] = {
            "timeout": timeout,
            "allowed_updates": json.dumps(["message", "channel_post"]),
        }
        if offset is not None:
            payload["offset"] = offset
        return self.call("getUpdates", payload)

    def send_message(self, chat_id: int, text: str) -> None:
        self.call(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": "true",
            },
        )

