# n8n-BEGET Install 🌌

Полностью автоматическая установка n8n + Telegram-бота + бэкапов по одной команде на чистый сервер Ubuntu 22.04

---

## ✨ Возможности

* ✅ Установка `n8n`, `Postgres`, `Redis`, `Traefik`, `Telegram-бота`
* ✅ Кастомный Docker-образ `n8n` со всеми зависимостями
* ✅ Telegram-бот:

  * Команды `/status`, `/logs`, `/backup`, `/update`
  * Автобэкапы каждый день в 02:00
  * Уведомления об ошибках и завершении установки
* ✅ Зашифрованные архивы с паролем в Telegram + автоудаление с сервера

---

## ⚡ Установка

**1. Запусти одну команду:**

```bash
bash <(curl -s https://raw.githubusercontent.com/kalininlive/n8n-beget-install/main/install.sh)
```

**2. Введи данные:**

* Домен для n8n
* Email для SSL
* Пароль для базы данных
* Имя пользователя для входа в n8n
* Пароль для входа в n8n
* Ключ шифрования (или сгенерируется)
* Токен Telegram-бота
* Telegram ID (куда слать уведомления)

После завершения установки открой `https://<твой_домен>` и войди, используя указанные имя пользователя и пароль.

---

## 🚀 Команда /update

Обновляет **только n8n**, без влияния на другие сервисы:

```bash
docker build -f Dockerfile.n8n -t n8n-custom:latest .
docker compose up -d n8n
```

---

## 📅 Автоматический бэкап

* Каждый день в 02:00 ночи
* Содержит:

  * Все workflows (JSON)
  * Ключ шифрования
  * Файл `.env`
  * Дамп базы данных
* Архив зашифрован
* Отправляется в Telegram
* Автоматически удаляется после отправки

---

## 🔒 Безопасность

* Архивы не хранятся на сервере
* Пароль шифрования отправляется отдельно
* Все данные через `.env`
* Бот работает только с указанным Telegram ID

---

## ⚙ Требования

* Ubuntu 22.04 (чистая установка)
* Права root
* Домен с А-записью, направленной на IP сервера (HTTP-порт должен быть доступен)

### 📡 Настройка домена

Для получения SSL сертификата через HTTP challenge домен должен указывать на ваш
сервер и быть доступен по порту `80`. Создайте A‑запись в DNS с IP вашего сервера.

---

## 📄 Структура проекта

```
/opt/n8n-install/
├── docker-compose.yml
├── Dockerfile.n8n
├── install.sh
├── backup_n8n.sh
├── .env
├── /bot
│   ├── bot.js
│   └── .env
└── /backups (временные файлы)
```

---

## 🚀 Поддержка и обновления

* Обновления доступны в Telegram через `/update`
* Уведомления приходят при любых ошибках
* Скрипт легко доработать под свои нужды

РУЧНОЕ ОБНОВЛЕНИЕ ЧЕРЕЗ ТЕРМИНАЛ

Сначала вводим команду
```bash
cd /opt/n8n-install
```

Затем

```bash
docker compose build n8n
docker compose up -d n8n
```

---

**✅ Готово! Установка, обновление и резервное копирование теперь полностью автоматизированы.**

## ОЧИСТКА СЕРВЕРА ПОСЛЕ ОБНОВЛЕНИЯ N8N

[СМОТРЕТЬ ТУТ](https://www.notion.so/idirectsmm/N8N-21e6b62f009680ba8bd9e7c325a9f21b)
