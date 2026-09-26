#!/usr/bin/env node
// MONTAGE v2 — движок гибридного монтажа (HyperFrames для сцен без спикера + ffmpeg/libass для остального).
//
//   montage-v2 validate <plan.json> <words.json> [--duration 31.2]
//       проверка плана агента: stdout {ok, errors[], warnings[], plan} (plan — с посчитанными *_at). Код 1, если errors.
//   montage-v2 render <jobDir> [--out <file.mp4>] [--workers 2] [--preset veryfast] [--keep]
//       jobDir: plan.json, words.json, speaker.mp4 (+ файлы b-roll из scenes[].src: путь от jobDir или абсолютный /data/...).
//       stdout {ok, out, duration, ms:{validate,build,hyperframes,ffmpeg,total}, warnings, plan}; прогресс — в stderr.
//   montage-v2 catalog [--md]
//       всё, что должен знать агент-режиссёр: стили, форматы, компоненты, поля, лимиты, иконки, правила, пример (JSON или markdown для промпта).
//   montage-v2 --version
//
// --skin "#RRGGBB" | <имя> (validate/render) — цвет бренда клиента поверх plan.skin (когда бренд-кит задаёт цвет жёстко).
// words.json: [{t,e,w}] (с), whisper verbose_json ({words:[{word,start,end}]}) или AssemblyAI [{text,start,end}] (мс).
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { validate } from './validate.mjs';
import { build, bgGeq } from './render.mjs';
import { agentSpec } from './catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version;
const GSAP = process.env.MV2_GSAP || '/opt/engines/vendor/gsap/gsap.min.js';
const CACHE = process.env.MV2_CACHE || '/data/files/montage-v2/cache';

const out = o => { process.stdout.write(JSON.stringify(o) + '\n'); };
const fail = (msg, extra = {}) => { out({ ok: false, error: msg, ...extra }); process.exit(1); };
const log = m => process.stderr.write(`[montage-v2] ${m}\n`);
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = name => argv.includes(name);

export function loadWords(raw) {
  const arr = Array.isArray(raw) ? raw : raw?.words || raw?.segments?.flatMap(s => s.words || []) || [];
  if (!arr.length) return [];
  const ms = arr.some(w => (w.end ?? w.e ?? 0) > 1000) && !('t' in arr[0]); // AssemblyAI — миллисекунды
  return arr.map(w => ({
    t: +(w.t ?? w.start) / (ms ? 1000 : 1),
    e: +(w.e ?? w.end) / (ms ? 1000 : 1),
    w: String(w.w ?? w.word ?? w.text ?? '').trim(),
  })).filter(w => w.w && Number.isFinite(w.t)).map(w => ({ ...w, t: Math.round(w.t * 100) / 100, e: Math.round(w.e * 100) / 100 }));
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(`не прочитан ${f}: ${e.message}`); } };
const probeDur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const now = () => Date.now();

function skinBg(skin) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `bg_${[skin.brandLight, skin.brand, skin.brandDeep].join('').replace(/#/g, '')}.png`);
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=1080x1920:d=1', '-frames:v', '1', '-vf', bgGeq(skin), f]);
  return f;
}

async function main() {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n'); return; }
  if (cmd === '--version') { out({ engine: 'montage-v2', version: VERSION }); return; }

  if (cmd === 'catalog') {
    const spec = agentSpec();
    if (!flag('--md')) { out(spec); return; }
    const L = [];
    L.push('## Стили'); for (const s of spec.styles) L.push(`- **${s.id}** — ${s.name}. ${s.description} Подходит: ${s.fits}.`);
    L.push('', '## Форматы'); for (const f of spec.formats) L.push(`- **${f.id}** (стиль ${f.style}) — ${f.name}. ${f.description} Компоненты: ${f.components.join(', ')}.`);
    L.push('', '## Компоненты (поле "c")'); for (const [id, c] of Object.entries(spec.components)) L.push(`- **${id}** ${c.duration[0]}–${c.duration[1]} с — ${c.use}. Поля: ${Object.keys(c.fields).join(', ') || '—'}${c.object ? `; object: ${c.object.join(' | ')}${c.objectOptional ? ' (необязателен)' : ''}` : ''}.`);
    L.push('', '## Объекты'); for (const [id, o] of Object.entries(spec.objects)) L.push(`- **${id}** — ${o.use}`);
    L.push('', '## Иконки cards_trio', spec.icons.join(', '), '', '## Правила'); spec.rules.forEach(r => L.push(`- ${r}`));
    L.push('', '## Цвет', spec.skin, '', '## Пример плана', '```json', JSON.stringify(spec.plan_example), '```');
    process.stdout.write(L.join('\n') + '\n'); return;
  }

  if (cmd === 'validate') {
    const [, planF, wordsF] = argv;
    if (!planF || !wordsF) fail('нужно: validate <plan.json> <words.json>');
    const plan = readJson(planF); if (opt('--skin')) plan.skin = opt('--skin');
    const r = validate(plan, loadWords(readJson(wordsF)), { duration: +opt('--duration', 0) || undefined });
    delete r.plan.skinResolved;
    out(r); process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'render') {
    const job = path.resolve(argv[1] || '');
    if (!argv[1] || !fs.existsSync(job)) fail(`папка задачи не найдена: ${argv[1]}`);
    const T = { start: now() };
    const planIn = readJson(path.join(job, 'plan.json'));
    if (opt('--skin')) planIn.skin = opt('--skin');
    const words = loadWords(readJson(path.join(job, 'words.json')));
    const speaker = path.join(job, planIn.speaker || 'speaker.mp4');
    if (!fs.existsSync(speaker)) fail(`нет видео спикера: ${speaker}`);
    for (const s of planIn.scenes || []) if (s.src) { s.src = path.isAbsolute(s.src) ? s.src : path.join(job, s.src); if (!fs.existsSync(s.src)) fail(`нет файла b-roll: ${s.src}`); }
    const duration = planIn.duration || Math.floor(probeDur(speaker) * 30) / 30;
    const v = validate(planIn, words, { duration, render: true });
    if (!v.ok) { out({ ok: false, error: 'план не прошёл проверку', errors: v.errors, warnings: v.warnings }); process.exit(1); }
    T.validate = now();
    const skin = v.plan.skinResolved; delete v.plan.skinResolved;
    const wd = path.join(job, 'mv2');
    fs.rmSync(wd, { recursive: true, force: true });
    const b = build({ plan: v.plan, words, skin, speaker, outDir: wd, bgPng: skinBg(skin), gsap: GSAP });
    fs.writeFileSync(path.join(wd, 'plan.resolved.json'), JSON.stringify(v.plan, null, 1));
    T.build = now();
    log(`план ок: ${v.plan.scenes.length} сцен, ${duration} с; ASS ${b.stats.assEvents} событий; слайдов HF: ${b.hfJobs.length}`);

    const workers = opt('--workers', process.env.MV2_WORKERS || '2');
    for (const id of b.hfJobs) {
      log(`HyperFrames: ${id}`);
      const r = spawnSync('hyperframes', ['render', '-o', path.join(wd, 'slides', `${id}.mp4`), '--no-low-memory-mode', '--workers', workers],
        { cwd: path.join(wd, 'slides', id), env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1' }, encoding: 'utf8', maxBuffer: 64 << 20 });
      fs.writeFileSync(path.join(wd, `hf-${id}.log`), (r.stdout || '') + (r.stderr || ''));
      if (r.status !== 0 || !fs.existsSync(path.join(wd, 'slides', `${id}.mp4`))) fail(`HyperFrames упал на ${id}`, { log: path.join(wd, `hf-${id}.log`), tail: ((r.stdout || '') + (r.stderr || '')).slice(-1500) });
    }
    T.hyperframes = now();

    const outFile = path.resolve(opt('--out', path.join(job, 'montage_v2.mp4')));
    log('ffmpeg: сборка');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...b.inputs, '-filter_complex_script', path.join(wd, 'filter.txt'),
      '-map', '[vout]', '-map', '0:a?', '-t', String(duration), '-c:v', 'libx264', '-preset', opt('--preset', 'veryfast'), '-crf', '20', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile];
    fs.writeFileSync(path.join(wd, 'ffmpeg.args.json'), JSON.stringify(args));
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) fail('ffmpeg упал', { tail: (r.stderr || '').slice(-2000) });
    T.ffmpeg = now();
    if (!flag('--keep')) for (const id of b.hfJobs) fs.rmSync(path.join(wd, 'slides', id, 'assets'), { recursive: true, force: true });
    const sec = (a, bb) => Math.round((T[bb] - T[a]) / 100) / 10;
    out({ ok: true, engine: 'montage-v2', version: VERSION, out: outFile, duration, scenes: v.plan.scenes.length, style: v.plan.style, format: v.plan.format, skin,
      ms: { validate: sec('start', 'validate'), build: sec('validate', 'build'), hyperframes: sec('build', 'hyperframes'), ffmpeg: sec('hyperframes', 'ffmpeg'), total: sec('start', 'ffmpeg') },
      warnings: v.warnings, workDir: wd });
    return;
  }
  fail(`неизвестная команда "${cmd}" (catalog | validate | render | --version | --help)`);
}
main().catch(e => fail(e.stack || String(e)));
