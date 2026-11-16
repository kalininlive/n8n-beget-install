#!/bin/bash
# ============================================================
# beget/install-genesis.sh — сервисы GENESIS поверх Beget-сборки n8n (/opt/beget/n8n).
# Аналог install-extras.sh для серверов, где n8n поставлен шаблоном Beget (НЕ наш /opt/n8n-install).
# Только добавляет: базу (Postgres 16), Traefik, образ n8n не трогает и не пересобирает. Идемпотентно.
#
# Набор кладётся в /opt/beget/n8n/genesis-kit/ (client-stack.mjs --apply делает это сам):
#   docker-compose.genesis.yml, install-genesis.sh, telegram-bot-api/nginx.conf, edge-tts-custom/*, shims/*
#
#   bash genesis-kit/install-genesis.sh [--n8n 2.41.2]  # бэкап → .env/шимы/ссылка → сборка n8n нужной версии → сервисы → пересоздать n8n и worker
#   bash genesis-kit/install-genesis.sh --check         # только проверка
# --n8n: целевая версия n8n (client-stack.mjs берёт её из stack-v2 Dockerfile.n8n). Ниже текущей не опускаемся;
#   сборка упала — старые контейнеры n8n работают дальше, скрипт останавливается.
# ============================================================
set -euo pipefail
BASE_DIR="/opt/beget/n8n"
KIT="$BASE_DIR/genesis-kit"
cd "$BASE_DIR"
MODE="all"; N8N_TARGET=""
while [ $# -gt 0 ]; do case "$1" in --check) MODE="--check";; --n8n) N8N_TARGET="$2"; shift;; *) echo "usage: install-genesis.sh [--n8n <версия>] [--check]"; exit 1;; esac; shift; done
log() { echo "[$(date +%H:%M:%S)] $*"; }
[ -f docker-compose.yml ] && [ -f .env ] || { echo "❌ $BASE_DIR: нет docker-compose.yml/.env — это не Beget-сборка"; exit 1; }

ensure_env() { # ensure_env KEY VALUE — добавить, если ключа нет или он пустой
  if grep -q "^$1=." .env; then return 0
  elif grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env
  else echo "$1=$2" >> .env; fi
}

backup() {
  local d="$BASE_DIR/backups/genesis-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$d"
  cp -a .env docker-compose.yml docker-compose.override.yml shims "$d"/ 2>/dev/null || true
  [ -f docker-compose.genesis.yml ] && cp -a docker-compose.genesis.yml "$d"/
  local u db
  u=$(grep '^POSTGRES_USER=' .env | cut -d= -f2-); db=$(grep '^POSTGRES_DB=' .env | cut -d= -f2-)
  docker exec n8n-postgres pg_dump -U "${u:-postgres}" "${db:-n8n}" | gzip > "$d/n8n-db.sql.gz"
  log "бэкап: $d ($(du -sh "$d" | cut -f1)), дамп базы $(du -h "$d/n8n-db.sql.gz" | cut -f1)"
}

prepare() {
  # ссылка: движки, doctor и шаблоны GENESIS работают с /opt/n8n-install
  if [ -L /opt/n8n-install ]; then :
  elif [ -e /opt/n8n-install ]; then echo "❌ /opt/n8n-install существует и это не ссылка — два стека на одном сервере, разобрать руками"; exit 1
  else ln -s "$BASE_DIR" /opt/n8n-install; log "ссылка /opt/n8n-install → $BASE_DIR"; fi

  cp "$KIT/docker-compose.genesis.yml" "$BASE_DIR/docker-compose.genesis.yml"
  grep -q '^TELEGRAM_API_ID=' .env || echo "TELEGRAM_API_ID=" >> .env
  grep -q '^TELEGRAM_API_HASH=' .env || echo "TELEGRAM_API_HASH=" >> .env
  ensure_env WHISPER_MODEL "Systran/faster-whisper-small"
  ensure_env WHISPER_MEM_LIMIT "1500m"
  ensure_env WHISPER_CPU_THREADS "$(nproc)"
  ensure_env COMPOSE_FILE "docker-compose.yml:docker-compose.override.yml:docker-compose.genesis.yml"
  grep -q '^NO_PROXY=' .env || echo "NO_PROXY=localhost,127.0.0.1,postgres,redis" >> .env
  local host cur
  for host in faster-whisper telegram-bot-api-proxy telegram-bot-api edge-tts n8n-tools n8n-media-render; do
    cur=$(grep '^NO_PROXY=' .env | cut -d= -f2-)
    echo ",$cur," | grep -q ",$host," || { sed -i "s|^NO_PROXY=|NO_PROXY=${host},|" .env; log "NO_PROXY: + $host"; }
  done

  # шимы: только недостающие, существующие Beget-шимы не трогаем
  local s
  for s in whisper edge-tts ffprobe; do
    if [ ! -e "shims/$s" ]; then cp "$KIT/shims/$s" "shims/$s"; chmod +x "shims/$s"; log "шим shims/$s"; fi
  done
  docker compose config -q && log "compose: конфигурация валидна"
}

ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; } # ver_ge A B: A >= B

upgrade_n8n() {
  [ -n "$N8N_TARGET" ] || { log "n8n: версия не задана — не обновляю"; return 0; }
  local cur; cur=$(docker exec n8n-app n8n --version 2>/dev/null | tail -n1 || true)
  if [ -n "$cur" ] && ver_ge "$cur" "$N8N_TARGET"; then log "n8n: $cur ≥ $N8N_TARGET — обновление не нужно"; return 0; fi
  log "n8n: $cur → $N8N_TARGET (сборка образа, несколько минут)"
  cp Dockerfile.n8n "backups/Dockerfile.n8n.$(date +%Y%m%d-%H%M%S)"
  # в Beget-сборке база — последний FROM n8nio/n8n:<тег>; первый этап (alpine с ffmpeg и т.д.) не трогаем
  sed -i -E "s#^FROM n8nio/n8n:[^ ]+#FROM n8nio/n8n:${N8N_TARGET}#" Dockerfile.n8n
  grep -q "^FROM n8nio/n8n:${N8N_TARGET}" Dockerfile.n8n || { echo "❌ не нашёл FROM n8nio/n8n в Dockerfile.n8n"; exit 1; }
  docker compose build n8n n8n-worker || { echo "❌ сборка n8n $N8N_TARGET не прошла — работающий n8n не тронут"; exit 1; }
  N8N_REBUILT=1
}

start() {
  local svc="faster-whisper edge-tts"
  if grep -q '^TELEGRAM_API_ID=.' .env && grep -q '^TELEGRAM_API_HASH=.' .env; then
    svc="$svc telegram-bot-api telegram-bot-api-proxy"
  else
    log "⚠ TELEGRAM_API_ID/HASH пустые — локальный Bot API не запускаю (клиент вписывает свои с my.telegram.org в $BASE_DIR/.env, затем повторить скрипт)"
  fi
  log "запуск: $svc"
  docker compose up -d --no-build $svc
  # n8n и worker — пересоздать с новыми томами/NO_PROXY, без пересборки образа (иначе n8nio/n8n:latest обновит n8n)
  log "пересоздаю n8n и n8n-worker (без сборки, ~1 мин простоя)"
  docker compose up -d --no-build --no-deps n8n n8n-worker
  local i
  for i in $(seq 1 60); do docker exec n8n-app wget -qO- http://localhost:5678/healthz >/dev/null 2>&1 && break; sleep 2; done
  for i in $(seq 1 30); do docker exec faster-whisper curl -sf http://localhost:8000/health >/dev/null 2>&1 && break; sleep 2; done
  local model; model=$(grep '^WHISPER_MODEL=' .env | cut -d= -f2-)
  log "faster-whisper: модель $model (первый раз — скачивание)"
  docker exec faster-whisper curl -sf -X POST "http://localhost:8000/v1/models/${model}" >/dev/null || log "⚠ модель не скачалась — проверь доступ к huggingface.co"
}

check() {
  local fails=0
  chk() { local n="$1"; shift; if out=$("$@" 2>&1); then echo "  ✅ $n: $(echo "$out" | tail -n1 | cut -c1-100)"; else echo "  ❌ $n: $(echo "$out" | tail -n1 | cut -c1-160)"; fails=$((fails+1)); fi; }
  chk "n8n healthz"        docker exec n8n-app wget -qO- http://localhost:5678/healthz
  chk "faster-whisper"     docker exec faster-whisper curl -sf http://localhost:8000/health
  chk "edge-tts из n8n"    docker exec n8n-app wget -qO- http://edge-tts:5050/v1/models
  chk "шимы whisper/ffprobe/edge-tts" docker exec n8n-app sh -c 'ls /opt/shims/whisper /opt/shims/ffprobe /opt/shims/edge-tts >/dev/null && echo есть'
  chk "ffprobe"            docker exec n8n-app /opt/shims/ffprobe -version
  chk "том Bot API в n8n"  docker exec n8n-app sh -c 'test -d /var/lib/telegram-bot-api && echo смонтирован'
  if grep -q '^TELEGRAM_API_ID=.' .env; then
    chk "telegram-bot-api-proxy" sh -c 'docker exec n8n-app wget -S -O- http://telegram-bot-api-proxy/ 2>&1 | grep -q "HTTP/1.1 404" && echo "HTTP 404 (слушает)"'
  else echo "  ⚠ Bot API: TELEGRAM_API_ID/HASH пустые"; fi
  [ "$fails" = 0 ] && log "🟢 GENESIS-сервисы в порядке" || { log "🔴 провалов: $fails"; return 1; }
}

case "$MODE" in
  --check) check ;;
  all) backup; prepare; upgrade_n8n; start; check; log "n8n: $(docker exec n8n-app n8n --version 2>/dev/null | tail -n1)" ;;
  *) exit 1 ;;
esac
