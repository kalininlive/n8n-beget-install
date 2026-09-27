// Проверка плана агента и перевод «индексы слов → секунды».
// Вход: plan {scenes:[{type, w:[first,last], …}]}, words [{w,s,e}], duration (с).
// Выход: {ok, errors[], warnings[], plan} — plan разрешён: scenes[].start/end/words, duration.
// Мелочи чинятся с предупреждением (пропуски/наложения слов, неизвестная иконка, лишний пункт списка); ошибка — только то, что сломает кадр.
import { COMPONENTS, ICONS } from './catalog.mjs';

const nWords = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter(Boolean).length;

export function validate(planIn, words, { duration } = {}) {
  const errors = [], warnings = [];
  const plan = JSON.parse(JSON.stringify(planIn || {}));
  const SC = Array.isArray(plan.scenes) ? plan.scenes : [];
  if (!words.length) errors.push('нет слов речи (words пуст)');
  if (!SC.length) errors.push('в плане нет scenes');
  const last = words.length - 1;
  const dur = duration || (words.length ? words[last].e + .6 : 0);

  // 1. индексы слов: по порядку, без дыр и наложений
  let expect = 0;
  SC.forEach((sc, i) => {
    const at = `scenes[${i}] (${sc.type})`;
    if (!Array.isArray(sc.w) || sc.w.length !== 2 || !sc.w.every(Number.isInteger)) { errors.push(`${at}: поле w должно быть [первое, последнее] — индексы слов`); return; }
    let [a, b] = sc.w;
    if (a !== expect) { warnings.push(`${at}: начало ${a} → ${expect} (сцены должны идти подряд)`); a = expect; }
    if (i === SC.length - 1 && b !== last) { warnings.push(`${at}: последняя сцена дотянута до слова ${last}`); b = last; }
    if (b > last) { warnings.push(`${at}: конец ${b} → ${last}`); b = last; }
    if (b < a) { errors.push(`${at}: пустая сцена (w=[${sc.w}])`); b = a; }
    sc.w = [a, b];
    expect = b + 1;
  });

  // 2. типы и поля
  SC.forEach((sc, i) => {
    const at = `scenes[${i}] (${sc.type})`, spec = COMPONENTS[sc.type];
    if (!spec) { errors.push(`${at}: неизвестный type, можно: ${Object.keys(COMPONENTS).join(', ')}`); return; }
    for (const [f, d] of Object.entries(spec.fields)) {
      const v = sc[f];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) { if (d.required) errors.push(`${at}: нет поля ${f}`); continue; }
      if (d.type === 'icon' && !ICONS.includes(v)) { warnings.push(`${at}: иконка ${v} → ${f === 'right' ? 'spark' : 'doc'}`); sc[f] = f === 'right' ? 'spark' : 'doc'; }
      if (d.type === 'text' && d.maxWords && nWords(v) > d.maxWords) errors.push(`${at}: ${f} длиннее ${d.maxWords} слов: "${v}"`);
      if (d.type === 'text' && d.maxChars && String(v).length > d.maxChars) { warnings.push(`${at}: ${f} обрезан до ${d.maxChars} символов`); sc[f] = String(v).slice(0, d.maxChars); }
      if (d.type === 'list') {
        if (!Array.isArray(v)) { errors.push(`${at}: ${f} должен быть списком`); continue; }
        if (v.length > d.n[1]) { warnings.push(`${at}: ${f} — оставлено ${d.n[1]} из ${v.length}`); sc[f] = v.slice(0, d.n[1]); }
        sc[f].forEach((x, k) => { if (d.maxWords && nWords(x) > d.maxWords) errors.push(`${at}: ${f}[${k}] длиннее ${d.maxWords} слов: "${x}"`); });
      }
    }
    if (sc.type === 'window') content(sc, at, errors, warnings);
    if (sc.type === 'cta' && i !== SC.length - 1) errors.push(`${at}: cta может быть только последней сценой`);
    if (i && SC[i - 1].type === sc.type && sc.type !== 'window') errors.push(`${at}: два ${sc.type} подряд — чередуй сцены`);
    if (i > 1 && sc.type === 'window' && SC[i - 1].type === 'window' && SC[i - 2].type === 'window') errors.push(`${at}: больше 2 окон подряд`);
  });
  const wins = SC.filter((s) => s.type === 'window').length;
  if (SC.length > 2 && wins > Math.ceil(SC.length / 2)) warnings.push(`окон ${wins} из ${SC.length} — больше половины, ролик станет однообразным`);

  // 3. секунды: сцена начинается чуть раньше первого своего слова, кончается там, где начинается следующая
  if (!errors.length) {
    SC.forEach((sc, i) => { sc.start = i ? Math.max(words[sc.w[0]].s - .15, words[sc.w[0] - 1].e) : 0; });
    SC.forEach((sc, i) => {
      sc.end = i < SC.length - 1 ? SC[i + 1].start : dur;
      sc.words = words.slice(sc.w[0], sc.w[1] + 1);
      const d = sc.end - sc.start, [lo, hi] = COMPONENTS[sc.type].duration, at = `scenes[${i}] (${sc.type})`;
      if (d < 1.2) errors.push(`${at}: ${d.toFixed(1)} с — слишком коротко, объедини с соседней`);
      else if (d < lo || d > hi) warnings.push(`${at}: ${d.toFixed(1)} с (рекомендуется ${lo}–${hi})`);
      sc.start = Math.round(sc.start * 1000) / 1000; sc.end = Math.round(sc.end * 1000) / 1000;
    });
  }
  plan.duration = Math.round(dur * 100) / 100;
  return { ok: !errors.length, errors, warnings, plan };
}

function content(sc, at, errors, warnings) {
  const c = sc.content;
  if (!c || typeof c !== 'object') return;
  const kinds = COMPONENTS.window.kinds;
  if (!kinds[c.kind]) { errors.push(`${at}: content.kind "${c.kind}" — можно ${Object.keys(kinds).join(', ')}`); return; }
  if (c.kind === 'code') {
    if (!Array.isArray(c.lines) || c.lines.length < 2) errors.push(`${at}: code — нужны lines (3–6 строк)`);
    else {
      if (c.lines.length > 6) { warnings.push(`${at}: code — оставлено 6 строк`); c.lines = c.lines.slice(0, 6); }
      c.lines.forEach((l, k) => { if (String(l).length > 30) errors.push(`${at}: code.lines[${k}] длиннее 30 символов`); });
    }
  }
  if (c.kind === 'stats') {
    if (!Array.isArray(c.stats) || !c.stats.length) errors.push(`${at}: stats — нужен список stats`);
    else {
      if (c.stats.length > 2) { warnings.push(`${at}: stats — оставлено 2`); c.stats = c.stats.slice(0, 2); }
      c.stats.forEach((s, k) => { s.value = Number(String(s.value).replace(/[^\d.]/g, '')); if (!Number.isFinite(s.value)) errors.push(`${at}: stats[${k}].value не число`); });
    }
  }
  if (c.kind === 'bars') {
    if (!Array.isArray(c.bars) || c.bars.length !== 2) errors.push(`${at}: bars — нужно ровно 2 столбика`);
    else c.bars.forEach((b) => { b.value = Math.min(1, Math.max(0.05, Number(b.value) || 0.3)); });
  }
}
