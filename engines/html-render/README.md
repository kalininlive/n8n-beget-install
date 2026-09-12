# html-render — движок HTML → PNG для n8n

Универсальный рендер HTML-слайдов в PNG (карусели 1080×1350 @2x, обложки, посты).
Работает внутри контейнера `n8n-media-render` на `puppeteer-core` + системном Chromium (`/usr/bin/chromium`),
никаких браузеров не скачивает. Запекается в образ через `Dockerfile.render`
(`COPY engines/html-render /opt/engines/html-render` + `npm ci --omit=dev`).

## Вызов

```bash
# с хоста / из n8n Execute Command (шим)
/opt/shims/render-html /data/carousel/jobs/<runId> [--width 1080] [--height 1350] [--scale 2] [--out <dir>]

# внутри контейнера
node /opt/engines/html-render/render.mjs /data/carousel/jobs/<runId>
```

- В папке задачи лежат `slide_01.html … slide_NN.html` (любые `*.html`, сортировка натуральная: 1, 2, …, 10).
- Для каждого файла: `page.goto(file://…, waitUntil: ['load','networkidle0'])` → `document.fonts.ready` → `page.screenshot({type:'png'})`.
- PNG кладутся рядом (`slide_01.png`) или в `--out`.
- Один Chromium на всю задачу, флаги `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-web-security --allow-file-access-from-files --font-render-hinting=none`.
- Прогресс — в **stderr**, результат — **один JSON в stdout** (n8n парсит его из `stdout` ноды Execute Command):

```json
{"ok":true,"engine":"html-render 1.0.0","jobDir":"/data/carousel/jobs/1757…","out":"/data/carousel/jobs/1757…",
 "width":1080,"height":1350,"scale":2,"count":8,"ms":4210,
 "slides":[{"html":"…/slide_01.html","png":"…/slide_01.png","bytes":428705}, …]}
```

При ошибке — `{"ok":false,"error":"…"}` и код выхода 1. `--help` / `--version` не запускают браузер (используются в health-check).

## Шрифты и ассеты

- Шрифты каруселей: `fonts/*.woff2` + `fonts/fonts.css` (Inter 400–900, Manrope 700/800, Montserrat 400/700/900, Rubik 700–900, Unbounded 700–900; cyrillic+latin).
  На сервере они копируются в `/data/studio-engine/public/fonts/` — общую папку шрифтов с маскотом — и подключаются в HTML так:
  `<link rel="stylesheet" href="file:///data/studio-engine/public/fonts/fonts.css">`.
- Персонаж, стикеры, иконки — те же, что у маскота: `file:///data/studio-engine/public/assets/{characters,stickers,icons,emojis,brand_logos}/…`.
- Шаблоны/стили каруселей на сервере не хранятся — они живут в Code-нодах воркфлоу n8n.

## Как n8n готовит задачу

Code-нода собирает HTML каждого слайда и команду вида:

```js
const runId = Date.now();
const jobDir = `/data/carousel/jobs/${runId}`;
const writes = slides.map((html, i) => {
  const name = `slide_${String(i + 1).padStart(2, '0')}.html`;
  const b64 = Buffer.from(html, 'utf-8').toString('base64');
  return `echo '${b64}' | base64 -d > ${jobDir}/${name}`;
}).join(' && ');
const renderCommand = `mkdir -p ${jobDir} && ${writes} && /opt/shims/render-html ${jobDir}`;
```

Execute Command выполняет `renderCommand`; следующая Code-нода делает `JSON.parse($json.stdout)` и читает `slides[].png`
через Read Binary File (путь `/data/...` разрешён `N8N_RESTRICT_FILE_ACCESS_TO=/data`). После публикации — `rm -rf ${jobDir}`.

## Локальная отладка (Windows/macOS)

```bash
cd engines/html-render && npm ci
PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node render.mjs ./job --out ./out
```

## Обновление

Изменить `render.mjs` / `package.json` в репо → `docker compose build n8n-media-render && docker compose up -d n8n-media-render`
(из `moy-n8n`: `npm run deploy:html-render`). Другие сервисы не трогаются.
