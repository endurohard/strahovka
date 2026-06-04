# 🔧 Устранение неполадок

## Проблема: после простоя рассылки клиенты получают напоминания по истёкшим страховкам

**Симптом:** в сообщениях отрицательные дни («Осталось всего -16 дней!»),
напоминания уходят по полисам, истёкшим недели/месяцы назад.

**Причина:** выборка due-клиентов идёт по `reminder_date <= CURRENT_DATE` и
`last_reminder_sent IS NULL`. Если отправка долго не работала (сломанная
очередь, упавший контейнер), накапливается бэклог — после починки он
выгребается целиком.

**Решение (внедрено 04.06.2026):** во все выборки добавлен фильтр
`expiration_date::date >= CURRENT_DATE` (`getDailyReminders`, `getStats`,
`getDueContactsWithoutPhone`). Просроченный бэклог игнорируется навсегда.

**Проверка перед перезапуском после долгого простоя:**

```bash
docker exec strahovka-db psql -U postgres -d strahovka -c \
  "SELECT count(*) FROM clients
   WHERE reminder_date::date <= CURRENT_DATE
     AND last_reminder_sent IS NULL
     AND phone_formatted IS NOT NULL AND btrim(phone_formatted) <> '';"
```

Если число большое — убедиться, что фильтр по `expiration_date` на месте.

## Проблема: Не открывается веб-интерфейс

### Проверка 1: Убедитесь что сервер запущен

```bash
# Проверьте процесс на порту 3000
lsof -i :3000
```

Должно показать процесс `node` на порту 3000.

### Проверка 2: Проверьте API

```bash
curl http://localhost:3000/api/health
```

Должно вернуть JSON с статусом:
```json
{"status":"ok","database":"demo mode","whatsapp":"demo mode","timestamp":"..."}
```

### Проверка 3: Откройте в разных браузерах

Попробуйте открыть в разных браузерах:

**Chrome/Edge:**
```
http://localhost:3000
```

**Safari:**
```
http://localhost:3000
```

**Firefox:**
```
http://localhost:3000
```

### Проверка 4: Очистите кэш браузера

1. Откройте инструменты разработчика (F12)
2. Во вкладке Network поставьте галочку "Disable cache"
3. Обновите страницу (Cmd+Shift+R или Ctrl+Shift+R)

### Проверка 5: Проверьте файлы

```bash
# Убедитесь что файлы на месте
ls -la public/
# Должны быть: index.html, app.js
```

### Проверка 6: Попробуйте другой порт

Если порт 3000 занят, измените в `.env`:

```env
API_PORT=8080
```

Затем перезапустите:
```bash
npm run demo
```

И откройте:
```
http://localhost:8080
```

### Проверка 7: Проверьте логи

```bash
# Если запустили в фоне
docker-compose logs -f app

# Если запустили npm run demo
# Логи будут в терминале
```

## Альтернативные способы

### Способ 1: Прямой доступ к HTML

Откройте файл напрямую в браузере:

```
file:///Users/bagamedovyusup/work/strahovka/public/index.html
```

⚠️ API не будет работать, но вы увидите интерфейс.

### Способ 2: Используйте curl для проверки

```bash
# Получить HTML
curl http://localhost:3000/ > test.html
open test.html

# Проверить API
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/clients
```

### Способ 3: Используйте Python сервер

Если Node.js не работает:

```bash
cd public
python3 -m http.server 8000
```

Откройте:
```
http://localhost:8000
```

⚠️ API не будет работать.

## Распространенные проблемы

### Ошибка: Port already in use

```bash
# Найти процесс
lsof -i :3000

# Остановить процесс
kill -9 <PID>

# Или используйте другой порт
API_PORT=8080 npm run demo
```

### Ошибка: Cannot find module 'express'

```bash
# Установите зависимости
npm install
```

### Ошибка: ECONNREFUSED

Сервер не запущен. Запустите:

```bash
npm run demo
```

### Ошибка: 404 Not Found

Файлы в директории `public/` не найдены. Проверьте:

```bash
ls -la public/
# Должны быть: index.html, app.js
```

## Docker проблемы

### Docker не запускается

1. Запустите Docker Desktop
2. Подождите пока он полностью загрузится
3. Проверьте статус:

```bash
docker ps
```

### Контейнеры не запускаются

```bash
# Пересоберите образы
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### База данных не подключается

```bash
# Проверьте логи
docker-compose logs db

# Перезапустите контейнер
docker-compose restart db
```

### WhatsApp не подключается

```bash
# Проверьте логи
docker-compose logs app | grep WhatsApp

# Удалите сессию и пересоздайте
docker-compose down
docker volume rm strahovka_whatsapp_session
docker-compose up -d
```

## Проверка системы

### Проверить все компоненты

```bash
# Node.js
node --version

# npm
npm --version

# Docker
docker --version
docker-compose --version

# Порт 3000
lsof -i :3000

# Файлы проекта
ls -la

# Зависимости
npm list --depth=0
```

## Получение помощи

### Соберите информацию о системе

```bash
# Версии
node --version
npm --version
docker --version

# Логи
docker-compose logs app > logs.txt

# Статус
docker-compose ps > status.txt
```

### Проверьте документацию

1. **README.md** - основная документация
2. **DEMO.md** - демо-режим
3. **WEB_INTERFACE.md** - веб-интерфейс
4. **START_HERE.md** - быстрый старт

## Быстрое решение

Если ничего не помогает, попробуйте с нуля:

```bash
# 1. Остановите все
docker-compose down
killall node

# 2. Очистите
rm -rf node_modules
rm -rf .wwebjs_auth

# 3. Переустановите
npm install

# 4. Запустите демо
npm run demo

# 5. Откройте
open http://localhost:3000
```

## Контакты

Если проблема не решается:
1. Проверьте все пункты выше
2. Соберите логи
3. Опишите проблему подробно
4. Укажите версии (Node.js, Docker, ОС)
