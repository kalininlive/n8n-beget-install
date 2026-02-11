#!/bin/bash
# ============================================================
# n8n Universal Auto-Install Script v4.0
# Чистая установка на Ubuntu 22.04 / 24.04
# ============================================================
# Компоненты: n8n 2.x + PostgreSQL 16 + Redis 7 + Traefik v3
#             + Telegram Bot
#             + FFmpeg + Python3 + Chromium + Tesseract OCR
#             + 30+ npm-библиотек для AI/ML/автоматизации
# ============================================================

set -euo pipefail

# ─── Цвета ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $(date '+%H:%M:%S') $1"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $(date '+%H:%M:%S') $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $(date '+%H:%M:%S') $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $1"; }
log_step()    { echo -e "\n${CYAN}${BOLD}═══ $1 ═══${NC}\n"; }

# ─── Ловушка ошибок ──────────────────────────────────────────
trap 'log_error "Скрипт прервался на строке $LINENO. Последняя команда: $BASH_COMMAND"' ERR

# ─── Директория установки ────────────────────────────────────
INSTALL_DIR="/opt/websansay/n8n"

# ============================================================
# PREFLIGHT CHECKS
# ============================================================
log_step "Предварительные проверки"

# Root
if [[ $EUID -ne 0 ]]; then
    log_error "Запустите от root: sudo bash install.sh"
    exit 1
fi

# ОС
if ! grep -qE "Ubuntu (22|24)" /etc/os-release 2>/dev/null; then
    log_warn "Рекомендуется Ubuntu 22.04 или 24.04. Текущая ОС может не поддерживаться."
    read -p "Продолжить? (y/n): " -r
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
fi

# Свободное место
DISK_FREE=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')
if (( DISK_FREE < 10 )); then
    log_error "Недостаточно места на диске: ${DISK_FREE}G свободно (нужно минимум 10G)"
    exit 1
fi

log_ok "ОС: $(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)"
log_ok "Свободно на диске: ${DISK_FREE}G"

# ============================================================
# БАННЕР
# ============================================================
clear
echo ""
echo -e "${CYAN}"
cat << 'BANNER'
    ███╗   ██╗ █████╗ ███╗   ██╗
    ████╗  ██║██╔══██╗████╗  ██║
    ██╔██╗ ██║╚█████╔╝██╔██╗ ██║
    ██║╚██╗██║██╔══██╗██║╚██╗██║
    ██║ ╚████║╚█████╔╝██║ ╚████║
    ╚═╝  ╚═══╝ ╚════╝ ╚═╝  ╚═══╝
BANNER
echo -e "${NC}"
echo -e "${BOLD}    Universal Auto-Install v4.0${NC}"
echo -e "    n8n 2.x + PostgreSQL + Redis + Traefik SSL + Telegram Bot"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# ВВОД ДАННЫХ
# ============================================================
log_step "Настройка параметров"

# --- 1. Домен n8n ---
read -p "Домен для n8n (например n8n.example.com): " DOMAIN
while [[ -z "$DOMAIN" ]]; do
    log_error "Домен не может быть пустым"
    read -p "Домен для n8n: " DOMAIN
done

# --- 2. Email ---
read -p "Email для SSL сертификата: " EMAIL
while ! echo "$EMAIL" | grep -qE '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'; do
    log_error "Некорректный email"
    read -p "Email: " EMAIL
done

# --- 3. Telegram Bot Token ---
echo ""
read -p "Telegram Bot Token (от @BotFather, Enter для пропуска): " TG_BOT_TOKEN
TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"

# --- 4. Telegram User ID ---
read -p "Telegram User ID (от @userinfobot, Enter для пропуска): " TG_USER_ID
TG_USER_ID="${TG_USER_ID:-}"

if [[ -z "$TG_BOT_TOKEN" ]] || [[ -z "$TG_USER_ID" ]]; then
    log_warn "Telegram бот не настроен (можно добавить позже в .env)"
fi

# ============================================================
# АВТОГЕНЕРАЦИЯ ВСЕХ ПАРАМЕТРОВ
# ============================================================
log_step "Генерация конфигурации"

# Все пароли и ключи
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
ENCRYPTION_KEY=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
log_ok "Пароли и ключ шифрования сгенерированы"

# Таймзона и прокси — дефолты
TIMEZONE="Europe/Moscow"
PROXY_URL=""

# ============================================================
# ПОДТВЕРЖДЕНИЕ
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}Параметры установки:${NC}"
echo ""
echo -e "  n8n:             ${CYAN}https://${DOMAIN}${NC}"
echo -e "  Email:           ${EMAIL}"
echo -e "  Таймзона:        ${TIMEZONE}"
echo -e "  Telegram бот:    $([ -n "$TG_BOT_TOKEN" ] && echo "✅" || echo "❌ пропущен")"
echo -e "  Директория:      ${INSTALL_DIR}"
echo ""
echo -e "  ${YELLOW}⚠ DNS A-запись домена должна указывать на этот сервер${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "Начать установку? (y/n): " -r
[[ ! $REPLY =~ ^[Yy]$ ]] && { echo "Отменено."; exit 0; }

# ============================================================
# 1. ОБНОВЛЕНИЕ СИСТЕМЫ
# ============================================================
log_step "1/11 · Обновление системы"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    apt-transport-https ca-certificates curl gnupg lsb-release \
    git jq openssl cron software-properties-common

log_ok "Система обновлена"

# ============================================================
# 2. SWAP (если нет)
# ============================================================
log_step "2/11 · Настройка SWAP"

TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')

if swapon --show | grep -q '/'; then
    SWAP_SIZE=$(free -m | awk '/^Swap:/{print $2}')
    log_ok "SWAP уже настроен: ${SWAP_SIZE}MB"
else
    if (( TOTAL_RAM < 4096 )); then
        SWAP_GB=4
    else
        SWAP_GB=2
    fi
    log_info "Создание SWAP ${SWAP_GB}GB (RAM: ${TOTAL_RAM}MB)..."

    fallocate -l ${SWAP_GB}G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile

    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi

    sysctl -w vm.swappiness=10 > /dev/null
    grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

    log_ok "SWAP ${SWAP_GB}GB создан"
fi

# ============================================================
# 3. УСТАНОВКА DOCKER
# ============================================================
log_step "3/11 · Установка Docker Engine"

if command -v docker &>/dev/null && docker --version &>/dev/null; then
    log_ok "Docker уже установлен: $(docker --version)"
else
    # Удаление старых версий
    for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
        apt-get remove -y -qq "$pkg" 2>/dev/null || true
    done

    # Добавление репозитория Docker
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start docker

    # Ждём запуска
    for i in {1..10}; do
        systemctl is-active --quiet docker && break
        sleep 1
    done

    log_ok "Docker установлен: $(docker --version)"
fi

# Проверка Docker Compose
if ! docker compose version &>/dev/null; then
    log_error "Docker Compose plugin не установлен"
    exit 1
fi
log_ok "Docker Compose: $(docker compose version --short)"

# ============================================================
# 4. СТРУКТУРА ДИРЕКТОРИЙ
# ============================================================
log_step "4/11 · Создание структуры проекта"

mkdir -p "$INSTALL_DIR"/{bot,logs,backups,shims,n8n-files,data}

# Права для n8n (UID 1000 = пользователь node в контейнере)
chown -R 1000:1000 "$INSTALL_DIR/n8n-files"
chown -R 1000:1000 "$INSTALL_DIR/data"
chmod -R u+rwX,g+rwX "$INSTALL_DIR/n8n-files"
chmod -R u+rwX,g+rwX "$INSTALL_DIR/data"

log_ok "Структура создана: $INSTALL_DIR"

# ============================================================
# 5. .ENV ФАЙЛ
# ============================================================
log_step "5/11 · Создание конфигурации .env"

cat > "$INSTALL_DIR/.env" << ENVEOF
# ============================================================
# n8n v4 — Полная конфигурация
# Создано: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# ─── ДОМЕН ───────────────────────────────────────────────────
DOMAIN=${DOMAIN}

# ─── SSL ─────────────────────────────────────────────────────
EMAIL=${EMAIL}

# ─── POSTGRESQL ──────────────────────────────────────────────
POSTGRES_USER=n8n
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=n8n

# ─── REDIS ───────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}

# ─── N8N CORE ───────────────────────────────────────────────
N8N_ENCRYPTION_KEY=${ENCRYPTION_KEY}
WEBHOOK_URL=https://${DOMAIN}/

# Binary data на файловой системе (производительнее чем в БД)
N8N_BINARY_DATA_MODE=filesystem
N8N_DEFAULT_BINARY_DATA_MODE=filesystem

# Proxy settings для Traefik
N8N_EXPRESS_TRUST_PROXY=true
N8N_TRUSTED_PROXIES=*
N8N_PROXY_HOPS=1

# ─── N8N 2.x SECURITY ──────────────────────────────────────
# Execute Command и Local File Trigger разрешены
NODES_EXCLUDE=[]
# Whitelist путей для Read/Write Binary Files
N8N_RESTRICT_FILE_ACCESS_TO=/home/node/.n8n-files;/data
# Task runners (false = быстрее, true = безопаснее)
N8N_RUNNERS_ENABLED=false

# ─── N8N LIMITS ─────────────────────────────────────────────
N8N_PAYLOAD_SIZE_MAX=512
N8N_FORMDATA_FILE_SIZE_MAX=2048
N8N_RUNNERS_TASK_TIMEOUT=1800
EXECUTIONS_TIMEOUT=-1
EXECUTIONS_TIMEOUT_MAX=14400

# Community packages
N8N_COMMUNITY_PACKAGES_ENABLED=true

# ─── ВНЕШНИЙ ПРОКСИ ────────────────────────────────────────
PROXY_URL=${PROXY_URL}
NO_PROXY=localhost,127.0.0.1,::1,.local,postgres,redis,traefik,n8n,n8n-postgres,n8n-redis,n8n-traefik

# ─── TELEGRAM BOT ──────────────────────────────────────────
TG_BOT_TOKEN=${TG_BOT_TOKEN}
TG_USER_ID=${TG_USER_ID}

# ─── БЭКАПЫ ────────────────────────────────────────────────
BACKUP_RETENTION_DAYS=7

# ─── TIMEZONE ──────────────────────────────────────────────
GENERIC_TIMEZONE=${TIMEZONE}
TZ=${TIMEZONE}

# ─── N8N MISC ──────────────────────────────────────────────
N8N_METRICS=true
N8N_LOG_LEVEL=info
N8N_DIAGNOSTICS_ENABLED=false
N8N_PERSONALIZATION_ENABLED=false

# ─── QUEUE MODE ────────────────────────────────────────────
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=n8n-redis
QUEUE_BULL_REDIS_PORT=6379
ENVEOF

chmod 600 "$INSTALL_DIR/.env"
log_ok ".env создан"

# ============================================================
# 6. DOCKERFILE.N8N
# ============================================================
log_step "6/11 · Создание Dockerfile.n8n"

# Определяем Docker GID хоста
DOCKER_GID=$(getent group docker | cut -d: -f3 || echo "999")

cat > "$INSTALL_DIR/Dockerfile.n8n" << 'DEOF'
# ============================================================
# n8n Custom Build — Multi-Stage (Hardened Image)
# Stage 1: Alpine builder — устанавливаем все пакеты
# Stage 2: Hardened n8n — копируем через tar
# ============================================================

# ─── STAGE 1: Builder ──────────────────────────────────────
FROM alpine:3.22 AS builder

RUN apk add --no-cache \
    bash curl wget git make g++ gcc \
    python3 py3-pip libffi-dev \
    ffmpeg \
    chromium chromium-chromedriver \
    font-noto font-noto-cjk font-noto-emoji \
    imagemagick ghostscript graphicsmagick \
    poppler-utils \
    tesseract-ocr tesseract-ocr-data-rus tesseract-ocr-data-eng \
    jq apache2-utils \
    fontconfig ttf-freefont \
    docker-cli

# Пакуем все инструменты в tar (follow symlinks с -h)
RUN mkdir -p /export && tar chf /export/tools.tar \
    /usr/bin/ffmpeg /usr/bin/ffprobe \
    /usr/bin/python3 /usr/bin/python3.12 \
    /usr/bin/chromium-browser /usr/lib/chromium/ \
    /usr/bin/chromedriver \
    /usr/bin/convert /usr/bin/magick /usr/bin/identify \
    /usr/bin/gs /usr/bin/gm \
    /usr/bin/pdftotext /usr/bin/pdftoppm \
    /usr/bin/tesseract \
    /usr/bin/jq /usr/bin/htpasswd \
    /usr/bin/docker \
    /usr/bin/git \
    /usr/lib/lib*.so* \
    /usr/lib/python3.12/ \
    /usr/lib/tesseract-ocr/ \
    /usr/share/tessdata/ \
    /usr/share/fonts/ \
    /usr/lib/ImageMagick*/ \
    /usr/lib/graphicsmagick*/ \
    /etc/ImageMagick*/ \
    /etc/fonts/ \
    /lib/lib*.so* \
    2>/dev/null ; true

# ─── STAGE 2: Hardened n8n ─────────────────────────────────
FROM docker.n8n.io/n8nio/n8n:latest

USER root

# Распаковываем инструменты
COPY --from=builder /export/tools.tar /tmp/tools.tar
RUN tar xf /tmp/tools.tar -C / 2>/dev/null ; rm -f /tmp/tools.tar ; true

# ─── Docker группа ──────────────────────────────────────────
ARG DOCKER_GID=999
RUN set -eux; \
    addgroup -S -g ${DOCKER_GID} docker 2>/dev/null || true; \
    adduser node docker 2>/dev/null || true

# ─── npm config ─────────────────────────────────────────────
RUN npm config set fund false && npm config set audit false

# ─── npm глобальные пакеты ──────────────────────────────────
RUN for pkg in \
    axios node-fetch form-data \
    moment date-fns lodash \
    fs-extra csv-parser xml2js js-yaml xlsx \
    jsonwebtoken simple-oauth2 uuid \
    openai langchain \
    node-telegram-bot-api discord.js vk-io \
    fluent-ffmpeg \
    google-tts-api \
    mongoose ioredis \
    bcrypt validator joi \
    winston dotenv prom-client \
    node-downloader-helper adm-zip archiver \
    puppeteer-core \
  ; do \
    echo "📦 $pkg..." && npm install -g "$pkg" 2>/dev/null || echo "⚠️  skip $pkg"; \
  done

# ─── Локальные пакеты для Code-нод ─────────────────────────
RUN cd /tmp && npm install oauth-1.0a && \
    cp -r node_modules/oauth-1.0a /usr/local/lib/node_modules/ && \
    rm -rf /tmp/node_modules /tmp/package*.json

# ─── Puppeteer / Chromium ───────────────────────────────────
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/bin/chromium-browser \
    N8N_USER_FOLDER=/home/node/.n8n

USER node
WORKDIR /home/node
DEOF

log_ok "Dockerfile.n8n создан"

# ============================================================
# 7. DOCKER-COMPOSE.YML
# ============================================================
log_step "7/11 · Создание docker-compose.yml"

cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSEOF'
# ============================================================
# n8n Full Stack — docker-compose.yml
# ============================================================

x-n8n-env: &n8n-env
  # Домен
  N8N_HOST: ${DOMAIN}
  N8N_PORT: 5678
  N8N_PROTOCOL: https
  WEBHOOK_URL: ${WEBHOOK_URL}
  # Шифрование
  N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
  # PostgreSQL
  DB_TYPE: postgresdb
  DB_POSTGRESDB_HOST: n8n-postgres
  DB_POSTGRESDB_PORT: 5432
  DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}
  DB_POSTGRESDB_USER: ${POSTGRES_USER}
  DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
  # Redis queue
  EXECUTIONS_MODE: ${EXECUTIONS_MODE}
  QUEUE_BULL_REDIS_HOST: ${QUEUE_BULL_REDIS_HOST}
  QUEUE_BULL_REDIS_PORT: ${QUEUE_BULL_REDIS_PORT}
  QUEUE_BULL_REDIS_PASSWORD: ${REDIS_PASSWORD}
  # Binary data
  N8N_BINARY_DATA_MODE: ${N8N_BINARY_DATA_MODE}
  N8N_DEFAULT_BINARY_DATA_MODE: ${N8N_DEFAULT_BINARY_DATA_MODE}
  # Proxy (Traefik)
  N8N_EXPRESS_TRUST_PROXY: ${N8N_EXPRESS_TRUST_PROXY}
  N8N_TRUSTED_PROXIES: ${N8N_TRUSTED_PROXIES}
  N8N_PROXY_HOPS: ${N8N_PROXY_HOPS}
  # Внешний прокси
  HTTP_PROXY: ${PROXY_URL:-}
  HTTPS_PROXY: ${PROXY_URL:-}
  NO_PROXY: ${NO_PROXY}
  # Timezone
  GENERIC_TIMEZONE: ${GENERIC_TIMEZONE}
  TZ: ${TZ}
  # Misc
  N8N_METRICS: ${N8N_METRICS}
  N8N_LOG_LEVEL: ${N8N_LOG_LEVEL}
  N8N_DIAGNOSTICS_ENABLED: ${N8N_DIAGNOSTICS_ENABLED}
  N8N_PERSONALIZATION_ENABLED: ${N8N_PERSONALIZATION_ENABLED}
  # n8n 2.x security
  NODES_EXCLUDE: ${NODES_EXCLUDE}
  N8N_RESTRICT_FILE_ACCESS_TO: ${N8N_RESTRICT_FILE_ACCESS_TO}
  N8N_RUNNERS_ENABLED: ${N8N_RUNNERS_ENABLED}
  # Limits
  N8N_PAYLOAD_SIZE_MAX: ${N8N_PAYLOAD_SIZE_MAX:-512}
  N8N_FORMDATA_FILE_SIZE_MAX: ${N8N_FORMDATA_FILE_SIZE_MAX:-2048}
  N8N_RUNNERS_TASK_TIMEOUT: ${N8N_RUNNERS_TASK_TIMEOUT:-1800}
  EXECUTIONS_TIMEOUT: ${EXECUTIONS_TIMEOUT:--1}
  EXECUTIONS_TIMEOUT_MAX: ${EXECUTIONS_TIMEOUT_MAX:-14400}
  N8N_COMMUNITY_PACKAGES_ENABLED: ${N8N_COMMUNITY_PACKAGES_ENABLED:-true}

x-n8n-volumes: &n8n-volumes
  - n8n_data:/home/node/.n8n
  - ./logs:/logs
  - ./n8n-files:/home/node/.n8n-files
  - ./data:/data

services:
  # ──────────────────────────────────────────────────────────
  # n8n — Главное приложение
  # ──────────────────────────────────────────────────────────
  n8n:
    build:
      context: .
      dockerfile: Dockerfile.n8n
      args:
        DOCKER_GID: ${DOCKER_GID:-999}
    container_name: n8n
    restart: unless-stopped
    environment:
      <<: *n8n-env
    volumes:
      - n8n_data:/home/node/.n8n
      - ./logs:/logs
      - ./n8n-files:/home/node/.n8n-files
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      n8n-postgres:
        condition: service_healthy
      n8n-redis:
        condition: service_healthy
    labels:
      - "traefik.enable=true"
      # HTTPS
      - "traefik.http.routers.n8n.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.n8n.entrypoints=websecure"
      - "traefik.http.routers.n8n.tls.certresolver=letsencrypt"
      - "traefik.http.services.n8n.loadbalancer.server.port=5678"
      # HTTP → HTTPS redirect
      - "traefik.http.routers.n8n-http.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.n8n-http.entrypoints=web"
      - "traefik.http.routers.n8n-http.middlewares=redirect-https"
      - "traefik.http.middlewares.redirect-https.redirectscheme.scheme=https"
    networks:
      - n8n-net
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5678/healthz"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 90s

  # ──────────────────────────────────────────────────────────
  # n8n-worker — Воркер для queue mode
  # ──────────────────────────────────────────────────────────
  n8n-worker:
    build:
      context: .
      dockerfile: Dockerfile.n8n
      args:
        DOCKER_GID: ${DOCKER_GID:-999}
    container_name: n8n-worker
    restart: unless-stopped
    command: worker
    environment:
      <<: *n8n-env
    volumes:
      - n8n_data:/home/node/.n8n
      - ./logs:/logs
      - ./n8n-files:/home/node/.n8n-files
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      n8n:
        condition: service_healthy
    networks:
      - n8n-net

  # ──────────────────────────────────────────────────────────
  # PostgreSQL 16
  # ──────────────────────────────────────────────────────────
  n8n-postgres:
    image: postgres:16-alpine
    container_name: n8n-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      TZ: ${TZ}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - n8n-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # ──────────────────────────────────────────────────────────
  # Redis 7
  # ──────────────────────────────────────────────────────────
  n8n-redis:
    image: redis:7-alpine
    container_name: n8n-redis
    restart: unless-stopped
    command: >
      redis-server
      --appendonly yes
      --requirepass ${REDIS_PASSWORD}
    environment:
      TZ: ${TZ}
    volumes:
      - redis_data:/data
    networks:
      - n8n-net
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  # ──────────────────────────────────────────────────────────
  # Traefik v3 — Reverse Proxy + SSL
  # ──────────────────────────────────────────────────────────
  n8n-traefik:
    image: traefik:v3.2
    container_name: n8n-traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--log.level=WARN"
    environment:
      TZ: ${TZ}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/letsencrypt
    networks:
      - n8n-net
    healthcheck:
      test: ["CMD", "traefik", "healthcheck"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ──────────────────────────────────────────────────────────
  # Telegram Bot
  # ──────────────────────────────────────────────────────────
  n8n-bot:
    build:
      context: ./bot
      dockerfile: Dockerfile
    container_name: n8n-bot
    restart: unless-stopped
    environment:
      TG_BOT_TOKEN: ${TG_BOT_TOKEN}
      TG_USER_ID: ${TG_USER_ID}
      N8N_DIR: /opt/websansay/n8n
      DOMAIN: ${DOMAIN}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      TZ: ${TZ}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/websansay/n8n:/opt/websansay/n8n:ro
      - ./logs:/logs
    networks:
      - n8n-net
    depends_on:
      n8n:
        condition: service_started

networks:
  n8n-net:
    driver: bridge

volumes:
  n8n_data:
  postgres_data:
  redis_data:
  traefik_certs:
COMPOSEOF

# Подставляем Docker GID
echo "DOCKER_GID=${DOCKER_GID}" >> "$INSTALL_DIR/.env"

log_ok "docker-compose.yml создан"

# ============================================================
# 8. TELEGRAM BOT
# ============================================================
log_step "8/11 · Создание Telegram бота"

# bot/Dockerfile
cat > "$INSTALL_DIR/bot/Dockerfile" << 'BDEOF'
FROM node:20-alpine
RUN apk add --no-cache docker-cli bash curl openssl
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY bot.js ./
CMD ["node", "bot.js"]
BDEOF

# bot/package.json
cat > "$INSTALL_DIR/bot/package.json" << 'BPEOF'
{
  "name": "n8n-telegram-bot",
  "version": "4.0.0",
  "main": "bot.js",
  "scripts": { "start": "node bot.js" },
  "dependencies": { "node-telegram-bot-api": "^0.66.0" }
}
BPEOF

# bot/bot.js
cat > "$INSTALL_DIR/bot/bot.js" << 'BJEOF'
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const AUTH_USER = process.env.TG_USER_ID;
const N8N_DIR = process.env.N8N_DIR || '/opt/websansay/n8n';

if (!BOT_TOKEN || !AUTH_USER) {
    console.log('TG_BOT_TOKEN or TG_USER_ID not set. Bot disabled.');
    process.exit(0);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const auth = (msg) => String(msg.from.id) === String(AUTH_USER);

const run = (cmd, timeout = 60000) => new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout || stderr || 'OK');
    });
});

// /start, /help
bot.onText(/\/(start|help)/, (msg) => {
    if (!auth(msg)) return;
    bot.sendMessage(msg.chat.id, `*n8n Bot v4.0*\n
/status — Статус сервера
/logs [N] — Логи n8n (по умолчанию 50 строк)
/update — Обновить n8n
/backup — Создать бэкап
/restart — Перезапустить n8n
/disk — Дисковое пространство
/urls — Адреса всех сервисов`, { parse_mode: 'Markdown' });
});

// /status
bot.onText(/\/status/, async (msg) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    try {
        const [uptime, containers, disk, mem, ver] = await Promise.all([
            run('uptime -p').catch(() => run('uptime')),
            run('docker ps --format "{{.Names}}: {{.Status}}"'),
            run("df -h / | tail -1 | awk '{print $5\" of \"$2}'"),
            run("free -h | grep Mem | awk '{print $3\"/\"$2}'"),
            run('docker exec n8n n8n --version 2>/dev/null').catch(() => 'N/A')
        ]);
        bot.sendMessage(cid, `📊 *Статус*\n\n⏱ ${uptime.trim()}\n💾 Диск: ${disk.trim()}\n🧠 RAM: ${mem.trim()}\n📦 n8n: v${ver.trim()}\n\n*Контейнеры:*\n\`\`\`\n${containers.trim()}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}`); }
});

// /logs
bot.onText(/\/logs(?:\s+(\d+))?/, async (msg, match) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    const lines = Math.min(parseInt(match[1]) || 50, 5000);
    try {
        const logs = await run(`docker logs n8n --tail ${lines} 2>&1`, 30000);
        if (!logs.trim()) { bot.sendMessage(cid, '📋 Логи пусты'); return; }
        if (logs.length > 3900) {
            const p = `/tmp/n8n_logs_${Date.now()}.txt`;
            fs.writeFileSync(p, logs);
            await bot.sendDocument(cid, p, { caption: `📋 ${lines} строк логов` });
            fs.unlinkSync(p);
        } else {
            bot.sendMessage(cid, `📋 *Логи:*\n\`\`\`\n${logs.substring(0, 3800)}\n\`\`\``, { parse_mode: 'Markdown' });
        }
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}`); }
});

// /restart
bot.onText(/\/restart/, async (msg) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    await bot.sendMessage(cid, '🔄 Перезапускаю n8n...');
    try {
        await run('docker restart n8n', 120000);
        await new Promise(r => setTimeout(r, 15000));
        const s = await run('docker ps --filter name=^n8n$ --format "{{.Status}}"');
        bot.sendMessage(cid, `✅ Перезапущен\n${s.trim()}`);
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}`); }
});

// /update
bot.onText(/\/update/, async (msg) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    try {
        await bot.sendMessage(cid, '🔍 Проверяю версии...');
        let cur = 'unknown', lat = 'unknown';
        try { cur = (await run('docker exec n8n n8n --version')).trim(); } catch {}
        try {
            const r = JSON.parse(await run('curl -s https://api.github.com/repos/n8n-io/n8n/releases/latest'));
            lat = (r.tag_name || '').replace('n8n@', '').replace('v', '') || 'unknown';
        } catch {}
        await bot.sendMessage(cid, `📦 Текущая: *${cur}*\n🆕 Последняя: *${lat}*`, { parse_mode: 'Markdown' });
        if (cur === lat && cur !== 'unknown') { bot.sendMessage(cid, '✅ Уже последняя версия!'); return; }

        await bot.sendMessage(cid, '💾 Бэкап...');
        await run(`${N8N_DIR}/backup_n8n.sh`, 300000).catch(() => {});

        await bot.sendMessage(cid, '⏹ Останавливаю...');
        await run(`docker compose -f ${N8N_DIR}/docker-compose.yml stop n8n n8n-worker`, 60000);

        await bot.sendMessage(cid, '🔨 Пересборка (5-10 мин)...');
        await run(`docker compose -f ${N8N_DIR}/docker-compose.yml build --pull n8n`, 900000);

        await bot.sendMessage(cid, '🚀 Запуск...');
        await run(`docker compose -f ${N8N_DIR}/docker-compose.yml up -d n8n n8n-worker`, 120000);
        await new Promise(r => setTimeout(r, 20000));

        let nv = 'unknown';
        try { nv = (await run('docker exec n8n n8n --version')).trim(); } catch {}
        await run('docker image prune -f', 60000).catch(() => {});
        const s = await run('docker ps --filter name=^n8n$ --format "{{.Status}}"').catch(() => '?');
        bot.sendMessage(cid, `✅ *Обновлено!*\n\n📦 Было: ${cur}\n🆕 Стало: ${nv}\n📊 ${s.trim()}`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}\n\nВручную: \`cd ${N8N_DIR} && ./update_n8n.sh\``, { parse_mode: 'Markdown' }); }
});

// /backup
bot.onText(/\/backup/, async (msg) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    await bot.sendMessage(cid, '💾 Создаю бэкап...');
    try {
        await run(`${N8N_DIR}/backup_n8n.sh`, 300000);
        const info = await run(`ls -lhrt ${N8N_DIR}/backups/n8n_backup_*.tar.gz* 2>/dev/null | tail -1`).catch(() => '');
        bot.sendMessage(cid, `✅ Бэкап создан!\n${info.trim()}`);
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}`); }
});

// /disk
bot.onText(/\/disk/, async (msg) => {
    if (!auth(msg)) return;
    const cid = msg.chat.id;
    try {
        const [d, dd] = await Promise.all([run('df -h /'), run('docker system df').catch(() => 'N/A')]);
        bot.sendMessage(cid, `💾 *Диск*\n\`\`\`\n${d.trim()}\n\`\`\`\n*Docker:*\n\`\`\`\n${dd.trim()}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(cid, `❌ ${e.message}`); }
});

// /urls
bot.onText(/\/urls/, (msg) => {
    if (!auth(msg)) return;
    const D = process.env.DOMAIN || '?';
    bot.sendMessage(msg.chat.id, `🌐 *n8n:* https://${D}`, { parse_mode: 'Markdown' });
});

bot.on('polling_error', (e) => console.error('Poll:', e.code || e.message));
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
console.log(`🤖 Bot started | Auth: ${AUTH_USER}`);
BJEOF

log_ok "Telegram бот создан"

# ============================================================
# 10. УТИЛИТЫ (backup, update, restore)
# ============================================================
log_step "9/11 · Создание утилит"

# ─── backup_n8n.sh ──────────────────────────────────────────
cat > "$INSTALL_DIR/backup_n8n.sh" << 'BKEOF'
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then set -a; source .env; set +a; fi

BACKUP_DIR="$SCRIPT_DIR/backups"
BACKUP_NAME="n8n_backup_$(date +%Y%m%d_%H%M%S)"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
RETENTION=${BACKUP_RETENTION_DAYS:-7}

mkdir -p "$BACKUP_PATH"

notify() {
    [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_USER_ID:-}" ] && \
    curl -sf -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TG_USER_ID}" -d "text=$1" -d "parse_mode=Markdown" >/dev/null 2>&1 || true
}

echo "[$(date)] Бэкап PostgreSQL..."
docker exec n8n-postgres pg_dump -U "${POSTGRES_USER:-n8n}" "${POSTGRES_DB:-n8n}" > "$BACKUP_PATH/database.sql"
[ ! -s "$BACKUP_PATH/database.sql" ] && { echo "ERROR: пустой дамп"; rm -rf "$BACKUP_PATH"; exit 1; }

echo "[$(date)] Бэкап конфигурации..."
docker cp n8n:/home/node/.n8n "$BACKUP_PATH/n8n_data" 2>/dev/null || true

echo "[$(date)] Копирование .env и docker-compose.yml..."
cp -f .env "$BACKUP_PATH/.env" 2>/dev/null || true
cp -f docker-compose.yml "$BACKUP_PATH/docker-compose.yml" 2>/dev/null || true

# Версии
{ echo "Date: $(date)"; docker exec n8n n8n --version 2>/dev/null || echo "n8n: N/A"; docker --version; } > "$BACKUP_PATH/versions.txt"

echo "[$(date)] Архивирование..."
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"

if [ -n "${N8N_ENCRYPTION_KEY:-}" ] && command -v openssl &>/dev/null; then
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
        -in "${BACKUP_NAME}.tar.gz" -out "${BACKUP_NAME}.tar.gz.enc" \
        -pass pass:"$N8N_ENCRYPTION_KEY"
    rm "${BACKUP_NAME}.tar.gz"
    FINAL="${BACKUP_NAME}.tar.gz.enc"
else
    FINAL="${BACKUP_NAME}.tar.gz"
fi

rm -rf "$BACKUP_NAME"
find "$BACKUP_DIR" -name "n8n_backup_*.tar.gz*" -mtime +$RETENTION -delete 2>/dev/null || true

SIZE=$(du -h "$FINAL" | cut -f1)
COUNT=$(find "$BACKUP_DIR" -name "n8n_backup_*.tar.gz*" 2>/dev/null | wc -l)
echo "[$(date)] ✅ Бэкап: $FINAL ($SIZE) | Всего: $COUNT"
notify "✅ Бэкап: \`$FINAL\` ($SIZE)"
echo "$BACKUP_DIR/$FINAL"
BKEOF
chmod +x "$INSTALL_DIR/backup_n8n.sh"

# ─── update_n8n.sh ──────────────────────────────────────────
cat > "$INSTALL_DIR/update_n8n.sh" << 'UPEOF'
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then set -a; source .env; set +a; fi
LOG="$SCRIPT_DIR/logs/update_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$SCRIPT_DIR/logs"
exec > >(tee -a "$LOG") 2>&1

notify() {
    [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_USER_ID:-}" ] && \
    curl -sf -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TG_USER_ID}" -d "text=$1" -d "parse_mode=Markdown" >/dev/null 2>&1 || true
}

CUR=$(docker exec n8n n8n --version 2>/dev/null || echo "unknown")
LAT=$(curl -sf https://api.github.com/repos/n8n-io/n8n/releases/latest | grep '"tag_name"' | sed -E 's/.*"n8n@([^"]+)".*/\1/' || echo "unknown")

echo "Текущая: $CUR | Последняя: $LAT"

if [ "$CUR" = "$LAT" ] && [ "$CUR" != "unknown" ]; then
    echo "✅ Уже последняя версия"; notify "✅ n8n $CUR — последняя версия"; exit 0
fi

notify "🔄 Обновление n8n: $CUR → $LAT"

echo "Бэкап..."
[ -f ./backup_n8n.sh ] && ./backup_n8n.sh || echo "⚠️  Бэкап не создан"

echo "Остановка..."
docker compose stop n8n n8n-worker

echo "Пересборка..."
docker compose build --pull --no-cache n8n

echo "Запуск..."
docker compose up -d n8n n8n-worker

echo "Ожидание (60s max)..."
for i in {1..30}; do
    sleep 2
    docker exec n8n wget --spider -q http://localhost:5678/healthz 2>/dev/null && break
done

NEW=$(docker exec n8n n8n --version 2>/dev/null || echo "unknown")
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true

STATUS=$(docker ps --filter name=^n8n$ --format "{{.Status}}" 2>/dev/null)

if echo "$STATUS" | grep -q "Up"; then
    echo "✅ Обновлено: $CUR → $NEW"
    notify "✅ n8n обновлён: $CUR → $NEW"
else
    echo "❌ Контейнер не запустился"
    notify "❌ Ошибка обновления. Проверьте: docker logs n8n"
    exit 1
fi
UPEOF
chmod +x "$INSTALL_DIR/update_n8n.sh"

# ─── restore_n8n.sh ─────────────────────────────────────────
cat > "$INSTALL_DIR/restore_n8n.sh" << 'RSEOF'
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then set -a; source .env; set +a; fi

if [ -z "$1" ]; then
    echo "Использование: $0 <путь_к_бэкапу>"
    echo ""; echo "Доступные бэкапы:"
    ls -lhrt "$SCRIPT_DIR/backups/n8n_backup_"* 2>/dev/null || echo "  Нет бэкапов"
    exit 1
fi

BACKUP_FILE="$1"
[ ! -f "$BACKUP_FILE" ] && { echo "❌ Файл не найден: $BACKUP_FILE"; exit 1; }

echo "⚠️  ВСЕ текущие данные будут ЗАМЕНЕНЫ!"
read -p "Продолжить? (yes/no): " CONFIRM
[ "$CONFIRM" != "yes" ] && { echo "Отменено."; exit 0; }

# Бэкап текущего состояния
echo "💾 Бэкап текущего состояния..."
./backup_n8n.sh 2>/dev/null || true

echo "⏹  Остановка контейнеров..."
docker compose down

TMPDIR=$(mktemp -d)
cd "$TMPDIR"

# Расшифровка
if [[ "$BACKUP_FILE" == *.enc ]]; then
    [ -z "${N8N_ENCRYPTION_KEY:-}" ] && { echo "❌ N8N_ENCRYPTION_KEY не задан"; rm -rf "$TMPDIR"; exit 1; }
    openssl enc -aes-256-cbc -d -salt -pbkdf2 -iter 100000 \
        -in "$BACKUP_FILE" -out backup.tar.gz -pass pass:"$N8N_ENCRYPTION_KEY"
    tar -xzf backup.tar.gz
else
    tar -xzf "$BACKUP_FILE"
fi

DATA_DIR=$(find . -maxdepth 1 -type d -name "n8n_backup_*" | head -1)
[ -z "$DATA_DIR" ] && { echo "❌ Данные не найдены в архиве"; rm -rf "$TMPDIR"; exit 1; }

# Восстановление PostgreSQL
echo "🗄  PostgreSQL..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d n8n-postgres
sleep 10
if [ -f "$DATA_DIR/database.sql" ]; then
    docker exec n8n-postgres psql -U "${POSTGRES_USER:-n8n}" -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB:-n8n}' AND pid<>pg_backend_pid();" 2>/dev/null || true
    docker exec n8n-postgres dropdb -U "${POSTGRES_USER:-n8n}" "${POSTGRES_DB:-n8n}" 2>/dev/null || true
    docker exec n8n-postgres createdb -U "${POSTGRES_USER:-n8n}" "${POSTGRES_DB:-n8n}"
    docker exec -i n8n-postgres psql -U "${POSTGRES_USER:-n8n}" -d "${POSTGRES_DB:-n8n}" < "$DATA_DIR/database.sql"
    echo "✅ БД восстановлена"
fi

# Восстановление конфигурации n8n
if [ -d "$DATA_DIR/n8n_data" ]; then
    echo "📁 Конфигурация n8n..."
    docker volume rm -f "$(basename $SCRIPT_DIR)_n8n_data" 2>/dev/null || true
    docker volume create "$(basename $SCRIPT_DIR)_n8n_data" 2>/dev/null || true
    docker run --rm -v "$(basename $SCRIPT_DIR)_n8n_data":/restore -v "$PWD/$DATA_DIR/n8n_data":/backup alpine sh -c "cp -r /backup/. /restore/"
    echo "✅ Конфигурация восстановлена"
fi

# .env
if [ -f "$DATA_DIR/.env" ]; then
    read -p "Восстановить .env? (yes/no): " RE
    if [ "$RE" = "yes" ]; then
        cp "$SCRIPT_DIR/.env" "$SCRIPT_DIR/.env.before_restore"
        cp "$DATA_DIR/.env" "$SCRIPT_DIR/.env"
        echo "✅ .env восстановлен (старый → .env.before_restore)"
    fi
fi

rm -rf "$TMPDIR"

echo "🚀 Запуск..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d
sleep 15

for i in {1..30}; do
    docker exec n8n wget --spider -q http://localhost:5678/healthz 2>/dev/null && { echo "✅ n8n работает!"; break; }
    sleep 2
done

echo ""; echo "✅ Восстановление завершено!"
echo "🔗 https://${DOMAIN:-n8n}"
RSEOF
chmod +x "$INSTALL_DIR/restore_n8n.sh"

log_ok "Утилиты: backup_n8n.sh, update_n8n.sh, restore_n8n.sh"

# ============================================================
# 10. СБОРКА ОБРАЗОВ
# ============================================================
log_step "10/11 · Сборка Docker образов"

cd "$INSTALL_DIR"

log_info "Очистка Docker кэша..."
docker builder prune -af 2>/dev/null || true

log_info "Сборка n8n (может занять 5-15 минут)..."
docker compose build --no-cache 2>&1 | tail -5

log_ok "Все образы собраны"

# ============================================================
# 11. ЗАПУСК
# ============================================================
log_step "11/11 · Запуск контейнеров"

docker compose up -d

# Ожидание healthcheck n8n
log_info "Ожидание запуска n8n (до 120 секунд)..."
N8N_OK=false
for i in {1..60}; do
    sleep 2
    if docker exec n8n wget --spider -q http://localhost:5678/healthz 2>/dev/null; then
        N8N_OK=true
        break
    fi
    echo -n "."
done
echo ""

if $N8N_OK; then
    log_ok "n8n запущен и отвечает!"
else
    log_warn "n8n не ответил за 120 секунд. Проверьте: docker compose logs n8n"
fi

# ============================================================
# 12. CRON + ФИНАЛИЗАЦИЯ
# ============================================================
log_step "Финализация"

# Cron для бэкапов
(crontab -l 2>/dev/null | grep -v "backup_n8n.sh"; \
 echo "0 2 * * * cd $INSTALL_DIR && ./backup_n8n.sh >> ./logs/backup_cron.log 2>&1") | crontab - 2>/dev/null || true
log_ok "Cron: ежедневный бэкап в 2:00"

# Версия n8n
N8N_VER=$(docker exec n8n n8n --version 2>/dev/null || echo "N/A")

# Уведомление в Telegram
if [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_USER_ID" ]; then
    curl -sf -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TG_USER_ID}" \
        -d "text=✅ *n8n установлен!*

🌐 https://${DOMAIN}
📦 Версия: ${N8N_VER}

Команды: /start" \
        -d "parse_mode=Markdown" >/dev/null 2>&1 || true
fi

# ============================================================
# ИТОГОВЫЙ ВЫВОД
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}${BOLD}  ✅ УСТАНОВКА ЗАВЕРШЕНА!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  ${BOLD}🌐 n8n:${NC}  ${CYAN}https://${DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}📦 Версии:${NC}"
echo -e "     n8n:              v${N8N_VER}"
echo -e "     PostgreSQL:       16"
echo -e "     Redis:            7"
echo -e "     Traefik:          v3.2"
echo ""
echo -e "  ${BOLD}📝 Команды:${NC}"
echo "     cd $INSTALL_DIR"
echo "     docker compose ps           # Статус"
echo "     docker compose logs -f n8n  # Логи"
echo "     ./update_n8n.sh             # Обновить"
echo "     ./backup_n8n.sh             # Бэкап"
echo "     ./restore_n8n.sh <файл>     # Восстановить"
echo ""
echo -e "  ${BOLD}📁 Все пароли сохранены в:${NC} ${INSTALL_DIR}/.env"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Статус контейнеров
docker compose ps
