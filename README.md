# n8n-BEGET Install 🌌

Полностью автоматическая установка `n8n` с Telegram-ботом, резервным копированием и кастомным Docker-образом — **по одной команде**.

## 📦 Что входит:

- 📥 Автоматическая установка Docker + Docker Compose
- 🧪 Генерация `.env` и запуск docker-compose
- 🤖 Telegram-бот с командами:
  - `/status` — аптайм и контейнеры
  - `/logs` — последние 50 строк логов n8n
  - `/backups` — запуск бэкапа вручную
  - `/update` — обновление n8n после создания резервной копии
- 🗃️ Ежедневный бэкап в 02:00 (cron)
- 🔐 Шифрование credentials с `N8N_ENCRYPTION_KEY`

## ⚙️ Установка

Запусти в терминале:

```bash
bash <(curl -s https://raw.githubusercontent.com/kalininlive/n8n-beget-install/main/install.sh)
````

В процессе скрипт попросит ввести:

* Домен (например: `n8n.example.com`)
* Email для SSL (Let's Encrypt)
* Пароль для PostgreSQL
* Ключ шифрования (или сгенерирует сам)
* Токен Telegram-бота
* Telegram ID (кому слать уведомления)

## 🔁 Резервное копирование

* Все бэкапы сохраняются в `/opt/n8n-install/backups`
* Архив отправляется в Telegram
* Поддержка ручного запуска и cron

## 📁 Структура проекта

```
n8n-beget-install/
├── .env.template
├── Dockerfile.n8n
├── README.md
├── backup_n8n.sh
├── docker-compose.yml
├── install.sh
└── bot/
    ├── Dockerfile
    ├── bot.js
    └── package.json
```

## ✅ Требования

* Ubuntu 22.04+
* Права root
* Публичный домен (на него будет выдан SSL через Traefik)

---

Автор: [@kalininlive](https://t.me/WebSansay)

```
