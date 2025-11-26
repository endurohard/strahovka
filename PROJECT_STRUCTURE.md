# Структура проекта

## Файлы приложения

### Основные модули (JavaScript)

- **index.js** - Главный файл приложения
  - Инициализация сервиса
  - Планировщик задач (cron)
  - Координация между модулями
  - Обработка сигналов завершения

- **excelReader.js** - Чтение и обработка Excel файлов
  - Чтение XLSX файлов
  - Преобразование Excel дат
  - Расчет дат напоминаний
  - Форматирование номеров телефонов

- **database.js** - Работа с PostgreSQL
  - Создание таблиц
  - CRUD операции для клиентов
  - Импорт данных
  - Получение статистики

- **whatsappService.js** - Интеграция с WhatsApp
  - Авторизация через WhatsApp Web
  - Отправка сообщений
  - Создание текста напоминаний
  - Обработка QR кодов

- **read-excel.js** - Тестовый скрипт для чтения Excel

### Docker конфигурация

- **Dockerfile** - Образ Node.js приложения
  - Установка зависимостей Puppeteer
  - Копирование кода
  - Настройка окружения

- **docker-compose.yml** - Оркестрация сервисов
  - PostgreSQL база данных
  - Node.js приложение
  - Volumes для данных и сессии WhatsApp
  - Healthchecks

- **.dockerignore** - Исключения для Docker

### Конфигурация проекта

- **package.json** - Зависимости и скрипты
  - Dependencies: xlsx, whatsapp-web.js, pg, node-cron, dotenv
  - Scripts: start, import, check, dev

- **package-lock.json** - Зафиксированные версии

- **.env** - Переменные окружения (не в git)
- **.env.example** - Шаблон переменных окружения

- **.gitignore** - Исключения для git
  - node_modules
  - .env
  - .wwebjs_auth
  - data/
  - *.xlsx

### Документация

- **README.md** - Основная документация
  - Описание проекта
  - Установка и запуск
  - Использование
  - Устранение неполадок

- **QUICKSTART.md** - Быстрый старт
  - Пошаговая инструкция
  - Команды для проверки
  - Тестирование

- **ARCHITECTURE.md** - Архитектура системы
  - Схема компонентов
  - Жизненный цикл данных
  - Docker инфраструктура
  - Безопасность и масштабирование

- **PROJECT_STRUCTURE.md** - Этот файл

### Скрипты

- **check-db.sh** - Проверка базы данных
  - Статистика клиентов
  - Предстоящие напоминания
  - Клиенты на сегодня

### Директории

- **data/** - Excel файлы (не в git)
  - clients.xlsx - Файл с данными клиентов

- **node_modules/** - Зависимости npm (не в git)

- **.wwebjs_auth/** - Сессия WhatsApp (не в git)
  - Создается автоматически при первом запуске

- **.git/** - Git репозиторий

## Дерево проекта

```
strahovka/
├── index.js                  # Главный файл приложения
├── excelReader.js            # Чтение Excel
├── database.js               # Работа с PostgreSQL
├── whatsappService.js        # WhatsApp интеграция
├── read-excel.js             # Тестовый скрипт
│
├── Dockerfile                # Docker образ
├── docker-compose.yml        # Docker Compose
├── .dockerignore            
├── .env                      # Переменные окружения (не в git)
├── .env.example             
│
├── package.json              # Зависимости
├── package-lock.json        
├── .gitignore               
│
├── README.md                 # Основная документация
├── QUICKSTART.md            # Быстрый старт
├── ARCHITECTURE.md          # Архитектура
├── PROJECT_STRUCTURE.md     # Этот файл
│
├── check-db.sh              # Скрипт проверки БД
│
├── data/                    # Excel файлы (не в git)
│   └── clients.xlsx         # Данные клиентов
│
├── node_modules/            # Зависимости (не в git)
├── .wwebjs_auth/           # Сессия WhatsApp (не в git)
└── .git/                    # Git репозиторий
```

## Размеры файлов

```
index.js           ~7 KB   - Главное приложение
excelReader.js     ~4 KB   - Excel парсер
database.js        ~7 KB   - База данных
whatsappService.js ~6 KB   - WhatsApp сервис
Dockerfile         ~1.5 KB - Docker образ
docker-compose.yml ~1 KB   - Compose конфиг
README.md          ~7 KB   - Документация
ARCHITECTURE.md    ~10 KB  - Архитектура
```

## Команды для работы

### Разработка

```bash
npm install              # Установка зависимостей
npm start               # Запуск приложения
npm run import          # Импорт из Excel
npm run check           # Проверка напоминаний
```

### Docker

```bash
docker-compose up -d              # Запуск
docker-compose down              # Остановка
docker-compose logs -f app       # Логи
docker-compose exec app bash     # Консоль
./check-db.sh                    # Проверка БД
```

## Добавление новых функций

### Новый источник данных (кроме Excel)

1. Создать новый модуль (например, `csvReader.js`)
2. Реализовать аналогичный интерфейс
3. Обновить `index.js` для поддержки нового формата

### Новый канал уведомлений (кроме WhatsApp)

1. Создать новый сервис (например, `telegramService.js`)
2. Реализовать методы: `initialize()`, `sendMessage()`
3. Обновить `index.js` для выбора канала

### Веб-интерфейс

1. Добавить Express.js
2. Создать API эндпоинты
3. Добавить frontend (React/Vue)
4. Обновить `docker-compose.yml`
