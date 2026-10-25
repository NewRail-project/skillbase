#!/bin/bash

echo "🤖 Настройка OpenCode Telegram Bot через GitHub Actions"

# Создаем временную директорию для теста
mkdir -p /tmp/skillbase-github
cd /tmp/skillbase-github

# Клонируем бота (если еще не установлен)
if [ ! -d "node_modules/@artickc/opencode-telegram-bot" ]; then
    echo "Установка зависимостей..."
    npm install -g @artickc/opencode-telegram-bot@2.0.0
    npm install -g tsx
fi

# Создаем конфиг
mkdir -p ~/.opencode/tg-github/logs
cat > ~/.opencode/tg-github/.env << EOF
TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE
OPENCODE_WORKSPACE=/tmp/skillbase-github
ALLOWED_USERS=7554503862
OPENCODE_TRUST_ALL_TOOLS=false
AUTO_UPDATE=false
OPENCODE_TG_SINGLE_INSTANCE=true
EOF
chmod 600 ~/.opencode/tg-github/.env

echo "✅ Конфиг создан: ~/.opencode/tg-github/.env"
echo "📝 Нужно:"
echo "1. Создать GitHub репозиторий для skillbase"
echo "2. Добавить TELEGRAM_BOT_TOKEN в Secrets репозитория"
echo "3. Запустить workflow вручную"
echo ""
echo "🔧 Для локального тестирования:"
echo "cd ~/.opencode/tg-github"
echo "export TELEGRAM_BOT_TOKEN=ваш_токен"
echo "node --import tsx /usr/lib/node_modules/@artickc/opencode-telegram-bot/src/index.ts --instance ."
echo ""
echo "🚀 После настройки на GitHub:"
echo "1. git add .github/workflows/"
echo "2. git commit -m 'Add GitHub Actions bot'"
echo "3. git push"
echo "4. В GitHub Settings → Secrets → Actions добавить TELEGRAM_BOT_TOKEN"
echo "5. Запустить workflow вручную или ждать автоматического запуска"