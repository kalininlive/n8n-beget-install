#!/bin/bash
# ============================================================
# install-extras.sh — движки и доп. сервисы поверх базового n8n.
# Идемпотентно, без SSH, запускается прямо на сервере (из install.sh или руками).
#
#   bash install-extras.sh                 # всё: подготовка + запуск сервисов + проверка
#   bash install-extras.sh --prepare-only  # только .env / папки / шрифты / шимы (без docker)
#   bash install-extras.sh --check         # только проверка (для doctor / после обновления)
#
# Делает то же, что раньше делали deploy-sandbox.mjs / deploy-searxng.mjs / deploy-edge-tts.mjs
# из moy-n8n, плюс html-render. Сервисы описаны в docker-compose.override.yml (репо), сюда
# ничего не хардкодим — только секреты в .env, NO_PROXY, папки, шрифты и запуск.
# ============================================================
set -euo pipefail

BASE_DIR="/opt/n8n-install"
cd "$BASE_DIR"
MODE="${1:-all}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---------- 1. .env: секреты и NO_PROXY ----------
ensure_env_var() { # ensure_env_var KEY VALUE — добавить, если ключа нет или он пустой
  local key="$1" val="$2"
  if grep -q "^${key}=." .env 2>/dev/null; then
    return 0
  elif grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
  log "  .env: задан ${key}"
}

prepare_env() {
  [ -f .env ] || { echo "❌ Нет $BASE_DIR/.env — сначала install.sh"; exit 1; }
  log "1/4 .env: секреты sandbox / searxng / pixabay"
  local sbx reg rnk
  sbx="sbx_$(openssl rand -hex 24)"; reg="reg_$(openssl rand -hex 24)"; rnk="rnk_$(openssl rand -hex 24)"
  # парные значения должны совпадать (см. SERVER_PROFILE / lessons learned)
  ensure_env_var SANDBOX_API_KEYS "$sbx"
  ensure_env_var N8N_SANDBOX_SERVICE_API_KEY "$(grep '^SANDBOX_API_KEYS=' .env | cut -d= -f2-)"
  ensure_env_var SANDBOX_API_RUNNER_REGISTRATION_TOKEN "$reg"
  ensure_env_var SANDBOX_RUNNER_REGISTRATION_TOKEN "$(grep '^SANDBOX_API_RUNNER_REGISTRATION_TOKEN=' .env | cut -d= -f2-)"
  ensure_env_var SANDBOX_API_RUNNER_API_KEY "$rnk"
  ensure_env_var SANDBOX_RUNNER_API_KEYS "$(grep '^SANDBOX_API_RUNNER_API_KEY=' .env | cut -d= -f2-)"
  ensure_env_var N8N_SANDBOX_SERVICE_URL "http://sandbox-api:8080"
  ensure_env_var SEARXNG_SECRET "$(openssl rand -hex 32)"
  ensure_env_var N8N_INSTANCE_AI_SEARXNG_URL "http://searxng:8080"
  grep -q '^PIXABAY_API_KEY=' .env || echo "PIXABAY_API_KEY=" >> .env
  grep -q '^PROXY_URL=' .env || echo "PROXY_URL=" >> .env

  # NO_PROXY: каждый внутренний сервис — в начало списка (иначе 502 через внешний прокси)
  local current changed=0 host
  grep -q '^NO_PROXY=' .env || echo "NO_PROXY=localhost,127.0.0.1,::1" >> .env
  for host in n8n-tools n8n-media-render searxng sandbox-runner-1 sandbox-api edge-tts; do
    current=$(grep '^NO_PROXY=' .env | cut -d= -f2-)
    if ! echo ",$current," | grep -q ",$host,"; then
      sed -i "s|^NO_PROXY=|NO_PROXY=${host},|" .env
      changed=1
      log "  NO_PROXY: добавлен ${host}"
    fi
  done
  NO_PROXY_CHANGED=$changed
  chmod 600 .env
}

# ---------- 2. Папки, шимы, шрифты ----------
prepare_files() {
  log "2/4 папки /data, шимы, шрифты каруселей"
  mkdir -p data/reels data/carousel/jobs data/files \
    data/studio-engine/public/fonts data/studio-engine/public/assets/characters data/studio-engine/public/assets/stickers
  chmod +x shims/* 2>/dev/null || true
  [ -f searxng-settings.yml ] || printf 'use_default_settings: true\nsearch:\n  formats:\n    - html\n    - json\n' > searxng-settings.yml
  # шрифты html-render → общая папка шрифтов с маскотом (источник правды — engines/html-render/fonts в репо)
  if [ -d engines/html-render/fonts ]; then
    cp -f engines/html-render/fonts/*.woff2 engines/html-render/fonts/fonts.css data/studio-engine/public/fonts/
    log "  шрифты: $(ls engines/html-render/fonts/*.woff2 | wc -l) woff2 + fonts.css → data/studio-engine/public/fonts/"
  fi
}

# ---------- 3. Запуск сервисов ----------
start_services() {
  log "3/4 запуск сервисов из docker-compose.override.yml"
  docker compose up -d sandbox-certs
  docker wait sandbox-certs >/dev/null 2>&1 || true
  docker compose up -d sandbox-api sandbox-runner-1 searxng edge-tts n8n-tools
  if ! docker image inspect n8n-install-n8n-media-render:latest >/dev/null 2>&1; then
    log "  сборка образа n8n-media-render (5-10 минут)..."
    docker compose build n8n-media-render
  fi
  docker compose up -d n8n-media-render
  if [ "${NO_PROXY_CHANGED:-0}" = "1" ]; then
    log "  NO_PROXY изменился — пересоздаю n8n и n8n-worker"
    docker compose up -d n8n n8n-worker
  fi
  sleep 8
}

# ---------- 4. Проверка ----------
check_all() {
  log "4/4 проверка"
  local fails=0
  chk() { # chk "имя" команда...
    local name="$1"; shift
    if out=$(timeout 90 "$@" 2>&1); then
      echo "  ✅ $name: $(printf '%s' "$out" | tail -n 1 | cut -c1-100)"
    else
      echo "  ❌ $name: $(printf '%s' "$out" | tail -n 2)"; fails=$((fails+1))
    fi
  }
  chk "контейнеры"          sh -c 'for c in n8n-app n8n-worker n8n-postgres n8n-redis n8n-traefik n8n-tools n8n-media-render edge-tts searxng sandbox-api sandbox-runner-1; do docker inspect -f "{{.State.Running}}" "$c" 2>/dev/null | grep -q true || { echo "не запущен: $c"; exit 1; }; done; echo "все 11 запущены"'
  chk "n8n healthz"         docker exec n8n-app wget -qO- http://localhost:5678/healthz
  chk "remotion (шим)"      ./shims/remotion --version
  chk "render-html (шим)"   ./shims/render-html --version
  chk "ffmpeg (шим)"        ./shims/ffmpeg -version
  chk "edge-tts из n8n"     docker exec n8n-app wget -qO- http://edge-tts:5050/v1/models
  chk "searxng из n8n"      docker exec n8n-app wget -qO- 'http://searxng:8080/search?q=n8n&format=json'
  chk "sandbox из n8n"      docker exec n8n-app wget -qO- http://sandbox-api:8080/healthz
  chk "шимы внутри n8n-app" docker exec n8n-app sh -c 'ls /opt/shims/render-html /opt/shims/remotion /opt/shims/edge-tts'
  chk "NO_PROXY в n8n-app"  docker exec n8n-app sh -c 'echo "$NO_PROXY" | grep -q edge-tts && echo "$NO_PROXY" | grep -q searxng && echo "$NO_PROXY" | grep -q sandbox-api && echo "$NO_PROXY"'
  chk "шрифты каруселей"    sh -c 'test -f data/studio-engine/public/fonts/fonts.css && ls data/studio-engine/public/fonts/*.woff2 | wc -l'
  if [ -f data/studio-engine/src/index.ts ]; then
    chk "studio-engine (маскот)" sh -c 'test -d data/studio-engine/node_modules && echo "src + node_modules на месте"'
  else
    echo "  ⚠️  studio-engine: data/studio-engine/src отсутствует — маскот не соберётся (см. STACK.md → studio-engine)"
  fi
  # реальный рендер html → png
  local job="data/carousel/jobs/_selftest"
  mkdir -p "$job"
  cat > "$job/slide_01.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file:///data/studio-engine/public/fonts/fonts.css">
<style>body{margin:0;width:1080px;height:1350px;background:#0D0F12;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Unbounded',sans-serif;font-weight:900;font-size:96px}</style>
</head><body>render-html OK</body></html>
HTML
  chk "тестовый рендер PNG"  sh -c "./shims/render-html /data/carousel/jobs/_selftest --quiet >/dev/null && test -s $job/slide_01.png && ls -la $job/slide_01.png"
  rm -rf "$job"
  if [ "$fails" -eq 0 ]; then
    echo "🟢 Всё зелёное."
  else
    echo "🔴 Проблем: $fails"
    return 1
  fi
}

case "$MODE" in
  --prepare-only) prepare_env; prepare_files ;;
  --check)        check_all ;;
  all|"")         prepare_env; prepare_files; start_services; check_all ;;
  *) echo "Использование: $0 [--prepare-only|--check]"; exit 2 ;;
esac
