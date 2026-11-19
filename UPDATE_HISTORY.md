[2026-04-22] Updated to 2.18.0 (Successfully)
[2026-06-05] Updated to 2.25.3 (Successfully)
[2026-06-17] Updated to 2.26.4 (Successfully)
[2026-06-18] Updated to 2.27.0 (Successfully)
[2026-06-27] Updated to 2.28.2 and updated Community Nodes
[2026-09-06] Updated from 2.36.3 to 2.37.10 safely
[2026-09-09] Updated to 2.39.0
[2026-09-12] stack-v2: сборка зафиксирована в репо; n8n-media-render с html-render 1.0.0 (puppeteer-core, Chromium 152, emoji-шрифт); шим render-html
[2026-09-23] telegram-bot-api (локальный Bot API, файлы до 2 ГБ) — в override, проверки в install-extras/update_n8n
[2026-09-25] Updated from 2.40.5 to 2.41.2
[2026-09-25] faster-whisper (speaches 0.8.3-cpu, контейнер faster-whisper, шим whisper, WHISPER_* в .env); шим ffprobe
[2026-09-25] telegram-bot-api-proxy (nginx: файлы local-режима по HTTP)
[2026-09-25] Ежечасная уборка временных файлов (scripts/cleanup_data.sh + cron)
[2026-09-26] n8n-media-render: GSAP по умолчанию (file:///opt/engines/vendor/gsap/, NODE_PATH), HYPERFRAMES_NO_UPDATE_CHECK=1

## 2026-11-16 — актуализация сборки
- n8n по умолчанию `:latest` (update_n8n.sh собирает с `--pull`); Traefik `v3`.
- Установщик: проверка ОС (Ubuntu 22.04/24.04/26.04 LTS, x86_64), RAM, диска, портов, DNS и токена бота; неинтерактивный режим для агентов (AGENTS.md); повторный запуск сохраняет .env; браузер HyperFrames ставится сам; Bot API запускается только с ключами.
- Шрифты: коллекция 62 семейств с кириллицей → /opt/fonts (scripts/install-fonts.sh, fonts/fonts.list), fontconfig в media-render и tools.
- Движки: Remotion 4.0.544, HyperFrames 0.8.221, GSAP 3.15.1, three.js 0.187.0, Playwright 1.65.1 (Node + Python, шимы `playwright`, `pw-node`, `pw-python`).
- install.sh спрашивает `TELEGRAM_API_ID/HASH` (локальный Bot API, файлы до 2 ГБ ставится всегда).
- RSSHub убран из compose.
- Сборка очищена от индивидуальной настройки: движки монтажа (kraft-reel, montage-v2, audio-prep), библиотека компонентов HyperFrames, проект маскота (studio-engine), воркфлоу, набор `beget/` и всё, что относится к конкретному боту. Стили роликов, шаблоны и воркфлоу каждый ставит под себя.
- Готовый образ `ghcr.io/kalininlive/n8n-media-render:stack-v2` (GitHub Actions: сборка + smoke-тест + публикация); шрифты и браузер HyperFrames запечены; установщик качает образ параллельно со сборкой ядра, без доступа — собирает локально. Установка 10–15 минут вместо 15–30.
- Убран рендер каруселей html-render (puppeteer-core, шим `render-html`): тестовый рендер HTML → PNG в `--check` теперь через Playwright.
- Подготовка к n8n v3: поддержка unverified community-нод (`N8N_UNVERIFIED_PACKAGES_ENABLED=true`) и фиксация лимитов распаковки архивов на 2 ГБ / 5000 файлов (`N8N_COMPRESSION_NODE_*`).
