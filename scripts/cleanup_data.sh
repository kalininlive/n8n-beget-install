#!/bin/bash
# cleanup_data.sh — ежечасная уборка временных файлов движков и ботов (cron: /etc/cron.d/n8n-data-cleanup).
# Всё, что воркфлоу создают «на время», должно исчезать само — даже если выполнение упало посередине.
# Сроки можно переопределить в .env: CLEANUP_TG_HOURS, CLEANUP_TMP_MIN, CLEANUP_GENESIS_DAYS.
BASE=/opt/n8n-install
D=$BASE/data
[ -f $BASE/.env ] && set -a && . $BASE/.env 2>/dev/null && set +a
TG_H=${CLEANUP_TG_HOURS:-24}; TMP_MIN=${CLEANUP_TMP_MIN:-180}; GEN_DAYS=${CLEANUP_GENESIS_DAYS:-3}
before=$(df -Pm / | awk 'NR==2{print $4}')

# 1. локальный Telegram Bot API: скачанные/загруженные ботами файлы (td.binlog и папки не трогаем)
docker exec telegram-bot-api find /var/lib/telegram-bot-api -mindepth 3 -type f -mmin +$((TG_H*60)) -delete 2>/dev/null
docker exec telegram-bot-api find /tmp/telegram-bot-api -mindepth 1 -type f -mmin +$TMP_MIN -delete 2>/dev/null
# 2. временные файлы отправки в Telegram (скачанные результаты, превью)
find $D/tg-send -mindepth 1 -type f -mmin +$TMP_MIN -delete 2>/dev/null
# 3. рендеры маскота и задания каруселей (воркфлоу чистят за собой; это страховка на случай падения)
find $D/reels -mindepth 1 -maxdepth 1 -type f -mmin +$((TG_H*60)) -delete 2>/dev/null
find $D/carousel/jobs -mindepth 1 -maxdepth 1 -mmin +$((TG_H*60)) -exec rm -rf {} + 2>/dev/null
# 4. папки задач GENESIS (монтаж: исходник, b-roll, промежуточные проходы)
find $D/genesis -mindepth 1 -maxdepth 1 -mtime +$GEN_DAYS -exec rm -rf {} + 2>/dev/null

after=$(df -Pm / | awk 'NR==2{print $4}')
echo "[$(date '+%F %T')] cleanup: свободно ${before} → ${after} МБ"
# лог не растёт бесконечно
L=$BASE/logs/cleanup.log; [ -f $L ] && [ $(stat -c %s $L) -gt 1048576 ] && tail -n 500 $L > $L.tmp && mv $L.tmp $L
exit 0
