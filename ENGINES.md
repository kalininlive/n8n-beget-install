# ENGINES.md — движки рендера на сервере n8n

> Все движки живут в одном контейнере **`n8n-media-render`** (`docker-compose.override.yml` → `Dockerfile.render`).
> n8n вызывает их из ноды **Execute Command** через шимы `/opt/shims/*` (папка `shims/` репо смонтирована в n8n-app и n8n-worker).
> Обмен файлами — общий том: на хосте `/opt/n8n-install/data` = `/data` в n8n-app, n8n-worker и media-render.
> Принцип: на сервере — только движки. Воркфлоу, стили роликов, шаблоны HyperFrames, проекты Remotion — индивидуальная настройка, каждый ставит свои.

| Шим | Что запускает |
|---|---|
| `remotion` | Remotion CLI 4.0.544 |
| `hyperframes` | HyperFrames 0.8.221 (браузер — `HYPERFRAMES_BROWSER_PATH`, ставит `install-extras.sh`) |
| `playwright`, `pw-node`, `pw-python` | Playwright 1.65.1: CLI, Node-скрипт, Python-скрипт |
| `ffmpeg`, `ffprobe`, `fc-scan` | ffmpeg + libass, fontconfig |
| `edge-tts`, `whisper` | озвучка и распознавание речи |
| `python`, `python3`, `yt-dlp` | утилиты в `n8n-tools` |

Шрифты: коллекция `/opt/fonts` (62 семейства с кириллицей) — см. [fonts/README.md](fonts/README.md).

---

## 1. Видео — Remotion и HyperFrames

**Рантайм.** Образ `n8n-media-render`: `@remotion/cli`, `remotion`, `hyperframes`, `gsap` глобально, Chromium `/usr/bin/chromium`, ffmpeg. `WORKDIR` = `/data`.

**Свои проекты** кладите в том `/data` (например `/data/files/my-remotion/`), зависимости ставьте внутри контейнера:
```bash
docker exec -it n8n-media-render sh -lc 'cd /data/files/my-remotion && npm ci'
/opt/n8n-install/shims/remotion render /data/files/my-remotion/src/index.ts MyComp /data/reels/out.mp4 --props=/data/reels/props.json
/opt/n8n-install/shims/hyperframes render -o /data/reels/out.mp4      # из папки проекта HyperFrames
```
Версии в `package.json` проекта Remotion должны совпадать по мажору с CLI. HyperFrames закреплён (`HYPERFRAMES_VERSION` в `Dockerfile.render`), автообновление выключено.

**GSAP в HTML** (есть в образе, без CDN):
```html
<script src="file:///opt/engines/vendor/gsap/gsap.min.js"></script>
```
В Node — `require('gsap')` через `NODE_PATH=/usr/local/lib/node_modules`.

**three.js 0.187.0** (3D / WebGL, только ES-модули):
```html
<script type="importmap">{"imports":{
  "three": "file:///opt/engines/vendor/three/build/three.module.min.js",
  "three/addons/": "file:///opt/engines/vendor/three/examples/jsm/"}}</script>
<script type="module">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
</script>
```
В Node — `import * as THREE from '/usr/local/lib/node_modules/three/build/three.module.js'` (ESM не читает `NODE_PATH`); `require('three')` тоже работает, но помечен устаревшим. Если браузер не грузит модули по `file://`, отдавайте папку проекта через локальный http-сервер (так делает HyperFrames при рендере).

---

## 2. Playwright

Node и Python, браузеры в образе (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Скрипты кладите в `/data`:
```bash
/opt/shims/playwright screenshot --full-page https://example.com /data/files/shot.png
/opt/shims/pw-node /data/files/scrape.js       # const { chromium } = require('playwright')
/opt/shims/pw-python /data/files/scrape.py     # from playwright.sync_api import sync_playwright
```
Прокси: Playwright сам не читает `HTTP_PROXY` — передайте `proxy: { server: process.env.HTTPS_PROXY }` в `launch()`, если сайтам нужен прокси.

---

## 3. Распознавание речи — faster-whisper

Контейнер `faster-whisper` (`ghcr.io/speaches-ai/speaches:0.8.3-cpu`, MIT): модели Whisper скачиваются один раз в том `whisper-models`, считается на CPU сервера, без ключей.

**Настройки (`.env`).** `WHISPER_MODEL` (`Systran/faster-whisper-small` по умолчанию; точнее — `Systran/faster-whisper-medium`, `deepdml/faster-whisper-large-v3-turbo-ct2`), `WHISPER_CPU_THREADS=4`, `WHISPER_TTL=600`, `WHISPER_MEM_LIMIT=3g`. Смена модели: правка `.env` → `docker compose up -d faster-whisper && bash install-extras.sh`.

**Вызов из n8n.**
- Шим: `whisper /data/files/video.mp4 ru` → JSON `verbose_json` (`text`, `segments[]`, `words[{word,start,end}]`).
- HTTP Request: `POST http://faster-whisper:8000/v1/audio/transcriptions` (multipart `file`, `model`, `language`, `response_format=verbose_json`, `timestamp_granularities[]=word`).
- Нода OpenAI → Audio → Transcribe: Base URL `http://faster-whisper:8000/v1`, ключ любой.

**Скорость (4 CPU / 6 ГБ, ролик 56 с).** `small` ≈ 30 с, `large-v3-turbo` ≈ 45 с и точнее. RAM: small ≈ 1 ГБ, turbo ≈ 2 ГБ.

---

## 4. Проверка всех движков

- `bash /opt/n8n-install/install-extras.sh --check` — контейнеры, шимы, `NO_PROXY`, браузеры, Playwright, шрифты, тестовый рендер HTML → PNG через Playwright, сквозной тест edge-tts → whisper.
- После обновления n8n `update_n8n.sh` сам проверяет движки и пишет в Telegram, если что-то не отвечает.
