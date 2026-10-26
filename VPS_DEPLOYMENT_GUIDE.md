# Инструкция по переустановке на Oracle Cloud VPS

## Результат

Бот перенесён с телефона (Termux) на постоянный сервер Oracle Cloud Free VPS. Бот будет работать 24/7 без падений и не будет зависеть от телефона.

## Что включает стек на VPS:

1. **FreeLLMAPI** - запускается на сервере (порт 3001)
2. **OpenCode 2.0.26** - работает на сервере
3. **OpenCode Telegram Bot 2.0.0** - запущен через systemd сервис
4. **Проект skillbase** - находится на сервере

## Шаги для задеплоя:

### 1. Создание VPS на Oracle Cloud
1. Зайти на https://cloud.oracle.com/
2. Создать Compute Instance (Compute → Instances → Create Instance)
3. Выбрать образ: **Ubuntu 22.04 LTS**
4. Выбрать формой: **VM.Standard.A1.Flex** (4 OCPU, 24 GB RAM) - это платный лимит, но полностью бесплатный навсегда (Always Free)
5. Сохранить приватный SSH ключ
6. Получить Публичный IP адрес

### 2. Запуск скрипта деплоя
На телефоне (в Termux) выполните:

```bash
cd ~/skillbase
chmod +x vps-deploy.sh
./vps-deploy.sh <IP_АДРЕС_ВАШЕГО_VPS>
```

Скрипт автоматически:
- Установит Node.js, Docker, OpenCode, Bot
- Настроит и запустит FreeLLMAPI
- Создаст systemd сервис для бота
- Клонирует ваш проект `skillbase`

### 3. Добавление токена
Подключитесь к VPS по SSH и добавьте токен:

```bash
# Подключение к VPS
ssh -i /path/to/your/ssh-key root@<IP_АДРЕС_VPS>

# Редактирование конфига
nano ~/.opencode/tg/.env

# Вставьте ваш токен вместо YOUR_TOKEN_HERE
TELEGRAM_BOT_TOKEN=8771111789:AAFPd3aqlXmZRoamObxAgcs_8x3DFQ56jEY

# Сохранить: Ctrl+O, Enter, Ctrl+X

# Перезапуск сервиса
systemctl restart opencode-tg-bot

# Проверка статуса
systemctl status opencode-tg-bot
```

### 4. Проверка работы
1. В Telegram отправьте боту **@Freeopencodebot** команду `/status`
2. Бот должен ответить:
   ```
   🤖 OpenCode Telegram Bot — запущен
   Сессия: ses_e8b5
   Пользователь: 7554503862
   Модель: freellmapi/auto
   ```

## Преимущества переезда на VPS:

- ✅ **Не падает при выключении телефона**
- ✅ **Работает 24/7 без ограничений Termux**
- ✅ **Бесплатный хостинг навсегда**
- ✅ **Автоматический перезапуск через systemd**
- ✅ **Все компоненты (FreeLLMAPI + OpenCode + Bot) на одном сервере**

## Важные файлы на VPS:

- Конфиг бота: `/root/.opencode/tg/.env`
- Логи бота: `/root/.opencode/tg/logs/opencode-telegram-bot.log`
- Логи сервиса: `journalctl -u opencode-tg-bot -f`
- FreeLLMAPI: `/opt/freellmapi`
- OpenCode: `/opt/opencode`
- Проект: `/opt/skillbase`

## Управление сервисом на VPS:

```bash
# Запуск
systemctl start opencode-tg-bot

# Остановка
systemctl stop opencode-tg-bot

# Перезапуск
systemctl restart opencode-tg-bot

# Статус
systemctl status opencode-tg-bot

# Просмотр логов в реальном времени
journalctl -u opencode-tg-bot -f
```

После этих шагов бот станет полностью автономным!