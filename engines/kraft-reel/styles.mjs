// Стили, скины (палитры) и форматы kraft-reel — всё данными в папках, код только читает.
//   styles/<id>/style.json + style.css — визуальный язык (утверждает владелец: status "approved")
//   skins/<id>.json                    — палитра; или один цвет акцента "#RRGGBB" — производные считаются здесь
//   formats/<id>.json                  — какие сцены разрешены агенту (сценарный шаблон)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const list = (dir, pick) => { try { return fs.readdirSync(path.join(HERE, dir)).map((x) => pick(x)).filter(Boolean); } catch { return []; } };

export function styles() {
  return list('styles', (d) => { const f = path.join(HERE, 'styles', d, 'style.json'); return fs.existsSync(f) ? { ...readJson(f), dir: path.join(HERE, 'styles', d) } : null; });
}
export function formats() { return list('formats', (f) => (f.endsWith('.json') ? readJson(path.join(HERE, 'formats', f)) : null)); }
export function skins() { return list('skins', (f) => (f.endsWith('.json') ? { id: f.replace(/\.json$/, ''), ...readJson(path.join(HERE, 'skins', f)) } : null)); }
export const getStyle = (id) => styles().find((s) => s.id === id);
export const getFormat = (id) => formats().find((f) => f.id === id);
export const styleCss = (st) => fs.readFileSync(path.join(st.dir, st.css || 'style.css'), 'utf8');

// ── цвет ────────────────────────────────────────────────────────────────────
const HEX = /^#?[0-9a-f]{6}$/i;
const rgb = (h) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbStr = (h) => rgb(h).join(',');

// акцент → всё, что от него зависит; белый текст на акценте должен читаться (контраст ≥ 3)
export function accentSet(acc, bg, warnings = []) {
  let a = acc.startsWith('#') ? acc.toUpperCase() : '#' + acc.toUpperCase();
  let guard = 0;
  while (contrast(a, '#FFFFFF') < 3 && guard++ < 12) a = mix(a, '#000000', 0.08);
  if (a !== acc.toUpperCase() && a !== '#' + acc.toUpperCase()) warnings.push(`акцент ${acc} затемнён до ${a}: белый текст на нём иначе не читается`);
  return { acc: a, accPale: mix(a, bg, 0.62), accLight: mix(a, '#FFFFFF', 0.18), accDeep: mix(a, '#000000', 0.14), accRgb: rgbStr(a) };
}

// итоговая палитра: скин стиля → скин плана (имя или "#акцент") → точечные цвета плана
export function resolvePalette(st, { skin, colors } = {}, warnings = []) {
  const base = skins().find((s) => s.id === (st.skin || st.id)) || skins().find((s) => s.id === 'kraft');
  let P = { ...base };
  if (skin && HEX.test(skin)) Object.assign(P, accentSet(skin, P.bg1, warnings));
  else if (skin) { const s = skins().find((x) => x.id === skin); if (s) P = { ...P, ...s }; else warnings.push(`скин "${skin}" не найден — оставлен ${base.id}`); }
  for (const [k, v] of Object.entries(colors || {})) if (HEX.test(String(v))) P[k] = String(v).toUpperCase();
  if (!P.accRgb || (colors && colors.acc) || (skin && !HEX.test(skin))) Object.assign(P, accentSet(P.acc, P.bg1, warnings));
  P.bg1Rgb = rgbStr(P.bg1); P.groundRgb = P.groundRgb || rgbStr(P.bg3); P.codeText = P.codeText || P.onDark; P.shadowRgb = P.shadowRgb || '90,70,40';
  delete P.id; delete P.name; delete P.description;
  return P;
}
