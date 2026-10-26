#!/bin/bash
# OpenCode Telegram Bot + FreeLLMAPI deployment script for Oracle Cloud Free VPS
# Usage: bash vps-deploy.sh [oracle-instance-ip]

set -e

INSTANCE_IP="${1:-}"
if [ -z "$INSTANCE_IP" ]; then
    echo "❌ Usage: bash vps-deploy.sh <oracle-instance-ip>"
    echo "   Example: bash vps-deploy.sh 192.168.1.100"
    exit 1
fi

echo "🚀 Начало деплоя на Oracle Cloud VPS: $INSTANCE_IP"
echo "=================================================="

# 1. Подключение к VPS
echo "📦 Шаг 1: Подключение к VPS..."
ssh -o StrictHostKeyChecking=no root@$INSTANCE_IP "echo 'Connected to VPS'"

# 2. Установка Node.js
echo "🔧 Шаг 2: Установка Node.js 20..."
ssh root@$INSTANCE_IP << 'EOF'
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version
npm --version
EOF

# 3. Установка Docker (для FreeLLMAPI)
echo "🐳 Шаг 3: Установка Docker..."
ssh root@$INSTANCE_IP << 'EOF'
apt-get update
apt-get install -y docker.io
systemctl enable docker
systemctl start docker
docker --version
EOF

# 4. Клонирование FreeLLMAPI
echo "📥 Шаг 4: Клонирование FreeLLMAPI..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt
git clone https://github.com/tashfeenahmed/freellmapi.git
cd freellmapi
git checkout main
EOF

# 5. Настройка FreeLLMAPI
echo "⚙️  Шаг 5: Настройка FreeLLMAPI..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt/freellmapi

# Генерация случайного ключа
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Создание .env файла
cat > .env << ENVFILE
ENCRYPTION_KEY=$ENCRYPTION_KEY
PORT=3001
HOST=0.0.0.0
ENVFILE

# Установка зависимостей
npm install

# Сборка
npm run build:server
EOF

# 6. Запуск FreeLLMAPI через Docker
echo "🚀 Шаг 6: Запуск FreeLLMAPI..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt/freellmapi

# Создание docker-compose.yml
cat > docker-compose.yml << COMPOSE
version: '3.8'
services:
  freellmapi:
    build: .
    container_name: freellmapi
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - ENCRYPTION_KEY=\${ENCRYPTION_KEY}
      - PORT=3001
      - HOST=0.0.0.0
    volumes:
      - ./server/dist:/app/server/dist
      - ./shared:/app/shared
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
COMPOSE

# Запуск
docker compose up -d
EOF

# 7. Ожидание запуска FreeLLMAPI
echo "⏳ Шаг 7: Ожидание запуска FreeLLMAPI..."
sleep 10

# 8. Проверка FreeLLMAPI
echo "✅ Шаг 8: Проверка FreeLLMAPI..."
ssh root@$INSTANCE_IP "curl -f http://localhost:3001/health || echo 'FreeLLMAPI not ready yet'"

# 9. Установка OpenCode
echo "🔧 Шаг 9: Установка OpenCode..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt
git clone https://github.com/artickc/opencode.git
cd opencode
git checkout v2.0.26
npm install -g .
opencode --version
EOF

# 10. Настройка OpenCode
echo "⚙️  Шаг 10: Настройка OpenCode..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt/opencode

# Создание конфига
mkdir -p ~/.config/opencode

cat > ~/.config/opencode/opencode.json << CONFIG
{
  "\$schema": "https://opencode.ai/config.json",
  "providers": {
    "freellmapi": {
      "name": "FreeLLMAPI",
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": {
        "baseURL": "http://localhost:3001/v1",
        "apiKey": "freellmapi-a5395297f7085f1ef6d48abf42dea73b00bac35a35d21592"
      },
      "models": {
        "auto": {
          "name": "FreeLLMAPI Auto",
          "capabilities": {
            "tools": true,
            "input": ["text", "image"],
            "output": ["text"]
          },
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  }
}
CONFIG

# Запуск OpenCode в фоне
opencode serve --service &
sleep 5
EOF

# 11. Установка Telegram бота
echo "🤖 Шаг 11: Установка Telegram бота..."
ssh root@$INSTANCE_IP << 'EOF'
cd /opt
git clone https://github.com/artickc/opencode-telegram-bot.git
cd opencode-telegram-bot
git checkout v2.0.0
npm install -g .
npm install -g tsx
EOF

# 12. Создание конфига бота
echo "📝 Шаг 12: Создание конфига бота..."
ssh root@$INSTANCE_IP << 'EOF'
mkdir -p ~/.opencode/tg/logs

# Файл с токеном (пользователь должен заполнить его вручную)
cat > ~/.opencode/tg/.env << ENVFILE
TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE
OPENCODE_WORKSPACE=/opt/skillbase
ALLOWED_USERS=7554503862
OPENCODE_TRUST_ALL_TOOLS=false
AUTO_UPDATE=false
OPENCODE_TG_SINGLE_INSTANCE=true
ENVFILE

chmod 600 ~/.opencode/tg/.env
echo "⚠️  ВАЖНО: Отредактируйте ~/.opencode/tg/.env и вставьте свой TELEGRAM_BOT_TOKEN"
EOF

# 13. Создание systemd сервиса для бота
echo "📋 Шаг 13: Создание systemd сервиса..."
ssh root@$INSTANCE_IP << 'EOF'
cat > /etc/systemd/system/opencode-tg-bot.service << SERVICE
[Unit]
Description=OpenCode Telegram Bot
After=network.target freellmapi.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/opencode-telegram-bot
Environment=OPENCODE_TG_DIR=/root/.opencode/tg
Environment=OPENCODE_WORKSPACE=/opt/skillbase
ExecStart=/usr/local/bin/node --import tsx /opt/opencode-telegram-bot/src/index.ts --instance /root/.opencode/tg
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable opencode-tg-bot
echo "✅ Systemd сервис создан"
EOF

# 14. Создание директории для skillbase
echo "📁 Шаг 14: Создание workspace..."
ssh root@$INSTANCE_IP << 'EOF'
mkdir -p /opt/skillbase
cd /opt/skillbase
git init
git remote add origin https://github.com/NewRail-project/skillbase.git
git fetch origin main
git checkout origin/main
EOF

# 15. Запуск бота
echo "🚀 Шаг 15: Запуск бота..."
ssh root@$INSTANCE_IP << 'EOF'
echo "⚠️  Бот запущен, но НЕ РАБОТАЕТ без токена в ~/.opencode/tg/.env"
echo "1. SSH на VPS: ssh root@$INSTANCE_IP"
echo "2. Отредактируйте: nano ~/.opencode/tg/.env"
echo "3. Замените YOUR_TOKEN_HERE на свой токен"
echo "4. Перезапустите сервис: systemctl restart opencode-tg-bot"
echo "5. Проверьте статус: systemctl status opencode-tg-bot"
EOF

echo "=================================================="
echo "✅ Деплой завершён!"
echo ""
echo "📋 Дальнейшие шаги:"
echo "1. SSH на VPS: ssh root@$INSTANCE_IP"
echo "2. Отредактируйте ~/.opencode/tg/.env"
echo "3. Вставьте TELEGRAM_BOT_TOKEN"
echo "4. Перезапустите: systemctl restart opencode-tg-bot"
echo "5. Проверьте статус: systemctl status opencode-tg-bot"
echo ""
echo "🔗 Бот будет доступен как @Freeopencodebot"
echo "=================================================="