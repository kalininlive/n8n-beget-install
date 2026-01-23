#!/bin/bash
set -e

### Проверка root
if [[ "$EUID" -ne 0 ]]; then
  echo "❌ Запусти от root: sudo bash install.sh"
  exit 1
fi

clear
echo "🚀 Установка n8n 2.5.0 (CLEAN INSTALL / REFERENCE MODE)"
echo "====================================================="

### 1. Ввод данных
read -p "🌐 Домен (например n8n.example.com): " DOMAIN
read -p "📧 Email для Let's Encrypt: " EMAIL
read -p "🔐 Пароль Postgres: " POSTGRES_PASSWORD
read -p "🤖 Telegram Bot Token: " TG_BOT_TOKEN
read -p "👤 Telegram User ID: " TG_USER_ID

read -p "🗝️  N8N Encryption Key (Enter = сгенерировать): " N8N_ENCRYPTION_KEY
if [[ -z "$N8N_ENCRYPTION_KEY" ]]; then
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
  echo "✅ Сгенерирован ключ шифрования"
fi

### 2. Docker + compose
echo "📦 Установка Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-plugin
fi

systemctl enable docker
systemctl start docker

### 3. Клонирование репозитория
INSTALL_DIR="/opt/n8n-install"
echo "📥 Клонируем репозиторий"
rm -rf "$INSTALL_DIR"
git clone https://github.com/kalininlive/n8n-beget-install.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

### 4. Директории
echo "📂 Создаём директории"
mkdir -p data backups logs letsencrypt traefik_dynamic
chmod -R 755 data backups logs letsencrypt traefik_dynamic

### 5. ACME reset (КРИТИЧНО)
echo "🔐 Готовим Let's Encrypt"
rm -f letsencrypt/acme.json
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json

### 6. .env
echo "🧾 Генерируем .env"
cat > .env <<EOF
DOMAIN=$DOMAIN
EMAIL=$EMAIL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
N8N_ENCRYPTION_KEY=$N8N_ENCRYPTION_KEY

N8N_PROXY_HOPS=1

EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=n8n-redis
QUEUE_BULL_REDIS_PORT=6379

N8N_BINARY_DATA_MODE=filesystem
N8N_DEFAULT_BINARY_DATA_MODE=filesystem
EOF

chmod 600 .env

### 7. bot/.env
echo "🤖 Настраиваем Telegram-бота"
cat > bot/.env <<EOF
TG_BOT_TOKEN=$TG_BOT_TOKEN
TG_USER_ID=$TG_USER_ID
EOF
chmod 600 bot/.env

### 8. Подстановка DOMAIN / EMAIL в docker-compose.yml
echo "🔧 Подставляем DOMAIN и EMAIL в docker-compose.yml"
sed -i "s|{{DOMAIN}}|$DOMAIN|g" docker-compose.yml
sed -i "s|{{EMAIL}}|$EMAIL|g" docker-compose.yml

### 9. Права (v2 FIX)
echo "🔧 Исправляем права (1000:1000)"
chown -R 1000:1000 data backups logs letsencrypt || true

### 10. Запуск
echo "🚀 Сборка и запуск контейнеров (5–10 минут)"
docker compose build
docker compose up -d

### 11. Проверка
echo "⏳ Ожидание старта (30 сек)..."
sleep 30

echo "📦 Запущенные контейнеры:"
docker ps

### 12. Финал
echo "====================================================="
echo "✅ УСТАНОВКА ЗАВЕРШЕНА"
echo "🌐 n8n: https://$DOMAIN"
echo "🤖 Telegram-бот подключён"
echo "====================================================="
