// voice-cut: вырезать из голосового лишнее (паразиты, оговорки, длинные паузы) и пересчитать пословные тайминги.
// cut.json: {segments: [[s, e], …] — куски исходника, которые остаются (с), words: [{w, s, e}] — оставленные слова в тайминге исходника}.
// Выход: чистый голос (шумодав, −14 LUFS, 48 кГц) + words в тайминге нового файла (формат edge-tts: {word, start, end}).
import { execFileSync } from 'child_process';

const FADE = 0.012;

export function voiceCut(src, cut, out) {
  const segs = (cut.segments || []).map(([s, e]) => [Math.max(0, +s), +e]).filter(([s, e]) => e - s > 0.05).sort((a, b) => a[0] - b[0]);
  if (!segs.length) throw new Error('в cut.json нет segments');
  // склеить пересекающиеся куски
  const merged = [];
  for (const sg of segs) { const p = merged[merged.length - 1]; if (p && sg[0] <= p[1] + 0.01) p[1] = Math.max(p[1], sg[1]); else merged.push([...sg]); }
  const offs = []; let acc = 0;
  for (const [s, e] of merged) { offs.push(acc); acc += e - s; }

  const f = merged.map(([s, e], k) => {
    const d = e - s;
    return `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE},afade=t=out:st=${Math.max(0, d - FADE).toFixed(3)}:d=${FADE}[a${k}]`;
  });
  f.push(`${merged.map((_, k) => `[a${k}]`).join('')}concat=n=${merged.length}:v=0:a=1,highpass=f=70,afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]`);
  // фильтр — аргументом (не файлом): -filter_complex_script убран в новых ffmpeg; 200 кусков ≈ 30 КБ, в лимит аргумента влезает
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-filter_complex', f.join(';'), '-map', '[out]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '160k', out]);

  const words = [];
  for (const w of cut.words || []) {
    const k = merged.findIndex(([s, e]) => w.s >= s - 0.02 && w.s < e);
    if (k < 0) continue;
    const [s, e] = merged[k];
    const ns = offs[k] + Math.max(0, w.s - s), ne = offs[k] + Math.min(e, Math.max(w.e, w.s + 0.05)) - s;
    words.push({ word: w.w, start: Math.round(ns * 1000) / 1000, end: Math.round(Math.max(ne, ns + 0.05) * 1000) / 1000 });
  }
  const duration = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
  return { out, duration: Math.round(duration * 100) / 100, source_cut: Math.round((acc) * 100) / 100, segments: merged.length, words };
}
