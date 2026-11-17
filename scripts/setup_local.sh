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

read "chat_id?הדבק את מזהה הצ׳אט המספרי ולחץ Enter: "
if [[ ! "$chat_id" =~ '^-?[0-9]+$' ]]; then
  echo "מזהה הצ׳אט חייב להיות מספר. לא נשמר דבר."
  exit 1
fi

collector_secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"

security add-generic-password -U -a "$USER" -s apartment-hunter-token -w "$telegram_token" >/dev/null
security add-generic-password -U -a "$USER" -s apartment-hunter-chat-id -w "$chat_id" >/dev/null
security add-generic-password -U -a "$USER" -s apartment-hunter-collector-secret -w "$collector_secret" >/dev/null

print -rn -- "$collector_secret" | pbcopy
unset telegram_token collector_secret

echo
echo "נשמר בהצלחה. הסוד המקומי הועתק ללוח — הדבק אותו בשדה 'הסוד המקומי המשותף' בתוסף."
echo "לאחר ההדבקה אפשר להעתיק טקסט אחר כדי לנקות את הלוח."
