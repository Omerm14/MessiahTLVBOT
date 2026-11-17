#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
export TELEGRAM_BOT_TOKEN="$(security find-generic-password -a "$USER" -s apartment-hunter-token -w)"
export COLLECTOR_SHARED_SECRET="$(security find-generic-password -a "$USER" -s apartment-hunter-collector-secret -w)"
export TELEGRAM_ALERT_CHAT_ID="$(security find-generic-password -a "$USER" -s apartment-hunter-chat-id -w)"
export APARTMENT_DB_PATH="$PROJECT_DIR/data/apartments.db"
export PYTHONPATH="$PROJECT_DIR/src"

cd "$PROJECT_DIR"
exec python3 -m apartment_hunter.collector
