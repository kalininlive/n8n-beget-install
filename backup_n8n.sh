#!/bin/sh
exec > /opt/n8n-install/backups/debug.log 2>&1
echo "🟡 backup_n8n.sh начался: $(date)"
set -e
set -x

# === Конфигурация ===
BACKUP_DIR="/opt/n8n-install/backups"
mkdir -p "$BACKUP_DIR"
NOW=$(date +"%Y-%m-%d-%H-%M")
ARCHIVE_NAME="n8n-backup-$NOW.zip"
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE_NAME"
BASE_DIR="/opt/n8n-install"
ENV_FILE="$BASE_DIR/.env"
EXPORT_DIR="$BASE_DIR/export_temp"
EXPORT_CREDS="$BASE_DIR/n8n_credentials.json"

# Очистка перед запуском
rm -f "$BACKUP_DIR"/n8n-backup-*.zip
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

# === Загрузка переменных окружения ===
if [ -f "$ENV_FILE" ]; then
    . "$ENV_FILE"
fi
BOT_TOKEN="$TG_BOT_TOKEN"
USER_ID="$TG_USER_ID"

# Проверка наличия переменных
if [ -z "$BOT_TOKEN" ] || [ -z "$USER_ID" ]; then
    echo "❌ Ошибка: TG_BOT_TOKEN или TG_USER_ID не найдены. Проверьте .env файл."
    exit 1
fi

# === Функции Telegram ===
send_telegram_message() {
  # Кодируем сообщение для URL
  ENCODED_MESSAGE=$(printf %s "$1" | jq -s -R -r @uri)
  curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    -d chat_id="$USER_ID" \
    -d text="$ENCODED_MESSAGE" \
    -d parse_mode="Markdown" > /dev/null
}

send_telegram_document() {
  curl -s -o /dev/null -w "%{http_code}" -F "document=@$1" \
    "https://api.telegram.org/bot$BOT_TOKEN/sendDocument?chat_id=$USER_ID&caption=$2"
}


# === Экспорт Workflows (по отдельным файлам) ===
docker exec n8n-app n8n export:workflow --all --separate --output=/tmp/export_dir || true
docker cp n8n-app:/tmp/export_dir "$EXPORT_DIR"

WF_COUNT=$(ls -1q "$EXPORT_DIR/export_dir"/*.json 2>/dev/null | wc -l)
if [ "$WF_COUNT" -eq 0 ]; then
  echo "⚠️ Внимание: воркфлоу не найдены"
  send_telegram_message "⚠️ *Бэкап n8n*: Внимание, в n8n нет ни одного workflow. Бэкап отменён."
  exit 1
fi
echo "✅ Экспортировано $WF_COUNT воркфлоу"

# === Экспорт Credentials ===
docker exec n8n-app n8n export:credentials --all --output=/tmp/creds.json || true

if docker cp n8n-app:/tmp/creds.json "$EXPORT_CREDS"; then
  echo "✅ credentials экспортированы"
else
  echo "⚠️ Внимание: credentials отсутствуют, создаю пустой JSON"
  echo '{}' > "$EXPORT_CREDS"
  send_telegram_message "⚠️ *Бэкап n8n*: Внимание, в n8n нет ни одного credentials. Бэкап выполнен только для workflows."
fi

# === Создание архива ===
zip -9 -j "$ARCHIVE_PATH" "$EXPORT_CREDS" > /dev/null
zip -9 -j "$ARCHIVE_PATH" "$EXPORT_DIR/export_dir"/*.json > /dev/null
echo "✅ Архив $ARCHIVE_NAME создан."

# === Проверка размера и отправка ===
MAX_SIZE_BYTES=50000000 # 50 MB
FILE_SIZE_BYTES=$(stat -c%s "$ARCHIVE_PATH")

if [ "$FILE_SIZE_BYTES" -gt "$MAX_SIZE_BYTES" ]; then
  # Файл слишком большой, отправляем только уведомление
  FILE_SIZE_MB=$((FILE_SIZE_BYTES / 1024 / 1024))
  echo "⚠️ Файл слишком большой ($FILE_SIZE_MB MB), отправляю только уведомление."
  MESSAGE="✅ *Бэкап n8n*
Резервная копия *$ARCHIVE_NAME* успешно создана.
*Размер*: $FILE_SIZE_MB MB.

Файл слишком большой для отправки в Telegram. Он доступен на сервере по пути:
\`$ARCHIVE_PATH\`"
  send_telegram_message "$MESSAGE"
else
  # Файл в пределах лимита, отправляем его
  echo "✅ Файл в пределах лимита ($FILE_SIZE_BYTES байт), отправляю в Telegram."
  CAPTION="Backup%20n8n%20($NOW)"
  
  # Отправляем документ и проверяем HTTP-статус
  HTTP_STATUS=$(send_telegram_document "$ARCHIVE_PATH" "$CAPTION")
  
  if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ Архив успешно отправлен в Telegram."
  else
    echo "❌ Ошибка отправки архива. HTTP статус: $HTTP_STATUS"
    send_telegram_message "❌ *Бэкап n8n*: Ошибка при отправке архива в Telegram. Код ответа: $HTTP_STATUS."
  fi
fi

# === Временные файлы — очищаем, архив сохраняем до следующего запуска
rm -rf "$EXPORT_DIR" "$EXPORT_CREDS"
echo "🟢 backup_n8n.sh завершён: $(date)"