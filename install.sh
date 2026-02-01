#!/bin/bash
set -e

INSTALL_DIR="/opt/n8n-install"

### Проверка прав
if (( EUID != 0 )); then
  echo "❗ Скрипт должен быть запущен от root"
  exit 1
fi

clear
echo "🌐 Автоматическая установка n8n v2+"
echo "----------------------------------------"

### 1. Ввод переменных (КАНОН, НЕ МЕНЯЕМ)
read -p "🌐 Введите домен для n8n (например: n8n.example.com): " DOMAIN
read -p "📧 Введите email для SSL-сертификата Let's Encrypt: " EMAIL
read -p "🤖 Введите Telegram Bot Token: " TG_BOT_TOKEN
read -p "👤 Введите Telegram User ID (для уведомлений): " TG_USER_ID
read -s -p "🔐 Введите пароль для базы данных Postgres: " POSTGRES_PASSWORD
echo
read -p "🗝️  Введите ключ шифрования для n8n (Enter для генерации): " N8N_ENCRYPTION_KEY

if [ -z "$N8N_ENCRYPTION_KEY" ]; then
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
  echo "✅ Сгенерирован ключ шифрования:"
  echo "$N8N_ENCRYPTION_KEY"
  echo "⬆️ СОХРАНИТЕ ЕГО. БЕЗ НЕГО ДАННЫЕ НЕ ВОССТАНОВИТЬ."
fi

### Proxy (опционально)
echo
read -p "🌍 Использовать proxy? (y/N): " USE_PROXY

HTTP_PROXY=""
HTTPS_PROXY=""
NO_PROXY="localhost,127.0.0.1,::1,postgres,redis,traefik,n8n-app,n8n-worker"

if [[ "$USE_PROXY" =~ ^[Yy]$ ]]; then
  read -p "HTTP_PROXY: " HTTP_PROXY
  read -p "HTTPS_PROXY: " HTTPS_PROXY
fi

### 2. Docker
echo "📦 Проверка Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

### 3. Клонирование проекта
if [[ -d "$INSTALL_DIR" ]]; then
  echo "❌ $INSTALL_DIR уже существует. Удалите вручную или выполните update."
  exit 1
fi

echo "📥 Клонируем проект с GitHub..."
git clone https://github.com/kalininlive/n8n-beget-install.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

### 4. Генерация .env (n8n v2+)
cat > ".env" <<EOF
# === Domain / SSL ===
DOMAIN=${DOMAIN}
EMAIL=${EMAIL}

# === Database ===
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# === n8n core ===
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
NODES_EXCLUDE=[]
N8N_RESTRICT_FILE_ACCESS_TO=/data

# === n8n v2 security defaults ===
N8N_RUNNERS_ENABLED=true
N8N_BLOCK_ENV_ACCESS_IN_NODE=true
N8N_SKIP_AUTH_ON_OAUTH_CALLBACK=false
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true

# === Telegram ===
TG_BOT_TOKEN=${TG_BOT_TOKEN}
TG_USER_ID=${TG_USER_ID}

# === Proxy ===
HTTP_PROXY=${HTTP_PROXY}
HTTPS_PROXY=${HTTPS_PROXY}
NO_PROXY=${NO_PROXY}
EOF

chmod 600 .env

### 5. Директории
mkdir -p data logs backups letsencrypt shims traefik_dynamic
touch logs/backup.log
chmod 600 letsencrypt || true

### 6. shims (как у тебя)
cat > shims/ffmpeg <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/ffmpeg "$@"
EOF

cat > shims/yt-dlp <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/yt-dlp "$@"
EOF

cat > shims/python <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/python3 "$@"
EOF

cat > shims/python3 <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/python3 "$@"
EOF

chmod +x shims/*

### 7. Запуск
echo "🚀 Запуск docker compose..."
docker compose up -d --build

### 8. Telegram notify
curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TG_USER_ID}" \
  -d text="✅ Установка n8n v2+ завершена. Домен: https://${DOMAIN}"

### 9. Итог
echo
docker ps --format "table {{.Names}}\t{{.Status}}"
echo
echo "🎉 Готово! Открой: https://${DOMAIN}"
