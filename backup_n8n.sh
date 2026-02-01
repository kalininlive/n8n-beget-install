#!/bin/sh
set -e
set -x

BASE_DIR="/opt/n8n-install"
BACKUP_DIR="$BASE_DIR/backups"
LOG="$BACKUP_DIR/backup.log"

exec > >(tee -a "$LOG") 2>&1
echo "🟡 backup_n8n.sh (logical, v2+) начался: $(date)"

NOW=$(date +"%Y-%m-%d-%H-%M")
ARCHIVE_NAME="n8n-logical-backup-$NOW.zip"
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE_NAME"

ENV_FILE="$BASE_DIR/.env"
EXPORT_DIR="$BASE_DIR/export_temp"
EXPORT_CREDS="$BASE_DIR/n8n_credentials.json"

mkdir -p "$BACKUP_DIR"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

# === ENV ===
if [ -f "$ENV_FILE" ]; then
  . "$ENV_FILE"
fi

BOT_TOKEN="$TG_BOT_TOKEN"
USER_ID="$TG_USER_ID"

if [ -z "$BOT_TOKEN" ] || [ -z "$USER_ID" ]; then
  echo "❌ TG_BOT_TOKEN или TG_USER_ID отсутствуют"
  exit 1
fi

send_msg() {
  curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    -d chat_id="$USER_ID" \
    -d parse_mode="Markdown" \
    -d text="$1" >/dev/null
}

send_msg "📦 *Начинаю логический бэкап n8n (v2+)*"

# === Export workflows ===
docker exec n8n-app n8n export:workflow --all --separate --output=/tmp/export_dir || {
  send_msg "❌ *Ошибка*: не удалось экспортировать workflows"
  exit 1
}

docker cp n8n-app:/tmp/export_dir "$EXPORT_DIR"

WF_COUNT=$(ls -1 "$EXPORT_DIR/export_dir"/*.json 2>/dev/null | wc -l)

if [ "$WF_COUNT" -eq 0 ]; then
  send_msg "⚠️ *Бэкап отменён*: workflows не найдены"
  exit 1
fi

# === Export credentials ===
docker exec n8n-app n8n export:credentials --all --output=/tmp/creds.json || true

if docker cp n8n-app:/tmp/creds.json "$EXPORT_CREDS"; then
  echo "credentials экспортированы"
else
  echo '{}' > "$EXPORT_CREDS"
  send_msg "⚠️ credentials отсутствуют — сохранён пустой файл"
fi

# === Archive ===
zip -9 -j "$ARCHIVE_PATH" \
  "$EXPORT_CREDS" \
  "$EXPORT_DIR/export_dir"/*.json

SIZE_BYTES=$(stat -c%s "$ARCHIVE_PATH")
SIZE_MB=$((SIZE_BYTES / 1024 / 1024))

# === Send ===
if [ "$SIZE_BYTES" -gt 50000000 ]; then
  send_msg "⚠️ *Бэкап создан*: \`$ARCHIVE_NAME\` ($SIZE_MB MB)\nФайл слишком большой для Telegram.\nПуть: \`$ARCHIVE_PATH\`"
else
  curl -s -F "document=@$ARCHIVE_PATH" \
    "https://api.telegram.org/bot$BOT_TOKEN/sendDocument?chat_id=$USER_ID&caption=Logical%20backup%20n8n%20$NOW" >/dev/null
fi

rm -rf "$EXPORT_DIR" "$EXPORT_CREDS"

send_msg "✅ *Логический бэкап n8n завершён*\nWorkflows: *$WF_COUNT*\nРазмер: *${SIZE_MB} MB*"
echo "🟢 backup_n8n.sh завершён: $(date)"
