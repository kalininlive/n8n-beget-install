#!/bin/bash
# ============================================================
# n8n-beget-install — установка полного стека на чистый Ubuntu 22.04/24.04
#   n8n (queue mode) + Postgres + Redis + Traefik + Telegram-бот
#   + движки: n8n-media-render (маскот/Remotion + html-render карусели),
#     n8n-tools (ffmpeg/yt-dlp/python), edge-tts, SearXNG, n8n Sandbox
# Состав стека — STACK.md, движки — ENGINES.md.
# Запуск:  bash <(curl -s https://raw.githubusercontent.com/kalininlive/n8n-beget-install/main/install.sh)
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kalininlive/n8n-beget-install.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
INSTALL_DIR="/opt/n8n-install"

### Проверка прав
if (( EUID != 0 )); then
  echo "❗ Скрипт должен быть запущен от root: sudo bash install.sh"
  exit 1
fi

clear
echo "🌐 Автоматическая установка n8n + движков рендера"
echo "------------------------------------------------"

### 1. Ввод переменных
read -p "🌐 Введите домен для n8n (например: n8n.example.com): " DOMAIN
read -p "📧 Введите email для SSL-сертификата Let's Encrypt: " EMAIL
read -p "🔐 Введите пароль для базы данных Postgres (Enter для генерации): " POSTGRES_PASSWORD
read -p "🤖 Введите Telegram Bot Token: " TG_BOT_TOKEN
read -p "👤 Введите Telegram User ID (для уведомлений): " TG_USER_ID
read -p "🗝️  Введите ключ шифрования для n8n (Enter для генерации): " N8N_ENCRYPTION_KEY
read -p "🌍 Внешний HTTP-прокси для n8n (например http://user:pass@host:port, Enter — без прокси): " PROXY_URL

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
