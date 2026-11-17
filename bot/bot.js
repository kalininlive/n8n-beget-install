const TelegramBot = require('node-telegram-bot-api');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// === Переменные окружения ===
const token = process.env.TG_BOT_TOKEN;
const userId = process.env.TG_USER_ID;

if (!token || !userId) {
  console.error("❌ Не заданы необходимые переменные окружения.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

function isAuthorized(msg) {
  return String(msg.chat.id) === String(userId);
}

function send(text) {
  bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
}

// /start — список команд
bot.onText(/\/start/, (msg) => {
  if (!isAuthorized(msg)) return;
  send('🤖 Доступные команды:\n/status — Статус контейнеров\n/logs — Логи n8n\n/backups — Бэкап вручную\n/update — Обновление n8n');
});

// /status — аптайм и контейнеры
bot.onText(/\/status/, (msg) => {
  if (!isAuthorized(msg)) return;
  try {
    const uptime = execSync('uptime -p').toString().trim();
    const containers = execSync('docker ps --format "{{.Names}} ({{.Status}})"').toString().trim();
    send(`🟢 Сервер работает\n⏱ Uptime: ${uptime}\n\n📦 Контейнеры:\n${containers}`);
  } catch (err) {
    send('❌ Ошибка при получении статуса');
  }
});

// /logs — последние 50 строк логов n8n
bot.onText(/\/logs/, (msg) => {
  if (!isAuthorized(msg)) return;

  exec('docker logs --tail=100 n8n-app', (error, stdout, stderr) => {
    if (error) {
      send(`❌ Не удалось получить логи:\n\`\`\`\n${error.message}\n\`\`\``);
      return;
    }

    if (stderr && stderr.trim()) {
      send(`⚠️ Предупреждение при получении логов:\n\`\`\`\n${stderr}\n\`\`\``);
      return;
    }

    const MAX_LEN = 3900;
    const trimmed = stdout.length > MAX_LEN ? stdout.slice(-MAX_LEN) : stdout;

    if (stdout.length > MAX_LEN) {
      // Логи слишком длинные — сохраняем во временный файл и отправляем
      const fs = require('fs');
      const logPath = '/tmp/n8n_logs.txt';
      fs.writeFileSync(logPath, stdout);

      bot.sendDocument(userId, logPath, {}, {
        caption: '📝 Логи n8n (последние 100 строк)'
      });
    } else {
      send(`📝 Логи n8n:\n\`\`\`\n${trimmed}\n\`\`\``);
    }
  });
});

// /backups — запускает backup_n8n.sh
bot.onText(/\/backups/, (msg) => {
  if (!isAuthorized(msg)) return;

  send('📦 Запускаю резервное копирование n8n...');

  const backupScriptPath = path.resolve('/opt/n8n-install/backup_n8n.sh');

  exec(`/bin/bash ${backupScriptPath}`, (error, stdout, stderr) => {
    if (error) {
      send(`❌ Ошибка при запуске backup:\n\`\`\`\n${error.message}\n\`\`\``, { parse_mode: 'Markdown' });
      return;
    }

    if (stderr && stderr.trim()) {
      send(`⚠️ В процессе бэкапа были предупреждения:\n\`\`\`\n${stderr}\n\`\`\``, { parse_mode: 'Markdown' });
      return;
    }

    send('✅ Бэкап завершён. Проверьте Telegram — архив должен быть отправлен автоматически.');
  });
});

// /update — сначала backup, потом обновление n8n
bot.onText(/\/update/, (msg) => {
  if (!isAuthorized(msg)) return;

  send('🔄 Начинаю обновление n8n...');

  const { exec } = require('child_process');
  const cmd = `
    if [ -x /opt/n8n-install/update_n8n.sh ]; then
      /bin/bash /opt/n8n-install/update_n8n.sh;
    elif [ -x /opt/n8n-install/updaten8n.sh ]; then
      /bin/bash /opt/n8n-install/updaten8n.sh;
    else
      echo 'SCRIPT_NOT_FOUND'; exit 127;
    fi
  `;
  exec(cmd, (error, stdout, stderr) => {
    if (error) return send(`❌ Обновление завершилось с ошибкой:\n${error.message}`);
    if (stderr) send(`⚠️ Предупреждение:\n${stderr}`);
    send(`✅ Обновление завершено:\n${stdout}`);
  });
});

