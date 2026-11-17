#!/bin/bash
# ============================================================
# n8n-beget-install — полный боевой стек n8n одной командой
#   Ubuntu 24.04 LTS (рекомендуется) · 22.04 LTS · 26.04 LTS, x86_64
#   n8n (queue mode) + Postgres + Redis + Traefik (HTTPS) + админ-бот Telegram
#   + движки: n8n-media-render (Remotion, HyperFrames, GSAP, Playwright, ffmpeg)
#     n8n-tools (ffmpeg/yt-dlp/python), edge-tts, faster-whisper, SearXNG, n8n Sandbox,
#     локальный Telegram Bot API (файлы до 2 ГБ), коллекция шрифтов /opt/fonts
#
# Интерактивно:
#   bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/n8n-beget-install/stack-v2/install.sh)
# Без вопросов (агент / CI) — все ответы переменными окружения, см. AGENTS.md:
#   curl -fsSL …/install.sh -o install.sh && DOMAIN=… EMAIL=… TG_BOT_TOKEN=… TG_USER_ID=… \
#     TELEGRAM_API_ID=… TELEGRAM_API_HASH=… NONINTERACTIVE=1 bash install.sh
# Повторный запуск безопасен: существующий .env (ключ шифрования, пароли) сохраняется.
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kalininlive/n8n-beget-install.git}"
REPO_BRANCH="${REPO_BRANCH:-stack-v2}"   # после слияния stack-v2 -> main поменять на main
INSTALL_DIR="/opt/n8n-install"
LOG_FILE="/var/log/n8n-install.log"

die()  { echo "❌ $*" >&2; exit 1; }
warn() { echo "⚠️  $*"; }
ok()   { echo "✅ $*"; }
section() { echo; echo "━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

(( EUID == 0 )) || die "Запустите от root: sudo bash install.sh"

# есть ли живой терминал для вопросов (агент по SSH без TTY → только переменные окружения)
HAVE_TTY=0
if [ "${NONINTERACTIVE:-0}" != "1" ] && { : </dev/tty; } 2>/dev/null; then HAVE_TTY=1; fi

# ask VAR "вопрос" — спрашивает, только если переменная ещё не задана
ask() {
  local var="$1" prompt="$2"
  if [ -n "${!var:-}" ]; then echo "   ↳ $var: задан заранее"; return; fi
  if [ "$HAVE_TTY" = 1 ]; then read -r -p "$prompt" "$var" </dev/tty || true; fi
  printf -v "$var" '%s' "${!var:-}"
}
# confirm "вопрос" — да/нет; без терминала — «да» только при FORCE=1
confirm() {
  [ "${FORCE:-0}" = 1 ] && return 0
  [ "$HAVE_TTY" = 1 ] || return 1
  local a; read -r -p "$1 [y/N]: " a </dev/tty || true; [[ "$a" =~ ^[YyДд] ]]
}

touch "$LOG_FILE" && chmod 600 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

[ "$HAVE_TTY" = 1 ] && clear || true
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   🌌  n8n + движки рендера — автоматическая установка         ║
║   n8n · Postgres · Redis · Traefik · Remotion · HyperFrames   ║
║   ffmpeg · edge-tts · whisper · Telegram Bot API (до 2 ГБ)    ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo "Журнал установки: $LOG_FILE"

### 0. Проверка сервера
section "0/5  Проверка сервера"
if pgrep -f '/usr/bin/unattended-upgrade' >/dev/null 2>&1; then
  warn "На сервере выполняется первичное фоновое обновление Ubuntu (unattended-upgrades)..."
  echo "   Жду завершения, чтобы пакетный менеджер не блокировался и службы не перезапускались..."
  while pgrep -f '/usr/bin/unattended-upgrade' >/dev/null 2>&1; do sleep 5; done
  ok "Фоновое обновление системы завершено"
fi
. /etc/os-release 2>/dev/null || die "Не удалось определить ОС"
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:24.04) ok "Ubuntu 24.04 LTS — рекомендуемая версия" ;;
  ubuntu:22.04|ubuntu:26.04) ok "Ubuntu ${VERSION_ID} LTS — поддерживается" ;;
  ubuntu:*) warn "Ubuntu ${VERSION_ID} — не LTS, не проверялась. Рекомендуется 24.04 LTS."
            confirm "Продолжить на свой риск?" || die "Остановлено. Переустановите сервер на Ubuntu 24.04 LTS." ;;
  debian:12|debian:13) warn "Debian ${VERSION_ID} — должно работать, но проверялось только на Ubuntu."
            confirm "Продолжить?" || die "Остановлено." ;;
  *) die "Поддерживается Ubuntu 22.04 / 24.04 / 26.04 LTS (у вас: ${PRETTY_NAME:-неизвестно})" ;;
esac
ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] || die "Нужен процессор x86_64 (amd64), у вас $ARCH: браузер рендера HyperFrames есть только под x86_64"
RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
CPU=$(nproc)
echo "   CPU: $CPU · RAM: ${RAM_MB} МБ · свободно на диске: ${DISK_GB} ГБ"
(( RAM_MB >= 3500 )) || { warn "RAM меньше 4 ГБ — рендер видео будет падать. Минимум 4 ГБ, комфортно 8 ГБ."; confirm "Продолжить?" || die "Остановлено."; }
(( DISK_GB >= 25 ))  || { warn "Свободно меньше 25 ГБ — образы, модели и шрифты занимают ~15 ГБ, плюс место под видео."; confirm "Продолжить?" || die "Остановлено."; }
(( CPU >= 2 ))       || warn "1 ядро CPU — рендер будет очень медленным (рекомендуется 4+)."
for port in 80 443; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    proc=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)
    [ "$proc" = docker-proxy ] && continue   # уже наш Traefik (повторный запуск)
    warn "Порт $port занят процессом ${proc:-?} (часто nginx/apache из шаблона хостинга). Traefik не сможет получить SSL."
    confirm "Остановить и отключить ${proc:-этот сервис}?" && { systemctl disable --now "${proc:-nginx}" 2>/dev/null || systemctl disable --now nginx apache2 2>/dev/null || true; } \
      || die "Освободите порт $port и запустите снова."
  fi
done

### 1. Ввод данных
# повторный запуск: берём значения из существующего .env (ключ шифрования терять нельзя — пропадут все креды n8n)
if [ -f "$INSTALL_DIR/.env" ]; then
  echo "ℹ️  Найден $INSTALL_DIR/.env — значения из него используются по умолчанию."
  for k in DOMAIN EMAIL POSTGRES_PASSWORD N8N_ENCRYPTION_KEY TG_BOT_TOKEN TG_USER_ID TELEGRAM_API_ID TELEGRAM_API_HASH PROXY_URL; do
    [ -n "${!k:-}" ] && continue
    v=$(grep -m1 "^${k}=" "$INSTALL_DIR/.env" | cut -d= -f2- || true)
    [ -n "$v" ] && printf -v "$k" '%s' "$v"
  done
fi

section "1/5  Домен и SSL"
echo "Создайте у регистратора A-запись домена (или поддомена) на IP этого сервера ДО установки — иначе Let's Encrypt не выдаст сертификат."
ask DOMAIN "🌐 Домен для n8n (например n8n.example.com): "
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
[ -n "$DOMAIN" ] || die "Домен обязателен (DOMAIN=…)"
ask EMAIL "📧 Email для SSL-сертификата Let's Encrypt: "
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Нужен корректный email (EMAIL=…)"
SERVER_IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
if [ "$DOMAIN_IP" = "$SERVER_IP" ]; then ok "DNS: $DOMAIN → $SERVER_IP"
else
  warn "DNS: $DOMAIN → ${DOMAIN_IP:-нет записи}, а IP сервера $SERVER_IP. SSL не выпустится, пока запись не обновится (обычно 5–30 минут)."
  confirm "Продолжить всё равно (сертификат выпустится сам, когда DNS обновится)?" || [ "${FORCE:-0}" = 1 ] || die "Исправьте A-запись и запустите снова (или FORCE=1)."
fi

section "2/5  Секреты n8n"
ask POSTGRES_PASSWORD  "🔐 Пароль Postgres (Enter — сгенерировать): "
ask N8N_ENCRYPTION_KEY "🗝️  Ключ шифрования n8n (Enter — сгенерировать; при переносе со старого сервера — вставьте старый): "
[ -n "$POSTGRES_PASSWORD" ]  || { POSTGRES_PASSWORD=$(openssl rand -hex 16); ok "Сгенерирован пароль Postgres"; }
[ -n "$N8N_ENCRYPTION_KEY" ] || { N8N_ENCRYPTION_KEY=$(openssl rand -hex 32); ok "Сгенерирован ключ шифрования (сохранён в $INSTALL_DIR/.env — сделайте копию)"; }

section "3/5  Админ-бот Telegram"
cat <<'TGHELP'
🤖 Бот сервера: уведомления, /status, /logs, /backups, /update и ночной бэкап воркфлоу.
   • токен — у @BotFather: /newbot → скопируйте строку вида 123456789:AAH…
   • ваш ID — напишите @userinfobot, он ответит числом (только этот ID сможет управлять ботом)
TGHELP
while :; do
  ask TG_BOT_TOKEN "🤖 Telegram Bot Token: "
  [[ "$TG_BOT_TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] && break
  [ "$HAVE_TTY" = 1 ] || die "TG_BOT_TOKEN пуст или неверного вида (123456789:AAH…)"
  echo "   ⚠️  Токен вида 123456789:AAH… — скопируйте целиком из @BotFather."; TG_BOT_TOKEN=""
done
if BOT_NAME=$(curl -fsS --max-time 10 "https://api.telegram.org/bot${TG_BOT_TOKEN}/getMe" 2>/dev/null | grep -o '"username":"[^"]*"' | cut -d'"' -f4) && [ -n "$BOT_NAME" ]; then
  ok "Бот найден: @$BOT_NAME"
else
  warn "Не удалось проверить токен через api.telegram.org (неверный токен или Telegram недоступен с сервера)."
fi
while :; do
  ask TG_USER_ID "👤 Ваш Telegram User ID: "
  [[ "$TG_USER_ID" =~ ^-?[0-9]{5,}$ ]] && break
  [ "$HAVE_TTY" = 1 ] || die "TG_USER_ID пуст или не число"
  echo "   ⚠️  ID — это число от @userinfobot."; TG_USER_ID=""
done

section "4/5  Telegram Bot API: файлы до 2 ГБ"
cat <<'APIHELP'
📎 Зачем: обычный Bot API (api.telegram.org) даёт боту скачать файл максимум 20 МБ
   и отправить — 50 МБ. Видео для монтажа больше. Свой сервер Bot API на этой машине
   снимает лимит до 2 ГБ в обе стороны. Для него Telegram требует ключи ПРИЛОЖЕНИЯ
   (не бота!) — api_id и api_hash.

   Где взять (2 минуты, бесплатно):
     1. https://my.telegram.org → войдите по номеру телефона (код придёт в сам Telegram).
     2. Раздел «API development tools».
     3. App title — любое (n8n-files), Short name — латиница 5–32 символа,
        Platform — Other → «Create application».
     4. Скопируйте App api_id (число) и App api_hash (32 символа).
   Ключи привязаны к вашему аккаунту — никому их не передавайте.
   Enter без ввода — пропустить (лимит останется 20 МБ; добавить позже: вписать в
   /opt/n8n-install/.env и выполнить bash /opt/n8n-install/install-extras.sh).
APIHELP
while :; do
  ask TELEGRAM_API_ID "🔑 App api_id: "
  { [ -z "$TELEGRAM_API_ID" ] || [[ "$TELEGRAM_API_ID" =~ ^[0-9]+$ ]]; } && break
  [ "$HAVE_TTY" = 1 ] || die "TELEGRAM_API_ID — только цифры"
  echo "   ⚠️  api_id — это только цифры."; TELEGRAM_API_ID=""
done
if [ -n "$TELEGRAM_API_ID" ]; then
  while :; do
    ask TELEGRAM_API_HASH "🔑 App api_hash: "
    [[ "$TELEGRAM_API_HASH" =~ ^[0-9a-fA-F]{32}$ ]] && break
    [ "$HAVE_TTY" = 1 ] || die "TELEGRAM_API_HASH — 32 символа 0-9/a-f"
    echo "   ⚠️  api_hash — 32 символа 0-9/a-f."; TELEGRAM_API_HASH=""
  done
  ok "Локальный Bot API будет установлен (до 2 ГБ)"
else
  TELEGRAM_API_HASH=""
  warn "Локальный Bot API пропущен — лимит файлов 20 МБ."
fi

section "5/5  Сеть"
echo "Прокси нужен, если с сервера закрыт доступ к OpenAI/Google/Telegram и т.п. Внутренние сервисы ходят мимо него."
ask PROXY_URL "🌍 HTTP-прокси (http://user:pass@host:port, Enter — без прокси): "

echo
echo "────────── Итого ──────────"
echo "  Домен:        https://$DOMAIN"
echo "  Email SSL:    $EMAIL"
echo "  Админ-бот:    ${BOT_NAME:+@$BOT_NAME }→ ID $TG_USER_ID"
echo "  Bot API 2 ГБ: $([ -n "$TELEGRAM_API_ID" ] && echo да || echo нет)"
echo "  Прокси:       ${PROXY_URL:-нет}"
echo "  Ветка:        $REPO_BRANCH → $INSTALL_DIR"
if [ "$HAVE_TTY" = 1 ] && [ "${FORCE:-0}" != 1 ]; then
  confirm "Начать установку (10–15 минут)?" || die "Отменено."
fi

### 2. Система: пакеты, swap, firewall, Docker
section "Установка: система и Docker"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
mkdir -p /etc/apt/apt.conf.d /etc/needrestart/conf.d
echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4
printf '$nrconf{override_rc}->{qr(^ssh)} = 0;\n$nrconf{restart} = "a";\n' > /etc/needrestart/conf.d/no-restart-ssh.conf 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq ca-certificates curl git jq openssl zip cron >/dev/null
SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
if (( RAM_MB < 8000 && SWAP_MB < 1000 )) && [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile \
    && echo '/swapfile none swap sw 0 0' >> /etc/fstab && ok "Создан swap 4 ГБ (RAM < 8 ГБ — для сборки образов и рендера)"
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ok "ufw: открыты 22, 80 и 443"
fi
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version &>/dev/null || apt-get install -y -qq docker-compose-plugin
systemctl enable --now docker >/dev/null 2>&1 || true
ok "Docker: $(docker --version | cut -d, -f1), compose: $(docker compose version --short)"

### 3. Код проекта
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "📥 $INSTALL_DIR уже есть — обновляю из git ($REPO_BRANCH)..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout -q -B "$REPO_BRANCH" FETCH_HEAD
else
  echo "📥 Клонирую проект ($REPO_BRANCH)..."
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    mv "$INSTALL_DIR" "${INSTALL_DIR}.old.$(date +%s)"; warn "Старая папка без git перенесена в ${INSTALL_DIR}.old.*"
  fi
  git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

### 4. .env (все секреты только здесь; существующий сохраняется и дополняется)
if [ -f .env ]; then cp .env ".env.bak.$(date +%s)"; else cp .env.template .env; fi
set_env() { # set_env KEY VALUE
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    val="${val//\\/\\\\}"; val="${val//|/\\|}"; val="${val//&/\\&}"
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${2}" >> .env
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
printf 'TG_BOT_TOKEN=%s\nTG_USER_ID=%s\n' "$TG_BOT_TOKEN" "$TG_USER_ID" > bot/.env
chmod 600 .env bot/.env

### 5. Папки, права, шимы
mkdir -p logs backups letsencrypt traefik_dynamic docker-plugins \
  data/reels data/files
touch logs/backup.log
chown -R 1000:1000 logs backups
chmod -R 755 logs backups
chmod +x shims/* backup_n8n.sh update_n8n.sh install-extras.sh scripts/*.sh
# docker-compose как cli-plugin для контейнера n8n-bot (он запускает update_n8n.sh у себя)
for p in /usr/libexec/docker/cli-plugins/docker-compose /usr/lib/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose; do
  [ -f "$p" ] && cp -f "$p" docker-plugins/docker-compose && break
done

### 6. Подготовка движков: секреты sandbox/searxng, NO_PROXY, движки монтажа, шрифты
bash ./install-extras.sh --prepare-only

### 7. Сборка и запуск ядра (готовый образ рендера качается параллельно)
section "Сборка ядра + загрузка образа рендера (5–10 минут)"
PULL_PID=""
if [ "${MEDIA_RENDER_BUILD:-0}" != "1" ]; then
  docker compose pull -q n8n-media-render >/dev/null 2>&1 &
  PULL_PID=$!
fi
docker compose build n8n n8n-worker n8n-tools n8n-bot
docker compose up -d n8n-postgres n8n-redis n8n-traefik n8n n8n-worker n8n-bot n8n-tools
echo "⏳ Жду запуска n8n (до 2 минут)..."
for i in $(seq 1 24); do
  docker exec n8n-app wget -qO- http://localhost:5678/healthz 2>/dev/null | grep -q ok && { ok "n8n запущен"; break; }
  sleep 5
done

### 8. Движки и сервисы (Bot API, whisper, edge-tts, рендер, поиск, sandbox) + полная проверка
section "Движки и проверка"
[ -n "$PULL_PID" ] && { echo "⏳ Дожидаюсь загрузки образа рендера..."; wait "$PULL_PID" || true; }
CHECK_OK=1
bash ./install-extras.sh || CHECK_OK=0

### 9. Бэкап по расписанию
(crontab -l 2>/dev/null | grep -v backup_n8n.sh; echo "0 2 * * * /bin/bash $INSTALL_DIR/backup_n8n.sh >> $INSTALL_DIR/logs/backup.log 2>&1") | crontab -
ok "Бэкап воркфлоу и кредов: ежедневно в 02:00 → Telegram"

### 10. Итог
SSL_OK=0
for s in $(seq 1 6); do
  curl -fsS --max-time 5 -o /dev/null "https://$DOMAIN/healthz" 2>/dev/null && { SSL_OK=1; break; }
  sleep 5
done
STATUS="$([ $CHECK_OK = 1 ] && echo '🟢 все проверки пройдены' || echo '🟡 есть замечания — см. журнал')"
curl -s -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" -d chat_id="$TG_USER_ID" \
  --data-urlencode text="✅ n8n установлен: https://$DOMAIN
$STATUS
SSL: $([ $SSL_OK = 1 ] && echo ok || echo 'ещё выпускается (проверьте DNS)')" >/dev/null || true

echo
docker ps --format "table {{.Names}}\t{{.Status}}"
cat <<EOF

╔══════════════════════════════════════════════════════════════╗
  🎉 Установка завершена — $STATUS
  🌐 n8n:          https://$DOMAIN   (SSL: $([ $SSL_OK = 1 ] && echo готов || echo 'выпускается, подождите 1–5 минут после обновления DNS'))
  👤 Первый вход:  откройте адрес и создайте аккаунт владельца
  📎 Telegram в n8n: в кредах Telegram укажите Base URL  http://telegram-bot-api-proxy
  🔤 Шрифты:       /opt/fonts (каталог /opt/fonts/fonts.json)
  🗝️  Секреты:      $INSTALL_DIR/.env — сохраните N8N_ENCRYPTION_KEY в надёжном месте
  🩺 Проверка:     bash $INSTALL_DIR/install-extras.sh --check
  📜 Журнал:       $LOG_FILE
╚══════════════════════════════════════════════════════════════╝
EOF
[ $CHECK_OK = 1 ] || exit 3
