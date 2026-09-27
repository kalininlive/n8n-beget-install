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
kraft-reel voice-cut src.ogg cut.json --out voice.mp3   # режим 🎙 Голос: куски речи → чистый голос + новые тайминги
kraft-reel --version                          # версия и найденный браузер
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
| `voice.mjs` | чистка голосового: куски из cut.json, паузы > 0,2 с по звуку (silencedetect, порог = средняя громкость − 16 дБ) → 0,1 с |
| `tests/pilot/` | план пилота (51 с) для замеров и регрессии |

## Установка (свой сервер и клиенты)

```bash
cd moy-n8n
npm run deploy:kraft-reel -- --test                              # свой сервер, с тестовым рендером tests/pilot
npm run deploy:kraft-reel -- --env .env.client-<имя> --test      # сервер клиента (SERVER_HOST/ключ в env-файле)
```
Скрипт: движок из закоммиченного `HEAD` → том `/data/files/kraft-reel/engine/kraft-reel` (прошлая версия → `engine.prev`),
браузер Chrome for Testing → `/data/files/hf-browser` (копия с пилота или `npx @puppeteer/browsers install`), шим → `/opt/n8n-install/shims/kraft-reel`.
Нужно на сервере: `n8n-media-render` (hyperframes, ffmpeg), `faster-whisper` + шим `whisper` (режим Голос). Данных клиента движок не хранит.
Воркфлоу (57 и голосовая ветка 55) едут клиенту инсталлятором пакета `genesis-n8n/GENESIS/installer`.

Откат версии на сервере: `cp -a /opt/n8n-install/data/files/kraft-reel/engine.prev/kraft-reel /opt/n8n-install/data/files/kraft-reel/engine/`.
