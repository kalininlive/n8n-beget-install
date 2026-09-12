#!/bin/bash
set -e

# === Защита: запрещаем запуск через терминал (разрешаем только из бота) ===
if [[ -t 1 ]]; then
  echo "🚫 Обновление можно запускать только через Telegram-бота, а не напрямую в терминале."
  exit 1
fi

# === Подключаем .env (для TG_BOT_TOKEN / TG_USER_ID и пр.) ===
set -a
source /opt/n8n-install/.env
set +a

# === Общие настройки ===
LOG="/opt/n8n-install/logs/update.log"
TG_URL="https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage"

# гарантируем каталог и права лога ДО перенаправления stdout/stderr
mkdir -p /opt/n8n-install/logs
: > "$LOG"
chmod 666 "$LOG"
umask 000

notify() {
  local text="$1"
  curl -s -X POST "$TG_URL" \
    -d chat_id="$TG_USER_ID" \
    -d parse_mode="Markdown" \
    --data-urlencode text="$text" >/dev/null || true
}

# перехват ошибок — шлём алерт и смотрим лог
trap 'notify "❌ *ОШИБКА во время обновления!* См. лог в \`/opt/n8n-install/logs/update.log\`"' ERR

# логируем всё в файл
exec > >(tee -a "$LOG") 2>&1
echo -e "\n🟡 update_n8n.sh начался: $(date)"
notify "🛠 *Начинаю обновление n8n...*"

BASE_DIR="/opt/n8n-install"
cd "$BASE_DIR"

# === Шаг 1. Бэкап ===
echo "🔄 Шаг 1: создаю бэкап..."
notify "📦 *Шаг 1:* создаю бэкап..."
bash "$BASE_DIR/backup_n8n.sh"

# === Шаг 2. Проверка версий ===
echo "🔍 Шаг 2: проверяю версии n8n..."
CURRENT=$(docker exec n8n-app n8n --version || true)
LATEST=$(curl -s https://api.github.com/repos/n8n-io/n8n/releases | jq -r '.[].tag_name' | grep -E '^n8n@' | head -n 1)

# нормализуем формат (GitHub: n8n@1.109.2, бинарь: 1.109.2)
LATEST=${LATEST#n8n@}
CURRENT=${CURRENT#n8n@}

if [ -z "$CURRENT" ]; then
  echo "⚠️ Не удалось получить текущую версию из контейнера n8n-app, продолжу обновление."
else
  if [ "$CURRENT" = "$LATEST" ]; then
    echo "✅ У вас уже последняя версия n8n: $CURRENT. Проверю обновление нод."
    notify "✅ *Уже последняя версия n8n:* $CURRENT. Проверяю Community Nodes..."
  else
    echo "🆕 Доступна новая версия: $LATEST (у вас: $CURRENT)"
    notify "🔁 *Обновляю n8n с версии $CURRENT до $LATEST...*"
  fi
fi

# === Шаг 3. Обновление контейнеров n8n и n8n-worker ===
echo "📦 Шаг 3: обновляю контейнеры n8n и n8n-worker..."
notify "📦 *Шаг 3:* обновляю контейнеры n8n и n8n-worker..."

# Обновляем версию в Dockerfile.n8n
if [ -n "$LATEST" ]; then
  echo "✏️ Обновляю Dockerfile.n8n на версию $LATEST..."
  sed -i "s|^FROM n8nio/n8n:.*|FROM n8nio/n8n:$LATEST|g" Dockerfile.n8n
fi

# Используем системный docker compose для синхронного обновления обоих сервисов
docker compose build n8n n8n-worker
docker compose up -d n8n n8n-worker

# === Шаг 3.1. Обновление Community Nodes ===
echo "🧩 Шаг 3.1: обновляю Community Nodes..."
notify "🧩 *Шаг 3.1:* обновляю Community Nodes..."
# Ожидаем готовности контейнера и обновляем пакеты нод
sleep 10
docker exec n8n-app /bin/sh -c "cd /home/node/.n8n/nodes && npm update" || echo "⚠️ Ошибка при обновлении нод"
# Перезапускаем для применения изменений в нодах
docker compose restart n8n n8n-worker

# === Шаг 4. Проверка статуса ===
echo "🩺 Шаг 4: проверка статуса контейнера..."
sleep 5
docker ps | grep -E 'n8n-app|n8n-worker|n8n-bot|n8n-postgres|n8n-redis|n8n-traefik|n8n-media-render|n8n-tools|edge-tts' || true

# === Шаг 5. Проверка обновлённой версии ===
echo "🔎 Шаг 5: проверка обновлённой версии..."
NEW_VERSION=$(docker exec n8n-app n8n --version || echo "unknown")
echo "🆗 Новая версия: $NEW_VERSION"

# === Шаг 5.1. Post-check движков (media-render, tools, edge-tts) ===
# Обновление пересобирает только n8n/n8n-worker; движки живут в override + /data и не должны
# пострадать. Проверяем это явно, чтобы узнать о поломке из Telegram, а не из упавшего воркфлоу.
echo "🧪 Шаг 5.1: проверяю движки после обновления..."
ENGINE_FAILS=""
check_engine() {
  # $1 — имя проверки, $2 — шим на хосте (может быть пустым), $3 — эквивалент через docker exec, $4 — аргументы шима
  local name="$1" shim="$2" fallback="$3" args="${4:-}" out="" rc=0
  if [ -n "$shim" ] && [ -x "$shim" ]; then
    out=$(timeout 60 "$shim" $args 2>&1) || rc=$?
  else
    out=$(timeout 60 sh -c "$fallback" 2>&1) || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  ✅ $name: $(printf '%s' "$out" | tail -n 1 | cut -c1-120)"
  else
    echo "  ❌ $name (код $rc): $(printf '%s' "$out" | tail -n 3)"
    ENGINE_FAILS="${ENGINE_FAILS}
• ${name}"
  fi
  return 0
}
check_engine "remotion (маскот)"       "$BASE_DIR/shims/remotion"    "docker exec -i n8n-media-render remotion --version" "--version"
check_engine "render-html (карусели)"  "$BASE_DIR/shims/render-html" "docker exec -i n8n-media-render node /opt/engines/html-render/render.mjs --help" "--help"
check_engine "ffmpeg (n8n-tools)"      "$BASE_DIR/shims/ffmpeg"      "docker exec -i n8n-tools ffmpeg -version" "-version"
check_engine "edge-tts"                ""                            "docker exec -i n8n-app wget -qO- http://edge-tts:5050/v1/models"
check_engine "shims в n8n-app"         ""                            "docker exec -i n8n-app sh -c 'test -x /opt/shims/remotion && test -x /opt/shims/render-html && echo ok'"
if [ -n "$ENGINE_FAILS" ]; then
  notify "⚠️ *n8n обновлён, но движки не отвечают:*${ENGINE_FAILS}
Проверь: \`docker ps\`, \`docker compose up -d n8n-media-render n8n-tools edge-tts\`"
else
  echo "  🟢 Все движки отвечают."
fi

# === Шаг 6. Лёгкая уборка Docker ===
# image prune -f (без -a) удаляет только dangling-слои: образы n8n-media-render / n8n-tools / n8n-bot
# помечены тегами и используются контейнерами — они не затрагиваются. НЕ добавлять -a!
echo "🧹 Шаг 6: лёгкая очистка Docker..."
notify "🧹 *Шаг 6:* лёгкая очистка Docker..."
docker image prune -f || true
docker builder prune -f || true
docker system df || true
df -h | sed -n '1,5p' || true

# === Запись в историю ===
echo "[$(date +%F)] Updated to $NEW_VERSION and updated Community Nodes" >> "$BASE_DIR/UPDATE_HISTORY.md"

# === Завершение ===
echo "✅ Обновление завершено! ($(date))"
notify "✅ *Обновление завершено!*\nТеперь установлена версия: *$NEW_VERSION*\nCommunity Nodes обновлены."
