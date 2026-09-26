// MONTAGE v2 — каталог компонентов и правила режиссуры (источник правды: genesis-n8n/docs/montage-v2-library.md §2–4).
// Агент-режиссёр выбирает компоненты отсюда и заполняет поля словами из речи; стилей он не задаёт.
// Всё, что знает агент, отдаёт `montage-v2 catalog` (agentSpec ниже) — новый компонент/стиль/формат попадает в промпт сам.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// dur — допустимая длительность сцены, с. obj — какие объекты можно вложить (null = без объекта). use — когда брать (для агента).
export const COMPONENTS = {
  talking:        { dur: [1.5, 6],   fields: {}, obj: null,
    use: 'обычная речь, связки; кинетические титры строятся сами. Первая сцена ролика — всегда talking 1.5–2.5 с (хук)' },
  slide_full:     { dur: [2.5, 4.5], fields: { kicker: 'text', head: 'head' }, obj: ['cards_trio'], objOptional: true,
    use: 'главный тезис, проблема, цифра без лица: слайд цвета бренда. kicker — подводка, head — капс-тезис 1–3 слова; object cards_trio — 3 карточки (иконка + 2–3 слова)' },
  speaker_circle: { dur: [2.5, 4],   fields: { kicker: 'text', head: 'head', badge: 'badge?' }, obj: null,
    use: 'личное «я сделал», эмоция: спикер в круге на фоне бренда, сверху kicker + head, badge — наклонная плашка (1–2 слова)' },
  speaker_rect:   { dur: [2.5, 4],   fields: { kicker: 'text' }, obj: ['stat_big'],
    use: 'результат/итог с цифрой: тёмный фон, спикер в прямоугольнике, сверху счётчик stat_big' },
  card_over_blur: { dur: [3, 8],     fields: {}, obj: ['checklist'],
    use: 'перечисление, шаги, возможности: спикер размыт, белая карточка с чек-листом, пункты появляются, когда произнесены' },
  broll_own:      { dur: [2, 5],     fields: { query: 'query' }, obj: null,
    use: 'показать процесс/предмет: ролик из базы клиента на весь кадр; query — что искать по смыслу (3–6 слов)' },
  cta:            { dur: [3, 8],     fields: { text: 'text', keyword: 'keyword' }, obj: null,
    use: 'финальный призыв, всегда последняя сцена до конца ролика: text — призыв, keyword — кодовое слово в плашке' },
};

export const OBJECTS = {
  cards_trio: { items: [3, 3], use: '{"c":"cards_trio","items":[["иконка","2–3 слова"],×3]}' },
  checklist:  { items: [2, 4], use: '{"c":"checklist","title":"Что делает AI-бот","items":[["пункт",at?],…]} — последнее слово title выделяется цветом' },
  stat_big:   { use: '{"c":"stat_big","value":68,"prefix":"+","suffix":"%"} — value только число из речи' },
};

// иконки карточек cards_trio (SVG в render.mjs)
export const ICONS = ['chat', 'clock', 'x', 'check', 'user', 'money', 'chart', 'phone', 'calendar', 'bolt', 'star', 'heart', 'fire', 'target'];

export const RULES = {
  hookMin: 1.5, hookMax: 2.5,           // первая сцена talking
  heavyShare: 0.5,                      // slide_full + card_over_blur ≤ 50% времени
  heavy: ['slide_full', 'card_over_blur'],
  headLineMax: 18,                      // капс-заголовок: символов в строке
  kickerMax: 28, hookTextMax: 34, badgeMax: 12, keywordMax: 10, cardItemMax: 18, checkItemMax: 34, ctaTextMax: 40,
  snap: 0.35,                           // *_at притягивается к началу слова ближе этого, с
};

export const SKIN_DEFAULT = 'brand_blue';
export const STYLE_DEFAULT = 'reference';
export const FORMAT_DEFAULT = 'expert';

// реестр стилей и форматов — JSON-файлы в styles/ и formats/
const readDir = dir => fs.existsSync(dir) ? Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(x => [x.id, x])) : {};
export const STYLES = readDir(path.join(HERE, 'styles'));
export const FORMATS = readDir(path.join(HERE, 'formats'));
export const SKINS_DIR = path.join(HERE, 'skins');

// Всё, что нужно агенту-режиссёру: n8n кладёт это в системный промпт (JSON или markdown).
export function agentSpec() {
  return {
    styles: Object.values(STYLES).filter(s => s.status === 'approved').map(({ id, name, description, fits, components }) => ({ id, name, description, fits, components })),
    formats: Object.values(FORMATS).map(({ id, name, style, description, components }) => ({ id, name, style, description, components })),
    components: Object.fromEntries(Object.entries(COMPONENTS).map(([id, c]) => [id, { duration: c.dur, fields: c.fields, object: c.obj, objectOptional: !!c.objOptional, use: c.use }])),
    objects: Object.fromEntries(Object.entries(OBJECTS).map(([id, o]) => [id, { items: o.items, use: o.use }])),
    icons: ICONS,
    rules: [
      'сцены идут встык от 0 до конца ролика, t0/t1 в секундах, границы — по словам',
      `первая сцена talking ${RULES.hookMin}–${RULES.hookMax} с, последняя cta`,
      'смена компонента каждые 2–5 с, длительность в пределах компонента; два одинаковых компонента подряд нельзя',
      `slide_full + card_over_blur ≤ ${RULES.heavyShare * 100}% времени`,
      `тексты только из слов речи (сокращать можно, придумывать нельзя); head ≤ ${RULES.headLineMax} символов в строке, kicker ≤ ${RULES.kickerMax}, badge ≤ ${RULES.badgeMax}, keyword ≤ ${RULES.keywordMax}, пункт чек-листа ≤ ${RULES.checkItemMax}, cta.text ≤ ${RULES.ctaTextMax}`,
      `hook — хук для обложки: 2–5 самых цепляющих слов из речи (результат, цифра, боль), ≤ ${RULES.hookTextMax} символов`,
      '*_at (моменты появления) можно не писать — код поставит по словам; если текст пересказан, укажи время начала нужного слова из списка слов',
    ],
    skin: 'поле "skin": цвет бренда "#RRGGBB" (остальная палитра считается сама) или имя готового скина; если бренд-кит клиента задаёт цвет жёстко — его подставит воркфлоу',
    plan_example: {
      style: 'reference', format: 'expert', skin: '#1E6BFF', hook: 'Бот за 3 секунды: лиды +68%',
      scenes: [
        { t0: 0, t1: 2.1, c: 'talking' },
        { t0: 2.1, t1: 5.9, c: 'slide_full', kicker: 'клиент ждёт ответа', head: '40 минут', object: { c: 'cards_trio', items: [['chat', 'клиент написал'], ['clock', 'менеджер занят'], ['x', 'клиент ушёл']] } },
        { t0: 5.9, t1: 9.5, c: 'speaker_circle', kicker: 'я внедрил клиенту', head: 'автономного', badge: 'AI-бота' },
        { t0: 9.5, t1: 16.6, c: 'card_over_blur', object: { c: 'checklist', title: 'Что делает AI-бот', items: [['Квалифицирует лида за 3 секунды'], ['Отвечает на любое возражение'], ['Назначает созвон в календарь']] } },
        { t0: 16.6, t1: 20.4, c: 'speaker_rect', kicker: 'ИТОГ · конверсия в лид', object: { c: 'stat_big', value: 68, prefix: '+', suffix: '%' } },
        { t0: 20.4, t1: 24.6, c: 'broll_own', query: 'финансы затраты телефон график' },
        { t0: 24.6, t1: 31, c: 'cta', text: 'пиши в комментариях слово', keyword: 'BOT' },
      ],
    },
  };
}
