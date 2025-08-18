# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Генерируем Prisma клиент
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Создаем папки для сессий
RUN mkdir -p /app/whatsapp_sessions

# Устанавливаем права на папки
RUN chown -R node:node /app
USER node

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["npm", "run", "start:prod"] 