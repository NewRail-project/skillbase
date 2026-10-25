# OpenCode Telegram Bot через GitHub Actions

## План настройки

### 1. Создать GitHub репозиторий
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/skillbase.git
git push -u origin main
```

### 2. Настроить Secrets в GitHub
- Зайти в репозиторий → Settings → Secrets and variables → Actions
- Добавить новый secret: `TELEGRAM_BOT_TOKEN` (твой токен)

### 3. Создать workflow файл
Создать файл `.github/workflows/opencode-bot.yml` с содержимым:

```yaml
name: OpenCode Telegram Bot

on:
  schedule:
    # Запуск каждые 10 минут
    - cron: '*/10 * * * *'
  workflow_dispatch:
  push:
    branches: [ main, master ]

jobs:
  run-bot:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
        
    - name: Install dependencies
      run: |
        npm install -g @artickc/opencode-telegram-bot@2.0.0
        npm install -g tsx
        
    - name: Setup environment
      run: |
        mkdir -p ~/.opencode/tg
        mkdir -p ~/.opencode/tg/logs
        echo "TELEGRAM_BOT_TOKEN=${{ secrets.TELEGRAM_BOT_TOKEN }}" > ~/.opencode/tg/.env
        echo "OPENCODE_WORKSPACE=/tmp/skillbase" >> ~/.opencode/tg/.env
        echo "ALLOWED_USERS=7554503862" >> ~/.opencode/tg/.env
        echo "OPENCODE_TRUST_ALL_TOOLS=false" >> ~/.opencode/tg/.env
        echo "AUTO_UPDATE=false" >> ~/.opencode/tg/.env
        echo "OPENCODE_TG_SINGLE_INSTANCE=true" >> ~/.opencode/tg/.env
        chmod 600 ~/.opencode/tg/.env
        
    - name: Clone FreeLLMAPI
      run: |
        git clone https://github.com/your-username/FreeCodeStudio.git /tmp/FreeCodeStudio || echo "Repo already exists"
        cd /tmp/FreeCodeStudio
        npm install
        npm run dev &
        
    - name: Wait for FreeLLMAPI
      run: |
        sleep 15
        curl -f http://localhost:3001 || exit 1
        
    - name: Start OpenCode
      run: |
        opencode serve --service &
        sleep 10
        
    - name: Run bot
      run: |
        mkdir -p /tmp/skillbase
        cd /tmp/skillbase
        timeout 600 opencode acp &
        sleep 5
        cd ~/.opencode/tg
        timeout 600 node --import tsx /usr/lib/node_modules/@artickc/opencode-telegram-bot/src/index.ts --instance ~/.opencode/tg
```

### 4. Запустить workflow
- Зайти в Actions репозитория
- Нажать "Run workflow" вручную
- Или ждать автоматического запуска (каждые 10 минут)

### 5. Альтернатива: Render.com (бесплатный)
Можно использовать Render.com для постоянного запуска:

1. Создать аккаунт на Render.com
2. Подключить GitHub репозиторий
3. Создать Web Service с командой:
   ```bash
   node --import tsx /usr/lib/node_modules/@artickc/opencode-telegram-bot/src/index.ts --instance /app/.opencode/tg
   ```
4. Добавить переменные окружения:
   - `TELEGRAM_BOT_TOKEN`
   - `OPENCODE_WORKSPACE=/app`
   - `ALLOWED_USERS=7554503862`

## Преимущества GitHub Actions
- Бесплатно
- Стабильнее Android
- Автоматический перезапуск
- Логи в интерфейсе GitHub
- Не падает при перезагрузке

## Минусы
- Ограничение по времени выполнения (15 минут)
- Нужно периодически перезапускать
- Бесплатный токен должен быть активным