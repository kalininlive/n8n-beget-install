# kraft-reel — стиль «Крафт» для МАСКОТ (ролик без маскота)

Голос + пословные тайминги + план агента → вертикальный ролик 1080×1920 / 30 fps на HyperFrames + GSAP.
Тёплая бумага с зерном, внизу линейный пейзаж, который рисуется заново в каждой сцене (город / посёлок / парк, случайно по seed).
Сверху стайки птиц. Акцент оранжевый, окна-приложения тёмные. Текст появляется в момент, когда звучит слово.
Пилот и разбор референса: `genesis-n8n/pilot/mascot-paper/` (README, `paper-pilot-v2.mp4`).

## Команды

```bash
kraft-reel catalog --md                       # сцены, поля, лимиты, правила — вставляется в промпт агента-режиссёра
kraft-reel validate plan.json words.json      # {ok, errors, warnings, plan}; мелочи чинит с warning
kraft-reel render <jobDir> --out /data/…/kraft.mp4 --cover /data/…/cover.jpg [--workers 3] [--seed N]
kraft-reel --version
```
`jobDir`: `plan.json`, `words.json`, `voice.(mp3|m4a|ogg|opus|wav)`. Голос нормализуется до −14 LUFS.
`words.json` — `[{w,s,e}]`, ответ edge-tts `speech-with-timestamps` (`words:[{word,start,end}]`) или whisper verbose_json.

## План агента

```json
{ "handle": "@websansay", "seed": 123, "colors": { "acc": "#D97454" },
  "scenes": [ { "type": "hook_link", "w": [0, 13], "headline": "Этот *GENESIS* бот …", "pills": ["в любом стиле"] }, … ] }
```
`w` — индексы первого и последнего слова сцены в `words.json`. Сцены подряд, без дыр. Типы: `hook_link`, `title`,
`window` (`content.kind`: `code` | `gallery` | `stats` | `bars`), `thought`, `question`, `radial`, `cta`. Лимиты — `catalog.mjs`.

## Файлы

| Файл | Что |
|---|---|
| `cli.mjs` | команды, подготовка jobDir, вызов `hyperframes render`, обложка |
| `catalog.mjs` | каталог сцен для агента (источник правды лимитов) |
| `validate.mjs` | проверка плана, индексы слов → секунды |
| `render.mjs` | план → `index.html` (сцены, переходы, эмиттер карточек) |
| `lib/city.mjs` | генератор пейзажей и птиц (seed) |
| `lib/mini.mjs` | мини-экраны для карточек |
| `lib/style.css` | вёрстка стиля (`${токены}` палитры) |
| `tests/pilot/` | план пилота (51 с) для замеров и регрессии |

На сервере движок живёт в томе `/data/files/kraft-reel/engine/kraft-reel`, шим `/opt/shims/kraft-reel`.
Выкатка: `moy-n8n` → `npm run deploy:kraft-reel [-- --test]`.
