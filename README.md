# n8n-BEGET Install 🌌

Полная установка production-стека n8n одной командой на чистый Ubuntu 22.04/24.04:

* ✅ `n8n` (queue mode: `n8n-app` + `n8n-worker`), `Postgres 15`, `Redis 7`, `Traefik` (SSL Let's Encrypt)
* ✅ Кастомный образ n8n (`Dockerfile.n8n`) + `n8n-tools` (ffmpeg, yt-dlp, python3) через шимы
* ✅ **Движки рендера** в `n8n-media-render`: маскот-видео на Remotion и **html-render** (HTML → PNG карусели) — см. [ENGINES.md](ENGINES.md)
* ✅ `edge-tts` (бесплатная озвучка + пословные таймкоды), `SearXNG` (web search для AI Assistant), `n8n Sandbox` (code sandbox для AI Assistant), **локальный `telegram-bot-api`** (файлы до 2 ГБ)
* ✅ Telegram-бот: `/status`, `/logs`, `/backups`, `/update`; автобэкап в 02:00; post-check движков после обновления

Состав и правила сборки — [STACK.md](STACK.md). История обновлений — [UPDATE_HISTORY.md](UPDATE_HISTORY.md).

---

## ⚡ Установка

```bash
bash <(curl -s https://raw.githubusercontent.com/kalininlive/n8n-beget-install/main/install.sh)
```

Скрипт спросит: домен, email для SSL, пароль Postgres (или сгенерирует), токен и ID Telegram, ключ шифрования (или сгенерирует), внешний прокси (можно пропустить). Дальше всё автоматически: Docker → клон репо в `/opt/n8n-install` → `.env` из `.env.template` → `install-extras.sh` (секреты sandbox/searxng, `NO_PROXY`, папки `/data`, шрифты) → `docker compose build && up -d` → cron → проверка.

Установка на существующий сервер только «экстры» (движки, TTS, поиск, sandbox), идемпотентно:

```bash
cd /opt/n8n-install && bash install-extras.sh          # всё
bash install-extras.sh --check                         # только проверка
```

> Движок маскота дополнительно требует проект `studio-engine` в `data/studio-engine/` — как он попадает на сервер, описано в [STACK.md §5](STACK.md).

---

## 🧱 Правила

1. **На сервере — только движки.** Логика, промпты, HTML-шаблоны, стили — в нодах воркфлоу n8n.
2. **Новые сервисы — только в `docker-compose.override.yml`**, поднимать точечно: `docker compose up -d <service>`.
3. **Новый внутренний хост — сразу в начало `NO_PROXY`** в `.env` и `docker compose up -d n8n n8n-worker`.
4. **Шим = одна строка** `exec docker exec -i <container> <cmd> "$@"` в `shims/`, `chmod +x`.
5. **Секреты только в `.env`** (шаблон `.env.template`); в compose — `${...}`.

---

## 🚀 Обновление n8n

Через Telegram `/update` или на сервере `bash update_n8n.sh` (из бота). Скрипт: бэкап → `FROM n8nio/n8n:<latest>` в `Dockerfile.n8n` → `docker compose build n8n n8n-worker && up -d n8n n8n-worker` → обновление community-нод → **post-check движков** (`remotion`, `render-html`, `ffmpeg`, `edge-tts`) с алертом в Telegram → лёгкая уборка (`image prune -f`, без `-a`).

Ручное обновление:

```bash
cd /opt/n8n-install
docker compose build n8n n8n-worker
docker compose up -d n8n n8n-worker
```

Пересборка движков (не трогает n8n):

```bash
docker compose build n8n-media-render && docker compose up -d n8n-media-render
```

---

## 📅 Бэкап

Каждый день в 02:00 (`backup_n8n.sh`, cron): экспорт всех workflows и credentials → zip → в Telegram (если < 50 MB) или в `/opt/n8n-install/backups/`.

---

## 📄 Структура

```
/opt/n8n-install/
├── install.sh, install-extras.sh      # установка / экстры (идемпотентно)
├── docker-compose.yml                 # базовый стек
├── docker-compose.override.yml        # движки и доп. сервисы
├── Dockerfile.n8n / .render / .tools  # образы
├── engines/html-render/               # движок HTML → PNG (+ шрифты каруселей)
├── shims/                             # remotion, render-html, ffmpeg, yt-dlp, python, edge-tts, …
├── edge-tts-custom/, searxng-settings.yml
├── bot/                               # Telegram-бот
├── update_n8n.sh, backup_n8n.sh
├── .env.template  →  .env (секреты, не в git)
├── data/                              # /data во всех контейнерах: reels/, carousel/jobs/, studio-engine/, files/
├── STACK.md, ENGINES.md, UPDATE_HISTORY.md
└── backups/, logs/, letsencrypt/      # не в git
```

Управление с ПК (аудит, бэкап, deploy движков, doctor) — проект `moy-n8n`.
