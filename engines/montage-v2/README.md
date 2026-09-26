# montage-v2 — движок гибридного монтажа GENESIS

План ролика (JSON из каталога компонентов) + слова whisper + видео спикера → готовый ролик 1080×1920, 30 fps.
Сцены без спикера (`slide_full`) рендерит HyperFrames, всё остальное — ffmpeg + libass.
Эталон вида: `genesis-n8n/pilot/montage-v2/reference-31s.mp4`. Каталог и правила: `genesis-n8n/docs/montage-v2-library.md`.

| Файл | Что |
|---|---|
| `catalog.mjs` | компоненты, объекты, иконки, лимиты правил; `agentSpec()` — всё, что знает агент |
| `skins.mjs` | палитра из одного цвета бренда, проверка контраста |
| `styles/*.json`, `formats/*.json` | реестр стилей (визуальный язык) и форматов (какие компоненты разрешены) |
| `STYLES.md` | **как добавлять цвета, форматы, стили и компоненты** |
| `validate.mjs` | схема + правила режиссуры §3 + привязка `*_at` к словам whisper |
| `render.mjs` | сборка: `graphics.ass`, `mask_spk.ass`, проекты HF-слайдов, ffmpeg-граф |
| `cli.mjs` | `montage-v2 validate …` / `montage-v2 render <jobDir>` |
| `skins/*.json` | готовые скины с ручной палитрой |

## Вызов

```bash
montage-v2 catalog [--md]                                     # спецификация для промпта агента-режиссёра
montage-v2 validate plan.json words.json [--skin "#RRGGBB"]   # {ok, errors[], warnings[], plan}
montage-v2 render /data/genesis/<job> [--skin "#RRGGBB"] [--out file.mp4] [--workers 2] [--preset veryfast] [--keep]
```
`jobDir`: `plan.json`, `words.json` (`[{t,e,w}]`, whisper `verbose_json` или AssemblyAI), `speaker.mp4` (со звуком),
файлы b-roll из `scenes[].src` (путь от jobDir или абсолютный `/data/...`). Результат — `montage_v2.mp4`, рабочие файлы — `mv2/`.
stdout — один JSON (`ok`, `out`, `ms`, `warnings`), прогресс — stderr. Нужен `HYPERFRAMES_BROWSER_PATH` (headless-shell).

## План

Верхний уровень: `style` (по умолчанию `reference`), `format` (`expert`), `skin` (цвет `"#RRGGBB"`, `{brand,…}` или имя скина; `--skin` важнее плана), `scenes[]`.

Контракт — `montage-v2-library.md` §4. Времена появления (`head_at`, `badge_at`, `object.at`, пункты чек-листа, `count_at`, `at`, `keyword_at`)
агент может не задавать: код находит момент, когда слово произнесено. Если агент пересказывает (слов нет в речи) — время нужно задать самому,
иначе элемент встанет равномерно. `broll_own` для рендера должен иметь `src` (ролик, найденный по `query` в `genesis_websansay.brolls`).

## Переходы спикера (любой порядок сцен)

Спикер — один слой: масштаб/сдвиг (`perspective`) + рамка (маска libass) + размытие. «Откуда» берётся из текущего состояния:
после `slide_full`/`broll_own` вход резкий (круг и прямоугольник — «поп», `talking`/`cta` — удар зумом 1.12→1), иначе плавное перетекание рамки.
Переход «круг → карточка на размытии» повторяет особенность эталона (несимметричный прямоугольник), так одобрено владельцем.

## Проверка качества

- План эталона (`tests/ref31`) даёт кадр в кадр тот же ролик, что пилот `hybrid/` v2 (SSIM 1.0000 на всех 930 кадрах, до правки ease ниже).
- С эталоном HyperFrames: SSIM 0.979 в среднем; отличия — сдвиг фазы переходов < 1 кадра.
- Проявление тёмного фона и b-roll — с easing как в GSAP (`power1.out` / `power3.out`), а не линейным `fade`.
- На сервере: `/data/files/montage-v2/{engine,run.sh,ssim.sh,tests/}`; `ssim.sh a.mp4 b.mp4` — сравнение по кадрам.

Скорость (2 ядра через `taskset`, ролик 31 с): ≈ 1:32–1:35 (HF-слайд 11–16 с + ffmpeg ≈ 80 с).
