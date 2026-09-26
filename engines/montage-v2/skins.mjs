// MONTAGE v2 — бренд-кит (скин): вся палитра выводится из одного цвета бренда.
// plan.skin: "brand_blue" (готовый скин из skins/) | { brand: "#E53935" } (остальное досчитывается) | { brand, dark, … } (явные значения важнее).
import fs from 'fs';
import path from 'path';

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgb2hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
function hsl2rgb([h, s, l]) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
}
const hsl = (h, s, l) => rgb2hex(hsl2rgb([h, Math.max(0, Math.min(100, s)), Math.max(0, Math.min(100, l))]));
const lum = hex => { const c = hex2rgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

// Формулы подобраны так, что из #1E6BFF получается палитра эталона (brand_blue.json) с точностью до 1–2 единиц.
export function derive(brand) {
  const [h, s, l] = rgb2hsl(hex2rgb(brand));
  return {
    brand: brand.toUpperCase(),
    brandLight: hsl(h - 3, s, l + 6),        // центр радиального градиента фона
    brandDeep: hsl(h + 2, s * 0.83, l - 10), // край градиента
    dark: hsl(h + 4, Math.min(s, 41), 7),     // фон speaker_rect
    muted: hsl(h - 2, Math.min(s, 46), 74),   // подводка на тёмном
    card: hsl(h + 3, Math.min(s, 17), 8),     // карточки cards_trio
    ink: '#0E1116', white: '#FFFFFF', rule: '#E6E9F0',
  };
}

// белый текст на плашке бренда должен читаться: контраст ≥ 3 (WCAG для крупного текста); светлый бренд затемняется
export function ensureContrast(skin, warn = () => {}) {
  let { brand } = skin, [h, s, l] = rgb2hsl(hex2rgb(brand)), n = 0;
  while (contrast(brand, '#FFFFFF') < 3 && l > 5) { l -= 2; brand = hsl(h, s, l); n++; }
  if (!n) return skin;
  warn(`цвет бренда ${skin.brand} слишком светлый для белого текста, взят ${brand}`);
  return { ...derive(brand), ...Object.fromEntries(Object.entries(skin).filter(([k]) => !['brand', 'brandLight', 'brandDeep'].includes(k))), brand, name: skin.name };
}

export function resolveSkin(spec, skinsDir, warn = () => {}) {
  if (spec == null || spec === '') spec = 'brand_blue';
  let skin;
  if (typeof spec === 'string') {
    const f = path.join(skinsDir, `${spec}.json`);
    if (isHex(spec)) skin = { name: 'custom', ...derive(spec) };
    else if (fs.existsSync(f)) skin = JSON.parse(fs.readFileSync(f, 'utf8'));
    else throw new Error(`скин "${spec}" не найден (есть: ${listSkins(skinsDir).join(', ')}; можно цвет "#RRGGBB" или { "brand": "#RRGGBB" })`);
  } else if (typeof spec === 'object') {
    if (!isHex(spec.brand)) throw new Error('skin.brand — цвет вида "#RRGGBB"');
    for (const [k, v] of Object.entries(spec)) if (k !== 'name' && !isHex(v)) throw new Error(`skin.${k} — цвет вида "#RRGGBB"`);
    skin = { name: spec.name || 'custom', ...derive(spec.brand), ...spec };
  } else throw new Error('skin — имя скина, "#RRGGBB" или { brand }');
  return ensureContrast(skin, warn);
}
export const listSkins = dir => fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
