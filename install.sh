#!/bin/bash
# ============================================================
# n8n-beget-install — установка полного стека на чистый Ubuntu 22.04/24.04
#   n8n (queue mode) + Postgres + Redis + Traefik + Telegram-бот
#   + движки: n8n-media-render (маскот/Remotion + html-render карусели),
#     n8n-tools (ffmpeg/yt-dlp/python), edge-tts, SearXNG, n8n Sandbox
# Состав стека — STACK.md, движки — ENGINES.md.
# Запуск:  bash <(curl -s https://raw.githubusercontent.com/kalininlive/n8n-beget-install/stack-v2/install.sh)
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kalininlive/n8n-beget-install.git}"
REPO_BRANCH="${REPO_BRANCH:-stack-v2}"   # после слияния stack-v2 -> main поменять на main
INSTALL_DIR="/opt/n8n-install"


### Проверка прав
if (( EUID != 0 )); then
  echo "❗ Скрипт должен быть запущен от root: sudo bash install.sh"
  exit 1
fi

clear
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   🌌  n8n + движки рендера — автоматическая установка         ║
║   n8n · Postgres · Redis · Traefik · Remotion · HyperFrames   ║
║   ffmpeg · edge-tts · whisper · Telegram Bot API (до 2 ГБ)    ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo "Любой ответ можно задать заранее переменной окружения (DOMAIN=… EMAIL=… bash install.sh) — тогда вопрос пропускается."
echo

# ask VAR "вопрос" — спрашивает, только если переменная ещё не задана в окружении
ask() {
  local var="$1" prompt="$2"
  if [ -n "${!var:-}" ]; then echo "   ↳ $var задан из окружения"; return; fi
  read -r -p "$prompt" "$var" </dev/tty || true
  printf -v "$var" '%s' "${!var:-}"
}
section() { echo; echo "━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

### 1. Ввод переменных
section "1/4  Домен и SSL"
echo "DNS-запись A домена должна уже указывать на IP этого сервера — иначе Let's Encrypt не выдаст сертификат."
ask DOMAIN "🌐 Домен для n8n (например n8n.example.com): "
ask EMAIL  "📧 Email для SSL-сертификата Let's Encrypt: "

section "2/4  Секреты n8n"
ask POSTGRES_PASSWORD  "🔐 Пароль Postgres (Enter — сгенерировать): "
ask N8N_ENCRYPTION_KEY "🗝️  Ключ шифрования n8n (Enter — сгенерировать; при переносе со старого сервера — вставьте старый): "

section "3/4  Telegram"
cat <<'TGHELP'
🤖 Админ-бот сервера (/status, /logs, /backups, /update, ночной бэкап):
   • токен — у @BotFather: /newbot → скопируйте строку вида 123456:ABC-DEF…
   • ваш ID — напишите @userinfobot, он ответит числом (только этот ID сможет управлять ботом)
TGHELP
ask TG_BOT_TOKEN "🤖 Telegram Bot Token: "
ask TG_USER_ID   "👤 Ваш Telegram User ID: "

cat <<'APIHELP'

📎 Локальный Telegram Bot API — зачем он нужен
   Обычный Bot API (api.telegram.org) даёт ботам скачать файл максимум 20 МБ
   и отправить — 50 МБ. Видео для монтажа больше. Свой сервер Bot API на этой
   машине снимает лимит до 2 ГБ в обе стороны. Для него Telegram требует ключи
   приложения (не бота!) — api_id и api_hash.

   Где взять (2 минуты, бесплатно):
     1. Откройте https://my.telegram.org и войдите по номеру телефона
        (код придёт в сам Telegram, не по SMS).
     2. Раздел «API development tools».
     3. Заполните форму: App title — любое (например n8n-files),
        Short name — латиницей 5–32 символа, Platform — Other. «Create application».
     4. Скопируйте App api_id (число) и App api_hash (32 символа).
   Ключи привязаны к вашему аккаунту — никому их не передавайте.
   Enter без ввода — пропустить (бот будет работать с лимитом 20 МБ; ключи можно
   добавить позже в .env и запустить bash install-extras.sh).
APIHELP
while :; do
  ask TELEGRAM_API_ID "🔑 App api_id: "
  [ -z "$TELEGRAM_API_ID" ] || [[ "$TELEGRAM_API_ID" =~ ^[0-9]+$ ]] && break
  echo "   ⚠️  api_id — это только цифры. Попробуйте ещё раз."; TELEGRAM_API_ID=""
done
if [ -n "$TELEGRAM_API_ID" ]; then
  while :; do
    ask TELEGRAM_API_HASH "🔑 App api_hash: "
    [[ "$TELEGRAM_API_HASH" =~ ^[0-9a-fA-F]{32}$ ]] && break
    echo "   ⚠️  api_hash — 32 символа 0-9/a-f. Попробуйте ещё раз."; TELEGRAM_API_HASH=""
  done
else
  TELEGRAM_API_HASH=""
  echo "   ↳ Локальный Bot API пропущен (лимит файлов 20 МБ)."
fi

section "4/4  Сеть"
echo "Нужен, если серверу закрыт доступ к OpenAI/Google и т.п. Внутренние сервисы ходят мимо прокси автоматически."
ask PROXY_URL "🌍 HTTP-прокси (http://user:pass@host:port, Enter — без прокси): "

[ -z "$DOMAIN" ] && { echo "❌ Домен обязателен"; exit 1; }
[ -z "$EMAIL" ] && { echo "❌ Email обязателен"; exit 1; }
if [ -z "$POSTGRES_PASSWORD" ]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  echo "✅ Сгенерирован пароль Postgres"
fi
if [ -z "$N8N_ENCRYPTION_KEY" ]; then
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
  echo "✅ Сгенерирован ключ шифрования: $N8N_ENCRYPTION_KEY"
fi

### 2. Установка Docker и Compose
echo "📦 Проверка Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi
for pkg in git jq curl openssl zip; do
  command -v "$pkg" &>/dev/null || { apt-get update -qq; apt-get install -y -qq "$pkg"; }
done
echo "✅ Docker: $(docker --version | cut -d, -f1), compose: $(docker compose version --short)"

### 3. Клонирование проекта с GitHub
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "📥 $INSTALL_DIR уже есть — обновляю из git ($REPO_BRANCH)..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout -q -B "$REPO_BRANCH" FETCH_HEAD
else
  echo "📥 Клонирую проект с GitHub ($REPO_BRANCH)..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

### 4. Генерация .env из шаблона (все секреты только здесь)
if [ -f .env ]; then
  cp .env ".env.bak.$(date +%s)"
  echo "ℹ️  .env уже существует — сохранил копию, значения перезаписываю введёнными."
fi
cp .env.template .env
set_env() { # set_env KEY VALUE — заменить или добавить строку KEY=VALUE в .env
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env DOMAIN "$DOMAIN"
set_env EMAIL "$EMAIL"
set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_env N8N_ENCRYPTION_KEY "$N8N_ENCRYPTION_KEY"
set_env WEBHOOK_URL "https://${DOMAIN}/"
set_env TG_BOT_TOKEN "$TG_BOT_TOKEN"
set_env TG_USER_ID "$TG_USER_ID"
set_env PROXY_URL "$PROXY_URL"
set_env TELEGRAM_API_ID "$TELEGRAM_API_ID"
set_env TELEGRAM_API_HASH "$TELEGRAM_API_HASH"
set_env DOCKER_GID "$(getent group docker | cut -d: -f3 || echo 999)"

cat > "bot/.env" <<EOF
TG_BOT_TOKEN=$TG_BOT_TOKEN
TG_USER_ID=$TG_USER_ID
EOF
chmod 600 .env bot/.env

### 5. Директории, права, шимы
mkdir -p logs backups letsencrypt traefik_dynamic docker-plugins \
  data/reels data/carousel/jobs data/files data/studio-engine/public/fonts data/studio-engine/public/assets
touch logs/backup.log
chown -R 1000:1000 logs backups
chmod -R 755 logs backups
chmod +x shims/* backup_n8n.sh update_n8n.sh install-extras.sh scripts/*.sh
# docker-compose как cli-plugin для контейнера n8n-bot (он запускает update_n8n.sh у себя)
if [ -f /usr/libexec/docker/cli-plugins/docker-compose ]; then
  cp -f /usr/libexec/docker/cli-plugins/docker-compose docker-plugins/docker-compose
fi

### 6. Движки: секреты sandbox/searxng, NO_PROXY, шрифты каруселей (идемпотентно)
bash ./install-extras.sh --prepare-only

### 7. Сборка образов и запуск всего стека (docker-compose.yml + docker-compose.override.yml)
echo "🏗  Собираю образы (n8n, n8n-worker, n8n-tools, n8n-bot, n8n-media-render)... это занимает 5-15 минут"
docker compose build
echo "🚀 Запускаю контейнеры..."
docker compose up -d

### 8. Настройка cron
echo "🔧 Устанавливаем cron-задачу бэкапа на 02:00 каждый день"
(crontab -l 2>/dev/null | grep -v backup_n8n.sh; echo "0 2 * * * /bin/bash $INSTALL_DIR/backup_n8n.sh >> $INSTALL_DIR/logs/backup.log 2>&1") | crontab -

### 9. Проверки
echo "⏳ Жду запуска n8n (до 90 секунд)..."
for i in $(seq 1 18); do
  if docker exec n8n-app wget -qO- http://localhost:5678/healthz 2>/dev/null | grep -q ok; then break; fi
  sleep 5
done
bash ./install-extras.sh --check || true

### 10. Уведомление в Telegram
if [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_USER_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \
    -d chat_id="$TG_USER_ID" \
    --data-urlencode text="✅ Установка n8n завершена. Домен: https://$DOMAIN" >/dev/null || true
fi

### 11. Финальный вывод
echo ""
echo "📦 Активные контейнеры:"
docker ps --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "🎉 Готово! Открой: https://$DOMAIN"
echo "   Движок маскота: нужен проект studio-engine в $INSTALL_DIR/data/studio-engine (см. STACK.md, раздел studio-engine)."
echo "   Движок каруселей: /opt/shims/render-html — готов (см. ENGINES.md)."
