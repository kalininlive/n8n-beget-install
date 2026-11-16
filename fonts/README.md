# 🔤 Коллекция шрифтов `/opt/fonts`

62 популярных семейства с **кириллицей и латиницей** (лицензии OFL / UFL — можно использовать в коммерческих роликах). Большинство — вариативные: **один файл = все начертания** от Thin 100 до Black 900.

| Где | Путь |
|---|---|
| На сервере | `/opt/n8n-install/fonts/` |
| В `n8n-app`, `n8n-worker`, `n8n-media-render`, `n8n-tools` | `/opt/fonts/` (только чтение) |
| Для fontconfig (Chromium, HyperFrames, Remotion, ffmpeg/libass) | `/opt/fonts` в `n8n-media-render`, `/usr/share/fonts/n8n/` в `n8n-tools` |

```
fonts/
├── fonts.list      # список семейств (в git) — правьте его
├── google/<папка>/ # скачанные TTF + лицензия
├── custom/         # ваши шрифты: просто положите .ttf/.otf
├── fonts.css       # @font-face на все шрифты из google/
└── fonts.json      # каталог: семейство, категория, начертания, кириллица
```

## Как использовать

**HTML (HyperFrames, Playwright)** — шрифты уже видны по имени, `@font-face` не обязателен:

```html
<link rel="stylesheet" href="file:///opt/fonts/fonts.css"> <!-- явная загрузка, если нужна гарантия -->
<h1 style="font-family:'Unbounded';font-weight:900">Заголовок</h1>
<p  style="font-family:'Manrope';font-weight:300">Тонкий текст</p>
```

**ffmpeg** — по имени через fontconfig (подходит и для вариативных начертаний):

```bash
ffmpeg -i in.mp4 -vf "drawtext=font='Montserrat\:style=Black':text='Привет':fontsize=96:fontcolor=white" out.mp4
# субтитры .ass: Style: Default,Golos Text,64,…  (libass найдёт по имени)
```

**Агенту-режиссёру / воркфлоу** — список доступных шрифтов: прочитать `/opt/fonts/fonts.json` (поле `category`: `sans`, `display`, `handwriting`, `serif`, `mono`).

## Состав

| Категория | Семейства |
|---|---|
| Гротески | Inter, Roboto, Roboto Condensed, Montserrat, Manrope, Rubik, Golos Text, Onest, Open Sans, Noto Sans, PT Sans, PT Sans Narrow, Raleway, Nunito, Mulish, Jost, Commissioner, Exo 2, Fira Sans, Fira Sans Condensed, IBM Plex Sans, Oswald, Sofia Sans Condensed, Ubuntu |
| Акцидентные | Unbounded, Russo One, Dela Gothic One, Rubik Mono One, Tektur, Comfortaa, Oi, Seymour One, Kelly Slab, Yeseva One, Press Start 2P, Rubik Glitch |
| Рукописные | Caveat, Lobster, Pacifico, Amatic SC, Neucha, Marck Script, Bad Script, Philosopher |
| С засечками | Playfair Display, Lora, Merriweather, PT Serif, Noto Serif, EB Garamond, Cormorant, Prata, Spectral, Literata, Old Standard TT, Alice |
| Моноширинные | JetBrains Mono, Fira Code, Roboto Mono, IBM Plex Mono, PT Mono, Source Code Pro |

≈ 75 МБ, 166 файлов. Уже лежат в готовом образе `n8n-media-render` — установщик копирует их оттуда в `/opt/n8n-install/fonts`. Если вы изменили `fonts.list`, они скачиваются заново с [github.com/google/fonts](https://github.com/google/fonts) (только нужные папки).

## Добавить шрифт

- **Из Google Fonts:** найдите папку семейства в `google/fonts` (например `ofl/manrope`), допишите строку в `fonts.list`, затем `bash scripts/install-fonts.sh && docker exec n8n-media-render fc-cache -f`. Скрипт предупредит, если папки нет или в шрифте нет кириллицы.
- **Свой файл:** положите в `/opt/n8n-install/fonts/custom/`, затем `docker exec n8n-media-render fc-cache -f`.
