FROM node:20-alpine

# Устанавливаем нужные пакеты
RUN apk add --no-cache \
  zip \
  bash \
  curl \
  docker-cli \
  coreutils \
  procps \
  jq

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем исходники бота
COPY . .

# Запускаем бота
CMD ["node", "bot.js"]