# STACK.md — состав сборки n8n-сервера

> Репозиторий установщика: `github.com/kalininlive/n8n-beget-install`, ветка `stack-v2` (после проверки → `main`).
> На сервере: `/opt/n8n-install` (= клон репо + `.env` + `data/`).
> Принцип: **на сервере живут только движки** (контейнеры, шимы, рантаймы, ассеты). Логика, промпты, шаблоны, стили — в нодах воркфлоу n8n.

## 1. Компоненты

| Сервис / контейнер | Собирается из | Монтирует | Шим (в n8n `PATH=/opt/shims`) | Нужен для воркфлоу | Как проверить | Как обновить |
|---|---|---|---|---|---|---|
| `n8n-app` (`n8n`) | `docker-compose.yml` → `Dockerfile.n8n` (`n8nio/n8n:<ver>` + fs-extra, oauth-1.0a) | `/opt/n8n-install/data → /data`, `./shims → /opt/shims:ro`, docker.sock, `n8n_data` | — (сам вызывает шимы из Execute Command) | все | `docker exec n8n-app wget -qO- localhost:5678/healthz` → `{"status":"ok"}` | `update_n8n.sh` (Telegram `/update`); правит `FROM` в `Dockerfile.n8n`, `docker compose build n8n n8n-worker && up -d n8n n8n-worker` |
| `n8n-worker` | то же, `command: worker` | как n8n-app (без backups/скриптов) | — | все (queue mode) | `docker logs n8n-worker --tail 20` | вместе с n8n-app |
| `n8n-postgres` | `postgres:15-alpine` | `postgres_data` | — | все | `docker exec n8n-postgres pg_isready -U n8n` | не трогаем (мажорное обновление = отдельная задача с дампом) |
| `n8n-redis` | `redis:7-alpine` | `redis_data` | — | очередь Bull | `docker exec n8n-redis redis-cli ping` | `docker compose pull n8n-redis && up -d n8n-redis` |
| `n8n-traefik` | `traefik:v3`, `DOCKER_API_VERSION=1.44`, редирект http→https (+ `extra_hosts` из override); 2.10 на Docker ≥ 25 не видит контейнеры | `./letsencrypt`, `./traefik_dynamic`, docker.sock | — | HTTPS для `${DOMAIN}` | `curl -I https://$DOMAIN` | версия в `docker-compose.yml`; сертификаты в `letsencrypt/acme.json` |
| `n8n-tools` | `docker-compose.yml` → `Dockerfile.tools` (alpine + ffmpeg, yt-dlp, python3, fontconfig) | `/data`, docker.sock | `ffmpeg`, `yt-dlp`, `python`, `python3`, `fc-scan` | всё, где нужен ffmpeg/yt-dlp/python | `shims/ffmpeg -version` | `docker compose build n8n-tools && up -d n8n-tools` |
| `n8n-media-render` | `docker-compose.override.yml` → `Dockerfile.render` (`node:22-bookworm-slim` + Chromium + ffmpeg + шрифты + `@remotion/cli`, `remotion`, `hyperframes`, `gsap`, `three`, `playwright` (+ Python) глобально; GSAP для HTML — `file:///opt/engines/vendor/gsap/`) | `/opt/n8n-install/data → /data`, `fonts → /opt/fonts`; env прокси, `HYPERFRAMES_BROWSER_PATH` | `remotion`, `hyperframes`, `playwright`, `pw-node`, `pw-python` | видео (Remotion, HyperFrames), скриншоты и парсинг сайтов | `shims/remotion --help`, `shims/playwright --version` | `docker compose build n8n-media-render && docker compose up -d n8n-media-render` (из ПК: `npm run deploy:html-render`) |
| `n8n-bot` | `docker-compose.yml` → `bot/Dockerfile` (node:20-alpine + docker-cli, jq, zip) | `./ → /opt/n8n-install` (вся папка), docker.sock, cli-plugins | — | Telegram-админ: `/status`, `/logs`, `/backups`, `/update` | `/status` в Telegram | `docker compose build n8n-bot && up -d n8n-bot` |
| `edge-tts` | override: `travisvn/openai-edge-tts:latest` + наши `edge-tts-custom/server.py`, `tts_handler.py` (эндпоинт `/v1/audio/speech-with-timestamps`) | `/data`, два `.py` поверх образа `:ro` | `edge-tts` | озвучка | `docker exec n8n-app wget -qO- http://edge-tts:5050/v1/models` | `docker compose pull edge-tts && up -d edge-tts` (после pull проверить, что наши `.py` совместимы с новым образом) |
| `faster-whisper` | override: `ghcr.io/speaches-ai/speaches:0.8.3-cpu` (бесплатный open-source сервер над [faster-whisper](https://github.com/SYSTRAN/faster-whisper), MIT; OpenAI-совместимый API, всё локально, без ключей) | том `whisper-models` (модели HF), `/data:ro` | `whisper` | распознавание речи вместо AssemblyAI (монтаж, субтитры, транскрибация) | `docker exec n8n-app wget -qO- http://faster-whisper:8000/health` | модель — `WHISPER_MODEL` в `.env` + `bash install-extras.sh`; образ — `WHISPER_IMAGE_TAG`, `docker compose up -d faster-whisper` |
| `searxng` | override: `ghcr.io/searxng/searxng:latest` + `searxng-settings.yml` (JSON API) | `./searxng-settings.yml:/etc/searxng/settings.yml:ro` | — | n8n AI Assistant «web search» (`http://searxng:8080`) | `docker exec n8n-app wget -qO- 'http://searxng:8080/search?q=n8n&format=json'` | `docker compose pull searxng && up -d searxng` |
| `sandbox-certs` → `sandbox-api` → `sandbox-runner-1` | override: `ghcr.io/n8n-io/n8n-sandbox-service-{api,runner-dind}:1.2.0` | том `sandbox-tls`; `env_file: .env` | — | n8n AI Assistant «code sandbox» (`http://sandbox-api:8080`, ключ `SANDBOX_API_KEYS`) | `docker exec n8n-app wget -qO- http://sandbox-api:8080/healthz` | поднять версию образов в override, `docker compose up -d sandbox-api sandbox-runner-1` |
| `telegram-bot-api` | override: `aiogram/telegram-bot-api:latest` | том `telegram-bot-data:/var/lib/telegram-bot-api`; в n8n `/data/telegram-files` | — | Снятие лимитов Telegram Bot API (до 2 ГБ) на скачивание/отправку | `docker exec n8n-app wget -S -O- http://telegram-bot-api:8081 2>&1 \| grep 404` | `docker compose pull telegram-bot-api && up -d telegram-bot-api` |
| `telegram-bot-api-proxy` | override: `nginx:1.27-alpine` + `telegram-bot-api/nginx.conf` | том `telegram-bot-data:ro` | — | **Base URL кредов Telegram в n8n: `http://telegram-bot-api-proxy`.** API → `telegram-bot-api:8081`; `/file/bot<token>/<абсолютный путь>` отдаёт с диска (в `--local` Bot API файлы по HTTP не отдаёт, без прокси ноды «Download file» ломаются) | `docker exec n8n-app wget -S -O- http://telegram-bot-api-proxy/ 2>&1 \| grep 404` | `docker compose up -d telegram-bot-api-proxy` |

Шимы — файлы в `shims/`, одна строка каждый: `exec docker exec -i <container> <cmd> "$@"`. Внутри n8n они видны как `/opt/shims/<name>` (и `ffmpeg`/`python`/`yt-dlp` дополнительно как `/usr/bin/...`). Новый шим = новый файл в `shims/` + `chmod +x`, контейнеры перезапускать не нужно (папка смонтирована).

## 2. Файлы репозитория

| Файл | Назначение |
|---|---|
| `install.sh` | установка с нуля: Docker, клон репо, `.env` из `.env.template`, папки, `install-extras.sh --prepare-only`, `docker compose build && up -d`, cron бэкапа, проверка |
| `install-extras.sh` | идемпотентно: секреты sandbox/searxng в `.env`, `NO_PROXY`, папки `/data`, браузер HyperFrames, шрифты /opt/fonts, запуск override-сервисов, `--check` — полная проверка |
| `docker-compose.yml` | базовый стек (n8n, worker, postgres, redis, traefik, tools, bot). Домен — `${DOMAIN}` |
| `docker-compose.override.yml` | движки и доп. сервисы (media-render, edge-tts, faster-whisper, telegram-bot-api, searxng, sandbox). Загружается compose автоматически. **Новые сервисы — только сюда** |
| `Dockerfile.n8n` / `Dockerfile.render` / `Dockerfile.tools` / `bot/Dockerfile` | образы |
| `shims/` | шимы |
| `edge-tts-custom/` | патч edge-tts с пословными таймкодами |
| `searxng-settings.yml` | JSON API для SearXNG |
| `update_n8n.sh`, `backup_n8n.sh`, `scripts/cron_backup.sh` | обновление n8n (с post-check движков), бэкап workflows+credentials в Telegram |
| `.env.template` | все переменные с пояснениями; секретов в репо нет |
| `.dockerignore` | `data/`, `backups/`, `.env*`, `node_modules` не попадают в контекст сборки |
| `STACK.md`, `ENGINES.md`, `UPDATE_HISTORY.md` | документация |

Не в git (`.gitignore`): `.env`, `data/`, `backups/`, `logs/`, `letsencrypt/`, `*.bak*`, `node_modules`.

## 3. Секреты и переменные

Всё в `/opt/n8n-install/.env` (шаблон — `.env.template`). В compose-файлах — только `${...}`:
`DOMAIN`, `EMAIL`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `TG_BOT_TOKEN`, `TG_USER_ID`, `PROXY_URL`, `NO_PROXY`,
`SANDBOX_*` / `N8N_SANDBOX_*` (парные значения должны совпадать), `SEARXNG_SECRET`, `DOCKER_GID`.

**Правило NO_PROXY:** имя каждого внутреннего сервиса — в начало `NO_PROXY`, после изменения `docker compose up -d n8n n8n-worker`. Иначе n8n ходит к контейнеру через внешний прокси → `502 Bad Gateway`. `install-extras.sh` делает это сам.

## 4. Обновления: почему `update_n8n.sh` не ломает движки

`update_n8n.sh` делает: бэкап → правит `FROM n8nio/n8n:<latest>` в `Dockerfile.n8n` → `docker compose build n8n n8n-worker` → `docker compose up -d n8n n8n-worker` → `npm update` community-нод → `restart n8n n8n-worker` → post-check движков → `docker image prune -f` + `builder prune -f`.

| Риск | Статус |
|---|---|
| `up -d n8n n8n-worker` пересоздаёт только эти два сервиса | ✅ остальные контейнеры не трогаются (проверено на обновлениях 2.36 → 2.39) |
| `docker image prune -f` | ✅ без `-a` удаляет только dangling-слои; образы `n8n-install-n8n-media-render`, `n8n-tools`, `n8n-bot` теговые и используются → не удаляются. **Не добавлять `-a`** |
| `docker builder prune -f` | ✅ только кэш сборки, следующая пересборка media-render дольше на ~5 мин |
| `/data`, `shims/` | ✅ bind-mount с хоста, обновление их не касается |
| `NO_PROXY` | ✅ читается из `.env` при пересоздании n8n — значение сохраняется. Риск только если `.env` перезаписать вручную |
| Переименование сервисов в compose | ⚠️ шимы завязаны на `container_name` (`n8n-media-render`, `n8n-tools`, `edge-tts`, `faster-whisper`). Менять имена = менять `shims/*` |
| Бот запускал `update_n8n.sh` без override и без `Dockerfile.n8n` (в контейнер были смонтированы отдельные файлы, `.env` «залипал» на старом inode после `sed -i`) | 🔧 исправлено в `stack-v2`: `n8n-bot` монтирует всю папку `./:/opt/n8n-install`, `COMPOSE_FILE` включает override. Требует `docker compose up -d n8n-bot` один раз |
| Post-check | 🔧 добавлен: после обновления проверяются `remotion --help`, `playwright --version`, `ffmpeg`, `edge-tts`, `telegram-bot-api`, `faster-whisper`, шимы в n8n-app; при сбое — сообщение в Telegram |
| Ручной `docker compose pull` + `up -d --remove-orphans` | ⚠️ подтянет `edge-tts:latest` / `searxng:latest` и пересоздаст их. Для обновления n8n предпочитать `update_n8n.sh` (бот) — он трогает только n8n |

## 5. Перевод бота на локальный Telegram Bot API (до 2 ГБ)

1. В n8n найти **все** креды с токеном бота (их может быть несколько с разными именами) — `n8n export:credentials --all --decrypted` внутри n8n-app, сравнить `accessToken`, файл сразу удалить.
2. Бэкап этих кредов (`n8n export:credentials --id=<id>`), затем `baseUrl = http://telegram-bot-api-proxy` (`import:credentials` с изменённым JSON).
3. `https://api.telegram.org/bot<token>/logOut` — после этого облако бота не обслуживает (вернуть можно не раньше чем через 10 минут: `logOut` на локальном + вызовы на api.telegram.org).
4. Деактивировать и активировать воркфлоу с Telegram Trigger — n8n сам вызовет `setWebhook` через локальный сервер. Проверка: `getWebhookInfo` через прокси.
5. HTTP-запросы с токеном, вшитым в URL `api.telegram.org`, после `logOut` перестают работать — найти и перевести на прокси заранее.

**Лимиты локального Bot API (проверено 25.09.2026):** скачивание — до 2 ГБ; отправка **по ссылке** (`video: "https://…"`) — **только до 20 МБ**, как в облаке; отправка **файла с диска** — до 2 ГБ: `file:///data/…` (контейнер `telegram-bot-api` монтирует `/data:ro`). Шаблон для воркфлоу: сначала по ссылке, при ошибке — скачать в `/data/tg-send/` (чистится через 3 ч) и отправить `file://`.

**Превью при отправке файлом.** Видео, отправленное файлом (`file://` или загрузкой из n8n), локальный Bot API показывает чёрным квадратом 320×320 без длительности. Нужно передать `thumb` (JPEG ≤ 320 px, строкой `file:///data/…jpg`), `width`, `height`, `duration` — в Telegram-ноде n8n это Additional Fields → Thumbnail / Width / Height / Duration. Превью и размеры снимать ffmpeg/ffprobe (шимы), учитывая поворот `rotation` у видео с телефона.

## 6. Уборка временных файлов

`scripts/cleanup_data.sh` — cron каждый час (`/etc/cron.d/n8n-data-cleanup`, ставит `install-extras.sh`), лог `logs/cleanup.log`.
Файлы ботов в локальном Bot API — 24 ч (`CLEANUP_TG_HOURS`); `/data/tg-send` — 3 ч (`CLEANUP_TMP_MIN`); `/data/reels` — 24 ч. Правило для новых воркфлоу: временные файлы класть только в эти папки — тогда они уберутся, даже если выполнение упало.

