# 📱 Подключение WhatsApp

## Почему WhatsApp не подключен?

WhatsApp Web требует:
1. **Chrome/Chromium браузер** для Puppeteer
2. **Docker** (рекомендуется) или локальную установку всех зависимостей
3. **Авторизацию через QR код**

## ✅ Рекомендуемый способ: Docker

### Шаг 1: Установите Docker Desktop

Скачайте и установите:
- Mac: https://www.docker.com/products/docker-desktop/
- Windows: https://www.docker.com/products/docker-desktop/

### Шаг 2: Запустите Docker Desktop

Откройте приложение Docker Desktop и дождитесь полной загрузки

### Шаг 3: Запустите сервис

```bash
cd /Users/bagamedovyusup/work/strahovka
docker-compose up -d
```

### Шаг 4: Просмотрите QR код

```bash
docker-compose logs -f app
```

В логах появится QR код (ASCII art).

### Шаг 5: Отсканируйте QR код

1. Откройте WhatsApp на телефоне
2. Нажмите на три точки (меню) → "Связанные устройства"
3. Нажмите "Привязать устройство"
4. Отсканируйте QR код из терминала

### Шаг 6: Откройте веб-интерфейс

```
http://localhost:3000
```

Статус WhatsApp станет зеленым ✅

## 🔧 Альтернативный способ: Локально (сложнее)

### Требования

```bash
# 1. Установите Chrome/Chromium
brew install --cask google-chrome

# 2. Установите все зависимости
npm install

# 3. Запустите
node start-local.js
```

⚠️ **Проблема:** Puppeteer может не найти Chrome автоматически.

### Решение проблемы с Puppeteer

Отредактируйте `start-local.js`, добавьте путь к Chrome:

```javascript
whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox']
  }
});
```

## 🎮 Текущие режимы работы

### 1. Демо-режим (БЕЗ WhatsApp)

```bash
npm run demo
```

✅ Работает:
- Веб-интерфейс
- Управление клиентами
- Статистика

❌ Не работает:
- WhatsApp
- База данных
- Импорт Excel

### 2. Локальный режим (С WhatsApp, но нужен Chrome)

```bash
npm run local
```

✅ Работает:
- Всё из демо-режима
- WhatsApp (если установлен Chrome)

❌ Не работает:
- PostgreSQL
- Импорт из Excel

### 3. Docker (ПОЛНАЯ ВЕРСИЯ)

```bash
docker-compose up -d
```

✅ Работает ВСЁ:
- Веб-интерфейс
- WhatsApp
- PostgreSQL база данных
- Импорт из Excel
- Все функции

## 📊 Сравнение режимов

| Функция | Демо | Локально | Docker |
|---------|------|----------|--------|
| Веб-интерфейс | ✅ | ✅ | ✅ |
| Управление клиентами | ✅ | ✅ | ✅ |
| WhatsApp | ❌ | ⚠️ | ✅ |
| PostgreSQL | ❌ | ❌ | ✅ |
| Импорт Excel | ❌ | ❌ | ✅ |
| Сохранение данных | ❌ | ❌ | ✅ |

## 🚀 Что делать сейчас?

### Вариант A: Хотите WhatsApp

1. Установите Docker Desktop
2. Запустите `docker-compose up -d`
3. Отсканируйте QR код

### Вариант B: Просто посмотреть интерфейс

1. Используйте демо: `npm run demo`
2. Откройте http://localhost:3000
3. WhatsApp будет показан как "не подключен" (это нормально)

## ❓ FAQ

**Q: Зачем нужен WhatsApp?**
A: Для автоматической отправки напоминаний клиентам

**Q: Можно без WhatsApp?**
A: Да, используйте демо-режим. Всё работает кроме отправки сообщений

**Q: Как проверить что WhatsApp подключен?**
A: В веб-интерфейсе в правом верхнем углу должен быть зеленый статус

**Q: Сохраняется ли сессия WhatsApp?**
A: Да, в Docker она сохраняется в volume. При перезапуске QR код не нужен

**Q: Можно использовать несколько номеров WhatsApp?**
A: Да, запустите несколько копий сервиса с разными сессиями

## 🔍 Проверка статуса

```bash
# Через веб-интерфейс
open http://localhost:3000

# Через API
curl http://localhost:3000/api/whatsapp/status

# Через логи (Docker)
docker-compose logs app | grep WhatsApp
```

## 📝 Заметки

- WhatsApp Web требует стабильное подключение к интернету
- Телефон должен быть онлайн
- Сессия действует ~2 недели, потом нужно пересканировать QR
- В Docker сессия сохраняется автоматически
- Можно отправлять ~1000 сообщений в день
