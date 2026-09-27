// voice-cut: вырезать из голосового лишнее (паразиты, оговорки, паузы) и пересчитать пословные тайминги.
// cut.json: {segments: [[s, e], …] — куски исходника, которые остаются (с), words: [{w, s, e}] — оставленные слова в тайминге исходника}.
// Паузы ищутся ПО ЗВУКУ (silencedetect), а не по таймингам whisper: whisper растягивает слова на тишину, и внутри «сплошного»
// куска остаются паузы по 1–1,5 с. Любая тишина длиннее MIN_SIL сжимается до KEEP_SIL.
// Выход: чистый голос (шумодав, −14 LUFS, 48 кГц) + words в тайминге нового файла (формат edge-tts: {word, start, end}).
import { execFileSync, spawnSync } from 'child_process';

const FADE = 0.012;
const MIN_SIL = 0.2;    // тишина короче — естественная, не трогаем
const KEEP_SIL = 0.1;   // сколько тишины оставить на месте длинной паузы (по половине с каждой стороны)

// порог тишины — от средней громкости записи: телефонные голосовые бывают и тихими, и громкими
function silences(src) {
  const vd = spawnSync('ffmpeg', ['-hide_banner', '-i', src, '-af', 'highpass=f=70,afftdn=nf=-25,volumedetect', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const mean = +((vd.stderr || '').match(/mean_volume:\s*(-?[\d.]+)/) || [])[1];
  const n = Math.max(-50, Math.min(-28, (Number.isFinite(mean) ? mean : -22) - 16));
  const sd = spawnSync('ffmpeg', ['-hide_banner', '-i', src, '-af', `highpass=f=70,afftdn=nf=-25,silencedetect=n=${n}dB:d=${MIN_SIL}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = [], txt = sd.stderr || '';
  const re = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  let m;
  while ((m = re.exec(txt))) out.push([Math.max(0, +m[1]), +m[2]]);
  return { threshold: n, list: out };
}

// из кусков вычесть длинные паузы, оставив KEEP_SIL
function subtract(segs, sil) {
  const res = [];
  for (const [s, e] of segs) {
    let cur = s;
    for (const [a, b] of sil) {
      if (b <= cur || a >= e) continue;
      const cutA = Math.max(cur, a + KEEP_SIL / 2), cutB = Math.min(e, b - KEEP_SIL / 2);
      if (cutB - cutA < 0.05) continue;
      if (cutA - cur > 0.05) res.push([cur, cutA]);
      cur = cutB;
    }
    if (e - cur > 0.05) res.push([cur, e]);
  }
  return res;
}

export function voiceCut(src, cut, out, { trimSilence = true } = {}) {
  const segs = (cut.segments || []).map(([s, e]) => [Math.max(0, +s), +e]).filter(([s, e]) => e - s > 0.05).sort((a, b) => a[0] - b[0]);
  if (!segs.length) throw new Error('в cut.json нет segments');
  const joined = [];
  for (const sg of segs) { const p = joined[joined.length - 1]; if (p && sg[0] <= p[1] + 0.01) p[1] = Math.max(p[1], sg[1]); else joined.push([...sg]); }
  const sil = trimSilence ? silences(src) : { threshold: null, list: [] };
  const merged = trimSilence ? subtract(joined, sil.list) : joined;
  const offs = []; let acc = 0;
  for (const [s, e] of merged) { offs.push(acc); acc += e - s; }

  const f = merged.map(([s, e], k) => {
    const d = e - s;
    return `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE},afade=t=out:st=${Math.max(0, d - FADE).toFixed(3)}:d=${FADE}[a${k}]`;
  });
  f.push(`${merged.map((_, k) => `[a${k}]`).join('')}concat=n=${merged.length}:v=0:a=1,highpass=f=70,afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]`);
  // фильтр — аргументом (не файлом): -filter_complex_script убран в новых ffmpeg; 300 кусков ≈ 45 КБ, в лимит аргумента влезает
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-filter_complex', f.join(';'), '-map', '[out]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '160k', out]);

  // позиция момента исходника в новом файле: внутри куска — со сдвигом; в вырезанной паузе — начало следующего куска
  const map = (t) => {
    for (let k = 0; k < merged.length; k++) {
      const [s, e] = merged[k];
      if (t < s) return offs[k];
      if (t <= e) return offs[k] + (t - s);
    }
    return acc;
  };
  const words = [];
  for (const w of cut.words || []) {
    if (!joined.some(([s, e]) => w.s >= s - 0.02 && w.s < e)) continue;
    const ns = map(w.s), ne = Math.max(map(w.e), ns + 0.05);
    words.push({ word: w.w, start: Math.round(ns * 1000) / 1000, end: Math.round(ne * 1000) / 1000 });
  }
  const duration = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
  return { out, duration: Math.round(duration * 100) / 100, segments: merged.length, silences_cut: sil.list.length, threshold_db: sil.threshold, words };
}
