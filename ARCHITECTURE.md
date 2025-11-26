# Архитектура сервиса

## Общая схема

```
┌─────────────────┐
│  Excel файл     │
│  (clients.xlsx) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Node.js Application             │
│  ┌───────────────────────────────────┐  │
│  │  excelReader.js                   │  │
│  │  - Чтение Excel                   │  │
│  │  - Парсинг данных                 │  │
│  │  - Расчет дат                     │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  database.js                      │  │
│  │  - Импорт данных                  │  │
│  │  - Хранение клиентов              │  │
│  │  - Запросы к БД                   │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  index.js (Scheduler)             │  │
│  │  - Cron задачи                    │  │
│  │  - Проверка напоминаний           │  │
│  │  - Координация                    │  │
│  └──────────────┬────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  whatsappService.js               │  │
│  │  - WhatsApp Web авторизация       │  │
│  │  - Отправка сообщений             │  │
│  │  - Форматирование текста          │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │                │
         ▼                ▼
┌─────────────┐  ┌─────────────────┐
│ PostgreSQL  │  │  WhatsApp Web   │
│   Database  │  │                 │
└─────────────┘  └─────────────────┘
```

## Компоненты

### 1. excelReader.js

**Назначение**: Чтение и обработка Excel файлов

**Функции**:
- `readClientsFromExcel(filePath)` - чтение данных из Excel
- `excelSerialToDate(serial)` - преобразование Excel даты
- `formatPhoneNumber(phone)` - форматирование номера телефона
- `getClientsForReminder(clients)` - фильтрация клиентов для напоминания

**Логика расчета дат**:
```javascript
// Дата начала страховки из Excel
startDate = excelSerialToDate(row[1])

// Дата окончания = начало + 1 год
expirationDate = startDate + 1 year

// Дата напоминания = окончание - 7 дней
reminderDate = expirationDate - 7 days
```

### 2. database.js

**Назначение**: Работа с PostgreSQL базой данных

**Схема таблицы**:
```sql
CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  excel_id INTEGER,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  phone_formatted VARCHAR(20),
  insurance VARCHAR(100),
  services TEXT,
  amount DECIMAL(10, 2),
  start_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  reminder_date DATE NOT NULL,
  last_reminder_sent TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(phone_formatted, start_date)
);
```

**Функции**:
- `initialize()` - создание таблиц
- `upsertClient(client)` - добавление/обновление клиента
- `importClients(clients)` - массовый импорт
- `getClientsForReminder(date)` - получение клиентов для напоминания
- `markReminderSent(clientId)` - отметка об отправке
- `getStats()` - статистика

### 3. whatsappService.js

**Назначение**: Интеграция с WhatsApp Web

**Технологии**:
- `whatsapp-web.js` - библиотека для WhatsApp Web API
- `puppeteer` - для автоматизации браузера
- `qrcode-terminal` - отображение QR кода

**Функции**:
- `initialize()` - инициализация и авторизация
- `sendMessage(phone, message)` - отправка сообщения
- `createReminderMessage(client)` - формирование текста
- `sendReminders(clients)` - массовая отправка

**Формат сообщения**:
```
Здравствуйте, {ИМЯ}!

Напоминаем, что срок действия вашей страховки ({КОМПАНИЯ})
истекает {ДАТА}.

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!
```

### 4. index.js

**Назначение**: Главный файл приложения и планировщик

**Функции**:
- `initialize()` - запуск всех компонентов
- `importFromExcel()` - импорт данных
- `checkAndSendReminders()` - проверка и отправка
- `setupScheduler()` - настройка расписания
- `shutdown()` - корректная остановка

**Расписание (node-cron)**:
```javascript
// Обновление данных каждый день в 09:00
'0 9 * * *' => importFromExcel()

// Проверка напоминаний каждый день в 10:00
'0 10 * * *' => checkAndSendReminders()
```

## Жизненный цикл данных

### 1. Импорт данных
```
Excel → excelReader → Database
```

1. Чтение Excel файла
2. Парсинг строк (пропуск заголовков)
3. Преобразование дат
4. Расчет reminder_date и expiration_date
5. Форматирование номеров
6. Сохранение в БД (upsert)

### 2. Проверка напоминаний
```
Database → Scheduler → WhatsApp
```

1. Запрос клиентов с reminder_date = сегодня
2. Фильтрация неотправленных
3. Для каждого клиента:
   - Форматирование сообщения
   - Отправка через WhatsApp
   - Отметка в БД (last_reminder_sent)
   - Задержка 2-3 секунды

### 3. Обновление данных
```
Excel (новая версия) → Database (upsert)
```

1. Чтение обновленного Excel
2. Upsert по ключу (phone_formatted, start_date)
3. Обновление существующих записей
4. Добавление новых

## Docker инфраструктура

### Сервисы

**db** (PostgreSQL):
- Image: `postgres:15-alpine`
- Port: 5432
- Volume: `postgres_data`
- Healthcheck: проверка доступности

**app** (Node.js):
- Build: локальный Dockerfile
- Depends on: db (с healthcheck)
- Volumes:
  - `./data` → `/data` (Excel файлы)
  - `whatsapp_session` → `/app/.wwebjs_auth` (сессия WhatsApp)

### Volumes

- `postgres_data` - данные PostgreSQL (персистентны)
- `whatsapp_session` - сессия WhatsApp Web (персистентна)

## Переменные окружения

```env
DB_HOST=db              # Хост базы данных
DB_PORT=5432            # Порт базы данных
DB_NAME=strahovka       # Имя базы данных
DB_USER=postgres        # Пользователь БД
DB_PASSWORD=postgres    # Пароль БД
EXCEL_FILE_PATH=/data/clients.xlsx  # Путь к Excel
TZ=Europe/Moscow        # Часовой пояс
```

## Безопасность

1. **База данных**:
   - Пароли через .env
   - Не экспонируется наружу (только для app)

2. **WhatsApp сессия**:
   - Хранится в отдельном volume
   - Не попадает в git (.gitignore)
   - Переиспользуется между запусками

3. **Excel файл**:
   - Только внутри контейнера
   - Не в git (.gitignore)
   - Можно обновлять без пересборки

## Масштабирование

### Горизонтальное
- Несколько инстансов app для разных WhatsApp аккаунтов
- Общая база данных
- Разные Excel файлы

### Вертикальное
- Увеличение ресурсов контейнера
- Оптимизация запросов к БД
- Батчинг сообщений WhatsApp

## Мониторинг

### Логи
```bash
docker-compose logs -f app     # Логи приложения
docker-compose logs -f db      # Логи БД
```

### Метрики (из БД)
- Всего клиентов
- Предстоящие напоминания
- Ожидающие отправки
- Отправленные

### Алерты
- Ошибки подключения к WhatsApp
- Ошибки БД
- Неотправленные сообщения

## Восстановление после сбоя

1. **Потеря WhatsApp сессии**:
   - Пересканирование QR кода
   - Сессия сохранится в volume

2. **Потеря данных БД**:
   - Повторный импорт из Excel
   - Volume с данными персистентен

3. **Обновление кода**:
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

## Тестирование

### Локально (без Docker)
```bash
npm install
DB_HOST=localhost node index.js --import
```

### В Docker
```bash
docker-compose up -d
docker-compose exec app node index.js --import
docker-compose exec app node index.js --check-now
```

### Проверка БД
```bash
./check-db.sh
```
