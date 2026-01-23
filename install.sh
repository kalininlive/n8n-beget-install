#!/bin/bash
set -e

# ==========================================================
# CLEAN INSTALL SCRIPT FOR n8n 2.x (QUEUE MODE, RUNNERS)
# ==========================================================

if (( EUID != 0 )); then
  echo "❗ Запусти скрипт от root"
  exit 1
fi

clear
echo "🌐 Чистая установка n8n (2.x, queue mode)"
echo "----------------------------------------"

# ===== INPUT =====
read -p "🌐 Домен для n8n (например n8n.example.com): " DOMAIN
read -p "📧 Email для Let's Encrypt: " EMAIL
read -p "🔐 Пароль Postgres: " POSTGRES_PASSWORD
read -p "🤖 Telegram Bot Token: " TG_BOT_TOKEN
read -p "👤 Telegram User ID: " TG_USER_ID
read -p "🗝️  Ключ шифрования n8n (Enter — сгенерировать): " N8N_ENCRYPTION_KEY

if [ -z "$N8N_ENCRYPTION_KEY" ]; then
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
  echo "✅ Сгенерирован ключ: $N8N_ENCRYPTION_KEY"
fi

# ===== DOCKER =====
echo "📦 Установка Docker + docker compose plugin"

apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release

if ! command -v docker &>/dev/null; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /usr/share/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

docker --version
docker compose version

# ===== CLONE =====
echo "📥 Клонируем репозиторий"
rm -rf /opt/n8n-install
git clone https://github.com/kalininlive/n8n-beget-install.git /opt/n8n-install
cd /opt/n8n-install

# ===== DIRECTORIES =====
echo "📂 Создаём директории"
mkdir -p data logs backups shims letsencrypt traefik_dynamic
touch logs/backup.log
chmod 600 logs/backup.log
chown -R 1000:1000 logs backups

# ===== ENV =====
echo "🧾 Генерируем .env"

cat > .env <<EOF
DOMAIN=${DOMAIN}
EMAIL=${EMAIL}

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}

# Proxy / trust
N8N_EXPRESS_TRUST_PROXY=true
N8N_TRUSTED_PROXIES=*
N8N_PROXY_HOPS=1

# Queue mode
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=n8n-redis
QUEUE_BULL_REDIS_PORT=6379

# Binary data
N8N_BINARY_DATA_MODE=filesystem
N8N_DEFAULT_BINARY_DATA_MODE=filesystem

# Telegram
TG_BOT_TOKEN=${TG_BOT_TOKEN}
TG_USER_ID=${TG_USER_ID}
EOF

chmod 600 .env

cat > bot/.env <<EOF
TG_BOT_TOKEN=${TG_BOT_TOKEN}
TG_USER_ID=${TG_USER_ID}
EOF

chmod 600 bot/.env

# ===== BUILD & RUN =====
echo "🚀 Сборка и запуск контейнеров"
docker compose build
docker compose up -d

# ===== CRON =====
echo "⏱️ Настройка ежедневных бэкапов (02:00)"
chmod +x backup_n8n.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /bin/bash /opt/n8n-install/backup_n8n.sh >> /opt/n8n-install/logs/backup.log 2>&1") | crontab -

# ===== TELEGRAM =====
curl -s -X POST https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage \
  -d chat_id=${TG_USER_ID} \
  -d text="✅ n8n установлен и запущен: https://${DOMAIN}"

# ===== DONE =====
echo
echo "🎉 Установка завершена"
echo "🌐 https://${DOMAIN}"
echo
docker ps --format "table {{.Names}}\t{{.Status}}"
