#!/bin/bash
# cleanup_data.sh — ежечасная уборка временных файлов движков и ботов (cron: /etc/cron.d/n8n-data-cleanup).
# Всё, что воркфлоу создают «на время», должно исчезать само — даже если выполнение упало посередине.
# Сроки можно переопределить в .env: CLEANUP_TG_HOURS, CLEANUP_TMP_MIN.
BASE=/opt/n8n-install
D=$BASE/data
[ -f $BASE/.env ] && set -a && . $BASE/.env 2>/dev/null && set +a
# По умолчанию храним временные файлы Telegram Bot API не более 3 часов (вместо 24 ч)
TG_H=${CLEANUP_TG_HOURS:-3}; TMP_MIN=${CLEANUP_TMP_MIN:-120}
before=$(df -Pm / | awk 'NR==2{print $4}')

# 1. локальный Telegram Bot API: скачанные/загруженные ботами файлы (td.binlog и папки не трогаем)
docker exec telegram-bot-api find /var/lib/telegram-bot-api -mindepth 3 -type f -mmin +$((TG_H*60)) -delete 2>/dev/null
docker exec telegram-bot-api find /tmp/telegram-bot-api -mindepth 1 -type f -mmin +$TMP_MIN -delete 2>/dev/null

# 2. временные файлы отправки в Telegram (скачанные результаты, превью)
find $D/tg-send -mindepth 1 -type f -mmin +$TMP_MIN -delete 2>/dev/null

# 3. рендеры (воркфлоу чистят за собой; это страховка на случай падения)
find $D/reels -mindepth 1 -maxdepth 1 -type f -mmin +$((TG_H*60)) -delete 2>/dev/null

# 4. автоматизация уникализации (/data/tg_bot): страховка на случай аварийных сбоев процессов
find $D/tg_bot -mindepth 1 -maxdepth 1 -type f -name "in_*.mp4" -mmin +$TMP_MIN -delete 2>/dev/null
find $D/tg_bot -mindepth 1 -maxdepth 1 -type f -name "out_*.mp4" -mmin +$TMP_MIN -delete 2>/dev/null
find $D/tg_bot -mindepth 1 -maxdepth 1 -type f -name "*test*.mp4" -mmin +$TMP_MIN -delete 2>/dev/null

# 5. задачи распознавания речи Whisper (/data/genesis/vtt_*): страховка от зависших папок
find $D/genesis -mindepth 1 -maxdepth 1 -type d -name "vtt_*" -mmin +$TMP_MIN -exec rm -rf {} + 2>/dev/null

# 6. задачи каруселей (/data/carousel/jobs)
[ -d "$D/carousel/jobs" ] && find $D/carousel/jobs -mindepth 1 -maxdepth 1 -type d -mmin +$TMP_MIN -exec rm -rf {} + 2>/dev/null

after=$(df -Pm / | awk 'NR==2{print $4}')
echo "[$(date '+%F %T')] cleanup: свободно ${before} → ${after} МБ"
# лог не растёт бесконечно
L=$BASE/logs/cleanup.log; [ -f $L ] && [ $(stat -c %s $L) -gt 1048576 ] && tail -n 500 $L > $L.tmp && mv $L.tmp $L
exit 0
