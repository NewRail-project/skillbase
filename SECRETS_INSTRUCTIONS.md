# Инструкция по настройке бота на GitHub Actions

## 1. Добавление токена в GitHub Secrets

Выполнить эти команды в терминале:

```bash
# Показать токен (если он у тебя есть)
echo "TELEGRAM_BOT_TOKEN=твой_токен_здесь"

# Или создать файл с токеном
echo "твой_токен_здесь" > /tmp/bot_token.txt
cat /tmp/bot_token.txt
```

## 2. Настройка GitHub Secrets

Зайти на GitHub:
1. Открыть репозиторий: https://github.com/NewRail-project/skillbase
2. Settings → Secrets and variables → Actions
3. New repository secret
4. Name: `TELEGRAM_BOT_TOKEN`
5. Secret: [вставить токен]
6. Add secret

## 3. Запуск workflow

```bash
# Проверить workflow
echo "📋 Проверить статус: https://github.com/NewRail-project/skillbase/actions"

# Запустить вручную через GitHub интерфейса
echo "1. Зайти в Actions"
echo "2. Выбрать 'OpenCode Telegram Bot (Simple)'"
echo "3. Нажать 'Run workflow'"
```

## 4. Проверка работы

```bash
# Проверить логи после запуска
echo "📊 Логи будут доступны в GitHub Actions"
echo "🤖 Бот должен работать как @Freeopencodebot"
```

## 5. Автоматический запуск

Бот будет запускаться автоматически:
- Каждые 10 минут через cron
- При пуше в репозиторий
- Можно запускать вручную

## 6. Альтернативный запуск

Если нужно запустить бота локально для теста:

```bash
# Запуск через Termux (не стабильно)
~/.opencode/tg/termux-bot.sh start

# Остановка
~/.opencode/tg/termux-bot.sh stop

# Статус
~/.opencode/tg/termux-bot.sh status
```

## Важно!

- Токен должен быть активным
- Бот будет работать только для Telegram ID 7554503862
- На GitHub Actions есть ограничение 15 минут на выполнение
- Бесплатный тариф GitHub Actions