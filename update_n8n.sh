#!/bin/bash
set -e

# === Защита: запрещаем запуск через терминал (разрешаем только из бота) ===
if [[ -t 1 ]]; then
  echo "🚫 Обновление можно запускать только через Telegram-бота, а не напрямую в терминале."
  exit 1
fi

# === Подключаем .env ===
set -a
source /opt/n8n-install/.env
set +a

# === Общие настройки ===
BASE_DIR="/opt/n8n-install"
LOG="$BASE_DIR/logs/update.log"
TG_URL="https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage"

mkdir -p "$BASE_DIR/logs"
: > "$LOG"
chmod 666 "$LOG"
umask 000

notify() {
  local text="$1"
  curl -s -X POST "$TG_URL" \
    -d chat_id="$TG_USER_ID" \
    -d parse_mode="Markdown" \
    -d text="$text" >/dev/null || true
}

trap 'notify "❌ *ОШИБКА во время обновления n8n!* См. лог: \`logs/update.log\`"' ERR

exec > >(tee -a "$LOG") 2>&1
echo -e "\n🟡 update_n8n.sh (v2+) начался: $(date)"
notify "🛠 *Начинаю обновление n8n (v2+)*"

cd "$BASE_DIR"

# === Шаг 1. Бэкап ===
echo "🔄 Шаг 1: создаю бэкап..."
notify "📦 *Шаг 1:* создаю бэкап..."
bash "$BASE_DIR/backup_n8n.sh"

# === Шаг 2. Проверка версий (ИНФОРМАЦИОННО) ===
echo "🔍 Шаг 2: проверяю версии n8n (неблокирующе)..."
CURRENT=$(docker exec n8n-app n8n --version || true)
LATEST=$(curl -s https://api.github.com/repos/n8n-io/n8n/releases/latest | grep '"tag_name":' | cut -d '"' -f 4)

LATEST=${LATEST#n8n@}
CURRENT=${CURRENT#n8n@}

if [[ -n "$CURRENT" ]]; then
  echo "ℹ️ Текущая версия: $CURRENT"
fi
echo "ℹ️ Последняя версия: $LATEST"

# === Шаг 3. Обновление (v2+ атомарно) ===
echo "📦 Шаг 3: обновляю все сервисы n8n (v2+)..."
notify "🏗 *Шаг 3:* пересобираю и перезапускаю сервисы n8n..."

COMPOSE_IMG="docker/compose:1.29.2"
compose() {
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /opt:/opt \
    -w /opt/n8n-install \
    "$COMPOSE_IMG" -p n8n-install "$@"
}

# v2+ ВАЖНО: всё целиком
compose down
compose build
compose up -d

# === Шаг 4. Проверка статуса ===
echo "🩺 Шаг 4: проверка статуса..."
sleep 10
docker ps | grep -E 'n8n-app|n8n-worker|n8n-bot|n8n-postgres|n8n-redis|n8n-traefik' || true

# === Шаг 5. Версия после обновления ===
NEW_VERSION=$(docker exec n8n-app n8n --version || echo "unknown")
echo "🆗 Новая версия: $NEW_VERSION"

# === Шаг 6. Лёгкая очистка Docker (БЕЗ хоста) ===
echo "🧹 Шаг 6: лёгкая очистка Docker..."
notify "🧹 *Шаг 6:* очистка Docker..."
docker image prune -f || true
docker builder prune -f || true
docker container prune -f || true
docker volume prune -f || true
docker system df || true

# === Завершение ===
echo "✅ Обновление завершено! ($(date))"
notify "✅ *Обновление завершено!*\nВерсия n8n: *$NEW_VERSION*"
