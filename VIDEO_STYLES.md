# VIDEO_STYLES.md — стили и путь монтажа роликов

Единая карта: какие стили роликов уже есть, где они лежат и как проходит ролик от идеи до файла.
Подробные правила добавления — в `engines/kraft-reel/STYLES.md` и `engines/montage-v2/STYLES.md`.

## 1. Пути (что откуда запускается)

| Движок | Код в репо | Шим | Рантайм |
|---|---|---|---|
| Маскот (Remotion) | проект `studio-engine` (вне git) | `remotion`, `render-studio-reel` | `n8n-media-render`, том `/data/studio-engine` |
| Крафт + голос | `engines/kraft-reel/` | `kraft-reel` | том `/data/files/kraft-reel/engine/kraft-reel/`, браузер `/data/files/hf-browser` |
| Гибридный монтаж | `engines/montage-v2/` | `montage-v2` | том `/data/files/montage-v2/engine/montage-v2/` |
| Карусели | `engines/html-render/` | `render-html` | в образе `/opt/engines/html-render` |

## 2. Маршрут ролика

```
Telegram-бот (меню стилей) → статус → воркфлоу
  Маскот / Крафт:  сценарий → edge-tts (слова с таймкодами) → агент-режиссёр → validate → render → файл в Telegram
  Голос:           голосовое → whisper → AI-редактор (чистка текста) → kraft-reel voice-cut (паузы, шумодав, −14 LUFS) → дальше как выше
  MONTAGE v2:      видео спикера → audio-prep → whisper → EDL-нарезка пауз (snapToVoice) → агент-режиссёр (JSON-план)
                   → montage-v2 validate (до 2 повторов) → b-roll → render (HyperFrames + ffmpeg/libass) → QA-инспектор → Telegram
```

Агент-режиссёр узнаёт о стилях командой `catalog --md` при каждом запуске: новый стиль появляется у него сразу после выкатки движка, промпт руками не правится.

## 3. Уровни кастомизации

| Уровень | Что меняет | Код? |
|---|---|---|
| Цвет | акцент клиента (`kraft.accent`) или скин | нет |
| Декор | пейзажи, птицы, солнце, облака (Крафт) | нет |
| Формат | какие сцены разрешены, лимиты | нет |
| Стиль | палитра + вёрстка + набор сцен | CSS / JSON |
| Сцена (компонент) | новый тип сцены | JS |

## 4. kraft-reel (0.4.0)

| id | Название | Статус | Суть |
|---|---|---|---|
| `kraft` | Крафт | approved | тёплая бумага с зерном, линейный пейзаж рисуется заново в каждой сцене, оранжевый акцент, тёмные окна-приложения |
| `kraft-night` | Крафт · Ночь | draft | тёмная бумага, мятный акцент, только город (пример стиля без кода) |

Форматы: `short` (до 25 с), `universal`. Скины: `kraft`, `kraft-night`. Команды: `catalog`, `validate`, `render`, `voice-cut`, `styles`.
Статусы бота: `KRAFT_TEXT[:id]`, `KRAFT_LLM[:id]`, `KRAFT_VOICE[:id]`. Кнопки в меню — `moy-n8n: npm run styles:kraft -- --apply` (только `approved`).

## 5. montage-v2 (0.5.4) — 17 стилей, все approved

| id | Название | Вид |
|---|---|---|
| `reference` | Эталон: моушен-графика в цвете бренда | спикер чередуется с графикой каждые 2–5 с; слайды цвета бренда, спикер в круге/скруглённом прямоугольнике |
| `pro-montage-v3` | Pro-монтаж v3 | крупные читаемые карточки на весь экран |
| `beat-cards` | Beat-Cards | по одной карточке на бит, быстрая смена |
| `clean-ui` | Clean UI | светлый холст, карточки продукта |
| `hyperframes-explainer` | HyperFrames Explainer | минималистичные интерфейсные карточки |
| `genesis-mascot-explainer` | Genesis Mascot Explainer | карточки в цветах бренда (3D-маскот не рендерится; для Workflow 19) |
| `agentworld` | AgentWorld | тёмный технический мир, стеклянные карточки |
| `kinetic-promo` | Kinetic Promo | неон-градиент, стекло, высокая энергия |
| `synthwave` | Synthwave | фиолетово-маджентовый градиент, неон |
| `hudscan` | HudScan | сетка сканирования, циановые акценты |
| `matrixglitch` | MatrixGlitch | тёмно-зелёные сканлайны, глитч |
| `lowpoly3d` | LowPoly3D | гранёный фон, объёмные тени |
| `chalkboard` | Chalkboard | синяя сетка, меловой контраст |
| `newspaper` | Newspaper | тёплая бумага, редакционные карточки |
| `photo-story` | Photo Story | тёплые редакционные карточки, фото передаёт пользователь |
| `story-format` | Story Format | хук → развитие → вывод |
| `pixel8` | Pixel8 | пиксельная сетка, игровой ритм |

Формат: `expert` (тезис → кейс → цифра → призыв). Скин: `brand_blue`. Профили холста: `vertical-9x16-v1` (1080×1920), `vertical-9x16-720p`, `landscape-16x9-v1`, `square-1x1-v1` с защитными зонами соцсетей.
Ротация: `montage-v2 style-next` — стили чередуются, последние 3 не повторяются, стиль маскота закреплён за Workflow 19.
Ресурсы движка: `sfx/` — звуковые эффекты, `fonts/` — Unbounded, Inter.

## 6. Маскот и карусели

- **Маскот:** композиция `MascotFactoryReel` (Remotion), персонаж-позы, виджеты, субтитры по пословным таймкодам; режимы `MASCOT_TEXT` / `MASCOT_LLM` / `MASCOT_VOICE`.
- **Карусели:** 4 стиля (шаблоны вшиты в воркфлоу `mcarousel`), рендер `render-html`, шрифты `fonts.css`, GSAP локально.

## 7. Идея: сервис `/opt/montage` (не реализовано, на будущее)

Единое место для движков и стилей монтажа, чтобы новые добавлялись без правки образа:

```
/opt/montage/                 # монтируется в n8n-media-render как /opt/montage
├── engines/<name>/            # kraft-reel, montage-v2, будущие (каждый: cli.mjs, catalog, validate, render, package.json)
├── styles/<engine>/<id>/      # пакеты стилей данными: style.json (+ style.css), skins/, formats/
├── assets/                    # шрифты, sfx, библиотека компонентов
└── registry.json              # какие движки и стили активны, версии, status: draft|approved
```

Контракт: каждый движок отдаёт `catalog --md`, `validate`, `render` и `--version`; шим `montage <engine> <cmd>`. Меню бота строится из `registry.json` (только `approved`). Сейчас движки живут в `/data/files/{kraft-reel,montage-v2}`, перенос — отдельной задачей.

## 8. Задел под новый стиль монтажа

Новую систему монтажа удобнее строить как новый `styles/<id>` в `kraft-reel` (данные + CSS, без кода) или `montage-v2` (JSON + код сцен). Стартовая точка — разбор референса → HTML-пилот → ролик → утверждение владельцем (`status: "approved"`) → выкатка `deploy:kraft-reel` / `deploy:montage-v2` → кнопка в боте.
