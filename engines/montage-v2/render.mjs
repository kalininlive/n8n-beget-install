// MONTAGE v2 — сборка ролика по проверенному плану (гибрид, эталон: genesis-n8n/pilot/montage-v2/reference-31s.mp4).
// Сцены без спикера (slide_full) -> проекты HyperFrames; спикер, b-roll, титры и графика -> ffmpeg + libass.
// build({ plan, words, skin, speaker, outDir, bgPng, gsap }) пишет в outDir:
//   slides/<id>/index.html, graphics.ass, mask_spk.ass, filter.txt и возвращает { inputs, hfJobs, stats }.
// Код перенесён из пилота pilot/montage-v2/hybrid/build.mjs; на плане эталона даёт тот же кадр.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STYLES } from './catalog.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let fontkit;
try { fontkit = require('/usr/local/lib/node_modules/hyperframes/node_modules/fontkit'); } catch { fontkit = require('fontkit'); }

const FPS = 30, W = 1080, H = 1920;
const f2 = v => Math.round(v * 100) / 100;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- шрифты (метрики через fontkit, чтобы libass совпал с CSS) ----------
const FD = process.env.MV2_FONTS || fileURLToPath(new URL('./fonts/', import.meta.url));
const SFX_DIR = process.env.MV2_SFX || fileURLToPath(new URL('./sfx/', import.meta.url));
const FONTS = {
  disp900: { file: path.join(FD, 'Unbounded-Black.ttf'), name: 'Unbounded', b: 1 },
  disp800: { file: path.join(FD, 'Unbounded-ExtraBold.ttf'), name: 'Unbounded', b: 1 },
  inter800: { file: path.join(FD, 'Inter-ExtraBold.ttf'), name: 'Inter', b: 1 },
  inter700: { file: path.join(FD, 'Inter-Bold.ttf'), name: 'Inter', b: 1 },
  inter400: { file: path.join(FD, 'Inter-Regular.ttf'), name: 'Inter', b: 0 },
};
for (const f of Object.values(FONTS)) {
  const fk = fontkit.openSync(f.file);
  const os2 = fk['OS/2'];
  f.fk = fk; f.upm = fk.unitsPerEm;
  f.asc = fk.ascent / f.upm; f.desc = -fk.descent / f.upm;            // CSS (hhea)
  f.winAsc = os2.winAscent / f.upm; f.winH = (os2.winAscent + os2.winDescent) / f.upm; // libass
}
const textW = (font, size, text, ls = 0) =>
  font.fk.layout(text).advanceWidth * size / font.upm + ls * [...text].length;
// перенос по словам в ширину maxW (как в браузере)
function wrap(font, size, text, maxW, ls = 0) {
  const lines = [];
  for (const wd of String(text).split(/\s+/).filter(Boolean)) {
    const cand = lines.length ? lines[lines.length - 1] + ' ' + wd : wd;
    if (lines.length && textW(font, size, cand, ls) <= maxW) lines[lines.length - 1] = cand; else lines.push(wd);
  }
  return lines;
}
// кегль, при котором самая длинная строка влезает в maxW
const fitSize = (font, size, lines, maxW, lsK = 0) =>
  Math.min(size, ...lines.map(l => { const w = textW(font, size, l, lsK * size); return w > maxW ? size * maxW / w : size; }));

// ---------- easing как в GSAP ----------
const EASE = {
  none: p => p,
  'power2.out': p => 1 - (1 - p) ** 3,
  'power3.out': p => 1 - (1 - p) ** 4,
  'power2.inOut': p => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  'power3.inOut': p => (p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2),
  'back.out': p => { const c = 1.7; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; },
};
// то же выражением ffmpeg
const EEXPR = {
  none: p => p,
  'power2.inOut': p => `if(lt(${p},0.5),4*pow(${p},3),1-pow(-2*${p}+2,3)/2)`,
  'power3.inOut': p => `if(lt(${p},0.5),8*pow(${p},4),1-pow(-2*${p}+2,4)/2)`,
  'power3.out': p => `(1-pow(1-${p},4))`,
  'power2.out': p => `(1-pow(1-${p},3))`,
  'back.out': p => `(1+2.7*pow(${p}-1,3)+1.7*pow(${p}-1,2))`,
};
// твины: [{p:'y'|'x'|'s'|'a', from, to, t, d, e}] -> значение свойства во времени
function track(tweens, prop, def) {
  const ts = tweens.filter(x => x.p === prop).sort((a, b) => a.t - b.t);
  return t => {
    if (!ts.length) return def;
    if (t < ts[0].t) return ts[0].from;
    let v = ts[0].from;
    for (const tw of ts) {
      if (t < tw.t) break;
      const p = tw.d > 0 ? Math.min(1, (t - tw.t) / tw.d) : 1;
      v = tw.from + (tw.to - tw.from) * EASE[tw.e](p);
    }
    return v;
  };
}
const tr = (tweens, ox, oy) => {
  const x = track(tweens, 'x', 0), y = track(tweens, 'y', 0), s = track(tweens, 's', 1), a = track(tweens, 'a', 1);
  return t => ({ x: x(t), y: y(t), s: s(t), a: a(t), ox, oy });
};

// ---------- ASS ----------
const cs = n => Math.floor((n * 100) / FPS); // кадр -> сантисекунды (граница кадра)
const assTime = c => { const h = Math.floor(c / 360000), m = Math.floor(c / 6000) % 60, s = Math.floor(c / 100) % 60, r = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(2, '0')}`; };
const assColor = hex => { const h = hex.replace('#', ''); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const assAlpha = op => `&H${Math.round(255 * (1 - Math.max(0, Math.min(1, op)))).toString(16).padStart(2, '0').toUpperCase()}&`;
const ASS_HEAD = (w, h, matrix) => `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n` +
  (matrix ? 'YCbCr Matrix: TV.709\n' : '') + '\n' +
  `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
  `Style: D,Inter,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

// фигуры
function rrect(w, h, r) {
  const c = r * 0.5523;
  return `m ${r} 0 l ${w - r} 0 b ${w - r + c} 0 ${w} ${r - c} ${w} ${r} l ${w} ${h - r} b ${w} ${h - r + c} ${w - r + c} ${h} ${w - r} ${h} ` +
    `l ${r} ${h} b ${r - c} ${h} 0 ${h - r + c} 0 ${h - r} l 0 ${r} b 0 ${r - c} ${r - c} 0 ${r} 0`;
}
function circlePath(cx, cy, r) {
  const c = r * 0.5523;
  return `m ${f2(cx)} ${f2(cy - r)} b ${f2(cx + c)} ${f2(cy - r)} ${f2(cx + r)} ${f2(cy - c)} ${f2(cx + r)} ${f2(cy)} ` +
    `b ${f2(cx + r)} ${f2(cy + c)} ${f2(cx + c)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} ` +
    `b ${f2(cx - c)} ${f2(cy + r)} ${f2(cx - r)} ${f2(cy + c)} ${f2(cx - r)} ${f2(cy)} ` +
    `b ${f2(cx - r)} ${f2(cy - c)} ${f2(cx - c)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)}`;
}
function ringPath(R, w) {
  // кольцо: внешний круг по часовой, внутренний против (libass заливает по ненулевому правилу)
  const outer = circlePath(R, R, R);
  const r = R - w, c = r * 0.5523, cx = R, cy = R;
  const inner = `m ${f2(cx)} ${f2(cy - r)} b ${f2(cx - c)} ${f2(cy - r)} ${f2(cx - r)} ${f2(cy - c)} ${f2(cx - r)} ${f2(cy)} ` +
    `b ${f2(cx - r)} ${f2(cy + c)} ${f2(cx - c)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} ` +
    `b ${f2(cx + c)} ${f2(cy + r)} ${f2(cx + r)} ${f2(cy + c)} ${f2(cx + r)} ${f2(cy)} ` +
    `b ${f2(cx + r)} ${f2(cy - c)} ${f2(cx + c)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)}`;
  return outer + ' ' + inner;
}
// толстая ломаная (stroke) -> набор многоугольников; координаты абсолютные внутри рамки 0..size
function strokePaths(pts, w, size) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const L = Math.hypot(x2 - x1, y2 - y1), nx = (-(y2 - y1) / L) * w / 2, ny = ((x2 - x1) / L) * w / 2;
    out.push(`m ${f2(x1 + nx)} ${f2(y1 + ny)} l ${f2(x2 + nx)} ${f2(y2 + ny)} l ${f2(x2 - nx)} ${f2(y2 - ny)} l ${f2(x1 - nx)} ${f2(y1 - ny)}`);
  }
  for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i]; out.push(circlePath(x, y, w / 2)); } // скругление стыка
  out.push(`m 0 0 l 0 0 m ${size} ${size} l ${size} ${size}`); // «якорь»: bbox рисунка от (0,0) до (size,size)
  return out.join(' ');
}

// Элемент: набор частей (text/draw) + цепочка трансформаций (дочерняя -> родительская).
// Части задаются в координатах кадра (как в CSS-вёрстке эталона).
function makeAss(playW, playH) {
  const lines = [];
  function element({ t0, t1, parts, chain = [], layer = 1 }) {
    const n0 = Math.ceil(t0 * FPS - 1e-6), n1 = Math.ceil(t1 * FPS - 1e-6);
    let prev = null, start = n0;
    const stateAt = n => {
      const t = n / FPS;
      return chain.map(fn => { const st = fn(t); return { ...st, x: f2(st.x), y: f2(st.y), s: Math.round(st.s * 1000) / 1000, a: Math.round(st.a * 100) / 100 }; });
    };
    const textAt = n => parts.map(p => (typeof p.text === 'function' ? p.text(n / FPS) : p.text));
    const key = n => JSON.stringify([stateAt(n), textAt(n)]);
    const emit = (na, nb) => {
      const sts = stateAt(na), txts = textAt(na);
      let alpha = 1, scale = 1;
      for (const st of sts) { alpha *= st.a; scale *= st.s; }
      if (alpha <= 0.001 || scale <= 0.001) return;
      const map = (px, py) => {
        let x = px, y = py;
        for (const st of sts) { x = st.ox + (x - st.ox) * st.s + st.x; y = st.oy + (y - st.oy) * st.s + st.y; } // как translate+scale в GSAP
        return [x, y];
      };
      parts.forEach((p, i) => {
        // libass отбрасывает пробелы по краям строки («40 мин» -> «40мин»): крайние пробелы -> неразрывные \h
        const txt = typeof txts[i] === 'string' ? txts[i].replace(/^ +| +$/g, m => '\\h'.repeat(m.length)) : txts[i];
        const [x, y] = map(p.x, p.y);
        const sc = scale * (p.s || 1);
        let tags = `\\an7\\pos(${f2(x)},${f2(y)})\\fscx${f2(sc * 100)}\\fscy${f2(sc * 100)}\\bord0\\shad0`;
        if (p.rot) { const [ox, oy] = map(p.rot.ox, p.rot.oy); tags += `\\org(${f2(ox)},${f2(oy)})\\frz${p.rot.deg}`; }
        const body = p.kind === 'draw' ? `{\\p1}${p.path}{\\p0}` : txt;
        const font = p.font ? `\\fn${p.font.name}\\b${p.font.b}\\fs${f2(p.size * p.font.winH)}` + (p.ls ? `\\fsp${f2(p.ls * sc)}` : '') : '';
        const start = assTime(cs(na)), end = assTime(cs(nb));
        if (p.shadow) {
          const sh = p.shadow;
          const [sx, sy] = map(p.x + sh.dx, p.y + sh.dy);
          lines.push(`Dialogue: ${layer * 3},${start},${end},D,,0,0,0,,{\\an7\\pos(${f2(sx)},${f2(sy)})\\fscx${f2(sc * 100)}\\fscy${f2(sc * 100)}\\bord0\\shad0` +
            (p.rot ? `\\org(${f2(map(p.rot.ox, p.rot.oy)[0])},${f2(map(p.rot.ox, p.rot.oy)[1])})\\frz${p.rot.deg}` : '') +
            `${font}\\1c&H000000&\\1a${assAlpha(sh.op * alpha * (p.op ?? 1))}\\blur${sh.blur}}${body}`);
        }
        lines.push(`Dialogue: ${layer * 3 + 1},${start},${end},D,,0,0,0,,{${tags}${font}\\1c${assColor(p.color)}\\1a${assAlpha(alpha * (p.op ?? 1))}` +
          (p.blur ? `\\blur${p.blur}` : '') + `}${body}`);
      });
    };
    for (let n = n0; n <= n1; n++) {
      const k = n < n1 ? key(n) : null;
      if (k !== prev) { if (prev !== null && n > start) emit(start, n); start = n; prev = k; }
    }
  }
  return { element, write: file => fs.writeFileSync(file, ASS_HEAD(playW, playH, true) + lines.join('\n') + '\n'), count: () => lines.length };
}

// текст: позиция по верху CSS-строки с заданным line-height (в px) -> верх для libass (\an7)
function textPart({ font, size, text, x, lineTop, lineH, color, shadow, ls, op }) {
  const cssContent = (font.asc + font.desc) * size;
  const baseline = lineTop + (lineH - cssContent) / 2 + font.asc * size;
  return { kind: 'text', font, size, text, x, y: baseline - font.winAsc * size, color, shadow, ls, op };
}
const centerX = (font, size, text, ls = 0, cx = W / 2) => cx - textW(font, size, text, ls) / 2;

// ---------- иконки ----------
// обводка для libass (чек-лист, стрелка CTA)
const STROKE_ICONS = {
  check: { pts: [[[5, 12], [10, 17], [19, 7]]], w: 3.5 },
  arrow: { pts: [[[12, 4], [12, 19]], [[5, 13], [12, 20], [19, 13]]], w: 2.6 },
};
function iconPart(name, x, y, size, color) {
  const ic = STROKE_ICONS[name], k = size / 24;
  const path = ic.pts.map(pl => strokePaths(pl.map(([a, b]) => [a * k, b * k]), ic.w * k, size)).join(' ');
  return { kind: 'draw', x, y, path, color };
}
// SVG для карточек cards_trio (HyperFrames); первые три — как в эталоне
const svg = (color, body, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON_SVG = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="#4F8CFF" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#FFB020" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="#FF4D4F" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: svg('#22C55E', '<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  user: svg('#4F8CFF', '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  money: svg('#22C55E', '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>'),
  chart: svg('#4F8CFF', '<path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>'),
  phone: svg('#4F8CFF', '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  calendar: svg('#FFB020', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  bolt: svg('#FFB020', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  star: svg('#FFB020', '<path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/>'),
  heart: svg('#FF4D4F', '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>'),
  fire: svg('#FF7A1A', '<path d="M12 22c4 0 7-2.8 7-6.8 0-4.2-3.3-6.3-4.2-10.2-2.3 1.6-3.3 3.9-3.3 5.8-1.3-.8-2-2.1-2.2-3.4C7 9.2 5 11.7 5 15.2 5 19.2 8 22 12 22z"/>'),
  target: svg('#FF4D4F', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
};

export const STYLE_CAPTIONS = {
  'beat-cards': { fill: '#FFFFFF', text: '#121827', accent: '#1E6BFF', every: 1, radius: 18 },
  'agentworld': { fill: '#0E1F36', text: '#F4F8FF', accent: '#57AAFF', every: 2, radius: 12 },
  'kinetic-promo': { fill: '#1C1842', text: '#FFFFFF', accent: '#FF2DBE', every: 2, radius: 20 },
  'genesis-mascot-explainer': { fill: '#09233A', text: '#FFFFFF', accent: '#42D6FF', every: 2, radius: 18 },
  'pro-montage-v3': { fill: '#101114', text: '#FFFFFF', accent: '#FFD43B', every: 2, radius: 10 },
  'hyperframes-explainer': { fill: '#101820', text: '#FFFFFF', accent: '#45E0C1', every: 2, radius: 14 },
  'story-format': { fill: '#282019', text: '#FFF6E8', accent: '#E6B978', every: 2, radius: 6 },
  'photo-story': { fill: '#17202A', text: '#FFFFFF', accent: '#E7B48A', every: 2, radius: 24 },
  'clean-ui': { fill: '#FFFFFF', text: '#111827', accent: '#2563EB', every: 2, radius: 10 },
  'newspaper': { fill: '#FFF9EA', text: '#201B14', accent: '#9E3328', every: 2, radius: 2 },
  'matrixglitch': { fill: '#03130E', text: '#E7FFE9', accent: '#39FF88', every: 2, radius: 2 },
  'pixel8': { fill: '#211A46', text: '#FFF36D', accent: '#FF4FD8', every: 2, radius: 0 },
  'synthwave': { fill: '#21123D', text: '#FFFFFF', accent: '#FF55C8', every: 2, radius: 16 },
  'hudscan': { fill: '#071D26', text: '#D8FCFF', accent: '#28E7F2', every: 2, radius: 4 },
  'chalkboard': { fill: '#173F31', text: '#FFFBEA', accent: '#F5E8A8', every: 2, radius: 3 },
  'lowpoly3d': { fill: '#17223A', text: '#FFFFFF', accent: '#FFB84D', every: 2, radius: 8 },
  'reference': { fill: null, text: null, accent: null, every: 3, radius: 20 },
};

export function getStylePalette(styleId) {
  const style = STYLES[styleId];
  const render = style?.render;
  const caption = STYLE_CAPTIONS[styleId] || STYLE_CAPTIONS.reference;
  if (!render) return null;
  const hexes = (render.bg?.match(/#[0-9a-fA-F]{6}/g) || []);
  const shadowHex = render.shadow?.match(/#[0-9a-fA-F]{6}/)?.[0];
  const bgLight = hexes[1] || hexes[0] || render.surface || '#24205B';
  const bgMain = hexes[0] || render.surface || '#100D35';
  const bgDeep = hexes[2] || shadowHex || hexes[1] || hexes[0] || render.surface || '#08071F';
  const accent = caption.accent || render.border || '#F6D743';
  const ink = render.ink || caption.text || '#FFFFFF';
  const surface = render.surface || '#24205B';
  const border = render.border || accent;
  const radius = render.radius !== undefined ? (parseInt(render.radius) || 0) : 18;
  return { bgLight, bgMain, bgDeep, accent, ink, surface, border, radius, caption };
}

// ================= сборка =================
export function build({ plan, words, skin: SKIN, speaker, outDir, bgPng, gsap }) {
  const DUR = plan.duration, WORDS = words, scenes = plan.scenes;
  const STYLE_ID = plan.style || 'reference';
  const slideTheme = STYLES[STYLE_ID]?.render || null;
  const captionTheme = STYLE_CAPTIONS[STYLE_ID] || STYLE_CAPTIONS.reference;
  const palette = getStylePalette(STYLE_ID);
  fs.mkdirSync(outDir, { recursive: true });
  const G = makeAss(W, H);

  // ---------- кинетические субтитры (как в эталоне) ----------
  function subtitleZones() {
    const zones = [];
    for (const s of scenes) {
      if (s.c === 'talking') zones.push({ from: s.t0, to: s.t1, top: 1360 });
      if (s.c === 'broll_own') zones.push({ from: s.t0, to: s.t1, top: 1360 });
      if (s.c === 'cta') { zones.push({ from: s.t0, to: s.at, top: 1360 }); zones.push({ from: s.at, to: s.t1, top: 1400 }); }
    }
    const merged = [];
    for (const z of zones) { const l = merged[merged.length - 1]; if (l && l.top === z.top && Math.abs(l.to - z.from) < 1e-6) l.to = z.to; else merged.push({ ...z }); }
    return merged;
  }
  function buildSubtitles() {
    const small = { font: FONTS.inter800, size: 50 };
    const acc = { font: FONTS.disp900, size: 96, lh: 96 * 0.95, ls: -0.02 * 96 };
    const shadow = { dx: 0, dy: 4, blur: 7, op: 0.55 };
    let chunkN = 0;
    for (const z of subtitleZones()) {
      const ws = WORDS.filter(w => w.t >= z.from - 0.01 && w.t < z.to);
      const chunks = []; let cur = [];
      ws.forEach((w, i) => {
        const gap = i ? w.t - ws[i - 1].e : 0;
        if (cur.length && (cur.length >= 3 || gap > 0.35 || cur.map(x => x.w).join(' ').length > 16)) { chunks.push(cur); cur = []; }
        cur.push(w);
      });
      if (cur.length) chunks.push(cur);
      chunks.forEach((c, ci) => {
        const end = ci < chunks.length - 1 ? chunks[ci + 1][0].t : Math.min(z.to, c[c.length - 1].e + 0.4);
        const accI = c.reduce((b, w, i) => (w.w.length > c[b].w.length ? i : b), 0);
        const pill = chunkN % captionTheme.every === (captionTheme.every === 1 ? 0 : 1);
        // элементы строки (inline-block) и блочный акцент
        const items = c.map((w, i) => {
          if (i !== accI) {
            const text = w.w.toLowerCase();
            const tw = textW(small.font, small.size, text);
            const h = (small.font.asc + small.font.desc) * small.size;
            return { w, text, kind: 'small', width: tw + 16, height: h, above: small.font.asc * small.size };
          }
          const text = w.w.toUpperCase();
          const maxW = pill ? 960 - 56 : 960;
          let accSize = acc.size;
          let accLh = acc.lh;
          let accLs = acc.ls;
          const singleW = textW(acc.font, accSize, text, accLs);
          if (singleW > maxW) {
            accSize = Math.max(54, Math.floor(accSize * (maxW / singleW) * 0.94));
            accLh = accSize * 0.95;
            accLs = -0.02 * accSize;
          }
          const inner = (accLh - (acc.font.asc + acc.font.desc) * accSize) / 2 + acc.font.asc * accSize;
          const lines = wrap(acc.font, accSize, text, maxW, accLs);
          const lws = lines.map(l => textW(acc.font, accSize, l, accLs)), lw = Math.max(...lws), n = lines.length;
          const last = (n - 1) * accLh + inner; // baseline inline-block = последняя строка
          if (pill) return { w, text, lines, lws, kind: 'pill', tw: lw, width: lw + 56, height: 6 + 4 + n * accLh + 10 + 6, above: 6 + 4 + last, accSize, accLh, accLs };
          return { w, text, lines, lws, kind: 'block', tw: lw, width: 960, height: n * accLh + 12, above: 6 + last, accSize, accLh, accLs };
        });
        // раскладка по строкам (ширина 960, по центру)
        const rows = []; let row = [];
        for (const it of items) {
          if (it.kind === 'block') { if (row.length) rows.push(row); rows.push([it]); row = []; continue; }
          const rw = row.reduce((s, x) => s + x.width, 0);
          if (row.length && rw + it.width > 960) { rows.push(row); row = []; }
          row.push(it);
        }
        if (row.length) rows.push(row);
        let y = z.top;
        const strutA = FONTS.disp900.asc * 16, strutB = FONTS.disp900.desc * 16;
        for (const r of rows) {
          const A = Math.max(strutA, ...r.map(i => i.above)), B = Math.max(strutB, ...r.map(i => i.height - i.above));
          const rw = r[0].kind === 'block' ? r[0].width : r.reduce((s, x) => s + x.width, 0);
          let x = 60 + (960 - rw) / 2;
          for (const it of r) {
            const top = y + A - it.above; // верх margin-box
            const parts = [];
            let ox, oy, tweens;
            if (it.kind === 'small') {
              parts.push(textPart({ font: small.font, size: small.size, text: it.text, x: x + 8, lineTop: top, lineH: it.height, color: SKIN.white, shadow }));
              ox = x + it.width / 2; oy = top + it.height / 2;
              tweens = [{ p: 'a', from: 0, to: 1, t: it.w.t, d: 0.22, e: 'power3.out' }, { p: 'y', from: 30, to: 0, t: it.w.t, d: 0.22, e: 'power3.out' }];
            } else {
              const curLh = it.accLh || acc.lh;
              const curSize = it.accSize || acc.size;
              const curLs = it.accLs || acc.ls;
              const n = it.lines.length, boxTop = top + 6, boxH = it.kind === 'pill' ? 4 + n * curLh + 10 : n * curLh;
              if (it.kind === 'pill') {
                const pillColor = captionTheme.fill || SKIN.brand;
                parts.push({ kind: 'draw', x, y: boxTop, path: rrect(f2(it.width), f2(boxH), captionTheme.radius), color: pillColor });
                if (captionTheme.accent) parts.push({ kind: 'draw', x: x + 5, y: boxTop + 5, path: rrect(f2(Math.min(8, it.width - 10)), f2(Math.max(8, boxH - 10)), 4), color: captionTheme.accent });
              }
              it.lines.forEach((ln, li) => {
                const tx = it.kind === 'pill' ? x + 28 + (it.tw - it.lws[li]) / 2 : 60 + (960 - it.lws[li]) / 2;
                parts.push(textPart({ font: acc.font, size: curSize, text: ln, x: tx, lineTop: boxTop + (it.kind === 'pill' ? 4 : 0) + li * curLh, lineH: curLh, color: it.kind === 'pill' ? (captionTheme.text || SKIN.white) : SKIN.white, shadow: it.kind === 'pill' && captionTheme.text ? null : shadow, ls: curLs }));
              });
              ox = it.kind === 'pill' ? x + it.width / 2 : W / 2; oy = boxTop + boxH / 2;
              tweens = [{ p: 'a', from: 0, to: 1, t: it.w.t, d: 0.22, e: 'back.out' }, { p: 'y', from: 30, to: 0, t: it.w.t, d: 0.22, e: 'back.out' },
                { p: 's', from: 0.7, to: 1, t: it.w.t, d: 0.22, e: 'back.out' }];
            }
            G.element({ t0: it.w.t, t1: end, parts, chain: [tr(tweens, ox, oy)], layer: 3 });
            x += it.width;
          }
          y += A + B;
        }
        chunkN++;
      });
    }
  }

  // ---------- графика сцен со спикером ----------
  // подводка (kicker): одна строка по центру, длинная — уменьшается до 960
  const kickerPart = (text, top, color = (palette?.ink || SKIN.white)) => {
    const f = FONTS.inter700, sz = fitSize(f, 54, [text], 960);
    return textPart({ font: f, size: sz, text, x: centerX(f, sz, text), lineTop: top, lineH: (f.asc + f.desc) * sz, color });
  };
  function sceneGraphics(s) {
    if (s.c === 'speaker_circle') {
      const textColor = palette ? palette.ink : SKIN.white;
      G.element({ t0: s.t0, t1: s.t1, parts: [kickerPart(s.kicker, 300, textColor)] });
      const ht = s.head.toUpperCase(), lsK = -0.02;
      let hs = 118, lines = wrap(FONTS.disp900, hs, ht, 960, lsK * hs);
      hs = fitSize(FONTS.disp900, hs, lines, 960, lsK);
      const ls = lsK * hs, lh = hs * 0.92;
      G.element({ t0: s.head_at, t1: s.t1,
        parts: lines.map((ln, li) => textPart({ font: FONTS.disp900, size: hs, text: ln, x: centerX(FONTS.disp900, hs, ln, ls), lineTop: 380 + li * lh, lineH: lh, color: textColor, ls, shadow: { dx: 0, dy: 8, blur: 12, op: 0.25 } })),
        chain: [tr([{ p: 'y', from: 40, to: 0, t: s.head_at, d: 0.3, e: 'power3.out' }, { p: 'a', from: 0, to: 1, t: s.head_at, d: 0.3, e: 'power3.out' }], 0, 0)] });
      if (s.badge) {
        const f = FONTS.disp800, sz = 56, tw = textW(f, sz, s.badge), bw = tw + 52, bh = 12 + (f.asc + f.desc) * sz, bx = W / 2 - bw / 2, by = 520 + (lines.length - 1) * lh;
        const rot = { ox: W / 2, oy: by + bh / 2, deg: 3 };
        const badgeBg = palette?.caption?.fill || (palette?.surface?.startsWith('#') ? palette.surface : SKIN.white);
        const badgeText = palette?.accent || SKIN.brand;
        const badgeRadius = palette?.radius !== undefined ? Math.min(14, palette.radius || 4) : 14;
        const bParts = [];
        if (palette?.border && /^#[0-9a-fA-F]{6}$/.test(palette.border)) {
          bParts.push({ kind: 'draw', x: bx - 2, y: by - 2, path: rrect(f2(bw + 4), f2(bh + 4), badgeRadius + 2), color: palette.border, rot, op: 0.85 });
        }
        bParts.push({ kind: 'draw', x: bx, y: by, path: rrect(f2(bw), f2(bh), badgeRadius), color: badgeBg, rot, op: 0.95 });
        bParts.push({ ...textPart({ font: f, size: sz, text: s.badge, x: bx + 26, lineTop: by + 6, lineH: (f.asc + f.desc) * sz, color: badgeText }), rot });
        G.element({ t0: s.badge_at, t1: s.t1, parts: bParts,
          chain: [tr([{ p: 's', from: 0, to: 1, t: s.badge_at, d: 0.35, e: 'back.out' }], W / 2, by + bh / 2)] });
      }
      // кольцо вокруг круга спикера (центр 540,1140; r 330, толщина 10)
      const ringColor = palette?.accent || SKIN.white;
      G.element({ t0: s.t0, t1: s.t1, layer: 0, parts: [{ kind: 'draw', x: 210, y: 810, path: ringPath(330, 10), color: ringColor }],
        chain: [tr([{ p: 's', from: 0, to: 1, t: s.t0 + 0.05, d: 0.5, e: 'back.out' }], 540, 1140)] });
    }
    if (s.c === 'card_over_blur' && s.object.c === 'checklist') {
      const o = s.object, L = 90, T = 840, CW = 900, PAD = 50;
      const tf = FONTS.disp900, ts = fitSize(tf, 64, [o.title[0] + o.title[1]], CW - 2 * PAD), tH = (tf.asc + tf.desc) * ts;
      const parts = [];
      const t1w = textW(tf, ts, o.title[0]);
      const titleTop = T + PAD;
      const title0Color = '#FFFFFF';
      const title1Color = palette?.accent || SKIN.brand;
      parts.push(textPart({ font: tf, size: ts, text: o.title[0], x: L + PAD, lineTop: titleTop, lineH: tH, color: title0Color }));
      parts.push(textPart({ font: tf, size: ts, text: o.title[1], x: L + PAD + t1w, lineTop: titleTop, lineH: tH, color: title1Color }));
      // пункты
      const f = FONTS.inter700, sz = 42, lh = (f.asc + f.desc) * sz, avail = CW - 2 * PAD - 70 - 28;
      let y = titleTop + tH + 28;
      const items = o.items.map(([text, at]) => {
        const lines = wrap(f, sz, text, avail);
        const h = 2 + 18 + Math.max(60, lines.length * lh) + 18;
        const it = { lines, at, top: y, h };
        y += h; return it;
      });
      const CH = y + 36 - T;
      const cardChain = tr([{ p: 'y', from: 80, to: 0, t: o.at, d: 0.4, e: 'back.out' }, { p: 'a', from: 0, to: 1, t: o.at, d: 0.4, e: 'back.out' },
        { p: 's', from: 0.92, to: 1, t: o.at, d: 0.4, e: 'back.out' }], L + CW / 2, T + CH / 2);
      const cardBg = palette?.surface && palette.surface.startsWith('#') ? palette.surface : '#141028';
      const cardRadius = palette?.radius !== undefined ? Math.min(36, Math.max(16, palette.radius)) : 28;
      const bgParts = [];
      if (palette?.border && /^#[0-9a-fA-F]{6}$/.test(palette.border)) {
        bgParts.push({ kind: 'draw', x: L - 3, y: T - 3, path: rrect(CW + 6, f2(CH) + 6, cardRadius + 3), color: palette.border, op: 0.85 });
      }
      bgParts.push({ kind: 'draw', x: L, y: T, path: rrect(CW, f2(CH), cardRadius), color: cardBg, op: 0.94, shadow: { dx: 0, dy: 30, blur: 24, op: 0.45 } });
      G.element({ t0: o.at, t1: s.t1, parts: bgParts, chain: [cardChain], layer: 1 });
      G.element({ t0: o.at, t1: s.t1, parts, chain: [cardChain], layer: 2 });
      const ruleColor = palette?.border && /^#[0-9a-fA-F]{6}$/.test(palette.border) ? palette.border : 'rgba(255,255,255,0.18)';
      const checkCircleColor = palette?.accent || '#22C55E';
      const checkIconColor = '#FFFFFF';
      const itemTextColor = '#FFFFFF';
      for (const it of items) {
        const ip = [{ kind: 'draw', x: L + PAD, y: it.top, path: `m 0 0 l ${CW - 2 * PAD} 0 l ${CW - 2 * PAD} 2 l 0 2`, color: ruleColor, op: 0.6 }];
        const inner = it.h - 2 - 36, midY = it.top + 2 + 18 + inner / 2;
        ip.push({ kind: 'draw', x: L + PAD, y: midY - 32, path: circlePath(32, 32, 32), color: checkCircleColor });
        ip.push(iconPart('check', L + PAD + 14, midY - 18, 36, checkIconColor));
        const textTop = midY - (it.lines.length * lh) / 2;
        it.lines.forEach((ln, i) => ip.push(textPart({ font: f, size: sz, text: ln, x: L + PAD + 64 + 24, lineTop: textTop + i * lh, lineH: lh, color: itemTextColor })));
        G.element({ t0: it.at, t1: s.t1, parts: ip, layer: 2,
          chain: [tr([{ p: 'x', from: -50, to: 0, t: it.at, d: 0.3, e: 'power3.out' }, { p: 'a', from: 0, to: 1, t: it.at, d: 0.3, e: 'power3.out' }], 0, 0), cardChain] });
      }
    }
    if (s.c === 'speaker_rect' && !s.object) G.element({ t0: s.t0, t1: s.t1, parts: [kickerPart(s.kicker, 300, palette?.accent || SKIN.muted)] });
    if (s.c === 'speaker_rect' && s.object?.c === 'stat_big') {
      const o = s.object;
      const kickerColor = palette?.accent || SKIN.muted;
      G.element({ t0: s.t0, t1: s.t1, parts: [kickerPart(s.kicker, 300, kickerColor)] });
      const f = FONTS.disp900, sz = fitSize(f, 300, [o.prefix + o.value + o.suffix], 960), top = 390 + (300 - sz) / 2;
      const val = t => (t < o.count_at ? 0 : Math.round(o.value * EASE['power2.out'](Math.min(1, (t - o.count_at) / 1.4))));
      const layout = t => { const num = String(val(t)); const wp = textW(f, sz, o.prefix), wn = textW(f, sz, num), ws = textW(f, sz, o.suffix);
        const x0 = W / 2 - (wp + wn + ws) / 2; return { num, x0, wp, wn }; };
      // три части с позицией, зависящей от числа -> отдельный элемент на каждое значение счётчика
      const tp = (text, x, color) => textPart({ font: f, size: sz, text, x, lineTop: top, lineH: sz, color });
      const chain = [tr([{ p: 's', from: 0.5, to: 1, t: o.at, d: 0.35, e: 'back.out' }, { p: 'a', from: 0, to: 1, t: o.at, d: 0.35, e: 'back.out' }], W / 2, top + sz / 2)];
      let segStart = o.at, prevNum = layout(o.at).num;
      const n0 = Math.ceil(o.at * FPS), n1 = Math.ceil(s.t1 * FPS);
      const brandColor = palette ? palette.accent : SKIN.brand;
      const numColor = palette ? palette.ink : SKIN.white;
      for (let n = n0; n <= n1; n++) {
        const t = n / FPS, L2 = layout(Math.min(t, s.t1 - 1e-6));
        if (L2.num !== prevNum || n === n1) {
          const Lp = layout(segStart);
          G.element({ t0: segStart, t1: t, chain, parts: [tp(o.prefix, Lp.x0, brandColor), tp(Lp.num, Lp.x0 + Lp.wp, numColor), tp(o.suffix, Lp.x0 + Lp.wp + Lp.wn, brandColor)].filter(p => p.text) });
          segStart = t; prevNum = L2.num;
        }
      }
    }
    if (s.c === 'cta') {
      const top = 250, f1 = FONTS.inter800;
      const lines = wrap(f1, 60, s.text, 960), s1 = fitSize(f1, 60, lines, 960), h1 = (f1.asc + f1.desc) * s1;
      const kf = FONTS.disp900, ks = fitSize(kf, 170, [s.keyword], 840), kw = textW(kf, ks, s.keyword), bw = kw + 120, bh = 10 + ks + 20, bx = W / 2 - bw / 2, by = top + lines.length * h1 + 18;
      const ctaChain = tr([{ p: 'y', from: -60, to: 0, t: s.at, d: 0.35, e: 'power3.out' }, { p: 'a', from: 0, to: 1, t: s.at, d: 0.35, e: 'power3.out' }], 0, 0);
      G.element({ t0: s.at, t1: s.t1, chain: [ctaChain], parts: [
        ...lines.map((ln, li) => textPart({ font: f1, size: s1, text: ln, x: centerX(f1, s1, ln), lineTop: top + li * h1, lineH: h1, color: SKIN.white, shadow: { dx: 0, dy: 4, blur: 7, op: 0.5 } })),
        iconPart('arrow', W / 2 - 55, by + bh + 24, 110, SKIN.white)] });
      G.element({ t0: s.keyword_at, t1: s.t1, chain: [tr([{ p: 's', from: 0, to: 1, t: s.keyword_at, d: 0.4, e: 'back.out' }], W / 2, by + bh / 2), ctaChain], parts: [
        { kind: 'draw', x: bx, y: by, path: rrect(f2(bw), f2(bh), 26), color: SKIN.brand, shadow: { dx: 0, dy: 20, blur: 18, op: 0.3 } },
        textPart({ font: kf, size: ks, text: s.keyword, x: bx + 60, lineTop: by + 10, lineH: ks, color: SKIN.white })] });
    }
  }

  // ---------- HyperFrames: сцены без спикера ----------
  function slideHtml(s) {
    const d = f2(s.t1 - s.t0), rel = t => f2(t - s.t0);
    // Fit single-word and multi-word headlines to the actual inner width of the card.
    // CSS does not wrap long unbroken words, so the previous fixed 150px size clipped
    // Russian headings such as «СМОНТИРОВАЛОСЬ» at the right edge.
    const headText = String(s.head || '').toUpperCase();
    const headLsK = -0.02;
    const headLines = wrap(FONTS.disp900, 150, headText, 936, headLsK * 150);
    const headSize = fitSize(FONTS.disp900, 150, headLines, 936, headLsK);
    const kickerText = String(s.kicker || '');
    const kickerSize = fitSize(FONTS.inter700, 64, [kickerText], 936);
    const slideCss = slideTheme ? [
      '#root { color: ' + slideTheme.ink + '; }',
      '#bg { background: ' + slideTheme.bg + '; }',
      '#bg::after { content:""; position:absolute; inset:0; background:' + slideTheme.texture + '; opacity:.8; }',
      '.kicker,.head { color:' + slideTheme.ink + '; text-shadow:' + (['clean-ui','beat-cards','story-format','photo-story','newspaper','chalkboard'].includes(STYLE_ID) ? 'none' : '0 8px 30px rgba(0,0,0,.32)') + '; }',
      '.card { color:' + slideTheme.ink + '; background:' + slideTheme.surface + '; border:2px solid ' + slideTheme.border + '; border-radius:' + slideTheme.radius + '; box-shadow:' + slideTheme.shadow + '; }',
      '.card svg { filter:drop-shadow(0 4px 10px rgba(0,0,0,.15)); }',
] .join('\n') : '';
    const items = s.object?.items || [];
    const card = (it, i, pos) => {
      const words = esc(it[1]).split(/\s+/).filter(Boolean);
      const maxWord = Math.max(...words.map(w => w.length), 0);
      const fontSize = maxWord > 10 ? 26 : (maxWord > 7 ? 30 : 36);
      return `<div class="card abs" id="c${i}" style="${pos}"><div class="card-icon">${ICON_SVG[it[0]]}</div><p style="font-size:${fontSize}px">${words.join('<br>')}</p></div>`;
    };
    const POS = ['left:45px; top:820px', 'left:385px; top:780px', 'left:725px; top:820px'];
    const top = items.length ? [330, 410] : [680, 780]; // без карточек — тезис по центру кадра
    const cardTl = items.length ? `
tl.from("#c1", { y: 500, rotation: -30, opacity: 0, duration: 0.45, ease: EB }, ${rel(items[0][2])})
  .from("#c2", { y: 500, opacity: 0, duration: 0.45, ease: EB }, ${rel(items[1][2])})
  .from("#c3", { y: 500, rotation: 30, opacity: 0, duration: 0.45, ease: EB }, ${rel(items[2][2])})
  .to("#c1", { rotation: -9, duration: 0.3 }, ${rel(items[0][2] + 0.5)})
  .to("#c3", { rotation: 9, duration: 0.3 }, ${rel(items[2][2] + 0.5)});` : '';
    const headAnim = (s.head_at && rel(s.head_at) > 0.25) ? `
tl.to("#sh", { scale: 1.08, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out" }, ${rel(s.head_at)});` : '';
    return `<!doctype html>
<html lang="ru" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<script src="assets/gsap.min.js"></script>
<style>
  @font-face { font-family: "Unbounded"; font-weight: 900; src: url("assets/fonts/Unbounded-Black.ttf") format("truetype"); }
  @font-face { font-family: "Unbounded"; font-weight: 800; src: url("assets/fonts/Unbounded-ExtraBold.ttf") format("truetype"); }
  @font-face { font-family: "Inter"; font-weight: 400; src: url("assets/fonts/Inter-Regular.ttf") format("truetype"); }
  @font-face { font-family: "Inter"; font-weight: 700; src: url("assets/fonts/Inter-Bold.ttf") format("truetype"); }
  @font-face { font-family: "Inter"; font-weight: 800; src: url("assets/fonts/Inter-ExtraBold.ttf") format("truetype"); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: ${SKIN.brand}; }
  #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: "Unbounded", sans-serif; color: #fff; }
  .abs { position: absolute; }
  #bg { left: 0; top: 0; width: 1080px; height: 1920px; background: radial-gradient(120% 80% at 50% 30%, ${SKIN.brandLight} 0%, ${SKIN.brand} 55%, ${SKIN.brandDeep} 100%); }
  .slide { left: 0; top: 0; width: 1080px; height: 1920px; z-index: 4; }
  .kicker { font-family: Inter, sans-serif; font-weight: 700; font-size: ${kickerSize}px; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; width: 1080px; padding: 0 72px; opacity: 0.85; }
  .head { font-weight: 900; font-size: 150px; line-height: .92; text-transform: uppercase; text-align: center; width: 1080px; padding: 0 72px; letter-spacing: -0.02em; overflow-wrap: anywhere; text-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .card { width: 310px; min-height: 440px; border-radius: 28px; background: ${SKIN.card}; box-shadow: 0 24px 50px rgba(0,0,0,.4);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 24px 14px; overflow: hidden; }
  .card-icon svg { width: 96px; height: 96px; display: block; }
  .card p { font-weight: 800; text-transform: uppercase; text-align: center; line-height: 1.12; word-break: break-word; overflow-wrap: anywhere; width: 100%; }
  ${slideCss}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${d}" data-width="1080" data-height="1920">
  <div id="bg" class="abs"></div>
  <div id="s" class="abs slide clip" data-start="0" data-duration="${d}">
    <div class="kicker abs" style="top:${top[0]}px;font-size:${kickerSize}px">${esc(kickerText)}</div>
    <div class="head abs" id="sh" style="top:${top[1]}px;font-size:${headSize}px">${headLines.map(esc).join('<br>')}</div>
    ${items.map((it, k) => card(it, k + 1, POS[k])).join('\n    ')}
  </div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
const EB = "back.out(1.7)";
tl.from("#sh", { y: 40, opacity: 0, duration: 0.35, ease: "power3.out" }, 0.05);
${headAnim}
${cardTl}
tl.to("#s", { opacity: 1, duration: 0.01 }, ${f2(d - 0.01)});
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
  }

  // ---------- спикер: один непрерывный слой, как #spk в эталоне ----------
  // Масштаб/сдвиг (perspective) + рамка clip-path (маска libass) + размытие.
  // Переходы задаются по типу сцены; «откуда» берётся из текущего состояния, поэтому порядок сцен любой.
  const SW = 720, SH = 1280, K = SW / W; // спикер трансформируется в 720p и потом масштабируется
  const TW = { s: [], x: [], y: [], ox: [], oy: [], ins: [] }; // ins = [top,right,bottom,left,radius]
  const set = (p, t, v) => TW[p].push({ t, d: 0, from: v, to: v, e: 'none' });
  const tw = (p, t, d, from, to, e) => TW[p].push({ t, d, from, to, e });
  const valAt = (list, t) => {
    let v = list[0].from;
    for (const w of list) {
      if (t < w.t) break;
      const p = w.d > 0 ? Math.min(1, (t - w.t) / w.d) : 1, e = EASE[w.e](p);
      v = Array.isArray(w.to) ? w.to.map((x, j) => w.from[j] + (x - w.from[j]) * e) : w.from + (w.to - w.from) * e;
    }
    return v;
  };
  const FULL = [0, 0, 0, 0, 0], CIRCLE = [500, 220, 780, 220, 320], RECT = [480, 170, 580, 170, 48];
  const same = (a, b) => (Array.isArray(a) ? a.every((x, j) => Math.abs(x - b[j]) < 1e-6) : Math.abs(a - b) < 1e-6);
  // плавно перевести спикера в позу (только изменившиеся свойства)
  const morph = (t, d, e, pose) => { for (const [p, v] of Object.entries(pose)) { const cur = valAt(TW[p], t); if (!same(cur, v)) tw(p, t, d, cur, v, e); } };
  const place = (t, pose) => { for (const [p, v] of Object.entries(pose)) set(p, t, v); };
  // «удар» зумом на входе (как cta в эталоне): 1.12 → 1 за 0,5 с, потом медленный наезд
  const punch = (s, to) => { tw('s', s.t0, 0.5, 1.12, 1, 'power3.out'); tw('s', s.t0 + 0.5, s.t1 - s.t0 - 0.5, 1, to, 'none'); };

  set('s', 0, 1); set('x', 0, 0); set('y', 0, 0); set('ox', 0, 540); set('oy', 0, 960); set('ins', 0, FULL);
  const hfJobs = [], bgDark = [], blurWin = [], slides = [], brolls = [];
  scenes.forEach((s, i) => {
    const d = s.t1 - s.t0, prev = scenes[i - 1];
    // спикер был не виден (ушёл со слайдом или закрыт b-roll) — входим резко, иначе плавно перетекаем
    const cut = !!prev && (prev.c === 'slide_full' || prev.c === 'broll_own');
    const fullPose = { x: 0, y: 0, ox: 540, oy: 960, ins: FULL };
    if (s.c === 'talking') {
      if (!prev) tw('s', s.t0, d, 1, 1.08, 'none');
      else if (cut) { place(s.t0, fullPose); punch(s, 1.06); }
      else {
        const S = valAt(TW.s, s.t0);
        if (Math.abs(S - 1) < 1e-6) { set('ox', s.t0, 540); set('oy', s.t0, 960); } // при масштабе 1 точка опоры не видна
        morph(s.t0, 0.45, 'power2.inOut', { y: 0, ins: FULL, s: 1 });
        tw('s', s.t0 + 0.45, d - 0.45, 1, 1.05, 'none');
      }
    }
    if (s.c === 'slide_full') {
      // весь кадр уезжает влево, слайд въезжает справа
      morph(s.t0, 0.45, 'power2.inOut', { x: -1080, s: 1 });
      const id = `slide${i}`; hfJobs.push({ id, html: slideHtml(s), dur: f2(d) }); slides.push({ id, s });
    }
    if (s.c === 'speaker_circle') {
      place(s.t0, { x: 0, y: 320, ox: 540, oy: 820, ins: CIRCLE });
      tw('s', s.t0, 0.45, 0, 1, 'back.out');
    }
    if (s.c === 'card_over_blur') {
      if (prev.c === 'speaker_circle') {
        // как в эталоне: браузер отдаёт clip-path сокращённо «inset(500px 220px 780px round 320px)», и GSAP сопоставляет числа
        // по порядку -> левый отступ стартует с 320, скругление сразу 0 (острые углы, несимметрично). Владелец одобрил этот вид.
        tw('y', s.t0, 0.4, valAt(TW.y, s.t0), 0, 'power2.inOut'); tw('ins', s.t0, 0.4, [500, 220, 780, 320, 0], FULL, 'power2.inOut');
      } else if (cut) { place(s.t0, fullPose); set('s', s.t0, 1); }
      else morph(s.t0, 0.4, 'power2.inOut', { y: 0, ins: FULL, s: 1 });
      blurWin.push({ a: s.t0, b: s.t1, din: 0.04, dout: 0.3 }); // CSS-фильтр в GSAP нарастает с ease-out -> визуально быстрее
    }
    if (s.c === 'speaker_rect') {
      if (cut) { place(s.t0, { x: 0, y: 420, ox: 540, oy: 960, ins: RECT }); tw('s', s.t0, 0.45, 0, 1, 'back.out'); }
      else morph(s.t0, 0.5, 'power3.inOut', { y: 420, ins: RECT, s: 1 });
      const nx = scenes.slice(i + 1).find(x => x.c !== 'broll_own');
      bgDark.push({ a: s.t0, b: nx ? Math.min(DUR, nx.t0 + 0.5) : DUR }); // тёмный фон гаснет, пока спикер уходит из рамки
    }
    if (s.c === 'broll_own') brolls.push(s);
    if (s.c === 'cta') { place(s.t0, fullPose); punch(s, 1.07); }
  });
  for (const k in TW) TW[k].sort((a, b) => a.t - b.t);

  function propExpr(list, T) {
    let e = String(list[list.length - 1].to);
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i], next = list[i + 1];
      let tail = e;
      if (next) tail = `if(lt(${T},${f2(next.t)}),${w.to},${e})`;
      if (w.d > 0) {
        const p = `min(max((${T}-${f2(w.t)})/${f2(w.d)},0),1)`;
        tail = `if(lt(${T},${f2(w.t + w.d)}),${w.from}+(${f2(w.to - w.from)})*${EEXPR[w.e](p)},${tail})`;
      }
      e = tail;
    }
    return `if(lt(${T},${f2(list[0].t)}),${list[0].from},${e})`;
  }
  // perspective: куда уходят углы исходника (sense=destination) = O + s(C-O) + d, в координатах 720p
  function spkPerspective() {
    const T = `(in/${FPS})`;
    const s = propExpr(TW.s, T), x = propExpr(TW.x, T), y = propExpr(TW.y, T), ox = propExpr(TW.ox, T), oy = propExpr(TW.oy, T);
    const cx = C => `(${K})*((${ox})+(${s})*(${C}-(${ox}))+(${x}))`, cy = C => `(${K})*((${oy})+(${s})*(${C}-(${oy}))+(${y}))`;
    return `perspective=x0='${cx(0)}':y0='${cy(0)}':x1='${cx(W)}':y1='${cy(0)}':x2='${cx(0)}':y2='${cy(H)}':x3='${cx(W)}':y3='${cy(H)}'` +
      `:interpolation=linear:sense=destination:eval=frame`;
  }
  // маска рамки (clip-path inset + round), пропущенная через тот же transform
  function spkMask(file) {
    const M = [];
    let prev = null, start = 0;
    const N = Math.round(DUR * FPS);
    const at = n => {
      const t = n / FPS, s = valAt(TW.s, t), x = valAt(TW.x, t), y = valAt(TW.y, t), ox = valAt(TW.ox, t), oy = valAt(TW.oy, t);
      const [it, ir, ib, il, R] = valAt(TW.ins, t);
      let L = ox + s * (il - ox) + x, Tp = oy + s * (it - oy) + y, Rr = ox + s * (W - ir - ox) + x, B = oy + s * (H - ib - oy) + y, r = R * s;
      if (s <= 0.001) return 'none';
      if (r < 1 && L <= 0 && Tp <= 0 && Rr >= W && B >= H) return 'full';
      L = Math.max(L, -4); Tp = Math.max(Tp, -4); Rr = Math.min(Rr, W + 4); B = Math.min(B, H + 4);
      if (Rr - L < 1 || B - Tp < 1) return 'none';
      r = Math.min(r, (Rr - L) / 2, (B - Tp) / 2);
      return [f2(L), f2(Tp), f2(Rr - L), f2(B - Tp), f2(r)].join(',');
    };
    const emit = (a, b, k) => {
      if (k === 'none') return;
      const [L, Tp, w, h, r] = k === 'full' ? [-4, -4, W + 8, H + 8, 0] : k.split(',').map(Number);
      M.push(`Dialogue: 0,${assTime(cs(a))},${assTime(cs(b))},D,,0,0,0,,{\\an7\\pos(${L},${Tp})\\bord0\\shad0\\1c&HFFFFFF&}{\\p1}${r > 0 ? rrect(w, h, r) : `m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}`}{\\p0}`);
    };
    for (let n = 0; n <= N; n++) {
      const k = n < N ? at(n) : null;
      if (k !== prev) { if (prev !== null) emit(start, n, prev); start = n; prev = k; }
    }
    fs.writeFileSync(file, ASS_HEAD(W, H, false) + M.join('\n') + '\n');
    return M.length;
  }

  // ---------- ffmpeg-граф ----------
  // входы: 0 — видео спикера (с его звуком), 1 — фон бренда, дальше окна размытия, слайды, b-roll
  const inputs = ['-i', speaker, '-loop', '1', '-framerate', String(FPS), '-t', String(DUR), '-i', bgPng];
  let inIdx = 2;
  const fc = [];
  // маска прозрачности с easing как у GSAP (ffmpeg fade только линейный): считается на 16×16 и растягивается — почти бесплатно.
  // GSAP без явного ease = power1.out. fades: [{st, d, e, out?}] в секундах от начала слоя.
  const EA = { 'power1.out': p => `(1-pow(1-${p},2))`, 'power3.out': p => `(1-pow(1-${p},4))` };
  const alphaMask = (label, len, fades) => {
    const f = fades.map(x => { const p = `min(max((T-${f2(x.st)})/${f2(x.d)},0),1)`; return x.out ? `(1-${EA[x.e](p)})` : EA[x.e](p); }).join('*');
    fc.push(`color=c=black:s=16x16:r=${FPS}:d=${len},format=gray,geq=lum='255*${f}',scale=${W}:${H}:flags=neighbor[${label}]`);
  };
  fc.push(`[1:v]format=yuv420p,fps=${FPS},settb=1/${FPS}[bg0]`);
  let bgl = 'bg0';
  bgDark.forEach((w, k) => {
    const len = f2(w.b - w.a);
    alphaMask(`dkm${k}`, len, [{ st: 0, d: 0.3, e: 'power1.out' }, ...(w.b < DUR ? [{ st: Math.max(0.3, len - 0.3), d: 0.3, e: 'power1.out', out: true }] : [])]);
    fc.push(`color=c=${SKIN.dark}:s=${W}x${H}:r=${FPS}:d=${len},format=yuv420p[dkc${k}];[dkc${k}][dkm${k}]alphamerge,setpts=PTS+${f2(w.a)}/TB[dk${k}]`);
    fc.push(`[${bgl}][dk${k}]overlay=eof_action=pass[bgd${k}]`); bgl = `bgd${k}`;
  });
  // спикер: кадрирование под 9:16, резкий + окна размытия
  fc.push(`[0:v]trim=0:${DUR},setpts=PTS-STARTPTS,fps=${FPS},scale=${SW}:${SH}:force_original_aspect_ratio=increase,crop=${SW}:${SH},split=${1 + blurWin.length}[spk0]${blurWin.map((_, k) => `[bsrc${k}]`).join('')}`);
  let sl = 'spk0';
  blurWin.forEach((w, k) => {
    const len = f2(w.b - w.a + w.dout);
    // Плавное кинематографичное размытие и легкое затемнение спикера на время показа плашки
    fc.push(`[bsrc${k}]trim=${f2(w.a)}:${f2(w.a + len)},setpts=PTS-STARTPTS,scale=${SW}:${SH}:flags=bilinear,gblur=sigma=10,` +
      `lutyuv=y=val*0.7:u=128+(val-128)*0.7:v=128+(val-128)*0.7,format=yuva420p,` +
      `fade=in:st=0:d=${w.din}:alpha=1,fade=out:st=${f2(w.b - w.a)}:d=${w.dout}:alpha=1,setpts=PTS+${f2(w.a)}/TB[bl${k}]`);
    fc.push(`[${sl}][bl${k}]overlay=eof_action=pass,format=yuv420p[spkb${k}]`); sl = `spkb${k}`;
  });
  const maskEvents = spkMask(`${outDir}/mask_spk.ass`);
  fc.push(`[${sl}]${spkPerspective()},scale=${W}:${H}:flags=bicubic,format=yuva420p[spkt]`);
  fc.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${DUR},ass=${outDir}/mask_spk.ass,format=gray,lut=c0='clip((val-16)*255/219,0,255)'[mspk]`);
  fc.push(`[spkt][mspk]alphamerge[spkm]`);
  fc.push(`[${bgl}][spkm]overlay=shortest=1[L1]`);
  let ll = 'L1';
  // слайды HyperFrames: въезжают справа вместе со сдвигом спикера
  slides.forEach(({ id, s }, k) => {
    inputs.push('-i', `${outDir}/slides/${id}.mp4`);
    const p = `min(max((t-${f2(s.t0)})/0.45,0),1)`;
    fc.push(`[${inIdx++}:v]fps=${FPS},format=yuv420p,trim=0:${f2(s.t1 - s.t0)},setpts=PTS-STARTPTS+${f2(s.t0)}/TB[sl${k}]`);
    fc.push(`[${ll}][sl${k}]overlay=x='1080*(1-${EEXPR['power2.inOut'](p)})':y=0:eval=frame:eof_action=pass[Ls${k}]`); ll = `Ls${k}`;
  });
  // свой b-roll: наезд 1.15→1 + проявление, затем медленный зум; короткий ролик зацикливается
  const zoomFilter = (pieces) => {
    const T = `(in/${FPS})`;
    let z = String(pieces[pieces.length - 1].to);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i], P = `min(max((${T}-${p.t})/${p.d},0),1)`;
      const e = p.e === 'power3.out' ? `(1-pow(1-${P},4))` : P;
      z = `if(lt(${T},${f2(p.t + p.d)}),${p.from}+(${f2(p.to - p.from)})*${e},${z})`;
    }
    const hx = `(${W / 2}/(${z}))`, hy = `(${H / 2}/(${z}))`;
    const X0 = `${W / 2}-${hx}`, X1 = `${W / 2}+${hx}`, Y0 = `${H / 2}-${hy}`, Y1 = `${H / 2}+${hy}`;
    return `perspective=x0='${X0}':y0='${Y0}':x1='${X1}':y1='${Y0}':x2='${X0}':y2='${Y1}':x3='${X1}':y3='${Y1}':interpolation=linear:eval=frame`;
  };
  brolls.forEach((s, k) => {
    const len = f2(s.t1 - s.t0);
    inputs.push('-stream_loop', '-1', '-ss', String(s.media_start || 0), '-t', String(len), '-i', s.src);
    const pieces = [{ t: 0, d: 0.4, from: 1.15, to: 1, e: 'power3.out' }, { t: 0.4, d: len - 0.4, from: 1, to: 1.06, e: 'none' }];
    // проявление как в эталоне: opacity 0→1 за 0,4 с, power3.out (вместе с наездом)
    alphaMask(`brm${k}`, len, [{ st: 0, d: 0.4, e: 'power3.out' }]);
    fc.push(`[${inIdx++}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bilinear,crop=${W}:${H},${zoomFilter(pieces)},setpts=PTS-STARTPTS[brv${k}];` +
      `[brv${k}][brm${k}]alphamerge,setpts=PTS-STARTPTS+${f2(s.t0)}/TB[br${k}]`);
    fc.push(`[${ll}][br${k}]overlay=eof_action=pass[Lb${k}]`); ll = `Lb${k}`;
  });
  fc.push(`[${ll}]ass=${outDir}/graphics.ass:fontsdir=${FD},trim=0:${DUR},format=yuv420p[vout]`);

  // ---------- графика ----------
  buildSubtitles();
  scenes.forEach(sceneGraphics);
  G.write(`${outDir}/graphics.ass`);

  // ---------- HF-проекты ----------
  for (const j of hfJobs) {
    const d = `${outDir}/slides/${j.id}`;
    fs.mkdirSync(`${d}/assets`, { recursive: true });
    fs.writeFileSync(`${d}/index.html`, j.html);
    fs.copyFileSync(gsap, `${d}/assets/gsap.min.js`);
    fs.mkdirSync(`${d}/assets/fonts`, { recursive: true });
    for (const name of ['Unbounded-Black.ttf', 'Unbounded-ExtraBold.ttf', 'Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-ExtraBold.ttf']) {
      fs.copyFileSync(path.join(FD, name), `${d}/assets/fonts/${name}`);
    }
    fs.writeFileSync(`${d}/hyperframes.json`, JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true } }, null, 2));
    fs.writeFileSync(`${d}/meta.json`, JSON.stringify({ id: j.id, name: j.id }, null, 2));
    fs.writeFileSync(`${d}/package.json`, JSON.stringify({ name: j.id, private: true, type: 'module' }, null, 2));
  }
  // ---------- SFX звуковой дизайн ----------
  const sfxEvents = [];
  scenes.forEach(s => {
    if (s.c === 'slide_full') {
      sfxEvents.push({ t: s.t0, file: 'whoosh_short.mp3', vol: 0.35 });
      if (s.object?.items) {
        s.object.items.forEach(it => {
          if (it[2] !== undefined) sfxEvents.push({ t: s.t0 + it[2], file: 'bubble.mp3', vol: 0.35 });
        });
      }
    }
    if (s.c === 'card_over_blur') {
      sfxEvents.push({ t: s.t0, file: 'whoosh_short.mp3', vol: 0.25 });
      if (s.object?.at !== undefined) sfxEvents.push({ t: s.object.at, file: 'pop.mp3', vol: 0.40 });
      if (s.object?.items) {
        s.object.items.forEach(it => {
          if (it[1] !== undefined) sfxEvents.push({ t: it[1], file: 'click.mp3', vol: 0.35 });
        });
      }
    }
    if (s.c === 'speaker_circle') {
      if (s.badge_at !== undefined) sfxEvents.push({ t: s.badge_at, file: 'pop.mp3', vol: 0.35 });
    }
    if (s.c === 'speaker_rect' && s.object?.c === 'stat_big') {
      sfxEvents.push({ t: s.object.at, file: 'impact.mp3', vol: 0.30 });
    }
    if (s.c === 'cta') {
      if (s.keyword_at !== undefined) sfxEvents.push({ t: s.keyword_at, file: 'ding.mp3', vol: 0.40 });
    }
  });

  const sfxLabels = [];
  sfxEvents.forEach((ev, k) => {
    const sfxPath = path.join(SFX_DIR, ev.file);
    if (fs.existsSync(sfxPath)) {
      inputs.push('-i', sfxPath);
      const sfxIn = inIdx++;
      const ms = Math.max(0, Math.round(ev.t * 1000));
      fc.push(`[${sfxIn}:a]adelay=${ms}|${ms},volume=${ev.vol}[sfx${k}]`);
      sfxLabels.push(`[sfx${k}]`);
    }
  });

  if (sfxLabels.length > 0) {
    fc.push(`[0:a]${sfxLabels.join('')}amix=inputs=${sfxLabels.length + 1}:duration=first:dropout_transition=0[aout]`);
  }

  fs.writeFileSync(`${outDir}/filter.txt`, fc.join(';\n'));
  return { inputs, hfJobs: hfJobs.map(j => j.id), hasSfx: sfxLabels.length > 0, stats: { assEvents: G.count(), maskEvents, sfxCount: sfxLabels.length } };
}

// Обложка: первый кадр спикера + хук по центру (капс Inter Display Black, строки белые с тенью, последняя — в плашке бренда,
// как акцент кинетических титров эталона). Пишет ASS-файл; кадр и наложение делает cli (ffmpeg).
export function coverAss(hook, skin, file, palette = null) {
  const G = makeAss(W, H), f = FONTS.disp900, lsK = -0.02;
  const text = String(hook).toUpperCase().trim();
  let size = 150, lines = wrap(f, size, text, 900, lsK * size);
  if (lines.length > 3) { size = 118; lines = wrap(f, size, text, 900, lsK * size); }
  size = fitSize(f, size, lines, 900, lsK);
  const ls = lsK * size, lh = size * 0.98, padX = 34, padY = 10, shadow = { dx: 0, dy: 8, blur: 14, op: 0.6 };
  const blockH = lines.length * lh + (lines.length > 1 ? 2 * padY : 0);
  let y = H / 2 - blockH / 2 - 40;
  const pillBg = palette?.caption?.fill || palette?.accent || skin.brand;
  const pillText = palette?.caption?.text || skin.white;
  const normalText = palette?.ink || skin.white;
  const parts = [];
  lines.forEach((ln, i) => {
    const tw = textW(f, size, ln, ls), x = W / 2 - tw / 2, pill = i === lines.length - 1 && lines.length > 1;
    if (pill) { y += padY; parts.push({ kind: 'draw', x: x - padX, y: y - padY + 4, path: rrect(f2(tw + 2 * padX), f2(lh + 2 * padY - 8), 26), color: pillBg, shadow: { dx: 0, dy: 16, blur: 18, op: 0.35 } }); }
    parts.push(textPart({ font: f, size, text: ln, x, lineTop: y, lineH: lh, color: pill ? pillText : normalText, ls, shadow: pill ? null : shadow }));
    y += lh;
  });
  G.element({ t0: 0, t1: 1, parts, layer: 1 });
  G.write(file);
}

// фон бренда (радиальный градиент как у слайда HyperFrames) — один PNG на скин / стиль
export function bgGeq(skin, palette = null) {
  const rgb = h => {
    if (!h) return [0, 0, 0];
    const hex = h.replace(/^#/, '');
    if (hex.length === 3) return [0, 1, 2].map(i => parseInt(hex[i] + hex[i], 16));
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  };
  const light = palette?.bgLight || skin.brandLight;
  const main = palette?.bgMain || skin.brand;
  const deep = palette?.bgDeep || skin.brandDeep;
  const [a, b, c] = [rgb(light), rgb(main), rgb(deep)];
  const ch = j => `'st(0,hypot((X-540)/1296,(Y-576)/1536));if(lt(ld(0),0.55),${a[j]}+(${b[j]}-${a[j]})*ld(0)/0.55,if(lt(ld(0),1),${b[j]}+(${c[j]}-${b[j]})*(ld(0)-0.55)/0.45,${c[j]}))'`;
  return `format=gbrp,geq=r=${ch(0)}:g=${ch(1)}:b=${ch(2)}`;
}


