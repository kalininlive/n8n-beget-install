#!/usr/bin/env node
// html-render — универсальный движок HTML → PNG для n8n (карусели, обложки, посты).
//
// Вход:  папка задачи с файлами slide_01.html … slide_NN.html (любые *.html).
// Выход: рядом (или в --out) slide_01.png … slide_NN.png + JSON-отчёт в stdout.
//
// Эталон поведения — D:/CLAUDE CODE/carusel_dayly_agent/build.mjs: один Chromium
// на всю задачу, viewport 1080x1350 @ 2x, ожидание load + networkidle0 + document.fonts.ready.
//
// Запуск из n8n через шим:  /opt/shims/render-html /data/carousel/jobs/<runId> [опции]
// Запуск внутри контейнера: node /opt/engines/html-render/render.mjs <jobDir> [опции]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const DEFAULTS = {
  width: 1080,
  height: 1350,
  scale: 2,
  timeout: 30000,
  pattern: '*.html',
};

const HELP = `html-render ${pkg.version} — HTML → PNG (puppeteer-core + системный Chromium)

Использование:
  render.mjs <jobDir> [--width 1080] [--height 1350] [--scale 2] [--out <dir>]
                      [--timeout 30000] [--pattern "*.html"] [--quiet]

Аргументы:
  <jobDir>        папка с HTML-слайдами (например /data/carousel/jobs/1757000000000)
  --width         ширина viewport в CSS-пикселях      (по умолчанию ${DEFAULTS.width})
  --height        высота viewport в CSS-пикселях      (по умолчанию ${DEFAULTS.height})
  --scale         deviceScaleFactor (2 = Retina)      (по умолчанию ${DEFAULTS.scale})
  --out           куда класть PNG                     (по умолчанию рядом с HTML)
  --timeout       таймаут загрузки страницы, мс       (по умолчанию ${DEFAULTS.timeout})
  --pattern       glob-маска файлов (только * и ?)    (по умолчанию ${DEFAULTS.pattern})
  --quiet         не писать прогресс в stderr
  --help, -h      эта справка
  --version, -v   версия движка

Вывод (stdout) — один JSON-объект:
  { "ok": true, "jobDir": "...", "out": "...", "width": 1080, "height": 1350, "scale": 2,
    "count": 8, "ms": 4210, "slides": [ { "html": ".../slide_01.html", "png": ".../slide_01.png", "bytes": 512345 }, ... ] }
При ошибке: { "ok": false, "error": "..." } и код выхода 1.

Переменные окружения:
  PUPPETEER_EXECUTABLE_PATH   путь к Chromium (по умолчанию /usr/bin/chromium)
`;

function parseArgs(argv) {
  const opts = { ...DEFAULTS, out: null, quiet: false, jobDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Опция ${a} требует значение`);
      return v;
    };
    switch (a) {
      case '--help': case '-h': opts.help = true; break;
      case '--version': case '-v': opts.version = true; break;
      case '--quiet': case '-q': opts.quiet = true; break;
      case '--width': opts.width = Number(next()); break;
      case '--height': opts.height = Number(next()); break;
      case '--scale': opts.scale = Number(next()); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--out': opts.out = next(); break;
      case '--pattern': opts.pattern = next(); break;
      default:
        if (a.startsWith('--')) throw new Error(`Неизвестная опция: ${a}`);
        if (opts.jobDir) throw new Error(`Лишний аргумент: ${a}`);
        opts.jobDir = a;
    }
  }
  return opts;
}

function globToRegExp(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

function listHtml(dir, pattern) {
  const re = globToRegExp(pattern);
  return fs.readdirSync(dir)
    .filter((f) => re.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`❌ ${e.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) { process.stdout.write(HELP); return; }
  if (opts.version) { process.stdout.write(`${pkg.version}\n`); return; }
  if (!opts.jobDir) { process.stderr.write(HELP); process.exit(2); }

  for (const k of ['width', 'height', 'scale', 'timeout']) {
    if (!Number.isFinite(opts[k]) || opts[k] <= 0) fail(`Некорректное значение --${k}: ${opts[k]}`);
  }

  const jobDir = path.resolve(opts.jobDir);
  if (!fs.existsSync(jobDir) || !fs.statSync(jobDir).isDirectory()) fail(`Папка задачи не найдена: ${jobDir}`);
  const outDir = opts.out ? path.resolve(opts.out) : jobDir;
  fs.mkdirSync(outDir, { recursive: true });

  const files = listHtml(jobDir, opts.pattern);
  if (files.length === 0) fail(`В ${jobDir} нет файлов по маске ${opts.pattern}`);

  const log = opts.quiet ? () => {} : (s) => process.stderr.write(s);
  log(`🎨 html-render ${pkg.version}: ${files.length} файл(ов), ${opts.width}x${opts.height} @ ${opts.scale}x\n`);

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
  if (!fs.existsSync(executablePath)) fail(`Chromium не найден: ${executablePath} (задайте PUPPETEER_EXECUTABLE_PATH)`);

  const puppeteer = (await import('puppeteer-core')).default;
  const started = Date.now();
  let browser;
  const slides = [];
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',        // в docker /dev/shm маленький — иначе падает на больших страницах
        '--disable-web-security',         // как в build.mjs: file:// → file:// (локальные шрифты, картинки)
        '--allow-file-access-from-files',
        '--font-render-hinting=none',
        '--hide-scrollbars',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: opts.scale });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const htmlPath = path.join(jobDir, file);
      const pngPath = path.join(outDir, file.replace(/\.html?$/i, '') + '.png');
      log(`⏳ [${i + 1}/${files.length}] ${file} … `);

      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: ['load', 'networkidle0'], timeout: opts.timeout });
      await page.evaluateHandle('document.fonts.ready');
      await page.screenshot({ path: pngPath, type: 'png', omitBackground: false });

      const bytes = fs.statSync(pngPath).size;
      slides.push({ html: htmlPath, png: pngPath, bytes });
      log(`✅ ${path.basename(pngPath)} (${(bytes / 1024).toFixed(0)} KB)\n`);
    }
  } catch (e) {
    fail(`${e.message || e}`, { jobDir, out: outDir, done: slides });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const ms = Date.now() - started;
  log(`🎉 Готово: ${slides.length} PNG за ${(ms / 1000).toFixed(2)}с → ${outDir}\n`);
  process.stdout.write(JSON.stringify({
    ok: true,
    engine: `html-render ${pkg.version}`,
    jobDir,
    out: outDir,
    width: opts.width,
    height: opts.height,
    scale: opts.scale,
    count: slides.length,
    ms,
    slides,
  }) + '\n');
}

function fail(message, extra = {}) {
  process.stderr.write(`❌ ${message}\n`);
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }) + '\n');
  process.exit(1);
}

main().catch((e) => fail(e?.stack || String(e)));
