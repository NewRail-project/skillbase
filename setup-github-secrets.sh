#!/bin/bash

echo "🚀 Настройка GitHub Secrets для OpenCode Telegram Bot"
echo "=================================================="

# Показать текущий токен (если есть)
if [ -f ~/.opencode/tg/.env ]; then
    echo "💾 Текущий токен из локального файла:"
    grep "TELEGRAM_BOT_TOKEN" ~/.opencode/tg/.env | cut -d'=' -f2
    echo ""
fi

echo "📋 Инструкция по добавлению токена в GitHub:"
echo "1. Открыть: https://github.com/NewRail-project/skillbase/settings/secrets/actions"
echo "2. Нажать 'New repository secret'"
echo "3. Name: TELEGRAM_BOT_TOKEN"
echo "4. Secret: [вставить токен]"
echo "5. Нажать 'Add secret'"
echo ""

echo "🔗 Ссылки:"
echo "- Репозиторий: https://github.com/NewRail-project/skillbase"
echo "- Actions: https://github.com/NewRail-project/skillbase/actions"
echo ""

echo "🤖 После настройки:"
echo "1. Зайти в Actions"
echo "2. Выбрать 'OpenCode Telegram Bot (Simple)'"
echo "3. Нажать 'Run workflow'"
echo "4. Дождаться завершения (до 8 минут)"
echo ""

echo "✅ Готово! Бот будет работать стабильно на GitHub Actions."