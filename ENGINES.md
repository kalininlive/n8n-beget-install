# ENGINES.md — движки рендера на сервере n8n

> **2026-11-16:** движки монтажа kraft-reel и montage-v2 (и audio-prep) из установщика убраны — это индивидуальная настройка каждого. Разделы о них ниже — история.


> С 27.09.2026 воркфлоу GENESIS перенумерованы (55/56/57 → 19/20/21, 1 START → 3 START и т. д.) — таблица `genesis-n8n/docs/workflow-numbering.md`.

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
- Рантайм: образ `n8n-media-render` — `@remotion/cli`, `remotion`, `hyperframes`, `gsap` глобально, Chromium `/usr/bin/chromium`, ffmpeg.
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
1. LLM-блок как у маскота (Исследователь с Jina AI Search/Supabase → Судья → Копирайтер, либо Адаптер готового текста) → JSON контента (обложка, 3–7 смысловых слайдов, финал, подпись поста) → Арт-директор (стиль из 4, позы маскота, стикеры).
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
**GSAP в HTML** (есть в образе по умолчанию, версия — `ARG GSAP_VERSION` в `Dockerfile.render`):
```html
<script src="file:///opt/engines/vendor/gsap/gsap.min.js"></script>
<script src="file:///opt/engines/vendor/gsap/ScrollTrigger.min.js"></script> <!-- плагины из той же папки -->
```
В Node-скриптах контейнера `require('gsap')` / `import gsap from 'gsap'` работает через `NODE_PATH=/usr/local/lib/node_modules`. CDN-ссылки на GSAP не использовать — см. ниже про прокси и `networkidle0`.

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

## 3. Распознавание речи — faster-whisper

**Что это.** Контейнер `faster-whisper` (образ `ghcr.io/speaches-ai/speaches:0.8.3-cpu`, open-source, MIT) — сервер над библиотекой [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Модели Whisper открытые, скачиваются один раз с HuggingFace в том `whisper-models`, дальше всё считается на CPU сервера: без ключей, без оплаты, файлы наружу не уходят. «OpenAI-совместимый» — только формат запроса.

**Настройки (`.env`).** `WHISPER_MODEL` (по умолчанию `Systran/faster-whisper-small`; точнее — `Systran/faster-whisper-medium`, `deepdml/faster-whisper-large-v3-turbo-ct2`), `WHISPER_CPU_THREADS=4`, `WHISPER_TTL=600` (секунд до выгрузки модели из RAM), `WHISPER_MEM_LIMIT=3g`. Смена модели: правка `.env` → `docker compose up -d faster-whisper && bash install-extras.sh` (скачает модель).

**Как вызывать из n8n.**
- Шим (Execute Command), файл должен лежать в `/data`:
  ```
  whisper /data/genesis/<job>/video.mp4 ru          # язык необязателен (автоопределение)
  ```
  stdout — JSON `verbose_json`: `text`, `language`, `duration`, `segments[]`, `words[{word,start,end}]`.
- HTTP Request: `POST http://faster-whisper:8000/v1/audio/transcriptions`, multipart: `file` (binary), `model`, `language`, `response_format=verbose_json`, `timestamp_granularities[]=word`.
- Нода OpenAI → Audio → Transcribe: Base URL `http://faster-whisper:8000/v1`, ключ любой.

**Замер (25.09.2026, сервер 4 CPU / 6 ГБ, ролик 56 с, русский).** `small`: 28–34 с, ошибается в редких словах («бронзированные» вместо «брендированные»). `large-v3-turbo`: 44 с (холодный старт 53 с, загрузка модели 8,6 с), текст и пунктуация точнее. На сервере владельца стоит turbo; в шаблоне для клиентов — `small` (безопасно на слабых серверах), turbo включать при ≥ 4 CPU / 6 ГБ.

**Ресурсы.** Пока модель загружена: small ≈ 0.5–1 ГБ, medium ≈ 1.5 ГБ, large-v3-turbo ≈ 2 ГБ RAM. Не запускать параллельно с рендером Remotion на сервере с 6 ГБ.

**Проверка.** `bash install-extras.sh --check` (health, модель, сквозной тест edge-tts → whisper), `moy-n8n: npm run doctor`.

---

## 3а. Гибридный монтаж — montage-v2 (движок и audio-prep)

**Что это.** MONTAGE v2 GENESIS: JSON-план из каталога компонентов (агент-режиссёр) + слова whisper + видео спикера → ролик 1080×1920.
Сцены без спикера — HyperFrames, остальное — ffmpeg + libass. Код: `engines/montage-v2/` (README там же).

**Где лежит сейчас.** Пока **не запечён в образ**: копия в томе `/data/files/montage-v2/engine/montage-v2/`, запуск
`docker exec n8n-media-render sh /data/files/montage-v2/run.sh <jobDir> [ядра]`. Для прода: `COPY engines/montage-v2` в `Dockerfile.render`,
шим `montage-v2`. Браузер — общий с kraft-reel: `/data/files/hf-browser` (Chrome for Testing 152.0.7977.30, ставит `npm run deploy:kraft-reel`; в образе нет `unzip`).

**Формат.** `montage-v2 validate plan.json words.json` → `{ok, errors, warnings, plan}`; `montage-v2 render <jobDir>` → `{ok, out, ms, warnings}`.

**Audio-prep для GENESIS workflow 7 (добавлено 19.10.2026).** В томе `.../engine/montage-v2/` работают `audio-prep-service.mjs` и `audio-prep.mjs`; сервис слушает только внутренний порт 3387 контейнера `n8n-media-render` и вызывается HTTP-нодой воркфлоу. Bearer передаётся из n8n credential **«Auphonic API»**, ключ в файлы или образ не копируется. Перед созданием production helper проверяет `/api/user.json`; если аккаунт не подтверждён как бесплатный (`is_paying_user !== false`) или API/квота недоступны — сразу использует локальный FFmpeg, чтобы не расходовать платные кредиты. На подтверждённом бесплатном аккаунте Auphonic чистит и выравнивает голос, затем helper анализирует оригинал/результат, удаляет начальный бесплатный джингл, если синхронизация подтверждена, и вырезает длинные паузы по словам Whisper до дальнейших таймингов и монтажа. Исходное видео сохраняется. Вызов не публикует наружу порт 3387.

Auphonic Free заявляет 2 часа обработки в месяц, но тарификация одного production имеет минимум 3 минуты; учитывайте это при расчёте остатка месячной бесплатной квоты. API сообщает `is_paying_user` и платные credits в user info: если аккаунт платный, helper не запускает production автоматически.

Воркфлоу 7 и 19 используют общую команду `montage-v2 style-next` и счётчик `/data/files/genesis-video-style-cycle.json`, чтобы последовательные автоматические ролики чередовали 17 зарегистрированных стилей. Явно переданный стиль имеет приоритет. Рендер-область каждого пресета описана в `styles/*.json`; исходные 3D-камеры Remotion не включаются автоматически в старый рендерный конвейер.

---

## 3б. Крафт и голосовое → ролик — kraft-reel

**Что это.** Стиль «Крафт» для МАСКОТ (ролик без персонажа: бумага, линейный город, окна-приложения) + чистка голосовых
для режима 🎙 Голос в Маскоте и Крафте. Код: `engines/kraft-reel/` (README там же). Воркфлоу: `57 🟫 КРАФТ`, голосовая ветка в `55 МАСКОТ`.

**Стили.** `styles/<id>/` + `skins/` + `formats/` — данными; как добавить — `engines/kraft-reel/STYLES.md`. Цвет клиента — `profile.json → kraft.accent`.

**Где лежит.** Не запечён в образ: том `/data/files/kraft-reel/engine/kraft-reel/`, браузер HyperFrames — `/data/files/hf-browser/`
(Chrome for Testing 152.0.7977.30), шим `/opt/shims/kraft-reel`. Всё ставит `moy-n8n: npm run deploy:kraft-reel [-- --env .env.client-<имя>] [-- --test]`.
Зависимости из образа/стека: `n8n-media-render` (node, ffmpeg, `hyperframes`, gsap), `faster-whisper` + шим `whisper` (для голоса).

**Команды.** `kraft-reel catalog --md` (сцены для агента) · `validate plan.json words.json` · `render <jobDir> --out f.mp4` (jobDir: plan.json,
words.json, voice.*) · `voice-cut <src> <cut.json> --out f.mp3` (куски речи + вырезание пауз по звуку, шумодав, −14 LUFS, новые тайминги слов).

**Ресурсы.** Рендер 51 с ролика ≈ 3 мин 10 с на 4 CPU (HyperFrames, 3 воркера); чистка голосового 73 с → 2–3 с, whisper — около длительности записи.

---

## 4. Проверка всех движков одной командой

- На сервере: `bash /opt/n8n-install/install-extras.sh --check`
- С ПК: `cd moy-n8n && npm run doctor` (контейнеры, шимы, `NO_PROXY`, тестовый рендер PNG, smoke-рендер Remotion)
- После обновления n8n `update_n8n.sh` сам прогоняет `remotion --help` / `render-html --help` и пишет в Telegram, если что-то не отвечает.

## Уборка результатов после workflow 7/19
Успешный workflow 7 вызывает /opt/shims/cleanup-genesis-job для своего каталога задачи только после доставки итогового видео и сохранения ссылок. Успешный workflow 19 удаляет файлы своего рендера/озвучки/props/превью после Telegram send. Периодическая cleanup_data.sh остаётся страховкой для сбоев и незавершённых задач.

## 2026-10-19 — montage-v2 0.5.2
- Исправлена оценка размера PCM stdout для Auphonic alignment: 8 kHz mono float32 плюс 1 MiB запаса по длительности исходного видео, вместо стандартного 1 MiB для файлов любой длины.
- Ранее в 0.5.1 добавлены safe-area fitting длинных заголовков и порог отбора B-roll 0.30.
- Live workflow 7 active/47 нод. Синтетический рендер с длинным заголовком прошёл, временная задача удалена. Реальный Auphonic-запуск после исправления пока не выполнялся.


## 2026-10-20 — montage-v2 0.5.4 assets
- `engines/montage-v2/fonts/`: объединённые reference шрифты Unbounded Black/ExtraBold и Inter Regular/Bold/ExtraBold с OFL notices; renderer задаёт `fontsdir` для libass и копирует файлы в HyperFrames slide assets.
- `engines/montage-v2/hyperframes/components/`: переданы 236 component HTML и `registry-item.json` из проекта-референса. Это библиотека исходников для явного подключения при разработке scene; renderer не исполняет весь каталог автоматически.
- Выкатка на `n8n-media-render`: workflow 7 синтетически проверен, Beat-Cards captions и HyperFrames `slide_full` отрисованы; workflow active.

## 2026-10-20 — montage-v2 0.5.5 (EDL, snapToVoice, VideoProfile, QA-инспектор)
- **Точная нарезка пауз (`edit-edl.mjs`):**
  - Алгоритм `snapToVoice` прижимает границы слов Whisper к фактической огибающей речи, удаляя искусственно растянутую тишину на краях слов.
  - Адаптивный RMS-порог тишины ($p_{10} + 0.35 \times (p_{95} - p_{10})$) рассчитывается по 10-мс окнам звука, устраняя проблему комнатного шума и несрабатывания жесткого порога `-35 dB`.
  - Нарезка пауз >0.18 с до 0.10 с (0.22 с после завершения предложений) и сквозной пересчет таймкодов всех слов субтитров.
- **Профили холста и Safe Zones (`video-profile.mjs`):**
  - Поддержка профилей `vertical-9x16-v1` (1080×1920), `vertical-9x16-720p`, `landscape-16x9-v1`, `square-1x1-v1`.
  - Защитные зоны интерфейсов соцсетей (верх 180px, правая колонка кнопок 160px, нижняя плашка описания 420px) и отдельная зона субтитров.
  - Геометрическая валидация `validateLayoutBounds` против вылета элементов за безопасные границы.
- **Визуальный QA-инспектор (`qa-inspector.mjs`):**
  - Расчет контрольных таймкодов по сценам (`planInspectionTimestamps`), генерация контакт-листа (`buildContactSheet` через FFmpeg `xstack`).
  - Структурированный промпт для Vision QA модели с типизированным обнаружением артефактов (`text_clipped`, `outside_safe_area`, `overlap`, `face_obscured`).
- **Ротация стилей (`cli.mjs style-next`):**
  - Исключение стиля маскота `genesis-mascot-explainer` для Workflow 7 (закреплен за Workflow 19).
  - Скользящее окно истории (последние 3 стиля) с атомарной блокировкой для исключения дублирования стиля в двух видео подряд.
  - Оптимизация запуска CLI (lazy-load тяжелых модулей без зависимости от `fontkit`).
- **Статус выкатки:**
  - Развёрнуто на сервере в `/opt/n8n-install/data/files/montage-v2/engine/montage-v2/`.
  - Контейнер `n8n-media-render` перезапущен.
  - Сервис `audio-prep` верифицирован через вызов из `n8n-app` (HTTP 401 unauth при запросе без токена).
  - 10 unit-тестов модуля `montage-v2` успешно пройдены (100% pass).
