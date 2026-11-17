#!/bin/bash
# ============================================================
# install-extras.sh — движки и доп. сервисы поверх базового n8n.
# Идемпотентно, без SSH, запускается прямо на сервере (из install.sh или руками).
#
#   bash install-extras.sh                 # всё: подготовка + запуск сервисов + проверка
#   bash install-extras.sh --prepare-only  # только .env / папки / шрифты / шимы (без docker)
#   bash install-extras.sh --check         # только проверка (для doctor / после обновления)
#
# Сервисы описаны в docker-compose.override.yml (репо), сюда
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
  log "1/4 .env: секреты sandbox / searxng"
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
  grep -q '^PROXY_URL=' .env || echo "PROXY_URL=" >> .env
  grep -q '^TELEGRAM_API_ID=' .env || echo "TELEGRAM_API_ID=" >> .env
  grep -q '^TELEGRAM_API_HASH=' .env || echo "TELEGRAM_API_HASH=" >> .env
  ensure_env_var WHISPER_MODEL "Systran/faster-whisper-small"

  # NO_PROXY: каждый внутренний сервис — в начало списка (иначе 502 через внешний прокси)
  local current changed=0 host
  grep -q '^NO_PROXY=' .env || echo "NO_PROXY=localhost,127.0.0.1,::1" >> .env
  for host in faster-whisper telegram-bot-api-proxy telegram-bot-api n8n-tools n8n-media-render searxng sandbox-runner-1 sandbox-api edge-tts; do
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

# ---------- 2. Папки, шимы ----------
prepare_files() {
  log "2/4 папки /data, шимы"
  mkdir -p data/reels data/files
  chmod +x shims/* 2>/dev/null || true
  mkdir -p data/tg-send logs
  # ежечасная уборка временных файлов (боты, отправка, рендеры) — см. scripts/cleanup_data.sh
  chmod +x scripts/cleanup_data.sh 2>/dev/null || true
  echo "17 * * * * root /bin/bash $BASE_DIR/scripts/cleanup_data.sh >> $BASE_DIR/logs/cleanup.log 2>&1" > /etc/cron.d/n8n-data-cleanup
  chmod 644 /etc/cron.d/n8n-data-cleanup
  [ -f searxng-settings.yml ] || printf 'use_default_settings: true\nsearch:\n  formats:\n    - html\n    - json\n' > searxng-settings.yml
  mkdir -p fonts/custom   # коллекция шрифтов ставится из образа media-render (см. ensure_fonts)
}

# Образ n8n-media-render: готовый с GitHub (ghcr.io), иначе — локальная сборка из Dockerfile.render.
# Браузер HyperFrames, Playwright, шрифты уже внутри — на сервере ничего не докачивается.
ensure_media_image() {
  local img; img=$(docker compose config --images 2>/dev/null | grep media-render)
  if [ "${MEDIA_RENDER_BUILD:-0}" != "1" ]; then
    log "  образ n8n-media-render: скачиваю готовый ($img, ~1,5 ГБ, на диске ~4 ГБ)"
    docker compose pull -q n8n-media-render >/dev/null 2>&1 || true
    if docker image inspect "$img" >/dev/null 2>&1; then log "  образ n8n-media-render: готов"; return 0; fi
    log "  ⚠ не скачался — собираю локально"
  fi
  log "  образ n8n-media-render: сборка из Dockerfile.render (15–25 минут)..."
  docker compose build n8n-media-render
}

# Коллекция шрифтов /opt/n8n-install/fonts: копия из образа (тот же fonts.list) или скачивание по своему fonts.list
ensure_fonts() {
  if [ -f fonts/fonts.json ] && [ ! fonts/fonts.list -nt fonts/fonts.json ]; then
    log "  шрифты: есть ($(grep -o '"family"' fonts/fonts.json | wc -l) семейств)"; return 0
  fi
  local img; img=$(docker compose config --images 2>/dev/null | grep media-render)
  if docker run --rm --entrypoint cat "$img" /opt/fonts/fonts.list 2>/dev/null | cmp -s - fonts/fonts.list; then
    rm -rf fonts/google
    docker run --rm --entrypoint tar "$img" -C /opt/fonts -cf - google fonts.css fonts.json | tar -xf - -C fonts \
      && touch fonts/fonts.json && log "  шрифты: из образа ($(grep -o '"family"' fonts/fonts.json | wc -l) семейств)" && return 0
  fi
  log "  шрифты: fonts.list изменён — скачиваю по списку"
  bash scripts/install-fonts.sh || log "  ⚠ шрифты не скачались (сеть?) — повторить: bash scripts/install-fonts.sh"
}

# ---------- 3. Запуск сервисов ----------
start_services() {
  log "3/4 запуск сервисов из docker-compose.override.yml"
  docker compose up -d sandbox-certs
  docker wait sandbox-certs >/dev/null 2>&1 || true
  docker compose up -d sandbox-api sandbox-runner-1 searxng edge-tts faster-whisper n8n-tools
  # обновляем edge-tts в контейнере до актуальной версии (защита от устаревания Sec-MS-GEC токенов и 403 ошибки)
  docker exec edge-tts pip install --quiet --upgrade edge-tts >/dev/null 2>&1 && docker restart edge-tts >/dev/null 2>&1 || true
  # локальный Bot API — только с API_ID/HASH (у клиента свои с my.telegram.org), иначе контейнер крутится в перезапусках
  if grep -q '^TELEGRAM_API_ID=.' .env && grep -q '^TELEGRAM_API_HASH=.' .env; then
    docker compose up -d telegram-bot-api telegram-bot-api-proxy
  else
    log "  ⚠ TELEGRAM_API_ID/HASH пустые — telegram-bot-api не запускаю (вписать в .env и повторить install-extras.sh)"
  fi
  whisper_model
  ensure_media_image
  ensure_fonts
  docker compose up -d n8n-media-render
  docker exec n8n-media-render fc-cache -f >/dev/null 2>&1 && log "  fc-cache: шрифты /opt/fonts проиндексированы" || true
  docker exec n8n-tools fc-cache -f >/dev/null 2>&1 || true
  if [ "${NO_PROXY_CHANGED:-0}" = "1" ]; then
    log "  NO_PROXY изменился — пересоздаю n8n и n8n-worker"
    docker compose up -d n8n n8n-worker
  fi
  sleep 8
}

# faster-whisper: скачать модель из .env в том whisper-models (идемпотентно, при повторе — мгновенно)
whisper_model() {
  local model i
  model=$(grep '^WHISPER_MODEL=' .env | cut -d= -f2-)
  for i in $(seq 1 30); do
    docker exec faster-whisper curl -sf http://localhost:8000/health >/dev/null 2>&1 && break
    sleep 2
  done
  log "  faster-whisper: модель ${model} (первый раз — скачивание, до нескольких минут)"
  docker exec faster-whisper curl -sf -X POST "http://localhost:8000/v1/models/${model}" >/dev/null     || log "  ⚠️ не удалось скачать ${model} — проверьте доступ к huggingface.co / PROXY_URL"
}

# ---------- 4. Проверка ----------
check_all() {
  log "4/4 проверка"
  local fails=0
  # локальный Bot API проверяем, только если заданы ключи
  local tg=0; grep -q '^TELEGRAM_API_ID=.' .env && grep -q '^TELEGRAM_API_HASH=.' .env && tg=1
  export TG_CONTAINERS=""; [ $tg = 1 ] && TG_CONTAINERS="telegram-bot-api telegram-bot-api-proxy"
  chk() { # chk "имя" команда...
    local name="$1"; shift
    if out=$(timeout 90 "$@" 2>&1 </dev/null); then  # </dev/null: шимы (docker exec -i) иначе съедают stdin
      echo "  ✅ $name: $(printf '%s' "$out" | tail -n 1 | cut -c1-100)"
    else
      echo "  ❌ $name: $(printf '%s' "$out" | tail -n 2)"; fails=$((fails+1))
    fi
  }
  chk "контейнеры"          sh -c 'for c in n8n-app n8n-worker n8n-postgres n8n-redis n8n-traefik n8n-tools n8n-media-render edge-tts searxng sandbox-api sandbox-runner-1 faster-whisper $TG_CONTAINERS; do docker inspect -f "{{.State.Running}}" "$c" 2>/dev/null | grep -q true || { echo "не запущен: $c"; exit 1; }; done; echo "все запущены"'
  chk "n8n healthz"         docker exec n8n-app wget -qO- http://localhost:5678/healthz
  chk "remotion (шим)"      sh -c "./shims/remotion --help | head -n 1"
  chk "ffmpeg (шим)"        ./shims/ffmpeg -version
  chk "edge-tts из n8n"     docker exec n8n-app wget -qO- http://edge-tts:5050/v1/models
  chk "searxng из n8n"      docker exec n8n-app wget -qO- 'http://searxng:8080/search?q=n8n&format=json'
  chk "sandbox из n8n"      docker exec n8n-app wget -qO- http://sandbox-api:8080/healthz
  [ $tg = 1 ] && chk "telegram-bot-api"    sh -c 'docker exec n8n-app wget -S -O- http://telegram-bot-api:8081 2>&1 | grep -q "HTTP/1.1 404" && echo "HTTP 404 OK"'
  [ $tg = 1 ] && chk "telegram-bot-api-proxy" sh -c 'docker exec n8n-app wget -S -O- http://telegram-bot-api-proxy/ 2>&1 | grep -q "HTTP/1.1 404" && echo "HTTP 404 OK (прокси → Bot API)"'
  [ $tg = 1 ] && chk "telegram тома n8n"   docker exec n8n-app sh -c 'test -d /data/telegram-files && test -d /var/lib/telegram-bot-api && echo "смонтированы"'
  chk "faster-whisper из n8n" docker exec n8n-app wget -qO- http://faster-whisper:8000/health
  chk "whisper модель"      sh -c 'm=$(grep "^WHISPER_MODEL=" .env | cut -d= -f2-); docker exec faster-whisper curl -sf "http://localhost:8000/v1/models/$m" >/dev/null && echo "$m скачана"'
  chk "шимы внутри n8n-app" docker exec n8n-app sh -c 'ls /opt/shims/remotion /opt/shims/playwright /opt/shims/edge-tts /opt/shims/whisper'
  chk "NO_PROXY в n8n-app"  docker exec n8n-app sh -c 'echo "$NO_PROXY" | grep -q faster-whisper && echo "$NO_PROXY" | grep -q telegram-bot-api && echo "$NO_PROXY" | grep -q edge-tts && echo "$NO_PROXY" | grep -q searxng && echo "$NO_PROXY" | grep -q sandbox-api && echo "$NO_PROXY"'
  chk "уборка (cron)"       sh -c 'test -f /etc/cron.d/n8n-data-cleanup && bash scripts/cleanup_data.sh | tail -n 1'
  chk "gsap + three.js"     docker exec n8n-media-render node --no-deprecation -e "const t=require('three');require('gsap');require('fs').accessSync('/opt/engines/vendor/three/build/three.module.js');console.log('three r'+t.REVISION+', gsap OK')"
  chk "hyperframes (шим)"   sh -c './shims/hyperframes --version 2>&1 | tail -n 1'
  chk "playwright"          sh -c './shims/playwright --version && ./shims/pw-python -c "from playwright.sync_api import sync_playwright as p; b=p().start().chromium.launch(); print(\"python + chromium OK\"); b.close()"'
  chk "браузер HyperFrames" docker exec n8n-media-render sh -c 'test -x "$HYPERFRAMES_BROWSER_PATH" && echo "$HYPERFRAMES_BROWSER_PATH"'
  chk "коллекция шрифтов"   sh -c 'docker exec n8n-media-render sh -c "fc-list | grep -c /opt/fonts/" && docker exec n8n-app test -f /opt/fonts/fonts.json && echo "/opt/fonts в n8n"'
  # реальный рендер HTML → PNG через Playwright (браузер + шрифт из /opt/fonts)
  mkdir -p data/files
  cat > data/files/_selftest.html <<'HTML'
<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;width:1080px;height:1350px;background:#0D0F12;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Unbounded',sans-serif;font-weight:900;font-size:96px}</style>
</head><body>Рендер OK</body></html>
HTML
  chk "тестовый рендер PNG"  sh -c "./shims/playwright screenshot --viewport-size=1080,1350 file:///data/files/_selftest.html /data/files/_selftest.png >/dev/null && test -s data/files/_selftest.png && ls -la data/files/_selftest.png"
  rm -f data/files/_selftest.html data/files/_selftest.png
  # реальное распознавание: edge-tts озвучивает фразу → whisper её распознаёт
  mkdir -p data/files
  chk "тест edge-tts → whisper" sh -c './shims/edge-tts --voice ru-RU-DmitryNeural --text "Проверка распознавания речи" --write-media /data/files/_whisper_selftest.mp3 >/dev/null 2>&1 && ./shims/whisper /data/files/_whisper_selftest.mp3 ru | grep -o "\"text\":\"[^\"]*\"" | head -n 1'
  rm -f data/files/_whisper_selftest.mp3
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
