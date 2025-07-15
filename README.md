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


1. Очистка APT-кэша и ненужных пакетов
sudo apt-get clean
sudo apt-get autoremove --purge -y

​
Проверка:
df -h | sed -n '1,5p'

​
2. Очистка системных журналов (systemd)
sudo journalctl --vacuum-size=100M
sudo journalctl --vacuum-time=7d

​
Проверка:
sudo journalctl --disk-usage

​
3. Очистка логов в /var/log
sudo find /var/log -type f -name "*.gz" -delete
sudo truncate -s 0 /var/log/*.log
sudo truncate -s 0 /var/log/**/*.log

​
4. Очистка логов Docker-контейнеров
sudo find /var/lib/docker/containers/ -type f -name "*-json.log" -exec truncate -s 0 {} \;
sudo systemctl restart docker

​
5. Основная Docker-чистка
# Убираем образы без тега (<none>)
docker image prune -f

# Очищаем кэш сборок
docker builder prune -f

# Удаляем все образы, не используемые запущенными контейнерами (включая старые n8n)
docker image prune -a -f

# Удаляем остановленные контейнеры
docker container prune -f

# (Опционально) Удаляем «висячие» тома
docker volume prune -f

​
Проверка:
docker system df
df -h

​
6. (Опционально) Уменьшение swap-файла до 1 GiB
sudo swapoff /swapfile
sudo dd if=/dev/zero of=/swapfile bs=1M count=1024
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

​
Проверка:
free -h
df -h

​
После выполнения всех шагов у вас будет:
Сброшен APT-кэш и ненужные пакеты
Подчищены systemd-журналы и /var/log
Обнулены логи Docker-контейнеров
Удалены все неиспользуемые образы, контейнеры и кеш
(По желанию) Сокращён объём swap
Скопируйте этот список в Notion и двигайтесь пункт за пунктом, проверяя результаты каждого блока.
