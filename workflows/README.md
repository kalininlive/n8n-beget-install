# workflows/ — воркфлоу n8n, которые идут вместе со стеком

Импорт: n8n → Workflows → Import from file. После импорта заменить credentials на свои (S3, OpenAI, Telegram-бот, Jina, Brave, Supabase).

| Файл | Воркфлоу | Что делает |
|---|---|---|
| `sync-assets-s3.json` | 🔄 [СЕРВИС] Синхронизация ассетов S3 → сервер | по кнопке докачивает новые/изменённые файлы из S3 (`<prefix>` = зеркало `public/`) в `/data/studio-engine/public`. Настройка — нода «Конфиг» (bucket, prefix, dry_run) |
| `mcarousel-genesis.json` | 56 🎠 [КАРУСЕЛЬ] МОЙ МАСКОТ | HTML-карусель 4:5: Исследователь → Судья → Копирайтер \| Адаптер → Арт-директор → Сборка HTML (шаблоны 4 стилей вшиты в Code-ноду) → `render-html` → PNG → S3 → альбом в Telegram. Вход как у маскота: `chat_id`, `text`, `status` (`MCAROUSEL_TEXT` / `MCAROUSEL_LLM`) |

Исходники и сборщик `mcarousel-genesis.json` — в `moy-n8n`: `scripts/build-mcarousel-wf.mjs`, `workflows/src/mcarousel-build-html.js` (шаблоны берутся из `carusel_dayly_agent/styles`). Правки шаблонов/промптов → пересобрать и `--update <id>`.

Подключение к боту GENESIS (команда `/mcarousel`, callbacks `mcarousel_*`, статусы `MCAROUSEL_*`) — `moy-n8n/scripts/wire-mcarousel.mjs` (добавляет правила в `1.1 COMMANDS`, `1.2 CALLBACK`, `1 START`).
