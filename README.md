# 🚀 Автоматическая установка n8n + Telegram-бот

Полный скрипт, который за 5–7 минут установит на сервер Ubuntu 22.04:

- Полностью рабочий n8n (через Docker)
- Redis + Postgres
- Валидный SSL через Traefik
- Telegram-бот для управления, логов, обновлений и бэкапа
- Автоматический ежедневный бэкап воркфлоу в Telegram
- yt-dlp + ffmpeg встроены в n8n для обработки мультимедиа
- Сохраняется список всех установленных пакетов и версий

---

## ⚙️ Установка

1. Подготовьте домен и пропишите А-запись.
2. Подключитесь к серверу по SSH.
3. Выполните:

```bash
git clone https://github.com/kalininlive/n8n-beget-install.git /opt/n8n-install
cd /opt/n8n-install
chmod +x install.sh
./install.sh
```

Скрипт спросит:

- домен
- email для SSL
- токен Telegram-бота
- Telegram user ID
- пароль для БД

Через 5–7 минут будет готово.

---

## 📁 Что создаётся

**Папки:**

- `/opt/n8n/n8n_data/files` — загруженные файлы
- `/opt/n8n/n8n_data/backups` — автоматические и ручные бэкапы
- `/opt/n8n/n8n_data/tmp` — временные файлы
- `/opt/n8n/traefik_data` — SSL и настройки прокси
- `/opt/n8n/static` — доступная статика по адресу `/static`
- `/opt/n8n/bot` — Telegram-бот
- `/opt/n8n/cron` — скрипт авто-бэкапа

---

## 🤖 Telegram-бот: команды

| Команда   | Описание                       |
|-----------|--------------------------------|
| /status   | Проверка работы всех сервисов  |
| /logs     | Последние логи n8n             |
| /backup   | Ручной бэкап всех workflows    |
| /update   | Обновление n8n до последней версии |

---

## 📂 Что сохраняется автоматически

После установки, в `/opt/n8n/n8n_data/backups/` создаются файлы:

- `n8n_installed_apk.txt` — системные пакеты Alpine внутри контейнера n8n
- `n8n_installed_pip.txt` — Python-библиотеки из виртуального окружения
- `n8n_versions.txt` — версии yt-dlp, ffmpeg, python3

---

## 🛡️ Требования

- Чистая Ubuntu 22.04
- Готовый домен (A-запись)
- Свободные порты 80 и 443

---

**Made with ❤️ by [kalininlive](https://github.com/kalininlive)**
