# ENGINES.md — движки рендера на сервере n8n

> Оба движка живут в одном контейнере **`n8n-media-render`** (`docker-compose.override.yml` → `Dockerfile.render`).
> n8n вызывает их из ноды **Execute Command** через шимы `/opt/shims/*` (папка `shims/` репо смонтирована в n8n-app и n8n-worker).
> Обмен файлами — общий том: на хосте `/opt/n8n-install/data` = в n8n-app **и** в media-render `/data`.
> Принцип: на сервере — только движки и ассеты; сценарии, промпты, шаблоны HTML, стили — в нодах воркфлоу.

## Общие ассеты (одни для обоих движков)

| Что | Путь на хосте | Путь в контейнерах (n8n-app, media-render) | Откуда берётся |
|---|---|---|---|
| Персонаж-маскот (позы) | `/opt/n8n-install/data/studio-engine/public/assets/characters/` | `/data/studio-engine/public/assets/characters/` | проект studio-engine (см. STACK.md §5) |
| Стикеры, иконки, эмодзи, логотипы брендов | `…/public/assets/{stickers,icons,emojis,brand_logos}/` | `/data/studio-engine/public/assets/…` | studio-engine |
| Шрифты маскота | `…/public/fonts/<family>-<subset>-<weight>-normal.woff2` (inter, rubik, unbounded, caveat, jetbrains-mono, noto-color-emoji) | `/data/studio-engine/public/fonts/` | studio-engine |
| Шрифты каруселей | `…/public/fonts/<Family>-<weight>-<subset>.woff2` + **`fonts.css`** (Inter 400–900, Manrope 700/800, Montserrat 400/700/900, Rubik 700–900, Unbounded 700–900) | `/data/studio-engine/public/fonts/fonts.css` | репо `engines/html-render/fonts/` → копирует `install-extras.sh` / `deploy-html-render.mjs` |

В HTML/CSS ссылаться абсолютно: `file:///data/studio-engine/public/...` — путь одинаков во всех контейнерах.

---

## 1. Маскот (видео) — Remotion

**Что это.** Фабрика вертикальных роликов 1080×1920 @ 60 fps на Remotion: React-композиции (`MascotFactoryReel`, `CoreSmokeTest`, …), персонаж, виджеты, субтитры по пословным таймкодам Edge-TTS.

**Где лежит.**
- Рантайм: образ `n8n-media-render` — `@remotion/cli`, `remotion`, `hyperframes` глобально, Chromium `/usr/bin/chromium`, ffmpeg.
- Проект: том `/opt/n8n-install/data/studio-engine/` (`src/index.ts`, `public/`, `scripts/`, `node_modules/` — ставится `npm ci` внутри контейнера). Вне git на сервере; источник `D:/ANTIGRAVITY PACK/video-production-test-agy`.
- `WORKDIR` контейнера = `/data/studio-engine`.

**Шимы.**
- `remotion` → `docker exec -i n8n-media-render remotion "$@"`
- `hyperframes` → `… hyperframes "$@"`
- `render-studio-reel` → `… python3 /data/studio-engine/scripts/render_studio_reel.py "$@"` (старый пайплайн)

**Как вызывает n8n** (воркфлоу `55 🎬 [РЕЙЛС] МОЙ МАСКОТ`, id `18lXGBiCbPa9SVd1`).
1. LLM-ноды пишут сценарий и «режиссёрский» JSON сцен; `Озвучка Edge-TTS` → `http://edge-tts:5050/v1/audio/speech-with-timestamps` (mp3 base64 + `words[]`).
2. Code-нода `Сборка Props, Timeline и Ассетов`: пишет `runId = Date.now()`, собирает `timeline` (meta, audio, scenes, subtitles), и команду:
   ```
   echo '<base64 props.json>' | base64 -d > /data/reels/props_<runId>.json && \
   /opt/shims/remotion render /data/studio-engine/src/index.ts MascotFactoryReel /data/reels/reel_<runId>.mp4 --props=/data/reels/props_<runId>.json 2>&1
   ```
   Аудио mp3 сохраняется как `/data/reels/speech_<runId>.mp3` (в props — `reels/speech_<runId>.mp3` относительно `public/`… см. ноду).
3. Execute Command `Рендер Remotion (60 FPS)` выполняет `renderCommand`; результат — `/data/reels/reel_<runId>.mp4`, n8n читает его Read Binary File и публикует.
4. Execute Command `Очистка временных файлов`: `rm -f reel_*.mp4 speech_*.mp3 props_*.json`.

**Что n8n пишет в `/data` до вызова:** `reels/props_<runId>.json`, `reels/speech_<runId>.mp3`. **Что читает после:** `reels/reel_<runId>.mp4`.

**Ручная отладка / smoke-тест.**
```bash
/opt/n8n-install/shims/remotion --help
/opt/n8n-install/shims/remotion render /data/studio-engine/src/index.ts CoreSmokeTest /data/reels/smoketest.mp4
docker exec -it n8n-media-render sh -lc 'cd /data/studio-engine && npm run typecheck'
```
Логи — в stdout Execute Command (`2>&1`). Типичные проблемы: нет `node_modules` (→ `npm ci` в контейнере), нет ассета в `public/assets` (→ проверить путь в props), нехватка RAM (→ swap 4 GB есть, `--concurrency=1`).

**Обновление.** Сцены/ассеты: заменить файлы в `data/studio-engine` (без пересборки образа). Версия Remotion CLI: `Dockerfile.render` → `docker compose build n8n-media-render && docker compose up -d n8n-media-render`; версии в `package.json` проекта должны совпадать по мажору с CLI.

---

## 2. Карусели (HTML → PNG) — html-render

**Что это.** Универсальный рендер HTML-слайдов в PNG: `puppeteer-core` + системный Chromium. Один браузер на задачу, viewport `1080×1350 @ 2x` (Retina 2160×2700), ожидание `load` + `networkidle0` + `document.fonts.ready`. Поведение 1:1 с локальным `carusel_dayly_agent/build.mjs`.

**Где лежит.** В образе: `/opt/engines/html-render/render.mjs` (репо `engines/html-render/`, запекается `COPY` + `npm ci --omit=dev`). Обновление кода движка = пересборка образа.

**Шим.** `render-html` → `docker exec -i n8n-media-render node /opt/engines/html-render/render.mjs "$@"`.

**Формат вызова.**
```
/opt/shims/render-html /data/carousel/jobs/<runId> [--width 1080] [--height 1350] [--scale 2] [--out <dir>] [--timeout 30000] [--pattern "*.html"] [--quiet]
/opt/shims/render-html --help | --version
```
stdout — один JSON: `{ok, engine, jobDir, out, width, height, scale, count, ms, slides:[{html, png, bytes}]}`; при ошибке `{ok:false, error}` и код 1. Прогресс — в stderr (не мешает парсить stdout, если в Execute Command не склеивать `2>&1`).

**Как вызывает n8n** — воркфлоу `56 🎠 [КАРУСЕЛЬ] МОЙ МАСКОТ` (id `c2KPuvgqGy1suliL`, JSON в `workflows/mcarousel-genesis.json`). Вход из бота GENESIS: `/mcarousel` → статус `MCAROUSEL_TEXT` / `MCAROUSEL_LLM` → `1 START GENESIS` → Execute Workflow с `chat_id`, `text`, `status`. Контракт:
1. LLM-блок как у маскота (Исследователь с Jina/Brave/Supabase → Судья → Копирайтер, либо Адаптер готового текста) → JSON контента (обложка, 3–7 смысловых слайдов, финал, подпись поста) → Арт-директор (стиль из 4, позы маскота, стикеры).
2. Code-нода «Сборка HTML и команда рендера»: шаблоны 4 стилей + `_zones.css` вшиты в ноду; на выходе по одному item на слайд с binary HTML. Далее Execute Command `mkdir -p /data/carousel/jobs/<runId>` → Write File `slide_NN.html` (через Write File, а не `echo base64 | …`: у одного аргумента shell лимит 128 KB, 8 слайдов HTML в base64 в него не влезают).
3. Execute Command `/opt/shims/render-html /data/carousel/jobs/<runId> --quiet </dev/null` → Code: `JSON.parse($json.stdout)` → `slides[].png`.
4. Read File по каждому PNG → S3 upload `carousel/<runId>/slide_NN.png` (publicRead) → Telegram `sendMediaGroup` по URL. Нюанс: fixedCollection в n8n не принимает массив из expression, поэтому Switch по числу слайдов → ноды «Альбом × N» (N = 2…10, генерируются сборщиком).
5. Execute Command `rm -rf /data/carousel/jobs/<runId>` → ответ в чат.

**Что n8n пишет в `/data` до вызова:** `carousel/jobs/<runId>/slide_NN.html`. **Что читает после:** `carousel/jobs/<runId>/slide_NN.png`.

**Шрифты и картинки в HTML.**
```html
<link rel="stylesheet" href="file:///data/studio-engine/public/fonts/fonts.css">
<img src="file:///data/studio-engine/public/assets/characters/genesis/pointing.png">
```
Google Fonts CDN в HTML работать не будет, если у контейнера нет интернета через прокси — используйте `fonts.css`. Chromium запущен с `--allow-file-access-from-files --disable-web-security`, поэтому `file://` → `file://` разрешён.

**Ручная отладка.**
```bash
mkdir -p /opt/n8n-install/data/carousel/jobs/test && cp slide_*.html /opt/n8n-install/data/carousel/jobs/test/
/opt/n8n-install/shims/render-html /data/carousel/jobs/test          # PNG рядом с HTML
/opt/n8n-install/shims/render-html /data/carousel/jobs/test --out /data/carousel/jobs/test/out --scale 1
docker exec -it n8n-media-render node /opt/engines/html-render/render.mjs --help
```
Типичные проблемы: `Папка задачи не найдена` (n8n передал хостовый путь `/opt/n8n-install/data/...` вместо `/data/...`), пустой/системный шрифт на PNG (не подключён `fonts.css` или опечатка в `font-family`), таймаут (`networkidle0` ждёт внешние ресурсы — убрать внешние `<link>`/`<img>` или поднять `--timeout`).

**Обновление.** Правка `engines/html-render/render.mjs` или версии `puppeteer-core` в `package.json` (+ `npm install --package-lock-only`) → коммит → на сервере `git pull` → `docker compose build n8n-media-render && docker compose up -d n8n-media-render`. С ПК: `moy-n8n: npm run deploy:html-render` (делает всё это + smoke-тест маскота + тестовый рендер). Остальные сервисы не перезапускаются.

---

## 3. Проверка обоих движков одной командой

- На сервере: `bash /opt/n8n-install/install-extras.sh --check`
- С ПК: `cd moy-n8n && npm run doctor` (контейнеры, шимы, `NO_PROXY`, тестовый рендер PNG, smoke-рендер Remotion)
- После обновления n8n `update_n8n.sh` сам прогоняет `remotion --help` / `render-html --help` и пишет в Telegram, если что-то не отвечает.
