// Каталог сцен стиля «Крафт» — всё, что должен знать агент-режиссёр. Источник правды для validate и для промпта.
// maxWords — лимиты текста на экране (слова через пробел), n — сколько элементов в списке.

export const ICONS = ['doc', 'spark', 'tg', 'play', 'chart'];

export const COMPONENTS = {
  hook_link: {
    duration: [3, 9],
    use: 'первая сцена-хук: две иконки, связанные линией, из правой вылетают карточки-ролики; заголовок по словам и 0–2 плашки с галочкой',
    fields: {
      headline: { type: 'text', maxWords: 8, required: true, note: '1–2 слова *в звёздочках* — оранжевый акцент' },
      left: { type: 'icon', note: `иконка слева: ${ICONS.join('|')}` },
      left_label: { type: 'text', maxChars: 6, note: 'подпись на иконке doc, напр. ".bot"' },
      right: { type: 'icon', note: 'иконка справа (обычно spark — бренд)' },
      pills: { type: 'list', n: [0, 2], maxWords: 5, note: 'короткие выгоды, звучат в речи' },
    },
  },
  title: {
    duration: [1.5, 4.5],
    use: 'разделитель «сейчас покажу / как это работает»: надзаголовок разрядкой + крупный капс с подчёркиванием',
    fields: {
      eyebrow: { type: 'text', maxWords: 4, required: true },
      title: { type: 'text', maxWords: 3, required: true },
    },
  },
  window: {
    duration: [3, 9],
    use: 'тёмное окно-приложение влетает из камеры, под ним подпись = речь диктора. Содержимое по content.kind',
    fields: {
      window: { type: 'text', maxWords: 4, required: true, note: 'заголовок окна, напр. "GENESIS · сравнение"' },
      content: { type: 'content', required: true },
    },
    kinds: {
      code: 'печать кода + превью роликов + зачёркнутая плашка. Поля: lines[3–6 строк ≤ 28 символов], note (≤ 6 слов), strike (≤ 3 слов — чем это НЕ является)',
      gallery: 'три экрана-соцсети: подключение, светящийся шар с роликами, лайки. Поля: connect (≤ 5 слов), made_title (≤ 4), made_label (≤ 4), likes ("12,4K")',
      stats: 'счётчики от нуля + растущий график + бейдж. Поля: stats[1–2 {label ≤ 3 слов, value число}], chart (≤ 3 слов), trend (≤ 2), axis[4 подписи сверху вниз], badge (≤ 5 слов)',
      bars: 'сравнение двумя столбиками, акцентный растёт и светится. Поля: bars[2 {label ≤ 3 слов, value 0..1, accent true|false, note ≤ 5 символов, напр. "×3"}]',
    },
  },
  thought: {
    duration: [3, 9],
    use: 'возражение: серое «ты, наверное, думаешь» + утверждение → зачёркивается → оранжевая плашка-ответ растёт по словам',
    fields: {
      lead: { type: 'text', maxWords: 5, required: true },
      statement: { type: 'text', maxWords: 5, required: true },
      reply_steps: { type: 'list', n: [1, 2], maxWords: 3, required: true, note: 'напр. ["нет.", "совсем нет."] — каждый шаг появляется на своём слове' },
    },
  },
  question: {
    duration: [2, 5.5],
    use: 'оранжевый «?» + серый лид + крупное утверждение-сомнение с акцентом',
    fields: {
      lead: { type: 'text', maxWords: 5, required: true },
      statement: { type: 'text', maxWords: 5, required: true, note: 'одно слово *в звёздочках*' },
    },
  },
  radial: {
    duration: [2.5, 6],
    use: 'иконка бренда в центре, лучи и поток карточек вокруг; заголовок по словам — «масштаб, охват, всё в одном»',
    fields: {
      headline: { type: 'text', maxWords: 5, required: true, note: 'одно слово *в звёздочках*' },
    },
  },
  cta: {
    duration: [4, 10],
    use: 'финал: «✳ СЛОВО», в поле комментария печатается слово → «Отправлено ✓» → автоответ в директ. Только последней сценой',
    fields: {
      lead: { type: 'text', maxWords: 4, required: true },
      word: { type: 'text', maxWords: 1, required: true, note: 'кодовое слово КАПСОМ, звучит в речи' },
      reply: { type: 'text', maxWords: 7, required: true, note: 'текст автоответа' },
      note: { type: 'text', maxWords: 6 },
      placeholder: { type: 'text', maxWords: 3 },
    },
  },
};

export const RULES = [
  'Сцены идут подряд и покрывают ВСЕ слова речи: "w": [индекс первого слова, индекс последнего], без пропусков и наложений.',
  'Первая сцена — hook_link (или question/thought, если ролик начинается с вопроса). Последняя — cta, если в речи есть призыв; иначе radial или title.',
  'Текст на экране берётся из слов речи этой сцены (движок показывает его в момент, когда слово звучит). Перефразировать можно коротко, но ключевые слова должны совпадать.',
  'Одинаковые типы подряд нельзя, кроме window (не больше 2 окон подряд). Окон — не больше половины сцен.',
  'Каждая сцена 2–9 с; меньше 1,2 с — ошибка. Цифры в stats/bars — из речи; не выдумывать.',
  'Акцент *словом* — 1–2 на заголовок. Никаких эмодзи в текстах.',
];

export const PLAN_EXAMPLE = {
  scenes: [
    { type: 'hook_link', w: [0, 13], headline: 'Этот *GENESIS* бот делает *бесконечные* рилсы', left: 'doc', left_label: '.bot', right: 'spark', pills: ['в любом стиле', 'без кредитов и доплат'] },
    { type: 'title', w: [14, 18], eyebrow: 'сейчас покажу', title: 'КАК ЭТО РАБОТАЕТ' },
    { type: 'window', w: [19, 25], window: 'GENESIS · reel.tsx', content: { kind: 'code', lines: ['<Reel style="любой">', '  <Hook text={идея} />', '</Reel>'], note: 'собрано кодом', strike: 'видео-нейросеть' } },
    { type: 'thought', w: [26, 35], lead: 'ты, наверное, думаешь', statement: 'ролики будут так себе', reply_steps: ['нет.', 'совсем нет.'] },
    { type: 'window', w: [36, 51], window: 'GENESIS · твоя страница', content: { kind: 'stats', stats: [{ label: 'просмотры', value: 900000 }, { label: 'переходы на сайт', value: 40000 }], chart: 'трафик на сайт', trend: 'растёт', badge: 'возраст страницы: 2 месяца' } },
    { type: 'cta', w: [52, 64], lead: 'хочешь так же?', word: 'СТАРТ', reply: 'Отправили в директ: все детали', note: 'бот пришлёт все детали' },
  ],
};

export function agentSpec() {
  return { style: 'kraft', name: 'Крафт', components: COMPONENTS, icons: ICONS, rules: RULES, plan_example: PLAN_EXAMPLE };
}

export function agentMd() {
  const L = ['# Стиль «Крафт» — сцены', '', 'Тёплая бумага, линейный пейзаж внизу рисуется заново в каждой сцене, оранжевый акцент, тёмные окна-приложения. Без спикера, только голос.', '', '## Сцены (поле "type")'];
  for (const [id, c] of Object.entries(COMPONENTS)) {
    L.push(`- **${id}** ${c.duration[0]}–${c.duration[1]} с — ${c.use}.`);
    for (const [f, d] of Object.entries(c.fields)) L.push(`  - \`${f}\`${d.required ? ' (обязательно)' : ''}: ${d.type === 'list' ? `список ${d.n[0]}–${d.n[1]}, ` : ''}${d.maxWords ? `≤ ${d.maxWords} слов` : d.maxChars ? `≤ ${d.maxChars} символов` : ''}${d.note ? ` — ${d.note}` : ''}`);
    if (c.kinds) for (const [k, v] of Object.entries(c.kinds)) L.push(`  - content.kind = **${k}**: ${v}`);
  }
  L.push('', '## Иконки', ICONS.join(', '), '', '## Правила');
  RULES.forEach((r) => L.push(`- ${r}`));
  L.push('', '## Пример плана (w — индексы слов из списка слов речи)', '```json', JSON.stringify(PLAN_EXAMPLE), '```');
  return L.join('\n');
}
