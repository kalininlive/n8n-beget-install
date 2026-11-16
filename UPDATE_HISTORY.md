[2026-04-22] Updated to 2.18.0 (Successfully)
[2026-06-05] Updated to 2.25.3 (Successfully)
[2026-06-17] Updated to 2.26.4 (Successfully)
[2026-06-18] Updated to 2.27.0 (Successfully)
[2026-06-27] Updated to 2.28.2 and updated Community Nodes
[2026-09-06] Updated from 2.36.3 to 2.37.10 safely
[2026-09-09] Updated to 2.39.0
[2026-09-12] stack-v2: сборка зафиксирована в репо; n8n-media-render пересобран с html-render 1.0.0 (puppeteer-core 25.10, Chromium 152, emoji-шрифт); шим render-html; шрифты каруселей в public/fonts; воркфлоу 🔄 Синхронизация ассетов S3 и 56 🎠 КАРУСЕЛЬ МОЙ МАСКОТ (+ /mcarousel в боте GENESIS)
[2026-09-23] telegram-bot-api (локальный Bot API, файлы до 2 ГБ) — в override, проверки в install-extras/update_n8n
[2026-09-25] Updated from 2.40.5 to 2.41.2 (pre-release по GitHub, по решению владельца); дамп БД backups/db_n8n_pre_2.41.2_20260925_142640.sql.gz
[2026-09-25] faster-whisper (speaches 0.8.3-cpu, контейнер faster-whisper, шим whisper, WHISPER_* в .env); шим ffprobe забран в репо
[2026-09-25] telegram-bot-api-proxy (nginx: файлы local-режима по HTTP); @genesis_content_bot переведён на локальный Bot API (logOut облака, креды VuynFjARrXpGjLon + ogiJfZHCx5LEOPIe → http://telegram-bot-api-proxy)
[2026-09-25] Ежечасная уборка временных файлов (scripts/cleanup_data.sh + cron); @dl_filemontage_wsbot переведён на локальный Bot API
[2026-09-26] n8n-media-render: GSAP 3.15.0 по умолчанию (file:///opt/engines/vendor/gsap/, NODE_PATH), HYPERFRAMES_NO_UPDATE_CHECK=1 (HyperFrames закреплён на 0.8.30); коммит 85ad952
[2026-10-19] GENESIS: production n8n обновлён до 2.44.4; воркфлоу 7 и 19 обновлены с сохранением активного состояния и бэкапов. В montage-v2 добавлен внутренний audio-prep endpoint (3387, доступен только в Docker-сети): credential n8n «Auphonic API», проверка типа аккаунта до запуска (платный аккаунт уходит на локальный FFmpeg), удаление бесплатного джингла, обрезка длинных пауз с пересчётом слов, FFmpeg fallback. Для контейнера n8n-media-render настроен Node proxy и перезапущен только этот контейнер. Изменения локальны и не закоммичены.

[2026-10-20] montage-v2 0.5.4: reference fonts Unbounded/Inter (Cyrillic+Latin, OFL) для libass и HyperFrames; переданы 236 HyperFrames components; workflow 7 исправлен по execution #179199: выбирает очищенное видео и передаёт auto-style renderer; синтетические captions + slide_full QA пройдены.

## 2026-11-16 — актуализация сборки
- n8n по умолчанию `:latest` (update_n8n.sh собирает с `--pull`); Traefik `v3`.
- Движки: Remotion 4.0.544, HyperFrames 0.8.221 (та же версия, что на компьютере владельца), GSAP 3.15.1, puppeteer-core 25.17.0, fontkit 3.0.0.
- montage-v2 0.5.4 (17 стилей, EDL, audio-prep, QA-инспектор), шим `cleanup-genesis-job`, набор `beget/` для серверов с шаблоном Beget.
- install.sh спрашивает `TELEGRAM_API_ID/HASH` (локальный Bot API, файлы до 2 ГБ ставится всегда).
- RSSHub убран из compose; Дзен-публикатор в сборку не входит (приватный репозиторий).
- README переписан, добавлен VIDEO_STYLES.md (стили и путь монтажа, идея `/opt/montage`).
