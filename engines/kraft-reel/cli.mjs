#!/usr/bin/env node
// kraft-reel — ролики стиля «Крафт» (МАСКОТ без маскота): голос + пословные тайминги + план агента → HyperFrames.
//
//   kraft-reel catalog [--md] [--style kraft] [--format universal]
//       сцены, поля, лимиты, правила и пример плана для агента-режиссёра — только разрешённые стилем и форматом
//   kraft-reel styles [--all]
//       стили (утверждённые; --all — и черновики), скины, форматы — для людей и для скрипта меню бота
//   kraft-reel validate <plan.json> <words.json> [--duration 51.2]
//       stdout {ok, errors[], warnings[], plan} — plan с посчитанными start/end. Код 1, если errors.
//   kraft-reel render <jobDir> [--out file.mp4] [--cover file.jpg] [--workers 3] [--seed N] [--skin имя|#RRGGBB] [--draft] [--keep]
//       jobDir: plan.json, words.json, voice.(mp3|m4a|ogg|wav|opus). stdout {ok, out, cover, duration, ms, warnings}; прогресс — в stderr.
//   kraft-reel voice-cut <src> <cut.json> --out voice.mp3 [--b64]
//       чистка голосового: оставить куски cut.segments, шумодав, −14 LUFS; stdout {ok, out, duration, words:[{word,start,end}], audio_base64?}
//   kraft-reel --version
//
// words.json: [{w,s,e}] (с), edge-tts {words:[{word,start,end}]}, whisper verbose_json ({words|segments[].words}).
// В plan.json: style (kraft), format (universal|short), skin (имя скина или "#RRGGBB" акцента), colors ({acc, bg1, …}), handle ("@ник"), seed.
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { validate } from './validate.mjs';
import { buildHtml } from './render.mjs';
import { agentSpec, agentMd } from './catalog.mjs';
import { styles, skins, formats } from './styles.mjs';
import { hash } from './lib/city.mjs';
import { voiceCut } from './voice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version;
const GSAP = process.env.KRAFT_GSAP || '/opt/engines/vendor/gsap/gsap.min.js';
// браузер HyperFrames: env → /data/files/hf-browser (ставит deploy-kraft-reel) → старый путь пилота montage-v2
function findBrowser() {
  const cands = [process.env.HYPERFRAMES_BROWSER_PATH];
  const root = '/data/files/hf-browser/chrome-headless-shell';
  try { for (const v of fs.readdirSync(root).sort().reverse()) cands.push(path.join(root, v, 'chrome-headless-shell-linux64', 'chrome-headless-shell')); } catch { /* нет папки */ }
  cands.push('/data/files/montage-v2-pilot/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell');
  return cands.find((f) => f && fs.existsSync(f)) || '';
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const fail = (msg, extra = {}) => { out({ ok: false, error: msg, ...extra }); process.exit(1); };
const log = (m) => process.stderr.write(`[kraft-reel] ${m}\n`);
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(`не прочитан ${f}: ${e.message}`); } };
const probeDur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

export function loadWords(raw) {
  const arr = Array.isArray(raw) ? raw : raw?.words || raw?.segments?.flatMap((s) => s.words || []) || [];
  return arr.map((x) => ({
    w: String(x.w ?? x.word ?? x.text ?? '').trim().replace(/^[«"'(]+|[.,!?:;»"')…]+$/g, ''),
    s: Math.round(+(x.s ?? x.start ?? x.t) * 1000) / 1000,
    e: Math.round(+(x.e ?? x.end) * 1000) / 1000,
  })).filter((x) => x.w && Number.isFinite(x.s) && Number.isFinite(x.e));
}

function main() {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return;
  }
  if (cmd === '--version') return out({ engine: 'kraft-reel', version: VERSION, browser: findBrowser() || null });
  if (cmd === 'catalog') return flag('--md') ? process.stdout.write(agentMd(opt('--style'), opt('--format')) + '\n') : out(agentSpec(opt('--style'), opt('--format')));
  if (cmd === 'styles') return out({ styles: styles().filter((s) => flag('--all') || s.status === 'approved').map(({ dir, ...s }) => s), skins: skins().map((s) => ({ id: s.id, name: s.name })), formats: formats() });

  if (cmd === 'validate') {
    const [, pf, wf] = argv;
    if (!pf || !wf) fail('usage: validate <plan.json> <words.json>');
    const r = validate(readJson(pf), loadWords(readJson(wf)), { duration: +opt('--duration', 0) || undefined, draft: flag('--draft') });
    out(r);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'voice-cut') {
    const [, src, cf] = argv;
    if (!src || !cf) fail('usage: voice-cut <src> <cut.json> --out voice.mp3 [--b64]');
    const outFile = path.resolve(opt('--out', path.join(path.dirname(src), 'voice.mp3')));
    try {
      const r = voiceCut(src, readJson(cf), outFile);
      if (flag('--b64')) r.audio_base64 = fs.readFileSync(outFile).toString('base64');
      return out({ ok: true, ...r });
    } catch (e) { fail('voice-cut: ' + String(e.stderr || e.message).slice(-600)); }
  }

  if (cmd === 'render') {
    const T = { start: Date.now() };
    const job = path.resolve(argv[1] || fail('usage: render <jobDir>'));
    const voice = ['mp3', 'm4a', 'ogg', 'opus', 'wav'].map((x) => path.join(job, `voice.${x}`)).find((f) => fs.existsSync(f));
    if (!voice) fail(`нет voice.(mp3|m4a|ogg|opus|wav) в ${job}`);
    const words = loadWords(readJson(path.join(job, 'words.json')));
    const planIn = readJson(path.join(job, 'plan.json'));
    const duration = Math.round((probeDur(voice) + .5) * 100) / 100;
    const v = validate(planIn, words, { duration, draft: flag('--draft') });
    if (!v.ok) fail('план не прошёл проверку', { errors: v.errors, warnings: v.warnings });
    T.validate = Date.now();

    const wd = path.join(job, 'hf');
    fs.rmSync(wd, { recursive: true, force: true });
    fs.mkdirSync(path.join(wd, 'assets'), { recursive: true });
    // голос в m4a: HyperFrames надёжнее всего читает AAC
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', voice, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', path.join(wd, 'assets', 'voice.m4a')]);
    fs.copyFileSync(fs.existsSync(GSAP) ? GSAP : path.join(HERE, 'vendor', 'gsap.min.js'), path.join(wd, 'assets', 'gsap.min.js'));
    const plan = { ...v.plan, voice: 'assets/voice.m4a', handle: planIn.handle ?? '', colors: planIn.colors, skin: opt('--skin', planIn.skin),
      seed: +opt('--seed', planIn.seed ?? hash(words.map((w) => w.w).join(' '))) };
    fs.writeFileSync(path.join(wd, 'index.html'), buildHtml(plan));
    T.build = Date.now();

    const outFile = path.resolve(opt('--out', path.join(job, 'kraft.mp4')));
    log(`HyperFrames: ${plan.scenes.length} сцен, ${plan.duration} с`);
    const r = spawnSync('hyperframes', ['render', '-o', outFile, '--no-low-memory-mode', '--workers', opt('--workers', process.env.KRAFT_WORKERS || '3')],
      { cwd: wd, env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1', ...(findBrowser() ? { HYPERFRAMES_BROWSER_PATH: findBrowser() } : {}) }, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0 || !fs.existsSync(outFile)) fail('HyperFrames упал', { stderr: String(r.stderr || r.stdout).slice(-2000) });
    T.render = Date.now();

    let cover = null;
    if (opt('--cover')) {
      cover = path.resolve(opt('--cover'));
      const hook = plan.scenes[0], at = Math.min(hook.end - .3, Math.max(2.5, hook.start + (hook.end - hook.start) * .7));
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', outFile, '-frames:v', '1', '-q:v', '3', cover]);
    }
    if (!flag('--keep')) fs.rmSync(wd, { recursive: true, force: true });
    const sec = (a, b) => Math.round((T[b] - T[a]) / 100) / 10;
    return out({ ok: true, out: outFile, cover, duration: plan.duration, size_mb: Math.round(fs.statSync(outFile).size / 1e5) / 10,
      style: plan.style, format: plan.format, ms: { validate: sec('start', 'validate'), build: sec('validate', 'build'), render: sec('build', 'render'), total: sec('start', 'render') }, warnings: [...v.warnings, ...(plan.warnings || [])] });
  }
  fail(`неизвестная команда "${cmd}" (catalog | validate | render | --version | --help)`);
}
main();
