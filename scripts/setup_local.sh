#!/bin/zsh
set -euo pipefail

echo "Apartment Hunter TLV — הגדרה מקומית מאובטחת"
echo "הערכים נשמרים ב-Keychain של macOS ואינם נכתבים לקבצי הפרויקט."
echo

read -s "telegram_token?הדבק טוקן Telegram חדש ולחץ Enter: "
echo
if [[ ! "$telegram_token" =~ '^[0-9]+:[A-Za-z0-9_-]+$' ]]; then
  echo "הטוקן לא נראה תקין. לא נשמר דבר."
  exit 1
fi

echo
echo "פתח עכשיו את הבוט שלך בטלגרם ושלח לו /start."
read "ready?אחרי ששלחת /start, לחץ כאן Enter: "

export APARTMENT_HUNTER_SETUP_TOKEN="$telegram_token"
setup_result="$(python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

token = os.environ["APARTMENT_HUNTER_SETUP_TOKEN"]

def telegram(method):
    with urllib.request.urlopen(
        f"https://api.telegram.org/bot{token}/{method}", timeout=15
    ) as response:
        payload = json.load(response)
    if not payload.get("ok"):
        raise RuntimeError(payload.get("description", "Telegram rejected the request"))
    return payload["result"]

try:
    bot = telegram("getMe")
    updates = telegram("getUpdates?timeout=2&allowed_updates=%5B%22message%22%5D")
except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError) as error:
    print(f"ERROR\t{error}")
    sys.exit(0)

chat_id = ""
for update in reversed(updates):
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    if chat.get("id") is not None:
        chat_id = str(chat["id"])
        break

print(f"OK\t{bot.get('username', '')}\t{chat_id}")
PY
)"
unset APARTMENT_HUNTER_SETUP_TOKEN

status="${setup_result%%$'\t'*}"
if [[ "$status" != "OK" ]]; then
  echo "לא הצלחתי לאמת את הטוקן מול Telegram. לא נשמר דבר."
  exit 1
fi

remainder="${setup_result#*$'\t'}"
bot_username="${remainder%%$'\t'*}"
chat_id="${remainder#*$'\t'}"
if [[ ! "$chat_id" =~ '^-?[0-9]+$' ]]; then
  echo "לא מצאתי הודעת /start חדשה. שלח /start לבוט והרץ את ההגדרה שוב."
  exit 1
fi

collector_secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"

security add-generic-password -U -a "$USER" -s apartment-hunter-token -w "$telegram_token" >/dev/null
security add-generic-password -U -a "$USER" -s apartment-hunter-chat-id -w "$chat_id" >/dev/null
security add-generic-password -U -a "$USER" -s apartment-hunter-collector-secret -w "$collector_secret" >/dev/null

print -rn -- "$collector_secret" | pbcopy
unset telegram_token collector_secret

echo
echo "הבוט @$bot_username והצ׳אט זוהו ונשמרו בהצלחה."
echo "הסוד המקומי הועתק ללוח — הדבק אותו בשדה 'הסוד המקומי המשותף' בתוסף."
echo "לאחר ההדבקה אפשר להעתיק טקסט אחר כדי לנקות את הלוח."
