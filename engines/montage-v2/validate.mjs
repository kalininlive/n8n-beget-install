// MONTAGE v2 — проверка плана по схеме и правилам режиссуры + привязка времён появления к словам whisper.
// validate(plan, words, { duration, render }) -> { ok, errors[], warnings[], plan (нормализованный, с *_at) }
// errors — план рендерить нельзя (агенту вернуть на исправление); warnings — можно, но стоит посмотреть.
import { COMPONENTS, OBJECTS, ICONS, RULES, STYLES, FORMATS, STYLE_DEFAULT, FORMAT_DEFAULT, SKIN_DEFAULT, SKINS_DIR } from './catalog.mjs';
import { resolveSkin } from './skins.mjs';

const r2 = v => Math.round(v * 100) / 100;

// ---------- сравнение слов плана и речи ----------
const LAT = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'й', z: 'з' };
const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
const cyr = s => s.replace(/[a-z]/g, ch => LAT[ch] || ch);
const STOP = new Set(['в', 'на', 'по', 'за', 'и', 'а', 'не', 'с', 'к', 'о', 'у', 'из', 'от', 'до', 'же', 'ли', 'то', 'это', 'что', 'как']);
export const tokens = text => String(text).split(/[\s·/|,.:;!?()«»"—–]+/).map(norm).filter(t => t && (/\d/.test(t) || !STOP.has(t)));
// совпадение токена плана и слова речи: числа — точно, слова — по общей основе (≥ 3 букв, ≥ 60% короткого)
export function same(a, b) {
  if (!a || !b) return false;
  if (/\d/.test(a) || /\d/.test(b)) return a.replace(/\D/g, '') === b.replace(/\D/g, '') && /\d/.test(a);
  const x = cyr(a), y = cyr(b);
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  if (n < 3) return false;
  let k = 0; while (k < n && x[k] === y[k]) k++;
  return k >= 3 && k >= Math.ceil(n * 0.6);
}
// первое слово речи в окне [from, to), совпавшее с любым токеном текста
function align(text, W, from, to) {
  const ts = tokens(text);
  for (const w of W) if (w.t >= from - 1e-6 && w.t < to && ts.some(t => same(t, w.n))) return w;
  return null;
}
// доля токенов текста, которые есть в речи рядом со сценой (правило 4: только слова из речи)
function coverage(text, W, from, to) {
  const ts = tokens(text); if (!ts.length) return 1;
  const near = W.filter(w => w.t >= from - 3 && w.t < to + 3);
  return ts.filter(t => near.some(w => same(t, w.n))).length / ts.length;
}

// ---------- проверка ----------
export function validate(input, words, { duration, render = false } = {}) {
  const errors = [], warnings = [];
  const err = (i, m) => errors.push(i == null ? m : `сцена ${i + 1}: ${m}`);
  const warn = (i, m) => warnings.push(i == null ? m : `сцена ${i + 1}: ${m}`);
  const plan = JSON.parse(JSON.stringify(input || {}));
  const W = (words || []).filter(w => Number.isFinite(w.t)).map(w => ({ ...w, n: norm(w.w) })).sort((a, b) => a.t - b.t);
  if (!W.length) errors.push('нет слов whisper (words.json пуст)');
  const S = plan.scenes;
  if (!Array.isArray(S) || !S.length) return { ok: false, errors: ['нет scenes[]'], warnings, plan };
  const DUR = r2(duration || plan.duration || S[S.length - 1].t1);
  plan.duration = DUR;

  // 0. стиль, формат, цвет
  plan.style = plan.style || STYLE_DEFAULT;
  plan.format = plan.format || FORMAT_DEFAULT;
  const style = STYLES[plan.style], format = FORMATS[plan.format];
  if (!style) errors.push(`стиль "${plan.style}" не найден (есть: ${Object.keys(STYLES).join(', ')})`);
  else if (style.status !== 'approved') warnings.push(`стиль "${plan.style}" ещё не утверждён владельцем (status: ${style.status})`);
  if (!format) errors.push(`формат "${plan.format}" не найден (есть: ${Object.keys(FORMATS).join(', ')})`);
  const allowed = new Set((format?.components || Object.keys(COMPONENTS)).filter(c => !style || style.components.includes(c)));
  try { plan.skinResolved = resolveSkin(plan.skin ?? SKIN_DEFAULT, SKINS_DIR, m => warnings.push(m)); }
  catch (e) { errors.push(e.message); }

  // 1. структура: подряд, без дыр, от 0 до конца ролика
  S.forEach((s, i) => {
    const C = COMPONENTS[s.c];
    if (!C) return err(i, `неизвестный компонент "${s.c}" (есть: ${Object.keys(COMPONENTS).join(', ')})`);
    if (!allowed.has(s.c)) return err(i, `компонент "${s.c}" не входит в формат "${plan.format}" / стиль "${plan.style}" (можно: ${[...allowed].join(', ')})`);
    if (!(s.t1 > s.t0)) return err(i, `t1 (${s.t1}) должен быть больше t0 (${s.t0})`);
    const prevT1 = i ? S[i - 1].t1 : 0;
    if (Math.abs(s.t0 - prevT1) > 0.05) err(i, `t0 = ${s.t0}, а предыдущая сцена кончается в ${prevT1} (сцены идут встык, без дыр)`);
    else s.t0 = prevT1;
    const d = s.t1 - s.t0, last = i === S.length - 1;
    // допуск 0,1 с: границы сцен ставятся по словам
    if (d < C.dur[0] - 0.1) err(i, `${s.c} длится ${r2(d)} с, минимум ${C.dur[0]} с`);
    if (d > C.dur[1] + 0.1) err(i, `${s.c} длится ${r2(d)} с, максимум ${C.dur[1]} с — разбейте на две сцены`);
    // поля
    for (const [f, kind] of Object.entries(C.fields)) {
      const opt = kind.endsWith('?'), v = s[f];
      if (v == null || v === '') { if (!opt && !(f === 'query' && s.src)) err(i, `${s.c}: нет поля "${f}"`); continue; }
      if (typeof v !== 'string') { err(i, `${s.c}.${f} должно быть строкой`); continue; }
      const lim = { text: s.c === 'cta' ? RULES.ctaTextMax : RULES.kickerMax, badge: RULES.badgeMax, keyword: RULES.keywordMax, query: 60 }[kind.replace('?', '')];
      if (lim && v.length > lim) err(i, `${s.c}.${f} "${v}" длиннее ${lim} символов`);
      if (kind.startsWith('head') && v.split(/\s+/).some(wd => wd.length > RULES.headLineMax)) err(i, `${s.c}.${f}: слово длиннее ${RULES.headLineMax} символов`);
      if (kind.startsWith('head') && v.length > RULES.headLineMax * 2) err(i, `${s.c}.${f} "${v}" не влезет в 2 строки по ${RULES.headLineMax}`);
    }
    // объект
    const o = s.object;
    if (C.obj && !o && !C.objOptional) err(i, `${s.c}: нужен object (${C.obj.join(' | ')})`);
    if (o) {
      if (!C.obj || !C.obj.includes(o.c)) err(i, `${s.c}: объект "${o.c}" не подходит (можно: ${(C.obj || ['—']).join(', ')})`);
      else checkObject(i, s, o, err, warn);
    }
    if (render && s.c === 'broll_own' && !s.src) warn(i, 'broll_own: своего ролика не нашлось (нет src) — сцена будет речью спикера');
    if (last && Math.abs(s.t1 - DUR) > 0.3) err(i, `последняя сцена кончается в ${s.t1}, а ролик длится ${DUR} с`);
    if (last) s.t1 = DUR;
  });
  if (plan.hook != null && (typeof plan.hook !== 'string' || plan.hook.length > RULES.hookTextMax)) errors.push(`hook — строка до ${RULES.hookTextMax} символов (хук для обложки)`);
  if (errors.length) return { ok: false, errors, warnings, plan };

  // 2. правила режиссуры (§3)
  if (S[0].c !== 'talking') err(0, 'первая сцена — talking (хук с крупным титром)');
  else if (S[0].t1 < RULES.hookMin - 0.1 || S[0].t1 > RULES.hookMax + 0.1) err(0, `хук длится ${r2(S[0].t1)} с, нужно ${RULES.hookMin}–${RULES.hookMax} с`);
  if (S[S.length - 1].c !== 'cta') err(S.length - 1, 'последняя сцена — cta');
  S.forEach((s, i) => { if (i && S[i - 1].c === s.c) err(i, `два ${s.c} подряд`); });
  const heavy = S.filter(s => RULES.heavy.includes(s.c)).reduce((a, s) => a + s.t1 - s.t0, 0);
  if (heavy > DUR * RULES.heavyShare + 0.1) err(null, `slide_full + card_over_blur занимают ${r2(heavy)} с из ${DUR} (> 50%)`);
  S.forEach((s, i) => { if (s.c === 'cta' && i !== S.length - 1) err(i, 'cta бывает только последней сценой'); });
  if (errors.length) return { ok: false, errors, warnings, plan };

  // 3. времена появления: заданные — проверить, недостающие — привязать к словам
  S.forEach((s, i) => fillTimes(i, s, W, warn));
  // 4. тексты — из речи
  S.forEach((s, i) => {
    const texts = [s.kicker, s.head, s.badge, s.text, s.keyword, ...(s.object?.c === 'checklist' ? s.object.items.map(x => x[0]) : [])].filter(Boolean);
    for (const t of texts) { const c = coverage(t, W, s.t0, s.t1); if (c < 0.5) warn(i, `"${t}": мало слов из речи (${Math.round(c * 100)}%) — текст должен быть из того, что сказано`); }
  });
  return { ok: true, errors, warnings, plan };
}

// Мелочи, которые не портят смысл, исправляются здесь же с предупреждением — монтаж не должен падать из-за них
function checkObject(i, s, o, err, warn) {
  const lim = OBJECTS[o.c].items;
  if (o.c === 'cards_trio' || o.c === 'checklist') {
    if (Array.isArray(o.items) && o.items.length > lim[1]) { warn(i, `${o.c}: пунктов ${o.items.length}, оставлены первые ${lim[1]}`); o.items = o.items.slice(0, lim[1]); }
    if (!Array.isArray(o.items) || o.items.length < lim[0] || o.items.length > lim[1]) return err(i, `${o.c}: пунктов должно быть ${lim[0]}–${lim[1]}`);
    o.items = o.items.map(x => (Array.isArray(x) ? x : o.c === 'checklist' ? [x] : x));
  }
  if (o.c === 'cards_trio') o.items.forEach((x, k) => {
    if (!Array.isArray(x) || typeof x[1] !== 'string') return err(i, `cards_trio.items[${k}] — ["иконка", "текст"]`);
    if (!ICONS.includes(x[0])) { warn(i, `cards_trio: иконки "${x[0]}" нет — взята check`); x[0] = 'check'; }
    if (x[1].length > RULES.cardItemMax) err(i, `cards_trio: "${x[1]}" длиннее ${RULES.cardItemMax} символов`);
  });
  if (o.c === 'checklist') {
    if (!o.title) err(i, 'checklist: нет title');
    if (typeof o.title === 'string') { const m = o.title.match(/^(.*\s)(\S+)$/); o.title = m ? [m[1], m[2]] : ['', o.title]; } // последнее слово — цветом бренда
    if ((o.title[0] + o.title[1]).length > 24) err(i, `checklist.title "${o.title.join('')}" длиннее 24 символов`);
    o.items.forEach(x => { if (typeof x[0] !== 'string') err(i, 'checklist.items — ["текст", at?]'); else if (x[0].length > RULES.checkItemMax) err(i, `checklist: "${x[0]}" длиннее ${RULES.checkItemMax} символов`); });
  }
  if (o.c === 'stat_big') {
    if (!Number.isFinite(o.value)) err(i, 'stat_big.value — число');
    else if (Math.abs(o.value) >= 1e5) err(i, 'stat_big.value — не больше 5 знаков');
    o.prefix = o.prefix ?? ''; o.suffix = o.suffix ?? '';
  }
}

// времена появления элементов. Заданные агентом значения не трогаем (только проверяем), недостающие считаем.
function fillTimes(i, s, W, warn) {
  const inside = (v, name, lo = s.t0, hi = s.t1) => {
    if (v == null) return null;
    if (!(v >= lo - 1e-6 && v < hi)) { warn(i, `${name} = ${v} вне сцены ${lo}–${hi}, пересчитано по словам`); return null; }
    if (!W.some(w => Math.abs(w.t - v) <= RULES.snap)) warn(i, `${name} = ${v}: рядом нет начала слова`);
    return v;
  };
  const a = (text, from, to = s.t1) => align(text, W, from, to)?.t ?? null;
  const o = s.object;
  if (s.c === 'slide_full') {
    s.head_at = inside(s.head_at, 'head_at') ?? a(s.head, s.t0 + 0.2) ?? r2(s.t0 + 0.3);
    if (o) {
      const step = Math.min(0.8, (s.t1 - s.t0 - 1.2) / 3);
      o.items.forEach((x, k) => { x[2] = inside(x[2], `cards_trio.items[${k}]`) ?? r2(s.t0 + 0.4 + k * step); });
    }
  }
  if (s.c === 'speaker_circle') {
    s.head_at = inside(s.head_at, 'head_at') ?? a(s.head, s.t0 + 0.2) ?? r2(s.t0 + 0.6);
    if (s.badge) s.badge_at = inside(s.badge_at, 'badge_at', s.head_at) ?? a(s.badge, s.head_at + 0.1) ?? r2(Math.min(s.head_at + 0.5, s.t1 - 0.5));
  }
  if (s.c === 'card_over_blur' && o.c === 'checklist') {
    o.at = inside(o.at, 'checklist.at') ?? r2(s.t0 + 0.1);
    let lo = o.at + 0.5;
    const n = o.items.length, span = Math.max(0.6, (s.t1 - 1 - lo) / n);
    // пункт появляется, когда произнесено первое его слово; не найден — через равный шаг после предыдущего
    o.items.forEach((x, k) => {
      x[1] = inside(x[1], `checklist.items[${k}]`, lo) ?? a(x[0], lo, s.t1 - 0.5) ?? r2(k ? o.items[k - 1][1] + span : lo);
      lo = x[1] + 0.6;
    });
  }
  if (s.c === 'speaker_rect' && o?.c === 'stat_big') {
    const said = a(String(o.value), s.t0, s.t1 + 1);
    o.at = inside(o.at, 'stat_big.at') ?? r2(Math.max(s.t0 + 0.4, (said ?? s.t0 + 2.3) - 1.85));
    o.count_at = inside(o.count_at, 'stat_big.count_at', o.at) ?? r2(Math.max(o.at + 0.4, (said ?? s.t0 + 2.3) - 1.1));
  }
  if (s.c === 'cta') {
    s.keyword_at = inside(s.keyword_at, 'keyword_at') ?? a(s.keyword, s.t0) ?? r2(Math.min(s.t0 + 1.5, s.t1 - 1));
    s.at = inside(s.at, 'cta.at', s.t0, s.keyword_at + 1e-3) ?? r2(Math.max(s.t0 + 0.5, s.keyword_at - 0.26));
  }
}
